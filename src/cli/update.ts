/**
 * `npx egovframe-mcp-search update` — 지식베이스 갱신 CLI
 *
 * 5개 리소스를 독립적으로 갱신한다 (부분 실패 = 부분 성공):
 *   developer_knowledge  릴리스 스냅샷 → 직전 적용 스냅샷과 id 대조 → 변경분만 임베딩
 *   guide                GitHub 태그 소스(md) → 전량 재인덱싱 (원본 ~수 MB)
 *   common_components    GitHub 태그 tarball → 트리 교체 (임베딩 0, SQLite 미변경)
 *   compatibility        릴리스 JSON → 오버레이 SQLite 에 deterministic 재적재
 *   custom_terms         사용자 반입 CSV(--from-file 전용) → 오버레이 SQLite 재적재
 *
 * SQLite 두 리소스는 하나의 오버레이 DB 사본을 공유하며(utils/dataPaths 의
 * base 추적 — 번들이 이기는 규칙), 패키지 갱신으로 사본이 무효화되면 보관된
 * 적용 원본으로 새 번들 위에 재적용해 치유한다.
 *
 * 갱신분은 패키지 디렉토리가 아니라 사용자 데이터 디렉토리(오버레이)에 쓴다 —
 * npm 재설치/업그레이드/npx 캐시 정리에 소실되지 않는다 (utils/dataPaths 참조).
 * 활성 버전 전환은 오버레이 state.json 의 원자 교체(temp-write + rename)로만
 * 이뤄지므로 Windows 파일 잠금 문제를 정면 회피한다.
 *
 * 출력은 전부 stderr — stdout 은 MCP stdio 전송 전용.
 */

import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin as input } from 'node:process';
import {
  SCHEMA_VERSION,
  EMBEDDING_MODEL_ID,
  getOverlayRoot,
  readOverlayState,
  readBundledState,
  writeOverlayStateAtomic,
  resolveResource,
  getOverlaySqliteDir,
  getOverlaySqliteDbPath,
  writeOverlaySqliteBase,
  isOverlaySqliteValid,
  type ResourceName,
  type ResourceState,
  type StateFile,
} from '../utils/dataPaths.js';
import { getKnowledgeBasePath } from '../utils/projectPath.js';
import {
  MANIFEST_FILENAME,
  SNAPSHOT_FILENAME,
  assertManifestCompatible,
  parseManifestFile,
  parseSnapshotFile,
  compareDatasetVersion,
  diffSnapshots,
  snapshotRowToKnowledgeInput,
  synthesizeDatasetVersion,
  type SnapshotRow,
} from '../kb/snapshot.js';
import {
  DOCS_REPO,
  COMPONENTS_REPO,
  SNAPSHOT_REPO,
  listRemoteVersionTags,
  sourceTarballUrl,
  snapshotManifestUrl,
  snapshotFileUrl,
  compatibilityJsonUrls,
} from '../kb/sources.js';
import { downloadToFile } from '../utils/download.js';
import { extractTarGz } from '../utils/tarSafe.js';
import { DeveloperKnowledgeManager } from '../rag/knowledgeManager.js';
import { SQLiteManager } from '../database/sqliteManager.js';
import {
  loadCompatibilityFromJson,
  parseCompatibilityJson,
  reloadCustomDictionaries,
  reportShadowingConflicts,
  CUSTOM_TERMS_CSV,
  CUSTOM_WORDS_CSV,
  CUSTOM_DOMAINS_CSV,
} from '../kb/sqliteLoaders.js';
import { GuideSearchManager } from '../rag/guideManager.js';
import { indexGuideDirectory } from '../kb/guideIndexer.js';
import { runGit, EGOVDOCS_REPO } from '../scripts/templateSources.js';

// 번들(패키지) 경로 해석 기준 — cwd 가 아니라 이 모듈의 설치 위치.
// npx 를 임의 디렉토리에서 실행해도 번들 knowledge-base 를 정확히 찾는다.
const CLI_FILE = fileURLToPath(import.meta.url);

// ─── 옵션 ────────────────────────────────────────────────

const RESOURCE_ALIASES: Record<string, ResourceName> = {
  developer_knowledge: 'developer_knowledge',
  knowledge: 'developer_knowledge',
  guide: 'guide',
  common_components: 'common_components',
  components: 'common_components',
  compatibility: 'compatibility',
  compat: 'compatibility',
  custom_terms: 'custom_terms',
  'custom-terms': 'custom_terms',
  custom: 'custom_terms',
};

interface UpdateOptions {
  check: boolean;
  yes: boolean;
  full: boolean;
  force: boolean;
  keepPrevious: boolean;
  rollback: boolean;
  rollbackTargets: ResourceName[] | null; // null = 전체
  resources: ResourceName[]; // 갱신 대상 (기본 전체)
  fromFileDir: string | null;
  guideTag: string | null;
  componentsTag: string | null;
  compatibilityTag: string | null;
}

export function parseUpdateArgs(argv: string[]): UpdateOptions {
  const options: UpdateOptions = {
    check: false,
    yes: false,
    full: false,
    force: false,
    keepPrevious: false,
    rollback: false,
    rollbackTargets: null,
    resources: ['developer_knowledge', 'guide', 'common_components', 'compatibility', 'custom_terms'],
    fromFileDir: null,
    guideTag: null,
    componentsTag: null,
    compatibilityTag: null,
  };

  const resourceSelection: ResourceName[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    /** `--flag=value` 와 `--flag value` 둘 다 허용 */
    const takeValue = (name: string): string => {
      if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
      const next = argv[++i];
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`${name} 에 값이 필요합니다.`);
      }
      return next;
    };

    if (arg === '--check') options.check = true;
    else if (arg === '--yes' || arg === '-y') options.yes = true;
    else if (arg === '--full') options.full = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--keep-previous') options.keepPrevious = true;
    else if (arg === '--rollback') options.rollback = true;
    else if (arg.startsWith('--rollback=')) {
      options.rollback = true;
      options.rollbackTargets = arg
        .slice('--rollback='.length)
        .split(',')
        .map(resolveResourceName);
    } else if (arg === '--from-file' || arg.startsWith('--from-file=')) {
      options.fromFileDir = path.resolve(takeValue('--from-file'));
    } else if (arg === '--resource' || arg.startsWith('--resource=')) {
      for (const name of takeValue('--resource').split(',')) {
        resourceSelection.push(resolveResourceName(name));
      }
    } else if (arg === '--guide-tag' || arg.startsWith('--guide-tag=')) {
      options.guideTag = takeValue('--guide-tag');
    } else if (arg === '--components-tag' || arg.startsWith('--components-tag=')) {
      options.componentsTag = takeValue('--components-tag');
    } else if (arg === '--compatibility-tag' || arg.startsWith('--compatibility-tag=')) {
      options.compatibilityTag = takeValue('--compatibility-tag');
    } else {
      throw new Error(`알 수 없는 옵션입니다: ${arg}`);
    }
  }

  if (resourceSelection.length > 0) {
    options.resources = [...new Set(resourceSelection)];
  }
  return options;
}

function resolveResourceName(name: string): ResourceName {
  const canonical = RESOURCE_ALIASES[name.trim()];
  if (!canonical) {
    throw new Error(
      `알 수 없는 리소스입니다: ${name} (developer_knowledge | guide | components | compatibility | custom_terms 중 선택)`,
    );
  }
  return canonical;
}

// ─── 잠금 ────────────────────────────────────────────────

/** update.lock (O_EXCL) — 중복 실행 직렬화. stale 잠금은 회수한다 */
function acquireLock(): () => void {
  const overlayRoot = getOverlayRoot();
  fs.mkdirSync(overlayRoot, { recursive: true });
  const lockPath = path.join(overlayRoot, 'update.lock');

  const tryAcquire = (): boolean => {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }));
      fs.closeSync(fd);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      return false;
    }
  };

  if (!tryAcquire()) {
    // stale 판정: 잠금 주인 프로세스가 죽었거나 6시간 초과
    let stale = false;
    try {
      const info = JSON.parse(fs.readFileSync(lockPath, 'utf-8')) as { pid?: number };
      const age = Date.now() - fs.statSync(lockPath).mtimeMs;
      if (age > 6 * 60 * 60 * 1000) stale = true;
      else if (typeof info.pid === 'number') {
        try {
          process.kill(info.pid, 0); // 시그널 0 = 존재 확인
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === 'ESRCH') stale = true;
        }
      }
    } catch {
      stale = true; // 읽을 수 없는 잠금 파일
    }
    if (!stale) {
      throw new Error('다른 update 가 실행 중입니다. 잠시 후 다시 시도하세요.');
    }
    console.error('⚠️ 이전 실행의 stale 잠금을 회수합니다.');
    fs.rmSync(lockPath, { force: true });
    if (!tryAcquire()) {
      throw new Error('잠금 획득에 실패했습니다. 잠시 후 다시 시도하세요.');
    }
  }

  return () => {
    fs.rmSync(lockPath, { force: true });
  };
}

// ─── 오버레이 버전 디렉토리 헬퍼 ─────────────────────────

export function sanitizeVersionDirName(version: string): string {
  return `v-${version.replace(/[^A-Za-z0-9._-]+/g, '-')}`;
}

function overlayResourceDir(resource: ResourceName, version: string): {
  abs: string;
  rel: string;
} {
  const rel = path.join('resources', resource, sanitizeVersionDirName(version));
  return { abs: path.join(getOverlayRoot(), rel), rel };
}

/** 오버레이 state 에 리소스 항목을 반영하고 원자 교체로 기록 */
function commitResourceState(resource: ResourceName, entry: ResourceState): void {
  const state: StateFile = readOverlayState() ?? {
    schema_version: SCHEMA_VERSION,
    resources: {},
  };
  state.schema_version = SCHEMA_VERSION;
  state.embedding_model = { id: EMBEDDING_MODEL_ID };
  state.generated_at = new Date().toISOString();
  state.resources[resource] = entry;
  writeOverlayStateAtomic(state);
}

/** active/previous 를 제외한 옛 버전 디렉토리 정리 (실패해도 다음 실행에서 재시도) */
async function pruneOldVersions(resource: ResourceName, keepRel: Array<string | undefined>): Promise<void> {
  const base = path.join(getOverlayRoot(), 'resources', resource);
  if (!await fs.pathExists(base)) return;
  const keepNames = new Set(
    keepRel.filter((rel): rel is string => !!rel).map((rel) => path.basename(rel)),
  );
  for (const entry of await fs.readdir(base)) {
    if (keepNames.has(entry)) continue;
    // Windows 파일 잠금 관용: 삭제 실패는 무시하고 다음 실행에서 재시도
    await fs.remove(path.join(base, entry)).catch(() => {});
  }
}

// ─── 리소스별 현재/최신 상태 ─────────────────────────────

interface ResourceStatus {
  resource: ResourceName;
  currentVersion: string | null;
  origin: 'overlay' | 'bundled';
  /** 원격에서 확인한 갱신 후보 (null = 확인 불가/대상 아님) */
  candidate: string | null;
  note: string;
}

const RESOURCE_LABELS: Record<ResourceName, string> = {
  developer_knowledge: '개발자 지식(Q&A/FAQ)',
  guide: '가이드',
  common_components: '공통컴포넌트',
  compatibility: '호환성 SW',
  custom_terms: 'Custom 사전',
};

// ─── SQLite 오버레이 공용 (compatibility · custom_terms) ─

const SQLITE_RESOURCES: ReadonlyArray<ResourceName> = ['compatibility', 'custom_terms'];

/**
 * 오버레이 SQLite 사본을 확보한다. base 가 현재 번들과 일치하면 재사용,
 * 아니면 번들 DB 를 새로 복사(재베이스)한다 — 재베이스 시 호출자는
 * 반드시 reapplyStoredSqliteResources 로 다른 리소스 적용분을 복원해야 한다.
 */
async function ensureOverlaySqlite(): Promise<{ dbPath: string; rebased: boolean }> {
  const bundled = readBundledState(CLI_FILE);
  if (!bundled?.generated_at) {
    throw new Error(
      '번들 state.json 이 없습니다 — 이 패키지 버전에서는 SQLite 리소스 갱신을 지원하지 않습니다.',
    );
  }

  const dbPath = getOverlaySqliteDbPath();
  if (isOverlaySqliteValid(CLI_FILE)) {
    return { dbPath, rebased: false };
  }

  const bundledDb = path.join(getKnowledgeBasePath(CLI_FILE), 'egovframe.db');
  if (!await fs.pathExists(bundledDb)) {
    throw new Error('번들 egovframe.db 를 찾을 수 없습니다 — 패키지 설치가 손상되었을 수 있습니다.');
  }
  await fs.remove(getOverlaySqliteDir());
  await fs.copy(bundledDb, dbPath);
  writeOverlaySqliteBase({ bundled_generated_at: bundled.generated_at });
  console.error('  ↻ 번들 SQLite 를 오버레이로 (재)베이스했습니다.');
  return { dbPath, rebased: true };
}

/** 보관된 적용 원본(artifact)으로 SQLite 리소스 하나를 재적용한다 */
async function reapplySqliteResource(
  sqlite: SQLiteManager,
  resource: ResourceName,
  artifactDir: string,
): Promise<void> {
  if (resource === 'compatibility') {
    const jsonPath = path.join(artifactDir, 'compatibility-software.json');
    if (await fs.pathExists(jsonPath)) {
      const count = await loadCompatibilityFromJson(sqlite, jsonPath);
      console.error(`  ↻ 호환성 SW 재적용: ${count}행`);
    }
  } else if (resource === 'custom_terms') {
    const counts = await reloadCustomDictionaries(sqlite, artifactDir);
    console.error(`  ↻ Custom 사전 재적용: 용어 ${counts.terms} · 단어 ${counts.words} · 도메인 ${counts.domains}`);
  }
}

/** 재베이스 후 정합성 복원 — exclude 를 제외한 보관 적용분을 전부 재적용 */
async function reapplyStoredSqliteResources(
  sqlite: SQLiteManager,
  exclude?: ResourceName,
): Promise<void> {
  const state = readOverlayState();
  if (!state) return;
  for (const resource of SQLITE_RESOURCES) {
    if (resource === exclude) continue;
    const entry = state.resources[resource];
    if (!entry?.dir) continue;
    const artifactDir = path.join(getOverlayRoot(), entry.dir);
    if (!await fs.pathExists(artifactDir)) continue;
    await reapplySqliteResource(sqlite, resource, artifactDir);
  }
}

/**
 * state 기준으로 오버레이 SQLite 전체 재구성 (롤백·패키지 갱신 치유용).
 * SQLite 리소스 적용분이 하나도 없으면 사본 자체를 제거해 순수 번들로 돌아간다.
 */
async function rebuildOverlaySqliteFromState(): Promise<void> {
  const state = readOverlayState();
  const hasAny = SQLITE_RESOURCES.some((r) => state?.resources[r]?.dir);
  await fs.remove(getOverlaySqliteDir());
  if (!hasAny) return;

  const { dbPath } = await ensureOverlaySqlite();
  const sqlite = new SQLiteManager(dbPath);
  try {
    await reapplyStoredSqliteResources(sqlite);
  } finally {
    sqlite.close();
  }
}

/** SQLite 리소스 공통 마무리 — 원본 보관(applied.json 포함) + 상태 커밋 + 정리 */
async function commitSqliteResource(
  resource: ResourceName,
  versionDirRel: string,
  entry: ResourceState,
): Promise<void> {
  commitResourceState(resource, entry);
  await pruneOldVersions(resource, [versionDirRel, entry.previous_dir]);
}

// ─── 개발자 지식 갱신 ────────────────────────────────────

interface KnowledgeUpdateResult {
  version: string;
  added: number;
  changed: number;
  removed: number;
  fullRebuild: boolean;
}

async function updateDeveloperKnowledge(options: UpdateOptions): Promise<KnowledgeUpdateResult | 'skip'> {
  const label = RESOURCE_LABELS.developer_knowledge;
  console.error(`\n▶ ${label} 갱신...`);

  // 1. 소스 확보 (릴리스 다운로드 또는 반입 디렉토리)
  let manifestPath: string;
  let snapshotPath: string;
  let origin: ResourceState['origin'];
  let tmpDir: string | null = null;

  if (options.fromFileDir) {
    manifestPath = path.join(options.fromFileDir, MANIFEST_FILENAME);
    snapshotPath = path.join(options.fromFileDir, SNAPSHOT_FILENAME);
    origin = 'from-file';
    if (!await fs.pathExists(manifestPath) || !await fs.pathExists(snapshotPath)) {
      console.error(`  ⚠️ 반입 디렉토리에 ${MANIFEST_FILENAME}/${SNAPSHOT_FILENAME} 이 없어 스킵합니다.`);
      return 'skip';
    }
  } else {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'egov-update-kb-'));
    manifestPath = path.join(tmpDir, MANIFEST_FILENAME);
    snapshotPath = path.join(tmpDir, SNAPSHOT_FILENAME);
    origin = 'release';
    console.error('  ⬇ manifest 다운로드...');
    await downloadToFile(snapshotManifestUrl(), manifestPath, { timeoutMs: 30_000, maxBytes: 10 * 1024 * 1024 });
  }

  try {
    // 2. 검증 — 스키마·모델 호환성
    const manifest = parseManifestFile(manifestPath);
    assertManifestCompatible(manifest);

    // 3. 단조성 — 다운그레이드 기본 거부
    const effective = resolveResource('developer_knowledge', CLI_FILE);
    const currentVersion = effective.state?.version ?? null;
    if (currentVersion) {
      const cmp = compareDatasetVersion(manifest.dataset_version, currentVersion);
      if (cmp === 0 && !options.full) {
        console.error(`  ✓ 이미 최신입니다 (${currentVersion})`);
        return 'skip';
      }
      if (cmp < 0 && !options.force) {
        console.error(
          `  ⚠️ 대상 버전(${manifest.dataset_version})이 현재(${currentVersion})보다 오래되어 거부합니다 (--force 로 강제 가능).`,
        );
        return 'skip';
      }
    }

    // 4. 스냅샷 확보 + 파싱
    if (origin === 'release') {
      console.error('  ⬇ snapshot 다운로드...');
      await downloadToFile(snapshotFileUrl(), snapshotPath, { timeoutMs: 300_000, maxBytes: 128 * 1024 * 1024 });
    }
    const newRows = parseSnapshotFile(snapshotPath);
    if (newRows.length !== manifest.row_count) {
      throw new Error(`스냅샷 행 수(${newRows.length})가 manifest(${manifest.row_count})와 다릅니다.`);
    }

    // 5. 직전 적용 스냅샷 (diff 기준본) — 오버레이 우선, 없으면 번들 동봉본
    let prevRows: SnapshotRow[] | null = null;
    const appliedPath = effective.source === 'overlay'
      ? path.join(effective.dir, 'snapshot.applied.jsonl.gz')
      : path.join(getKnowledgeBasePath(CLI_FILE), SNAPSHOT_FILENAME);
    if (!options.full && await fs.pathExists(appliedPath)) {
      try {
        prevRows = parseSnapshotFile(appliedPath);
      } catch {
        console.error('  ⚠️ 직전 스냅샷을 읽을 수 없어 전량 재구축으로 진행합니다.');
      }
    }

    // 6. 부트스트랩 — 실효 lance 테이블을 새 버전 디렉토리로 복사
    const sourceTable = path.join(effective.dir, 'developer_knowledge.lance');
    if (!await fs.pathExists(sourceTable)) {
      throw new Error('developer_knowledge.lance 를 찾을 수 없습니다 — 패키지 설치가 손상되었을 수 있습니다.');
    }
    const { abs: versionDir, rel: versionRel } = overlayResourceDir('developer_knowledge', manifest.dataset_version);
    await fs.remove(versionDir);
    await fs.copy(sourceTable, path.join(versionDir, 'developer_knowledge.lance'));

    const manager = new DeveloperKnowledgeManager(versionDir);
    await manager.initialize();

    // 7. qa/faq 스코프 행 목록 (삭제 스코핑 — PDF 청크 보호)
    const qaFaqRows = await manager.listSourceRows(['qa', 'faq']);
    const statsBefore = await manager.getStats();
    const pdfCount = statsBefore.total - qaFaqRows.length;

    // 8. 작업 결정 — 증분 diff 또는 전량
    const fullRebuild = options.full || prevRows === null;
    let toAdd: SnapshotRow[];
    let removeLanceIds: string[];
    let addedCount: number;
    let changedCount: number;
    let removedCount: number;

    if (fullRebuild) {
      toAdd = newRows;
      removeLanceIds = qaFaqRows.map((r) => r.id);
      addedCount = newRows.length;
      changedCount = 0;
      removedCount = qaFaqRows.length;
      console.error(`  ↻ 전량 재구축: 기존 Q&A/FAQ ${removedCount}행 제거 후 ${addedCount}행 임베딩 (PDF ${pdfCount}청크 보존)`);
    } else {
      const diff = diffSnapshots(prevRows!, newRows);
      addedCount = diff.added.length;
      changedCount = diff.changed.length;
      removedCount = diff.removedIds.length;
      toAdd = [...diff.added, ...diff.changed];

      // 삭제 대상: removed + changed — (sourceType, originalId) → lance id 매핑
      const byKey = new Map<string, string[]>();
      for (const row of qaFaqRows) {
        const key = row.originalId;
        const list = byKey.get(key);
        if (list) list.push(row.id);
        else byKey.set(key, [row.id]);
      }
      const targetIds = [...diff.removedIds, ...diff.changed.map((r) => r.id)];
      removeLanceIds = targetIds.flatMap((snapshotId) => {
        const originalId = snapshotId.replace(/^(qa|faq):/, '');
        return byKey.get(originalId) ?? [];
      });
      console.error(`  Δ 신규 ${addedCount} · 변경 ${changedCount} · 삭제 ${removedCount} (PDF ${pdfCount}청크 보존)`);

      if (addedCount + changedCount + removedCount === 0) {
        console.error('  ✓ 내용 변경 없음 — 버전 표기만 갱신합니다.');
      }
    }

    // 9. 적용 — 삭제 후 변경분 임베딩
    if (removeLanceIds.length > 0) {
      await manager.deleteByIds(removeLanceIds);
    }
    if (toAdd.length > 0) {
      await manager.addKnowledgeBatch(toAdd.map(snapshotRowToKnowledgeInput));
    }
    await manager.optimize();

    // 10. 검증 프로브 — 행 수 대조
    const statsAfter = await manager.getStats();
    const expected = pdfCount + newRows.length;
    if (statsAfter.total !== expected) {
      throw new Error(`검증 실패: 행 수 ${statsAfter.total} ≠ 기대값 ${expected}. 이 버전은 적용하지 않습니다.`);
    }

    // 11. 다음 diff 기준본 보관 + 상태 원자 교체
    await fs.copy(snapshotPath, path.join(versionDir, 'snapshot.applied.jsonl.gz'));
    const previousDir = effective.source === 'overlay' ? effective.state?.dir : undefined;
    commitResourceState('developer_knowledge', {
      version: manifest.dataset_version,
      dir: versionRel,
      previous_dir: previousDir,
      row_count: newRows.length,
      origin,
      embedding_model: EMBEDDING_MODEL_ID,
      applied_at: new Date().toISOString(),
    });
    await pruneOldVersions('developer_knowledge', [versionRel, previousDir]);

    return {
      version: manifest.dataset_version,
      added: addedCount,
      changed: changedCount,
      removed: removedCount,
      fullRebuild,
    };
  } finally {
    if (tmpDir) await fs.remove(tmpDir).catch(() => {});
  }
}

// ─── 가이드 갱신 ─────────────────────────────────────────

interface GuideUpdateResult {
  version: string;
  chunks: number;
}

/** md 소스 확보 — sparse checkout 우선, 실패 시 tarball 폴백 */
async function acquireGuideMarkdown(tag: string, tmpDir: string): Promise<string> {
  const checkoutDir = path.join(tmpDir, 'docs');

  // 1순위: partial clone + sparse checkout (이미지 blob 을 아예 받지 않음)
  try {
    runGit([
      'clone', '--depth', '1', '--filter=blob:none', '--sparse',
      '--branch', tag, EGOVDOCS_REPO, checkoutDir,
    ]);
    runGit(['sparse-checkout', 'set', '--no-cone', '/*', '!**/images/**'], checkoutDir);
    if (await fs.pathExists(path.join(checkoutDir, '_index.md'))) {
      console.error('  ✓ sparse checkout 완료 (이미지 제외)');
      return checkoutDir;
    }
  } catch {
    console.error('  ⚠️ git sparse checkout 실패 — 소스 tarball 로 폴백합니다.');
  }

  // 폴백: 전체 tarball 에서 md 만 추출
  const tarPath = path.join(tmpDir, 'guide-src.tar.gz');
  console.error('  ⬇ 소스 tarball 다운로드 (전송량이 클 수 있습니다)...');
  await downloadToFile(sourceTarballUrl(DOCS_REPO, tag), tarPath, {
    timeoutMs: 600_000,
    maxBytes: 512 * 1024 * 1024,
  });
  await fs.remove(checkoutDir);
  extractTarGz(tarPath, checkoutDir, {
    stripComponents: 1,
    filter: (rel) => rel.endsWith('.md'),
  });
  await fs.remove(tarPath);
  return checkoutDir;
}

async function updateGuide(options: UpdateOptions): Promise<GuideUpdateResult | 'skip'> {
  const label = RESOURCE_LABELS.guide;
  console.error(`\n▶ ${label} 갱신...`);

  const effective = resolveResource('guide', CLI_FILE);
  const currentVersion = effective.state?.version ?? null;

  // 대상 버전/소스 결정
  let targetVersion: string;
  let mdRoot: string;
  let origin: ResourceState['origin'];
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'egov-update-guide-'));

  try {
    if (options.fromFileDir) {
      origin = 'from-file';
      targetVersion = options.guideTag ?? 'from-file';
      const treeDir = path.join(options.fromFileDir, 'egovframe_guide');
      const tarFile = path.join(options.fromFileDir, 'guide-md.tar.gz');
      if (await fs.pathExists(path.join(treeDir, '_index.md'))) {
        mdRoot = treeDir;
      } else if (await fs.pathExists(tarFile)) {
        mdRoot = path.join(tmpDir, 'docs');
        extractTarGz(tarFile, mdRoot, { filter: (rel) => rel.endsWith('.md') });
      } else {
        console.error('  ⚠️ 반입 디렉토리에 egovframe_guide/ 또는 guide-md.tar.gz 가 없어 스킵합니다.');
        return 'skip';
      }
    } else {
      origin = 'release';
      targetVersion =
        options.guideTag ?? (await listRemoteVersionTags(DOCS_REPO))[0];
      if (!targetVersion) {
        console.error('  ⚠️ 원격에서 버전 태그를 찾지 못해 스킵합니다.');
        return 'skip';
      }
      if (targetVersion === currentVersion && !options.force) {
        console.error(`  ✓ 이미 최신입니다 (${currentVersion})`);
        return 'skip';
      }
      mdRoot = await acquireGuideMarkdown(targetVersion, tmpDir);
    }

    if (targetVersion === currentVersion && !options.force) {
      console.error(`  ✓ 이미 최신입니다 (${currentVersion})`);
      return 'skip';
    }

    // 전량 재인덱싱 — 새 버전 디렉토리에 새 테이블 구축
    const { abs: versionDir, rel: versionRel } = overlayResourceDir('guide', targetVersion);
    await fs.remove(versionDir);
    await fs.ensureDir(versionDir);

    const manager = new GuideSearchManager(versionDir);
    await manager.initialize(); // 빈 디렉토리 → 새 테이블 생성
    const stats = await indexGuideDirectory(manager, mdRoot);

    // 검증 프로브
    if (stats.totalChunks === 0) {
      throw new Error('가이드 청크가 0개입니다 — 소스가 비었거나 형식이 다릅니다. 이 버전은 적용하지 않습니다.');
    }

    const previousDir = effective.source === 'overlay' ? effective.state?.dir : undefined;
    commitResourceState('guide', {
      version: targetVersion,
      dir: versionRel,
      previous_dir: previousDir,
      chunk_count: stats.totalChunks,
      origin,
      embedding_model: EMBEDDING_MODEL_ID,
      applied_at: new Date().toISOString(),
    });
    await pruneOldVersions('guide', [versionRel, previousDir]);

    return { version: targetVersion, chunks: stats.totalChunks };
  } finally {
    await fs.remove(tmpDir).catch(() => {});
  }
}

// ─── 공통컴포넌트 갱신 ───────────────────────────────────

interface ComponentsUpdateResult {
  version: string;
  files: number;
  metadataVersion: string | null;
}

async function updateComponents(options: UpdateOptions): Promise<ComponentsUpdateResult | 'skip'> {
  const label = RESOURCE_LABELS.common_components;
  console.error(`\n▶ ${label} 갱신...`);

  const effective = resolveResource('common_components', CLI_FILE);
  const currentVersion = effective.state?.source_version ?? effective.state?.version ?? null;
  const metadataVersion = effective.state?.metadata_version ?? null;

  let targetVersion: string;
  let origin: ResourceState['origin'];
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'egov-update-comp-'));

  try {
    let tarPath: string;
    if (options.fromFileDir) {
      origin = 'from-file';
      targetVersion = options.componentsTag ?? 'from-file';
      tarPath = path.join(options.fromFileDir, 'components-src.tar.gz');
      if (!await fs.pathExists(tarPath)) {
        console.error('  ⚠️ 반입 디렉토리에 components-src.tar.gz 가 없어 스킵합니다.');
        return 'skip';
      }
      if (targetVersion === currentVersion && !options.force) {
        console.error(`  ✓ 이미 최신입니다 (${currentVersion})`);
        return 'skip';
      }
    } else {
      origin = 'release';
      targetVersion =
        options.componentsTag ?? (await listRemoteVersionTags(COMPONENTS_REPO))[0];
      if (!targetVersion) {
        console.error('  ⚠️ 원격에서 버전 태그를 찾지 못해 스킵합니다.');
        return 'skip';
      }
      if (targetVersion === currentVersion && !options.force) {
        console.error(`  ✓ 이미 최신입니다 (${currentVersion})`);
        return 'skip';
      }
      tarPath = path.join(tmpDir, 'components-src.tar.gz');
      console.error(`  ⬇ 소스 tarball 다운로드 (${targetVersion})...`);
      await downloadToFile(sourceTarballUrl(COMPONENTS_REPO, targetVersion), tarPath, {
        timeoutMs: 600_000,
        maxBytes: 512 * 1024 * 1024,
      });
    }

    // 트리 교체 — 임베딩 0, SQLite 미변경
    const { abs: versionDir, rel: versionRel } = overlayResourceDir('common_components', targetVersion);
    await fs.remove(versionDir);
    const stats = extractTarGz(tarPath, versionDir, { stripComponents: 1 });

    // 검증 프로브
    if (!await fs.pathExists(path.join(versionDir, 'pom.xml'))) {
      throw new Error('해제 결과에 pom.xml 이 없습니다 — 아카이브 구성이 예상과 다릅니다. 이 버전은 적용하지 않습니다.');
    }
    console.error(`  ✓ 트리 해제 완료: ${stats.files}개 파일`);

    // 직전 버전은 기본 미보존 (해제본 ~300MB — 롤백은 재다운로드로)
    const previousDir =
      options.keepPrevious && effective.source === 'overlay' ? effective.state?.dir : undefined;
    commitResourceState('common_components', {
      source_version: targetVersion,
      metadata_version: metadataVersion ?? undefined,
      dir: versionRel,
      previous_dir: previousDir,
      file_count: stats.files,
      origin,
      applied_at: new Date().toISOString(),
    });
    await pruneOldVersions('common_components', [versionRel, previousDir]);

    // 메타 버전 불일치 경고 — 목록·설명·FTS 는 동봉 메타 기준
    if (metadataVersion && normalizeVersion(targetVersion) !== normalizeVersion(metadataVersion)) {
      console.error(`  ⚠️ 소스 ${targetVersion} / 메타 ${metadataVersion} — 컴포넌트 목록·설명은 메타 기준입니다.`);
      console.error('     메타 갱신은 MCP 패키지(tgz) 업그레이드로만 반영됩니다.');
    }

    return { version: targetVersion, files: stats.files, metadataVersion };
  } finally {
    await fs.remove(tmpDir).catch(() => {});
  }
}

function normalizeVersion(value: string): string {
  return value.replace(/^v/, '');
}

// ─── 호환성 SW 갱신 ──────────────────────────────────────

interface CompatibilityUpdateResult {
  version: string;
  rows: number;
}

async function updateCompatibility(options: UpdateOptions): Promise<CompatibilityUpdateResult | 'skip'> {
  const label = RESOURCE_LABELS.compatibility;
  console.error(`\n▶ ${label} 갱신...`);

  const effective = resolveResource('compatibility', CLI_FILE);
  const currentVersion = effective.state?.version ?? null;

  let targetVersion: string;
  let origin: ResourceState['origin'];
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'egov-update-compat-'));

  try {
    let jsonPath: string;
    if (options.fromFileDir) {
      origin = 'from-file';
      const candidates = [
        path.join(options.fromFileDir, 'compatibility', 'compatibility-software.json'),
        path.join(options.fromFileDir, 'compatibility-software.json'),
      ];
      const found = candidates.find((p) => fs.existsSync(p));
      if (!found) {
        console.error('  ⚠️ 반입 디렉토리에 compatibility-software.json 이 없어 스킵합니다.');
        return 'skip';
      }
      jsonPath = found;
      targetVersion = options.compatibilityTag ?? synthesizeDatasetVersion([jsonPath]);
    } else {
      origin = 'release';
      targetVersion =
        options.compatibilityTag ?? (await listRemoteVersionTags(SNAPSHOT_REPO))[0];
      if (!targetVersion) {
        console.error('  ⚠️ 원격에서 버전 태그를 찾지 못해 스킵합니다.');
        return 'skip';
      }
      if (targetVersion === currentVersion && !options.force) {
        console.error(`  ✓ 이미 최신입니다 (${currentVersion})`);
        return 'skip';
      }
      // 릴리스 자산 URL 후보를 순서대로 시도
      jsonPath = path.join(tmpDir, 'compatibility-software.json');
      let downloaded = false;
      let lastError = '';
      for (const url of compatibilityJsonUrls(targetVersion)) {
        try {
          await downloadToFile(url, jsonPath, { timeoutMs: 60_000, maxBytes: 32 * 1024 * 1024 });
          downloaded = true;
          break;
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
      }
      if (!downloaded) {
        throw new Error(`호환성 JSON 다운로드 실패 (${lastError})`);
      }
    }

    if (targetVersion === currentVersion && !options.force) {
      console.error(`  ✓ 이미 최신입니다 (${currentVersion})`);
      return 'skip';
    }

    // 검증 — 파싱·스키마·0행 가드 (오버레이 SQLite 를 건드리기 전에)
    const rows = await parseCompatibilityJson(jsonPath);
    if (rows.length === 0) {
      throw new Error('호환성 JSON 이 비어 있습니다 — 이 버전은 적용하지 않습니다.');
    }

    // 적용 원본 보관 (재베이스 치유·롤백의 기반)
    const { abs: versionDir, rel: versionRel } = overlayResourceDir('compatibility', targetVersion);
    await fs.remove(versionDir);
    await fs.copy(jsonPath, path.join(versionDir, 'compatibility-software.json'));
    await fs.writeJSON(
      path.join(versionDir, 'applied.json'),
      { resource: 'compatibility', version: targetVersion, row_count: rows.length, applied_at: new Date().toISOString() },
      { spaces: 2 },
    );

    // 오버레이 SQLite 에 적재 (재베이스 시 다른 SQLite 리소스 재적용)
    const { dbPath, rebased } = await ensureOverlaySqlite();
    const sqlite = new SQLiteManager(dbPath);
    try {
      const count = await loadCompatibilityFromJson(sqlite, jsonPath);
      if (rebased) {
        await reapplyStoredSqliteResources(sqlite, 'compatibility');
      }
      console.error(`  ✓ 호환성 SW ${count}행 적재 완료`);
    } finally {
      sqlite.close();
    }

    const previousDir = effective.source === 'overlay' ? effective.state?.dir : undefined;
    await commitSqliteResource('compatibility', versionRel, {
      version: targetVersion,
      dir: versionRel,
      previous_dir: previousDir,
      row_count: rows.length,
      origin,
      applied_at: new Date().toISOString(),
    });

    return { version: targetVersion, rows: rows.length };
  } finally {
    await fs.remove(tmpDir).catch(() => {});
  }
}

// ─── 기관 Custom 사전 갱신 (반입 파일 전용) ──────────────

interface CustomTermsUpdateResult {
  version: string;
  terms: number;
  words: number;
  domains: number;
}

async function updateCustomTerms(options: UpdateOptions): Promise<CustomTermsUpdateResult | 'skip'> {
  const label = RESOURCE_LABELS.custom_terms;
  console.error(`\n▶ ${label} 갱신...`);

  // 원격 채널이 없다 — 기관이 직접 준비한 CSV 를 --from-file 로만 받는다
  if (!options.fromFileDir) {
    console.error('  ℹ️ Custom 사전은 반입 파일로만 갱신합니다 — --from-file <디렉토리> 를 지정하세요.');
    console.error(`     (디렉토리의 custom_terms/ 하위 또는 바로 아래에 ${CUSTOM_TERMS_CSV} 등 3종 CSV)`);
    return 'skip';
  }

  const nested = path.join(options.fromFileDir, 'custom_terms');
  const srcDir = fs.existsSync(nested) ? nested : options.fromFileDir;
  const csvNames = [CUSTOM_TERMS_CSV, CUSTOM_WORDS_CSV, CUSTOM_DOMAINS_CSV];
  const presentCsvs = csvNames
    .map((name) => path.join(srcDir, name))
    .filter((p) => fs.existsSync(p));
  if (presentCsvs.length === 0) {
    console.error('  ⚠️ 반입 디렉토리에 custom_standard_*.csv 가 없어 스킵합니다.');
    return 'skip';
  }

  const targetVersion = synthesizeDatasetVersion(presentCsvs);

  // 적용 원본 보관
  const { abs: versionDir, rel: versionRel } = overlayResourceDir('custom_terms', targetVersion);
  await fs.remove(versionDir);
  for (const csvPath of presentCsvs) {
    await fs.copy(csvPath, path.join(versionDir, path.basename(csvPath)));
  }

  // 오버레이 SQLite 에 재적재 (CSV 기준 deterministic — 빠진 파일의 사전은 비워짐)
  const { dbPath, rebased } = await ensureOverlaySqlite();
  const sqlite = new SQLiteManager(dbPath);
  let counts: { terms: number; words: number; domains: number };
  try {
    counts = await reloadCustomDictionaries(sqlite, versionDir);
    if (rebased) {
      await reapplyStoredSqliteResources(sqlite, 'custom_terms');
    }
    // 표준을 가리는 항목 안내 (custom > standard 우선순위는 의도된 동작)
    reportShadowingConflicts(sqlite);
  } finally {
    sqlite.close();
  }

  await fs.writeJSON(
    path.join(versionDir, 'applied.json'),
    {
      resource: 'custom_terms',
      version: targetVersion,
      counts,
      files: presentCsvs.map((p) => path.basename(p)),
      applied_at: new Date().toISOString(),
    },
    { spaces: 2 },
  );

  const effective = resolveResource('custom_terms', CLI_FILE);
  const previousDir = effective.source === 'overlay' ? effective.state?.dir : undefined;
  await commitSqliteResource('custom_terms', versionRel, {
    version: targetVersion,
    dir: versionRel,
    previous_dir: previousDir,
    row_count: counts.terms + counts.words + counts.domains,
    origin: 'from-file',
    applied_at: new Date().toISOString(),
  });

  return { version: targetVersion, ...counts };
}

// ─── 롤백 ────────────────────────────────────────────────

async function rollbackResources(targets: ResourceName[]): Promise<number> {
  const state = readOverlayState();
  if (!state) {
    console.error('오버레이 상태가 없습니다 — 롤백할 갱신분이 없습니다 (번들 그대로 사용 중).');
    return 0;
  }

  let failures = 0;
  let sqliteTouched = false;
  for (const resource of targets) {
    const entry = state.resources[resource];
    const label = RESOURCE_LABELS[resource];
    if (!entry) {
      console.error(`  - ${label}: 오버레이 적용분 없음 — 건너뜀`);
      continue;
    }

    if (SQLITE_RESOURCES.includes(resource)) sqliteTouched = true;

    if (entry.previous_dir && await fs.pathExists(path.join(getOverlayRoot(), entry.previous_dir))) {
      // 직전 버전으로 포인터 교체
      state.resources[resource] = {
        ...entry,
        dir: entry.previous_dir,
        previous_dir: undefined,
        version: undefined, // 버전 표기는 직전본 기준으로 불명확 — 미기재
        applied_at: new Date().toISOString(),
      };
      console.error(`  ✓ ${label}: 직전 버전 디렉토리로 복귀`);
    } else {
      // 직전본이 없으면 오버레이 항목 제거 → 번들 폴백
      delete state.resources[resource];
      console.error(`  ✓ ${label}: 오버레이 적용분 제거 — 번들 동봉본으로 복귀`);
    }
  }

  writeOverlayStateAtomic(state);

  // SQLite 리소스는 공유 DB 안에 살아서 디렉토리 스왑만으로 복귀되지 않는다 —
  // 번들 재베이스 + 남은 보관 원본 재적용으로 DB 를 재구성한다
  if (sqliteTouched) {
    console.error('  ↻ SQLite 오버레이 재구성 중 (번들 재베이스 + 보관 원본 재적용)...');
    await rebuildOverlaySqliteFromState();
  }
  return failures;
}

// ─── 상태 조회/출력 ──────────────────────────────────────

async function gatherStatus(options: UpdateOptions): Promise<ResourceStatus[]> {
  const statuses: ResourceStatus[] = [];

  for (const resource of options.resources) {
    const effective = resolveResource(resource, CLI_FILE);
    const currentVersion =
      resource === 'common_components'
        ? effective.state?.source_version ?? effective.state?.version ?? null
        : effective.state?.version ?? null;

    let candidate: string | null = null;
    let note = '';

    if (resource === 'custom_terms' && !options.fromFileDir) {
      // 원격 채널 없음 — 반입 파일로만 갱신
      note = '반입 파일로만 갱신 (--from-file)';
    } else if (options.fromFileDir) {
      note = '반입 파일 기준';
    } else {
      try {
        if (resource === 'developer_knowledge') {
          const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'egov-check-'));
          try {
            const manifestPath = path.join(tmp, MANIFEST_FILENAME);
            await downloadToFile(snapshotManifestUrl(), manifestPath, { timeoutMs: 15_000, maxBytes: 10 * 1024 * 1024 });
            candidate = parseManifestFile(manifestPath).dataset_version;
          } finally {
            await fs.remove(tmp).catch(() => {});
          }
        } else if (resource === 'guide') {
          candidate = options.guideTag ?? (await listRemoteVersionTags(DOCS_REPO))[0] ?? null;
        } else if (resource === 'compatibility') {
          candidate = options.compatibilityTag ?? (await listRemoteVersionTags(SNAPSHOT_REPO))[0] ?? null;
        } else {
          candidate = options.componentsTag ?? (await listRemoteVersionTags(COMPONENTS_REPO))[0] ?? null;
        }
      } catch (error) {
        note = '원격 확인 실패 (오프라인?)';
      }
    }

    statuses.push({
      resource,
      currentVersion,
      origin: effective.source,
      candidate,
      note,
    });
  }
  return statuses;
}

function printStatus(statuses: ResourceStatus[]): void {
  console.error('\n현재 적용 버전');
  for (const s of statuses) {
    const label = RESOURCE_LABELS[s.resource].padEnd(14, ' ');
    const originLabel = s.origin === 'overlay' ? '(update 적용분)' : '(동봉)';
    const current = s.currentVersion ?? '(기록 없음)';
    let line = `  ${label} ${current}  ${originLabel}`;
    if (s.candidate) {
      const isNew =
        s.resource === 'developer_knowledge' && s.currentVersion
          ? compareDatasetVersion(s.candidate, s.currentVersion) > 0
          : s.candidate !== s.currentVersion;
      line += isNew ? `  → ${s.candidate} 사용 가능` : '  → 최신 (변경 없음)';
    } else if (s.note) {
      line += `  — ${s.note}`;
    }
    console.error(line);
  }
  console.error(`\n임베딩 모델: ${EMBEDDING_MODEL_ID} (로컬, 오프라인 임베딩)`);

  // 패키지 갱신으로 오버레이 SQLite 가 무효화된 상태 안내
  const overlayState = readOverlayState();
  const hasSqliteApplied = SQLITE_RESOURCES.some((r) => overlayState?.resources[r]?.dir);
  if (hasSqliteApplied && !isOverlaySqliteValid(CLI_FILE)) {
    console.error('⚠️ 패키지 갱신으로 SQLite 적용분(호환성/Custom)이 번들로 폴백 중입니다 — update 를 실행하면 새 번들 위에 재적용됩니다.');
  }
}

// ─── 엔트리 ──────────────────────────────────────────────

export async function runUpdate(argv: string[]): Promise<number> {
  let options: UpdateOptions;
  try {
    options = parseUpdateArgs(argv);
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    printUsage();
    return 1;
  }

  let releaseLock: (() => void) | null = null;
  try {
    releaseLock = acquireLock();

    // 롤백은 별도 경로
    if (options.rollback) {
      console.error('↩ 직전 버전으로 롤백합니다...');
      await rollbackResources(options.rollbackTargets ?? options.resources);
      console.error('\n✅ 롤백 완료. 실행 중인 MCP 서버는 다음 세션부터 반영됩니다.');
      return 0;
    }

    // 상태 조회
    const statuses = await gatherStatus(options);
    printStatus(statuses);

    if (options.check) {
      return 0;
    }

    // 갱신할 것이 있는지 판정 (from-file 은 각 리소스 갱신 루틴이 판정)
    // 패키지 갱신으로 무효화된 SQLite 적용분이 있으면 치유 자체가 갱신 사유다
    const overlayStale =
      SQLITE_RESOURCES.some((r) => readOverlayState()?.resources[r]?.dir) && !isOverlaySqliteValid(CLI_FILE);

    if (!options.fromFileDir && !options.force && !options.full && !overlayStale) {
      const anyNew = statuses.some((s) => {
        if (!s.candidate) return false;
        if (s.resource === 'developer_knowledge' && s.currentVersion) {
          return compareDatasetVersion(s.candidate, s.currentVersion) > 0;
        }
        return s.candidate !== s.currentVersion;
      });
      if (!anyNew) {
        console.error('\n✅ 모든 리소스가 최신입니다.');
        return 0;
      }
    }

    // 확인 (TTY + --yes 미지정 시 1회)
    if (!options.yes && input.isTTY) {
      const rl = createInterface({ input, output: process.stderr });
      try {
        const answer = (await rl.question('\n갱신을 진행할까요? (y/N): ')).trim().toLowerCase();
        if (answer !== 'y' && answer !== 'yes') {
          console.error('중단했습니다.');
          return 0;
        }
      } finally {
        rl.close();
      }
    }

    // 패키지 갱신으로 무효화된 SQLite 적용분 치유 (보관 원본을 새 번들 위에 재적용)
    if (overlayStale) {
      console.error('\n↻ 패키지 갱신 감지 — SQLite 적용분(호환성/Custom)을 새 번들 위에 재적용합니다...');
      try {
        await rebuildOverlaySqliteFromState();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`  ⚠️ 재적용 실패 (${message}) — 해당 적용분은 번들 폴백 상태로 유지됩니다.`);
      }
    }

    // 리소스별 독립 갱신 — 부분 실패는 부분 성공으로
    const summary: string[] = [];
    let failures = 0;

    for (const resource of options.resources) {
      const label = RESOURCE_LABELS[resource];
      try {
        if (resource === 'developer_knowledge') {
          const result = await updateDeveloperKnowledge(options);
          if (result === 'skip') summary.push(`  ${label}: 변경 없음`);
          else if (result.fullRebuild) summary.push(`  ${label}: → ${result.version} (전량 ${result.added}행 재임베딩)`);
          else summary.push(`  ${label}: → ${result.version} (신규 ${result.added} · 변경 ${result.changed} · 삭제 ${result.removed})`);
        } else if (resource === 'guide') {
          const result = await updateGuide(options);
          if (result === 'skip') summary.push(`  ${label}: 변경 없음`);
          else summary.push(`  ${label}: → ${result.version} (${result.chunks}청크 재인덱싱)`);
        } else if (resource === 'compatibility') {
          const result = await updateCompatibility(options);
          if (result === 'skip') summary.push(`  ${label}: 변경 없음`);
          else summary.push(`  ${label}: → ${result.version} (${result.rows}행 재적재)`);
        } else if (resource === 'custom_terms') {
          const result = await updateCustomTerms(options);
          if (result === 'skip') summary.push(`  ${label}: 변경 없음`);
          else summary.push(`  ${label}: → ${result.version} (용어 ${result.terms} · 단어 ${result.words} · 도메인 ${result.domains})`);
        } else {
          const result = await updateComponents(options);
          if (result === 'skip') summary.push(`  ${label}: 변경 없음`);
          else summary.push(`  ${label}: → ${result.version} (${result.files}개 파일)`);
        }
      } catch (error) {
        failures++;
        const message = error instanceof Error ? error.message : String(error);
        console.error(`  ❌ ${label} 갱신 실패: ${message}`);
        console.error('     이 리소스는 이전 상태를 유지합니다.');
        summary.push(`  ${label}: 실패 — 이전 상태 유지`);
      }
    }

    console.error(failures === 0 ? '\n✅ 갱신 완료' : '\n⚠️ 일부 리소스 갱신 실패');
    for (const line of summary) console.error(line);
    console.error('\n실행 중인 MCP 서버가 있으면 다음 세션부터 반영됩니다.');
    return failures === 0 ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n❌ ${message}`);
    return 1;
  } finally {
    releaseLock?.();
  }
}

function printUsage(): void {
  console.error('');
  console.error('사용법: egovframe-mcp-search update [옵션]');
  console.error('  --check                    갱신 가능 여부만 조회');
  console.error('  --resource=<이름,...>      대상 한정 (developer_knowledge|guide|components|compatibility|custom_terms)');
  console.error('  --guide-tag=<태그>         가이드 버전 지정');
  console.error('  --components-tag=<태그>    공통컴포넌트 버전 지정');
  console.error('  --compatibility-tag=<태그>  호환성 SW 릴리스 버전 지정');
  console.error('  --from-file=<디렉토리>     반입 파일로 갱신 (Custom 사전은 이 경로 전용)');
  console.error('  --rollback[=<이름,...>]    직전 버전 복귀');
  console.error('  --full                     개발자 지식 전량 재임베딩');
  console.error('  --force                    다운그레이드/동일 버전 강제 적용');
  console.error('  --keep-previous            공통컴포넌트 직전 버전도 보존');
  console.error('  --yes                      확인 생략');
}
