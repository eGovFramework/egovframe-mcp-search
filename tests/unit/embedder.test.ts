/**
 * 로컬 임베더(src/rag/embedder.ts) 단위 테스트
 *
 * 입력 길이 제한은 순수 함수로 검증하고, 실제 모델이 필요한 검증은 모델(models/)이 있을 때만 수행한다.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { AutoTokenizer } from "@xenova/transformers";
import { LocalEmbedder, MAX_EMBED_INPUT_CHARS, truncateEmbedInput } from "../../src/rag/embedder.js";
import { EMBEDDING_MODEL_ID } from "../../src/utils/dataPaths.js";
import { hasEmbeddingModel } from "../integration/_helper.js";
import { GUIDE_TABLE, HAS_BUNDLED_TABLES, KNOWLEDGE_TABLE, openBundledTable } from "./_lanceFixtures.js";

describe("truncateEmbedInput", () => {
  it("상한 이하의 입력은 그대로 둔다", () => {
    const text = "게시판 구현 방법";
    expect(truncateEmbedInput(text)).toBe(text);
    const atLimit = "가".repeat(MAX_EMBED_INPUT_CHARS);
    expect(truncateEmbedInput(atLimit)).toBe(atLimit);
  });

  it("상한을 넘는 입력은 앞에서부터 상한까지만 남긴다", () => {
    const text = "가".repeat(MAX_EMBED_INPUT_CHARS) + "나".repeat(1000);
    expect(truncateEmbedInput(text)).toBe("가".repeat(MAX_EMBED_INPUT_CHARS));
  });

  it("수 MB 입력도 상한 길이로 줄인다", () => {
    expect(truncateEmbedInput("log line\n".repeat(700_000))).toHaveLength(MAX_EMBED_INPUT_CHARS);
  });

  it("서로게이트 쌍의 가운데에서 자르지 않는다", () => {
    const text = "가".repeat(MAX_EMBED_INPUT_CHARS - 1) + "😀" + "나";
    expect(truncateEmbedInput(text)).toBe("가".repeat(MAX_EMBED_INPUT_CHARS - 1));
  });
});

describe("LocalEmbedder — 모델에 넘기는 입력", () => {
  /**
   * 모델을 불러오지 않고, 모델(파이프라인)에 전달되는 입력만 기록하는 임베더를 만든다.
   * 토크나이저는 입력 전체를 처리하므로, 긴 입력이 그대로 넘어가면 12만 자쯤부터 스택 오버플로가 난다.
   */
  function embedderRecordingInputs(): { embedder: LocalEmbedder; inputs: string[] } {
    const embedder = new LocalEmbedder();
    const inputs: string[] = [];
    (embedder as unknown as { model: unknown }).model = async (text: string) => {
      inputs.push(text);
      return { data: new Float32Array(384) };
    };
    return { embedder, inputs };
  }

  it("짧은 입력은 용도 접두어만 붙여 그대로 넘긴다", async () => {
    const { embedder, inputs } = embedderRecordingInputs();
    await embedder.embed("게시판 구현 방법", "query");
    await embedder.embed("게시판은 글을 등록하고 조회한다", "passage");
    expect(inputs).toEqual(["query: 게시판 구현 방법", "passage: 게시판은 글을 등록하고 조회한다"]);
  });

  it("embed 는 긴 입력을 상한까지만 모델에 넘긴다", async () => {
    const { embedder, inputs } = embedderRecordingInputs();
    await embedder.embed("가".repeat(3_000_000), "query");
    expect(inputs).toEqual([`query: ${"가".repeat(MAX_EMBED_INPUT_CHARS)}`]);
  });

  it("embedBatch(색인 경로)도 문서마다 상한까지만 넘긴다", async () => {
    const { embedder, inputs } = embedderRecordingInputs();
    await embedder.embedBatch(["나".repeat(200_000), "짧은 문서"], { purpose: "passage" });
    expect(inputs).toEqual([`passage: ${"나".repeat(MAX_EMBED_INPUT_CHARS)}`, "passage: 짧은 문서"]);
  });
});

describe.skipIf(!hasEmbeddingModel())("LocalEmbedder — 긴 입력", () => {
  const embedder = new LocalEmbedder();

  beforeAll(async () => {
    await embedder.initialize();
  }, 120_000);

  it("20만 자 질의도 스택 오버플로 없이 임베딩한다", async () => {
    const vector = await embedder.embed("가".repeat(200_000), "query");
    expect(vector).toHaveLength(384);
    expect(Array.from(vector).every(Number.isFinite)).toBe(true);
  }, 120_000);

  it("상한 뒤의 내용은 임베딩에 영향을 주지 않는다", async () => {
    const head = "전자정부 표준프레임워크 트랜잭션 설정 방법을 설명한다. ".repeat(400).slice(0, MAX_EMBED_INPUT_CHARS);
    const a = await embedder.embed(head + "뒤에 붙는 서로 다른 내용 A ".repeat(50), "passage");
    const b = await embedder.embed(head + "completely different tail B ".repeat(5000), "passage");
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).toEqual(Array.from(await embedder.embed(head, "passage")));
  }, 120_000);

  it("embedBatch 도 같은 제한을 적용한다", async () => {
    const [long, short] = await embedder.embedBatch(["가".repeat(200_000), "짧은 문서"], { purpose: "passage" });
    expect(long).toHaveLength(384);
    expect(short).toHaveLength(384);
    expect(Array.from(long)).toEqual(Array.from(await embedder.embed("가".repeat(MAX_EMBED_INPUT_CHARS), "passage")));
  }, 120_000);
});

/**
 * 모델은 앞의 512 토큰만 읽는다. 입력을 글자 수로 자르더라도 그 512 토큰이 달라지지 않아야
 * 색인 결과(저장되는 벡터)가 그대로다. 동봉 테이블의 실제 문서로 확인한다.
 */
describe.skipIf(!hasEmbeddingModel() || !HAS_BUNDLED_TABLES)("입력 길이 제한과 색인 결과", () => {
  type Tokenizer = Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;
  let tokenizer: Tokenizer;

  let texts: string[];

  /** 임베딩 파이프라인과 같은 조건(512 토큰에서 자름)으로 구한 토큰 id 를 한 줄 문자열로 돌려준다. */
  const modelInput = (text: string): string =>
    String(tokenizer(`passage: ${text}`, { padding: true, truncation: true }).input_ids.data);

  /** 가이드 청크의 색인 입력 (GuideSearchManager 의 createSearchText 와 같은 형식) */
  const guideText = (r: Record<string, unknown>) =>
    [
      `제목: ${r.title}`,
      `내용: ${r.content}`,
      ...(r.layer ? [`분류: ${r.layer}`] : []),
      ...(r.category ? [`카테고리: ${r.category}`] : []),
    ].join("\n");

  /** 개발자 지식 행의 색인 입력 (DeveloperKnowledgeManager 의 createSearchText 와 같은 형식) */
  const knowledgeText = (r: Record<string, unknown>) => {
    const tags = Array.from((r.tags ?? []) as Iterable<string>);
    return [
      `제목: ${r.title}`,
      `내용: ${r.content}`,
      ...(r.context ? [`상황: ${r.context}`] : []),
      ...(tags.length > 0 ? [`태그: ${tags.join(", ")}`] : []),
    ].join("\n");
  };

  /** 앞에서부터 length 글자로 잘랐을 때 모델 입력이 달라지는 문서 수 */
  const changedBy = (length: number): number =>
    texts.filter((text) => text.length > length && modelInput(text.slice(0, length)) !== modelInput(text)).length;

  beforeAll(async () => {
    tokenizer = await AutoTokenizer.from_pretrained(EMBEDDING_MODEL_ID);
    const guide = await (await openBundledTable(GUIDE_TABLE))
      .query()
      .select(["title", "content", "layer", "category"])
      .toArray();
    const knowledge = await (await openBundledTable(KNOWLEDGE_TABLE))
      .query()
      .select(["title", "content", "context", "tags"])
      .toArray();
    texts = [...guide.map(guideText), ...knowledge.map(knowledgeText)];
  }, 120_000);

  it("동봉 테이블의 모든 색인 입력은 상한에서 잘라도 모델이 읽는 토큰이 원문과 같다", () => {
    expect(texts.length).toBeGreaterThan(1000);
    const changed = texts.filter(
      (text) => text.length > MAX_EMBED_INPUT_CHARS && modelInput(truncateEmbedInput(text)) !== modelInput(text),
    );
    expect(changed).toEqual([]);
  }, 120_000);

  it("상한에는 두 배의 여유가 있다 (상한의 절반에서 잘라도 모델 입력이 같다)", () => {
    // 실패한다면 512 토큰을 채우는 데 상한의 절반보다 긴 글이 생긴 것이다 — 상한을 다시 정한다
    expect(changedBy(MAX_EMBED_INPUT_CHARS / 2)).toBe(0);
  }, 180_000);
});
