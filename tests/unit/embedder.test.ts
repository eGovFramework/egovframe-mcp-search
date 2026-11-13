/**
 * 로컬 임베더(src/rag/embedder.ts) 단위 테스트
 *
 * 입력 길이 제한은 순수 함수로 검증하고, 실제 모델이 필요한 검증은 모델(models/)이 있을 때만 수행한다.
 * 모델 로드 실패는 transformers.js 의 로컬 모델 경로를 임시 디렉토리로 돌려 재현한다
 * (저장소의 models/ 는 건드리지 않는다).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { AutoTokenizer, env } from "@xenova/transformers";
import { LocalEmbedder, MAX_EMBED_INPUT_CHARS, truncateEmbedInput } from "../../src/rag/embedder.js";
import { EMBEDDING_MODEL_ID } from "../../src/utils/dataPaths.js";
import { INTERNAL_ERROR_MESSAGE, UserFacingError, toUserMessage } from "../../src/utils/errors.js";
import { hasEmbeddingModel } from "../integration/_helper.js";
import { GUIDE_TABLE, HAS_BUNDLED_TABLES, KNOWLEDGE_TABLE, openBundledTable } from "./_lanceFixtures.js";

describe("LocalEmbedder — 모델 로드 실패", () => {
  const MODEL_NOT_FOUND_MESSAGE =
    "임베딩 모델을 찾을 수 없습니다 (models/Xenova/multilingual-e5-small). 저장소를 클론해 쓰는 경우 npm run fetch-model 을 실행하세요.";

  let tmpDir: string;
  let savedModelPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "egov-embedder-"));
    savedModelPath = env.localModelPath;
    env.localModelPath = tmpDir;
    // 실패 경위는 stderr 로 나간다 — 테스트 출력에서는 가린다
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(async () => {
    env.localModelPath = savedModelPath;
    vi.restoreAllMocks();
    await fs.remove(tmpDir);
    // 모델 파일을 복사해 넣는 테스트가 있다 — 임시 디렉토리가 남지 않았는지 확인한다
    expect(await fs.pathExists(tmpDir)).toBe(false);
  });

  it("모델 파일이 없으면 조치 방법을 담은 UserFacingError 를 던진다", async () => {
    const error = await new LocalEmbedder().initialize().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as Error).message).toBe(MODEL_NOT_FOUND_MESSAGE);
    // 도구 응답에 그대로 실리는 문구다 — 설치 위치의 절대 경로가 들어가면 안 된다
    expect(toUserMessage(error)).toBe(MODEL_NOT_FOUND_MESSAGE);
    expect(toUserMessage(error)).not.toContain(tmpDir);
  });

  it("모델 파일이 없는 것은 예상된 상황이므로 로그에 스택을 남기지 않는다", async () => {
    const logged = vi.mocked(console.error);
    logged.mockClear();

    await new LocalEmbedder().initialize().catch(() => {});

    // 오류 객체를 통째로 넘기면 호출마다 여러 줄의 스택이 stderr 에 찍힌다
    const errorObjects = logged.mock.calls.flat().filter((argument) => argument instanceof Error);
    expect(errorObjects).toEqual([]);
    expect(logged.mock.calls.flat().join("\n")).toContain("임베딩 모델");
  });

  // 가중치(onnx)만 없는 불완전한 모델 디렉토리 — 설정·토크나이저는 실제 모델의 것을 써야 해서 모델이 있을 때만 돈다
  it.skipIf(!hasEmbeddingModel())("모델 파일 가운데 일부만 없어도 같은 안내를 던진다", async () => {
    const modelDir = path.join(tmpDir, EMBEDDING_MODEL_ID);
    await fs.ensureDir(modelDir);
    // 링크를 걸지 않고 복사한다 — Windows 에서는 권한 없이 파일 심볼릭 링크를 만들 수 없다
    for (const file of ["config.json", "tokenizer.json", "tokenizer_config.json"]) {
      await fs.copyFile(path.join(savedModelPath, EMBEDDING_MODEL_ID, file), path.join(modelDir, file));
    }

    const error = await new LocalEmbedder().initialize().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as Error).message).toBe(MODEL_NOT_FOUND_MESSAGE);
  });

  it("embed() 도 같은 안내를 던진다 (임베딩 생성 실패로 감싸지 않는다)", async () => {
    const error = await new LocalEmbedder().embed("게시판", "query").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as Error).message).toBe(MODEL_NOT_FOUND_MESSAGE);
  });

  describe("모델 파일이 있지만 쓸 수 없는 경우", () => {
    const MODEL_FILES = ["config.json", "tokenizer.json", "tokenizer_config.json", "onnx/model_quantized.onnx"];
    const DAMAGED = /임베딩 모델 파일을 읽지 못했습니다/;

    /** 임시 모델 디렉토리에 네 파일을 만든다. 내용을 주지 않은 파일은 한 글자짜리 자리 채움이다. */
    async function writeModelFiles(contents: Record<string, string | Buffer> = {}): Promise<string> {
      const modelDir = path.join(tmpDir, EMBEDDING_MODEL_ID);
      for (const file of MODEL_FILES) {
        await fs.outputFile(path.join(modelDir, file), contents[file] ?? "x");
      }
      return modelDir;
    }

    it("내용이 깨진 파일은 다시 받으라는 안내로 알린다 (경로는 싣지 않는다)", async () => {
      await writeModelFiles({
        "config.json": "{ 깨진 JSON",
        "tokenizer.json": "{ 깨진 JSON",
        "tokenizer_config.json": "{ 깨진 JSON",
      });

      const error = await new LocalEmbedder().initialize().catch((e: unknown) => e);

      expect(error).toBeInstanceOf(UserFacingError);
      expect((error as Error).message).toMatch(DAMAGED);
      expect((error as Error).message).toContain("npm run fetch-model");
      expect((error as Error).message).not.toContain(tmpDir);
    });

    it("크기가 0 인 파일은 불러오기 전에 걸러 낸다", async () => {
      await writeModelFiles({ "onnx/model_quantized.onnx": "" });
      const error = await new LocalEmbedder().initialize().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(UserFacingError);
      expect((error as Error).message).toMatch(DAMAGED);
    });

    it("파일 자리에 디렉토리가 있으면 불러오기 전에 걸러 낸다", async () => {
      const modelDir = await writeModelFiles();
      await fs.remove(path.join(modelDir, "onnx/model_quantized.onnx"));
      await fs.ensureDir(path.join(modelDir, "onnx/model_quantized.onnx"));

      const error = await new LocalEmbedder().initialize().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(UserFacingError);
      expect((error as Error).message).toMatch(DAMAGED);
    });

    // 권한을 뺏어도 읽을 수 있는 환경(Windows, root)에서는 재현되지 않는다
    it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
      "읽을 권한이 없는 파일은 불러오기 전에 걸러 낸다 (불러오면 서버 프로세스가 죽는다)",
      async () => {
        const modelDir = await writeModelFiles();
        const onnx = path.join(modelDir, "onnx/model_quantized.onnx");
        await fs.chmod(onnx, 0o000);
        try {
          const error = await new LocalEmbedder().initialize().catch((e: unknown) => e);
          expect(error).toBeInstanceOf(UserFacingError);
          expect((error as Error).message).toMatch(DAMAGED);
        } finally {
          await fs.chmod(onnx, 0o644);
        }
      },
    );

    // 잘린 가중치 파일: 설정·토크나이저는 실제 모델의 것을 써야 해서 모델이 있을 때만 돈다
    it.skipIf(!hasEmbeddingModel())(
      "불러오기에 실패한 모델은 다시 불러오지 않고 같은 안내를 돌려준다 (다시 불러오면 서버가 멈춘다)",
      async () => {
        const realDir = path.join(savedModelPath, EMBEDDING_MODEL_ID);
        const modelDir = path.join(tmpDir, EMBEDDING_MODEL_ID);
        await fs.ensureDir(path.join(modelDir, "onnx"));
        for (const file of MODEL_FILES.slice(0, 3)) {
          await fs.copyFile(path.join(realDir, file), path.join(modelDir, file));
        }
        // 가중치 파일의 앞 1MB 만 남긴다 (내려받다가 끊긴 파일)
        const head = Buffer.alloc(1024 * 1024);
        const fd = await fs.open(path.join(realDir, "onnx/model_quantized.onnx"), "r");
        await fs.read(fd, head, 0, head.length, 0);
        await fs.close(fd);
        await fs.writeFile(path.join(modelDir, "onnx/model_quantized.onnx"), head);

        const embedder = new LocalEmbedder();
        const first = await embedder.initialize().catch((e: unknown) => e);
        expect(first).toBeInstanceOf(UserFacingError);
        expect((first as Error).message).toMatch(DAMAGED);

        const startedAt = Date.now();
        const second = await embedder.embed("게시판", "query").catch((e: unknown) => e);
        expect(second).toBeInstanceOf(UserFacingError);
        expect((second as Error).message).toMatch(DAMAGED);
        expect(Date.now() - startedAt).toBeLessThan(1000);
      },
      60_000,
    );
  });

  it.skipIf(!hasEmbeddingModel())(
    "실패한 뒤에도 모델이 준비되면 다시 불러온다",
    async () => {
      const embedder = new LocalEmbedder();
      await expect(embedder.initialize()).rejects.toBeInstanceOf(UserFacingError);

      env.localModelPath = savedModelPath;
      await embedder.initialize();
      expect(embedder.getModelInfo().isLoaded).toBe(true);
    },
    120_000,
  );
});

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
