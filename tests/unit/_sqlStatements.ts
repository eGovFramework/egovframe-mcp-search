/**
 * SQLiteManager 가 실행한 SQL 문을 들여다보는 테스트 도구.
 *
 * 조회 결과만으로는 확인할 수 없는 성질을 확인할 때만 쓴다. 예를 들어 정렬 기준이 모두 같은 행의 순서는
 * SQL 이 보장하지 않지만, 지금의 SQLite 는 그런 행을 읽은 순서대로 낸다. 읽는 순서가 우연히 id 순이면
 * 정렬에서 id 기준을 빼도 결과가 달라지지 않으므로, 실행한 문에 그 기준이 있는지를 직접 봐야 한다.
 */
import { vi } from "vitest";
import type { SQLiteManager } from "../../src/database/sqliteManager.js";

/**
 * run 이 실행한 문 가운데 행을 돌려주는 조회 문(LIMIT ? OFFSET ? 으로 끝나는 SELECT)의 ORDER BY 절을 모은다.
 * 공백은 한 칸으로 줄이고, 'ORDER BY' 부터 문 끝까지를 돌려준다. 건수만 세는 문(COUNT)은 넣지 않는다.
 */
export function orderByClausesOf(sqlite: SQLiteManager, run: () => unknown): string[] {
  const db = (sqlite as unknown as { db: { prepare: (sql: string) => unknown } }).db;
  const prepare = vi.spyOn(db, "prepare");
  try {
    run();
    return prepare.mock.calls
      .map(([sql]) => String(sql).replace(/\s+/g, " ").trim())
      .filter((sql) => sql.endsWith("LIMIT ? OFFSET ?"))
      .map((sql) => sql.slice(sql.lastIndexOf("ORDER BY")));
  } finally {
    prepare.mockRestore();
  }
}
