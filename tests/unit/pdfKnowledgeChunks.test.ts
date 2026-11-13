/**
 * 적용가이드 PDF 를 청크로 나눠 개발자 지식 입력으로 만드는 과정(src/scripts/buildIndex.ts) 단위 테스트
 *
 * buildIndex.ts 는 직접 실행될 때만 인덱싱을 시작하므로, import 해서 함수만 불러 쓴다.
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import { TEMPLATES_DIR, chunkPdfText, pdfTextToKnowledge } from "../../src/scripts/buildIndex.js";

/** 한 줄이 lineLength 글자인 줄 lineCount 개로 된 문단. 줄마다 내용이 다르다. */
function paragraphOfLines(label: string, lineCount: number, lineLength: number): string {
  return Array.from({ length: lineCount }, (_, i) => `${label}${i + 1} `.padEnd(lineLength, "가")).join("\n");
}

describe("pdfTextToKnowledge — 청크를 개발자 지식 입력으로 만든다", () => {
  const pdfPath = path.join(TEMPLATES_DIR, "developer_knowledge", "application-guide.pdf");
  // 어느 상한에서도 청크가 여러 개 나오도록 1,000자 문단을 여섯 개 둔다
  const text = Array.from({ length: 6 }, (_, i) => paragraphOfLines(`문단${i + 1}줄`, 25, 39)).join("\n\n");

  it("청크마다 입력을 하나씩 만들고 본문에 청크를 그대로 싣는다", () => {
    const chunks = chunkPdfText(text);
    const inputs = pdfTextToKnowledge(pdfPath, text);

    expect(chunks.length).toBeGreaterThan(1);
    expect(inputs.map((input) => input.content)).toEqual(chunks);
  });

  it("제목의 (순번/전체) 와 metadata 의 chunkIndex, chunkCount 가 청크 수와 맞는다", () => {
    const inputs = pdfTextToKnowledge(pdfPath, text);
    const count = inputs.length;

    inputs.forEach((input, index) => {
      expect(input.title).toBe(`application-guide (${index + 1}/${count})`);
      expect(input.metadata?.chunkIndex).toBe(index + 1);
      expect(input.metadata?.chunkCount).toBe(count);
    });
  });

  it("유형, 출처, 태그는 적용가이드 PDF 의 값으로 채운다", () => {
    const [first] = pdfTextToKnowledge(pdfPath, text);

    expect(first).toMatchObject({
      type: "best-practice",
      context: "표준프레임워크 적용가이드 PDF",
      tags: ["egovframe", "developer_knowledge", "guide", "pdf"],
      importance: 5,
      verified: true,
      metadata: {
        source: "templates/developer_knowledge",
        sourceFile: path.join("templates", "developer_knowledge", "application-guide.pdf"),
        sourceType: "pdf",
      },
    });
  });

  it("NFD 로 들어온 한글 파일 이름을 제목과 sourceFile 에서 NFC 로 정규화한다", () => {
    const nfdName = "적용가이드".normalize("NFD");
    const [first] = pdfTextToKnowledge(path.join(TEMPLATES_DIR, "developer_knowledge", `${nfdName}.pdf`), text);

    expect(first.title.startsWith("적용가이드 (1/")).toBe(true);
    expect(first.metadata?.sourceFile).toBe(path.join("templates", "developer_knowledge", "적용가이드.pdf"));
  });

  it("본문이 비어 있으면 입력을 만들지 않는다", () => {
    expect(pdfTextToKnowledge(pdfPath, "")).toEqual([]);
    expect(pdfTextToKnowledge(pdfPath, " \n\n \t ")).toEqual([]);
  });
});
