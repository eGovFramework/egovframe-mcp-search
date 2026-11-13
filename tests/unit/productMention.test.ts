/**
 * 제품명 언급 판정(src/utils/productMention.ts) 단위 테스트
 *
 * 호환 소프트웨어 조회의 includeKnowledge 는 제품명으로 의미 검색한 후보 가운데 그 제품을 언급하는 글만 싣는다.
 * 부분 문자열로만 견주던 때에 실제 데이터에서 실린 무관한 글(제품 'CESS' 에 access-denied-page,
 * 'xFRAME' 에 xframeoptions, 'HMS' 에 프로젝트 이름 hms)을 사례로 고정한다.
 */
import { describe, it, expect } from "vitest";
import { findProductMention, nameWithoutParentheses } from "../../src/utils/productMention.js";

describe("nameWithoutParentheses", () => {
  it("괄호와 그 안의 내용을 빼고, 남은 낱말 사이의 공백은 하나로 줄인다", () => {
    expect(nameWithoutParentheses("Morpheus CMS(모피어스 CMS)")).toBe("Morpheus CMS");
    expect(nameWithoutParentheses("AI+(플러스) CMS")).toBe("AI+ CMS");
    expect(nameWithoutParentheses("ALPAS v1.0 (도서관리 시스템)")).toBe("ALPAS v1.0");
    expect(nameWithoutParentheses("UCARE(콜센터상담시스템)")).toBe("UCARE");
    expect(nameWithoutParentheses("  JEUS  ")).toBe("JEUS");
  });

  it("전각 괄호와 겹친 괄호도 뺀다", () => {
    expect(nameWithoutParentheses("제품（설명）")).toBe("제품");
    expect(nameWithoutParentheses("제품(설명(안쪽) 더) 이름")).toBe("제품 이름");
  });

  it("괄호를 빼고 남는 것이 없으면 제품명을 그대로 쓴다", () => {
    expect(nameWithoutParentheses("(이름뿐)")).toBe("(이름뿐)");
    expect(nameWithoutParentheses(" (이름뿐) ")).toBe("(이름뿐)");
  });

  it("짝이 맞지 않는 괄호는 그대로 둔다", () => {
    expect(nameWithoutParentheses("제품(설명")).toBe("제품(설명");
  });
});

describe("findProductMention", () => {
  /** 글에 제품명이 언급되어 있는지 */
  const mentions = (text: string, name: string) => findProductMention(text, name) !== -1;

  it("제품명이 처음 언급된 자리를 돌려주고, 언급이 없으면 -1 을 돌려준다", () => {
    expect(findProductMention("JEUS 데이터소스 설정 문의", "JEUS")).toBe(0);
    expect(findProductMention("WAS 로 JEUS 를 씁니다. JEUS 8.5 입니다.", "JEUS")).toBe(6);
    expect(findProductMention("게시판 샘플 문의", "JEUS")).toBe(-1);
    expect(findProductMention("", "JEUS")).toBe(-1);
  });

  it("빈 제품명은 어디에도 일치하지 않는다", () => {
    expect(findProductMention("아무 글", "")).toBe(-1);
    expect(findProductMention("", "")).toBe(-1);
  });

  describe("낱말 경계 (제품명의 끝 글자가 ASCII 영문자나 숫자인 쪽)", () => {
    it("일치한 자리의 바로 앞뒤가 ASCII 영문자나 숫자이면 일치로 보지 않는다", () => {
      // X-Frame-Options 헤더를 묻는 글이 제품 xFRAME 의 관련 지식으로 실렸다
      expect(mentions("xframeoptions 문의", "xFRAME")).toBe(false);
      expect(mentions("myxframe 설정", "xFRAME")).toBe(false);
      expect(mentions("xFRAME5 버전", "xFRAME")).toBe(false);
      expect(mentions("X-Frame-Options 헤더 설정", "xFRAME")).toBe(false);
      // 버전을 붙여 쓴 표기도 경계가 아니다
      expect(mentions("tibero5 db연결 질문", "Tibero")).toBe(false);
    });

    it("앞뒤가 글의 끝, 공백, 문장부호, 한글이면 일치로 본다", () => {
      for (const text of ["xFRAME", "xFRAME 도입 문의", "솔루션(xFRAME)", "xFRAME의 설정", "UI는 xFRAME입니다", "xFRAME/넥사크로"]) {
        expect(mentions(text, "xFRAME"), text).toBe(true);
      }
      // 조사가 붙거나 괄호 안에 든 제품명
      for (const text of ["JEUS는", "JEUS 8.5", "(JEUS)", "WAS는 JEUS입니다"]) {
        expect(mentions(text, "JEUS"), text).toBe(true);
      }
      expect(mentions("DevonFrame과 전자정부Frame과 어떤차이점이 있나요?", "DevOnFrame")).toBe(true);
    });

    it("경계를 채우지 못한 자리는 건너뛰고 그 뒤의 자리를 찾는다", () => {
      const text = "xframeoptions 와 xFrame 의 차이";
      expect(findProductMention(text, "xFRAME")).toBe(text.indexOf("xFrame"));
    });

    it("제품명의 끝이 한글이나 기호인 쪽에는 경계를 따지지 않는다", () => {
      // 뒤가 한글인 제품명: 조사가 붙는다. 앞은 ASCII 라 경계를 따진다
      expect(mentions("e2스쿨은 학교 홈페이지 솔루션입니다", "e2스쿨")).toBe(true);
      expect(mentions("e2스쿨2 를 씁니다", "e2스쿨")).toBe(true);
      expect(mentions("one2스쿨", "e2스쿨")).toBe(false);
      // 앞이 한글인 제품명: 앞에는 경계를 따지지 않고, ASCII 로 끝나는 뒤에는 따진다
      expect(mentions("새그린나래CMS 를 씁니다", "그린나래CMS")).toBe(true);
      expect(mentions("그린나래CMSX", "그린나래CMS")).toBe(false);
      // 양끝이 한글인 제품명
      expect(mentions("신아사프로를", "아사프로")).toBe(true);
      // 기호로 끝나는 제품명
      expect(mentions("AI+CMS", "AI+")).toBe(true);
      expect(mentions("XAI+ 솔루션", "AI+")).toBe(false);
    });
  });

  describe("대소문자", () => {
    it("공백을 뺀 길이가 4자 이하이고 ASCII 영문자·숫자뿐인 제품명은 대소문자까지 같아야 일치한다", () => {
      // 제품 CESS 에 access-denied-page, loginSuccess.do 가 든 글이 실렸다
      expect(mentions('<access-denied-handler error-page="/access-denied-page"/>', "CESS")).toBe(false);
      expect(mentions("loginSuccess.do 로 이동합니다", "CESS")).toBe(false);
      expect(mentions("cess 솔루션", "CESS")).toBe(false);
      expect(mentions("CESS 솔루션", "CESS")).toBe(true);
      // 제품 HMS 에 Maven 프로젝트 이름이 든 글이 실렸다
      expect(mentions("Failed to execute goal on project hms", "HMS")).toBe(false);
      expect(mentions("HMS 프로젝트", "HMS")).toBe(true);
      // 낱말로 떨어져 있어도 대소문자가 다르면 일치하지 않는다
      expect(mentions("ice cream", "ICE")).toBe(false);
      expect(mentions("jeus 8 에서 기동", "JEUS")).toBe(false);
      // 공백을 빼고 센다
      expect(mentions("k 2 솔루션", "K 2")).toBe(false);
      expect(mentions("K 2 솔루션", "K 2")).toBe(true);
    });

    it("그 밖의 제품명은 ASCII 영문자의 대소문자를 가리지 않는다", () => {
      // 다섯 글자 이상
      expect(mentions("ucare 연동", "UCARE")).toBe(true);
      expect(mentions("TIBERO 접속 오류", "Tibero")).toBe(true);
      expect(mentions("morpheus cms 2.0 에서 메뉴가 보이지 않습니다", "Morpheus CMS")).toBe(true);
      // 네 글자 이하여도 ASCII 영문자·숫자뿐이 아니면 가리지 않는다
      expect(mentions("E2스쿨 문의", "e2스쿨")).toBe(true);
      expect(mentions("ai+ 솔루션", "AI+")).toBe(true);
    });
  });
});
