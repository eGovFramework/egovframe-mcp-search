/**
 * 벡터 검색·최근 목록의 limit 방어 단위 테스트
 *
 * 검색은 인덱스를 건너뛴 전수 검색이라, limit 을 그대로 넘기면 음수나 아주 큰 값 한 번에 테이블
 * 전체가 결과로 나가고 0·1 미만의 소수·NaN 은 LanceDB 오류("k must be positive")가 된다.
 * 매니저가 limit 을 1 이상 MAX_VECTOR_SEARCH_LIMIT 이하의 정수로 정리하는지 확인한다.
 *
 * 상한보다 행이 많은 임시 테이블에서 검증하고, 동봉 테이블(읽기 전용)로도 한 번 확인한다.
 * 질의 임베딩은 고정 벡터로 대신한다 (_lanceFixtures 참고).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import * as lancedb from "@lancedb/lancedb";
import { GuideSearchManager } from "../../src/rag/guideManager.js";
import { DeveloperKnowledgeManager } from "../../src/rag/knowledgeManager.js";
import { MAX_VECTOR_SEARCH_LIMIT } from "../../src/utils/lanceFilter.js";
import { BUNDLED_KB, GUIDE_TABLE, HAS_BUNDLED_TABLES, useQueryVector } from "./_lanceFixtures.js";
import { createKnowledgeTable, unitVector, type KnowledgeTableFixture } from "./_knowledgeTableFixture.js";

const STORED_VECTOR_QUERY = "(고정 벡터로 대체)";

/** 임시 테이블의 행 수 — 상한보다 많아서, limit 을 정리하지 않으면 이 수가 그대로 결과로 나온다 */
const ROW_COUNT = MAX_VECTOR_SEARCH_LIMIT + 50;

/** limit 을 주지 않았을 때의 건수: 검색은 5건, 최근 목록은 10건 */
const SEARCH_DEFAULT = 5;
const RECENT_DEFAULT = 10;

/** limit 입력과, 기본값이 fallback 인 메서드가 돌려줘야 하는 건수 */
const LIMIT_CASES: Array<{ limit: unknown; expected: (fallback: number) => number }> = [
  // 음수 — LanceDB 는 "제한 없음"으로 받아 테이블 전체를 돌려준다
  { limit: -1, expected: () => 1 },
  { limit: -5, expected: () => 1 },
  // 0·1 미만의 소수 — LanceDB 가 "k must be positive" 로 거부한다
  { limit: 0, expected: () => 1 },
  { limit: 0.4, expected: () => 1 },
  // 숫자가 아니거나 유한하지 않은 값 — 기본값
  { limit: Number.NaN, expected: (fallback) => fallback },
  { limit: Infinity, expected: (fallback) => fallback },
  { limit: -Infinity, expected: (fallback) => fallback },
  { limit: "7", expected: (fallback) => fallback },
  { limit: null, expected: (fallback) => fallback },
  { limit: undefined, expected: (fallback) => fallback },
  // 상한을 넘는 값
  { limit: 1e9, expected: () => MAX_VECTOR_SEARCH_LIMIT },
  { limit: MAX_VECTOR_SEARCH_LIMIT + 1, expected: () => MAX_VECTOR_SEARCH_LIMIT },
  // 범위 안의 값은 그대로 (소수는 내림)
  { limit: 1, expected: () => 1 },
  { limit: 2.9, expected: () => 2 },
  { limit: 30, expected: () => 30 },
  { limit: MAX_VECTOR_SEARCH_LIMIT, expected: () => MAX_VECTOR_SEARCH_LIMIT },
];

/** 반환 건수가 기대한 값이고, 어떤 경우에도 1 이상 상한 이하인지 확인한다. */
function expectCount(rows: unknown[], expected: number, limit: unknown): void {
  const label = `limit=${String(limit)}`;
  expect(rows.length, label).toBeGreaterThanOrEqual(1);
  expect(rows.length, label).toBeLessThanOrEqual(MAX_VECTOR_SEARCH_LIMIT);
  expect(rows.length, label).toBe(expected);
}

describe("가이드 검색 — limit 방어", () => {
  let tmpDir: string;
  let manager: GuideSearchManager;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "egov-guide-limit-"));
    const db = await lancedb.connect(tmpDir);
    await db.createTable(
      GUIDE_TABLE,
      Array.from({ length: ROW_COUNT }, (_, i) => ({
        id: `g${i}`,
        title: `문서 ${i}`,
        content: `본문 ${i}`,
        source: `layer-${i % 2}/category/${i}.md`,
        layer: `layer-${i % 2}`,
        category: "category",
        section: "개요",
        docTitle: `문서 ${i}`,
        url: "",
        vector: unitVector(i),
      })),
    );
    manager = new GuideSearchManager(tmpDir);
    await manager.initialize();
  });

  afterAll(async () => {
    await fs.remove(tmpDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("limit 이 어떤 값이어도 1 건 이상 상한 이하를 돌려주고 오류를 내지 않는다", async () => {
    useQueryVector(unitVector(0));
    for (const { limit, expected } of LIMIT_CASES) {
      const results = await manager.searchGuide(STORED_VECTOR_QUERY, { limit: limit as number });
      expectCount(results, expected(SEARCH_DEFAULT), limit);
    }
  });

  it("limit 을 주지 않으면 기본 5건이다", async () => {
    useQueryVector(unitVector(0));
    expect(await manager.searchGuide(STORED_VECTOR_QUERY)).toHaveLength(SEARCH_DEFAULT);
  });

  it("필터가 있어도 같은 상한을 적용한다", async () => {
    useQueryVector(unitVector(0));
    // layer-0 은 ROW_COUNT 의 절반(75건)이다
    expect(await manager.searchGuide(STORED_VECTOR_QUERY, { limit: -5, layer: "layer-0" })).toHaveLength(1);
    expect(await manager.searchGuide(STORED_VECTOR_QUERY, { limit: 1e9, layer: "layer-0" })).toHaveLength(
      ROW_COUNT / 2,
    );
  });
});

describe("개발자 지식 — limit 방어", () => {
  let fixture: KnowledgeTableFixture;
  let manager: DeveloperKnowledgeManager;

  beforeAll(async () => {
    fixture = await createKnowledgeTable(
      Array.from({ length: ROW_COUNT }, (_, i) => ({
        id: `k${i}`,
        type: i % 2 === 0 ? ("solution" as const) : ("tip" as const),
        axis: i,
      })),
    );
    manager = fixture.manager;
  });

  afterAll(async () => {
    await fixture.cleanup();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("검색: limit 이 어떤 값이어도 1 건 이상 상한 이하를 돌려주고 오류를 내지 않는다", async () => {
    useQueryVector(unitVector(0));
    for (const { limit, expected } of LIMIT_CASES) {
      const results = await manager.searchKnowledge(STORED_VECTOR_QUERY, { limit: limit as number });
      expectCount(results, expected(SEARCH_DEFAULT), limit);
    }
  });

  it("검색: limit 을 주지 않으면 기본 5건이다", async () => {
    useQueryVector(unitVector(0));
    expect(await manager.searchKnowledge(STORED_VECTOR_QUERY)).toHaveLength(SEARCH_DEFAULT);
  });

  it("검색: 필터가 있어도 같은 상한을 적용한다", async () => {
    useQueryVector(unitVector(0));
    // tip 은 ROW_COUNT 의 절반(75건)이다
    expect(await manager.searchKnowledge(STORED_VECTOR_QUERY, { limit: -5, type: "tip" })).toHaveLength(1);
    expect(await manager.searchKnowledge(STORED_VECTOR_QUERY, { limit: 1e9, type: "tip" })).toHaveLength(
      ROW_COUNT / 2,
    );
  });

  it("최근 목록: limit 이 어떤 값이어도 1 건 이상 상한 이하를 돌려준다", async () => {
    for (const { limit, expected } of LIMIT_CASES) {
      const results = await manager.listRecentKnowledge(limit as number);
      expectCount(results, expected(RECENT_DEFAULT), limit);
    }
  });

  it("최근 목록: limit 을 주지 않으면 기본 10건이다", async () => {
    expect(await manager.listRecentKnowledge()).toHaveLength(RECENT_DEFAULT);
  });

  it("최근 목록: type 필터가 있어도 같은 상한을 적용한다", async () => {
    expect(await manager.listRecentKnowledge(-5, "tip")).toHaveLength(1);
    expect(await manager.listRecentKnowledge(1e9, "tip")).toHaveLength(ROW_COUNT / 2);
  });
});

/**
 * 동봉 테이블에서의 재현: 고치기 전에는 limit -5 한 번에 테이블 전체(그때의 개발자 지식 18,046행·가이드 2,277행)가 나갔다.
 */
describe.skipIf(!HAS_BUNDLED_TABLES)("동봉 테이블 — 음수·초대형 limit 이 테이블 전체를 돌려주지 않는다", () => {
  let guide: GuideSearchManager;
  let knowledge: DeveloperKnowledgeManager;

  beforeAll(async () => {
    guide = new GuideSearchManager(BUNDLED_KB);
    knowledge = new DeveloperKnowledgeManager(BUNDLED_KB);
    await guide.initialize();
    await knowledge.initialize();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("가이드 검색", async () => {
    useQueryVector(unitVector(0));
    expect(await guide.searchGuide(STORED_VECTOR_QUERY, { limit: -5 })).toHaveLength(1);
    expect(await guide.searchGuide(STORED_VECTOR_QUERY, { limit: 1e9 })).toHaveLength(MAX_VECTOR_SEARCH_LIMIT);
  });

  it("개발자 지식 검색", async () => {
    useQueryVector(unitVector(0));
    expect(await knowledge.searchKnowledge(STORED_VECTOR_QUERY, { limit: -5 })).toHaveLength(1);
    expect(await knowledge.searchKnowledge(STORED_VECTOR_QUERY, { limit: 1e9 })).toHaveLength(
      MAX_VECTOR_SEARCH_LIMIT,
    );
  });

  it("최근 지식 목록", async () => {
    expect(await knowledge.listRecentKnowledge(-5)).toHaveLength(1);
    expect(await knowledge.listRecentKnowledge(1e9)).toHaveLength(MAX_VECTOR_SEARCH_LIMIT);
  });
});
