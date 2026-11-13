/**
 * 개발자 지식 도구(src/tools/knowledge.ts) 단위 테스트
 *
 * 도구 함수는 하이브리드 매니저 싱글톤(getInitializedHybridManager)을 통해 저장소에 접근하는데,
 * 실제 싱글톤은 저장소의 knowledge-base/egovframe.db 를 열어 수정한다. 테스트가 추적 파일을
 * 건드리지 않도록 싱글톤 접근 함수만 대체하고, 그 뒤의 DeveloperKnowledgeManager 는 동봉
 * LanceDB 테이블을 읽기 전용으로 여는 실제 객체를 쓴다 (_lanceFixtures 참고).
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { DeveloperKnowledgeManager } from "../../src/rag/knowledgeManager.js";
import { getEmbedder } from "../../src/rag/embedder.js";
import { searchKnowledge } from "../../src/tools/knowledge.js";
import { UserFacingError } from "../../src/utils/errors.js";
import {
  BUNDLED_KB,
  HAS_BUNDLED_TABLES,
  KNOWLEDGE_TABLE,
  loadVectorRows,
  openBundledTable,
  useQueryVector,
  type VectorRow,
} from "./_lanceFixtures.js";

/** getInitializedHybridManager() 가 돌려줄 객체 (테스트마다 필요한 부분만 채운다) */
const hybrid = vi.hoisted(() => ({ current: undefined as unknown }));

vi.mock("../../src/database/hybridManager.js", () => ({
  getInitializedHybridManager: async () => hybrid.current,
}));

/** 기본(의미 검색) 응답의 결과 항목 — 도구가 JSON 으로 내보내는 필드 */
type SemanticItem = Record<string, unknown> & { id: string; similarity: unknown };

/** 기본(의미 검색) 응답의 results 를 꺼낸다. */
function semanticResults(output: unknown): SemanticItem[] {
  const response = output as { resultCount?: number; results?: SemanticItem[] };
  if (response.resultCount === undefined || !response.results) {
    throw new Error("의미 검색 응답이 아닙니다");
  }
  return response.results;
}

describe.skipIf(!HAS_BUNDLED_TABLES)("searchKnowledge 도구 — 의미 검색 결과", () => {
  let knowledge: DeveloperKnowledgeManager;
  let rows: VectorRow[];

  beforeAll(async () => {
    knowledge = new DeveloperKnowledgeManager(BUNDLED_KB);
    await knowledge.initialize();
    rows = await loadVectorRows(await openBundledTable(KNOWLEDGE_TABLE));
    hybrid.current = { getKnowledge: () => knowledge };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("similarity 는 소수 셋째 자리로 반올림한 숫자다", async () => {
    useQueryVector(rows[100].vector);
    const direct = await knowledge.searchKnowledge("(저장된 벡터로 대체)", { limit: 5 });
    const results = semanticResults(await searchKnowledge({ query: "(저장된 벡터로 대체)", limit: 5 }));

    expect(results).toHaveLength(5);
    results.forEach((result, idx) => {
      expect(typeof result.similarity).toBe("number");
      expect(result.similarity).toBe(Math.round((1 - direct[idx].score) * 1000) / 1000);
    });
    // 질의 벡터가 저장된 행의 벡터이므로 1위는 자기 자신이고 코사인 유사도는 1 이다
    expect(results[0].similarity).toBe(1);
    // 그다음 결과는 1 보다 작은 코사인 유사도 (제곱 L2 를 쓰면 2·cos - 1 이 되어 값이 달라진다)
    expect(results[1].similarity).toBeLessThan(1);
  });
});

describe.skipIf(!HAS_BUNDLED_TABLES)("searchKnowledge 도구 — query 필수 여부", () => {
  let knowledge: DeveloperKnowledgeManager;

  beforeAll(async () => {
    knowledge = new DeveloperKnowledgeManager(BUNDLED_KB);
    await knowledge.initialize();
    hybrid.current = { getKnowledge: () => knowledge };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sort=recent 는 query 없이도 최근 목록을 돌려준다", async () => {
    const output = (await searchKnowledge({ sort: "recent", limit: 3 })) as {
      sort?: string;
      count?: number;
      results?: Array<Record<string, unknown>>;
    };
    expect(output.sort).toBe("recent");
    expect(output.count).toBe(3);
    expect(output.results).toHaveLength(3);
  });

  it("sort=recent 의 결과는 query 가 있든 없든 같다 (질의를 쓰지 않는다)", async () => {
    const withoutQuery = await searchKnowledge({ sort: "recent", limit: 3 });
    const withQuery = await searchKnowledge({ query: "아무 질의", sort: "recent", limit: 3 });
    expect(withQuery).toEqual(withoutQuery);
  });

  it("의미 검색은 query 가 없거나 공백뿐이면 임베딩 전에 거부한다", async () => {
    const embed = vi.spyOn(getEmbedder(), "embed");
    for (const args of [{}, { query: "" }, { query: "   \n\t" }, { limit: 3, sort: "relevance" as const }]) {
      const error = await searchKnowledge(args).catch((e: unknown) => e);
      expect(error, JSON.stringify(args)).toBeInstanceOf(UserFacingError);
      expect((error as Error).message).toBe("query is required for knowledge search");
    }
    expect(embed).not.toHaveBeenCalled();
  });

  it("통합 검색(scope=all)도 query 가 없으면 거부한다", async () => {
    const smartSearch = vi.fn();
    hybrid.current = { getKnowledge: () => knowledge, smartSearch };
    await expect(searchKnowledge({ scope: "all" })).rejects.toBeInstanceOf(UserFacingError);
    expect(smartSearch).not.toHaveBeenCalled();
    hybrid.current = { getKnowledge: () => knowledge };
  });
});
