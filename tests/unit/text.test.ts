/**
 * 문자열 유틸(src/utils/text.ts) 단위 테스트
 */
import { describe, it, expect } from "vitest";
import { sliceHead } from "../../src/utils/text.js";

describe("sliceHead", () => {
  it("상한보다 짧은 문자열은 그대로 돌려준다", () => {
    expect(sliceHead("가나다", 3)).toBe("가나다");
    expect(sliceHead("가나다", 10)).toBe("가나다");
    expect(sliceHead("", 5)).toBe("");
  });

  it("상한보다 긴 문자열은 앞에서부터 상한까지만 남긴다", () => {
    expect(sliceHead("가나다라마", 3)).toBe("가나다");
    expect(sliceHead("abcdef", 1)).toBe("a");
  });

  it("서로게이트 쌍(이모지)의 가운데에서 자르지 않는다", () => {
    const text = "ab😀cd"; // 😀 은 UTF-16 코드 단위 두 개
    expect(sliceHead(text, 3)).toBe("ab");
    expect(sliceHead(text, 4)).toBe("ab😀");
    expect(sliceHead("😀", 1)).toBe("");
  });

  it("상한이 0 이하이면 빈 문자열이다", () => {
    expect(sliceHead("가나다", 0)).toBe("");
    expect(sliceHead("가나다", -3)).toBe("");
  });

  it("소수 상한은 내림한다", () => {
    expect(sliceHead("가나다라", 2.9)).toBe("가나");
  });
});
