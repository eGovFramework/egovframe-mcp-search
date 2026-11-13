/**
 * 개발자 지식 도구(src/tools/knowledge.ts) 단위 테스트
 *
 * 도구 함수는 하이브리드 매니저 싱글톤(getInitializedHybridManager)을 통해 저장소에 접근하는데,
 * 실제 싱글톤은 저장소의 knowledge-base/egovframe.db 를 열어 수정한다. 테스트가 추적 파일을
 * 건드리지 않도록 싱글톤 접근 함수만 대체하고, 그 뒤의 DeveloperKnowledgeManager 는 동봉
 * LanceDB 테이블을 읽기 전용으로 여는 실제 객체를 쓴다 (_lanceFixtures 참고).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import { DeveloperKnowledgeManager } from "../../src/rag/knowledgeManager.js";
import { getEmbedder } from "../../src/rag/embedder.js";
import { formatProductLabel, searchKnowledge, smartSearch } from "../../src/tools/knowledge.js";
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
import { createKnowledgeTable, unitVector, type KnowledgeTableFixture } from "./_knowledgeTableFixture.js";

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

  it("의미 검색 결과에는 색인 시각(createdAt)을 넣지 않는다", async () => {
    useQueryVector(rows[100].vector);
    const results = semanticResults(await searchKnowledge({ query: "(저장된 벡터로 대체)", limit: 3 }));

    expect(results).toHaveLength(3);
    for (const result of results) {
      // 모든 행의 createdAt 은 색인한 시각이라 게시 일자로 오해된다
      expect(result).not.toHaveProperty("createdAt");
      expect(Object.keys(result).sort()).toEqual(
        ["content", "context", "id", "importance", "similarity", "tags", "title", "type"].sort(),
      );
    }
  });

  it("최근 목록 결과에는 정렬 기준인 createdAt 을 유지한다", async () => {
    const output = (await searchKnowledge({ sort: "recent", limit: 5 })) as {
      results: Array<{ createdAt: string }>;
    };
    expect(output.results).toHaveLength(5);
    const times = output.results.map((result) => Date.parse(result.createdAt));
    expect(times.every(Number.isFinite)).toBe(true);
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });
});

describe.skipIf(!HAS_BUNDLED_TABLES)("searchKnowledge 도구 — excerptLength", () => {
  const ANSWER_MARK = "\n\n답변:\n";
  let knowledge: DeveloperKnowledgeManager;
  /** 질문과 답변이 모두 긴 Q&A 행 (앞에서부터 200자를 자르면 답변이 남지 않는다) */
  let longQa: VectorRow & { content: string };

  beforeAll(async () => {
    knowledge = new DeveloperKnowledgeManager(BUNDLED_KB);
    await knowledge.initialize();
    hybrid.current = { getKnowledge: () => knowledge };

    const rows = await loadVectorRows(await openBundledTable(KNOWLEDGE_TABLE), ["content"]);
    const found = rows.find((row) => {
      const content = String(row.content);
      const at = content.indexOf(ANSWER_MARK);
      return content.startsWith("질문:") && at > 600 && content.length - at > 600;
    });
    if (!found) throw new Error("질문과 답변이 모두 긴 Q&A 행을 찾지 못했습니다");
    longQa = { ...found, content: String(found.content) };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("excerptLength 가 없으면 본문 전체를 돌려준다", async () => {
    useQueryVector(longQa.vector);
    const [first] = semanticResults(await searchKnowledge({ query: "(저장된 벡터로 대체)", limit: 1 }));
    expect(first.id).toBe(longQa.id);
    expect(first.content).toBe(longQa.content);
  });

  it("excerptLength 를 주면 본문을 그 길이 이내로 줄이되 답변 앞부분을 남긴다", async () => {
    useQueryVector(longQa.vector);
    const [first] = semanticResults(
      await searchKnowledge({ query: "(저장된 벡터로 대체)", limit: 1, excerptLength: 200 }),
    );
    const content = String(first.content);
    const fullAnswer = longQa.content.slice(longQa.content.indexOf(ANSWER_MARK) + ANSWER_MARK.length).trim();

    expect(first.id).toBe(longQa.id);
    expect(content.length).toBeLessThanOrEqual(200);
    expect(content.startsWith("질문:\n")).toBe(true);
    const excerptAnswer = content.slice(content.indexOf(ANSWER_MARK) + ANSWER_MARK.length).replace(/\.\.\.$/, "");
    expect(excerptAnswer.length).toBeGreaterThan(50);
    expect(fullAnswer.startsWith(excerptAnswer)).toBe(true);
  });

  it("결과 전체에 같은 상한을 적용한다", async () => {
    useQueryVector(longQa.vector);
    const results = semanticResults(
      await searchKnowledge({ query: "(저장된 벡터로 대체)", limit: 10, excerptLength: 120 }),
    );
    expect(results).toHaveLength(10);
    for (const result of results) {
      expect(String(result.content).length).toBeLessThanOrEqual(120);
    }
  });

  it("유효한 양수가 아닌 excerptLength 는 지정하지 않은 것으로 본다", async () => {
    useQueryVector(longQa.vector);
    for (const excerptLength of [0, -10, Number.NaN]) {
      const [first] = semanticResults(
        await searchKnowledge({ query: "(저장된 벡터로 대체)", limit: 1, excerptLength }),
      );
      expect(first.content, String(excerptLength)).toBe(longQa.content);
    }
  });
});

describe("searchKnowledge 도구 — 통합 검색(scope=all)의 지식 미리보기", () => {
  const question = "서버를 기동하면 다음과 같은 오류가 발생합니다. ".repeat(20).trim();
  const answer = "안녕하세요. 표준프레임워크센터입니다. 설정 파일을 확인해 보시기 바랍니다. ".repeat(20).trim();

  /** 통합 검색이 돌려주는 지식 행 (smartSearch 의 결과 형태) */
  const knowledgeHit = {
    id: "k1",
    type: "solution",
    title: "서버 기동 오류",
    content: `질문:\n${question}\n\n답변:\n${answer}`,
    context: "표준프레임워크 묻고답하기",
    tags: ["egovframe", "qa"],
    importance: 3,
    score: 0.1,
    createdAt: "2026-06-09T06:30:14.979Z",
    metadata: {},
  };

  const previewOf = async (excerptLength?: number): Promise<string> => {
    hybrid.current = {
      getKnowledge: () => ({}),
      smartSearch: async () => ({ compatibility: [], knowledge: [knowledgeHit], totalResults: 1 }),
    };
    const output = (await searchKnowledge({ query: "서버 기동 오류", scope: "all", excerptLength })) as {
      scope?: string;
      knowledge: Array<{ content: string }>;
    };
    expect(output.scope).toBe("all");
    return output.knowledge[0].content;
  };

  it("기본 200자 미리보기에도 답변 앞부분이 들어간다", async () => {
    const preview = await previewOf();
    expect(preview.length).toBeLessThanOrEqual(200);
    expect(preview).toContain("\n\n답변:\n안녕하세요. 표준프레임워크센터입니다.");
  });

  it("excerptLength 로 미리보기 길이를 정한다", async () => {
    const preview = await previewOf(400);
    expect(preview.length).toBeLessThanOrEqual(400);
    expect(preview.length).toBeGreaterThan(300);
    expect(preview).toContain("\n\n답변:\n안녕하세요.");

    expect((await previewOf(80)).length).toBeLessThanOrEqual(80);
  });
});

describe("searchKnowledge 도구 — 최근 목록(sort=recent)의 필터", () => {
  let fixture: KnowledgeTableFixture;

  /** sort=recent 응답의 id 를 순서대로 */
  const recentIds = async (args: Omit<Parameters<typeof searchKnowledge>[0], "sort">): Promise<string[]> => {
    const output = (await searchKnowledge({ ...args, sort: "recent" })) as {
      sort?: string;
      count: number;
      results: Array<{ id: string }>;
    };
    expect(output.sort).toBe("recent");
    expect(output.count).toBe(output.results.length);
    return output.results.map((result) => result.id);
  };

  beforeAll(async () => {
    // day 가 클수록 최근에 만든 행이다 — 최근 순은 r4, r3, r2, r1
    const createdAt = (day: number) => `2026-01-0${day}T00:00:00.000Z`;
    fixture = await createKnowledgeTable([
      { id: "r1", type: "solution", tags: ["faq"], importance: 5, verified: true, createdAt: createdAt(1) },
      { id: "r2", type: "solution", tags: ["qa"], importance: 3, verified: false, createdAt: createdAt(2) },
      { id: "r3", type: "tip", tags: ["faq", "pdf"], importance: 4, verified: true, createdAt: createdAt(3) },
      { id: "r4", type: "tip", tags: [], importance: 2, verified: false, createdAt: createdAt(4) },
    ]);
  });

  beforeEach(() => {
    hybrid.current = { getKnowledge: () => fixture.manager };
  });

  afterAll(async () => {
    await fixture.cleanup();
  });

  it("필터가 없으면 전체를 최근 순으로 돌려준다", async () => {
    expect(await recentIds({})).toEqual(["r4", "r3", "r2", "r1"]);
  });

  it("type 필터를 적용한다", async () => {
    expect(await recentIds({ type: "tip" })).toEqual(["r4", "r3"]);
  });

  it("tags 필터를 적용한다 (조용히 무시하지 않는다)", async () => {
    expect(await recentIds({ tags: ["faq"] })).toEqual(["r3", "r1"]);
    expect(await recentIds({ tags: ["pdf", "qa"] })).toEqual(["r3", "r2"]);
  });

  it("minImportance 필터를 적용한다", async () => {
    expect(await recentIds({ minImportance: 4 })).toEqual(["r3", "r1"]);
  });

  it("verifiedOnly 필터를 적용한다", async () => {
    expect(await recentIds({ verifiedOnly: true })).toEqual(["r3", "r1"]);
  });

  it("여러 필터와 limit 을 함께 적용한다", async () => {
    expect(await recentIds({ type: "solution", tags: ["faq"] })).toEqual(["r1"]);
    expect(await recentIds({ type: "tip", minImportance: 3 })).toEqual(["r3"]);
    expect(await recentIds({ tags: ["faq"], verifiedOnly: true, limit: 1 })).toEqual(["r3"]);
  });
});

describe("도구 응답에 되돌려 주는 query", () => {
  /** 응답에 싣는 query 의 최대 길이 */
  const MAX_ECHO = 200;

  /** 검색(매니저)에 실제로 전달된 질의 */
  let searched: string[];

  beforeEach(() => {
    searched = [];
    hybrid.current = {
      getKnowledge: () => ({
        searchKnowledge: async (query: string) => {
          searched.push(query);
          return [];
        },
      }),
      smartSearch: async (options: { query: string }) => {
        searched.push(options.query);
        return { compatibility: [], knowledge: [], totalResults: 0 };
      },
    };
  });

  /** 긴 문자열 비교 — 실패했을 때 수십만 자가 출력되지 않도록 길이와 일치 여부만 확인한다 */
  const expectSameText = (actual: string, expected: string): void => {
    expect(actual.length).toBe(expected.length);
    expect(actual === expected).toBe(true);
  };

  /** 세 응답 경로: 의미 검색, 통합 검색(scope=all), smartSearch */
  const ECHO_PATHS: Array<[string, (query: string) => Promise<unknown>]> = [
    ["의미 검색", (query) => searchKnowledge({ query })],
    ["통합 검색(scope=all)", (query) => searchKnowledge({ query, scope: "all" })],
    ["smartSearch", (query) => smartSearch({ query })],
  ];

  it.each(ECHO_PATHS)("%s: 200자를 넘는 query 는 앞 200자와 '…' 만 되돌려 준다", async (_name, run) => {
    const query = "가".repeat(220_000);
    const output = (await run(query)) as { query: string };

    expectSameText(output.query, `${"가".repeat(MAX_ECHO)}…`);
    // 응답 전체도 질의 길이를 따라 커지지 않는다
    expect(JSON.stringify(output).length).toBeLessThan(1000);
  });

  it.each(ECHO_PATHS)("%s: 검색에는 원래 query 를 그대로 쓴다", async (_name, run) => {
    const query = "게시판 ".repeat(1000);
    await run(query);

    expect(searched).toHaveLength(1);
    expectSameText(searched[0], query);
  });

  it.each(ECHO_PATHS)("%s: 200자 이하의 query 는 그대로 되돌려 준다", async (_name, run) => {
    for (const query of ["게시판 구현 방법", "가".repeat(MAX_ECHO)]) {
      const output = (await run(query)) as { query: string };
      expect(output.query).toBe(query);
    }
  });

  it.each(ECHO_PATHS)("%s: 서로게이트 쌍의 가운데에서 자르지 않는다", async (_name, run) => {
    // 😀 은 UTF-16 코드 단위 두 개다 — 200번째 자리에 걸치면 통째로 뺀다
    const straddling = (await run(`${"가".repeat(MAX_ECHO - 1)}😀${"나".repeat(50)}`)) as { query: string };
    expect(straddling.query).toBe(`${"가".repeat(MAX_ECHO - 1)}…`);

    const fitting = (await run(`${"가".repeat(MAX_ECHO - 2)}😀${"나".repeat(50)}`)) as { query: string };
    expect(fitting.query).toBe(`${"가".repeat(MAX_ECHO - 2)}😀…`);
  });
});

describe("formatProductLabel", () => {
  it("버전 표기가 제품명으로 시작하면 버전 표기만 쓴다", () => {
    expect(formatProductLabel("JEUS", "JEUS 21")).toBe("JEUS 21");
    expect(formatProductLabel("Tibero", "Tibero v7")).toBe("Tibero v7");
    expect(formatProductLabel("그린나래CMS", "그린나래CMS1.0")).toBe("그린나래CMS1.0");
    expect(formatProductLabel("DevOnFrame", "DevOnFrame")).toBe("DevOnFrame");
  });

  it("버전 표기가 제품명으로 시작하지 않으면 제품명과 버전을 잇는다", () => {
    expect(formatProductLabel("BXM Framework", "v4.0")).toBe("BXM Framework v4.0");
    expect(formatProductLabel("JAMMY CMS", "v1.0")).toBe("JAMMY CMS v1.0");
  });

  it("버전이 비어 있으면 제품명만 쓴다", () => {
    expect(formatProductLabel("JEUS", "")).toBe("JEUS");
    expect(formatProductLabel("JEUS", null)).toBe("JEUS");
    expect(formatProductLabel("JEUS", undefined)).toBe("JEUS");
    expect(formatProductLabel("JEUS", "   ")).toBe("JEUS");
  });
});

describe("통합 검색의 호환 제품 표기", () => {
  const compatibilityRow = (product_name: string, product_version: string) => ({
    id: 1,
    product_name,
    product_version,
    framework_version: "4.3",
    category: "WAS",
    compatibility_level: 1,
    vendor: "벤더",
    description: null,
  });

  beforeAll(() => {
    hybrid.current = {
      getKnowledge: () => ({}),
      smartSearch: async () => ({
        compatibility: [compatibilityRow("JEUS", "JEUS 21"), compatibilityRow("BXM Framework", "v4.0")],
        knowledge: [],
        totalResults: 2,
      }),
    };
  });

  it("searchKnowledge(scope=all) 은 제품명을 두 번 쓰지 않는다", async () => {
    const output = (await searchKnowledge({ query: "JEUS", scope: "all" })) as {
      compatibility: Array<{ product: string; framework: string }>;
    };
    expect(output.compatibility.map((c) => c.product)).toEqual(["JEUS 21", "BXM Framework v4.0"]);
    expect(output.compatibility[0].framework).toBe("4.3");
  });

  it("smartSearch 도 같은 표기를 쓴다", async () => {
    const output = await smartSearch({ query: "JEUS" });
    expect(output.compatibility.map((c) => c.product)).toEqual(["JEUS 21", "BXM Framework v4.0"]);
  });
});

describe("통합 검색의 호환 소프트웨어 건수", () => {
  const compatibilityRow = (product_name: string) => ({
    id: 1,
    product_name,
    product_version: `${product_name} 1.0`,
    framework_version: "4.3",
    category: "CMS Solution",
    compatibility_level: 2,
    vendor: "벤더",
    description: null,
  });
  const knowledgeRow = { id: "k1", type: "solution", title: "글", content: "본문", tags: [], importance: 3, score: 0.1 };

  beforeEach(() => {
    // 호환 소프트웨어는 298건이 일치하지만 limit 건(2건)만 돌려준 경우
    hybrid.current = {
      getKnowledge: () => ({}),
      smartSearch: async () => ({
        compatibility: [compatibilityRow("A CMS"), compatibilityRow("B CMS")],
        compatibilityTotal: 298,
        knowledge: [knowledgeRow],
        totalResults: 3,
      }),
    };
  });

  it("searchKnowledge(scope=all) 은 호환 소프트웨어의 전체 일치 건수를 compatibilityTotal 로 싣는다", async () => {
    const output = (await searchKnowledge({ query: "CMS", scope: "all", limit: 2 })) as {
      compatibilityTotal: number;
      compatibility: unknown[];
    };
    expect(output.compatibility).toHaveLength(2);
    expect(output.compatibilityTotal).toBe(298);
  });

  it("totalResults 는 응답에 실은 건수의 합 그대로다", async () => {
    const output = (await searchKnowledge({ query: "CMS", scope: "all", limit: 2 })) as {
      totalResults: number;
      compatibility: unknown[];
      knowledge: unknown[];
    };
    expect(output.totalResults).toBe(output.compatibility.length + output.knowledge.length);
  });

  it("smartSearch 도 같은 값을 싣는다", async () => {
    const output = await smartSearch({ query: "CMS", limit: 2 });
    expect(output.compatibilityTotal).toBe(298);
    expect(output.totalResults).toBe(3);
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

describe("searchKnowledge 도구 — 통합 검색(scope=all)의 지식 필터", () => {
  it("type, tags, minImportance, verifiedOnly 를 지식 검색에 넘긴다", async () => {
    const smartSearchSpy = vi.fn(async () => ({ compatibility: [], knowledge: [], totalResults: 0 }));
    hybrid.current = { getKnowledge: () => ({}), smartSearch: smartSearchSpy };

    await searchKnowledge({
      query: "로그인",
      scope: "all",
      limit: 3,
      type: "solution",
      tags: ["faq"],
      minImportance: 4,
      verifiedOnly: true,
    });

    expect(smartSearchSpy).toHaveBeenCalledTimes(1);
    expect(smartSearchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "로그인",
        limit: 3,
        knowledgeOptions: { type: "solution", tags: ["faq"], minImportance: 4, verifiedOnly: true },
      }),
    );
  });

  it("필터를 주지 않으면 지식 검색에 조건을 걸지 않는다", async () => {
    const smartSearchSpy = vi.fn(async (_options: { knowledgeOptions?: Record<string, unknown> }) => ({
      compatibility: [],
      knowledge: [],
      totalResults: 0,
    }));
    hybrid.current = { getKnowledge: () => ({}), smartSearch: smartSearchSpy };

    await searchKnowledge({ query: "로그인", scope: "all" });

    const options = smartSearchSpy.mock.calls[0]?.[0];
    expect(Object.values(options?.knowledgeOptions ?? {}).filter((value) => value !== undefined)).toEqual([]);
  });
});

describe("searchKnowledge 도구 — 응답의 민감한 식별번호와 제목 정규화", () => {
  let fixture: KnowledgeTableFixture;

  beforeAll(async () => {
    // 테스트용으로 지어낸 번호다. 제목 하나는 자모가 분리된 NFD 로 넣는다
    fixture = await createKnowledgeTable([
      { id: "pii", title: "개인정보 900101-1234567", content: "질문:\n900101-1234567\n\n답변:\n850505-2345678", axis: 1 },
      { id: "nfd", title: "적용가이드".normalize("NFD"), content: "질문:\n본문\n\n답변:\n답", axis: 2 },
      { id: "cut", title: "발췌 경계", content: `${"가".repeat(20)} 900101-1234567 뒤에 이어지는 글`, axis: 3 },
    ]);
    hybrid.current = { getKnowledge: () => fixture.manager };
  });

  afterAll(async () => {
    await fixture.cleanup();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("의미 검색 결과의 제목과 본문에서 주민등록번호 형식을 가린다", async () => {
    useQueryVector(unitVector(1));
    const results = semanticResults(await searchKnowledge({ query: "개인정보", limit: 1 }));

    expect(results[0].id).toBe("pii");
    expect(results[0].title).toBe("개인정보 ******-*******");
    expect(results[0].content).toBe("질문:\n******-*******\n\n답변:\n******-*******");
  });

  it("발췌가 번호 중간에서 끊겨도 번호의 일부를 남기지 않는다", async () => {
    useQueryVector(unitVector(3));
    const results = semanticResults(await searchKnowledge({ query: "발췌", limit: 1, excerptLength: 30 }));

    expect(results[0].id).toBe("cut");
    expect(results[0].content).not.toMatch(/\d/);
    expect(results[0].content).toContain("*");
  });

  it("최근 목록의 제목에서도 가린다", async () => {
    const output = (await searchKnowledge({ sort: "recent", limit: 10 })) as { results: Array<{ id: string; title: string }> };
    expect(output.results.find((row) => row.id === "pii")?.title).toBe("개인정보 ******-*******");
  });

  it("제목은 NFC 로 정규화해서 돌려준다", async () => {
    useQueryVector(unitVector(2));
    const results = semanticResults(await searchKnowledge({ query: "적용가이드", limit: 1 }));

    expect(results[0].id).toBe("nfd");
    expect(results[0].title).toBe("적용가이드");
    expect(results[0].title).toBe((results[0].title as string).normalize("NFC"));
  });
});
