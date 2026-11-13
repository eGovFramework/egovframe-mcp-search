/**
 * 임시 디렉토리에 개발자 지식 테이블(developer_knowledge)을 만드는 단위 테스트 공용 도구.
 *
 * 동봉 테이블은 읽기만 하므로(_lanceFixtures 참고), 행 구성을 직접 정해야 하거나 삭제·갱신을
 * 실행해 봐야 하는 검증은 여기서 만든 임시 테이블에서 한다.
 * 스키마는 매니저가 만든 것을 그대로 쓴다 — 테이블은 매니저로 만들고 행만 직접 넣는다.
 */
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import * as lancedb from "@lancedb/lancedb";
import { DeveloperKnowledgeManager } from "../../src/rag/knowledgeManager.js";
import type { KnowledgeType } from "../../src/types/knowledge.js";
import { KNOWLEDGE_TABLE } from "./_lanceFixtures.js";

/** 임베딩 벡터 차원 */
const VECTOR_DIMENSION = 384;

/** axis 번째 축만 1 인 단위 벡터 (차원을 넘는 축은 처음부터 다시 센다) */
export function unitVector(axis: number): number[] {
  return Array.from({ length: VECTOR_DIMENSION }, (_, i) => (i === axis % VECTOR_DIMENSION ? 1 : 0));
}

/** 임시 테이블에 넣을 행 — 지정하지 않은 값은 기본값을 쓴다 */
export interface KnowledgeRowSpec {
  id: string;
  type?: KnowledgeType;
  title?: string;
  content?: string;
  tags?: string[];
  importance?: number;
  verified?: boolean;
  createdAt?: string;
  /** 벡터로 쓸 단위 벡터의 축 (기본 0) */
  axis?: number;
}

export interface KnowledgeTableFixture {
  /** 행을 넣은 뒤에 연 매니저 (검증 대상) */
  manager: DeveloperKnowledgeManager;
  /** 임시 테이블을 새 핸들로 연다 (매니저와는 별개의 핸들) */
  openTable(): Promise<lancedb.Table>;
  /** 테이블에 지금 들어 있는 행의 id (매니저가 쓴 내용까지 반영해 새로 읽는다, 오름차순) */
  ids(): Promise<string[]>;
  /** 임시 디렉토리를 지운다 */
  cleanup(): Promise<void>;
}

/** metadata struct 의 하위 필드를 타입에 맞는 빈 값으로 채운다 (필드 목록은 테이블 스키마에서 읽는다). */
async function emptyMetadata(table: lancedb.Table): Promise<Record<string, string | number>> {
  const field = (await table.schema()).fields.find((candidate) => candidate.name === "metadata");
  if (!field) {
    throw new Error("developer_knowledge 테이블에 metadata 컬럼이 없습니다");
  }
  const children = field.type.children as Array<{ name: string; type: unknown }>;
  return Object.fromEntries(
    children.map((child): [string, string | number] => [child.name, String(child.type) === "Utf8" ? "" : 0]),
  );
}

/**
 * 임시 디렉토리에 개발자 지식 테이블을 만들고 rows 를 넣는다.
 *
 * LanceDB 테이블 핸들은 다른 핸들이 쓴 내용을 스스로 다시 읽지 않는다. 그래서 행을 넣은 뒤에
 * 매니저를 새로 열어 돌려주고, ids() 도 부를 때마다 테이블을 새로 연다.
 */
export async function createKnowledgeTable(rows: KnowledgeRowSpec[]): Promise<KnowledgeTableFixture> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "egov-knowledge-table-"));
  const openTable = async () => (await lancedb.connect(dir)).openTable(KNOWLEDGE_TABLE);

  // 테이블(스키마)은 매니저가 만든다
  await new DeveloperKnowledgeManager(dir).initialize();

  const table = await openTable();
  const metadata = await emptyMetadata(table);
  if (rows.length > 0) {
    await table.add(
      rows.map((row) => {
        const createdAt = row.createdAt ?? "2026-01-01T00:00:00.000Z";
        return {
          id: row.id,
          type: row.type ?? "solution",
          title: row.title ?? `제목 ${row.id}`,
          content: row.content ?? `본문 ${row.id}`,
          context: "",
          tags: row.tags ?? [],
          relatedTo: [],
          importance: row.importance ?? 3,
          verified: row.verified ?? false,
          createdAt,
          updatedAt: createdAt,
          metadata,
          vector: unitVector(row.axis ?? 0),
        };
      }),
    );
  }

  const manager = new DeveloperKnowledgeManager(dir);
  await manager.initialize();

  return {
    manager,
    openTable,
    ids: async () => {
      const records = await (await openTable()).query().select(["id"]).toArray();
      return records.map((record: { id: unknown }) => String(record.id)).sort();
    },
    cleanup: () => fs.remove(dir),
  };
}
