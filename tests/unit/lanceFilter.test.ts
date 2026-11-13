/**
 * LanceDB where 절 조립 도우미(src/utils/lanceFilter.ts) 단위 테스트
 *
 * 문자열 값이 리터럴로만 해석되는지를 실제 LanceDB 질의로 확인한다.
 * 임시 디렉토리에 만든 작은 테이블과, 읽기 전용으로 여는 동봉 테이블을 쓴다.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import * as lancedb from "@lancedb/lancedb";
import { lanceEquals, lanceString, quoteFilterValue } from "../../src/utils/lanceFilter.js";
import { GUIDE_TABLE, HAS_BUNDLED_TABLES, openBundledTable } from "./_lanceFixtures.js";

/** 조건을 바꾸거나 질의를 깨뜨리려는 값들 */
const HOSTILE_VALUES = [
  "it's",
  "x' OR '1'='1",
  "x' OR 1=1 --",
  "\\' OR 1=1 --",
  "trailing backslash \\",
  "x'; DROP TABLE t; --",
  "''",
  "'",
  '"double"',
  "line\nbreak",
  "nul\u0000char",
  "%",
  "_",
];

describe("lanceString", () => {
  it("문자열을 작은따옴표로 감싼 리터럴로 만든다", () => {
    expect(lanceString("egovframe-runtime")).toBe("'egovframe-runtime'");
    expect(lanceString("")).toBe("''");
  });

  it("작은따옴표는 두 번 써서 이스케이프한다", () => {
    expect(lanceString("it's")).toBe("'it''s'");
    expect(lanceString("x' OR '1'='1")).toBe("'x'' OR ''1''=''1'");
    expect(lanceString("''")).toBe("''''''");
  });

  it("역슬래시는 이스케이프 문자가 아니므로 그대로 둔다", () => {
    expect(lanceString("a\\'b")).toBe("'a\\''b'");
  });
});

describe("lanceEquals", () => {
  it("컬럼과 문자열 리터럴의 등호 조건을 만든다", () => {
    expect(lanceEquals("layer", "common-component")).toBe("layer = 'common-component'");
    expect(lanceEquals("type", "it's")).toBe("type = 'it''s'");
  });
});

describe("quoteFilterValue", () => {
  it("오류 문구에 넣을 수 있게 값을 따옴표로 감싸고 제어 문자를 이스케이프한다", () => {
    expect(quoteFilterValue("runtime")).toBe('"runtime"');
    expect(quoteFilterValue("a\nb")).toBe('"a\\nb"');
  });

  it("긴 값은 잘라서 보여 준다", () => {
    const quoted = quoteFilterValue("x".repeat(500));
    expect(quoted.length).toBeLessThan(80);
    expect(quoted).toContain("…");
  });

  it("문자열이 아닌 값도 문구로 바꾼다", () => {
    expect(quoteFilterValue(123)).toBe('"123"');
    expect(quoteFilterValue(undefined)).toBe('"undefined"');
  });
});

describe("where 절 리터럴 — 실제 LanceDB 질의", () => {
  let tmpDir: string;
  let table: lancedb.Table;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "egov-lance-filter-"));
    const db = await lancedb.connect(tmpDir);
    table = await db.createTable("t", [
      { id: "1", name: "plain" },
      { id: "2", name: "o'brien" },
      { id: "3", name: "x' OR '1'='1" },
      { id: "4", name: "back\\slash" },
    ]);
  });

  afterAll(async () => {
    await fs.remove(tmpDir);
  });

  it("작은따옴표·역슬래시가 든 저장 값을 정확히 한 행만 찾는다", async () => {
    expect(await table.countRows(lanceEquals("name", "plain"))).toBe(1);
    expect(await table.countRows(lanceEquals("name", "o'brien"))).toBe(1);
    expect(await table.countRows(lanceEquals("name", "x' OR '1'='1"))).toBe(1);
    expect(await table.countRows(lanceEquals("name", "back\\slash"))).toBe(1);
  });

  it("조건을 바꾸려는 값은 어떤 행과도 일치하지 않고 오류도 내지 않는다", async () => {
    for (const value of HOSTILE_VALUES) {
      const expected = value === "x' OR '1'='1" ? 1 : 0;
      expect(await table.countRows(lanceEquals("name", value)), JSON.stringify(value)).toBe(expected);
    }
  });

  it.skipIf(!HAS_BUNDLED_TABLES)("동봉 가이드 테이블에서도 조건이 풀리지 않는다", async () => {
    const guide = await openBundledTable(GUIDE_TABLE);
    const total = await guide.countRows();
    const runtime = await guide.countRows(lanceEquals("layer", "egovframe-runtime"));
    expect(runtime).toBeGreaterThan(0);
    expect(runtime).toBeLessThan(total);
    for (const value of HOSTILE_VALUES) {
      expect(await guide.countRows(lanceEquals("layer", value)), JSON.stringify(value)).toBe(0);
    }
  });
});
