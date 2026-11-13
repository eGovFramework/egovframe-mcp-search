/**
 * 동봉 LanceDB 테이블(knowledge-base/)을 읽는 단위 테스트의 공용 도구.
 *
 * 테이블은 읽기만 한다 (쓰기·색인·최적화 금지).
 * 임베딩 모델(models/ — git 미추적)이 없는 환경에서도 검색 경로를 검증할 수 있도록,
 * 질의 임베딩을 테이블에 저장된 벡터로 대신하는 도구를 제공한다. LocalEmbedder.embed 만
 * 대체하므로 where 절 조립과 LanceDB 질의는 실제 코드를 그대로 탄다.
 */
import { vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import * as lancedb from "@lancedb/lancedb";
import { getEmbedder } from "../../src/rag/embedder.js";
import { REPO_ROOT } from "../integration/_helper.js";

/** 저장소에 동봉된 지식베이스 디렉토리 (오버레이가 아닌 번들 고정) */
export const BUNDLED_KB = path.join(REPO_ROOT, "knowledge-base");

export const GUIDE_TABLE = "egovframe_guide";
export const KNOWLEDGE_TABLE = "developer_knowledge";

/** 동봉 LanceDB 테이블 두 개가 모두 있는지 (없으면 이 테이블에 의존하는 테스트는 skip) */
export const HAS_BUNDLED_TABLES =
  fs.existsSync(path.join(BUNDLED_KB, `${GUIDE_TABLE}.lance`)) &&
  fs.existsSync(path.join(BUNDLED_KB, `${KNOWLEDGE_TABLE}.lance`));

/** id 와 벡터, 그리고 함께 읽은 컬럼 값 */
export type VectorRow = { id: string; vector: Float32Array } & Record<string, unknown>;

/** 동봉 테이블을 연다 (기대값 계산용 — 검증 대상 매니저와는 별개의 핸들). */
export async function openBundledTable(name: string): Promise<lancedb.Table> {
  const db = await lancedb.connect(BUNDLED_KB);
  return db.openTable(name);
}

/** id·vector 와 지정한 컬럼을 전부 읽는다. */
export async function loadVectorRows(table: lancedb.Table, columns: string[] = []): Promise<VectorRow[]> {
  const records = await table.query().select(["id", "vector", ...columns]).toArray();
  return records.map((record: Record<string, unknown>) => ({
    ...Object.fromEntries(columns.map((column) => [column, record[column]])),
    id: String(record.id),
    vector: Float32Array.from(record.vector as ArrayLike<number>),
  }));
}

/** 질의 임베딩을 주어진 벡터로 대신한다 (모델을 불러오지 않는다). afterEach 에서 vi.restoreAllMocks() 로 되돌린다. */
export function useQueryVector(vector: ArrayLike<number>): void {
  vi.spyOn(getEmbedder(), "embed").mockResolvedValue(Float32Array.from(vector));
}

/** 내적. 저장된 벡터는 모두 정규화되어 있어 내적이 곧 코사인 유사도다. */
export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

/** rows 를 처음부터 끝까지 고르게 건너뛰며 count 개를 고른다. */
export function spread<T>(rows: T[], count: number): T[] {
  return Array.from({ length: Math.min(count, rows.length) }, (_, i) => rows[Math.floor((i * rows.length) / count)]);
}
