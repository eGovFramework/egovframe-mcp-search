/**
 * LanceDB 매니저의 clearAll 단위 테스트
 *
 * 인덱스 구축(build-index)은 테이블을 지우고(clearAll) 같은 자리에 다시 만든 뒤 행을 배치로 더하고
 * 마지막에 optimize 를 부른다. 지운 테이블에 인덱스가 걸려 있었고 같은 연결을 계속 쓰면, 새 테이블의
 * 버전 번호가 예전 테이블의 버전에 닿을 때 연결이 기억하던 예전 인덱스 정보가 다시 읽혀 optimize 가
 * 실패한다 ("No scalar index plugin found for name vector"). clearAll 은 연결을 새로 열어야 한다.
 *
 * 임베딩 모델 없이 돌도록 행은 가짜 벡터로 테이블에 직접 더한다.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as lancedb from "@lancedb/lancedb";
import { GuideSearchManager } from "../../src/rag/guideManager.js";
import { DeveloperKnowledgeManager } from "../../src/rag/knowledgeManager.js";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";

const DIM = 384;
const vector = (seed: number) => Array.from({ length: DIM }, (_, i) => Math.sin(seed * 31 + i));

function guideRow(n: number) {
  return {
    id: `g-${n}`,
    title: `제목 ${n}`,
    content: `가이드 본문 ${n}`,
    source: `doc${n % 7}.md`,
    layer: "egovframe-runtime",
    category: "x",
    section: `절 ${n}`,
    docTitle: "문서",
    url: "/x/",
    vector: vector(n),
  };
}

function knowledgeRow(manager: DeveloperKnowledgeManager, n: number) {
  const now = new Date(0).toISOString();
  return {
    id: `k-${n}`,
    type: "solution",
    title: `제목 ${n}`,
    content: `지식 본문 ${n}`,
    context: "",
    tags: ["qa"],
    relatedTo: ["egovframe"],
    importance: 3,
    verified: true,
    createdAt: now,
    updatedAt: now,
    metadata: (manager as unknown as { normalizeMetadata(value: object): unknown }).normalizeMetadata({}),
    vector: vector(n),
  };
}

type TableHolder = { table: lancedb.Table };
const tableOf = (manager: object) => (manager as TableHolder).table;

/** 예전 테이블: 행 300개에 IVF_PQ 인덱스를 건 테이블을 다른 연결로 만들어 둔다 (재구축 전의 동봉 인덱스와 같은 모양). */
async function seedIndexedTable(tableName: string, dir: string, rows: object[]): Promise<number> {
  const db = await lancedb.connect(dir);
  const table = await db.openTable(tableName);
  await table.add(rows as Record<string, unknown>[]);
  await table.createIndex("vector", { config: lancedb.Index.ivfPq({ numPartitions: 2, numSubVectors: 16 }) });
  expect((await table.listIndices()).length).toBeGreaterThan(0);
  return table.version();
}

describe("LanceDB 매니저의 clearAll 은 인덱스가 걸려 있던 테이블을 다시 만든 뒤에도 최적화할 수 있다", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "egov-lance-clear-"));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it("GuideSearchManager", async () => {
    await new GuideSearchManager(tmpDir).initialize();
    const oldVersion = await seedIndexedTable(
      "egovframe_guide",
      tmpDir,
      Array.from({ length: 300 }, (_, n) => guideRow(n)),
    );

    const manager = new GuideSearchManager(tmpDir);
    await manager.initialize();
    await manager.clearAll();
    // 새 테이블의 버전이 예전 테이블의 버전을 넘을 만큼 배치를 더한다
    for (let batch = 0; batch < oldVersion + 5; batch++) {
      await tableOf(manager).add(Array.from({ length: 5 }, (_, i) => guideRow(1000 + batch * 5 + i)));
    }

    await expect(manager.optimize()).resolves.toBeUndefined();
    expect(await tableOf(manager).countRows()).toBe((oldVersion + 5) * 5);
    expect(await tableOf(manager).listIndices()).toEqual([]);
  });

  it("DeveloperKnowledgeManager", async () => {
    const seed = new DeveloperKnowledgeManager(tmpDir);
    await seed.initialize();
    const oldVersion = await seedIndexedTable(
      "developer_knowledge",
      tmpDir,
      Array.from({ length: 300 }, (_, n) => knowledgeRow(seed, n)),
    );

    const manager = new DeveloperKnowledgeManager(tmpDir);
    await manager.initialize();
    await manager.clearAll();
    for (let batch = 0; batch < oldVersion + 5; batch++) {
      await tableOf(manager).add(Array.from({ length: 5 }, (_, i) => knowledgeRow(manager, 1000 + batch * 5 + i)));
    }

    await expect(manager.optimize()).resolves.toBeUndefined();
    expect(await tableOf(manager).countRows()).toBe((oldVersion + 5) * 5);
    expect(await tableOf(manager).listIndices()).toEqual([]);
  });
});
