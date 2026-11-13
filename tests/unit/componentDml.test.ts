/**
 * 공통컴포넌트 DML 추출(extractTableDMLs)과 포맷 단위 테스트
 *
 * 거의 모든 컴포넌트가 공통코드·ID 생성 테이블을 함께 쓰기 때문에, 관련 INSERT 문을 전부
 * 돌려주면 응답이 12만 자를 넘는다. 기본 보기는 테이블마다 처음 몇 건만 보여 주고 전체
 * 건수를 알려 주며, 한 테이블의 전체 내용은 table + limit/offset 으로 나눠 조회한다.
 * 작은 SQL 문자열로 규칙을 고정하고, 저장소에 동봉된 8개 DB 스크립트로 응답 크기와
 * 페이지 조회의 완전성을 확인한다.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  DML_PREVIEW_ROWS_PER_TABLE,
  DML_TABLE_PAGE_SIZE,
  extractTableDMLs,
  formatComponentDML,
  type ComponentDMLOptions,
} from '../../src/tools/commonComponents.js';
import { UserFacingError } from '../../src/utils/errors.js';

const REPO_ROOT = path.resolve(__dirname, '../..');
const SRC_ROOT = path.join(REPO_ROOT, 'templates', 'common-components-src');
const hasComponentSources = fs.existsSync(path.join(SRC_ROOT, 'pom.xml'));

const DB_TYPES = ['mysql', 'maria', 'oracle', 'postgres', 'tibero', 'cubrid', 'altibase', 'goldilocks'];

/** 한 테이블의 INSERT 문 n 건 (값은 1 부터 번호를 매긴다) */
function insertRows(table: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `INSERT INTO ${table} (ID) VALUES ('${table}-${i + 1}');`);
}

/** 텍스트에 들어 있는 INSERT 문의 대상 테이블 (출력 순서) */
function insertTargets(sql: string): string[] {
  return sql
    .split('\n')
    .map((line) => line.trim().match(/^INSERT\s+INTO\s+(\w+)/i)?.[1].toUpperCase())
    .filter((name): name is string => name !== undefined);
}

/** formatComponentDML 에 넘길 결과를 조립한다 (getComponentDML 이 하는 일과 같다) */
function dmlResult(sql: string, tables: string[], options?: ComponentDMLOptions) {
  return {
    componentId: 'bbs',
    componentName: '게시판',
    dbType: 'mysql',
    tables,
    ...extractTableDMLs(sql, tables, options),
  };
}

const SAMPLE_SQL = [
  '-- 코드',
  ...insertRows('CODE_T', 25),
  '',
  '-- 사용자',
  ...insertRows('USER_T', 2),
  '',
  '-- 요청하지 않는 테이블',
  ...insertRows('OTHER_T', 3),
].join('\n');

const SAMPLE_TABLES = ['USER_T', 'CODE_T', 'EMPTY_T'];

describe('extractTableDMLs — 기본 보기 (테이블별 미리보기)', () => {
  it('미리보기 건수와 한 번에 조회하는 건수의 상한은 20건과 100건이다', () => {
    expect(DML_PREVIEW_ROWS_PER_TABLE).toBe(20);
    expect(DML_TABLE_PAGE_SIZE).toBe(100);
  });

  it('테이블마다 처음 20건만 담고 전체 건수와 담은 건수를 알려 준다', () => {
    const result = extractTableDMLs(SAMPLE_SQL, SAMPLE_TABLES);

    expect(insertTargets(result.dml)).toEqual([...Array(20).fill('CODE_T'), 'USER_T', 'USER_T']);
    expect(result.dml).toContain("VALUES ('CODE_T-20');");
    expect(result.dml).not.toContain("VALUES ('CODE_T-21');");
    expect(result.dml).not.toContain('OTHER_T');
    expect(result.statementCount).toBe(22);
    expect(result.totalCount).toBe(27);
    expect(result.table).toBeNull();
    // 데이터가 있는 테이블은 스크립트 순서, 없는 테이블은 그 뒤
    expect(result.tableCounts).toEqual([
      { table: 'CODE_T', total: 25, shown: 20 },
      { table: 'USER_T', total: 2, shown: 2 },
      { table: 'EMPTY_T', total: 0, shown: 0 },
    ]);
  });

  it('생략한 테이블에는 SQL 안에도 생략 건수를 남기고 구역 주석은 유지한다', () => {
    const { dml } = extractTableDMLs(SAMPLE_SQL, SAMPLE_TABLES);

    expect(dml).toContain('-- 코드');
    expect(dml).toContain('-- 사용자');
    expect(dml).not.toContain('-- 요청하지 않는 테이블');
    expect(dml).toMatch(/CODE_T.*5건 생략/);
    expect(dml).not.toMatch(/USER_T.*생략/);
  });

  it('table 을 주지 않으면 limit 과 offset 은 쓰지 않는다', () => {
    const result = extractTableDMLs(SAMPLE_SQL, SAMPLE_TABLES, { limit: 1, offset: 10 });

    expect(result.statementCount).toBe(22);
    expect(result.table).toBeNull();
  });

  it('모든 테이블이 20건 이하면 전부 담는다', () => {
    const result = extractTableDMLs(SAMPLE_SQL, ['USER_T']);

    expect(result.statementCount).toBe(2);
    expect(result.totalCount).toBe(2);
    expect(result.dml).not.toContain('생략');
  });

  it('요청한 테이블에 INSERT 문이 하나도 없으면 그렇게 알린다', () => {
    const result = extractTableDMLs(SAMPLE_SQL, ['EMPTY_T', 'NOPE_T']);

    expect(insertTargets(result.dml)).toEqual([]);
    expect(result.dml).toContain('초기 데이터가 없습니다');
    expect(result.statementCount).toBe(0);
    expect(result.totalCount).toBe(0);
  });
});

describe('extractTableDMLs — table 지정 조회', () => {
  const bigSql = insertRows('BIG_T', 130).join('\n');

  it('그 테이블의 INSERT 문만 돌려주고 이름은 대소문자를 구분하지 않는다', () => {
    const result = extractTableDMLs(SAMPLE_SQL, SAMPLE_TABLES, { table: 'code_t' });

    expect(insertTargets(result.dml)).toEqual(Array(25).fill('CODE_T'));
    expect(result.table).toBe('CODE_T');
    expect(result.statementCount).toBe(25);
    expect(result.totalCount).toBe(25);
    expect(result.offset).toBe(0);
    expect(result.tableCounts).toEqual([{ table: 'CODE_T', total: 25, shown: 25 }]);
    expect(result.dml).toContain('총 25건 중 1~25');
  });

  it('offset 부터 limit 건을 돌려주고 범위를 표시한다', () => {
    const result = extractTableDMLs(SAMPLE_SQL, SAMPLE_TABLES, { table: 'CODE_T', limit: 10, offset: 20 });

    expect(result.statementCount).toBe(5);
    expect(result.totalCount).toBe(25);
    expect(result.offset).toBe(20);
    expect(result.limit).toBe(10);
    expect(result.dml).toContain("VALUES ('CODE_T-21');");
    expect(result.dml).toContain("VALUES ('CODE_T-25');");
    expect(result.dml).not.toContain("VALUES ('CODE_T-20');");
    expect(result.dml).toContain('총 25건 중 21~25');
  });

  it('limit 의 기본값과 상한은 100건이다', () => {
    expect(extractTableDMLs(bigSql, ['BIG_T'], { table: 'BIG_T' }).statementCount).toBe(100);
    expect(extractTableDMLs(bigSql, ['BIG_T'], { table: 'BIG_T', limit: 5000 }).statementCount).toBe(100);
    expect(extractTableDMLs(bigSql, ['BIG_T'], { table: 'BIG_T', limit: 5000 }).limit).toBe(100);
    expect(extractTableDMLs(bigSql, ['BIG_T'], { table: 'BIG_T', offset: 100 }).statementCount).toBe(30);
  });

  it('범위를 벗어난 limit 과 offset 은 오류 대신 가까운 유효한 값으로 맞춘다', () => {
    const page = (options: ComponentDMLOptions) => extractTableDMLs(bigSql, ['BIG_T'], { table: 'BIG_T', ...options });

    expect(page({ limit: 0 }).statementCount).toBe(1);
    expect(page({ limit: -3 }).statementCount).toBe(1);
    expect(page({ limit: 2.9 }).statementCount).toBe(2);
    expect(page({ limit: Number.NaN }).statementCount).toBe(100);
    expect(page({ limit: Number.POSITIVE_INFINITY }).statementCount).toBe(100);
    expect(page({ offset: -7 }).offset).toBe(0);
    expect(page({ offset: 3.7, limit: 1 }).dml).toContain("VALUES ('BIG_T-4');");
    expect(page({ offset: Number.NaN }).offset).toBe(0);
  });

  it('offset 이 전체 건수 이상이면 빈 결과와 함께 전체 건수를 알려 준다', () => {
    const result = extractTableDMLs(bigSql, ['BIG_T'], { table: 'BIG_T', offset: 500 });

    expect(insertTargets(result.dml)).toEqual([]);
    expect(result.statementCount).toBe(0);
    expect(result.totalCount).toBe(130);
    expect(result.dml).toContain('총 130건');
  });

  it('초기 데이터가 없는 테이블은 빈 결과로 알린다', () => {
    const result = extractTableDMLs(SAMPLE_SQL, SAMPLE_TABLES, { table: 'EMPTY_T' });

    expect(result.table).toBe('EMPTY_T');
    expect(result.statementCount).toBe(0);
    expect(result.totalCount).toBe(0);
    expect(result.dml).toContain('초기 데이터가 없습니다');
  });

  it('컴포넌트가 사용하는 테이블이 아니면 사용 가능한 테이블을 나열한 UserFacingError 를 던진다', () => {
    let error: unknown;
    try {
      extractTableDMLs(SAMPLE_SQL, SAMPLE_TABLES, { table: 'OTHER_T' });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as Error).message).toContain('OTHER_T');
    expect((error as Error).message).toContain('사용 가능한 테이블: USER_T, CODE_T, EMPTY_T');
  });

  it('사용 테이블이 없는 컴포넌트에 table 을 주면 UserFacingError 를 던진다', () => {
    expect(() => extractTableDMLs(SAMPLE_SQL, [], { table: 'CODE_T' })).toThrow(UserFacingError);
  });

  it('공백뿐인 table 은 지정하지 않은 것으로 본다', () => {
    const result = extractTableDMLs(SAMPLE_SQL, SAMPLE_TABLES, { table: '   ' });

    expect(result.table).toBeNull();
    expect(result.statementCount).toBe(22);
  });
});

describe('formatComponentDML', () => {
  it('기본 보기는 테이블별 전체·표시·생략 건수 표와 table 조회 안내를 붙인다', () => {
    const text = formatComponentDML(dmlResult(SAMPLE_SQL, SAMPLE_TABLES));

    expect(text).toContain('## 게시판 초기 데이터 (mysql)');
    expect(text).toContain('- **관련 테이블**: 3개');
    expect(text).toContain('전체 27건 중 22건');
    expect(text).toContain('| CODE_T | 25 | 20 | 5 |');
    expect(text).toContain('| USER_T | 2 | 2 | 0 |');
    expect(text).toContain('EMPTY_T');
    expect(text).toMatch(/INSERT INTO CODE_T/);
    // 생략된 내용을 받는 방법: filters.table 과 limit, filters.offset
    expect(text).toContain('filters.table');
    expect(text).toContain('limit');
    expect(text).toContain('filters.offset');
  });

  it('생략한 것이 없으면 table 조회 안내를 붙이지 않는다', () => {
    const text = formatComponentDML(dmlResult(SAMPLE_SQL, ['USER_T']));

    expect(text).toContain('- **INSERT 문**: 2건');
    expect(text).toContain('| USER_T | 2 | 2 | 0 |');
    expect(text).not.toContain('filters.table');
  });

  it('table 지정 조회는 "총 N건 중 a~b" 와 다음 구간의 offset 을 알려 준다', () => {
    const text = formatComponentDML(dmlResult(SAMPLE_SQL, SAMPLE_TABLES, { table: 'CODE_T', limit: 10, offset: 5 }));

    expect(text).toContain('## 게시판 초기 데이터 (mysql)');
    expect(text).toContain('- **테이블**: CODE_T');
    expect(text).toContain('총 25건 중 6~15');
    expect(text).toContain('filters.offset: 15');
  });

  it('마지막 구간에서는 다음 구간 안내를 붙이지 않는다', () => {
    const text = formatComponentDML(dmlResult(SAMPLE_SQL, SAMPLE_TABLES, { table: 'CODE_T', limit: 10, offset: 20 }));

    expect(text).toContain('총 25건 중 21~25');
    expect(text).not.toContain('filters.offset:');
  });

  it('표시할 INSERT 문이 없는 table 조회는 범위 대신 전체 건수만 적는다', () => {
    const empty = formatComponentDML(dmlResult(SAMPLE_SQL, SAMPLE_TABLES, { table: 'EMPTY_T' }));
    const beyond = formatComponentDML(dmlResult(SAMPLE_SQL, SAMPLE_TABLES, { table: 'CODE_T', offset: 99 }));

    expect(empty).toContain('- **INSERT 문**: 총 0건\n');
    expect(beyond).toContain('- **INSERT 문**: 총 25건 (offset 99 부터는 남은 INSERT 문이 없습니다)');
    expect(beyond).not.toMatch(/INSERT INTO/);
  });
});

describe.skipIf(!hasComponentSources)('extractTableDMLs — 동봉 스크립트 (8개 DB 타입)', () => {
  /** 컴포넌트 메타데이터 (DB 를 열지 않도록 원본 JSON 을 읽는다) */
  const components: Array<{ id: string; name: string; useTables: string[] }> = hasComponentSources
    ? JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'templates', 'common-components.json'), 'utf-8')).components
    : [];

  const readScript = (dbType: string) =>
    fs.readFileSync(path.join(SRC_ROOT, 'script', 'dml', dbType, `com_DML_${dbType}.sql`), 'utf-8');

  /** 추출기와 무관하게 센 테이블별 INSERT 줄 (검증용 기준) */
  function insertLinesByTable(script: string): Map<string, string[]> {
    const byTable = new Map<string, string[]>();
    for (const line of script.split('\n')) {
      const name = line.trim().match(/^INSERT\s+INTO\s+(\w+)/i)?.[1].toUpperCase();
      if (!name) continue;
      byTable.set(name, [...(byTable.get(name) ?? []), line]);
    }
    return byTable;
  }

  /**
   * 응답 크기의 상한 (문자 수). 지금 데이터에서 가장 큰 응답은 약 2만 7천 자이고,
   * 제한이 없던 때는 컴포넌트마다 12만~19만 자였다.
   */
  const MAX_RESPONSE_CHARS = 40_000;

  it.each(DB_TYPES)('%s: 기본 보기는 모든 컴포넌트에서 크기가 제한되고 건수가 정확하다', (dbType) => {
    const script = readScript(dbType);
    const byTable = insertLinesByTable(script);

    const problems: string[] = [];
    for (const component of components) {
      const tables = component.useTables ?? [];
      if (tables.length === 0) continue;
      const requested = new Set(tables.map((t) => t.toUpperCase()));
      const result = extractTableDMLs(script, tables);
      const text = formatComponentDML({
        componentId: component.id,
        componentName: component.name,
        dbType,
        tables,
        ...result,
      });

      const targets = insertTargets(result.dml);
      const expectedTotal = [...requested].reduce((sum, t) => sum + (byTable.get(t)?.length ?? 0), 0);
      const expectedShown = [...requested].reduce(
        (sum, t) => sum + Math.min(DML_PREVIEW_ROWS_PER_TABLE, byTable.get(t)?.length ?? 0),
        0,
      );
      if (text.length > MAX_RESPONSE_CHARS) problems.push(`${component.id}: ${text.length}자`);
      if (targets.some((t) => !requested.has(t))) problems.push(`${component.id}: 요청하지 않은 테이블의 INSERT`);
      if (result.totalCount !== expectedTotal) problems.push(`${component.id}: totalCount ${result.totalCount}/${expectedTotal}`);
      if (result.statementCount !== expectedShown || targets.length !== expectedShown) {
        problems.push(`${component.id}: statementCount ${result.statementCount}, 출력 ${targets.length}, 기대 ${expectedShown}`);
      }
      for (const count of result.tableCounts) {
        const total = byTable.get(count.table.toUpperCase())?.length ?? 0;
        if (count.total !== total || count.shown !== Math.min(DML_PREVIEW_ROWS_PER_TABLE, total)) {
          problems.push(`${component.id}: ${count.table} ${count.shown}/${count.total}, 기대 전체 ${total}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it.each(DB_TYPES)('%s: 구간을 이어 조회하면 한 테이블의 INSERT 문 전체를 빠짐없이 순서대로 얻는다', (dbType) => {
    const script = readScript(dbType);
    const expected = insertLinesByTable(script).get('COMTCCMMNDETAILCODE') ?? [];
    expect(expected.length).toBeGreaterThan(DML_TABLE_PAGE_SIZE);

    const collected: string[] = [];
    for (let offset = 0; offset < expected.length; offset += DML_TABLE_PAGE_SIZE) {
      const page = extractTableDMLs(script, ['COMTCCMMNCODE', 'COMTCCMMNDETAILCODE'], {
        table: 'comtccmmndetailcode',
        offset,
      });
      expect(page.totalCount).toBe(expected.length);
      expect(page.statementCount).toBeLessThanOrEqual(DML_TABLE_PAGE_SIZE);
      expect(page.dml.length).toBeLessThan(MAX_RESPONSE_CHARS);
      collected.push(...page.dml.split('\n').filter((line) => /^\s*INSERT\s+INTO/i.test(line)));
    }
    expect(collected).toEqual(expected);
  });
});
