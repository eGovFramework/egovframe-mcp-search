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
 * - 두세 글자 영문 검색어가 다른 낱말 속에서 일치한 행이, 낱말로 일치한 행보다 앞에 왔다 ("ECM Solution", "ERS",
 *   컴포넌트 ID "ist").
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
      // 컴포넌트 ID 는 'sts-com', 'blog-management' 이고 이름은 'Web Messenger' 다. 다른 기호로 이으면 0건이었다
      const cases: Array<[string, string, string[]]> = [
        ["sts_com", "sts-com", ["sts", "com"]],
        ["blog_management", "blog-management", ["blog", "management"]],
        ["Web-Messenger", "msg", ["Web", "Messenger"]],
      ];
      for (const [query, id, pieces] of cases) {
        const result = sqlite.queryComponents({ query });
        expect(result.matchMode, `query=${query}`).toBe("any-term");
        expect(result.terms, `query=${query}`).toEqual({ used: pieces, ignored: [], dropped: [], required: 1 });
        expect(idsOf(result.rows)[0], `query=${query}`).toBe(id);
      }
      // 조각 'com' 은 모든 패키지명에 든 흔한 낱말이다. 그것만 일치한 컴포넌트는 나오지 않는다
      const stats = sqlite.queryComponents({ query: "sts_com" });
      expect(idsOf(stats.rows).sort()).toEqual(idsOf(sqlite.queryComponents({ query: "sts" }).rows).sort());
      expect(stats.total).toBeLessThan(sqlite.queryComponents({ query: "com" }).total);
      // 저장된 표기 그대로 적으면 나누지 않는다
      for (const id of ["sts-com", "blog-management"]) {
        const exact = sqlite.queryComponents({ query: id });
        expect(idsOf(exact.rows), `query=${id}`).toEqual([id]);
        expect(exact.matchMode, `query=${id}`).toBe("all-terms");
      }
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

    it('"Q&A" 는 두 글자가 모두 낱말의 처음에 든 컴포넌트를 앞에 돌려준다', () => {
      // 'Q' 와 'A' 가 어딘가에 든 컴포넌트는 서른 개가 넘는다. 낱말의 처음에서 일치했는지를 가리지 않던 때에는
      // Q&A관리(qna)가 이름이 더 짧은 컴포넌트들에 밀려 여섯 번째였다
      const result = sqlite.queryComponents({ query: "Q&A" });
      expect(result.matchMode).toBe("all-terms");
      expect(result.terms).toEqual({ used: ["Q", "A"], ignored: [], dropped: [], required: 2 });
      const ids = idsOf(result.rows);
      // 두 글자가 모두 낱말의 처음에 든 컴포넌트는 여럿이고(설문조사는 ID 'qri' 와 영문 설명의 'answering'),
      // 그 안에서는 이름이 짧은 순이다. Q&A관리는 앞의 두 건 안에 들고, 'Q' 가 낱말의 가운데에 든 FAQ관리보다 앞이다
      expect(ids.slice(0, 2)).toContain("qna");
      expect(ids).toContain("faq");
      expect(ids.indexOf("qna")).toBeLessThan(ids.indexOf("faq"));
      // '관리' 를 함께 적으면 세 검색어가 모두 이름에 든 Q&A관리가 맨 앞이다
      expect(idsOf(sqlite.queryComponents({ query: "Q&A 관리" }).rows)[0]).toBe("qna");
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
      // 제품명이 낱말로 일치한 Tibero 행이 맨 앞이다. 이름에 '4.3' 이 든 다른 제품(확인일자가 더 최근이다)이 앞서지 않는다
      const tibero = compatible("Tibero");
      expect(rowKeys(result).slice(0, tibero.total)).toEqual(rowKeys(tibero));
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
      // "티맥스 제품 목록" 이 350건 남짓이 되고 티맥스 다섯 행 가운데 둘이 300번째 뒤로 밀렸다
      const cases: Array<[string, string]> = [
        ["티맥스 제품 목록", "티맥스"],
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
      // 티맥스 제품만 나온다
      expect(compatible("티맥스 제품 목록").rows.every((row) => row.vendor.includes("티맥스"))).toBe(true);
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
      expect(versions).not.toContain("JEUS 21");
      expect(result.total).toBeLessThan(compatible("JEUS").total);
    });

    it("기호로 이은 낱말이 저장된 표기와 달라도 찾는다", () => {
      // 저장된 표기는 'K2Web Wizard' 다. 'K2Web-Wizard' 는 어느 행에도 부분 문자열로 들어 있지 않아 0건이었다
      const stored = compatible("K2Web Wizard");
      expect(stored.matchMode).toBe("all-terms");
      expect(stored.total).toBeGreaterThan(0);
      const joined = compatible("K2Web-Wizard");
      expect(joined.matchMode).toBe("any-term");
      expect(joined.terms).toEqual({ used: ["K2Web", "Wizard"], ignored: [], dropped: [], required: 1 });
      // 두 조각이 모두 든 행(K2Web Wizard)이 앞에 오고, 한 조각만 든 행이 뒤따른다
      expect(rowKeys(joined).slice(0, stored.total).sort()).toEqual(rowSet(stored));

      // 'SCP-SmartUI' 를 다른 기호로 이어도 같은 행을 찾는다
      expect(rowSet(compatible("SCP_SmartUI"))).toEqual(rowSet(compatible("SCP-SmartUI")));
      // 한 글자 조각은 쓰지 않는다: 'JEUS-8' 은 JEUS 행들이다
      const jeus = compatible("JEUS");
      for (const query of ["JEUS-8", "JEUS_8", "JEUS.8"]) {
        const result = compatible(query);
        expect(rowKeys(result), `query=${query}`).toEqual(rowKeys(jeus));
        expect(result.terms?.used, `query=${query}`).toEqual(["JEUS"]);
      }
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
      expect(rowSet(result)).toEqual(rowSet(cms43));
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
