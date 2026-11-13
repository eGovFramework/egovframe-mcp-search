/**
 * 하이브리드 매니저가 SQLite 를 필요한 때에만 여는지 확인하는 단위 테스트
 *
 * 개발자 지식 검색은 LanceDB 만 쓴다. SQLite 파일이 없거나 네이티브 모듈을 불러오지 못해도
 * (Node 버전 불일치) 지식 검색까지 함께 막히면 안 된다.
 */
import { describe, it, expect, afterEach } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import { HybridDatabaseManager } from "../../src/database/hybridManager.js";
import { SQLiteManager } from "../../src/database/sqliteManager.js";
import { UserFacingError } from "../../src/utils/errors.js";
import { createKnowledgeTable, type KnowledgeTableFixture } from "./_knowledgeTableFixture.js";

describe("HybridDatabaseManager — SQLite 지연 열기", () => {
  let fixture: KnowledgeTableFixture | undefined;
  let manager: HybridDatabaseManager | undefined;

  afterEach(async () => {
    try {
      manager?.close();
    } catch {
      // SQLite 를 연 적이 없으면 닫을 것이 없다
    }
    manager = undefined;
    await fixture?.cleanup();
    fixture = undefined;
  });

  it("egovframe.db 가 없어도 매니저를 만들고 개발자 지식을 조회할 수 있다", async () => {
    fixture = await createKnowledgeTable([{ id: "a", title: "첫 글" }, { id: "b", title: "둘째 글" }]);

    manager = new HybridDatabaseManager(fixture.dir);
    await manager.initialize();

    const recent = await manager.getKnowledge().listRecentKnowledge(10);
    expect(recent.map((row) => row.id).sort()).toEqual(["a", "b"]);
  });

  it("SQLite 는 getSQLite() 를 처음 부를 때 열고, 파일이 없으면 그때 조치 방법을 담은 오류를 던진다", async () => {
    fixture = await createKnowledgeTable([{ id: "a" }]);
    manager = new HybridDatabaseManager(fixture.dir);

    expect(() => manager!.getSQLite()).toThrow(UserFacingError);
    expect(() => manager!.getSQLite()).toThrow(/egovframe\.db/);
  });

  it("실패한 뒤에 파일이 생기면 다음 호출에서 다시 열고, 한 번 연 연결은 계속 쓴다", async () => {
    fixture = await createKnowledgeTable([{ id: "a" }]);
    manager = new HybridDatabaseManager(fixture.dir);
    expect(() => manager!.getSQLite()).toThrow(UserFacingError);

    // 쓰기 모드로 한 번 열어 빈 DB 파일을 만든다
    new SQLiteManager(path.join(fixture.dir, "egovframe.db")).close();

    const sqlite = manager.getSQLite();
    expect(sqlite.getCategories()).toEqual([]);
    expect(manager.getSQLite()).toBe(sqlite);
  });
});
