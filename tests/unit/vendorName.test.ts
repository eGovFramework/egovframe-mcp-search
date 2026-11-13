/**
 * 업체명 비교용 정규화(src/utils/vendorName.ts) 단위 테스트
 *
 * 호환 소프트웨어의 vendor 필터가 필터 값과 컬럼 값 양쪽에 같은 규칙을 적용한다.
 */
import { describe, it, expect } from "vitest";
import { VENDOR_IGNORED_SEQUENCES, stripVendorDesignation } from "../../src/utils/vendorName.js";

describe("stripVendorDesignation", () => {
  it("법인 표기 ㈜, (주), （주）, 주식회사 를 어느 자리에 있든 뗀다", () => {
    for (const name of [
      "㈜아이액츠",
      "(주)아이액츠",
      "（주）아이액츠",
      "주식회사 아이액츠",
      "아이액츠㈜",
      "아이액츠(주)",
      "아이액츠（주）",
      "아이액츠 주식회사",
    ]) {
      expect(stripVendorDesignation(name), name).toBe("아이액츠");
    }
  });

  it("공백을 뗀다 (띄어 쓴 법인 표기와 띄어 쓴 이름도 같은 값이 된다)", () => {
    expect(stripVendorDesignation("세원IT ㈜")).toBe("세원IT");
    expect(stripVendorDesignation(" ㈜ 아이 액츠 ")).toBe("아이액츠");
    expect(stripVendorDesignation("( 주 ) 아이액츠")).toBe("아이액츠");
    expect(stripVendorDesignation("주 식 회 사\t아이액츠")).toBe("아이액츠");
    expect(stripVendorDesignation("LG CNS")).toBe("LGCNS");
    // 전각 공백과 줄 바꿈 없는 공백도 뗀다
    expect(stripVendorDesignation("LG\u3000CNS\u00a0Korea")).toBe("LGCNSKorea");
  });

  it("법인 표기가 아닌 괄호와 글자는 그대로 둔다", () => {
    expect(stripVendorDesignation("소포(SOFO)")).toBe("소포(SOFO)");
    expect(stripVendorDesignation("한국레드헷(Red Hat Korea)")).toBe("한국레드헷(RedHatKorea)");
    expect(stripVendorDesignation("(유)어떤회사")).toBe("(유)어떤회사");
    expect(stripVendorDesignation("주택관리공단")).toBe("주택관리공단");
    // 영문자의 대소문자는 바꾸지 않는다 (비교하는 쪽에서 가리지 않는다)
    expect(stripVendorDesignation("GrapeCity Korea")).toBe("GrapeCityKorea");
  });

  it("법인 표기와 공백뿐인 값은 빈 문자열이 된다", () => {
    for (const name of ["(주)", "㈜", "（주）", "주식회사", " (주) ", "㈜ 주식회사", "( 주 )", ""]) {
      expect(stripVendorDesignation(name), JSON.stringify(name)).toBe("");
    }
  });

  it("떼는 문자열은 공백류가 법인 표기보다 먼저다 (SQL 에서도 같은 순서로 뗀다)", () => {
    const firstDesignation = VENDOR_IGNORED_SEQUENCES.findIndex((sequence) => sequence.trim() !== "");
    expect(firstDesignation).toBeGreaterThan(0);
    expect(VENDOR_IGNORED_SEQUENCES.slice(0, firstDesignation).every((sequence) => sequence.trim() === "")).toBe(true);
    expect(VENDOR_IGNORED_SEQUENCES.slice(firstDesignation)).toEqual(["㈜", "(주)", "（주）", "주식회사"]);
  });
});
