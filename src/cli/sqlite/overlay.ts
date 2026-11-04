/**
 * update CLI — 오버레이 SQLite 공용 (compatibility 등 SQLite 리소스)
 *
 * SQLite 리소스는 하나의 물리 DB(egovframe.db 오버레이 사본)에 적용된다.
 * 사본은 복사 시점의 번들 state.json generated_at 을 base 로 기록하며
 * (utils/dataPaths), 패키지 갱신으로 번들이 바뀌면 사본은 무효가 되어
 * 번들이 이긴다. 이 모듈은 사본 확보(재베이스)·보관 원본 재적용·state 기준
 * 전체 재구성(롤백·치유)을 담당한다.
 */

import fs from 'fs-extra';
import path from 'node:path';
import {
  getOverlayRoot,
  readOverlayState,
  readBundledState,
  getOverlaySqliteDir,
  getOverlaySqliteDbPath,
  writeOverlaySqliteBase,
  isOverlaySqliteValid,
  type ResourceName,
  type ResourceState,
  type StateFile,
} from '../../utils/dataPaths.js';
import { getKnowledgeBasePath } from '../../utils/projectPath.js';
import { SQLiteManager } from '../../database/sqliteManager.js';
import { loadCompatibilityFromJson } from '../../kb/sqliteLoaders.js';
import { CLI_FILE, commitResourceState, pruneOldVersions } from '../shared.js';

export const SQLITE_RESOURCES: ReadonlyArray<ResourceName> = ['compatibility'];

/** 오버레이 state 에 SQLite 리소스 적용분(보관 원본)이 하나라도 있는가 */
export function hasStoredSqliteResources(state: StateFile | null): boolean {
  return SQLITE_RESOURCES.some((r) => !!state?.resources[r]?.dir);
}

/**
 * 패키지 갱신으로 오버레이 SQLite 가 무효화되어 보관 적용분이 번들 폴백 중인가.
 * true 면 rebuildOverlaySqliteFromState 로 새 번들 위에 재적용해 치유한다.
 */
export function isOverlaySqliteStale(): boolean {
  return hasStoredSqliteResources(readOverlayState()) && !isOverlaySqliteValid(CLI_FILE);
}

/**
 * 오버레이 SQLite 사본을 확보한다. base 가 현재 번들과 일치하면 재사용,
 * 아니면 번들 DB 를 새로 복사(재베이스)한다 — 재베이스 시 호출자는
 * 반드시 reapplyStoredSqliteResources 로 다른 리소스 적용분을 복원해야 한다.
 */
export async function ensureOverlaySqlite(): Promise<{ dbPath: string; rebased: boolean }> {
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
  }
}

/** 재베이스 후 정합성 복원 — exclude 를 제외한 보관 적용분을 전부 재적용 */
export async function reapplyStoredSqliteResources(
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
export async function rebuildOverlaySqliteFromState(): Promise<void> {
  const hasAny = hasStoredSqliteResources(readOverlayState());
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
export async function commitSqliteResource(
  resource: ResourceName,
  versionDirRel: string,
  entry: ResourceState,
): Promise<void> {
  commitResourceState(resource, entry);
  await pruneOldVersions(resource, [versionDirRel, entry.previous_dir]);
}
