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
import { extractSearchTerms } from "../utils/fts5Query.js";
import { KNOWLEDGE_TYPES, type KnowledgeType } from "../types/knowledge.js";
import type { CommonComponent } from "../types/database.js";
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

/** 개발자 지식의 type 필터가 받는 값. server.ts 의 inputSchema enum 이 이 배열을 쓴다. */
export { KNOWLEDGE_TYPES };

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

/** 통합 검색(scope all)의 개발자 지식 섹션에 싣는 본문 발췌의 최대 길이(문자 수). */
const ALL_SCOPE_KNOWLEDGE_EXCERPT_LENGTH = 600;

/** 출처 하나를 검색할 때의 부가 조건. 통합 검색이 출처별 응답 크기를 줄이는 데 쓴다. */
interface SectionOptions {
  defaultLimit?: number;
  /** 개발자 지식의 본문을 이 길이 이내의 발췌로 줄인다. */
  knowledgeExcerptLength?: number;
}

/** componentId 와 그 별칭. 값이 먼저 지정된 키가 쓰인다. */
const COMPONENT_ID_KEYS = ["componentId", "component", "id"] as const;

/** 공통컴포넌트 목록·키워드 검색에 적용되는 필터 키. */
const COMPONENT_LIST_FILTER_KEYS = ["categoryId", "keyword", "hasWeb", "version", "limit"] as const;

/** 가이드 검색에 적용되는 필터 키. */
const GUIDE_USED_FILTER_KEYS = ["layer", "category", "limit"] as const;

/** 개발자 지식 검색에 적용되는 필터 키. */
const KNOWLEDGE_USED_FILTER_KEYS = [
  "type",
  "tags",
  "minImportance",
  "verifiedOnly",
  "sort",
  "knowledgeScope",
  "limit",
] as const;

/** 호환 소프트웨어 조회에 적용되는 필터 키. */
const COMPATIBILITY_USED_FILTER_KEYS = [
  "frameworkVersion",
  "category",
  "minLevel",
  "vendor",
  "productName",
  "includeKnowledge",
  "limit",
  "offset",
] as const;

/**
 * scope 를 지정하지 않았을 때 출처를 가리키는 필터 키.
 * 여러 출처가 함께 쓰거나 뜻이 넓은 키(category, keyword, version, limit, offset)는 넣지 않는다.
 */
const COMPONENT_FILTER_KEYS = [
  ...COMPONENT_ID_KEYS,
  "componentIds",
  "filePath",
  "dbType",
  "table",
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

/** 숫자를 세 자리마다 쉼표로 끊어 적는다 (실행 환경의 로캘에 좌우되지 않게 고정한다). */
function formatCount(value: number): string {
  return value.toLocaleString("en-US");
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

/** 호출자가 limit 을 직접 지정했는지 (최상위 limit 또는 filters.limit). */
function requestedLimit(args: EgovSearchKnowledgeArgs): number | undefined {
  return asPositiveInt(args.limit) ?? asPositiveInt(getFilters(args).limit);
}

/** 최상위 limit 이 filters.limit 보다 우선한다. 둘 다 없으면 범위 기본값을 쓴다. */
function resolveLimit(args: EgovSearchKnowledgeArgs, scope: LimitScope, options: SectionOptions = {}): ResolvedLimit {
  const rule = LIMIT_RULES[scope];
  const requested = requestedLimit(args);
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

/** 본문 뒤에 안내 줄을 덧붙인다. 값이 없는 안내는 건너뛴다. */
function withNotes(text: string, ...notes: Array<string | undefined>): string {
  const present = notes.filter((note): note is string => Boolean(note));
  return present.length > 0 ? `${text.trimEnd()}\n\n${present.join("\n\n")}` : text;
}

/**
 * 호출자가 줬지만 이번 조회에는 적용되지 않은 필터를 알리는 안내.
 * 필터가 조용히 무시되면 호출자는 걸러진 결과라고 오해하므로, 무시한 키를 응답에 적는다.
 */
function ignoredFiltersNote(filters: Record<string, unknown>, usedKeys: readonly string[]): string | undefined {
  const ignored = Object.keys(filters).filter((key) => hasFilterValue(filters, key) && !usedKeys.includes(key));
  return ignored.length > 0 ? `> 이 조회에 적용되지 않아 무시한 필터: ${ignored.join(", ")}.` : undefined;
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

/**
 * 값이 가이드 문서의 category 인지 확인한다 (대소문자 무시).
 * 가이드 인덱스를 읽지 못하면 false 를 돌려주고, 실제 오류는 가이드를 검색할 때 드러난다.
 */
async function isGuideCategory(value: string): Promise<boolean> {
  try {
    const facets = await (await getInitializedGuideManager()).getFacets();
    const wanted = value.toLowerCase();
    return facets.categories.some((category) => category.value.toLowerCase() === wanted);
  } catch {
    return false;
  }
}

/** filters.category 가 어느 출처의 분류 값인지. */
interface CategoryOwner {
  guide: boolean;
  compatibility: boolean;
}

async function findCategoryOwner(filters: Record<string, unknown>): Promise<CategoryOwner> {
  const category = asString(filters.category);
  if (category === undefined) {
    return { guide: false, compatibility: false };
  }
  return { guide: await isGuideCategory(category), compatibility: isCompatibilityCategory(category) };
}

async function searchGuide(args: EgovSearchKnowledgeArgs, options: SectionOptions = {}): Promise<string> {
  const filters = getFilters(args);
  const query = requireQuery(args.query, "guide");
  const limit = resolveLimit(args, "guide", options);
  const layer = asString(filters.layer);
  const category = asString(filters.category);
  const guideManager = await getInitializedGuideManager();
  const results = await guideManager.searchGuide(query, { limit: limit.value, layer, category });
  const ignored = ignoredFiltersNote(filters, GUIDE_USED_FILTER_KEYS);

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
    return withNotes(`${heading}\n\n검색 결과가 없습니다. 다른 키워드로 검색해 보세요.${hint}`, limit.note, ignored);
  }
  return withNotes(`${heading}\n\n${formatted.join("\n\n---\n\n")}`, limit.note, ignored);
}

async function searchDeveloperKnowledge(args: EgovSearchKnowledgeArgs, options: SectionOptions = {}): Promise<string> {
  const filters = getFilters(args);
  const sortRecent = asString(filters.sort) === "recent";
  // 최근 순 조회는 query 를 쓰지 않으므로 요구하지 않는다.
  const query = sortRecent ? undefined : requireQuery(args.query, "knowledge");
  const limit = resolveLimit(args, "knowledge", options);
  const excerptLength = options.knowledgeExcerptLength;
  const result = await searchKnowledge({
    query,
    scope: asString(filters.knowledgeScope) === "all" ? "all" : "knowledge",
    sort: sortRecent ? "recent" : "relevance",
    limit: limit.value,
    // type 값이 유효한지는 지식 매니저가 검증한다 (허용되지 않은 값이면 쓸 수 있는 값을 알려 준다).
    type: asString(filters.type) as KnowledgeType | undefined,
    tags: asStringArray(filters.tags),
    minImportance: asNumber(filters.minImportance) as 1 | 2 | 3 | 4 | 5 | undefined,
    verifiedOnly: asBoolean(filters.verifiedOnly),
    excerptLength,
  });

  const excerptNote =
    excerptLength !== undefined && !sortRecent
      ? `> 개발자 지식의 본문은 ${excerptLength}자를 넘으면 발췌해서 싣습니다. 전체 본문은 같은 query 에 \`scope: "knowledge"\` 를 지정해 검색하면 볼 수 있습니다.`
      : undefined;

  return withNotes(
    formatJson("개발자 지식 검색 결과", result),
    limit.note,
    excerptNote,
    ignoredFiltersNote(filters, KNOWLEDGE_USED_FILTER_KEYS),
  );
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

/** 컴포넌트를 찾지 못했을 때의 안내. 같은 입력으로 찾은 후보가 있으면 컴포넌트 ID 와 함께 나열한다. */
function formatComponentNotFound(componentId: string, suggestions: CommonComponent[] = []): string {
  const lines = [`컴포넌트를 찾을 수 없습니다: ${componentId}`];
  if (suggestions.length > 0) {
    lines.push("", "비슷한 컴포넌트 (`filters.componentId` 에는 아래의 컴포넌트 ID 를 넣습니다):");
    for (const suggestion of suggestions) {
      lines.push(`- \`${suggestion.component_id}\` ${suggestion.name} (${suggestion.package_name})`);
    }
  }
  return lines.join("\n");
}

function formatComponentDetail(componentId: string): string {
  const { component, dependencies, dependencyComponents, suggestions } = getComponentInfo(componentId);
  return component
    ? formatComponentInfo(component, dependencies, dependencyComponents)
    : formatComponentNotFound(componentId, suggestions);
}

/**
 * 파일 기능(sourceFiles, ddl, dml)에 넘길 컴포넌트를 정한다.
 * 호출자는 컴포넌트 ID, 패키지명, 정확한 컴포넌트 이름 가운데 하나를 줄 수 있고, 여기서 컴포넌트 ID 로 바꾼다.
 * 찾지 못하면 후보를 담은 안내 문구를 돌려준다.
 */
function resolveComponent(input: string): { id: string } | { notFound: string } {
  const { component, suggestions } = getComponentInfo(input);
  return component ? { id: component.component_id } : { notFound: formatComponentNotFound(input, suggestions) };
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
  const input = requireComponentId(filters, "component source file listing");
  const resolved = resolveComponent(input);
  if ("notFound" in resolved) {
    return resolved.notFound;
  }
  const result = getComponentSourceFiles(resolved.id);
  return result ? formatComponentSourceFiles(result) : formatComponentNotFound(input);
}

/** 본문에 들어 있는 백틱 연속보다 긴 코드 펜스를 고른다 (본문의 ``` 가 블록을 닫지 않게 한다). */
function codeFenceFor(content: string): string {
  const longestRun = Math.max(0, ...(content.match(/`+/g) ?? []).map((run) => run.length));
  return "`".repeat(Math.max(3, longestRun + 1));
}

function formatComponentSourceRead(filters: Record<string, unknown>): string {
  const filePath = asString(filters.filePath);
  if (!filePath) {
    throw new UserFacingError("filters.filePath is required for component source reading");
  }
  const result = readComponentSource(filePath, { offset: asNumber(filters.offset) });
  if (!result) {
    return `파일을 찾을 수 없거나 접근할 수 없습니다: ${filePath}`;
  }

  // UTF-8 이 아닌 인코딩으로 읽은 파일은 인코딩을 함께 적는다 (바이트 수와 문자 수가 다른 이유를 알 수 있다).
  const encodingLabel = result.encoding && result.encoding !== "utf-8" ? `, ${result.encoding.toUpperCase()}` : "";
  const header = `**파일**: \`${result.filePath}\` (${formatCount(result.size)} bytes, ${result.language}${encodingLabel})`;
  if (result.language === "binary") {
    // 바이너리 파일의 content 는 파일 내용이 아니라 안내 문구다.
    return `${header}\n\n${result.content}`;
  }

  const fence = codeFenceFor(result.content);
  const body = [header, "", `${fence}${result.language}`, result.content, fence].join("\n");

  // 한 번에 다 싣지 못한 파일은 표시한 범위와 이어 읽는 방법을 알린다.
  const end = result.offset + result.content.length;
  if (result.truncated && result.nextOffset !== null) {
    return withNotes(
      body,
      `> 전체 ${formatCount(result.totalChars)}자 중 ${formatCount(result.offset + 1)}~${formatCount(end)}자를 표시했습니다. ` +
        `이어서 읽으려면 같은 호출에 \`filters.offset: ${result.nextOffset}\` 을 주세요.`,
    );
  }
  if (result.offset > 0) {
    return withNotes(
      body,
      result.content.length > 0
        ? `> 전체 ${formatCount(result.totalChars)}자 중 ${formatCount(result.offset + 1)}~${formatCount(end)}자를 표시했습니다 (파일의 끝).`
        : `> filters.offset ${result.offset} 부터는 남은 내용이 없습니다 (전체 ${formatCount(result.totalChars)}자).`,
    );
  }
  return body;
}

function formatComponentScriptLookup(
  args: EgovSearchKnowledgeArgs,
  filters: Record<string, unknown>,
  action: "ddl" | "dml",
): string {
  const input = requireComponentId(filters, `component ${action} lookup`);
  const dbType = asString(filters.dbType) || "mysql";
  const resolved = resolveComponent(input);
  if ("notFound" in resolved) {
    return resolved.notFound;
  }

  if (action === "ddl") {
    const result = getComponentDDL(resolved.id, dbType);
    return result ? formatComponentDDL(result) : formatComponentNotFound(input);
  }

  // 기본 보기는 테이블마다 처음 몇 건만 보여 준다. filters.table 을 주면 그 테이블을 limit·offset 으로 나눠 조회한다.
  const result = getComponentDML(resolved.id, dbType, {
    table: asString(filters.table),
    limit: requestedLimit(args),
    offset: asNumber(filters.offset),
  });
  return result ? formatComponentDML(result) : formatComponentNotFound(input);
}

function formatComponentListLookup(
  args: EgovSearchKnowledgeArgs,
  filters: Record<string, unknown>,
  options: SectionOptions = {},
): string {
  const listFilters = {
    categoryId: asString(filters.categoryId),
    keyword: asString(filters.keyword),
    hasWeb: asBoolean(filters.hasWeb),
    version: asString(filters.version),
  };
  const hasFilters = Object.values(listFilters).some((value) => value !== undefined);
  const ignored = ignoredFiltersNote(filters, COMPONENT_LIST_FILTER_KEYS);

  // 검색어를 하나도 추출할 수 없는 query("*" 처럼 기호뿐인 값)는 지정하지 않은 것으로 본다.
  const query = args.query && extractSearchTerms(args.query).length > 0 ? args.query : undefined;

  if (query) {
    const limit = resolveLimit(args, "components", options);
    const { results, total, matchMode } = searchComponents(query, limit.value, listFilters);
    return withNotes(formatComponentList(results, false, { total, matchMode }), limit.note, ignored);
  }

  if (hasFilters) {
    // limit 을 주지 않으면 조건에 맞는 컴포넌트를 모두 보여 준다 (전체가 150개 안팎이라 한 번에 볼 수 있다).
    // 통합 검색에서는 다른 출처와 같이 출처별 기본 건수를 따른다.
    const limit =
      requestedLimit(args) !== undefined || options.defaultLimit !== undefined
        ? resolveLimit(args, "components", options)
        : undefined;
    const { components, total } = listCommonComponents(listFilters, limit?.value);
    return withNotes(formatComponentList(components, true, { total }), limit?.note, ignored);
  }

  const { categories } = listComponentCategories();
  return withNotes(
    `${formatCategoryList(categories)}\n---\n\n${formatComponentSummary(getComponentSummary())}`,
    ignored,
  );
}

/** action 별로 실제 조회에 쓰이는 필터 키. */
function usedFilterKeysForAction(action: ComponentAction, filters: Record<string, unknown>): readonly string[] {
  switch (action) {
    case "get":
    case "info":
    case "sourceFiles":
      return COMPONENT_ID_KEYS;
    case "dependencies":
      return [...COMPONENT_ID_KEYS, "componentIds"];
    case "readSource":
      return ["filePath", "offset"];
    case "ddl":
      return [...COMPONENT_ID_KEYS, "dbType"];
    case "dml":
      // limit 과 offset 은 filters.table 을 준 구간 조회에서만 쓰인다.
      return hasFilterValue(filters, "table")
        ? [...COMPONENT_ID_KEYS, "dbType", "table", "limit", "offset"]
        : [...COMPONENT_ID_KEYS, "dbType"];
  }
}

function runComponentAction(
  args: EgovSearchKnowledgeArgs,
  filters: Record<string, unknown>,
  action: ComponentAction,
): string {
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
      return formatComponentScriptLookup(args, filters, action);
  }
}

function searchComponentsGateway(args: EgovSearchKnowledgeArgs, options: SectionOptions = {}): string {
  const filters = getFilters(args);
  const action = args.action;

  // action 이 없을 때만 필터로 동작을 정한다: componentId 가 있으면 상세, 없으면 목록/검색.
  // action 이 있으면 componentId 는 그 action 의 대상일 뿐이므로 상세 조회로 가로채지 않는다.
  if (!action) {
    const componentId = getComponentId(filters);
    return componentId
      ? withNotes(formatComponentDetail(componentId), ignoredFiltersNote(filters, COMPONENT_ID_KEYS))
      : formatComponentListLookup(args, filters, options);
  }

  if (!isComponentAction(action)) {
    throw new UserFacingError(
      `Unsupported action for components scope: ${action}. Supported actions: ${COMPONENT_ACTIONS.join(", ")}`,
    );
  }

  return withNotes(
    runComponentAction(args, filters, action),
    ignoredFiltersNote(filters, usedFilterKeysForAction(action, filters)),
  );
}

async function searchCompatibility(args: EgovSearchKnowledgeArgs, options: SectionOptions = {}): Promise<string> {
  const filters = getFilters(args);
  const limit = resolveLimit(args, "compatibility", options);
  const result = await searchCompatibleSoftware({
    query: args.query,
    frameworkVersion: asString(filters.frameworkVersion),
    category: asString(filters.category),
    minLevel: asNumber(filters.minLevel) as 1 | 2 | undefined,
    vendor: asString(filters.vendor),
    productName: asString(filters.productName),
    limit: limit.value,
    offset: asNumber(filters.offset),
    includeKnowledge: asBoolean(filters.includeKnowledge),
  });

  // 뒤에 남은 결과가 있으면 다음 구간을 조회하는 방법을 알린다.
  const shownEnd = result.offset + result.count;
  const shownRange = result.count === 1 ? `${shownEnd}번째` : `${result.offset + 1}~${shownEnd}번째`;
  const pagingNote =
    result.count > 0 && shownEnd < result.total
      ? `> 전체 ${result.total}건 중 ${shownRange} 결과를 표시했습니다. 다음 구간은 같은 호출에 \`filters.offset: ${shownEnd}\` 을 주어 조회합니다.`
      : undefined;

  return withNotes(
    formatJson("호환 소프트웨어 검색 결과", result),
    limit.note,
    pagingNote,
    ignoredFiltersNote(filters, COMPATIBILITY_USED_FILTER_KEYS),
  );
}

async function searchAll(args: EgovSearchKnowledgeArgs): Promise<string> {
  requireQuery(args.query, "all");

  // 필터는 그 필터를 쓰는 출처에만 넘긴다. 함께 쓰는 키인 category 는 값으로 출처를 가린다:
  // 한쪽 출처의 분류 값으로 확인되면 그 출처에만 넘기고, 어느 쪽 값도 아니면 양쪽에 넘겨
  // 각 출처가 쓸 수 있는 값을 안내하게 한다.
  const filters = getFilters(args);
  const owner = await findCategoryOwner(filters);
  const categoryForGuide = owner.guide || !owner.compatibility ? ["category"] : [];
  const categoryForCompatibility = owner.compatibility || !owner.guide ? ["category"] : [];

  const guideKeys = [...GUIDE_FILTER_KEYS, ...categoryForGuide];
  const knowledgeKeys = ["type", "tags", "minImportance", "verifiedOnly"];
  const componentKeys = [...COMPONENT_FILTER_KEYS, "keyword", "version"];
  const compatibilityKeys = [...COMPATIBILITY_FILTER_KEYS, ...categoryForCompatibility];

  const limitFilter = pickFilters(filters, ["limit"]);
  const forSource = (keys: readonly string[]): EgovSearchKnowledgeArgs => ({
    ...args,
    filters: { ...pickFilters(filters, keys), ...limitFilter },
  });
  const options: SectionOptions = {
    defaultLimit: ALL_SCOPE_SECTION_LIMIT,
    knowledgeExcerptLength: ALL_SCOPE_KNOWLEDGE_EXCERPT_LENGTH,
  };

  const sections = await Promise.all(
    (
      [
        ["공식 가이드", () => searchGuide(forSource(guideKeys), options)],
        ["개발자 지식", () => searchDeveloperKnowledge(forSource(knowledgeKeys), options)],
        ["공통컴포넌트", async () => searchComponentsGateway(forSource(componentKeys), options)],
        ["호환 소프트웨어", () => searchCompatibility(forSource(compatibilityKeys), options)],
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

  // 어느 출처에도 넘기지 않은 필터(sort, knowledgeScope, offset 등)는 통합 검색에서 쓰이지 않는다.
  const ignored = ignoredFiltersNote(filters, [
    ...guideKeys,
    ...knowledgeKeys,
    ...componentKeys,
    ...compatibilityKeys,
    "category",
    "limit",
  ]);

  return withNotes(`# 통합 지식 검색 결과\n\n${sections.join("\n\n---\n\n")}`, ignored);
}

/**
 * scope 를 지정하지 않았을 때(auto) 검색할 출처를 정한다.
 *
 * 1. action 이 있으면 components (action 은 components 에서만 지원한다)
 * 2. 출처를 가리키는 필터가 있으면 그 출처 (components → compatibility → guide → knowledge 순으로 확인).
 *    함께 쓰는 키인 category 는 값이 어느 출처의 분류인지로 가린다.
 * 3. 그 밖에는 query 가 있으면 통합 검색, 없으면 공통컴포넌트 카테고리 개요
 */
async function inferScope(args: EgovSearchKnowledgeArgs): Promise<ResolvedScope> {
  const filters = getFilters(args);
  if (args.action) {
    return "components";
  }
  if (hasAnyFilter(filters, COMPONENT_FILTER_KEYS)) {
    return "components";
  }
  if (hasAnyFilter(filters, COMPATIBILITY_FILTER_KEYS)) {
    return "compatibility";
  }
  const category = asString(filters.category);
  if (category !== undefined && isCompatibilityCategory(category)) {
    return "compatibility";
  }
  if (hasAnyFilter(filters, GUIDE_FILTER_KEYS)) {
    return "guide";
  }
  if (category !== undefined && (await isGuideCategory(category))) {
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
  const scope: ResolvedScope = args.scope && args.scope !== "auto" ? args.scope : await inferScope(args);

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
