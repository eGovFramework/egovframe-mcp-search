/**
 * templateSources 단위 테스트.
 *
 * - resolveSourceStrategy: 템플릿 소스 디렉터리의 체크아웃 형태(서브모듈/독립 클론/파일만/없음)에
 *   따른 갱신 전략 결정을 임시 디렉터리 픽스처로만 검증한다.
 * - filterVersionTags: git 이 버전순(-v:refname)으로 정렬해 준 태그 목록에서
 *   버전 형태 태그만 순서를 유지하며 골라내는 순수 함수 검증.
 * 실제 git 실행이나 네트워크 접근은 하지 않는다.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import {
  resolveSourceStrategy,
  filterVersionTags,
  runTagSelectionPrompt,
  TagSelectionAbortedError,
  type TagSelectionContext,
} from "../../src/scripts/templateSources.js";

describe("filterVersionTags", () => {
  it("버전 형태 태그만 순서를 유지하며 반환한다", () => {
    expect(filterVersionTags(["v5.0.6", "v5.0.5", "v5.0.1"])).toEqual([
      "v5.0.6",
      "v5.0.5",
      "v5.0.1",
    ]);
  });

  it("버전 형태가 아닌 태그는 걸러낸다", () => {
    expect(filterVersionTags(["latest", "v4.3.0", "sso-login", "v4.2.1"])).toEqual([
      "v4.3.0",
      "v4.2.1",
    ]);
  });

  it("접미사가 붙은 버전 태그도 인식한다 (예: v5.0.0-ready-2026-contribution)", () => {
    expect(filterVersionTags(["v5.0.0-ready-2026-contribution", "v4.3.0"])).toEqual([
      "v5.0.0-ready-2026-contribution",
      "v4.3.0",
    ]);
  });

  it("v 접두사 없는 버전 태그도 인식한다", () => {
    expect(filterVersionTags(["5.0.6"])).toEqual(["5.0.6"]);
  });

  it("버전 태그가 하나도 없으면 빈 배열을 반환한다", () => {
    expect(filterVersionTags([])).toEqual([]);
    expect(filterVersionTags(["latest", "release-candidate"])).toEqual([]);
  });
});

describe("runTagSelectionPrompt", () => {
  const CTX: TagSelectionContext = {
    label: "test-repo",
    latestTags: ["v2.0.0", "v1.0.0"],
    allTags: ["v2.0.0", "v1.0.0", "odd-tag"],
    currentTag: "v1.0.0",
    currentDescription: "v1.0.0",
    fetchFailed: false,
  };

  /** 미리 정해진 답변을 순서대로 돌려주는 ask 스텁 */
  function askReturning(...answers: string[]) {
    let idx = 0;
    const calls: string[] = [];
    const ask = async (question: string) => {
      calls.push(question);
      return answers[idx++] ?? "";
    };
    return { ask, calls };
  }

  it("빈 입력(엔터)이면 '' 를 반환한다 (현재 유지)", async () => {
    const { ask } = askReturning("");
    await expect(runTagSelectionPrompt(CTX, ask)).resolves.toBe("");
  });

  it("현재 적용된 태그명을 입력해도 '' 를 반환한다 (현재 유지)", async () => {
    const { ask } = askReturning("v1.0.0");
    await expect(runTagSelectionPrompt(CTX, ask)).resolves.toBe("");
  });

  it("없는 태그명을 입력하면 재입력을 요청하고, 유효한 태그명이 오면 반환한다", async () => {
    const { ask, calls } = askReturning("v9.9.9", "v2.0.0");
    await expect(runTagSelectionPrompt(CTX, ask)).resolves.toBe("v2.0.0");
    expect(calls).toHaveLength(2);
  });

  it("표시 목록(latestTags) 밖이라도 존재하는 태그명이면 수락한다", async () => {
    const { ask } = askReturning("odd-tag");
    await expect(runTagSelectionPrompt(CTX, ask)).resolves.toBe("odd-tag");
  });

  it("공백이 붙은 입력은 trim 후 판정한다", async () => {
    const { ask } = askReturning("  v2.0.0  ");
    await expect(runTagSelectionPrompt(CTX, ask)).resolves.toBe("v2.0.0");
  });

  it("ask 가 TagSelectionAbortedError 를 던지면 그대로 전파한다 (Ctrl+C)", async () => {
    const ask = async () => {
      throw new TagSelectionAbortedError("사용자 중단");
    };
    await expect(runTagSelectionPrompt(CTX, ask)).rejects.toBeInstanceOf(TagSelectionAbortedError);
  });
});

describe("resolveSourceStrategy", () => {
  const MARKER = "_index.md";
  let projectRoot: string;
  let sourceDir: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "source-strategy-"));
    sourceDir = path.join(projectRoot, "templates", "egovframe_guide");
  });

  afterEach(async () => {
    await fs.remove(projectRoot);
  });

  it("마커 파일이 있고 .git 이 파일이면 서브모듈 체크아웃으로 판단한다", async () => {
    await fs.outputFile(path.join(sourceDir, MARKER), "# guide");
    await fs.outputFile(
      path.join(sourceDir, ".git"),
      "gitdir: ../../.git/modules/templates/egovframe_guide\n",
    );

    await expect(resolveSourceStrategy(sourceDir, projectRoot, MARKER)).resolves.toBe(
      "submodule-update",
    );
  });

  it("마커 파일이 있고 .git 이 디렉터리면 독립 클론으로 판단한다", async () => {
    await fs.outputFile(path.join(sourceDir, MARKER), "# guide");
    await fs.ensureDir(path.join(sourceDir, ".git"));

    await expect(resolveSourceStrategy(sourceDir, projectRoot, MARKER)).resolves.toBe("pull");
  });

  it("마커 파일만 있고 .git 이 없으면 갱신 없이 그대로 사용한다 (tgz 배포본)", async () => {
    await fs.outputFile(path.join(sourceDir, MARKER), "# guide");

    await expect(resolveSourceStrategy(sourceDir, projectRoot, MARKER)).resolves.toBe("use-as-is");
  });

  it("디렉터리가 비어 있고 .gitmodules 에 등록되어 있으면 서브모듈 초기화로 판단한다", async () => {
    await fs.outputFile(
      path.join(projectRoot, ".gitmodules"),
      [
        '[submodule "templates/egovframe_guide"]',
        "\tpath = templates/egovframe_guide",
        "\turl = https://github.com/eGovFramework/egovframe-docs.git",
        "",
      ].join("\n"),
    );

    await expect(resolveSourceStrategy(sourceDir, projectRoot, MARKER)).resolves.toBe(
      "submodule-init",
    );
  });

  it("디렉터리도 .gitmodules 도 없으면 클론으로 판단한다", async () => {
    await expect(resolveSourceStrategy(sourceDir, projectRoot, MARKER)).resolves.toBe("clone");
  });

  it(".gitmodules 가 있어도 다른 경로만 등록되어 있으면 클론으로 판단한다", async () => {
    await fs.outputFile(
      path.join(projectRoot, ".gitmodules"),
      [
        '[submodule "templates/common-components-src"]',
        "\tpath = templates/common-components-src",
        "\turl = https://github.com/eGovFramework/egovframe-common-components.git",
        "",
      ].join("\n"),
    );

    await expect(resolveSourceStrategy(sourceDir, projectRoot, MARKER)).resolves.toBe("clone");
  });
});
