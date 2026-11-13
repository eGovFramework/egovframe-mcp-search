/**
 * Compatibility Tools
 * 호환성 소프트웨어 관리 도구
 */

import { getHybridManager, type HybridDatabaseManager } from '../database/hybridManager.js';
import type { SQLiteManager } from '../database/sqliteManager.js';
import { CompatibilitySearchFilter, CompatibilitySoftwareInfo, KeywordMatchMode } from '../types/database.js';
import { UserFacingError } from '../utils/errors.js';
import { normalizeFrameworkVersion } from '../utils/frameworkVersion.js';
import { collapseWhitespace, excerptAround, presentTitle } from '../utils/knowledgePresentation.js';
import { findProductMention, lowerAscii, nameWithoutParentheses } from '../utils/productMention.js';
import { maskResidentNumbers } from '../utils/sensitiveText.js';

/** 문자열 필터 값의 앞뒤 공백을 뗀다. 문자열이 아니거나 비어 있으면 undefined. */
function cleanFilter(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** 호출 인자에서 실제로 적용할 필터만 추린다 (공백 제거, 버전 표기 정규화). */
function normalizeFilters(args: {
  frameworkVersion?: string;
  category?: string;
  level?: 1 | 2;
  minLevel?: 1 | 2;
  vendor?: string;
  productName?: string;
}): CompatibilitySearchFilter {
  const filters: CompatibilitySearchFilter = {};

  const frameworkVersion = cleanFilter(args.frameworkVersion);
  if (frameworkVersion) {
    filters.frameworkVersion = normalizeFrameworkVersion(frameworkVersion);
  }
  const category = cleanFilter(args.category);
  if (category) {
    filters.category = category;
  }
  // 숫자가 아닌 값은 조회에 적용되지 않으므로 응답의 filters 에도 싣지 않는다
  if (typeof args.level === 'number') {
    filters.level = args.level;
  }
  if (typeof args.minLevel === 'number') {
    filters.minLevel = args.minLevel;
  }
  const vendor = cleanFilter(args.vendor);
  if (vendor) {
    filters.vendor = vendor;
  }
  const productName = cleanFilter(args.productName);
  if (productName) {
    filters.productName = productName;
  }

  return filters;
}

/**
 * frameworkVersion 또는 category 필터가 데이터에 없는 값이면, 쓸 수 있는 값 목록을 돌려준다.
 * 두 필터가 모두 유효하면(조합에 맞는 행이 없을 뿐이면) undefined.
 */
function findAvailableValues(
  sqlite: SQLiteManager,
  filters: CompatibilitySearchFilter,
): { frameworkVersions: string[]; categories: string[] } | undefined {
  const { frameworkVersion, category } = filters;
  if (frameworkVersion === undefined && category === undefined) {
    return undefined;
  }

  const frameworkVersions = sqlite.getFrameworkVersions();
  const categories = sqlite.getCategories();
  const unknownVersion = frameworkVersion !== undefined && !frameworkVersions.includes(frameworkVersion);
  const unknownCategory =
    category !== undefined && !categories.some((known) => lowerAscii(known) === lowerAscii(category));

  return unknownVersion || unknownCategory ? { frameworkVersions, categories } : undefined;
}

/** limit 을 주지 않았을 때 돌려주는 건수 */
const DEFAULT_LIMIT = 20;
/**
 * 한 번에 돌려주는 최대 건수. 그 이상은 offset 으로 이어서 조회한다.
 *
 * MCP 클라이언트는 큰 도구 결과를 본문 대신 파일로 넘기거나 잘라 낸다 (Claude Code 는 25,000 토큰을 기본
 * 상한으로 두고, 50,000자를 넘는 결과는 파일로 저장한다). 행 하나가 응답에서 400~500자를 차지해 100건이면
 * 50,000자에 닿으므로, 그 절반에서 끊는다.
 */
const MAX_LIMIT = 50;

/** limit 을 1 이상 MAX_LIMIT 이하의 정수로 맞춘다. 숫자가 아니면 기본값을 쓴다. */
function normalizeLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || Number.isNaN(limit)) {
    return DEFAULT_LIMIT;
  }
  return Math.min(Math.max(1, Math.floor(limit)), MAX_LIMIT);
}

/** offset 을 0 이상의 정수로 맞춘다. 숫자가 아니면 0 을 쓴다. */
function normalizeOffset(offset: number | undefined): number {
  if (typeof offset !== 'number' || Number.isNaN(offset)) {
    return 0;
  }
  return Math.min(Math.max(0, Math.floor(offset)), Number.MAX_SAFE_INTEGER);
}

/** includeKnowledge 로 함께 돌려주는 관련 지식 한 건 */
export interface RelatedKnowledgeItem {
  id: string;
  /** 제목. 지식 검색의 응답과 같은 방식으로 다듬는다 (NFC 정규화, 주민등록번호 형식 가림) */
  title: string;
  /**
   * 본문에서 제품명이 처음 나오는 자리를 가운데에 둔 발췌 (제품명이 제목에만 있으면 본문의 처음부터).
   * 줄바꿈과 연속 공백은 공백 하나로 바꾸고, 자른 쪽에는 "..." 을 붙인다. 표시까지 200자 이내다
   */
  excerpt: string;
  type: string;
  importance: number;
  tags: string[];
}

/** 제품 하나와 그 제품을 언급하는 지식 */
export interface RelatedKnowledge {
  product: string;
  knowledge: RelatedKnowledgeItem[];
}

/** 한 번의 조회에서 관련 지식을 찾아보는 제품 수 (결과의 앞에서부터) */
const MAX_KNOWLEDGE_PRODUCTS = 5;

/** 제품 하나마다 의미 검색으로 가져와 제품명을 언급하는지 확인하는 후보 수 */
const KNOWLEDGE_CANDIDATES_PER_PRODUCT = 50;

/** 제품 하나에 싣는 관련 지식의 최대 건수 */
const MAX_KNOWLEDGE_PER_PRODUCT = 5;

/** 관련 지식 항목에 싣는 본문 발췌의 최대 길이 (생략 표시 포함) */
const KNOWLEDGE_EXCERPT_LENGTH = 200;

/**
 * 관련 지식 항목에 싣는 본문 발췌를 만든다: 본문에서 제품의 이름(name)이 처음 언급된 자리를 가운데에 둔다.
 * 본문이 그 이름을 언급하지 않으면(제목에만 있으면) 본문의 처음부터 싣는다.
 *
 * 줄바꿈과 연속 공백을 공백 하나로 바꾸고 주민등록번호 형식을 가린 뒤에 자른다. 자른 뒤에 가리면 잘린 자리에
 * 걸친 번호의 일부가 남는다 (공개 게시판의 글이라 본문에 들어 있을 수 있다).
 */
function mentionExcerpt(content: unknown, name: string): string {
  if (typeof content !== 'string') {
    return '';
  }
  const text = maskResidentNumbers(collapseWhitespace(content));
  const at = findProductMention(text, name);
  return at === -1
    ? excerptAround(text, 0, 0, KNOWLEDGE_EXCERPT_LENGTH)
    : excerptAround(text, at, name.length, KNOWLEDGE_EXCERPT_LENGTH);
}

/** 관련 지식 조회가 실패했을 때 응답에 싣는 안내. 내부 오류의 상세 원인은 서버 로그(stderr)에만 남긴다. */
const KNOWLEDGE_WARNING =
  '관련 지식을 조회하는 중 오류가 발생해 일부 또는 전부를 싣지 못했습니다. ' +
  '호환 소프트웨어 목록은 정상입니다. 자세한 내용은 MCP 서버 로그(stderr)를 확인하세요.';

/**
 * knowledgeWarning 에 싣는 문구를 만든다.
 *
 * cause 는 호출자가 읽고 조치할 수 있는 실패 원인이다 (임베딩 모델이 없거나 손상됨, 지식 인덱스가 없음).
 * 있으면 고정 안내 끝에 덧붙인다. 내부 오류는 원인을 싣지 않으므로 cause 없이 고정 안내만 쓴다.
 */
function knowledgeWarning(cause: string | undefined): string {
  return cause === undefined ? KNOWLEDGE_WARNING : `${KNOWLEDGE_WARNING} 원인: ${cause}`;
}

/**
 * 오류가 호출자가 읽고 조치할 수 있는 것(UserFacingError)이면 그 문구를 돌려준다.
 * 그 밖의 오류는 문구에 절대 경로나 내부 SQL 이 들어 있을 수 있으므로 undefined 를 돌려준다.
 */
function actionableCause(error: unknown): string | undefined {
  return error instanceof UserFacingError ? error.message : undefined;
}

/** 개발자 지식 매니저 (하이브리드 매니저가 내주는 것) */
type KnowledgeManager = ReturnType<HybridDatabaseManager['getKnowledge']>;

/**
 * 개발자 지식 매니저를 준비한다 (LanceDB 테이블 열기).
 * 실패하면 원인을 서버 로그에 남기고, 매니저 없이(knowledge: null) 실패 원인(error)을 돌려준다.
 */
async function openKnowledge(
  manager: HybridDatabaseManager,
): Promise<{ knowledge: KnowledgeManager } | { knowledge: null; error: unknown }> {
  try {
    await manager.initialize();
    return { knowledge: manager.getKnowledge() };
  } catch (error) {
    console.error('[egovframe-mcp-search] 관련 지식 조회를 준비하지 못했습니다:', error);
    return { knowledge: null, error };
  }
}

/**
 * 제품명마다 그 제품을 언급하는 지식을 찾는다.
 *
 * 벡터 검색은 관련이 없어도 가까운 순으로 항상 요청한 건수를 돌려준다. 그래서 제품명으로 의미 검색한 후보
 * 가운데 제목이나 본문이 제품의 이름(괄호를 뺀 이름, nameWithoutParentheses)을 언급하는 지식만 남긴다.
 * 이름이 다른 낱말의 일부로 들어 있을 뿐인 글은 언급으로 보지 않는다 (findProductMention 의 낱말 경계와
 * 대소문자 규칙).
 * 제품을 실제로 언급하는 글이 가까운 몇 건 안에 든다는 보장이 없으므로 (제품명이 짧으면 다른 글이 앞 순위를
 * 차지한다), 후보를 KNOWLEDGE_CANDIDATES_PER_PRODUCT 건까지 보고 그 가운데 앞의 MAX_KNOWLEDGE_PER_PRODUCT 건을
 * 싣는다. 그런 지식이 하나도 없는 제품은 결과에 넣지 않는다.
 * 항목에는 본문 전체 대신 제품명이 나오는 자리의 발췌를 싣는다 (mentionExcerpt). 호출자가 제목으로 다시
 * 검색하지 않고도 그 글이 제품을 어떻게 언급하는지 볼 수 있다.
 *
 * 지식 쪽 오류는 던지지 않고 failed 로 알린다 (소프트웨어 조회 결과는 이미 구해져 있다).
 * 실패 가운데 호출자가 조치할 수 있는 것이 있으면 그 문구를 cause 로 함께 돌려준다 (여럿이면 처음 것).
 * searchedProducts 는 조회를 마친 제품 수다. productNames 가 비어 있으면 지식 쪽을 초기화하지 않는다.
 */
async function findRelatedKnowledge(
  manager: HybridDatabaseManager,
  productNames: string[],
): Promise<{ relatedKnowledge: RelatedKnowledge[]; searchedProducts: number; failed: boolean; cause?: string }> {
  const relatedKnowledge: RelatedKnowledge[] = [];
  if (productNames.length === 0) {
    return { relatedKnowledge, searchedProducts: 0, failed: false };
  }

  const opened = await openKnowledge(manager);
  if (opened.knowledge === null) {
    return { relatedKnowledge, searchedProducts: 0, failed: true, cause: actionableCause(opened.error) };
  }
  const { knowledge } = opened;

  let searchedProducts = 0;
  let failed = false;
  let cause: string | undefined;

  for (const productName of productNames) {
    try {
      const name = nameWithoutParentheses(productName);
      const candidates = await knowledge.searchKnowledge(productName, { limit: KNOWLEDGE_CANDIDATES_PER_PRODUCT });
      const mentioning = candidates
        .filter((item) =>
          [item.title, item.content].some((text) => typeof text === 'string' && findProductMention(text, name) !== -1),
        )
        .slice(0, MAX_KNOWLEDGE_PER_PRODUCT);
      searchedProducts += 1;
      if (mentioning.length > 0) {
        relatedKnowledge.push({
          product: productName,
          knowledge: mentioning.map((item) => ({
            id: item.id,
            title: presentTitle(item.title),
            excerpt: mentionExcerpt(item.content, name),
            type: item.type,
            importance: item.importance,
            tags: item.tags,
          })),
        });
      }
    } catch (error) {
      failed = true;
      cause ??= actionableCause(error);
      console.error(`[egovframe-mcp-search] 관련 지식 조회 실패 (${productName}):`, error);
    }
  }

  return { relatedKnowledge, searchedProducts, failed, cause };
}

/** 호환성 소프트웨어 검색 응답 */
export interface CompatibilitySearchResponse {
  success: true;
  /** 같은 조건에 맞는 전체 건수 (limit/offset 적용 전) */
  total: number;
  /** 이번에 돌려준 건수 (software 의 길이) */
  count: number;
  /** 실제로 적용한 limit (1~50) */
  limit: number;
  /** 실제로 적용한 offset */
  offset: number;
  /** 실제로 적용한 필터 */
  filters: CompatibilitySearchFilter;
  /** 키워드 검색이 결과를 찾은 방식. 키워드 검색을 하지 않았으면 없다 */
  matchMode?: KeywordMatchMode;
  /**
   * query 에 단독 낱말 OR(대소문자 무관)가 있어, 검색어 가운데 하나 이상이 일치하는 행을 찾았을 때만 true 로 싣는다
   * (matchMode 는 any-term, requiredMatches 는 1). 이 필드가 없는 any-term 결과는 모든 검색어가 일치하는 행이 없어
   * 대체 검색으로 넘어간 것이다
   */
  orQuery?: true;
  /**
   * matchMode 가 any-term 일 때: 대체 검색에 쓴 검색어. 조사를 떼어 쓴 검색어는 뗀 꼴이고,
   * '.', '-', '_' 에서 나눠 쓴 검색어는 조각이다 ('K2Web-Wizard' → 'K2Web', 'Wizard')
   */
  usedTerms?: string[];
  /**
   * matchMode 가 any-term 일 때: 결과의 행마다 일치한 검색어(usedTerms)의 최소 수.
   * usedTerms 의 절반(올림)에서 시작해, 그 기준을 채운 행이 없으면 1 까지 낮춘 값이다 (orQuery 이면 처음부터 1 이다).
   * usedTerms 의 수보다 작으면 결과의 행은 검색어의 일부만 일치한 행이다. usedTerms 가 비면 0 이다
   */
  requiredMatches?: number;
  /** 일치하는 행이 없어 검색에 쓰지 않은 검색어 (query 에 적힌 꼴). 그런 검색어가 없으면 없다 */
  ignoredTerms?: string[];
  /**
   * 일치하는 행이 있는지와 관계없이 검색에서 뺀 검색어 (query 에 적힌 꼴, 적힌 순서대로).
   * - 영어 기능어(is, with, the 등)와 프레임워크 자체를 가리키는 낱말(eGovFrame, 전자정부, 표준프레임워크 등).
   *   목록의 모든 행에 해당하거나 제품명의 일부와 우연히 일치할 뿐이라 행을 가려 주지 못한다.
   *   다른 검색어가 남을 때만 뺀다
   * - 한 글자 검색어. 한 글자 검색어까지 일치하는 행이 없으면 두 글자 이상인 검색어만으로 찾는다
   *
   * matchMode 가 all-terms 여도 싣는다 (나머지 검색어는 모두 일치했다는 뜻이다). 뺀 검색어가 없으면 없다
   */
  droppedTerms?: string[];
  /**
   * 키워드 검색 결과가 0건인데 같은 필터만 적용하면 행이 있을 때: 필터만 적용한 건수.
   * 0건의 원인이 필터가 아니라 query 임을 알 수 있다 (query 의 어느 검색어도 그 행들과 일치하지 않았다)
   */
  totalWithoutQuery?: number;
  /** 결과가 0건이고 frameworkVersion·category 가 데이터에 없는 값일 때: 쓸 수 있는 값 */
  available?: { frameworkVersions: string[]; categories: string[] };
  /** 조회된 소프트웨어. 내부용 필드(id, created_at)는 싣지 않는다 */
  software: CompatibilitySoftwareInfo[];
  /**
   * includeKnowledge 일 때: 제품명을 언급하는 지식 (제품마다 최대 5건). 그런 지식이 없는 제품은 빠진다.
   * 조회된 소프트웨어가 없어도 빈 배열로 싣는다
   */
  relatedKnowledge?: RelatedKnowledge[];
  /**
   * includeKnowledge 일 때: 관련 지식을 조회한 범위. 이번 페이지에 나온 제품(pageProducts, 제품명 기준) 가운데
   * 앞에서부터 searchedProducts 개만 조회했다. 나머지 제품의 지식은 그 제품을 productName 으로 좁혀 조회한다
   */
  knowledgeLookup?: { searchedProducts: number; pageProducts: number };
  /**
   * 관련 지식 조회가 일부라도 실패했을 때의 안내 (소프트웨어 목록에는 영향이 없다).
   * 호출자가 조치할 수 있는 실패(임베딩 모델이나 지식 인덱스가 없음)이면 끝에 " 원인: …" 이 붙는다
   */
  knowledgeWarning?: string;
}

/**
 * 호환성 소프트웨어 검색 (통합)
 * - 기본: 호환 소프트웨어 검색
 * - includeKnowledge=true: 검색 결과의 소프트웨어에 대한 개발자 경험/지식도 함께 반환
 *
 * 한 번에 limit 건(기본 20, 최대 50)을 돌려준다. 응답의 total 이 count 보다 크면
 * offset 을 늘려 다음 페이지를 조회할 수 있다.
 */
export async function searchCompatibleSoftware(args: {
  query?: string;
  frameworkVersion?: string;
  category?: string;
  /** 호환성 레벨이 이 값과 같은 행만 (minLevel 은 이 값 이상인 행. 함께 주면 둘 다 적용한다) */
  level?: 1 | 2;
  minLevel?: 1 | 2;
  vendor?: string;
  productName?: string;
  limit?: number;
  offset?: number;
  includeKnowledge?: boolean;
}): Promise<CompatibilitySearchResponse> {
  // 호환성 조회는 SQLite 만 쓴다. 지식 쪽(LanceDB + 임베딩 모델)은 includeKnowledge 일 때만 초기화한다.
  const manager = getHybridManager();
  const sqlite = manager.getSQLite();
  const limit = normalizeLimit(args.limit);
  const offset = normalizeOffset(args.offset);

  // 실제로 적용하는 필터. 응답의 filters 로 그대로 되돌려준다.
  const filters = normalizeFilters(args);

  // 키워드와 필터를 한 번의 조회로 처리한다 (필터는 SQL 에서 LIMIT 보다 먼저 적용된다).
  // matchMode 는 키워드 검색이 결과를 찾은 방식이다 (all-terms: 모든 검색어가 일치하는 행,
  // any-term: 그런 행이 없어 대체 검색으로 찾은 행. 일부 검색어만 일치한다).
  // 대체 검색은 쓸 검색어가 하나라도 있으면 결과가 0건이 되지 않는다 (일치 기준을 낮춰 가며 찾는다).
  // query 에 OR 가 있으면 처음부터 검색어 가운데 하나 이상이 일치하는 행을 찾는다 (any-term, terms.orQuery).
  const { rows: results, total, matchMode, terms } = sqlite.queryCompatibleSoftware({
    query: args.query?.trim(),
    filters,
    limit,
    offset,
  });

  // 결과가 없고 frameworkVersion·category 가 데이터에 없는 값이면, 쓸 수 있는 값을 알려 준다.
  const available = total === 0 ? findAvailableValues(sqlite, filters) : undefined;

  // 키워드 검색 결과가 0건이면 같은 필터만 적용한 건수를 센다. 행이 있으면 0건의 원인은 필터가 아니라 query 다.
  const totalWithoutQuery =
    matchMode && total === 0 ? sqlite.queryCompatibleSoftware({ filters, limit: 1 }).total : 0;

  const response: CompatibilitySearchResponse = {
    success: true,
    total,
    count: results.length,
    limit,
    offset,
    filters,
    ...(matchMode ? { matchMode } : {}),
    // query 에 OR 가 있어 하나 이상 일치하는 행을 찾은 결과는, 모든 검색어가 일치하는 행이 없어 넘어간 대체 검색과 구분해 알린다
    ...(terms?.orQuery ? { orQuery: true as const } : {}),
    // 대체 검색 결과는 일부 검색어만 일치한 행이다. 어떤 검색어 가운데 몇 개가 일치했는지 함께 알린다
    ...(matchMode === 'any-term' && terms ? { usedTerms: terms.used, requiredMatches: terms.required } : {}),
    ...(terms && terms.ignored.length > 0 ? { ignoredTerms: terms.ignored } : {}),
    // 검색에서 뺀 검색어는 결과를 찾은 방식과 관계없이 알린다 (all-terms 는 나머지 검색어가 모두 일치했다는 뜻이다)
    ...(terms && terms.dropped.length > 0 ? { droppedTerms: terms.dropped } : {}),
    ...(totalWithoutQuery > 0 ? { totalWithoutQuery } : {}),
    ...(available ? { available } : {}),
    software: results,
  };

  // includeKnowledge=true: 이번 페이지에 나온 제품 가운데 앞의 몇 개에 대해, 그 제품을 언급하는 지식을 함께 싣는다.
  // 조회된 소프트웨어가 없어도 키는 싣는다 (응답의 모양이 결과 건수에 따라 달라지지 않게 한다).
  // 지식 조회가 실패해도 소프트웨어 결과는 그대로 돌려주고 knowledgeWarning 으로 알린다.
  if (args.includeKnowledge) {
    const pageProducts = [...new Set(results.map((item) => item.product_name))].filter(
      (productName) => productName.trim() !== '',
    );
    const { relatedKnowledge, searchedProducts, failed, cause } = await findRelatedKnowledge(
      manager,
      pageProducts.slice(0, MAX_KNOWLEDGE_PRODUCTS),
    );
    response.relatedKnowledge = relatedKnowledge;
    response.knowledgeLookup = { searchedProducts, pageProducts: pageProducts.length };
    if (failed) {
      response.knowledgeWarning = knowledgeWarning(cause);
    }
  }

  return response;
}
