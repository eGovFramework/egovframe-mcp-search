/**
 * 키워드 검색어 추출 단위 테스트
 *
 * 공통컴포넌트·호환 소프트웨어의 키워드 검색은 query 에서 검색어를 추출해 부분 문자열 일치로 찾는다.
 * 문장부호, 검색 연산자처럼 적은 접속사, 전각 문자, 아주 긴 입력이 들어와도 일정한 검색어 목록이 나와야 한다.
 * (파일 이름은 검색어로 FTS5 MATCH 식을 조립하던 때의 것이다.)
 */
import { describe, it, expect } from "vitest";
import {
  MAX_KEYWORD_QUERY_LENGTH,
  MAX_SEARCH_TERMS,
  extractSearchTerms,
  particleStrippedForms,
  trimEdgeSeparators,
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
