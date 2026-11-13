/**
 * Knowledge Management Tools
 * 개발자 지식 관리 도구
 */

import { getInitializedHybridManager } from '../database/hybridManager.js';
import {
  KnowledgeSearchOptions,
  KnowledgeType,
} from '../types/knowledge.js';
import { UserFacingError } from '../utils/errors.js';

/**
 * 검색 결과의 score(코사인 거리)를 코사인 유사도로 바꾼다.
 * 소수 셋째 자리로 반올림한 숫자를 돌려준다 (문자열이 아니다).
 */
function toSimilarity(score: number): number {
  return Math.round((1 - score) * 1000) / 1000;
}

/**
 * 검색에 쓸 질의를 확인한다. 없거나 공백뿐이면 호출자가 고칠 수 있게 알린다.
 */
function requireQuery(query: string | undefined): string {
  if (typeof query !== 'string' || query.trim() === '') {
    throw new UserFacingError('query is required for knowledge search');
  }
  return query;
}

/**
 * 지식 검색 (통합)
 * - query + scope="knowledge" → 시맨틱 검색 (기본)
 * - sort="recent" → 최근 추가 순 조회 (질의를 쓰지 않으므로 query 없이 호출할 수 있다)
 * - query + scope="all" → 통합 검색 (지식 + 호환성)
 *
 * See: docs/TODO_TOOL_OPTIMIZATION.md Phase 3-C
 */
export async function searchKnowledge(args: {
  query?: string;
  scope?: 'knowledge' | 'all';
  sort?: 'relevance' | 'recent';
  limit?: number;
  type?: KnowledgeType;
  tags?: string[];
  minImportance?: 1 | 2 | 3 | 4 | 5;
  verifiedOnly?: boolean;
}) {
  // 최근 목록 말고는 질의가 있어야 한다 — 저장소와 임베딩 모델을 불러오기 전에 확인한다
  const query = args.sort === 'recent' ? '' : requireQuery(args.query);

  const manager = await getInitializedHybridManager();
  const knowledge = manager.getKnowledge();

  // sort="recent" → 최근 지식 목록 (list_recent_knowledge 기능)
  if (args.sort === 'recent') {
    const results = await knowledge.listRecentKnowledge(args.limit || 10, args.type);
    return {
      success: true,
      sort: 'recent',
      count: results.length,
      results: results.map((r: any) => ({
        id: r.id,
        type: r.type,
        title: r.title,
        content: r.content,
        tags: r.tags,
        importance: r.importance,
        createdAt: r.createdAt,
      })),
    };
  }

  // scope="all" → 통합 검색 (smart_search 기능)
  if (args.scope === 'all') {
    const results = await manager.smartSearch({
      query,
      includeCompatibility: true,
      includeKnowledge: true,
      limit: args.limit || 5,
    });

    return {
      success: true,
      scope: 'all',
      query,
      totalResults: results.totalResults,
      compatibility: results.compatibility.map((s: any) => ({
        product: `${s.product_name} ${s.product_version}`,
        framework: s.framework_version,
        category: s.category,
        level: s.compatibility_level,
        vendor: s.vendor,
        description: s.description,
      })),
      knowledge: results.knowledge.map((k: any) => ({
        title: k.title,
        type: k.type,
        content: k.content.substring(0, 200) + (k.content.length > 200 ? '...' : ''),
        tags: k.tags,
        importance: k.importance,
      })),
    };
  }

  // 기본: 시맨틱 검색
  const options: KnowledgeSearchOptions = {
    limit: args.limit,
    type: args.type,
    tags: args.tags,
    minImportance: args.minImportance,
    verifiedOnly: args.verifiedOnly,
  };

  const results = await knowledge.searchKnowledge(query, options);

  return {
    success: true,
    query,
    options,
    resultCount: results.length,
    // createdAt 은 넣지 않는다: 모든 행이 색인한 시각이라 글이 쓰인 날짜로 오해된다
    // (최근 목록에서는 정렬 기준이므로 유지한다)
    results: results.map(r => ({
      id: r.id,
      type: r.type,
      title: r.title,
      content: r.content,
      context: r.context,
      tags: r.tags,
      importance: r.importance,
      similarity: toSimilarity(r.score),
    })),
  };
}

/**
 * 최근 지식 목록
 */
export async function listRecentKnowledge(args: {
  limit?: number;
  type?: KnowledgeType;
}) {
  const manager = await getInitializedHybridManager();
  const knowledge = manager.getKnowledge();

  const results = await knowledge.listRecentKnowledge(args.limit || 10, args.type);

  return {
    success: true,
    count: results.length,
    knowledge: results,
  };
}

/**
 * 지식 조회
 */
export async function getKnowledge(args: { id: string }) {
  const manager = await getInitializedHybridManager();
  const knowledge = manager.getKnowledge();

  const result = await knowledge.getKnowledgeById(args.id);

  if (!result) {
    return {
      success: false,
      message: `지식 ID ${args.id}를 찾을 수 없습니다.`,
    };
  }

  return {
    success: true,
    knowledge: {
      ...result,
      vector: undefined,  // 벡터는 제외
    },
  };
}

/**
 * 스마트 검색 (통합 검색)
 */
export async function smartSearch(args: {
  query: string;
  includeCompatibility?: boolean;
  includeKnowledge?: boolean;
  limit?: number;
}) {
  const manager = await getInitializedHybridManager();

  const results = await manager.smartSearch({
    query: args.query,
    includeCompatibility: args.includeCompatibility !== false,
    includeKnowledge: args.includeKnowledge !== false,
    limit: args.limit || 5,
  });

  return {
    success: true,
    query: args.query,
    totalResults: results.totalResults,
    compatibility: results.compatibility.map(s => ({
      product: `${s.product_name} ${s.product_version}`,
      framework: s.framework_version,
      category: s.category,
      level: s.compatibility_level,
      vendor: s.vendor,
      description: s.description,
    })),
    knowledge: results.knowledge.map(k => ({
      title: k.title,
      type: k.type,
      content: k.content.substring(0, 200) + (k.content.length > 200 ? '...' : ''),
      tags: k.tags,
      importance: k.importance,
      similarity: toSimilarity(k.score),
    })),
  };
}

/**
 * 전체 통계
 */
export async function getOverallStats() {
  const manager = await getInitializedHybridManager();
  const stats = await manager.getOverallStats();

  return {
    success: true,
    stats,
  };
}


