/**
 * 키워드 검색어 추출과 FTS5 MATCH 식 조립 단위 테스트
 *
 * 사용자가 입력한 문장을 그대로 MATCH 에 넘기면 문장부호 하나로 구문 오류가 나고,
 * 한국어 복합어("권한관리")는 토큰 전체가 일치해야만 검색된다.
 * extractSearchTerms / buildFts5MatchQuery 는 어떤 입력에도 구문 오류가 나지 않는
 * 접두 일치 MATCH 식을 만든다.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import {
  MAX_KEYWORD_QUERY_LENGTH,
  MAX_SEARCH_TERMS,
  buildFts5MatchQuery,
  extractSearchTerms,
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

describe("buildFts5MatchQuery", () => {
  it("검색어마다 큰따옴표 구와 접두 일치(*)를 붙여 AND 로 결합한다", () => {
    expect(buildFts5MatchQuery(["게시판", "4.3"])).toBe('"게시판"* "4.3"*');
  });

  it("검색어가 없으면 null 을 돌려준다", () => {
    expect(buildFts5MatchQuery([])).toBeNull();
  });
});

describe("조립한 MATCH 식을 실제 FTS5 에 실행", () => {
  let db: Database.Database;

  beforeAll(() => {
    db = new Database(":memory:");
    db.exec(`
      CREATE VIRTUAL TABLE docs USING fts5(body);
      INSERT INTO docs(rowid, body) VALUES
        (1, '권한관리 컴포넌트는 역할별 권한을 관리합니다'),
        (2, '게시판에 글을 등록합니다'),
        (3, '표준프레임워크 4.3 버전을 지원합니다'),
        (4, '4 개 항목 가운데 3 개를 선택합니다'),
        (5, 'egovframework.com.cop.bbs 패키지'),
        (6, 'JEUS는 AND 연산을 지원합니다');
    `);
  });

  afterAll(() => {
    db.close();
  });

  const match = (raw: string): number[] => {
    const expr = buildFts5MatchQuery(extractSearchTerms(raw));
    if (!expr) return [];
    return (db.prepare("SELECT rowid FROM docs WHERE docs MATCH ? ORDER BY rowid").all(expr) as Array<{
      rowid: number;
    }>).map((r) => r.rowid);
  };

  it("복합어의 앞부분만 입력해도 찾는다", () => {
    expect(match("권한")).toEqual([1]);
  });

  it("조사가 붙은 낱말을 조사 없이 찾는다", () => {
    expect(match("게시판")).toEqual([2]);
    expect(match("jeus")).toEqual([6]);
  });

  it("버전 번호는 숫자가 붙어 있는 행만 찾는다", () => {
    expect(match("4.3")).toEqual([3]);
  });

  it("패키지명은 구 단위로 찾는다", () => {
    expect(match("egovframework.com.cop.bbs")).toEqual([5]);
  });

  it("여러 검색어는 모두 포함한 행만 찾는다", () => {
    expect(match("권한 컴포넌트")).toEqual([1]);
    expect(match("권한 게시판")).toEqual([]);
  });

  it("문장부호와 FTS5 연산자 단어가 섞여도 구문 오류가 나지 않는다", () => {
    const nasty = [
      "로그인?",
      "게시판!",
      "A AND",
      "AND",
      "OR NOT",
      "NEAR(a b)",
      "c++",
      "it's",
      '"dq" "',
      "(x)",
      "a:b",
      "-neg",
      "x*",
      "^start",
      "100%",
      "a/b\\c",
      "{col}: v",
    ];
    for (const raw of nasty) {
      expect(() => match(raw), `query=${raw}`).not.toThrow();
    }
    // 연산자 단어는 검색어에서 빠지고, 남은 낱말로 검색된다
    expect(match("AND 연산")).toEqual([6]);
  });
});
