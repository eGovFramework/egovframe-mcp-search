/**
 * 리소스 단위 데이터 경로 해석 (오버레이 우선 → 번들 폴백)
 *
 * `npx egovframe-mcp-search update` 는 패키지 설치 디렉토리가 아니라
 * 사용자 데이터 디렉토리(오버레이)에 갱신분을 쓴다 — npm 재설치/업그레이드/
 * npx 캐시 정리에 갱신분이 소실되지 않도록.
 *
 * 해석 규칙 (리소스 단위):
 *   developer_knowledge.lance   오버레이 우선 → 번들 폴백
 *   egovframe_guide.lance       오버레이 우선 → 번들 폴백
 *   common-components-src/      오버레이 우선 → 번들 폴백
 *   egovframe.db (SQLite)       오버레이 우선 → 번들 폴백 — 단, 번들이 이긴다:
 *                               오버레이 사본은 복사 시점의 번들 state.json
 *                               generated_at 을 base 로 기록하며, 패키지 갱신으로
 *                               번들이 바뀌면 오버레이는 무효(번들 폴백)가 되고
 *                               다음 update 실행이 재베이스 + 재적용으로 치유한다
 *   models/                     번들 고정
 *
 * 오버레이가 유효하지 않으면(스키마/임베딩 모델 불일치, 마커 파일 부재 등)
 * 조용히 번들로 폴백한다 — 어떤 실패 조합에서도 검색 불능 상태를 만들지 않는다.
 *
 * 상태 기록(state.json)은 두 곳에 존재하고 리소스 단위로 병합된다:
 *   <패키지>/knowledge-base/state.json   build-index 가 기록 (불변)
 *   <오버레이>/state.json                update 가 기록 (가변, 원자 교체)
 */

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { findProjectRoot, getKnowledgeBasePath } from './projectPath.js';

/** state.json / 배포 산출물의 구조 버전 (호환성 검사 기준) */
export const SCHEMA_VERSION = 1;

/** 동봉 임베딩 모델 ID (임베더와 단일 출처 공유) */
export const EMBEDDING_MODEL_ID = 'Xenova/multilingual-e5-small';

export type ResourceName =
  | 'developer_knowledge'
  | 'guide'
  | 'common_components'
  | 'compatibility'
  | 'custom_terms';

/** 리소스별 유효성 판정 마커 (오버레이 디렉토리 안에 있어야 하는 파일/디렉토리) */
const RESOURCE_MARKERS: Record<ResourceName, string> = {
  developer_knowledge: 'developer_knowledge.lance',
  guide: 'egovframe_guide.lance',
  common_components: 'pom.xml',
  // SQLite 리소스의 버전 디렉토리는 적용 원본(artifact)을 보관하고,
  // update CLI 가 적용 요약(applied.json)을 함께 기록한다
  compatibility: 'applied.json',
  custom_terms: 'applied.json',
};

/** 벡터를 보유해 임베딩 모델과 결합되는 리소스 */
const VECTOR_RESOURCES: ReadonlySet<ResourceName> = new Set([
  'developer_knowledge',
  'guide',
]);

export interface ResourceState {
  /** 적용된 버전 (dataset_version 또는 git 태그) */
  version?: string;
  /** common_components 전용: 소스 트리 태그 (version 과 동일 의미, 별칭) */
  source_version?: string;
  /** common_components 전용: 동봉 common-components.json 의 메타 버전 */
  metadata_version?: string;
  /** 적용 시각 (ISO 8601) */
  applied_at?: string;
  /** 출처: 번들(build-index) / 릴리스 다운로드 / 반입 파일 / 사용자 지정 경로 */
  origin?: 'bundled' | 'release' | 'from-file' | 'user-path';
  /** 오버레이 전용: 오버레이 루트 기준 활성 버전 디렉토리 상대 경로 */
  dir?: string;
  /** 오버레이 전용: 직전 버전 디렉토리 상대 경로 (rollback 대상) */
  previous_dir?: string;
  /** 벡터 리소스 전용: 적용 당시 임베딩 모델 ID */
  embedding_model?: string;
  row_count?: number;
  chunk_count?: number;
  file_count?: number;
}

export interface StateFile {
  schema_version: number;
  embedding_model?: { id: string };
  generated_at?: string;
  resources: Partial<Record<ResourceName, ResourceState>>;
}

// ─── 오버레이 루트 ───────────────────────────────────────

/**
 * 사용자 데이터 디렉토리(오버레이) 루트.
 * EGOV_MCP_DATA_DIR 환경변수로 override 가능 (테스트/특수 환경용).
 */
export function getOverlayRoot(): string {
  const override = process.env.EGOV_MCP_DATA_DIR;
  if (override && override.trim() !== '') {
    return path.resolve(override);
  }

  const home = os.homedir();
  switch (process.platform) {
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', 'egovframe-mcp-search');
    case 'win32':
      return path.join(
        process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'),
        'egovframe-mcp-search',
      );
    default: {
      const xdg = process.env.XDG_DATA_HOME;
      const base = xdg && xdg.trim() !== '' ? xdg : path.join(home, '.local', 'share');
      return path.join(base, 'egovframe-mcp-search');
    }
  }
}

export function getOverlayStatePath(): string {
  return path.join(getOverlayRoot(), 'state.json');
}

export function getBundledStatePath(startPath?: string): string {
  return path.join(getKnowledgeBasePath(startPath), 'state.json');
}

// ─── state.json 읽기/쓰기 ────────────────────────────────

/** state.json 파싱. 없거나 손상이면 null (폴백 안전) */
export function readStateFile(filePath: string): StateFile | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as StateFile).schema_version !== 'number' ||
      typeof (parsed as StateFile).resources !== 'object' ||
      (parsed as StateFile).resources === null
    ) {
      return null;
    }
    return parsed as StateFile;
  } catch {
    return null;
  }
}

export function readOverlayState(): StateFile | null {
  return readStateFile(getOverlayStatePath());
}

export function readBundledState(startPath?: string): StateFile | null {
  return readStateFile(getBundledStatePath(startPath));
}

/**
 * 오버레이 state.json 을 원자적으로 교체 (temp-write + rename).
 * 리소스 하나만 바뀌어도 나머지 포인터는 그대로 유지된다.
 */
export function writeOverlayStateAtomic(state: StateFile): void {
  const statePath = getOverlayStatePath();
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const tmpPath = `${statePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmpPath, statePath);
}

// ─── 실효 상태 (리소스 단위 병합) ────────────────────────

export interface EffectiveResource {
  state: ResourceState | null;
  /** 실제 사용되는 쪽 */
  source: 'overlay' | 'bundled';
  /** 실효 데이터 디렉토리 (리소스별 의미: lance 연결 디렉토리 / 소스 루트) */
  dir: string;
}

/** 오버레이 항목이 이 리소스에 대해 유효한지 (마커·스키마·모델 검사) */
function isOverlayEntryValid(name: ResourceName, overlay: StateFile | null): overlay is StateFile {
  if (!overlay) return false;
  if (overlay.schema_version !== SCHEMA_VERSION) return false;

  const entry = overlay.resources[name];
  if (!entry || !entry.dir) return false;

  // 벡터 리소스는 적용 당시 모델이 현재 동봉 모델과 일치해야 한다
  if (VECTOR_RESOURCES.has(name) && entry.embedding_model !== EMBEDDING_MODEL_ID) {
    return false;
  }

  const dirAbs = path.join(getOverlayRoot(), entry.dir);
  const marker = path.join(dirAbs, RESOURCE_MARKERS[name]);
  return fs.existsSync(marker);
}

/** 리소스의 번들 측 데이터 디렉토리 */
function bundledDirFor(name: ResourceName, startPath?: string): string {
  if (name === 'common_components') {
    return path.join(findProjectRoot(startPath), 'templates', 'common-components-src');
  }
  if (name === 'compatibility') {
    return path.join(findProjectRoot(startPath), 'templates', 'compatibility');
  }
  if (name === 'custom_terms') {
    return path.join(findProjectRoot(startPath), 'templates', 'custom_terms');
  }
  // lance 리소스는 번들 knowledge-base 디렉토리에 연결 (테이블명으로 구분)
  return getKnowledgeBasePath(startPath);
}

/**
 * 리소스의 실효 상태·경로를 해석한다.
 * 오버레이가 유효하면 오버레이, 아니면 번들 (조용한 폴백).
 */
export function resolveResource(name: ResourceName, startPath?: string): EffectiveResource {
  const overlay = readOverlayState();

  if (isOverlayEntryValid(name, overlay)) {
    const entry = overlay.resources[name]!;
    return {
      state: entry,
      source: 'overlay',
      dir: path.join(getOverlayRoot(), entry.dir!),
    };
  }

  const bundled = readBundledState(startPath);
  return {
    state: bundled?.resources[name] ?? null,
    source: 'bundled',
    dir: bundledDirFor(name, startPath),
  };
}

// ─── SQLite 오버레이 (compatibility · custom_terms 공유) ─
//
// 두 SQLite 리소스는 하나의 물리 DB(egovframe.db 오버레이 사본)를 공유한다.
// 사본은 복사 시점의 번들 state.json generated_at 을 base.json 에 기록하며,
// 번들이 갱신되면(패키지 업그레이드) base 불일치 → 오버레이 무효 → 번들 폴백.
// 다음 update 실행이 새 번들을 재베이스하고 보관된 원본을 재적용해 치유한다.

export function getOverlaySqliteDir(): string {
  return path.join(getOverlayRoot(), 'sqlite');
}

export function getOverlaySqliteDbPath(): string {
  return path.join(getOverlaySqliteDir(), 'egovframe.db');
}

function getOverlaySqliteBasePath(): string {
  return path.join(getOverlaySqliteDir(), 'base.json');
}

export interface SqliteBaseInfo {
  /** 복사 원본이 된 번들 state.json 의 generated_at */
  bundled_generated_at: string;
}

export function readOverlaySqliteBase(): SqliteBaseInfo | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(getOverlaySqliteBasePath(), 'utf-8')) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as SqliteBaseInfo).bundled_generated_at !== 'string'
    ) {
      return null;
    }
    return parsed as SqliteBaseInfo;
  } catch {
    return null;
  }
}

export function writeOverlaySqliteBase(info: SqliteBaseInfo): void {
  fs.mkdirSync(getOverlaySqliteDir(), { recursive: true });
  fs.writeFileSync(getOverlaySqliteBasePath(), JSON.stringify(info, null, 2) + '\n', 'utf-8');
}

/** 오버레이 SQLite 가 현재 번들 기준으로 유효한가 (번들이 이기는 규칙) */
export function isOverlaySqliteValid(startPath?: string): boolean {
  if (!fs.existsSync(getOverlaySqliteDbPath())) return false;
  const base = readOverlaySqliteBase();
  if (!base) return false;
  const bundled = readBundledState(startPath);
  // 번들 state 가 없으면(구버전 패키지) 오버레이 SQLite 를 신뢰하지 않는다
  if (!bundled?.generated_at) return false;
  return bundled.generated_at === base.bundled_generated_at;
}

// ─── 런타임용 경로 해석기 ────────────────────────────────

/** developer_knowledge 테이블의 LanceDB 연결 디렉토리 */
export function resolveDeveloperKnowledgeDbDir(startPath?: string): string {
  return resolveResource('developer_knowledge', startPath).dir;
}

/** egovframe_guide 테이블의 LanceDB 연결 디렉토리 */
export function resolveGuideDbDir(startPath?: string): string {
  return resolveResource('guide', startPath).dir;
}

/** 공통컴포넌트 소스 트리 루트 */
export function resolveComponentsSrcRoot(startPath?: string): string {
  return resolveResource('common_components', startPath).dir;
}

/** SQLite DB 경로 — 오버레이 사본이 유효하면 오버레이, 아니면 번들 */
export function resolveSQLiteDbPath(startPath?: string): string {
  if (isOverlaySqliteValid(startPath)) {
    return getOverlaySqliteDbPath();
  }
  return path.join(getKnowledgeBasePath(startPath), 'egovframe.db');
}
