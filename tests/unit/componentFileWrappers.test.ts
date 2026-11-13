/**
 * 공통컴포넌트 파일 기능의 공개 함수 단위 테스트
 * (getComponentSourceFiles, readComponentSource, getComponentDDL, getComponentDML)
 *
 * 게이트웨이가 호출하는 공개 함수는 지식베이스 DB 에서 컴포넌트를 찾은 뒤 소스 트리를 읽는다.
 * 저장소의 DB 와 소스 트리를 건드리지 않도록 dataPaths 의 경로 해석 두 개만 바꿔치기해,
 * 임시 디렉토리에 새로 만든 SQLite DB 와 작은 소스 트리를 쓰게 한다 (DB 경로를 바꿀 다른
 * 방법이 없다). 그 밖의 코드는 모두 실제 구현이다.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SQLiteManager } from '../../src/database/sqliteManager.js';

type ComponentTools = typeof import('../../src/tools/commonComponents.js');

/** 한 테이블의 INSERT 문 n 건 */
function insertRows(table: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `INSERT INTO ${table} (ID) VALUES ('${table}-${i + 1}');`);
}

/** 호출이 던진 오류를 돌려준다 (던지지 않으면 undefined) */
function catchError(run: () => unknown): Error | undefined {
  try {
    run();
  } catch (error) {
    return error as Error;
  }
  return undefined;
}

const DDL_SCRIPT = [
  'CREATE TABLE COMTNBRD',
  '(',
  '\tBRD_ID  CHAR(20) NOT NULL,',
  '\t PRIMARY KEY (BRD_ID)',
  ')',
  ';',
  '',
  'CREATE INDEX COMTNBRD_i01 ON COMTNBRD (BRD_ID ASC);',
  '',
  'CREATE TABLE OTHER_T (ID CHAR(20) NOT NULL);',
  '',
  'CREATE VIEW COMVNBRDUSER (ID)',
  'AS',
  '\tSELECT BRD_ID FROM COMTNBRD;',
  '',
  'CREATE TABLE COMTCCODE (CODE CHAR(6) NOT NULL);',
  '',
].join('\n');

/** 외래 키를 CREATE TABLE 안에 적는 DB 의 스크립트에 덧붙이는 부분 (mysql) */
const INLINE_FK_DDL = [
  'CREATE TABLE COMTNPARENT (ID CHAR(20) NOT NULL, PRIMARY KEY (ID));',
  '',
  'CREATE TABLE COMTNCHILD',
  '(',
  '\tID  CHAR(20) NOT NULL,',
  '\tPARENT_ID  CHAR(20),',
  '\tSELF_ID  CHAR(20),',
  '\tCONSTRAINT COMTNCHILD_FK1 FOREIGN KEY (PARENT_ID) REFERENCES COMTNPARENT (ID),',
  '\tCONSTRAINT COMTNCHILD_FK2 FOREIGN KEY (SELF_ID) REFERENCES COMTNCHILD (ID),',
  '\tCONSTRAINT COMTNCHILD_FK3 FOREIGN KEY (ID) REFERENCES COMTNUNDEFINED (ID)',
  ')',
  ';',
  '',
].join('\n');

/** 외래 키를 초기 데이터 스크립트의 끝에 ALTER 문으로 두는 DB 의 스크립트 (cubrid) */
const CUBRID_DDL_SCRIPT = [
  'CREATE TABLE COMTNBRD (BRD_ID CHAR(20) NOT NULL, MASTER_ID CHAR(20));',
  '',
  'CREATE TABLE COMTNBRDMASTER (MASTER_ID CHAR(20) NOT NULL, TMPLAT_ID CHAR(20));',
  '',
  'CREATE TABLE COMTNTMPLAT (TMPLAT_ID CHAR(20) NOT NULL);',
  '',
  'CREATE TABLE OTHER_T (ID CHAR(20) NOT NULL, BRD_ID CHAR(20));',
  '',
  'CREATE TABLE COMTCCODE (CODE CHAR(6) NOT NULL);',
  '',
].join('\n');

const CUBRID_DML_SCRIPT = [
  ...insertRows('COMTNBRD', 2),
  '',
  '-- FK제약 조건 등록',
  'ALTER CLASS COMTNBRD ADD CONSTRAINT [COMTNBRD_FK1] FOREIGN KEY([MASTER_ID]) REFERENCES [COMTNBRDMASTER] ON DELETE RESTRICT ON UPDATE RESTRICT;',
  'ALTER CLASS COMTNBRDMASTER ADD CONSTRAINT [COMTNBRDMASTER_FK1] FOREIGN KEY([TMPLAT_ID]) REFERENCES [COMTNTMPLAT] ON DELETE RESTRICT ON UPDATE RESTRICT;',
  'ALTER CLASS OTHER_T ADD CONSTRAINT [OTHER_T_FK1] FOREIGN KEY([BRD_ID]) REFERENCES [COMTNBRD] ON DELETE RESTRICT ON UPDATE RESTRICT;',
  '',
].join('\n');

const DML_SCRIPT = [
  '-- 코드',
  ...insertRows('COMTCCODE', 130),
  '',
  '-- 게시판',
  ...insertRows('COMTNBRD', 2),
  ...insertRows('OTHER_T', 1),
  '',
].join('\n');

describe('공통컴포넌트 파일 기능 공개 함수 (임시 DB + 임시 소스 트리)', () => {
  let tmpDir: string;
  let srcRoot: string;
  let tools: ComponentTools;

  beforeAll(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'egov-file-wrappers-'));
    srcRoot = path.join(tmpDir, 'common-components-src');
    const dbPath = path.join(tmpDir, 'egovframe.db');

    // 소스 트리
    const write = (relPath: string, content: string | Buffer) => {
      const target = path.join(srcRoot, relPath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    };
    const javaDir = path.join('src', 'main', 'java', 'egovframework', 'com', 'cop', 'brd', 'service');
    const springDir = path.join('src', 'main', 'resources', 'egovframework', 'spring', 'com');
    write('pom.xml', '<project/>\n');
    // 소스 루트가 독립 클론일 때의 저장소 메타데이터
    write(path.join('.git', 'config'), '[remote "origin"]\n\turl = https://example.com/repo.git\n');
    write(path.join('script', 'ddl', 'mysql', 'com_DDL_mysql.sql'), DDL_SCRIPT + INLINE_FK_DDL);
    write(path.join('script', 'dml', 'mysql', 'com_DML_mysql.sql'), DML_SCRIPT);
    write(path.join('script', 'ddl', 'cubrid', 'com_DDL_cubrid.sql'), CUBRID_DDL_SCRIPT);
    write(path.join('script', 'dml', 'cubrid', 'com_DML_cubrid.sql'), CUBRID_DML_SCRIPT);
    write(path.join(javaDir, 'BoardService.java'), '// 게시판 서비스\npublic class BoardService {}\n');
    write(path.join(javaDir, '._BoardService.java'), Buffer.from([0x00, 0x05, 0x16, 0x07]));
    write(path.join('src', 'main', 'resources', 'egovframework', 'mapper', 'com', 'cop', 'brd', 'Board_SQL_mysql.xml'), '<mapper/>\n');
    write(path.join(springDir, 'context-common.xml'), '<beans/>\n');
    // 파일 이름이 컴포넌트 ID(brd)와 같은 설정
    write(path.join(springDir, 'context-brd.xml'), '<beans/>\n');
    write(path.join(springDir, 'scheduling', 'context-scheduling-cop-brd.xml'), '<beans/>\n');

    // 지식베이스 DB (임시 디렉토리의 새 DB)
    const sqlite = new SQLiteManager(dbPath);
    sqlite.addComponentCategoriesBatch([{ category_id: 'cat-test', name: '테스트', name_en: 'Test' }]);
    sqlite.addCommonComponentsBatch([
      {
        component_id: 'brd',
        name: '테스트 게시판',
        category_id: 'cat-test',
        package_name: 'egovframework.com.cop.brd',
        use_tables: JSON.stringify(['COMTCCODE', 'COMTNBRD', 'COMVNBRDUSER', 'COMTNMISSING']),
        version: '5.0.0',
        has_web: true,
      },
      {
        component_id: 'fkc',
        name: '외래 키 컴포넌트',
        category_id: 'cat-test',
        package_name: 'egovframework.com.cop.fkc',
        use_tables: JSON.stringify(['COMTNCHILD']),
        version: '5.0.0',
        has_web: false,
      },
      {
        component_id: 'notbl',
        name: '테이블 없는 컴포넌트',
        category_id: 'cat-test',
        package_name: 'egovframework.com.cop.notbl',
        version: '5.0.0',
        has_web: false,
      },
    ]);
    sqlite.close();

    vi.resetModules();
    vi.doMock('../../src/utils/dataPaths.js', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../../src/utils/dataPaths.js')>()),
      resolveComponentsSrcRoot: () => srcRoot,
      resolveSQLiteDbPath: () => dbPath,
    }));
    tools = await import('../../src/tools/commonComponents.js');
  });

  afterAll(() => {
    vi.doUnmock('../../src/utils/dataPaths.js');
    vi.resetModules();
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('getComponentSourceFiles', () => {
    it('컴포넌트 ID 또는 패키지명으로 소스 파일 목록을 돌려준다', () => {
      const byId = tools.getComponentSourceFiles('brd');
      const byPackage = tools.getComponentSourceFiles('egovframework.com.cop.brd');

      expect(byId).not.toBeNull();
      expect(byId).toMatchObject({ componentId: 'brd', componentName: '테스트 게시판', total: 4 });
      expect(byId!.java.map((file) => path.basename(file))).toEqual(['BoardService.java']);
      expect(byId!.mapperXml).toHaveLength(1);
      // 설정: DB 의 컴포넌트 ID 와 이름이 같은 파일, 그리고 패키지에서 나온 이름의 스케줄링 설정
      expect(byId!.config.map((file) => path.basename(file))).toEqual([
        'context-brd.xml',
        'context-scheduling-cop-brd.xml',
      ]);
      // 패키지명으로 찾아도 DB 의 컴포넌트 ID 로 설정을 고른다
      expect(byPackage).toEqual(byId);
    });

    it('없는 컴포넌트는 null 이다', () => {
      expect(tools.getComponentSourceFiles('nope')).toBeNull();
    });

    it('포맷한 목록은 개별 파일을 읽는 호출(action readSource)을 안내한다', () => {
      const text = tools.formatComponentSourceFiles(tools.getComponentSourceFiles('brd')!);

      expect(text).toContain('## 테스트 게시판 소스 파일 목록');
      expect(text).toContain('`action: "readSource"`');
      expect(text).toContain('filters.filePath');
      expect(text).not.toContain('read_component_source');
    });
  });

  describe('readComponentSource', () => {
    const javaFile = 'src/main/java/egovframework/com/cop/brd/service/BoardService.java';

    it('소스 루트 기준 상대 경로의 파일을 읽는다', () => {
      const result = tools.readComponentSource(javaFile);

      expect(result).toMatchObject({
        filePath: path.normalize(javaFile),
        content: '// 게시판 서비스\npublic class BoardService {}\n',
        language: 'java',
        encoding: 'utf-8',
        truncated: false,
        nextOffset: null,
      });
      expect(result!.size).toBe(fs.statSync(path.join(srcRoot, javaFile)).size);
    });

    it('options.offset 을 넘기면 그 위치부터 읽는다', () => {
      const offset = '// 게시판 서비스\n'.length;

      expect(tools.readComponentSource(javaFile, { offset })).toMatchObject({
        content: 'public class BoardService {}\n',
        offset,
      });
    });

    it('소스 루트 밖의 파일과 없는 파일은 null 이다', () => {
      expect(tools.readComponentSource('../egovframe.db')).toBeNull();
      expect(tools.readComponentSource(path.join(tmpDir, 'egovframe.db'))).toBeNull();
      expect(tools.readComponentSource('src/Nope.java')).toBeNull();
    });

    it('저장소 메타데이터(.git)는 소스 루트 안에 있어도 null 이다', () => {
      expect(fs.existsSync(path.join(srcRoot, '.git', 'config'))).toBe(true);
      expect(tools.readComponentSource('.git/config')).toBeNull();
    });
  });

  describe('getComponentDDL', () => {
    it('테이블·인덱스·뷰를 추출하고 찾지 못한 객체를 알린다', () => {
      const result = tools.getComponentDDL('brd', 'mysql');

      expect(result).toMatchObject({
        componentId: 'brd',
        componentName: '테스트 게시판',
        dbType: 'mysql',
        tables: ['COMTCCODE', 'COMTNBRD', 'COMVNBRDUSER', 'COMTNMISSING'],
        tableCount: 2,
        viewCount: 1,
        missing: ['COMTNMISSING'],
      });
      expect(result!.ddl).toContain('CREATE INDEX COMTNBRD_i01');
      expect(result!.ddl).not.toContain('OTHER_T');

      const text = tools.formatComponentDDL(result!);
      expect(text).toContain('## 테스트 게시판 DDL (mysql)');
      expect(text).toContain('- **추출된 DDL**: 2개 테이블, 1개 뷰');
      expect(text).toContain('DDL 을 찾지 못한 객체: COMTNMISSING');
    });

    it('외래 키가 참조하는 테이블이 사용 테이블에 없으면 그 테이블의 DDL 도 함께 싣는다', () => {
      const result = tools.getComponentDDL('fkc', 'mysql');

      // 자기 자신을 참조하는 외래 키와, 스크립트에 정의가 없는 테이블을 참조하는 외래 키는 보탤 것이 없다
      expect(result).toMatchObject({
        tables: ['COMTNCHILD'],
        tableCount: 1,
        referencedTables: ['COMTNPARENT'],
        foreignKeyCount: 0,
        missing: [],
      });
      // 참조되는 테이블이 먼저 만들어지도록 스크립트의 순서를 따른다
      expect(result!.ddl.indexOf('CREATE TABLE COMTNPARENT')).toBeGreaterThanOrEqual(0);
      expect(result!.ddl.indexOf('CREATE TABLE COMTNPARENT')).toBeLessThan(result!.ddl.indexOf('CREATE TABLE COMTNCHILD'));

      const text = tools.formatComponentDDL(result!);
      expect(text).toContain('- **추출된 DDL**: 1개 테이블');
      expect(text).toContain('- **외래 키 참조로 함께 실은 테이블**: 1개 (COMTNPARENT)');
    });

    it('외래 키를 ALTER 문으로 따로 두는 DB 는 그 제약을 DDL 끝에 싣고, 참조 테이블을 이어서 따라간다', () => {
      const result = tools.getComponentDDL('brd', 'cubrid');

      expect(result).toMatchObject({
        tables: ['COMTCCODE', 'COMTNBRD', 'COMVNBRDUSER', 'COMTNMISSING'],
        tableCount: 2,
        // COMTNBRD → COMTNBRDMASTER → COMTNTMPLAT
        referencedTables: ['COMTNBRDMASTER', 'COMTNTMPLAT'],
        foreignKeyCount: 2,
        missing: ['COMVNBRDUSER', 'COMTNMISSING'],
      });
      expect(result!.ddl).toContain('CREATE TABLE COMTNBRDMASTER');
      expect(result!.ddl).toContain('CREATE TABLE COMTNTMPLAT');
      expect(result!.ddl).toContain('ALTER CLASS COMTNBRD ADD CONSTRAINT [COMTNBRD_FK1]');
      expect(result!.ddl).toContain('ALTER CLASS COMTNBRDMASTER ADD CONSTRAINT [COMTNBRDMASTER_FK1]');
      // 결과에 없는 테이블(OTHER_T)에 거는 제약은 싣지 않는다
      expect(result!.ddl).not.toContain('OTHER_T');
      // 제약은 모든 CREATE 문 뒤에 온다
      expect(result!.ddl.indexOf('ALTER CLASS')).toBeGreaterThan(result!.ddl.lastIndexOf('CREATE TABLE'));

      const text = tools.formatComponentDDL(result!);
      expect(text).toContain('- **외래 키 참조로 함께 실은 테이블**: 2개 (COMTNBRDMASTER, COMTNTMPLAT)');
      expect(text).toContain('- **외래 키 제약**: 2건');
    });

    it('없는 컴포넌트는 null 이다', () => {
      expect(tools.getComponentDDL('nope', 'mysql')).toBeNull();
    });

    it('지원하지 않는 dbType 은 컴포넌트가 없어도 오류로 알린다', () => {
      const error = catchError(() => tools.getComponentDDL('nope', 'h2'));

      expect(error?.name).toBe('UserFacingError');
      expect(error?.message).toContain('지원하지 않는 DB 타입입니다: h2');
    });

    it('그 DB 의 스크립트가 없으면 찾을 수 없다고 알린다', () => {
      const result = tools.getComponentDDL('brd', 'mariadb');

      expect(result).toMatchObject({ dbType: 'maria', tableCount: 0, viewCount: 0 });
      expect(result!.ddl).toBe('-- DDL 파일을 찾을 수 없습니다: maria');
      expect(result!.missing).toEqual(result!.tables);
    });

    it('사용 테이블이 없는 컴포넌트는 그렇게 알린다', () => {
      expect(tools.getComponentDDL('notbl', 'mysql')).toMatchObject({
        tables: [],
        tableCount: 0,
        viewCount: 0,
        missing: [],
        ddl: '-- 이 컴포넌트에는 사용 테이블이 정의되어 있지 않습니다.',
      });
    });
  });

  describe('getComponentDML', () => {
    it('옵션이 없으면 테이블마다 처음 20건만 돌려준다', () => {
      const result = tools.getComponentDML('brd', 'mysql');

      expect(result).toMatchObject({
        componentId: 'brd',
        dbType: 'mysql',
        table: null,
        statementCount: 22,
        totalCount: 132,
      });
      expect(result!.tableCounts).toEqual([
        { table: 'COMTCCODE', total: 130, shown: 20 },
        { table: 'COMTNBRD', total: 2, shown: 2 },
        { table: 'COMVNBRDUSER', total: 0, shown: 0 },
        { table: 'COMTNMISSING', total: 0, shown: 0 },
      ]);

      const text = tools.formatComponentDML(result!);
      expect(text).toContain('## 테스트 게시판 초기 데이터 (mysql)');
      expect(text).toContain('| COMTCCODE | 130 | 20 | 110 |');
      expect(text).toContain('filters.table');
    });

    it('options.table, limit, offset 으로 한 테이블을 구간 조회한다', () => {
      const result = tools.getComponentDML('brd', 'mysql', { table: 'comtccode', limit: 50, offset: 100 });

      expect(result).toMatchObject({ table: 'COMTCCODE', statementCount: 30, totalCount: 130, offset: 100, limit: 50 });
      expect(result!.dml).toContain("VALUES ('COMTCCODE-101');");
      expect(result!.dml).toContain("VALUES ('COMTCCODE-130');");
      expect(tools.formatComponentDML(result!)).toContain('총 130건 중 101~130');
    });

    it('컴포넌트가 쓰지 않는 테이블은 사용 가능한 테이블과 함께 오류로 알린다', () => {
      const error = catchError(() => tools.getComponentDML('brd', 'mysql', { table: 'OTHER_T' }));

      expect(error?.name).toBe('UserFacingError');
      expect(error?.message).toContain('사용 가능한 테이블: COMTCCODE, COMTNBRD, COMVNBRDUSER, COMTNMISSING');
    });

    it('사용 테이블이 없는 컴포넌트는 그렇게 알리고, table 을 주면 오류로 알린다', () => {
      expect(tools.getComponentDML('notbl', 'mysql')).toMatchObject({
        tables: [],
        statementCount: 0,
        dml: '-- 이 컴포넌트에는 사용 테이블이 정의되어 있지 않습니다.',
      });
      expect(catchError(() => tools.getComponentDML('notbl', 'mysql', { table: 'COMTCCODE' }))?.name).toBe(
        'UserFacingError',
      );
    });

    it('없는 컴포넌트는 table 을 줘도 null 이다', () => {
      expect(tools.getComponentDML('nope', 'mysql')).toBeNull();
      expect(tools.getComponentDML('nope', 'mysql', { table: 'COMTCCODE' })).toBeNull();
    });

    it('그 DB 의 스크립트가 없으면 찾을 수 없다고 알린다', () => {
      expect(tools.getComponentDML('brd', 'oracle')).toMatchObject({
        dbType: 'oracle',
        statementCount: 0,
        totalCount: 0,
        dml: '-- DML 파일을 찾을 수 없습니다: oracle',
      });
    });
  });
});
