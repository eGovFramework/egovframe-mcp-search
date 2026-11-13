/**
 * 키워드 검색어 추출 단위 테스트
 *
 * 공통컴포넌트·호환 소프트웨어의 키워드 검색은 query 에서 검색어를 추출해 부분 문자열 일치로 찾는다.
 * 문장부호, 검색 연산자처럼 적은 접속사, 전각 문자, 아주 긴 입력이 들어와도 일정한 검색어 목록이 나와야 한다.
 * (파일 이름은 검색어로 FTS5 MATCH 식을 조립하던 때의 것이다.)
 */
import { describe, it, expect, afterAll } from "vitest";
import Database from "better-sqlite3";
import {
  COMPATIBILITY_GENERIC_WORDS,
  COMPONENT_GENERIC_WORDS,
  ENGLISH_FUNCTION_WORDS,
  MAX_KEYWORD_QUERY_LENGTH,
  MAX_SEARCH_TERMS,
  dropGenericTerms,
  extractSearchTerms,
  hasOrOperator,
  isEnglishTerm,
  isGenericTerm,
  joinedTermKeys,
  parseKeywordQuery,
  particleStrippedForms,
  splitAtSeparators,
  trimEdgeSeparators,
  wordStartGlobPattern,
} from "../../src/utils/fts5Query.js";

/** fn 을 한 번 실행하는 데 걸린 시간(ms) */
const elapsedMs = (fn: () => unknown): number => {
  const started = performance.now();
  fn();
  return performance.now() - started;
};

describe("extractSearchTerms", () => {
  it("공백으로 나눈 검색어를 순서대로 돌려준다", () => {
    expect(extractSearchTerms("게시판 컴포넌트")).toEqual(["게시판", "컴포넌트"]);
  });

  it("검색어 앞뒤의 문장부호를 떼어 낸다", () => {
    expect(extractSearchTerms("로그인? 게시판! (권한)")).toEqual(["로그인", "게시판", "권한"]);
  });

  it("버전·패키지명·하이픈 식별자 안쪽의 구분 문자는 보존한다", () => {
    expect(extractSearchTerms("4.3 egovframework.com.cop.bbs spring-boot")).toEqual([
      "4.3",
      "egovframework.com.cop.bbs",
      "spring-boot",
    ]);
  });

  it("그 밖의 문장부호는 검색어를 나누는 구분자로 본다", () => {
    expect(extractSearchTerms("로그인/로그아웃,세션")).toEqual(["로그인", "로그아웃", "세션"]);
    expect(extractSearchTerms('spring "boot" (mvc)')).toEqual(["spring", "boot", "mvc"]);
    expect(extractSearchTerms("egov:framework")).toEqual(["egov", "framework"]);
  });

  it("문자나 숫자가 하나도 없는 입력은 빈 배열을 돌려준다", () => {
    expect(extractSearchTerms("")).toEqual([]);
    expect(extractSearchTerms("   ")).toEqual([]);
    expect(extractSearchTerms('()[]{}"*^|?!.-')).toEqual([]);
  });

  it("대소문자만 다른 중복 검색어는 한 번만 남긴다", () => {
    expect(extractSearchTerms("JEUS jeus Jeus tibero")).toEqual(["JEUS", "tibero"]);
  });

  it("검색어 수를 상한까지만 남긴다", () => {
    const many = Array.from({ length: 40 }, (_, i) => `t${i}`).join(" ");
    expect(extractSearchTerms(many)).toHaveLength(MAX_SEARCH_TERMS);
    expect(extractSearchTerms(many, 3)).toEqual(["t0", "t1", "t2"]);
  });

  it("검색어 수의 상한은 16개다", () => {
    // 상한을 상수로만 견주면 상수가 바뀌어도 테스트가 따라 바뀐다. 값 자체를 고정한다
    expect(MAX_SEARCH_TERMS).toBe(16);
    const words = Array.from({ length: 20 }, (_, i) => `t${i}`);
    expect(extractSearchTerms(words.join(" "))).toEqual(words.slice(0, 16));
  });

  it("자모가 분리된(NFD) 한글을 합쳐진 형태(NFC)로 정규화한다", () => {
    const nfd = "게시판".normalize("NFD");
    expect(nfd).not.toBe("게시판");
    expect(extractSearchTerms(nfd)).toEqual(["게시판"]);
  });
});

describe("extractSearchTerms 의 전각 문자 처리", () => {
  it("전각 영숫자를 반각으로 바꿔 검색어를 추출한다", () => {
    expect(extractSearchTerms("ＣＭＳ")).toEqual(["CMS"]);
    expect(extractSearchTerms("ＪＥＵＳ\u3000８．５")).toEqual(["JEUS", "8.5"]);
    expect(extractSearchTerms("４.３")).toEqual(["4.3"]);
    expect(extractSearchTerms("ｅｇｏｖ－ｆｒａｍｅ＿ｗｏｒｋ")).toEqual(["egov-frame_work"]);
  });

  it("전각 공백과 전각 문장부호는 반각과 같이 구분자로 본다", () => {
    expect(extractSearchTerms("게시판\u3000템플릿")).toEqual(["게시판", "템플릿"]);
    expect(extractSearchTerms("（JEUS）／Tibero！")).toEqual(["JEUS", "Tibero"]);
  });

  it("반각으로 바꾼 뒤에 중복과 접속사를 가린다", () => {
    expect(extractSearchTerms("CMS ＣＭＳ ｃｍｓ")).toEqual(["CMS"]);
    expect(extractSearchTerms("JEUS ＯＲ Tibero")).toEqual(["JEUS", "Tibero"]);
  });

  it("전각 ASCII 가 아닌 호환 문자는 바꾸지 않는다 (NFKC 를 적용하지 않는다)", () => {
    // NFKC 는 '㈜' 를 '(주)' 로 풀어, 저장된 업체명('㈜티맥스티베로')에 없는 낱말 '주' 를 만든다
    expect("㈜".normalize("NFKC")).toBe("(주)");
    expect(extractSearchTerms("㈜티맥스티베로")).toEqual(["티맥스티베로"]);
    // 반각 가타카나, 로마 숫자, 위 첨자도 그대로 둔다
    expect(extractSearchTerms("ｶﾞ Ⅲ x²")).toEqual(["ｶﾞ", "Ⅲ", "x²"]);
  });
});

describe("extractSearchTerms 가 빼는 접속사", () => {
  it("단독 낱말 AND, OR, NOT, NEAR 는 검색어로 쓰지 않는다", () => {
    expect(extractSearchTerms("JEUS OR Tibero")).toEqual(["JEUS", "Tibero"]);
    expect(extractSearchTerms("JEUS AND Tibero")).toEqual(["JEUS", "Tibero"]);
    expect(extractSearchTerms("JEUS NOT Tibero")).toEqual(["JEUS", "Tibero"]);
    expect(extractSearchTerms("JEUS NEAR Tibero")).toEqual(["JEUS", "Tibero"]);
  });

  it("대소문자를 가리지 않는다", () => {
    expect(extractSearchTerms("JEUS and Tibero")).toEqual(["JEUS", "Tibero"]);
    expect(extractSearchTerms("jeus Or tibero nOt weblogic Near oracle")).toEqual([
      "jeus",
      "tibero",
      "weblogic",
      "oracle",
    ]);
  });

  it("문장부호가 붙어 있어도 뺀다", () => {
    expect(extractSearchTerms("(JEUS) OR, 'Tibero'")).toEqual(["JEUS", "Tibero"]);
    expect(extractSearchTerms("NEAR(JEUS Tibero)")).toEqual(["JEUS", "Tibero"]);
  });

  it("다른 낱말의 일부인 경우에는 빼지 않는다", () => {
    expect(extractSearchTerms("Android ORACLE notebook nearby and-or")).toEqual([
      "Android",
      "ORACLE",
      "notebook",
      "nearby",
      "and-or",
    ]);
  });

  it("접속사뿐인 query 에서는 검색어가 추출되지 않는다", () => {
    expect(extractSearchTerms("AND")).toEqual([]);
    expect(extractSearchTerms("and or NOT near")).toEqual([]);
  });

  it("뺀 접속사는 검색어 수 상한에 세지 않는다", () => {
    expect(extractSearchTerms("a AND b OR c NOT d", 3)).toEqual(["a", "b", "c"]);
  });
});

describe("hasOrOperator", () => {
  it("query 에 단독 낱말 OR 가 있으면 true 다 (대소문자를 가리지 않는다)", () => {
    for (const query of ["게시판 OR 댓글", "JEUS or Tibero", "CMS Or Portal", "a oR b", "(JEUS) OR, 'Tibero'", "A/OR/B"]) {
      expect(hasOrOperator(query), query).toBe(true);
    }
  });

  it("앞이나 뒤에 검색어가 없어도 OR 가 적혀 있으면 true 다", () => {
    for (const query of ["OR", "OR JEUS", "JEUS OR", "and or NOT near"]) {
      expect(hasOrOperator(query), query).toBe(true);
    }
  });

  it("다른 낱말의 일부인 OR 는 해당하지 않는다", () => {
    for (const query of ["ORACLE", "Oracle 호환", "portal for", "ORM color", "and-or", "x.or.y", "or_else", "오어"]) {
      expect(hasOrOperator(query), query).toBe(false);
    }
  });

  it("AND, NOT, NEAR 만 있으면 false 다", () => {
    for (const query of ["JEUS AND Tibero", "JEUS NOT Tibero", "JEUS NEAR Tibero", "게시판 댓글", ""]) {
      expect(hasOrOperator(query), JSON.stringify(query)).toBe(false);
    }
  });

  it("전각으로 적은 OR 도 같다", () => {
    expect(hasOrOperator("게시판 ＯＲ 댓글")).toBe(true);
    expect(hasOrOperator("게시판　or　댓글")).toBe(true);
  });

  it("extractSearchTerms 와 같이 query 의 앞 2,000자만 읽는다", () => {
    expect(hasOrOperator(`${"x ".repeat(999)}OR y`)).toBe(true);
    expect(hasOrOperator(`${"x ".repeat(1000)}OR y`)).toBe(false);
  });

  it("아주 긴 입력도 100ms 안에 끝난다", () => {
    expect(elapsedMs(() => hasOrOperator(`a${".".repeat(80000)}a OR b`))).toBeLessThan(100);
    expect(elapsedMs(() => hasOrOperator("or ".repeat(50000)))).toBeLessThan(100);
  });
});

describe("parseKeywordQuery", () => {
  it("검색어, 이어 적힌 낱말, OR 가 있었는지를 한 번에 읽어 낸다", () => {
    expect(parseKeywordQuery("게시판 OR 댓글")).toEqual({ terms: ["게시판", "댓글"], joinedTerms: new Set(), orQuery: true });
    expect(parseKeywordQuery("Q&A 관리")).toEqual({ terms: ["Q", "A", "관리"], joinedTerms: new Set(["q", "a"]), orQuery: false });
    expect(parseKeywordQuery("JEUS and Tibero")).toEqual({ terms: ["JEUS", "Tibero"], joinedTerms: new Set(), orQuery: false });
    expect(parseKeywordQuery("")).toEqual({ terms: [], joinedTerms: new Set(), orQuery: false });
  });
});

describe("가려 주지 못하는 낱말 (dropGenericTerms, isGenericTerm)", () => {
  /** 프레임워크 자체를 가리키는 낱말 */
  const FRAMEWORK = ["egovframe", "egovframework", "egov", "전자정부", "표준프레임워크", "전자정부프레임워크", "전자정부표준프레임워크"];
  /** 공통컴포넌트 목록의 모든 항목에 해당하는 낱말 */
  const COMPONENT = ["컴포넌트", "공통컴포넌트", "component", "components"];

  it("영어 기능어 목록은 정해진 낱말 그대로다", () => {
    expect([...ENGLISH_FUNCTION_WORDS].sort()).toEqual(
      [
        ...["a", "an", "the", "is", "are", "were", "be", "do", "does", "did"],
        ...["can", "could", "will", "would", "should", "with", "for", "in", "on", "of", "to", "from", "by", "at", "as"],
        ...["it", "this", "that", "what", "which", "how"],
      ].sort(),
    );
  });

  it("was 는 영어 기능어 목록에 넣지 않는다 (호환 소프트웨어의 분류 WAS 와 같은 낱말이다)", () => {
    expect(ENGLISH_FUNCTION_WORDS.has("was")).toBe(false);
    for (const terms of [["국산", "WAS"], ["was", "추천"], ["which", "WAS", "is", "compatible"]]) {
      expect(dropGenericTerms(terms, COMPATIBILITY_GENERIC_WORDS), terms.join(" ")).toContain(terms.find((t) => /was/i.test(t)));
    }
    expect(dropGenericTerms(["which", "WAS", "is", "compatible"], COMPATIBILITY_GENERIC_WORDS)).toEqual(["WAS", "compatible"]);
  });

  it("대상의 모든 항목에 해당하는 낱말은 대상마다 다르다", () => {
    // 호환 소프트웨어: 프레임워크 자체를 가리키는 낱말 / 공통컴포넌트: 거기에 컴포넌트를 가리키는 낱말을 더한 것
    expect([...COMPATIBILITY_GENERIC_WORDS].sort()).toEqual([...FRAMEWORK].sort());
    expect([...COMPONENT_GENERIC_WORDS].sort()).toEqual([...FRAMEWORK, ...COMPONENT].sort());
  });

  it("영어 기능어는 어느 대상에서나 뺀다 (대소문자를 가리지 않는다)", () => {
    for (const words of [COMPATIBILITY_GENERIC_WORDS, COMPONENT_GENERIC_WORDS]) {
      expect(dropGenericTerms(["Is", "Tibero", "compatible", "WITH", "4.3"], words)).toEqual(["Tibero", "compatible", "4.3"]);
      expect(dropGenericTerms(["how", "to", "implement", "login"], words)).toEqual(["implement", "login"]);
    }
  });

  it("프레임워크 자체를 가리키는 낱말은 두 대상 모두에서 뺀다", () => {
    for (const words of [COMPATIBILITY_GENERIC_WORDS, COMPONENT_GENERIC_WORDS]) {
      for (const word of [...FRAMEWORK, "eGovFrame", "EGOVFRAMEWORK", "eGov"]) {
        expect(dropGenericTerms([word, "4.3", "CMS"], words), `word=${word}`).toEqual(["4.3", "CMS"]);
      }
    }
  });

  it("컴포넌트를 가리키는 낱말은 공통컴포넌트에서만 뺀다", () => {
    for (const word of [...COMPONENT, "Component", "COMPONENTS"]) {
      expect(dropGenericTerms(["게시판", word], COMPONENT_GENERIC_WORDS), `word=${word}`).toEqual(["게시판"]);
      expect(dropGenericTerms(["게시판", word], COMPATIBILITY_GENERIC_WORDS), `word=${word}`).toEqual(["게시판", word]);
    }
  });

  it("목록에 없는 낱말은 뜻이 비슷해도 빼지 않는다", () => {
    // 'Framework Solution' 은 호환 소프트웨어의 분류 이름이다
    const terms = ["framework", "프레임워크", "solution", "솔루션", "JEUS"];
    expect(dropGenericTerms(terms, COMPATIBILITY_GENERIC_WORDS)).toEqual(terms);
    expect(dropGenericTerms(terms, COMPONENT_GENERIC_WORDS)).toEqual(terms);
  });

  it("목록의 낱말이 다른 낱말의 일부일 뿐이면 빼지 않는다", () => {
    const terms = ["within", "forum", "information", "eGovFrameWeb", "egov-cms", "subcomponent", "전자정부포털"];
    expect(dropGenericTerms(terms, COMPONENT_GENERIC_WORDS)).toEqual(terms);
  });

  it("뺀 뒤에 남는 검색어가 없으면 빼지 않고 그대로 돌려준다", () => {
    // 제품명에 eGovframe 이 든 제품을 그 낱말만으로 찾을 수 있어야 한다
    expect(dropGenericTerms(["eGovframe"], COMPATIBILITY_GENERIC_WORDS)).toEqual(["eGovframe"]);
    expect(dropGenericTerms(["컴포넌트"], COMPONENT_GENERIC_WORDS)).toEqual(["컴포넌트"]);
    expect(dropGenericTerms(["is", "the", "eGovFrame"], COMPATIBILITY_GENERIC_WORDS)).toEqual(["is", "the", "eGovFrame"]);
    expect(dropGenericTerms([], COMPATIBILITY_GENERIC_WORDS)).toEqual([]);
  });

  it("남는 검색어가 한 글자뿐이어도 다른 검색어가 남은 것이다", () => {
    expect(dropGenericTerms(["eGovFrame", "8"], COMPATIBILITY_GENERIC_WORDS)).toEqual(["8"]);
  });

  it("대상의 모든 항목에 해당하는 낱말은 조사가 붙어 있어도 뺀다", () => {
    expect(dropGenericTerms(["eGovFrame에서", "쓰는", "CMS"], COMPATIBILITY_GENERIC_WORDS)).toEqual(["쓰는", "CMS"]);
    expect(dropGenericTerms(["전자정부의", "표준프레임워크로", "JEUS"], COMPATIBILITY_GENERIC_WORDS)).toEqual(["JEUS"]);
    expect(dropGenericTerms(["게시판", "컴포넌트를"], COMPONENT_GENERIC_WORDS)).toEqual(["게시판"]);
    expect(dropGenericTerms(["components는", "게시판"], COMPONENT_GENERIC_WORDS)).toEqual(["게시판"]);
  });

  it("영어 기능어는 한글이 붙어 있으면 빼지 않는다", () => {
    // 'IT서비스', 'AS센터' 는 영어 기능어 it, as 로 시작하지만 다른 낱말이다
    const terms = ["IT서비스", "AS센터", "IT는", "관리"];
    expect(dropGenericTerms(terms, COMPATIBILITY_GENERIC_WORDS)).toEqual(terms);
    expect(dropGenericTerms(["IT", "관리"], COMPATIBILITY_GENERIC_WORDS)).toEqual(["관리"]);
  });

  it("isGenericTerm 은 낱말 하나가 목록의 낱말인지 알려 준다", () => {
    expect(isGenericTerm("with", COMPATIBILITY_GENERIC_WORDS)).toBe(true);
    expect(isGenericTerm("eGovFrame", COMPATIBILITY_GENERIC_WORDS)).toBe(true);
    expect(isGenericTerm("eGovFrame에서", COMPATIBILITY_GENERIC_WORDS)).toBe(true);
    expect(isGenericTerm("컴포넌트", COMPONENT_GENERIC_WORDS)).toBe(true);
    expect(isGenericTerm("컴포넌트", COMPATIBILITY_GENERIC_WORDS)).toBe(false);
    expect(isGenericTerm("JEUS", COMPATIBILITY_GENERIC_WORDS)).toBe(false);
    expect(isGenericTerm("", COMPATIBILITY_GENERIC_WORDS)).toBe(false);
  });

  it("다른 낱말과 기호로 이어 적힌 영어 기능어는 빼지 않는다", () => {
    // 'Q&A' 의 'A' 는 관사가 아니고, 'on/off' 의 'on' 은 전치사가 아니다. 이어 적힌 낱말은 joinedTermKeys 가 알려 준다
    expect(dropGenericTerms(["Q", "A", "관리"], COMPONENT_GENERIC_WORDS, new Set(["q", "a"]))).toEqual(["Q", "A", "관리"]);
    expect(dropGenericTerms(["on", "off", "스위치"], COMPONENT_GENERIC_WORDS, new Set(["on", "off"]))).toEqual([
      "on",
      "off",
      "스위치",
    ]);
    // 따로 적힌 것은 뺀다
    expect(dropGenericTerms(["Q", "A", "관리"], COMPONENT_GENERIC_WORDS, new Set())).toEqual(["Q", "관리"]);
    expect(isGenericTerm("A", COMPONENT_GENERIC_WORDS, new Set(["a"]))).toBe(false);
    expect(isGenericTerm("A", COMPONENT_GENERIC_WORDS)).toBe(true);
  });

  it("대상의 모든 항목에 해당하는 낱말은 이어 적혀 있어도 뺀다", () => {
    // '전자정부(표준프레임워크)' 처럼 적어도 두 낱말은 프레임워크 자체를 가리킨다
    const joined = new Set(["전자정부", "표준프레임워크", "egovframe", "spring"]);
    expect(dropGenericTerms(["전자정부", "표준프레임워크", "4.3", "CMS"], COMPATIBILITY_GENERIC_WORDS, joined)).toEqual([
      "4.3",
      "CMS",
    ]);
    expect(dropGenericTerms(["eGovFrame", "Spring"], COMPATIBILITY_GENERIC_WORDS, joined)).toEqual(["Spring"]);
  });
});

describe("joinedTermKeys", () => {
  const joined = (raw: string) => [...joinedTermKeys(raw)].sort();

  it("앞이나 뒤의 낱말과 공백 없이 기호로 이어 적힌 낱말을 소문자로 돌려준다", () => {
    expect(joined("Q&A 관리")).toEqual(["a", "q"]);
    expect(joined("on/off 스위치")).toEqual(["off", "on"]);
    expect(joined("JEUS,Tibero+WebLogic")).toEqual(["jeus", "tibero", "weblogic"]);
    expect(joined("게시판(BBS)")).toEqual(["bbs", "게시판"]);
  });

  it("공백으로 떨어져 있으면 이어 적힌 것이 아니다 (문장부호가 붙어 있어도 같다)", () => {
    expect(joined("Q A")).toEqual([]);
    expect(joined("Q & A")).toEqual([]);
    expect(joined('Is Tibero "compatible" (with) eGovFrame 4.3?')).toEqual([]);
    expect(joined("JEUS, Tibero")).toEqual([]);
    expect(joined("게시판")).toEqual([]);
    expect(joined("")).toEqual([]);
  });

  it("'.', '-', '_' 로 이은 것은 한 낱말이라 해당하지 않는다", () => {
    expect(joined("to-do in_out egovframework.com")).toEqual([]);
  });

  it("전각 문자는 반각으로 바꾼 뒤에 본다", () => {
    expect(joined("Ｑ＆Ａ")).toEqual(["a", "q"]);
    // 전각 공백은 공백이다
    expect(joined("Ｑ　Ａ")).toEqual([]);
  });

  it("한 번이라도 이어 적혔으면 이어 적힌 낱말이다", () => {
    expect(joined("a CMS 와 Q&A")).toEqual(["a", "q"]);
  });

  it("extractSearchTerms 와 같이 query 의 앞 2,000자만 읽는다", () => {
    expect(joined(`${"x ".repeat(1000)}Q&A`)).toEqual([]);
  });
});

describe("extractSearchTerms 가 읽는 query 의 길이", () => {
  it("읽는 길이의 상한은 2,000자다", () => {
    expect(MAX_KEYWORD_QUERY_LENGTH).toBe(2000);
  });

  it("query 의 앞 2,000자에서만 검색어를 추출한다", () => {
    // 'a ' 1,000번이 정확히 2,000자다. 그 뒤의 낱말은 읽지 않는다
    expect(extractSearchTerms(`${"a ".repeat(1000)}뒤쪽`)).toEqual(["a"]);
    // 2,000번째 글자까지는 읽는다 ('x' 1,997자 + 공백 + 'ab' = 2,000자)
    expect(extractSearchTerms(`${"x".repeat(1997)} abcd`)).toEqual(["x".repeat(1997), "ab"]);
  });

  it("경계에 걸친 낱말은 앞 2,000자에 든 부분까지만 검색어가 된다", () => {
    expect(extractSearchTerms("가".repeat(2500))).toEqual(["가".repeat(2000)]);
    expect(extractSearchTerms(`a${".".repeat(80000)}a`)).toEqual(["a"]);
  });

  it("2,000자 이하의 query 는 그대로 읽는다", () => {
    const words = Array.from({ length: 10 }, (_, index) => `낱말${index}`);
    expect(extractSearchTerms(words.join(" "))).toEqual(words);
    expect(extractSearchTerms("가".repeat(2000))).toEqual(["가".repeat(2000)]);
  });
});

describe("splitAtSeparators", () => {
  it("검색어 안쪽의 '.', '-', '_' 에서 나눈 조각을 차례대로 돌려준다", () => {
    expect(splitAtSeparators("K2Web-Wizard")).toEqual(["K2Web", "Wizard"]);
    expect(splitAtSeparators("sts_com")).toEqual(["sts", "com"]);
    expect(splitAtSeparators("egovframework.com.cop.bbs")).toEqual(["egovframework", "com", "cop", "bbs"]);
    expect(splitAtSeparators("spring-boot_starter.web")).toEqual(["spring", "boot", "starter", "web"]);
  });

  it("구분 문자가 이어져 있어도 빈 조각은 만들지 않는다", () => {
    expect(splitAtSeparators("a.-_b")).toEqual(["a", "b"]);
    expect(splitAtSeparators("게시판--템플릿")).toEqual(["게시판", "템플릿"]);
  });

  it("조각의 길이는 가리지 않는다 (한 글자 조각을 쓸지는 호출부가 정한다)", () => {
    expect(splitAtSeparators("JEUS-8")).toEqual(["JEUS", "8"]);
    expect(splitAtSeparators("4.3")).toEqual(["4", "3"]);
  });

  it("구분 문자가 없는 검색어는 나눌 것이 없어 빈 배열을 돌려준다", () => {
    expect(splitAtSeparators("JEUS")).toEqual([]);
    expect(splitAtSeparators("게시판")).toEqual([]);
    expect(splitAtSeparators("")).toEqual([]);
  });

  it("아주 긴 검색어도 100ms 안에 나눈다", () => {
    for (const term of [`${"a-".repeat(999)}a`, `a${".".repeat(1998)}a`, "a".repeat(2000)]) {
      expect(elapsedMs(() => splitAtSeparators(term))).toBeLessThan(100);
    }
  });
});

describe("isEnglishTerm", () => {
  it("ASCII 영문자와 숫자로만 되어 있고 영문자가 든 검색어를 가려낸다", () => {
    for (const term of ["ECM", "ecm", "K2Web", "a", "Z9", "R6", "12c", "v7"]) {
      expect(isEnglishTerm(term), term).toBe(true);
    }
  });

  it("숫자뿐인 검색어는 아니다", () => {
    // 버전 숫자는 'v7', 'R6' 처럼 영문자 바로 뒤에 적는 일이 많아, 낱말의 처음을 따지면 찾는 행이 뒤로 밀린다
    for (const term of ["7", "21", "2025", "0"]) {
      expect(isEnglishTerm(term), term).toBe(false);
    }
  });

  it("한글이나 기호가 든 검색어, 빈 문자열은 아니다", () => {
    for (const term of ["게시판", "JEUS는", "CMS관리", "4.3", "i-Portal", "sts_com", "Q&A", "ＣＭＳ", "é", "a b", ""]) {
      expect(isEnglishTerm(term), term).toBe(false);
    }
  });
});

describe("wordStartGlobPattern", () => {
  // 패턴이 SQLite 의 GLOB 에서 실제로 어떻게 견줘지는지를 본다 (키워드 검색은 값 앞에 공백 한 칸을 붙여 견준다)
  const db = new Database(":memory:");
  afterAll(() => {
    db.close();
  });

  /** 값(value)에서 검색어(term)가 낱말의 처음에서 일치하는지 */
  const startsWord = (value: string, term: string): boolean => {
    const row = db.prepare("SELECT (' ' || ?) GLOB ? AS hit").get(value, wordStartGlobPattern(term)) as { hit: number };
    return row.hit === 1;
  };

  it("값의 맨 앞에서 일치하면 낱말의 처음이다", () => {
    expect(startsWord("ECM Solution", "ECM")).toBe(true);
    expect(startsWord("ECM", "ECM")).toBe(true);
    expect(startsWord("ist", "ist")).toBe(true);
  });

  it("바로 앞 글자가 공백, 숫자, 기호, 한글이면 낱말의 처음이다", () => {
    for (const value of ["Crownix Report & ERS", "7ERS", "MC@ERS", "a.b.ers", "(ERS)", "Report/ERS", "리포트ERS", "１ERS"]) {
      expect(startsWord(value, "ERS"), value).toBe(true);
    }
  });

  it("바로 앞 글자가 ASCII 영문자이면 낱말의 처음이 아니다", () => {
    for (const value of ["PowerService5", "Universe CMS", "UNIVERSE", "xers", "XERS", "zErS"]) {
      expect(startsWord(value, "ERS"), value).toBe(false);
    }
    expect(startsWord("TimeCMS", "ECM")).toBe(false);
    expect(startsWord("ZenithECM 3.0", "ECM")).toBe(false);
  });

  it("ASCII 영문자의 대소문자를 가리지 않는다", () => {
    for (const [value, term] of [
      ["ecm solution", "ECM"],
      ["ECM Solution", "ecm"],
      ["Ecm", "eCM"],
      ["k2web wizard", "K2Web"],
    ]) {
      expect(startsWord(value, term), `${value} / ${term}`).toBe(true);
    }
  });

  it("낱말의 가운데에서 일치한 자리를 지나, 그 뒤에 낱말의 처음에서 일치한 자리가 있으면 일치한다", () => {
    // 'TimeCMS' 의 가운데 다음에, 설명의 '영역: ECM' 에서 낱말의 처음으로 나온다
    expect(startsWord("TimeCMS -영역: ECM", "ECM")).toBe(true);
    expect(startsWord("aaa a", "a")).toBe(true);
    expect(startsWord("aaa", "aa")).toBe(true);
    expect(startsWord("baa", "aa")).toBe(false);
  });

  it("숫자가 든 검색어도 같은 규칙으로 견준다 (바로 앞 글자가 숫자이면 낱말의 처음이다)", () => {
    expect(startsWord("KCUBE R6 1.0", "R6")).toBe(true);
    expect(startsWord("2R6", "R6")).toBe(true);
    expect(startsWord("XR6", "R6")).toBe(false);
    expect(startsWord("K2Web Wizard", "Web")).toBe(true);
  });

  it("검색어가 들어 있지 않은 값이나 빈 값과는 일치하지 않는다", () => {
    expect(startsWord("CMS Solution", "ECM")).toBe(false);
    expect(startsWord("", "ECM")).toBe(false);
    expect(startsWord("EC", "ECM")).toBe(false);
  });

  it("GLOB 에서 뜻이 있는 문자(*, ?, [, ])는 글자 그대로 견준다", () => {
    // 키워드 검색이 이 패턴에 넘기는 검색어는 영문자와 숫자뿐이지만, 어떤 검색어를 넘겨도 와일드카드로 읽히지 않아야 한다
    expect(startsWord("a*b", "a*b")).toBe(true);
    expect(startsWord("aXb", "a*b")).toBe(false);
    expect(startsWord("a?b", "a?b")).toBe(true);
    expect(startsWord("aXb", "a?b")).toBe(false);
    expect(startsWord("[ab]", "[ab]")).toBe(true);
    expect(startsWord("a", "[ab]")).toBe(false);
    expect(startsWord("x]y", "x]y")).toBe(true);
    expect(startsWord("x[y", "x[y")).toBe(true);
    expect(startsWord("[^a]", "[^a]")).toBe(true);
    expect(startsWord("b", "[^a]")).toBe(false);
    expect(startsWord("a-z", "a-z")).toBe(true);
    expect(startsWord("m", "a-z")).toBe(false);
    // 별표뿐인 검색어가 모든 값과 일치하지 않는다
    expect(startsWord("anything", "*")).toBe(false);
    expect(startsWord("5 * 3", "*")).toBe(true);
  });

  it("아주 긴 검색어도 SQLite 의 패턴 길이 한도(50,000바이트) 안에 든다", () => {
    // 검색어는 길어야 2,000자(MAX_KEYWORD_QUERY_LENGTH)다
    const pattern = wordStartGlobPattern("a".repeat(MAX_KEYWORD_QUERY_LENGTH));
    expect(Buffer.byteLength(pattern, "utf8")).toBeLessThan(50_000);
    expect(startsWord(`x ${"A".repeat(MAX_KEYWORD_QUERY_LENGTH)}`, "a".repeat(MAX_KEYWORD_QUERY_LENGTH))).toBe(true);
  });
});

describe("particleStrippedForms", () => {
  it("영문·숫자 뒤에 한글 1~3자가 붙은 꼴은 한글을 뗀 앞부분을 돌려준다", () => {
    expect(particleStrippedForms("JEUS는")).toEqual(["JEUS"]);
    expect(particleStrippedForms("4.3에서")).toEqual(["4.3"]);
    expect(particleStrippedForms("Tibero를")).toEqual(["Tibero"]);
    expect(particleStrippedForms("JEUS입니다")).toEqual(["JEUS"]);
    expect(particleStrippedForms("spring-boot_starter로")).toEqual(["spring-boot_starter"]);
  });

  it("붙은 한글이 조사가 아니어도 뗀다", () => {
    expect(particleStrippedForms("JEUS서버")).toEqual(["JEUS"]);
  });

  it("붙은 한글이 네 자 이상이면 앞부분을 돌려주지 않는다", () => {
    expect(particleStrippedForms("JEUS이라면서")).toEqual([]);
    // 끝의 조사를 떼는 규칙은 따로 적용된다
    expect(particleStrippedForms("JEUS이라면서도")).toEqual(["JEUS이라면서"]);
  });

  it("조사로 끝나면 조사를 뗀 나머지를 돌려준다", () => {
    const cases: Array<[string, string]> = [
      ["티맥스는", "티맥스"],
      ["게시판은", "게시판"],
      ["게시판이", "게시판"],
      ["오라클가", "오라클"],
      ["게시판을", "게시판"],
      ["티맥스를", "티맥스"],
      ["로그인와", "로그인"],
      ["게시판과", "게시판"],
      ["오라클의", "오라클"],
      ["게시판에", "게시판"],
      ["권한도", "권한"],
      ["티베로로", "티베로"],
      ["템플릿으로", "템플릿"],
      ["게시판에서", "게시판"],
      ["담당자에게", "담당자"],
      ["로그인부터", "로그인"],
      ["권한까지", "권한"],
    ];
    for (const [term, expected] of cases) {
      expect(particleStrippedForms(term), `term=${term}`).toEqual([expected]);
    }
  });

  it("'으로' 로 끝나면 '로' 가 아니라 '으로' 를 뗀다", () => {
    expect(particleStrippedForms("확인으로")).toEqual(["확인"]);
  });

  it("뗀 나머지가 두 글자 미만이면 돌려주지 않는다", () => {
    expect(particleStrippedForms("주는")).toEqual([]);
    expect(particleStrippedForms("나의")).toEqual([]);
    expect(particleStrippedForms("집으로")).toEqual([]);
    expect(particleStrippedForms("C는")).toEqual([]);
    expect(particleStrippedForms("8에서")).toEqual([]);
    // 조사만으로 된 낱말
    expect(particleStrippedForms("에서")).toEqual([]);
    expect(particleStrippedForms("부터")).toEqual([]);
  });

  it("두 규칙이 모두 맞으면 영문·숫자 앞부분을 먼저, 서로 다른 꼴만 돌려준다", () => {
    // 한글을 모두 뗀 'ABC' 가 먼저고, 끝의 조사 '는' 만 뗀 'ABC가나' 가 다음이다
    expect(particleStrippedForms("ABC가나는")).toEqual(["ABC", "ABC가나"]);
    // 두 규칙의 결과가 같으면 한 번만 돌려준다
    expect(particleStrippedForms("JEUS는")).toEqual(["JEUS"]);
  });

  it("뗀 꼴의 끝에 남은 '.', '-', '_' 는 뗀다", () => {
    expect(particleStrippedForms("spring-boot-는")).toEqual(["spring-boot"]);
    expect(particleStrippedForms("게시판_을")).toEqual(["게시판"]);
  });

  it("어느 규칙에도 맞지 않으면 빈 배열을 돌려준다", () => {
    expect(particleStrippedForms("JEUS")).toEqual([]);
    expect(particleStrippedForms("게시판")).toEqual([]);
    expect(particleStrippedForms("솔루션")).toEqual([]);
    expect(particleStrippedForms("")).toEqual([]);
  });

  it("아주 긴 낱말도 100ms 안에 처리한다", () => {
    for (const term of ["a".repeat(2000), `${"a".repeat(1999)}는`, `${"가".repeat(1999)}는`, `${"a-".repeat(999)}는`]) {
      expect(elapsedMs(() => particleStrippedForms(term))).toBeLessThan(100);
    }
  });
});

describe("trimEdgeSeparators", () => {
  it("양끝의 '.', '-', '_' 만 떼고 안쪽의 것은 남긴다", () => {
    expect(trimEdgeSeparators("..4.3-")).toBe("4.3");
    expect(trimEdgeSeparators("_egovframework.com.cop.bbs_")).toBe("egovframework.com.cop.bbs");
    expect(trimEdgeSeparators("-spring-boot.")).toBe("spring-boot");
    expect(trimEdgeSeparators("게시판")).toBe("게시판");
  });

  it("구분 문자뿐이거나 빈 입력은 빈 문자열을 돌려준다", () => {
    expect(trimEdgeSeparators("")).toBe("");
    expect(trimEdgeSeparators(".")).toBe("");
    expect(trimEdgeSeparators("._-._-")).toBe("");
  });

  it("안쪽에 구분 문자가 길게 이어져도 입력 길이에 비례하는 시간 안에 끝난다", () => {
    // 정규식 /^[._-]+|[._-]+$/g 는 끝에 닿지 않는 구분 문자 줄의 자리마다 줄 끝까지 다시 훑어 2차 시간이 걸린다
    const inner = `a${".".repeat(80000)}a`;
    let trimmed = "";
    expect(elapsedMs(() => (trimmed = trimEdgeSeparators(inner)))).toBeLessThan(100);
    expect(trimmed).toBe(inner);
    expect(elapsedMs(() => (trimmed = trimEdgeSeparators("-".repeat(60000))))).toBeLessThan(100);
    expect(trimmed).toBe("");
  });
});

describe("extractSearchTerms 의 처리 시간", () => {
  it("구분 문자('.', '-', '_')가 길게 이어진 입력도 100ms 안에 끝난다", () => {
    // 'a' + '.' 8만 개 + 'a' 는 약 3초가 걸렸고, 그동안 stdio 서버 전체가 멈췄다
    expect(elapsedMs(() => extractSearchTerms(`a${".".repeat(80000)}a`))).toBeLessThan(100);
    expect(elapsedMs(() => extractSearchTerms("-".repeat(60000)))).toBeLessThan(100);
  });
});
