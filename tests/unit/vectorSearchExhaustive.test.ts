/**
 * 벡터 검색이 전수 검색(flat scan)으로 동작하는지 검증한다.
 *
 * 이전에 구축한 테이블에는 IVF_PQ 인덱스가 있었는데, 기본 설정으로 인덱스를 타면 일부 파티션만 후보가 되어
 * (1) 가이드 인덱스의 손상된 항목 때문에 자기 벡터로도 찾지 못하는 청크가 생기고
 * (2) where 필터에 맞는 행이 있어도 0건 또는 limit 미만이 반환된다.
 * 색인을 구축할 때 인덱스를 만들지 않으므로 새로 구축한 테이블에는 인덱스가 없다. 검색은 인덱스가 있든 없든 전수 검색이다.
 *
 * 동봉 LanceDB 테이블을 읽기만 한다. 임베딩 모델이 없어도 돌도록 질의 임베딩은 저장된 벡터로
 * 대신하고(_lanceFixtures 참고), 실제 모델로 임베딩하는 검증은 모델이 있을 때만 수행한다.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import * as lancedb from "@lancedb/lancedb";
import type { Table } from "@lancedb/lancedb";
import { GuideSearchManager } from "../../src/rag/guideManager.js";
import { DeveloperKnowledgeManager } from "../../src/rag/knowledgeManager.js";
import { MAX_VECTOR_SEARCH_LIMIT } from "../../src/utils/lanceFilter.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { REPO_ROOT, hasEmbeddingModel } from "../integration/_helper.js";
import {
  BUNDLED_KB,
  GUIDE_TABLE,
  HAS_BUNDLED_TABLES,
  KNOWLEDGE_TABLE,
  dot,
  loadVectorRows,
  openBundledTable,
  spread,
  useQueryVector,
  type VectorRow,
} from "./_lanceFixtures.js";

const STORED_VECTOR_QUERY = "(저장된 벡터로 대체)";

/** 테이블 전체에서 질의 벡터와 가장 가까운 k 개의 내적 값 (정규화된 벡터에서는 L2·코사인 모두 같은 순위). */
function topSimilarities(rows: VectorRow[], query: ArrayLike<number>, k: number): number[] {
  return rows
    .map((row) => dot(row.vector, query))
    .sort((a, b) => b - a)
    .slice(0, k);
}

describe("색인 구축 — 쓰이지 않는 벡터 인덱스를 만들지 않는다", () => {
  // 검색은 항상 인덱스를 건너뛴 전수 검색이다. 그런데도 색인을 구축할 때 IVF_PQ 인덱스를 만들면 구축 시간과
  // 지식베이스 크기만 늘고, 행 수에 비해 파티션이 많아 빈 파티션 경고가 수백 줄 나온다.
  const SOURCES = [
    "src/kb/guideIndexer.ts",
    "src/scripts/buildIndex.ts",
    "src/cli/lancedb/guide.ts",
    "src/cli/lancedb/developerKnowledge.ts",
    "src/rag/guideManager.ts",
    "src/rag/knowledgeManager.ts",
    "src/database/hybridManager.ts",
  ];

  it.each(SOURCES)("%s 는 벡터 인덱스를 만드는 코드를 두지 않는다", (file) => {
    const source = fs.readFileSync(path.join(REPO_ROOT, file), "utf-8");
    expect(source).not.toMatch(/\.createIndex\(|Index\.ivfPq|createIndex\(\)/);
  });
});

describe.skipIf(!HAS_BUNDLED_TABLES)("가이드 검색 — 전수 검색", () => {
  let manager: GuideSearchManager;
  let table: Table;
  let rows: VectorRow[];

  beforeAll(async () => {
    manager = new GuideSearchManager(BUNDLED_KB);
    await manager.initialize();
    table = await openBundledTable(GUIDE_TABLE);
    rows = await loadVectorRows(table, ["category"]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("모든 청크는 자기 벡터로 검색하면 거리 0 으로 찾을 수 있다", async () => {
    const unreachable: string[] = [];
    for (const row of rows) {
      useQueryVector(row.vector);
      const results = await manager.searchGuide(STORED_VECTOR_QUERY, { limit: 5 });
      // 벡터가 같은 쌍둥이 청크가 있어 1위가 자기 자신이 아닐 수는 있다 — 결과 안에 거리 0 으로 있으면 된다
      const self = results.find((r) => r.id === row.id);
      if (!self || Math.abs(self.score) > 1e-4) unreachable.push(row.id);
    }
    expect(unreachable).toEqual([]);
  });

  it("결과는 테이블 전체에서 가장 가까운 청크들이다", async () => {
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const { vector: query } of spread(rows, 20)) {
      useQueryVector(query);
      const results = await manager.searchGuide(STORED_VECTOR_QUERY, { limit: 5 });
      const returned = results.map((r) => dot(byId.get(r.id)!.vector, query)).sort((a, b) => b - a);
      const expected = topSimilarities(rows, query, 5);
      expect(returned).toHaveLength(5);
      returned.forEach((value, idx) => expect(value).toBeCloseTo(expected[idx], 5));
    }
  });

  it("category 필터에 맞는 청크가 있으면 질의와 무관하게 limit 건을 채운다", async () => {
    const securityCount = await table.countRows("category = 'security'");
    expect(securityCount).toBeGreaterThanOrEqual(5);

    // security 가 아닌 청크의 벡터(= 주제가 다른 질의)로 검색한다
    const offTopic = rows.filter((row) => row.category !== "security");
    for (const { vector } of spread(offTopic, 20)) {
      useQueryVector(vector);
      const results = await manager.searchGuide(STORED_VECTOR_QUERY, { limit: 5, category: "security" });
      expect(results).toHaveLength(5);
      expect(results.every((r) => r.category === "security")).toBe(true);
    }
  });

  it("limit 가 필터에 맞는 청크 수보다 크면 맞는 청크를 모두 돌려준다", async () => {
    // 청크가 가장 적은 category 를 고른다 (인덱스를 다시 만들어도 깨지지 않게 이름을 고정하지 않는다)
    const counts = new Map<string, number>();
    for (const row of rows) {
      const category = String(row.category);
      if (category) counts.set(category, (counts.get(category) ?? 0) + 1);
    }
    const [smallest, total] = [...counts].sort((a, b) => a[1] - b[1])[0];
    expect(await table.countRows(`category = '${smallest}'`)).toBe(total);
    // 검색 한 번의 상한 안에서 확인한다 — 그보다 큰 limit 은 상한으로 줄어든다
    expect(total + 20).toBeLessThanOrEqual(MAX_VECTOR_SEARCH_LIMIT);

    useQueryVector(rows.find((row) => row.category !== smallest)!.vector);
    const results = await manager.searchGuide(STORED_VECTOR_QUERY, { limit: total + 20, category: smallest });
    expect(results).toHaveLength(total);
    expect(results.every((r) => r.category === smallest)).toBe(true);
  });

  it.skipIf(!hasEmbeddingModel())(
    "실제 임베딩: '부서권한관리' 질의의 상위 결과는 부서권한관리 문서다",
    async () => {
      const results = await manager.searchGuide("부서권한관리", { limit: 3 });
      expect(results).toHaveLength(3);
      for (const result of results) {
        expect(result.source).toContain("department-role-management");
      }
    },
    60_000,
  );
});

describe.skipIf(!HAS_BUNDLED_TABLES)("개발자 지식 검색 — 전수 검색", () => {
  let manager: DeveloperKnowledgeManager;
  let table: Table;
  let rows: VectorRow[];

  beforeAll(async () => {
    manager = new DeveloperKnowledgeManager(BUNDLED_KB);
    await manager.initialize();
    table = await openBundledTable(KNOWLEDGE_TABLE);
    rows = await loadVectorRows(table, ["type"]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("결과는 테이블 전체에서 가장 가까운 행들이다", async () => {
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const { vector: query } of spread(rows, 10)) {
      useQueryVector(query);
      const results = await manager.searchKnowledge(STORED_VECTOR_QUERY, { limit: 5 });
      const returned = results.map((r) => dot(byId.get(r.id)!.vector, query)).sort((a, b) => b - a);
      const expected = topSimilarities(rows, query, 5);
      expect(returned).toHaveLength(5);
      returned.forEach((value, idx) => expect(value).toBeCloseTo(expected[idx], 5));
    }
  });

  it("type 필터에 맞는 행이 있으면 질의와 무관하게 limit 건을 채운다", async () => {
    const bestPracticeCount = await table.countRows("type = 'best-practice'");
    expect(bestPracticeCount).toBeGreaterThanOrEqual(5);

    // best-practice 가 아닌 행의 벡터(= 주제가 다른 질의)로 검색한다
    const offTopic = rows.filter((row) => row.type !== "best-practice");
    for (const { vector } of spread(offTopic, 20)) {
      useQueryVector(vector);
      const results = await manager.searchKnowledge(STORED_VECTOR_QUERY, { limit: 5, type: "best-practice" });
      expect(results).toHaveLength(5);
      expect(results.every((r) => r.type === "best-practice")).toBe(true);
    }
  });

  it("minImportance 필터도 limit 건을 채운다", async () => {
    const importantCount = await table.countRows("importance >= 4");
    expect(importantCount).toBeGreaterThanOrEqual(50);

    useQueryVector(rows.find((row) => row.type !== "best-practice")!.vector);
    const results = await manager.searchKnowledge(STORED_VECTOR_QUERY, { limit: 50, minImportance: 4 });
    expect(results).toHaveLength(50);
    expect(results.every((r) => r.importance >= 4)).toBe(true);
  });

  it("limit 가 필터에 맞는 행 수보다 크면 맞는 행을 모두 돌려준다", async () => {
    // 검색 한 번의 상한(MAX_VECTOR_SEARCH_LIMIT) 안에서 확인한다 — 그보다 큰 limit 은 상한으로 줄어든다.
    // 상한보다 적은 행에 맞는 필터가 필요한데, 동봉 데이터의 태그는 모두 상한보다 많은 행에 붙어 있다
    // (2026-11-24 의 데이터에서 가장 적은 FAQ 가 105행). 그래서 동봉 테이블의 FAQ 60행과 Q&A 60행을
    // 임시 테이블로 옮겨, 그 테이블에서 확인한다 (동봉 테이블은 바꾸지 않는다)
    const sample = 60;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "egov-exhaustive-"));
    try {
      const db = await lancedb.connect(dir);
      const copy = await db.createTable(
        KNOWLEDGE_TABLE,
        await table.query().where("array_has_any(tags, ['faq'])").limit(sample).toArrow(),
      );
      await copy.add(await table.query().where("array_has_any(tags, ['qa'])").limit(sample).toArrow());
      const total = await copy.countRows("array_has_any(tags, ['faq'])");
      expect(total).toBe(sample);
      expect(total).toBeLessThan(MAX_VECTOR_SEARCH_LIMIT);

      const sampled = new DeveloperKnowledgeManager(dir);
      await sampled.initialize();
      useQueryVector(rows.find((row) => row.type !== "best-practice")!.vector);
      const results = await sampled.searchKnowledge(STORED_VECTOR_QUERY, {
        limit: MAX_VECTOR_SEARCH_LIMIT,
        tags: ["faq"],
      });
      expect(results).toHaveLength(total);
      expect(results.every((r) => r.tags.includes("faq"))).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!hasEmbeddingModel())(
    "실제 임베딩: 주제가 다른 질의에도 type 필터 결과가 비지 않는다",
    async () => {
      const results = await manager.searchKnowledge("트랜잭션 설정 오류", { limit: 5, type: "best-practice" });
      expect(results).toHaveLength(5);
      expect(results.every((r) => r.type === "best-practice")).toBe(true);
    },
    60_000,
  );
});
