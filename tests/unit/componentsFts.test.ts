/**
 * components_fts (external-content FTS5) 드리프트 회귀 테스트
 *
 * INSERT OR REPLACE 는 recursive_triggers 가 OFF 면 암묵적 DELETE 에 대해
 * 삭제 트리거(components_ad)를 발화시키지 않아 FTS 인덱스에 옛 토큰이 남는다.
 * SQLiteManager 는 연결 시 recursive_triggers = ON 을 설정하고,
 * rebuildComponentsFts() 로 이미 드리프트한 인덱스를 치유할 수 있어야 한다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteManager } from '../../src/database/sqliteManager.js';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';

const COMPONENT = {
  component_id: 'fts-drift-test',
  name: '옛이름드리프트검사',
  name_en: 'FtsDriftProbeOld',
  category_id: 'cat-test',
  package_name: 'egovframework.com.test.fts',
  description: 'FTS 드리프트 회귀 테스트용 컴포넌트',
  description_en: null,
  use_tables: null,
  version: '1.0.0',
  has_web: false,
  added_options: null,
};

describe('components_fts drift', () => {
  let tmpDir: string;
  let sqlite: SQLiteManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'egov-fts-'));
    sqlite = new SQLiteManager(path.join(tmpDir, 'egovframe.db'));
    sqlite.addComponentCategoriesBatch([
      { category_id: 'cat-test', name: '테스트카테고리', name_en: null, description: null, description_en: null },
    ]);
  });

  afterEach(async () => {
    sqlite.close();
    await fs.remove(tmpDir);
  });

  /** 내부 better-sqlite3 인스턴스로 FTS 인덱스만 직접 조회 (content 테이블 JOIN 배제) */
  function ftsMatchCount(token: string): number {
    const db = (sqlite as any).db;
    const row = db
      .prepare(`SELECT count(*) AS cnt FROM components_fts WHERE components_fts MATCH ?`)
      .get(token) as { cnt: number };
    return row.cnt;
  }

  it('INSERT OR REPLACE 갱신 후 옛 토큰이 FTS 인덱스에 남지 않는다', () => {
    sqlite.addCommonComponentsBatch([COMPONENT]);
    expect(ftsMatchCount('옛이름드리프트검사')).toBe(1);

    // 같은 component_id(UNIQUE) 재적재 → INSERT OR REPLACE 가 암묵적 DELETE 수행
    sqlite.addCommonComponentsBatch([
      { ...COMPONENT, name: '새이름드리프트검사', name_en: 'FtsDriftProbeNew' },
    ]);

    expect(ftsMatchCount('새이름드리프트검사')).toBe(1);
    // recursive_triggers = ON 이므로 암묵적 DELETE 에서도 components_ad 가 발화해야 한다
    expect(ftsMatchCount('옛이름드리프트검사')).toBe(0);
  });

  it('rebuildComponentsFts() 가 이미 드리프트한 인덱스를 치유한다', () => {
    sqlite.addCommonComponentsBatch([COMPONENT]);

    // 과거 연결이 남긴 드리프트를 재현: content 테이블에 없는 rowid 의 유령 토큰 주입
    const db = (sqlite as any).db;
    db.prepare(
      `INSERT INTO components_fts(rowid, name, name_en, description, description_en, package_name)
       VALUES (999999, '유령토큰검사', 'GhostToken', '', '', '')`,
    ).run();
    expect(ftsMatchCount('유령토큰검사')).toBe(1);

    sqlite.rebuildComponentsFts();

    expect(ftsMatchCount('유령토큰검사')).toBe(0);
    expect(ftsMatchCount('옛이름드리프트검사')).toBe(1);
  });
});
