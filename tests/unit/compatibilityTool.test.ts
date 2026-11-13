/**
 * 호환 소프트웨어 검색 도구(src/tools/compatibility.ts) 단위 테스트
 *
 * 도구 함수는 싱글톤 HybridDatabaseManager 를 통해 저장소의 knowledge-base 를 연다.
 * 테스트가 그 파일을 건드리지 않도록 hybridManager 모듈만 대역으로 바꾼다.
 * - SQLite 쪽은 임시 디렉토리의 새 DB 를 여는 실제 SQLiteManager 를 그대로 쓴다.
 * - 지식 쪽(LanceDB + 임베딩 모델)은 호출 여부와 반환값만 흉내 낸다.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import { SQLiteManager } from "../../src/database/sqliteManager.js";
import { CATALOGUE, versionsOf } from "./_compatibilityFixture.js";

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

describe("searchCompatibleSoftware (호환 소프트웨어 검색 도구)", () => {
  let tmpDir: string;
  let sqlite: SQLiteManager;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "egov-compat-tool-"));
    sqlite = new SQLiteManager(path.join(tmpDir, "egovframe.db"));
    sqlite.addCompatibilitySoftwareBatch(CATALOGUE);
    hybrid.sqlite = sqlite;
  });

  afterAll(async () => {
    sqlite.close();
    await fs.remove(tmpDir);
  });

  beforeEach(() => {
    hybrid.initialize.mockClear();
    hybrid.findKnowledgeForSoftware.mockReset();
    hybrid.findKnowledgeForSoftware.mockResolvedValue([]);
  });

  describe("matchMode", () => {
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
});
