/**
 * Server connectivity & tool inventory integration test
 *
 * MCP 서버가 stdio 로 정상 부팅되고, ListTools 가 현재 노출하기로 합의된 도구
 * (egov_search_knowledge) 만 돌려주는지 검증한다.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { REPO_ROOT, createMcpClient } from "./_helper.js";

/** 서버 모듈(빌드 산출물). 진입점 디스패처가 인자 없이 실행될 때 불러오는 파일이다. */
const SERVER_MODULE = path.join(REPO_ROOT, "build", "server.js");

const EXPECTED_TOOLS = ["egov_search_knowledge"];

describe("integration — MCP server connectivity & inventory", () => {
  let client: Client;

  beforeAll(async () => {
    client = await createMcpClient();
  });

  afterAll(async () => {
    await client?.close();
  });

  it("서버가 stdio 로 응답한다", async () => {
    const tools = await client.listTools();
    expect(Array.isArray(tools.tools)).toBe(true);
  });

  it("노출 도구가 정확히 egov_search_knowledge 뿐이다", async () => {
    const tools = await client.listTools();
    const actual = tools.tools.map((t) => t.name).sort();
    expect(actual).toEqual(EXPECTED_TOOLS);
  });

  it("각 도구가 description 과 inputSchema 를 갖는다", async () => {
    const tools = await client.listTools();
    for (const t of tools.tools) {
      expect(t.description, `${t.name} 에 description 이 없습니다`).toBeTruthy();
      expect(t.inputSchema, `${t.name} 에 inputSchema 가 없습니다`).toBeTruthy();
      expect((t.inputSchema as any).type).toBe("object");
    }
  });

  it("egov_search_knowledge 가 핵심 파라미터를 노출한다", async () => {
    const tools = await client.listTools();
    const search = tools.tools.find((t) => t.name === "egov_search_knowledge");
    expect(search).toBeDefined();
    const props = (search!.inputSchema as any).properties || {};
    for (const key of ["query", "scope", "action", "filters", "limit", "strictScope"]) {
      expect(props[key], `${key} 가 inputSchema 에 없습니다`).toBeDefined();
    }
  });
});

describe("integration — 서버 프로세스의 견고성", () => {
  it("처리되지 않은 프라미스 거부가 나도 서버 프로세스가 종료되지 않는다", () => {
    // 의존 라이브러리 안에서 처리되지 않은 거부가 나면 Node 는 기본 동작으로 프로세스를 끝낸다.
    // MCP 서버가 그렇게 죽으면 호출자는 연결이 끊겼다는 것만 알게 되고 다른 조회도 쓸 수 없게 된다.
    const script = [
      `await import(${JSON.stringify(pathToFileURL(SERVER_MODULE).href)});`,
      `Promise.reject(new Error("unhandled-rejection-probe"));`,
      `setTimeout(() => { console.error("STILL_ALIVE"); process.exit(0); }, 500);`,
    ].join("\n");
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf-8",
      timeout: 20_000,
    });

    expect(result.stderr).toContain("STILL_ALIVE");
    expect(result.status).toBe(0);
    // 무슨 일이 있었는지는 서버 로그에 남긴다
    expect(result.stderr).toContain("unhandled-rejection-probe");
    // stdout 은 JSON-RPC 전용이다
    expect(result.stdout).toBe("");
  });
});
