/**
 * 가이드 문서 청킹(chunkMarkdown)과 색인 대상 판정(kb/guideIndexer) 단위 테스트
 *
 * 색인 결과(source, layer, category)가 플랫폼과 무관하게 같은지, 게시되지 않는 문서(draft)가
 * 색인에서 빠지는지 확인한다. 대부분 순수 함수 검증이고, 실제 색인(indexGuideDirectory)은
 * 임베딩 모델이 있을 때만 임시 디렉토리에서 돌려 본다.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import * as lancedb from "@lancedb/lancedb";
import { GuideSearchManager, chunkMarkdown, parseFrontMatter } from "../../src/rag/guideManager.js";
import { chunkGuideDocument, indexGuideDirectory, relativeGuidePath } from "../../src/kb/guideIndexer.js";
import { hasEmbeddingModel } from "../integration/_helper.js";

const paragraph = (label: string) => `${label} 문단입니다. `.repeat(10).trim();

const BODY = [`# Transaction 서비스`, "", paragraph("개요"), "", "## 설명", "", paragraph("설명")].join("\n");

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

  it("본문이 너무 짧은 문서는 색인하지 않는다", () => {
    expect(chunkGuideDocument(["---", "title: 목차", "---", "# 목차", "", "짧은 본문"].join("\n"), "a/_index.md")).toBeNull();
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
