#!/usr/bin/env node

/**
 * eGovFrame MCP Companion
 *
 * Exposes a single unified knowledge/reference search tool
 * (egov_search_knowledge) that internally fans out to guide, knowledge base,
 * standard terms, compatibility, and common component sources.
 *
 * Note: 과거 분리되어 있던 도구들 (search_guide, list_common_components, …) 은
 * 이 도구의 scope/action 으로 통합되었으며 더 이상 노출되지 않습니다.
 * SDK 1.x 의 McpServer 는 미등록 도구에 대해 표준 JSON-RPC "Method not found"
 * 에러를 자동 반환하므로, 과거 버전에 있던 retire/hidden 안내 메시지는 제거되었습니다.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { egovSearchKnowledge } from "./tools/egovSearchKnowledge.js";

const server = new McpServer({
  name: "egovframe-mcp-search",
  version: "1.0.0",
});

server.registerTool(
  "egov_search_knowledge",
  {
    title: "eGovFrame Knowledge Search",
    description:
      "Unified eGovFrame knowledge/reference search gateway. Searches official guides, personal knowledge, standard terms, common components, component source/DDL/DML, and compatible software through one tool.",
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
          "terms",
          "components",
          "compatibility",
          "all",
        ])
        .optional()
        .describe(
          "Search scope. Use auto to infer the best source from query and filters. Default: auto.",
        ),
      action: z
        .string()
        .optional()
        .describe(
          "Optional sub-action for scoped lookup. Components support: get/info, dependencies, sourceFiles, readSource, ddl, dml. Terms support: get.",
        ),
      filters: z
        .record(z.any())
        .optional()
        .describe(
          "Scope-specific filters. Examples: { layer, category, limit }, { koreanName, fulltext }, { componentId, componentIds, dbType, filePath }, { frameworkVersion, vendor, productName, includeKnowledge }.",
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
    try {
      const result = await egovSearchKnowledge(args as any);
      return { content: [{ type: "text", text: result }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[egovframe-mcp-search] egov_search_knowledge failed:`, error);
      return {
        content: [{ type: "text", text: message }],
        isError: true,
      };
    }
  },
);

async function main() {
  try {
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
