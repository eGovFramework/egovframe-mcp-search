/**
 * SQLiteManager 호환 소프트웨어 조회 단위 테스트
 *
 * 키워드 조회(queryCompatibleSoftware)의 동작을 고정한다.
 * 임시 디렉토리의 새 DB 만 사용한다 (knowledge-base/egovframe.db 에 의존하지 않음).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SQLiteManager } from "../../src/database/sqliteManager.js";
import { CATALOGUE, DATED, SAME_DAY, versionsOf, type SoftwareSeed } from "./_compatibilityFixture.js";
import { connectionOf, orderByClausesOf, statementsOf } from "./_sqlStatements.js";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";

describe("SQLiteManager 호환 소프트웨어 조회", () => {
  let tmpDir: string;
  let sqlite: SQLiteManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "egov-compat-query-"));
    sqlite = new SQLiteManager(path.join(tmpDir, "egovframe.db"));
    sqlite.addCompatibilitySoftwareBatch(CATALOGUE);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    sqlite.close();
    await fs.remove(tmpDir);
  });

  describe("1단계: 모든 검색어가 부분 문자열로 일치하는 행 (all-terms)", () => {
    it("모든 검색어가 일치하는 행이 있으면 그 행만 돌려주고 matchMode 는 all-terms 다", () => {
      const result = sqlite.queryCompatibleSoftware({ query: "JEUS" });
      expect(versionsOf(result.rows)).toEqual(["JEUS 21", "JEUS 8.5"]);
      expect(result.total).toBe(2);
      expect(result.matchMode).toBe("all-terms");
    });

    it("낱말의 가운데나 뒤쪽에 든 검색어도 찾는다", () => {
      // 낱말 단위 접두 일치로는 '한국오라클' 의 '오라클', '티맥스소프트' 의 '소프트', 'WebLogic' 의 'logic' 을 찾지 못했다
      const cases: Array<[string, string[]]> = [
        ["오라클", ["WebLogic 12c"]],
        ["소프트", ["JEUS 21", "JEUS 8.5"]],
        ["logic", ["WebLogic 12c"]],
        ["맥스", ["JEUS 21", "Tibero 7", "JEUS 8.5"]],
      ];
      for (const [query, expected] of cases) {
        const result = sqlite.queryCompatibleSoftware({ query });
        expect(versionsOf(result.rows), `query=${query}`).toEqual(expected);
        expect(result.matchMode, `query=${query}`).toBe("all-terms");
      }
    });

    it("많은 행에 들어 있는 검색어도 그대로 쓴다", () => {
      // '프레임워크'('표준프레임워크' 의 뒤쪽)와 '호환' 은 여섯 행 모두의 설명에 들어 있다
      for (const query of ["프레임워크", "호환 프레임"]) {
        const result = sqlite.queryCompatibleSoftware({ query });
        expect(result.total, `query=${query}`).toBe(CATALOGUE.length);
        expect(result.matchMode, `query=${query}`).toBe("all-terms");
      }
    });

    it("제품명·제품 버전 표기·업체명·분류·설명에 부분 문자열로 든 검색어를 찾는다", () => {
      const found = (query: string) => versionsOf(sqlite.queryCompatibleSoftware({ query }).rows);
      expect(found("WebLog")).toEqual(["WebLogic 12c"]); // product_name
      expect(found("12c")).toEqual(["WebLogic 12c"]); // product_version 에만 있다
      expect(found("샘플벤")).toEqual(["SampleCMS 1.0"]); // vendor
      expect(found("DBMS")).toEqual(["Tibero 7"]); // category
      // '워크' 는 여섯 행 모두의 설명('표준프레임워크 …')에만 있다
      expect(found("워크")).toHaveLength(CATALOGUE.length); // description
    });

    it("제품 버전 표기에 든 검색어로 그 버전의 행을 가려낸다", () => {
      // 'JEUS 21' 의 '21' 은 product_version 에만 있다
      const result = sqlite.queryCompatibleSoftware({ query: "JEUS 21" });
      expect(versionsOf(result.rows)).toEqual(["JEUS 21"]);
      expect(result.matchMode).toBe("all-terms");
    });

    it("여러 검색어는 서로 다른 컬럼에 들어 있어도 모두 일치하는 행만 돌려준다", () => {
      // 티맥스: 업체명(JEUS 두 행, Tibero) / 4.0: 설명(JEUS 8.5, Tibero)
      const result = sqlite.queryCompatibleSoftware({ query: "티맥스 4.0" });
      expect(versionsOf(result.rows)).toEqual(["Tibero 7", "JEUS 8.5"]);
      expect(result.matchMode).toBe("all-terms");
      // 맥스 JEUS: Tibero 는 '맥스' 만 일치하므로 나오지 않는다
      expect(versionsOf(sqlite.queryCompatibleSoftware({ query: "맥스 JEUS" }).rows)).toEqual(["JEUS 21", "JEUS 8.5"]);
    });

    it("영문자의 대소문자를 가리지 않는다", () => {
      expect(versionsOf(sqlite.queryCompatibleSoftware({ query: "jeus" }).rows)).toEqual(["JEUS 21", "JEUS 8.5"]);
      expect(versionsOf(sqlite.queryCompatibleSoftware({ query: "WEBLOGIC 12C" }).rows)).toEqual(["WebLogic 12c"]);
    });

    it("검색어의 LIKE 와일드카드는 글자 그대로 비교한다", () => {
      // '_' 가 와일드카드였다면 'WAS' 가 일치했을 것. 글자 그대로는 어느 행에도 없고,
      // 유연한 꼴('W S', 'WS')도 '_' 자리에 영문자가 온 'WAS' 와는 일치하지 않는다
      expect(sqlite.queryCompatibleSoftware({ query: "W_S" }).rows).toEqual([]);
      // '티맥_소프트' 도 '티맥스소프트' 와 일치하지 않는다 ('_' 자리에 한글 '스' 가 왔다)
      const literal = sqlite.queryCompatibleSoftware({ query: "티맥_소프트" });
      expect(literal.rows).toEqual([]);
      expect(literal.terms).toEqual({ used: [], ignored: ["티맥_소프트"], dropped: [], required: 0 });
      // '%' 는 구분자라 검색어에 남지 않는다 ('맥' 과 '소프트' 두 검색어가 되고, 둘 다 든 행은 JEUS 두 행이다)
      expect(versionsOf(sqlite.queryCompatibleSoftware({ query: "맥%소프트" }).rows)).toEqual(["JEUS 21", "JEUS 8.5"]);
    });

    it("limit 과 total 은 일치한 전체 행을 기준으로 한다", () => {
      const result = sqlite.queryCompatibleSoftware({ query: "맥스", limit: 1 });
      expect(versionsOf(result.rows)).toEqual(["JEUS 21"]);
      expect(result.total).toBe(3);
    });

    it("FTS5 인덱스를 읽지 않는다 (인덱스가 없어도 같은 결과를 돌려준다)", () => {
      // 1단계에서 끝나는 조회와 2단계까지 가는 조회 모두 FTS5 표를 읽지 않는다
      for (const query of ["JEUS 티맥스", "JEUS Tibero 없는말은"]) {
        const statements = statementsOf(sqlite, () => sqlite.queryCompatibleSoftware({ query }));
        expect(statements.length, `query=${query}`).toBeGreaterThan(0);
        expect(statements.filter((sql) => /MATCH|_fts/i.test(sql)), `query=${query}`).toEqual([]);
      }

      const before = sqlite.queryCompatibleSoftware({ query: "JEUS 티맥스" });
      connectionOf(sqlite).exec("DROP TABLE compatibility_fts");
      const after = sqlite.queryCompatibleSoftware({ query: "JEUS 티맥스" });
      expect(versionsOf(after.rows)).toEqual(["JEUS 21", "JEUS 8.5"]);
      expect(after).toEqual(before);
    });

    it("조회 중 오류는 결과 없음으로 가리지 않고 그대로 던진다", () => {
      connectionOf(sqlite).exec("DROP TABLE compatibility_software");
      expect(() => sqlite.queryCompatibleSoftware({ query: "JEUS" })).toThrow(/compatibility_software/);
    });
  });

  describe("프레임워크 버전과 확인일자로 찾기", () => {
    /** 프레임워크 버전은 4.3 이지만 다른 컬럼 어디에도 '4.3' 이 적혀 있지 않은 행 */
    const UNLABELLED_43: SoftwareSeed = {
      ...CATALOGUE[4],
      product_name: "NoVersionText",
      product_version: "NoVersionText 1.0",
      description: "설명 없음",
    };

    it("검색어가 프레임워크 버전과 같으면 설명에 버전이 적혀 있지 않은 행도 찾는다", () => {
      sqlite.addCompatibilitySoftwareBatch([UNLABELLED_43]);
      // 세 행 모두 이름에는 '4.3' 이 없어 확인일자 순이고, 확인일자가 같은 두 행은 적재 순이다
      const result = sqlite.queryCompatibleSoftware({ query: "4.3" });
      expect(versionsOf(result.rows)).toEqual(["JEUS 21", "SampleCMS 1.0", "NoVersionText 1.0"]);
      expect(result.total).toBe(3);
      expect(result.matchMode).toBe("all-terms");
    });

    it("앞에 v 를 붙였거나 패치 자리까지 적은 검색어도 같은 프레임워크 버전의 행을 찾는다", () => {
      sqlite.addCompatibilitySoftwareBatch([UNLABELLED_43]);
      // frameworkVersion 필터와 같은 정규화를 거친다: 'v4.3', '4.3.0' → '4.3'
      for (const query of ["v4.3", "V4.3", "4.3.0", "v4.3.1"]) {
        const result = sqlite.queryCompatibleSoftware({ query });
        expect(versionsOf(result.rows), `query=${query}`).toEqual(["JEUS 21", "SampleCMS 1.0", "NoVersionText 1.0"]);
        expect(result.matchMode, `query=${query}`).toBe("all-terms");
      }
    });

    it("프레임워크 버전은 부분 문자열로 견주지 않는다", () => {
      // 프레임워크 3.10 의 행. 다른 컬럼에는 '10' 도 '3.1' 도 없다
      sqlite.addCompatibilitySoftwareBatch([
        UNLABELLED_43,
        { ...UNLABELLED_43, product_name: "OldTool", product_version: "OldTool 2", framework_version: "3.10" },
      ]);
      expect(versionsOf(sqlite.queryCompatibleSoftware({ query: "3.10" }).rows)).toEqual(["OldTool 2"]);
      // 버전의 뒷부분('10')이나 앞부분('3.1')은 그 버전과 같지 않다
      expect(sqlite.queryCompatibleSoftware({ query: "10" }).rows).toEqual([]);
      expect(sqlite.queryCompatibleSoftware({ query: "3.1" }).rows).toEqual([]);
      // '.3' 에서 추출되는 검색어는 '3' 이다. 설명에 '4.3'·'3.6' 이 적힌 행은 찾지만,
      // 프레임워크 버전에만 3 이 든 두 행(NoVersionText, OldTool)은 찾지 않는다
      expect(versionsOf(sqlite.queryCompatibleSoftware({ query: ".3" }).rows)).toEqual([
        "JEUS 21",
        "SampleCMS 1.0",
        "WebLogic 12c",
      ]);
    });

    it("YYYY, YYYY-MM, YYYY-MM-DD 꼴의 검색어는 확인일자가 그 값으로 시작하는 행을 찾는다", () => {
      // OtherCMS 의 확인일자가 2023-03-03 이다. 다른 컬럼에는 '2023' 이 없다
      for (const query of ["2023", "2023-03", "2023-03-03"]) {
        const result = sqlite.queryCompatibleSoftware({ query });
        expect(versionsOf(result.rows), `query=${query}`).toEqual(["OtherCMS 2.0"]);
        expect(result.matchMode, `query=${query}`).toBe("all-terms");
      }
      // 2022년에 확인된 행은 둘이고, 그 가운데 11월은 하나다
      expect(versionsOf(sqlite.queryCompatibleSoftware({ query: "2022" }).rows)).toEqual(["Tibero 7", "JEUS 8.5"]);
      expect(versionsOf(sqlite.queryCompatibleSoftware({ query: "2022-11" }).rows)).toEqual(["JEUS 8.5"]);
      // 일자가 다르면 일치하지 않는다
      expect(sqlite.queryCompatibleSoftware({ query: "2023-03-04" }).rows).toEqual([]);
    });

    it("날짜 꼴이 아닌 검색어는 확인일자와 견주지 않는다", () => {
      // 확인일자(2019-03-21)에만 '03'·'21' 이 든 행
      sqlite.addCompatibilitySoftwareBatch([
        { ...UNLABELLED_43, product_name: "DateOnly", product_version: "DateOnly 5", verified_date: "2019-03-21" },
      ]);
      expect(sqlite.queryCompatibleSoftware({ query: "03" }).rows).toEqual([]);
      // '21' 은 제품 버전 표기 'JEUS 21' 과만 일치한다. 확인일자 2019-03-21, 2025-08-21 의 일자와는 견주지 않는다
      expect(versionsOf(sqlite.queryCompatibleSoftware({ query: "21" }).rows)).toEqual(["JEUS 21"]);
      // 월·일만 적은 값, 자릿수가 다른 값, 구분자가 없거나 다른 값은 날짜 꼴이 아니다
      for (const query of ["03-21", "2019-3", "19-03-21", "20190321", "2019.03.21"]) {
        expect(sqlite.queryCompatibleSoftware({ query }).rows, `query=${query}`).toEqual([]);
      }
      // 날짜 꼴이면 그 행을 찾는다
      expect(versionsOf(sqlite.queryCompatibleSoftware({ query: "2019-03" }).rows)).toEqual(["DateOnly 5"]);
    });

    it("다른 검색어와 함께 줘도 같은 규칙으로 견준다 (all-terms)", () => {
      sqlite.addCompatibilitySoftwareBatch([UNLABELLED_43]);
      // CMS: 분류 'CMS Solution' / 4.3: 프레임워크 버전. 이름에 'CMS' 가 든 SampleCMS 가 먼저다
      const byVersion = sqlite.queryCompatibleSoftware({ query: "CMS 4.3" });
      expect(versionsOf(byVersion.rows)).toEqual(["SampleCMS 1.0", "NoVersionText 1.0"]);
      expect(byVersion.matchMode).toBe("all-terms");
      // 티맥스: 업체명 / 2022: 확인일자
      const byYear = sqlite.queryCompatibleSoftware({ query: "티맥스 2022" });
      expect(versionsOf(byYear.rows)).toEqual(["Tibero 7", "JEUS 8.5"]);
      expect(byYear.matchMode).toBe("all-terms");
    });

    it("대체 검색(any-term)과 조사를 뗀 꼴에도 같은 규칙을 적용한다", () => {
      sqlite.addCompatibilitySoftwareBatch([UNLABELLED_43]);
      // 2023: OtherCMS(확인일자) / 4.3: 세 행(프레임워크 버전) / 없는말: 0행(제외) → 하나 이상 일치하는 네 행
      const fallback = sqlite.queryCompatibleSoftware({ query: "2023 4.3 없는말" });
      expect(versionsOf(fallback.rows)).toEqual(["JEUS 21", "SampleCMS 1.0", "NoVersionText 1.0", "OtherCMS 2.0"]);
      expect(fallback.matchMode).toBe("any-term");
      expect(fallback.terms).toMatchObject({ used: ["2023", "4.3"], ignored: ["없는말"] });

      // 조사를 뗀 꼴: '4.3에서' → '4.3', 'v4.3은' → 'v4.3', '2023년에' → '2023'
      const cases: Array<[string, string, string[]]> = [
        ["4.3에서", "4.3", ["JEUS 21", "SampleCMS 1.0", "NoVersionText 1.0"]],
        ["v4.3은", "v4.3", ["JEUS 21", "SampleCMS 1.0", "NoVersionText 1.0"]],
        ["2023년에", "2023", ["OtherCMS 2.0"]],
      ];
      for (const [query, used, expected] of cases) {
        const result = sqlite.queryCompatibleSoftware({ query });
        expect(versionsOf(result.rows), `query=${query}`).toEqual(expected);
        expect(result.matchMode, `query=${query}`).toBe("any-term");
        expect(result.terms, `query=${query}`).toMatchObject({ used: [used], ignored: [] });
      }
    });

    it("일치하는 행이 있는 검색어인지는 필터를 적용한 대상 안에서 같은 규칙으로 판정한다", () => {
      // 4.3 의 행은 WAS 안에 JEUS 21 하나가 있다
      const inScope = sqlite.queryCompatibleSoftware({ query: "4.3 없는말", filters: { category: "WAS" } });
      expect(versionsOf(inScope.rows)).toEqual(["JEUS 21"]);
      expect(inScope.terms).toMatchObject({ used: ["4.3"], ignored: ["없는말"] });
      // 4.2 의 행(OtherCMS)과 2023년에 확인된 행(OtherCMS)은 WAS 안에 없다
      const outOfScope = sqlite.queryCompatibleSoftware({ query: "4.2 2023", filters: { category: "WAS" } });
      expect(outOfScope.rows).toEqual([]);
      expect(outOfScope.terms).toMatchObject({ used: [], ignored: ["4.2", "2023"] });
    });

    it("이름에 일치한 검색어 수는 제품명과 제품 버전 표기에서만 센다", () => {
      // 'Suite 4.3' 은 프레임워크 4.2 의 제품이지만 이름에 '4.3' 이 들어 있어, 프레임워크 버전만 4.3 인 행보다 먼저 온다
      sqlite.addCompatibilitySoftwareBatch([
        {
          ...CATALOGUE[5],
          product_name: "Suite",
          product_version: "Suite 4.3",
          verified_date: "2016-06-06",
          description: "설명 없음",
        },
      ]);
      expect(versionsOf(sqlite.queryCompatibleSoftware({ query: "4.3" }).rows)).toEqual([
        "Suite 4.3",
        "JEUS 21",
        "SampleCMS 1.0",
      ]);
    });

    it("배열을 돌려주는 fullTextSearchCompatibility 도 같은 규칙으로 찾는다", () => {
      sqlite.addCompatibilitySoftwareBatch([UNLABELLED_43]);
      expect(versionsOf(sqlite.fullTextSearchCompatibility("v4.3"))).toEqual([
        "JEUS 21",
        "SampleCMS 1.0",
        "NoVersionText 1.0",
      ]);
      expect(versionsOf(sqlite.fullTextSearchCompatibility("CMS 2023"))).toEqual(["OtherCMS 2.0"]);
    });
  });

  describe("한 글자 검색어", () => {
    it("모든 검색어가 일치하는 행을 찾을 때는 한 글자 검색어도 쓴다", () => {
      // '8' 은 JEUS 8.5 의 버전 표기와 설명에만 있다. 한 글자라고 빼면 'JEUS' 만 일치하는 JEUS 21 이 함께 나온다
      const versioned = sqlite.queryCompatibleSoftware({ query: "JEUS 8" });
      expect(versionsOf(versioned.rows)).toEqual(["JEUS 8.5"]);
      expect(versioned.total).toBe(1);
      expect(versioned.matchMode).toBe("all-terms");
      expect(versioned.terms).toEqual({ used: ["JEUS", "8"], ignored: [], dropped: [], required: 2 });
    });

    it("한 글자 검색어까지 일치하는 행이 없으면 한 글자 검색어를 빼고 다시 찾는다", () => {
      // T 와 M 은 각각 세 행(Tibero, SampleCMS, OtherCMS)에 들어 있지만 '오라클' 이 든 WebLogic 에는 없다.
      // 나머지 검색어('오라클')가 모두 일치하는 행을 찾았으므로 all-terms 다
      const mixed = sqlite.queryCompatibleSoftware({ query: "T M 오라클" });
      expect(versionsOf(mixed.rows)).toEqual(["WebLogic 12c"]);
      expect(mixed.matchMode).toBe("all-terms");
      expect(mixed.terms).toEqual({ used: ["오라클"], ignored: [], dropped: ["T", "M"], required: 1 });
      // 어느 행에도 없는 한 글자 검색어도 같다 ('9' 가 든 행은 없다)
      const absent = sqlite.queryCompatibleSoftware({ query: "JEUS 9" });
      expect(versionsOf(absent.rows)).toEqual(["JEUS 21", "JEUS 8.5"]);
      expect(absent.matchMode).toBe("all-terms");
      expect(absent.terms).toEqual({ used: ["JEUS"], ignored: [], dropped: ["9"], required: 1 });
    });

    it("그래도 없으면 한 글자 검색어를 뺀 채로 대체 검색으로 넘어간다", () => {
      // 오라클(1행)과 없는말(0행)이 함께 든 행은 없다. T 와 M 을 대체 검색에 쓰면 그 글자가 든 세 행이 섞여 나온다
      const result = sqlite.queryCompatibleSoftware({ query: "T M 오라클 없는말" });
      expect(versionsOf(result.rows)).toEqual(["WebLogic 12c"]);
      expect(result.total).toBe(1);
      expect(result.matchMode).toBe("any-term");
      expect(result.terms).toEqual({ used: ["오라클"], ignored: ["없는말"], dropped: ["T", "M"], required: 1 });
    });

    it("모든 검색어가 한 글자이면 그대로 쓴다", () => {
      // T 와 M 이 모두 든 행: Tibero('Tibero', 'DBMS'), SampleCMS('Sample', 'Solution'), OtherCMS('Other', 'CMS')
      const result = sqlite.queryCompatibleSoftware({ query: "T M" });
      expect(versionsOf(result.rows).sort()).toEqual(["OtherCMS 2.0", "SampleCMS 1.0", "Tibero 7"]);
      expect(result.matchMode).toBe("all-terms");
      expect(versionsOf(sqlite.queryCompatibleSoftware({ query: "7" }).rows)).toEqual(["Tibero 7"]);
    });

    it("글자 수는 코드 포인트로 센다 (UTF-16 두 단위로 표현되는 한 글자도 한 글자다)", () => {
      // '𠀀', '𠀁' 는 한 글자지만 String.length 는 2 다
      expect("𠀀".length).toBe(2);
      // 두 글자가 설명에 들어 있는 행을 둔다. 두 글자를 검색어로 쓰면 '오라클' 까지 든 행이 없어
      // 2단계로 넘어가고, 세 검색어 가운데 둘이 일치하는 이 두 행이 WebLogic 대신 나온다
      sqlite.addCompatibilitySoftwareBatch(
        ["RareA", "RareB"].map((product_name) => ({
          ...CATALOGUE[5],
          product_name,
          product_version: `${product_name} 1.0`,
          description: "𠀀 𠀁 표준프레임워크 4.2 호환 확인",
        })),
      );
      const result = sqlite.queryCompatibleSoftware({ query: "𠀀 𠀁 오라클" });
      expect(versionsOf(result.rows)).toEqual(["WebLogic 12c"]);
    });
  });

  describe("가려 주지 못하는 낱말 (영어 기능어, 프레임워크 자체를 가리키는 낱말)", () => {
    const termsOf = (query: string) => sqlite.queryCompatibleSoftware({ query }).terms;

    it("영어 기능어는 검색어로 쓰지 않는다", () => {
      // 'the' 는 'OtherCMS' 의 가운데에 들어 있다. 검색어로 쓰면 JEUS 와 함께 든 행이 없어 대체 검색으로 넘어가고,
      // 'the' 만 일치하는 OtherCMS 가 JEUS 두 행과 함께 나온다
      const result = sqlite.queryCompatibleSoftware({ query: "the JEUS" });
      expect(versionsOf(result.rows)).toEqual(["JEUS 21", "JEUS 8.5"]);
      expect(result.matchMode).toBe("all-terms");
      expect(result.terms).toEqual({ used: ["JEUS"], ignored: [], dropped: ["the"], required: 1 });
    });

    it("영어 문장으로 물어도 기능어가 제품명의 일부와 일치한 행이 섞이지 않는다", () => {
      // on: 'CMS Solution' 의 끝 / as: 'WAS' 의 뒤쪽 / Is, with: 일치하는 행 없음. 넷 다 검색어로 쓰지 않는다.
      // JEUS(2행)·4.3(2행)·WAS(3행) 가운데 둘 이상이 든 행은 JEUS 두 행이다 (compatible 은 어느 행에도 없다)
      const result = sqlite.queryCompatibleSoftware({ query: "Is JEUS compatible with 4.3 on WAS?" });
      expect(versionsOf(result.rows)).toEqual(["JEUS 21", "JEUS 8.5"]);
      expect(result.matchMode).toBe("any-term");
      expect(result.terms).toEqual({
        used: ["JEUS", "4.3", "WAS"],
        ignored: ["compatible"],
        dropped: ["Is", "with", "on"],
        required: 2,
      });
    });

    it("프레임워크 자체를 가리키는 낱말은 검색어로 쓰지 않는다", () => {
      // 목록의 모든 행이 이 프레임워크에 관한 것이다. 'eGovFrame' 을 검색어로 쓰면 어느 행에도 없어 대체 검색이 되고,
      // 4.3 이나 CMS 하나만 일치하는 행까지 나온다
      const result = sqlite.queryCompatibleSoftware({ query: "eGovFrame 4.3 CMS" });
      expect(versionsOf(result.rows)).toEqual(["SampleCMS 1.0"]);
      expect(result.matchMode).toBe("all-terms");
      expect(result.terms).toEqual({ used: ["4.3", "CMS"], ignored: [], dropped: ["eGovFrame"], required: 2 });

      // 대소문자를 가리지 않고, 한글 낱말도 같다
      const cases: Array<[string, string[]]> = [
        ["EGOVFRAMEWORK JEUS", ["EGOVFRAMEWORK"]],
        ["egov JEUS", ["egov"]],
        ["전자정부 표준프레임워크 JEUS", ["전자정부", "표준프레임워크"]],
        ["전자정부표준프레임워크 전자정부프레임워크 JEUS", ["전자정부표준프레임워크", "전자정부프레임워크"]],
        // 다른 낱말과 이어 적혀 있어도 같은 것을 가리킨다 (영어 기능어와 달리 이어 적힌 낱말을 따로 가리지 않는다)
        ["전자정부/표준프레임워크 JEUS", ["전자정부", "표준프레임워크"]],
        ["eGovFrame+JEUS", ["eGovFrame"]],
      ];
      for (const [query, dropped] of cases) {
        expect(termsOf(query), `query=${query}`).toEqual({ used: ["JEUS"], ignored: [], dropped, required: 1 });
      }
    });

    it("조사가 붙은 꼴도 같다", () => {
      // 'eGovFrame에서' 는 조사를 떼면 'eGovFrame' 이다. 뺀 낱말은 query 에 적힌 꼴로 돌려준다
      const result = sqlite.queryCompatibleSoftware({ query: "eGovFrame에서 표준프레임워크의 CMS" });
      expect(versionsOf(result.rows)).toEqual(["SampleCMS 1.0", "OtherCMS 2.0"]);
      expect(result.matchMode).toBe("all-terms");
      expect(result.terms?.dropped).toEqual(["eGovFrame에서", "표준프레임워크의"]);
    });

    it("그런 낱말뿐이면 빼지 않고 그대로 찾는다", () => {
      // '표준프레임워크' 는 여섯 행 모두의 설명에 들어 있다
      const alone = sqlite.queryCompatibleSoftware({ query: "표준프레임워크" });
      expect(alone.total).toBe(CATALOGUE.length);
      expect(alone.terms).toEqual({ used: ["표준프레임워크"], ignored: [], dropped: [], required: 1 });

      // 제품명에 그 낱말이 든 제품을 그 낱말만으로 찾을 수 있어야 한다
      sqlite.addCompatibilitySoftwareBatch([
        { ...CATALOGUE[5], product_name: "DL-WCMS for eGovframe", product_version: "DL-WCMS for eGovframe v1.0" },
      ]);
      const named = sqlite.queryCompatibleSoftware({ query: "eGovframe" });
      expect(versionsOf(named.rows)).toEqual(["DL-WCMS for eGovframe v1.0"]);
      expect(named.terms).toEqual({ used: ["eGovframe"], ignored: [], dropped: [], required: 1 });
      // 다른 낱말과 함께 적으면 빼지만, 남은 낱말로 그 제품을 찾는다
      const full = sqlite.queryCompatibleSoftware({ query: "DL-WCMS for eGovframe" });
      expect(versionsOf(full.rows)).toEqual(["DL-WCMS for eGovframe v1.0"]);
      expect(full.terms).toEqual({ used: ["DL-WCMS"], ignored: [], dropped: ["for", "eGovframe"], required: 1 });
    });

    it("목록에 없는 낱말(framework, 프레임워크, solution)과 공통컴포넌트 쪽 낱말은 빼지 않는다", () => {
      // 'Framework Solution' 은 분류 이름이다. '프레임워크' 는 여섯 행 모두의 설명에 들어 있다
      expect(termsOf("프레임워크 JEUS")).toEqual({ used: ["프레임워크", "JEUS"], ignored: [], dropped: [], required: 2 });
      expect(termsOf("Solution CMS")).toEqual({ used: ["Solution", "CMS"], ignored: [], dropped: [], required: 2 });
      // '컴포넌트' 와 'framework' 는 어느 행에도 없어 대체 검색에서 쓰지 않은 검색어(ignored)가 된다
      expect(termsOf("컴포넌트 framework JEUS")).toEqual({
        used: ["JEUS"],
        ignored: ["컴포넌트", "framework"],
        dropped: [],
        required: 1,
      });
    });

    it("분류 이름 WAS 는 영어 기능어(was)로 보지 않는다", () => {
      // which, is: 영어 기능어 / compatible: 0행(제외). 'WAS' 를 빼면 남은 검색어로는 한 행도 찾지 못한다
      const result = sqlite.queryCompatibleSoftware({ query: "which WAS is compatible" });
      expect(versionsOf(result.rows)).toEqual(["JEUS 21", "JEUS 8.5", "WebLogic 12c"]);
      expect(result.terms).toEqual({ used: ["WAS"], ignored: ["compatible"], dropped: ["which", "is"], required: 1 });
      expect(termsOf("was 4.3")).toEqual({ used: ["was", "4.3"], ignored: [], dropped: [], required: 2 });
    });

    it("다른 낱말과 기호로 이어 적힌 영어 기능어는 검색어로 쓴다", () => {
      // 'on/off' 의 'on' 은 전치사가 아니다. 따로 적은 'on' 만 뺀다 ('on' 은 'CMS Solution' 의 끝에 들어 있다)
      expect(termsOf("JEUS on/off")).toEqual({ used: ["JEUS", "on"], ignored: ["off"], dropped: [], required: 1 });
      expect(termsOf("JEUS on")).toEqual({ used: ["JEUS"], ignored: [], dropped: ["on"], required: 1 });
    });

    it("쉼표나 아포스트로피로 붙여 적은 영어 기능어는 검색어로 쓰지 않는다", () => {
      // 낱말을 잇는 기호는 '&', '/', '+' 뿐이다. 'Tibero,is' 의 'is' 는 따로 적힌 영어 기능어다
      const result = sqlite.queryCompatibleSoftware({ query: "Tibero,is it ok" });
      expect(versionsOf(result.rows)).toEqual(["Tibero 7"]);
      expect(result.terms).toEqual({ used: ["Tibero"], ignored: ["ok"], dropped: ["is", "it"], required: 1 });
      // 'on' 은 'CMS Solution' 에 들어 있다. 검색어로 쓰면 그 분류의 행이 함께 나온다
      for (const query of ["JEUS,on", "JEUS(on)", "JEUS'on", "JEUS:on", '"JEUS"on']) {
        expect(termsOf(query), `query=${query}`).toEqual({ used: ["JEUS"], ignored: [], dropped: ["on"], required: 1 });
      }
    });

    it("한 글자라서 뺀 검색어와 함께 query 에 적힌 순서대로 dropped 에 싣는다", () => {
      // Is, with: 영어 기능어 / 9: JEUS 와 함께 든 행이 없는 한 글자 검색어
      const result = sqlite.queryCompatibleSoftware({ query: "Is JEUS 9 with eGovFrame" });
      expect(versionsOf(result.rows)).toEqual(["JEUS 21", "JEUS 8.5"]);
      expect(result.matchMode).toBe("all-terms");
      expect(result.terms).toEqual({ used: ["JEUS"], ignored: [], dropped: ["Is", "9", "with", "eGovFrame"], required: 1 });
    });

    it("배열을 돌려주는 메서드도 같은 낱말을 뺀다", () => {
      expect(versionsOf(sqlite.fullTextSearchCompatibility("eGovFrame 4.3 CMS"))).toEqual(["SampleCMS 1.0"]);
      expect(sqlite.queryCompatibleSoftwareAllTerms("Is the JEUS")).toMatchObject({ total: 2 });
      expect(sqlite.queryCompatibleSoftwareAllTerms("표준프레임워크")).toMatchObject({ total: CATALOGUE.length });
    });
  });

  describe("가려 주지 못하는 낱말을 빼는 조건", () => {
    /**
     * 제품명에 프레임워크 자체를 가리키는 낱말(eGovframe)이 든 제품.
     * 분류는 'CMS Solution' 이고, 확인일자는 고정 데이터의 어느 행보다도 오래됐다.
     */
    const EGOV_NAMED: SoftwareSeed = {
      ...CATALOGUE[5],
      product_name: "DL-WCMS for eGovframe",
      product_version: "DL-WCMS for eGovframe v1.0",
      verified_date: "2015-01-01",
      description: "설명 없음",
    };

    beforeEach(() => {
      sqlite.addCompatibilitySoftwareBatch([EGOV_NAMED]);
    });

    const search = (query: string, filters = {}) => sqlite.queryCompatibleSoftware({ query, filters });

    it("영어 기능어는 영어 기능어가 아닌 두 글자 이상의 낱말이 있을 때만 뺀다", () => {
      // 'on' 은 'CMS Solution' 의 끝에 들어 있다. 두 글자 이상인 다른 낱말(JEUS)이 있으면 뺀다
      expect(search("on JEUS").terms).toEqual({ used: ["JEUS"], ignored: [], dropped: ["on"], required: 1 });

      // 남는 것이 한 글자 검색어뿐이면 빼지 않는다. 빼면 그 한 글자의 부분 문자열 검색이 된다
      // ('T' 는 네 행에 들어 있고, 'on' 과 'T' 가 모두 든 행은 분류가 'CMS Solution' 인 세 행이다)
      const short = search("on T");
      expect(short.terms).toEqual({ used: ["on", "T"], ignored: [], dropped: [], required: 2 });
      expect(short.matchMode).toBe("all-terms");
      expect(versionsOf(short.rows).sort()).toEqual(["DL-WCMS for eGovframe v1.0", "OtherCMS 2.0", "SampleCMS 1.0"]);
      expect(search("T").total).toBeGreaterThan(short.total);

      // 영어 기능어뿐인 query 도 그대로 찾는다 ('as' 는 'WAS' 의 뒤쪽에 들어 있다)
      expect(search("on as").terms).toEqual({ used: ["on", "as"], ignored: [], dropped: [], required: 1 });
    });

    it("영어 기능어가 아닌 낱말이 대상 낱말뿐이어도 영어 기능어는 뺀다", () => {
      // 'the' 는 'OtherCMS' 의 가운데에 들어 있다. 빼지 않으면 OtherCMS 가 함께 나온다
      const result = search("the eGovframe");
      expect(versionsOf(result.rows)).toEqual(["DL-WCMS for eGovframe v1.0"]);
      expect(result.terms).toEqual({ used: ["eGovframe"], ignored: [], dropped: ["the"], required: 1 });
    });

    it("대상 낱말은 쓸 수 있는 다른 검색어가 있을 때만 뺀다", () => {
      // CMS 가 든 행이 있으므로 eGovframe 을 뺀다
      expect(search("eGovframe CMS").terms).toEqual({ used: ["CMS"], ignored: [], dropped: ["eGovframe"], required: 1 });

      // '없는말' 은 어느 행에도 없다. eGovframe 을 빼면 남은 검색어로는 한 행도 찾지 못하므로, 빼지 않고 검색어로 쓴다
      const kept = search("eGovframe 없는말");
      expect(versionsOf(kept.rows)).toEqual(["DL-WCMS for eGovframe v1.0"]);
      expect(kept.matchMode).toBe("any-term");
      expect(kept.terms).toEqual({ used: ["eGovframe"], ignored: ["없는말"], dropped: [], required: 1 });
    });

    it("한 글자 검색어, 영어 기능어, 다른 대상 낱말은 쓸 수 있는 다른 검색어로 세지 않는다", () => {
      // '8' 은 JEUS 8.5 에 들어 있지만 한 글자다. eGovframe 을 빼면 '8' 한 글자의 부분 문자열 검색이 된다
      const single = search("eGovframe 8");
      expect(versionsOf(single.rows)).toEqual(["DL-WCMS for eGovframe v1.0"]);
      expect(single.matchMode).toBe("all-terms");
      expect(single.terms).toEqual({ used: ["eGovframe"], ignored: [], dropped: ["8"], required: 1 });

      // 'on' 은 일치하는 행이 있지만('CMS Solution') 영어 기능어다
      const preposition = search("eGovframe on");
      expect(versionsOf(preposition.rows)).toEqual(["DL-WCMS for eGovframe v1.0"]);
      expect(preposition.terms).toEqual({ used: ["eGovframe"], ignored: [], dropped: ["on"], required: 1 });

      // '표준프레임워크' 도 대상 낱말이다 (여섯 행의 설명에 들어 있다). 두 낱말 모두 검색어로 쓴다
      expect(search("eGovframe 표준프레임워크").terms).toEqual({
        used: ["eGovframe", "표준프레임워크"],
        ignored: [],
        dropped: [],
        required: 1,
      });
    });

    it("다른 검색어를 쓸 수 있는지는 대체 검색과 같은 꼴 고르기로 판정한다 (조사를 뗀 꼴, 유연한 꼴)", () => {
      // 'JEUS는' 은 그대로는 어느 행에도 없고 조사를 뗀 'JEUS' 가 있다
      expect(search("eGovframe JEUS는").terms).toEqual({ used: ["JEUS"], ignored: [], dropped: ["eGovframe"], required: 1 });
      // 'Web-Logic' 은 유연한 꼴로 'WebLogic' 과 일치한다
      expect(search("eGovframe Web-Logic").terms).toEqual({
        used: ["Web-Logic"],
        ignored: [],
        dropped: ["eGovframe"],
        required: 1,
      });
    });

    it("다른 검색어를 쓸 수 있는지는 필터를 적용한 대상 안에서 판정한다", () => {
      expect(search("eGovframe JEUS").terms?.dropped).toEqual(["eGovframe"]);
      // JEUS 는 표에는 있지만 CMS Solution 안에는 없다. 그 안에서는 eGovframe 을 빼지 않는다
      const inCms = search("eGovframe JEUS", { category: "CMS Solution" });
      expect(versionsOf(inCms.rows)).toEqual(["DL-WCMS for eGovframe v1.0"]);
      expect(inCms.terms).toEqual({ used: ["eGovframe"], ignored: ["JEUS"], dropped: [], required: 1 });
    });

    it("대상 낱말을 뺄지 정하려고 견준 검색어는 대체 검색에서 다시 조회하지 않는다", () => {
      // 두 query 모두 검색어 둘을 한 번씩만 견준다. 'eGovframe 없는말' 은 '없는말' 을 대상 낱말을 뺄지 정할 때 이미 견줬다
      const statements = (query: string) => statementsOf(sqlite, () => search(query)).length;
      expect(statements("eGovframe 없는말")).toBe(statements("CMS 없는말"));
    });

    it("query 에 OR 가 있으면 이름 컬럼에 든 행이 있는 대상 낱말을 빼지 않는다", () => {
      // OR 가 없으면 뺀다 (JEUS 를 쓸 수 있다)
      expect(search("eGovframe JEUS").terms?.dropped).toEqual(["eGovframe"]);
      // OR 로 이으면 제품명에 eGovframe 이 든 행도 돌려준다
      const result = search("eGovframe OR JEUS");
      expect(versionsOf(result.rows)).toEqual(["JEUS 21", "JEUS 8.5", "DL-WCMS for eGovframe v1.0"]);
      expect(result.terms).toEqual({ used: ["eGovframe", "JEUS"], ignored: [], dropped: [], required: 1, orQuery: true });
      // 조사가 붙은 꼴은 목록에 있는 꼴(eGovframe)로 견준다
      expect(search("eGovframe은 OR JEUS").terms).toEqual({
        used: ["eGovframe", "JEUS"],
        ignored: [],
        dropped: [],
        required: 1,
        orQuery: true,
      });
    });

    it("이름 컬럼에 든 행이 없는 대상 낱말은 OR 가 있어도 다른 검색어를 쓸 수 있으면 뺀다", () => {
      // '표준프레임워크' 는 여섯 행의 설명에만 들어 있다. 빼지 않으면 그 여섯 행이 모두 나온다
      const result = search("표준프레임워크 OR JEUS");
      expect(versionsOf(result.rows)).toEqual(["JEUS 21", "JEUS 8.5"]);
      expect(result.terms).toEqual({ used: ["JEUS"], ignored: [], dropped: ["표준프레임워크"], required: 1, orQuery: true });

      // 이름 컬럼에 든 행이 있는지도 필터를 적용한 대상 안에서 본다: WAS 안에는 제품명에 eGovframe 이 든 행이 없다
      expect(search("eGovframe OR JEUS", { category: "WAS" }).terms).toEqual({
        used: ["JEUS"],
        ignored: [],
        dropped: ["eGovframe"],
        required: 1,
        orQuery: true,
      });

      // 다른 검색어를 쓸 수 없으면 OR 가 없을 때와 같이 빼지 않는다
      expect(search("표준프레임워크 OR 없는말").terms).toEqual({
        used: ["표준프레임워크"],
        ignored: ["없는말"],
        dropped: [],
        required: 1,
        orQuery: true,
      });
    });

    it("뺀 대상 낱말이 이름 컬럼에 든 행을 먼저 돌려준다", () => {
      // CMS 가 든 세 행은 확인일자 순이다
      expect(versionsOf(search("CMS").rows)).toEqual(["SampleCMS 1.0", "OtherCMS 2.0", "DL-WCMS for eGovframe v1.0"]);
      // 'eGovframe CMS': 제품명에 eGovframe 이 든 행은 확인일자가 가장 오래됐지만 맨 앞에 온다
      const result = search("eGovframe CMS");
      expect(result.matchMode).toBe("all-terms");
      expect(versionsOf(result.rows)).toEqual(["DL-WCMS for eGovframe v1.0", "SampleCMS 1.0", "OtherCMS 2.0"]);
      // 조사가 붙은 꼴은 목록에 있는 꼴로 견준다
      expect(versionsOf(search("eGovframe에서 CMS").rows)[0]).toBe("DL-WCMS for eGovframe v1.0");
      // 대체 검색 결과에도 같은 기준을 적용한다
      const fallback = search("eGovframe CMS 없는말");
      expect(fallback.matchMode).toBe("any-term");
      expect(versionsOf(fallback.rows)).toEqual(["DL-WCMS for eGovframe v1.0", "SampleCMS 1.0", "OtherCMS 2.0"]);
    });

    it("그 기준은 일치한 검색어 수보다 뒤서고, 낱말의 처음과 이름 컬럼의 기준보다 앞선다", () => {
      // 일치한 검색어 수: CMS 와 2024(확인일자)가 모두 일치한 SampleCMS 가 맨 앞이고,
      // 하나만 일치한 두 행 가운데에서는 제품명에 eGovframe 이 든 행이 먼저다
      const counted = search("eGovframe CMS 2024 없는말");
      expect(counted.terms).toEqual({ used: ["CMS", "2024"], ignored: ["없는말"], dropped: ["eGovframe"], required: 1 });
      expect(versionsOf(counted.rows)).toEqual(["SampleCMS 1.0", "DL-WCMS for eGovframe v1.0", "OtherCMS 2.0"]);

      const seed = (product_name: string, verified_date: string): SoftwareSeed => ({
        ...CATALOGUE[5],
        product_name,
        product_version: `${product_name} 1.0`,
        category: "기타",
        verified_date,
        description: "설명 없음",
      });
      // 낱말의 처음: 'beta' 가 이름의 낱말 가운데에 든 행('Xbeta')이, 낱말의 처음에 든 행보다 앞에 온다
      // 이름 컬럼: 'gamma' 가 설명에만 든 행이, 이름에 든 행보다 앞에 온다 (두 경우 모두 확인일자는 뒤의 행이 더 최근이다)
      sqlite.addCompatibilitySoftwareBatch([
        seed("Alpha eGovframe Xbeta", "2001-01-01"),
        seed("Beta Tool", "2030-01-01"),
        { ...seed("Delta eGovframe", "2002-01-01"), description: "gamma 를 지원" },
        seed("Gamma Tool", "2031-01-01"),
      ]);
      expect(versionsOf(search("eGovframe beta").rows)).toEqual(["Alpha eGovframe Xbeta 1.0", "Beta Tool 1.0"]);
      expect(versionsOf(search("eGovframe gamma").rows)).toEqual(["Delta eGovframe 1.0", "Gamma Tool 1.0"]);
    });

    it("뺀 대상 낱말마다 따로 세고, 같은 낱말은 한 번만 센다", () => {
      const suite = (product_name: string, verified_date: string): SoftwareSeed => ({
        ...CATALOGUE[5],
        product_name,
        product_version: `${product_name} 1.0`,
        category: "기타",
        verified_date,
        description: "스위트 제품",
      });
      sqlite.addCompatibilitySoftwareBatch([
        suite("Both eGov 전자정부", "2001-01-01"),
        suite("Only eGov", "2030-01-01"),
        suite("Only 전자정부", "2031-01-01"),
      ]);
      const expected = ["Both eGov 전자정부 1.0", "Only 전자정부 1.0", "Only eGov 1.0"];
      // 뺀 낱말 둘이 모두 이름에 든 행이, 하나만 든 행보다 먼저다 (확인일자는 그 반대 순서다).
      // 하나씩 든 두 행은 확인일자 순이다
      const two = search("eGov 전자정부 스위트");
      expect(two.terms).toEqual({ used: ["스위트"], ignored: [], dropped: ["eGov", "전자정부"], required: 1 });
      expect(versionsOf(two.rows)).toEqual(expected);
      // 같은 낱말을 조사만 달리 두 번 적어도 한 번만 센다. 두 번 세면 'eGov' 가 든 행이 '전자정부' 가 든 행보다 앞선다
      const twice = search("eGov eGov에서 전자정부 스위트");
      expect(twice.terms?.dropped).toEqual(["eGov", "eGov에서", "전자정부"]);
      expect(versionsOf(twice.rows)).toEqual(expected);
    });

    it("영어 기능어는 빼더라도 정렬에 쓰지 않는다", () => {
      // 'the' 는 'OtherCMS' 의 이름에 들어 있다. 정렬에 쓰면 OtherCMS 가 확인일자가 더 최근인 SampleCMS 보다 앞에 온다
      const result = search("the CMS");
      expect(result.terms?.dropped).toEqual(["the"]);
      expect(versionsOf(result.rows)).toEqual(["SampleCMS 1.0", "OtherCMS 2.0", "DL-WCMS for eGovframe v1.0"]);
    });

    it("모든 검색어 일치만 하는 조회(queryCompatibleSoftwareAllTerms)도 같은 규칙으로 낱말을 빼고 정렬한다", () => {
      const versions = (query: string, limit?: number) =>
        versionsOf(sqlite.queryCompatibleSoftwareAllTerms(query, limit).rows);

      // 뺀 대상 낱말이 이름 컬럼에 든 행이 맨 앞이다 (전체 건수는 limit 과 무관하다)
      expect(versions("eGovframe CMS")).toEqual(["DL-WCMS for eGovframe v1.0", "SampleCMS 1.0", "OtherCMS 2.0"]);
      expect(sqlite.queryCompatibleSoftwareAllTerms("eGovframe CMS", 1)).toMatchObject({ total: 3 });
      expect(versions("eGovframe CMS", 1)).toEqual(["DL-WCMS for eGovframe v1.0"]);
      // 대상 낱말은 쓸 수 있는 다른 검색어가 있을 때만 뺀다. '8' 은 한 글자이고 '없는말' 은 어느 행에도 없다
      expect(versions("eGovframe 8")).toEqual(["DL-WCMS for eGovframe v1.0"]);
      expect(versions("eGovframe 없는말")).toEqual([]);
      // 영어 기능어는 영어 기능어가 아닌 두 글자 이상의 낱말이 있을 때만 뺀다
      expect(versions("on T").sort()).toEqual(["DL-WCMS for eGovframe v1.0", "OtherCMS 2.0", "SampleCMS 1.0"]);
      expect(versions("the eGovframe")).toEqual(["DL-WCMS for eGovframe v1.0"]);
      // 검색어 수 상한은 뺀 뒤에 적용한다
      const functionWords = "is the a of to in on at by as it this that what which how";
      expect(versions(`${functionWords} JEUS`)).toEqual(["JEUS 21", "JEUS 8.5"]);
      // OR 는 따르지 않는다: OR 가 있어도 이름 컬럼에 든 행이 있는 대상 낱말을 빼고, 모든 검색어가 일치하는 행만 찾는다
      expect(versions("eGovframe OR JEUS")).toEqual(["JEUS 21", "JEUS 8.5"]);
      expect(versions("JEUS OR Tibero")).toEqual([]);

      // 조회(queryCompatibleSoftware)가 모든 검색어 일치로 찾은 결과와 행도 순서도 같다
      for (const query of ["eGovframe CMS", "the CMS", "on T", "eGovframe 8", "Solution CMS", "ECM Solution"]) {
        const result = search(query);
        expect(result.matchMode, `query=${query}`).toBe("all-terms");
        expect(versions(query), `query=${query}`).toEqual(versionsOf(result.rows));
        expect(sqlite.queryCompatibleSoftwareAllTerms(query).total, `query=${query}`).toBe(result.total);
      }
    });

    it("뺀 대상 낱말이 없으면 정렬에 그 기준을 두지 않는다", () => {
      const criteria = (query: string) => orderByClausesOf(sqlite, () => search(query))[0].split(" DESC,").length;
      // 'eGovframe 호환' 은 뺀 대상 낱말이 이름 컬럼에 든 수가 기준 하나로 더 들어간다
      expect(criteria("eGovframe 호환")).toBe(criteria("호환") + 1);
      // 영어 기능어만 뺀 조회에는 더하지 않는다
      expect(criteria("the 호환")).toBe(criteria("호환"));
    });
  });

  describe("검색어 수의 상한", () => {
    const search = (query: string, filters = {}) => sqlite.queryCompatibleSoftware({ query, filters });

    /** 이름이 서로 다른 제품 count 개 (Word00, Word01, …). 이름 말고는 견줄 낱말이 없다 */
    const addWordProducts = (count: number): string[] => {
      const names = Array.from({ length: count }, (_, index) => `Word${String(index).padStart(2, "0")}`);
      sqlite.addCompatibilitySoftwareBatch(
        names.map((product_name) => ({
          ...CATALOGUE[5],
          product_name,
          product_version: `${product_name} 1.0`,
          category: "기타",
          description: "설명 없음",
        })),
      );
      return names;
    };

    /** 영어 기능어 열여섯 개 */
    const FUNCTION_WORDS = "is the a of to in on at by as it this that what which how".split(" ");

    it("쓰는 검색어는 16개를 넘지 않는다", () => {
      // 제품명 스무 개를 나열한다. 앞의 열여섯 개만 쓴다
      const names = addWordProducts(20);
      const listed = search(names.join(" "));
      expect(listed.matchMode).toBe("any-term");
      expect(listed.terms).toEqual({ used: names.slice(0, 16), ignored: [], dropped: [], required: 1 });
      expect(listed.total).toBe(16);

      // 모든 검색어가 일치하는 행을 찾을 때도 같다: 스무 낱말이 모두 든 행을 열여섯 낱말로 찾는다
      const words = Array.from({ length: 20 }, (_, index) => `kw${index}x`);
      sqlite.addCompatibilitySoftwareBatch([
        { ...CATALOGUE[5], product_name: "Wordy", product_version: "Wordy 1.0", description: words.join(" ") },
      ]);
      const every = search(words.join(" "));
      expect(versionsOf(every.rows)).toEqual(["Wordy 1.0"]);
      expect(every.matchMode).toBe("all-terms");
      expect(every.terms).toEqual({ used: words.slice(0, 16), ignored: [], dropped: [], required: 16 });
    });

    it("16개를 넘어 쓰지 못한 검색어는 used, ignored, dropped 어디에도 싣지 않는다", () => {
      // 열일곱 번째부터의 낱말은 일치하는 행이 있든(Word16) 없든(없는말) 응답에 나오지 않는다
      const names = addWordProducts(17);
      const terms = search(`${names.join(" ")} 없는말`).terms;
      expect(terms).toEqual({ used: names.slice(0, 16), ignored: [], dropped: [], required: 1 });
    });

    it("상한은 가려 주지 못하는 낱말을 뺀 뒤에 적용한다", () => {
      // 영어 기능어 열여섯 개 뒤에 적은 JEUS. 상한을 먼저 적용하던 때에는 JEUS 가 추출되지 않아,
      // 기능어들이 검색어로 쓰이고 JEUS 행은 결과에 없었다
      const sentence = search(`${FUNCTION_WORDS.join(" ")} JEUS`);
      expect(versionsOf(sentence.rows)).toEqual(["JEUS 21", "JEUS 8.5"]);
      expect(sentence.matchMode).toBe("all-terms");
      expect(sentence.terms).toEqual({ used: ["JEUS"], ignored: [], dropped: FUNCTION_WORDS, required: 1 });

      // 뺀 낱말은 상한에 세지 않는다: 기능어 열여섯 개와 대상 낱말 하나를 빼고도 제품명 열여섯 개를 모두 쓴다
      const names = addWordProducts(16);
      const mixed = search(`eGovFrame ${FUNCTION_WORDS.join(" ")} ${names.join(" ")}`);
      expect(mixed.terms).toEqual({
        used: names,
        ignored: [],
        dropped: ["eGovFrame", ...FUNCTION_WORDS],
        required: 1,
      });
      expect(mixed.total).toBe(16);
    });

    it("빼지 않은 영어 기능어와 대상 낱말은 상한에 센다", () => {
      // 영어 기능어뿐인 query 는 기능어를 빼지 않는다. 앞의 열여섯 개가 모두 검색어이고(일치하는 행이 있으면 used,
      // 없으면 ignored), 열일곱 번째인 'for' 는 쓰지 못한다
      const sixteen = "is the an of to in on at by as it this that what which how".split(" ");
      const terms = search(`${sixteen.join(" ")} for`).terms;
      expect([...(terms?.used ?? []), ...(terms?.ignored ?? [])].sort()).toEqual([...sixteen].sort());
      expect(terms?.used).toContain("on");
      expect(terms?.dropped).toEqual([]);
    });

    it("대상 낱말을 뺄지는 상한 안에 드는 검색어로 판정한다", () => {
      sqlite.addCompatibilitySoftwareBatch([
        { ...CATALOGUE[5], product_name: "DL-WCMS for eGovframe", product_version: "DL-WCMS for eGovframe v1.0" },
      ]);
      const absent = Array.from({ length: 16 }, (_, index) => `none${index}`);
      // 대상 낱말을 빼면 남는 검색어의 앞 열여섯 개는 모두 일치하는 행이 없다. JEUS 는 일치하는 행이 있지만 열일곱 번째라
      // 쓰지 못한다. JEUS 를 보고 대상 낱말을 빼면 0건이 되므로, 빼지 않고 대상 낱말로 찾는다
      const result = search(`eGovframe ${absent.join(" ")} JEUS`);
      expect(versionsOf(result.rows)).toEqual(["DL-WCMS for eGovframe v1.0"]);
      expect(result.terms).toEqual({ used: ["eGovframe"], ignored: absent.slice(0, 15), dropped: [], required: 1 });
      // JEUS 가 상한 안에 들면 대상 낱말을 빼고 JEUS 로 찾는다
      const within = search(`eGovframe ${absent.slice(0, 15).join(" ")} JEUS`);
      expect(versionsOf(within.rows)).toEqual(["JEUS 21", "JEUS 8.5"]);
      expect(within.terms).toEqual({ used: ["JEUS"], ignored: absent.slice(0, 15), dropped: ["eGovframe"], required: 1 });
    });
  });

  describe("키워드 검색의 정렬", () => {
    it("이름(제품명·제품 버전 표기)에 일치한 검색어가 많은 행을 먼저 돌려준다", () => {
      // 분류에만 'CMS' 가 든 행은 확인일자가 가장 최근이어도 이름에 'CMS' 가 든 행 뒤에 온다
      sqlite.addCompatibilitySoftwareBatch([
        { ...CATALOGUE[4], product_name: "Portal X", product_version: "Portal X 1.0", verified_date: "2026-01-01" },
      ]);
      const result = sqlite.queryCompatibleSoftware({ query: "CMS" });
      expect(versionsOf(result.rows)).toEqual(["SampleCMS 1.0", "OtherCMS 2.0", "Portal X 1.0"]);
      expect(result.matchMode).toBe("all-terms");
    });

    it("이름에 일치한 검색어 수는 검색어마다 따로 센다", () => {
      // 'e m': SampleCMS 와 OtherCMS 는 이름에 둘 다, Tibero 는 이름에 'e' 만 들어 있다 ('m' 은 분류 DBMS 에 있다).
      // 이름에 일치한 수가 같은 SampleCMS 와 OtherCMS 는 확인일자가 최근인 순이다.
      // (두 글자 모두 어느 행에서도 낱말의 처음에 나오지 않아, 낱말의 가운데에서만 일치한 검색어 수는 세 행이 같다.)
      const result = sqlite.queryCompatibleSoftware({ query: "e m" });
      expect(versionsOf(result.rows)).toEqual(["SampleCMS 1.0", "OtherCMS 2.0", "Tibero 7"]);
    });

    it("제품 버전 표기에만 일치한 행이 설명에만 일치한 행보다 앞에 온다", () => {
      // '가나다판' 은 한 행의 제품 버전 표기에만, 다른 한 행의 설명에만 들어 있다.
      // 설명에만 든 행의 확인일자가 더 최근이라, 제품 버전 표기를 이름으로 세지 않으면 그 행이 먼저 나온다
      sqlite.addCompatibilitySoftwareBatch([
        {
          ...CATALOGUE[5],
          product_name: "Plain",
          product_version: "Plain 가나다판",
          verified_date: "2015-01-01",
          description: "설명 없음",
        },
        {
          ...CATALOGUE[5],
          product_name: "Other",
          product_version: "Other 1.0",
          verified_date: "2026-03-03",
          description: "가나다판 을 지원함",
        },
      ]);
      const result = sqlite.queryCompatibleSoftware({ query: "가나다판" });
      expect(versionsOf(result.rows)).toEqual(["Plain 가나다판", "Other 1.0"]);
      expect(result.matchMode).toBe("all-terms");
    });

    it("이름에 일치한 검색어 수가 같으면 확인일자가 최근인 행을 먼저 돌려준다", () => {
      // 여섯 행 모두 설명에만 '호환' 이 들어 있다
      expect(versionsOf(sqlite.queryCompatibleSoftware({ query: "호환" }).rows)).toEqual([
        "JEUS 21",
        "SampleCMS 1.0",
        "OtherCMS 2.0",
        "Tibero 7",
        "JEUS 8.5",
        "WebLogic 12c",
      ]);
    });
  });

  describe("키워드 검색의 정렬: 영문 검색어가 낱말의 처음에서 일치했는지 (낱말의 가운데에서만 일치한 행을 뒤로)", () => {
    /** 제품 버전 표기만 다른 행 (제품명·분류·설명에는 견줄 낱말이 없다) */
    const probe = (index: number, product_version: string, verified_date: string): SoftwareSeed => ({
      ...CATALOGUE[5],
      product_name: `Probe${index}`,
      product_version,
      category: "기타",
      verified_date,
      description: "설명 없음",
    });

    it("낱말의 처음에서 일치한 행을 낱말의 가운데에서 일치한 행보다 먼저 돌려준다", () => {
      // 'ECM' 은 'SampleCMS' 의 가운데(Sampl-eCM-S)에도 들어 있다. 분류가 'ECM Solution' 인 행은 이름에 'ECM' 이 없고
      // 확인일자도 더 오래됐지만, 두 검색어가 모두 낱말의 처음에서 일치해 앞에 온다 (SampleCMS 는 'Solution' 하나다)
      sqlite.addCompatibilitySoftwareBatch([
        {
          ...CATALOGUE[5],
          product_name: "SmartOpen",
          product_version: "SmartOpen 3.0",
          category: "ECM Solution",
          verified_date: "2014-10-29",
          description: "설명 없음",
        },
      ]);
      const result = sqlite.queryCompatibleSoftware({ query: "ECM Solution" });
      expect(versionsOf(result.rows)).toEqual(["SmartOpen 3.0", "SampleCMS 1.0"]);
      expect(result.matchMode).toBe("all-terms");
      expect(result.terms).toEqual({ used: ["ECM", "Solution"], ignored: [], dropped: [], required: 2 });
    });

    it("낱말의 처음은 값의 맨 앞이거나, 바로 앞 글자가 ASCII 영문자가 아닌 자리다", () => {
      // 일곱 행 모두 제품 버전 표기에만 'zeta' 가 들어 있다 (이름에 일치한 검색어 수가 같다).
      // 낱말의 가운데에서 일치한 두 행의 확인일자가 가장 최근이라, 이 기준이 없으면 그 두 행이 맨 앞에 온다
      sqlite.addCompatibilitySoftwareBatch([
        probe(1, "Zeta 1", "2001-01-01"), // 값의 맨 앞
        probe(2, "가 Zeta", "2002-01-01"), // 앞이 공백
        probe(3, "7zeta", "2003-01-01"), // 앞이 숫자
        probe(4, "X-ZETA", "2004-01-01"), // 앞이 기호
        probe(5, "가zeta", "2005-01-01"), // 앞이 한글
        probe(6, "Alphazeta", "2030-01-01"), // 앞이 영문 소문자
        probe(7, "ALPHAZETA", "2031-01-01"), // 앞이 영문 대문자
      ]);
      for (const query of ["zeta", "Zeta", "ZETA"]) {
        const result = sqlite.queryCompatibleSoftware({ query });
        expect(versionsOf(result.rows), `query=${query}`).toEqual([
          "가zeta",
          "X-ZETA",
          "7zeta",
          "가 Zeta",
          "Zeta 1",
          "ALPHAZETA",
          "Alphazeta",
        ]);
      }
    });

    it("이름이 아닌 컬럼에서 낱말의 처음으로 일치해도 센다 (이름에 일치한 검색어 수보다 앞선 기준이다)", () => {
      // 'omega': 한 행은 이름의 가운데에, 다른 한 행은 설명의 낱말 처음에만 들어 있다.
      // 이름에 든 행의 확인일자가 더 최근이기도 해서, 이 기준이 이름보다 뒤에 있으면 그 행이 먼저 나온다
      sqlite.addCompatibilitySoftwareBatch([
        probe(1, "Bigomega 1.0", "2030-01-01"),
        { ...probe(2, "Plain 2.0", "2001-01-01"), description: "분류: Omega 계열" },
      ]);
      const result = sqlite.queryCompatibleSoftware({ query: "omega" });
      expect(versionsOf(result.rows)).toEqual(["Plain 2.0", "Bigomega 1.0"]);
    });

    it("일치한 검색어 수보다는 뒤선 기준이다", () => {
      // 대체 검색: 'omega'·'sigma' 가 모두 낱말의 가운데에 든 행(둘 일치)이, 'omega' 하나가 낱말의 처음에 든 행보다 앞이다
      sqlite.addCompatibilitySoftwareBatch([
        probe(1, "Omega 1.0", "2030-01-01"),
        probe(2, "Bigomega Bigsigma", "2001-01-01"),
      ]);
      const result = sqlite.queryCompatibleSoftware({ query: "omega sigma 없는말" });
      expect(result.matchMode).toBe("any-term");
      expect(result.terms).toEqual({ used: ["omega", "sigma"], ignored: ["없는말"], dropped: [], required: 1 });
      expect(versionsOf(result.rows)).toEqual(["Bigomega Bigsigma", "Omega 1.0"]);
    });

    it("낱말의 가운데에서만 일치한 검색어 수는 검색어마다 따로 센다", () => {
      // 'omega sigma': 둘 다 낱말의 처음인 행, 하나만 처음인 행, 둘 다 가운데인 행 (확인일자는 그 반대 순서다)
      sqlite.addCompatibilitySoftwareBatch([
        probe(1, "Bigomega Bigsigma", "2030-01-01"),
        probe(2, "Omega Bigsigma", "2020-01-01"),
        probe(3, "Omega Sigma", "2010-01-01"),
      ]);
      const result = sqlite.queryCompatibleSoftware({ query: "omega sigma" });
      expect(result.matchMode).toBe("all-terms");
      expect(versionsOf(result.rows)).toEqual(["Omega Sigma", "Omega Bigsigma", "Bigomega Bigsigma"]);
    });

    it("한글이 든 검색어에는 이 기준을 적용하지 않는다", () => {
      // 한국어 복합어의 가운데에 든 낱말은 정상적인 일치다. '나래' 가 값의 맨 앞에 든 행이 '그린나래' 보다 앞서지 않는다
      sqlite.addCompatibilitySoftwareBatch([
        probe(1, "나래 1.0", "2001-01-01"),
        probe(2, "그린나래 2.0", "2030-01-01"),
        probe(3, "나래CMS", "2002-01-01"),
        probe(4, "그린나래CMS", "2031-01-01"),
      ]);
      expect(versionsOf(sqlite.queryCompatibleSoftware({ query: "나래" }).rows)).toEqual([
        "그린나래CMS",
        "그린나래 2.0",
        "나래CMS",
        "나래 1.0",
      ]);
      // 영문자와 한글이 섞인 검색어도 같다
      expect(versionsOf(sqlite.queryCompatibleSoftware({ query: "나래CMS" }).rows)).toEqual(["그린나래CMS", "나래CMS"]);
      // 행을 돌려주는 조회 문의 정렬에 낱말의 처음을 견주는 식(GLOB)이 없다
      const clauses = orderByClausesOf(sqlite, () => sqlite.queryCompatibleSoftware({ query: "나래 호환" }));
      expect(clauses).toHaveLength(1);
      expect(clauses[0]).not.toContain("GLOB ?");
    });

    it("'.', '-', '_' 가 든 검색어에도 적용하지 않는다", () => {
      sqlite.addCompatibilitySoftwareBatch([probe(1, "X-Zeta 1.0", "2001-01-01"), probe(2, "MAX-Zeta 2.0", "2030-01-01")]);
      expect(versionsOf(sqlite.queryCompatibleSoftware({ query: "x-zeta" }).rows)).toEqual(["MAX-Zeta 2.0", "X-Zeta 1.0"]);
    });

    it("영문 검색어와 한글 검색어가 섞여 있으면 영문 검색어만 센다", () => {
      // '나래 omega': 두 행 모두 두 검색어가 일치한다. 'omega' 가 낱말의 처음에 든 행이 먼저다
      sqlite.addCompatibilitySoftwareBatch([
        probe(1, "나래 Omega", "2001-01-01"),
        probe(2, "나래 Bigomega", "2030-01-01"),
      ]);
      expect(versionsOf(sqlite.queryCompatibleSoftware({ query: "나래 omega" }).rows)).toEqual(["나래 Omega", "나래 Bigomega"]);
    });

    it("숫자뿐인 검색어에는 적용하지 않는다", () => {
      // 버전 숫자는 'v7', 'R6' 처럼 영문자 바로 뒤에 적는 일이 많다. 숫자에 이 기준을 적용하면 제품 버전 표기가
      // 'Tool v7' 인 행이, 설명에 날짜 '2017. 7. 14' 가 적혔을 뿐인 행보다 뒤로 밀린다 ('v' 뒤의 7 은 낱말의 처음이 아니다)
      sqlite.addCompatibilitySoftwareBatch([
        probe(1, "Tool v7", "2001-01-01"),
        { ...probe(2, "Tool", "2030-01-01"), description: "확인일자 : 2017. 7. 14" },
      ]);
      // 두 행 모두 'Tool' 과 '7' 이 일치한다. 이름에 '7' 이 든 Tool v7 이 먼저다 (이름에 일치한 검색어 수)
      expect(versionsOf(sqlite.queryCompatibleSoftware({ query: "Tool 7" }).rows)).toEqual(["Tool v7", "Tool"]);
      // '7' 만으로 찾아도 이름에 '7' 이 든 두 행(확인일자 순)이 설명에만 든 행보다 먼저다
      expect(versionsOf(sqlite.queryCompatibleSoftware({ query: "7" }).rows)).toEqual(["Tibero 7", "Tool v7", "Tool"]);

      // '2025': 확인일자(2025-08-21)로만 일치한 JEUS 21 이, 설명에 '2025' 가 적힌 오래된 행보다 먼저다 (확인일자 순)
      sqlite.addCompatibilitySoftwareBatch([{ ...probe(3, "Legacy 1.0", "2010-01-01"), description: "2025 년까지 지원" }]);
      expect(versionsOf(sqlite.queryCompatibleSoftware({ query: "2025" }).rows)).toEqual(["JEUS 21", "Legacy 1.0"]);

      // 숫자뿐인 검색어만 있는 조회 문의 정렬에는 낱말의 처음을 견주는 식(GLOB)이 없다
      const clauses = orderByClausesOf(sqlite, () => sqlite.queryCompatibleSoftware({ query: "7 2025" }));
      expect(clauses.length).toBeGreaterThan(0);
      for (const clause of clauses) {
        expect(clause).not.toContain("GLOB ?");
      }
    });

    it("대체 검색에서 조사를 떼어 쓴 검색어는 뗀 꼴로 견준다", () => {
      // 'omega는 없는말' → 'omega' 로 찾는다
      sqlite.addCompatibilitySoftwareBatch([
        probe(1, "Bigomega 1.0", "2030-01-01"),
        probe(2, "Omega 2.0", "2001-01-01"),
      ]);
      const result = sqlite.queryCompatibleSoftware({ query: "omega는 없는말" });
      expect(result.terms?.used).toEqual(["omega"]);
      expect(versionsOf(result.rows)).toEqual(["Omega 2.0", "Bigomega 1.0"]);
    });

    it("영문 검색어와 일치하지 않은 행은 뒤로 보내지 않는다 (한글 검색어가 이름에 든 행이 밀리지 않는다)", () => {
      // '게시판 API': 두 검색어가 함께 든 행이 없어 하나씩 일치한 행이 나온다. 설명에 'Open API' 가 든 행은 확인일자가
      // 더 최근이지만, '게시판' 이 이름에 든 행 뒤에 온다. 낱말의 처음에서 일치한 영문 검색어 수가 많은 행을 먼저 놓던
      // 때에는 한글 검색어가 그 기준에서 점수를 얻지 못해, 영문 검색어가 일치한 행이 언제나 앞에 왔다
      sqlite.addCompatibilitySoftwareBatch([
        probe(1, "게시판 도구 1.0", "2001-01-01"),
        { ...probe(2, "Gateway 2.0", "2030-01-01"), description: "Open API 를 제공" },
      ]);
      const result = sqlite.queryCompatibleSoftware({ query: "게시판 API" });
      expect(result.matchMode).toBe("any-term");
      expect(result.terms).toEqual({ used: ["게시판", "API"], ignored: [], dropped: [], required: 1 });
      expect(versionsOf(result.rows)).toEqual(["게시판 도구 1.0", "Gateway 2.0"]);

      // OR 로 이은 query 도 같다: 업체명에 'LG' 가 낱말로 든 행이 '티맥스' 가 든 행들보다 앞서지 않는다 (확인일자 순이다)
      sqlite.addCompatibilitySoftwareBatch([{ ...probe(3, "DevOn 1.0", "2010-01-01"), vendor: "LG CNS" }]);
      expect(versionsOf(sqlite.queryCompatibleSoftware({ query: "티맥스 OR LG" }).rows)).toEqual([
        "JEUS 21",
        "Tibero 7",
        "JEUS 8.5",
        "DevOn 1.0",
      ]);
    });

    it("낱말의 가운데에서만 일치한 행은 이름에 일치했어도, 그 검색어와 일치하지 않은 행보다 뒤에 온다", () => {
      // 'API' 가 이름의 낱말 가운데('Capital')에만 든 행과, '게시판' 이 설명에만 든 행.
      // 앞의 행은 이름에 일치했고 확인일자도 더 최근이지만, 낱말의 가운데에서만 일치한 검색어가 있어 뒤에 온다
      sqlite.addCompatibilitySoftwareBatch([
        probe(1, "Capital Tool 1.0", "2030-01-01"),
        { ...probe(2, "Plain 2.0", "2001-01-01"), description: "게시판을 제공" },
      ]);
      const result = sqlite.queryCompatibleSoftware({ query: "게시판 API" });
      expect(result.terms?.used).toEqual(["게시판", "API"]);
      expect(versionsOf(result.rows)).toEqual(["Plain 2.0", "Capital Tool 1.0"]);
    });

    it("이름 컬럼 안에서 낱말의 가운데에서만 일치한 영문 검색어가 적은 행을 먼저 돌려준다", () => {
      // 두 행 모두 'omega' 가 낱말의 처음에서 일치하고(앞의 행은 설명에서) 이름에도 들어 있다.
      // 이름 안에서는 'Xomega' 의 가운데에만 든 행이, 확인일자가 더 최근이어도 뒤에 온다
      sqlite.addCompatibilitySoftwareBatch([
        { ...probe(1, "Xomega Tool 1.0", "2030-01-01"), description: "Omega 계열" },
        probe(2, "Omega Tool 2.0", "2001-01-01"),
      ]);
      expect(versionsOf(sqlite.queryCompatibleSoftware({ query: "omega" }).rows)).toEqual([
        "Omega Tool 2.0",
        "Xomega Tool 1.0",
      ]);
    });

    it("그 기준은 이름 컬럼에 일치한 검색어 수보다 뒤선 기준이다", () => {
      // 'omega sigma': 두 행 모두 두 검색어가 낱말의 처음에서 일치한다 ('Sigma' 는 설명에서).
      // 이름에 두 검색어가 모두 든 행이 먼저다. 그 행의 이름에서는 'sigma' 가 'Xsigma' 의 가운데에만 들어 있다
      sqlite.addCompatibilitySoftwareBatch([
        { ...probe(1, "Omega 1.0", "2030-01-01"), description: "Sigma 지원" },
        { ...probe(2, "Omega Xsigma 2.0", "2001-01-01"), description: "Sigma 지원" },
      ]);
      const result = sqlite.queryCompatibleSoftware({ query: "omega sigma" });
      expect(result.matchMode).toBe("all-terms");
      expect(versionsOf(result.rows)).toEqual(["Omega Xsigma 2.0", "Omega 1.0"]);
    });

    it("숫자뿐인 검색어는 이름 컬럼 안의 기준에도 세지 않는다", () => {
      // 'v7' 의 7 은 영문자 바로 뒤라 낱말의 처음이 아니다. 숫자를 세면 확인일자가 더 최근인 'Kit v7' 이 'Tibero 7' 뒤로 간다
      sqlite.addCompatibilitySoftwareBatch([probe(1, "Kit v7", "2030-01-01")]);
      expect(versionsOf(sqlite.queryCompatibleSoftware({ query: "7" }).rows)).toEqual(["Kit v7", "Tibero 7"]);
    });

    it("낱말의 가운데 일치를 따지는 기준은 영문 검색어가 있을 때만 정렬에 들어간다", () => {
      const ascending = (query: string) =>
        orderByClausesOf(sqlite, () => sqlite.queryCompatibleSoftware({ query }))[0].split(" ASC").length - 1;
      // 영문 검색어: 검색 컬럼 전체에서 한 번, 이름 컬럼 안에서 한 번
      expect(ascending("Solution")).toBe(2);
      expect(ascending("Solution 호환")).toBe(2);
      // 한글 검색어, 숫자뿐인 검색어, 유연한 꼴로 쓴 검색어에는 없다
      expect(ascending("호환")).toBe(0);
      expect(ascending("4.3 2025")).toBe(0);
      expect(ascending("Web-Logic")).toBe(0);
    });

    it("필터와 페이지를 줘도 같은 순서에서 고른다", () => {
      sqlite.addCompatibilitySoftwareBatch([
        probe(1, "Bigomega 1.0", "2030-01-01"),
        probe(2, "Omega 2.0", "2001-01-01"),
        probe(3, "Omega 3.0", "2002-01-01"),
      ]);
      const page = sqlite.queryCompatibleSoftware({ query: "omega", filters: { category: "기타" }, limit: 2, offset: 1 });
      expect(versionsOf(page.rows)).toEqual(["Omega 2.0", "Bigomega 1.0"]);
      expect(page.total).toBe(3);
    });

    it("검색어는 바인딩 값으로만 넘긴다 (조회 문에 검색어가 들어가지 않는다)", () => {
      const statements = statementsOf(sqlite, () => sqlite.queryCompatibleSoftware({ query: "zeta9 Solution" }));
      expect(statements.length).toBeGreaterThan(0);
      for (const sql of statements) {
        expect(sql.toLowerCase()).not.toContain("zeta9");
        expect(sql).not.toContain("Solution");
      }
      // 영문 검색어가 있으면 행을 돌려주는 조회 문의 정렬에 낱말의 처음을 견주는 식이 들어간다
      const clauses = orderByClausesOf(sqlite, () => sqlite.queryCompatibleSoftware({ query: "Solution" }));
      expect(clauses).toHaveLength(1);
      expect(clauses[0]).toContain("GLOB ?");
    });
  });

  describe("2단계: 대체 검색 (any-term)", () => {
    it("모든 검색어가 든 행이 없으면, 일치하는 행이 있는 검색어의 절반 이상이 든 행을 돌려준다", () => {
      // JEUS 와 Tibero 가 함께 든 행은 없다. 두 검색어 가운데 하나 이상이 든 행이 나온다
      const result = sqlite.queryCompatibleSoftware({ query: "JEUS Tibero" });
      expect(versionsOf(result.rows)).toEqual(["JEUS 21", "Tibero 7", "JEUS 8.5"]);
      expect(result.total).toBe(3);
      expect(result.matchMode).toBe("any-term");
    });

    it("남은 검색어의 절반 이상(올림)이 일치하는 행이 있으면 그 행만 돌려준다", () => {
      // JEUS: 2행 / 8.5: 1행 / Tibero: 1행 / 여부: 0행(제외) → k=3, 두 개 이상 일치해야 통과
      const result = sqlite.queryCompatibleSoftware({ query: "JEUS 8.5 Tibero 여부" });
      expect(versionsOf(result.rows)).toEqual(["JEUS 8.5"]);
      expect(result.matchMode).toBe("any-term");
      expect(result.terms?.required).toBe(2);
    });

    it("절반 이상이 일치하는 행이 없으면 일치 기준을 1씩 낮춰 행이 나올 때까지 찾는다", () => {
      // 제품명 셋을 나열했다. 한 행에 두 제품명이 함께 들 수 없어 기준(k=3 → 2)을 채운 행이 없다.
      // 기준을 낮추지 않던 때에는 0건이어서, 호출자가 세 제품이 목록에 없다고 읽었다
      const result = sqlite.queryCompatibleSoftware({ query: "JEUS Tibero WebLogic" });
      expect(versionsOf(result.rows)).toEqual(["JEUS 21", "Tibero 7", "JEUS 8.5", "WebLogic 12c"]);
      expect(result.total).toBe(4);
      expect(result.matchMode).toBe("any-term");
      expect(result.terms).toEqual({ used: ["JEUS", "Tibero", "WebLogic"], ignored: [], dropped: [], required: 1 });
    });

    it("일치 기준은 행이 나오는 데까지만 낮춘다", () => {
      // k=5 → 기준 3. 세 개가 일치하는 행은 없고, 두 개가 일치하는 행은 JEUS 8.5(JEUS, 8.5) 하나다.
      // 기준 2 에서 멈추므로 하나만 일치하는 나머지 행은 나오지 않는다
      const result = sqlite.queryCompatibleSoftware({ query: "JEUS 8.5 Tibero WebLogic OtherCMS" });
      expect(versionsOf(result.rows)).toEqual(["JEUS 8.5"]);
      expect(result.total).toBe(1);
      expect(result.terms).toEqual({
        used: ["JEUS", "8.5", "Tibero", "WebLogic", "OtherCMS"],
        ignored: [],
        dropped: [],
        required: 2,
      });

      // 두 개가 일치하는 행도 없으면 1 까지 낮춘다 (k=5 → 3 → 2 → 1). 여섯 행 모두 제품명 하나씩과 일치한다
      const names = sqlite.queryCompatibleSoftware({ query: "JEUS Tibero WebLogic SampleCMS OtherCMS" });
      expect(names.total).toBe(CATALOGUE.length);
      expect(names.terms?.required).toBe(1);
    });

    it("일치 기준을 여러 단계 낮춰도 조회 문 수는 한 단계 낮출 때와 같다", () => {
      // 기준을 1씩 낮춰 가며 그때마다 건수를 세면, 검색어가 많은 query 는 낮추는 단계마다 표 전체를 다시 훑는다.
      // 가장 많이 일치한 행의 일치 수를 한 번 구해 그 값으로 낮춘다
      sqlite.addCompatibilitySoftwareBatch([
        { ...CATALOGUE[5], product_name: "ExtraTool", product_version: "ExtraTool 1.0", description: "설명 없음" },
      ]);
      // 두 query 모두 쓸 수 있는 검색어가 여섯이라 기준 3 에서 시작한다
      const oneStep = "JEUS 8.5 Tibero WebLogic OtherCMS SampleCMS"; // JEUS 8.5 행이 JEUS·8.5 두 개와 일치한다 → 기준 2
      const twoSteps = "JEUS Tibero WebLogic OtherCMS SampleCMS ExtraTool"; // 어느 행도 하나씩만 일치한다 → 기준 1
      expect(sqlite.queryCompatibleSoftware({ query: oneStep }).terms?.required).toBe(2);
      expect(sqlite.queryCompatibleSoftware({ query: twoSteps }).terms?.required).toBe(1);
      expect(sqlite.queryCompatibleSoftware({ query: twoSteps }).total).toBe(CATALOGUE.length + 1);
      const statements = (query: string) => statementsOf(sqlite, () => sqlite.queryCompatibleSoftware({ query })).length;
      expect(statements(twoSteps)).toBe(statements(oneStep));
    });

    it("쓸 수 있는 검색어가 하나라도 있으면 결과가 0건이 되지 않는다", () => {
      const queries = [
        "JEUS Tibero WebLogic",
        "JEUS Tibero WebLogic 없는말 다른말",
        "JEUS는 Tibero를 WebLogic과 SampleCMS와 OtherCMS",
        "오라클 DBMS 샘플벤더 12c 4.2 2025",
      ];
      for (const query of queries) {
        const result = sqlite.queryCompatibleSoftware({ query });
        expect(result.matchMode, `query=${query}`).toBe("any-term");
        expect(result.terms?.used.length, `query=${query}`).toBeGreaterThan(0);
        expect(result.total, `query=${query}`).toBeGreaterThan(0);
        expect(result.terms?.required, `query=${query}`).toBeGreaterThanOrEqual(1);
      }
    });

    it("일치 기준을 낮출지는 페이지가 아니라 전체 건수로 판단한다", () => {
      // offset 이 끝을 넘어 이번 페이지가 비어도 기준을 더 낮추지 않는다 (기준 2 를 채운 행이 하나 있다)
      const beyond = sqlite.queryCompatibleSoftware({ query: "JEUS 8.5 Tibero WebLogic OtherCMS", offset: 5 });
      expect(beyond.rows).toEqual([]);
      expect(beyond.total).toBe(1);
      expect(beyond.terms?.required).toBe(2);

      // 낮춘 기준으로 찾은 결과도 페이지를 나눠 이어서 볼 수 있다
      const all = sqlite.queryCompatibleSoftware({ query: "JEUS Tibero WebLogic" });
      const paged = [0, 1, 2, 3].flatMap(
        (offset) => sqlite.queryCompatibleSoftware({ query: "JEUS Tibero WebLogic", limit: 1, offset }).rows,
      );
      expect(versionsOf(paged)).toEqual(versionsOf(all.rows));
    });

    it("일치하는 행이 하나도 없는 검색어는 세지 않는다 (군말이 섞인 문장형 질의)", () => {
      // 오라클: 1행 / 제품·호환성·문의: 0행(제외) → k=1.
      // 0행인 검색어까지 세면 k=4 가 되어, '오라클' 하나만 일치하는 WebLogic 이 탈락한다
      const result = sqlite.queryCompatibleSoftware({ query: "오라클 제품 호환성 문의" });
      expect(versionsOf(result.rows)).toEqual(["WebLogic 12c"]);
      expect(result.total).toBe(1);
      expect(result.matchMode).toBe("any-term");
    });

    it("일치하는 행이 있는 검색어가 하나도 없으면 빈 결과를 돌려준다", () => {
      // 없는말·다른말·문의: 0행 → k=0
      const result = sqlite.queryCompatibleSoftware({ query: "없는말 다른말 문의" });
      expect(result.rows).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.matchMode).toBe("any-term");
    });

    it("가려 주는 검색어가 있으면 흔한 검색어만 일치한 행은 돌려주지 않는다", () => {
      // JEUS: 2행(여섯 행의 절반 이하, 가려 주는 검색어) / 호환: 6행(절반 넘음, 흔한 검색어) / 여부: 0행(제외).
      // 하나 이상 일치하면 통과하므로(k=2), '호환' 만 일치한 네 행까지 돌려주던 때에는 목록 전체가 나왔다
      const sentence = sqlite.queryCompatibleSoftware({ query: "JEUS 호환 여부" });
      expect(versionsOf(sentence.rows)).toEqual(["JEUS 21", "JEUS 8.5"]);
      expect(sentence.total).toBe(2);
      expect(sentence.matchMode).toBe("any-term");
      // 흔한 검색어도 쓴 검색어로 알린다
      expect(sentence.terms).toEqual({ used: ["JEUS", "호환"], ignored: ["여부"], dropped: [], required: 1 });
    });

    it("쓰기로 한 검색어가 모두 흔한 검색어이면 그 검색어가 일치한 행을 그대로 돌려준다", () => {
      // '호환' 과 '확인' 은 여섯 행 모두에 들어 있다. 흔한 검색어를 버리면 남는 검색어가 없어 0건이 된다
      for (const query of ["호환 추천", "호환 확인 추천"]) {
        const common = sqlite.queryCompatibleSoftware({ query });
        expect(common.total, `query=${query}`).toBe(CATALOGUE.length);
        expect(common.matchMode, `query=${query}`).toBe("any-term");
      }
    });

    it("흔한 검색어는 일치한 검색어 수(정렬과 일치 기준)에는 그대로 센다", () => {
      // 정렬: 설명에 '호환' 이 없는 JEUS 행을 넣는다. JEUS(3행)는 가려 주는 검색어, 호환(7행 가운데 6행)은 흔한 검색어다.
      // 새 행은 확인일자가 가장 최근이지만 JEUS 하나만 일치해, JEUS·호환 두 개가 일치한 두 행 뒤에 온다
      sqlite.addCompatibilitySoftwareBatch([
        {
          ...CATALOGUE[1],
          product_name: "Plain JEUS",
          product_version: "Plain JEUS 1.0",
          verified_date: "2026-04-04",
          description: "설명 없음",
        },
      ]);
      const ordered = sqlite.queryCompatibleSoftware({ query: "JEUS 호환 여부" });
      expect(versionsOf(ordered.rows)).toEqual(["JEUS 21", "JEUS 8.5", "Plain JEUS 1.0"]);

      // 일치 기준: JEUS·Tibero·4.0 은 가려 주는 검색어, 호환은 흔한 검색어 → k=4, 두 개 이상 일치해야 통과.
      // JEUS 21 은 가려 주는 검색어가 JEUS 하나뿐이지만 '호환' 까지 두 개가 일치해 통과하고, 'Plain JEUS' 는 하나라 빠진다
      const counted = sqlite.queryCompatibleSoftware({ query: "JEUS Tibero 4.0 호환 없는말" });
      expect(versionsOf(counted.rows)).toEqual(["Tibero 7", "JEUS 8.5", "JEUS 21"]);
      expect(counted.terms).toEqual({
        used: ["JEUS", "Tibero", "4.0", "호환"],
        ignored: ["없는말"],
        dropped: [],
        required: 2,
      });
    });

    it("일치 기준은 가려 주는 검색어가 일치한 행 안에서 낮춘다", () => {
      // 설명에 '호환' 도 '확인' 도 없는 행. 드문말(1행)은 가려 주는 검색어, 호환·확인(7행 가운데 6행)은 흔한 검색어다 → k=3.
      // 두 개 이상 일치한 행은 여섯이지만 모두 흔한 검색어만 일치했다. 그 행들을 돌려주지 않고 기준을 1 로 낮춘다
      sqlite.addCompatibilitySoftwareBatch([
        { ...CATALOGUE[5], product_name: "Rare", product_version: "Rare 1.0", description: "드문말" },
      ]);
      const result = sqlite.queryCompatibleSoftware({ query: "드문말 호환 확인 없는말" });
      expect(versionsOf(result.rows)).toEqual(["Rare 1.0"]);
      expect(result.total).toBe(1);
      expect(result.terms).toEqual({ used: ["드문말", "호환", "확인"], ignored: ["없는말"], dropped: [], required: 1 });
    });

    it("흔한 검색어인지는 필터를 적용한 대상 안에서 판단한다", () => {
      // 표 전체(6행)에서는 JEUS(2행)와 오라클(1행) 모두 가려 주는 검색어라, 하나 이상 일치한 세 행이 나온다
      const everywhere = sqlite.queryCompatibleSoftware({ query: "JEUS 오라클" });
      expect(versionsOf(everywhere.rows)).toEqual(["JEUS 21", "JEUS 8.5", "WebLogic 12c"]);
      // WAS 세 행 안에서는 JEUS(2행)가 절반을 넘는 흔한 검색어다. 가려 주는 검색어 '오라클' 이 일치한 행만 남는다
      const inWas = sqlite.queryCompatibleSoftware({ query: "JEUS 오라클", filters: { category: "WAS" } });
      expect(versionsOf(inWas.rows)).toEqual(["WebLogic 12c"]);
      expect(inWas.terms).toEqual({ used: ["JEUS", "오라클"], ignored: [], dropped: [], required: 1 });
    });

    it("대상 행의 정확히 절반과 일치하는 검색어는 가려 주는 검색어다", () => {
      // 티맥스: 6행 가운데 3행 / 호환: 6행. '호환' 만 일치한 세 행은 나오지 않는다
      const result = sqlite.queryCompatibleSoftware({ query: "티맥스 호환 없는말" });
      expect(versionsOf(result.rows)).toEqual(["JEUS 21", "Tibero 7", "JEUS 8.5"]);
      expect(result.total).toBe(3);
    });

    it("일치한 검색어 수가 많은 행을 먼저 돌려준다 (확인일자보다 앞선 기준이다)", () => {
      // JEUS 8.5 는 JEUS·8.5·4.0 세 개, Tibero 7 은 Tibero·4.0 두 개가 일치한다 (네 개가 모두 든 행은 없다).
      // 확인일자는 Tibero 7 이 더 최근이다. JEUS 21 은 하나만 일치해 기준(절반)에 못 미친다
      const result = sqlite.queryCompatibleSoftware({ query: "JEUS 8.5 Tibero 4.0" });
      expect(versionsOf(result.rows)).toEqual(["JEUS 8.5", "Tibero 7"]);
      expect(result.total).toBe(2);
      expect(result.matchMode).toBe("any-term");
    });

    it("일치한 검색어 수는 이름에 일치한 검색어 수보다 앞선 기준이다", () => {
      // 설명에만 두 검색어가 든 행(Alpha)과 이름에 한 검색어가 든 행(가나다 Suite). 이름에 든 행의 확인일자가 더 최근이다.
      // 이름에 일치한 수를 먼저 보면 '가나다 Suite' 가 앞에 온다
      sqlite.addCompatibilitySoftwareBatch([
        {
          ...CATALOGUE[5],
          product_name: "Alpha",
          product_version: "Alpha 1.0",
          verified_date: "2015-01-01",
          description: "가나다 라마바 설명",
        },
        {
          ...CATALOGUE[5],
          product_name: "가나다 Suite",
          product_version: "가나다 Suite 1.0",
          verified_date: "2026-03-03",
          description: "설명 없음",
        },
      ]);
      // 없는말: 0행(제외) → k=2, 하나 이상 일치하면 통과. Alpha 는 둘, '가나다 Suite' 는 하나가 일치한다
      const result = sqlite.queryCompatibleSoftware({ query: "가나다 라마바 없는말" });
      expect(versionsOf(result.rows)).toEqual(["Alpha 1.0", "가나다 Suite 1.0"]);
      expect(result.matchMode).toBe("any-term");
    });

    it("일치한 검색어 수가 같으면 이름에 일치한 검색어가 많은 행을 먼저 돌려준다", () => {
      // Tibero·호환·없는말: 분류에만 'Tibero' 가 든 행을 넣는다. 그 행과 Tibero 7 은 Tibero·호환 두 개가 일치한다
      // (k=2, 하나 이상이면 통과). 새 행은 확인일자가 더 최근이지만 이름에는 'Tibero' 가 없어 Tibero 7 뒤에 온다.
      // '호환' 만 일치한 다섯 행은 가려 주는 검색어(Tibero)가 일치하지 않아 나오지 않는다
      sqlite.addCompatibilitySoftwareBatch([
        {
          ...CATALOGUE[2],
          product_name: "Addon",
          product_version: "Addon 1.0",
          category: "Tibero Tool",
          verified_date: "2026-02-02",
        },
      ]);
      const result = sqlite.queryCompatibleSoftware({ query: "Tibero 호환 없는말" });
      expect(versionsOf(result.rows)).toEqual(["Tibero 7", "Addon 1.0"]);
      expect(result.total).toBe(2);
    });

    it("한 글자 검색어뿐인 query 도 대체 검색에서 그대로 쓴다", () => {
      // T 는 세 행에 들어 있고 9 는 어느 행에도 없다 → k=1.
      // 'T' 가 낱말의 처음에 든 Tibero 가 먼저고, 낱말의 가운데에 든 두 행은 이름에 든 OtherCMS 가 먼저다
      const result = sqlite.queryCompatibleSoftware({ query: "T 9" });
      expect(versionsOf(result.rows)).toEqual(["Tibero 7", "OtherCMS 2.0", "SampleCMS 1.0"]);
      expect(result.matchMode).toBe("any-term");
    });

    it("limit 은 대체 검색 결과에도 적용된다", () => {
      const result = sqlite.queryCompatibleSoftware({ query: "JEUS Tibero", limit: 1 });
      expect(versionsOf(result.rows)).toEqual(["JEUS 21"]);
      expect(result.total).toBe(3);
    });

    it("아주 긴 검색어가 있어도 오류 없이 처리한다", () => {
      // query 는 앞 2,000자만 읽으므로 검색어의 LIKE 패턴이 SQLite 의 길이 한도(50,000바이트)를 넘지 않는다
      const huge = "가".repeat(20000);
      expect(sqlite.queryCompatibleSoftware({ query: huge }).rows).toEqual([]);
      // 어떤 행과도 일치하지 않는 긴 검색어는 세지 않는다 (k=1)
      expect(versionsOf(sqlite.queryCompatibleSoftware({ query: `오라클 ${huge}` }).rows)).toEqual([
        "WebLogic 12c",
      ]);
    });
  });

  describe("2단계: 조사가 붙은 검색어", () => {
    it("영문·숫자 뒤에 한글 1~3자가 붙은 검색어는 한글을 떼고 찾는다", () => {
      const cases: Array<[string, string[]]> = [
        ["JEUS는", ["JEUS 21", "JEUS 8.5"]],
        ["Tibero를", ["Tibero 7"]],
        ["4.3에서", ["JEUS 21", "SampleCMS 1.0"]],
        ["WebLogic입니다", ["WebLogic 12c"]],
      ];
      for (const [query, expected] of cases) {
        const result = sqlite.queryCompatibleSoftware({ query });
        expect(versionsOf(result.rows), `query=${query}`).toEqual(expected);
        expect(result.matchMode, `query=${query}`).toBe("any-term");
      }
    });

    it("조사로 끝나는 검색어는 조사를 떼고 찾는다", () => {
      const cases: Array<[string, string[]]> = [
        ["티맥스는", ["JEUS 21", "Tibero 7", "JEUS 8.5"]],
        ["오라클의", ["WebLogic 12c"]],
        ["티맥스소프트에서", ["JEUS 21", "JEUS 8.5"]],
        ["벤더로", ["SampleCMS 1.0", "OtherCMS 2.0"]],
      ];
      for (const [query, expected] of cases) {
        const result = sqlite.queryCompatibleSoftware({ query });
        expect(versionsOf(result.rows), `query=${query}`).toEqual(expected);
        expect(result.matchMode, `query=${query}`).toBe("any-term");
      }
      // '으로' 로 끝나면 '으로' 를 뗀다 ('확인' 은 여섯 행 모두의 설명에 있고, '확인으' 는 어느 행에도 없다)
      expect(sqlite.queryCompatibleSoftware({ query: "확인으로" }).total).toBe(CATALOGUE.length);
    });

    it("조사를 뗀 나머지가 한 글자이면 떼지 않는다", () => {
      // '주' 는 세 행의 업체명('(주)…')에 들어 있다
      expect(sqlite.queryCompatibleSoftware({ query: "주" }).total).toBe(3);
      expect(sqlite.queryCompatibleSoftware({ query: "주는" }).rows).toEqual([]);
    });

    it("조사를 뗀 꼴도 일치하는 행이 없으면 그 검색어는 쓰지 않는다", () => {
      expect(sqlite.queryCompatibleSoftware({ query: "없는말은" }).rows).toEqual([]);
      // 나머지 검색어로는 찾는다
      expect(versionsOf(sqlite.queryCompatibleSoftware({ query: "JEUS는 없는말은" }).rows)).toEqual([
        "JEUS 21",
        "JEUS 8.5",
      ]);
    });

    it("문장 속의 조사 붙은 낱말도 떼고 센다", () => {
      // JEUS는 → JEUS(2행) / 4.3에서 → 4.3(2행) / 지원되나요: 0행(제외) → k=2, 하나 이상 일치하면 통과.
      // JEUS 21 만 둘 다 일치한다. 하나씩 일치한 두 행은 이름에 검색어가 든 JEUS 8.5 가 먼저다
      const result = sqlite.queryCompatibleSoftware({ query: "JEUS는 4.3에서 지원되나요" });
      expect(versionsOf(result.rows)).toEqual(["JEUS 21", "JEUS 8.5", "SampleCMS 1.0"]);
      expect(result.matchMode).toBe("any-term");
    });

    it("뗀 꼴이 다른 검색어와 같으면 한 번만 센다", () => {
      // 두 번 세면 k=3 이 되어 두 개 이상 일치해야 하고, 'JEUS' 가 두 번 일치하는 JEUS 두 행만 남는다
      const result = sqlite.queryCompatibleSoftware({ query: "JEUS JEUS는 Tibero" });
      expect(versionsOf(result.rows)).toEqual(["JEUS 21", "Tibero 7", "JEUS 8.5"]);
    });

    it("뗀 꼴도 필터를 적용한 대상 안에서 일치하는 행이 있어야 쓴다", () => {
      const inDbms = (query: string) => sqlite.queryCompatibleSoftware({ query, filters: { category: "DBMS" } });
      expect(versionsOf(inDbms("티맥스는").rows)).toEqual(["Tibero 7"]);
      // 'JEUS' 는 표에는 있지만 DBMS 안에는 없다
      expect(inDbms("JEUS는").rows).toEqual([]);
      expect(versionsOf(inDbms("JEUS는 티맥스는").rows)).toEqual(["Tibero 7"]);
    });

    it("검색어 그대로 일치하는 행이 있으면 조사처럼 보이는 끝 글자를 떼지 않는다", () => {
      // '티베로' 는 '로' 로 끝나지만 업체명 '티맥스티베로' 에 그대로 들어 있다.
      // 떼어 낸 '티베' 가 든 행을 넣어도 그 행은 나오지 않는다
      sqlite.addCompatibilitySoftwareBatch([
        { ...CATALOGUE[5], product_name: "TibetTool", product_version: "TibetTool 1.0", vendor: "티베트소프트" },
      ]);
      expect(versionsOf(sqlite.queryCompatibleSoftware({ query: "티베로" }).rows)).toEqual(["Tibero 7"]);
      expect(versionsOf(sqlite.queryCompatibleSoftware({ query: "티베로 없는말" }).rows)).toEqual(["Tibero 7"]);
    });
  });

  describe("2단계: 기호로 이은 검색어 (유연한 꼴)", () => {
    /** 제품명을 띄어 쓴 제품과, 그 낱말 하나씩만 이름에 든 제품 */
    const named = (product_name: string, verified_date: string): SoftwareSeed => ({
      ...CATALOGUE[5],
      product_name,
      product_version: `${product_name} 1.0`,
      verified_date,
      description: "설명 없음",
    });

    beforeEach(() => {
      sqlite.addCompatibilitySoftwareBatch([
        named("K2Web Wizard", "2020-01-01"),
        named("K2Web Lite", "2021-01-01"),
        named("SCP-SmartUI", "2019-01-01"),
        named("SmartUI Tool", "2026-01-01"),
      ]);
    });

    const search = (query: string, filters = {}) => sqlite.queryCompatibleSoftware({ query, filters });

    /** 쓸 수 있는 꼴이 하나도 없는 검색어 하나뿐인 query 의 결과 */
    const nothingFor = (query: string) => ({
      rows: [],
      total: 0,
      matchMode: "any-term",
      terms: { used: [], ignored: [query], dropped: [], required: 0 },
    });

    it("저장된 표기와 다른 기호로 이은 검색어는 구분 기호의 자리를 유연하게 견줘 찾는다", () => {
      // 저장된 표기는 'K2Web Wizard' 다. 'K2Web-Wizard' 는 어느 행에도 부분 문자열로 들어 있지 않아 0건이었다
      for (const query of ["K2Web-Wizard", "K2Web_Wizard", "K2Web.Wizard", "k2web-wizard"]) {
        const result = search(query);
        // 두 낱말이 이어져 나오는 행만 찾는다. 'K2Web' 만 든 'K2Web Lite' 는 나오지 않는다
        expect(versionsOf(result.rows), `query=${query}`).toEqual(["K2Web Wizard 1.0"]);
        expect(result.matchMode, `query=${query}`).toBe("any-term");
        // 쓴 검색어는 query 에 적힌 그대로 싣는다
        expect(result.terms, `query=${query}`).toEqual({ used: [query], ignored: [], dropped: [], required: 1 });
      }
    });

    it("구분 기호의 자리에 아무 글자도 없는 표기와도 일치한다", () => {
      // 저장된 표기는 'WebLogic', 'SmartUI' 다
      expect(versionsOf(search("Web-Logic").rows)).toEqual(["WebLogic 12c"]);
      expect(versionsOf(search("Smart_UI").rows)).toEqual(["SmartUI Tool 1.0", "SCP-SmartUI 1.0"]);
    });

    it("조각으로 나눠 찾지 않는다 (낱말 하나만 든 행과는 일치하지 않는다)", () => {
      // 'K2Web' 은 두 행에, 'JEUS' 도 두 행에, 'on' 은 'CMS Solution' 의 끝에 들어 있다.
      // 기호에서 나눈 조각으로 찾던 때에는 조각 하나만 든 그 행들이 나왔다
      for (const query of ["K2Web-NoSuch", "JEUS-on", "egov_JEUS", "없는말-다른말"]) {
        expect(search(query), `query=${query}`).toEqual(nothingFor(query));
      }
      // 다른 검색어로는 찾는다 ('9.9' 는 어느 행에도 없고 유연한 자리도 없다)
      expect(search("JEUS 9.9").terms).toEqual({ used: ["JEUS"], ignored: ["9.9"], dropped: [], required: 1 });
      // 영문 뒤에 한글 1~3자가 붙은 꼴은 조사를 뗀 꼴이 먼저 일치한다 (조각으로 나눈 것이 아니다)
      expect(search("K2Web-없는말").terms).toEqual({ used: ["K2Web"], ignored: [], dropped: [], required: 1 });
    });

    it("검색어의 첫 글자와 마지막 글자가 영문자이면 낱말의 처음과 끝에서 일치해야 한다", () => {
      // 'S_CMS' 는 'S-CMS', 'SCMS' 와 일치하고, 다른 낱말의 일부인 'PlusS-CMS', 'S-CMSuite' 와는 일치하지 않는다.
      // 일치하지 않는 두 행의 확인일자가 가장 최근이라, 이 조건이 없으면 그 두 행이 맨 앞에 온다
      sqlite.addCompatibilitySoftwareBatch([
        named("S-CMS", "2015-01-01"),
        named("SCMS", "2016-01-01"),
        named("PlusS-CMS", "2030-01-01"),
        named("S-CMSuite", "2031-01-01"),
      ]);
      expect(versionsOf(search("S_CMS").rows)).toEqual(["SCMS 1.0", "S-CMS 1.0"]);
    });

    it("숫자 사이의 구분 문자는 글자 그대로 견준다", () => {
      // 'JEUS-8.5' 는 '-' 의 자리만 유연하다. '.' 은 버전 표기의 일부라 'JEUS 85' 와는 일치하지 않는다
      sqlite.addCompatibilitySoftwareBatch([named("JEUS 85", "2031-01-01")]);
      const versioned = search("JEUS-8.5");
      expect(versionsOf(versioned.rows)).toEqual(["JEUS 8.5"]);
      expect(versioned.terms).toEqual({ used: ["JEUS-8.5"], ignored: [], dropped: [], required: 1 });
      // 마지막 글자가 숫자이면 뒤 글자를 가리지 않는다: 'JEUS_8' 은 'JEUS 8.5' 와 'JEUS 85' 를 모두 찾는다
      expect(versionsOf(search("JEUS_8").rows)).toEqual(["JEUS 85 1.0", "JEUS 8.5"]);
      // 'JEUS-21' 은 'JEUS 21' 만 찾는다 ('JEUS' 만 든 다른 행은 나오지 않는다)
      const exactVersion = search("JEUS-21");
      expect(versionsOf(exactVersion.rows)).toEqual(["JEUS 21"]);
      expect(exactVersion.terms).toEqual({ used: ["JEUS-21"], ignored: [], dropped: [], required: 1 });
    });

    it("숫자와 구분 문자뿐인 검색어에는 유연한 꼴이 없다", () => {
      // 버전이나 날짜를 적은 검색어다. 구분 문자의 자리를 유연하게 견주면 '03-21' 이 '0321' 과, '12.5' 가 '12 5' 와,
      // '21_0' 이 '210' 과 일치한다
      sqlite.addCompatibilitySoftwareBatch([
        named("Build 0321", "2018-01-01"),
        named("Kit 12 5", "2018-01-02"),
        named("Rev 210", "2018-01-03"),
      ]);
      for (const query of ["03-21", "12.5", "21_0", "2099-12-31"]) {
        expect(search(query), `query=${query}`).toEqual(nothingFor(query));
      }
    });

    it("검색어 그대로 일치하는 행이 있으면 유연한 꼴을 쓰지 않는다", () => {
      // 'SCP-SmartUI' 는 제품명에 그대로 들어 있다. 유연한 꼴은 띄어 쓴 'SCP SmartUI Plus' 와도 일치한다
      sqlite.addCompatibilitySoftwareBatch([named("SCP SmartUI Plus", "2031-01-01")]);
      const exact = search("SCP-SmartUI");
      expect(versionsOf(exact.rows)).toEqual(["SCP-SmartUI 1.0"]);
      expect(exact.matchMode).toBe("all-terms");
      // 대체 검색으로 넘어가도 같다
      const fallback = search("SCP-SmartUI 없는말");
      expect(versionsOf(fallback.rows)).toEqual(["SCP-SmartUI 1.0"]);
      expect(fallback.terms).toEqual({ used: ["SCP-SmartUI"], ignored: ["없는말"], dropped: [], required: 1 });
      // 어느 행에도 그대로 들어 있지 않은 표기로 적으면 유연한 꼴로 두 표기를 모두 찾는다
      expect(versionsOf(search("SCP_SmartUI").rows)).toEqual(["SCP SmartUI Plus 1.0", "SCP-SmartUI 1.0"]);
      // 버전처럼 '.' 이 든 검색어도 그대로 일치하면 그대로 쓴다
      expect(search("4.3 없는말").terms?.used).toEqual(["4.3"]);
    });

    it("조사를 뗀 꼴이 일치하는 행이 있어도 유연한 꼴을 쓰지 않는다", () => {
      sqlite.addCompatibilitySoftwareBatch([named("SCP SmartUI Plus", "2031-01-01")]);
      const result = search("SCP-SmartUI는 없는말");
      expect(versionsOf(result.rows)).toEqual(["SCP-SmartUI 1.0"]);
      expect(result.terms).toEqual({ used: ["SCP-SmartUI"], ignored: ["없는말"], dropped: [], required: 1 });
    });

    it("조사를 뗀 꼴의 유연한 꼴도 견주고, 쓴 검색어는 뗀 꼴로 싣는다", () => {
      const result = search("K2Web-Wizard는");
      expect(versionsOf(result.rows)).toEqual(["K2Web Wizard 1.0"]);
      expect(result.terms).toEqual({ used: ["K2Web-Wizard"], ignored: [], dropped: [], required: 1 });
    });

    it("검색어 그대로의 유연한 꼴을 조사를 뗀 꼴의 유연한 꼴보다 먼저 견준다", () => {
      // 'K2Web Wizard는' 이 적힌 행이 있으면 'K2Web-Wizard는' 은 그 행만 찾는다. 조사를 뗀 꼴의 유연한 꼴을 먼저 견주면
      // 'K2Web Wizard' 가 든 행이 모두 나오고 쓴 검색어도 'K2Web-Wizard' 가 된다
      sqlite.addCompatibilitySoftwareBatch([
        { ...named("Guide", "2031-01-01"), description: "K2Web Wizard는 저작 도구다" },
      ]);
      const result = search("K2Web-Wizard는");
      expect(versionsOf(result.rows)).toEqual(["Guide 1.0"]);
      expect(result.terms).toEqual({ used: ["K2Web-Wizard는"], ignored: [], dropped: [], required: 1 });
    });

    it("이름이 아닌 검색 컬럼에서 일치한 행도 찾고, 이름 컬럼에서 일치한 행을 먼저 돌려준다", () => {
      // 설명에만 'K2Web Wizard' 가 적힌 행은 확인일자가 더 최근이지만, 제품명에 든 행 뒤에 온다
      sqlite.addCompatibilitySoftwareBatch([
        { ...named("Addon", "2031-01-01"), description: "K2Web Wizard 와 함께 쓴다" },
      ]);
      expect(versionsOf(search("K2Web-Wizard").rows)).toEqual(["K2Web Wizard 1.0", "Addon 1.0"]);
    });

    it("유연한 꼴에는 프레임워크 버전과 확인일자를 견주는 조건을 두지 않는다", () => {
      const rowSelects = (query: string) =>
        statementsOf(sqlite, () => search(query)).filter((sql) => sql.endsWith("LIMIT ? OFFSET ?"));
      const flexible = rowSelects("K2Web-Wizard");
      expect(flexible).toHaveLength(1);
      expect(flexible[0]).not.toContain("cs.framework_version = ?");
      expect(flexible[0]).not.toContain("substr(cs.verified_date");
      // 검색어 그대로 견주는 조회 문에는 프레임워크 버전을 견주는 조건이 있다
      const exact = rowSelects("JEUS");
      expect(exact).toHaveLength(1);
      expect(exact[0]).toContain("cs.framework_version = ?");
    });

    it("같은 유연한 꼴이 되는 검색어는 한 번만 쓴다", () => {
      // 두 번 세면 쓸 수 있는 검색어가 셋이 되어 두 개 이상 일치해야 하고, 'Tibero' 하나만 든 Tibero 7 이 빠진다
      const result = search("K2Web-Wizard K2Web_Wizard Tibero");
      expect(versionsOf(result.rows)).toEqual(["Tibero 7", "K2Web Wizard 1.0"]);
      expect(result.terms).toEqual({ used: ["K2Web-Wizard", "Tibero"], ignored: [], dropped: [], required: 1 });
    });

    it("유연한 꼴로 쓴 검색어도 일치한 검색어 수에 센다", () => {
      // K2Web-Wizard·1.0·없는말 → 쓸 수 있는 검색어는 둘이고 하나 이상 일치하면 통과한다.
      // '1.0' 은 다섯 행의 버전 표기에 있고, 두 검색어가 모두 일치한 K2Web Wizard 가 맨 앞이다
      const result = search("K2Web-Wizard 1.0 없는말");
      expect(versionsOf(result.rows)[0]).toBe("K2Web Wizard 1.0");
      expect(result.total).toBe(5);
      expect(result.terms).toEqual({ used: ["K2Web-Wizard", "1.0"], ignored: ["없는말"], dropped: [], required: 1 });
    });

    it("유연한 꼴과 일치하는 행이 있는지는 필터를 적용한 대상 안에서 판단한다", () => {
      // 넣은 네 행은 모두 'CMS Solution' 이다. WAS 안에는 'K2Web Wizard' 가 없다
      expect(search("K2Web-Wizard", { category: "WAS" })).toEqual(nothingFor("K2Web-Wizard"));
      expect(versionsOf(search("K2Web-Wizard", { category: "CMS Solution" }).rows)).toEqual(["K2Web Wizard 1.0"]);
    });

    it("구분 문자가 수백 개인 검색어도 오류 없이 처리하고, 조회 문 수가 늘지 않는다", () => {
      // 조각마다 조회하던 때에는 구분 문자의 수만큼 조회가 늘었다. 유연한 꼴은 검색어 하나에 패턴 두 개다
      const many = Array.from({ length: 300 }, (_, index) => `p${index}`).join("-");
      expect(search(many)).toEqual(nothingFor(many));
      const statements = (query: string) => statementsOf(sqlite, () => search(query)).length;
      expect(statements(many)).toBe(statements("p0-p1"));
    });
  });

  describe("query 에 OR 가 있을 때", () => {
    const search = (query: string, filters = {}) => sqlite.queryCompatibleSoftware({ query, filters });

    it("모든 검색어가 일치하는 행이 있어도 검색어 가운데 하나 이상이 일치하는 행을 돌려준다", () => {
      // 'JEUS 4.3' 은 두 검색어가 모두 든 JEUS 21 한 행에서 끝난다
      expect(versionsOf(search("JEUS 4.3").rows)).toEqual(["JEUS 21"]);
      // OR 로 이으면 JEUS 가 든 행과 4.3 의 행을 모두 돌려준다. 둘 다 일치한 JEUS 21 이 맨 앞이다
      const result = search("JEUS OR 4.3");
      expect(versionsOf(result.rows)).toEqual(["JEUS 21", "JEUS 8.5", "SampleCMS 1.0"]);
      expect(result.total).toBe(3);
      expect(result.matchMode).toBe("any-term");
      expect(result.terms).toEqual({ used: ["JEUS", "4.3"], ignored: [], dropped: [], required: 1, orQuery: true });
    });

    it("OR 의 대소문자를 가리지 않는다", () => {
      const expected = search("JEUS OR 4.3");
      for (const query of ["JEUS or 4.3", "jeus Or 4.3", "JEUS oR 4.3", "(JEUS) OR '4.3'"]) {
        const result = search(query);
        expect(versionsOf(result.rows), `query=${query}`).toEqual(versionsOf(expected.rows));
        expect(result.terms?.orQuery, `query=${query}`).toBe(true);
      }
    });

    it("일치 기준은 처음부터 1 이다 (검색어의 절반이 아니다)", () => {
      // 네 검색어 가운데 절반(2) 이상이 든 행은 JEUS 21 하나다 (JEUS 와 4.3). 대체 검색은 그 기준을 채운 행이 있으면
      // 거기서 끝나지만, OR 가 있으면 처음부터 하나 이상이 일치하는 행을 찾는다
      const result = search("JEUS OR Tibero OR WebLogic OR 4.3");
      expect(result.terms).toEqual({
        used: ["JEUS", "Tibero", "WebLogic", "4.3"],
        ignored: [],
        dropped: [],
        required: 1,
        orQuery: true,
      });
      // 절반(2) 이상이 일치한 행(JEUS 21: JEUS 와 4.3)이 있어도 하나만 일치한 행을 함께 돌려준다
      expect(versionsOf(result.rows)).toEqual(["JEUS 21", "Tibero 7", "JEUS 8.5", "WebLogic 12c", "SampleCMS 1.0"]);
      // OR 가 없으면 절반 이상이 일치한 행에서 끝난다
      expect(versionsOf(search("JEUS Tibero WebLogic 4.3").rows)).toEqual(["JEUS 21"]);
    });

    it("흔한 검색어만 일치한 행도 돌려준다", () => {
      // '호환' 은 여섯 행 모두에 든 흔한 검색어다. 대체 검색은 가려 주는 검색어(JEUS)가 일치한 행만 돌려주지만
      expect(versionsOf(search("JEUS 호환 없는말").rows)).toEqual(["JEUS 21", "JEUS 8.5"]);
      // OR 로 이으면 '호환' 만 일치한 행도 돌려준다. 두 검색어가 모두 일치한 JEUS 두 행이 먼저다
      const result = search("JEUS OR 호환");
      expect(versionsOf(result.rows)).toEqual([
        "JEUS 21",
        "JEUS 8.5",
        "SampleCMS 1.0",
        "OtherCMS 2.0",
        "Tibero 7",
        "WebLogic 12c",
      ]);
      expect(result.total).toBe(CATALOGUE.length);
      expect(result.terms).toEqual({ used: ["JEUS", "호환"], ignored: [], dropped: [], required: 1, orQuery: true });
    });

    it("일치하는 행이 없는 검색어는 쓰지 않은 검색어로 돌려준다", () => {
      const result = search("JEUS OR 없는말");
      expect(versionsOf(result.rows)).toEqual(["JEUS 21", "JEUS 8.5"]);
      expect(result.matchMode).toBe("any-term");
      expect(result.terms).toEqual({ used: ["JEUS"], ignored: ["없는말"], dropped: [], required: 1, orQuery: true });
    });

    it("쓸 수 있는 검색어가 하나도 없으면 빈 결과이고 일치 기준은 0 이다", () => {
      expect(search("없는말 OR 다른말")).toEqual({
        rows: [],
        total: 0,
        matchMode: "any-term",
        terms: { used: [], ignored: ["없는말", "다른말"], dropped: [], required: 0, orQuery: true },
      });
    });

    it("한 글자 검색어는 두 글자 이상인 검색어가 있으면 쓰지 않는다", () => {
      // '8' 을 쓰면 JEUS 8.5 가 두 검색어와 일치해 맨 앞에 온다. 쓰지 않으므로 JEUS 두 행이 확인일자 순이다
      const result = search("JEUS OR 8");
      expect(versionsOf(result.rows)).toEqual(["JEUS 21", "JEUS 8.5"]);
      expect(result.terms).toEqual({ used: ["JEUS"], ignored: [], dropped: ["8"], required: 1, orQuery: true });
      // 모든 검색어가 한 글자이면 그대로 쓴다
      expect(search("T OR 9").terms).toEqual({ used: ["T"], ignored: ["9"], dropped: [], required: 1, orQuery: true });
    });

    it("영어 기능어와, 이름 컬럼에 든 행이 없는 대상 낱말은 OR 가 있어도 쓰지 않는다", () => {
      // 고정 데이터에는 제품명에 eGovFrame 이 든 행이 없다 (있을 때의 동작은 "가려 주지 못하는 낱말을 빼는 조건" 참조)
      const result = search("eGovFrame OR JEUS OR with");
      expect(versionsOf(result.rows)).toEqual(["JEUS 21", "JEUS 8.5"]);
      expect(result.terms).toEqual({
        used: ["JEUS"],
        ignored: [],
        dropped: ["eGovFrame", "with"],
        required: 1,
        orQuery: true,
      });
    });

    it("조사를 뗀 꼴과 유연한 꼴도 대체 검색과 같이 쓴다", () => {
      const result = search("JEUS는 OR Tibero를 OR Web-Logic");
      expect(result.terms).toEqual({
        used: ["JEUS", "Tibero", "Web-Logic"],
        ignored: [],
        dropped: [],
        required: 1,
        orQuery: true,
      });
      // 네 행 모두 검색어 하나씩과 일치한다 ('Web-Logic' 은 유연한 꼴로 'WebLogic' 과 일치한다)
      expect(versionsOf(result.rows)).toEqual(["JEUS 21", "Tibero 7", "JEUS 8.5", "WebLogic 12c"]);
    });

    it("필터를 함께 주면 필터를 적용한 대상 안에서 찾는다", () => {
      const result = search("JEUS OR Tibero", { category: "WAS" });
      expect(versionsOf(result.rows)).toEqual(["JEUS 21", "JEUS 8.5"]);
      expect(result.terms).toEqual({ used: ["JEUS"], ignored: ["Tibero"], dropped: [], required: 1, orQuery: true });
    });

    it("limit 과 offset 은 그 결과에 적용하고, 끝을 넘은 offset 에서도 total 과 matchMode 는 같다", () => {
      const page = sqlite.queryCompatibleSoftware({ query: "JEUS OR 호환", limit: 2, offset: 1 });
      expect(versionsOf(page.rows)).toEqual(["JEUS 8.5", "SampleCMS 1.0"]);
      expect(page.total).toBe(CATALOGUE.length);
      const beyond = sqlite.queryCompatibleSoftware({ query: "JEUS OR 호환", limit: 2, offset: 100 });
      expect(beyond.rows).toEqual([]);
      expect(beyond.total).toBe(CATALOGUE.length);
      expect(beyond.matchMode).toBe("any-term");
    });

    it("OR 뒤에 검색어가 없어도 OR 가 적힌 query 로 다룬다", () => {
      const result = search("JEUS OR");
      expect(versionsOf(result.rows)).toEqual(["JEUS 21", "JEUS 8.5"]);
      expect(result.matchMode).toBe("any-term");
      expect(result.terms).toEqual({ used: ["JEUS"], ignored: [], dropped: [], required: 1, orQuery: true });
    });

    it("OR 뿐인 query 에서는 검색어가 추출되지 않아 필터만 적용한 목록을 돌려준다", () => {
      const result = search("OR");
      expect(result.total).toBe(CATALOGUE.length);
      expect(result.matchMode).toBeUndefined();
      expect(result.terms).toBeUndefined();
    });

    it("AND, NOT, NEAR 는 검색어에서 빼기만 한다 (부정 검색과 근접 검색은 하지 않는다)", () => {
      for (const query of ["JEUS AND 4.3", "JEUS NOT 4.3", "JEUS NEAR 4.3", "jeus and 4.3"]) {
        const result = search(query);
        expect(versionsOf(result.rows), `query=${query}`).toEqual(["JEUS 21"]);
        expect(result.matchMode, `query=${query}`).toBe("all-terms");
        expect(result.terms, `query=${query}`).not.toHaveProperty("orQuery");
      }
    });

    it("OR 가 다른 낱말의 일부이면 해당하지 않는다", () => {
      // '오라클' 이 든 행은 WebLogic 하나다. 'Oracle', 'portal' 의 'or' 는 연산자가 아니다
      const result = search("Oracle 오라클");
      expect(result.terms).toEqual({ used: ["오라클"], ignored: ["Oracle"], dropped: [], required: 1 });
    });

    it("OR 가 없는 query 의 결과에는 orQuery 를 싣지 않는다", () => {
      for (const query of ["JEUS", "JEUS 4.3", "JEUS Tibero", "JEUS 호환 없는말", "없는말"]) {
        expect(search(query).terms, `query=${query}`).not.toHaveProperty("orQuery");
      }
    });

    it("배열을 돌려주는 메서드는 OR 를 따르지 않고 모든 검색어가 일치하는 행만 돌려준다", () => {
      // 이 메서드들의 결과는 찾은 방식의 표시 없이 쓰인다 (queryCompatibleSoftwareAllTerms 의 주석)
      expect(sqlite.queryCompatibleSoftwareAllTerms("JEUS OR 4.3")).toMatchObject({ total: 1 });
      expect(versionsOf(sqlite.fullTextSearchCompatibility("JEUS OR 4.3"))).toEqual(["JEUS 21"]);
      expect(sqlite.fullTextSearchCompatibility("JEUS OR Tibero")).toEqual([]);
    });
  });

  describe("쓴 검색어와 쓰지 않은 검색어 (terms)", () => {
    const termsOf = (query: string, filters = {}) => sqlite.queryCompatibleSoftware({ query, filters }).terms;

    it("모든 검색어가 일치하는 행을 찾았으면 검색어를 모두 used 로 돌려준다", () => {
      expect(termsOf("JEUS")).toEqual({ used: ["JEUS"], ignored: [], dropped: [], required: 1 });
      expect(termsOf("맥스 jeus")).toEqual({ used: ["맥스", "jeus"], ignored: [], dropped: [], required: 2 });
    });

    it("대체 검색에서는 일치하는 행이 없어 쓰지 않은 검색어를 ignored 로 돌려준다", () => {
      expect(termsOf("JEUS 호환 여부")).toEqual({ used: ["JEUS", "호환"], ignored: ["여부"], dropped: [], required: 1 });
      // query 에 적힌 순서를 지킨다
      expect(termsOf("추천 JEUS 문의 Tibero 여부")).toEqual({
        used: ["JEUS", "Tibero"],
        ignored: ["추천", "문의", "여부"],
        dropped: [],
        required: 1,
      });
    });

    it("조사를 떼어 쓴 검색어는 used 에 뗀 꼴로, 쓰지 않은 검색어는 ignored 에 적힌 꼴로 싣는다", () => {
      expect(termsOf("JEUS는")).toEqual({ used: ["JEUS"], ignored: [], dropped: [], required: 1 });
      expect(termsOf("JEUS는 티맥스는 없는말은")).toEqual({
        used: ["JEUS", "티맥스"],
        ignored: ["없는말은"],
        dropped: [],
        required: 1,
      });
      // 검색어 그대로 일치하는 행이 있으면 떼지 않는다 ('티베로' 는 '로' 로 끝난다)
      expect(termsOf("티베로 없는말")).toEqual({ used: ["티베로"], ignored: ["없는말"], dropped: [], required: 1 });
    });

    it("뗀 꼴이 다른 검색어와 같으면 used 에 한 번만 싣는다", () => {
      expect(termsOf("JEUS JEUS는 Tibero")).toEqual({ used: ["JEUS", "Tibero"], ignored: [], dropped: [], required: 1 });
      expect(termsOf("jeus는 JEUS Tibero")).toEqual({ used: ["jeus", "Tibero"], ignored: [], dropped: [], required: 1 });
    });

    it("쓸 검색어가 하나도 남지 않으면 used 는 비고 결과는 0건이다", () => {
      expect(sqlite.queryCompatibleSoftware({ query: "없는말 다른말" })).toEqual({
        rows: [],
        total: 0,
        matchMode: "any-term",
        terms: { used: [], ignored: ["없는말", "다른말"], dropped: [], required: 0 },
      });
    });

    it("필터를 적용한 대상 안에서 일치하는 행이 없는 검색어도 ignored 다", () => {
      expect(termsOf("JEUS WebLogic 맥스", { category: "DBMS" })).toEqual({
        used: ["맥스"],
        ignored: ["JEUS", "WebLogic"],
        dropped: [],
        required: 1,
      });
      // 필터가 없으면 세 검색어 모두 일치하는 행이 있다 (둘 이상 일치하는 행은 JEUS 두 행이다)
      expect(termsOf("JEUS WebLogic 맥스")).toEqual({
        used: ["JEUS", "WebLogic", "맥스"],
        ignored: [],
        dropped: [],
        required: 2,
      });
    });

    it("한 글자라서 뺀 검색어는 used 와 ignored 가 아니라 dropped 로 돌려준다", () => {
      // ignored 는 '일치하는 행이 없어' 쓰지 않은 검색어다. T 와 M 은 일치하는 행이 있지만 한 글자라서 뺐다
      expect(termsOf("T M 오라클")).toEqual({ used: ["오라클"], ignored: [], dropped: ["T", "M"], required: 1 });
      expect(termsOf("T M 오라클 없는말")).toEqual({
        used: ["오라클"],
        ignored: ["없는말"],
        dropped: ["T", "M"],
        required: 1,
      });
      // query 에 적힌 순서를 지킨다
      expect(termsOf("M 오라클 T")?.dropped).toEqual(["M", "T"]);
      // 한 글자 검색어까지 모두 일치한 행을 찾았으면 뺀 것이 없다
      expect(termsOf("JEUS 8")).toEqual({ used: ["JEUS", "8"], ignored: [], dropped: [], required: 2 });
      // 모든 검색어가 한 글자이면 그대로 쓰고, 일치하는 행이 없는 것은 ignored 다
      expect(termsOf("T M")).toEqual({ used: ["T", "M"], ignored: [], dropped: [], required: 2 });
      expect(termsOf("T 9")).toEqual({ used: ["T"], ignored: ["9"], dropped: [], required: 1 });
    });

    it("required 는 all-terms 에서는 쓴 검색어의 수, any-term 에서는 실제로 적용한 일치 기준이다", () => {
      // all-terms: 모든 검색어가 일치해야 하므로 쓴 검색어의 수와 같다
      expect(termsOf("티맥스 JEUS 4.0")?.required).toBe(3);
      // any-term: 절반(올림)을 채운 행이 있으면 그 기준, 없으면 낮춘 기준, 쓸 검색어가 없으면 0
      expect(termsOf("JEUS 8.5 Tibero 4.0")?.required).toBe(2);
      expect(termsOf("JEUS Tibero WebLogic")?.required).toBe(1);
      expect(termsOf("없는말 다른말")?.required).toBe(0);
    });

    it("검색어가 추출되지 않은 조회에는 terms 를 넣지 않는다", () => {
      expect(sqlite.queryCompatibleSoftware({ filters: { category: "WAS" } })).not.toHaveProperty("terms");
      expect(sqlite.queryCompatibleSoftware({ query: "?!" })).not.toHaveProperty("terms");
      expect(sqlite.queryCompatibleSoftware({ query: "AND or" })).not.toHaveProperty("terms");
    });
  });

  describe("필터", () => {
    it("query 없이 필터만 주면 확인일자가 최근인 순으로 돌려주고 matchMode 는 넣지 않는다", () => {
      const result = sqlite.queryCompatibleSoftware({ filters: { category: "WAS" } });
      expect(versionsOf(result.rows)).toEqual(["JEUS 21", "JEUS 8.5", "WebLogic 12c"]);
      expect(result.matchMode).toBeUndefined();
    });

    it("키워드와 필터를 모두 만족하는 행만 돌려준다", () => {
      const result = sqlite.queryCompatibleSoftware({ query: "JEUS", filters: { frameworkVersion: "4.3" } });
      expect(versionsOf(result.rows)).toEqual(["JEUS 21"]);
      expect(result.matchMode).toBe("all-terms");
    });

    it("minLevel 과 vendor, productName 필터도 키워드와 함께 적용한다", () => {
      // 'CMS' 는 카테고리 'CMS Solution' 의 두 행과 일치하고, 그중 레벨 2 는 OtherCMS 뿐이다
      expect(versionsOf(sqlite.queryCompatibleSoftware({ query: "CMS", filters: { minLevel: 2 } }).rows)).toEqual([
        "OtherCMS 2.0",
      ]);
      expect(versionsOf(sqlite.queryCompatibleSoftware({ query: "CMS", filters: { vendor: "샘플" } }).rows)).toEqual([
        "SampleCMS 1.0",
      ]);
      expect(
        versionsOf(sqlite.queryCompatibleSoftware({ query: "CMS", filters: { productName: "othercms" } }).rows),
      ).toEqual(["OtherCMS 2.0"]);
    });

    it("level 은 호환성 레벨이 그 값과 같은 행만 통과시킨다", () => {
      // 레벨 1 은 SampleCMS 하나다. minLevel 은 '이상' 비교라 레벨 1 인 행만 고를 수 없다
      expect(versionsOf(sqlite.queryCompatibleSoftware({ filters: { level: 1 } }).rows)).toEqual(["SampleCMS 1.0"]);
      expect(sqlite.queryCompatibleSoftware({ filters: { minLevel: 1 } }).total).toBe(CATALOGUE.length);
      const level2 = sqlite.queryCompatibleSoftware({ filters: { level: 2 } });
      expect(level2.total).toBe(CATALOGUE.length - 1);
      expect(versionsOf(level2.rows)).not.toContain("SampleCMS 1.0");
      expect(versionsOf(sqlite.searchCompatibleSoftware({ level: 1 }))).toEqual(["SampleCMS 1.0"]);
    });

    it("level 과 minLevel 을 함께 주면 둘 다 적용한다", () => {
      // 레벨이 1 이면서 2 이상인 행은 없다
      expect(sqlite.queryCompatibleSoftware({ filters: { level: 1, minLevel: 2 } })).toEqual({ rows: [], total: 0 });
      expect(versionsOf(sqlite.queryCompatibleSoftware({ filters: { level: 1, minLevel: 1 } }).rows)).toEqual([
        "SampleCMS 1.0",
      ]);
      expect(sqlite.queryCompatibleSoftware({ filters: { level: 2, minLevel: 2 } }).total).toBe(CATALOGUE.length - 1);
    });

    it("level 도 키워드 검색과 같은 문에서 적용한다", () => {
      // 'CMS' 는 SampleCMS(레벨 1)와 OtherCMS(레벨 2)에 일치한다
      const byLevel = (level: 1 | 2) =>
        versionsOf(sqlite.queryCompatibleSoftware({ query: "CMS", filters: { level } }).rows);
      expect(byLevel(1)).toEqual(["SampleCMS 1.0"]);
      expect(byLevel(2)).toEqual(["OtherCMS 2.0"]);
      // 대체 검색의 대상도 level 로 좁힌다: 'JEUS' 는 레벨 1 안에 없다
      const fallback = sqlite.queryCompatibleSoftware({ query: "JEUS CMS", filters: { level: 1 } });
      expect(versionsOf(fallback.rows)).toEqual(["SampleCMS 1.0"]);
      expect(fallback.terms).toEqual({ used: ["CMS"], ignored: ["JEUS"], dropped: [], required: 1 });
    });

    it("필터는 LIMIT 보다 먼저 적용한다", () => {
      // 필터를 나중에 적용하면 상위 1건(다른 버전)만 남긴 뒤 걸러 0건이 된다
      for (const frameworkVersion of ["4.0", "4.3"]) {
        const result = sqlite.queryCompatibleSoftware({ query: "JEUS", filters: { frameworkVersion }, limit: 1 });
        expect(result.rows.map((row) => row.framework_version)).toEqual([frameworkVersion]);
      }
    });

    it("필터까지 만족하는 행이 없으면 대체 검색으로 넘어가고, 거기에도 필터를 적용한다", () => {
      // '티맥스 JEUS' 는 JEUS 두 행과 일치하지만 둘 다 WAS 다.
      // 대체 검색: 티맥스(DBMS 안에 1행), JEUS(DBMS 안에 없음, 제외) → k=1, DBMS 행은 Tibero 뿐
      const result = sqlite.queryCompatibleSoftware({ query: "티맥스 JEUS", filters: { category: "DBMS" } });
      expect(versionsOf(result.rows)).toEqual(["Tibero 7"]);
      expect(result.matchMode).toBe("any-term");
    });

    it("필터를 적용한 대상 안에서 일치하는 행이 없는 검색어는 세지 않는다", () => {
      // 대상(DBMS)은 Tibero 한 행이다. JEUS(2행)와 WebLogic(1행)은 표에는 있지만 대상 안에는 없다 → k=1(맥스).
      // 표 전체에서 일치한 검색어를 모두 세면 k=3 이 되어, '맥스' 하나만 일치하는 Tibero 가 탈락한다
      const result = sqlite.queryCompatibleSoftware({ query: "JEUS WebLogic 맥스", filters: { category: "DBMS" } });
      expect(versionsOf(result.rows)).toEqual(["Tibero 7"]);
      expect(result.total).toBe(1);
      expect(result.matchMode).toBe("any-term");
    });

    it("문장으로 물으면서 필터를 함께 줘도 뜻이 있는 검색어로 찾는다", () => {
      // eGovFrame: 프레임워크 자체를 가리키는 낱말(뺌) / 에서·검증된·솔루션: 0행(제외) /
      // 4.3: 2행(대상 안에 1행) / CMS: 2행(대상 안에 1행) → k=2
      const result = sqlite.queryCompatibleSoftware({
        query: "eGovFrame 4.3 에서 검증된 CMS 솔루션",
        filters: { frameworkVersion: "4.3", category: "CMS Solution" },
      });
      expect(versionsOf(result.rows)).toEqual(["SampleCMS 1.0"]);
      expect(result.total).toBe(1);
      expect(result.matchMode).toBe("any-term");
      expect(result.terms).toEqual({
        used: ["4.3", "CMS"],
        ignored: ["에서", "검증된", "솔루션"],
        dropped: ["eGovFrame"],
        required: 1,
      });
    });

    it("많은 행에 든 검색어에 군말과 필터를 함께 줘도, 그 검색어만 줬을 때와 같은 행을 돌려준다", () => {
      // '호환' 은 여섯 행 모두에 들어 있다. 절반 넘게 일치하는 검색어를 버리던 때에는 '호환 솔루션' 이 0건이었다
      const filters = { frameworkVersion: "4.3" };
      const alone = sqlite.queryCompatibleSoftware({ query: "호환", filters });
      const withNoise = sqlite.queryCompatibleSoftware({ query: "호환 솔루션", filters });
      expect(versionsOf(alone.rows)).toEqual(["JEUS 21", "SampleCMS 1.0"]);
      expect(alone.matchMode).toBe("all-terms");
      expect(versionsOf(withNoise.rows)).toEqual(versionsOf(alone.rows));
      expect(withNoise.total).toBe(alone.total);
      expect(withNoise.matchMode).toBe("any-term");
    });

    it("필터를 적용한 대상 안에서도 일치 기준을 낮춰 찾는다", () => {
      // 레벨 2 인 다섯 행 안에서: JEUS(2행), Tibero(1행), WebLogic(1행) → k=3, 기준 2 를 채운 행이 없어 1 로 낮춘다
      const lowered = sqlite.queryCompatibleSoftware({ query: "JEUS Tibero WebLogic", filters: { minLevel: 2 } });
      expect(versionsOf(lowered.rows)).toEqual(["JEUS 21", "Tibero 7", "JEUS 8.5", "WebLogic 12c"]);
      expect(lowered.terms).toEqual({ used: ["JEUS", "Tibero", "WebLogic"], ignored: [], dropped: [], required: 1 });

      // 프레임워크 4.0 안에는 WebLogic 이 없다 → k=2(JEUS, Tibero), 기준 1
      const scoped = sqlite.queryCompatibleSoftware({
        query: "JEUS Tibero WebLogic",
        filters: { frameworkVersion: "4.0" },
      });
      expect(versionsOf(scoped.rows)).toEqual(["Tibero 7", "JEUS 8.5"]);
      expect(scoped.terms).toEqual({ used: ["JEUS", "Tibero"], ignored: ["WebLogic"], dropped: [], required: 1 });
    });

    it("대상 안에서 일치하는 검색어가 하나도 남지 않으면 빈 결과를 돌려준다", () => {
      // JEUS(2행)와 WebLogic(1행) 모두 DBMS 안에는 없다 → k=0
      const result = sqlite.queryCompatibleSoftware({ query: "JEUS WebLogic", filters: { category: "DBMS" } });
      expect(result).toEqual({
        rows: [],
        total: 0,
        matchMode: "any-term",
        terms: { used: [], ignored: ["JEUS", "WebLogic"], dropped: [], required: 0 },
      });
    });

    it("query 에서 검색어가 하나도 추출되지 않으면 query 가 없는 것으로 보고 필터만 적용한다", () => {
      for (const query of ["*", ".", "?!", '"-"', "   "]) {
        const result = sqlite.queryCompatibleSoftware({ query, filters: { frameworkVersion: "4.3" } });
        expect(versionsOf(result.rows), `query=${JSON.stringify(query)}`).toEqual(["JEUS 21", "SampleCMS 1.0"]);
        expect(result.matchMode).toBeUndefined();
      }
    });

    it("category 는 대소문자를 구분하지 않고 일치시킨다", () => {
      for (const category of ["WAS", "was", "Was"]) {
        const result = sqlite.queryCompatibleSoftware({ filters: { category } });
        expect(versionsOf(result.rows), `category=${category}`).toEqual(["JEUS 21", "JEUS 8.5", "WebLogic 12c"]);
      }
      expect(versionsOf(sqlite.queryCompatibleSoftware({ query: "티맥스", filters: { category: "dbms" } }).rows)).toEqual([
        "Tibero 7",
      ]);
      // 부분 일치는 아니다
      expect(sqlite.queryCompatibleSoftware({ filters: { category: "CMS" } }).rows).toEqual([]);
    });

    it("문자열 필터는 앞뒤 공백을 떼고 비교한다", () => {
      expect(versionsOf(sqlite.queryCompatibleSoftware({ filters: { category: " WAS\n" } }).rows)).toHaveLength(3);
      expect(versionsOf(sqlite.queryCompatibleSoftware({ filters: { frameworkVersion: " 4.3 " } }).rows)).toEqual([
        "JEUS 21",
        "SampleCMS 1.0",
      ]);
      expect(versionsOf(sqlite.queryCompatibleSoftware({ filters: { vendor: " 샘플벤더 " } }).rows)).toEqual([
        "SampleCMS 1.0",
      ]);
      expect(versionsOf(sqlite.queryCompatibleSoftware({ filters: { productName: "\tTibero " } }).rows)).toEqual([
        "Tibero 7",
      ]);
      // 공백뿐인 필터는 주지 않은 것과 같다
      expect(sqlite.queryCompatibleSoftware({ filters: { vendor: "   " } }).rows).toHaveLength(CATALOGUE.length);
    });

    it("productName 은 제품명 또는 제품 버전 표기에 부분 일치하면 통과시킨다", () => {
      // 응답에 표시되는 product_version('JEUS 8.5')을 그대로 넣어도 찾을 수 있어야 한다
      expect(versionsOf(sqlite.queryCompatibleSoftware({ filters: { productName: "JEUS 8.5" } }).rows)).toEqual([
        "JEUS 8.5",
      ]);
      expect(versionsOf(sqlite.queryCompatibleSoftware({ filters: { productName: "12c" } }).rows)).toEqual([
        "WebLogic 12c",
      ]);
      expect(versionsOf(sqlite.queryCompatibleSoftware({ filters: { productName: "JEUS" } }).rows)).toEqual([
        "JEUS 21",
        "JEUS 8.5",
      ]);
      // 키워드와 함께 줄 때도 같다
      expect(
        versionsOf(sqlite.queryCompatibleSoftware({ query: "티맥스", filters: { productName: "jeus 21" } }).rows),
      ).toEqual(["JEUS 21"]);
      // 버전 표기와 비교할 때도 와일드카드는 글자 그대로 본다 ('_' 가 공백과 일치하면 안 된다)
      expect(sqlite.queryCompatibleSoftware({ filters: { productName: "JEUS_8" } }).rows).toEqual([]);
    });

    it("searchCompatibleSoftware 는 같은 필터 조회 결과를 배열로 돌려준다", () => {
      expect(versionsOf(sqlite.searchCompatibleSoftware({ category: "WAS" }, 2))).toEqual(["JEUS 21", "JEUS 8.5"]);
      expect(sqlite.searchCompatibleSoftware()).toHaveLength(CATALOGUE.length);
    });
  });

  describe("vendor 필터의 법인 표기", () => {
    /** 같은 업체를 표기만 달리 적은 행. 제품 버전 표기로 구분한다 */
    const acts = (suffix: string, vendor: string): SoftwareSeed => ({
      ...CATALOGUE[5],
      product_name: `Acts ${suffix}`,
      product_version: `Acts ${suffix}`,
      vendor,
    });
    const SAME_VENDOR = [
      acts("half", "(주)아이액츠"),
      acts("symbol", "㈜아이액츠"),
      acts("word", "주식회사 아이액츠"),
      acts("full", "（주）아이액츠"),
      acts("tail", "아이액츠(주)"),
      acts("tailword", "아이액츠 주식회사"),
      acts("spaced", "㈜ 아이 액츠"),
      acts("bare", "아이액츠"),
    ];
    /** 이름이 비슷한 다른 업체 */
    const OTHER_VENDOR = acts("other", "(주)아이엑스");
    const ALL_SPELLINGS = versionsOf(SAME_VENDOR).sort();

    /** vendor 필터만 준 조회의 결과를 제품 버전 표기 순으로 */
    const byVendor = (vendor: string, query?: string) =>
      versionsOf(sqlite.queryCompatibleSoftware({ query, filters: { vendor } }).rows).sort();

    beforeEach(() => {
      sqlite.addCompatibilitySoftwareBatch([...SAME_VENDOR, OTHER_VENDOR]);
    });

    it("결과에 보이는 업체명을 어느 표기로 넣어도 그 업체의 행을 모두 찾는다", () => {
      // 글자 그대로 비교하던 때에는 넣은 표기의 행만 나왔다 ('(주)아이액츠' 는 한 행, '아이액츠' 는 여덟 행)
      for (const row of SAME_VENDOR) {
        expect(byVendor(row.vendor), `vendor=${row.vendor}`).toEqual(ALL_SPELLINGS);
      }
    });

    it("필터 값의 공백과 법인 표기의 자리도 가리지 않는다", () => {
      for (const vendor of ["아이 액츠", " ㈜ 아이액츠 ", "아이액츠㈜", "( 주 ) 아이액츠", "주식회사아이액츠", "아이액츠（주）"]) {
        expect(byVendor(vendor), `vendor=${vendor}`).toEqual(ALL_SPELLINGS);
      }
    });

    it("표기를 뗀 값을 부분 문자열로 비교한다", () => {
      expect(byVendor("액츠")).toEqual(ALL_SPELLINGS);
      expect(byVendor("(주)액츠")).toEqual(ALL_SPELLINGS);
      // '아이' 는 다른 업체 '(주)아이엑스' 에도 들어 있다
      expect(byVendor("㈜아이")).toEqual([...ALL_SPELLINGS, "Acts other"].sort());
      expect(byVendor("아이엑스")).toEqual(["Acts other"]);
      // 고정 데이터의 '(주)티맥스소프트' 는 '주식회사 티맥스소프트' 로도 찾는다
      expect(byVendor("주식회사 티맥스소프트")).toEqual(["JEUS 21", "JEUS 8.5"]);
      expect(byVendor("없는업체(주)")).toEqual([]);
    });

    it("영문자의 대소문자는 지금처럼 가리지 않는다", () => {
      sqlite.addCompatibilitySoftwareBatch([acts("latin", "LG CNS Korea(주)")]);
      for (const vendor of ["LG CNS", "lg cns", "LGCNS", "㈜lg cns korea", "Cns Kor"]) {
        expect(byVendor(vendor), `vendor=${vendor}`).toEqual(["Acts latin"]);
      }
    });

    it("법인 표기만 적은 값은 떼지 않고 글자 그대로 비교한다", () => {
      // 떼면 빈 값이 되어 모든 행과 일치한다. 그 표기가 적힌 행을 찾는 것으로 본다
      expect(byVendor("(주)")).toEqual(["Acts half", "Acts other", "Acts tail", "JEUS 21", "JEUS 8.5", "Tibero 7"]);
      expect(byVendor("㈜")).toEqual(["Acts spaced", "Acts symbol"]);
      expect(byVendor("주식회사")).toEqual(["Acts tailword", "Acts word"]);
      expect(byVendor("（주）")).toEqual(["Acts full"]);
      // 고정 데이터에 그렇게 적힌 행이 없는 조합
      expect(byVendor("㈜ 주식회사")).toEqual([]);
    });

    it("키워드 검색과 함께 줘도 같은 규칙으로 거른다", () => {
      expect(byVendor("㈜아이액츠", "Acts")).toEqual(ALL_SPELLINGS);
      // 대체 검색에서도 같다: 'Acts' 는 대상 안에 있고 '없는말' 은 없다
      const fallback = sqlite.queryCompatibleSoftware({ query: "Acts 없는말", filters: { vendor: "주식회사 아이액츠" } });
      expect(fallback.matchMode).toBe("any-term");
      expect(fallback.total).toBe(SAME_VENDOR.length);
    });

    it("필터 값의 LIKE 와일드카드는 표기를 뗀 뒤에도 글자 그대로 비교한다", () => {
      // '_' 가 와일드카드였다면 '아이액츠' 와 일치했을 것
      expect(byVendor("(주)아이_츠")).toEqual([]);
      expect(byVendor("아이%")).toEqual([]);
    });

    it("배열을 돌려주는 searchCompatibleSoftware 도 같다", () => {
      expect(versionsOf(sqlite.searchCompatibleSoftware({ vendor: "㈜아이액츠" })).sort()).toEqual(ALL_SPELLINGS);
    });
  });

  describe("LIKE 로 비교하는 필터(vendor, productName)에 쓸 수 없는 값", () => {
    const NO_ROWS = { rows: [], total: 0 };
    /** UTF-8 로 SQLite 의 LIKE 패턴 한도(50,000바이트)를 넘는 값 */
    const TOO_LONG = ["a".repeat(50000), "가".repeat(20000)];

    it("NUL 문자가 든 vendor 는 필터를 무시하지 않고 일치하는 행이 없는 조건으로 처리한다", () => {
      // SQLite 의 LIKE 는 패턴을 NUL 에서 끊어 읽는다. '\u0000티맥스' 는 '%' 만 남아 모든 행과 일치한다
      expect(sqlite.queryCompatibleSoftware({ filters: { vendor: "\u0000티맥스" } })).toEqual(NO_ROWS);
      expect(sqlite.queryCompatibleSoftware({ filters: { vendor: "\u0000" } })).toEqual(NO_ROWS);
      // NUL 뒤가 잘리면 '%티맥스소프트' 가 되어, 값에 없는 문자열인데도 그렇게 끝나는 벤더와 일치한다
      expect(sqlite.queryCompatibleSoftware({ filters: { vendor: "티맥스소프트\u0000없는말" } })).toEqual(NO_ROWS);
      // NUL 이 없는 같은 값은 그대로 찾는다
      expect(sqlite.queryCompatibleSoftware({ filters: { vendor: "티맥스" } }).total).toBe(3);
    });

    it("NUL 문자가 든 productName 도 같다 (제품명과 버전 표기 어느 쪽과도 일치하지 않는다)", () => {
      expect(sqlite.queryCompatibleSoftware({ filters: { productName: "\u0000JEUS" } })).toEqual(NO_ROWS);
      expect(sqlite.queryCompatibleSoftware({ filters: { productName: "JEUS\u0000" } })).toEqual(NO_ROWS);
      expect(sqlite.queryCompatibleSoftware({ filters: { productName: "JEUS" } }).total).toBe(2);
    });

    it("키워드 검색과 함께 줘도 같다", () => {
      // 필터가 무시되면 'JEUS' 의 두 행이 그대로 나온다
      expect(sqlite.queryCompatibleSoftware({ query: "JEUS", filters: { vendor: "\u0000티맥스" } })).toEqual({
        ...NO_ROWS,
        matchMode: "any-term",
        terms: { used: [], ignored: ["JEUS"], dropped: [], required: 0 },
      });
      expect(sqlite.queryCompatibleSoftware({ query: "티맥스", filters: { productName: "\u0000" } }).total).toBe(0);
      // 다른 검색어로 물어도 같다
      expect(sqlite.queryCompatibleSoftware({ query: "오라클", filters: { vendor: "\u0000" } }).total).toBe(0);
    });

    it("LIKE 패턴 길이 한도를 넘는 값은 오류 없이 일치하는 행이 없는 조건으로 처리한다", () => {
      for (const value of TOO_LONG) {
        const bytes = Buffer.byteLength(value, "utf8");
        expect(sqlite.queryCompatibleSoftware({ filters: { vendor: value } }), `vendor ${bytes}바이트`).toEqual(NO_ROWS);
        expect(
          sqlite.queryCompatibleSoftware({ filters: { productName: value } }),
          `productName ${bytes}바이트`,
        ).toEqual(NO_ROWS);
        expect(
          sqlite.queryCompatibleSoftware({ query: "JEUS", filters: { vendor: value } }).total,
          `query + vendor ${bytes}바이트`,
        ).toBe(0);
        expect(
          sqlite.queryCompatibleSoftware({ query: "오라클", filters: { productName: value } }).total,
          `query + productName ${bytes}바이트`,
        ).toBe(0);
      }
    });

    it("길이 한도는 값이 아니라 패턴('%값%')의 바이트 수로 따진다", () => {
      // 패턴이 정확히 50,000바이트가 되는 값(49,998바이트)까지는 SQLite 가 비교할 수 있으므로 그대로 찾는다
      const longest = "a".repeat(49998);
      sqlite.addCompatibilitySoftwareBatch([
        { ...CATALOGUE[0], product_name: "LongVendor", product_version: "LongVendor 1.0", vendor: longest },
      ]);
      expect(versionsOf(sqlite.queryCompatibleSoftware({ filters: { vendor: longest } }).rows)).toEqual([
        "LongVendor 1.0",
      ]);
      // 한 바이트만 넘어도 오류 없이 0건이다
      expect(sqlite.queryCompatibleSoftware({ filters: { vendor: `${longest}a` } })).toEqual(NO_ROWS);
      // 이스케이프로 늘어난 길이도 패턴에 들어간다 ('%' 25,000개 → 50,002바이트)
      expect(sqlite.queryCompatibleSoftware({ filters: { vendor: "%".repeat(25000) } })).toEqual(NO_ROWS);
    });

    it("배열을 돌려주는 searchCompatibleSoftware 도 같다", () => {
      expect(sqlite.searchCompatibleSoftware({ vendor: "\u0000티맥스" })).toEqual([]);
      expect(sqlite.searchCompatibleSoftware({ productName: TOO_LONG[0] })).toEqual([]);
    });
  });

  describe("전체 건수와 페이지", () => {
    it("total 은 limit 과 무관하게 조건에 맞는 전체 건수다", () => {
      const result = sqlite.queryCompatibleSoftware({ filters: { category: "WAS" }, limit: 2 });
      expect(versionsOf(result.rows)).toEqual(["JEUS 21", "JEUS 8.5"]);
      expect(result.total).toBe(3);
      expect(sqlite.queryCompatibleSoftware().total).toBe(CATALOGUE.length);
    });

    it("offset 만큼 건너뛴 다음 행부터 돌려준다", () => {
      const result = sqlite.queryCompatibleSoftware({ filters: { category: "WAS" }, limit: 2, offset: 2 });
      expect(versionsOf(result.rows)).toEqual(["WebLogic 12c"]);
      expect(result.total).toBe(3);
    });

    it("키워드 검색(all-terms)에도 total 과 offset 을 적용한다", () => {
      const all = sqlite.queryCompatibleSoftware({ query: "표준프레임워크" });
      expect(all.total).toBe(CATALOGUE.length);
      expect(all.matchMode).toBe("all-terms");

      const paged = [0, 2, 4].flatMap(
        (offset) => sqlite.queryCompatibleSoftware({ query: "표준프레임워크", limit: 2, offset }).rows,
      );
      expect(versionsOf(paged)).toEqual(versionsOf(all.rows));
    });

    it("대체 검색(any-term)에도 total 과 offset 을 적용한다", () => {
      const result = sqlite.queryCompatibleSoftware({ query: "JEUS Tibero", limit: 1, offset: 2 });
      expect(versionsOf(result.rows)).toEqual(["JEUS 8.5"]);
      expect(result.total).toBe(3);
      expect(result.matchMode).toBe("any-term");
    });

    it("offset 이 전체 건수를 넘으면 빈 페이지를 돌려주되, 검색 방식은 바꾸지 않는다", () => {
      const result = sqlite.queryCompatibleSoftware({ query: "JEUS", offset: 10 });
      expect(result.rows).toEqual([]);
      expect(result.total).toBe(2);
      expect(result.matchMode).toBe("all-terms");
    });

    it("확인일자가 같은 행이 있어도 페이지를 넘길 때 순서가 흔들리지 않는다", () => {
      sqlite.addCompatibilitySoftwareBatch(
        Array.from({ length: 5 }, (_, index) => ({
          ...CATALOGUE[5],
          product_name: `SameDay${index}`,
          product_version: `SameDay${index} 1.0`,
        })),
      );
      const all = sqlite.queryCompatibleSoftware();
      const paged = Array.from({ length: all.total }, (_, offset) =>
        sqlite.queryCompatibleSoftware({ limit: 1, offset }).rows,
      ).flat();
      expect(all.total).toBe(CATALOGUE.length + 5);
      expect(versionsOf(paged)).toEqual(versionsOf(all.rows));
      expect(new Set(versionsOf(paged)).size).toBe(all.total);
    });

    it("limit 과 offset 은 정수로 맞추고, 범위를 벗어난 값도 SQL 오류 없이 처리한다", () => {
      const count = (limit?: number, offset?: number) => sqlite.queryCompatibleSoftware({ limit, offset }).rows.length;
      expect(count(2.7)).toBe(2);
      expect(count(0)).toBe(1);
      expect(count(-5)).toBe(1);
      expect(count(1e300)).toBe(CATALOGUE.length);
      expect(count(undefined)).toBe(CATALOGUE.length);
      expect(count(undefined, -1)).toBe(CATALOGUE.length);
      expect(count(undefined, 1.9)).toBe(CATALOGUE.length - 1);
      expect(count(undefined, Number.NaN)).toBe(CATALOGUE.length);
      expect(count(undefined, 1e300)).toBe(0);
      // 키워드 검색 경로도 같다
      expect(sqlite.queryCompatibleSoftware({ query: "JEUS", limit: 1.5, offset: 0.5 }).rows).toHaveLength(1);
    });
  });

  describe("확인일자 순 정렬 (verified_date 에 날짜가 아닌 값이 든 행)", () => {
    // 적재 순서는 Old, Vendor, New, Url 이다. 문자열 내림차순으로는 Vendor('㈜…'), Url('https…'), New, Old 가 된다
    const NEWEST_FIRST = ["Dated New 1.0", "Dated Old 1.0", "Dated Vendor 1.0", "Dated Url 1.0"];

    beforeEach(() => {
      sqlite.addCompatibilitySoftwareBatch(DATED);
    });

    it("최신순 목록의 첫 행은 가장 최근 날짜의 행이고, 날짜가 아닌 값은 맨 뒤로 간다", () => {
      const result = sqlite.queryCompatibleSoftware();
      expect(result.rows[0]).toMatchObject({ product_version: "Dated New 1.0", verified_date: "2025-12-31" });
      expect(result.rows.map((row) => row.verified_date)).toEqual([
        "2025-12-31",
        "2025-08-21",
        "2024-05-05",
        "2023-03-03",
        "2022-12-12",
        "2022-11-02",
        "2021-01-01",
        "2017-01-01",
        "㈜어떤회사",
        "https://vendor.example",
      ]);
    });

    it("필터 조회도 같은 순서를 따른다", () => {
      const result = sqlite.queryCompatibleSoftware({ filters: { category: "Date Check" } });
      expect(versionsOf(result.rows)).toEqual(NEWEST_FIRST);
      // 페이지를 나눠도 같다
      const paged = [0, 1, 2, 3].flatMap(
        (offset) => sqlite.queryCompatibleSoftware({ filters: { category: "Date Check" }, limit: 1, offset }).rows,
      );
      expect(versionsOf(paged)).toEqual(NEWEST_FIRST);
    });

    it("키워드 검색(all-terms)에서 일치한 검색어 수가 같은 행도 같은 순서를 따른다", () => {
      const result = sqlite.queryCompatibleSoftware({ query: "Dated" });
      expect(result.matchMode).toBe("all-terms");
      expect(versionsOf(result.rows)).toEqual(NEWEST_FIRST);
    });

    it("대체 검색(any-term)에서 일치한 검색어 수가 같은 행도 같은 순서를 따른다", () => {
      // 'ated' 는 Dated 네 행에만 있고, '없는말' 은 어느 행에도 없다
      const result = sqlite.queryCompatibleSoftware({ query: "ated 없는말" });
      expect(result.matchMode).toBe("any-term");
      expect(versionsOf(result.rows)).toEqual(NEWEST_FIRST);
    });

    it("배열을 돌려주는 메서드도 같은 순서를 따른다", () => {
      expect(versionsOf(sqlite.searchCompatibleSoftware({ category: "Date Check" }))).toEqual(NEWEST_FIRST);
      expect(versionsOf(sqlite.searchCompatibleSoftware({ category: "Date Check" }, 1))).toEqual(["Dated New 1.0"]);
      expect(versionsOf(sqlite.fullTextSearchCompatibility("Dated"))).toEqual(NEWEST_FIRST);
    });

    it("YYYY-MM-DD 꼴로 시작하는 값만 날짜로 본다", () => {
      const shaped = (suffix: string, verified_date: string) => ({
        ...DATED[0],
        product_name: `Shape ${suffix}`,
        product_version: `Shape ${suffix}`,
        category: "Shape Check",
        verified_date,
      });
      sqlite.addCompatibilitySoftwareBatch([
        shaped("dots", "2026.01.01"),
        shaped("short", "26-01-01"),
        shaped("suffix", "2020-02-02 재확인"),
        shaped("plain", "2020-03-03"),
      ]);
      // 날짜 꼴인 두 행이 먼저(최근 순), 나머지는 그 뒤에 문자열 내림차순으로 온다
      const result = sqlite.queryCompatibleSoftware({ filters: { category: "Shape Check" } });
      expect(versionsOf(result.rows)).toEqual(["Shape plain", "Shape suffix", "Shape short", "Shape dots"]);
    });
  });

  describe("확인일자가 같은 행의 순서 (id 순)", () => {
    // SAME_DAY 는 확인일자가 같은 네 행이고, 적재 순서(id 순)는 A, B, C, D 다.
    // 호환 레벨이 적재 순서와 엇갈려 있어(2, 1, 2, 1), minLevel 필터를 주면 SQLite 가 호환 레벨 인덱스를 따라
    // B, D, A, C 순으로 행을 읽는다. 정렬의 마지막 기준(id)이 없으면 읽은 순서가 그대로 결과가 된다.
    const BY_ID = ["Tied A 1.0", "Tied B 1.0", "Tied C 1.0", "Tied D 1.0"];

    beforeEach(() => {
      sqlite.addCompatibilitySoftwareBatch(SAME_DAY);
    });

    it("필터 조회는 확인일자가 같은 행을 id 순으로 돌려준다", () => {
      const filters = { minLevel: 1 as const, category: "Tie Check" };
      const result = sqlite.queryCompatibleSoftware({ filters });
      expect(new Set(result.rows.map((row) => row.verified_date))).toEqual(new Set(["2024-07-07"]));
      expect(versionsOf(result.rows)).toEqual(BY_ID);
      // 한 건씩 페이지를 넘겨도 같은 순서다
      const paged = [0, 1, 2, 3].flatMap(
        (offset) => sqlite.queryCompatibleSoftware({ filters, limit: 1, offset }).rows,
      );
      expect(versionsOf(paged)).toEqual(BY_ID);
      // 배열을 돌려주는 메서드도 같다
      expect(versionsOf(sqlite.searchCompatibleSoftware(filters))).toEqual(BY_ID);
    });

    it("키워드 검색(all-terms)은 일치한 검색어 수와 확인일자가 같은 행을 id 순으로 돌려준다", () => {
      const result = sqlite.queryCompatibleSoftware({ query: "Tied", filters: { minLevel: 1 } });
      expect(result.matchMode).toBe("all-terms");
      expect(versionsOf(result.rows)).toEqual(BY_ID);
      const paged = [0, 1, 2, 3].flatMap(
        (offset) => sqlite.queryCompatibleSoftware({ query: "Tied", filters: { minLevel: 1 }, limit: 1, offset }).rows,
      );
      expect(versionsOf(paged)).toEqual(BY_ID);
      expect(versionsOf(sqlite.fullTextSearchCompatibility("Tied"))).toEqual(BY_ID);
    });

    it("대체 검색(any-term)은 일치한 검색어 수와 확인일자가 같은 행을 id 순으로 돌려준다", () => {
      // 'ied' 는 Tied 네 행에만 있고, '없는말' 은 어느 행에도 없다
      const result = sqlite.queryCompatibleSoftware({ query: "ied 없는말", filters: { minLevel: 1 } });
      expect(result.matchMode).toBe("any-term");
      expect(versionsOf(result.rows)).toEqual(BY_ID);
      const paged = [0, 1, 2, 3].flatMap(
        (offset) =>
          sqlite.queryCompatibleSoftware({ query: "ied 없는말", filters: { minLevel: 1 }, limit: 1, offset }).rows,
      );
      expect(versionsOf(paged)).toEqual(BY_ID);
    });

    it("행을 돌려주는 조회 문은 세 경로 모두 정렬의 마지막 기준으로 id 를 둔다", () => {
      // 지금의 SQLite 는 정렬 기준이 모두 같은 행을 읽은 순서대로 내고, 필터가 없으면 표를 rowid(= id) 순으로
      // 읽는다. 그래서 그 경로는 id 기준을 빼도 결과가 달라지지 않아, 위 테스트처럼 결과만 봐서는 빠진 것을
      // 알 수 없다. SQL 은 정렬 기준이 같은 행의 순서를 보장하지 않으므로, 실행한 문에 id 기준이 있는지를
      // 직접 확인한다.
      const paths: Array<[string, () => unknown]> = [
        ["필터 조회", () => sqlite.queryCompatibleSoftware({ filters: { category: "Tie Check" } })],
        ["키워드 검색(all-terms)", () => sqlite.queryCompatibleSoftware({ query: "Tied" })],
        ["대체 검색(any-term)", () => sqlite.queryCompatibleSoftware({ query: "ied 없는말" })],
      ];
      for (const [name, run] of paths) {
        const clauses = orderByClausesOf(sqlite, run);
        expect(clauses, name).toHaveLength(1);
        expect(clauses[0], name).toMatch(/, cs\.id(?: ASC)? LIMIT \? OFFSET \?$/);
      }
    });
  });

  describe("결과 행의 컬럼", () => {
    const PUBLIC_COLUMNS = [
      "product_name",
      "product_version",
      "framework_version",
      "category",
      "compatibility_level",
      "vendor",
      "verified_date",
      "description",
      "url",
    ];

    it("내부용 id 와 created_at 을 빼고 정해진 컬럼만 돌려준다", () => {
      const listed = sqlite.queryCompatibleSoftware({ filters: { category: "WAS" } });
      const allTerms = sqlite.queryCompatibleSoftware({ query: "JEUS" });
      const anyTerm = sqlite.queryCompatibleSoftware({ query: "오라클 없는말" });
      expect(allTerms.matchMode).toBe("all-terms");
      expect(anyTerm.matchMode).toBe("any-term");

      for (const result of [listed, allTerms, anyTerm]) {
        expect(result.rows.length).toBeGreaterThan(0);
        for (const row of result.rows) {
          expect(Object.keys(row)).toEqual(PUBLIC_COLUMNS);
        }
      }
    });

    it("배열을 돌려주는 기존 메서드는 id 를 유지한다 (행 전체를 돌려주는 메서드다)", () => {
      expect(sqlite.searchCompatibleSoftware({ category: "WAS" })[0]).toHaveProperty("id");
      expect(sqlite.fullTextSearchCompatibility("JEUS")[0]).toHaveProperty("id");
      expect(sqlite.fullTextSearchCompatibility("티맥스 Tibero")[0]).toHaveProperty("id");
    });
  });

  describe("필터에 쓸 수 있는 값 목록", () => {
    it("getFrameworkVersions 는 major, minor 를 정수로 비교해 최신 버전부터 돌려준다", () => {
      // 문자열로 정렬하면 3.10 이 3.2 와 3.9 보다 작은 값으로 취급된다
      sqlite.addCompatibilitySoftwareBatch(
        ["3.10", "3.9", "3.2", "3.1", "2.7"].map((framework_version) => ({
          ...CATALOGUE[0],
          product_name: `Extra ${framework_version}`,
          framework_version,
        })),
      );
      expect(sqlite.getFrameworkVersions()).toEqual(["4.3", "4.2", "4.0", "3.10", "3.9", "3.6", "3.2", "3.1", "2.7"]);
    });

    it("getCategories 는 카테고리 이름을 중복 없이 돌려준다", () => {
      expect(sqlite.getCategories()).toEqual(["CMS Solution", "DBMS", "WAS"]);
    });
  });

  describe("fullTextSearchCompatibility (배열을 돌려주는 기존 메서드)", () => {
    it("모든 검색어가 일치하는 행을 배열로 돌려준다", () => {
      expect(versionsOf(sqlite.fullTextSearchCompatibility("JEUS"))).toEqual(["JEUS 21", "JEUS 8.5"]);
      expect(versionsOf(sqlite.fullTextSearchCompatibility("티맥스 Tibero"))).toEqual(["Tibero 7"]);
      expect(sqlite.fullTextSearchCompatibility("표준프레임워크", 2)).toHaveLength(2);
    });

    it("조회와 같은 규칙으로 찾는다 (낱말의 가운데, 제품 버전 표기, 한 글자 검색어)", () => {
      expect(versionsOf(sqlite.fullTextSearchCompatibility("오라클"))).toEqual(["WebLogic 12c"]);
      expect(versionsOf(sqlite.fullTextSearchCompatibility("JEUS 21"))).toEqual(["JEUS 21"]);
      // 한 글자 검색어도 쓰고, 그렇게 해서 일치하는 행이 없을 때만 뺀다
      expect(versionsOf(sqlite.fullTextSearchCompatibility("JEUS 8"))).toEqual(["JEUS 8.5"]);
      expect(versionsOf(sqlite.fullTextSearchCompatibility("T M 오라클"))).toEqual(["WebLogic 12c"]);
      expect(sqlite.queryCompatibleSoftwareAllTerms("JEUS 9")).toMatchObject({ total: 2 });
    });

    it("모든 검색어가 일치하는 행이 없으면 대체 검색 결과를 돌려주지 않는다", () => {
      // 이 메서드는 결과를 찾은 방식(matchMode)을 알릴 수 없다. 대체 검색 결과를 섞어 돌려주면
      // 통합 검색의 호출부가 일부 검색어만 일치한 제품을 아무 표시 없이 싣게 된다.
      for (const query of ["JEUS Tibero", "JEUS 호환 여부", "오라클 제품 문의"]) {
        const fallback = sqlite.queryCompatibleSoftware({ query });
        expect(fallback.matchMode, `query=${query}`).toBe("any-term");
        expect(fallback.rows.length, `query=${query}`).toBeGreaterThan(0);

        expect(sqlite.fullTextSearchCompatibility(query), `query=${query}`).toEqual([]);
      }
    });

    it("조회 중 오류는 빈 배열로 가리지 않고 그대로 던진다", () => {
      connectionOf(sqlite).exec("DROP TABLE compatibility_software");
      expect(() => sqlite.fullTextSearchCompatibility("JEUS")).toThrow(/compatibility_software/);
    });

    it("queryCompatibleSoftwareAllTerms 는 같은 행과 함께 전체 일치 건수를 돌려준다", () => {
      // 여섯 행 모두의 설명에 든 낱말. limit 건만 돌려주고 total 로 전체 건수를 알린다
      const found = sqlite.queryCompatibleSoftwareAllTerms("표준프레임워크", 2);
      expect(versionsOf(found.rows)).toEqual(["JEUS 21", "SampleCMS 1.0"]);
      expect(found.total).toBe(CATALOGUE.length);
      expect(found.rows[0]).toHaveProperty("id");
      // 배열을 돌려주는 메서드는 이 결과의 rows 다
      expect(sqlite.fullTextSearchCompatibility("표준프레임워크", 2)).toEqual(found.rows);
      // limit 을 주지 않으면 20건까지다
      expect(sqlite.queryCompatibleSoftwareAllTerms("JEUS")).toMatchObject({ total: 2 });
    });

    it("queryCompatibleSoftwareAllTerms 도 대체 검색으로 넘어가지 않는다", () => {
      expect(sqlite.queryCompatibleSoftwareAllTerms("JEUS Tibero")).toEqual({ rows: [], total: 0 });
      expect(sqlite.queryCompatibleSoftwareAllTerms("?!")).toEqual({ rows: [], total: 0 });
    });

    it("검색어가 하나도 추출되지 않으면 빈 배열을 돌려준다", () => {
      expect(sqlite.fullTextSearchCompatibility("?!")).toEqual([]);
    });
  });
});
