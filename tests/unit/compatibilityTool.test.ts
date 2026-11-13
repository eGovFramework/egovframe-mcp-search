/**
 * 호환 소프트웨어 검색 도구(src/tools/compatibility.ts) 단위 테스트
 *
 * 도구 함수는 싱글톤 HybridDatabaseManager 를 통해 저장소의 knowledge-base 를 연다.
 * 테스트가 그 파일을 건드리지 않도록 hybridManager 모듈만 대역으로 바꾼다.
 * - SQLite 쪽은 임시 디렉토리의 새 DB 를 여는 실제 SQLiteManager 를 그대로 쓴다.
 * - 지식 쪽(LanceDB + 임베딩 모델)은 의미 검색(searchKnowledge)의 호출과 반환값만 흉내 낸다.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import { SQLiteManager } from "../../src/database/sqliteManager.js";
import { UserFacingError } from "../../src/utils/errors.js";
import { CATALOGUE, DATED, versionsOf, type SoftwareSeed } from "./_compatibilityFixture.js";

const hybrid = vi.hoisted(() => ({
  sqlite: undefined as unknown,
  /** initialize 가 성공한 뒤에만 true. 실제 매니저처럼 그 전에는 지식 매니저를 내주지 않는다 */
  initialized: false,
  initialize: vi.fn(async () => {}),
  /** 지식 매니저의 의미 검색 대역: (query, { limit }) 로 불리고, 가까운 순의 후보를 돌려준다 */
  searchKnowledge: vi.fn(async (_query: string, _options?: { limit?: number }): Promise<unknown[]> => []),
}));

vi.mock("../../src/database/hybridManager.js", () => {
  const manager = {
    getSQLite: () => hybrid.sqlite,
    // 실제 매니저처럼 이미 초기화했으면 다시 하지 않는다
    initialize: async () => {
      if (!hybrid.initialized) {
        await hybrid.initialize();
        hybrid.initialized = true;
      }
    },
    getKnowledge: () => {
      if (!hybrid.initialized) {
        throw new Error("데이터베이스가 초기화되지 않았습니다. initialize()를 먼저 호출하세요.");
      }
      return {
        searchKnowledge: (query: string, options?: { limit?: number }) => hybrid.searchKnowledge(query, options),
      };
    },
    // 실제 매니저의 구현 그대로: 가까운 5건만 가져온다
    findKnowledgeForSoftware: async (productName: string) => {
      await manager.initialize();
      return hybrid.searchKnowledge(productName, { limit: 5 });
    },
  };
  return {
    getHybridManager: () => manager,
    getInitializedHybridManager: async () => {
      await manager.initialize();
      return manager;
    },
  };
});

import { searchCompatibleSoftware } from "../../src/tools/compatibility.js";

/** describe 블록 하나가 쓸 임시 DB 를 만들고, 도구가 그 DB 를 보게 한다. */
function useCatalogue(rows: SoftwareSeed[]): { sqlite: () => SQLiteManager } {
  let tmpDir: string;
  let sqlite: SQLiteManager;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "egov-compat-tool-"));
    sqlite = new SQLiteManager(path.join(tmpDir, "egovframe.db"));
    sqlite.addCompatibilitySoftwareBatch(rows);
    hybrid.sqlite = sqlite;
  });

  afterAll(async () => {
    sqlite.close();
    await fs.remove(tmpDir);
  });

  return { sqlite: () => sqlite };
}

/** 의미 검색이 돌려주는 지식 한 건 */
const knowledge = (id: string, title: string, content: string) => ({
  id,
  type: "solution",
  title,
  content,
  tags: ["was"],
  importance: 3,
  score: 0.3,
  createdAt: "2026-01-01T00:00:00.000Z",
  metadata: {},
});

/** 응답의 relatedKnowledge 에 실리는 지식 한 건. excerpt 는 본문의 발췌다 (200자 이내의 본문은 그대로다) */
const listed = (id: string, title: string, excerpt: string) => ({
  id,
  title,
  excerpt,
  type: "solution",
  importance: 3,
  tags: ["was"],
});

/**
 * 의미 검색이 돌려줄 후보를 정한다 (가까운 순). 실제 검색처럼 요청한 limit 건까지만 돌려준다.
 * 함수를 주면 query(제품명)마다 후보를 달리 정할 수 있다.
 */
function setCandidates(candidates: unknown[] | ((query: string) => unknown[])): void {
  hybrid.searchKnowledge.mockImplementation(async (query, options) => {
    const all = typeof candidates === "function" ? candidates(query) : candidates;
    return all.slice(0, options?.limit ?? 5);
  });
}

/**
 * "CMS" 로 찾으면 31행이 나온다. 31행 모두 이름에 'CMS' 가 들어 있어 확인일자가 최근인 순으로 나오고,
 * 프레임워크 4.3 인 TargetCMS 는 확인일자가 가장 오래되어 맨 뒤(31번째)다.
 */
const CROWDED: SoftwareSeed[] = [
  ...Array.from({ length: 30 }, (_, index): SoftwareSeed => ({
    product_name: `FillerCMS${index}`,
    product_version: `FillerCMS${index} 1.0`,
    framework_version: "4.2",
    category: "CMS Solution",
    compatibility_level: 2,
    vendor: "필러벤더",
    verified_date: "2023-01-01",
    description: "CMS",
  })),
  {
    product_name: "TargetCMS",
    product_version: "TargetCMS 1.0",
    framework_version: "4.3",
    category: "CMS Solution",
    compatibility_level: 2,
    vendor: "LG CNS",
    verified_date: "2022-01-01",
    description: "CMS",
  },
];

/** 상한(100건)보다 많은 120행. 제품명은 모두 "Bulk" 로 시작한다. */
const BULK: SoftwareSeed[] = Array.from({ length: 120 }, (_, index): SoftwareSeed => ({
  product_name: `Bulk${index}`,
  product_version: `Bulk${index} 1.0`,
  framework_version: "4.3",
  category: "CMS Solution",
  compatibility_level: 2,
  vendor: "대량벤더",
  verified_date: "2024-01-01",
  description: "Bulk 제품",
}));

describe("searchCompatibleSoftware (호환 소프트웨어 검색 도구)", () => {
  beforeEach(() => {
    hybrid.initialized = false;
    hybrid.initialize.mockClear();
    hybrid.searchKnowledge.mockReset();
    setCandidates([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("matchMode", () => {
    useCatalogue(CATALOGUE);

    it("모든 검색어가 일치하는 행을 찾으면 all-terms 를 알린다", async () => {
      const response = await searchCompatibleSoftware({ query: "JEUS" });
      expect(versionsOf(response.software).sort()).toEqual(["JEUS 21", "JEUS 8.5"]);
      expect(response.matchMode).toBe("all-terms");
    });

    it("모든 검색어가 든 행이 없어 대체 검색으로 찾았으면 any-term 을 알린다", async () => {
      // '여부' 는 어느 행에도 없다. JEUS 와 호환이 모두 든 두 행이 먼저고, '호환' 만 든 네 행이 뒤따른다
      const response = await searchCompatibleSoftware({ query: "JEUS 호환 여부" });
      expect(versionsOf(response.software).slice(0, 2)).toEqual(["JEUS 21", "JEUS 8.5"]);
      expect(response).toMatchObject({ total: CATALOGUE.length, count: CATALOGUE.length, matchMode: "any-term" });
    });

    it("조사가 붙은 제품명으로 물어도 찾는다", async () => {
      const response = await searchCompatibleSoftware({ query: "JEUS는 지원되나요" });
      expect(versionsOf(response.software)).toEqual(["JEUS 21", "JEUS 8.5"]);
      expect(response).toMatchObject({ total: 2, matchMode: "any-term" });
    });

    it("문장으로 물으면서 필터를 함께 줘도 뜻이 있는 검색어로 찾는다", async () => {
      // 에서·검증된·솔루션 은 어떤 행에도 없다. 이런 검색어까지 세면 일치 기준이 올라가 0건이 된다
      // ('eGovFrame' 은 프레임워크 자체를 가리키는 낱말이라 검색어로 쓰지 않는다)
      const response = await searchCompatibleSoftware({
        query: "eGovFrame 4.3 에서 검증된 CMS 솔루션",
        frameworkVersion: "4.3",
        category: "CMS Solution",
      });
      expect(versionsOf(response.software)).toEqual(["SampleCMS 1.0"]);
      expect(response).toMatchObject({ total: 1, count: 1, matchMode: "any-term" });
      expect(response).not.toHaveProperty("available");
    });

    it("query 가 없으면 matchMode 를 넣지 않는다", async () => {
      const response = await searchCompatibleSoftware({ frameworkVersion: "4.3" });
      expect(response.count).toBe(2);
      expect(response).not.toHaveProperty("matchMode");
    });
  });

  describe("쓰지 않은 검색어 (ignoredTerms)", () => {
    useCatalogue(CATALOGUE);

    it("일치하는 행이 없어 쓰지 않은 검색어를 알린다", async () => {
      const response = await searchCompatibleSoftware({ query: "JEUS 호환 여부 문의" });
      expect(response.matchMode).toBe("any-term");
      expect(response.ignoredTerms).toEqual(["여부", "문의"]);
    });

    it("필터를 적용한 대상 안에서 일치하는 행이 없는 검색어도 알린다", async () => {
      const response = await searchCompatibleSoftware({ query: "티맥스 JEUS", category: "DBMS" });
      expect(versionsOf(response.software)).toEqual(["Tibero 7"]);
      expect(response.ignoredTerms).toEqual(["JEUS"]);
    });

    it("결과가 0건이어도 알린다", async () => {
      const response = await searchCompatibleSoftware({ query: "없는제품이름 추천" });
      expect(response).toMatchObject({ total: 0, count: 0, matchMode: "any-term" });
      expect(response.ignoredTerms).toEqual(["없는제품이름", "추천"]);
    });

    it("모든 검색어를 썼으면 싣지 않는다", async () => {
      const responses = [
        await searchCompatibleSoftware({ query: "JEUS" }),
        // 조사를 떼어 쓴 검색어는 쓰지 않은 것이 아니다
        await searchCompatibleSoftware({ query: "JEUS는" }),
        // 대체 검색이어도 모든 검색어에 일치하는 행이 있다
        await searchCompatibleSoftware({ query: "JEUS Tibero" }),
      ];
      for (const response of responses) {
        expect(response.count).toBeGreaterThan(0);
        expect(response).not.toHaveProperty("ignoredTerms");
      }
    });

    it("키워드 검색을 하지 않았으면 싣지 않는다", async () => {
      expect(await searchCompatibleSoftware({ frameworkVersion: "4.3" })).not.toHaveProperty("ignoredTerms");
      expect(await searchCompatibleSoftware({ query: "*" })).not.toHaveProperty("ignoredTerms");
    });
  });

  describe("대체 검색에 쓴 검색어와 일치 기준 (usedTerms, requiredMatches)", () => {
    useCatalogue(CATALOGUE);

    it("대체 검색으로 찾았으면 쓴 검색어와 적용한 일치 기준을 알린다", async () => {
      // JEUS·8.5·Tibero 가운데 둘 이상이 든 행은 JEUS 8.5 하나다 ('여부' 는 어느 행에도 없다)
      const response = await searchCompatibleSoftware({ query: "JEUS 8.5 Tibero 여부" });
      expect(versionsOf(response.software)).toEqual(["JEUS 8.5"]);
      expect(response).toMatchObject({
        matchMode: "any-term",
        usedTerms: ["JEUS", "8.5", "Tibero"],
        requiredMatches: 2,
        ignoredTerms: ["여부"],
      });
    });

    it("일치 기준을 낮춰 찾았으면 낮춘 기준을 알린다", async () => {
      // 제품명 셋을 나열하면 둘 이상이 함께 든 행이 없다. 하나만 일치한 행이라는 것을 requiredMatches 로 알 수 있다
      const response = await searchCompatibleSoftware({ query: "JEUS Tibero WebLogic" });
      expect(versionsOf(response.software)).toEqual(["JEUS 21", "Tibero 7", "JEUS 8.5", "WebLogic 12c"]);
      expect(response).toMatchObject({
        total: 4,
        matchMode: "any-term",
        usedTerms: ["JEUS", "Tibero", "WebLogic"],
        requiredMatches: 1,
      });
    });

    it("조사를 떼어 쓴 검색어는 뗀 꼴로 싣는다", async () => {
      const response = await searchCompatibleSoftware({ query: "JEUS는 지원되나요" });
      expect(response).toMatchObject({ usedTerms: ["JEUS"], requiredMatches: 1, ignoredTerms: ["지원되나요"] });
    });

    it("쓸 검색어가 하나도 없어 0건이면 빈 목록과 0 을 싣는다", async () => {
      const response = await searchCompatibleSoftware({ query: "없는제품이름 추천" });
      expect(response).toMatchObject({ total: 0, matchMode: "any-term", usedTerms: [], requiredMatches: 0 });
    });

    it("모든 검색어가 일치하는 행을 찾았으면 싣지 않는다", async () => {
      const response = await searchCompatibleSoftware({ query: "티맥스 JEUS" });
      expect(response.matchMode).toBe("all-terms");
      expect(response).not.toHaveProperty("usedTerms");
      expect(response).not.toHaveProperty("requiredMatches");
    });

    it("키워드 검색을 하지 않았으면 싣지 않는다", async () => {
      for (const response of [
        await searchCompatibleSoftware({ frameworkVersion: "4.3" }),
        await searchCompatibleSoftware({ query: "*" }),
      ]) {
        expect(response).not.toHaveProperty("usedTerms");
        expect(response).not.toHaveProperty("requiredMatches");
      }
    });
  });

  describe("검색에서 뺀 검색어 (droppedTerms)", () => {
    useCatalogue(CATALOGUE);

    it("한 글자라서 뺀 검색어를 알린다 (모든 검색어가 일치한 결과에도 싣는다)", async () => {
      // T 와 M 까지 든 행은 없어, 두 글자를 빼고 '오라클' 로 찾았다
      const response = await searchCompatibleSoftware({ query: "T M 오라클" });
      expect(versionsOf(response.software)).toEqual(["WebLogic 12c"]);
      expect(response).toMatchObject({ matchMode: "all-terms", droppedTerms: ["T", "M"] });
      expect(response).not.toHaveProperty("usedTerms");
      expect(response).not.toHaveProperty("ignoredTerms");
    });

    it("대체 검색 결과에서는 쓴 검색어, 일치하는 행이 없는 검색어와 구분해 싣는다", async () => {
      const response = await searchCompatibleSoftware({ query: "T M 오라클 없는말" });
      expect(response).toMatchObject({
        matchMode: "any-term",
        usedTerms: ["오라클"],
        requiredMatches: 1,
        ignoredTerms: ["없는말"],
        droppedTerms: ["T", "M"],
      });
    });

    it("영어 기능어와 프레임워크 자체를 가리키는 낱말도 뺀 검색어로 알린다", async () => {
      // Is, with: 영어 기능어 / eGovFrame: 목록의 모든 행에 해당하는 낱말. JEUS 와 4.3 이 모두 든 JEUS 21 이 맨 앞이다
      const sentence = await searchCompatibleSoftware({ query: "Is JEUS compatible with eGovFrame 4.3?" });
      expect(sentence).toMatchObject({
        matchMode: "any-term",
        usedTerms: ["JEUS", "4.3"],
        requiredMatches: 1,
        ignoredTerms: ["compatible"],
        droppedTerms: ["Is", "with", "eGovFrame"],
      });
      expect(sentence.software[0]).toMatchObject({ product_version: "JEUS 21" });

      // 남은 검색어가 모두 일치한 행을 찾았으면 all-terms 다
      const keywords = await searchCompatibleSoftware({ query: "eGovFrame 4.3 CMS" });
      expect(versionsOf(keywords.software)).toEqual(["SampleCMS 1.0"]);
      expect(keywords).toMatchObject({ matchMode: "all-terms", droppedTerms: ["eGovFrame"] });
    });

    it("뺀 검색어가 없으면 싣지 않는다", async () => {
      for (const response of [
        // 그런 낱말뿐이면 빼지 않는다
        await searchCompatibleSoftware({ query: "표준프레임워크" }),
        // 한 글자 검색어까지 모두 일치한 행을 찾았다
        await searchCompatibleSoftware({ query: "JEUS 8" }),
        await searchCompatibleSoftware({ query: "JEUS" }),
        await searchCompatibleSoftware({ query: "JEUS 호환 여부" }),
        await searchCompatibleSoftware({ frameworkVersion: "4.3" }),
        await searchCompatibleSoftware({ query: "*" }),
      ]) {
        expect(response).not.toHaveProperty("droppedTerms");
      }
    });
  });

  describe("query 때문에 0건일 때의 안내 (totalWithoutQuery)", () => {
    useCatalogue(CATALOGUE);

    it("필터 없이 query 만으로 0건이면 전체 건수를 알린다", async () => {
      const response = await searchCompatibleSoftware({ query: "없는제품이름" });
      expect(response).toMatchObject({ total: 0, count: 0, totalWithoutQuery: CATALOGUE.length });
    });

    it("필터만 적용하면 행이 있는데 query 때문에 0건이면 필터만 적용한 건수를 알린다", async () => {
      const byVersion = await searchCompatibleSoftware({ query: "없는제품이름", frameworkVersion: "4.3" });
      expect(byVersion).toMatchObject({ total: 0, totalWithoutQuery: 2 });

      // 'JEUS' 는 표에는 있지만 DBMS 안에는 없다. 필터 값은 유효하므로 available 은 붙지 않는다
      const byCategory = await searchCompatibleSoftware({ query: "JEUS", category: "DBMS" });
      expect(byCategory).toMatchObject({ total: 0, totalWithoutQuery: 1, ignoredTerms: ["JEUS"] });
      expect(byCategory).not.toHaveProperty("available");
    });

    it("검색어마다 일치하는 행이 있으면 0건이 되지 않으므로 싣지 않는다", async () => {
      // JEUS·Tibero·WebLogic 은 둘 이상이 함께 든 행이 없다. 일치 기준을 낮춰 하나씩 일치하는 행을 돌려준다.
      // 기준을 낮추지 않던 때에는 total 0 과 totalWithoutQuery 만 실려, 세 제품이 목록에 없는 것처럼 읽혔다
      const response = await searchCompatibleSoftware({ query: "JEUS Tibero WebLogic" });
      expect(response).toMatchObject({ total: 4, count: 4, matchMode: "any-term" });
      expect(response).not.toHaveProperty("totalWithoutQuery");
      expect(response).not.toHaveProperty("ignoredTerms");
    });

    it("필터만으로도 0건이면 싣지 않는다", async () => {
      // 데이터에 없는 버전: 쓸 수 있는 값(available)을 대신 알린다
      const unknown = await searchCompatibleSoftware({ query: "JEUS", frameworkVersion: "5.0" });
      expect(unknown.total).toBe(0);
      expect(unknown).not.toHaveProperty("totalWithoutQuery");
      expect(unknown).toHaveProperty("available");

      // 값은 모두 유효하지만 조합에 맞는 행이 없다
      const emptyCombination = await searchCompatibleSoftware({
        query: "JEUS",
        frameworkVersion: "3.6",
        category: "DBMS",
      });
      expect(emptyCombination.total).toBe(0);
      expect(emptyCombination).not.toHaveProperty("totalWithoutQuery");
    });

    it("결과가 있거나 키워드 검색을 하지 않았으면 싣지 않는다", async () => {
      expect(await searchCompatibleSoftware({ query: "JEUS" })).not.toHaveProperty("totalWithoutQuery");
      expect(await searchCompatibleSoftware({ query: "JEUS 없는말" })).not.toHaveProperty("totalWithoutQuery");
      expect(await searchCompatibleSoftware({ frameworkVersion: "5.0" })).not.toHaveProperty("totalWithoutQuery");
      expect(await searchCompatibleSoftware({ query: "*", frameworkVersion: "5.0" })).not.toHaveProperty(
        "totalWithoutQuery",
      );
    });

    it("결과가 있는 조회에서는 필터 전용 조회를 따로 하지 않는다", async () => {
      const query = vi.spyOn(hybrid.sqlite as SQLiteManager, "queryCompatibleSoftware");
      await searchCompatibleSoftware({ query: "JEUS" });
      expect(query).toHaveBeenCalledTimes(1);
    });
  });

  describe("검색어가 추출되지 않는 query", () => {
    useCatalogue(CATALOGUE);

    it("필터를 무효로 만들지 않고, query 가 없을 때와 같은 결과를 돌려준다", async () => {
      const expected = await searchCompatibleSoftware({ frameworkVersion: "4.3" });
      expect(versionsOf(expected.software)).toEqual(["JEUS 21", "SampleCMS 1.0"]);

      for (const query of ["*", ".", "?!"]) {
        const response = await searchCompatibleSoftware({ query, frameworkVersion: "4.3" });
        expect(versionsOf(response.software), `query=${query}`).toEqual(versionsOf(expected.software));
        expect(response).not.toHaveProperty("matchMode");
      }
    });

    it("필터도 없으면 전체 목록을 돌려준다", async () => {
      const response = await searchCompatibleSoftware({ query: "*" });
      expect(response.count).toBe(CATALOGUE.length);
    });
  });

  describe("필터 값 다듬기", () => {
    useCatalogue(CATALOGUE);

    it("frameworkVersion 의 앞 v 와 패치 자리를 떼고 major.minor 로 비교한다", async () => {
      for (const frameworkVersion of ["4.3", "v4.3", "V4.3", "4.3.0", "v4.3.1", " 4.3\n"]) {
        const response = await searchCompatibleSoftware({ frameworkVersion });
        expect(versionsOf(response.software), `frameworkVersion=${JSON.stringify(frameworkVersion)}`).toEqual([
          "JEUS 21",
          "SampleCMS 1.0",
        ]);
        // 응답은 실제로 적용한 값을 되돌려준다
        expect(response.filters.frameworkVersion).toBe("4.3");
      }
    });

    it("category 는 대소문자와 앞뒤 공백이 달라도 일치시킨다", async () => {
      for (const category of ["CMS Solution", "cms solution", " CMS SOLUTION "]) {
        const response = await searchCompatibleSoftware({ category });
        expect(versionsOf(response.software), `category=${JSON.stringify(category)}`).toEqual([
          "SampleCMS 1.0",
          "OtherCMS 2.0",
        ]);
      }
    });

    it("vendor 와 productName 의 앞뒤 공백을 뗀다", async () => {
      expect(versionsOf((await searchCompatibleSoftware({ vendor: " 샘플벤더 " })).software)).toEqual(["SampleCMS 1.0"]);
      expect(versionsOf((await searchCompatibleSoftware({ productName: " Tibero " })).software)).toEqual(["Tibero 7"]);
    });

    it("vendor 는 법인 표기가 달라도 찾되, 응답의 filters 에는 받은 값을 그대로 싣는다", async () => {
      // 고정 데이터의 업체명은 '(주)티맥스소프트' 다
      for (const vendor of ["주식회사 티맥스소프트", "㈜티맥스소프트", "티맥스소프트(주)"]) {
        const response = await searchCompatibleSoftware({ vendor });
        expect(versionsOf(response.software), `vendor=${vendor}`).toEqual(["JEUS 21", "JEUS 8.5"]);
        expect(response.filters, `vendor=${vendor}`).toEqual({ vendor });
      }
    });

    it("level 은 그 호환성 레벨의 행만 돌려주고 응답의 filters 에 싣는다", async () => {
      const response = await searchCompatibleSoftware({ level: 1 });
      expect(versionsOf(response.software)).toEqual(["SampleCMS 1.0"]);
      expect(response.filters).toEqual({ level: 1 });
      // minLevel 1 은 모든 행이다 ('이상' 비교)
      expect((await searchCompatibleSoftware({ minLevel: 1 })).total).toBe(CATALOGUE.length);
    });

    it("숫자가 아닌 level 과 minLevel 은 지정하지 않은 것으로 보고 filters 에 싣지 않는다", async () => {
      // 조회에는 적용하지 않으면서 응답의 filters 에만 실으면, 호출자는 걸러진 결과라고 읽는다
      const all = await searchCompatibleSoftware({});
      for (const value of ["1", null, true]) {
        const response = await searchCompatibleSoftware({ level: value as never, minLevel: value as never });
        expect(response.filters, String(value)).toEqual({});
        expect(response.total, String(value)).toBe(all.total);
      }
    });

    it("level 과 minLevel 을 함께 주면 둘 다 적용하고 둘 다 filters 에 싣는다", async () => {
      const response = await searchCompatibleSoftware({ level: 1, minLevel: 2 });
      expect(response).toMatchObject({ total: 0, count: 0, software: [] });
      expect(response.filters).toEqual({ level: 1, minLevel: 2 });
      // 필터 값은 모두 유효하므로 쓸 수 있는 값 안내는 붙지 않는다
      expect(response).not.toHaveProperty("available");

      const narrowed = await searchCompatibleSoftware({ query: "CMS", level: 2, minLevel: 1 });
      expect(versionsOf(narrowed.software)).toEqual(["OtherCMS 2.0"]);
    });

    it("공백뿐인 필터는 주지 않은 것으로 보고 응답의 filters 에도 넣지 않는다", async () => {
      const response = await searchCompatibleSoftware({ frameworkVersion: "  ", category: "", vendor: " " });
      expect(response.count).toBe(CATALOGUE.length);
      expect(response.filters).toEqual({});
    });

    it("vendor·productName 에 NUL 문자가 들었거나 지나치게 긴 값을 줘도 오류 없이 0건으로 응답한다", async () => {
      // NUL 이 든 값은 필터가 무시되어 전체가 나왔고, LIKE 패턴 한도(50,000바이트)를 넘는 값은 SQLite 오류가 났다
      for (const value of ["\u0000티맥스", "a".repeat(50000)]) {
        const label = `값 ${Buffer.byteLength(value, "utf8")}바이트`;
        const byVendor = await searchCompatibleSoftware({ query: "JEUS", vendor: value });
        expect(byVendor, label).toMatchObject({ success: true, total: 0, count: 0, software: [] });
        const byProduct = await searchCompatibleSoftware({ productName: value });
        expect(byProduct, label).toMatchObject({ success: true, total: 0, count: 0, software: [] });
        // 필터 값은 모두 유효한 꼴이므로 쓸 수 있는 값 안내는 붙지 않는다
        expect(byProduct, label).not.toHaveProperty("available");
      }
    });
  });

  describe("결과가 없을 때의 available 안내", () => {
    useCatalogue(CATALOGUE);

    const AVAILABLE = {
      frameworkVersions: ["4.3", "4.2", "4.0", "3.6"],
      categories: ["CMS Solution", "DBMS", "WAS"],
    };

    it("데이터에 없는 frameworkVersion 이면 쓸 수 있는 값을 알려 준다", async () => {
      const response = await searchCompatibleSoftware({ frameworkVersion: "5.0" });
      expect(response.count).toBe(0);
      expect(response.available).toEqual(AVAILABLE);
    });

    it("데이터에 없는 category 이면 쓸 수 있는 값을 알려 준다", async () => {
      const response = await searchCompatibleSoftware({ category: "CMS" });
      expect(response.count).toBe(0);
      expect(response.available).toEqual(AVAILABLE);
    });

    it("query 와 함께 줘도 알려 준다", async () => {
      const response = await searchCompatibleSoftware({ query: "JEUS", frameworkVersion: "4" });
      expect(response.count).toBe(0);
      expect(response.available).toEqual(AVAILABLE);
    });

    it("필터 값은 모두 유효한데 조합에 맞는 행이 없을 뿐이면 넣지 않는다", async () => {
      const response = await searchCompatibleSoftware({ frameworkVersion: "v3.6", category: "dbms" });
      expect(response.count).toBe(0);
      expect(response).not.toHaveProperty("available");
    });

    it("필터 없이 키워드만으로 결과가 없으면 넣지 않는다", async () => {
      const response = await searchCompatibleSoftware({ query: "없는제품이름" });
      expect(response.count).toBe(0);
      expect(response).not.toHaveProperty("available");
    });

    it("결과가 있으면 넣지 않는다", async () => {
      const response = await searchCompatibleSoftware({ frameworkVersion: "4.3" });
      expect(response.count).toBe(2);
      expect(response).not.toHaveProperty("available");
    });
  });

  describe("지식 쪽(LanceDB·임베딩 모델) 초기화", () => {
    useCatalogue(CATALOGUE);

    it("includeKnowledge 가 아니면 초기화하지 않는다 (SQLite 만으로 조회한다)", async () => {
      const filtered = await searchCompatibleSoftware({ frameworkVersion: "4.3" });
      const searched = await searchCompatibleSoftware({ query: "JEUS", includeKnowledge: false });
      expect(filtered.count).toBe(2);
      expect(searched.count).toBe(2);

      expect(hybrid.initialize).not.toHaveBeenCalled();
      expect(hybrid.searchKnowledge).not.toHaveBeenCalled();
      for (const response of [filtered, searched]) {
        expect(response).not.toHaveProperty("relatedKnowledge");
        expect(response).not.toHaveProperty("knowledgeLookup");
      }
    });

    it("includeKnowledge 가 true 이면 초기화한 뒤 제품명으로 관련 지식을 조회한다", async () => {
      const response = await searchCompatibleSoftware({ query: "JEUS", includeKnowledge: true });
      expect(response.count).toBe(2);

      expect(hybrid.initialize).toHaveBeenCalledTimes(1);
      expect(hybrid.searchKnowledge).toHaveBeenCalledTimes(1);
      expect(hybrid.searchKnowledge.mock.calls[0][0]).toBe("JEUS");
      // 초기화가 조회보다 먼저다
      expect(hybrid.initialize.mock.invocationCallOrder[0]).toBeLessThan(
        hybrid.searchKnowledge.mock.invocationCallOrder[0],
      );
    });

    it("includeKnowledge 가 true 여도 조회된 소프트웨어가 없으면 초기화하지 않는다", async () => {
      const response = await searchCompatibleSoftware({ frameworkVersion: "5.0", includeKnowledge: true });
      expect(response.count).toBe(0);
      expect(hybrid.initialize).not.toHaveBeenCalled();
      expect(hybrid.searchKnowledge).not.toHaveBeenCalled();
    });
  });

  describe("includeKnowledge 로 함께 돌려주는 관련 지식", () => {
    useCatalogue(CATALOGUE);

    it("제목이나 본문에 제품명이 들어 있는 지식만 남기고, 항목에 id 를 싣는다", async () => {
      setCandidates([
        knowledge("k-title", "JEUS 데이터소스 설정 문의", "설정 방법이 궁금합니다."),
        knowledge("k-content", "WAS 기동 오류", "JEUS 8 에서 기동할 때 오류가 납니다."),
        knowledge("k-unrelated", "게시판 샘플", "공통컴포넌트 게시판 샘플 문의"),
      ]);

      const response = await searchCompatibleSoftware({ query: "JEUS", includeKnowledge: true });

      expect(response.relatedKnowledge).toEqual([
        {
          product: "JEUS",
          knowledge: [
            listed("k-title", "JEUS 데이터소스 설정 문의", "설정 방법이 궁금합니다."),
            listed("k-content", "WAS 기동 오류", "JEUS 8 에서 기동할 때 오류가 납니다."),
          ],
        },
      ]);
      expect(response).not.toHaveProperty("knowledgeWarning");
    });

    it("제품명이 들어 있는 지식이 하나도 없는 제품은 항목을 넣지 않는다", async () => {
      // 벡터 검색은 관련이 없어도 항상 가까운 순으로 후보를 돌려준다
      setCandidates([
        knowledge("k1", "게시판 샘플", "공통컴포넌트 게시판 샘플 문의"),
        knowledge("k2", "로그인 암호화", "사용자 테이블 암호화 관련"),
      ]);

      const response = await searchCompatibleSoftware({ productName: "Tibero", includeKnowledge: true });

      expect(response.count).toBe(1);
      expect(response.relatedKnowledge).toEqual([]);
    });

    it("가까운 5건 밖에 있는 글도 제품명을 언급하면 찾는다 (후보를 50건까지 본다)", async () => {
      // 제품명이 짧으면 의미 검색의 앞 순위는 다른 글이 차지한다. 제품을 언급하는 글은 9번째와 11번째에 있다
      const candidates = Array.from({ length: 60 }, (_, index) =>
        knowledge(`k${index + 1}`, `WAS 일반 문의 ${index + 1}`, "서버 설정 문의"),
      );
      candidates[8] = knowledge("k9", "JEUS 세션 클러스터링", "세션이 공유되지 않습니다.");
      candidates[10] = knowledge("k11", "배포 오류", "JEUS 21 에 배포할 때 오류가 납니다.");
      // 51번째 이후는 보지 않는다
      candidates[50] = knowledge("k51", "JEUS 로그 설정", "로그 경로를 바꾸고 싶습니다.");
      setCandidates(candidates);

      const response = await searchCompatibleSoftware({ query: "JEUS", includeKnowledge: true });

      expect(hybrid.searchKnowledge).toHaveBeenCalledWith("JEUS", { limit: 50 });
      expect(response.relatedKnowledge).toEqual([
        {
          product: "JEUS",
          knowledge: [
            listed("k9", "JEUS 세션 클러스터링", "세션이 공유되지 않습니다."),
            listed("k11", "배포 오류", "JEUS 21 에 배포할 때 오류가 납니다."),
          ],
        },
      ]);
    });

    it("제품명을 언급하는 글이 많으면 가까운 순으로 5건만 싣는다", async () => {
      setCandidates(
        Array.from({ length: 30 }, (_, index) =>
          // 짝수 번째만 제품을 언급한다
          knowledge(`k${index + 1}`, index % 2 === 1 ? `JEUS 문의 ${index + 1}` : `다른 문의 ${index + 1}`, "본문"),
        ),
      );

      const response = await searchCompatibleSoftware({ query: "JEUS", includeKnowledge: true });

      expect(response.relatedKnowledge?.[0].knowledge.map((item) => item.id)).toEqual(["k2", "k4", "k6", "k8", "k10"]);
    });

    it("한 제품의 지식 조회가 실패해도 소프트웨어 결과와 나머지 제품의 지식은 돌려준다", async () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      hybrid.searchKnowledge.mockImplementation(async (productName: string) => {
        if (productName === "JEUS") {
          throw new Error("lance error: LanceError(IO): Permission denied, /Users/someone/secret/local.rs:124:24");
        }
        return [knowledge("k-tibero", "Tibero 연결 설정", "Tibero 7 JDBC 설정")];
      });

      const response = await searchCompatibleSoftware({ query: "티맥스", includeKnowledge: true });

      expect(response.success).toBe(true);
      expect(versionsOf(response.software).sort()).toEqual(["JEUS 21", "JEUS 8.5", "Tibero 7"]);
      expect(response.relatedKnowledge).toEqual([
        { product: "Tibero", knowledge: [listed("k-tibero", "Tibero 연결 설정", "Tibero 7 JDBC 설정")] },
      ]);
      // 조회를 마친 제품만 센다
      expect(response.knowledgeLookup).toEqual({ searchedProducts: 1, pageProducts: 2 });

      // 응답에는 일반적인 안내만, 상세 오류는 서버 로그(stderr)에만 남긴다
      expect(response.knowledgeWarning).toEqual(expect.stringContaining("관련 지식"));
      expect(JSON.stringify(response)).not.toContain("/Users/someone");
      expect(JSON.stringify(response)).not.toContain("LanceError");
      expect(logged.mock.calls.flat().map(String).join("\n")).toContain("LanceError");
    });

    it("지식 쪽 초기화가 실패해도 소프트웨어 결과는 그대로 돌려준다", async () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      hybrid.initialize.mockRejectedValueOnce(
        new Error('임베딩 모델 로드 실패: file was not found locally at "/opt/app/models/tokenizer.json"'),
      );

      const response = await searchCompatibleSoftware({ query: "JEUS", includeKnowledge: true });

      expect(response.success).toBe(true);
      expect(response.count).toBe(2);
      expect(response.relatedKnowledge).toEqual([]);
      expect(response.knowledgeLookup).toEqual({ searchedProducts: 0, pageProducts: 1 });
      expect(response.knowledgeWarning).toEqual(expect.stringContaining("관련 지식"));
      expect(JSON.stringify(response)).not.toContain("/opt/app");
      expect(hybrid.searchKnowledge).not.toHaveBeenCalled();
      expect(logged.mock.calls.flat().map(String).join("\n")).toContain("/opt/app/models");
    });

    it("조회된 소프트웨어가 없어도 relatedKnowledge 를 빈 배열로 싣는다", async () => {
      const responses = [
        await searchCompatibleSoftware({ query: "없는제품이름", includeKnowledge: true }),
        await searchCompatibleSoftware({ frameworkVersion: "5.0", includeKnowledge: true }),
      ];
      for (const response of responses) {
        expect(response.count).toBe(0);
        expect(response.relatedKnowledge).toEqual([]);
        expect(response.knowledgeLookup).toEqual({ searchedProducts: 0, pageProducts: 0 });
        expect(response).not.toHaveProperty("knowledgeWarning");
      }
    });
  });

  describe("includeKnowledge — 제품명을 낱말로 언급하는 글만 싣는다", () => {
    const seed = (product_name: string): SoftwareSeed => ({
      ...CATALOGUE[4],
      product_name,
      product_version: `${product_name} 1.0`,
    });
    useCatalogue([seed("xFRAME"), seed("CESS"), seed("HMS"), seed("DevOnFrame"), seed("JEUS")]);

    /** 제품 하나를 조회해 그 제품의 관련 지식 id 를 돌려준다 */
    const relatedIds = async (productName: string, candidates: unknown[]) => {
      setCandidates(candidates);
      const response = await searchCompatibleSoftware({ productName, includeKnowledge: true });
      expect(response.count).toBe(1);
      return (response.relatedKnowledge ?? []).flatMap((entry) => entry.knowledge.map((item) => item.id));
    };

    it("제품명이 다른 낱말의 일부로 들어 있을 뿐인 글은 싣지 않는다", async () => {
      // 실제 데이터에서 제품 xFRAME 에 X-Frame-Options 헤더를 묻는 글이 실렸다
      expect(
        await relatedIds("xFRAME", [
          knowledge("k1", "xframeoptions 문의", "security 의 xframeOptions 옵션 때문에 화면이 표시되지 않습니다."),
          knowledge("k2", "UI 솔루션 연동", "화면은 xFrame 으로 개발하고 서버는 표준프레임워크입니다."),
          knowledge("k3", "xFRAME5 설치", "설치 중 오류가 납니다."),
        ]),
      ).toEqual(["k2"]);
    });

    it("네 글자 이하의 영문 제품명은 대소문자까지 같은 글만 싣는다", async () => {
      // 실제 데이터에서 제품 CESS 에 access-denied-page 가 든 글이, HMS 에 프로젝트 이름 hms 가 든 글이 실렸다
      expect(
        await relatedIds("CESS", [
          knowledge("k1", "context-security.xml 관련", '<http access-denied-page="/cmm/sec/accessDenied.do">'),
          knowledge("k2", "로그인 질문", "loginSuccess.do 는 아무 내용도 없는데 어디에서 이동하나요"),
          knowledge("k3", "CESS 연동 문의", "설치 방법이 궁금합니다."),
        ]),
      ).toEqual(["k3"]);
      expect(
        await relatedIds("HMS", [
          knowledge("k1", "톰캣 구동시 에러", "Failed to execute goal (default-compile) on project hms: Compilation failure"),
        ]),
      ).toEqual([]);
      // 소문자로 적은 글은 제품을 가리키더라도 싣지 않는다
      expect(
        await relatedIds("JEUS", [
          knowledge("k1", "jeus 설정 문의", "jeus 8 에서 기동할 때 오류가 납니다."),
          knowledge("k2", "WAS 기동 오류", "JEUS 8 에서 기동할 때 오류가 납니다."),
        ]),
      ).toEqual(["k2"]);
    });

    it("다섯 글자 이상의 제품명은 대소문자가 달라도 찾고, 한글이 바로 붙어 있어도 찾는다", async () => {
      expect(
        await relatedIds("DevOnFrame", [
          knowledge("k1", "DevonFrame과 전자정부Frame과 어떤차이점이 있나요?", "차이가 궁금합니다."),
          knowledge("k2", "프레임워크 비교", "devonframe은 LG CNS 의 제품입니다."),
          knowledge("k3", "다른 문의", "DevOnFrameworks 는 다른 이름입니다."),
        ]),
      ).toEqual(["k1", "k2"]);
    });
  });

  describe("includeKnowledge — 조회 실패의 원인 (knowledgeWarning)", () => {
    useCatalogue(CATALOGUE);

    /** 관련 지식 조회가 실패했을 때의 고정 안내 */
    const WARNING =
      "관련 지식을 조회하는 중 오류가 발생해 일부 또는 전부를 싣지 못했습니다. " +
      "호환 소프트웨어 목록은 정상입니다. 자세한 내용은 MCP 서버 로그(stderr)를 확인하세요.";
    /** 임베더가 모델 파일을 찾지 못했을 때 던지는 안내 (호출자가 읽고 조치할 수 있다) */
    const MODEL_MISSING =
      "임베딩 모델을 찾을 수 없습니다 (models/Xenova/multilingual-e5-small). " +
      "저장소를 클론해 쓰는 경우 npm run fetch-model 을 실행하세요.";
    const INDEX_MISSING = "개발자 지식 인덱스(knowledge-base/developer_knowledge.lance)를 찾을 수 없습니다.";

    beforeEach(() => {
      vi.spyOn(console, "error").mockImplementation(() => {});
    });

    it("호출자가 조치할 수 있는 오류(UserFacingError)로 실패하면 안내 끝에 원인을 덧붙인다", async () => {
      // 임베딩 모델은 의미 검색을 처음 실행할 때 불러오므로, 모델이 없으면 제품마다의 조회가 실패한다
      hybrid.searchKnowledge.mockRejectedValue(new UserFacingError(MODEL_MISSING));

      const response = await searchCompatibleSoftware({ query: "JEUS", includeKnowledge: true });

      expect(response.count).toBe(2);
      expect(response.relatedKnowledge).toEqual([]);
      expect(response.knowledgeLookup).toEqual({ searchedProducts: 0, pageProducts: 1 });
      expect(response.knowledgeWarning).toBe(`${WARNING} 원인: ${MODEL_MISSING}`);
    });

    it("지식 쪽 초기화가 UserFacingError 로 실패해도 원인을 덧붙인다", async () => {
      hybrid.initialize.mockRejectedValueOnce(new UserFacingError(INDEX_MISSING));

      const response = await searchCompatibleSoftware({ query: "JEUS", includeKnowledge: true });

      expect(response.count).toBe(2);
      expect(response.knowledgeWarning).toBe(`${WARNING} 원인: ${INDEX_MISSING}`);
      expect(hybrid.searchKnowledge).not.toHaveBeenCalled();
    });

    it("그 밖의 오류는 고정 문구만 싣는다 (내부 오류의 문구와 경로를 싣지 않는다)", async () => {
      hybrid.searchKnowledge.mockRejectedValue(
        new Error("lance error: LanceError(IO): Permission denied, /Users/someone/secret/local.rs:124:24"),
      );
      const searchFailed = await searchCompatibleSoftware({ query: "JEUS", includeKnowledge: true });
      expect(searchFailed.knowledgeWarning).toBe(WARNING);

      hybrid.initialized = false;
      hybrid.initialize.mockRejectedValueOnce(new Error("SQLITE_ERROR: no such table: compatibility_software"));
      const initFailed = await searchCompatibleSoftware({ query: "JEUS", includeKnowledge: true });
      expect(initFailed.knowledgeWarning).toBe(WARNING);
    });

    it("여러 제품이 같은 원인으로 실패해도 원인은 한 번만 적는다", async () => {
      hybrid.searchKnowledge.mockRejectedValue(new UserFacingError(MODEL_MISSING));

      // JEUS 와 Tibero 두 제품의 조회가 모두 실패한다
      const response = await searchCompatibleSoftware({ query: "티맥스", includeKnowledge: true });

      expect(hybrid.searchKnowledge).toHaveBeenCalledTimes(2);
      expect(response.knowledgeWarning).toBe(`${WARNING} 원인: ${MODEL_MISSING}`);
    });

    it("조치할 수 있는 오류 뒤에 내부 오류가 나도 먼저 얻은 원인을 그대로 적는다", async () => {
      hybrid.searchKnowledge.mockImplementation(async (productName: string) => {
        if (productName === "JEUS") {
          throw new UserFacingError(MODEL_MISSING);
        }
        throw new Error("lance error: LanceError(IO): /Users/someone/secret");
      });

      const response = await searchCompatibleSoftware({ query: "티맥스", includeKnowledge: true });

      expect(hybrid.searchKnowledge.mock.calls[0]?.[0]).toBe("JEUS");
      expect(hybrid.searchKnowledge.mock.calls.length).toBeGreaterThan(1);
      expect(response.knowledgeWarning).toBe(`${WARNING} 원인: ${MODEL_MISSING}`);
      expect(JSON.stringify(response)).not.toContain("/Users/someone");
    });

    it("내부 오류와 조치할 수 있는 오류가 섞여 있으면 조치할 수 있는 오류의 문구만 원인으로 적는다", async () => {
      hybrid.searchKnowledge.mockImplementation(async (productName: string) => {
        if (productName === "JEUS") {
          throw new Error("lance error: LanceError(IO): /Users/someone/secret");
        }
        throw new UserFacingError(MODEL_MISSING);
      });

      const response = await searchCompatibleSoftware({ query: "티맥스", includeKnowledge: true });

      expect(response.knowledgeWarning).toBe(`${WARNING} 원인: ${MODEL_MISSING}`);
      expect(JSON.stringify(response)).not.toContain("/Users/someone");
    });

    it("조회가 모두 성공하면 knowledgeWarning 을 싣지 않는다", async () => {
      const response = await searchCompatibleSoftware({ query: "JEUS", includeKnowledge: true });
      expect(response).not.toHaveProperty("knowledgeWarning");
    });
  });

  describe("includeKnowledge — 항목의 제목과 발췌", () => {
    useCatalogue(CATALOGUE);

    /** JEUS 를 조회해 관련 지식 항목을 돌려준다 */
    const jeusItems = async (candidates: unknown[]) => {
      setCandidates(candidates);
      const response = await searchCompatibleSoftware({ productName: "JEUS", limit: 1, includeKnowledge: true });
      return response.relatedKnowledge?.[0]?.knowledge ?? [];
    };

    it("본문에서 제품명이 처음 나오는 자리를 가운데에 둔 200자 이내의 발췌를 싣는다", async () => {
      const head = "서버 설정을 바꾼 뒤부터 문제가 생겼습니다. ".repeat(20);
      const tail = " 로그를 첨부합니다.".repeat(30);
      const [item] = await jeusItems([knowledge("k1", "WAS 기동 오류", `${head}JEUS 8 에서 기동할 때 오류가 납니다.${tail}`)]);

      expect(item.excerpt.length).toBeLessThanOrEqual(200);
      expect(item.excerpt.startsWith("...")).toBe(true);
      expect(item.excerpt.endsWith("...")).toBe(true);
      // 제품명이 발췌의 가운데에 있다
      const at = item.excerpt.indexOf("JEUS 8 에서 기동할 때");
      expect(at).toBeGreaterThan(80);
      expect(at).toBeLessThan(110);
    });

    it("제품명이 여러 번 나오면 처음 나오는 자리를 쓴다", async () => {
      const filler = "가".repeat(300);
      const [item] = await jeusItems([knowledge("k1", "문의", `${filler} JEUS 첫째 ${filler} JEUS 둘째 ${filler}`)]);
      expect(item.excerpt).toContain("JEUS 첫째");
      expect(item.excerpt).not.toContain("JEUS 둘째");
    });

    it("제품명이 제목에만 있으면 본문의 처음부터 싣는다", async () => {
      const body = "설정 방법이 궁금합니다. ".repeat(40).trim();
      const [item] = await jeusItems([knowledge("k1", "JEUS 데이터소스 설정 문의", body)]);
      expect(item.excerpt).toBe(`${body.slice(0, 197).trimEnd()}...`);
      expect(item.excerpt.length).toBeLessThanOrEqual(200);
    });

    it("200자 이내의 본문은 자르지 않고, 줄바꿈과 연속 공백을 공백 하나로 바꿔 싣는다", async () => {
      const [item] = await jeusItems([knowledge("k1", "문의", "질문:\nJEUS   설정이 궁금합니다.\r\n\r\n답변:\n\t가이드를 참고하세요.  ")]);
      expect(item.excerpt).toBe("질문: JEUS 설정이 궁금합니다. 답변: 가이드를 참고하세요.");
    });

    it("줄바꿈으로 나뉜 긴 본문도 공백을 정리한 뒤에 200자를 센다", async () => {
      const line = "로그 한 줄입니다.";
      const [item] = await jeusItems([knowledge("k1", "문의", `JEUS 기동 로그\n\n\n${`${line}\n\n\n`.repeat(60)}`)]);
      expect(item.excerpt.length).toBeLessThanOrEqual(200);
      expect(item.excerpt.length).toBeGreaterThan(190);
      expect(item.excerpt).not.toMatch(/\s{2,}|\n/);
      expect(item.excerpt.startsWith("JEUS 기동 로그 로그 한 줄입니다.")).toBe(true);
    });

    it("제목은 NFC 로 정규화하고 주민등록번호 형식을 가린다", async () => {
      // 테스트용으로 지어낸 번호다
      const [item] = await jeusItems([
        knowledge("k1", `${"적용가이드".normalize("NFD")} JEUS 900101-1234567`, "본문"),
      ]);
      expect(item.title).toBe("적용가이드 JEUS ******-*******");
    });

    it("발췌의 주민등록번호 형식은 자르기 전에 가린다 (번호의 일부도 남기지 않는다)", async () => {
      // 가리지 않고 자르면 197번째 글자에서 번호가 끊겨 앞 여섯 자리가 남는다
      const [item] = await jeusItems([
        knowledge("k1", "문의", `JEUS 문의입니다. ${"가".repeat(178)} 900101-1234567 뒤에 이어지는 글이 더 있습니다.`),
      ]);
      expect(item.excerpt.length).toBeLessThanOrEqual(200);
      expect(item.excerpt).not.toMatch(/\d/);
      expect(item.excerpt).toContain("*");

      // 잘리지 않는 자리에 있는 번호도 가린다
      const [whole] = await jeusItems([knowledge("k2", "문의", "JEUS 담당자 850505-2345678 입니다.")]);
      expect(whole.excerpt).toBe("JEUS 담당자 ******-******* 입니다.");
    });

    it("본문이 비어 있으면 빈 발췌를 싣는다", async () => {
      const [item] = await jeusItems([knowledge("k1", "JEUS 문의", "")]);
      expect(item.excerpt).toBe("");
    });
  });

  describe("includeKnowledge — 괄호가 든 제품명", () => {
    const seed = (product_name: string): SoftwareSeed => ({
      ...CATALOGUE[4],
      product_name,
      product_version: `${product_name} 1.0`,
    });
    useCatalogue([
      seed("Morpheus CMS(모피어스 CMS)"),
      seed("AI+(플러스) CMS"),
      seed("ALPAS v1.0 (도서관리 시스템)"),
      seed("UCARE(콜센터상담시스템)"),
      seed("Zenkaku CMS（전각 괄호 설명）"),
      seed("Nested CMS(설명(안쪽 괄호) 더)"),
      seed("(괄호뿐인 이름)"),
    ]);

    /** 제품 하나를 조회해 그 제품의 관련 지식 id 를 돌려준다 */
    const relatedIds = async (productName: string, candidates: unknown[]) => {
      setCandidates(candidates);
      const response = await searchCompatibleSoftware({ productName, includeKnowledge: true });
      expect(response.count).toBe(1);
      return (response.relatedKnowledge ?? []).flatMap((entry) => entry.knowledge.map((item) => item.id));
    };

    it("괄호와 그 안의 내용을 뺀 이름이 들어 있는 글을 찾는다", async () => {
      // 글은 제품을 'Morpheus CMS' 로 부른다. 괄호까지 붙인 전체 이름으로 견주면 하나도 남지 않는다
      expect(
        await relatedIds("Morpheus", [
          knowledge("k1", "Morpheus CMS 설치 문의", "설치 중 오류"),
          knowledge("k2", "CMS 일반 문의", "morpheus cms 2.0 에서 메뉴가 보이지 않습니다"),
          knowledge("k3", "다른 CMS 문의", "모피어스 제품이 아닙니다"),
        ]),
      ).toEqual(["k1", "k2"]);
    });

    it("이름 가운데나 끝의 괄호를 빼고 남은 낱말 사이의 공백은 하나로 줄인다", async () => {
      expect(await relatedIds("AI+", [knowledge("k1", "AI+ CMS 권한 설정", "본문")])).toEqual(["k1"]);
      expect(await relatedIds("ALPAS", [knowledge("k1", "도서관리", "ALPAS v1.0 에서 대출 반납이 안 됩니다")])).toEqual([
        "k1",
      ]);
      expect(await relatedIds("UCARE", [knowledge("k1", "ucare 연동", "본문")])).toEqual(["k1"]);
    });

    it("전각 괄호와 겹친 괄호도 그 안의 내용과 함께 뺀다", async () => {
      // 전각 괄호를 빼지 않으면 '（전각 괄호 설명）' 까지 붙은 이름으로 견줘 하나도 남지 않는다
      expect(await relatedIds("Zenkaku", [knowledge("k1", "Zenkaku CMS 설치 문의", "본문")])).toEqual(["k1"]);
      // 겹친 괄호를 한 번만 빼면 바깥 괄호가 남은 이름('Nested CMS(설명 더)')으로 견주게 된다
      expect(await relatedIds("Nested", [knowledge("k1", "메뉴 문의", "Nested CMS 에서 메뉴가 보이지 않습니다")])).toEqual([
        "k1",
      ]);
    });

    it("괄호를 빼고 남는 것이 없는 제품명은 그대로 견준다", async () => {
      // 빈 이름으로 견주면 어떤 글과도 일치하지 않는다
      expect(
        await relatedIds("괄호뿐인", [
          knowledge("k1", "제품 문의", "목록에 (괄호뿐인 이름) 으로 올라 있는 제품입니다"),
          knowledge("k2", "다른 문의", "괄호가 없는 글입니다"),
        ]),
      ).toEqual(["k1"]);
    });

    it("의미 검색에는 제품명을 그대로 쓰고, 응답의 product 도 제품명 그대로다", async () => {
      setCandidates([knowledge("k1", "UCARE 연동", "본문")]);
      const response = await searchCompatibleSoftware({ productName: "UCARE", includeKnowledge: true });
      expect(hybrid.searchKnowledge).toHaveBeenCalledWith("UCARE(콜센터상담시스템)", { limit: 50 });
      expect(response.relatedKnowledge).toEqual([
        { product: "UCARE(콜센터상담시스템)", knowledge: [listed("k1", "UCARE 연동", "본문")] },
      ]);
    });
  });

  describe("includeKnowledge — 조회한 제품 수 (knowledgeLookup)", () => {
    useCatalogue(BULK);

    it("한 페이지의 앞 5개 제품만 조회하고, 그 수와 페이지의 제품 수를 알린다", async () => {
      const response = await searchCompatibleSoftware({ limit: 7, includeKnowledge: true });
      expect(response.count).toBe(7);
      expect(hybrid.searchKnowledge).toHaveBeenCalledTimes(5);
      expect(response.knowledgeLookup).toEqual({ searchedProducts: 5, pageProducts: 7 });
    });

    it("제품이 5개 이하이면 모두 조회한다", async () => {
      const response = await searchCompatibleSoftware({ limit: 3, includeKnowledge: true });
      expect(response.knowledgeLookup).toEqual({ searchedProducts: 3, pageProducts: 3 });
    });
  });

  describe("includeKnowledge — 같은 제품의 여러 버전", () => {
    useCatalogue(CATALOGUE);

    it("제품 수는 제품명 기준으로 센다 (버전이 여럿이어도 한 번만 조회한다)", async () => {
      // JEUS 두 행과 Tibero 한 행
      const response = await searchCompatibleSoftware({ query: "티맥스", includeKnowledge: true });
      expect(response.count).toBe(3);
      expect(hybrid.searchKnowledge).toHaveBeenCalledTimes(2);
      expect(response.knowledgeLookup).toEqual({ searchedProducts: 2, pageProducts: 2 });
    });
  });

  describe("확인일자 순 정렬", () => {
    // DATED 에는 verified_date 가 날짜가 아닌 행('㈜어떤회사', 'https://vendor.example')이 있다
    useCatalogue([...CATALOGUE, ...DATED]);

    it("최신순 목록의 첫 행은 가장 최근 날짜의 행이고, 날짜가 아닌 값은 맨 뒤로 간다", async () => {
      const response = await searchCompatibleSoftware({});
      expect(response.total).toBe(CATALOGUE.length + DATED.length);
      expect(response.software[0]).toMatchObject({ product_version: "Dated New 1.0", verified_date: "2025-12-31" });
      expect(response.software.slice(-2).map((software) => software.verified_date)).toEqual([
        "㈜어떤회사",
        "https://vendor.example",
      ]);
    });

    it("첫 페이지만 요청해도 날짜가 아닌 값이 끼어들지 않는다", async () => {
      const response = await searchCompatibleSoftware({ limit: 3 });
      expect(response.software.map((software) => software.verified_date)).toEqual([
        "2025-12-31",
        "2025-08-21",
        "2024-05-05",
      ]);
    });
  });

  describe("응답의 software 항목", () => {
    useCatalogue(CATALOGUE);

    it("내부용 필드 id 와 created_at 을 싣지 않는다", async () => {
      const responses = [
        await searchCompatibleSoftware({ category: "WAS" }),
        await searchCompatibleSoftware({ query: "JEUS" }),
        await searchCompatibleSoftware({ query: "오라클" }),
      ];
      for (const response of responses) {
        expect(response.count).toBeGreaterThan(0);
        for (const software of response.software) {
          expect(software).not.toHaveProperty("id");
          expect(software).not.toHaveProperty("created_at");
          expect(software).toHaveProperty("product_name");
          expect(software).toHaveProperty("verified_date");
        }
      }
    });
  });

  describe("전체 건수와 페이지", () => {
    useCatalogue(BULK);

    it("응답에 total, count, limit, offset 을 넣는다", async () => {
      const response = await searchCompatibleSoftware({ limit: 5 });
      expect(response).toMatchObject({ success: true, total: BULK.length, count: 5, limit: 5, offset: 0 });
      expect(response.software).toHaveLength(5);
    });

    it("limit 을 주지 않으면 20건을 돌려주고, 잘린 사실을 total 로 알 수 있다", async () => {
      const response = await searchCompatibleSoftware({});
      expect(response).toMatchObject({ total: BULK.length, count: 20, limit: 20, offset: 0 });
    });

    it("offset 으로 다음 페이지를 이어서 조회한다", async () => {
      const first = await searchCompatibleSoftware({ limit: 50 });
      const second = await searchCompatibleSoftware({ limit: 50, offset: 50 });
      const third = await searchCompatibleSoftware({ limit: 50, offset: 100 });
      expect([first.count, second.count, third.count]).toEqual([50, 50, BULK.length - 100]);
      expect(third).toMatchObject({ total: BULK.length, limit: 50, offset: 100 });

      const seen = new Set([...first.software, ...second.software, ...third.software].map((s) => s.product_name));
      expect(seen.size).toBe(BULK.length);
    });

    it("query 가 있을 때도 total 과 offset 을 적용한다", async () => {
      const response = await searchCompatibleSoftware({ query: "Bulk", limit: 10, offset: 115 });
      expect(response).toMatchObject({ total: BULK.length, count: BULK.length - 115, limit: 10, offset: 115 });
      expect(response.matchMode).toBe("all-terms");
    });

    it("limit 은 1 이상 100 이하의 정수로 맞춘다", async () => {
      const applied = async (limit: number) => {
        const response = await searchCompatibleSoftware({ limit });
        return [response.limit, response.count];
      };
      expect(await applied(1000)).toEqual([100, 100]);
      expect(await applied(1e300)).toEqual([100, 100]);
      expect(await applied(2.7)).toEqual([2, 2]);
      // 1 보다 작은 값이 '제한 없음'(전체 반환)으로 바뀌면 안 된다
      expect(await applied(0.5)).toEqual([1, 1]);
      expect(await applied(0)).toEqual([1, 1]);
      expect(await applied(-5)).toEqual([1, 1]);
      expect(await applied(Number.NaN)).toEqual([20, 20]);
    });

    it("query 가 있을 때도 같은 limit 규칙을 따른다", async () => {
      expect((await searchCompatibleSoftware({ query: "Bulk", limit: 0.5 })).count).toBe(1);
      expect((await searchCompatibleSoftware({ query: "Bulk", limit: 1000 })).count).toBe(100);
    });

    it("offset 은 0 이상의 정수로 맞춘다", async () => {
      expect((await searchCompatibleSoftware({ offset: -3 })).offset).toBe(0);
      expect((await searchCompatibleSoftware({ offset: 1.5 })).offset).toBe(1);
      expect((await searchCompatibleSoftware({ offset: Number.NaN })).offset).toBe(0);

      const beyond = await searchCompatibleSoftware({ offset: 1e300 });
      expect(beyond).toMatchObject({ total: BULK.length, count: 0 });
    });
  });

  describe("query 와 필터를 함께 준 조회", () => {
    const db = useCatalogue(CROWDED);

    it("정렬에서 뒤에 오는 행이어도 필터에 맞으면 빠뜨리지 않는다", async () => {
      // 필터가 없으면 TargetCMS 는 31번째(마지막)다
      const unfiltered = await searchCompatibleSoftware({ query: "CMS", limit: 100 });
      expect(versionsOf(unfiltered.software).indexOf("TargetCMS 1.0")).toBe(CROWDED.length - 1);

      // 예전에는 상위 limit*5 건만 가져와 걸러서, 순위가 31번째인 TargetCMS 가 빠졌다
      const response = await searchCompatibleSoftware({ query: "CMS", frameworkVersion: "4.3", limit: 1 });
      expect(versionsOf(response.software)).toEqual(["TargetCMS 1.0"]);
      expect(response.count).toBe(1);
    });

    it("vendor 와 productName 은 query 가 있어도 대소문자를 구분하지 않는다", async () => {
      const byVendor = await searchCompatibleSoftware({ query: "TargetCMS", vendor: "lg cns" });
      expect(versionsOf(byVendor.software)).toEqual(["TargetCMS 1.0"]);

      const byProduct = await searchCompatibleSoftware({ query: "CMS", productName: "targetcms" });
      expect(versionsOf(byProduct.software)).toEqual(["TargetCMS 1.0"]);
    });

    it("query 가 없을 때와 같은 필터 결과를 돌려준다", async () => {
      const withoutQuery = await searchCompatibleSoftware({ vendor: "LG CNS" });
      const withQuery = await searchCompatibleSoftware({ query: "CMS", vendor: "LG CNS" });
      expect(versionsOf(withQuery.software)).toEqual(versionsOf(withoutQuery.software));
    });

    it("조회는 한 번만 실행한다 (버려지던 필터 전용 조회를 따로 하지 않는다)", async () => {
      const query = vi.spyOn(db.sqlite(), "queryCompatibleSoftware");
      const filterOnly = vi.spyOn(db.sqlite(), "searchCompatibleSoftware");

      await searchCompatibleSoftware({ query: "CMS", frameworkVersion: "4.3" });

      expect(query).toHaveBeenCalledTimes(1);
      expect(filterOnly).not.toHaveBeenCalled();
    });
  });
});
