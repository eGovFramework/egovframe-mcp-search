/**
 * 게이트웨이의 가이드 응답 단위 테스트 (조각 안내, 같은 절의 조각 묶기, 청크 이어 읽기)
 *
 * 긴 절은 색인할 때 여러 조각으로 나뉘고 section 끝에 " (k/n)" 이 붙는다 (rag/guideChunking).
 * 게이트웨이는 검색 결과와 청크 읽기 응답에 조각 번호와 이웃 조각의 chunkId 를 싣고, 같은 절의 조각이
 * 여러 개 검색되면 결과 하나로 묶는다.
 *
 * 동봉 인덱스가 어느 청킹으로 만들어졌는지에 기대지 않도록, 가이드 매니저를 고정 데이터로 바꿔치기해
 * 게이트웨이의 동작만 확인한다 (조각 번호 해석 parseSectionPart 는 실제 구현을 쓴다).
 */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";

interface FakeChunk {
  id: string;
  title: string;
  content: string;
  source: string;
  layer: string;
  category: string;
  section: string;
  docTitle: string;
  url: string;
}

const SOURCE = "egovframe-runtime/persistence-layer/dataaccess-mybatis.md";

const chunk = (id: string, section: string, content: string, source: string = SOURCE): FakeChunk => ({
  id,
  title: `MyBatis 가이드: ${section}`,
  content,
  source,
  layer: "egovframe-runtime",
  category: "persistence-layer",
  section,
  docTitle: "MyBatis 가이드",
  url: "/egovframe-runtime/persistence-layer/dataaccess-mybatis/",
});

/** '설정' 절의 다섯 조각 (id 는 s1 ~ s5) */
const SETTING_PARTS = [1, 2, 3, 4, 5].map((part) => chunk(`s${part}`, `설정 (${part}/5)`, `설정 조각 ${part} 의 본문`));

/** 테스트마다 반환값을 바꿔 끼우는 가짜 매니저 (인자와 반환 타입은 테스트가 정한다) */
interface FakeManager {
  searchGuide: Mock<any[], any>;
  getChunkById: Mock<any[], any>;
  getSectionParts: Mock<any[], any>;
}

let manager: FakeManager;

/** 게이트웨이를 가짜 가이드 매니저와 함께 불러온다. */
async function loadGateway() {
  vi.doMock("../../src/rag/guideManager.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../src/rag/guideManager.js")>()),
    getInitializedGuideManager: async () => manager,
    resetGuideManager: vi.fn(),
  }));
  return import("../../src/tools/egovSearchKnowledge.js");
}

/** 검색 결과 블록(### 순번. 제목 ...)으로 나눈다. */
const resultBlocks = (text: string): string[] => text.split("\n\n---\n\n");

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  manager = {
    searchGuide: vi.fn<any[], any>(async () => []),
    getChunkById: vi.fn<any[], any>(async () => null),
    // '설정' 절만 조각으로 나뉘어 있다
    getSectionParts: vi.fn<any[], any>(async (source: string, base: string) =>
      source === SOURCE && base === "설정" ? SETTING_PARTS.map((part, index) => ({ id: part.id, part: index + 1, count: 5 })) : [],
    ),
  };
});

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("../../src/rag/guideManager.js");
  vi.restoreAllMocks();
});

describe("가이드 검색 결과의 조각 안내", () => {
  it("조각으로 나뉜 절의 결과에는 조각 번호와 이웃 조각의 chunkId 를 싣는다", async () => {
    manager.searchGuide.mockResolvedValue([{ ...SETTING_PARTS[1], score: 0.1 }]);
    const { runEgovSearchKnowledge } = await loadGateway();

    const result = await runEgovSearchKnowledge({ scope: "guide", query: "MyBatis 설정" });

    expect(result.isError).toBe(false);
    expect(result.text).toContain('- **조각**: 2/5 (이 조각의 chunkId: "s2", 이전 조각: "s1", 다음 조각: "s3")');
  });

  it("첫 조각에는 다음 조각만, 마지막 조각에는 이전 조각만 적는다", async () => {
    manager.searchGuide.mockResolvedValue([
      { ...SETTING_PARTS[0], score: 0.1 },
      { ...chunk("x1", "개요", "다른 절의 본문"), score: 0.2 },
    ]);
    const { runEgovSearchKnowledge } = await loadGateway();
    const first = await runEgovSearchKnowledge({ scope: "guide", query: "MyBatis 설정" });
    expect(first.text).toContain('- **조각**: 1/5 (이 조각의 chunkId: "s1", 다음 조각: "s2")');

    manager.searchGuide.mockResolvedValue([{ ...SETTING_PARTS[4], score: 0.1 }]);
    const last = await runEgovSearchKnowledge({ scope: "guide", query: "MyBatis 설정" });
    expect(last.text).toContain('- **조각**: 5/5 (이 조각의 chunkId: "s5", 이전 조각: "s4")');
  });

  it("나뉘지 않은 절의 결과에는 조각 줄을 넣지 않고 이웃도 조회하지 않는다", async () => {
    manager.searchGuide.mockResolvedValue([{ ...chunk("x1", "개요", "나뉘지 않은 절의 본문"), score: 0.1 }]);
    const { runEgovSearchKnowledge } = await loadGateway();

    const result = await runEgovSearchKnowledge({ scope: "guide", query: "MyBatis 개요" });

    expect(result.text).not.toContain("**조각**");
    expect(manager.getSectionParts).not.toHaveBeenCalled();
  });
});

describe("같은 절의 조각 묶기", () => {
  it("같은 절의 조각이 여러 개 검색되면 유사도가 가장 높은 조각 하나로 묶고 나머지를 알려 준다", async () => {
    manager.searchGuide.mockResolvedValue([
      { ...SETTING_PARTS[1], score: 0.1 },
      { ...SETTING_PARTS[3], score: 0.2 },
      { ...chunk("x1", "개요", "다른 절의 본문"), score: 0.3 },
      { ...SETTING_PARTS[0], score: 0.4 },
    ]);
    const { runEgovSearchKnowledge } = await loadGateway();

    const result = await runEgovSearchKnowledge({ scope: "guide", query: "MyBatis 설정", limit: 2 });

    expect(result.text).toContain("가이드 검색 결과 (2건)");
    const blocks = resultBlocks(result.text);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toContain("설정 조각 2 의 본문");
    expect(blocks[0]).toContain('> 같은 절의 다른 조각도 검색되었습니다: 4/5 (chunkId "s4"), 1/5 (chunkId "s1").');
    expect(blocks[0]).not.toContain("설정 조각 4 의 본문");
    expect(blocks[1]).toContain("다른 절의 본문");
  });

  it("묶어서 줄어든 자리는 다음 순위의 결과로 채운다", async () => {
    manager.searchGuide.mockResolvedValue([
      { ...SETTING_PARTS[0], score: 0.1 },
      { ...SETTING_PARTS[1], score: 0.2 },
      { ...SETTING_PARTS[2], score: 0.3 },
      { ...chunk("x1", "개요", "개요 본문"), score: 0.4 },
      { ...chunk("x2", "설치", "설치 본문"), score: 0.5 },
    ]);
    const { runEgovSearchKnowledge } = await loadGateway();

    const result = await runEgovSearchKnowledge({ scope: "guide", query: "MyBatis", limit: 3 });

    const blocks = resultBlocks(result.text);
    expect(blocks).toHaveLength(3);
    expect(blocks[1]).toContain("개요 본문");
    expect(blocks[2]).toContain("설치 본문");
  });

  it("조각 번호가 없는 절은 section 이 같아도 묶지 않는다 (서로 다른 절이다)", async () => {
    manager.searchGuide.mockResolvedValue([
      { ...chunk("u1", "설명", "첫 번째 설명 절"), score: 0.1 },
      { ...chunk("u2", "설명", "두 번째 설명 절"), score: 0.2 },
    ]);
    const { runEgovSearchKnowledge } = await loadGateway();

    const result = await runEgovSearchKnowledge({ scope: "guide", query: "설명" });

    expect(resultBlocks(result.text)).toHaveLength(2);
    expect(result.text).not.toContain("같은 절의 다른 조각");
  });

  it("다른 문서의 같은 이름의 절은 묶지 않는다", async () => {
    manager.searchGuide.mockResolvedValue([
      { ...SETTING_PARTS[1], score: 0.1 },
      { ...chunk("o2", "설정 (2/5)", "다른 문서의 설정 조각", "egovframe-runtime/other.md"), score: 0.2 },
    ]);
    const { runEgovSearchKnowledge } = await loadGateway();

    const result = await runEgovSearchKnowledge({ scope: "guide", query: "설정" });

    expect(resultBlocks(result.text)).toHaveLength(2);
  });

  it("한 절의 조각이 후보를 모두 차지해 limit 건을 채우지 못하면, 그 절의 조각을 빼고 다시 가져온다", async () => {
    // 표 하나가 백 개가 넘는 조각으로 나뉜 절이 있다. 그런 절의 조각이 가까운 후보를 모두 차지하면
    // 후보를 아무리 많이 가져와도 결과가 한 건뿐이므로, 이미 결과에 든 절의 조각을 빼고 다음 후보를 가져온다
    const manyParts = Array.from({ length: 150 }, (_, index) =>
      chunk(`t${index + 1}`, `표 (${index + 1}/150)`, `표 조각 ${index + 1}`),
    );
    const others = [chunk("x1", "개요", "개요 본문"), chunk("x2", "설치", "설치 본문")];
    const ranked = [...manyParts, ...others];
    manager.searchGuide.mockImplementation(async (_query: string, options: { limit: number; excludeIds?: string[] }) =>
      ranked
        .filter((row) => !(options.excludeIds ?? []).includes(row.id))
        .slice(0, options.limit)
        .map((row, index) => ({ ...row, score: 0.1 + index * 0.001 })),
    );
    manager.getSectionParts.mockImplementation(async (_source: string, base: string) =>
      base === "표" ? manyParts.map((part, index) => ({ id: part.id, part: index + 1, count: 150 })) : [],
    );
    const { runEgovSearchKnowledge } = await loadGateway();

    const result = await runEgovSearchKnowledge({ scope: "guide", query: "표", limit: 3 });

    const blocks = resultBlocks(result.text);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toContain("표 조각 1");
    expect(blocks[1]).toContain("개요 본문");
    expect(blocks[2]).toContain("설치 본문");
    // 두 번째 조회는 그 절의 모든 조각(첫 조회에 나오지 않은 것 포함)을 뺀다
    const secondCall = manager.searchGuide.mock.calls[1]?.[1] as { excludeIds?: string[] };
    expect(secondCall.excludeIds).toEqual(expect.arrayContaining(["t1", "t19", "t20", "t150"]));
  });

  it("후보가 더 없으면 다시 가져오지 않는다", async () => {
    manager.searchGuide.mockResolvedValue([{ ...SETTING_PARTS[0], score: 0.1 }, { ...SETTING_PARTS[1], score: 0.2 }]);
    const { runEgovSearchKnowledge } = await loadGateway();

    await runEgovSearchKnowledge({ scope: "guide", query: "설정", limit: 5 });

    expect(manager.searchGuide).toHaveBeenCalledTimes(1);
  });

  it("함께 검색된 같은 절의 조각이 많으면 앞의 셋만 적고 나머지는 수로 알린다", async () => {
    manager.searchGuide.mockResolvedValue(SETTING_PARTS.map((part, index) => ({ ...part, score: 0.1 + index * 0.01 })));
    const { runEgovSearchKnowledge } = await loadGateway();

    const result = await runEgovSearchKnowledge({ scope: "guide", query: "설정", limit: 1 });

    expect(result.text).toContain(
      '> 같은 절의 다른 조각도 검색되었습니다: 2/5 (chunkId "s2"), 3/5 (chunkId "s3"), 4/5 (chunkId "s4") 외 1개.',
    );
  });

  it("묶은 뒤에도 limit 건을 채울 수 있도록 후보를 넉넉히 가져온다", async () => {
    const { runEgovSearchKnowledge } = await loadGateway();

    await runEgovSearchKnowledge({ scope: "guide", query: "설정", limit: 5 });
    expect(manager.searchGuide).toHaveBeenLastCalledWith("설정", expect.objectContaining({ limit: 25 }));

    // 가이드 매니저가 받는 limit 의 상한(100)을 넘기지 않는다
    await runEgovSearchKnowledge({ scope: "guide", query: "설정", limit: 20 });
    expect(manager.searchGuide).toHaveBeenLastCalledWith("설정", expect.objectContaining({ limit: 70 }));
  });
});

describe("검색 결과의 잘린 본문", () => {
  it("1,500자를 넘는 본문은 잘라 싣고 chunkId 로 이어 읽는 방법을 알려 준다", async () => {
    manager.searchGuide.mockResolvedValue([{ ...chunk("long1", "개요", "가".repeat(2000)), score: 0.1 }]);
    const { runEgovSearchKnowledge } = await loadGateway();

    const result = await runEgovSearchKnowledge({ scope: "guide", query: "개요" });

    expect(result.text).toContain("전체 2,000자 중 1~1,500자를 표시했습니다");
    expect(result.text).toContain('`filters.chunkId: "long1"`');
    expect(result.text).toContain("`filters.offset: 1500`");
    expect(result.text).not.toContain("가".repeat(1501));
  });
});

describe("청크 이어 읽기 (filters.chunkId)", () => {
  it("긴 청크는 6,000자씩 나눠 읽고 다음 offset 을 알려 준다", async () => {
    manager.getChunkById.mockResolvedValue(chunk("long1", "개요", "나".repeat(14000)));
    const { runEgovSearchKnowledge } = await loadGateway();

    const first = await runEgovSearchKnowledge({ scope: "guide", filters: { chunkId: "long1" } });
    expect(first.isError).toBe(false);
    expect(first.text).toContain("전체 14,000자 중 1~6,000자를 표시했습니다");
    expect(first.text).toContain("`filters.offset: 6000`");

    const last = await runEgovSearchKnowledge({ scope: "guide", filters: { chunkId: "long1", offset: 12000 } });
    expect(last.text).toContain("전체 14,000자 중 12,001~14,000자를 표시했습니다 (청크의 끝)");

    const beyond = await runEgovSearchKnowledge({ scope: "guide", filters: { chunkId: "long1", offset: 20000 } });
    expect(beyond.text).toContain("filters.offset 14000 부터는 남은 내용이 없습니다");
  });

  it("조각으로 나뉜 절의 청크를 읽으면 몇 번째 조각인지와 이웃 조각의 chunkId 를 알려 준다", async () => {
    manager.getChunkById.mockResolvedValue(SETTING_PARTS[1]);
    const { runEgovSearchKnowledge } = await loadGateway();

    const result = await runEgovSearchKnowledge({ scope: "guide", filters: { chunkId: "s2" } });

    expect(result.isError).toBe(false);
    expect(result.text).toContain("설정 조각 2 의 본문");
    expect(result.text).toContain(
      '> 이 절은 5조각으로 나뉘어 있고, 이 청크는 2번째 조각입니다. 이전 조각의 chunkId 는 "s1", 다음 조각의 chunkId 는 "s3" 입니다 (`filters.chunkId` 에 넣어 읽습니다).',
    );
  });

  it("마지막 조각에는 이전 조각만 알려 준다", async () => {
    manager.getChunkById.mockResolvedValue(SETTING_PARTS[4]);
    const { runEgovSearchKnowledge } = await loadGateway();

    const result = await runEgovSearchKnowledge({ scope: "guide", filters: { chunkId: "s5" } });

    expect(result.text).toContain('이 청크는 5번째 조각입니다. 이전 조각의 chunkId 는 "s4" 입니다 (`filters.chunkId` 에 넣어 읽습니다).');
    expect(result.text).not.toContain("다음 조각의");
  });

  it("나뉘지 않은 절의 청크에는 조각 안내를 붙이지 않는다", async () => {
    manager.getChunkById.mockResolvedValue(chunk("x1", "개요", "나뉘지 않은 절의 본문"));
    const { runEgovSearchKnowledge } = await loadGateway();

    const result = await runEgovSearchKnowledge({ scope: "guide", filters: { chunkId: "x1" } });

    expect(result.text).toContain("나뉘지 않은 절의 본문");
    expect(result.text).not.toContain("조각");
    expect(manager.getSectionParts).not.toHaveBeenCalled();
  });
});
