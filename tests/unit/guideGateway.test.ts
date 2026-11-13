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

describe("제목이 조각 번호 모양으로 끝나는 나뉘지 않은 절", () => {
  // 원문의 제목이 "## 단계 (3/3)" 처럼 끝나면 나뉘지 않은 절의 section 도 " (k/n)" 으로 끝난다. 조각 목록
  // (getSectionParts)은 번호가 1부터 n까지 빠짐없이 있을 때만 조각을 돌려주므로, 이런 절은 목록에 없다 (가짜 매니저는
  // '설정' 절 말고는 빈 목록을 돌려준다). 게이트웨이는 목록에서 그 청크 자신을 찾았을 때만 조각으로 다룬다

  it("검색 결과에 조각 줄을 싣지 않는다", async () => {
    manager.searchGuide.mockResolvedValue([{ ...chunk("u3", "단계 (3/3)", "나뉘지 않은 절의 본문"), score: 0.1 }]);
    const { runEgovSearchKnowledge } = await loadGateway();

    const result = await runEgovSearchKnowledge({ scope: "guide", query: "단계" });

    expect(result.isError).toBe(false);
    expect(result.text).toContain("### 1. MyBatis 가이드: 단계 (3/3)");
    expect(result.text).toContain("나뉘지 않은 절의 본문");
    expect(result.text).not.toContain("**조각**");
  });

  it("chunkId 로 읽은 결과에 조각 안내를 붙이지 않는다", async () => {
    manager.getChunkById.mockResolvedValue(chunk("u3", "단계 (3/3)", "나뉘지 않은 절의 본문"));
    const { runEgovSearchKnowledge } = await loadGateway();

    const result = await runEgovSearchKnowledge({ scope: "guide", filters: { chunkId: "u3" } });

    expect(result.isError).toBe(false);
    expect(result.text).toContain("나뉘지 않은 절의 본문");
    expect(result.text).not.toContain("조각");
  });

  it("그런 절 두 개가 함께 검색되면 한 절의 조각으로 묶지 않고 따로 싣는다", async () => {
    manager.searchGuide.mockResolvedValue([
      { ...chunk("i1", "설치 (1/3)", "첫째 설치 절의 본문"), score: 0.1 },
      { ...chunk("i2", "설치 (2/3)", "둘째 설치 절의 본문"), score: 0.2 },
    ]);
    const { runEgovSearchKnowledge } = await loadGateway();

    const result = await runEgovSearchKnowledge({ scope: "guide", query: "설치" });

    expect(result.text).toContain("가이드 검색 결과 (2건)");
    const blocks = resultBlocks(result.text);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toContain("첫째 설치 절의 본문");
    expect(blocks[1]).toContain("둘째 설치 절의 본문");
    expect(result.text).not.toContain("같은 절의 다른 조각");
    expect(result.text).not.toContain("**조각**");
    // 조각 목록은 절마다 한 번만 읽는다 (둘째 결과에서는 다시 읽지 않는다)
    expect(manager.getSectionParts).toHaveBeenCalledTimes(1);
  });

  it("따로 실을 때 유사도 순서와 limit 을 지킨다", async () => {
    manager.searchGuide.mockResolvedValue([
      { ...chunk("i1", "설치 (1/3)", "첫째 설치 절의 본문"), score: 0.1 },
      { ...chunk("x1", "개요", "개요 본문"), score: 0.2 },
      { ...chunk("i2", "설치 (2/3)", "둘째 설치 절의 본문"), score: 0.3 },
      { ...chunk("x2", "참고", "참고 본문"), score: 0.4 },
    ]);
    const { runEgovSearchKnowledge } = await loadGateway();

    const result = await runEgovSearchKnowledge({ scope: "guide", query: "설치", limit: 3 });

    const blocks = resultBlocks(result.text);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toContain("첫째 설치 절의 본문");
    expect(blocks[1]).toContain("개요 본문");
    expect(blocks[2]).toContain("둘째 설치 절의 본문");
    expect(result.text).not.toContain("참고 본문");
  });

  it("조각 목록에 그 청크가 없거나 번호와 조각 수가 section 의 표기와 다르면 조각으로 다루지 않는다", async () => {
    // '설정' 절의 조각 목록은 s1 ~ s5 (5조각)다. 같은 문서에 section 이 '설정 (2/5)' 인 다른 행(z2),
    // '설정 (2/4)' 로 적힌 행(s2 와 id 가 같다), '설정 (4/5)' 로 적힌 행(s3 과 id 가 같다)은 그 절의 조각이 아니다
    manager.searchGuide.mockResolvedValue([
      { ...chunk("z2", "설정 (2/5)", "목록에 없는 행의 본문"), score: 0.1 },
      { ...chunk("s2", "설정 (2/4)", "조각 수가 다른 행의 본문"), score: 0.2 },
      { ...chunk("s3", "설정 (4/5)", "번호가 다른 행의 본문"), score: 0.3 },
    ]);
    const { runEgovSearchKnowledge } = await loadGateway();

    const result = await runEgovSearchKnowledge({ scope: "guide", query: "설정" });

    expect(resultBlocks(result.text)).toHaveLength(3);
    expect(result.text).not.toContain("**조각**");
    expect(result.text).not.toContain("같은 절의 다른 조각");

    manager.getChunkById.mockResolvedValue(chunk("z2", "설정 (2/5)", "목록에 없는 행의 본문"));
    const read = await runEgovSearchKnowledge({ scope: "guide", filters: { chunkId: "z2" } });
    expect(read.text).toContain("목록에 없는 행의 본문");
    expect(read.text).not.toContain("조각");
  });

  it("조각으로 확인된 절의 결과 아래에도 확인된 조각만 묶는다", async () => {
    // '설정' 절의 조각(s2)이 결과에 든 뒤에, section 은 '설정 (3/5)' 이지만 조각 목록에 없는 행(z3)이 검색된다
    manager.searchGuide.mockResolvedValue([
      { ...SETTING_PARTS[1], score: 0.1 },
      { ...chunk("z3", "설정 (3/5)", "목록에 없는 행의 본문"), score: 0.2 },
      { ...SETTING_PARTS[3], score: 0.3 },
    ]);
    const { runEgovSearchKnowledge } = await loadGateway();

    const result = await runEgovSearchKnowledge({ scope: "guide", query: "설정" });

    const blocks = resultBlocks(result.text);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toContain('> 같은 절의 다른 조각도 검색되었습니다: 4/5 (chunkId "s4").');
    expect(blocks[1]).toContain("목록에 없는 행의 본문");
    expect(blocks[1]).not.toContain("조각");
    expect(manager.getSectionParts).toHaveBeenCalledTimes(1);
  });

  it("실제로 조각으로 나뉜 절은 지금처럼 묶고, 나뉘지 않은 절과 섞여 검색되어도 조각끼리만 묶는다", async () => {
    manager.searchGuide.mockResolvedValue([
      { ...SETTING_PARTS[1], score: 0.1 },
      { ...chunk("i1", "설치 (1/3)", "첫째 설치 절의 본문"), score: 0.2 },
      { ...SETTING_PARTS[3], score: 0.3 },
      { ...chunk("i2", "설치 (2/3)", "둘째 설치 절의 본문"), score: 0.4 },
    ]);
    const { runEgovSearchKnowledge } = await loadGateway();

    const result = await runEgovSearchKnowledge({ scope: "guide", query: "설정 설치" });

    const blocks = resultBlocks(result.text);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toContain('- **조각**: 2/5 (이 조각의 chunkId: "s2", 이전 조각: "s1", 다음 조각: "s3")');
    expect(blocks[0]).toContain('> 같은 절의 다른 조각도 검색되었습니다: 4/5 (chunkId "s4").');
    expect(blocks[1]).toContain("첫째 설치 절의 본문");
    expect(blocks[1]).not.toContain("조각");
    expect(blocks[2]).toContain("둘째 설치 절의 본문");
    expect(blocks[2]).not.toContain("조각");
  });
});

describe("후보를 다시 가져올 때 빼는 청크", () => {
  it("조각이 아닌 것으로 확인된 절과 이름이 같은 다른 절은 빼지 않는다", async () => {
    // '설치 (1/3)' 은 나뉘지 않은 절이다. 같은 문서에 번호 없는 '설치' 절이 있으면 조각 목록 조회는 그 절을 돌려준다
    // (조각이 아닌 이름으로 조회하면 section 전체가 그 이름과 같은 행이 나온다). 그 절은 '설치 (1/3)' 의 조각이 아니므로
    // 아직 결과에 싣지 않았다면 다음 조회에서 빼면 안 된다
    const fillers = Array.from({ length: 18 }, (_, index) => chunk(`d${index + 1}`, "개요", "개요 본문"));
    const ranked = [chunk("i1", "설치 (1/3)", "첫째 설치 절의 본문"), ...fillers, chunk("plain", "설치", "번호 없는 설치 절의 본문")];
    manager.searchGuide.mockImplementation(async (_query: string, options: { limit: number; excludeIds?: string[] }) =>
      ranked
        .filter((row) => !(options.excludeIds ?? []).includes(row.id))
        .slice(0, options.limit)
        .map((row, index) => ({ ...row, score: 0.1 + index * 0.001 })),
    );
    manager.getSectionParts.mockImplementation(async (_source: string, base: string) =>
      base === "설치" ? [{ id: "plain", part: 1, count: 1 }] : [],
    );
    const { runEgovSearchKnowledge } = await loadGateway();

    // limit 3 이면 후보를 19건씩 가져온다. 첫 조회의 19건은 '설치 (1/3)' 과 본문이 같은 '개요' 18건이라 결과가 2건뿐이고,
    // 그래서 받은 청크를 빼고 다시 가져온다
    const result = await runEgovSearchKnowledge({ scope: "guide", query: "설치", limit: 3 });

    const blocks = resultBlocks(result.text);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toContain("첫째 설치 절의 본문");
    expect(blocks[1]).toContain("개요 본문");
    expect(blocks[2]).toContain("번호 없는 설치 절의 본문");
    const secondCall = manager.searchGuide.mock.calls[1]?.[1] as { excludeIds?: string[] };
    expect(secondCall.excludeIds).toContain("i1");
    expect(secondCall.excludeIds).not.toContain("plain");
  });
});

describe("조각 목록을 읽는 횟수", () => {
  it("결과로 싣는 절마다 한 번만 읽는다 (함께 검색된 조각마다 읽지 않는다)", async () => {
    manager.searchGuide.mockResolvedValue([
      { ...SETTING_PARTS[1], score: 0.1 },
      { ...SETTING_PARTS[3], score: 0.2 },
      { ...SETTING_PARTS[0], score: 0.3 },
      { ...chunk("x1", "개요", "다른 절의 본문"), score: 0.4 },
    ]);
    const { runEgovSearchKnowledge } = await loadGateway();

    await runEgovSearchKnowledge({ scope: "guide", query: "MyBatis 설정" });

    expect(manager.getSectionParts).toHaveBeenCalledTimes(1);
    expect(manager.getSectionParts).toHaveBeenCalledWith(SOURCE, "설정");
  });

  it("limit 을 넘어 결과에 싣지 않는 후보의 조각 목록은 읽지 않는다", async () => {
    manager.searchGuide.mockResolvedValue([
      { ...chunk("x1", "개요", "개요 본문"), score: 0.1 },
      { ...SETTING_PARTS[0], score: 0.2 },
      { ...chunk("i1", "설치 (1/3)", "첫째 설치 절의 본문"), score: 0.3 },
    ]);
    const { runEgovSearchKnowledge } = await loadGateway();

    const result = await runEgovSearchKnowledge({ scope: "guide", query: "MyBatis", limit: 1 });

    expect(resultBlocks(result.text)).toHaveLength(1);
    expect(manager.getSectionParts).not.toHaveBeenCalled();
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
