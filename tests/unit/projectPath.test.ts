/**
 * 프로젝트 경로 유틸(src/utils/projectPath.ts) 단위 테스트
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { findProjectRoot } from "../../src/utils/projectPath.js";

describe("findProjectRoot", () => {
  const created: string[] = [];

  async function makeProject(): Promise<{ root: string; deep: string }> {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "egov-project-root-")));
    created.push(root);
    const deep = path.join(root, "build", "tools");
    await fs.ensureDir(deep);
    await fs.writeJSON(path.join(root, "package.json"), { name: "fixture" });
    return { root, deep };
  }

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(created.splice(0).map((dir) => fs.remove(dir)));
  });

  it("package.json 이 있는 가장 가까운 상위 디렉토리를 돌려준다", async () => {
    const { root, deep } = await makeProject();
    expect(findProjectRoot(deep)).toBe(root);
  });

  it("시작 경로가 파일이면 그 파일이 있는 디렉토리에서 찾기 시작한다", async () => {
    const { root, deep } = await makeProject();
    const file = path.join(deep, "module.js");
    await fs.writeFile(file, "");
    expect(findProjectRoot(file)).toBe(root);
  });

  it("같은 시작 경로를 다시 찾을 때는 로그를 남기지 않는다", async () => {
    // 조회 호출마다 경로를 다시 찾으며 절대 경로 두 줄을 stderr 에 찍으면 서버 로그가 이 줄로 채워진다
    const { root, deep } = await makeProject();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(findProjectRoot(deep)).toBe(root);
    const firstCallLines = logged.mock.calls.length;
    expect(firstCallLines).toBeGreaterThan(0);

    expect(findProjectRoot(deep)).toBe(root);
    expect(findProjectRoot(deep)).toBe(root);
    expect(logged.mock.calls.length).toBe(firstCallLines);
  });

  it("시작 경로가 다르면 따로 찾는다", async () => {
    const first = await makeProject();
    const second = await makeProject();
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(findProjectRoot(first.deep)).toBe(first.root);
    expect(findProjectRoot(second.deep)).toBe(second.root);
  });
});
