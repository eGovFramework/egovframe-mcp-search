#!/usr/bin/env node

/**
 * eGovFrame MCP Companion
 *
 * Exposes a single unified knowledge/reference search tool
 * (egov_search_knowledge) that internally fans out to guide, knowledge base,
 * standard terms, compatibility, and common component sources.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { egovSearchKnowledge } from "./tools/egovSearchKnowledge.js";

const server = new Server(
  {
    name: "egovframe-mcp-search",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const hiddenUnifiedToolNames = new Set([
  "search_compatible_software",
  "search_knowledge",
  "search_guide",
  "search_standard_terms",
  "get_standard_term",
  "list_common_components",
  "get_component_info",
  "search_common_components",
  "resolve_component_dependencies",
  "get_component_source_files",
  "read_component_source",
  "get_component_ddl",
  "get_component_dml",
]);

const internalKnowledgeMutationToolNames = new Set([
  "add_knowledge",
  "update_knowledge",
  "delete_knowledge",
]);

const hiddenGenerationToolNames = new Set([
  "normalize_ddl",
  "review_code",
  "generate_crud",
  "generate_config",
]);

const retiredToolNames = new Set([
  "egov_check_compliance",
  "egov_scaffold_project",
  "egov_add_entity",
  "egov_add_query_view",
]);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "egov_search_knowledge",
        description:
          "Unified eGovFrame knowledge/reference search gateway. Searches official guides, personal knowledge, standard terms, common components, component source/DDL/DML, and compatible software through one tool.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description:
                "Search question or keyword. Required for guide, knowledge, compatibility keyword, and all-scope searches.",
            },
            scope: {
              type: "string",
              enum: ["auto", "guide", "knowledge", "terms", "components", "compatibility", "all"],
              description: "Search scope. Use auto to infer the best source from query and filters. Default: auto.",
              default: "auto",
            },
            action: {
              type: "string",
              description:
                "Optional sub-action for scoped lookup. Components support: get/info, dependencies, sourceFiles, readSource, ddl, dml. Terms support: get.",
            },
            filters: {
              type: "object",
              description:
                "Scope-specific filters. Examples: { layer, category, limit }, { koreanName, fulltext }, { componentId, componentIds, dbType, filePath }, { frameworkVersion, vendor, productName, includeKnowledge }.",
            },
            limit: {
              type: "number",
              description: "Maximum result count for scopes that support pagination/search limits.",
            },
            strictScope: {
              type: "boolean",
              description:
                "If true, search only the inferred/requested scope. Explicit scope values are respected even when this is omitted; auto scope may expand broad keyword searches to all knowledge sources.",
              default: false,
            },
          },
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (hiddenUnifiedToolNames.has(name)) {
      throw new Error(
        `Tool '${name}' is integrated into egov_search_knowledge and is no longer exposed. Use egov_search_knowledge with the appropriate scope/action instead.`,
      );
    }
    if (internalKnowledgeMutationToolNames.has(name)) {
      throw new Error(
        `Tool '${name}' is an internal knowledge ingestion API and is no longer exposed. Update source knowledge files and rebuild the index instead.`,
      );
    }
    if (hiddenGenerationToolNames.has(name)) {
      throw new Error(`Tool '${name}' is no longer exposed by this MCP server.`);
    }
    if (retiredToolNames.has(name)) {
      throw new Error(
        `Tool '${name}' has been removed from this MCP server. Only egov_search_knowledge is exposed now.`,
      );
    }

    switch (name) {
      case "egov_search_knowledge": {
        const result = await egovSearchKnowledge(args as any);
        return {
          content: [{ type: "text", text: result }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    console.error(`Error executing tool '${name}':`, error);
    throw error;
  }
});

async function main() {
  try {
    console.error("[egovframe-mcp] Creating transport...");
    const transport = new StdioServerTransport();

    console.error("[egovframe-mcp] Connecting server...");
    await server.connect(transport);

    console.error("[egovframe-mcp] ✓ Server started successfully");
  } catch (error) {
    console.error("[egovframe-mcp] ✗ Failed to start:", error);
    throw error;
  }
}

main().catch((error) => {
  console.error("[egovframe-mcp] Fatal error:", error);
  process.exit(1);
});
