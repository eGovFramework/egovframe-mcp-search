#!/usr/bin/env node

/**
 * eGovFrame MCP Search — stdio MCP 서버
 *
 * Exposes one tool:
 *  - egov_search_knowledge: a unified read-only knowledge/reference search
 *    gateway that internally fans out to guide, knowledge base,
 *    compatibility, and common component sources.
 *
 * Note: 과거 분리되어 있던 도구들 (search_guide, list_common_components, …) 은
 * 이 도구의 scope/action 으로 통합되었으며 더 이상 노출되지 않습니다.
 * 등록되지 않은 도구 이름을 호출하면 SDK 가 isError 결과
 * ("MCP error -32602: Tool <name> not found")로 응답합니다.
 */

import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import Database from "better-sqlite3";
import { toUserMessage } from "./utils/errors.js";
import {
  COMPONENT_ACTIONS,
  KNOWLEDGE_TYPES,
  SEARCH_SCOPES,
  runEgovSearchKnowledge,
} from "./tools/egovSearchKnowledge.js";
import { SUPPORTED_DB_TYPES } from "./tools/commonComponents.js";

// 서버 버전은 package.json 한 곳에서만 관리한다 (build/server.js 기준 한 단계 위).
const packageJson = createRequire(import.meta.url)("../package.json") as { version: string };

const server = new McpServer(
  {
    name: "egovframe-mcp-search",
    version: packageJson.version,
  },
  {
    instructions:
      "This server exposes one read-only tool, egov_search_knowledge. Choose the source with `scope` (guide, knowledge, components, compatibility, all; omit it to let the server infer). `action` is used only with the components scope. Every filter goes inside the `filters` object, never at the top level.",
  },
);

/** query 가 받는 최대 길이(문자 수). 의미 검색은 앞 8,000자, 키워드 검색은 앞 2,000자까지만 쓴다. */
const MAX_QUERY_LENGTH = 10_000;

/** 문자열 필터 하나가 받는 최대 길이(문자 수). */
const MAX_FILTER_LENGTH = 500;

/**
 * null 과 빈 문자열을 "지정하지 않음" 으로 받는다.
 * 쓰지 않는 선택 파라미터를 null 이나 "" 로 채워 보내는 클라이언트가 있어서다. 공개되는 JSON Schema 는 바뀌지 않는다.
 */
function absentIfEmpty<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (value === null || value === "" ? undefined : value), schema);
}

/** filters 안에서 값이 null 이거나 빈 문자열인 키는 지정하지 않은 것으로 보고 뺀다. filters 자체가 null 이어도 같다. */
function dropEmptyFilters(value: unknown): unknown {
  if (value === null) {
    return undefined;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== null && entry !== ""));
}

/** 길이 상한이 있는 문자열 필터 */
const filterString = () => z.string().max(MAX_FILTER_LENGTH);

/**
 * filters 는 키와 타입을 명시한 strict 객체로 받는다.
 * 철자가 틀린 키나 타입이 맞지 않는 값이 조용히 무시되어 필터 없는 결과가 나가는 일을 막고,
 * tools/list 만 보는 클라이언트가 어떤 키를 쓸 수 있는지 알 수 있게 한다.
 */
const filtersSchema = z.strictObject({
  // ── guide ──
  layer: filterString()
    .optional()
    .describe(
      "guide: top-level area of the Developer Guide, e.g. egovframe-runtime, egovframe-development, common-component (case-insensitive). An unknown value is rejected with the list of valid values.",
    ),
  category: filterString()
    .optional()
    .describe(
      "guide: sub-area under a layer, e.g. persistence-layer, security. compatibility: software category name, e.g. 'CMS Solution', 'WAS', 'DBMS'. Case-insensitive. With scope auto or all, the value decides which source the filter belongs to.",
    ),

  // ── knowledge ──
  type: z
    .enum(KNOWLEDGE_TYPES)
    .optional()
    .describe(
      "knowledge: entry type. The bundled data holds only solution (portal Q&A and FAQ) and best-practice (application guide PDF).",
    ),
  tags: z
    .array(z.string().max(100))
    .max(20)
    .optional()
    .describe("knowledge: keep entries that carry any of these tags (at most 20). Bundled tags: qa, faq, guide, pdf."),
  minImportance: z
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .describe("knowledge: minimum importance (1-5). Bundled data: Q&A 3, FAQ 4, application guide 5."),
  verifiedOnly: z.boolean().optional().describe("knowledge: only verified entries (every bundled entry is verified)."),
  sort: z
    .enum(["relevance", "recent"])
    .optional()
    .describe(
      "knowledge: relevance (default, semantic search) or recent (most recently indexed entries without content; query is not needed and not used).",
    ),
  knowledgeScope: z
    .enum(["knowledge", "all"])
    .optional()
    .describe(
      "knowledge: all additionally returns compatible software whose text matches every query word; knowledge entries then carry a 200-character preview instead of the full content. The knowledge filters (type, tags, minImportance, verifiedOnly) still apply.",
    ),

  // ── components ──
  componentId: filterString()
    .optional()
    .describe(
      "components: component ID (e.g. uia), package name (e.g. egovframework.com.uat.uia) or exact component name; case-insensitive. Target of get/info, sourceFiles, ddl, dml; also accepted by dependencies (ID or package name). When nothing matches, the response lists similar components with their IDs.",
    ),
  component: filterString().optional().describe("components: alias of componentId."),
  id: filterString().optional().describe("components: alias of componentId."),
  componentIds: z
    .array(filterString())
    .max(50)
    .optional()
    .describe("components: component IDs or package names for action dependencies (at most 50)."),
  filePath: filterString()
    .optional()
    .describe(
      "components: path of one source file for action readSource, relative to the component source root, as printed by action sourceFiles. Absolute paths and paths outside the source root are not readable.",
    ),
  dbType: filterString()
    .optional()
    .describe(
      `components: database for ddl/dml. One of ${SUPPORTED_DB_TYPES.join(", ")} (default mysql; aliases mariadb, postgresql, pgsql). Any other value is rejected.`,
    ),
  table: filterString()
    .optional()
    .describe(
      "components: with action dml, return only the INSERT statements of this table (one of the tables listed by the default dml view), paged by limit (max 100) and filters.offset.",
    ),
  categoryId: filterString()
    .optional()
    .describe(
      "components: keep only the components of one category. Accepts the category ID, Korean name or English name shown by the category overview (a components call without query and filters). Applies to the list and to the keyword search.",
    ),
  keyword: filterString()
    .optional()
    .describe(
      "components: substring filter on component name, description and package name. Applies to the list and to the keyword search.",
    ),
  hasWeb: z
    .boolean()
    .optional()
    .describe("components: filter the list or keyword search by whether the component ships web pages."),
  version: filterString()
    .optional()
    .describe("components: filter the list or keyword search by component metadata version."),

  // ── compatibility ──
  frameworkVersion: filterString()
    .optional()
    .describe(
      'compatibility: eGovFrame version as a string in major.minor form, e.g. "4.3" or "3.10" ("v4.3" and "4.3.0" are normalized; a JSON number is rejected because 3.10 would become 3.1). When no row matches, the response lists the available versions.',
    ),
  vendor: filterString().optional().describe("compatibility: substring of the vendor name."),
  productName: filterString()
    .optional()
    .describe('compatibility: substring of the product name or of the product version label, e.g. "JEUS" or "JEUS 8.5".'),
  minLevel: z
    .number()
    .int()
    .min(1)
    .max(2)
    .optional()
    .describe("compatibility: minimum compatibility level (1 or 2)."),
  includeKnowledge: z
    .boolean()
    .optional()
    .describe(
      "compatibility: also attach developer-knowledge entries that mention the returned products (needs the local embedding model).",
    ),

  // ── paging ──
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe("Same as the top-level limit; the top-level value wins when both are given."),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      "Where to continue a paged result. compatibility: number of rows to skip. components action dml with filters.table: number of INSERT statements to skip. components action readSource: character position to continue from (the nextOffset printed by the previous response). Not supported elsewhere.",
    ),
});

server.registerTool(
  "egov_search_knowledge",
  {
    title: "eGovFrame Knowledge Search",
    description:
      "Read-only SEARCH/RETRIEVAL gateway for existing eGovFrame reference material: the official Developer Guide (의미 검색), developer knowledge from the eGovFrame portal (묻고답하기 Q&A · FAQ · 적용가이드 PDF, 의미 검색), 공통컴포넌트 메타·소스 파일과 그 PRE-BUILT CREATE TABLE/INSERT 문 (예: '게시판 컴포넌트 DDL 보여줘'), 호환 SW 카탈로그. This tool does NOT compose new schemas and does not store anything — it only retrieves what already exists in the bundled knowledge base.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      query: absentIfEmpty(z.string().max(MAX_QUERY_LENGTH).optional())
        .describe(
          'Search question or keywords. Required for the guide, knowledge and all scopes (except knowledge with filters.sort "recent"), where it runs a semantic search. Optional for components and compatibility, where it runs a keyword search: every word must match as a word prefix, and when nothing matches, rows that contain at least half of the words as substrings are returned and marked (matchMode any-term). Prefer a few keywords over a sentence there. A blank string counts as not given.',
        ),
      scope: absentIfEmpty(z.enum(SEARCH_SCOPES).optional())
        .describe(
          "Search source. guide: official Developer Guide (the index holds little of the per-component common-component manuals, so look components up with scope components). knowledge: portal Q&A / FAQ / application guide. components: common components. compatibility: compatible software catalog. all: every source at once. auto (default) infers the source: an action or a component filter (componentId, componentIds, filePath, dbType, table, categoryId, hasWeb) → components; a compatibility filter (frameworkVersion, vendor, productName, minLevel, includeKnowledge, or a category that names a software category) → compatibility; layer, or a category that names a guide category → guide; a knowledge filter (type, tags, minImportance, verifiedOnly, sort) → knowledge; otherwise a query searches all sources and a call without query returns the component category overview. Filter values equal to the default (includeKnowledge false, verifiedOnly false, sort relevance, minImportance 1) do not select a source. An explicit scope is always used as given. With all, each filter is applied only to the source it belongs to and the knowledge section carries excerpts.",
        ),
      action: absentIfEmpty(z.enum(COMPONENT_ACTIONS).optional())
        .describe(
          "Optional sub-action, supported only for the components scope. get/info: component detail (filters.componentId). dependencies: transitive dependencies (filters.componentIds array, or a single filters.componentId). sourceFiles: source file list (filters.componentId). readSource: one source file (filters.filePath), up to 60,000 characters per call; continue with filters.offset. ddl: pre-built CREATE TABLE / INDEX / VIEW statements (filters.componentId, optional filters.dbType). dml: initial INSERT statements (filters.componentId, optional filters.dbType), by default the first 20 per table; add filters.table to page through one table with limit and filters.offset. Without an action, filters.componentId returns the component detail and otherwise the component list/search runs.",
        ),
      filters: z
        .preprocess(dropEmptyFilters, filtersSchema.optional())
        .describe(
          "Scope-specific filters. Each key states the scope it applies to. Unknown keys and values of the wrong type are rejected; a value of null or an empty string counts as not given. A known key that the chosen scope or action does not use is ignored, and the response names the ignored keys. Filters must be nested here: a filter key placed at the top level of the arguments is dropped.",
        ),
      limit: absentIfEmpty(z.number().int().min(1).max(200).optional())
        .describe(
          "Maximum number of results (integer). Defaults: guide 5, knowledge 5, components keyword search 20 (a filter-only component list returns every match), compatibility 20; with scope all, 5 per source. Per-scope maximum: guide 20, knowledge 20, components 200, compatibility 100; a larger value is reduced to the maximum and the response says so. With action dml and filters.table it is the number of INSERT statements per call (default and maximum 100).",
        ),
      strictScope: absentIfEmpty(z.boolean().optional())
        .describe(
          "Deprecated: has no effect and is accepted only for backward compatibility. An explicit scope is always searched as given, and scope auto follows the inference rules described for `scope`.",
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
