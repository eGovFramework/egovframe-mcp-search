#!/usr/bin/env node

/**
 * eGovFrame MCP Companion
 *
 * Exposes one tool:
 *  - egov_search_knowledge: a unified read-only knowledge/reference search
 *    gateway that internally fans out to guide, knowledge base,
 *    compatibility, and common component sources.
 *
 * Note: 과거 분리되어 있던 도구들 (search_guide, list_common_components, …) 은
 * 이 도구의 scope/action 으로 통합되었으며 더 이상 노출되지 않습니다.
 * SDK 1.x 의 McpServer 는 미등록 도구에 대해 표준 JSON-RPC "Method not found"
 * 에러를 자동 반환하므로, 과거 버전에 있던 retire/hidden 안내 메시지는 제거되었습니다.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import Database from "better-sqlite3";
import { toUserMessage } from "./utils/errors.js";
import { COMPONENT_ACTIONS, runEgovSearchKnowledge } from "./tools/egovSearchKnowledge.js";

const server = new McpServer({
  name: "egovframe-mcp-search",
  version: "1.0.0",
});

server.registerTool(
  "egov_search_knowledge",
  {
    title: "eGovFrame Knowledge Search",
    description:
      "Read-only SEARCH/RETRIEVAL gateway for existing eGovFrame reference material: official Developer Guide (의미 검색), 개인 지식 베이스, 공통컴포넌트 메타와 그 PRE-BUILT CREATE TABLE/INSERT 문 (예: '게시판 컴포넌트 DDL 보여줘'), 호환 SW 카탈로그. This tool does NOT compose new schemas — it only retrieves what already exists in the knowledge base.",
    inputSchema: {
      query: z
        .string()
        .optional()
        .describe(
          "Search question or keyword. Required for guide, knowledge, compatibility keyword, and all-scope searches.",
        ),
      scope: z
        .enum([
          "auto",
          "guide",
          "knowledge",
          "components",
          "compatibility",
          "all",
        ])
        .optional()
        .describe(
          "Search scope. Use auto to infer the best source from query and filters. Default: auto.",
        ),
      // 빈 문자열은 "지정하지 않음"으로 받는다 (쓰지 않는 선택 파라미터를 "" 로 채워 보내는 클라이언트 호환).
      action: z
        .preprocess((value) => (value === "" ? undefined : value), z.enum(COMPONENT_ACTIONS).optional())
        .describe(
          "Optional sub-action, supported only for the components scope. get/info: component detail (filters.componentId). dependencies: transitive dependencies (filters.componentIds array, or a single filters.componentId). sourceFiles: source file list (filters.componentId). readSource: one source file (filters.filePath). ddl: pre-built CREATE TABLE statements (filters.componentId, optional filters.dbType). dml: initial INSERT statements (filters.componentId, optional filters.dbType). Without an action, filters.componentId returns the component detail and otherwise the component list/search runs.",
        ),
      filters: z
        .record(z.string(), z.any())
        .optional()
        .describe(
          "Scope-specific filters. Examples: { layer, category, limit }, { componentId, componentIds, dbType, filePath }, { frameworkVersion, vendor, productName, includeKnowledge }.",
        ),
      limit: z
        .number()
        .optional()
        .describe(
          "Maximum result count for scopes that support pagination/search limits.",
        ),
      strictScope: z
        .boolean()
        .optional()
        .describe(
          "If true, search only the inferred/requested scope. Explicit scope values are respected even when this is omitted; auto scope may expand broad keyword searches to all knowledge sources.",
        ),
    },
  },
  async (args) => {
    const result = await runEgovSearchKnowledge(args);
    return {
      content: [{ type: "text", text: result.text }],
      ...(result.isError ? { isError: true } : {}),
    };
  },
);

/**
 * 번들된 네이티브 모듈(better-sqlite3)이 현재 Node 에서 로드되는지 시작 시점에 한 번 확인한다.
 *
 * 배포 tgz 의 바이너리는 패키징 시점의 Node ABI(Node 22)에 고정되어 있어, 다른 메이저 버전에서는
 * 서버는 정상적으로 뜨지만 첫 SQLite 조회에서야 실패한다. 원인을 바로 알 수 있도록 stderr 에
 * 한 줄을 남기고, 서버는 계속 띄운다 (가이드 검색 등 SQLite 를 쓰지 않는 기능은 동작한다).
 */
function warnIfNativeModuleUnavailable(): void {
  try {
    new Database(":memory:").close();
  } catch (error) {
    console.error(`[egovframe-mcp-search] ⚠ ${toUserMessage(error)}`);
  }
}

async function main() {
  try {
    warnIfNativeModuleUnavailable();

    console.error("[egovframe-mcp-search] Creating transport...");
    const transport = new StdioServerTransport();

    console.error("[egovframe-mcp-search] Connecting server...");
    await server.connect(transport);

    console.error("[egovframe-mcp-search] ✓ Server started successfully");
  } catch (error) {
    console.error("[egovframe-mcp-search] ✗ Failed to start:", error);
    throw error;
  }
}

main().catch((error) => {
  console.error("[egovframe-mcp-search] Fatal error:", error);
  process.exit(1);
});
