/**
 * templates/ 하위 외부 소스 저장소(egovframe-docs, egovframe-common-components)
 * 확보/최신화 로직.
 *
 * 갱신 기준: 사용자 태그 선택 (인터랙티브).
 * 저장소 차례가 되면 최신 버전 태그 목록(최대 10개)과 현재 적용 태그를 selectTag 콜백에
 * 넘긴다. 콜백이 '' 또는 현재 태그명을 반환하면 체크아웃을 유지하고, 다른 태그명을
 * 반환하면 그 태그의 소스를 체크아웃한다. 콜백이 없으면(비대화형) 어떤 경우에도
 * 현재 상태를 유지한다 (빌드 재현성). 버전 태그가 하나도 없는 원격이면 대화형에
 * 한해 브랜치 최신 커밋으로 폴백한다 (fast-forward 만 허용).
 *
 * 체크아웃 형태에 따라 소스 확보 방법이 다르다:
 * - 서브모듈 체크아웃 (.git 이 파일)    → 그대로 태그 선택 진행
 * - 독립 클론 (.git 이 디렉터리)        → 그대로 태그 선택 진행
 * - 파일만 존재 (tgz 배포본 등)         → 갱신 없이 그대로 사용 (태그 선택 없음)
 * - 미체크아웃 + .gitmodules 등록       → submodule update --init 후 태그 선택
 * - 미체크아웃 + 미등록                 → git clone --depth 1 후 태그 선택
 *
 * 갱신 실패(오프라인 등)는 build-index 전체를 중단시키지 않는다 —
 * 기존 파일이 있으면 경고 후 그대로 진행한다.
 */

import fs from 'fs-extra';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 프로젝트 루트 경로 (build/scripts/templateSources.js -> project root)
const PROJECT_ROOT = path.resolve(__dirname, '../..');
export const EGOVDOCS_DIR = path.join(PROJECT_ROOT, 'templates', 'egovframe_guide');
export const EGOVDOCS_REPO = 'https://github.com/egovframework/egovframe-docs.git';
export const COMPONENTS_SRC_DIR = path.join(PROJECT_ROOT, 'templates', 'common-components-src');
export const COMPONENTS_SRC_REPO = 'https://github.com/eGovFramework/egovframe-common-components.git';

/** 태그 선택 프롬프트에 보여줄 최신 태그 개수 */
const LATEST_TAG_DISPLAY_COUNT = 10;

export type TemplateSourceStrategy =
  | 'submodule-update'
  | 'submodule-init'
  | 'pull'
  | 'use-as-is'
  | 'clone';

/** 태그 선택 콜백에 전달되는 컨텍스트 */
export interface TagSelectionContext {
  /** 저장소 표시명 (예: egovframe-docs) */
  label: string;
  /** 버전순 정렬된 최신 버전 태그 (최대 10개) */
  latestTags: string[];
  /** 존재하는 모든 태그 (입력 검증용) */
  allTags: string[];
  /** 현재 HEAD 에 정확히 일치하는 태그 (태그 위가 아니면 null) */
  currentTag: string | null;
  /** 현재 HEAD 의 describe 결과 (태그 위가 아닐 때 참고용, 예: v5.0.0-2-g24e8b3e) */
  currentDescription: string;
  /** 원격 태그 fetch 실패 여부 (true 면 로컬 태그 기준) */
  fetchFailed: boolean;
}

/**
 * 태그 선택 콜백. '' 또는 현재 태그명을 반환하면 유지, 다른 태그명이면 해당 태그 체크아웃.
 * (buildIndex 가 터미널 프롬프트 구현을 주입하고, 비대화형에서는 주입하지 않는다)
 */
export type TagSelector = (ctx: TagSelectionContext) => Promise<string>;

/**
 * 사용자가 태그 선택 프롬프트에서 build-index 전체를 중단한 경우 (Ctrl+C).
 * applyTagSelection 의 방어적 catch 에 삼켜지지 않고 호출자까지 전파되어야 한다.
 */
export class TagSelectionAbortedError extends Error {
  constructor(message = '사용자가 태그 선택에서 build-index 를 중단했습니다') {
    super(message);
    this.name = 'TagSelectionAbortedError';
  }
}

/**
 * 태그 선택 입력 루프 (UI 스트림 비의존 — ask 주입으로 단위 테스트 가능).
 *
 * - 빈 입력(엔터) 또는 현재 태그명 → '' (현재 체크아웃 유지)
 * - 존재하는 태그명 → 그 태그명 반환 (표시 목록 밖이라도 allTags 에 있으면 수락)
 * - 없는 태그명 → 경고 후 재입력 요청
 * - ask 가 던진 TagSelectionAbortedError 는 그대로 전파
 */
export async function runTagSelectionPrompt(
  ctx: TagSelectionContext,
  ask: (question: string) => Promise<string>,
): Promise<string> {
  while (true) {
    const answer = (await ask('     적용할 태그명 입력 (엔터 = 현재 유지): ')).trim();
    if (answer === '' || answer === ctx.currentTag) {
      return '';
    }
    if (ctx.allTags.includes(answer)) {
      return answer;
    }
    console.error(`     ⚠️ '${answer}' 태그가 없습니다. 목록의 태그명을 입력하거나 엔터로 유지하세요.`);
  }
}

/**
 * git 무인 실행 환경.
 * stdio: 'pipe' 상태에서 자격증명 프롬프트가 뜨면 영원히 행이 걸리므로
 * 프롬프트를 전면 차단한다 — 인증이 필요한 원격은 즉시 실패하고, 그 실패는
 * 기존 fetchFailed(오프라인 폴백) 경로로 흡수된다. timeout 은 최후 방어선.
 */
function gitNonInteractiveEnv(): NodeJS.ProcessEnv {
  // 호출 시점의 process.env 를 기준으로 조립한다 (테스트 등 런타임 env 변경 반영)
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: 'echo',
    GCM_INTERACTIVE: 'never',
  };
}
const GIT_TIMEOUT_MS = 120_000;

/** 셸 미경유 git 실행 (사용자 입력이 아닌 내부 상수/검증된 인자만 전달) */
export function runGit(args: string[], cwd?: string): void {
  execFileSync('git', args, {
    cwd,
    stdio: 'pipe',
    env: gitNonInteractiveEnv(),
    timeout: GIT_TIMEOUT_MS,
  });
}

/** 셸 미경유 git 실행 + stdout 반환 */
export function runGitCapture(args: string[], cwd?: string): string {
  return execFileSync('git', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf-8',
    env: gitNonInteractiveEnv(),
    timeout: GIT_TIMEOUT_MS,
  });
}

/** posix 구분자로 정규화한 프로젝트 루트 기준 상대 경로 */
function relativeSourcePath(sourceDir: string, projectRoot: string): string {
  return path.relative(projectRoot, sourceDir).split(path.sep).join('/');
}

/**
 * 버전순(-v:refname) 정렬 목록에서 "버전 형태" 태그만 순서를 유지하며 골라낸다.
 * 접미사가 붙은 태그(v5.0.0-ready-2026-contribution)와 v 없는 태그(5.0.6)도 인식한다.
 */
export function filterVersionTags(sortedTags: string[]): string[] {
  const VERSION_TAG = /^v?\d+(\.\d+)*([-.].+)?$/;
  return sortedTags.map(t => t.trim()).filter(t => VERSION_TAG.test(t));
}

/** 로컬에 존재하는 모든 태그를 버전순(-v:refname 내림차순)으로 반환 */
function listLocalTagsSorted(sourceDir: string): string[] {
  return runGitCapture(['tag', '--list', '--sort=-v:refname'], sourceDir)
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
}

/** 현재 HEAD 에 정확히 일치하는 태그 (없으면 null) */
function describeExactTag(sourceDir: string): string | null {
  try {
    return runGitCapture(['describe', '--tags', '--exact-match', 'HEAD'], sourceDir).trim() || null;
  } catch {
    return null;
  }
}

/** 현재 HEAD 의 사람 친화 설명 (가까운 태그 기준, 태그가 없으면 커밋 해시) */
function describeHead(sourceDir: string): string {
  try {
    return runGitCapture(['describe', '--tags', '--always', 'HEAD'], sourceDir).trim();
  } catch {
    return '(알 수 없음)';
  }
}

/**
 * 소스 체크아웃의 사람 친화 버전 표기 (state.json 기록용).
 * 정확히 태그 위면 그 태그, 아니면 describe 결과, git 정보가 없으면 null.
 *
 * sourceDir 자체가 저장소(독립 클론)나 서브모듈 체크아웃일 때만 답한다. 자기 .git 이 없는 디렉토리(반입한
 * 소스, 복사본)에서 git 을 실행하면 바깥 저장소를 찾아 올라가 그 저장소의 버전을 돌려주므로, 그런 디렉토리는
 * git 정보가 없는 것으로 본다.
 */
export function describeSourceVersion(sourceDir: string): string | null {
  if (!fs.existsSync(path.join(sourceDir, '.git'))) {
    return null;
  }
  try {
    return describeExactTag(sourceDir) ?? describeHead(sourceDir);
  } catch {
    return null;
  }
}

/** 태그 커밋으로 detached checkout (서브모듈은 원래 detached 가 정상 상태) */
function checkoutTag(sourceDir: string, tag: string): void {
  runGit(['checkout', '--detach', `refs/tags/${tag}`], sourceDir);
}

/** .gitmodules 에 해당 경로가 서브모듈로 등록되어 있는지 확인 */
async function isRegisteredSubmodule(sourceDir: string, projectRoot: string): Promise<boolean> {
  const gitmodulesPath = path.join(projectRoot, '.gitmodules');
  if (!await fs.pathExists(gitmodulesPath)) return false;

  const relPath = relativeSourcePath(sourceDir, projectRoot);
  const content = await fs.readFile(gitmodulesPath, 'utf-8');
  return content.split('\n').some(line => {
    const match = line.trim().match(/^path\s*=\s*(.+)$/);
    return match !== null && match[1].trim() === relPath;
  });
}

/**
 * 체크아웃 형태를 감지해 갱신 전략을 결정한다.
 * @param markerFile 원본 존재 판정 기준 파일 (docs: _index.md, components: pom.xml)
 */
export async function resolveSourceStrategy(
  sourceDir: string,
  projectRoot: string,
  markerFile: string,
): Promise<TemplateSourceStrategy> {
  if (await fs.pathExists(path.join(sourceDir, markerFile))) {
    const gitPath = path.join(sourceDir, '.git');
    try {
      const stat = await fs.stat(gitPath);
      // 서브모듈 체크아웃은 .git 이 "gitdir: ..." 내용의 파일, 독립 클론은 디렉터리
      return stat.isFile() ? 'submodule-update' : 'pull';
    } catch {
      return 'use-as-is';
    }
  }

  return await isRegisteredSubmodule(sourceDir, projectRoot) ? 'submodule-init' : 'clone';
}

interface TemplateSourceOptions {
  sourceDir: string;
  projectRoot: string;
  repoUrl: string;
  markerFile: string;
  label: string;
  selectTag?: TagSelector;
}

/**
 * 태그 선택 흐름을 수행한다 (git 체크아웃이 존재하는 상태에서 호출).
 *
 * 1. 원격 태그 fetch (실패 시 로컬 태그 기준으로 계속)
 * 2. 버전 태그가 하나도 없으면 → 브랜치 최신 폴백 (submodule/pull)
 * 3. selectTag 콜백 호출 — '' 또는 현재 태그면 유지, 다른 태그면 checkout
 *
 * 어떤 실패도 밖으로 던지지 않는다 (기존 체크아웃 유지가 항상 안전한 결과).
 */
async function applyTagSelection(
  strategy: 'submodule-update' | 'pull',
  opts: TemplateSourceOptions,
  shallowFetch: boolean,
): Promise<void> {
  const { sourceDir, projectRoot, label, selectTag } = opts;

  let fetchFailed = false;
  try {
    const fetchArgs = ['fetch', '--tags', '--force'];
    if (shallowFetch) fetchArgs.push('--depth', '1');
    fetchArgs.push('origin');
    runGit(fetchArgs, sourceDir);
  } catch {
    fetchFailed = true;
    console.error(`  ⚠️ ${label}: 원격 태그 fetch 실패 (오프라인 환경일 수 있음) — 로컬 태그 기준으로 진행`);
  }

  try {
    const allTags = listLocalTagsSorted(sourceDir);
    const latestTags = filterVersionTags(allTags).slice(0, LATEST_TAG_DISPLAY_COUNT);
    const currentTag = describeExactTag(sourceDir);
    const currentDescription = describeHead(sourceDir);

    // 비대화형(--yes / non-TTY): 어떤 경우에도 현재 체크아웃 유지 (빌드 재현성)
    if (!selectTag) {
      console.error(`  ✓ ${label}: 비대화형 실행 — 현재 체크아웃 유지 (${currentTag ?? currentDescription})`);
      return;
    }

    // 버전 태그가 전혀 없는 원격 — 선택할 것이 없으므로 브랜치 최신으로 폴백
    if (latestTags.length === 0) {
      if (fetchFailed) {
        console.error(`  ⚠️ ${label}: 태그 정보 없음 + 원격 접근 불가 — 기존 파일 사용`);
        return;
      }
      if (strategy === 'submodule-update') {
        runGit(
          ['submodule', 'update', '--remote', '--', relativeSourcePath(sourceDir, projectRoot)],
          projectRoot,
        );
      } else {
        // --ff-only: non-fast-forward 면 워킹트리 변경 없이 원자적으로 실패한다
        // (--rebase 는 실패 시 mid-rebase 충돌 상태를 남겨 이후 실행을 고착시킴)
        runGit(['pull', '--ff-only'], sourceDir);
      }
      console.error(`  ✓ ${label}: 버전 태그 없음 — 원격 브랜치 최신 커밋으로 갱신 완료`);
      return;
    }

    const chosen = (await selectTag({
      label,
      latestTags,
      allTags,
      currentTag,
      currentDescription,
      fetchFailed,
    })).trim();

    if (chosen === '' || chosen === currentTag) {
      console.error(`  ✓ ${label}: 현재 체크아웃 유지 (${currentTag ?? currentDescription})`);
      return;
    }

    if (!allTags.includes(chosen)) {
      console.error(`  ⚠️ ${label}: '${chosen}' 태그를 찾을 수 없어 현재 체크아웃을 유지합니다.`);
      return;
    }

    checkoutTag(sourceDir, chosen);
    console.error(`  ✓ ${label}: 태그 ${chosen} 체크아웃 완료`);
    if (strategy === 'submodule-update') {
      console.error('    (gitlink 가 변경되었다면 재생성한 인덱스와 함께 커밋하세요)');
    }
  } catch (error) {
    // 사용자 중단(Ctrl+C)은 '기존 체크아웃 유지' 로 뭉개면 안 된다 — build-index 전체 중단
    if (error instanceof TagSelectionAbortedError) {
      throw error;
    }
    console.error(`  ⚠️ ${label}: 태그 적용 실패 — 기존 체크아웃 그대로 사용`);
  }
}

/**
 * 템플릿 소스 저장소를 확보하고 태그 선택 흐름을 수행한다.
 * @returns 사용 가능한 상태면 true (원본 존재), 확보 실패면 false
 */
export async function ensureTemplateSource(opts: TemplateSourceOptions): Promise<boolean> {
  const { sourceDir, projectRoot, repoUrl, markerFile, label } = opts;
  const strategy = await resolveSourceStrategy(sourceDir, projectRoot, markerFile);
  const relPath = relativeSourcePath(sourceDir, projectRoot);

  switch (strategy) {
    case 'submodule-update':
    case 'pull':
      console.error(`  📂 기존 ${label} 체크아웃 감지 (${strategy === 'submodule-update' ? '서브모듈' : '독립 클론'})`);
      await applyTagSelection(strategy, opts, false);
      return true;

    case 'use-as-is':
      console.error(`  📂 git 정보 없는 ${label} 감지 (배포본), 동봉된 파일 그대로 사용`);
      return true;

    case 'submodule-init':
      console.error(`  📥 ${label} 서브모듈 초기화 중...`);
      try {
        runGit(['submodule', 'update', '--init', '--', relPath], projectRoot);
      } catch {
        console.error(`  ❌ ${label} 서브모듈 초기화 실패 (오프라인 환경일 수 있음)`);
        console.error('  💡 수동으로 초기화하세요:');
        console.error(`     git submodule update --init -- ${relPath}`);
        return false;
      }
      // 초기화된 체크아웃도 서브모듈이므로 같은 태그 선택 흐름 적용
      await applyTagSelection('submodule-update', opts, false);
      if (!await fs.pathExists(path.join(sourceDir, markerFile))) {
        console.error(`  ❌ 서브모듈 초기화 후에도 ${label} 원본을 찾을 수 없습니다.`);
        return false;
      }
      console.error(`  ✓ ${label} 서브모듈 초기화 완료`);
      return true;

    case 'clone':
      console.error(`  📥 ${label} 클론 중: ${repoUrl}`);
      try {
        runGit(['clone', '--depth', '1', repoUrl, sourceDir]);
        console.error('  ✓ 클론 완료');
      } catch {
        console.error(`  ❌ ${label} 클론 실패`);
        console.error('  💡 수동으로 클론하세요:');
        console.error(`     git clone --depth 1 ${repoUrl} ${relPath}`);
        return false;
      }
      // 얕은 클론이므로 태그도 얕게 fetch (클론 결과는 독립 클론 = pull 계열)
      await applyTagSelection('pull', opts, true);
      return true;
  }
}

/** ensureEgovframeDocs / ensureCommonComponentsSrc 공통 오버라이드 (테스트/특수 환경용) */
export interface EnsureSourceOverrides {
  sourceDir?: string;
  projectRoot?: string;
  repoUrl?: string;
  selectTag?: TagSelector;
}

/** egovframe-docs (templates/egovframe_guide) 확보/태그 선택 */
export async function ensureEgovframeDocs(overrides: EnsureSourceOverrides = {}): Promise<boolean> {
  return ensureTemplateSource({
    sourceDir: overrides.sourceDir ?? EGOVDOCS_DIR,
    projectRoot: overrides.projectRoot ?? PROJECT_ROOT,
    repoUrl: overrides.repoUrl ?? EGOVDOCS_REPO,
    markerFile: '_index.md',
    label: 'egovframe-docs',
    selectTag: overrides.selectTag,
  });
}

/** egovframe-common-components (templates/common-components-src) 확보/태그 선택 */
export async function ensureCommonComponentsSrc(overrides: EnsureSourceOverrides = {}): Promise<boolean> {
  return ensureTemplateSource({
    sourceDir: overrides.sourceDir ?? COMPONENTS_SRC_DIR,
    projectRoot: overrides.projectRoot ?? PROJECT_ROOT,
    repoUrl: overrides.repoUrl ?? COMPONENTS_SRC_REPO,
    markerFile: 'pom.xml',
    label: 'egovframe-common-components',
    selectTag: overrides.selectTag,
  });
}
