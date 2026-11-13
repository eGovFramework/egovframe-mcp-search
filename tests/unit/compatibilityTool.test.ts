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
import { CATALOGUE, versionsOf, type SoftwareSeed } from "./_compatibilityFixture.js";

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

    it("query 가 없으면 matchMode 를 넣지 않는다", async () => {
      const response = await searchCompatibleSoftware({ frameworkVersion: "4.3" });
      expect(response.count).toBe(2);
      expect(response).not.toHaveProperty("matchMode");
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
