/**
 * 개발자 지식 검색의 필터(where 절) 처리 단위 테스트
 *
 * 필터 값이 리터럴로만 쓰이는지, type 이 허용된 값인지 검증하는지를 확인한다.
 * 동봉 LanceDB 테이블을 읽기만 하며, 질의 임베딩은 저장된 벡터로 대신한다 (_lanceFixtures 참고).
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import type { Table } from "@lancedb/lancedb";
import { DeveloperKnowledgeManager, buildKnowledgeFilter } from "../../src/rag/knowledgeManager.js";
import { getEmbedder } from "../../src/rag/embedder.js";
import { KNOWLEDGE_TYPES, type KnowledgeType } from "../../src/types/knowledge.js";
import { UserFacingError } from "../../src/utils/errors.js";
import { MAX_VECTOR_SEARCH_LIMIT } from "../../src/utils/lanceFilter.js";
import { hasEmbeddingModel } from "../integration/_helper.js";
import {
  BUNDLED_KB,
  HAS_BUNDLED_TABLES,
  KNOWLEDGE_TABLE,
  loadVectorRows,
  openBundledTable,
  spread,
  useQueryVector,
  type VectorRow,
} from "./_lanceFixtures.js";

/** 타입 검사를 우회해 임의의 문자열을 type 으로 넘긴다 (게이트웨이는 문자열이면 그대로 전달한다). */
const asType = (value: string) => value as KnowledgeType;

const INJECTION_TYPES = [
  "nope",
  "it's",
  "x' OR 1=1 --",
  "solution' AND metadata.sourceType = 'faq",
  "x' OR importance = 5 OR type = 'y",
  "Best-Practice",
];

describe("buildKnowledgeFilter", () => {
  it("필터가 없으면 조건을 만들지 않는다", () => {
    expect(buildKnowledgeFilter({})).toBeUndefined();
    expect(buildKnowledgeFilter({ limit: 3, minImportance: 1, verifiedOnly: false })).toBeUndefined();
  });

  it("type·minImportance·verifiedOnly 를 AND 로 결합한다", () => {
    expect(buildKnowledgeFilter({ type: "best-practice" })).toBe("type = 'best-practice'");
    expect(buildKnowledgeFilter({ type: "solution", minImportance: 4, verifiedOnly: true })).toBe(
      "type = 'solution' AND importance >= 4 AND verified = true",
    );
  });

  it("minImportance 는 1 보다 큰 유한한 수만 조건에 넣는다", () => {
    expect(buildKnowledgeFilter({ minImportance: 3 })).toBe("importance >= 3");
    expect(buildKnowledgeFilter({ minImportance: Number.NaN as 1 })).toBeUndefined();
    expect(buildKnowledgeFilter({ minImportance: "5 OR 1=1" as unknown as 5 })).toBeUndefined();
  });

  it("여섯 가지 type 값은 모두 받는다", () => {
    for (const type of KNOWLEDGE_TYPES) {
      expect(buildKnowledgeFilter({ type })).toBe(`type = '${type}'`);
    }
  });

  it("허용되지 않은 type 은 유효한 값을 나열한 오류로 거부한다", () => {
    for (const type of INJECTION_TYPES) {
      let thrown: unknown;
      try {
        buildKnowledgeFilter({ type: asType(type) });
      } catch (error) {
        thrown = error;
      }
      expect(thrown, type).toBeInstanceOf(UserFacingError);
      const message = (thrown as Error).message;
      for (const valid of KNOWLEDGE_TYPES) {
        expect(message).toContain(valid);
      }
    }
  });
});

describe.skipIf(!HAS_BUNDLED_TABLES)("개발자 지식 검색 — type 필터 검증", () => {
  let manager: DeveloperKnowledgeManager;
  let table: Table;
  let rows: VectorRow[];

  beforeAll(async () => {
    manager = new DeveloperKnowledgeManager(BUNDLED_KB);
    await manager.initialize();
    table = await openBundledTable(KNOWLEDGE_TABLE);
    rows = await loadVectorRows(table, ["type"]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("검색: 허용되지 않은 type 은 임베딩 전에 거부한다 (조건이 바뀌거나 질의가 깨지지 않는다)", async () => {
    const embed = vi.spyOn(getEmbedder(), "embed").mockResolvedValue(rows[0].vector);
    for (const type of INJECTION_TYPES) {
      await expect(manager.searchKnowledge("로그인", { limit: 2, type: asType(type) }), type).rejects.toBeInstanceOf(
        UserFacingError,
      );
    }
    expect(embed).not.toHaveBeenCalled();
  });

  it("검색: 유효한 type 은 그 type 의 행만 돌려준다", async () => {
    useQueryVector(rows[0].vector);
    const results = await manager.searchKnowledge("(저장된 벡터로 대체)", { limit: 5, type: "solution" });
    expect(results).toHaveLength(5);
    expect(results.every((r) => r.type === "solution")).toBe(true);
  });

  it("최근 목록: 허용되지 않은 type 은 거부한다", async () => {
    for (const type of INJECTION_TYPES) {
      await expect(manager.listRecentKnowledge(2, asType(type)), type).rejects.toBeInstanceOf(UserFacingError);
    }
  });

  it("최근 목록: 유효한 type 은 그 type 의 행만 돌려준다", async () => {
    const results = await manager.listRecentKnowledge(3, "best-practice");
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.type === "best-practice")).toBe(true);
  });

  it("buildKnowledgeFilter 가 만든 조건은 LanceDB 에서 같은 행 수를 고른다", async () => {
    const solutions = rows.filter((row) => row.type === "solution").length;
    expect(await table.countRows(buildKnowledgeFilter({ type: "solution" }))).toBe(solutions);
    expect(await table.countRows(buildKnowledgeFilter({ type: "tip" }))).toBe(
      rows.filter((row) => row.type === "tip").length,
    );
  });
});

describe("buildKnowledgeFilter — tags", () => {
  it("tags 는 배열 포함 조건으로 where 절에 넣는다 (하나라도 포함하면 일치)", () => {
    expect(buildKnowledgeFilter({ tags: ["faq"] })).toBe("array_has_any(tags, ['faq'])");
    expect(buildKnowledgeFilter({ tags: ["faq", "pdf"] })).toBe("array_has_any(tags, ['faq', 'pdf'])");
  });

  it("빈 tags 는 조건을 만들지 않는다", () => {
    expect(buildKnowledgeFilter({ tags: [] })).toBeUndefined();
  });

  it("tags 값의 작은따옴표를 이스케이프한다", () => {
    expect(buildKnowledgeFilter({ tags: ["it's", "x') OR 1=1 --"] })).toBe(
      "array_has_any(tags, ['it''s', 'x'') OR 1=1 --'])",
    );
  });

  it("다른 필터와 AND 로 결합한다", () => {
    expect(buildKnowledgeFilter({ type: "solution", minImportance: 4, tags: ["faq"] })).toBe(
      "type = 'solution' AND importance >= 4 AND array_has_any(tags, ['faq'])",
    );
  });
});

describe.skipIf(!HAS_BUNDLED_TABLES)("개발자 지식 검색 — tags 필터", () => {
  let manager: DeveloperKnowledgeManager;
  let table: Table;
  let rows: Array<VectorRow & { tagList: string[] }>;

  /** 주어진 태그 가운데 하나라도 가진 행 수 (테이블 전체를 자바스크립트로 센 기대값) */
  const countWithAnyTag = (tags: string[]) =>
    rows.filter((row) => tags.some((tag) => row.tagList.includes(tag))).length;

  beforeAll(async () => {
    manager = new DeveloperKnowledgeManager(BUNDLED_KB);
    await manager.initialize();
    table = await openBundledTable(KNOWLEDGE_TABLE);
    rows = (await loadVectorRows(table, ["tags"])).map((row) => ({
      ...row,
      tagList: Array.from(row.tags as Iterable<string>),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("조건은 LanceDB 에서 태그를 가진 행 전체를 고른다", async () => {
    const faq = countWithAnyTag(["faq"]);
    expect(faq).toBeGreaterThan(0);
    expect(await table.countRows(buildKnowledgeFilter({ tags: ["faq"] }))).toBe(faq);
    expect(await table.countRows(buildKnowledgeFilter({ tags: ["faq", "pdf"] }))).toBe(
      countWithAnyTag(["faq", "pdf"]),
    );
    // 정확히 일치하는 값만 고른다 (대소문자 구분)
    expect(await table.countRows(buildKnowledgeFilter({ tags: ["FAQ"] }))).toBe(0);
  });

  it("조건을 바꾸려는 태그 값은 어떤 행과도 일치하지 않고 오류도 내지 않는다", async () => {
    for (const tag of ["it's", "x') OR 1=1 --", "']) OR array_has_any(tags, ['qa", "\\"]) {
      expect(await table.countRows(buildKnowledgeFilter({ tags: [tag] })), tag).toBe(0);
    }
  });

  it("소수 태그도 질의와 무관하게 limit 건을 채운다", async () => {
    const offTopic = rows.filter((row) => !row.tagList.includes("faq") && !row.tagList.includes("pdf"));
    for (const tag of ["faq", "pdf", "guide"]) {
      expect(countWithAnyTag([tag])).toBeGreaterThanOrEqual(5);
      for (const { vector } of spread(offTopic, 10)) {
        useQueryVector(vector);
        const results = await manager.searchKnowledge("(저장된 벡터로 대체)", { limit: 5, tags: [tag] });
        expect(results, tag).toHaveLength(5);
        expect(results.every((r) => r.tags.includes(tag))).toBe(true);
      }
    }
  });

  it("여러 태그는 하나라도 가진 행을 돌려준다", async () => {
    // 두 태그 가운데 하나만 가진 행의 벡터로 찾으면 그 행이 결과에 있어야 한다
    // (태그를 모두 가져야 일치한다면 어느 쪽도 나오지 않는다).
    // 건수는 조건에 맞는 행 수와 검색 한 번의 상한 가운데 작은 쪽이다.
    const total = countWithAnyTag(["faq", "pdf"]);
    for (const [tag, other] of [
      ["faq", "pdf"],
      ["pdf", "faq"],
    ]) {
      const only = rows.find((row) => row.tagList.includes(tag) && !row.tagList.includes(other));
      if (!only) throw new Error(`${tag} 태그만 가진 행을 찾지 못했습니다`);

      useQueryVector(only.vector);
      const results = await manager.searchKnowledge("(저장된 벡터로 대체)", {
        limit: total + 50,
        tags: ["faq", "pdf"],
      });
      expect(results, tag).toHaveLength(Math.min(total, MAX_VECTOR_SEARCH_LIMIT));
      expect(results.every((r) => r.tags.includes("faq") || r.tags.includes("pdf"))).toBe(true);
      expect(results.map((r) => r.id), tag).toContain(only.id);
    }
  });

  it("일치하는 태그가 없으면 빈 결과다", async () => {
    useQueryVector(rows[0].vector);
    expect(await manager.searchKnowledge("(저장된 벡터로 대체)", { limit: 5, tags: ["FAQ"] })).toEqual([]);
    expect(await manager.searchKnowledge("(저장된 벡터로 대체)", { limit: 5, tags: ["it's"] })).toEqual([]);
  });

  it("tags 와 type 을 함께 주면 둘 다 만족하는 행만 돌려준다", async () => {
    useQueryVector(rows[0].vector);
    const results = await manager.searchKnowledge("(저장된 벡터로 대체)", {
      limit: 5,
      type: "solution",
      tags: ["faq"],
    });
    expect(results).toHaveLength(5);
    expect(results.every((r) => r.type === "solution" && r.tags.includes("faq"))).toBe(true);
  });

  it.skipIf(!hasEmbeddingModel())(
    "실제 임베딩: '로그인이 안됩니다' + tags faq 는 FAQ 5건을 돌려준다",
    async () => {
      const results = await manager.searchKnowledge("로그인이 안됩니다", { limit: 5, tags: ["faq"] });
      expect(results).toHaveLength(5);
      expect(results.every((r) => r.tags.includes("faq"))).toBe(true);
    },
    60_000,
  );
});
