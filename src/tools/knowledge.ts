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
import { excerptKnowledgeContent } from '../utils/knowledgeExcerpt.js';
import { presentTitle } from '../utils/knowledgePresentation.js';
import { sliceHead } from '../utils/text.js';
import { maskResidentNumbers } from '../utils/sensitiveText.js';

/**
 * 응답에 싣는 본문을 만든다: 주민등록번호 형식의 값을 가린 뒤(공개 게시판의 글이라 본문에 들어 있을 수 있다)
 * excerptLength 가 있으면 그 길이로 발췌한다. 발췌를 먼저 하면 번호가 중간에서 끊겨 일부가 남는다.
 */
function presentContent(content: string, excerptLength?: number): string {
  const masked = maskResidentNumbers(content);
  return excerptLength === undefined ? masked : excerptKnowledgeContent(masked, excerptLength);
}

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

/** 응답에 되돌려 주는 query 의 최대 길이 */
const MAX_ECHOED_QUERY_LENGTH = 200;

/**
 * 응답에 싣는 query 표기를 만든다. 200자를 넘으면 앞 200자만 싣고 끝에 '…' 를 붙인다.
 *
 * 질의를 통째로 되돌려 주면 응답이 질의만큼 커진다 (22만 자 질의에 22만 자가 넘는 응답).
 * 검색에는 원래 query 를 쓰고, 이 표기는 응답에만 쓴다. 서로게이트 쌍은 가운데에서 자르지 않는다.
 */
function echoQuery(query: string): string {
  return query.length > MAX_ECHOED_QUERY_LENGTH ? `${sliceHead(query, MAX_ECHOED_QUERY_LENGTH)}…` : query;
}

/**
 * 호환 제품의 표기를 만든다.
 *
 * 호환성 목록의 product_version 은 대부분 제품명을 이미 담고 있다 (예: 제품명 "JEUS",
 * 버전 "JEUS 21"). 둘을 그대로 이으면 "JEUS JEUS 21" 이 되므로, 버전 표기가 제품명으로
 * 시작하면 버전 표기만 쓴다.
 */
export function formatProductLabel(productName: string, productVersion?: string | null): string {
  const name = (productName ?? '').trim();
  const version = (productVersion ?? '').trim();
  if (!version) {
    return name;
  }
  return version.startsWith(name) ? version : `${name} ${version}`;
}

/** 통합 검색(scope="all")의 지식 미리보기 길이 — excerptLength 를 주지 않았을 때 */
const DEFAULT_PREVIEW_LENGTH = 200;

/**
 * excerptLength 인자를 정리한다. 1 이상의 유한한 수만 받고, 그 밖에는 지정하지 않은 것으로 본다.
 */
function normalizeExcerptLength(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? Math.floor(value) : undefined;
}

/**
 * 지식 검색 (통합)
 * - query + scope="knowledge" → 시맨틱 검색 (기본)
 * - sort="recent" → 최근 추가 순 조회 (질의를 쓰지 않으므로 query 없이 호출할 수 있다).
 *   type·tags·minImportance·verifiedOnly 필터는 시맨틱 검색과 같은 뜻으로 적용한다
 * - query + scope="all" → 통합 검색 (지식 + 호환성). 호환 소프트웨어는 모든 검색어가 일치하는 행을 limit 건까지
 *   싣고 전체 일치 건수를 compatibilityTotal 로 알린다. totalResults 는 응답에 실은 건수의 합이다
 *
 * excerptLength 를 주면 결과의 content 를 그 길이 이내의 발췌로 바꾼다 (표지·생략 표시 포함).
 * Q&A 본문은 질문과 답변에 길이를 나눠 답변의 앞부분이 반드시 들어간다 (utils/knowledgeExcerpt).
 * 주지 않으면 시맨틱 검색은 본문 전체를, 통합 검색은 200자 미리보기를 돌려준다.
 *
 * 응답에 되돌려 주는 query 는 앞 200자까지다 (echoQuery). 검색에는 원래 query 를 쓴다.
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
  excerptLength?: number;
}) {
  // 최근 목록 말고는 질의가 있어야 한다 — 저장소와 임베딩 모델을 불러오기 전에 확인한다
  const query = args.sort === 'recent' ? '' : requireQuery(args.query);
  const excerptLength = normalizeExcerptLength(args.excerptLength);

  const manager = await getInitializedHybridManager();
  const knowledge = manager.getKnowledge();

  // sort="recent" → 최근 지식 목록 (list_recent_knowledge 기능). 필터는 시맨틱 검색과 같은 조건을 건다
  if (args.sort === 'recent') {
    const results = await knowledge.listRecentKnowledge(args.limit || 10, {
      type: args.type,
      tags: args.tags,
      minImportance: args.minImportance,
      verifiedOnly: args.verifiedOnly,
    });
    return {
      success: true,
      sort: 'recent',
      count: results.length,
      results: results.map((r: any) => ({
        id: r.id,
        type: r.type,
        title: presentTitle(r.title),
        tags: r.tags,
        importance: r.importance,
        createdAt: r.createdAt,
      })),
    };
  }

  // scope="all" → 통합 검색 (smart_search 기능)
  if (args.scope === 'all') {
    // 지식 쪽에는 시맨틱 검색과 같은 필터를 건다 (호환 소프트웨어 쪽은 query 만 쓴다)
    const results = await manager.smartSearch({
      query,
      includeCompatibility: true,
      includeKnowledge: true,
      knowledgeOptions: {
        type: args.type,
        tags: args.tags,
        minImportance: args.minImportance,
        verifiedOnly: args.verifiedOnly,
      },
      limit: args.limit || 5,
    });

    return {
      success: true,
      scope: 'all',
      query: echoQuery(query),
      // 이 응답에 실은 건수의 합이다 (compatibility 와 knowledge 의 길이). 조건에 맞는 전체 건수가 아니다
      totalResults: results.totalResults,
      // 호환 소프트웨어는 limit 건까지만 싣는다. 모든 검색어가 일치하는 전체 건수를 함께 알린다
      compatibilityTotal: results.compatibilityTotal,
      compatibility: results.compatibility.map((s: any) => ({
        product: formatProductLabel(s.product_name, s.product_version),
        framework: s.framework_version,
        category: s.category,
        level: s.compatibility_level,
        vendor: s.vendor,
        description: s.description,
      })),
      knowledge: results.knowledge.map((k: any) => ({
        title: presentTitle(k.title),
        type: k.type,
        content: presentContent(k.content, excerptLength ?? DEFAULT_PREVIEW_LENGTH),
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
    query: echoQuery(query),
    options,
    resultCount: results.length,
    // createdAt 은 넣지 않는다: 모든 행이 색인한 시각이라 글이 쓰인 날짜로 오해된다
    // (최근 목록에서는 정렬 기준이므로 유지한다)
    results: results.map(r => ({
      id: r.id,
      type: r.type,
      title: presentTitle(r.title),
      content: presentContent(r.content, excerptLength),
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
    query: echoQuery(args.query),
    // 이 응답에 실은 건수의 합이다. 호환 소프트웨어의 전체 일치 건수는 compatibilityTotal 이다
    totalResults: results.totalResults,
    compatibilityTotal: results.compatibilityTotal,
    compatibility: results.compatibility.map(s => ({
      product: formatProductLabel(s.product_name, s.product_version),
      framework: s.framework_version,
      category: s.category,
      level: s.compatibility_level,
      vendor: s.vendor,
      description: s.description,
    })),
    knowledge: results.knowledge.map(k => ({
      title: presentTitle(k.title),
      type: k.type,
      content: presentContent(k.content, DEFAULT_PREVIEW_LENGTH),
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


