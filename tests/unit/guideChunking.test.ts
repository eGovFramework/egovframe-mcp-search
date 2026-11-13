/**
 * 가이드 문서 청킹(chunkMarkdown)과 색인 대상 판정(kb/guideIndexer) 단위 테스트
 *
 * 색인 결과(source, layer, category)가 플랫폼과 무관하게 같은지 확인한다.
 * 임베딩 모델과 LanceDB 를 쓰지 않는 순수 함수만 다룬다.
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import { chunkMarkdown, parseFrontMatter } from "../../src/rag/guideManager.js";
import { relativeGuidePath } from "../../src/kb/guideIndexer.js";

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
