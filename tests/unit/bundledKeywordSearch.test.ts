/**
 * 동봉 지식베이스(knowledge-base/egovframe.db)에 대한 키워드 검색 회귀 테스트
 *
 * 고정 데이터로는 드러나지 않고 실제 데이터에서 확인된 문제를 그 데이터로 고정한다.
 * - 한국어 복합어의 뒤쪽이나 가운데에 든 낱말을 찾지 못했다 ("코드" 에 '공통코드' 가 빠졌다).
 * - 흔한 낱말에 군말이 붙으면 0건이었다 ("CMS 추천").
 * - 영문 접속사, 조사가 붙은 제품명, 전각 영숫자로 물으면 0건이었다.
 * - 제품 버전 표기가 검색 대상이 아니었다 ("JEUS 8").
 *
 * DB 는 읽기 전용으로 열고, 조회가 파일을 바꾸지 않았는지 마지막에 확인한다.
 * 동봉 데이터는 갱신될 수 있으므로 건수를 숫자로 고정하지 않고, 같은 뜻의 두 조회가 같은 결과를 내는지와
 * 꼭 들어 있어야 하는 행이 들어 있는지를 본다.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SQLiteManager } from "../../src/database/sqliteManager.js";
import type { CompatibilityQueryResult } from "../../src/types/database.js";
import { idsOf } from "./_componentFixture.js";

const KNOWLEDGE_BASE_DIR = fileURLToPath(new URL("../../knowledge-base/", import.meta.url));
const DB_PATH = path.join(KNOWLEDGE_BASE_DIR, "egovframe.db");

const sha256 = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/** 호환 소프트웨어 행을 가리키는 키 (제품명·버전 표기·프레임워크 버전이 고유하다) */
const rowKeys = (result: CompatibilityQueryResult): string[] =>
  result.rows.map((row) => `${row.product_name}|${row.product_version}|${row.framework_version}`);

/** 순서와 무관하게 견줄 수 있도록 정렬한 행 키 */
const rowSet = (result: CompatibilityQueryResult): string[] => rowKeys(result).sort();

describe("동봉 지식베이스의 키워드 검색", () => {
  let sqlite: SQLiteManager;
  let hashBefore: string;
  let filesBefore: string[];

  beforeAll(() => {
    hashBefore = sha256(DB_PATH);
    filesBefore = fs.readdirSync(KNOWLEDGE_BASE_DIR).sort();
    sqlite = new SQLiteManager(DB_PATH, { readonly: true });
  });

  afterAll(() => {
    sqlite.close();
  });

  /** 호환 소프트웨어를 limit 없이 조회한다 (조건에 맞는 모든 행) */
  const compatible = (query: string, filters = {}) => sqlite.queryCompatibleSoftware({ query, filters });

  describe("공통컴포넌트", () => {
    it('"코드" 는 이름의 뒤쪽에 그 낱말이 든 공통코드·공통분류코드·공통상세코드도 찾는다', () => {
      const result = sqlite.queryComponents({ query: "코드" });
      expect(result.matchMode).toBe("all-terms");
      expect(idsOf(result.rows)).toEqual(expect.arrayContaining(["cca", "ccc", "cde"]));
      // 이름에 '코드' 가 든 컴포넌트가 설명에만 든 컴포넌트보다 앞에 온다
      const names = result.rows.map((row) => row.name.includes("코드"));
      expect(names.indexOf(false) === -1 || names.lastIndexOf(true) < names.indexOf(false)).toBe(true);
    });

    it("낱말의 가운데에 든 검색어로 찾은 결과도 all-terms 다", () => {
      const result = sqlite.queryComponents({ query: "증서" });
      expect(result.matchMode).toBe("all-terms");
      expect(idsOf(result.rows)).toContain("sec");
    });

    it("컴포넌트 ID 로도 찾는다 (패키지명과 다른 ID)", () => {
      // 'uss-cmt' 의 패키지명은 egovframework.com.uss.cmt 다. ID 에만 'uss-cmt' 가 있다
      expect(idsOf(sqlite.queryComponents({ query: "uss-cmt" }).rows)).toEqual(["uss-cmt"]);
    });
  });

  describe("호환 소프트웨어", () => {
    it('영문 접속사를 섞은 "JEUS OR Tibero", "JEUS and Tibero" 는 "JEUS Tibero" 와 같은 행을 돌려준다', () => {
      const plain = compatible("JEUS Tibero");
      expect(plain.total).toBeGreaterThan(0);
      for (const query of ["JEUS OR Tibero", "JEUS and Tibero", "JEUS AND Tibero", "jeus or tibero"]) {
        const result = compatible(query);
        expect(rowSet(result), `query=${query}`).toEqual(rowSet(plain));
        expect(result.matchMode, `query=${query}`).toBe(plain.matchMode);
      }
      // JEUS 행과 Tibero 행이 모두 들어 있다
      const names = new Set(plain.rows.map((row) => row.product_name));
      expect(names.has("JEUS")).toBe(true);
      expect(names.has("Tibero")).toBe(true);
    });

    it('"CMS 추천" 은 any-term 으로 CMS 행을 돌려준다', () => {
      const cms = compatible("CMS");
      const result = compatible("CMS 추천");
      expect(cms.matchMode).toBe("all-terms");
      expect(cms.total).toBeGreaterThan(0);

      expect(result.matchMode).toBe("any-term");
      // 절반 넘는 행과 일치하는 'CMS' 를 버리던 때에는 0건이었다
      expect(result.total).toBeGreaterThanOrEqual(cms.total);
      // 앞쪽 행은 CMS 가 든 행이다 (CMS 단독 조회의 첫 20건과 같다)
      expect(rowKeys(result).slice(0, 20)).toEqual(rowKeys(cms).slice(0, 20));
      expect(result.terms?.used).toContain("CMS");
    });

    it("조사가 붙은 제품명·업체명·버전은 조사를 뗀 검색어와 같은 행을 돌려준다", () => {
      const pairs: Array<[string, string]> = [
        ["JEUS는", "JEUS"],
        ["티맥스는", "티맥스"],
        ["Tibero를", "Tibero"],
        ["4.3에서", "4.3"],
      ];
      for (const [withParticle, bare] of pairs) {
        const expected = compatible(bare);
        const result = compatible(withParticle);
        expect(expected.total, `query=${bare}`).toBeGreaterThan(0);
        expect(rowSet(result), `query=${withParticle}`).toEqual(rowSet(expected));
        expect(result.terms, `query=${withParticle}`).toEqual({ used: [bare], ignored: [] });
      }
    });

    it('"JEUS 8" 은 제품 버전 표기가 "JEUS 8" 인 행을 돌려준다', () => {
      const result = compatible("JEUS 8");
      expect(result.rows.map((row) => row.product_version)).toContain("JEUS 8");
      // 설명에 '8' 이 없는 행이라 제품 버전 표기를 검색하지 않으면 찾지 못한다
      expect(result.rows.every((row) => row.product_name === "JEUS")).toBe(true);
    });

    it('전각으로 입력한 "ＣＭＳ" 는 "CMS" 와 같은 건수를 돌려준다', () => {
      const half = compatible("CMS");
      const full = compatible("ＣＭＳ");
      expect(full.total).toBe(half.total);
      expect(full.total).toBeGreaterThan(0);
      expect(rowKeys(full)).toEqual(rowKeys(half));
      // 전각 숫자와 전각 공백도 같다
      expect(compatible("ＪＥＵＳ\u3000２１").total).toBe(compatible("JEUS 21").total);
    });

    it('업체명의 뒤쪽에 든 "소프트" 로 그 낱말이 든 모든 행을 찾는다', () => {
      const result = compatible("소프트");
      expect(result.matchMode).toBe("all-terms");
      const contains = (value: string | undefined) => (value ?? "").includes("소프트");
      expect(
        result.rows.every((row) =>
          [row.product_name, row.product_version, row.vendor, row.category, row.description].some(contains),
        ),
      ).toBe(true);
      // 낱말 단위 접두 일치로는 '소프트' 로 시작하는 낱말이 든 세 행만 나왔다
      expect(result.total).toBeGreaterThan(3);
      expect(result.rows.some((row) => row.vendor.includes("티맥스소프트"))).toBe(true);
    });

    it("필터를 함께 줘도 군말이 붙은 query 가 0건이 되지 않는다", () => {
      const filters = { frameworkVersion: "4.3" };
      const cms = compatible("CMS", filters);
      const result = compatible("CMS 추천", filters);
      expect(cms.total).toBeGreaterThan(0);
      expect(rowSet(result)).toEqual(rowSet(cms));
      expect(result.rows.every((row) => row.framework_version === "4.3")).toBe(true);
    });

    it("이름에 검색어가 든 행을 확인일자가 최근인 순으로 먼저 돌려준다", () => {
      const firstPage = sqlite.queryCompatibleSoftware({ query: "CMS", limit: 20 }).rows;
      expect(firstPage).toHaveLength(20);
      const inName = (row: { product_name: string; product_version: string }) =>
        /cms/i.test(row.product_name) || /cms/i.test(row.product_version);
      expect(firstPage.every(inName)).toBe(true);
      const dates = firstPage.map((row) => row.verified_date);
      expect(dates).toEqual([...dates].sort().reverse());
    });
  });

  it("조회는 DB 파일을 바꾸지 않고 부속 파일(-wal, -shm)도 만들지 않는다", () => {
    expect(sha256(DB_PATH)).toBe(hashBefore);
    expect(fs.readdirSync(KNOWLEDGE_BASE_DIR).sort()).toEqual(filesBefore);
  });
});
