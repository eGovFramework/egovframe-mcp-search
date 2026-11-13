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
    // 연산자 단어는 연산자가 아니라 낱말로 검색된다
    expect(match("AND 연산")).toEqual([6]);
  });
});
