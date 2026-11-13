/**
 * 하이브리드 매니저의 통합 검색(smartSearch) 단위 테스트
 *
 * 호환 소프트웨어 쪽 결과를 확인한다: 모든 검색어가 일치하는 행을 limit 건까지 돌려주고, 전체 일치 건수를
 * 함께 돌려준다. 임시 디렉토리의 새 SQLite DB 와 개발자 지식 테이블만 쓰고, 질의 임베딩은 고정 벡터로
 * 대신한다 (임베딩 모델을 불러오지 않는다).
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import path from "node:path";
import { HybridDatabaseManager } from "../../src/database/hybridManager.js";
import { SQLiteManager } from "../../src/database/sqliteManager.js";
import { CATALOGUE, versionsOf, type SoftwareSeed } from "./_compatibilityFixture.js";
import { createKnowledgeTable, unitVector, type KnowledgeTableFixture } from "./_knowledgeTableFixture.js";
import { useQueryVector } from "./_lanceFixtures.js";

/** 이름에 'Bulk' 가 든 12행. 확인일자가 뒤로 갈수록 오래되어 번호 순으로 나온다 */
const BULK: SoftwareSeed[] = Array.from({ length: 12 }, (_, index): SoftwareSeed => ({
  ...CATALOGUE[5],
  product_name: `Bulk${index}`,
  product_version: `Bulk${index} 1.0`,
  verified_date: `2020-01-${String(28 - index).padStart(2, "0")}`,
}));

describe("HybridDatabaseManager.smartSearch — 호환 소프트웨어", () => {
  let fixture: KnowledgeTableFixture;
  let manager: HybridDatabaseManager;

  beforeAll(async () => {
    fixture = await createKnowledgeTable([
      { id: "k1", title: "첫 글", axis: 1 },
      { id: "k2", title: "둘째 글", axis: 2 },
      { id: "k3", title: "셋째 글", axis: 3 },
    ]);
    // 쓰기 모드로 열어 고정 데이터를 적재한 뒤 닫는다. 매니저는 같은 파일을 읽기 전용으로 연다
    const seeder = new SQLiteManager(path.join(fixture.dir, "egovframe.db"));
    seeder.addCompatibilitySoftwareBatch([...CATALOGUE, ...BULK]);
    seeder.close();
    manager = new HybridDatabaseManager(fixture.dir);
  });

  afterAll(async () => {
    manager.close();
    await fixture.cleanup();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("모든 검색어가 일치하는 행을 limit 건까지 돌려주고, 전체 일치 건수를 함께 돌려준다", async () => {
    const result = await manager.smartSearch({ query: "Bulk", includeKnowledge: false, limit: 5 });
    expect(versionsOf(result.compatibility)).toEqual(["Bulk0 1.0", "Bulk1 1.0", "Bulk2 1.0", "Bulk3 1.0", "Bulk4 1.0"]);
    // limit 건만 실려 있어, 이 값이 없으면 몇 건 가운데 다섯 건인지 알 수 없다
    expect(result.compatibilityTotal).toBe(BULK.length);
  });

  it("전체가 limit 이하이면 전체 일치 건수가 돌려준 건수와 같다", async () => {
    const result = await manager.smartSearch({ query: "JEUS", includeKnowledge: false, limit: 5 });
    expect(versionsOf(result.compatibility)).toEqual(["JEUS 21", "JEUS 8.5"]);
    expect(result.compatibilityTotal).toBe(2);
  });

  it("모든 검색어가 일치하는 행이 없으면 빈 배열과 0 을 돌려준다 (대체 검색 결과를 섞지 않는다)", async () => {
    // JEUS 와 Tibero 가 함께 든 행은 없다. 호환 소프트웨어 조회(scope compatibility)라면 대체 검색으로 세 행이 나온다
    const result = await manager.smartSearch({ query: "JEUS Tibero", includeKnowledge: false });
    expect(result.compatibility).toEqual([]);
    expect(result.compatibilityTotal).toBe(0);
  });

  it("호환 소프트웨어를 찾지 않으면 0 을 돌려준다", async () => {
    useQueryVector(unitVector(1));
    const result = await manager.smartSearch({ query: "Bulk", includeCompatibility: false });
    expect(result.compatibility).toEqual([]);
    expect(result.compatibilityTotal).toBe(0);
    expect(result.knowledge.length).toBeGreaterThan(0);
  });

  it("totalResults 는 돌려준 건수의 합이다 (전체 일치 건수가 아니다)", async () => {
    useQueryVector(unitVector(1));
    const result = await manager.smartSearch({ query: "Bulk", limit: 2 });
    expect(result.compatibility).toHaveLength(2);
    expect(result.knowledge).toHaveLength(2);
    expect(result.totalResults).toBe(4);
    expect(result.compatibilityTotal).toBe(BULK.length);
  });
});
