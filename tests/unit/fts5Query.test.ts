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
  MAX_PARSED_TERMS,
  MAX_SEARCH_TERMS,
  dropGenericTerms,
  extractSearchTerms,
  flexibleForm,
  hasOrOperator,
  isEnglishFunctionWord,
  isEnglishTerm,
  isGenericTerm,
  joinedTermKeys,
  listedTargetWord,
  parseKeywordQuery,
  particleStrippedForms,
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

  it("서로 다른 낱말을 64개까지 읽는다 (검색어 수 상한 16개는 키워드 검색이 가려 주지 못하는 낱말을 뺀 뒤에 적용한다)", () => {
    expect(MAX_PARSED_TERMS).toBe(64);
    const words = Array.from({ length: 80 }, (_, i) => `t${i}`);
    expect(parseKeywordQuery(words.join(" ")).terms).toEqual(words.slice(0, 64));
    // 접속사와 중복은 세지 않는다
    expect(parseKeywordQuery(`x AND x OR X ${words.join(" ")}`).terms).toEqual(["x", ...words.slice(0, 63)]);
    // 검색어만 추출하는 extractSearchTerms 의 기본 상한은 그대로 16개다
    expect(extractSearchTerms(words.join(" "))).toEqual(words.slice(0, 16));
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

describe("가려 주지 못하는 낱말의 판정 (isEnglishFunctionWord, listedTargetWord)", () => {
  it("isEnglishFunctionWord 는 낱말 전체가 영어 기능어인지 알려 준다 (대소문자를 가리지 않는다)", () => {
    for (const term of ["with", "Is", "THE", "a", "how"]) {
      expect(isEnglishFunctionWord(term), term).toBe(true);
    }
    // 목록의 낱말이 일부일 뿐인 낱말, 한글이 붙은 꼴, 목록에 없는 낱말(was), 대상 낱말은 아니다
    for (const term of ["within", "forum", "was", "IT서비스", "AS센터", "IT는", "eGovFrame", "컴포넌트", "JEUS", ""]) {
      expect(isEnglishFunctionWord(term), JSON.stringify(term)).toBe(false);
    }
  });

  it("다른 낱말과 이어 적힌 낱말은 영어 기능어가 아니다", () => {
    // 'Q&A' 의 'A' 는 관사가 아니고, 'on/off' 의 'on' 은 전치사가 아니다. 이어 적힌 낱말은 joinedTermKeys 가 알려 준다
    expect(isEnglishFunctionWord("A", new Set(["q", "a"]))).toBe(false);
    expect(isEnglishFunctionWord("on", new Set(["on", "off"]))).toBe(false);
    expect(isEnglishFunctionWord("A", new Set(["q"]))).toBe(true);
    expect(isEnglishFunctionWord("A")).toBe(true);
  });

  it("listedTargetWord 는 대상의 모든 항목에 해당하는 낱말이면 목록에 있는 꼴을 적힌 표기대로 돌려준다", () => {
    expect(listedTargetWord("eGovFrame", COMPATIBILITY_GENERIC_WORDS)).toBe("eGovFrame");
    expect(listedTargetWord("EGOV", COMPATIBILITY_GENERIC_WORDS)).toBe("EGOV");
    expect(listedTargetWord("전자정부", COMPATIBILITY_GENERIC_WORDS)).toBe("전자정부");
    expect(listedTargetWord("Components", COMPONENT_GENERIC_WORDS)).toBe("Components");
  });

  it("조사가 붙은 꼴은 조사를 뗀 꼴이 목록에 있으면 그 뗀 꼴을 돌려준다", () => {
    expect(listedTargetWord("eGovFrame에서", COMPATIBILITY_GENERIC_WORDS)).toBe("eGovFrame");
    expect(listedTargetWord("표준프레임워크로", COMPATIBILITY_GENERIC_WORDS)).toBe("표준프레임워크");
    expect(listedTargetWord("전자정부의", COMPATIBILITY_GENERIC_WORDS)).toBe("전자정부");
    expect(listedTargetWord("컴포넌트를", COMPONENT_GENERIC_WORDS)).toBe("컴포넌트");
    expect(listedTargetWord("components는", COMPONENT_GENERIC_WORDS)).toBe("components");
  });

  it("대상의 낱말이 아니면 null 을 돌려준다 (대상마다 목록이 다르다)", () => {
    // 컴포넌트를 가리키는 낱말은 공통컴포넌트의 목록에만 있다
    expect(listedTargetWord("컴포넌트", COMPATIBILITY_GENERIC_WORDS)).toBeNull();
    expect(listedTargetWord("component", COMPATIBILITY_GENERIC_WORDS)).toBeNull();
    // 목록의 낱말이 일부일 뿐인 낱말, 뜻이 비슷한 낱말, 영어 기능어는 아니다
    const others = ["eGovFrameWeb", "egov-cms", "subcomponent", "전자정부포털", "egovframework.com.cop.bbs", "framework", "프레임워크", "JEUS", "with", ""];
    for (const term of others) {
      expect(listedTargetWord(term, COMPONENT_GENERIC_WORDS), JSON.stringify(term)).toBeNull();
    }
  });
});

describe("joinedTermKeys", () => {
  const joined = (raw: string) => [...joinedTermKeys(raw)].sort();

  it("앞이나 뒤의 낱말과 낱말을 잇는 기호('&', '/', '+')로 이어 적힌 낱말을 소문자로 돌려준다", () => {
    expect(joined("Q&A 관리")).toEqual(["a", "q"]);
    expect(joined("on/off 스위치")).toEqual(["off", "on"]);
    expect(joined("R&D 센터")).toEqual(["d", "r"]);
    expect(joined("Tibero+WebLogic")).toEqual(["tibero", "weblogic"]);
    // 그 기호가 이어져 있어도 같다
    expect(joined("and/&/or 그리고 A&&B")).toEqual(["a", "and", "b", "or"]);
  });

  it("그 밖의 기호는 낱말을 잇지 않는다 (아포스트로피, 쉼표, 괄호, 따옴표, 콜론 등)", () => {
    // "What's" 의 What 과 "Tibero,is" 의 is 는 따로 적힌 낱말이다. 이어 적힌 낱말로 보면 영어 기능어인데도 검색어로 쓰인다
    expect(joined("What's the login component?")).toEqual([]);
    expect(joined("Tibero,is it ok")).toEqual([]);
    expect(joined('게시판(BBS) "is"it [on]off egov:framework MC@CMS a=b a|b a*b a#b')).toEqual([]);
    expect(joined("JEUS,Tibero+WebLogic")).toEqual(["tibero", "weblogic"]);
    // 잇는 기호에 다른 기호가 섞여 있어도 잇지 않는다
    expect(joined("Q&(A) on/'off'")).toEqual([]);
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

describe("flexibleForm", () => {
  // 패턴이 SQLite 의 GLOB 에서 실제로 어떻게 견줘지는지를 본다 (키워드 검색은 값의 앞뒤에 공백 한 칸씩을 붙여 견준다)
  const db = new Database(":memory:");
  afterAll(() => {
    db.close();
  });

  /** 검색어의 유연한 꼴을 견주는 GLOB 패턴 두 개. 유연한 꼴이 없으면 null */
  const patternsOf = (term: string): [string, string] | null => flexibleForm(term)?.patterns ?? null;

  /** 값(value)이 검색어(term)의 유연한 꼴과 일치하는지: 두 패턴 가운데 하나라도 일치하면 일치다 */
  const matchesFlexibly = (value: string, term: string): boolean => {
    const patterns = patternsOf(term);
    if (patterns === null) {
      throw new Error(`유연한 꼴이 없는 검색어: ${term}`);
    }
    return patterns.some((pattern) => {
      const row = db.prepare("SELECT (' ' || ? || ' ') GLOB ? AS hit").get(value, pattern) as { hit: number };
      return row.hit === 1;
    });
  };

  it("검색어를 유연한 자리에서 나눈 부분과 GLOB 패턴 두 개를 돌려준다", () => {
    expect(flexibleForm("K2Web-Wizard")).toEqual({
      parts: ["K2Web", "Wizard"],
      patterns: [
        "*[^A-Za-z][Kk]2[Ww][Ee][Bb][^0-9A-Za-z가-힣][Ww][Ii][Zz][Aa][Rr][Dd][^A-Za-z]*",
        "*[^A-Za-z][Kk]2[Ww][Ee][Bb][Ww][Ii][Zz][Aa][Rr][Dd][^A-Za-z]*",
      ],
    });
    // 숫자 사이의 구분 문자는 부분 안에 그대로 남고, 숫자나 한글로 시작하거나 끝나는 쪽에는 조건이 붙지 않는다
    expect(flexibleForm("공통-8.5")).toEqual({
      parts: ["공통", "8.5"],
      patterns: ["*공통[^0-9A-Za-z가-힣]8.5*", "*공통8.5*"],
    });
    expect(flexibleForm("egovframework.com.cop-bbs")?.parts).toEqual(["egovframework", "com", "cop", "bbs"]);
  });

  it("유연한 자리마다 기호나 공백 하나가 온 값과 일치한다", () => {
    // 유연한 자리: 검색어 안쪽의 '.', '-', '_' 묶음. 값에는 ASCII 영문자도 숫자도 한글 음절도 아닌 글자 하나가 올 수 있다
    for (const term of ["K2Web-Wizard", "K2Web_Wizard", "K2Web.Wizard"]) {
      for (const value of ["K2Web Wizard", "K2Web-Wizard", "K2Web_Wizard", "K2Web.Wizard", "K2Web@Wizard", "K2Web/Wizard", "K2Web&Wizard"]) {
        expect(matchesFlexibly(value, term), `${value} / ${term}`).toBe(true);
      }
    }
    expect(matchesFlexibly("MC@CMS eGov", "MC-CMS")).toBe(true);
    expect(matchesFlexibly("in_S v1.0", "in-S")).toBe(true);
  });

  it("유연한 자리에 아무 글자도 오지 않은 값과도 일치한다", () => {
    expect(matchesFlexibly("K2WebWizard", "K2Web-Wizard")).toBe(true);
    expect(matchesFlexibly("WebSquare5 v5.0", "Web-Square")).toBe(true);
    expect(matchesFlexibly("SCMS 1.0", "S_CMS")).toBe(true);
    expect(matchesFlexibly("공통코드", "공통-코드")).toBe(true);
  });

  it("유연한 자리에 영문자, 숫자, 한글 음절이 오거나 글자가 둘 이상 오면 일치하지 않는다", () => {
    for (const value of ["K2WebXWizard", "K2Web7Wizard", "K2Web가Wizard", "K2Web  Wizard", "K2Web - Wizard", "K2Web Lite", "Wizard K2Web"]) {
      expect(matchesFlexibly(value, "K2Web-Wizard"), value).toBe(false);
    }
    // '공통의코드', '공통분류코드' 는 두 부분 사이에 한글이 들어 있다
    expect(matchesFlexibly("공통의코드", "공통-코드")).toBe(false);
    expect(matchesFlexibly("공통분류코드", "공통-코드")).toBe(false);
  });

  it("모든 자리에 글자 하나가 온 값이거나 모든 자리가 붙은 값이어야 한다 (자리마다 섞이지 않는다)", () => {
    expect(matchesFlexibly("web log tool", "web-log-tool")).toBe(true);
    expect(matchesFlexibly("web.log_tool", "web-log-tool")).toBe(true);
    expect(matchesFlexibly("weblogtool", "web-log-tool")).toBe(true);
    expect(matchesFlexibly("web logtool", "web-log-tool")).toBe(false);
    expect(matchesFlexibly("weblog tool", "web-log-tool")).toBe(false);
  });

  it("구분 문자가 이어져 있어도 유연한 자리 하나다", () => {
    expect(patternsOf("K2Web-_.Wizard")).toEqual(patternsOf("K2Web-Wizard"));
    expect(matchesFlexibly("K2Web Wizard", "K2Web--Wizard")).toBe(true);
  });

  it("양옆이 모두 ASCII 숫자인 구분 문자는 글자 그대로 견준다", () => {
    // 'JEUS-8.5': '-' 는 유연한 자리이고, 숫자 사이의 '.' 은 버전 표기의 일부다
    expect(matchesFlexibly("JEUS 8.5", "JEUS-8.5")).toBe(true);
    for (const value of ["JEUS 8 5", "JEUS 85", "JEUS 8-5", "JEUS 8", "JEUS 8,5"]) {
      expect(matchesFlexibly(value, "JEUS-8.5"), value).toBe(false);
    }
    expect(matchesFlexibly("Tool 2024-03-21 build", "Tool_2024-03-21")).toBe(true);
    expect(matchesFlexibly("Tool 2024 03 21 build", "Tool_2024-03-21")).toBe(false);
    // 한쪽만 숫자이면 유연한 자리다
    expect(matchesFlexibly("JEUS 8", "JEUS-8")).toBe(true);
    expect(matchesFlexibly("v7 Tibero", "v7-Tibero")).toBe(true);
  });

  it("유연한 자리가 없는 검색어에는 유연한 꼴이 없다", () => {
    // 구분 문자가 없거나, 구분 문자가 모두 숫자 사이에 있다 (버전, 날짜)
    for (const term of ["JEUS", "게시판", "8", "", "4.3", "10.1", "4.3.0", "03-21", "2099-12-31", "21_0", "1.2-3_4", "v1_0"]) {
      expect(patternsOf(term), JSON.stringify(term)).toBeNull();
    }
  });

  it("검색어의 첫 글자가 ASCII 영문자이면 일치한 자리의 바로 앞 글자가 ASCII 영문자가 아니어야 한다", () => {
    for (const value of ["S-CMS V1.0", "SCMS 1.0", "(S-CMS)", "가S-CMS", "7S-CMS", "x S CMS"]) {
      expect(matchesFlexibly(value, "S_CMS"), value).toBe(true);
    }
    for (const value of ["OS-CMS", "XSCMS", "xS CMS", "Trans-CMS"]) {
      expect(matchesFlexibly(value, "S_CMS"), value).toBe(false);
    }
    // 낱말의 가운데에서 일치한 자리를 지나, 그 뒤에 조건을 채운 자리가 있으면 일치한다
    expect(matchesFlexibly("OS-CMS 와 S-CMS", "S_CMS")).toBe(true);
  });

  it("검색어의 마지막 글자가 ASCII 영문자이면 일치한 자리의 바로 뒤 글자가 ASCII 영문자가 아니어야 한다", () => {
    for (const value of ["S-CMS", "S-CMS2", "S-CMS관리", "S-CMS.", "S CMS x"]) {
      expect(matchesFlexibly(value, "S_CMS"), value).toBe(true);
    }
    for (const value of ["S-CMSX", "SCMSolution", "S CMSx"]) {
      expect(matchesFlexibly(value, "S_CMS"), value).toBe(false);
    }
    // 'JE_S' 는 'JEUS' 와도 'JE Solution' 과도 일치하지 않는다
    expect(matchesFlexibly("JEUS 8", "JE_S")).toBe(false);
    expect(matchesFlexibly("JE Solution", "JE_S")).toBe(false);
  });

  it("첫 글자나 마지막 글자가 숫자나 한글이면 그쪽에는 조건을 두지 않는다", () => {
    // 마지막 글자가 숫자: 'JEUS-8' 은 'JEUS 8.5', 'JEUS 85', 'JEUS 8x' 와도 일치한다
    for (const value of ["JEUS 8", "JEUS 8.5", "JEUS 85", "JEUS 8x"]) {
      expect(matchesFlexibly(value, "JEUS-8"), value).toBe(true);
    }
    expect(matchesFlexibly("xJEUS 8", "JEUS-8")).toBe(false);
    // 첫 글자가 숫자: 앞 글자가 영문자여도 된다
    expect(matchesFlexibly("v8 bit", "8-bit")).toBe(true);
    expect(matchesFlexibly("v8 bits", "8-bit")).toBe(false);
    // 한글: 복합어의 가운데에서도 일치한다
    expect(matchesFlexibly("내부공통코드관리", "공통-코드")).toBe(true);
    expect(matchesFlexibly("A공통 코드B", "공통-코드")).toBe(true);
  });

  it("ASCII 영문자의 대소문자를 가리지 않는다", () => {
    for (const [value, term] of [
      ["k2web wizard", "K2Web-Wizard"],
      ["K2WEB WIZARD", "k2web_wizard"],
      ["sts-com", "STS_COM"],
      ["Web Messenger", "web-messenger"],
    ]) {
      expect(matchesFlexibly(value, term), `${value} / ${term}`).toBe(true);
    }
  });

  it("양끝의 구분 문자는 없는 것으로 본다", () => {
    expect(patternsOf("-K2Web-Wizard_")).toEqual(patternsOf("K2Web-Wizard"));
    expect(patternsOf("-JEUS-")).toBeNull();
  });

  it("GLOB 에서 뜻이 있는 문자(*, ?, [, ])는 글자 그대로 견준다", () => {
    // 키워드 검색이 넘기는 검색어에는 이런 문자가 없지만, 어떤 검색어를 넘겨도 와일드카드로 읽히지 않아야 한다
    expect(matchesFlexibly("a* b", "a*-b")).toBe(true);
    expect(matchesFlexibly("axx b", "a*-b")).toBe(false);
    expect(matchesFlexibly("a? b", "a?-b")).toBe(true);
    expect(matchesFlexibly("ax b", "a?-b")).toBe(false);
    expect(matchesFlexibly("[a] b", "[a]-b")).toBe(true);
    expect(matchesFlexibly("a b", "[a]-b")).toBe(false);
  });

  it("아주 긴 검색어의 패턴도 SQLite 의 패턴 길이 한도(50,000바이트) 안에 든다", () => {
    // 검색어는 길어야 2,000자(MAX_KEYWORD_QUERY_LENGTH)다. 글자와 구분 문자가 번갈아 나올 때 패턴이 가장 길다
    const longest = `${"a-".repeat(MAX_KEYWORD_QUERY_LENGTH / 2 - 1)}ab`;
    expect(longest).toHaveLength(MAX_KEYWORD_QUERY_LENGTH);
    for (const term of [longest, `${"가_".repeat(999)}가나`, `a${".".repeat(1998)}a`, `${"ab_".repeat(666)}ab`]) {
      expect(elapsedMs(() => patternsOf(term))).toBeLessThan(100);
      const patterns = patternsOf(term);
      expect(patterns).toHaveLength(2);
      for (const pattern of patterns ?? []) {
        expect(Buffer.byteLength(pattern, "utf8")).toBeLessThan(50_000);
      }
    }
    // 그 패턴으로 견줘도 오류가 없고, 같은 꼴의 값과 일치한다
    const value = `${"A ".repeat(MAX_KEYWORD_QUERY_LENGTH / 2 - 1)}AB`;
    let hit = false;
    expect(elapsedMs(() => (hit = matchesFlexibly(value, longest)))).toBeLessThan(100);
    expect(hit).toBe(true);
    expect(matchesFlexibly("a b c", longest)).toBe(false);
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
