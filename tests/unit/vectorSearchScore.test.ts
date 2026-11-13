/**
 * 벡터 검색 결과의 score 가 코사인 거리인지 검증한다.
 *
 * LanceDB 기본 거리(l2)는 제곱 유클리드 거리라, 정규화된 임베딩에서는 2 - 2·cos 가 된다.
 * 게이트웨이와 도구는 1 - score 를 유사도로 출력하므로 score 는 코사인 거리(1 - cos)여야 한다.
 *
 * 동봉 LanceDB 테이블을 읽기만 한다 (_lanceFixtures 참고).
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { GuideSearchManager } from "../../src/rag/guideManager.js";
import { DeveloperKnowledgeManager } from "../../src/rag/knowledgeManager.js";
import { getEmbedder } from "../../src/rag/embedder.js";
import { hasEmbeddingModel } from "../integration/_helper.js";
import {
  BUNDLED_KB,
  GUIDE_TABLE,
  HAS_BUNDLED_TABLES,
  KNOWLEDGE_TABLE,
  dot,
  loadVectorRows,
  openBundledTable,
  spread,
  useQueryVector,
  type VectorRow,
} from "./_lanceFixtures.js";

/** 결과마다 score 가 질의 벡터와의 코사인 거리(1 - 내적)와 같은지 확인한다. */
function expectCosineDistances(
  results: Array<{ id: string; score: number }>,
  byId: Map<string, VectorRow>,
  query: ArrayLike<number>,
): void {
  expect(results.length).toBeGreaterThan(1);
  for (const result of results) {
    expect(result.score).toBeCloseTo(1 - dot(byId.get(result.id)!.vector, query), 4);
  }
  // 거리가 0 인 결과만 있으면 l2 와 코사인을 구분할 수 없다
  expect(results.some((result) => result.score > 0.01)).toBe(true);
}

describe.skipIf(!HAS_BUNDLED_TABLES)("벡터 검색 score — 코사인 거리", () => {
  let guide: GuideSearchManager;
  let knowledge: DeveloperKnowledgeManager;
  let guideRows: VectorRow[];
  let knowledgeRows: VectorRow[];
  let guideById: Map<string, VectorRow>;
  let knowledgeById: Map<string, VectorRow>;

  beforeAll(async () => {
    guide = new GuideSearchManager(BUNDLED_KB);
    knowledge = new DeveloperKnowledgeManager(BUNDLED_KB);
    await guide.initialize();
    await knowledge.initialize();
    guideRows = await loadVectorRows(await openBundledTable(GUIDE_TABLE));
    knowledgeRows = await loadVectorRows(await openBundledTable(KNOWLEDGE_TABLE));
    guideById = new Map(guideRows.map((row) => [row.id, row]));
    knowledgeById = new Map(knowledgeRows.map((row) => [row.id, row]));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("가이드 검색의 score 는 코사인 거리다", async () => {
    for (const { vector: query } of spread(guideRows, 5)) {
      useQueryVector(query);
      expectCosineDistances(await guide.searchGuide("(저장된 벡터로 대체)", { limit: 10 }), guideById, query);
    }
  });

  it("개발자 지식 검색의 score 는 코사인 거리다", async () => {
    for (const { vector: query } of spread(knowledgeRows, 5)) {
      useQueryVector(query);
      expectCosineDistances(
        await knowledge.searchKnowledge("(저장된 벡터로 대체)", { limit: 10 }),
        knowledgeById,
        query,
      );
    }
  });

  it.skipIf(!hasEmbeddingModel())(
    "실제 임베딩으로도 score 는 질의 임베딩과의 코사인 거리다",
    async () => {
      const text = "트랜잭션 설정 방법";
      const query = await getEmbedder().embed(text, "query");
      expectCosineDistances(await guide.searchGuide(text, { limit: 5 }), guideById, query);
      expectCosineDistances(await knowledge.searchKnowledge(text, { limit: 5 }), knowledgeById, query);
    },
    60_000,
  );
});
