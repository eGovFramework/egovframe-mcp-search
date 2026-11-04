/**
 * update CLI — compatibility (SQLite) 갱신
 *
 * 릴리스 JSON(compatibility-software.json)을 검증한 뒤 오버레이 SQLite 사본에
 * deterministic 재적재한다(clear 후 insert). 적용 원본은 버전 디렉토리에
 * 보관되어 재베이스 치유·롤백의 기반이 된다.
 */

import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import { resolveResource, type ResourceState } from '../../utils/dataPaths.js';
import { synthesizeDatasetVersion } from '../../kb/snapshot.js';
import { SNAPSHOT_REPO, listRemoteVersionTags, compatibilityJsonUrls } from '../../kb/sources.js';
import { downloadToFile } from '../../utils/download.js';
import { SQLiteManager } from '../../database/sqliteManager.js';
import { loadCompatibilityFromJson, parseCompatibilityJson } from '../../kb/sqliteLoaders.js';
import { CLI_FILE, RESOURCE_LABELS, overlayResourceDir, type UpdateOptions } from '../shared.js';
import { ensureOverlaySqlite, reapplyStoredSqliteResources, commitSqliteResource } from './overlay.js';

export interface CompatibilityUpdateResult {
  version: string;
  rows: number;
}

export async function updateCompatibility(options: UpdateOptions): Promise<CompatibilityUpdateResult | 'skip'> {
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
