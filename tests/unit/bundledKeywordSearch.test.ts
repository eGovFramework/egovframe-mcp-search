/**
 * 동봉 지식베이스(knowledge-base/egovframe.db)에 대한 키워드 검색 회귀 테스트
 *
 * 고정 데이터로는 드러나지 않고 실제 데이터에서 확인된 문제를 그 데이터로 고정한다.
 * - 한국어 복합어의 뒤쪽이나 가운데에 든 낱말을 찾지 못했다 ("코드" 에 '공통코드' 가 빠졌다).
 * - 흔한 낱말에 군말이 붙으면 0건이었다 ("CMS 추천").
 * - 영문 접속사, 조사가 붙은 제품명, 전각 영숫자로 물으면 0건이었다.
 * - 제품 버전 표기가 검색 대상이 아니었다 ("JEUS 8").
 * - 프레임워크 버전과 확인일자가 검색 대상이 아니었다 (설명에 버전이 적히지 않은 행, "2025", "2024-11").
 * - 제품명을 여럿 나열하거나 영어 문장으로 물으면 0건이었다 ("JEUS Tibero WebLogic").
 * - vendor 필터가 법인 표기까지 같은 행만 돌려줬다 ("(주)아이액츠", "㈜아이액츠", "주식회사 아이액츠").
 * - 한 글자 낱말을 검색어에서 빼, 그 낱말이 가려 주던 행이 나머지 낱말만의 결과에 묻혔다 ("롤 관리", "JEUS 8").
 * - 영어 기능어와 목록의 모든 항목에 해당하는 낱말이 결과를 흩뜨렸다 ("Is Tibero compatible with eGovFrame 4.3?",
 *   "eGovFrame 4.3 호환 CMS", "게시판 컴포넌트").
 * - 대체 검색이 흔한 낱말만 일치한 행으로 결과를 채웠다 ("티맥스 제품 목록", "게시판 기능 알려줘").
 * - 낱말을 저장된 표기와 다른 기호로 이으면 0건이었다 ("K2Web-Wizard", "sts_com", "JEUS-8").
 * - 기호에서 나눈 조각으로 찾으면 조각이 다른 낱말의 일부와 일치해 결과가 부풀었다 ("egovframework.com.zzz" 가
 *   전체 컴포넌트, "REST-API 게시판" 에서 게시판이 4위, 주소를 적은 query 가 여러 건).
 * - 가려 주지 못하는 낱말을 일치 여부와 관계없이 빼, 제품명에 그 낱말이 든 제품이 묻히거나("eGov CMS"),
 *   남은 낱말로는 한 행도 찾지 못하거나("컴포넌트 목록"), 한 글자 검색이 되었다 ("eGovFrame 8", "in S").
 * - 일부 검색어만 일치한 결과에서, 영문 검색어가 일치한 행이 한글 검색어가 이름에 든 행보다 언제나 앞에 왔다
 *   ("게시판 API", "티맥스 OR LG"). 이름이 더 짧은 설문조사가 Q&A관리보다 앞에 왔다 ("Q&A").
 * - 두세 글자 영문 검색어가 다른 낱말 속에서 일치한 행이, 낱말로 일치한 행보다 앞에 왔다 ("ECM Solution", "ERS",
 *   컴포넌트 ID "ist").
 * - OR 로 이은 낱말이 모두 든 행만 돌려줬다 ("게시판 OR 댓글", "CMS OR Portal").
 *
 * DB 는 읽기 전용으로 열고, 조회가 파일을 바꾸지 않았는지 마지막에 확인한다.
 * 동봉 데이터는 갱신될 수 있으므로 건수를 숫자로 고정하지 않고, 같은 뜻의 두 조회가 같은 결과를 내는지와
 * 꼭 들어 있어야 하는 행이 들어 있는지를 본다.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SQLiteManager } from "../../src/database/sqliteManager.js";
import type { CompatibilityQueryResult, CompatibilitySoftwareInfo } from "../../src/types/database.js";
import { idsOf } from "./_componentFixture.js";

const KNOWLEDGE_BASE_DIR = fileURLToPath(new URL("../../knowledge-base/", import.meta.url));
const DB_PATH = path.join(KNOWLEDGE_BASE_DIR, "egovframe.db");

const sha256 = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/** 호환 소프트웨어 행을 가리키는 키 (제품명·버전 표기·프레임워크 버전이 고유하다) */
const keyOf = (row: CompatibilitySoftwareInfo): string =>
  `${row.product_name}|${row.product_version}|${row.framework_version}`;

const rowKeys = (result: CompatibilityQueryResult): string[] => result.rows.map(keyOf);

/** 순서와 무관하게 견줄 수 있도록 정렬한 행 키 */
const rowSet = (result: CompatibilityQueryResult): string[] => rowKeys(result).sort();

describe("동봉 지식베이스의 키워드 검색", () => {
  let sqlite: SQLiteManager;
  let hashBefore: string;
  let filesBefore: string[];

  beforeAll(() => {
    hashBefore = sha256(DB_PATH);
    filesBefore = fs.readdirSync(KNOWLEDGE_BASE_DIR).sort();
    sqlite = new SQLiteManager(DB_PATH, { readonly: true });
  });

  afterAll(() => {
    sqlite.close();
  });

  /** 호환 소프트웨어를 limit 없이 조회한다 (조건에 맞는 모든 행) */
  const compatible = (query: string, filters = {}) => sqlite.queryCompatibleSoftware({ query, filters });

  describe("공통컴포넌트", () => {
    it('"코드" 는 이름의 뒤쪽에 그 낱말이 든 공통코드·공통분류코드·공통상세코드도 찾는다', () => {
      const result = sqlite.queryComponents({ query: "코드" });
      expect(result.matchMode).toBe("all-terms");
      expect(idsOf(result.rows)).toEqual(expect.arrayContaining(["cca", "ccc", "cde"]));
      // 이름에 '코드' 가 든 컴포넌트가 설명에만 든 컴포넌트보다 앞에 온다
      const names = result.rows.map((row) => row.name.includes("코드"));
      expect(names.indexOf(false) === -1 || names.lastIndexOf(true) < names.indexOf(false)).toBe(true);
    });

    it("낱말의 가운데에 든 검색어로 찾은 결과도 all-terms 다", () => {
      const result = sqlite.queryComponents({ query: "증서" });
      expect(result.matchMode).toBe("all-terms");
      expect(idsOf(result.rows)).toContain("sec");
    });

    it('"롤 관리", "웹 로그" 는 한 글자 낱말까지 든 컴포넌트만 돌려준다', () => {
      // 두 글자 이상인 검색어가 있으면 한 글자 검색어를 빼던 때에는 '관리' 가 든 컴포넌트, '로그' 가 든 컴포넌트가
      // 모두 나와, 찾는 컴포넌트(롤관리, 웹로그관리)가 첫 페이지 밖으로 밀렸다
      const cases: Array<[string, string, string]> = [
        ["롤 관리", "관리", "rmt"],
        ["웹 로그", "로그", "wlg"],
      ];
      for (const [query, longerTerm, id] of cases) {
        const result = sqlite.queryComponents({ query });
        expect(idsOf(result.rows), `query=${query}`).toEqual([id]);
        expect(result.matchMode, `query=${query}`).toBe("all-terms");
        expect(result.terms?.dropped, `query=${query}`).toEqual([]);
        expect(result.total, `query=${query}`).toBeLessThan(sqlite.queryComponents({ query: longerTerm }).total);
      }
    });

    it('"게시판 컴포넌트" 는 게시판 컴포넌트를 맨 앞에, "게시판" 과 같은 컴포넌트를 돌려준다', () => {
      // '컴포넌트' 를 검색어로 쓰던 때에는 두 낱말이 모두 설명에 든 웹에디터(wed) 한 건만 나왔다
      const board = sqlite.queryComponents({ query: "게시판" });
      const result = sqlite.queryComponents({ query: "게시판 컴포넌트" });
      expect(result.matchMode).toBe("all-terms");
      expect(result.terms).toEqual({ used: ["게시판"], ignored: [], dropped: ["컴포넌트"], required: 1 });
      expect(idsOf(result.rows)).toEqual(idsOf(board.rows));
      expect(idsOf(result.rows)[0]).toBe("bbs");
      expect(result.total).toBeGreaterThan(1);
      // 그 낱말뿐이면 빼지 않고 그대로 찾는다
      const alone = sqlite.queryComponents({ query: "컴포넌트" });
      expect(alone.terms).toEqual({ used: ["컴포넌트"], ignored: [], dropped: [], required: 1 });
      expect(idsOf(alone.rows)).toContain("wed");
    });

    it("대상 낱말을 빼면 한 건도 찾지 못하는 query 는 대상 낱말로 찾는다", () => {
      // '컴포넌트' 를 다른 낱말이 있으면 일치 여부와 관계없이 빼던 때에는 "컴포넌트 목록" 이 0건이었다
      // ('목록', '어떤', '있나요' 는 어느 컴포넌트에도 없다)
      const cases: Array<[string, string, string[]]> = [
        ["컴포넌트 목록", "컴포넌트", ["목록"]],
        ["공통컴포넌트 목록", "공통컴포넌트", ["목록"]],
        ["어떤 컴포넌트가 있나요", "컴포넌트", ["어떤", "있나요"]],
      ];
      for (const [query, word, ignored] of cases) {
        const expected = sqlite.queryComponents({ query: word });
        const result = sqlite.queryComponents({ query });
        expect(expected.total, `query=${word}`).toBeGreaterThan(0);
        expect(idsOf(result.rows), `query=${query}`).toEqual(idsOf(expected.rows));
        expect(result.terms, `query=${query}`).toEqual({ used: [word], ignored, dropped: [], required: 1 });
      }
      // 대상 낱말이 둘이어도 같다 ('종류' 는 어느 컴포넌트에도 없다)
      const two = sqlite.queryComponents({ query: "전자정부 컴포넌트 종류" });
      expect(two.terms).toEqual({ used: ["전자정부", "컴포넌트"], ignored: ["종류"], dropped: [], required: 1 });
      const union = new Set([
        ...idsOf(sqlite.queryComponents({ query: "전자정부" }).rows),
        ...idsOf(sqlite.queryComponents({ query: "컴포넌트" }).rows),
      ]);
      expect(idsOf(two.rows).sort()).toEqual([...union].sort());
    });

    it("아포스트로피로 붙여 적은 영어 기능어도 검색어로 쓰지 않는다", () => {
      // 공백이 없으면 어떤 기호든 낱말을 이은 것으로 보던 때에는 "What's" 의 'What' 이 검색어로 쓰여,
      // 영문 설명에 'what to do today' 가 든 메모/할일관리(mtm)가 결과에 섞였다
      const login = sqlite.queryComponents({ query: "login" });
      const result = sqlite.queryComponents({ query: "What's the login component?" });
      expect(result.terms?.dropped).toEqual(["What", "the", "component"]);
      // 한 글자 's' 는 모든 검색어가 일치하는 컴포넌트를 찾을 때 함께 쓴다
      expect(result.terms?.used).toEqual(["s", "login"]);
      expect(result.matchMode).toBe("all-terms");
      // login 이 든 컴포넌트만 나온다
      expect(result.total).toBeGreaterThan(1);
      expect(idsOf(result.rows).every((id) => idsOf(login.rows).includes(id))).toBe(true);
      expect(idsOf(result.rows)).not.toContain("mtm");
    });

    it("흔한 낱말이 섞인 문장형 질의는 가려 주는 낱말이 든 컴포넌트만 돌려준다", () => {
      // '기능' 은 컴포넌트 대부분의 설명에 들어 있다. 그 낱말만 일치한 컴포넌트까지 돌려주던 때에는
      // "게시판 기능 알려줘" 가 130건 남짓이 되고, 첫 20건 가운데 14건에 '게시판' 이 없었다
      const cases: Array<[string, string]> = [
        ["게시판 기능 알려줘", "게시판"],
        ["로그인 기능이 필요합니다", "로그인"],
        ["통계 기능 알려줘", "통계"],
      ];
      const everyComponent = sqlite.queryComponents().total;
      for (const [query, keyword] of cases) {
        const expected = sqlite.queryComponents({ query: keyword });
        const result = sqlite.queryComponents({ query });
        expect(expected.total, `query=${keyword}`).toBeGreaterThan(0);
        expect(result.matchMode, `query=${query}`).toBe("any-term");
        expect(idsOf(result.rows).sort(), `query=${query}`).toEqual(idsOf(expected.rows).sort());
        // 흔한 낱말도 쓴 검색어로 알린다 (버리지 않고, 일치한 검색어 수에는 센다)
        expect(result.terms?.used, `query=${query}`).toEqual([keyword, "기능"]);
      }
      // '기능' 은 대상의 절반 넘게 일치하는 흔한 낱말이다
      expect(sqlite.queryComponents({ query: "기능" }).total * 2).toBeGreaterThan(everyComponent);
    });

    it("기호로 이은 낱말이 저장된 표기와 달라도 찾는다", () => {
      // 컴포넌트 ID 는 'sts-com', 'blog-management' 이고 이름은 'Web Messenger', '공통코드', '웹로그관리' 다.
      // 다른 기호로 이으면 0건이었고, 기호에서 나눈 조각으로 찾던 때에는 조각 하나만 든 컴포넌트가 열 건 남짓 딸려 나왔다
      const cases: Array<[string, string[]]> = [
        ["sts_com", ["sts-com"]],
        ["blog_management", ["blog-management"]],
        ["Web-Messenger", ["msg"]],
        ["공통-코드", ["cca", "ccc"]],
        ["web_log", ["wlg"]],
      ];
      for (const [query, ids] of cases) {
        const result = sqlite.queryComponents({ query });
        expect(result.matchMode, `query=${query}`).toBe("any-term");
        // 쓴 검색어는 조각이 아니라 query 에 적힌 검색어다
        expect(result.terms, `query=${query}`).toEqual({ used: [query], ignored: [], dropped: [], required: 1 });
        expect(idsOf(result.rows), `query=${query}`).toEqual(ids);
      }
      // 저장된 표기 그대로 적으면 그대로 찾는다
      for (const id of ["sts-com", "blog-management"]) {
        const exact = sqlite.queryComponents({ query: id });
        expect(idsOf(exact.rows), `query=${id}`).toEqual([id]);
        expect(exact.matchMode, `query=${id}`).toBe("all-terms");
      }
    });

    it("기호로 이은 검색어를 조각으로 나눠 찾지 않는다", () => {
      // 조각으로 나눠 찾던 때에는 'com'(모든 패키지명), 'REST'('Rest day', 'restrictions'), 'sign'('signature'),
      // '없는'(설명의 한 구절)이 일치해 찾는 것과 무관한 컴포넌트가 나왔다 ("egovframework.com.zzz" 는 전체 컴포넌트였다)
      for (const query of ["egovframework.com.zzz", "REST-API", "single-sign-on", "sign-in", "multi-file", "zzz-없는-컴포넌트"]) {
        const result = sqlite.queryComponents({ query });
        expect(result.total, `query=${query}`).toBe(0);
        expect(result.terms, `query=${query}`).toEqual({ used: [], ignored: [query], dropped: [], required: 0 });
      }

      // 그런 검색어가 섞여도 나머지 검색어만으로 찾은 것과 행도 순서도 같다
      const pairs: Array<[string, string, string]> = [
        ["REST-API 게시판", "게시판", "REST-API"],
        ["single-sign-on 로그인", "로그인", "single-sign-on"],
      ];
      for (const [query, keyword, ignored] of pairs) {
        const expected = sqlite.queryComponents({ query: keyword });
        const result = sqlite.queryComponents({ query });
        expect(expected.total, `query=${keyword}`).toBeGreaterThan(1);
        expect(idsOf(result.rows), `query=${query}`).toEqual(idsOf(expected.rows));
        expect(result.terms, `query=${query}`).toEqual({ used: [keyword], ignored: [ignored], dropped: [], required: 1 });
      }
      expect(idsOf(sqlite.queryComponents({ query: "REST-API 게시판" }).rows)[0]).toBe("bbs");
    });

    it("유연한 꼴로 쓴 검색어는 OR 와 필터 안에서도 그 표기의 컴포넌트하고만 일치한다", () => {
      // "sts_com OR 게시판": 조각 'com' 이 모든 컴포넌트와 일치하던 때에는 전체 컴포넌트가 나왔다
      const board = sqlite.queryComponents({ query: "게시판" });
      const either = sqlite.queryComponents({ query: "sts_com OR 게시판" });
      expect(either.terms).toEqual({ used: ["sts_com", "게시판"], ignored: [], dropped: [], required: 1, orQuery: true });
      expect(idsOf(either.rows).sort()).toEqual([...idsOf(board.rows), "sts-com"].sort());
      expect(either.total).toBeLessThan(sqlite.queryComponents().total);
      // sts-com 은 게시판 카테고리가 아니다
      const filtered = sqlite.queryComponents({ query: "sts_com", filters: { categoryId: "게시판" } });
      expect(filtered.total).toBe(0);
      expect(filtered.terms).toEqual({ used: [], ignored: ["sts_com"], dropped: [], required: 0 });
    });

    it("컴포넌트 ID 로도 찾는다 (패키지명과 다른 ID)", () => {
      // 'uss-cmt' 의 패키지명은 egovframework.com.uss.cmt 다. ID 에만 'uss-cmt' 가 있다
      expect(idsOf(sqlite.queryComponents({ query: "uss-cmt" }).rows)).toEqual(["uss-cmt"]);
    });

    it("세 글자 컴포넌트 ID 로 찾으면 그 컴포넌트가 맨 앞에 온다", () => {
      // 'ist' 는 'list'·'statistics' 의 가운데에, 'omm' 은 'common'·'community' 의 가운데에도 들어 있다.
      // 낱말의 처음에서 일치했는지를 가리지 않던 때에는 그런 컴포넌트가 이름이 짧은 순으로 앞을 채워,
      // 찾는 컴포넌트(연계현황관리, 온라인매뉴얼)가 일곱 번째와 아홉 번째였다
      for (const id of ["ist", "omm"]) {
        const result = sqlite.queryComponents({ query: id });
        expect(result.matchMode, `query=${id}`).toBe("all-terms");
        expect(result.total, `query=${id}`).toBeGreaterThan(1);
        expect(idsOf(result.rows)[0], `query=${id}`).toBe(id);
      }
    });

    it('"게시판 OR 댓글" 은 두 낱말 가운데 하나라도 든 컴포넌트를 모두 돌려준다', () => {
      // OR 를 검색어에서 빼기만 하던 때에는 "게시판 댓글" 과 같아져, 두 낱말이 모두 든 댓글관리(cmt) 한 건에서 끝났다
      const both = sqlite.queryComponents({ query: "게시판 댓글" });
      expect(both.matchMode).toBe("all-terms");
      expect(idsOf(both.rows)).toContain("cmt");

      const either = sqlite.queryComponents({ query: "게시판 OR 댓글" });
      expect(either.matchMode).toBe("any-term");
      expect(either.terms).toEqual({ used: ["게시판", "댓글"], ignored: [], dropped: [], required: 1, orQuery: true });
      // '게시판' 으로 찾은 것과 '댓글' 로 찾은 것을 합친 것과 같다. 게시판(bbs)이 빠지지 않는다
      const union = new Set([
        ...idsOf(sqlite.queryComponents({ query: "게시판" }).rows),
        ...idsOf(sqlite.queryComponents({ query: "댓글" }).rows),
      ]);
      expect(idsOf(either.rows).sort()).toEqual([...union].sort());
      expect(idsOf(either.rows)).toContain("bbs");
      expect(either.total).toBeGreaterThan(both.total);
      // 두 낱말이 모두 든 컴포넌트가 앞에 온다
      expect(idsOf(either.rows).slice(0, both.total).sort()).toEqual(idsOf(both.rows).sort());
    });

    it('"Q&A" 와 "Q A" 는 Q&A관리를 맨 앞에 돌려준다', () => {
      // 'Q' 와 'A' 가 어딘가에 든 컴포넌트는 서른 개가 넘는다. 낱말의 처음에서 일치했는지를 가리지 않던 때에는
      // Q&A관리(qna)가 이름이 더 짧은 컴포넌트들에 밀려 여섯 번째였다
      for (const query of ["Q&A", "Q A"]) {
        const result = sqlite.queryComponents({ query });
        expect(result.matchMode, `query=${query}`).toBe("all-terms");
        // 띄어 쓴 'A' 는 영어 기능어지만, 두 글자 이상인 다른 낱말이 없어 빼지 않는다
        expect(result.terms, `query=${query}`).toEqual({ used: ["Q", "A"], ignored: [], dropped: [], required: 2 });
        const ids = idsOf(result.rows);
        // 설문조사(qri)도 두 글자가 모두 낱말의 처음에서 일치하고(ID 'qri' 와 영문 설명의 'answering') 이름 컬럼에도
        // 들어 있으며 이름이 더 짧다. 이름 컬럼 안에서는 'A' 가 'Survey Management' 의 가운데에만 들어 있어 뒤에 온다
        expect(ids[0], `query=${query}`).toBe("qna");
        expect(ids, `query=${query}`).toContain("qri");
        // 'Q' 가 낱말의 가운데에 든 FAQ관리보다 앞이다
        expect(ids, `query=${query}`).toContain("faq");
        expect(ids.indexOf("qri"), `query=${query}`).toBeLessThan(ids.indexOf("faq"));
      }
      // '관리' 를 함께 적으면 세 검색어가 모두 이름에 든 Q&A관리가 맨 앞이다
      expect(idsOf(sqlite.queryComponents({ query: "Q&A 관리" }).rows)[0]).toBe("qna");
    });

    it('"게시판 API" 는 게시판을 맨 앞에 돌려준다', () => {
      // 낱말의 처음에서 일치한 영문 검색어 수가 많은 컴포넌트를 먼저 놓던 때에는, 설명에 'Open API' 가 든
      // 도로명주소관리(adr)가 이름에 '게시판' 이 든 컴포넌트들보다 앞에 왔다 (한글 검색어는 그 기준에서 세지 않는다)
      const result = sqlite.queryComponents({ query: "게시판 API" });
      expect(result.matchMode).toBe("any-term");
      expect(result.terms).toEqual({ used: ["게시판", "API"], ignored: [], dropped: [], required: 1 });
      const ids = idsOf(result.rows);
      expect(ids[0]).toBe("bbs");
      expect(ids).toContain("adr");
      // 이름에 '게시판' 이 든 컴포넌트가 모두 adr 보다 앞이다
      const boards = result.rows.filter((row) => row.name.includes("게시판"));
      expect(boards.length).toBeGreaterThan(1);
      expect(Math.max(...boards.map((row) => ids.indexOf(row.component_id)))).toBeLessThan(ids.indexOf("adr"));
    });
  });

  describe("호환 소프트웨어", () => {
    it('영문 접속사를 섞은 "JEUS OR Tibero", "JEUS and Tibero" 는 "JEUS Tibero" 와 같은 행을 돌려준다', () => {
      const plain = compatible("JEUS Tibero");
      expect(plain.total).toBeGreaterThan(0);
      for (const query of ["JEUS OR Tibero", "JEUS and Tibero", "JEUS AND Tibero", "jeus or tibero"]) {
        const result = compatible(query);
        expect(rowSet(result), `query=${query}`).toEqual(rowSet(plain));
        expect(result.matchMode, `query=${query}`).toBe(plain.matchMode);
      }
      // JEUS 행과 Tibero 행이 모두 들어 있다
      const names = new Set(plain.rows.map((row) => row.product_name));
      expect(names.has("JEUS")).toBe(true);
      expect(names.has("Tibero")).toBe(true);
    });

    it('"CMS OR Portal" 은 두 낱말 가운데 하나라도 든 행을 모두 돌려준다', () => {
      // OR 를 검색어에서 빼기만 하던 때에는 "CMS Portal" 과 같아져, 두 낱말이 모두 든 일곱 행 남짓에서 끝났다
      const both = compatible("CMS Portal");
      expect(both.matchMode).toBe("all-terms");
      expect(both.total).toBeGreaterThan(0);

      const either = compatible("CMS OR Portal");
      expect(either.matchMode).toBe("any-term");
      expect(either.terms).toEqual({ used: ["CMS", "Portal"], ignored: [], dropped: [], required: 1, orQuery: true });
      const union = new Set([...rowKeys(compatible("CMS")), ...rowKeys(compatible("Portal"))]);
      expect(rowSet(either)).toEqual([...union].sort());
      expect(either.total).toBeGreaterThan(both.total);
      // 'CMS' 는 목록의 절반 넘는 행에 든 흔한 낱말이다. OR 로 이으면 그 낱말만 일치한 행도 돌려준다
      expect(compatible("CMS").total * 2).toBeGreaterThan(sqlite.queryCompatibleSoftware().total);
      // 두 낱말이 모두 든 행이 앞에 온다
      expect(rowKeys(either).slice(0, both.total).sort()).toEqual(rowSet(both));
      // 소문자로 적어도 같다
      expect(rowKeys(compatible("CMS or Portal"))).toEqual(rowKeys(either));
    });

    it('제품명 셋을 나열한 "JEUS Tibero WebLogic" 은 세 제품의 행을 모두 돌려준다', () => {
      // 한 행에 두 제품명이 함께 들 수 없다. 검색어의 절반 이상이 일치하는 행만 찾던 때에는 0건이었다
      const result = compatible("JEUS Tibero WebLogic");
      expect(result.matchMode).toBe("any-term");
      expect(result.terms).toEqual({ used: ["JEUS", "Tibero", "WebLogic"], ignored: [], dropped: [], required: 1 });
      // 제품명 하나씩으로 찾은 행을 합친 것과 같다
      const each = ["JEUS", "Tibero", "WebLogic"].map((name) => rowKeys(compatible(name)));
      expect(each.every((keys) => keys.length > 0)).toBe(true);
      expect(rowSet(result)).toEqual([...new Set(each.flat())].sort());
    });

    it('영어 문장으로 물은 "Is JEUS compatible with eGovFrame 4.3?" 도 0건이 되지 않는다', () => {
      // 다섯 검색어(Is, JEUS, with, eGovFrame, 4.3) 가운데 셋 이상이 든 행이 없어 0건이었다
      const result = compatible("Is JEUS compatible with eGovFrame 4.3?");
      expect(result.matchMode).toBe("any-term");
      expect(result.total).toBeGreaterThan(0);
      // 영어 기능어(Is, with)와 프레임워크 자체를 가리키는 낱말(eGovFrame)은 검색어로 쓰지 않는다
      expect(result.terms).toEqual({
        used: ["JEUS", "4.3"],
        ignored: ["compatible"],
        dropped: ["Is", "with", "eGovFrame"],
        required: 1,
      });
      // 일치한 검색어가 가장 많은 행이 맨 앞이다: 프레임워크 4.3 의 JEUS
      expect(result.rows[0]).toMatchObject({ product_name: "JEUS", framework_version: "4.3" });
    });

    it("긴 영어 문장의 뒤쪽에 적은 제품명도 검색어로 쓴다", () => {
      // 검색어 수 상한(16개)을 영어 기능어를 빼기 전에 적용하던 때에는, 기능어 열여섯 개 뒤의 JEUS 가 추출되지 않았다
      const functionWords = "is the a of to in on at by as it this that what which how".split(" ");
      const result = compatible(`${functionWords.join(" ")} JEUS`);
      expect(result.matchMode).toBe("all-terms");
      expect(result.terms).toEqual({ used: ["JEUS"], ignored: [], dropped: functionWords, required: 1 });
      expect(rowKeys(result)).toEqual(rowKeys(compatible("JEUS")));
      expect(result.total).toBeGreaterThan(0);
    });

    it("쉼표로 붙여 적은 영어 기능어도 검색어로 쓰지 않는다", () => {
      // "Tibero,is it ok" 의 'is' 를 Tibero 와 이어 적은 낱말로 보던 때에는 'is' 가 검색어로 쓰여,
      // aXis, WISE 처럼 'is' 가 든 스무 건 남짓이 Tibero 뒤에 딸려 나왔다
      const tibero = compatible("Tibero");
      const result = compatible("Tibero,is it ok");
      expect(result.terms?.dropped).toEqual(["is", "it"]);
      expect(result.terms?.used[0]).toBe("Tibero");
      expect(result.terms?.used).not.toContain("is");
      // Tibero 행이 맨 앞이고, 'is' 가 제품명의 일부일 뿐인 행은 없다
      expect(tibero.total).toBeGreaterThan(0);
      expect(rowKeys(result).slice(0, tibero.total)).toEqual(rowKeys(tibero));
      expect(result.rows.some((row) => /^(aXis|WISE)/i.test(row.product_name))).toBe(false);
    });

    it("영어 기능어가 제품명의 일부와 일치한 행은 결과에 섞이지 않는다", () => {
      // 'Is' 는 aXis·WISE 의 일부와, 'with' 는 WITHCMS 의 일부와 일치한다. 검색어로 쓰던 때에는 그런 행이
      // "Is Tibero compatible with eGovFrame 4.3?" 의 맨 앞을 차지했다
      const result = compatible("Is Tibero compatible with eGovFrame 4.3?");
      expect(result.terms?.used).toEqual(["Tibero", "4.3"]);
      expect(result.terms?.dropped).toEqual(["Is", "with", "eGovFrame"]);
      // Tibero 가 든 행과 4.3 의 행을 합친 것과 같다
      const expected = new Set([...rowKeys(compatible("Tibero")), ...rowKeys(compatible("4.3"))]);
      expect(rowSet(result)).toEqual([...expected].sort());
      expect(result.rows.some((row) => /^(aXis|WISE|WITHCMS)/i.test(row.product_name) && row.framework_version !== "4.3")).toBe(
        false,
      );
      // 이름에 검색어가 든 행이 앞에 온다: 제품명이 Tibero 인 두 행과, 제품 버전 표기에 '4.3' 이 든 한 행
      // ('JINIRAM Portal 4.3')이 앞의 세 행이다. 영문 검색어와 일치하지 않은 행을 뒤로 보내지 않으므로,
      // 확인일자가 더 최근인 그 한 행이 Tibero 보다 앞이다
      const tibero = compatible("Tibero");
      expect(tibero.total).toBe(2);
      const top = result.rows.slice(0, 3);
      expect(top.filter((row) => row.product_name === "Tibero").map(keyOf)).toEqual(rowKeys(tibero));
      expect(top.every((row) => row.product_name === "Tibero" || row.product_version.includes("4.3"))).toBe(true);
      expect(result.rows.slice(3).some((row) => row.product_name === "Tibero")).toBe(false);
    });

    it('"티맥스 OR LG" 는 두 업체의 행을 확인일자 순으로 돌려준다', () => {
      // 낱말의 처음에서 일치한 영문 검색어 수가 많은 행을 먼저 놓던 때에는 LG CNS 의 다섯 행이 티맥스의 행들보다
      // 앞에 와서, limit 5 이면 티맥스 행이 보이지 않았다 (한글 검색어 '티맥스' 는 그 기준에서 세지 않는다)
      const result = compatible("티맥스 OR LG");
      expect(result.terms).toEqual({ used: ["티맥스", "LG"], ignored: [], dropped: [], required: 1, orQuery: true });
      expect(result.rows.some((row) => row.vendor.includes("티맥스"))).toBe(true);
      expect(result.rows.some((row) => row.vendor.includes("LG"))).toBe(true);
      // 업체명에 낱말이 든 행끼리는 다른 기준으로 순서가 갈리지 않아 확인일자 순이다
      const byVendor = result.rows.filter((row) => row.vendor.includes("티맥스") || row.vendor.includes("LG"));
      const dates = byVendor.map((row) => row.verified_date);
      expect(dates).toEqual([...dates].sort().reverse());
      expect(result.rows[0].vendor).toContain("티맥스");
      // 'LG' 를 제품명의 낱말 가운데에서 찾은 행(2026-11-24 의 데이터에서는 'RealGridJS' 의 'lG')은 그 뒤에 온다
      const others = result.rows.slice(byVendor.length);
      expect(others.length).toBeGreaterThan(0);
      expect(others.every((row) => !row.vendor.includes("티맥스") && !row.vendor.includes("LG"))).toBe(true);
    });

    it('"CMS 추천" 은 any-term 으로 CMS 행을 돌려준다', () => {
      const cms = compatible("CMS");
      const result = compatible("CMS 추천");
      expect(cms.matchMode).toBe("all-terms");
      expect(cms.total).toBeGreaterThan(0);

      expect(result.matchMode).toBe("any-term");
      // 절반 넘는 행과 일치하는 'CMS' 를 버리던 때에는 0건이었다.
      // 쓸 수 있는 검색어가 흔한 검색어뿐이면 그 검색어가 일치한 행을 그대로 돌려준다 (CMS 단독 조회와 행도 순서도 같다)
      expect(cms.total * 2).toBeGreaterThan(sqlite.queryCompatibleSoftware().total);
      expect(rowKeys(result)).toEqual(rowKeys(cms));
      expect(result.terms).toEqual({ used: ["CMS"], ignored: ["추천"], dropped: [], required: 1 });
    });

    it("흔한 낱말이 섞인 문장형 질의는 가려 주는 낱말이 든 행만 돌려준다", () => {
      // '제품', '버전', '호환' 은 목록의 대부분 행에 들어 있다. 그 낱말만 일치한 행까지 돌려주던 때에는
      // "티맥스 제품 목록" 이 350건 남짓이 되고 티맥스 다섯 행 가운데 둘이 300번째 뒤로 밀렸다.
      // 2026-11-24 의 데이터에서는 티맥스 다섯 행 가운데 셋의 설명에 '제품' 이 들어 있고 '목록' 이 다른 두 행의
      // '첨부파일목록' 에 들어 있어, 그 질의는 이 규칙이 아니라 KNOWN_ISSUES 의 KW-12 를 재현한다 (빼고 시험한다)
      const cases: Array<[string, string]> = [
        ["DBMS 제품 추천", "DBMS"],
        ["티베로 호환되는 버전", "티베로"],
        ["JEUS의 호환 버전", "JEUS"],
      ];
      const everyRow = sqlite.queryCompatibleSoftware().total;
      for (const [query, keyword] of cases) {
        const expected = compatible(keyword);
        const result = compatible(query);
        expect(expected.total, `query=${keyword}`).toBeGreaterThan(0);
        expect(expected.total * 2, `query=${keyword}`).toBeLessThanOrEqual(everyRow);
        expect(result.matchMode, `query=${query}`).toBe("any-term");
        expect(rowSet(result), `query=${query}`).toEqual(rowSet(expected));
        // 흔한 낱말도 쓴 검색어로 알린다 (버리지 않고, 일치한 검색어 수에는 센다)
        expect(result.terms?.used[0], `query=${query}`).toBe(keyword);
        expect(result.terms?.used.length, `query=${query}`).toBeGreaterThan(1);
      }
      // JEUS 제품만 나온다
      expect(compatible("JEUS의 호환 버전").rows.every((row) => row.product_name === "JEUS")).toBe(true);
    });

    it("조사가 붙은 제품명·업체명·버전은 조사를 뗀 검색어와 같은 행을 돌려준다", () => {
      const pairs: Array<[string, string]> = [
        ["JEUS는", "JEUS"],
        ["티맥스는", "티맥스"],
        ["Tibero를", "Tibero"],
        ["4.3에서", "4.3"],
      ];
      for (const [withParticle, bare] of pairs) {
        const expected = compatible(bare);
        const result = compatible(withParticle);
        expect(expected.total, `query=${bare}`).toBeGreaterThan(0);
        expect(rowSet(result), `query=${withParticle}`).toEqual(rowSet(expected));
        expect(result.terms, `query=${withParticle}`).toEqual({ used: [bare], ignored: [], dropped: [], required: 1 });
      }
    });

    it('"JEUS 8" 은 제품 버전 표기가 "JEUS 8" 인 행을 돌려준다', () => {
      const result = compatible("JEUS 8");
      const versions = result.rows.map((row) => row.product_version);
      expect(versions).toContain("JEUS 8");
      // 설명에 '8' 이 없는 행이라 제품 버전 표기를 검색하지 않으면 찾지 못한다
      expect(result.rows.every((row) => row.product_name === "JEUS")).toBe(true);
      // 한 글자 검색어 '8' 도 쓴다. 빼던 때에는 'JEUS' 만 일치하는 JEUS 21 이 맨 앞에 함께 나왔다
      expect(result.matchMode).toBe("all-terms");
      expect(result.terms).toEqual({ used: ["JEUS", "8"], ignored: [], dropped: [], required: 2 });
      expect(versions).toContain("JEUS 8.5");
      // 2026-11-24 의 데이터에서는 JEUS 21 의 설명에도 '8' 이 있어(확인일자 '2025.08.21') 함께 나오지만,
      // 제품 버전 표기에 '8' 이 든 두 행보다 뒤에 온다
      expect(versions.slice(0, 2).sort()).toEqual(["JEUS 8", "JEUS 8.5"]);
      // JEUS 행이 그 세 행뿐이라 결과가 'JEUS' 단독 조회보다 좁아지지는 않는다
      expect(result.total).toBeLessThanOrEqual(compatible("JEUS").total);
    });

    it("기호로 이은 낱말이 저장된 표기와 달라도 찾는다", () => {
      // 저장된 표기는 'K2Web Wizard' 다. 'K2Web-Wizard' 는 어느 행에도 부분 문자열로 들어 있지 않아 0건이었다
      const stored = compatible("K2Web Wizard");
      expect(stored.matchMode).toBe("all-terms");
      expect(stored.total).toBeGreaterThan(0);
      const joined = compatible("K2Web-Wizard");
      expect(joined.matchMode).toBe("any-term");
      // 쓴 검색어는 조각이 아니라 query 에 적힌 검색어다
      expect(joined.terms).toEqual({ used: ["K2Web-Wizard"], ignored: [], dropped: [], required: 1 });
      // 띄어 쓴 표기로 찾은 것과 행도 순서도 같다. 조각으로 나눠 찾던 때에는 'Wizard' 만 든 다른 제품이 딸려 나왔다
      expect(rowKeys(joined)).toEqual(rowKeys(stored));
      expect(joined.rows.every((row) => row.product_name === "K2Web Wizard")).toBe(true);

      // 'SCP-SmartUI' 를 다른 기호로 이어도 같은 행을 찾는다
      expect(rowKeys(compatible("SCP_SmartUI"))).toEqual(rowKeys(compatible("SCP-SmartUI")));
      expect(compatible("SCP_SmartUI").total).toBeGreaterThan(0);

      // 저장된 표기가 기호로 이은 꼴이거나('MC@CMS', 'S-CMS', 'U-CMS', 'in_S', 'I-ON') 붙여 쓴 꼴('WebSquare')이어도 찾는다
      const names = (query: string) => [...new Set(compatible(query).rows.map((row) => row.product_name))].sort();
      expect(names("MC-CMS")).toEqual(["MC@CMS eGov"]);
      expect(names("Crownix-Report")).toEqual(["Crownix Report & ERS"]);
      // 'U_CMS' 는 'U-CMS' 와 붙여 쓴 'UCMS' 다 (아래의 'S_CMS' 와 같다)
      expect(names("U_CMS")).toEqual(["U-CMS", "UCMS"]);
      expect(names("i_Portal")).toEqual([
        "i-Portal Platform(ContentNavigator)",
        "i-Portal Platform(P-CMS)",
        "i-Portal_Platform(ContentNavigator)",
      ]);
      expect(names("e_Biz")).toEqual(["e-Biz Portal"]);
      expect(names("in-S")).toEqual(["In_S", "in_S"]);
      // Asset Cube 와 Content Cube 는 설명에 적힌 주소(act.i-on.net)에서 'i-on' 이 일치한다
      expect(names("I_ON")).toEqual(["Asset Cube", "Content Cube", "I-ON Content Server"]);
      expect(names("Web-Square")).toEqual(["WebSquare AI", "WebSquare5"]);
      // 'S_CMS' 는 'S-CMS' 와 'SCMS' 다. 조각 'CMS' 로 찾던 때에는 CMS 가 든 300건 남짓이 나왔다
      for (const query of ["S_CMS", "S.CMS"]) {
        expect(names(query), `query=${query}`).toEqual(["S-CMS", "SCMS"]);
      }
    });

    it("기호로 이은 제품명과 버전은 그 버전의 행만 찾는다", () => {
      // 조각으로 나눠 찾던 때에는 한 글자 조각 '8' 을 쓰지 않아 JEUS 의 모든 버전이 나왔다
      const versions = (query: string) => compatible(query).rows.map((row) => row.product_version).sort();
      for (const query of ["JEUS-8", "JEUS_8", "JEUS.8"]) {
        expect(versions(query), `query=${query}`).toEqual(["JEUS 8", "JEUS 8.5"]);
        expect(compatible(query).terms, `query=${query}`).toEqual({ used: [query], ignored: [], dropped: [], required: 1 });
      }
      // 숫자 사이의 '.' 은 글자 그대로 견준다
      expect(versions("JEUS-8.5")).toEqual(["JEUS 8.5"]);
      expect(compatible("JEUS-8").total).toBeLessThan(compatible("JEUS").total);
    });

    it("기호로 이은 검색어를 조각으로 나눠 찾지 않는다", () => {
      // 조각으로 나눠 찾던 때에는 'JE'('JEUS'), 'go'('Google', 'category'), 'co', 'com' 이 일치해 행이 나왔다
      // 'tmaxsoft.com' 은 2026-11-24 의 데이터에서 JEUS 21 의 설명에 주소로 들어 있어 'tmaxsoft.co.kr' 로 바꿨다
      const absent = ["JE_S", "Tibero-7", "a-b", "www.egovframe.go.kr", "tmaxsoft.co.kr", "open-source"];
      for (const query of absent) {
        const result = compatible(query);
        expect(result.total, `query=${query}`).toBe(0);
        expect(result.terms, `query=${query}`).toEqual({ used: [], ignored: [query], dropped: [], required: 0 });
      }
      // 주소를 적은 query 는 ':', '/', '@' 에서 낱말이 나뉘고, 도메인 꼴 낱말은 조각으로 나눠 찾지 않는다.
      // 2026-11-24 의 데이터에서는 설명에 주소('-URL : https://…')나 'admin' 이 든 행이 있어 앞 낱말로는 찾는다
      // (KNOWN_ISSUES 의 KW-17)
      expect(compatible("https://www.example.co.kr").terms).toMatchObject({ used: ["https"], ignored: ["www.example.co.kr"] });
      expect(compatible("admin@example.com").terms).toMatchObject({ used: ["admin"], ignored: ["example.com"] });

      // "open-source DBMS" 는 분류가 DBMS 인 행들이다. 조각 'open' 이 제품명의 일부와 일치한 행이 앞에 서지 않는다
      const dbms = compatible("DBMS");
      const result = compatible("open-source DBMS");
      expect(rowKeys(result)).toEqual(rowKeys(dbms));
      expect(result.terms).toEqual({ used: ["DBMS"], ignored: ["open-source"], dropped: [], required: 1 });
      expect(result.rows.every((row) => row.category === "DBMS")).toBe(true);
    });

    it('"ECM Solution" 은 분류가 ECM Solution 인 행을 맨 앞에 돌려준다', () => {
      // 'ECM' 은 'TimeCMS'·'UniteCMS' 의 가운데에도 들어 있다. 낱말의 처음에서 일치했는지를 가리지 않던 때에는
      // 그런 제품이 확인일자 순으로 앞을 채워, 분류가 ECM Solution 인 행이 맨 뒤였다
      const category = sqlite.queryCompatibleSoftware({ filters: { category: "ECM Solution" } });
      expect(category.total).toBeGreaterThan(0);
      const result = compatible("ECM Solution");
      expect(result.matchMode).toBe("all-terms");
      expect(result.total).toBeGreaterThan(category.total);
      expect(rowKeys(result).slice(0, category.total).sort()).toEqual(rowSet(category));
    });

    it("두세 글자 영문 검색어는 낱말로 일치한 행을 다른 낱말 속에서 일치한 행보다 먼저 돌려준다", () => {
      // 'ERS' 는 'PowerService'·'Universe' 의 가운데에, 'EP' 는 'Report' 의 가운데에도 들어 있다
      const startsWord = (row: CompatibilitySoftwareInfo, term: string): boolean =>
        [row.product_name, row.product_version, row.vendor, row.category, row.description].some((value) =>
          new RegExp(`(^|[^A-Za-z])${term}`, "i").test(value ?? ""),
        );
      for (const term of ["ERS", "EP"]) {
        const result = compatible(term);
        expect(result.matchMode, `query=${term}`).toBe("all-terms");
        const flags = result.rows.map((row) => startsWord(row, term));
        // 낱말로 일치한 행과 다른 낱말 속에서 일치한 행이 모두 있고, 앞의 것이 모두 먼저다
        expect(flags.includes(true), `query=${term}`).toBe(true);
        expect(flags.includes(false), `query=${term}`).toBe(true);
        expect(flags.lastIndexOf(true), `query=${term}`).toBeLessThan(flags.indexOf(false));
      }
      expect(compatible("ERS").rows[0].product_name).toBe("Crownix Report & ERS");
      expect(compatible("EP").rows[0].product_name).toMatch(/(^|[^A-Za-z])EP([^A-Za-z]|$)/);
    });

    it('"Tibero 7" 은 제품 버전 표기가 "Tibero v7" 인 행을 맨 앞에 돌려준다', () => {
      // 숫자뿐인 검색어에는 낱말의 처음에서 일치했는지를 따지지 않는다. 따지면 'v' 바로 뒤의 7 은 낱말의 처음이 아니라서,
      // 설명에 날짜 '2017. 7. 14' 가 적혔을 뿐인 다른 버전의 행이 Tibero v7 보다 앞에 온다
      const result = compatible("Tibero 7");
      expect(result.matchMode).toBe("all-terms");
      expect(result.terms).toEqual({ used: ["Tibero", "7"], ignored: [], dropped: [], required: 2 });
      expect(result.total).toBeGreaterThan(1);
      expect(result.rows[0]).toMatchObject({ product_name: "Tibero", product_version: "Tibero v7" });
    });

    it('전각으로 입력한 "ＣＭＳ" 는 "CMS" 와 같은 건수를 돌려준다', () => {
      const half = compatible("CMS");
      const full = compatible("ＣＭＳ");
      expect(full.total).toBe(half.total);
      expect(full.total).toBeGreaterThan(0);
      expect(rowKeys(full)).toEqual(rowKeys(half));
      // 전각 숫자와 전각 공백도 같다
      expect(compatible("ＪＥＵＳ\u3000２１").total).toBe(compatible("JEUS 21").total);
    });

    it('업체명의 뒤쪽에 든 "소프트" 로 그 낱말이 든 모든 행을 찾는다', () => {
      const result = compatible("소프트");
      expect(result.matchMode).toBe("all-terms");
      const contains = (value: string | undefined) => (value ?? "").includes("소프트");
      expect(
        result.rows.every((row) =>
          [row.product_name, row.product_version, row.vendor, row.category, row.description].some(contains),
        ),
      ).toBe(true);
      // 낱말 단위 접두 일치로는 '소프트' 로 시작하는 낱말이 든 세 행만 나왔다
      expect(result.total).toBeGreaterThan(3);
      expect(result.rows.some((row) => row.vendor.includes("티맥스소프트"))).toBe(true);
    });

    it("필터를 함께 줘도 군말이 붙은 query 가 0건이 되지 않는다", () => {
      const filters = { frameworkVersion: "4.3" };
      const cms = compatible("CMS", filters);
      const result = compatible("CMS 추천", filters);
      expect(cms.total).toBeGreaterThan(0);
      expect(rowSet(result)).toEqual(rowSet(cms));
      expect(result.rows.every((row) => row.framework_version === "4.3")).toBe(true);
    });

    it("검색어가 프레임워크 버전과 같으면 설명에 그 버전이 적혀 있지 않은 행도 찾는다", () => {
      // 프레임워크 3.7 의 행 가운데에는 설명에 '3.7' 이 적혀 있지 않은 행이 있다. 부분 문자열로만 찾던 때에는 그 행이 빠졌다
      const byFilter = sqlite.queryCompatibleSoftware({ filters: { frameworkVersion: "3.7" } });
      const unlabelled = byFilter.rows.filter(
        (row) =>
          ![row.product_name, row.product_version, row.vendor, row.category, row.description].some((value) =>
            (value ?? "").includes("3.7"),
          ),
      );
      expect(unlabelled.length).toBeGreaterThan(0);

      for (const query of ["3.7", "v3.7", "3.7.0"]) {
        const result = compatible(query);
        expect(result.matchMode, `query=${query}`).toBe("all-terms");
        expect(rowKeys(result), `query=${query}`).toEqual(expect.arrayContaining(rowKeys(byFilter)));
      }
    });

    it('"eGovFrame 4.3 호환 CMS" 는 프레임워크 4.3 의 CMS Solution 행을 돌려준다', () => {
      // 'eGovFrame' 을 검색어로 쓰던 때에는 네 검색어가 모두 든 행이 없어 대체 검색(300건 남짓)이 되었고,
      // 제품명에 eGovframe 이 든 다른 프레임워크 버전의 제품이 맨 앞에 왔다
      const result = compatible("eGovFrame 4.3 호환 CMS");
      expect(result.matchMode).toBe("all-terms");
      expect(result.terms).toEqual({ used: ["4.3", "호환", "CMS"], ignored: [], dropped: ["eGovFrame"], required: 3 });
      // 'eGovFrame' 을 적지 않은 query 와 행도 순서도 같다
      expect(rowKeys(result)).toEqual(rowKeys(compatible("4.3 호환 CMS")));

      const cms43 = sqlite.queryCompatibleSoftware({ filters: { frameworkVersion: "4.3", category: "CMS Solution" } });
      expect(cms43.total).toBeGreaterThan(0);
      expect(result.rows.filter((row) => row.framework_version === "4.3").map(keyOf).sort()).toEqual(rowSet(cms43));
      // 프레임워크 4.3 이 아닌 행은 설명의 확인일자에서 '4.3' 이 부분 문자열로 일치한 행뿐이다
      // (2026-11-24 의 데이터에서는 '2026.04.30' 인 OSE CMS 1.0 한 행. KNOWN_ISSUES 의 KW-15)
      const others = result.rows.filter((row) => row.framework_version !== "4.3");
      expect(others.every((row) => row.category === "CMS Solution" && /\d{4}\.04\.3/.test(row.description ?? ""))).toBe(true);
      expect(result.rows.some((row) => /egovframe/i.test(row.product_name))).toBe(false);
      // 한글로 적어도, 조사가 붙어도 같다
      for (const query of ["전자정부 표준프레임워크 4.3 호환 CMS", "eGovFrame에서 4.3 호환 CMS"]) {
        expect(rowKeys(compatible(query)), `query=${query}`).toEqual(rowKeys(result));
      }
    });

    it("제품명에 eGovframe 이 든 제품은 그 낱말만으로도, 제품명 전체로도 찾는다", () => {
      // 프레임워크 자체를 가리키는 낱말은 다른 검색어가 남을 때만 뺀다
      const alone = compatible("eGovframe");
      expect(alone.matchMode).toBe("all-terms");
      expect(alone.terms).toEqual({ used: ["eGovframe"], ignored: [], dropped: [], required: 1 });
      expect(alone.total).toBeGreaterThan(0);
      expect(alone.rows.every((row) => /egovframe/i.test(`${row.product_name} ${row.description ?? ""}`))).toBe(true);

      const named = alone.rows.find((row) => row.product_name === "DL-WCMS for eGovframe");
      expect(named).toBeDefined();
      const full = compatible("DL-WCMS for eGovframe");
      expect(full.matchMode).toBe("all-terms");
      expect(full.terms).toEqual({ used: ["DL-WCMS"], ignored: [], dropped: ["for", "eGovframe"], required: 1 });
      expect(full.rows.every((row) => row.product_name === "DL-WCMS for eGovframe")).toBe(true);
      expect(full.total).toBeGreaterThan(0);
    });

    it("제품명에 프레임워크를 가리키는 낱말이 든 제품은 다른 검색어와 함께 적어도 맨 앞에 온다", () => {
      // 'eGov' 를 다른 검색어가 있으면 일치 여부와 관계없이 빼기만 하던 때에는 "eGov CMS" 가 CMS 가 든 300건 남짓을
      // 확인일자 순으로 돌려줘, 제품명에 eGov 가 든 제품(MC@CMS eGov, DL-WCMS for eGovframe)이 40번째 뒤로 밀렸다
      // 'eGov' 는 설명에만 든 행(2026-11-24 의 데이터에서는 enView, ZCMS 모바일플러스)도 찾지만, 제품명에 든 행이 앞이다
      const egov = compatible("eGov");
      expect(egov.matchMode).toBe("all-terms");
      const named = egov.rows.filter((row) => /egov/i.test(row.product_name));
      expect(named.length).toBeGreaterThan(1);
      expect(egov.rows.slice(0, named.length).every((row) => /egov/i.test(row.product_name))).toBe(true);

      const result = compatible("eGov CMS");
      expect(result.matchMode).toBe("all-terms");
      expect(result.terms).toEqual({ used: ["CMS"], ignored: [], dropped: ["eGov"], required: 1 });
      // CMS 가 든 행을 모두 돌려주되, 제품명에 eGov 가 든 행이 맨 앞이다
      expect(rowSet(result)).toEqual(rowSet(compatible("CMS")));
      expect(rowKeys(result).slice(0, named.length).sort()).toEqual(named.map(keyOf).sort());
      // 그 안에서는 이름에서 'CMS' 가 낱말의 처음에 든 MC@CMS eGov 네 행이, 'WCMS' 의 가운데에 든 DL-WCMS 보다 먼저다
      expect(result.rows.slice(0, 5).map((row) => row.product_name)).toEqual([
        "MC@CMS eGov",
        "MC@CMS eGov",
        "MC@CMS eGov",
        "MC@CMS eGov",
        "DL-WCMS for eGovframe",
      ]);

      // 다른 낱말, 버전, 프레임워크 버전과 함께 적어도 그 제품이 맨 앞이다
      const first = (query: string) => compatible(query).rows[0];
      for (const query of ["eGovframe CMS", "CMS for eGovframe", "eGovframe v1.0", "WCMS eGovframe"]) {
        expect(first(query)?.product_name, `query=${query}`).toBe("DL-WCMS for eGovframe");
      }
      expect(first("eGov 4.2")).toMatchObject({ product_name: "MC@CMS eGov", framework_version: "4.2" });
      for (const query of ["표준프레임워크 3.7", "표준프레임워크 V1.0"]) {
        expect(first(query)?.product_name, `query=${query}`).toBe("전사개발표준프레임워크");
      }
      // "eGov 제품": 설명에 '제품' 이 든 350건 남짓 가운데, 제품명에 eGov 가 든 세 행이 앞의 세 행이다
      const products = compatible("eGov 제품");
      expect(products.total).toBeGreaterThan(100);
      expect(products.rows.slice(0, 4).map((row) => /egov/i.test(row.product_name))).toEqual([true, true, true, false]);

      // 제품명 전체를 적으면 남은 낱말이 모두 든 행 가운데 그 제품이 맨 앞이다
      const full = compatible("MC@CMS eGov");
      expect(full.terms).toEqual({ used: ["MC", "CMS"], ignored: [], dropped: ["eGov"], required: 2 });
      expect(full.rows.slice(0, 3).every((row) => row.product_name === "MC@CMS eGov")).toBe(true);
    });

    it('모든 검색어 일치만 하는 조회도 "eGov CMS" 에서 제품명에 eGov 가 든 행을 맨 앞에 둔다', () => {
      // 통합 검색(scope all)의 호환 소프트웨어 구역이 쓰는 조회다. 'eGov' 를 빼기만 하고 정렬에 쓰지 않던 때에는
      // 앞의 다섯 행이 모두 확인일자가 최근인 CMS 제품이었고, 제품명에 eGov 가 든 행은 그 안에 하나도 없었다
      // 제품명에 eGov 가 든 행만 센다 ('eGov' 는 설명에만 든 행도 찾는다)
      const named = compatible("eGov").rows.filter((row) => /egov/i.test(row.product_name));
      expect(named.length).toBeGreaterThan(1);
      const limit = named.length + 1;
      const { rows, total } = sqlite.queryCompatibleSoftwareAllTerms("eGov CMS", limit);
      expect(total).toBe(compatible("CMS").total);
      expect(rows).toHaveLength(limit);
      expect(rows.map((row) => /egov/i.test(row.product_name))).toEqual([...named.map(() => true), false]);
      // 조회(queryCompatibleSoftware)가 돌려주는 앞의 행들과 같은 행, 같은 순서다
      expect(rows.map(keyOf)).toEqual(rowKeys(compatible("eGov CMS")).slice(0, limit));
    });

    it('"eGov OR JEUS" 는 JEUS 행과 제품명에 eGov 가 든 행을 모두 돌려준다', () => {
      // OR 가 있어도 'eGov' 를 빼던 때에는 JEUS 세 행만 나왔다
      const either = compatible("eGov OR JEUS");
      expect(either.matchMode).toBe("any-term");
      expect(either.terms).toEqual({ used: ["eGov", "JEUS"], ignored: [], dropped: [], required: 1, orQuery: true });
      const union = new Set([...rowKeys(compatible("eGov")), ...rowKeys(compatible("JEUS"))]);
      expect(rowSet(either)).toEqual([...union].sort());
      expect(either.total).toBeGreaterThan(compatible("JEUS").total);
    });

    it("대상 낱말을 빼면 한 행도 찾지 못하거나 한 글자 검색어만 남는 query 는 대상 낱말로 찾는다", () => {
      // "eGovFrame 8" 은 'eGovFrame' 을 빼고 '8' 한 글자가 든 115건을, "eGovFrame compatible software" 는 0건을 돌려줬다
      const named = compatible("eGovFrame");
      expect(named.total).toBeGreaterThan(0);
      // 2026-11-24 의 데이터에서는 eGovFrame 이 든 행 하나(enView)의 설명에 '8' 이 있어 "eGovFrame 8" 이 그 행을
      // 모든 검색어 일치로 찾으므로, eGovFrame 이 든 어느 행에도 없는 한 글자 'Q' 로 시험한다
      const single = compatible("eGovFrame Q");
      expect(rowKeys(single)).toEqual(rowKeys(named));
      expect(single.terms).toEqual({ used: ["eGovFrame"], ignored: [], dropped: ["Q"], required: 1 });
      const sentence = compatible("eGovFrame compatible software");
      expect(rowKeys(sentence)).toEqual(rowKeys(named));
      expect(sentence.terms).toEqual({
        used: ["eGovFrame"],
        ignored: ["compatible", "software"],
        dropped: [],
        required: 1,
      });
    });

    it('"in S" 는 영어 기능어를 빼지 않고 두 낱말이 모두 든 행을 돌려준다', () => {
      // 'in' 을 빼던 때에는 'S' 한 글자가 든 460건 남짓이 나와, 제품 in_S 가 180번째였다
      const result = compatible("in S");
      expect(result.matchMode).toBe("all-terms");
      expect(result.terms).toEqual({ used: ["in", "S"], ignored: [], dropped: [], required: 2 });
      expect(result.total).toBeLessThanOrEqual(compatible("in").total);
      // 두 낱말이 모두 이름의 낱말 처음에 든 행이 앞에 온다. in_S 는 앞의 다섯 행 안에 든다
      expect(result.rows.slice(0, 5).some((row) => row.product_name === "in_S")).toBe(true);

      // "I ON" 도 같다: 'ON' 을 빼던 때에는 'I' 가 든 450건 남짓이 나와 I-ON Content Server 가 27번째였다
      const ion = compatible("I ON");
      expect(ion.terms).toEqual({ used: ["I", "ON"], ignored: [], dropped: [], required: 2 });
      expect(ion.rows[0].product_name).toBe("I-ON Content Server");
    });

    it('분류 이름 "WAS" 는 영어 기능어로 빼지 않는다', () => {
      // 'was' 를 영어 기능어로 보면 분류 이름이 검색어에서 빠져, 남은 낱말만으로 찾게 된다
      const was = compatible("WAS");
      expect(was.total).toBeGreaterThan(0);
      for (const query of ["국산 WAS", "WAS 추천해줘", "which WAS is compatible"]) {
        const result = compatible(query);
        expect(result.terms?.used, `query=${query}`).toEqual(["WAS"]);
        expect(rowKeys(result), `query=${query}`).toEqual(rowKeys(was));
      }
      expect(compatible("which WAS is compatible").terms?.dropped).toEqual(["which", "is"]);

      // 프레임워크 자체를 가리키는 낱말을 빼고 나면 4.3·호환·WAS 가 모두 든 행을 찾는다
      const sentence = compatible("전자정부 4.3 호환 WAS");
      expect(sentence.matchMode).toBe("all-terms");
      expect(sentence.terms?.dropped).toEqual(["전자정부"]);
      expect(sentence.total).toBeGreaterThan(0);
      expect(sentence.rows.every((row) => row.framework_version === "4.3" && row.category === "WAS")).toBe(true);
    });

    it('"2025" 는 2025년에 확인된 행을 모두 돌려준다', () => {
      const everyRow = sqlite.queryCompatibleSoftware().rows;
      const verifiedIn2025 = everyRow.filter((row) => row.verified_date.startsWith("2025"));
      // 확인일자를 견주지 않던 때에는 제품 버전 표기에 '2025' 가 든 한 행만 나왔다
      expect(verifiedIn2025.length).toBeGreaterThan(1);

      const result = compatible("2025");
      expect(result.matchMode).toBe("all-terms");
      // 2025년에 확인된 행과, 다른 검색 컬럼에 '2025' 가 적힌 행이 전부다.
      // (이 테스트를 쓴 시점의 동봉 데이터에서는 59건이고, 59건 모두 2025년에 확인된 행이다.)
      const inText = (row: CompatibilitySoftwareInfo) =>
        [row.product_name, row.product_version, row.vendor, row.category, row.description].some((value) =>
          (value ?? "").includes("2025"),
        );
      const expected = everyRow.filter((row) => row.verified_date.startsWith("2025") || inText(row));
      expect(rowSet(result)).toEqual(expected.map(keyOf).sort());
      expect(result.total).toBe(expected.length);
    });

    it('"2024-11" 처럼 연-월로 적으면 그 달에 확인된 행을 돌려준다', () => {
      const result = compatible("2024-11");
      expect(result.matchMode).toBe("all-terms");
      expect(result.total).toBeGreaterThan(0);
      expect(result.rows.every((row) => row.verified_date.startsWith("2024-11"))).toBe(true);
      // 그 달에 확인된 행은 하나도 빠지지 않는다
      const sameMonth = sqlite.queryCompatibleSoftware().rows.filter((row) => row.verified_date.startsWith("2024-11"));
      expect(result.total).toBe(sameMonth.length);
    });

    it("vendor 필터는 법인 표기가 달라도 같은 업체의 행을 모두 돌려준다", () => {
      const byVendor = (vendor: string) => sqlite.queryCompatibleSoftware({ filters: { vendor } });
      // 같은 업체가 '(주)아이액츠', '㈜아이액츠', '주식회사 아이액츠' 세 표기로 들어 있다.
      // 글자 그대로 비교하던 때에는 표기마다 건수가 달랐다 (이 테스트를 쓴 시점에 3건, 1건, 2건이고 합쳐 6건이다)
      const bare = byVendor("아이액츠");
      const spellings = [...new Set(bare.rows.map((row) => row.vendor))];
      expect(spellings.length).toBeGreaterThan(1);

      for (const vendor of [...spellings, "(주)아이액츠", "㈜아이액츠", "주식회사 아이액츠", "아이액츠(주)"]) {
        const result = byVendor(vendor);
        expect(result.total, `vendor=${vendor}`).toBe(bare.total);
        expect(rowSet(result), `vendor=${vendor}`).toEqual(rowSet(bare));
      }
      // 키워드 검색과 함께 줘도 같다
      expect(compatible("Smart", { vendor: "㈜아이액츠" }).total).toBe(compatible("Smart", { vendor: "아이액츠" }).total);
    });

    it("이름에 검색어가 든 행을 확인일자가 최근인 순으로 먼저 돌려준다", () => {
      const firstPage = sqlite.queryCompatibleSoftware({ query: "CMS", limit: 20 }).rows;
      expect(firstPage).toHaveLength(20);
      const inName = (row: { product_name: string; product_version: string }) =>
        /cms/i.test(row.product_name) || /cms/i.test(row.product_version);
      expect(firstPage.every(inName)).toBe(true);
      const dates = firstPage.map((row) => row.verified_date);
      expect(dates).toEqual([...dates].sort().reverse());
    });
  });

  it("조회는 DB 파일을 바꾸지 않고 부속 파일(-wal, -shm)도 만들지 않는다", () => {
    expect(sha256(DB_PATH)).toBe(hashBefore);
    expect(fs.readdirSync(KNOWLEDGE_BASE_DIR).sort()).toEqual(filesBefore);
  });
});
