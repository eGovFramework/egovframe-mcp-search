/**
 * 가이드 검색의 layer / category 필터 처리 단위 테스트
 *
 * 동봉 LanceDB 테이블을 읽기만 하며, 질의 임베딩은 저장된 벡터로 대신한다 (_lanceFixtures 참고).
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { GuideSearchManager } from "../../src/rag/guideManager.js";
import {
  BUNDLED_KB,
  GUIDE_TABLE,
  HAS_BUNDLED_TABLES,
  loadVectorRows,
  openBundledTable,
  useQueryVector,
  type VectorRow,
} from "./_lanceFixtures.js";

const STORED_VECTOR_QUERY = "(저장된 벡터로 대체)";

/** where 절의 조건을 바꾸거나 질의를 깨뜨리려는 값들 */
const INJECTION_VALUES = [
  "it's",
  "x' OR '1'='1",
  "egovframe-development' OR layer = 'common-component",
  "x'; DROP TABLE egovframe_guide; --",
];

describe.skipIf(!HAS_BUNDLED_TABLES)("가이드 검색 — 필터 값은 리터럴로만 쓰인다", () => {
  let manager: GuideSearchManager;
  let rows: VectorRow[];

  beforeAll(async () => {
    manager = new GuideSearchManager(BUNDLED_KB);
    await manager.initialize();
    rows = await loadVectorRows(await openBundledTable(GUIDE_TABLE), ["layer", "category"]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("작은따옴표가 든 layer 값은 필터를 풀지도 질의를 깨뜨리지도 않는다", async () => {
    useQueryVector(rows[0].vector);
    for (const layer of INJECTION_VALUES) {
      const results = await manager.searchGuide(STORED_VECTOR_QUERY, { limit: 5, layer });
      expect(results, layer).toEqual([]);
    }
  });

  it("작은따옴표가 든 category 값은 필터를 풀지도 질의를 깨뜨리지도 않는다", async () => {
    useQueryVector(rows[0].vector);
    for (const category of INJECTION_VALUES) {
      const results = await manager.searchGuide(STORED_VECTOR_QUERY, { limit: 5, category });
      expect(results, category).toEqual([]);
    }
  });

  it("유효한 layer 와 category 는 그대로 걸러 준다", async () => {
    useQueryVector(rows[0].vector);
    const results = await manager.searchGuide(STORED_VECTOR_QUERY, {
      limit: 5,
      layer: "common-component",
      category: "security",
    });
    expect(results).toHaveLength(5);
    expect(results.every((r) => r.layer === "common-component" && r.category === "security")).toBe(true);
  });
});
