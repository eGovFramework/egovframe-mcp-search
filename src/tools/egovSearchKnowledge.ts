/**
 * Unified knowledge/reference search gateway.
 *
 * This tool keeps the external MCP surface small while reusing the existing
 * guide, knowledge base, compatibility, and common component
 * capabilities internally.
 */

import { getInitializedGuideManager } from "../rag/guideManager.js";
import { searchKnowledge } from "./knowledge.js";
import { searchCompatibleSoftware } from "./compatibility.js";
import {
  listComponentCategories,
  listCommonComponents,
  getComponentInfo,
  searchComponents,
  resolveDependencies,
  getComponentSummary,
  getComponentSourceFiles,
  readComponentSource,
  getComponentDDL,
  getComponentDML,
  formatCategoryList,
  formatComponentList,
  formatComponentInfo,
  formatDependencyResolution,
  formatComponentSummary,
  formatComponentSourceFiles,
  formatComponentDDL,
  formatComponentDML,
} from "./commonComponents.js";

type SearchScope = "auto" | "guide" | "knowledge" | "components" | "compatibility" | "all";

export interface EgovSearchKnowledgeArgs {
  query?: string;
  scope?: SearchScope;
  action?: string;
  filters?: Record<string, unknown>;
  limit?: number;
  strictScope?: boolean;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

function formatJson(title: string, value: unknown): string {
  return `## ${title}\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

function requireQuery(query: string | undefined, scope: string): string {
  if (!query) {
    throw new Error(`query is required for ${scope} search`);
  }
  return query;
}

function getFilters(args: EgovSearchKnowledgeArgs): Record<string, unknown> {
  return args.filters || {};
}

function getLimit(args: EgovSearchKnowledgeArgs, fallback: number): number {
  return args.limit || asNumber(getFilters(args).limit) || fallback;
}

async function searchGuide(args: EgovSearchKnowledgeArgs): Promise<string> {
  const filters = getFilters(args);
  const query = requireQuery(args.query, "guide");
  try {
    const guideManager = await getInitializedGuideManager();
    const results = await guideManager.searchGuide(query, {
      limit: getLimit(args, 5),
      layer: asString(filters.layer),
      category: asString(filters.category),
    });

    const formatted = results.map((result, idx) => {
      const baseUrl = "https://www.egovframe.go.kr/wiki/doku.php";
      const docUrl = result.url ? `${baseUrl}?id=egovframework:rte${result.url.replaceAll("/", ":")}` : "";
      return [
        `### ${idx + 1}. ${result.title}`,
        `- **문서**: ${result.docTitle}`,
        `- **분류**: ${result.layer} > ${result.category}`,
        `- **소스**: ${result.source}`,
        ...(docUrl ? [`- **URL**: ${docUrl}`] : []),
        `- **유사도**: ${(1 - result.score).toFixed(4)}`,
        "",
        result.content.length > 1500 ? `${result.content.substring(0, 1500)}\n\n... (truncated)` : result.content,
      ].join("\n");
    });

    return formatted.length > 0
      ? `## eGovFrame 가이드 검색 결과 (${results.length}건)\n\n${formatted.join("\n\n---\n\n")}`
      : "검색 결과가 없습니다. 다른 키워드로 검색해 보세요.";
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (/lance|LanceError|not found:/i.test(msg)) {
      return [
        "## eGovFrame 가이드 검색",
        "",
        "공식 가이드 벡터 인덱스(LanceDB)를 읽지 못했습니다. `knowledge-base/egovframe_guide.lance`가 없거나 손상·불완전한 경우에 이런 오류가 납니다.",
        "",
        "프로젝트 루트에서 `npm run build-index`로 인덱스를 다시 생성한 뒤 MCP를 재시작해 주세요.",
        "",
        `_기술 정보: ${msg}_`,
      ].join("\n");
    }
    throw error;
  }
}

async function searchPersonalKnowledge(args: EgovSearchKnowledgeArgs): Promise<string> {
  const filters = getFilters(args);
  const query = requireQuery(args.query, "knowledge");
  const result = await searchKnowledge({
    query,
    scope: asString(filters.knowledgeScope) === "all" ? "all" : "knowledge",
    sort: asString(filters.sort) === "recent" ? "recent" : "relevance",
    limit: getLimit(args, 5),
    type: asString(filters.type) as any,
    tags: asStringArray(filters.tags),
    minImportance: asNumber(filters.minImportance) as any,
    verifiedOnly: asBoolean(filters.verifiedOnly),
  });

  return formatJson("개인 지식 검색 결과", result);
}

function formatComponentDetail(componentId: string): string {
  const { component, dependencies, dependencyComponents } = getComponentInfo(componentId);
  return component
    ? formatComponentInfo(component, dependencies, dependencyComponents)
    : `컴포넌트를 찾을 수 없습니다: ${componentId}`;
}

function formatComponentDependencyLookup(filters: Record<string, unknown>): string {
  const componentIds = asStringArray(filters.componentIds);
  if (!componentIds || componentIds.length === 0) {
    throw new Error("filters.componentIds is required for component dependency resolution");
  }
  return formatDependencyResolution(resolveDependencies(componentIds));
}

function formatComponentSourceFileLookup(filters: Record<string, unknown>): string {
  const componentId = asString(filters.componentId);
  if (!componentId) {
    throw new Error("filters.componentId is required for component source file listing");
  }
  const result = getComponentSourceFiles(componentId);
  return result ? formatComponentSourceFiles(result) : `컴포넌트를 찾을 수 없습니다: ${componentId}`;
}

function formatComponentSourceRead(filters: Record<string, unknown>): string {
  const filePath = asString(filters.filePath);
  if (!filePath) {
    throw new Error("filters.filePath is required for component source reading");
  }
  const result = readComponentSource(filePath);
  if (!result) {
    return `파일을 찾을 수 없거나 접근할 수 없습니다: ${filePath}`;
  }
  return [
    `**파일**: \`${result.filePath}\` (${result.size.toLocaleString()} bytes, ${result.language})`,
    "",
    `\`\`\`${result.language}`,
    result.content,
    "```",
  ].join("\n");
}

function formatComponentScriptLookup(filters: Record<string, unknown>, action: "ddl" | "dml"): string {
  const componentId = asString(filters.componentId);
  if (!componentId) {
    throw new Error(`filters.componentId is required for component ${action} lookup`);
  }
  const dbType = asString(filters.dbType) || "mysql";
  if (action === "ddl") {
    const result = getComponentDDL(componentId, dbType);
    return result ? formatComponentDDL(result) : `컴포넌트 '${componentId}'를 찾을 수 없거나 지원하지 않는 DB 타입입니다.`;
  }

  const result = getComponentDML(componentId, dbType);
  return result ? formatComponentDML(result) : `컴포넌트 '${componentId}'를 찾을 수 없거나 지원하지 않는 DB 타입입니다.`;
}

function formatComponentListLookup(args: EgovSearchKnowledgeArgs, filters: Record<string, unknown>): string {
  if (args.query) {
    const { results } = searchComponents(args.query, getLimit(args, 20));
    return formatComponentList(results, false);
  }

  const hasFilters =
    Boolean(asString(filters.categoryId)) ||
    Boolean(asString(filters.keyword)) ||
    asBoolean(filters.hasWeb) !== undefined ||
    Boolean(asString(filters.version));

  if (hasFilters) {
    const { components } = listCommonComponents({
      categoryId: asString(filters.categoryId),
      keyword: asString(filters.keyword),
      hasWeb: asBoolean(filters.hasWeb),
      version: asString(filters.version),
    });
    return formatComponentList(components);
  }

  const { categories } = listComponentCategories();
  return `${formatCategoryList(categories)}\n---\n\n${formatComponentSummary(getComponentSummary())}`;
}

function searchComponentsGateway(args: EgovSearchKnowledgeArgs): string {
  const filters = getFilters(args);
  const action = args.action || "";
  const componentId = asString(filters.componentId) || asString(filters.component) || asString(filters.id);

  if (action === "get" || action === "info" || componentId) {
    if (!componentId) {
      throw new Error("filters.componentId is required for component detail lookup");
    }
    return formatComponentDetail(componentId);
  }

  const actionHandlers: Record<string, () => string> = {
    dependencies: () => formatComponentDependencyLookup(filters),
    sourceFiles: () => formatComponentSourceFileLookup(filters),
    readSource: () => formatComponentSourceRead(filters),
    ddl: () => formatComponentScriptLookup(filters, "ddl"),
    dml: () => formatComponentScriptLookup(filters, "dml"),
  };

  return actionHandlers[action]?.() || formatComponentListLookup(args, filters);
}

async function searchCompatibility(args: EgovSearchKnowledgeArgs): Promise<string> {
  const filters = getFilters(args);
  const result = await searchCompatibleSoftware({
    query: args.query,
    frameworkVersion: asString(filters.frameworkVersion),
    category: asString(filters.category),
    minLevel: asNumber(filters.minLevel) as any,
    vendor: asString(filters.vendor),
    productName: asString(filters.productName),
    limit: getLimit(args, 20),
    includeKnowledge: asBoolean(filters.includeKnowledge),
  });

  return formatJson("호환 소프트웨어 검색 결과", result);
}

async function searchAll(args: EgovSearchKnowledgeArgs): Promise<string> {
  requireQuery(args.query, "all");

  const sections = await Promise.all(
    [
      ["공식 문서", () => searchGuide(args)],
      ["개인 지식", () => searchPersonalKnowledge({ ...args, filters: { ...getFilters(args), knowledgeScope: "all" } })],
      ["공통컴포넌트", () => Promise.resolve(searchComponentsGateway(args))],
      ["호환 소프트웨어", () => searchCompatibility(args)],
    ].map(async ([title, run]) => {
      try {
        return await (run as () => Promise<string>)();
      } catch (error) {
        return `## ${title}\n\n검색 중 오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}`;
      }
    })
  );

  return `# 통합 지식 검색 결과\n\n${sections.join("\n\n---\n\n")}`;
}

function shouldExpandToAll(args: EgovSearchKnowledgeArgs, scope: SearchScope): boolean {
  const filters = getFilters(args);
  const hasSpecificSourceFilter = Boolean(
    asString(filters.componentId) ||
    asStringArray(filters.componentIds) ||
    asString(filters.filePath) ||
    asString(filters.frameworkVersion) ||
    asString(filters.vendor) ||
    asString(filters.productName)
  );

  return Boolean(
    args.query &&
    (!args.scope || args.scope === "auto") &&
    !args.strictScope &&
    !args.action &&
    !hasSpecificSourceFilter &&
    scope !== "all"
  );
}

function inferScope(args: EgovSearchKnowledgeArgs): SearchScope {
  const filters = getFilters(args);
  if (asString(filters.componentId) || asStringArray(filters.componentIds) || asString(filters.filePath)) {
    return "components";
  }
  if (asString(filters.frameworkVersion) || asString(filters.vendor) || asString(filters.productName)) {
    return "compatibility";
  }
  return args.query ? "all" : "components";
}

export async function egovSearchKnowledge(args: EgovSearchKnowledgeArgs): Promise<string> {
  const scope = args.scope && args.scope !== "auto" ? args.scope : inferScope(args);

  if (shouldExpandToAll(args, scope)) {
    return searchAll(args);
  }

  switch (scope) {
    case "guide":
      return searchGuide(args);
    case "knowledge":
      return searchPersonalKnowledge(args);
    case "components":
      return searchComponentsGateway(args);
    case "compatibility":
      return searchCompatibility(args);
    case "all":
      return searchAll(args);
    case "auto":
      return egovSearchKnowledge({ ...args, scope: inferScope(args) });
    default:
      throw new Error(`Unsupported egov_search_knowledge scope: ${scope}`);
  }
}
