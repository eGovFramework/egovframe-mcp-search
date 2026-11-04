/**
 * `npx egovframe-mcp-search update` — 지식베이스 갱신 CLI (뼈대)
 *
 * 4개 리소스를 독립적으로 갱신한다 (부분 실패 = 부분 성공):
 *   developer_knowledge  릴리스 스냅샷 → 직전 적용 스냅샷과 id 대조 → 변경분만 임베딩
 *   guide                GitHub 태그 소스(md) → 전량 재인덱싱 (원본 ~수 MB)
 *   common_components    GitHub 태그 tarball → 트리 교체 (임베딩 0, SQLite 미변경)
 *   compatibility        릴리스 JSON → 오버레이 SQLite 에 deterministic 재적재
 *
 * 모듈 구성:
 *   update.ts           옵션 파싱·잠금·상태 조회·롤백·리소스별 디스패치 (이 파일)
 *   shared.ts           옵션 타입·리소스 라벨·오버레이 버전 디렉토리 헬퍼 (공통 기반)
 *   lancedb/            LanceDB 리소스 상세 — developer_knowledge, guide
 *   sqlite/             SQLite 리소스 상세 — 오버레이 사본 공용(overlay), compatibility
 *   common-components/  소스 트리 리소스 상세 — common_components
 *
 * SQLite 리소스는 오버레이 DB 사본에 적용되며(utils/dataPaths 의 base 추적 —
 * 번들이 이기는 규칙), 패키지 갱신으로 사본이 무효화되면 보관된 적용 원본으로
 * 새 번들 위에 재적용해 치유한다.
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
import { createInterface } from 'node:readline/promises';
import { stdin as input } from 'node:process';
import {
  EMBEDDING_MODEL_ID,
  getOverlayRoot,
  readOverlayState,
  writeOverlayStateAtomic,
  resolveResource,
  type ResourceName,
} from '../utils/dataPaths.js';
import {
  MANIFEST_FILENAME,
  parseManifestFile,
  compareDatasetVersion,
} from '../kb/snapshot.js';
import {
  DOCS_REPO,
  COMPONENTS_REPO,
  SNAPSHOT_REPO,
  listRemoteVersionTags,
  snapshotManifestUrl,
} from '../kb/sources.js';
import { downloadToFile } from '../utils/download.js';
import { CLI_FILE, RESOURCE_LABELS, type UpdateOptions } from './shared.js';
import { updateDeveloperKnowledge } from './lancedb/developerKnowledge.js';
import { updateGuide } from './lancedb/guide.js';
import { updateComponents } from './common-components/commonComponents.js';
import {
  SQLITE_RESOURCES,
  isOverlaySqliteStale,
  rebuildOverlaySqliteFromState,
} from './sqlite/overlay.js';
import { updateCompatibility } from './sqlite/compatibility.js';

// ─── 옵션 ────────────────────────────────────────────────

const RESOURCE_ALIASES: Record<string, ResourceName> = {
  developer_knowledge: 'developer_knowledge',
  knowledge: 'developer_knowledge',
  guide: 'guide',
  common_components: 'common_components',
  components: 'common_components',
  compatibility: 'compatibility',
  compat: 'compatibility',
};

export function parseUpdateArgs(argv: string[]): UpdateOptions {
  const options: UpdateOptions = {
    check: false,
    yes: false,
    full: false,
    force: false,
    keepPrevious: false,
    rollback: false,
    rollbackTargets: null,
    resources: ['developer_knowledge', 'guide', 'common_components', 'compatibility'],
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
      `알 수 없는 리소스입니다: ${name} (developer_knowledge | guide | components | compatibility 중 선택)`,
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

interface ResourceStatus {
  resource: ResourceName;
  currentVersion: string | null;
  origin: 'overlay' | 'bundled';
  /** 원격에서 확인한 갱신 후보 (null = 확인 불가/대상 아님) */
  candidate: string | null;
  note: string;
}

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

    if (options.fromFileDir) {
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
  if (isOverlaySqliteStale()) {
    console.error('⚠️ 패키지 갱신으로 SQLite 적용분(호환성)이 번들로 폴백 중입니다 — update 를 실행하면 새 번들 위에 재적용됩니다.');
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
    const overlayStale = isOverlaySqliteStale();

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
      console.error('\n↻ 패키지 갱신 감지 — SQLite 적용분(호환성)을 새 번들 위에 재적용합니다...');
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
  console.error('  --resource=<이름,...>      대상 한정 (developer_knowledge|guide|components|compatibility)');
  console.error('  --guide-tag=<태그>         가이드 버전 지정');
  console.error('  --components-tag=<태그>    공통컴포넌트 버전 지정');
  console.error('  --compatibility-tag=<태그>  호환성 SW 릴리스 버전 지정');
  console.error('  --from-file=<디렉토리>     반입 파일로 갱신 (폐쇄망 반입)');
  console.error('  --rollback[=<이름,...>]    직전 버전 복귀');
  console.error('  --full                     개발자 지식 전량 재임베딩');
  console.error('  --force                    다운그레이드/동일 버전 강제 적용');
  console.error('  --keep-previous            공통컴포넌트 직전 버전도 보존');
  console.error('  --yes                      확인 생략');
}
