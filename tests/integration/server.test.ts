/**
 * Server connectivity & tool inventory integration test
 *
 * MCP 서버가 stdio 로 정상 부팅되고, ListTools 가 현재 노출하기로 합의된 도구
 * (egov_search_knowledge 단 하나) 만 돌려주는지 검증한다.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createMcpClient } from "./_helper.js";

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

  it("노출 도구가 정확히 egov_search_knowledge 하나뿐이다", async () => {
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
