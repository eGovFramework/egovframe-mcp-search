/**
 * Compatibility Tools
 * 호환성 소프트웨어 관리 도구
 */

import { getInitializedHybridManager } from '../database/hybridManager.js';
import type { SQLiteManager } from '../database/sqliteManager.js';
import { CompatibilitySearchFilter, CompatibilitySoftwareInfo, KeywordMatchMode } from '../types/database.js';

/** 문자열 필터 값의 앞뒤 공백을 뗀다. 문자열이 아니거나 비어 있으면 undefined. */
function cleanFilter(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * frameworkVersion 필터를 데이터의 표기(major.minor)에 맞춘다.
 *
 * 앞의 v 또는 V 를 떼고, x.y.z 꼴은 x.y 로 줄인다 ('v4.3.0' → '4.3').
 * 숫자가 아니라 문자열로 다룬다 ('3.10' 과 '3.1' 은 다른 버전이다).
 */
export function normalizeFrameworkVersion(value: string): string {
  const version = value.trim().replace(/^[vV](?=\s*\d)/, '').trim();
  const patched = /^(\d+\.\d+)\.\d+$/.exec(version);
  return patched ? patched[1] : version;
}

/** 호출 인자에서 실제로 적용할 필터만 추린다 (공백 제거, 버전 표기 정규화). */
function normalizeFilters(args: {
  frameworkVersion?: string;
  category?: string;
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
  if (args.minLevel !== undefined) {
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

/** SQLite 의 NOCASE 와 같은 기준(ASCII 영문자만)으로 소문자로 바꾼다. */
function lowerAscii(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
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
/** 한 번에 돌려주는 최대 건수. 그 이상은 offset 으로 이어서 조회한다 */
const MAX_LIMIT = 100;

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
  title: string;
  type: string;
  importance: number;
  tags: string[];
}

/** 호환성 소프트웨어 검색 응답 */
export interface CompatibilitySearchResponse {
  success: true;
  /** 같은 조건에 맞는 전체 건수 (limit/offset 적용 전) */
  total: number;
  /** 이번에 돌려준 건수 (software 의 길이) */
  count: number;
  /** 실제로 적용한 limit (1~100) */
  limit: number;
  /** 실제로 적용한 offset */
  offset: number;
  /** 실제로 적용한 필터 */
  filters: CompatibilitySearchFilter;
  /** 키워드 검색이 결과를 찾은 방식. 키워드 검색을 하지 않았으면 없다 */
  matchMode?: KeywordMatchMode;
  /** 결과가 0건이고 frameworkVersion·category 가 데이터에 없는 값일 때: 쓸 수 있는 값 */
  available?: { frameworkVersions: string[]; categories: string[] };
  /** 조회된 소프트웨어. 내부용 필드(id, created_at)는 싣지 않는다 */
  software: CompatibilitySoftwareInfo[];
  relatedKnowledge?: Array<{ product: string; knowledge: RelatedKnowledgeItem[] }>;
}

/**
 * 호환성 소프트웨어 검색 (통합)
 * - 기본: 호환 소프트웨어 검색
 * - includeKnowledge=true: 검색 결과의 소프트웨어에 대한 개발자 경험/지식도 함께 반환
 *
 * 한 번에 limit 건(기본 20, 최대 100)을 돌려준다. 응답의 total 이 count 보다 크면
 * offset 을 늘려 다음 페이지를 조회할 수 있다.
 */
export async function searchCompatibleSoftware(args: {
  query?: string;
  frameworkVersion?: string;
  category?: string;
  minLevel?: 1 | 2;
  vendor?: string;
  productName?: string;
  limit?: number;
  offset?: number;
  includeKnowledge?: boolean;
}): Promise<CompatibilitySearchResponse> {
  const manager = await getInitializedHybridManager();
  const sqlite = manager.getSQLite();
  const limit = normalizeLimit(args.limit);
  const offset = normalizeOffset(args.offset);

  // 실제로 적용하는 필터. 응답의 filters 로 그대로 되돌려준다.
  const filters = normalizeFilters(args);

  // 키워드와 필터를 한 번의 조회로 처리한다 (필터는 SQL 에서 LIMIT 보다 먼저 적용된다).
  // matchMode 는 키워드 검색이 결과를 찾은 방식이다 (all-terms: 모든 검색어 일치, any-term: 일부만 일치).
  const { rows: results, total, matchMode } = sqlite.queryCompatibleSoftware({
    query: args.query?.trim(),
    filters,
    limit,
    offset,
  });

  // 결과가 없고 frameworkVersion·category 가 데이터에 없는 값이면, 쓸 수 있는 값을 알려 준다.
  const available = total === 0 ? findAvailableValues(sqlite, filters) : undefined;

  const response: CompatibilitySearchResponse = {
    success: true,
    total,
    count: results.length,
    limit,
    offset,
    filters,
    ...(matchMode ? { matchMode } : {}),
    ...(available ? { available } : {}),
    software: results,
  };

  // includeKnowledge=true: 검색된 소프트웨어에 대한 개발자 경험 포함
  if (args.includeKnowledge && results.length > 0) {
    const productNames = [...new Set(results.map((software) => software.product_name))].slice(0, 5);
    const knowledgeResults: Array<{ product: string; knowledge: RelatedKnowledgeItem[] }> = [];

    for (const productName of productNames) {
      const knowledge = await manager.findKnowledgeForSoftware(productName);
      if (knowledge.length > 0) {
        knowledgeResults.push({
          product: productName,
          knowledge: knowledge.map((k) => ({
            title: k.title,
            type: k.type,
            importance: k.importance,
            tags: k.tags,
          })),
        });
      }
    }

    response.relatedKnowledge = knowledgeResults;
  }

  return response;
}
