/**
 * 가이드 문서 청킹(chunkMarkdown)과 색인 대상 판정(kb/guideIndexer) 단위 테스트
 *
 * 색인 결과(source, layer, category)가 플랫폼과 무관하게 같은지, 게시되지 않는 문서(draft)가
 * 색인에서 빠지는지 확인한다. 대부분 순수 함수 검증이고, 실제 색인(indexGuideDirectory)은
 * 임베딩 모델이 있을 때만 임시 디렉토리에서 돌려 본다.
 *
 * 긴 절을 나누는 규칙은 guideChunkSplit.test.ts 에서 확인한다. 여기서는 색인 경로가 그 결과를 그대로
 * 테이블에 넣는지와, 넣은 조각을 이웃 조각 조회(getSectionParts)로 찾을 수 있는지를 본다.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import * as lancedb from "@lancedb/lancedb";
import { GuideSearchManager, chunkMarkdown, parseFrontMatter, parseSectionPart } from "../../src/rag/guideManager.js";
import { estimateGuideChunkTokens, estimateTokens, guideSearchText } from "../../src/rag/guideChunking.js";
import { getEmbedder } from "../../src/rag/embedder.js";
import { chunkGuideDocument, indexGuideDirectory, relativeGuidePath } from "../../src/kb/guideIndexer.js";
import { REPO_ROOT, hasEmbeddingModel } from "../integration/_helper.js";

const paragraph = (label: string) => `${label} 문단입니다. `.repeat(10).trim();

const BODY = [`# Transaction 서비스`, "", paragraph("개요"), "", "## 설명", "", paragraph("설명")].join("\n");

/** 기본 상한을 넘어 여러 조각으로 나뉘는 절 (제목 없이 문단 스무 개) */
const LONG_SECTION = [
  "## 선언적 트랜잭션",
  "",
  ...Array.from({ length: 20 }, (_, i) => [`${i + 1}번째 ${paragraph("선언적 트랜잭션 설정")}`, ""]).flat(),
].join("\n");

describe("chunkMarkdown — 경로에서 layer / category 를 구한다", () => {
  const frontmatter = { title: "Transaction 서비스", url: "/egovframe-runtime/persistence-layer/transaction/" };

  it("POSIX 경로: 첫 디렉토리가 layer, 둘째 디렉토리가 category", () => {
    const chunks = chunkMarkdown(BODY, frontmatter, "egovframe-runtime/persistence-layer/transaction.md");
    expect(chunks).toHaveLength(2);
    for (const chunk of chunks) {
      expect(chunk.layer).toBe("egovframe-runtime");
      expect(chunk.category).toBe("persistence-layer");
      expect(chunk.source).toBe("egovframe-runtime/persistence-layer/transaction.md");
    }
  });

  it("역슬래시 경로(Windows)도 같은 layer / category / source 를 만든다", () => {
    const posix = chunkMarkdown(BODY, frontmatter, "egovframe-runtime/persistence-layer/transaction.md");
    const windows = chunkMarkdown(BODY, frontmatter, "egovframe-runtime\\persistence-layer\\transaction.md");
    expect(windows).toEqual(posix);
  });

  it("layer 바로 아래 문서는 category 가 비어 있다 — 역슬래시 경로에서도", () => {
    for (const filePath of ["egovframe-runtime/intro.md", "egovframe-runtime\\intro.md"]) {
      const [chunk] = chunkMarkdown(BODY, frontmatter, filePath);
      expect(chunk.layer).toBe("egovframe-runtime");
      expect(chunk.category).toBe("");
      expect(chunk.source).toBe("egovframe-runtime/intro.md");
    }
  });

  it("제목이 없으면 파일 이름을 문서 제목으로 쓴다 — 역슬래시 경로에서도", () => {
    for (const filePath of ["common-component/security/role-management.md", "common-component\\security\\role-management.md"]) {
      const [chunk] = chunkMarkdown(BODY, { title: "" }, filePath);
      expect(chunk.docTitle).toBe("role-management");
      expect(chunk.title).toBe("role-management");
    }
  });
});

describe("chunkGuideDocument — 색인 대상 판정", () => {
  const withFrontMatter = (...keys: string[]) => ["---", ...keys, "---", BODY].join("\n");

  it("게시된 문서는 청크로 나눈다", () => {
    const chunks = chunkGuideDocument(
      withFrontMatter("title: Transaction 서비스", "url: /egovframe-runtime/persistence-layer/transaction/"),
      "egovframe-runtime/persistence-layer/transaction.md",
    );
    expect(chunks).not.toBeNull();
    expect(chunks).toHaveLength(2);
    expect(chunks![0]).toMatchObject({
      docTitle: "Transaction 서비스",
      url: "/egovframe-runtime/persistence-layer/transaction/",
      layer: "egovframe-runtime",
      category: "persistence-layer",
    });
  });

  it("draft: true 인 문서는 색인하지 않는다", () => {
    expect(
      chunkGuideDocument(
        withFrontMatter("draft: true", "title: 개발환경 운영 가이드"),
        "egovframe-development/operation-guide/operation-guide.md",
      ),
    ).toBeNull();
    // 블록 전체를 들여쓴 문서와 CRLF 문서의 draft 도 알아본다
    expect(chunkGuideDocument(withFrontMatter("  title: 초안", "  draft: true"), "a/b/c.md")).toBeNull();
    expect(chunkGuideDocument(withFrontMatter("title: 초안", "draft: true").replace(/\n/g, "\r\n"), "a/b/c.md")).toBeNull();
  });

  it("draft: false 이거나 draft 키가 없는 문서는 색인한다", () => {
    expect(chunkGuideDocument(withFrontMatter("draft: false", "title: 게시"), "a/b/c.md")).toHaveLength(2);
    expect(chunkGuideDocument(withFrontMatter("title: 게시"), "a/b/c.md")).toHaveLength(2);
    expect(chunkGuideDocument(BODY, "a/b/c.md")).toHaveLength(2);
  });

  it("가이드 저장소의 기여자용 문서(최상위 _index.md, docs/ 아래)는 색인하지 않는다", () => {
    // 최상위 _index.md 는 컨트리뷰션 안내 페이지, docs/ 는 문서 저장소의 파일 트리 같은 기여자용 문서다
    expect(chunkGuideDocument(withFrontMatter("title: Contribution 전용 페이지"), "_index.md")).toBeNull();
    expect(chunkGuideDocument(BODY, "docs/directory-structure.md")).toBeNull();
    expect(chunkGuideDocument(withFrontMatter("title: 안내"), "docs/sub/guide.md")).toBeNull();
  });

  it("하위 디렉토리의 _index.md 와 이름에 docs 가 든 다른 경로는 지금처럼 색인한다", () => {
    expect(chunkGuideDocument(withFrontMatter("title: 공통컴포넌트"), "common-component/_index.md")).toHaveLength(2);
    expect(chunkGuideDocument(withFrontMatter("title: 문서"), "egovframe-runtime/docs/a.md")).toHaveLength(2);
    expect(chunkGuideDocument(withFrontMatter("title: 문서"), "docs.md")).toHaveLength(2);
    expect(chunkGuideDocument(withFrontMatter("title: 시작하기"), "gettingstarted.md")).toHaveLength(2);
  });

  it("본문이 너무 짧은 문서는 색인하지 않는다", () => {
    expect(chunkGuideDocument(["---", "title: 목차", "---", "# 목차", "", "짧은 본문"].join("\n"), "a/_index.md")).toBeNull();
  });

  it("긴 절은 기본 상한으로 나눈 조각이 된다 (chunkMarkdown 의 결과 그대로)", () => {
    const relative = "egovframe-runtime/persistence-layer/transaction.md";
    const content = [withFrontMatter("title: Transaction 서비스"), "", LONG_SECTION].join("\n");
    const chunks = chunkGuideDocument(content, relative)!;
    const { frontmatter, body } = parseFrontMatter(content);
    expect(chunks).toEqual(chunkMarkdown(body, frontmatter, relative));

    // 짧은 절은 그대로, 긴 절은 조각 번호가 붙은 여러 청크
    expect(chunks.slice(0, 2).map((chunk) => chunk.section)).toEqual(["개요", "설명"]);
    const parts = chunks.slice(2);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.map((chunk) => chunk.section)).toEqual(
      parts.map((_, index) => `선언적 트랜잭션 (${index + 1}/${parts.length})`),
    );
  });
});

describe("가이드 색인 경로 — build-index 와 update CLI 가 같은 청킹을 쓴다", () => {
  it("두 경로 모두 kb/guideIndexer 의 indexGuideDirectory 로 색인하고, 청킹을 따로 부르지 않는다", async () => {
    for (const file of ["src/scripts/buildIndex.ts", "src/cli/lancedb/guide.ts"]) {
      const source = await fs.readFile(path.join(REPO_ROOT, file), "utf-8");
      expect(source, file).toMatch(/import \{[^}]*\bindexGuideDirectory\b[^}]*\} from ['"][./]+\/kb\/guideIndexer\.js['"]/);
      expect(source, file).toMatch(/await indexGuideDirectory\(/);
      expect(source, file).not.toMatch(/chunkMarkdown|chunkGuideDocument|splitGuideSections|guideChunking/);
    }
  });
});

describe("GuideSearchManager.addGuideBatch — 임베딩에 넘기는 문자열", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "egov-guide-embed-input-"));
  });

  afterAll(async () => {
    await fs.remove(tmpDir);
  });

  it("청킹이 상한을 잴 때 쓴 검색 텍스트(guideSearchText)를 그대로 임베딩하고, 벡터를 그 청크의 행에 넣는다", async () => {
    const relative = "egovframe-runtime/persistence-layer/transaction.md";
    const content = ["---", "title: Transaction 서비스", "---", BODY, "", LONG_SECTION].join("\n");
    const chunks = chunkGuideDocument(content, relative)!;
    expect(chunks.length).toBeGreaterThan(3);

    // 임베딩 모델 대신 세운 것: 넘어온 문자열을 적어 두고, i번째 문자열에는 i번째 축만 1 인 벡터를 돌려준다
    const embedder = getEmbedder();
    const original = embedder.embedBatch;
    const calls: Array<{ texts: string[]; purpose: string | undefined }> = [];
    embedder.embedBatch = async (texts, options = {}) => {
      calls.push({ texts: [...texts], purpose: options.purpose });
      return texts.map((_, index) => Float32Array.from({ length: 384 }, (_, axis) => (axis === index ? 1 : 0)));
    };
    try {
      const manager = new GuideSearchManager(tmpDir);
      await manager.initialize();
      expect(await manager.addGuideBatch(chunks)).toBe(chunks.length);
    } finally {
      embedder.embedBatch = original;
    }

    // 한 번에, 색인 문서용(passage)으로, 제목과 분류를 붙인 검색 텍스트를 넘긴다 (본문만 넘기지 않는다)
    expect(calls).toHaveLength(1);
    expect(calls[0].purpose).toBe("passage");
    expect(calls[0].texts).toEqual(
      chunks.map((chunk) => guideSearchText(chunk.title, chunk.content, chunk.layer, chunk.category)),
    );
    // 청킹이 잰 크기는 이 문자열 앞에 임베더가 붙이는 접두("passage: ")를 더한 것이다
    chunks.forEach((chunk, index) => {
      expect(estimateGuideChunkTokens(chunk)).toBeCloseTo(estimateTokens(`passage: ${calls[0].texts[index]}`), 6);
    });

    // i번째 청크의 행에 i번째 문자열의 벡터가 들어 있다
    const rows = await (await (await lancedb.connect(tmpDir)).openTable("egovframe_guide")).query().toArray();
    expect(rows).toHaveLength(chunks.length);
    chunks.forEach((chunk, index) => {
      const row = rows.find((candidate: { title: string; content: string }) => candidate.title === chunk.title && candidate.content === chunk.content);
      expect(row, chunk.title).toBeDefined();
      expect(Array.from(row.vector as ArrayLike<number>).indexOf(1), chunk.title).toBe(index);
    });
  });
});

describe.skipIf(!hasEmbeddingModel())("indexGuideDirectory — draft 문서 제외", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "egov-guide-index-"));
  });

  afterAll(async () => {
    await fs.remove(tmpDir);
  });

  it(
    "draft 문서와 본문이 짧은 문서를 건너뛰고 게시된 문서만 색인한다",
    async () => {
      const guideDir = path.join(tmpDir, "docs");
      const write = (relative: string, content: string) => fs.outputFile(path.join(guideDir, relative), content);
      await write(
        "egovframe-runtime/persistence-layer/transaction.md",
        ["---", "title: Transaction 서비스", "url: /egovframe-runtime/persistence-layer/transaction/", "---", BODY].join("\n"),
      );
      await write(
        "egovframe-development/operation-guide/operation-guide.md",
        ["---", "draft: true", "title: 개발환경 운영 가이드", "---", BODY].join("\n"),
      );
      await write("egovframe-runtime/_index.md", ["---", "title: 실행환경", "---", "# 실행환경"].join("\n"));

      // 테이블은 직접 만들어 둔다 (매니저의 initialize 가 없는 테이블을 만드는지에 기대지 않는다)
      const dbDir = path.join(tmpDir, "lance");
      const table = await (await lancedb.connect(dbDir)).createTable("egovframe_guide", [
        {
          id: "__placeholder__",
          title: "placeholder",
          content: "placeholder",
          source: "placeholder.md",
          layer: "placeholder",
          category: "placeholder",
          section: "placeholder",
          docTitle: "placeholder",
          url: "",
          vector: new Array(384).fill(0),
        },
      ]);
      await table.delete("id = '__placeholder__'");

      const manager = new GuideSearchManager(dbDir);
      await manager.initialize();
      const stats = await indexGuideDirectory(manager, guideDir);

      expect(stats.totalChunks).toBe(2);
      expect(stats.skippedFiles).toBe(2);
      expect(stats.totalFiles).toBe(1);
      expect(stats.byLayer).toEqual({ "egovframe-runtime": 2 });

      const indexed = await (await (await lancedb.connect(dbDir)).openTable("egovframe_guide")).query().toArray();
      expect(indexed.map((row: { source: string }) => row.source)).toEqual([
        "egovframe-runtime/persistence-layer/transaction.md",
        "egovframe-runtime/persistence-layer/transaction.md",
      ]);
    },
    120_000,
  );
});

describe.skipIf(!hasEmbeddingModel())("indexGuideDirectory — 긴 절의 조각과 이웃 조각 조회", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "egov-guide-parts-index-"));
  });

  afterAll(async () => {
    await fs.remove(tmpDir);
  });

  it(
    "색인한 행은 chunkGuideDocument 의 청크와 같고, getSectionParts 가 한 절의 조각을 순서대로 돌려준다",
    async () => {
      const guideDir = path.join(tmpDir, "docs");
      const relative = "egovframe-runtime/persistence-layer/transaction.md";
      const content = ["---", "title: Transaction 서비스", "---", BODY, "", LONG_SECTION].join("\n");
      await fs.outputFile(path.join(guideDir, relative), content);
      const expected = chunkGuideDocument(content, relative)!;
      const expectedParts = expected.filter((chunk) => parseSectionPart(chunk.section) !== null);
      expect(expectedParts.length).toBeGreaterThan(1);

      const manager = new GuideSearchManager(path.join(tmpDir, "lance"));
      await manager.initialize();
      const stats = await indexGuideDirectory(manager, guideDir);
      expect(stats.totalChunks).toBe(expected.length);

      // 번호가 붙은 절: 조각 번호 순으로, 본문은 청킹 결과 그대로
      const parts = await manager.getSectionParts(relative, "선언적 트랜잭션");
      expect(parts.map(({ part, count }) => [part, count])).toEqual(
        expectedParts.map((_, index) => [index + 1, expectedParts.length]),
      );
      for (const [index, part] of parts.entries()) {
        const stored = await manager.getChunkById(part.id);
        expect(stored?.section).toBe(expectedParts[index].section);
        expect(stored?.title).toBe(expectedParts[index].title);
        expect(stored?.content).toBe(expectedParts[index].content);
      }

      // 나뉘지 않은 절: 조각 하나
      const whole = await manager.getSectionParts(relative, "설명");
      expect(whole).toHaveLength(1);
      expect(whole[0]).toMatchObject({ part: 1, count: 1 });
      expect((await manager.getChunkById(whole[0].id))?.content).toBe(paragraph("설명"));
    },
    120_000,
  );
});

describe("relativeGuidePath", () => {
  it("가이드 디렉토리 기준 상대 경로를 POSIX 구분자로 돌려준다", () => {
    expect(
      relativeGuidePath("/data/docs", "/data/docs/egovframe-runtime/persistence-layer/transaction.md", path.posix),
    ).toBe("egovframe-runtime/persistence-layer/transaction.md");
  });

  it("Windows 경로도 POSIX 구분자로 바꾼다", () => {
    expect(
      relativeGuidePath(
        "C:\\t\\docs",
        "C:\\t\\docs\\egovframe-runtime\\persistence-layer\\transaction.md",
        path.win32,
      ),
    ).toBe("egovframe-runtime/persistence-layer/transaction.md");
  });

  it("Windows 에서 색인해도 layer / category 가 POSIX 와 같다", () => {
    const relative = relativeGuidePath("C:\\t\\docs", "C:\\t\\docs\\common-component\\security\\role.md", path.win32);
    const { frontmatter, body } = parseFrontMatter(`---\r\ntitle: 권한관리\r\n---\r\n${BODY.replace(/\n/g, "\r\n")}`);
    const [chunk] = chunkMarkdown(body, frontmatter, relative);
    expect(chunk).toMatchObject({
      layer: "common-component",
      category: "security",
      source: "common-component/security/role.md",
      docTitle: "권한관리",
    });
    expect(chunk.content).not.toContain("\r");
  });
});
