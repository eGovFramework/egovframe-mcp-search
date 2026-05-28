/**
 * Compatibility Tools
 * 호환성 소프트웨어 관리 도구
 */

import { getInitializedHybridManager } from '../database/hybridManager.js';
import { CompatibilitySearchFilter } from '../types/database.js';

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

  const filters: CompatibilitySearchFilter = {
    frameworkVersion: args.frameworkVersion,
    category: args.category,
    minLevel: args.minLevel,
    vendor: args.vendor,
    productName: args.productName,
  };

  const query = args.query?.trim();
  const hasFilters = Object.values(filters).some((value) => value !== undefined);
  let results = sqlite.searchCompatibleSoftware(filters, limit);

  if (query) {
    const searchLimit = hasFilters ? limit * 5 : limit;
    results = sqlite.fullTextSearchCompatibility(query, searchLimit)
      .filter((software) => {
        if (filters.frameworkVersion && software.framework_version !== filters.frameworkVersion) return false;
        if (filters.category && software.category !== filters.category) return false;
        if (filters.minLevel && software.compatibility_level < filters.minLevel) return false;
        if (filters.vendor && !software.vendor.includes(filters.vendor)) return false;
        if (filters.productName && !software.product_name.includes(filters.productName)) return false;
        return true;
      })
      .slice(0, limit);
  }

  const response: any = {
    success: true,
    count: results.length,
    filters,
    software: results,
  };

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

