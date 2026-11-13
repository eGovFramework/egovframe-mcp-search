#!/usr/bin/env node

/**
 * Initial Data Indexing Script
 * 초기 데이터베이스 인덱싱 (호환성 SW, 공통컴포넌트, 개발자 지식, eGovFrame 가이드)
 *
 * 파이프라인 (모든 질문은 프리플라이트에 모으고, 이후는 무인 실행):
 *   Phase 0-1  프리플라이트 — 소스 모드 선택 → 도달성 프로브 → 소스 확보·검증
 *              → 빌드 플랜 확인 (기존 인덱스 무손상)
 *   Phase 2    스테이징 빌드 — knowledge-base.staging/ 에 1/5~4/5 재구축
 *   Phase 3-5  검증 → 원자 교체 (직전본은 knowledge-base.prev/ 보존) → 통계
 *
 * 사용법:
 *   npm run build-index                                    # 대화형 (소스 모드 질문)
 *   npm run build-index -- --yes                           # 비대화형 = bundled (네트워크 0)
 *   npm run build-index -- --source=online --yes           # 비대화형 온라인 (태그는 현재 유지)
 *   npm run build-index -- --source=online --guide-tag=v5.0.0 --components-tag=v5.0.1 --yes
 *   npm run build-index -- --source=local --template-dir=/media/usb/kb --yes
 */

import { SQLiteManager } from '../database/sqliteManager.js';
import { GuideSearchManager, GuideIndexStats } from '../rag/guideManager.js';
import { DeveloperKnowledgeManager } from '../rag/knowledgeManager.js';
import { type AddKnowledgeInput } from '../types/knowledge.js';
import {
  ensureEgovframeDocs,
  ensureCommonComponentsSrc,
  runTagSelectionPrompt,
  TagSelectionAbortedError,
  describeSourceVersion,
  EGOVDOCS_DIR,
  COMPONENTS_SRC_DIR,
  type TagSelector,
} from './templateSources.js';
import {
  type SnapshotRow,
  type SnapshotManifest,
  assertManifestCompatible,
  parseManifestFile,
  parseSnapshotFile,
  writeSnapshotFile,
  writeManifestFile,
  buildManifest,
  xlsxToSnapshotRows,
  synthesizeDatasetVersion,
  snapshotRowToKnowledgeInput,
  SNAPSHOT_FILENAME,
  MANIFEST_FILENAME,
} from '../kb/snapshot.js';
import { snapshotManifestUrl, snapshotFileUrl } from '../kb/sources.js';
import { loadCompatibilityFromJson, loadCommonComponentsFromJson } from '../kb/sqliteLoaders.js';
import { indexGuideDirectory } from '../kb/guideIndexer.js';
import { probeReachable, downloadToFile } from '../utils/download.js';
import { SCHEMA_VERSION, EMBEDDING_MODEL_ID, readStateFile, type StateFile } from '../utils/dataPaths.js';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin as input } from 'node:process';
import { PDFParse } from 'pdf-parse';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 프로젝트 루트 경로 (build/scripts/buildIndex.js -> project root)
const PROJECT_ROOT = path.resolve(__dirname, '../..');
export const TEMPLATES_DIR = path.join(PROJECT_ROOT, 'templates');
// build-index 는 항상 저장소의 knowledge-base 를 대상으로 한다
// (유지보수자 머신에 사용자 오버레이가 있어도 간섭받지 않도록 명시 고정)
const KNOWLEDGE_BASE_DIR = path.join(PROJECT_ROOT, 'knowledge-base');
/** 스테이징 빌드 대상 — 성공 시 원자 교체로 KNOWLEDGE_BASE_DIR 이 된다 */
const STAGING_DIR = path.join(PROJECT_ROOT, 'knowledge-base.staging');
/** 직전 인덱스 보존 위치 (교체 실패 시 복귀 지점) */
const PREV_DIR = path.join(PROJECT_ROOT, 'knowledge-base.prev');
const DEVELOPER_KNOWLEDGE_DIR = path.join(TEMPLATES_DIR, 'developer_knowledge');

type SourceMode = 'online' | 'local' | 'bundled';

interface BuildIndexOptions {
  yes: boolean;
  source?: SourceMode;
  templateDir?: string;
  componentsTag?: string;
  guideTag?: string;
}

// ─── 빌드 플랜 (프리플라이트 산출물) ─────────────────────

interface KnowledgePlan {
  rows: SnapshotRow[];
  manifest: SnapshotManifest;
  origin: 'release' | 'from-file' | 'bundled';
  /** 스테이징에 그대로 동봉할 스냅샷 원본 경로 (없으면 rows 로 재직렬화) */
  snapshotSrcPath?: string;
}

interface BuildPlan {
  sourceMode: SourceMode;
  /** null → 소스 없음: 이 리소스는 스킵하고 기존 인덱스를 유지 */
  knowledge: KnowledgePlan | null;
  /** 인덱싱할 가이드 md 루트. null → 스킵 (기존 인덱스 유지) */
  guideDir: string | null;
  guideOrigin: 'bundled' | 'user-path';
  componentsSrcReady: boolean;
  componentsOrigin: 'bundled' | 'user-path';
}

function parseArgs(argv: string[]): BuildIndexOptions {
  const options: BuildIndexOptions = {
    yes: argv.includes('--yes') || argv.includes('-y') || argv.includes('--force'),
  };
  for (const arg of argv) {
    if (arg.startsWith('--source=')) {
      const value = arg.slice('--source='.length);
      if (value !== 'online' && value !== 'local' && value !== 'bundled') {
        throw new Error('--source 는 online | local | bundled 중 하나여야 합니다.');
      }
      options.source = value;
    } else if (arg.startsWith('--template-dir=')) {
      options.templateDir = arg.slice('--template-dir='.length);
    } else if (arg.startsWith('--components-tag=')) {
      options.componentsTag = arg.slice('--components-tag='.length);
    } else if (arg.startsWith('--guide-tag=')) {
      options.guideTag = arg.slice('--guide-tag='.length);
    }
  }
  return options;
}

/**
 * EOF 에 안전한 질문 헬퍼.
 *
 * non-terminal 모드(stdin/stderr 모두 리다이렉트)에서 stdin EOF 가 오면 rl.question
 * 프라미스가 영원히 settle 되지 않아 프로세스가 unsettled top-level await 로 조용히
 * 죽는다. 이를 방지하기 위해 사용자 입력 외에 close 이벤트와 race 해 빈 문자열 ''을 반환한다.
 * - rl.question(question)으로 사용자 입력을 기다리고
 * - rl.once('close', ...)으로 stdin이 EOF로 닫히면(close) 빈 문자열 ''을 반환하는데
 * - Promise.race(...)로 위 두가지 경우를 감싸서
 *   사용자 입력과 close 이벤트 중 먼저 발생한 결과를 사용한다.
 * - catch(...)로 사용자의 Ctrl+C 등으로 인한 예기치 않은 오류가 발생하더라도
 *   빈 문자열 ''을 반환한다.
 */
async function askQuestion(
  rl: ReturnType<typeof createInterface>,
  question: string,
): Promise<string> {
  return Promise.race([
    rl.question(question),
    new Promise<string>(resolve => rl.once('close', () => resolve(''))),
  ]).catch(() => '');
}

/**
 * 터미널 인터랙티브 태그 선택 프롬프트.
 *
 * 저장소 차례가 되면 최신 버전 태그(최대 10개)와 현재 적용 태그를 보여주고
 * 태그명을 입력받는다. 엔터(빈 입력) 또는 현재 태그명 입력 = 현재 소스 유지,
 * 다른 태그명 입력 = 그 태그의 소스로 전환. 없는 태그명은 재입력을 요청한다.
 */
export function createInteractiveTagSelector(): TagSelector {
  return async (ctx) => {
    console.error('');
    console.error(`  🔖 ${ctx.label} 버전 태그 선택`);
    if (ctx.fetchFailed) {
      console.error('     (원격 태그 fetch 실패 — 로컬에 저장된 태그 기준)');
    }
    console.error(`     현재 적용: ${ctx.currentTag ?? `${ctx.currentDescription} (정확히 태그 위가 아님)`}`);
    console.error(`     최신 태그 ${ctx.latestTags.length}개:`);
    for (const tag of ctx.latestTags) {
      const marker = tag === ctx.currentTag ? '→' : '-';
      console.error(`      ${marker} ${tag}`);
    }

    // readline의 output(질문)도 "stdout이 아니라 stderr로 처리"하여
    // 태그 목록과 같은 스트림에 질문을 표시하고,
    // stdout 리다이렉트 시에도 readline이 터미널 모드를 유지하게 한다
    // (질문이 로그 파일로 사라지는 문제 방지)
    const rl = createInterface({ input, output: process.stderr });
    // Ctrl+C: readline 이 raw mode 로 SIGINT 를 가로채므로 직접 감지해
    // '태그 적용 실패' 로 뭉개지지 않는 전용 에러로 build-index 전체를 중단시킨다.
    // (Ctrl+D/EOF 는 askQuestion 이 '' 로 정규화 → 현재 체크아웃 유지)
    let userInterrupted = false;
    rl.on('SIGINT', () => {
      userInterrupted = true;
      rl.close();
    });

    const ask = async (question: string): Promise<string> => {
      const answer = await askQuestion(rl, question);
      if (userInterrupted) {
        throw new TagSelectionAbortedError();
      }
      return answer;
    };

    try {
      return await runTagSelectionPrompt(ctx, ask);
    } finally {
      rl.close();
    }
  };
}

// ─── Phase 0-1: 프리플라이트 ─────────────────────────────
// 모든 대화형 질문·소스 확보·검증을 빌드 시작 전에 끝낸다.
// 이 단계에서는 기존 인덱스를 절대 건드리지 않는다 — 어떤 실패도 무손상 중단.

/** 태그 선택기 조립 — 플래그 명시가 우선, 대화형이면 프롬프트, 아니면 현재 유지 */
function buildTagSelector(options: BuildIndexOptions, interactive: boolean): TagSelector | undefined {
  const interactiveSelector = interactive ? createInteractiveTagSelector() : undefined;
  if (!options.componentsTag && !options.guideTag) {
    return interactiveSelector;
  }
  return async (ctx) => {
    const flag = ctx.label.includes('common-components') ? options.componentsTag : options.guideTag;
    if (flag) return flag;
    return interactiveSelector ? interactiveSelector(ctx) : '';
  };
}

/** 디렉토리에서 개발자 지식 소스 로드 — 스냅샷 쌍 우선, 없으면 xlsx 합성 */
async function loadKnowledgeFromDir(
  dir: string,
  origin: KnowledgePlan['origin'],
): Promise<KnowledgePlan | null> {
  const manifestPath = path.join(dir, MANIFEST_FILENAME);
  const snapshotPath = path.join(dir, SNAPSHOT_FILENAME);

  if (await fs.pathExists(manifestPath) && await fs.pathExists(snapshotPath)) {
    const manifest = parseManifestFile(manifestPath);
    assertManifestCompatible(manifest);
    const rows = parseSnapshotFile(snapshotPath);
    if (rows.length !== manifest.row_count) {
      throw new Error(`스냅샷 행 수(${rows.length})가 manifest(${manifest.row_count})와 다릅니다 — 산출물 손상 의심.`);
    }
    console.error(`  ✓ 스냅샷 로드: ${manifest.dataset_version} (${rows.length}행)`);
    return { rows, manifest, origin, snapshotSrcPath: snapshotPath };
  }

  // 스냅샷이 없으면 xlsx 에서 합성 (발행 파이프라인 가동 전 폴백)
  if (!await fs.pathExists(dir)) {
    return null;
  }
  const entries = await fs.readdir(dir);
  const xlsxPaths = entries
    .filter((name) => name.toLowerCase().endsWith('.xlsx'))
    .map((name) => path.join(dir, name));
  if (xlsxPaths.length === 0) {
    return null;
  }

  const rows: SnapshotRow[] = [];
  for (const xlsxPath of xlsxPaths) {
    const fileRows = xlsxToSnapshotRows(xlsxPath);
    rows.push(...fileRows);
    console.error(`  ✓ Excel 로드: ${path.basename(xlsxPath)} (${fileRows.length}행)`);
  }
  const manifest = buildManifest(synthesizeDatasetVersion(xlsxPaths), rows.length);
  console.error(`  ✓ xlsx 에서 스냅샷 합성: ${manifest.dataset_version} (${rows.length}행)`);
  return { rows, manifest, origin };
}

/** 개발자 지식 소스 획득 — online 은 다운로드, 실패 시 번들 폴백 */
async function acquireKnowledge(
  mode: SourceMode,
  templateDir: string | null,
): Promise<KnowledgePlan | null> {
  console.error('\n📥 개발자 지식(Q&A/FAQ) 소스 확보...');

  if (mode === 'online') {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'egov-kb-dl-'));
    try {
      const manifestPath = path.join(tmpDir, MANIFEST_FILENAME);
      const snapshotPath = path.join(tmpDir, SNAPSHOT_FILENAME);
      await downloadToFile(snapshotManifestUrl(), manifestPath, {
        timeoutMs: 30_000,
        maxBytes: 10 * 1024 * 1024,
      });
      const manifest = parseManifestFile(manifestPath);
      assertManifestCompatible(manifest);
      await downloadToFile(snapshotFileUrl(), snapshotPath, {
        timeoutMs: 300_000,
        maxBytes: 128 * 1024 * 1024,
      });
      const rows = parseSnapshotFile(snapshotPath);
      if (rows.length !== manifest.row_count) {
        throw new Error(`행 수(${rows.length}) ≠ manifest(${manifest.row_count})`);
      }
      console.error(`  ✓ 릴리스 스냅샷 다운로드: ${manifest.dataset_version} (${rows.length}행)`);
      return { rows, manifest, origin: 'release', snapshotSrcPath: snapshotPath };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  ⚠️ 릴리스 스냅샷 확보 실패 (${message})`);
      console.error('     번들 소스(templates/developer_knowledge)로 폴백합니다.');
      await fs.remove(tmpDir).catch(() => {});
      // 번들 폴백으로 계속
    }
  }

  if (mode === 'local' && templateDir) {
    const localDir = path.join(templateDir, 'developer_knowledge');
    const plan = await loadKnowledgeFromDir(localDir, 'from-file');
    if (plan) return plan;
    console.error(`  ⚠️ ${localDir} 에서 스냅샷/xlsx 를 찾지 못했습니다 — 번들 소스로 폴백합니다.`);
  }

  const plan = await loadKnowledgeFromDir(DEVELOPER_KNOWLEDGE_DIR, 'bundled');
  if (!plan) {
    console.error('  ⚠️ 개발자 지식 소스가 없습니다 — 이 리소스는 스킵하고 기존 인덱스를 유지합니다.');
  }
  return plan;
}

/** 빌드 플랜 요약 출력 */
function printBuildPlan(plan: BuildPlan): void {
  console.error('\n📋 빌드 플랜');
  console.error(`  소스 모드     : ${plan.sourceMode}`);
  const componentsVersion = describeSourceVersion(COMPONENTS_SRC_DIR) ?? '(git 정보 없음)';
  console.error(`  공통컴포넌트  : ${componentsVersion}${plan.componentsSrcReady ? '' : ' — 소스 없음(탐색 기능 제한)'}`);
  if (plan.guideDir) {
    const guideVersion = plan.guideOrigin === 'user-path'
      ? `사용자 지정 경로 (${plan.guideDir})`
      : describeSourceVersion(EGOVDOCS_DIR) ?? '(git 정보 없음)';
    console.error(`  가이드        : ${guideVersion}`);
  } else {
    console.error('  가이드        : 소스 없음 — 스킵 (기존 인덱스 유지)');
  }
  if (plan.knowledge) {
    console.error(
      `  개발자 지식   : ${plan.knowledge.manifest.dataset_version} (${plan.knowledge.rows.length}행, ${plan.knowledge.origin})`,
    );
  } else {
    console.error('  개발자 지식   : 소스 없음 — 스킵 (기존 인덱스 유지)');
  }
  console.error(`  임베딩 모델   : ${EMBEDDING_MODEL_ID} (로컬)`);
  console.error('  빌드 방식     : knowledge-base.staging/ 재구축 후 원자 교체 (기존 인덱스는 교체 전까지 유지)');
  console.error('  예상 소요     : 전량 재임베딩 수십 분 (CPU 성능에 따라 상이)');
}

/**
 * 프리플라이트 — 소스 모드 결정 → 확보 → 검증 → 플랜 확인.
 * 여기서 반환되면 이후 빌드는 무인으로 완주한다.
 */
async function preflight(options: BuildIndexOptions): Promise<BuildPlan> {
  const interactive = !options.yes && input.isTTY;
  let mode: SourceMode | undefined = options.source;

  // --source 미지정: 비대화형은 bundled(네트워크 0)가 안전 기본값
  if (!mode && !interactive) {
    mode = 'bundled';
  }

  // readline 은 stderr 로 — 안내 출력과 스트림 통일, stdout 리다이렉트에도 안전
  const rl = interactive ? createInterface({ input, output: process.stderr }) : null;
  try {
    if (!mode) {
      console.error('소스 모드를 선택하세요:');
      console.error('  1) online  — GitHub 에서 최신 소스·스냅샷 받기 (기본)');
      console.error('  2) local   — 사용자 지정 경로 사용 (폐쇄망 반입)');
      console.error('  3) bundled — 레포 현재 체크아웃만 사용 (네트워크 접근 0)');
      const answer = (await askQuestion(rl!, '  선택 [1/2/3] (엔터 = 1): ')).trim();
      mode = answer === '2' ? 'local' : answer === '3' ? 'bundled' : 'online';
    }

    // 도달성 프로브 — ICMP ping 이 아니라 실제 쓸 호스트에 HTTPS 요청
    if (mode === 'online') {
      console.error('\n🌐 github.com 도달성 확인 중 (3초 타임아웃)...');
      if (!(await probeReachable('https://github.com', 3_000))) {
        console.error('⚠️ github.com 에 도달할 수 없습니다.');
        if (rl) {
          const answer = (await askQuestion(rl, '   2) local / 3) bundled 중 선택 (엔터 = 3): ')).trim();
          mode = answer === '2' ? 'local' : 'bundled';
        } else {
          console.error('   bundled 모드로 진행합니다.');
          mode = 'bundled';
        }
      }
    }

    // local 모드: 경로 확정 + symlink 해석
    let templateDir: string | null = null;
    if (mode === 'local') {
      templateDir = options.templateDir ?? null;
      if (!templateDir && rl) {
        templateDir = (await askQuestion(rl, '  사용자 지정 템플릿 디렉토리 경로: ')).trim() || null;
      }
      if (!templateDir) {
        throw new Error('local 모드에는 --template-dir=<경로> 가 필요합니다.');
      }
      templateDir = path.resolve(templateDir);
      if (!await fs.pathExists(templateDir)) {
        throw new Error('지정한 템플릿 디렉토리를 찾을 수 없습니다.');
      }
      templateDir = await fs.realpath(templateDir);
    }

    // ── 리소스별 소스 확보 ──
    let componentsSrcReady: boolean;
    let componentsOrigin: BuildPlan['componentsOrigin'] = 'bundled';
    let guideDir: string | null = null;
    let guideOrigin: BuildPlan['guideOrigin'] = 'bundled';

    if (mode === 'online') {
      const selectTag = buildTagSelector(options, interactive);
      console.error('\n📥 공통컴포넌트 소스 확보...');
      componentsSrcReady = await ensureCommonComponentsSrc({ selectTag });
      console.error('\n📥 가이드 문서 소스 확보...');
      const docsReady = await ensureEgovframeDocs({ selectTag });
      guideDir = docsReady ? EGOVDOCS_DIR : null;
    } else if (mode === 'local') {
      // 공통컴포넌트: 소스 탐색 도구는 번들 경로를 읽으므로 local 트리는 검증+경고만
      const localComponents = path.join(templateDir!, 'common-components-src');
      if (await fs.pathExists(path.join(localComponents, 'pom.xml'))) {
        componentsOrigin = 'user-path';
        componentsSrcReady = true;
        console.error('  ⚠️ 사용자 지정 공통컴포넌트 소스를 확인했습니다.');
        console.error('     소스 탐색 기능과 tgz 동봉은 templates/common-components-src 를 사용하므로,');
        console.error('     반영하려면 해당 디렉토리를 직접 교체해야 합니다.');
      } else {
        componentsSrcReady = await fs.pathExists(path.join(COMPONENTS_SRC_DIR, 'pom.xml'));
      }

      const localGuide = path.join(templateDir!, 'egovframe_guide');
      if (await fs.pathExists(path.join(localGuide, '_index.md'))) {
        guideDir = localGuide;
        guideOrigin = 'user-path';
      } else if (await fs.pathExists(path.join(EGOVDOCS_DIR, '_index.md'))) {
        guideDir = EGOVDOCS_DIR;
        console.error('  ⚠️ 지정 경로에 egovframe_guide(_index.md)가 없어 번들 가이드로 폴백합니다.');
      }
    } else {
      // bundled — 네트워크 접근 0, 현재 체크아웃 그대로
      componentsSrcReady = await fs.pathExists(path.join(COMPONENTS_SRC_DIR, 'pom.xml'));
      if (await fs.pathExists(path.join(EGOVDOCS_DIR, '_index.md'))) {
        guideDir = EGOVDOCS_DIR;
      }
    }

    // 개발자 지식 확보 + 검증 (파싱까지 — clearAll 이전에 실패를 끝낸다)
    const knowledge = await acquireKnowledge(mode, templateDir);

    const plan: BuildPlan = {
      sourceMode: mode,
      knowledge,
      guideDir,
      guideOrigin,
      componentsSrcReady,
      componentsOrigin,
    };

    // ── 플랜 확인 (유일한 파괴적 작업 승인 지점) ──
    printBuildPlan(plan);
    if (rl) {
      const answer = await askQuestion(rl, '\n계속하려면 "yes"를 입력하세요: ');
      if (answer.trim().toLowerCase() !== 'yes') {
        throw new Error('사용자 확인이 없어 인덱싱을 중단했습니다.');
      }
    } else if (options.yes) {
      console.error('\n⚠️  --yes 옵션이 지정되어 확인 절차를 건너뜁니다.');
    } else {
      throw new Error('비대화형 환경에서는 확인을 받을 수 없습니다. 계속하려면 `npm run build-index -- --yes`를 사용하세요.');
    }

    return plan;
  } finally {
    rl?.close();
  }
}

// ─── Phase 2-4: 스테이징 → 검증 → 원자 교체 ──────────────

/** 스테이징 준비 — 기존 knowledge-base 전체 복사 (스킵 리소스 자연 승계) */
async function prepareStaging(): Promise<void> {
  await fs.remove(STAGING_DIR);
  if (await fs.pathExists(KNOWLEDGE_BASE_DIR)) {
    await fs.copy(KNOWLEDGE_BASE_DIR, STAGING_DIR, {
      filter: (src) => !src.endsWith('.DS_Store'),
    });
  } else {
    await fs.ensureDir(STAGING_DIR);
  }
}

/** 스테이징 검증 프로브 — 재구축 리소스의 마커 존재 확인 */
async function verifyStaging(plan: BuildPlan): Promise<void> {
  const checks: Array<[string, string]> = [['SQLite DB', 'egovframe.db']];
  if (plan.knowledge) checks.push(['개발자 지식 테이블', 'developer_knowledge.lance']);
  if (plan.guideDir) checks.push(['가이드 테이블', 'egovframe_guide.lance']);

  for (const [label, marker] of checks) {
    if (!await fs.pathExists(path.join(STAGING_DIR, marker))) {
      throw new Error(`스테이징 검증 실패: ${label}(${marker})이 없습니다. 기존 인덱스를 유지합니다.`);
    }
  }
}

/** 원자 교체 — 실패 시 직전 상태로 복귀 */
async function swapStagingIntoPlace(): Promise<void> {
  await fs.remove(PREV_DIR);
  if (await fs.pathExists(KNOWLEDGE_BASE_DIR)) {
    await fs.move(KNOWLEDGE_BASE_DIR, PREV_DIR);
  }
  try {
    await fs.move(STAGING_DIR, KNOWLEDGE_BASE_DIR);
  } catch (error) {
    // 복귀 시도 — 어떤 실패 조합에서도 검색 불능 상태를 만들지 않는다
    if (await fs.pathExists(PREV_DIR)) {
      await fs.move(PREV_DIR, KNOWLEDGE_BASE_DIR).catch(() => {});
    }
    throw error;
  }
  console.error(`  ✓ 원자 교체 완료 (직전본: knowledge-base.prev/)`);
}

/** v 접두어를 무시한 버전 문자열 비교용 정규화 */
function normalizeVersionLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.replace(/^v/, '');
}

/** 스테이징에 state.json + 스냅샷 동봉 파일 기록 */
interface SqliteResourceCounts {
  compat: number;
}

async function writeStateAndArtifacts(
  plan: BuildPlan,
  knowledgeStats: DeveloperKnowledgeIndexStats | null,
  guideStats: GuideIndexStats | null,
  sqliteCounts: SqliteResourceCounts,
): Promise<void> {
  console.error('\n📚 5/5 상태 기록·검증·원자 교체...');

  // 스냅샷 동봉 — 사용자 update 의 diff 부트스트랩 기반
  if (plan.knowledge) {
    writeManifestFile(path.join(STAGING_DIR, MANIFEST_FILENAME), plan.knowledge.manifest);
    if (plan.knowledge.snapshotSrcPath) {
      await fs.copy(plan.knowledge.snapshotSrcPath, path.join(STAGING_DIR, SNAPSHOT_FILENAME));
    } else {
      writeSnapshotFile(path.join(STAGING_DIR, SNAPSHOT_FILENAME), plan.knowledge.rows);
    }
  }

  // 스킵된 리소스는 기존 state 항목 승계
  const previousState = readStateFile(path.join(STAGING_DIR, 'state.json'));
  const state: StateFile = {
    schema_version: SCHEMA_VERSION,
    embedding_model: { id: EMBEDDING_MODEL_ID },
    generated_at: new Date().toISOString(),
    resources: { ...previousState?.resources },
  };

  if (plan.knowledge && knowledgeStats) {
    state.resources.developer_knowledge = {
      version: plan.knowledge.manifest.dataset_version,
      row_count: knowledgeStats.excelItems,
      origin: plan.knowledge.origin,
      embedding_model: EMBEDDING_MODEL_ID,
      applied_at: new Date().toISOString(),
    };
  }

  if (plan.guideDir && guideStats) {
    state.resources.guide = {
      version:
        plan.guideOrigin === 'user-path'
          ? 'user-path'
          : describeSourceVersion(EGOVDOCS_DIR) ?? 'unknown',
      chunk_count: guideStats.totalChunks,
      origin: plan.guideOrigin === 'user-path' ? 'user-path' : 'bundled',
      embedding_model: EMBEDDING_MODEL_ID,
      applied_at: new Date().toISOString(),
    };
  }

  // 공통컴포넌트: 소스 태그와 동봉 메타 버전을 함께 기록 (불일치 경고)
  const sourceVersion = describeSourceVersion(COMPONENTS_SRC_DIR);
  let metadataVersion: string | null = null;
  try {
    const meta = await fs.readJSON(path.join(TEMPLATES_DIR, 'common-components.json'));
    metadataVersion = typeof meta.version === 'string' ? meta.version : null;
  } catch {
    // 메타 파일 없음 — 버전 미기록
  }
  state.resources.common_components = {
    source_version: sourceVersion ?? undefined,
    metadata_version: metadataVersion ?? undefined,
    origin: plan.componentsOrigin,
    applied_at: new Date().toISOString(),
  };
  if (
    sourceVersion &&
    metadataVersion &&
    normalizeVersionLabel(sourceVersion) !== normalizeVersionLabel(metadataVersion)
  ) {
    console.error(`  ⚠️ 공통컴포넌트 소스(${sourceVersion})와 메타(${metadataVersion}) 버전이 다릅니다.`);
    console.error('     목록·설명·키워드 검색은 메타(common-components.json) 기준입니다 — 메타 재생성을 검토하세요.');
  }

  // SQLite 리소스 (호환성 SW) — 사용자 update 의 현재 버전 기준값.
  // 원본 JSON 에 버전 표기가 없어 파일 mtime 에서 날짜 버전을 합성한다.
  const compatFile = path.join(TEMPLATES_DIR, 'compatibility', 'compatibility-software.json');
  if (sqliteCounts.compat > 0 && await fs.pathExists(compatFile)) {
    state.resources.compatibility = {
      version: synthesizeDatasetVersion([compatFile]),
      row_count: sqliteCounts.compat,
      origin: 'bundled',
      applied_at: new Date().toISOString(),
    };
  }

  await fs.writeFile(
    path.join(STAGING_DIR, 'state.json'),
    JSON.stringify(state, null, 2) + '\n',
    'utf-8',
  );
  console.error('  ✓ state.json 기록 완료');
}

async function buildIndex(options: BuildIndexOptions) {
  console.error('🚀 eGovFrame Companion - 지식베이스 인덱싱 시작\n');

  try {
    // ── Phase 0-1: 프리플라이트 (모든 질문·확보·검증 — 기존 인덱스 무손상) ──
    const plan = await preflight(options);

    // ── Phase 2: 스테이징 빌드 ──
    console.error('\n📦 스테이징 준비 중 (기존 인덱스는 교체 전까지 그대로 유지됩니다)...');
    await prepareStaging();

    // 1/5 SQLite 기준 데이터 (스테이징 DB 대상)
    console.error('📊 SQLite 데이터베이스 초기화 중...');
    const sqlite = new SQLiteManager(path.join(STAGING_DIR, 'egovframe.db'));

    const compatCount = await loadCompatibilitySoftware(sqlite);

    // 2/5 공통컴포넌트 (SQLite 메타 — 소스 확보는 프리플라이트에서 완료)
    await loadCommonComponents(sqlite, plan.componentsSrcReady);

    // 3/5 개발자 지식 벡터화 (LanceDB)
    const knowledgeStats = await indexDeveloperKnowledge(plan.knowledge);

    // 4/5 eGovFrame 가이드 벡터화 (LanceDB)
    const guideStats = await indexEgovframeDocs(plan.guideDir);

    // 통계 수집 (close 전에)
    const stats = sqlite.getOverallStats();

    // ── Phase 3-5: 상태 기록 → 검증 → 원자 교체 ──
    await writeStateAndArtifacts(plan, knowledgeStats, guideStats, {
      compat: compatCount,
    });
    // 배포되는 DB 는 읽기 전용으로 열리므로 WAL 이 아닌 DELETE 저널 모드로 마무리한다
    sqlite.finalizeForDistribution();
    sqlite.close();
    await verifyStaging(plan);
    await swapStagingIntoPlace();

    // 통계 출력
    console.error('\n📊 인덱싱 완료 통계:');
    console.error(`  ✓ 호환성 SW: ${compatCount}개`);
    console.error(`  ✓ 컴포넌트 카테고리: ${stats.componentCategories.count}개`);
    console.error(`  ✓ 공통컴포넌트: ${stats.commonComponents.count}개`);
    if (knowledgeStats) {
      console.error(`  ✓ 개발자 지식: ${knowledgeStats.totalItems}개`);
      console.error(`    - FAQ/Q&A: ${knowledgeStats.excelItems}개`);
      console.error(`    - PDF 청크: ${knowledgeStats.pdfChunks}개`);
    }
    if (guideStats) {
      console.error(`  ✓ 가이드 문서: ${guideStats.totalFiles}개 파일 → ${guideStats.totalChunks}개 청크`);
      for (const [layer, count] of Object.entries(guideStats.byLayer)) {
        console.error(`    - ${layer}: ${count}개`);
      }
    }

    console.error('\n✅ 지식베이스 인덱싱 완료!');
    console.error('\n💡 다음 단계:');
    console.error('  1. npm run build - 프로젝트 빌드');
    console.error('  2. npm run inspector - MCP Inspector로 테스트');
    console.error('  3. Claude Desktop에 MCP 서버 등록');

  } catch (error) {
    // 실패 시 스테이징 잔재 정리 (기존 인덱스는 무손상)
    await fs.remove(STAGING_DIR).catch(() => {});
    if (error instanceof TagSelectionAbortedError) {
      console.error(`\n🛑 ${error.message}`);
      process.exit(130);
    }
    console.error('\n❌ 인덱싱 중 오류 발생:', error);
    process.exit(1);
  }
}

/**
 * 호환성 소프트웨어 로드 (JSON)
 */
async function loadCompatibilitySoftware(sqlite: SQLiteManager): Promise<number> {
  console.error('\n📚 1/5 호환성 소프트웨어 인덱싱...');

  const compatFile = path.join(TEMPLATES_DIR, 'compatibility', 'compatibility-software.json');

  if (!await fs.pathExists(compatFile)) {
    console.warn(`  ⚠️ 파일을 찾을 수 없습니다: ${compatFile}`);
    console.warn('  💡 python3 notebooks/convert-compatibility-xlsx-to-json.py --json 을 먼저 실행하세요.');
    return 0;
  }

  const count = await loadCompatibilityFromJson(sqlite, compatFile);
  console.error(`  ✓ ${count}개의 호환성 소프트웨어 추가 완료`);
  return count;
}

/**
 * 공통컴포넌트 데이터 로드
 */
async function loadCommonComponents(sqlite: SQLiteManager, srcReady: boolean) {
  console.error('\n📚 2/5 공통컴포넌트 인덱싱...');

  // 소스 확보/태그 선택은 프리플라이트에서 완료 — 여기서는 결과만 반영
  if (!srcReady) {
    console.warn('  ⚠️ 공통컴포넌트 소스 없음 — 소스 탐색 기능이 빈 결과를 반환할 수 있습니다.');
  }

  const componentsFile = path.join(TEMPLATES_DIR, 'common-components.json');

  if (!await fs.pathExists(componentsFile)) {
    console.warn(`  ⚠️ 파일을 찾을 수 없습니다: ${componentsFile}`);
    return;
  }

  // 카테고리·컴포넌트·의존성 적재와 FTS 재구축 (메타의 id 가 겹치면 고유한 id 로 바꿔 적재한다).
  // 소스 트리가 있으면 사용 테이블 목록을 메타 대신 소스 트리에서 도출한다.
  const result = await loadCommonComponentsFromJson(sqlite, componentsFile, {
    componentsSrcRoot: srcReady ? COMPONENTS_SRC_DIR : undefined,
  });

  if (result.tableSources) {
    const counts = Object.entries(result.tableSources)
      .map(([source, count]) => `${source} ${count}개`)
      .join(', ');
    console.error(`  ℹ️ 사용 테이블 목록을 소스 트리에서 도출했습니다 (${counts}).`);
  } else {
    console.warn('  ⚠️ 사용 테이블 목록을 메타에서 그대로 적재했습니다 — 메타의 목록은 부정확할 수 있습니다 (소스 트리가 있어야 도출할 수 있습니다).');
  }

  if (result.renamed.length > 0) {
    console.error(`  ℹ️ 메타의 id 가 겹쳐 새 id 를 부여한 컴포넌트 ${result.renamed.length}개:`);
    for (const entry of result.renamed) {
      console.error(`     - ${entry.name}: ${entry.from} → ${entry.to}`);
    }
  }

  const summary = sqlite.getComponentSummary();
  if (summary.totalComponents !== result.components) {
    throw new Error(
      `공통컴포넌트 적재 건수가 메타와 다릅니다 (메타 ${result.components}개, 적재 ${summary.totalComponents}개).`,
    );
  }
  console.error(`  ✓ ${result.categories}개 카테고리, ${summary.totalComponents}개 컴포넌트, ${result.dependencies}개 의존성 추가 완료`);
}

interface DeveloperKnowledgeIndexStats {
  totalItems: number;
  excelItems: number;
  pdfChunks: number;
}

/**
 * PDF 에서 뽑은 본문을 정리한다: NFC 로 정규화하고, 줄바꿈을 LF 로 통일하고, 이어진 공백과 탭을 한 칸으로,
 * 이어진 빈 줄을 하나로 줄인다.
 *
 * 게시판 글에 쓰는 cleanText 는 쓰지 않는다. cleanText 는 HTML 태그를 지우는데, PDF 본문의 꺾쇠는
 * 글자 그대로의 꺾쇠라서 "<" 부터 다음 ">" 까지가 통째로 사라진다. 동봉 적용가이드(v5.0)에서는
 * 17곳, 4,984자가 지워졌고 그중 한 곳은 다섯 쪽에 걸친 4,821자였다.
 */
function normalizePdfText(text: string): string {
  return text
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 적용가이드 PDF 청크 하나의 최대 글자 수 (앞 청크와 겹치는 부분 포함).
 *
 * 임베딩 모델은 입력의 앞 512 토큰만 읽는다. 청크의 임베딩 입력(제목·표지·상황·태그를 붙이고 접두
 * "passage: " 를 단 문자열)이 512 토큰을 넘으면 넘은 부분은 벡터에 반영되지 않아 의미 검색으로 찾을 수 없다.
 * 1,800자로 나누던 때에는 청크 87개 가운데 67개가 512 토큰을 넘었고, 토큰의 23.6% 가 반영되지 않았다.
 *
 * 동봉 적용가이드(v5.0)로 잰 값:
 * - 본문 밖의 몫(제목, 표지, 상황, 태그, 특수 토큰)은 52~54 토큰이다.
 * - 본문은 평균 글자당 0.44 토큰이고, 가장 빽빽한 곳(붙임 4 의 테이블 이름 목록)은 글자당 0.67 토큰이다.
 * - 줄 경계에서 시작해 줄 경계에서 끝나는 600자 이하의 구간은 어디를 잡아도 임베딩 입력이 452 토큰 이하다.
 *   680자 이하의 구간은 500 토큰 이하이고, 700자에서 513 토큰으로 넘는다.
 * 파일 이름이 길어지거나 다음 판의 본문이 더 빽빽해도 넘지 않도록 여유(60 토큰)를 두어 600자로 정한다.
 *
 * PDF 나 제목·상황·태그의 구성이 바뀌어 512 토큰을 넘게 되면 tests/unit/pdfKnowledgeChunks.test.ts 가 알린다.
 */
export const PDF_CHUNK_MAX_CHARS = 600;

/**
 * 이웃한 청크가 겹치는 최대 글자 수. 뒤 청크의 앞에 앞 청크의 끝부분을 이만큼까지 다시 싣는다 (청크의 상한에 포함된다).
 *
 * 겹침이 없으면 청크 경계에 걸친 내용은 두 청크로 갈려 어느 청크에도 온전히 들어 있지 않다.
 * 동봉 적용가이드(v5.0)를 600자 청크로 나눠 잰 값:
 * - 경계 양쪽에서 50자 이상씩 이어 붙인 구간(173개)을 질의로 쓰면, 겹침이 없을 때 구간 전체가 상위 3건에 드는
 *   비율은 50% 다. 100자를 겹치면 구간 전체를 담은 청크가 61% 에서 1위에 오르고, 78% 에서 구간 전체가 상위 3건에 든다.
 * - 본문 전체에서 고르게 뽑은 100~150자 구간(1,500개)이 상위 3건에 온전히 드는 비율은 겹침 0자 62%, 50자 73%,
 *   100자 75%, 150자 77%, 200자 75% 다. 구간을 가장 많이 담은 청크가 1위인 비율은 겹침 0~200자에서 57~60% 로,
 *   차이가 오차 범위 안이다.
 * - 글머리나 번호로 시작하는 항목은 78% 가 100자 이하다 (50자 이하는 32%).
 * - 150자로 늘리면 구간 전체를 담은 청크가 1위인 비율이 2~4%p 오르지만 청크가 12% 더 늘어난다.
 */
export const PDF_CHUNK_OVERLAP_CHARS = 100;

/** 정리한 본문의 한 구간 [start, end). 청크를 본문의 구간으로 다루어, 나눈 뒤에도 본문의 글자가 그대로 남게 한다. */
interface TextSpan {
  start: number;
  end: number;
}

/** 문단 경계: 빈 줄 */
const PDF_PARAGRAPH_BREAK = /\n{2,}/g;

/** 문장 경계: 끝 부호(와 닫는 따옴표·괄호) 뒤의 공백 */
const PDF_SENTENCE_BREAK = /(?<=[.!?。！？]["'”’」』)\]]*)\s+/g;

/**
 * 상한보다 긴 문단을 나눌 자리: 줄 → 문장 → 낱말.
 * 앞의 자리부터 써 보고, 그래도 상한을 넘는 조각만 다음 자리에서 더 나눈다.
 */
const PDF_SPLIT_BREAKS: readonly RegExp[] = [/\n/g, PDF_SENTENCE_BREAK, /\s+/g];

/** 구간 양 끝의 공백을 뺀다. 남는 글자가 없으면 null. */
function trimSpan(source: string, start: number, end: number): TextSpan | null {
  while (start < end && /\s/.test(source[start])) start += 1;
  while (end > start && /\s/.test(source[end - 1])) end -= 1;
  return start < end ? { start, end } : null;
}

/**
 * 구간을 separator 가 나오는 자리에서 나눈다. separator 와 조각 양 끝의 공백은 어느 조각에도 넣지 않는다.
 *
 * separator 는 구간만 잘라 낸 글에서 찾는다. 본문 전체에서 찾으면 구간 안에 separator 가 없을 때 구간 밖의 다음 자리나
 * 본문의 끝까지 훑게 되어, 그런 구간이 많은 본문(문장 부호가 없는 긴 줄이 이어진 본문)에서는 걸리는 시간이 본문 크기의
 * 제곱으로 늘어난다. 구간은 본문의 처음이나 공백 바로 뒤에서 시작하므로, 구간 앞의 글자를 볼 수 없어도 separator 의
 * 뒤돌아보기 조건(문장 경계의 끝 부호)은 본문 전체에서 찾을 때와 같은 자리에서 성립한다.
 */
function splitSpan(source: string, span: TextSpan, separator: RegExp): TextSpan[] {
  const parts: TextSpan[] = [];
  const pushPart = (start: number, end: number): void => {
    const part = trimSpan(source, start, end);
    if (part) parts.push(part);
  };

  let cursor = span.start;
  for (const match of source.slice(span.start, span.end).matchAll(separator)) {
    const matchStart = span.start + match.index;
    pushPart(cursor, matchStart);
    cursor = matchStart + match[0].length;
  }
  pushPart(cursor, span.end);
  return parts;
}

/**
 * 나눌 자리가 없는 구간을 글자 수로 자른다. 조각의 길이를 비슷하게 맞춰 끝에 몇 글자짜리 조각이 남지 않게 하고,
 * 서로게이트 쌍의 가운데에서는 자르지 않는다.
 */
function sliceSpanEvenly(source: string, span: TextSpan, maxChars: number): TextSpan[] {
  const parts: TextSpan[] = [];
  let start = span.start;
  let pieces = Math.ceil((span.end - start) / maxChars);
  while (start < span.end) {
    let end = Math.min(span.end, start + Math.ceil((span.end - start) / pieces));
    const lastKept = source.charCodeAt(end - 1);
    if (end < span.end && lastKept >= 0xd800 && lastKept <= 0xdbff) {
      // 쌍의 앞쪽에서 끊겼다. 한 단위 앞에서 자르고, 쌍 하나가 조각의 전부이면 쌍을 통째로 담는다
      end = end - 1 > start ? end - 1 : end + 1;
    }
    parts.push({ start, end });
    start = end;
    pieces = Math.max(pieces - 1, Math.ceil((span.end - start) / maxChars));
  }
  return parts;
}

/**
 * 구간을 상한 이하의 조각으로 나눈다. 상한 안에 드는 구간은 그대로 두고, 넘는 구간만 PDF_SPLIT_BREAKS 의
 * level 번째 자리에서 나눈 뒤 여전히 넘는 조각을 다음 자리에서 더 나눈다. 나눌 자리가 남지 않은 조각만 글자 수로 자른다.
 */
function splitSpanToFit(source: string, span: TextSpan, level: number, maxChars: number): TextSpan[] {
  if (span.end - span.start <= maxChars) {
    return [span];
  }
  if (level >= PDF_SPLIT_BREAKS.length) {
    return sliceSpanEvenly(source, span, maxChars);
  }
  return splitSpan(source, span, PDF_SPLIT_BREAKS[level]).flatMap((part) =>
    splitSpanToFit(source, part, level + 1, maxChars),
  );
}

/**
 * 이어진 조각을 순서대로 상한까지 채워 묶는다. 묶음은 첫 조각의 시작부터 마지막 조각의 끝까지의 구간이다.
 * 첫 묶음은 firstMaxChars 까지, 그 뒤의 묶음은 restMaxChars 까지 채운다.
 */
function packSpans(parts: TextSpan[], firstMaxChars: number, restMaxChars: number): TextSpan[] {
  const packed: TextSpan[] = [];
  for (const part of parts) {
    const last = packed[packed.length - 1];
    const maxChars = packed.length <= 1 ? firstMaxChars : restMaxChars;
    if (last && part.end - last.start <= maxChars) {
      last.end = part.end;
    } else {
      packed.push({ ...part });
    }
  }
  return packed;
}

/**
 * 뒤 청크의 앞에 다시 실을 앞 청크 끝부분이 어디에서 시작하는지 고른다.
 *
 * 뒤 청크의 본문(next)이 시작하는 자리에서 overlapChars 글자 안쪽, 앞 청크의 본문(previous) 안에서 찾는다.
 * 그 범위에서 가장 앞에 있는 줄의 처음을 고르고, 줄의 처음이 없으면 문장의 처음, 그것도 없으면 낱말의 처음을 고른다.
 * 낱말의 처음도 없으면 겹치지 않는다 (next.start 를 돌려준다). 앞 청크의 본문 전체를 다시 싣지는 않는다.
 */
function findOverlapStart(source: string, previous: TextSpan, next: TextSpan, overlapChars: number): number {
  const sentenceBreak = new RegExp(PDF_SENTENCE_BREAK.source, 'y');
  const earliest = Math.max(previous.start + 1, next.start - overlapChars);
  let sentenceStart: number | null = null;
  let wordStart: number | null = null;

  for (let position = earliest; position < previous.end; position += 1) {
    if (/\s/.test(source[position]) || !/\s/.test(source[position - 1])) {
      continue; // 공백 바로 뒤의 글자만 줄·문장·낱말의 처음이다
    }
    let gapStart = position - 1;
    while (gapStart > previous.start && /\s/.test(source[gapStart - 1])) gapStart -= 1;

    if (source.slice(gapStart, position).includes('\n')) {
      return position;
    }
    sentenceBreak.lastIndex = gapStart;
    if (sentenceStart === null && sentenceBreak.test(source)) {
      sentenceStart = position;
    }
    wordStart ??= position;
  }
  return sentenceStart ?? wordStart ?? next.start;
}

/**
 * 적용가이드 PDF 본문을 maxChars 글자 이하의 청크로 나눈다.
 *
 * - 문단(빈 줄로 나뉜 덩어리)을 순서대로 담다가 다음 문단이 들어가지 않으면 문단 경계에서 청크를 나눈다.
 *   한 청크에 들어가는 문단은 쪼개지 않는다.
 * - 한 청크에 들어가지 않는 긴 문단만 줄 경계에서 나눈다. 줄 하나가 길면 문장 경계에서, 문장도 길면 낱말 사이에서
 *   나누고, 공백이 없는 글자열만 글자 수로 자른다.
 * - 긴 문단의 조각도 문단과 같은 방법으로 담는다 (앞 청크에 자리가 남으면 거기부터 채운다). pdf-parse 가 뽑은
 *   본문은 쪽 하나가 문단 하나라서, 긴 문단을 새 청크에서 시작하면 쪽마다 몇 줄짜리 자투리 청크가 남는다.
 * - 둘째 청크부터는 앞 청크의 끝부분을 overlapChars 글자까지 앞에 다시 싣는다 (findOverlapStart). 겹침을 넣을
 *   자리를 남기려고 본문은 maxChars - overlapChars 글자까지만 담는다. 겹침은 maxChars 의 절반까지만 둔다.
 *
 * 청크는 공백을 정리한 본문(normalizePdfText)의 이어진 구간이다. 겹친 부분을 빼면 청크 사이에서 빠지는 것은 공백뿐이다.
 */
export function chunkPdfText(
  text: string,
  maxChars: number = PDF_CHUNK_MAX_CHARS,
  overlapChars: number = PDF_CHUNK_OVERLAP_CHARS,
): string[] {
  if (!Number.isFinite(maxChars) || maxChars < 1) {
    throw new RangeError('maxChars 는 1 이상의 수여야 합니다.');
  }
  if (!Number.isFinite(overlapChars) || overlapChars < 0) {
    throw new RangeError('overlapChars 는 0 이상의 수여야 합니다.');
  }
  const limit = Math.floor(maxChars);
  const overlap = Math.min(Math.floor(overlapChars), Math.floor(limit / 2));
  const bodyLimit = limit - overlap;
  const source = normalizePdfText(text);
  if (source === '') {
    return [];
  }

  const parts = splitSpan(source, { start: 0, end: source.length }, PDF_PARAGRAPH_BREAK).flatMap((paragraph) =>
    splitSpanToFit(source, paragraph, 0, bodyLimit),
  );
  // 첫 청크는 겹침을 싣지 않으므로 상한까지 본문으로 채운다
  const bodies = packSpans(parts, limit, bodyLimit);
  return bodies.map((body, index) => {
    const start = index > 0 && overlap > 0 ? findOverlapStart(source, bodies[index - 1], body, overlap) : body.start;
    return source.slice(start, body.end);
  });
}

/**
 * 적용가이드 PDF 청크의 제목: 파일 이름(확장자 제외)에 청크 번호를 붙인다.
 * macOS 의 파일 시스템은 한글 파일 이름을 자모가 분리된 NFD 로 돌려주므로 NFC 로 정규화한다.
 */
export function pdfChunkTitle(filePath: string, index: number, chunkCount: number): string {
  const baseTitle = path.basename(filePath, path.extname(filePath)).normalize('NFC');
  return `${baseTitle} (${index + 1}/${chunkCount})`;
}

/**
 * 적용가이드 PDF 에서 뽑은 본문을 청크로 나눠 개발자 지식 입력으로 만든다.
 * 제목의 순번과 metadata 의 chunkIndex, chunkCount 는 나눈 청크 수를 따른다.
 */
export function pdfTextToKnowledge(filePath: string, text: string): AddKnowledgeInput[] {
  const chunks = chunkPdfText(text);
  const sourceFile = path.relative(PROJECT_ROOT, filePath).normalize('NFC');

  return chunks.map((content, idx) => ({
    type: 'best-practice',
    title: pdfChunkTitle(filePath, idx, chunks.length),
    content,
    context: '표준프레임워크 적용가이드 PDF',
    tags: ['egovframe', 'developer_knowledge', 'guide', 'pdf'],
    relatedTo: ['egovframe', 'application-guide'],
    importance: 5,
    verified: true,
    metadata: {
      source: 'templates/developer_knowledge',
      sourceFile,
      sourceType: 'pdf',
      chunkIndex: idx + 1,
      chunkCount: chunks.length,
    },
  }));
}

/** 적용가이드 PDF 파일을 읽어 개발자 지식 입력으로 만든다. */
export async function readPdfKnowledge(filePath: string): Promise<AddKnowledgeInput[]> {
  const data = await fs.readFile(filePath);
  const parser = new PDFParse({ data });

  try {
    const result = await parser.getText();
    return pdfTextToKnowledge(filePath, result.text);
  } finally {
    await parser.destroy();
  }
}

async function indexDeveloperKnowledge(
  source: KnowledgePlan | null,
): Promise<DeveloperKnowledgeIndexStats | null> {
  console.error('\n📚 3/5 개발자 지식 벡터화 (LanceDB)...');

  if (!source) {
    console.warn('  ⚠️ 개발자 지식 소스 없음 — 스킵 (기존 인덱스 유지)');
    return null;
  }

  const knowledgeManager = new DeveloperKnowledgeManager(STAGING_DIR);
  await knowledgeManager.initialize();
  await knowledgeManager.clearAll();

  // 스냅샷 행 (프리플라이트에서 획득·검증 완료)
  const knowledgeItems: AddKnowledgeInput[] = source.rows.map(snapshotRowToKnowledgeInput);
  const excelItems = knowledgeItems.length;
  let pdfChunks = 0;

  // 적용가이드 PDF 는 스냅샷 스코프 밖 — 번들 템플릿에서 항상 적재
  if (await fs.pathExists(DEVELOPER_KNOWLEDGE_DIR)) {
    const entries = await fs.readdir(DEVELOPER_KNOWLEDGE_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.pdf')) {
        continue;
      }
      const items = await readPdfKnowledge(path.join(DEVELOPER_KNOWLEDGE_DIR, entry.name));
      knowledgeItems.push(...items);
      pdfChunks += items.length;
      console.error(`  ✓ PDF 로드: ${entry.name} (${items.length}개 청크)`);
    }
  }

  const BATCH_SIZE = 100;
  let totalIndexed = 0;

  for (let i = 0; i < knowledgeItems.length; i += BATCH_SIZE) {
    const batch = knowledgeItems.slice(i, Math.min(i + BATCH_SIZE, knowledgeItems.length));
    await knowledgeManager.addKnowledgeBatch(batch);
    totalIndexed += batch.length;
    console.error(`  진행률: ${totalIndexed}/${knowledgeItems.length} (${Math.round((totalIndexed / knowledgeItems.length) * 100)}%)`);
  }

  // 벡터 인덱스는 만들지 않는다: 검색은 항상 인덱스를 건너뛴 전수 검색이라 인덱스가 쓰이지 않는다
  await knowledgeManager.optimize();

  console.error(`  ✓ 개발자 지식 벡터화 완료: ${knowledgeItems.length}개`);
  return {
    totalItems: knowledgeItems.length,
    excelItems,
    pdfChunks,
  };
}

/**
 * 마크다운 파일 재귀 수집 (이미지/git/github 제외)
 */
/**
 * egovframe-docs 벡터화 (LanceDB) — 수집·청킹·임베딩은 kb/guideIndexer 공용 로직
 */
async function indexEgovframeDocs(guideDir: string | null): Promise<GuideIndexStats | null> {
  console.error('\n📚 4/5 eGovFrame 가이드 벡터화 (LanceDB)...');

  // 소스 확보/태그 선택은 프리플라이트에서 완료
  if (!guideDir) {
    console.error('  ⚠️ 가이드 소스 없음 — 스킵 (기존 인덱스 유지)');
    return null;
  }

  // GuideSearchManager 초기화 (스테이징 대상) 후 전량 재인덱싱
  const guideManager = new GuideSearchManager(STAGING_DIR);
  await guideManager.initialize();
  await guideManager.clearAll();

  const stats = await indexGuideDirectory(guideManager, guideDir);
  console.error(`  ✓ egovframe-docs 벡터화 완료: ${stats.totalFiles}개 파일 → ${stats.totalChunks}개 청크`);
  return stats;
}

// 스크립트 실행 — 이 파일이 직접 실행될 때만 (다른 스크립트가 import 할 때는 실행 안 됨)
if (process.argv[1] && process.argv[1] === __filename) {
  try {
    await buildIndex(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error('❌ 치명적 오류:', error);
    process.exit(1);
  }
}


