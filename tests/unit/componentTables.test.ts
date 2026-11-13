/**
 * 공통컴포넌트의 사용 테이블 목록(use_tables)을 소스 트리에서 도출하는 규칙 단위 테스트
 *
 * 메타(templates/common-components.json)의 useTables 는 빈 칸이 앞 항목의 값으로 채워져 있어
 * 믿을 수 없다 (공통코드의 사용 테이블이 출퇴근 테이블로 적혀 있다). 적재할 때 소스 트리의
 * 컴포넌트별 DDL 스크립트와 매퍼 XML 에서 목록을 다시 만든다.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  deriveComponentTables,
  loadComponentTableContext,
  readCreatedObjectNames,
  type ComponentTableContext,
} from "../../src/kb/componentTables.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BUNDLED_SRC = path.join(REPO_ROOT, "templates", "common-components-src");
const HAS_BUNDLED_SRC = fs.existsSync(path.join(BUNDLED_SRC, "src", "script", "ddl", "mysql"));

describe("readCreatedObjectNames", () => {
  it("CREATE TABLE 과 CREATE VIEW 가 만드는 이름을 스크립트 순서대로 돌려준다", () => {
    const sql = [
      "/* 주석 */",
      "CREATE TABLE COMTECOPSEQ",
      "(",
      "  TABLE_NAME VARCHAR(20) NOT NULL",
      ");",
      "CREATE UNIQUE INDEX COMTECOPSEQ_PK ON COMTECOPSEQ (TABLE_NAME);",
      "create table comtnbbs (id int);",
      "CREATE OR REPLACE VIEW COMVNUSERMASTER AS SELECT 1;",
      "  CREATE VIEW OTHER_V AS SELECT 2;",
    ].join("\n");

    expect(readCreatedObjectNames(sql)).toEqual(["COMTECOPSEQ", "comtnbbs", "COMVNUSERMASTER", "OTHER_V"]);
  });

  it("인덱스와 문장 중간의 CREATE TABLE 문구는 세지 않고, 같은 이름은 한 번만 돌려준다", () => {
    const sql = [
      "CREATE TABLE A (ID INT);",
      "CREATE INDEX A_I ON A (ID);",
      "INSERT INTO LOG (T) VALUES ('CREATE TABLE B (ID INT)');",
      "CREATE TABLE a (ID INT);",
    ].join("\n");

    expect(readCreatedObjectNames(sql)).toEqual(["A"]);
  });
});

describe("loadComponentTableContext / deriveComponentTables (임시 소스 트리)", () => {
  let root: string;
  let ctx: ComponentTableContext;

  const BASE = ["COMTECOPSEQ", "COMTCCMMNCODE"];
  const ddl = (...tables: string[]) => tables.map((t) => `CREATE TABLE ${t}\n(\n  ID INT\n)\n;\n`).join("\n");
  const write = (rel: string, content: string) => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  const mapper = (pkgPath: string, name: string, sql: string) =>
    write(`src/main/resources/egovframework/mapper/${pkgPath}/${name}`, `<mapper><select>${sql}</select></mapper>`);

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "egov-comp-tables-"));
    // 통합 스크립트: 알려진 테이블 전체
    write(
      "script/ddl/mysql/com_DDL_mysql.sql",
      ddl(...BASE, "COMTNBBS", "COMTNBBSMASTER", "COMTNBLOG", "COMTNSCHDULINFO", "COMTNDIARYINFO", "COMTNQESTNRINFO", "COMTNSTSFDG", "COMTNCOMMUTE") +
        "\nCREATE VIEW COMVNUSERMASTER AS SELECT 1;\n",
    );
    // 컴포넌트별 스크립트: 기반 테이블 + 자기 테이블
    write("src/script/ddl/mysql/cop.bbs_create_mysql.sql", ddl(...BASE, "COMTNBBSMASTER", "COMTNBBS"));
    write("src/script/ddl/mysql/cop.smt_create_mysql.sql", ddl(...BASE, "COMTNSCHDULINFO", "COMTNDIARYINFO"));
    // 자기 매퍼가 쓰는 테이블(COMTNSTSFDG)이 스크립트에서 빠져 있는 경우
    write("src/script/ddl/mysql/cop.stf_create_mysql.sql", ddl(...BASE, "COMTNBBS"));

    mapper("com/cop/bbs", "EgovBoard_SQL_mysql.xml", "SELECT * FROM COMTNBBS a JOIN comtnblog b ON a.ID = b.ID");
    mapper("com/cop/stf", "EgovStsfdg_SQL_mysql.xml", "SELECT * FROM COMTNSTSFDG");
    mapper("com/uss/olp/qmc", "EgovQustnr_SQL_oracle.xml", "SELECT * FROM COMTNQESTNRINFO WHERE NAME = 'COMTNBBSX'");

    const loaded = loadComponentTableContext(root);
    if (!loaded) throw new Error("임시 소스 트리에서 컨텍스트를 만들지 못했습니다");
    ctx = loaded;
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("컴포넌트별 스크립트와 통합 스크립트에서 이름을 읽고, 모든 스크립트에 공통인 테이블을 기반 테이블로 본다", () => {
    expect([...ctx.scriptTables.keys()].sort()).toEqual(["cop.bbs", "cop.smt", "cop.stf"]);
    expect(ctx.baseTables).toEqual(BASE);
    expect(ctx.knownTables).toContain("COMVNUSERMASTER");
  });

  it("자기 패키지의 스크립트가 있으면 그 스크립트가 만드는 테이블을 쓰고, 자기 매퍼가 쓰는 테이블을 더한다", () => {
    const result = deriveComponentTables(
      { packageName: "egovframework.com.cop.bbs", useTables: ["COMTNCOMMUTE"] },
      undefined,
      ctx,
    );

    expect(result.source).toBe("script");
    // 스크립트 순서 그대로, 그 뒤에 매퍼에서만 나온 테이블(COMTNBLOG, 대소문자 무시)
    expect(result.tables).toEqual([...BASE, "COMTNBBSMASTER", "COMTNBBS", "COMTNBLOG"]);
    // 메타에 적혀 있던 무관한 테이블은 들어가지 않는다
    expect(result.tables).not.toContain("COMTNCOMMUTE");
  });

  it("스크립트가 자기 매퍼의 테이블을 빠뜨렸어도 매퍼의 테이블이 들어간다", () => {
    const result = deriveComponentTables({ packageName: "egovframework.com.cop.stf", useTables: [] }, undefined, ctx);

    expect(result.source).toBe("script");
    expect(result.tables).toContain("COMTNSTSFDG");
  });

  it("자기 패키지의 스크립트가 없으면 가장 가까운 상위 패키지의 스크립트를 쓴다", () => {
    const result = deriveComponentTables(
      { packageName: "egovframework.com.cop.smt.sim", useTables: ["COMTNCOMMUTE"] },
      undefined,
      ctx,
    );

    expect(result.source).toBe("parent-script");
    expect(result.tables).toEqual([...BASE, "COMTNSCHDULINFO", "COMTNDIARYINFO"]);
  });

  it("스크립트가 없고 매퍼가 있으면 기반 테이블에 매퍼가 쓰는 테이블을 더한다", () => {
    const result = deriveComponentTables(
      { packageName: "egovframework.com.uss.olp.qmc", useTables: ["COMTNCOMMUTE"] },
      undefined,
      ctx,
    );

    expect(result.source).toBe("mapper");
    // 문자열 값 안의 COMTNBBSX 는 COMTNBBS 와 다른 낱말이라 세지 않는다
    expect(result.tables).toEqual([...BASE, "COMTNQESTNRINFO"]);
  });

  it("스크립트도 매퍼도 없으면 메타의 목록을 그대로 쓴다", () => {
    const result = deriveComponentTables(
      { packageName: "egovframework.com.ext.fbk", useTables: ["USERCONNECTION"] },
      ["COMTNBBS"],
      ctx,
    );

    expect(result).toEqual({ source: "meta", tables: ["USERCONNECTION"] });
  });

  it("스크립트도 매퍼도 없는데 메타의 목록이 바로 앞 항목과 같으면 채워 내려진 값으로 보고 기반 테이블만 쓴다", () => {
    const filledDown = ["COMTECOPSEQ", "COMTNCOMMUTE"];
    const result = deriveComponentTables(
      { packageName: "egovframework.com.ext.msg", useTables: filledDown },
      [...filledDown],
      ctx,
    );

    expect(result).toEqual({ source: "base", tables: BASE });
  });

  it("컴포넌트별 스크립트 디렉토리가 없는 소스 트리에서는 컨텍스트를 만들지 않는다", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "egov-comp-tables-empty-"));
    try {
      expect(loadComponentTableContext(empty)).toBeNull();
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!HAS_BUNDLED_SRC)("deriveComponentTables — 동봉 소스 트리와 메타", () => {
  const meta = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "templates", "common-components.json"), "utf-8"),
  ) as { components: Array<{ id: string; name: string; packageName: string; useTables: string[] }> };
  let ctx: ComponentTableContext;

  const derive = (name: string) => {
    const index = meta.components.findIndex((component) => component.name === name);
    return deriveComponentTables(meta.components[index], meta.components[index - 1]?.useTables, ctx);
  };

  /** 컴포넌트의 매퍼 XML 이 참조하는 테이블을 테스트가 따로 계산한다 (구현과 다른 방식: 정규식 낱말 경계). */
  const mapperTablesOf = (packageName: string): string[] => {
    const dir = path.join(BUNDLED_SRC, "src/main/resources/egovframework/mapper", ...packageName.split(".").slice(1));
    if (!fs.existsSync(dir)) return [];
    const files = (fs.readdirSync(dir, { recursive: true }) as string[]).filter((file) => file.endsWith(".xml"));
    const text = files.map((file) => fs.readFileSync(path.join(dir, file), "utf-8").toUpperCase()).join("\n");
    return ctx.knownTables.filter((table) => new RegExp(`\\b${table.toUpperCase()}\\b`).test(text));
  };

  beforeAll(() => {
    const loaded = loadComponentTableContext(BUNDLED_SRC);
    if (!loaded) throw new Error("동봉 소스 트리에서 컨텍스트를 만들지 못했습니다");
    ctx = loaded;
  });

  it("공통코드는 출퇴근 테이블이 아니라 공통코드 테이블을 쓴다", () => {
    const { tables } = derive("공통코드");
    expect(tables).toContain("COMTCCMMNCODE");
    expect(tables).toContain("COMTCCMMNCLCODE");
    expect(tables).not.toContain("COMTNCOMMUTE");
  });

  it("메뉴생성관리는 개인정보 로그 테이블이 아니라 메뉴 테이블을 쓴다", () => {
    const { tables, source } = derive("메뉴생성관리");
    expect(source).toBe("parent-script");
    expect(tables).toContain("COMTNMENUINFO");
    expect(tables).not.toContain("COMTNPRIVACYLOG");
  });

  it("모든 컴포넌트의 목록에 자기 매퍼가 쓰는 테이블이 들어 있다", () => {
    const missing: string[] = [];
    meta.components.forEach((component, index) => {
      const derived = new Set(
        deriveComponentTables(component, meta.components[index - 1]?.useTables, ctx).tables.map((t) => t.toUpperCase()),
      );
      const lacking = mapperTablesOf(component.packageName).filter((table) => !derived.has(table.toUpperCase()));
      if (lacking.length > 0) missing.push(`${component.id}(${component.name}): ${lacking.join(", ")}`);
    });
    expect(missing).toEqual([]);
  });

  it("도출한 이름은 모두 통합 DDL 스크립트에 정의되어 있거나 메타에서 온 이름이다", () => {
    const known = new Set(ctx.knownTables.map((table) => table.toUpperCase()));
    const unknown: string[] = [];
    meta.components.forEach((component, index) => {
      const result = deriveComponentTables(component, meta.components[index - 1]?.useTables, ctx);
      if (result.source === "meta") return;
      for (const table of result.tables) {
        if (!known.has(table.toUpperCase())) unknown.push(`${component.id}: ${table}`);
      }
    });
    expect(unknown).toEqual([]);
  });

  it("목록의 출처는 스크립트가 가장 많고, 메타를 그대로 쓰는 컴포넌트는 소수다", () => {
    const counts: Record<string, number> = {};
    meta.components.forEach((component, index) => {
      const { source } = deriveComponentTables(component, meta.components[index - 1]?.useTables, ctx);
      counts[source] = (counts[source] ?? 0) + 1;
    });
    expect(counts.script).toBeGreaterThan(100);
    expect(counts.meta ?? 0).toBeLessThan(5);
  });
});
