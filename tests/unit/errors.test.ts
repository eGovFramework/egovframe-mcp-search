/**
 * 도구 오류 문구 변환 단위 테스트
 *
 * 도구 응답에는 스택 트레이스·절대 경로·내부 SQL 이 나가면 안 된다.
 * 호출자가 읽고 조치할 수 있는 오류(UserFacingError)만 원문을 전달하고,
 * 나머지는 고정 문구로 바꾸는지 검증한다.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  INTERNAL_ERROR_MESSAGE,
  UserFacingError,
  toUserMessage,
} from "../../src/utils/errors.js";

describe("toUserMessage", () => {
  it("UserFacingError 의 메시지는 그대로 전달한다", () => {
    expect(toUserMessage(new UserFacingError("query is required for guide search"))).toBe(
      "query is required for guide search",
    );
  });

  it("그 밖의 오류는 내부 정보를 뺀 고정 문구로 바꾼다", () => {
    const leaky = new Error(
      "lance error: Invalid user input: SELECT 1 FROM t WHERE layer = 'x', /Users/someone/app/knowledge-base/egovframe_guide.lance/src/lib.rs:42",
    );
    const message = toUserMessage(leaky);
    expect(message).toBe(INTERNAL_ERROR_MESSAGE);
    expect(message).not.toContain("/Users/someone");
    expect(message).not.toContain("SELECT");
  });

  it("Error 가 아닌 값이 던져져도 고정 문구를 돌려준다", () => {
    expect(toUserMessage("문자열 오류 /abs/path")).toBe(INTERNAL_ERROR_MESSAGE);
    expect(toUserMessage(undefined)).toBe(INTERNAL_ERROR_MESSAGE);
  });

  it("네이티브 모듈 ABI 불일치는 Node 22 가 필요하다는 안내로 바꾼다", () => {
    const abi = new Error(
      "The module '/opt/pkg/node_modules/better-sqlite3/build/Release/better_sqlite3.node'\n" +
        "was compiled against a different Node.js version using\n" +
        "NODE_MODULE_VERSION 127. This version of Node.js requires\nNODE_MODULE_VERSION 115.",
    );
    (abi as NodeJS.ErrnoException).code = "ERR_DLOPEN_FAILED";
    const message = toUserMessage(abi);
    expect(message).toContain("Node.js 22");
    expect(message).toContain(process.version);
    expect(message).not.toContain("/opt/pkg");
  });
});

describe("runEgovSearchKnowledge 의 오류 응답", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("../../src/rag/guideManager.js");
    vi.restoreAllMocks();
  });

  it("입력 검증 오류는 원문 그대로 isError 로 돌려준다", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { runEgovSearchKnowledge } = await import("../../src/tools/egovSearchKnowledge.js");
    const result = await runEgovSearchKnowledge({ scope: "guide" });
    expect(result.isError).toBe(true);
    expect(result.text).toBe("query is required for guide search");
  });

  it("내부 오류의 절대 경로와 SQL 은 응답에 넣지 않는다", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.doMock("../../src/rag/guideManager.js", () => ({
      getInitializedGuideManager: async () => {
        throw new Error("lance error: SELECT 1 FROM t WHERE layer = 'x' at /Users/someone/secret/dir");
      },
    }));
    const { runEgovSearchKnowledge } = await import("../../src/tools/egovSearchKnowledge.js");
    const result = await runEgovSearchKnowledge({ scope: "guide", query: "설정" });
    expect(result.isError).toBe(true);
    expect(result.text).toBe(INTERNAL_ERROR_MESSAGE);
    expect(result.text).not.toContain("/Users/someone");
    expect(result.text).not.toContain("SELECT");
  });
});
