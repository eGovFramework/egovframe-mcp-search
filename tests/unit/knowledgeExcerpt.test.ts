/**
 * 개발자 지식 본문 발췌(src/utils/knowledgeExcerpt.ts) 단위 테스트
 *
 * Q&A 본문("질문:\n...\n\n답변:\n...")을 줄일 때 답변의 앞부분이 반드시 남는지 확인한다.
 * 동봉 테이블의 실제 본문으로도 같은 성질을 검증한다 (읽기 전용).
 */
import { describe, it, expect } from "vitest";
import { excerptKnowledgeContent } from "../../src/utils/knowledgeExcerpt.js";
import { HAS_BUNDLED_TABLES, KNOWLEDGE_TABLE, openBundledTable } from "./_lanceFixtures.js";

const ANSWER_MARK = "\n\n답변:\n";

const qa = (question: string, answer: string) => `질문:\n${question}${ANSWER_MARK}${answer}`;

/** 발췌를 질문 부분과 답변 부분으로 나눈다 (생략 표시는 떼어 낸다). */
function parts(excerpt: string): { question: string; answer: string } {
  expect(excerpt.startsWith("질문:\n")).toBe(true);
  const at = excerpt.indexOf(ANSWER_MARK);
  expect(at).toBeGreaterThanOrEqual(0);
  const strip = (text: string) => text.replace(/\.\.\.$/, "");
  return {
    question: strip(excerpt.slice("질문:\n".length, at)),
    answer: strip(excerpt.slice(at + ANSWER_MARK.length)),
  };
}

describe("excerptKnowledgeContent", () => {
  const longQuestion = "서버를 기동하면 다음과 같은 오류가 발생합니다. ".repeat(40).trim();
  const longAnswer = "안녕하세요. 표준프레임워크센터입니다. 설정 파일을 확인해 보시기 바랍니다. ".repeat(40).trim();

  it("상한보다 짧은 본문은 그대로 돌려준다", () => {
    const content = qa("짧은 질문", "짧은 답변");
    expect(excerptKnowledgeContent(content, 200)).toBe(content);
    expect(excerptKnowledgeContent(content, content.length)).toBe(content);
  });

  it("질문과 답변이 모두 길면 길이를 나눠 배정해 답변 앞부분을 남긴다", () => {
    const excerpt = excerptKnowledgeContent(qa(longQuestion, longAnswer), 200);
    const { question, answer } = parts(excerpt);

    expect(excerpt.length).toBeLessThanOrEqual(200);
    expect(excerpt.length).toBeGreaterThan(190);
    expect(longQuestion.startsWith(question)).toBe(true);
    expect(longAnswer.startsWith(answer)).toBe(true);
    // 답변에 더 많은 몫을 준다
    expect(answer.length).toBeGreaterThan(question.length);
    expect(question.length).toBeGreaterThan(50);
    expect(answer).toContain("표준프레임워크센터입니다");
  });

  it("질문이 짧으면 질문은 전부 남기고 남는 길이를 답변에 준다", () => {
    const excerpt = excerptKnowledgeContent(qa("로그인이 안됩니다.", longAnswer), 200);
    const { question, answer } = parts(excerpt);

    expect(excerpt.length).toBeLessThanOrEqual(200);
    expect(question).toBe("로그인이 안됩니다.");
    expect(longAnswer.startsWith(answer)).toBe(true);
    expect(answer.length).toBeGreaterThan(150);
  });

  it("답변이 짧으면 답변은 전부 남기고 남는 길이를 질문에 준다", () => {
    const excerpt = excerptKnowledgeContent(qa(longQuestion, "버전을 올리면 해결됩니다."), 200);
    const { question, answer } = parts(excerpt);

    expect(excerpt.length).toBeLessThanOrEqual(200);
    expect(answer).toBe("버전을 올리면 해결됩니다.");
    expect(longQuestion.startsWith(question)).toBe(true);
    expect(question.length).toBeGreaterThan(150);
  });

  it("답변이 없는 글은 질문에 길이를 모두 준다", () => {
    const excerpt = excerptKnowledgeContent(qa(longQuestion, ""), 120);
    expect(excerpt.length).toBeLessThanOrEqual(120);
    const { question, answer } = parts(excerpt);
    expect(answer).toBe("");
    expect(question.length).toBeGreaterThan(100);
  });

  it("잘린 부분에는 생략 표시를 붙인다", () => {
    const excerpt = excerptKnowledgeContent(qa(longQuestion, longAnswer), 200);
    expect(excerpt.endsWith("...")).toBe(true);
    expect(excerpt).toMatch(/\.\.\.\n\n답변:\n/);
    // 자르지 않은 부분에는 붙이지 않는다
    expect(excerptKnowledgeContent(qa("짧은 질문", longAnswer), 200)).toMatch(/^질문:\n짧은 질문\n\n답변:\n/);
  });

  it("질문·답변 형식이 아닌 본문(PDF 청크 등)은 앞에서부터 자른다", () => {
    const content = "표준프레임워크 적용가이드 ".repeat(100);
    const excerpt = excerptKnowledgeContent(content, 100);
    expect(excerpt.length).toBeLessThanOrEqual(100);
    expect(excerpt.endsWith("...")).toBe(true);
    expect(content.startsWith(excerpt.replace(/\.\.\.$/, ""))).toBe(true);
  });

  it("상한이 아주 작아도 그 길이를 넘지 않는다", () => {
    const content = qa(longQuestion, longAnswer);
    for (const max of [1, 2, 3, 5, 10, 11, 12, 13, 20, 30]) {
      expect(excerptKnowledgeContent(content, max).length, String(max)).toBeLessThanOrEqual(max);
    }
    // 표지가 들어갈 만큼만 되면 답변이 한 글자라도 남는다
    expect(parts(excerptKnowledgeContent(content, 13)).answer.length).toBeGreaterThan(0);
  });

  it("상한이 유효한 양수가 아니면 본문을 그대로 돌려준다", () => {
    const content = qa(longQuestion, longAnswer);
    for (const max of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(excerptKnowledgeContent(content, max)).toBe(content);
    }
  });

  it("소수 상한은 내림한다", () => {
    expect(excerptKnowledgeContent(qa(longQuestion, longAnswer), 100.9).length).toBeLessThanOrEqual(100);
  });

  it("이모지 가운데를 자르지 않는다", () => {
    const excerpt = excerptKnowledgeContent("😀".repeat(100), 20);
    expect(excerpt.length).toBeLessThanOrEqual(20);
    expect(excerpt).toBe(`${"😀".repeat(8)}...`);
  });
});

describe.skipIf(!HAS_BUNDLED_TABLES)("excerptKnowledgeContent — 동봉 테이블의 실제 본문", () => {
  it("모든 Q&A 행에서 상한을 지키고, 답변이 있으면 그 앞부분이 발췌에 들어간다", async () => {
    const table = await openBundledTable(KNOWLEDGE_TABLE);
    const rows = await table.query().select(["content"]).toArray();
    const contents: string[] = rows.map((row: { content: string }) => row.content);
    const qaContents = contents.filter((content) => content.startsWith("질문:") && content.includes(ANSWER_MARK));
    expect(qaContents.length).toBeGreaterThan(10_000);

    let checked = 0;
    for (const content of qaContents) {
      const at = content.indexOf(ANSWER_MARK);
      const fullAnswer = content.slice(at + ANSWER_MARK.length).trim();
      for (const max of [60, 200, 300]) {
        const excerpt = excerptKnowledgeContent(content, max);
        expect(excerpt.length).toBeLessThanOrEqual(max);
        if (content.length <= max) {
          expect(excerpt).toBe(content);
          continue;
        }
        const { answer } = parts(excerpt);
        if (fullAnswer.length > 0) {
          expect(answer.length).toBeGreaterThan(0);
          expect(fullAnswer.startsWith(answer)).toBe(true);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(10_000);
  });

  it("Q&A 가 아닌 행(PDF 청크)도 상한을 지킨다", async () => {
    const table = await openBundledTable(KNOWLEDGE_TABLE);
    const rows = await table.query().where("type = 'best-practice'").select(["content"]).toArray();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows as Array<{ content: string }>) {
      expect(excerptKnowledgeContent(row.content, 200).length).toBeLessThanOrEqual(200);
    }
  });
});
