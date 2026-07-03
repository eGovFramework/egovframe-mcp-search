/**
 * LIKE 와일드카드 이스케이프 단위 테스트.
 *
 * 사용자 키워드에 포함된 % / _ 가 LIKE 와일드카드로 해석되지 않고
 * 리터럴로 매칭되는지 escapeLikePattern + SQLiteManager 실쿼리로 검증한다.
 * (in-memory DB 사용 — knowledge-base/egovframe.db 에 의존하지 않음)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { escapeLikePattern } from "../../src/utils/sqlLike.js";
import { sanitizeFts5MatchQuery } from "../../src/utils/fts5Query.js";
import { SQLiteManager } from "../../src/database/sqliteManager.js";

describe("escapeLikePattern", () => {
  it("% 와 _ 를 백슬래시로 이스케이프한다", () => {
    expect(escapeLikePattern("100%")).toBe("100\\%");
    expect(escapeLikePattern("a_b")).toBe("a\\_b");
  });

  it("백슬래시 자신도 이스케이프한다", () => {
    expect(escapeLikePattern("a\\b")).toBe("a\\\\b");
  });

  it("와일드카드가 없으면 입력 그대로 반환", () => {
    expect(escapeLikePattern("사용자명")).toBe("사용자명");
    expect(escapeLikePattern("")).toBe("");
  });
});

describe("SQLiteManager LIKE 검색 — 와일드카드 리터럴 처리", () => {
  let db: SQLiteManager;

  beforeAll(() => {
    db = new SQLiteManager(":memory:");
    db.addStandardTermsBatch([
      { korean_name: "할인율10%", english_name: "DSCNT_RT", description: "10% 할인율" },
      { korean_name: "할인율10점", english_name: "DSCNT_RT_10", description: "10점 할인율" },
      { korean_name: "사용자명", english_name: "USER_NM", description: "사용자 이름" },
      { korean_name: "언더_스코어", english_name: "UNDER_SCORE", description: "언더스코어 용어" },
      { korean_name: "언더X스코어", english_name: "UNDER_X", description: "한 글자 와일드카드 함정" },
    ]);
  });

  afterAll(() => {
    db.close();
  });

  it("keyword 의 % 는 리터럴 매칭된다 (임의 문자열 와일드카드 아님)", () => {
    const rows = db.searchStandardTerm("할인율10%");
    // '%' 가 와일드카드였다면 '할인율10점' 도 매칭됐을 것.
    expect(rows.map((r) => r.korean_name)).toEqual(["할인율10%"]);
  });

  it("keyword 의 _ 는 리터럴 매칭된다 (한 글자 와일드카드 아님)", () => {
    const rows = db.searchStandardTerm("언더_스코어");
    expect(rows.map((r) => r.korean_name)).toEqual(["언더_스코어"]);
  });

  it("일반 키워드 부분 일치는 그대로 동작한다", () => {
    const rows = db.searchStandardTerm("사용자");
    expect(rows.map((r) => r.korean_name)).toContain("사용자명");
  });

  it("suggestTermsForConcept 도 와일드카드를 리터럴로 다루고 rank 를 유지한다", () => {
    // '%' 가 와일드카드였다면 '할인율10점' 도 후보에 올랐을 것.
    const rows = db.suggestTermsForConcept("할인율10%");
    expect(rows.map((r) => r.korean_name)).toEqual(["할인율10%"]);
    expect(rows[0].matchRank).toBe(1);

    const exact = db.suggestTermsForConcept("사용자명");
    expect(exact[0].korean_name).toBe("사용자명");
    expect(exact[0].matchRank).toBe(1);
  });

  it("fullTextSearchTerms 의 prefix rank 도 이스케이프를 유지한다", () => {
    const rows = db.fullTextSearchTerms("할인율10%");
    expect(rows.map((r) => r.korean_name)).toEqual(["할인율10%"]);
  });
});

describe("sanitizeFts5MatchQuery", () => {
  it("FTS5 특수문자를 공백으로 치환한다", () => {
    expect(sanitizeFts5MatchQuery('spring "boot" (mvc)')).toBe("spring boot mvc");
    expect(sanitizeFts5MatchQuery("egov:framework.core")).toBe("egov framework core");
  });

  it("특수문자만 있는 입력은 null 을 반환한다", () => {
    expect(sanitizeFts5MatchQuery('()[]{}"*^|')).toBeNull();
    expect(sanitizeFts5MatchQuery("   ")).toBeNull();
  });

  it("한글/영문 혼합 질의는 보존한다", () => {
    expect(sanitizeFts5MatchQuery("게시판 컴포넌트")).toBe("게시판 컴포넌트");
  });
});
