/**
 * ensureEgovframeDocs / ensureCommonComponentsSrc 통합 테스트.
 *
 * 임시 디렉터리에 로컬 git 저장소(업스트림/부모/서브모듈)를 실제로 만들어
 * 전략별 갱신 동작을 검증한다. 네트워크 접근은 없다 — 모든 remote 는 로컬 file 경로이며,
 * 서브모듈 fetch 를 위해 GIT_ALLOW_PROTOCOL=file 을 테스트 동안만 설정한다.
 * 실제 templates/ 하위는 절대 건드리지 않는다.
 *
 * 핵심 규칙 (인터랙티브 태그 선택):
 * - selectTag 콜백에 최신 태그 목록(최대 10개)과 현재 적용 태그를 넘긴다.
 * - 콜백이 '' (엔터) 또는 현재 태그명을 반환하면 체크아웃을 유지한다.
 * - 콜백이 다른 태그명을 반환하면 그 태그의 소스를 체크아웃한다.
 * - 콜백이 없으면(비대화형) 현재 체크아웃을 유지한다.
 * - 태그가 하나도 없는 원격이면 콜백 없이 브랜치 최신 커밋으로 폴백한다.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import {
  ensureEgovframeDocs,
  ensureCommonComponentsSrc,
  TagSelectionAbortedError,
  type TagSelectionContext,
} from "../../src/scripts/templateSources.js";

const GUIDE_REL = "templates/egovframe_guide";
const COMPONENTS_REL = "templates/common-components-src";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, stdio: "pipe" }).toString();
}

/** 커밋 가능한 로컬 저장소 초기화 (사용자 설정 포함) */
function initRepo(dir: string): void {
  fs.ensureDirSync(dir);
  git(dir, "init", "-b", "main");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "tester");
  git(dir, "config", "commit.gpgsign", "false");
  // 전역 설정에 태그 서명이 켜져 있으면 메시지 없는 git tag 가 실패한다
  git(dir, "config", "tag.gpgsign", "false");
}

/** 마커 파일 내용을 갱신하고 커밋. tag 를 주면 그 커밋에 태깅. */
function commitMarker(upstream: string, markerFile: string, content: string, tag?: string): void {
  fs.outputFileSync(path.join(upstream, markerFile), content);
  git(upstream, "add", "-A");
  git(upstream, "commit", "-m", `update to: ${content}`);
  if (tag) {
    git(upstream, "tag", tag);
  }
}

/** 항상 같은 값을 반환하는 selectTag 스파이 (전달된 컨텍스트 기록) */
function selectorReturning(answer: string) {
  const calls: TagSelectionContext[] = [];
  const selectTag = async (ctx: TagSelectionContext) => {
    calls.push(ctx);
    return answer;
  };
  return { selectTag, calls };
}

let workDir: string;
let upstream: string;
let parentRoot: string;
let guideDir: string;
let savedAllowProtocol: string | undefined;

beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), "ensure-sources-"));
  upstream = path.join(workDir, "upstream");
  parentRoot = path.join(workDir, "parent");
  guideDir = path.join(parentRoot, GUIDE_REL);

  savedAllowProtocol = process.env.GIT_ALLOW_PROTOCOL;
  process.env.GIT_ALLOW_PROTOCOL = "file";

  initRepo(upstream);
});

afterEach(async () => {
  if (savedAllowProtocol === undefined) {
    delete process.env.GIT_ALLOW_PROTOCOL;
  } else {
    process.env.GIT_ALLOW_PROTOCOL = savedAllowProtocol;
  }
  await fs.remove(workDir);
});

/** 부모 저장소에 upstream 을 서브모듈로 등록하고 커밋 */
function setupParentWithSubmodule(rel: string = GUIDE_REL): void {
  initRepo(parentRoot);
  git(parentRoot, "-c", "protocol.file.allow=always", "submodule", "add", upstream, rel);
  git(parentRoot, "commit", "-m", "add submodule");
}

async function readMarker(dir: string, markerFile = "_index.md"): Promise<string> {
  return fs.readFile(path.join(dir, markerFile), "utf-8");
}

describe("ensureEgovframeDocs (서브모듈 + 태그 선택)", () => {
  it("selectTag 가 다른 태그명을 반환하면 그 태그의 소스를 체크아웃한다", async () => {
    commitMarker(upstream, "_index.md", "v1", "v1.0.0");
    setupParentWithSubmodule();
    commitMarker(upstream, "_index.md", "v2", "v1.1.0");
    commitMarker(upstream, "_index.md", "v3-untagged"); // 태그 없는 브랜치 최신 커밋
    const { selectTag } = selectorReturning("v1.1.0");

    const ok = await ensureEgovframeDocs({
      sourceDir: guideDir,
      projectRoot: parentRoot,
      repoUrl: upstream,
      selectTag,
    });

    expect(ok).toBe(true);
    expect(await readMarker(guideDir)).toBe("v2");
  });

  it("selectTag 에 최신 태그 목록(버전 정렬)과 현재 적용 태그를 넘긴다", async () => {
    commitMarker(upstream, "_index.md", "v1", "v1.9.0");
    setupParentWithSubmodule();
    commitMarker(upstream, "_index.md", "v2", "v1.10.0");
    const { selectTag, calls } = selectorReturning("");

    await ensureEgovframeDocs({
      sourceDir: guideDir,
      projectRoot: parentRoot,
      repoUrl: upstream,
      selectTag,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].latestTags).toEqual(["v1.10.0", "v1.9.0"]); // -v:refname 정렬
    expect(calls[0].currentTag).toBe("v1.9.0");
    expect(calls[0].fetchFailed).toBe(false);
  });

  it("selectTag 가 '' (엔터) 를 반환하면 현재 체크아웃을 유지한다", async () => {
    commitMarker(upstream, "_index.md", "v1", "v1.0.0");
    setupParentWithSubmodule();
    commitMarker(upstream, "_index.md", "v2", "v1.1.0");
    const { selectTag } = selectorReturning("");

    const ok = await ensureEgovframeDocs({
      sourceDir: guideDir,
      projectRoot: parentRoot,
      repoUrl: upstream,
      selectTag,
    });

    expect(ok).toBe(true);
    expect(await readMarker(guideDir)).toBe("v1");
  });

  it("selectTag 가 현재 적용된 태그명을 반환해도 체크아웃을 유지한다", async () => {
    commitMarker(upstream, "_index.md", "v1", "v1.0.0");
    setupParentWithSubmodule();
    commitMarker(upstream, "_index.md", "v2", "v1.1.0");
    const { selectTag } = selectorReturning("v1.0.0");

    const ok = await ensureEgovframeDocs({
      sourceDir: guideDir,
      projectRoot: parentRoot,
      repoUrl: upstream,
      selectTag,
    });

    expect(ok).toBe(true);
    expect(await readMarker(guideDir)).toBe("v1");
  });

  it("selectTag 가 없으면(비대화형) 현재 체크아웃을 유지한다", async () => {
    commitMarker(upstream, "_index.md", "v1", "v1.0.0");
    setupParentWithSubmodule();
    commitMarker(upstream, "_index.md", "v2", "v1.1.0");

    const ok = await ensureEgovframeDocs({
      sourceDir: guideDir,
      projectRoot: parentRoot,
      repoUrl: upstream,
    });

    expect(ok).toBe(true);
    expect(await readMarker(guideDir)).toBe("v1");
  });

  it("존재하지 않는 태그명을 반환하면 경고 후 현재 체크아웃을 유지한다", async () => {
    commitMarker(upstream, "_index.md", "v1", "v1.0.0");
    setupParentWithSubmodule();
    commitMarker(upstream, "_index.md", "v2", "v1.1.0");
    const { selectTag } = selectorReturning("v9.9.9");

    const ok = await ensureEgovframeDocs({
      sourceDir: guideDir,
      projectRoot: parentRoot,
      repoUrl: upstream,
      selectTag,
    });

    expect(ok).toBe(true);
    expect(await readMarker(guideDir)).toBe("v1");
  });

  it("selectTag 가 TagSelectionAbortedError 를 던지면(Ctrl+C) 삼키지 않고 전파한다", async () => {
    commitMarker(upstream, "_index.md", "v1", "v1.0.0");
    setupParentWithSubmodule();
    const selectTag = async () => {
      throw new TagSelectionAbortedError("사용자가 태그 선택에서 build-index 를 중단했습니다");
    };

    await expect(
      ensureEgovframeDocs({
        sourceDir: guideDir,
        projectRoot: parentRoot,
        repoUrl: upstream,
        selectTag,
      }),
    ).rejects.toBeInstanceOf(TagSelectionAbortedError);
  });

  it("태그가 11개 이상이면 latestTags 는 10개로 잘리고, 목록 밖 태그도 선택 가능하다", async () => {
    commitMarker(upstream, "_index.md", "c0", "v1.0.0");
    setupParentWithSubmodule();
    for (let i = 1; i <= 11; i++) {
      commitMarker(upstream, "_index.md", `c${i}`, `v1.${i}.0`);
    }
    const { selectTag, calls } = selectorReturning("v1.0.0"); // top 10 밖의 가장 오래된 태그

    const ok = await ensureEgovframeDocs({
      sourceDir: guideDir,
      projectRoot: parentRoot,
      repoUrl: upstream,
      selectTag,
    });

    expect(ok).toBe(true);
    expect(calls[0].latestTags).toHaveLength(10);
    expect(calls[0].latestTags[0]).toBe("v1.11.0");
    expect(calls[0].latestTags).not.toContain("v1.0.0"); // 표시 목록에서는 밀려남
    expect(calls[0].allTags).toHaveLength(12); // 검증 목록에는 전부 존재
    expect(await readMarker(guideDir)).toBe("c0"); // 목록 밖 태그도 체크아웃됨
  });

  it("버전 태그가 없는 원격이면 selectTag 를 부르지 않고 브랜치 최신으로 폴백한다", async () => {
    commitMarker(upstream, "_index.md", "v1");
    setupParentWithSubmodule();
    commitMarker(upstream, "_index.md", "v2");
    const { selectTag, calls } = selectorReturning("");

    const ok = await ensureEgovframeDocs({
      sourceDir: guideDir,
      projectRoot: parentRoot,
      repoUrl: upstream,
      selectTag,
    });

    expect(ok).toBe(true);
    expect(calls).toHaveLength(0);
    expect(await readMarker(guideDir)).toBe("v2");
  });

  it("원격 fetch 실패(오프라인) 시 로컬 태그 기준으로 선택을 계속한다", async () => {
    commitMarker(upstream, "_index.md", "v1", "v1.0.0");
    setupParentWithSubmodule();
    await fs.remove(upstream); // 원격 소실 = 오프라인 상황 재현
    const { selectTag, calls } = selectorReturning("");

    const ok = await ensureEgovframeDocs({
      sourceDir: guideDir,
      projectRoot: parentRoot,
      repoUrl: upstream,
      selectTag,
    });

    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].fetchFailed).toBe(true);
    expect(calls[0].latestTags).toEqual(["v1.0.0"]); // 서브모듈 클론에 남은 로컬 태그
    expect(await readMarker(guideDir)).toBe("v1");
  });

  it("deinit 되어 비어 있는 서브모듈을 초기화한 뒤 선택한 태그로 이동한다", async () => {
    commitMarker(upstream, "_index.md", "v1", "v1.0.0");
    setupParentWithSubmodule();
    commitMarker(upstream, "_index.md", "v2", "v1.1.0");
    git(parentRoot, "submodule", "deinit", "-f", "--", GUIDE_REL);
    const { selectTag } = selectorReturning("v1.1.0");

    const ok = await ensureEgovframeDocs({
      sourceDir: guideDir,
      projectRoot: parentRoot,
      repoUrl: upstream,
      selectTag,
    });

    expect(ok).toBe(true);
    expect(await readMarker(guideDir)).toBe("v2");
  });
});

describe("ensureEgovframeDocs (독립 클론 + 태그 선택)", () => {
  it("독립 클론에서도 선택한 태그를 체크아웃한다", async () => {
    commitMarker(upstream, "_index.md", "v1", "v1.0.0");
    fs.ensureDirSync(parentRoot);
    execFileSync("git", ["clone", upstream, guideDir], { stdio: "pipe" });
    commitMarker(upstream, "_index.md", "v2", "v1.1.0");
    const { selectTag } = selectorReturning("v1.1.0");

    const ok = await ensureEgovframeDocs({
      sourceDir: guideDir,
      projectRoot: parentRoot,
      repoUrl: upstream,
      selectTag,
    });

    expect(ok).toBe(true);
    expect(await readMarker(guideDir)).toBe("v2");
  });

  it("버전 태그가 없으면 (대화형) fast-forward pull 로 브랜치 최신을 따른다", async () => {
    commitMarker(upstream, "_index.md", "v1");
    fs.ensureDirSync(parentRoot);
    execFileSync("git", ["clone", upstream, guideDir], { stdio: "pipe" });
    commitMarker(upstream, "_index.md", "v2");
    const { selectTag, calls } = selectorReturning("");

    const ok = await ensureEgovframeDocs({
      sourceDir: guideDir,
      projectRoot: parentRoot,
      repoUrl: upstream,
      selectTag,
    });

    expect(ok).toBe(true);
    expect(calls).toHaveLength(0); // 선택할 태그가 없으므로 프롬프트 없음
    expect(await readMarker(guideDir)).toBe("v2");
  });

  it("비대화형(selectTag 없음)에서는 태그 없는 원격이라도 현재 체크아웃을 유지한다", async () => {
    commitMarker(upstream, "_index.md", "v1");
    fs.ensureDirSync(parentRoot);
    execFileSync("git", ["clone", upstream, guideDir], { stdio: "pipe" });
    commitMarker(upstream, "_index.md", "v2");

    const ok = await ensureEgovframeDocs({
      sourceDir: guideDir,
      projectRoot: parentRoot,
      repoUrl: upstream,
    });

    expect(ok).toBe(true);
    expect(await readMarker(guideDir)).toBe("v1"); // CI 재현성: 소스가 움직이지 않음
  });

  it("브랜치 폴백이 non-fast-forward 로 실패해도 충돌 상태를 남기지 않는다", async () => {
    commitMarker(upstream, "_index.md", "v1");
    fs.ensureDirSync(parentRoot);
    execFileSync("git", ["clone", upstream, guideDir], { stdio: "pipe" });
    git(guideDir, "config", "user.email", "test@example.com");
    git(guideDir, "config", "user.name", "tester");
    commitMarker(guideDir, "_index.md", "local-divergent"); // 로컬 발산 커밋
    commitMarker(upstream, "_index.md", "v2"); // 원격도 전진 → non-FF
    const { selectTag } = selectorReturning("");

    const ok = await ensureEgovframeDocs({
      sourceDir: guideDir,
      projectRoot: parentRoot,
      repoUrl: upstream,
      selectTag,
    });

    expect(ok).toBe(true);
    // 충돌 마커/리베이스 진행 상태가 남지 않고 로컬 상태 그대로
    expect(await readMarker(guideDir)).toBe("local-divergent");
    expect(await fs.pathExists(path.join(guideDir, ".git", "rebase-merge"))).toBe(false);
    expect(await fs.pathExists(path.join(guideDir, ".git", "rebase-apply"))).toBe(false);
  });

  it("오프라인 + 로컬 태그도 없으면 기존 파일을 유지하고 true 를 반환한다", async () => {
    commitMarker(upstream, "_index.md", "v1");
    fs.ensureDirSync(parentRoot);
    execFileSync("git", ["clone", upstream, guideDir], { stdio: "pipe" });
    await fs.remove(upstream);
    const { selectTag, calls } = selectorReturning("");

    const ok = await ensureEgovframeDocs({
      sourceDir: guideDir,
      projectRoot: parentRoot,
      repoUrl: upstream,
      selectTag,
    });

    expect(ok).toBe(true);
    expect(calls).toHaveLength(0);
    expect(await readMarker(guideDir)).toBe("v1");
  });

  it("디렉터리가 없으면 클론한 뒤 선택한 태그로 이동한다", async () => {
    commitMarker(upstream, "_index.md", "v1", "v1.0.0");
    commitMarker(upstream, "_index.md", "v2-untagged");
    fs.ensureDirSync(parentRoot);
    const { selectTag } = selectorReturning("v1.0.0");

    const ok = await ensureEgovframeDocs({
      sourceDir: guideDir,
      projectRoot: parentRoot,
      repoUrl: upstream,
      selectTag,
    });

    expect(ok).toBe(true);
    expect(await readMarker(guideDir)).toBe("v1");
  });

  it("클론 후 selectTag 가 '' 를 반환하면 클론된 상태를 유지한다", async () => {
    commitMarker(upstream, "_index.md", "v1", "v1.0.0");
    commitMarker(upstream, "_index.md", "v2-untagged");
    fs.ensureDirSync(parentRoot);
    const { selectTag } = selectorReturning("");

    const ok = await ensureEgovframeDocs({
      sourceDir: guideDir,
      projectRoot: parentRoot,
      repoUrl: upstream,
      selectTag,
    });

    expect(ok).toBe(true);
    expect(await readMarker(guideDir)).toBe("v2-untagged");
  });
});

describe("ensureEgovframeDocs (확보 실패 경로)", () => {
  it("클론 실패 시 예외 대신 false 를 반환한다", async () => {
    fs.ensureDirSync(parentRoot);
    const missingRepo = path.join(workDir, "no-such-repo");

    const ok = await ensureEgovframeDocs({
      sourceDir: guideDir,
      projectRoot: parentRoot,
      repoUrl: missingRepo,
    });

    expect(ok).toBe(false);
  });

  it("서브모듈 초기화 실패 시 예외 대신 false 를 반환한다", async () => {
    initRepo(parentRoot);
    // .gitmodules 에는 등록되어 있으나 인덱스에 gitlink 가 없는 비정상 상태
    await fs.outputFile(
      path.join(parentRoot, ".gitmodules"),
      [
        '[submodule "templates/egovframe_guide"]',
        "\tpath = templates/egovframe_guide",
        `\turl = ${path.join(workDir, "no-such-repo")}`,
        "",
      ].join("\n"),
    );

    const ok = await ensureEgovframeDocs({
      sourceDir: guideDir,
      projectRoot: parentRoot,
      repoUrl: upstream,
    });

    expect(ok).toBe(false);
  });
});

describe("ensureEgovframeDocs (git 없는 배포본)", () => {
  it("마커 파일만 있으면 selectTag 호출 없이 그대로 사용한다", async () => {
    await fs.outputFile(path.join(guideDir, "_index.md"), "bundled");
    const { selectTag, calls } = selectorReturning("v1.0.0");

    const ok = await ensureEgovframeDocs({
      sourceDir: guideDir,
      projectRoot: parentRoot,
      repoUrl: upstream,
      selectTag,
    });

    expect(ok).toBe(true);
    expect(calls).toHaveLength(0);
    expect(await readMarker(guideDir)).toBe("bundled");
  });
});

describe("ensureCommonComponentsSrc", () => {
  it("pom.xml 마커로 서브모듈을 감지하고 선택한 태그로 갱신한다", async () => {
    const componentsDir = path.join(parentRoot, COMPONENTS_REL);
    commitMarker(upstream, "pom.xml", "<project>v5.0.1</project>", "v5.0.1");
    setupParentWithSubmodule(COMPONENTS_REL);
    commitMarker(upstream, "pom.xml", "<project>v5.0.6</project>", "v5.0.6");
    commitMarker(upstream, "pom.xml", "<project>develop</project>"); // 태그 없는 최신
    const { selectTag, calls } = selectorReturning("v5.0.6");

    const ok = await ensureCommonComponentsSrc({
      sourceDir: componentsDir,
      projectRoot: parentRoot,
      repoUrl: upstream,
      selectTag,
    });

    expect(ok).toBe(true);
    expect(calls[0].currentTag).toBe("v5.0.1");
    expect(await readMarker(componentsDir, "pom.xml")).toBe("<project>v5.0.6</project>");
  });
});
