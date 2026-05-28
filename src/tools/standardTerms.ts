/**
 * Standard Terms Tools
 * 표준 용어 조회 도구
 */

import { getInitializedHybridManager } from '../database/hybridManager.js';

/**
 * 표준 용어 검색 (통합)
 * - query 없으면 전체 목록 (페이지네이션)
 * - query + fulltext=false → 이름 기반 검색 (기본)
 * - query + fulltext=true → 전체 텍스트 검색 (FTS)
 * 
 * See: docs/TODO_TOOL_OPTIMIZATION.md Phase 3-A
 */
export async function searchStandardTerms(args: {
  query?: string;
  fulltext?: boolean;
  limit?: number;
  offset?: number;
}) {
  const manager = await getInitializedHybridManager();
  const sqlite = manager.getSQLite();

  const query = args.query || '';
  const fulltext = args.fulltext || false;
  const offset = args.offset || 0;

  // query 없으면 전체 목록 (list_standard_terms 기능)
  if (!query) {
    const limit = args.limit || 50;
    const terms = sqlite.searchStandardTerm('', limit, offset);
    const total = sqlite.getOverallStats().terms.count;

    return {
      success: true,
      total,
      offset,
      limit,
      count: terms.length,
      hasMore: offset + terms.length < total,
      terms: terms.map((t: any) => ({
        koreanName: t.korean_name,
        englishName: t.english_name,
        description: t.description || '',
        domainName: t.domain_name || '',
        allowedValues: t.allowed_values || '',
        standardCodeName: t.standard_code_name || '',
      })),
    };
  }

  const limit = args.limit || 20;

  // fulltext=true → 전체 텍스트 검색 (fulltext_search_terms 기능)
  if (fulltext) {
    const terms = sqlite.fullTextSearchTerms(query, limit);
    return {
      success: true,
      query,
      fulltext: true,
      count: terms.length,
      terms: terms.map((t: any) => ({
        koreanName: t.korean_name,
        englishName: t.english_name,
        description: t.description || '',
        domainName: t.domain_name || '',
        standardCodeName: t.standard_code_name || '',
      })),
    };
  }

  // 기본: 이름 기반 검색
  const terms = sqlite.searchStandardTerm(query, limit);
  return {
    success: true,
    query,
    count: terms.length,
    terms: terms.map((t: any) => ({
      koreanName: t.korean_name,
      englishName: t.english_name,
      description: t.description || '',
      domainName: t.domain_name || '',
      allowedValues: t.allowed_values || '',
      storageFormat: t.storage_format || '',
      displayFormat: t.display_format || '',
      standardCodeName: t.standard_code_name || '',
      authority: t.authority || '',
    })),
  };
}

/**
 * 특정 표준 용어 상세 조회
 */
export async function getStandardTerm(args: {
  koreanName: string;
}) {
  const manager = await getInitializedHybridManager();
  const sqlite = manager.getSQLite();

  const term = sqlite.getStandardTermByName(args.koreanName);

  if (!term) {
    return {
      success: false,
      message: `표준 용어 '${args.koreanName}'를 찾을 수 없습니다.`,
    };
  }

  return {
    success: true,
    term: {
      koreanName: term.korean_name,
      englishName: term.english_name,
      description: term.description || '',
      domainName: term.domain_name || '',
      allowedValues: term.allowed_values || '',
      storageFormat: term.storage_format || '',
      displayFormat: term.display_format || '',
      standardCodeName: term.standard_code_name || '',
      authority: term.authority || '',
    },
  };
}

