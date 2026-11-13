/**
 * SQLiteManager 호환 소프트웨어 조회 단위 테스트
 *
 * 키워드 조회(queryCompatibleSoftware)의 동작을 고정한다.
 * 임시 디렉토리의 새 DB 만 사용한다 (knowledge-base/egovframe.db 에 의존하지 않음).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SQLiteManager } from "../../src/database/sqliteManager.js";
import { CATALOGUE, DATED, SAME_DAY, versionsOf } from "./_compatibilityFixture.js";
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

    it("제품명·제품 버전 표기·업체명·분류·설명에서 찾는다", () => {
      const found = (query: string) => versionsOf(sqlite.queryCompatibleSoftware({ query }).rows);
      expect(found("WebLog")).toEqual(["WebLogic 12c"]); // product_name
      expect(found("12c")).toEqual(["WebLogic 12c"]); // product_version 에만 있다
      expect(found("샘플벤")).toEqual(["SampleCMS 1.0"]); // vendor
      expect(found("DBMS")).toEqual(["Tibero 7"]); // category
      expect(found("3.6")).toEqual(["WebLogic 12c"]); // description 에만 있다
    });

    it("프레임워크 버전·확인일자 컬럼에서는 찾지 않는다", () => {
      // '4.2' 는 OtherCMS 의 framework_version 과 설명에 있지만, '2023-03-03' 은 verified_date 에만 있다
      expect(sqlite.queryCompatibleSoftware({ query: "2023-03-03" }).rows).toEqual([]);
      // framework_version 이 '4.3' 인 두 행은 설명에도 '4.3' 이 있어 찾힌다. 설명을 바꾼 행은 찾히지 않는다
      sqlite.addCompatibilitySoftwareBatch([
        { ...CATALOGUE[4], product_name: "NoVersionText", product_version: "NoVersionText 1.0", description: "설명 없음" },
      ]);
      expect(versionsOf(sqlite.queryCompatibleSoftware({ query: "4.3" }).rows)).toEqual(["JEUS 21", "SampleCMS 1.0"]);
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
      // '_' 가 와일드카드였다면 '티맥스소프트' 가 일치했을 것
      expect(sqlite.queryCompatibleSoftware({ query: "티맥_소프트" }).rows).toEqual([]);
      // '%' 는 구분자라 검색어에 남지 않는다 ('맥', '소프트' → '소프트' 만 쓴다)
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

  describe("한 글자 검색어", () => {
    it("두 글자 이상인 검색어가 있으면 한 글자 검색어는 쓰지 않는다", () => {
      // '8' 을 쓰면 설명이나 버전 표기에 8 이 든 JEUS 8.5 만 남는다
      const versioned = sqlite.queryCompatibleSoftware({ query: "JEUS 8" });
      expect(versionsOf(versioned.rows)).toEqual(["JEUS 21", "JEUS 8.5"]);
      expect(versioned.matchMode).toBe("all-terms");
      // T 와 M 은 각각 세 행(Tibero, SampleCMS, OtherCMS)에 들어 있지만 WebLogic 에는 없다
      const mixed = sqlite.queryCompatibleSoftware({ query: "T M 오라클" });
      expect(versionsOf(mixed.rows)).toEqual(["WebLogic 12c"]);
      expect(mixed.matchMode).toBe("all-terms");
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
      // 'T M': OtherCMS 는 이름에 둘 다, SampleCMS('m')와 Tibero('T')는 하나씩 들어 있다.
      // 이름에 일치한 수가 같은 SampleCMS 와 Tibero 는 확인일자가 최근인 순이다
      const result = sqlite.queryCompatibleSoftware({ query: "T M" });
      expect(versionsOf(result.rows)).toEqual(["OtherCMS 2.0", "SampleCMS 1.0", "Tibero 7"]);
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

  describe("2단계: 대체 검색 (any-term)", () => {
    it("모든 검색어가 든 행이 없으면, 일치하는 행이 있는 검색어의 절반 이상이 든 행을 돌려준다", () => {
      // JEUS 와 Tibero 가 함께 든 행은 없다. 두 검색어 가운데 하나 이상이 든 행이 나온다
      const result = sqlite.queryCompatibleSoftware({ query: "JEUS Tibero" });
      expect(versionsOf(result.rows)).toEqual(["JEUS 21", "Tibero 7", "JEUS 8.5"]);
      expect(result.total).toBe(3);
      expect(result.matchMode).toBe("any-term");
    });

    it("남은 검색어의 절반 이상(올림)이 일치하는 행만 돌려준다", () => {
      // JEUS: 2행 / 8.5: 1행 / Tibero: 1행 / 여부: 0행(제외) → k=3, 두 개 이상 일치해야 통과
      const result = sqlite.queryCompatibleSoftware({ query: "JEUS 8.5 Tibero 여부" });
      expect(versionsOf(result.rows)).toEqual(["JEUS 8.5"]);
      expect(result.matchMode).toBe("any-term");
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

    it("많은 행에 들어 있는 검색어도 빼지 않는다 (일치한 검색어가 많은 행이 앞에 올 뿐이다)", () => {
      // 전체 행의 절반 넘게 일치하는 검색어를 버리던 때에는 '호환'(여섯 행 모두)이 빠져 JEUS 두 행만 나왔고,
      // '호환 추천' 처럼 남는 검색어가 없으면 0건이었다
      const sentence = sqlite.queryCompatibleSoftware({ query: "JEUS 호환 여부" });
      expect(versionsOf(sentence.rows)).toEqual([
        "JEUS 21",
        "JEUS 8.5",
        "SampleCMS 1.0",
        "OtherCMS 2.0",
        "Tibero 7",
        "WebLogic 12c",
      ]);
      expect(sentence.total).toBe(CATALOGUE.length);
      expect(sentence.matchMode).toBe("any-term");

      const common = sqlite.queryCompatibleSoftware({ query: "호환 추천" });
      expect(common.total).toBe(CATALOGUE.length);
      expect(common.matchMode).toBe("any-term");
    });

    it("일치한 검색어 수가 많은 행을 먼저 돌려준다 (확인일자보다 앞선 기준이다)", () => {
      // JEUS 8.5 는 JEUS·8.5·4.0 세 개, Tibero 7 은 Tibero·4.0 두 개가 일치한다 (네 개가 모두 든 행은 없다).
      // 확인일자는 Tibero 7 이 더 최근이다. JEUS 21 은 하나만 일치해 기준(절반)에 못 미친다
      const result = sqlite.queryCompatibleSoftware({ query: "JEUS 8.5 Tibero 4.0" });
      expect(versionsOf(result.rows)).toEqual(["JEUS 8.5", "Tibero 7"]);
      expect(result.total).toBe(2);
      expect(result.matchMode).toBe("any-term");
    });

    it("일치한 검색어 수가 같으면 이름에 일치한 검색어가 많은 행을 먼저 돌려준다", () => {
      // Tibero·호환·없는말: Tibero 7 은 둘, 나머지 다섯 행은 '호환' 하나만 일치한다 (k=2, 하나 이상이면 통과).
      // 분류에만 'Tibero' 가 든 행을 넣으면 일치한 수는 Tibero 7 과 같지만 이름에는 없어 그 뒤에 온다
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
      expect(versionsOf(result.rows).slice(0, 3)).toEqual(["Tibero 7", "Addon 1.0", "JEUS 21"]);
      expect(result.total).toBe(CATALOGUE.length + 1);
    });

    it("한 글자 검색어뿐인 query 도 대체 검색에서 그대로 쓴다", () => {
      // T 는 세 행에 들어 있고 9 는 어느 행에도 없다 → k=1
      const result = sqlite.queryCompatibleSoftware({ query: "T 9" });
      expect(versionsOf(result.rows)).toEqual(["OtherCMS 2.0", "Tibero 7", "SampleCMS 1.0"]);
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

  describe("쓴 검색어와 쓰지 않은 검색어 (terms)", () => {
    const termsOf = (query: string, filters = {}) => sqlite.queryCompatibleSoftware({ query, filters }).terms;

    it("모든 검색어가 일치하는 행을 찾았으면 검색어를 모두 used 로 돌려준다", () => {
      expect(termsOf("JEUS")).toEqual({ used: ["JEUS"], ignored: [] });
      expect(termsOf("맥스 jeus")).toEqual({ used: ["맥스", "jeus"], ignored: [] });
    });

    it("대체 검색에서는 일치하는 행이 없어 쓰지 않은 검색어를 ignored 로 돌려준다", () => {
      expect(termsOf("JEUS 호환 여부")).toEqual({ used: ["JEUS", "호환"], ignored: ["여부"] });
      // query 에 적힌 순서를 지킨다
      expect(termsOf("추천 JEUS 문의 Tibero 여부")).toEqual({
        used: ["JEUS", "Tibero"],
        ignored: ["추천", "문의", "여부"],
      });
    });

    it("조사를 떼어 쓴 검색어는 used 에 뗀 꼴로, 쓰지 않은 검색어는 ignored 에 적힌 꼴로 싣는다", () => {
      expect(termsOf("JEUS는")).toEqual({ used: ["JEUS"], ignored: [] });
      expect(termsOf("JEUS는 티맥스는 없는말은")).toEqual({ used: ["JEUS", "티맥스"], ignored: ["없는말은"] });
      // 검색어 그대로 일치하는 행이 있으면 떼지 않는다 ('티베로' 는 '로' 로 끝난다)
      expect(termsOf("티베로 없는말")).toEqual({ used: ["티베로"], ignored: ["없는말"] });
    });

    it("뗀 꼴이 다른 검색어와 같으면 used 에 한 번만 싣는다", () => {
      expect(termsOf("JEUS JEUS는 Tibero")).toEqual({ used: ["JEUS", "Tibero"], ignored: [] });
      expect(termsOf("jeus는 JEUS Tibero")).toEqual({ used: ["jeus", "Tibero"], ignored: [] });
    });

    it("쓸 검색어가 하나도 남지 않으면 used 는 비고 결과는 0건이다", () => {
      expect(sqlite.queryCompatibleSoftware({ query: "없는말 다른말" })).toEqual({
        rows: [],
        total: 0,
        matchMode: "any-term",
        terms: { used: [], ignored: ["없는말", "다른말"] },
      });
    });

    it("필터를 적용한 대상 안에서 일치하는 행이 없는 검색어도 ignored 다", () => {
      expect(termsOf("JEUS WebLogic 맥스", { category: "DBMS" })).toEqual({
        used: ["맥스"],
        ignored: ["JEUS", "WebLogic"],
      });
      // 필터가 없으면 세 검색어 모두 일치하는 행이 있다 (둘 이상 일치하는 행은 JEUS 두 행이다)
      expect(termsOf("JEUS WebLogic 맥스")).toEqual({ used: ["JEUS", "WebLogic", "맥스"], ignored: [] });
    });

    it("두 글자 이상인 검색어가 있어 뺀 한 글자 검색어는 used 에도 ignored 에도 싣지 않는다", () => {
      // ignored 는 '일치하는 행이 없어' 쓰지 않은 검색어다. '8' 은 일치하는 행이 있지만 한 글자라서 뺐다
      expect(termsOf("JEUS 8")).toEqual({ used: ["JEUS"], ignored: [] });
      expect(termsOf("T M 오라클 없는말")).toEqual({ used: ["오라클"], ignored: ["없는말"] });
      // 모든 검색어가 한 글자이면 그대로 쓰고, 일치하는 행이 없는 것은 ignored 다
      expect(termsOf("T M")).toEqual({ used: ["T", "M"], ignored: [] });
      expect(termsOf("T 9")).toEqual({ used: ["T"], ignored: ["9"] });
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

    it("필터는 LIMIT 보다 먼저 적용한다", () => {
      // 필터를 나중에 적용하면 상위 1건(다른 버전)만 남긴 뒤 걸러 0건이 된다
      for (const frameworkVersion of ["4.0", "4.3"]) {
        const result = sqlite.queryCompatibleSoftware({ query: "JEUS", filters: { frameworkVersion }, limit: 1 });
        expect(result.rows.map((row) => row.framework_version)).toEqual([frameworkVersion]);
      }
    });

    it("필터까지 만족하는 행이 없으면 부분 일치 검색으로 넘어가고, 거기에도 필터를 적용한다", () => {
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
      // eGovFrame·에서·검증된·솔루션: 0행(제외) / 4.3: 2행(대상 안에 1행) / CMS: 2행(대상 안에 1행) → k=2
      const result = sqlite.queryCompatibleSoftware({
        query: "eGovFrame 4.3 에서 검증된 CMS 솔루션",
        filters: { frameworkVersion: "4.3", category: "CMS Solution" },
      });
      expect(versionsOf(result.rows)).toEqual(["SampleCMS 1.0"]);
      expect(result.total).toBe(1);
      expect(result.matchMode).toBe("any-term");
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

    it("대상 안에서 일치하는 검색어가 하나도 남지 않으면 빈 결과를 돌려준다", () => {
      // JEUS(2행)와 WebLogic(1행) 모두 DBMS 안에는 없다 → k=0
      const result = sqlite.queryCompatibleSoftware({ query: "JEUS WebLogic", filters: { category: "DBMS" } });
      expect(result).toEqual({
        rows: [],
        total: 0,
        matchMode: "any-term",
        terms: { used: [], ignored: ["JEUS", "WebLogic"] },
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
        terms: { used: [], ignored: ["JEUS"] },
      });
      expect(sqlite.queryCompatibleSoftware({ query: "티맥스", filters: { productName: "\u0000" } }).total).toBe(0);
      // 부분 일치 대체 검색으로 넘어가는 질의도 같다
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

    it("부분 일치 대체 검색(any-term)에도 total 과 offset 을 적용한다", () => {
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

    it("배열을 돌려주는 기존 메서드는 id 를 유지한다 (id 로 중복을 걸러 내는 호출부가 있다)", () => {
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
      expect(versionsOf(sqlite.fullTextSearchCompatibility("JEUS 8"))).toEqual(["JEUS 21", "JEUS 8.5"]);
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

    it("검색어가 하나도 추출되지 않으면 빈 배열을 돌려준다", () => {
      expect(sqlite.fullTextSearchCompatibility("?!")).toEqual([]);
    });
  });
});
