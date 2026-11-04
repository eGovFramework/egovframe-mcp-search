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
    expect(escapeLikePattern("게시판")).toBe("게시판");
    expect(escapeLikePattern("")).toBe("");
  });
});

describe("SQLiteManager LIKE 검색 — 와일드카드 리터럴 처리", () => {
  let db: SQLiteManager;

  const sw = (product_name: string, vendor: string) => ({
    product_name,
    product_version: "1.0",
    framework_version: "4.3",
    category: "Framework Solution",
    compatibility_level: 1 as const,
    vendor,
    verified_date: "2025-01-01",
  });

  beforeAll(() => {
    db = new SQLiteManager(":memory:");
    db.addCompatibilitySoftwareBatch([
      sw("제품10%", "벤더_A"),
      sw("제품10점", "벤더XA"),
      sw("일반제품", "일반벤더"),
    ]);
  });

  afterAll(() => {
    db.close();
  });

  it("productName 의 % 는 리터럴 매칭된다 (임의 문자열 와일드카드 아님)", () => {
    const rows = db.searchCompatibleSoftware({ productName: "제품10%" });
    // '%' 가 와일드카드였다면 '제품10점' 도 매칭됐을 것.
    expect(rows.map((r) => r.product_name)).toEqual(["제품10%"]);
  });

  it("vendor 의 _ 는 리터럴 매칭된다 (한 글자 와일드카드 아님)", () => {
    const rows = db.searchCompatibleSoftware({ vendor: "벤더_A" });
    expect(rows.map((r) => r.vendor)).toEqual(["벤더_A"]);
  });

  it("일반 키워드 부분 일치는 그대로 동작한다", () => {
    const rows = db.searchCompatibleSoftware({ productName: "제품" });
    expect(rows.map((r) => r.product_name).sort()).toEqual(["일반제품", "제품10%", "제품10점"].sort());
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
