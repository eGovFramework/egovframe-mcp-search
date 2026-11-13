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

