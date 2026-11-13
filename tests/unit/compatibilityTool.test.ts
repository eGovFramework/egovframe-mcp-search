/**
 * 호환 소프트웨어 검색 도구(src/tools/compatibility.ts) 단위 테스트
 *
 * 도구 함수는 싱글톤 HybridDatabaseManager 를 통해 저장소의 knowledge-base 를 연다.
 * 테스트가 그 파일을 건드리지 않도록 hybridManager 모듈만 대역으로 바꾼다.
 * - SQLite 쪽은 임시 디렉토리의 새 DB 를 여는 실제 SQLiteManager 를 그대로 쓴다.
 * - 지식 쪽(LanceDB + 임베딩 모델)은 호출 여부와 반환값만 흉내 낸다.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import { SQLiteManager } from "../../src/database/sqliteManager.js";
import { CATALOGUE, DATED, versionsOf, type SoftwareSeed } from "./_compatibilityFixture.js";

const hybrid = vi.hoisted(() => ({
  sqlite: undefined as unknown,
  initialize: vi.fn(async () => {}),
  findKnowledgeForSoftware: vi.fn(async (_productName: string): Promise<unknown[]> => []),
}));

vi.mock("../../src/database/hybridManager.js", () => {
  const manager = {
    getSQLite: () => hybrid.sqlite,
    initialize: () => hybrid.initialize(),
    findKnowledgeForSoftware: (productName: string) => hybrid.findKnowledgeForSoftware(productName),
  };
  return {
    getHybridManager: () => manager,
    getInitializedHybridManager: async () => {
      await manager.initialize();
      return manager;
    },
  };
});

import { normalizeFrameworkVersion, searchCompatibleSoftware } from "../../src/tools/compatibility.js";

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

/**
 * "CMS" 로 찾으면 31행이 나온다. 프레임워크 4.3 인 TargetCMS 는 설명이 길어
 * 검색 순위(bm25)가 가장 낮다.
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
    verified_date: "2024-01-01",
    description: `CMS ${"아주 긴 설명 ".repeat(40)}`,
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
    hybrid.initialize.mockClear();
    hybrid.findKnowledgeForSoftware.mockReset();
    hybrid.findKnowledgeForSoftware.mockResolvedValue([]);
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

    it("일부 검색어만 일치하는 행으로 대체했으면 any-term 을 알린다", async () => {
      const response = await searchCompatibleSoftware({ query: "JEUS 호환 여부" });
      expect(versionsOf(response.software)).toEqual(["JEUS 21", "JEUS 8.5"]);
      expect(response.matchMode).toBe("any-term");
    });

    it("문장으로 물으면서 필터를 함께 줘도 뜻이 있는 검색어로 찾는다", async () => {
      // eGovFrame·에서·검증된·솔루션 은 어떤 행에도 없다. 이런 검색어까지 세면 일치 기준이 올라가 0건이 된다
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

  describe("normalizeFrameworkVersion", () => {
    it("앞의 v 또는 V 를 떼고 x.y.z 를 x.y 로 줄인다", () => {
      expect(normalizeFrameworkVersion("4.3")).toBe("4.3");
      expect(normalizeFrameworkVersion("v4.3")).toBe("4.3");
      expect(normalizeFrameworkVersion("V4.3")).toBe("4.3");
      expect(normalizeFrameworkVersion("4.3.0")).toBe("4.3");
      expect(normalizeFrameworkVersion("v4.3.1")).toBe("4.3");
      expect(normalizeFrameworkVersion("  4.3 \n")).toBe("4.3");
    });

    it("버전은 숫자가 아니라 문자열로 다룬다 (3.10 과 3.1 은 다른 버전)", () => {
      expect(normalizeFrameworkVersion("3.10")).toBe("3.10");
      expect(normalizeFrameworkVersion("3.10.2")).toBe("3.10");
      expect(normalizeFrameworkVersion("3.1")).toBe("3.1");
    });

    it("그 밖의 꼴은 공백만 떼고 그대로 둔다", () => {
      expect(normalizeFrameworkVersion("4")).toBe("4");
      expect(normalizeFrameworkVersion("4.3.0.1")).toBe("4.3.0.1");
      expect(normalizeFrameworkVersion("latest")).toBe("latest");
      expect(normalizeFrameworkVersion("version 4.3")).toBe("version 4.3");
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
      expect(hybrid.findKnowledgeForSoftware).not.toHaveBeenCalled();
    });

    it("includeKnowledge 가 true 이면 초기화한 뒤 관련 지식을 조회한다", async () => {
      const response = await searchCompatibleSoftware({ query: "JEUS", includeKnowledge: true });
      expect(response.count).toBe(2);

      expect(hybrid.initialize).toHaveBeenCalledTimes(1);
      expect(hybrid.findKnowledgeForSoftware).toHaveBeenCalledWith("JEUS");
      // 초기화가 조회보다 먼저다
      expect(hybrid.initialize.mock.invocationCallOrder[0]).toBeLessThan(
        hybrid.findKnowledgeForSoftware.mock.invocationCallOrder[0],
      );
    });

    it("includeKnowledge 가 true 여도 조회된 소프트웨어가 없으면 초기화하지 않는다", async () => {
      const response = await searchCompatibleSoftware({ frameworkVersion: "5.0", includeKnowledge: true });
      expect(response.count).toBe(0);
      expect(hybrid.initialize).not.toHaveBeenCalled();
    });
  });

  describe("includeKnowledge 로 함께 돌려주는 관련 지식", () => {
    useCatalogue(CATALOGUE);

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

    it("제목이나 본문에 제품명이 들어 있는 지식만 남기고, 항목에 id 를 싣는다", async () => {
      hybrid.findKnowledgeForSoftware.mockResolvedValue([
        knowledge("k-title", "JEUS 데이터소스 설정 문의", "설정 방법이 궁금합니다."),
        knowledge("k-content", "WAS 기동 오류", "jeus 8 에서 기동할 때 오류가 납니다."),
        knowledge("k-unrelated", "게시판 샘플", "공통컴포넌트 게시판 샘플 문의"),
      ]);

      const response = await searchCompatibleSoftware({ query: "JEUS", includeKnowledge: true });

      expect(response.relatedKnowledge).toEqual([
        {
          product: "JEUS",
          knowledge: [
            { id: "k-title", title: "JEUS 데이터소스 설정 문의", type: "solution", importance: 3, tags: ["was"] },
            { id: "k-content", title: "WAS 기동 오류", type: "solution", importance: 3, tags: ["was"] },
          ],
        },
      ]);
      expect(response).not.toHaveProperty("knowledgeWarning");
    });

    it("제품명이 들어 있는 지식이 하나도 없는 제품은 항목을 넣지 않는다", async () => {
      // 벡터 검색은 관련이 없어도 항상 가까운 순으로 5건을 돌려준다
      hybrid.findKnowledgeForSoftware.mockResolvedValue([
        knowledge("k1", "게시판 샘플", "공통컴포넌트 게시판 샘플 문의"),
        knowledge("k2", "로그인 암호화", "사용자 테이블 암호화 관련"),
      ]);

      const response = await searchCompatibleSoftware({ productName: "Tibero", includeKnowledge: true });

      expect(response.count).toBe(1);
      expect(response.relatedKnowledge).toEqual([]);
    });

    it("한 제품의 지식 조회가 실패해도 소프트웨어 결과와 나머지 제품의 지식은 돌려준다", async () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      hybrid.findKnowledgeForSoftware.mockImplementation(async (productName: string) => {
        if (productName === "JEUS") {
          throw new Error("lance error: LanceError(IO): Permission denied, /Users/someone/secret/local.rs:124:24");
        }
        return [knowledge("k-tibero", "Tibero 연결 설정", "Tibero 7 JDBC 설정")];
      });

      const response = await searchCompatibleSoftware({ query: "티맥스", includeKnowledge: true });

      expect(response.success).toBe(true);
      expect(versionsOf(response.software).sort()).toEqual(["JEUS 21", "JEUS 8.5", "Tibero 7"]);
      expect(response.relatedKnowledge).toEqual([
        {
          product: "Tibero",
          knowledge: [{ id: "k-tibero", title: "Tibero 연결 설정", type: "solution", importance: 3, tags: ["was"] }],
        },
      ]);

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
      expect(response.knowledgeWarning).toEqual(expect.stringContaining("관련 지식"));
      expect(JSON.stringify(response)).not.toContain("/opt/app");
      expect(hybrid.findKnowledgeForSoftware).not.toHaveBeenCalled();
      expect(logged.mock.calls.flat().map(String).join("\n")).toContain("/opt/app/models");
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

    it("검색 순위가 낮아도 필터에 맞는 행을 빠뜨리지 않는다", async () => {
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
