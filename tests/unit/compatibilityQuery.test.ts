/**
 * SQLiteManager 호환 소프트웨어 조회 단위 테스트
 *
 * 키워드 조회(queryCompatibleSoftware)의 동작을 고정한다.
 * 임시 디렉토리의 새 DB 만 사용한다 (knowledge-base/egovframe.db 에 의존하지 않음).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { SQLiteManager } from "../../src/database/sqliteManager.js";
import { CATALOGUE, versionsOf } from "./_compatibilityFixture.js";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";

describe("SQLiteManager 호환 소프트웨어 조회", () => {
  let tmpDir: string;
  let sqlite: SQLiteManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "egov-compat-query-"));
    sqlite = new SQLiteManager(path.join(tmpDir, "egovframe.db"));
    sqlite.addCompatibilitySoftwareBatch(CATALOGUE);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    sqlite.close();
    await fs.remove(tmpDir);
  });

  describe("부분 일치 대체 검색", () => {
    it("모든 검색어가 일치하는 행이 있으면 그 행만 돌려주고 matchMode 는 all-terms 다", () => {
      const result = sqlite.queryCompatibleSoftware({ query: "JEUS" });
      expect(versionsOf(result.rows).sort()).toEqual(["JEUS 21", "JEUS 8.5"]);
      expect(result.matchMode).toBe("all-terms");
    });

    it("낱말 중간에 있는 검색어는 부분 문자열로 찾고 matchMode 는 any-term 이다", () => {
      // '한국오라클' 은 한 토큰이라 접두 일치("오라클"*)로는 찾지 못한다
      const result = sqlite.queryCompatibleSoftware({ query: "오라클" });
      expect(versionsOf(result.rows)).toEqual(["WebLogic 12c"]);
      expect(result.matchMode).toBe("any-term");
    });

    it("절반을 넘는 행에 들어 있는 검색어는 빼고, 남은 검색어로 찾는다", () => {
      // 호환: 6행 모두(제외) / JEUS: 2행 / 여부: 0행 → k=2, 한 개 이상 일치하면 통과
      const result = sqlite.queryCompatibleSoftware({ query: "JEUS 호환 여부" });
      expect(versionsOf(result.rows)).toEqual(["JEUS 21", "JEUS 8.5"]);
      expect(result.matchMode).toBe("any-term");
    });

    it("남은 검색어의 절반 이상(올림)이 일치하는 행만 돌려준다", () => {
      // JEUS: 2행 / 8.5: 1행 / Tibero: 1행 / 여부: 0행 → k=4, 두 개 이상 일치해야 통과
      const result = sqlite.queryCompatibleSoftware({ query: "JEUS 8.5 Tibero 여부" });
      expect(versionsOf(result.rows)).toEqual(["JEUS 8.5"]);
    });

    it("정확히 절반의 행에 들어 있는 검색어는 빼지 않는다", () => {
      // 맥스: 3행(절반) / 없는말: 0행 → k=2, 한 개 이상 일치하면 통과
      const result = sqlite.queryCompatibleSoftware({ query: "맥스 없는말" });
      expect(versionsOf(result.rows).sort()).toEqual(["JEUS 21", "JEUS 8.5", "Tibero 7"]);
    });

    it("일치한 검색어 수가 많은 행을 먼저, 같으면 확인일자가 최근인 행을 먼저 돌려준다", () => {
      // 맥스: JEUS 두 행과 Tibero / JEUS: JEUS 두 행 → JEUS 두 행은 2개, Tibero 는 1개 일치
      const result = sqlite.queryCompatibleSoftware({ query: "맥스 JEUS" });
      expect(versionsOf(result.rows)).toEqual(["JEUS 21", "JEUS 8.5", "Tibero 7"]);
      expect(result.matchMode).toBe("any-term");
    });

    it("변별력 있는 검색어가 하나도 남지 않으면 빈 결과를 돌려준다", () => {
      // 호환: 6행 모두 / 프레임: 6행 모두('표준프레임워크' 의 중간) → k=0
      const result = sqlite.queryCompatibleSoftware({ query: "호환 프레임" });
      expect(result.rows).toEqual([]);
      expect(result.matchMode).toBe("any-term");
    });

    it("한 글자 검색어는 대체 검색에서 쓰지 않는다", () => {
      // X, Y 를 검색어로 세면 k=3 이 되어 '오라클' 하나만 일치하는 행이 탈락한다
      const result = sqlite.queryCompatibleSoftware({ query: "X Y 오라클" });
      expect(versionsOf(result.rows)).toEqual(["WebLogic 12c"]);
    });

    it("글자 수는 코드 포인트로 센다 (UTF-16 두 단위로 표현되는 한 글자도 한 글자다)", () => {
      // '𠀀', '𠀁' 는 한 글자지만 String.length 는 2 다
      expect("𠀀".length).toBe(2);
      const result = sqlite.queryCompatibleSoftware({ query: "𠀀 𠀁 오라클" });
      expect(versionsOf(result.rows)).toEqual(["WebLogic 12c"]);
    });

    it("검색어의 LIKE 와일드카드는 글자 그대로 비교한다", () => {
      // '_' 가 와일드카드였다면 '티맥스소프트' 가 일치했을 것
      expect(sqlite.queryCompatibleSoftware({ query: "티맥_소프트" }).rows).toEqual([]);
    });

    it("limit 은 대체 검색 결과에도 적용된다", () => {
      const result = sqlite.queryCompatibleSoftware({ query: "맥스 JEUS", limit: 1 });
      expect(versionsOf(result.rows)).toEqual(["JEUS 21"]);
    });

    it("LIKE 패턴 길이 한도를 넘는 검색어가 있어도 오류 없이 처리한다", () => {
      const huge = "가".repeat(20000); // UTF-8 60,000 바이트 — SQLite LIKE 패턴 한도(50,000)를 넘는다
      expect(sqlite.queryCompatibleSoftware({ query: huge }).rows).toEqual([]);
      // 한도를 넘는 검색어는 어떤 행과도 일치하지 않는 검색어로 센다 (k=2, 한 개 이상 일치)
      expect(versionsOf(sqlite.queryCompatibleSoftware({ query: `오라클 ${huge}` }).rows)).toEqual([
        "WebLogic 12c",
      ]);
    });

    it("FTS5 가 MATCH 식을 해석하지 못하면 부분 일치 검색으로 넘어간다", () => {
      // 지금의 MATCH 식 조립으로는 구문 오류가 나지 않으므로, 오류를 흉내 내어 안전망을 확인한다
      const db = (sqlite as any).db;
      const prepare = db.prepare.bind(db);
      vi.spyOn(db, "prepare").mockImplementation((sql: unknown) => {
        if (String(sql).includes("MATCH")) {
          throw new Database.SqliteError('fts5: syntax error near "?"', "SQLITE_ERROR");
        }
        return prepare(sql);
      });

      const result = sqlite.queryCompatibleSoftware({ query: "JEUS" });
      expect(versionsOf(result.rows)).toEqual(["JEUS 21", "JEUS 8.5"]);
      expect(result.matchMode).toBe("any-term");
    });

    it("FTS5 질의 오류가 아닌 오류는 다른 검색으로 바꾸지 않고 그대로 던진다", () => {
      (sqlite as any).db.exec("DROP TABLE compatibility_fts");
      expect(() => sqlite.queryCompatibleSoftware({ query: "JEUS" })).toThrow(/compatibility_fts/);
    });
  });

  describe("필터", () => {
    it("query 없이 필터만 주면 확인일자가 최근인 순으로 돌려주고 matchMode 는 넣지 않는다", () => {
      const result = sqlite.queryCompatibleSoftware({ filters: { category: "WAS" } });
      expect(versionsOf(result.rows)).toEqual(["JEUS 21", "JEUS 8.5", "WebLogic 12c"]);
      expect(result.matchMode).toBeUndefined();
    });

    it("키워드와 필터를 모두 만족하는 행만 돌려준다", () => {
      const result = sqlite.queryCompatibleSoftware({ query: "JEUS", filters: { frameworkVersion: "4.3" } });
      expect(versionsOf(result.rows)).toEqual(["JEUS 21"]);
      expect(result.matchMode).toBe("all-terms");
    });

    it("minLevel 과 vendor, productName 필터도 키워드와 함께 적용한다", () => {
      // 'CMS' 는 카테고리 'CMS Solution' 의 두 행과 일치하고, 그중 레벨 2 는 OtherCMS 뿐이다
      expect(versionsOf(sqlite.queryCompatibleSoftware({ query: "CMS", filters: { minLevel: 2 } }).rows)).toEqual([
        "OtherCMS 2.0",
      ]);
      expect(versionsOf(sqlite.queryCompatibleSoftware({ query: "CMS", filters: { vendor: "샘플" } }).rows)).toEqual([
        "SampleCMS 1.0",
      ]);
      expect(
        versionsOf(sqlite.queryCompatibleSoftware({ query: "CMS", filters: { productName: "othercms" } }).rows),
      ).toEqual(["OtherCMS 2.0"]);
    });

    it("필터는 LIMIT 보다 먼저 적용한다", () => {
      // 필터를 나중에 적용하면 상위 1건(다른 버전)만 남긴 뒤 걸러 0건이 된다
      for (const frameworkVersion of ["4.0", "4.3"]) {
        const result = sqlite.queryCompatibleSoftware({ query: "JEUS", filters: { frameworkVersion }, limit: 1 });
        expect(result.rows.map((row) => row.framework_version)).toEqual([frameworkVersion]);
      }
    });

    it("필터까지 만족하는 행이 없으면 부분 일치 검색으로 넘어가고, 거기에도 필터를 적용한다", () => {
      // '티맥스 JEUS' 는 JEUS 두 행과 일치하지만 둘 다 WAS 다.
      // 대체 검색: 티맥스 3행, JEUS 2행 → 한 개 이상 일치하는 DBMS 행은 Tibero 뿐
      const result = sqlite.queryCompatibleSoftware({ query: "티맥스 JEUS", filters: { category: "DBMS" } });
      expect(versionsOf(result.rows)).toEqual(["Tibero 7"]);
      expect(result.matchMode).toBe("any-term");
    });

    it("query 에서 검색어가 하나도 추출되지 않으면 query 가 없는 것으로 보고 필터만 적용한다", () => {
      for (const query of ["*", ".", "?!", '"-"', "   "]) {
        const result = sqlite.queryCompatibleSoftware({ query, filters: { frameworkVersion: "4.3" } });
        expect(versionsOf(result.rows), `query=${JSON.stringify(query)}`).toEqual(["JEUS 21", "SampleCMS 1.0"]);
        expect(result.matchMode).toBeUndefined();
      }
    });

    it("category 는 대소문자를 구분하지 않고 일치시킨다", () => {
      for (const category of ["WAS", "was", "Was"]) {
        const result = sqlite.queryCompatibleSoftware({ filters: { category } });
        expect(versionsOf(result.rows), `category=${category}`).toEqual(["JEUS 21", "JEUS 8.5", "WebLogic 12c"]);
      }
      expect(versionsOf(sqlite.queryCompatibleSoftware({ query: "티맥스", filters: { category: "dbms" } }).rows)).toEqual([
        "Tibero 7",
      ]);
      // 부분 일치는 아니다
      expect(sqlite.queryCompatibleSoftware({ filters: { category: "CMS" } }).rows).toEqual([]);
    });

    it("문자열 필터는 앞뒤 공백을 떼고 비교한다", () => {
      expect(versionsOf(sqlite.queryCompatibleSoftware({ filters: { category: " WAS\n" } }).rows)).toHaveLength(3);
      expect(versionsOf(sqlite.queryCompatibleSoftware({ filters: { frameworkVersion: " 4.3 " } }).rows)).toEqual([
        "JEUS 21",
        "SampleCMS 1.0",
      ]);
      expect(versionsOf(sqlite.queryCompatibleSoftware({ filters: { vendor: " 샘플벤더 " } }).rows)).toEqual([
        "SampleCMS 1.0",
      ]);
      expect(versionsOf(sqlite.queryCompatibleSoftware({ filters: { productName: "\tTibero " } }).rows)).toEqual([
        "Tibero 7",
      ]);
      // 공백뿐인 필터는 주지 않은 것과 같다
      expect(sqlite.queryCompatibleSoftware({ filters: { vendor: "   " } }).rows).toHaveLength(CATALOGUE.length);
    });

    it("productName 은 제품명 또는 제품 버전 표기에 부분 일치하면 통과시킨다", () => {
      // 응답에 표시되는 product_version('JEUS 8.5')을 그대로 넣어도 찾을 수 있어야 한다
      expect(versionsOf(sqlite.queryCompatibleSoftware({ filters: { productName: "JEUS 8.5" } }).rows)).toEqual([
        "JEUS 8.5",
      ]);
      expect(versionsOf(sqlite.queryCompatibleSoftware({ filters: { productName: "12c" } }).rows)).toEqual([
        "WebLogic 12c",
      ]);
      expect(versionsOf(sqlite.queryCompatibleSoftware({ filters: { productName: "JEUS" } }).rows)).toEqual([
        "JEUS 21",
        "JEUS 8.5",
      ]);
      // 키워드와 함께 줄 때도 같다
      expect(
        versionsOf(sqlite.queryCompatibleSoftware({ query: "티맥스", filters: { productName: "jeus 21" } }).rows),
      ).toEqual(["JEUS 21"]);
      // 버전 표기와 비교할 때도 와일드카드는 글자 그대로 본다 ('_' 가 공백과 일치하면 안 된다)
      expect(sqlite.queryCompatibleSoftware({ filters: { productName: "JEUS_8" } }).rows).toEqual([]);
    });

    it("searchCompatibleSoftware 는 같은 필터 조회 결과를 배열로 돌려준다", () => {
      expect(versionsOf(sqlite.searchCompatibleSoftware({ category: "WAS" }, 2))).toEqual(["JEUS 21", "JEUS 8.5"]);
      expect(sqlite.searchCompatibleSoftware()).toHaveLength(CATALOGUE.length);
    });
  });

  describe("전체 건수와 페이지", () => {
    it("total 은 limit 과 무관하게 조건에 맞는 전체 건수다", () => {
      const result = sqlite.queryCompatibleSoftware({ filters: { category: "WAS" }, limit: 2 });
      expect(versionsOf(result.rows)).toEqual(["JEUS 21", "JEUS 8.5"]);
      expect(result.total).toBe(3);
      expect(sqlite.queryCompatibleSoftware().total).toBe(CATALOGUE.length);
    });

    it("offset 만큼 건너뛴 다음 행부터 돌려준다", () => {
      const result = sqlite.queryCompatibleSoftware({ filters: { category: "WAS" }, limit: 2, offset: 2 });
      expect(versionsOf(result.rows)).toEqual(["WebLogic 12c"]);
      expect(result.total).toBe(3);
    });

    it("키워드 검색(all-terms)에도 total 과 offset 을 적용한다", () => {
      const all = sqlite.queryCompatibleSoftware({ query: "표준프레임워크" });
      expect(all.total).toBe(CATALOGUE.length);
      expect(all.matchMode).toBe("all-terms");

      const paged = [0, 2, 4].flatMap(
        (offset) => sqlite.queryCompatibleSoftware({ query: "표준프레임워크", limit: 2, offset }).rows,
      );
      expect(versionsOf(paged)).toEqual(versionsOf(all.rows));
    });

    it("부분 일치 대체 검색(any-term)에도 total 과 offset 을 적용한다", () => {
      const result = sqlite.queryCompatibleSoftware({ query: "맥스 JEUS", limit: 1, offset: 2 });
      expect(versionsOf(result.rows)).toEqual(["Tibero 7"]);
      expect(result.total).toBe(3);
      expect(result.matchMode).toBe("any-term");
    });

    it("offset 이 전체 건수를 넘으면 빈 페이지를 돌려주되, 검색 방식은 바꾸지 않는다", () => {
      const result = sqlite.queryCompatibleSoftware({ query: "JEUS", offset: 10 });
      expect(result.rows).toEqual([]);
      expect(result.total).toBe(2);
      expect(result.matchMode).toBe("all-terms");
    });

    it("확인일자가 같은 행이 있어도 페이지를 넘길 때 순서가 흔들리지 않는다", () => {
      sqlite.addCompatibilitySoftwareBatch(
        Array.from({ length: 5 }, (_, index) => ({
          ...CATALOGUE[5],
          product_name: `SameDay${index}`,
          product_version: `SameDay${index} 1.0`,
        })),
      );
      const all = sqlite.queryCompatibleSoftware();
      const paged = Array.from({ length: all.total }, (_, offset) =>
        sqlite.queryCompatibleSoftware({ limit: 1, offset }).rows,
      ).flat();
      expect(all.total).toBe(CATALOGUE.length + 5);
      expect(versionsOf(paged)).toEqual(versionsOf(all.rows));
      expect(new Set(versionsOf(paged)).size).toBe(all.total);
    });

    it("limit 과 offset 은 정수로 맞추고, 범위를 벗어난 값도 SQL 오류 없이 처리한다", () => {
      const count = (limit?: number, offset?: number) => sqlite.queryCompatibleSoftware({ limit, offset }).rows.length;
      expect(count(2.7)).toBe(2);
      expect(count(0)).toBe(1);
      expect(count(-5)).toBe(1);
      expect(count(1e300)).toBe(CATALOGUE.length);
      expect(count(undefined)).toBe(CATALOGUE.length);
      expect(count(undefined, -1)).toBe(CATALOGUE.length);
      expect(count(undefined, 1.9)).toBe(CATALOGUE.length - 1);
      expect(count(undefined, Number.NaN)).toBe(CATALOGUE.length);
      expect(count(undefined, 1e300)).toBe(0);
      // 키워드 검색 경로도 같다
      expect(sqlite.queryCompatibleSoftware({ query: "JEUS", limit: 1.5, offset: 0.5 }).rows).toHaveLength(1);
    });
  });

  describe("결과 행의 컬럼", () => {
    const PUBLIC_COLUMNS = [
      "product_name",
      "product_version",
      "framework_version",
      "category",
      "compatibility_level",
      "vendor",
      "verified_date",
      "description",
      "url",
    ];

    it("내부용 id 와 created_at 을 빼고 정해진 컬럼만 돌려준다", () => {
      const listed = sqlite.queryCompatibleSoftware({ filters: { category: "WAS" } });
      const allTerms = sqlite.queryCompatibleSoftware({ query: "JEUS" });
      const anyTerm = sqlite.queryCompatibleSoftware({ query: "오라클" });
      expect(allTerms.matchMode).toBe("all-terms");
      expect(anyTerm.matchMode).toBe("any-term");

      for (const result of [listed, allTerms, anyTerm]) {
        expect(result.rows.length).toBeGreaterThan(0);
        for (const row of result.rows) {
          expect(Object.keys(row)).toEqual(PUBLIC_COLUMNS);
        }
      }
    });

    it("배열을 돌려주는 기존 메서드는 id 를 유지한다 (id 로 중복을 걸러 내는 호출부가 있다)", () => {
      expect(sqlite.searchCompatibleSoftware({ category: "WAS" })[0]).toHaveProperty("id");
      expect(sqlite.fullTextSearchCompatibility("JEUS")[0]).toHaveProperty("id");
      expect(sqlite.fullTextSearchCompatibility("티맥스 Tibero")[0]).toHaveProperty("id");
    });
  });

  describe("필터에 쓸 수 있는 값 목록", () => {
    it("getFrameworkVersions 는 major, minor 를 정수로 비교해 최신 버전부터 돌려준다", () => {
      // 문자열로 정렬하면 3.10 이 3.2 와 3.9 보다 작은 값으로 취급된다
      sqlite.addCompatibilitySoftwareBatch(
        ["3.10", "3.9", "3.2", "3.1", "2.7"].map((framework_version) => ({
          ...CATALOGUE[0],
          product_name: `Extra ${framework_version}`,
          framework_version,
        })),
      );
      expect(sqlite.getFrameworkVersions()).toEqual(["4.3", "4.2", "4.0", "3.10", "3.9", "3.6", "3.2", "3.1", "2.7"]);
    });

    it("getCategories 는 카테고리 이름을 중복 없이 돌려준다", () => {
      expect(sqlite.getCategories()).toEqual(["CMS Solution", "DBMS", "WAS"]);
    });
  });

  describe("fullTextSearchCompatibility (배열을 돌려주는 기존 메서드)", () => {
    it("모든 검색어가 접두 일치하는 행을 배열로 돌려준다", () => {
      expect(versionsOf(sqlite.fullTextSearchCompatibility("JEUS")).sort()).toEqual(["JEUS 21", "JEUS 8.5"]);
      expect(versionsOf(sqlite.fullTextSearchCompatibility("티맥스 Tibero"))).toEqual(["Tibero 7"]);
      expect(sqlite.fullTextSearchCompatibility("표준프레임워크", 2)).toHaveLength(2);
    });

    it("접두 일치 결과가 없으면 부분 일치 대체 검색 결과를 돌려주지 않는다", () => {
      // 이 메서드는 결과를 찾은 방식(matchMode)을 알릴 수 없다. 대체 검색 결과를 섞어 돌려주면
      // 통합 검색의 호출부가 관련성이 낮은 제품을 아무 표시 없이 싣게 된다.
      for (const query of ["오라클", "맥스 JEUS", "JEUS 호환 여부"]) {
        const fallback = sqlite.queryCompatibleSoftware({ query });
        expect(fallback.matchMode, `query=${query}`).toBe("any-term");
        expect(fallback.rows.length, `query=${query}`).toBeGreaterThan(0);

        expect(sqlite.fullTextSearchCompatibility(query), `query=${query}`).toEqual([]);
      }
    });

    it("FTS5 가 MATCH 식을 해석하지 못하면 빈 배열을 돌려준다", () => {
      const db = (sqlite as any).db;
      const prepare = db.prepare.bind(db);
      vi.spyOn(db, "prepare").mockImplementation((sql: unknown) => {
        if (String(sql).includes("MATCH")) {
          throw new Database.SqliteError('fts5: syntax error near "?"', "SQLITE_ERROR");
        }
        return prepare(sql);
      });

      expect(sqlite.fullTextSearchCompatibility("JEUS")).toEqual([]);
    });

    it("FTS5 질의 오류가 아닌 오류는 그대로 던진다", () => {
      (sqlite as any).db.exec("DROP TABLE compatibility_fts");
      expect(() => sqlite.fullTextSearchCompatibility("JEUS")).toThrow(/compatibility_fts/);
    });

    it("검색어가 하나도 추출되지 않으면 빈 배열을 돌려준다", () => {
      expect(sqlite.fullTextSearchCompatibility("?!")).toEqual([]);
    });
  });
});
