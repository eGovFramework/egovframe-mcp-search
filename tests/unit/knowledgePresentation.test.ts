/**
 * 개발자 지식을 응답에 싣는 꼴로 다듬는 유틸(src/utils/knowledgePresentation.ts) 단위 테스트
 */
import { describe, it, expect } from "vitest";
import { collapseWhitespace, excerptAround, presentTitle } from "../../src/utils/knowledgePresentation.js";

describe("presentTitle", () => {
  it("NFC 로 정규화한다 (자모가 분리된 제목을 합친다)", () => {
    const decomposed = "적용가이드".normalize("NFD");
    expect(decomposed).not.toBe("적용가이드");
    expect(presentTitle(decomposed)).toBe("적용가이드");
  });

  it("주민등록번호 형식의 값을 가린다", () => {
    expect(presentTitle("개인정보 900101-1234567 문의")).toBe("개인정보 ******-******* 문의");
  });

  it("문자열이 아닌 값은 문자열로 바꾸고, 없는 값은 빈 문자열로 돌려준다", () => {
    expect(presentTitle(undefined)).toBe("");
    expect(presentTitle(null)).toBe("");
    expect(presentTitle(42)).toBe("42");
  });
});

describe("collapseWhitespace", () => {
  it("줄바꿈과 연속 공백을 공백 하나로 바꾸고 앞뒤 공백을 뗀다", () => {
    expect(collapseWhitespace("  질문:\nJEUS   설정\r\n\r\n답변:\t확인  ")).toBe("질문: JEUS 설정 답변: 확인");
    expect(collapseWhitespace("한 줄")).toBe("한 줄");
    expect(collapseWhitespace(" \n\t ")).toBe("");
  });
});

describe("excerptAround", () => {
  const MAX = 200;
  const MARK = "...";
  /** 글자마다 자리를 알 수 있는 긴 본문: '가' 가 이어지다 at 자리에 표지 'JEUS' 가 있다 */
  const textWithMarkerAt = (at: number, total: number) => `${"가".repeat(at)}JEUS${"나".repeat(total - at - 4)}`;

  it("상한 이하인 글은 그대로 돌려준다", () => {
    expect(excerptAround("짧은 글", 0, 2, MAX)).toBe("짧은 글");
    const exact = "가".repeat(MAX);
    expect(excerptAround(exact, 100, 1, MAX)).toBe(exact);
    expect(excerptAround("", 0, 0, MAX)).toBe("");
  });

  it("자리가 글의 앞쪽이면 앞에서부터 싣고 뒤에만 생략 표시를 붙인다", () => {
    const text = textWithMarkerAt(10, 1000);
    const excerpt = excerptAround(text, 10, 4, MAX);
    expect(excerpt).toHaveLength(MAX);
    expect(excerpt).toBe(`${text.slice(0, MAX - MARK.length)}${MARK}`);
    expect(excerpt).toContain("JEUS");
  });

  it("자리가 글의 뒤쪽이면 끝까지 싣고 앞에만 생략 표시를 붙인다", () => {
    const text = textWithMarkerAt(990, 1000);
    const excerpt = excerptAround(text, 990, 4, MAX);
    expect(excerpt).toHaveLength(MAX);
    expect(excerpt).toBe(`${MARK}${text.slice(text.length - (MAX - MARK.length))}`);
    expect(excerpt).toContain("JEUS");
  });

  it("자리가 글의 가운데이면 그 자리를 가운데에 두고 양쪽에 생략 표시를 붙인다", () => {
    const text = textWithMarkerAt(500, 1000);
    const excerpt = excerptAround(text, 500, 4, MAX);
    expect(excerpt).toHaveLength(MAX);
    expect(excerpt.startsWith(MARK)).toBe(true);
    expect(excerpt.endsWith(MARK)).toBe(true);
    // 표지의 앞뒤에 실린 글자 수가 같다 (95자씩)
    const body = excerpt.slice(MARK.length, -MARK.length);
    const before = body.indexOf("JEUS");
    expect(before).toBe(body.length - before - 4);
    expect(body).toBe(text.slice(500 - before, 500 + 4 + before));
  });

  it("생략 표시를 붙인 길이가 상한을 넘지 않는다 (어느 자리에서나)", () => {
    for (const total of [201, 203, 250, 397, 400, 1000]) {
      for (let at = 0; at + 4 <= total; at += 7) {
        const text = textWithMarkerAt(at, total);
        const excerpt = excerptAround(text, at, 4, MAX);
        expect(excerpt.length, `total=${total} at=${at}`).toBeLessThanOrEqual(MAX);
        expect(excerpt, `total=${total} at=${at}`).toContain("JEUS");
        // 자르지 않은 쪽에는 표시를 붙이지 않는다
        const body = excerpt.replace(/^\.\.\./, "").replace(/\.\.\.$/, "");
        expect(excerpt.startsWith(MARK), `total=${total} at=${at}`).toBe(!text.startsWith(body));
        expect(excerpt.endsWith(MARK), `total=${total} at=${at}`).toBe(!text.endsWith(body));
      }
    }
  });

  it("자른 자리의 공백은 싣지 않는다", () => {
    // 창의 양끝이 공백에 걸린다
    const text = `${"가 ".repeat(200)}JEUS${" 나".repeat(200)}`;
    const excerpt = excerptAround(text, text.indexOf("JEUS"), 4, MAX);
    expect(excerpt).toMatch(/^\.\.\.\S/);
    expect(excerpt).toMatch(/\S\.\.\.$/);
    expect(excerpt.length).toBeLessThanOrEqual(MAX);
  });

  it("서로게이트 쌍의 가운데에서 자르지 않는다", () => {
    // 😀 은 UTF-16 코드 단위 두 개다. 어느 자리에서 잘라도 짝 없는 서로게이트가 남지 않는다
    const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    for (let lead = 0; lead < 4; lead += 1) {
      const text = `${"가".repeat(lead)}${"😀".repeat(300)}JEUS${"😀".repeat(300)}`;
      for (const at of [0, 150, text.indexOf("JEUS"), text.length - 10]) {
        const excerpt = excerptAround(text, at, 4, MAX);
        expect(excerpt.length, `lead=${lead} at=${at}`).toBeLessThanOrEqual(MAX);
        expect(lone.test(excerpt), `lead=${lead} at=${at}`).toBe(false);
      }
    }
  });

  it("자리가 글의 범위를 벗어나면 가까운 끝으로 맞춘다", () => {
    const text = "가".repeat(1000);
    expect(excerptAround(text, -5, 0, MAX)).toBe(`${"가".repeat(MAX - MARK.length)}${MARK}`);
    expect(excerptAround(text, 5000, 0, MAX)).toBe(`${MARK}${"가".repeat(MAX - MARK.length)}`);
  });

  it("생략 표시를 붙일 수 없을 만큼 작은 상한에서는 앞에서부터 자르기만 한다", () => {
    expect(excerptAround("가나다라마바사아자차", 5, 1, 6)).toBe("가나다라마바");
    expect(excerptAround("가나다라마바사아자차", 5, 1, 0)).toBe("");
  });
});
