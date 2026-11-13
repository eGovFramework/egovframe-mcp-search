/**
 * SQLite 적재 공용 로직(kb/sqliteLoaders) 단위 테스트
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import { SQLiteManager } from '../../src/database/sqliteManager.js';
import {
  parseCompatibilityJson,
  loadCompatibilityFromJson,
  loadCommonComponentsFromJson,
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

  describe('공통컴포넌트 (JSON)', () => {
    const component = (id: string, name: string, packageName: string, extra: Record<string, unknown> = {}) => ({
      id,
      name,
      nameEn: name,
      categoryId: 'cat-a',
      categoryName: '분류A',
      packageName,
      description: `${name} 설명`,
      descriptionEn: '',
      dependencies: [],
      useTables: [],
      version: '4.3.1',
      hasWeb: true,
      addedOptions: '',
      ...extra,
    });

    const meta = (components: unknown[]) => ({
      version: '5.0.0',
      totalCategories: 1,
      totalComponents: components.length,
      categories: [{ id: 'cat-a', name: '분류A', nameEn: 'Category A', description: '', descriptionEn: '', components: [] }],
      components,
    });

    async function writeMeta(components: unknown[]): Promise<string> {
      const jsonPath = path.join(tmpDir, 'common-components.json');
      await fs.writeJSON(jsonPath, meta(components));
      return jsonPath;
    }

    it('id 가 겹치는 컴포넌트도 빠짐없이 적재하고 바뀐 id 를 알려 준다', async () => {
      const jsonPath = await writeMeta([
        component('bbs', '게시판', 'egovframework.com.cop.bbs', { nameEn: 'BBS' }),
        component('bbs', '블로그관리', 'egovframework.com.cop.bbs', { nameEn: 'Blog Management' }),
        component('sim', '일정관리', 'egovframework.com.cop.smt.sim'),
        component('sim', '시스템정보확인', 'egovframework.com.utl.sim'),
      ]);

      const result = await loadCommonComponentsFromJson(sqlite, jsonPath);

      expect(result.components).toBe(4);
      expect(count('common_components')).toBe(4);
      expect(result.renamed.map((r) => `${r.from}→${r.to}`)).toEqual(['bbs→blog-management', 'sim→utl-sim']);
      expect(sqlite.getComponentById('bbs')?.name).toBe('게시판');
      expect(sqlite.getComponentById('blog-management')?.name).toBe('블로그관리');
      expect(sqlite.getComponentById('sim')?.name).toBe('일정관리');
      expect(sqlite.getComponentById('utl-sim')?.name).toBe('시스템정보확인');
    });

    it('의존성은 컴포넌트마다 따로 적재한다 (id 가 겹쳐도 합쳐지지 않는다)', async () => {
      const jsonPath = await writeMeta([
        component('sim', '일정관리', 'egovframework.com.cop.smt.sim', { dependencies: ['egovframework.com.cmm'] }),
        component('sim', '시스템정보확인', 'egovframework.com.utl.sim', { dependencies: ['egovframework.com.utl.fcc'] }),
      ]);

      const result = await loadCommonComponentsFromJson(sqlite, jsonPath);

      expect(result.dependencies).toBe(2);
      expect(sqlite.getComponentDependencies('sim')).toEqual(['egovframework.com.cmm']);
      expect(sqlite.getComponentDependencies('utl-sim')).toEqual(['egovframework.com.utl.fcc']);
    });

    it('재적재하면 원본에서 사라진 컴포넌트와 의존성이 남지 않는다', async () => {
      const first = await writeMeta([
        component('uia', '일반로그인', 'egovframework.com.uat.uia', { dependencies: ['egovframework.com.cmm'] }),
        component('old', '없어질컴포넌트', 'egovframework.com.old', { dependencies: ['egovframework.com.cmm'] }),
      ]);
      await loadCommonComponentsFromJson(sqlite, first);
      expect(count('common_components')).toBe(2);

      const second = await writeMeta([component('uia', '일반로그인', 'egovframework.com.uat.uia')]);
      const result = await loadCommonComponentsFromJson(sqlite, second);

      expect(result.components).toBe(1);
      expect(count('common_components')).toBe(1);
      expect(count('component_dependencies')).toBe(0);
      expect(sqlite.getComponentById('old')).toBeUndefined();
    });

    it('적재한 컴포넌트는 키워드 검색으로 모두 찾을 수 있다', async () => {
      const jsonPath = await writeMeta([
        component('bbs', '게시판', 'egovframework.com.cop.bbs', { nameEn: 'BBS' }),
        component('bbs', '블로그관리', 'egovframework.com.cop.bbs', { nameEn: 'Blog Management' }),
      ]);
      await loadCommonComponentsFromJson(sqlite, jsonPath);

      expect(sqlite.searchComponents('게시판').map((c) => c.component_id)).toEqual(['bbs']);
      expect(sqlite.searchComponents('블로그').map((c) => c.component_id)).toEqual(['blog-management']);
    });

    it('패키지명으로 찾을 때 한 패키지를 함께 쓰는 컴포넌트는 먼저 적재한 것을 돌려준다', async () => {
      const jsonPath = await writeMeta([
        component('bbs', '게시판', 'egovframework.com.cop.bbs', { nameEn: 'BBS' }),
        component('bbs', '블로그관리', 'egovframework.com.cop.bbs', { nameEn: 'Blog Management' }),
      ]);
      await loadCommonComponentsFromJson(sqlite, jsonPath);

      expect(sqlite.getComponentByPackage('egovframework.com.cop.bbs')?.component_id).toBe('bbs');
      expect(sqlite.getComponentByPackage('EGOVFRAMEWORK.COM.COP.BBS')?.component_id).toBe('bbs');

      // 정렬 기준이 같은 행의 순서는 SQL 이 보장하지 않으므로, 조회 문이 id 를 마지막 기준으로 두는지 직접 확인한다
      const db = (sqlite as unknown as { db: { prepare: (sql: string) => unknown } }).db;
      const prepare = vi.spyOn(db, 'prepare');
      try {
        sqlite.getComponentByPackage('egovframework.com.cop.bbs');
        const sql = String(prepare.mock.calls[0]?.[0]).replace(/\s+/g, ' ').trim();
        expect(sql).toMatch(/ORDER BY .*, c\.id LIMIT 1$/);
      } finally {
        prepare.mockRestore();
      }
    });

    it('components 배열이 없는 파일은 거부한다', async () => {
      const jsonPath = path.join(tmpDir, 'bad-components.json');
      await fs.writeJSON(jsonPath, { categories: [] });
      await expect(loadCommonComponentsFromJson(sqlite, jsonPath)).rejects.toThrow(/common-components\.json/);
    });
  });
});
