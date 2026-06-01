#!/usr/bin/env node

/**
 * eGovFrame MCP Companion
 *
 * Exposes two tools:
 *  - egov_search_knowledge: a unified read-only knowledge/reference search
 *    gateway that internally fans out to guide, knowledge base, standard terms,
 *    compatibility, and common component sources.
 *  - egov_ddl_assist: a schema-design oracle backed by the 행정안전부 표준용어
 *    사전 for translating/validating Korean domain knowledge into 표준 DDL
 *    fragments.
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
import { egovDdlAssist } from "./tools/egovDdlAssist.js";

const server = new McpServer({
  name: "egovframe-mcp-search",
  version: "1.0.0",
});

server.registerTool(
  "egov_search_knowledge",
  {
    title: "eGovFrame Knowledge Search",
    description:
      "Read-only SEARCH/RETRIEVAL gateway for existing eGovFrame reference material: official Developer Guide (의미 검색), 개인 지식 베이스, 행정안전부 표준용어 사전 (lookup/list/fulltext), 공통컴포넌트 메타와 그 PRE-BUILT CREATE TABLE/INSERT 문 (예: '게시판 컴포넌트 DDL 보여줘'), 호환 SW 카탈로그. For *designing or reviewing NEW DDL* from Korean domain knowledge (표준 영문 컬럼명 생성/검증), use egov_ddl_assist instead — this tool does NOT compose new schemas, it only retrieves what already exists in the knowledge base.",
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
          "Optional sub-action for scoped lookup. Components support: get/info, dependencies, sourceFiles, readSource, ddl (pre-built component CREATE TABLE), dml (initial INSERTs). Terms support: get.",
        ),
      filters: z
        .record(z.string(), z.any())
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

server.registerTool(
  "egov_ddl_assist",
  {
    title: "eGovFrame DDL Assist",
    description:
      "Schema-design oracle backed by 행정안전부 공통표준용어 사전 (terms/words/domains, data.go.kr 8차 2025-11). Use THIS — not egov_search_knowledge — whenever DESIGNING or REVIEWING a database schema from Korean domain knowledge: translating Korean column concepts to 표준 영문 약어 (예: '사용자명' → 'USER_NM VARCHAR(100)'), resolving domain names to SQL types (예: '명V100' → 'VARCHAR(100)'), validating an existing column name/type against the standard, or listing candidate columns for a Korean table concept (회원/주문/게시판). Returns column-level fragments and validation findings — does NOT emit full CREATE TABLE statements (caller composes those from fragments).",
    inputSchema: {
      action: z
        .enum([
          "lookup_term",
          "decompose_phrase",
          "resolve_domain",
          "propose_column",
          "validate_column",
          "suggest_table_columns",
        ])
        .describe(
          "lookup_term: 한글 용어 → 표준 영문약어 (정확/동의어 매칭). decompose_phrase: 한글 구문 → 표준 단어 토큰 + 영문 컬럼명 조합 후보. resolve_domain: 도메인명 → SQL 타입/길이 (예: 명V100 → VARCHAR(100)). propose_column: 엔드투엔드 한글→컬럼 DDL fragment (lookup 우선 → 분해 폴백). validate_column: 영문 컬럼명 + sqlType 이 표준에 부합하는지 검증 (findings 리스트 반환). suggest_table_columns: 한글 테이블 개념 → 관련 표준 용어 ranked 후보 (회원/주문/게시판 등).",
        ),
      input: z
        .string()
        .describe(
          "Action-specific input. lookup_term/decompose_phrase/propose_column 은 한글 용어/구문 (예: '사용자명', '신규사용자등록일자'). resolve_domain 은 도메인명 (예: '명V100', '금액N15'). validate_column 은 영문 컬럼명 (예: 'USER_NM'). suggest_table_columns 는 한글 테이블 개념 키워드 (예: '회원', '주문').",
        ),
      domainHint: z
        .string()
        .optional()
        .describe(
          "propose_column 전용. 분해 폴백 시 사용할 도메인명 (예: '명V100'). 정확한 길이 결정을 위해 형식단어와 어울리는 도메인을 명시.",
        ),
      sqlType: z
        .string()
        .optional()
        .describe(
          "validate_column 전용. 실제 사용된 SQL 타입 (예: 'VARCHAR(100)', 'NUMERIC(15,4)', 'CHAR(8)'). 생략 시 영문명만 검증.",
        ),
      limit: z
        .number()
        .optional()
        .describe(
          "suggest_table_columns 전용. 반환 후보 수 상한. 기본 30, 최대 100.",
        ),
    },
  },
  async (args) => {
    try {
      const result = await egovDdlAssist(args as any);
      return { content: [{ type: "text", text: result }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[egovframe-mcp-search] egov_ddl_assist failed:`, error);
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
