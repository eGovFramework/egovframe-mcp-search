/**
 * 동봉 지식베이스(knowledge-base/egovframe.db)에 대한 키워드 검색 회귀 테스트
 *
 * 고정 데이터로는 드러나지 않고 실제 데이터에서 확인된 문제를 그 데이터로 고정한다.
 * - 한국어 복합어의 뒤쪽이나 가운데에 든 낱말을 찾지 못했다 ("코드" 에 '공통코드' 가 빠졌다).
 * - 흔한 낱말에 군말이 붙으면 0건이었다 ("CMS 추천").
 * - 영문 접속사, 조사가 붙은 제품명, 전각 영숫자로 물으면 0건이었다.
 * - 제품 버전 표기가 검색 대상이 아니었다 ("JEUS 8").
 * - 프레임워크 버전과 확인일자가 검색 대상이 아니었다 (설명에 버전이 적히지 않은 행, "2025", "2024-11").
 * - 제품명을 여럿 나열하거나 영어 문장으로 물으면 0건이었다 ("JEUS Tibero WebLogic").
 * - vendor 필터가 법인 표기까지 같은 행만 돌려줬다 ("(주)아이액츠", "㈜아이액츠", "주식회사 아이액츠").
 * - 한 글자 낱말을 검색어에서 빼, 그 낱말이 가려 주던 행이 나머지 낱말만의 결과에 묻혔다 ("롤 관리", "JEUS 8").
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
import type { CompatibilityQueryResult, CompatibilitySoftwareInfo } from "../../src/types/database.js";
import { idsOf } from "./_componentFixture.js";

const KNOWLEDGE_BASE_DIR = fileURLToPath(new URL("../../knowledge-base/", import.meta.url));
const DB_PATH = path.join(KNOWLEDGE_BASE_DIR, "egovframe.db");

const sha256 = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/** 호환 소프트웨어 행을 가리키는 키 (제품명·버전 표기·프레임워크 버전이 고유하다) */
const keyOf = (row: CompatibilitySoftwareInfo): string =>
  `${row.product_name}|${row.product_version}|${row.framework_version}`;

const rowKeys = (result: CompatibilityQueryResult): string[] => result.rows.map(keyOf);

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

    it('"롤 관리", "웹 로그" 는 한 글자 낱말까지 든 컴포넌트만 돌려준다', () => {
      // 두 글자 이상인 검색어가 있으면 한 글자 검색어를 빼던 때에는 '관리' 가 든 컴포넌트, '로그' 가 든 컴포넌트가
      // 모두 나와, 찾는 컴포넌트(롤관리, 웹로그관리)가 첫 페이지 밖으로 밀렸다
      const cases: Array<[string, string, string]> = [
        ["롤 관리", "관리", "rmt"],
        ["웹 로그", "로그", "wlg"],
      ];
      for (const [query, longerTerm, id] of cases) {
        const result = sqlite.queryComponents({ query });
        expect(idsOf(result.rows), `query=${query}`).toEqual([id]);
        expect(result.matchMode, `query=${query}`).toBe("all-terms");
        expect(result.terms?.dropped, `query=${query}`).toEqual([]);
        expect(result.total, `query=${query}`).toBeLessThan(sqlite.queryComponents({ query: longerTerm }).total);
      }
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

    it('제품명 셋을 나열한 "JEUS Tibero WebLogic" 은 세 제품의 행을 모두 돌려준다', () => {
      // 한 행에 두 제품명이 함께 들 수 없다. 검색어의 절반 이상이 일치하는 행만 찾던 때에는 0건이었다
      const result = compatible("JEUS Tibero WebLogic");
      expect(result.matchMode).toBe("any-term");
      expect(result.terms).toEqual({ used: ["JEUS", "Tibero", "WebLogic"], ignored: [], dropped: [], required: 1 });
      // 제품명 하나씩으로 찾은 행을 합친 것과 같다
      const each = ["JEUS", "Tibero", "WebLogic"].map((name) => rowKeys(compatible(name)));
      expect(each.every((keys) => keys.length > 0)).toBe(true);
      expect(rowSet(result)).toEqual([...new Set(each.flat())].sort());
    });

    it('영어 문장으로 물은 "Is JEUS compatible with eGovFrame 4.3?" 도 0건이 되지 않는다', () => {
      // 다섯 검색어(Is, JEUS, with, eGovFrame, 4.3) 가운데 셋 이상이 든 행이 없어 0건이었다
      const result = compatible("Is JEUS compatible with eGovFrame 4.3?");
      expect(result.matchMode).toBe("any-term");
      expect(result.total).toBeGreaterThan(0);
      expect(result.terms?.used).toEqual(expect.arrayContaining(["JEUS", "4.3"]));
      // 일치한 검색어가 가장 많은 행이 맨 앞이다: 프레임워크 4.3 의 JEUS
      expect(result.rows[0]).toMatchObject({ product_name: "JEUS", framework_version: "4.3" });
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
        expect(result.terms, `query=${withParticle}`).toEqual({ used: [bare], ignored: [], dropped: [], required: 1 });
      }
    });

    it('"JEUS 8" 은 제품 버전 표기가 "JEUS 8" 인 행을 돌려준다', () => {
      const result = compatible("JEUS 8");
      const versions = result.rows.map((row) => row.product_version);
      expect(versions).toContain("JEUS 8");
      // 설명에 '8' 이 없는 행이라 제품 버전 표기를 검색하지 않으면 찾지 못한다
      expect(result.rows.every((row) => row.product_name === "JEUS")).toBe(true);
      // 한 글자 검색어 '8' 도 쓴다. 빼던 때에는 'JEUS' 만 일치하는 JEUS 21 이 맨 앞에 함께 나왔다
      expect(result.matchMode).toBe("all-terms");
      expect(result.terms).toEqual({ used: ["JEUS", "8"], ignored: [], dropped: [], required: 2 });
      expect(versions).toContain("JEUS 8.5");
      expect(versions).not.toContain("JEUS 21");
      expect(result.total).toBeLessThan(compatible("JEUS").total);
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

    it("검색어가 프레임워크 버전과 같으면 설명에 그 버전이 적혀 있지 않은 행도 찾는다", () => {
      // 프레임워크 3.7 의 행 가운데에는 설명에 '3.7' 이 적혀 있지 않은 행이 있다. 부분 문자열로만 찾던 때에는 그 행이 빠졌다
      const byFilter = sqlite.queryCompatibleSoftware({ filters: { frameworkVersion: "3.7" } });
      const unlabelled = byFilter.rows.filter(
        (row) =>
          ![row.product_name, row.product_version, row.vendor, row.category, row.description].some((value) =>
            (value ?? "").includes("3.7"),
          ),
      );
      expect(unlabelled.length).toBeGreaterThan(0);

      for (const query of ["3.7", "v3.7", "3.7.0"]) {
        const result = compatible(query);
        expect(result.matchMode, `query=${query}`).toBe("all-terms");
        expect(rowKeys(result), `query=${query}`).toEqual(expect.arrayContaining(rowKeys(byFilter)));
      }
    });

    it('"eGovFrame 4.3 호환 CMS" 는 이름에 eGovFrame 이 든 행 다음에 프레임워크 4.3 의 CMS Solution 행을 모두 돌려준다', () => {
      const result = compatible("eGovFrame 4.3 호환 CMS");
      const cms43 = sqlite.queryCompatibleSoftware({ filters: { frameworkVersion: "4.3", category: "CMS Solution" } });
      expect(cms43.total).toBeGreaterThan(0);

      // 네 검색어가 모두 든 행은 없다: 'eGovFrame' 이 든 행은 다른 프레임워크 버전의 제품뿐이다
      expect(result.matchMode).toBe("any-term");
      expect(result.terms?.used).toEqual(["eGovFrame", "4.3", "호환", "CMS"]);
      const namedAfterFramework = (row: CompatibilitySoftwareInfo) => /egovframe/i.test(row.product_name);
      const named = result.rows.filter(namedAfterFramework);
      expect(named.length).toBeGreaterThan(0);
      expect(named.every((row) => row.framework_version !== "4.3")).toBe(true);

      // 4.3 의 CMS Solution 행은 4.3·호환·CMS 세 검색어가 일치한다. 이름에 eGovFrame 과 CMS 가 든 행
      // (세 검색어가 일치하고 그 가운데 둘이 이름에 있다)만 그보다 앞에 오고, 나머지 행은 모두 그 뒤다
      const others = result.rows.filter((row) => !namedAfterFramework(row));
      expect(others.slice(0, cms43.total).map(keyOf).sort()).toEqual(rowSet(cms43));
      expect(result.rows.findIndex((row) => row.framework_version === "4.3")).toBeLessThanOrEqual(named.length);
    });

    it('"2025" 는 2025년에 확인된 행을 모두 돌려준다', () => {
      const everyRow = sqlite.queryCompatibleSoftware().rows;
      const verifiedIn2025 = everyRow.filter((row) => row.verified_date.startsWith("2025"));
      // 확인일자를 견주지 않던 때에는 제품 버전 표기에 '2025' 가 든 한 행만 나왔다
      expect(verifiedIn2025.length).toBeGreaterThan(1);

      const result = compatible("2025");
      expect(result.matchMode).toBe("all-terms");
      // 2025년에 확인된 행과, 다른 검색 컬럼에 '2025' 가 적힌 행이 전부다.
      // (이 테스트를 쓴 시점의 동봉 데이터에서는 59건이고, 59건 모두 2025년에 확인된 행이다.)
      const inText = (row: CompatibilitySoftwareInfo) =>
        [row.product_name, row.product_version, row.vendor, row.category, row.description].some((value) =>
          (value ?? "").includes("2025"),
        );
      const expected = everyRow.filter((row) => row.verified_date.startsWith("2025") || inText(row));
      expect(rowSet(result)).toEqual(expected.map(keyOf).sort());
      expect(result.total).toBe(expected.length);
    });

    it('"2024-11" 처럼 연-월로 적으면 그 달에 확인된 행을 돌려준다', () => {
      const result = compatible("2024-11");
      expect(result.matchMode).toBe("all-terms");
      expect(result.total).toBeGreaterThan(0);
      expect(result.rows.every((row) => row.verified_date.startsWith("2024-11"))).toBe(true);
      // 그 달에 확인된 행은 하나도 빠지지 않는다
      const sameMonth = sqlite.queryCompatibleSoftware().rows.filter((row) => row.verified_date.startsWith("2024-11"));
      expect(result.total).toBe(sameMonth.length);
    });

    it("vendor 필터는 법인 표기가 달라도 같은 업체의 행을 모두 돌려준다", () => {
      const byVendor = (vendor: string) => sqlite.queryCompatibleSoftware({ filters: { vendor } });
      // 같은 업체가 '(주)아이액츠', '㈜아이액츠', '주식회사 아이액츠' 세 표기로 들어 있다.
      // 글자 그대로 비교하던 때에는 표기마다 건수가 달랐다 (이 테스트를 쓴 시점에 3건, 1건, 2건이고 합쳐 6건이다)
      const bare = byVendor("아이액츠");
      const spellings = [...new Set(bare.rows.map((row) => row.vendor))];
      expect(spellings.length).toBeGreaterThan(1);

      for (const vendor of [...spellings, "(주)아이액츠", "㈜아이액츠", "주식회사 아이액츠", "아이액츠(주)"]) {
        const result = byVendor(vendor);
        expect(result.total, `vendor=${vendor}`).toBe(bare.total);
        expect(rowSet(result), `vendor=${vendor}`).toEqual(rowSet(bare));
      }
      // 키워드 검색과 함께 줘도 같다
      expect(compatible("Smart", { vendor: "㈜아이액츠" }).total).toBe(compatible("Smart", { vendor: "아이액츠" }).total);
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
