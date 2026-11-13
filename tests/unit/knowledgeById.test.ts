/**
 * 개발자 지식의 id 기준 조회·갱신·삭제 단위 테스트
 *
 * getKnowledgeById / updateKnowledge / deleteKnowledge 는 id 를 where 절에 넣는다. id 를 그대로 이어
 * 붙이면 작은따옴표가 든 값이 조건을 바꿔 (`id = 'x' OR '1'='1'`) 엉뚱한 행을 돌려주거나 테이블 전체를
 * 지운다. id 가 리터럴로만 쓰이는지 확인한다.
 *
 * 삭제·갱신을 실제로 실행하므로 테스트마다 임시 테이블을 새로 만든다 (_knowledgeTableFixture 참고).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { DeveloperKnowledgeManager } from "../../src/rag/knowledgeManager.js";
import { createKnowledgeTable, type KnowledgeTableFixture } from "./_knowledgeTableFixture.js";

/** 조건을 바꾸거나 질의를 깨뜨리려는 id */
const HOSTILE_IDS = [
  "x' OR '1'='1",
  "x' OR 1=1 --",
  "a' OR id = 'b",
  "' OR id != '",
  "a'; DROP TABLE developer_knowledge; --",
  "'",
  "''",
];

describe("개발자 지식 — id 기준 조회·갱신·삭제", () => {
  let fixture: KnowledgeTableFixture;
  let manager: DeveloperKnowledgeManager;

  beforeEach(async () => {
    // 매니저의 진행 로그(stderr)는 테스트 출력에서 가린다
    vi.spyOn(console, "error").mockImplementation(() => {});
    fixture = await createKnowledgeTable([
      { id: "a", title: "문서 A", importance: 3 },
      { id: "b", title: "문서 B", importance: 3 },
    ]);
    manager = fixture.manager;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fixture.cleanup();
  });

  it("getKnowledgeById 는 id 가 정확히 같은 행만 돌려준다", async () => {
    expect((await manager.getKnowledgeById("a"))?.title).toBe("문서 A");
    expect((await manager.getKnowledgeById("b"))?.title).toBe("문서 B");
    expect(await manager.getKnowledgeById("없는-id")).toBeNull();
  });

  it("getKnowledgeById 는 작은따옴표가 든 id 로 다른 행을 돌려주지 않는다", async () => {
    for (const id of HOSTILE_IDS) {
      expect(await manager.getKnowledgeById(id), id).toBeNull();
    }
  });

  it("deleteKnowledge 는 id 가 정확히 같은 행만 지운다", async () => {
    await manager.deleteKnowledge("a");
    expect(await fixture.ids()).toEqual(["b"]);
  });

  it("deleteKnowledge 는 작은따옴표가 든 id 로 다른 행을 지우지 않는다", async () => {
    for (const id of HOSTILE_IDS) {
      await manager.deleteKnowledge(id);
      expect(await fixture.ids(), id).toEqual(["a", "b"]);
    }
  });

  it("updateKnowledge 는 작은따옴표가 든 id 를 없는 행으로 거부하고 테이블을 바꾸지 않는다", async () => {
    for (const id of HOSTILE_IDS) {
      await expect(manager.updateKnowledge({ id, importance: 5 }), id).rejects.toThrow("찾을 수 없습니다");
      expect(await fixture.ids(), id).toEqual(["a", "b"]);
    }
    expect((await manager.getKnowledgeById("a"))?.importance).toBe(3);
    expect((await manager.getKnowledgeById("b"))?.importance).toBe(3);
  });
});

describe("개발자 지식 — 작은따옴표가 든 id 가 저장된 테이블", () => {
  let fixture: KnowledgeTableFixture;
  let manager: DeveloperKnowledgeManager;

  beforeEach(async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fixture = await createKnowledgeTable([
      { id: "it's", title: "따옴표 문서" },
      { id: "x' OR '1'='1", title: "조건처럼 생긴 id" },
      { id: "plain", title: "보통 문서" },
    ]);
    manager = fixture.manager;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fixture.cleanup();
  });

  it("getKnowledgeById 는 그 id 의 행을 찾는다", async () => {
    expect((await manager.getKnowledgeById("it's"))?.title).toBe("따옴표 문서");
    expect((await manager.getKnowledgeById("x' OR '1'='1"))?.title).toBe("조건처럼 생긴 id");
  });

  it("deleteKnowledge 는 그 id 의 행만 지운다", async () => {
    await manager.deleteKnowledge("x' OR '1'='1");
    expect(await fixture.ids()).toEqual(["it's", "plain"]);

    await manager.deleteKnowledge("it's");
    expect(await fixture.ids()).toEqual(["plain"]);
  });
});
