/**
 * SQLite 적재 공용 로직(kb/sqliteLoaders) 단위 테스트
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import { SQLiteManager } from '../../src/database/sqliteManager.js';
import {
  parseCompatibilityJson,
  loadCompatibilityFromJson,
  reloadCustomDictionaries,
} from '../../src/kb/sqliteLoaders.js';

const COMPAT_ROW = {
  product_name: '테스트WAS',
  product_version: '10.1',
  framework_version: '4.3',
  category: 'WAS',
  compatibility_level: 1,
  vendor: '테스트벤더',
  verified_date: '2026-01-01',
  description: null,
  url: null,
};

describe('sqliteLoaders', () => {
  let tmpDir: string;
  let sqlite: SQLiteManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'egov-loaders-'));
    sqlite = new SQLiteManager(path.join(tmpDir, 'egovframe.db'));
  });

  afterEach(async () => {
    sqlite.close();
    await fs.remove(tmpDir);
  });

  function count(table: string): number {
    return ((sqlite as any).db.prepare(`SELECT count(*) AS c FROM ${table}`).get() as { c: number }).c;
  }

  describe('호환성 SW (JSON)', () => {
    it('JSON 을 검증·적재하고 재적재 시 삭제 행이 남지 않는다', async () => {
      const jsonPath = path.join(tmpDir, 'compatibility-software.json');
      await fs.writeJSON(jsonPath, [COMPAT_ROW, { ...COMPAT_ROW, product_name: '지워질제품' }]);
      expect(await loadCompatibilityFromJson(sqlite, jsonPath)).toBe(2);
      expect(count('compatibility_software')).toBe(2);

      // 원본에서 한 행이 사라진 새 JSON 으로 재적재 → deterministic replace
      await fs.writeJSON(jsonPath, [COMPAT_ROW]);
      expect(await loadCompatibilityFromJson(sqlite, jsonPath)).toBe(1);
      expect(count('compatibility_software')).toBe(1);
    });

    it('배열이 아니면 거부한다', async () => {
      const jsonPath = path.join(tmpDir, 'bad.json');
      await fs.writeJSON(jsonPath, { rows: [] });
      await expect(parseCompatibilityJson(jsonPath)).rejects.toThrow(/배열이 아닙니다/);
    });

    it('필수 필드가 빠진 항목을 줄 번호와 함께 거부한다', async () => {
      const jsonPath = path.join(tmpDir, 'bad-row.json');
      await fs.writeJSON(jsonPath, [COMPAT_ROW, { product_name: '' }]);
      await expect(parseCompatibilityJson(jsonPath)).rejects.toThrow(/2번째 항목/);
    });
  });

  describe('기관 Custom 사전 (CSV)', () => {
    it('3종 CSV 를 clear 후 재적재한다 (폐기 행 제외)', async () => {
      const dir = path.join(tmpDir, 'custom_terms');
      await fs.outputFile(
        path.join(dir, 'custom_standard_terms.csv'),
        '공통표준용어명,공통표준용어영문약어명,공통표준도메인명,제정차수\n' +
        '기관용어,ORG_TERM,명V100,1차\n' +
        '폐기용어,DEAD_TERM,명V100,2차(폐기)\n',
      );
      await fs.outputFile(
        path.join(dir, 'custom_standard_words.csv'),
        '공통표준단어명,공통표준단어영문약어명\n기관,ORG\n',
      );
      await fs.outputFile(
        path.join(dir, 'custom_standard_domains.csv'),
        '공통표준도메인명,데이터타입,데이터길이\n명V100,VARCHAR,100\n',
      );

      const counts = await reloadCustomDictionaries(sqlite, dir);
      expect(counts).toEqual({ terms: 1, words: 1, domains: 1 });
      expect(count('custom_terms')).toBe(1);

      // 빈 디렉토리로 재적재 → 전부 비워짐 (clear 후 로드 없음)
      const emptyDir = path.join(tmpDir, 'empty');
      await fs.ensureDir(emptyDir);
      const counts2 = await reloadCustomDictionaries(sqlite, emptyDir);
      expect(counts2).toEqual({ terms: 0, words: 0, domains: 0 });
      expect(count('custom_terms')).toBe(0);
    });
  });
});
