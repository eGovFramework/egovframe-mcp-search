/**
 * 민감한 식별번호 가림 처리 단위 테스트
 *
 * 개발자 지식은 공개 게시판(묻고답하기)의 글이라, 글쓴이가 본문에 적은 주민등록번호 형식의 값이
 * 그대로 들어 있을 수 있다. 색인할 때와 응답을 만들 때 그 형식을 가린다.
 * (아래의 번호는 모두 테스트용으로 지어낸 값이다.)
 */
import { describe, it, expect } from "vitest";
import { maskResidentNumbers } from "../../src/utils/sensitiveText.js";

describe("maskResidentNumbers", () => {
  it("주민등록번호 형식(6자리-7자리)을 가린다", () => {
    expect(maskResidentNumbers("번호는 900101-1234567 입니다")).toBe("번호는 ******-******* 입니다");
    expect(maskResidentNumbers("900101-1234567\n\n850505-2345678")).toBe("******-*******\n\n******-*******");
  });

  it("하이픈 앞뒤에 공백이 있어도 가린다", () => {
    expect(maskResidentNumbers("900101 - 1234567")).toBe("******-*******");
  });

  it("외국인등록번호 형식(뒷자리가 5~8 로 시작)도 가린다", () => {
    expect(maskResidentNumbers("900101-5234567")).toBe("******-*******");
  });

  it("날짜가 될 수 없는 앞자리나 형식이 다른 숫자는 그대로 둔다", () => {
    // 13월, 32일
    expect(maskResidentNumbers("901301-1234567")).toBe("901301-1234567");
    expect(maskResidentNumbers("900132-1234567")).toBe("900132-1234567");
    // 뒷자리가 9 나 0 으로 시작
    expect(maskResidentNumbers("900101-9234567")).toBe("900101-9234567");
    // 자릿수가 다른 숫자, 더 긴 숫자의 일부
    expect(maskResidentNumbers("2024-01-01 12345678")).toBe("2024-01-01 12345678");
    expect(maskResidentNumbers("1900101-1234567")).toBe("1900101-1234567");
    expect(maskResidentNumbers("900101-12345678")).toBe("900101-12345678");
  });

  it("전화번호, 버전, 날짜 같은 평범한 숫자는 건드리지 않는다", () => {
    const text = "문의 02-1234-5678, 010-1234-5678 / egovframe 4.3.0 / 2025-12-29 / ORA-00942 / 1700000000000";
    expect(maskResidentNumbers(text)).toBe(text);
  });

  it("가릴 것이 없으면 입력을 그대로 돌려준다", () => {
    expect(maskResidentNumbers("")).toBe("");
    expect(maskResidentNumbers("로그인이 안됩니다")).toBe("로그인이 안됩니다");
  });
});
