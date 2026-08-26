/**
 * compatibility_fts (external-content FTS5) 드리프트 회귀 테스트
 *
 * components_fts 와 동일한 결함 패턴 — 일반 DELETE 문 트리거는 AFTER DELETE
 * 시점에 content 행이 이미 없어 인덱스 토큰을 제거하지 못한다. 'delete'
 * 특수 커맨드 트리거와 rebuildCompatibilityFts() 를 검증한다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteManager } from '../../src/database/sqliteManager.js';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';

const SOFTWARE = {
  product_name: '옛제품드리프트검사',
  product_version: '1.0',
  framework_version: '4.3',
  category: 'WAS',
  compatibility_level: 1 as const,
  vendor: '테스트벤더',
  verified_date: '2026-01-01',
  description: 'FTS 드리프트 회귀 테스트',
  url: undefined,
};

describe('compatibility_fts drift', () => {
  let tmpDir: string;
  let sqlite: SQLiteManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'egov-compat-fts-'));
    sqlite = new SQLiteManager(path.join(tmpDir, 'egovframe.db'));
  });

  afterEach(async () => {
    sqlite.close();
    await fs.remove(tmpDir);
  });

  function ftsMatchCount(token: string): number {
    const db = (sqlite as any).db;
    const row = db
      .prepare(`SELECT count(*) AS cnt FROM compatibility_fts WHERE compatibility_fts MATCH ?`)
      .get(token) as { cnt: number };
    return row.cnt;
  }

  it('UNIQUE 충돌 REPLACE 갱신 후 옛 토큰이 FTS 인덱스에 남지 않는다', () => {
    sqlite.addCompatibilitySoftwareBatch([SOFTWARE]);
    expect(ftsMatchCount('옛제품드리프트검사')).toBe(1);

    // 같은 (product_name, product_version, framework_version)... 은 이름이 키의
    // 일부라 벤더 변경으로 REPLACE 를 유도한다 — 동일 키 재적재
    sqlite.addCompatibilitySoftwareBatch([{ ...SOFTWARE, vendor: '새벤더드리프트검사' }]);

    expect(ftsMatchCount('새벤더드리프트검사')).toBe(1);
    expect(ftsMatchCount('테스트벤더')).toBe(0);
  });

  it('clearCompatibilitySoftware 후 인덱스도 함께 비워진다', () => {
    sqlite.addCompatibilitySoftwareBatch([SOFTWARE]);
    sqlite.clearCompatibilitySoftware();
    expect(ftsMatchCount('옛제품드리프트검사')).toBe(0);
  });

  it('rebuildCompatibilityFts() 가 이미 드리프트한 인덱스를 치유한다', () => {
    sqlite.addCompatibilitySoftwareBatch([SOFTWARE]);

    const db = (sqlite as any).db;
    db.prepare(
      `INSERT INTO compatibility_fts(rowid, product_name, vendor, category, description)
       VALUES (999999, '유령제품검사', 'GhostVendor', '', '')`,
    ).run();
    expect(ftsMatchCount('유령제품검사')).toBe(1);

    sqlite.rebuildCompatibilityFts();

    expect(ftsMatchCount('유령제품검사')).toBe(0);
    expect(ftsMatchCount('옛제품드리프트검사')).toBe(1);
  });
});
