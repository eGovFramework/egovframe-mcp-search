/**
 * 진입점 디스패처(build/index.js) 통합 테스트
 *
 * 인자 없이 실행하면 MCP 서버가 뜨고, 그 밖의 인자는 CLI 로 처리된다.
 * CLI 경로는 어떤 경우에도 stdout 에 쓰지 않는다 (stdout 은 stdio 전송 전용).
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "fs";
import * as path from "path";
import { REPO_ROOT, SERVER_ENTRY } from "./_helper.js";

function run(...args: string[]) {
  const result = spawnSync(process.execPath, [SERVER_ENTRY, ...args], {
    encoding: "utf-8",
    input: "",
    timeout: 20_000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("integration — 진입점 디스패처", () => {
  it("--version 은 package.json 의 버전을 stderr 에 출력하고 정상 종료한다", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf-8")) as { version: string };
    for (const flag of ["--version", "-v"]) {
      const result = run(flag);
      expect(result.status, flag).toBe(0);
      expect(result.stderr.trim(), flag).toBe(pkg.version);
      expect(result.stdout, flag).toBe("");
    }
  });

  it("--help 는 사용법을 stderr 에 출력하고 정상 종료한다", () => {
    for (const flag of ["--help", "-h"]) {
      const result = run(flag);
      expect(result.status, flag).toBe(0);
      expect(result.stderr, flag).toContain("사용법:");
      expect(result.stderr, flag).toContain("update --check");
      expect(result.stderr, flag).not.toContain("알 수 없는 명령");
      expect(result.stdout, flag).toBe("");
    }
  });

  it("알 수 없는 명령은 사용법과 함께 실패로 종료한다", () => {
    const result = run("bogus");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("알 수 없는 명령입니다: bogus");
    expect(result.stderr).toContain("사용법:");
    expect(result.stdout).toBe("");
  });
});
