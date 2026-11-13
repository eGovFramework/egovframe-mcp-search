/**
 * 공통컴포넌트 DDL 추출(extractTableDDLs) 단위 테스트
 *
 * 추출기는 줄 단위로 CREATE 문을 모은다. 시작과 끝이 같은 줄에 있는 문(goldilocks·cubrid
 * 스크립트의 한 줄짜리 CREATE INDEX)을 닫지 못하면 뒤따르는 무관한 테이블이 출력에 섞이고
 * 인덱스가 사라진다. 뷰(CREATE VIEW)는 테이블 뒤에 따로 세어 출력하고, 요청한 이름 가운데
 * DDL 을 찾지 못한 것은 이름을 밝혀야 한다. 작은 SQL 문자열로 규칙을 고정하고, 저장소에
 * 동봉된 8개 DB 스크립트 전체에 대해 독립적인 문 단위 분할 결과와 비교해 회귀를 막는다.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { extractTableDDLs, formatComponentDDL } from '../../src/tools/commonComponents.js';

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

  it('한 줄짜리 CREATE 문 뒤에 오는 CREATE 가 아닌 문을 출력에 섞지 않는다', () => {
    // 뒤따르는 문이 CREATE 가 아니면 "다음 CREATE 문에서 닫기"로는 걸러지지 않는다.
    // 블록을 연 줄에서 종결자를 검사해야만 한 줄짜리 문이 닫힌다
    const sql = [
      'CREATE TABLE WANTED (ID CHAR(20) NOT NULL);',
      'CREATE INDEX WANTED_i01 ON WANTED (ID ASC);',
      'ALTER TABLE OTHER ADD CONSTRAINT OTHER_FK FOREIGN KEY (ID) REFERENCES WANTED (ID);',
      "COMMENT ON TABLE OTHER IS '다른 테이블';",
    ].join('\n');

    const result = extractTableDDLs(sql, ['WANTED']);

    expect(result.ddl).not.toContain('OTHER');
    expect(summarize(result.ddl)).toEqual(['table WANTED', 'index WANTED']);
    expect(result.foundCount).toBe(1);
  });

  it('인덱스 이름이 ON 으로 끝나도 ON 뒤의 테이블을 인덱스의 대상으로 읽는다', () => {
    // 줄 어디서나 "ON <이름>" 을 찾으면 IDX_ACTION 끝의 "ON" 에 걸려 대상을 'ON' 으로 읽고
    // 인덱스를 버린다. 패턴을 문 머리(CREATE [UNIQUE] INDEX <이름> ON)에 고정해야 한다
    const sql = ['CREATE TABLE ACTION_T (ID INT);', 'CREATE INDEX IDX_ACTION ON ACTION_T (ID);'].join('\n');

    const result = extractTableDDLs(sql, ['ACTION_T']);

    expect(result.ddl).toContain('IDX_ACTION');
    expect(summarize(result.ddl)).toEqual(['table ACTION_T', 'index ACTION_T']);
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

describe('extractTableDDLs — 뷰와 찾지 못한 객체', () => {
  const sql = [
    'CREATE TABLE BASE_A (ID CHAR(20) NOT NULL);',
    '',
    'CREATE VIEW V_USERS (ID, NAME)',
    'AS',
    '\tSELECT ID, NAME',
    '\tFROM BASE_A',
    'ORDER BY ID;',
    '',
    'CREATE OR REPLACE VIEW V_OTHER AS SELECT ID FROM BASE_A;',
    '',
    'CREATE TABLE BASE_B',
    '(',
    '\tID CHAR(20) NOT NULL',
    ');',
    'CREATE INDEX BASE_B_i01 ON BASE_B (ID ASC);',
  ].join('\n');

  it('CREATE VIEW 로 정의된 객체를 추출해 테이블 뒤에 출력하고 따로 센다', () => {
    const result = extractTableDDLs(sql, ['BASE_A', 'V_USERS', 'BASE_B']);

    expect(summarize(result.ddl)).toEqual(['table BASE_A', 'table BASE_B', 'index BASE_B', 'view V_USERS']);
    expect(result.ddl).toContain('ORDER BY ID;');
    expect(result.ddl).not.toContain('V_OTHER');
    expect(result.foundCount).toBe(2);
    expect(result.viewCount).toBe(1);
    expect(result.missing).toEqual([]);
  });

  it('CREATE OR REPLACE VIEW 도 뷰로 추출한다', () => {
    const result = extractTableDDLs(sql, ['v_other']);

    expect(summarize(result.ddl)).toEqual(['view V_OTHER']);
    expect(result.foundCount).toBe(0);
    expect(result.viewCount).toBe(1);
    expect(result.missing).toEqual([]);
  });

  it('요청한 이름 가운데 DDL 이 없는 것을 요청한 표기 그대로 돌려준다', () => {
    const result = extractTableDDLs(sql, ['BASE_A', 'UserConnection', 'v_users', 'COMTNSIEMAP', 'userconnection']);

    expect(result.foundCount).toBe(1);
    expect(result.viewCount).toBe(1);
    expect(result.missing).toEqual(['UserConnection', 'COMTNSIEMAP']);
  });

  it('아무것도 찾지 못하면 요청한 이름 전체가 찾지 못한 객체다', () => {
    const result = extractTableDDLs(sql, ['NOPE_A', 'NOPE_B']);

    expect(summarize(result.ddl)).toEqual([]);
    expect(result.foundCount).toBe(0);
    expect(result.viewCount).toBe(0);
    expect(result.missing).toEqual(['NOPE_A', 'NOPE_B']);
  });
});

describe('formatComponentDDL', () => {
  const base = {
    componentId: 'bbs',
    componentName: '게시판',
    dbType: 'mysql',
    tables: ['COMTNBBS', 'COMVNUSERMASTER', 'COMTNSIEMAP', 'UserConnection'],
    ddl: 'CREATE TABLE COMTNBBS (NTT_ID NUMERIC(20) NOT NULL);',
    tableCount: 1,
    viewCount: 1,
    missing: ['COMTNSIEMAP', 'UserConnection'],
  };

  it('테이블 수와 뷰 수를 따로 적고 DDL 을 찾지 못한 객체를 나열한다', () => {
    const text = formatComponentDDL(base);

    expect(text).toContain('## 게시판 DDL (mysql)');
    expect(text).toContain('- **필요 테이블**: 4개');
    expect(text).toContain('- **추출된 DDL**: 1개 테이블, 1개 뷰');
    expect(text).toContain('DDL 을 찾지 못한 객체: COMTNSIEMAP, UserConnection');
    expect(text).toContain('```sql\nCREATE TABLE COMTNBBS');
  });

  it('모두 찾았으면 찾지 못한 객체 줄을 넣지 않고, 뷰가 없으면 뷰 수를 적지 않는다', () => {
    const text = formatComponentDDL({ ...base, tables: ['COMTNBBS'], viewCount: 0, missing: [] });

    expect(text).toContain('- **추출된 DDL**: 1개 테이블\n');
    expect(text).not.toContain('뷰');
    expect(text).not.toContain('DDL 을 찾지 못한 객체');
  });
});

describe.skipIf(!hasComponentSources)('extractTableDDLs — 동봉 스크립트 회귀 (8개 DB 타입)', () => {
  /** 컴포넌트 메타데이터의 useTables (DB 를 열지 않도록 원본 JSON 을 읽는다) */
  const components: Array<{ id: string; useTables: string[] }> = hasComponentSources
    ? JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'templates', 'common-components.json'), 'utf-8')).components
    : [];

  const readScript = (dbType: string) =>
    fs.readFileSync(path.join(SRC_ROOT, 'script', 'ddl', dbType, `com_DDL_${dbType}.sql`), 'utf-8');

  it.each(DB_TYPES)('%s: 요청한 테이블·뷰의 CREATE 문과 인덱스만, 빠짐없이 추출한다', (dbType) => {
    const script = readScript(dbType);
    const all = parseStatements(script);
    expect(all.filter((s) => s.kind === 'other')).toEqual([]);

    const mismatches: string[] = [];
    for (const component of components) {
      const requested = new Set((component.useTables ?? []).map((t) => t.toUpperCase()));
      if (requested.size === 0) continue;

      // 기대 출력: 테이블·인덱스는 스크립트 순서, 뷰는 그 뒤
      const wanted = all.filter((s) => requested.has(s.target));
      const expected = [...wanted.filter((s) => s.kind !== 'view'), ...wanted.filter((s) => s.kind === 'view')];
      const result = extractTableDDLs(script, component.useTables);
      const actual = parseStatements(result.ddl);

      const expectedTables = expected.filter((s) => s.kind === 'table').length;
      const expectedViews = expected.filter((s) => s.kind === 'view').length;
      const defined = new Set(wanted.filter((s) => s.kind !== 'index').map((s) => s.target));
      const expectedMissing = [...requested].filter((name) => !defined.has(name));
      const same =
        actual.length === expected.length &&
        actual.every((s, i) => s.text === expected[i].text) &&
        result.foundCount === expectedTables &&
        result.viewCount === expectedViews &&
        JSON.stringify(result.missing.map((name) => name.toUpperCase())) === JSON.stringify(expectedMissing);
      if (!same) {
        const foreign = actual.filter((s) => !requested.has(s.target)).map((s) => s.target);
        mismatches.push(
          `${component.id}: 문 ${actual.length}/${expected.length}개, foundCount ${result.foundCount}/${expectedTables}` +
            `, viewCount ${result.viewCount}/${expectedViews}, missing ${JSON.stringify(result.missing)}/${JSON.stringify(expectedMissing)}` +
            (foreign.length > 0 ? `, 요청하지 않은 대상 ${[...new Set(foreign)].join(',')}` : ''),
        );
      }
    }
    expect(mismatches).toEqual([]);
  });

  it.each(DB_TYPES)('%s: 한 줄짜리 CREATE INDEX 가 가리키는 테이블을 요청하면 그 인덱스를 모두 추출한다', (dbType) => {
    const script = readScript(dbType);
    // 시작과 끝이 같은 줄인 인덱스 문 (goldilocks 와 cubrid 스크립트에만 있다)
    const singleLine = script
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^CREATE\s+(?:UNIQUE\s+)?INDEX\s.*;$/i.test(line));
    const tables = [...new Set(parseStatements(singleLine.join('\n')).map((s) => s.target))];
    if (tables.length === 0) return;

    const result = extractTableDDLs(script, tables);
    const statements = parseStatements(result.ddl);

    for (const line of singleLine) {
      expect(result.ddl).toContain(line);
    }
    expect(statements.filter((s) => !tables.includes(s.target))).toEqual([]);
    expect(statements.filter((s) => s.kind === 'table')).toHaveLength(tables.length);
    expect(result.foundCount).toBe(tables.length);
  });

  it.each(DB_TYPES)('%s: COMVNUSERMASTER 뷰를 자신이 조회하는 테이블 뒤에 추출한다', (dbType) => {
    // 46개 컴포넌트가 쓰는 뷰. 회원 테이블 세 개를 UNION 으로 조회한다
    const result = extractTableDDLs(readScript(dbType), [
      'COMVNUSERMASTER',
      'COMTNGNRLMBER',
      'COMTNENTRPRSMBER',
      'COMTNEMPLYRINFO',
    ]);
    const statements = parseStatements(result.ddl);

    expect(result.foundCount).toBe(3);
    expect(result.viewCount).toBe(1);
    expect(result.missing).toEqual([]);
    expect(statements[statements.length - 1]).toMatchObject({ kind: 'view', target: 'COMVNUSERMASTER' });
    expect(statements[statements.length - 1].text).toMatch(/UNION ALL/i);
  });

  it.each(DB_TYPES)('%s: 스크립트에 정의가 없는 이름은 찾지 못한 객체로 알린다', (dbType) => {
    // 메타데이터에 실제로 있는 사례: 오타(COMTNSIEMAP)와 다른 스크립트에 정의된 객체(UserConnection)
    const result = extractTableDDLs(readScript(dbType), ['COMTNSIEMAP', 'COMTNGNRLMBER', 'UserConnection']);

    expect(result.foundCount).toBe(1);
    expect(result.missing).toEqual(['COMTNSIEMAP', 'UserConnection']);
  });
});
