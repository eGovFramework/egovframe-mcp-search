/**
 * Compatibility Tools
 * 호환성 소프트웨어 관리 도구
 */

import { getInitializedHybridManager } from '../database/hybridManager.js';
import type { SQLiteManager } from '../database/sqliteManager.js';
import { CompatibilitySearchFilter } from '../types/database.js';

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

/**
 * 호환성 소프트웨어 검색 (통합)
 * - 기본: 호환 소프트웨어 검색
 * - includeKnowledge=true: 검색 결과의 소프트웨어에 대한 개발자 경험/지식도 함께 반환
 * 
 * See: docs/TODO_TOOL_OPTIMIZATION.md Phase 3-B
 */
export async function searchCompatibleSoftware(args: {
  query?: string;
  frameworkVersion?: string;
  category?: string;
  minLevel?: 1 | 2;
  vendor?: string;
  productName?: string;
  limit?: number;
  includeKnowledge?: boolean;
}) {
  const manager = await getInitializedHybridManager();
  const sqlite = manager.getSQLite();
  const limit = args.limit && Number.isFinite(args.limit) && args.limit > 0
    ? Math.floor(args.limit)
    : 20;

  // 실제로 적용하는 필터. 응답의 filters 로 그대로 되돌려준다.
  const filters = normalizeFilters(args);

  // 키워드와 필터를 한 번의 조회로 처리한다 (필터는 SQL 에서 LIMIT 보다 먼저 적용된다).
  // matchMode 는 키워드 검색이 결과를 찾은 방식이다 (all-terms: 모든 검색어 일치, any-term: 일부만 일치).
  const { rows: results, matchMode } = sqlite.queryCompatibleSoftware({
    query: args.query?.trim(),
    filters,
    limit,
  });

  const response: any = {
    success: true,
    count: results.length,
    filters,
    ...(matchMode ? { matchMode } : {}),
    software: results,
  };

  // 결과가 없고 frameworkVersion·category 가 데이터에 없는 값이면, 쓸 수 있는 값을 알려 준다.
  if (results.length === 0) {
    const available = findAvailableValues(sqlite, filters);
    if (available) {
      response.available = available;
    }
  }

  // includeKnowledge=true: 검색된 소프트웨어에 대한 개발자 경험 포함
  if (args.includeKnowledge && results.length > 0) {
    const productNames = [...new Set(results.map((s: any) => s.product_name))].slice(0, 5);
    const knowledgeResults: any[] = [];

    for (const productName of productNames) {
      const knowledge = await manager.findKnowledgeForSoftware(productName);
      if (knowledge.length > 0) {
        knowledgeResults.push({
          product: productName,
          knowledge: knowledge.map((k: any) => ({
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

