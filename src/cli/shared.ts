/**
 * update CLI 공통 기반
 *
 * 뼈대(update.ts)와 리소스별 갱신 모듈(lancedb/, sqlite/)이 함께 쓰는
 * 옵션 타입·리소스 라벨·오버레이 버전 디렉토리 헬퍼를 모아 둔다.
 * 리소스 모듈이 update.ts 를 역으로 import 하지 않도록(순환 참조 방지)
 * 별도 모듈로 분리했다.
 */

import fs from 'fs-extra';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SCHEMA_VERSION,
  EMBEDDING_MODEL_ID,
  getOverlayRoot,
  readOverlayState,
  writeOverlayStateAtomic,
  type ResourceName,
  type ResourceState,
  type StateFile,
} from '../utils/dataPaths.js';

// 번들(패키지) 경로 해석 기준 — cwd 가 아니라 이 모듈의 설치 위치.
// npx 를 임의 디렉토리에서 실행해도 번들 knowledge-base 를 정확히 찾는다
// (findProjectRoot 가 package.json 이 있는 상위 디렉토리까지 탐색).
export const CLI_FILE = fileURLToPath(import.meta.url);

// ─── 옵션 ────────────────────────────────────────────────

export interface UpdateOptions {
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

// ─── 리소스 라벨 ─────────────────────────────────────────

export const RESOURCE_LABELS: Record<ResourceName, string> = {
  developer_knowledge: '개발자 지식(Q&A/FAQ)',
  guide: '가이드',
  common_components: '공통컴포넌트',
  compatibility: '호환성 SW',
};

// ─── 오버레이 버전 디렉토리 헬퍼 ─────────────────────────

export function sanitizeVersionDirName(version: string): string {
  return `v-${version.replace(/[^A-Za-z0-9._-]+/g, '-')}`;
}

export function overlayResourceDir(resource: ResourceName, version: string): {
  abs: string;
  rel: string;
} {
  const rel = path.join('resources', resource, sanitizeVersionDirName(version));
  return { abs: path.join(getOverlayRoot(), rel), rel };
}

/** 오버레이 state 에 리소스 항목을 반영하고 원자 교체로 기록 */
export function commitResourceState(resource: ResourceName, entry: ResourceState): void {
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
export async function pruneOldVersions(resource: ResourceName, keepRel: Array<string | undefined>): Promise<void> {
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
