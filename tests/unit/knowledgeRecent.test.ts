/**
 * 최근 지식 목록(listRecentKnowledge) 단위 테스트
 *
 * - 의미 검색과 같은 필터(type·tags·minImportance·verifiedOnly)를 적용하는지
 * - 기존 호출 형태 (limit, type) 가 그대로 동작하는지
 * - 응답에 쓰는 컬럼만 읽고, 그래도 내용과 순서가 전체 컬럼을 읽을 때와 같은지
 *
 * 행 구성을 정해 둔 임시 테이블(_knowledgeTableFixture)과, 읽기 전용으로 여는 동봉 테이블을 쓴다.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import type * as lancedb from "@lancedb/lancedb";
import { DeveloperKnowledgeManager } from "../../src/rag/knowledgeManager.js";
import type { KnowledgeType } from "../../src/types/knowledge.js";
import { UserFacingError } from "../../src/utils/errors.js";
import { BUNDLED_KB, HAS_BUNDLED_TABLES, KNOWLEDGE_TABLE, openBundledTable } from "./_lanceFixtures.js";
import {
  createKnowledgeTable,
  type KnowledgeRowSpec,
  type KnowledgeTableFixture,
} from "./_knowledgeTableFixture.js";

/** 최근 목록 한 건의 필드 (RecentKnowledge) */
const RECENT_FIELDS = ["id", "type", "title", "tags", "importance", "verified", "createdAt"];

/** 임시 테이블의 행. day 가 클수록 최근에 만든 행이다 */
const sampleRow = (
  id: string,
  type: KnowledgeType,
  tags: string[],
  importance: number,
  verified: boolean,
  day: number,
): KnowledgeRowSpec => ({ id, type, tags, importance, verified, createdAt: `2026-01-0${day}T00:00:00.000Z` });

/**
 * 테이블 질의마다 읽은 컬럼 목록을 기록한다 (afterEach 의 vi.restoreAllMocks() 로 되돌린다).
 * select() 없이 실행한 질의(= 모든 컬럼을 읽는 질의)는 null 로 남는다.
 *
 * 매니저의 내부 필드에 기대지 않도록 LanceDB 테이블 구현 클래스의 query() 를 관찰한다.
 */
function recordSelectedColumns(table: lancedb.Table): Array<string[] | null> {
  type Query = ReturnType<lancedb.Table["query"]>;
  const tablePrototype = Object.getPrototypeOf(table) as lancedb.Table;
  const originalQuery = tablePrototype.query as (this: lancedb.Table) => Query;
  const selections: Array<string[] | null> = [];
  vi.spyOn(tablePrototype, "query").mockImplementation(function (this: lancedb.Table): Query {
    const query = originalQuery.call(this);
    const index = selections.push(null) - 1;
    const originalSelect = query.select.bind(query);
    query.select = ((columns: Parameters<Query["select"]>[0]) => {
      selections[index] = Array.isArray(columns) ? [...columns] : Object.keys(columns);
      return originalSelect(columns);
    }) as Query["select"];
    return query;
  });
  return selections;
}

describe("최근 지식 목록 — 필터", () => {
  let fixture: KnowledgeTableFixture;
  let manager: DeveloperKnowledgeManager;

  /** 최근 목록의 id 를 순서대로 */
  const recentIds = async (...args: Parameters<DeveloperKnowledgeManager["listRecentKnowledge"]>) =>
    (await manager.listRecentKnowledge(...args)).map((row) => row.id);

  beforeAll(async () => {
    // 인자는 id, type, tags, importance, verified, day 순서다. 최근 순은 r6, r5, …, r1
    fixture = await createKnowledgeTable([
      sampleRow("r1", "solution", ["faq"], 5, true, 1),
      sampleRow("r2", "solution", ["qa"], 3, false, 2),
      sampleRow("r3", "tip", ["faq", "pdf"], 4, true, 3),
      sampleRow("r4", "tip", [], 2, false, 4),
      sampleRow("r5", "best-practice", ["pdf"], 5, false, 5),
      sampleRow("r6", "solution", ["qa"], 1, true, 6),
    ]);
    manager = fixture.manager;
  });

  afterAll(async () => {
    await fixture.cleanup();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("필터가 없으면 전체를 최근 순으로 돌려준다", async () => {
    expect(await recentIds()).toEqual(["r6", "r5", "r4", "r3", "r2", "r1"]);
    expect(await recentIds(10, {})).toEqual(["r6", "r5", "r4", "r3", "r2", "r1"]);
    expect(await recentIds(2)).toEqual(["r6", "r5"]);
  });

  it("기존 호출 형태 (limit, type) 는 그대로 동작한다", async () => {
    expect(await recentIds(10, "tip")).toEqual(["r4", "r3"]);
    expect(await recentIds(10, "solution")).toEqual(["r6", "r2", "r1"]);
    expect(await recentIds(1, "solution")).toEqual(["r6"]);
    expect(await recentIds(10, "gotcha")).toEqual([]);
    expect(await recentIds(10, undefined)).toEqual(["r6", "r5", "r4", "r3", "r2", "r1"]);
  });

  it("필터 객체의 type 도 같은 결과다", async () => {
    expect(await recentIds(10, { type: "tip" })).toEqual(["r4", "r3"]);
    expect(await recentIds(10, { type: "best-practice" })).toEqual(["r5"]);
  });

  it("tags: 하나라도 가진 행만 돌려준다 (대소문자 구분)", async () => {
    expect(await recentIds(10, { tags: ["faq"] })).toEqual(["r3", "r1"]);
    expect(await recentIds(10, { tags: ["faq", "pdf"] })).toEqual(["r5", "r3", "r1"]);
    expect(await recentIds(10, { tags: ["FAQ"] })).toEqual([]);
    // 빈 배열은 필터가 없는 것으로 본다 (의미 검색과 같다)
    expect(await recentIds(10, { tags: [] })).toEqual(["r6", "r5", "r4", "r3", "r2", "r1"]);
  });

  it("minImportance: 중요도가 그 이상인 행만 돌려준다", async () => {
    expect(await recentIds(10, { minImportance: 4 })).toEqual(["r5", "r3", "r1"]);
    expect(await recentIds(10, { minImportance: 5 })).toEqual(["r5", "r1"]);
    expect(await recentIds(10, { minImportance: 1 })).toEqual(["r6", "r5", "r4", "r3", "r2", "r1"]);
  });

  it("verifiedOnly: 검증된 행만 돌려준다", async () => {
    expect(await recentIds(10, { verifiedOnly: true })).toEqual(["r6", "r3", "r1"]);
    expect(await recentIds(10, { verifiedOnly: false })).toEqual(["r6", "r5", "r4", "r3", "r2", "r1"]);
  });

  it("여러 필터는 모두 만족하는 행만 돌려준다", async () => {
    expect(await recentIds(10, { type: "solution", tags: ["faq", "qa"] })).toEqual(["r6", "r2", "r1"]);
    expect(await recentIds(10, { type: "solution", tags: ["faq", "qa"], verifiedOnly: true })).toEqual(["r6", "r1"]);
    expect(
      await recentIds(10, { type: "solution", tags: ["faq", "qa"], verifiedOnly: true, minImportance: 3 }),
    ).toEqual(["r1"]);
  });

  it("limit 은 필터를 건 뒤에 적용한다", async () => {
    expect(await recentIds(2, { minImportance: 4 })).toEqual(["r5", "r3"]);
    expect(await recentIds(1, { tags: ["faq"] })).toEqual(["r3"]);
  });

  it("허용되지 않은 type 은 필터 객체로 줘도 거부한다", async () => {
    for (const type of ["nope", "x' OR '1'='1", "Tip"]) {
      await expect(manager.listRecentKnowledge(10, { type: type as KnowledgeType }), type).rejects.toBeInstanceOf(
        UserFacingError,
      );
    }
  });

  it("조건을 바꾸려는 태그 값은 어떤 행과도 일치하지 않고 오류도 내지 않는다", async () => {
    for (const tag of ["it's", "x') OR 1=1 --", "']) OR array_has_any(tags, ['qa"]) {
      expect(await recentIds(10, { tags: [tag] }), tag).toEqual([]);
    }
  });

  it("한 건은 RecentKnowledge 의 필드만 가진다", async () => {
    const [r6, , , r3] = await manager.listRecentKnowledge(10);
    expect(r6).toEqual({
      id: "r6",
      type: "solution",
      title: "제목 r6",
      tags: ["qa"],
      importance: 1,
      verified: true,
      createdAt: "2026-01-06T00:00:00.000Z",
    });
    expect(r3.tags).toEqual(["faq", "pdf"]);
    expect(Object.keys(r3).sort()).toEqual([...RECENT_FIELDS].sort());
  });

  it("응답에 쓰는 컬럼만 읽는다 (본문·벡터를 읽지 않는다)", async () => {
    const selections = recordSelectedColumns(await fixture.openTable());
    const sorted = () => selections.map((columns) => columns && [...columns].sort());
    const expected = [...RECENT_FIELDS].sort();

    await manager.listRecentKnowledge(3);
    expect(sorted()).toEqual([expected]);

    await manager.listRecentKnowledge(3, { tags: ["faq"], minImportance: 4, verifiedOnly: true });
    expect(sorted()).toEqual([expected, expected]);
  });
});

describe.skipIf(!HAS_BUNDLED_TABLES)("최근 지식 목록 — 동봉 테이블", () => {
  let manager: DeveloperKnowledgeManager;
  let table: lancedb.Table;

  /**
   * 기준값: 모든 컬럼을 읽어 createdAt 내림차순으로 안정 정렬한 결과 (컬럼을 골라 읽기 전의 방식).
   * createdAt 이 같은 행이 색인 배치마다 100개씩 있어, 그 안의 순서는 테이블을 읽은 순서로 정해진다.
   */
  const reference = async (limit: number, where?: string) => {
    const all = await (where ? table.query().where(where) : table.query()).toArray();
    return all
      .sort(
        (a: { createdAt: string }, b: { createdAt: string }) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .slice(0, limit)
      .map((row: Record<string, unknown>) => ({
        id: row.id,
        type: row.type,
        title: row.title,
        tags: Array.from(row.tags as Iterable<string>),
        importance: row.importance,
        verified: row.verified,
        createdAt: row.createdAt,
      }));
  };

  beforeAll(async () => {
    manager = new DeveloperKnowledgeManager(BUNDLED_KB);
    await manager.initialize();
    table = await openBundledTable(KNOWLEDGE_TABLE);
  });

  it("컬럼을 골라 읽어도 내용과 순서는 전체 컬럼을 읽을 때와 같다", async () => {
    expect(await manager.listRecentKnowledge(100)).toEqual(await reference(100));
    expect(await manager.listRecentKnowledge(100, "best-practice")).toEqual(
      await reference(100, "type = 'best-practice'"),
    );
    expect(await manager.listRecentKnowledge(30, "solution")).toEqual(await reference(30, "type = 'solution'"));
  });

  it("tags·minImportance·verifiedOnly 필터가 걸린다", async () => {
    const faq = await manager.listRecentKnowledge(20, { tags: ["faq"] });
    expect(faq).toHaveLength(20);
    expect(faq.every((row) => row.tags.includes("faq"))).toBe(true);
    expect(faq).toEqual(await reference(20, "array_has_any(tags, ['faq'])"));

    const important = await manager.listRecentKnowledge(20, { minImportance: 4 });
    expect(important).toHaveLength(20);
    expect(important.every((row) => row.importance >= 4)).toBe(true);

    const verified = await manager.listRecentKnowledge(20, { verifiedOnly: true });
    expect(verified).toHaveLength(20);
    expect(verified.every((row) => row.verified === true)).toBe(true);
  });
});
