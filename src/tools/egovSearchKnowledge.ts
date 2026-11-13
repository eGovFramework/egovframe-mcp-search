/**
 * Unified knowledge/reference search gateway.
 *
 * This tool keeps the external MCP surface small while reusing the existing
 * guide, knowledge base, compatibility, and common component
 * capabilities internally.
 */

import { getInitializedGuideManager } from "../rag/guideManager.js";
import { getHybridManager } from "../database/hybridManager.js";
import { GUIDE_SITE_BASE_URL } from "../kb/sources.js";
import { UserFacingError, toUserMessage } from "../utils/errors.js";
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

/** 도구가 받는 scope 값. server.ts 의 inputSchema enum 이 이 배열을 쓴다. */
export const SEARCH_SCOPES = ["auto", "guide", "knowledge", "components", "compatibility", "all"] as const;

export type SearchScope = (typeof SEARCH_SCOPES)[number];

/** auto 를 실제 출처로 해석한 뒤의 scope */
type ResolvedScope = Exclude<SearchScope, "auto">;

/** 개발자 지식의 type 필터가 받는 값 (src/types/knowledge.ts 의 KnowledgeType 과 같다). */
export const KNOWLEDGE_TYPES = ["solution", "tip", "pattern", "error-fix", "best-practice", "gotcha"] as const;

/**
 * components scope 가 지원하는 action 목록.
 * server.ts 의 inputSchema enum 과 게이트웨이의 런타임 검증이 이 배열 하나를 함께 쓴다.
 */
export const COMPONENT_ACTIONS = [
  "get",
  "info",
  "dependencies",
  "sourceFiles",
  "readSource",
  "ddl",
  "dml",
] as const;

export type ComponentAction = (typeof COMPONENT_ACTIONS)[number];

function isComponentAction(value: string): value is ComponentAction {
  return (COMPONENT_ACTIONS as readonly string[]).includes(value);
}

export interface EgovSearchKnowledgeArgs {
  query?: string;
  scope?: SearchScope;
  action?: string;
  filters?: Record<string, unknown>;
  limit?: number;
  /** 효과가 없는 파라미터. 기존 호출자가 보내도 실패하지 않도록 스키마에만 남겨 둔다. */
  strictScope?: boolean;
}

/**
 * 범위별 limit 기본값과 최댓값.
 * inputSchema 는 1~200 의 정수만 받고, 범위별 최댓값을 넘는 값은 줄여서 적용한 뒤 응답에 알린다.
 */
const LIMIT_RULES = {
  guide: { fallback: 5, max: 20 },
  knowledge: { fallback: 5, max: 20 },
  components: { fallback: 20, max: 200 },
  compatibility: { fallback: 20, max: 100 },
} as const;

type LimitScope = keyof typeof LIMIT_RULES;

/** 통합 검색(scope all)에서 limit 을 주지 않았을 때 출처별로 돌려주는 건수. */
const ALL_SCOPE_SECTION_LIMIT = 5;

/** 출처 하나를 검색할 때의 부가 조건. 통합 검색이 출처별 기본 건수를 줄이는 데 쓴다. */
interface SectionOptions {
  defaultLimit?: number;
}

/**
 * scope 를 지정하지 않았을 때 출처를 가리키는 필터 키.
 * 여러 출처가 함께 쓰거나 뜻이 넓은 키(category, keyword, version, limit, offset)는 넣지 않는다.
 */
const COMPONENT_FILTER_KEYS = [
  "componentId",
  "component",
  "id",
  "componentIds",
  "filePath",
  "dbType",
  "categoryId",
  "hasWeb",
] as const;
const COMPATIBILITY_FILTER_KEYS = ["frameworkVersion", "vendor", "productName", "minLevel", "includeKnowledge"] as const;
const GUIDE_FILTER_KEYS = ["layer"] as const;
const KNOWLEDGE_FILTER_KEYS = ["type", "tags", "minImportance", "verifiedOnly", "sort"] as const;

/** 문자열 필터와 query 는 NFC 로 정규화하고 앞뒤 공백을 뗀다. 빈 값은 지정하지 않은 것으로 본다. */
function asString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.normalize("NFC").trim();
  return normalized || undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asPositiveInt(value: unknown): number | undefined {
  const num = asNumber(value);
  return num !== undefined && num >= 1 ? Math.floor(num) : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    return undefined;
  }
  return value.map((item) => asString(item)).filter((item): item is string => item !== undefined);
}

/** 필터에 의미 있는 값이 들어 있는지. 빈 문자열과 빈 배열은 지정하지 않은 것으로 본다. */
function hasFilterValue(filters: Record<string, unknown>, key: string): boolean {
  const value = filters[key];
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim() !== "";
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return true;
}

function hasAnyFilter(filters: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.some((key) => hasFilterValue(filters, key));
}

function pickFilters(filters: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((key) => hasFilterValue(filters, key)).map((key) => [key, filters[key]]));
}

function formatJson(title: string, value: unknown): string {
  return `## ${title}\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

function requireQuery(query: string | undefined, scope: string): string {
  if (!query) {
    throw new UserFacingError(`query is required for ${scope} search`);
  }
  return query;
}

function getFilters(args: EgovSearchKnowledgeArgs): Record<string, unknown> {
  return args.filters || {};
}

interface ResolvedLimit {
  value: number;
  /** 요청한 limit 을 줄여 적용했을 때 응답에 덧붙이는 안내 */
  note?: string;
}

/** 최상위 limit 이 filters.limit 보다 우선한다. 둘 다 없으면 범위 기본값을 쓴다. */
function resolveLimit(args: EgovSearchKnowledgeArgs, scope: LimitScope, options: SectionOptions = {}): ResolvedLimit {
  const rule = LIMIT_RULES[scope];
  const requested = asPositiveInt(args.limit) ?? asPositiveInt(getFilters(args).limit);
  if (requested === undefined) {
    return { value: options.defaultLimit ?? rule.fallback };
  }
  if (requested > rule.max) {
    return {
      value: rule.max,
      note: `> 요청한 limit ${requested} 은(는) ${scope} 범위의 최댓값 ${rule.max} 으로 줄여 적용했습니다.`,
    };
  }
  return { value: requested };
}

function withNote(text: string, note: string | undefined): string {
  return note ? `${text}\n\n${note}` : text;
}

let compatibilityCategories: Set<string> | undefined;

/**
 * 값이 호환 소프트웨어의 분류 이름인지 확인한다 (대소문자 무시).
 * `category` 는 가이드와 호환성이 함께 쓰는 키라서, 값으로 어느 출처의 필터인지 가린다.
 * DB 를 읽지 못하면 false 를 돌려주고, 실제 오류는 해당 출처를 검색할 때 드러난다.
 */
function isCompatibilityCategory(value: string): boolean {
  if (!compatibilityCategories) {
    try {
      compatibilityCategories = new Set(
        getHybridManager()
          .getSQLite()
          .getCategories()
          .map((category) => category.toLowerCase()),
      );
    } catch {
      return false;
    }
  }
  return compatibilityCategories.has(value.toLowerCase());
}

/** filters.category 가 호환 소프트웨어 분류를 가리키는지. */
function hasCompatibilityCategory(filters: Record<string, unknown>): boolean {
  const category = asString(filters.category);
  return category !== undefined && isCompatibilityCategory(category);
}

async function searchGuide(args: EgovSearchKnowledgeArgs, options: SectionOptions = {}): Promise<string> {
  const filters = getFilters(args);
  const query = requireQuery(args.query, "guide");
  const limit = resolveLimit(args, "guide", options);
  const layer = asString(filters.layer);
  const category = asString(filters.category);
  const guideManager = await getInitializedGuideManager();
  const results = await guideManager.searchGuide(query, { limit: limit.value, layer, category });

  const formatted = results.map((result, idx) => {
    // url 은 가이드 사이트(Hugo)의 permalink 다. 값이 없는 문서는 링크를 만들지 않는다.
    const docUrl = result.url ? `${GUIDE_SITE_BASE_URL}${result.url.startsWith("/") ? "" : "/"}${result.url}` : "";
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

  const heading = `## eGovFrame 가이드 검색 결과 (${results.length}건)`;
  if (formatted.length === 0) {
    const applied = [layer ? `layer=${layer}` : "", category ? `category=${category}` : ""].filter(Boolean);
    const hint = applied.length > 0 ? ` 적용한 필터: ${applied.join(", ")}.` : "";
    return withNote(`${heading}\n\n검색 결과가 없습니다. 다른 키워드로 검색해 보세요.${hint}`, limit.note);
  }
  return withNote(`${heading}\n\n${formatted.join("\n\n---\n\n")}`, limit.note);
}

async function searchDeveloperKnowledge(args: EgovSearchKnowledgeArgs, options: SectionOptions = {}): Promise<string> {
  const filters = getFilters(args);
  const sortRecent = asString(filters.sort) === "recent";
  // 최근 순 조회는 query 를 쓰지 않으므로 요구하지 않는다.
  const query = sortRecent ? (args.query ?? "") : requireQuery(args.query, "knowledge");
  const limit = resolveLimit(args, "knowledge", options);
  const result = await searchKnowledge({
    query,
    scope: asString(filters.knowledgeScope) === "all" ? "all" : "knowledge",
    sort: sortRecent ? "recent" : "relevance",
    limit: limit.value,
    type: asString(filters.type) as any,
    tags: asStringArray(filters.tags),
    minImportance: asNumber(filters.minImportance) as any,
    verifiedOnly: asBoolean(filters.verifiedOnly),
  });

  return withNote(formatJson("개발자 지식 검색 결과", result), limit.note);
}

/** filters.componentId 와 그 별칭(component, id) 가운데 먼저 지정된 값. */
function getComponentId(filters: Record<string, unknown>): string | undefined {
  return asString(filters.componentId) || asString(filters.component) || asString(filters.id);
}

function requireComponentId(filters: Record<string, unknown>, purpose: string): string {
  const componentId = getComponentId(filters);
  if (!componentId) {
    throw new UserFacingError(`filters.componentId is required for ${purpose}`);
  }
  return componentId;
}

function formatComponentDetail(componentId: string): string {
  const { component, dependencies, dependencyComponents } = getComponentInfo(componentId);
  return component
    ? formatComponentInfo(component, dependencies, dependencyComponents)
    : `컴포넌트를 찾을 수 없습니다: ${componentId}`;
}

function formatComponentDependencyLookup(filters: Record<string, unknown>): string {
  // 배열(componentIds)이 기본 형태이고, 컴포넌트 하나만 볼 때는 단수형(componentId 와 별칭)도 받는다.
  const single = getComponentId(filters);
  const componentIds = [
    ...new Set([...(asStringArray(filters.componentIds) ?? []), ...(single ? [single] : [])]),
  ];
  if (componentIds.length === 0) {
    throw new UserFacingError(
      "filters.componentIds (or filters.componentId) is required for component dependency resolution",
    );
  }
  return formatDependencyResolution(resolveDependencies(componentIds));
}

function formatComponentSourceFileLookup(filters: Record<string, unknown>): string {
  const componentId = requireComponentId(filters, "component source file listing");
  const result = getComponentSourceFiles(componentId);
  return result ? formatComponentSourceFiles(result) : `컴포넌트를 찾을 수 없습니다: ${componentId}`;
}

function formatComponentSourceRead(filters: Record<string, unknown>): string {
  const filePath = asString(filters.filePath);
  if (!filePath) {
    throw new UserFacingError("filters.filePath is required for component source reading");
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
  const componentId = requireComponentId(filters, `component ${action} lookup`);
  const dbType = asString(filters.dbType) || "mysql";
  if (action === "ddl") {
    const result = getComponentDDL(componentId, dbType);
    return result ? formatComponentDDL(result) : `컴포넌트 '${componentId}'를 찾을 수 없거나 지원하지 않는 DB 타입입니다.`;
  }

  const result = getComponentDML(componentId, dbType);
  return result ? formatComponentDML(result) : `컴포넌트 '${componentId}'를 찾을 수 없거나 지원하지 않는 DB 타입입니다.`;
}

function formatComponentListLookup(
  args: EgovSearchKnowledgeArgs,
  filters: Record<string, unknown>,
  options: SectionOptions = {},
): string {
  if (args.query) {
    const limit = resolveLimit(args, "components", options);
    const { results } = searchComponents(args.query, limit.value);
    return withNote(formatComponentList(results, false), limit.note);
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

function searchComponentsGateway(args: EgovSearchKnowledgeArgs, options: SectionOptions = {}): string {
  const filters = getFilters(args);
  const action = args.action;

  // action 이 없을 때만 필터로 동작을 정한다: componentId 가 있으면 상세, 없으면 목록/검색.
  // action 이 있으면 componentId 는 그 action 의 대상일 뿐이므로 상세 조회로 가로채지 않는다.
  if (!action) {
    const componentId = getComponentId(filters);
    return componentId ? formatComponentDetail(componentId) : formatComponentListLookup(args, filters, options);
  }

  if (!isComponentAction(action)) {
    throw new UserFacingError(
      `Unsupported action for components scope: ${action}. Supported actions: ${COMPONENT_ACTIONS.join(", ")}`,
    );
  }

  switch (action) {
    case "get":
    case "info":
      return formatComponentDetail(requireComponentId(filters, "component detail lookup"));
    case "dependencies":
      return formatComponentDependencyLookup(filters);
    case "sourceFiles":
      return formatComponentSourceFileLookup(filters);
    case "readSource":
      return formatComponentSourceRead(filters);
    case "ddl":
    case "dml":
      return formatComponentScriptLookup(filters, action);
  }
}

async function searchCompatibility(args: EgovSearchKnowledgeArgs, options: SectionOptions = {}): Promise<string> {
  const filters = getFilters(args);
  const limit = resolveLimit(args, "compatibility", options);
  const result = await searchCompatibleSoftware({
    query: args.query,
    frameworkVersion: asString(filters.frameworkVersion),
    category: asString(filters.category),
    minLevel: asNumber(filters.minLevel) as any,
    vendor: asString(filters.vendor),
    productName: asString(filters.productName),
    limit: limit.value,
    includeKnowledge: asBoolean(filters.includeKnowledge),
  });

  return withNote(formatJson("호환 소프트웨어 검색 결과", result), limit.note);
}

async function searchAll(args: EgovSearchKnowledgeArgs): Promise<string> {
  requireQuery(args.query, "all");

  // 필터는 그 필터를 쓰는 출처에만 넘긴다. 함께 쓰는 키인 category 는 값으로 출처를 가린다.
  const filters = getFilters(args);
  const categoryIsCompatibility = hasCompatibilityCategory(filters);
  const limitFilter = pickFilters(filters, ["limit"]);
  const forSource = (keys: readonly string[]): EgovSearchKnowledgeArgs => ({
    ...args,
    filters: { ...pickFilters(filters, keys), ...limitFilter },
  });
  const options: SectionOptions = { defaultLimit: ALL_SCOPE_SECTION_LIMIT };

  const sections = await Promise.all(
    (
      [
        [
          "공식 가이드",
          () => searchGuide(forSource([...GUIDE_FILTER_KEYS, ...(categoryIsCompatibility ? [] : ["category"])]), options),
        ],
        [
          "개발자 지식",
          () => searchDeveloperKnowledge(forSource(["type", "tags", "minImportance", "verifiedOnly"]), options),
        ],
        [
          "공통컴포넌트",
          async () => searchComponentsGateway(forSource([...COMPONENT_FILTER_KEYS, "keyword", "version"]), options),
        ],
        [
          "호환 소프트웨어",
          () =>
            searchCompatibility(
              forSource([...COMPATIBILITY_FILTER_KEYS, ...(categoryIsCompatibility ? ["category"] : [])]),
              options,
            ),
        ],
      ] as Array<[string, () => Promise<string>]>
    ).map(async ([title, run]) => {
      try {
        return await run();
      } catch (error) {
        logToolError(error);
        return `## ${title}\n\n검색 중 오류가 발생했습니다: ${toUserMessage(error)}`;
      }
    }),
  );

  return `# 통합 지식 검색 결과\n\n${sections.join("\n\n---\n\n")}`;
}

/**
 * scope 를 지정하지 않았을 때(auto) 검색할 출처를 정한다.
 *
 * 1. action 이 있으면 components (action 은 components 에서만 지원한다)
 * 2. 출처를 가리키는 필터가 있으면 그 출처 (components → compatibility → guide → knowledge 순으로 확인)
 * 3. 그 밖에는 query 가 있으면 통합 검색, 없으면 공통컴포넌트 카테고리 개요
 */
function inferScope(args: EgovSearchKnowledgeArgs): ResolvedScope {
  const filters = getFilters(args);
  if (args.action) {
    return "components";
  }
  if (hasAnyFilter(filters, COMPONENT_FILTER_KEYS)) {
    return "components";
  }
  if (hasAnyFilter(filters, COMPATIBILITY_FILTER_KEYS) || hasCompatibilityCategory(filters)) {
    return "compatibility";
  }
  if (hasAnyFilter(filters, GUIDE_FILTER_KEYS)) {
    return "guide";
  }
  if (hasAnyFilter(filters, KNOWLEDGE_FILTER_KEYS)) {
    return "knowledge";
  }
  return args.query ? "all" : "components";
}

export async function egovSearchKnowledge(rawArgs: EgovSearchKnowledgeArgs): Promise<string> {
  // 공백뿐인 query 와 빈 action 은 지정하지 않은 것으로 본다.
  const args: EgovSearchKnowledgeArgs = {
    ...rawArgs,
    query: asString(rawArgs.query),
    action: rawArgs.action || undefined,
  };
  const scope: ResolvedScope = args.scope && args.scope !== "auto" ? args.scope : inferScope(args);

  if (args.action && scope !== "components") {
    throw new UserFacingError(
      `action "${args.action}" is supported only for the components scope. ` +
        `Use scope "components" (or omit scope); received scope "${scope}".`,
    );
  }

  switch (scope) {
    case "guide":
      return searchGuide(args);
    case "knowledge":
      return searchDeveloperKnowledge(args);
    case "components":
      return searchComponentsGateway(args);
    case "compatibility":
      return searchCompatibility(args);
    case "all":
      return searchAll(args);
    default:
      throw new UserFacingError(`Unsupported egov_search_knowledge scope: ${String(scope)}`);
  }
}

/** 호출자 입력이 원인인 오류는 한 줄만, 그 밖의 오류는 원인 추적을 위해 전체를 stderr 에 남긴다. */
function logToolError(error: unknown): void {
  if (error instanceof UserFacingError) {
    console.error(`[egovframe-mcp-search] egov_search_knowledge rejected: ${error.message}`);
    return;
  }
  console.error("[egovframe-mcp-search] egov_search_knowledge failed:", error);
}

/** MCP 도구 응답의 본문과 오류 여부. */
export interface EgovSearchKnowledgeResult {
  text: string;
  isError: boolean;
}

/**
 * MCP 핸들러 본체. egovSearchKnowledge 를 실행하고, 오류는 도구 응답에 실어도 되는 문구로 바꾼다.
 * 스택 트레이스·절대 경로·내부 SQL 은 응답에 넣지 않고 stderr 에만 남긴다.
 */
export async function runEgovSearchKnowledge(args: EgovSearchKnowledgeArgs): Promise<EgovSearchKnowledgeResult> {
  try {
    return { text: await egovSearchKnowledge(args), isError: false };
  } catch (error) {
    logToolError(error);
    return { text: toUserMessage(error), isError: true };
  }
}
