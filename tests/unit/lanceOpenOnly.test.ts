/**
 * LanceDB 매니저의 "열기 전용" 초기화 단위 테스트
 *
 * 검색 서버가 테이블을 열지 못했을 때 빈 테이블을 새로 만들면, 인덱스가 설치되지 않은 상황이
 * "검색 결과 0건"으로 보이고 읽기 전용이어야 할 도구가 디스크에 쓰게 된다.
 * 서버 경로는 createIfMissing: false 로 초기화해 테이블을 만들지 않고 안내 오류를 던져야 한다.
 * 인덱스 구축(build-index)과 update CLI 가 쓰는 기본 동작(없으면 생성)은 유지한다.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GuideSearchManager } from "../../src/rag/guideManager.js";
import { DeveloperKnowledgeManager } from "../../src/rag/knowledgeManager.js";
import { UserFacingError } from "../../src/utils/errors.js";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";

describe("LanceDB 매니저의 열기 전용 초기화", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "egov-lance-open-"));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it("GuideSearchManager 는 없는 테이블을 만들지 않고 조치 방법을 담은 오류를 던진다", async () => {
    const manager = new GuideSearchManager(tmpDir);
    const error = await manager.initialize({ createIfMissing: false }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as Error).message).toContain("knowledge-base/egovframe_guide.lance");
    expect((error as Error).message).toContain("build-index");
    expect((error as Error).message).not.toContain(tmpDir);
    expect(fs.readdirSync(tmpDir)).toEqual([]);
  });

  it("DeveloperKnowledgeManager 는 없는 테이블을 만들지 않고 조치 방법을 담은 오류를 던진다", async () => {
    const manager = new DeveloperKnowledgeManager(tmpDir);
    const error = await manager.initialize({ createIfMissing: false }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as Error).message).toContain("knowledge-base/developer_knowledge.lance");
    expect((error as Error).message).toContain("build-index");
    expect((error as Error).message).not.toContain(tmpDir);
    expect(fs.readdirSync(tmpDir)).toEqual([]);
  });

  it("지식베이스 디렉토리 자체가 없어도 디렉토리를 만들지 않는다", async () => {
    const missing = path.join(tmpDir, "not-installed");
    const error = await new GuideSearchManager(missing).initialize({ createIfMissing: false }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UserFacingError);
    expect(fs.existsSync(missing)).toBe(false);
  });

  it("기본값(인덱스 구축 경로)은 지금처럼 없는 테이블을 새로 만든다", async () => {
    await new GuideSearchManager(tmpDir).initialize();
    await new DeveloperKnowledgeManager(tmpDir).initialize();

    expect(fs.readdirSync(tmpDir).sort()).toEqual(["developer_knowledge.lance", "egovframe_guide.lance"]);
  });
});
