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

    it("searchCompatibleSoftware 는 같은 필터 조회 결과를 배열로 돌려준다", () => {
      expect(versionsOf(sqlite.searchCompatibleSoftware({ category: "WAS" }, 2))).toEqual(["JEUS 21", "JEUS 8.5"]);
      expect(sqlite.searchCompatibleSoftware()).toHaveLength(CATALOGUE.length);
    });
  });

  describe("fullTextSearchCompatibility (배열을 돌려주는 기존 메서드)", () => {
    it("같은 규칙으로 찾은 행을 배열로 돌려준다", () => {
      expect(versionsOf(sqlite.fullTextSearchCompatibility("오라클"))).toEqual(["WebLogic 12c"]);
      expect(versionsOf(sqlite.fullTextSearchCompatibility("맥스 JEUS", 2))).toEqual(["JEUS 21", "JEUS 8.5"]);
    });

    it("검색어가 하나도 추출되지 않으면 빈 배열을 돌려준다", () => {
      expect(sqlite.fullTextSearchCompatibility("?!")).toEqual([]);
    });
  });
});
