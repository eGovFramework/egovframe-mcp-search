/**
 * 공통컴포넌트 DDL 추출(extractTableDDLs) 단위 테스트
 *
 * 추출기는 줄 단위로 CREATE 문을 모은다. 시작과 끝이 같은 줄에 있는 문(goldilocks·cubrid
 * 스크립트의 한 줄짜리 CREATE INDEX)을 닫지 못하면 뒤따르는 무관한 테이블이 출력에 섞이고
 * 인덱스가 사라진다. 작은 SQL 문자열로 규칙을 고정하고, 저장소에 동봉된 8개 DB 스크립트
 * 전체에 대해 독립적인 문 단위 분할 결과와 비교해 회귀를 막는다.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { extractTableDDLs } from '../../src/tools/commonComponents.js';

const REPO_ROOT = path.resolve(__dirname, '../..');
const SRC_ROOT = path.join(REPO_ROOT, 'templates', 'common-components-src');
const hasComponentSources = fs.existsSync(path.join(SRC_ROOT, 'pom.xml'));

const DB_TYPES = ['mysql', 'maria', 'oracle', 'postgres', 'tibero', 'cubrid', 'altibase', 'goldilocks'];

type StatementKind = 'table' | 'index' | 'view' | 'other';

interface Statement {
  kind: StatementKind;
  /** 문이 대상으로 삼는 테이블(뷰) 이름 — 대문자 */
  target: string;
  text: string;
}

/**
 * 추출기와 무관하게 SQL 을 문 단위로 나눠 분류한다 (검증용 기준).
 * 동봉 스크립트는 모든 문이 줄 끝의 세미콜론으로 끝나고 리터럴 안에 세미콜론이 없다.
 */
function parseStatements(sql: string): Statement[] {
  return sql
    .split(/;[ \t]*$/m)
    .map((chunk) =>
      chunk
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter((text) => text.length > 0)
    .map((text) => {
      const table = text.match(/^CREATE\s+TABLE\s+(\w+)/i);
      if (table) return { kind: 'table', target: table[1].toUpperCase(), text };
      const index = text.match(/^CREATE\s+(?:UNIQUE\s+)?INDEX\s+\w+\s+ON\s+(\w+)/i);
      if (index) return { kind: 'index', target: index[1].toUpperCase(), text };
      const view = text.match(/^CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(\w+)/i);
      if (view) return { kind: 'view', target: view[1].toUpperCase(), text };
      return { kind: 'other', target: '', text };
    });
}

/** 추출 결과에 담긴 문의 "종류 대상" 목록 (출력 순서) */
function summarize(ddl: string): string[] {
  return parseStatements(ddl).map((s) => `${s.kind} ${s.target}`);
}

describe('extractTableDDLs — 한 줄짜리 문 처리', () => {
  it('한 줄짜리 CREATE INDEX 뒤에 오는 요청하지 않은 테이블을 출력에 섞지 않는다', () => {
    const sql = [
      'CREATE TABLE WANTED',
      '(',
      '\tID CHAR(20) NOT NULL',
      ');',
      'CREATE INDEX WANTED_i01 ON WANTED (ID ASC);',
      '',
      'CREATE TABLE OTHER',
      '(',
      '\tID CHAR(20) NOT NULL',
      ');',
    ].join('\n');

    const result = extractTableDDLs(sql, ['WANTED']);

    expect(summarize(result.ddl)).toEqual(['table WANTED', 'index WANTED']);
    expect(result.ddl).not.toContain('OTHER');
    expect(result.foundCount).toBe(1);
  });

  it('한 줄짜리 CREATE INDEX 뒤에 요청한 테이블이 와도 인덱스를 잃지 않는다', () => {
    const sql = [
      'CREATE TABLE FIRST_T',
      '(',
      '\tID CHAR(20) NOT NULL',
      ');',
      'CREATE INDEX FIRST_T_i01 ON FIRST_T (ID ASC);',
      '',
      'CREATE TABLE SECOND_T',
      '(',
      '\tID CHAR(20) NOT NULL',
      ');',
    ].join('\n');

    const result = extractTableDDLs(sql, ['FIRST_T', 'SECOND_T']);

    expect(summarize(result.ddl)).toEqual(['table FIRST_T', 'index FIRST_T', 'table SECOND_T']);
    expect(result.foundCount).toBe(2);
  });

  it('연달아 나오는 한 줄짜리 CREATE INDEX 를 각각 하나의 문으로 추출한다', () => {
    const sql = [
      'CREATE TABLE T (ID CHAR(20) NOT NULL);',
      'CREATE INDEX T_i01 ON T (ID ASC);',
      'CREATE UNIQUE INDEX T_i02 ON T(ID ASC);',
      'CREATE INDEX X_i01 ON X (ID ASC);',
    ].join('\n');

    const result = extractTableDDLs(sql, ['T']);

    expect(summarize(result.ddl)).toEqual(['table T', 'index T', 'index T']);
    expect(result.ddl).toContain('T_i01');
    expect(result.ddl).toContain('T_i02');
    expect(result.ddl).not.toContain('X_i01');
    expect(result.foundCount).toBe(1);
  });

  it('여러 줄에 걸친 CREATE TABLE 과 CREATE INDEX 는 종결자까지 그대로 추출한다', () => {
    const sql = [
      '',
      'CREATE TABLE COMTNA',
      '(',
      '\tA_ID  CHAR(20) NOT NULL,',
      '\t PRIMARY KEY (A_ID)',
      ')',
      ';',
      '',
      'CREATE UNIQUE INDEX COMTNA_PK ON COMTNA',
      '(',
      '\tA_ID',
      ')',
      ';',
      '',
      'CREATE TABLE COMTNB',
      '(',
      '\tB_ID  CHAR(20) NOT NULL',
      ')',
      ';',
    ].join('\n');

    const result = extractTableDDLs(sql, ['comtna']);

    expect(summarize(result.ddl)).toEqual(['table COMTNA', 'index COMTNA']);
    expect(result.ddl).toContain('PRIMARY KEY (A_ID)');
    expect(result.ddl).not.toContain('COMTNB');
    expect(result.foundCount).toBe(1);
  });

  it('종결자 없이 열린 블록은 다음 CREATE 문에서 닫는다', () => {
    const sql = [
      'CREATE TABLE WANTED',
      '(',
      '\tID CHAR(20) NOT NULL',
      ')',
      '',
      'CREATE TABLE OTHER',
      '(',
      '\tID CHAR(20) NOT NULL',
      ');',
      'CREATE SEQUENCE OTHER_SEQ;',
    ].join('\n');

    const result = extractTableDDLs(sql, ['WANTED']);

    expect(result.ddl).toContain('CREATE TABLE WANTED');
    expect(result.ddl).not.toContain('OTHER');
    expect(result.foundCount).toBe(1);
  });
});

describe.skipIf(!hasComponentSources)('extractTableDDLs — 동봉 스크립트 회귀 (8개 DB 타입)', () => {
  /** 컴포넌트 메타데이터의 useTables (DB 를 열지 않도록 원본 JSON 을 읽는다) */
  const components: Array<{ id: string; useTables: string[] }> = hasComponentSources
    ? JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'templates', 'common-components.json'), 'utf-8')).components
    : [];

  const readScript = (dbType: string) =>
    fs.readFileSync(path.join(SRC_ROOT, 'script', 'ddl', dbType, `com_DDL_${dbType}.sql`), 'utf-8');

  it.each(DB_TYPES)('%s: 요청한 테이블의 CREATE TABLE·CREATE INDEX 만, 빠짐없이 추출한다', (dbType) => {
    const script = readScript(dbType);
    const all = parseStatements(script);
    expect(all.filter((s) => s.kind === 'other')).toEqual([]);

    const mismatches: string[] = [];
    for (const component of components) {
      const requested = new Set((component.useTables ?? []).map((t) => t.toUpperCase()));
      if (requested.size === 0) continue;

      const expected = all.filter((s) => s.kind !== 'view' && requested.has(s.target));
      const result = extractTableDDLs(script, component.useTables);
      const actual = parseStatements(result.ddl).filter((s) => s.kind !== 'view');

      const expectedTables = expected.filter((s) => s.kind === 'table').length;
      const same =
        actual.length === expected.length &&
        actual.every((s, i) => s.text === expected[i].text) &&
        result.foundCount === expectedTables;
      if (!same) {
        const foreign = actual.filter((s) => !requested.has(s.target)).map((s) => s.target);
        mismatches.push(
          `${component.id}: 문 ${actual.length}/${expected.length}개, foundCount ${result.foundCount}/${expectedTables}` +
            (foreign.length > 0 ? `, 요청하지 않은 대상 ${[...new Set(foreign)].join(',')}` : ''),
        );
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('goldilocks: 한 줄짜리 인덱스가 있는 컴포넌트(uia)의 테이블 12개와 인덱스 8개를 모두 추출한다', () => {
    const uia = components.find((c) => c.id === 'uia');
    expect(uia).toBeDefined();
    const result = extractTableDDLs(readScript('goldilocks'), uia!.useTables);
    const statements = parseStatements(result.ddl);
    const requested = new Set(uia!.useTables.map((t) => t.toUpperCase()));

    expect(statements.filter((s) => s.kind === 'table')).toHaveLength(12);
    expect(statements.filter((s) => s.kind === 'index')).toHaveLength(8);
    expect(statements.filter((s) => !requested.has(s.target))).toEqual([]);
    expect(result.foundCount).toBe(12);
  });
});
