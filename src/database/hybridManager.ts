/**
 * Hybrid Database Manager
 * SQLite (정형 데이터) + LanceDB (비정형 지식)를 통합 관리
 */

import { SQLiteManager } from './sqliteManager.js';
import { DeveloperKnowledgeManager } from '../rag/knowledgeManager.js';
import { getEmbedder } from '../rag/embedder.js';
import { fileURLToPath } from 'url';
import { getKnowledgeBasePath } from '../utils/projectPath.js';
import { resolveDeveloperKnowledgeDbDir, resolveSQLiteDbPath } from '../utils/dataPaths.js';
import {
  CompatibilitySoftware,
  CompatibilitySearchFilter,
} from '../types/database.js';
import {
  AddKnowledgeInput,
  KnowledgeSearchOptions,
  KnowledgeSearchResult,
} from '../types/knowledge.js';
import path from 'path';

export interface HybridSearchOptions {
  query: string;
  includeCompatibility?: boolean;  // 호환성 소프트웨어 검색
  includeKnowledge?: boolean;      // 개발자 지식 검색
  knowledgeOptions?: KnowledgeSearchOptions;
  compatibilityFilter?: CompatibilitySearchFilter;
  limit?: number;
}

export interface HybridSearchResult {
  compatibility: CompatibilitySoftware[];
  knowledge: KnowledgeSearchResult[];
  totalResults: number;
}

export class HybridDatabaseManager {
  private sqlite: SQLiteManager;
  private knowledge: DeveloperKnowledgeManager;
  private isInitialized = false;

  constructor(basePath?: string) {
    // 현재 파일 위치를 기준으로 프로젝트 루트 찾기
    const currentFile = fileURLToPath(import.meta.url);
    const dbPath = basePath || getKnowledgeBasePath(currentFile);
    
    console.error(`📂 현재 파일: ${currentFile}`);
    console.error(`📂 Knowledge Base 경로: ${dbPath}`);
    console.error(`🔍 process.cwd(): ${process.cwd()}`);
    
    // SQLite 초기화 (동기)
    // basePath 미지정 시 SQLite 도 오버레이(compatibility 적용분) 우선
    this.sqlite = new SQLiteManager(basePath ? path.join(basePath, 'egovframe.db') : resolveSQLiteDbPath(currentFile));
    
    // LanceDB 초기화 (비동기 - initialize()에서 처리)
    // basePath 미지정 시 오버레이(사용자 update 적용분) 우선 해석
    this.knowledge = new DeveloperKnowledgeManager(
      basePath ? dbPath : resolveDeveloperKnowledgeDbDir(currentFile),
    );
  }

  /**
   * 데이터베이스 초기화
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    console.error('🚀 하이브리드 데이터베이스 초기화 중...');
    
    // LanceDB 초기화
    await this.knowledge.initialize();
    
    // 임베더 사전 로드 (첫 사용 시 지연 방지)
    const embedder = getEmbedder();
    await embedder.initialize();
    
    this.isInitialized = true;
    console.error('✅ 하이브리드 데이터베이스 초기화 완료');
  }

  /**
   * SQLite 관리자 반환
   */
  getSQLite(): SQLiteManager {
    return this.sqlite;
  }

  /**
   * 지식 관리자 반환
   */
  getKnowledge(): DeveloperKnowledgeManager {
    if (!this.isInitialized) {
      throw new Error('데이터베이스가 초기화되지 않았습니다. initialize()를 먼저 호출하세요.');
    }
    return this.knowledge;
  }

  /**
   * 하이브리드 스마트 검색
   * 정형 데이터(SQL)와 비정형 지식(벡터)을 통합 검색
   */
  async smartSearch(options: HybridSearchOptions): Promise<HybridSearchResult> {
    await this.initialize();

    const {
      query,
      includeCompatibility = true,
      includeKnowledge = true,
      knowledgeOptions = {},
      compatibilityFilter = {},
      limit = 10,
    } = options;

    const result: HybridSearchResult = {
      compatibility: [],
      knowledge: [],
      totalResults: 0,
    };

    // 병렬로 검색 실행
    const searches: Promise<void>[] = [];

    // 1. 호환성 소프트웨어 검색 (키워드 기반)
    if (includeCompatibility) {
      searches.push(
        (async () => {
          // FTS 전체 텍스트 검색
          const ftsResults = this.sqlite.fullTextSearchCompatibility(query, limit);
          
          // 필터가 있으면 추가 검색
          if (Object.keys(compatibilityFilter).length > 0) {
            const filterResults = this.sqlite.searchCompatibleSoftware(compatibilityFilter);
            
            // 중복 제거 후 병합
            const combined = [...ftsResults, ...filterResults];
            const uniqueMap = new Map<number, CompatibilitySoftware>();
            combined.forEach(item => {
              if (item.id) uniqueMap.set(item.id, item);
            });
            result.compatibility = Array.from(uniqueMap.values()).slice(0, limit);
          } else {
            result.compatibility = ftsResults;
          }
        })()
      );
    }

    // 2. 개발자 지식 검색 (의미 기반)
    if (includeKnowledge) {
      searches.push(
        (async () => {
          result.knowledge = await this.knowledge.searchKnowledge(query, {
            limit,
            ...knowledgeOptions,
          });
        })()
      );
    }

    // 모든 검색 완료 대기
    await Promise.all(searches);

    result.totalResults =
      result.compatibility.length +
      result.knowledge.length;

    return result;
  }

  /**
   * 컨텍스트 기반 추천
   * 현재 작업 컨텍스트에 맞는 호환성 정보 + 개발자 경험 추천
   */
  async getContextualRecommendations(context: {
    frameworkVersion?: string;
    category?: string;
    tags?: string[];
    query?: string;
  }): Promise<{
    compatibility: CompatibilitySoftware[];
    relatedKnowledge: KnowledgeSearchResult[];
  }> {
    await this.initialize();

    const { frameworkVersion, category, tags, query } = context;

    // 호환성 소프트웨어 검색
    const compatibility = this.sqlite.searchCompatibleSoftware({
      frameworkVersion,
      category,
    });

    // 관련 개발자 지식 검색
    let relatedKnowledge: KnowledgeSearchResult[] = [];
    
    if (query || tags) {
      const searchQuery = query || tags?.join(' ') || '';
      relatedKnowledge = await this.knowledge.searchKnowledge(searchQuery, {
        tags,
        limit: 5,
      });
    }

    return {
      compatibility: compatibility.slice(0, 10),
      relatedKnowledge,
    };
  }

  /**
   * 통합 통계
   */
  async getOverallStats() {
    await this.initialize();

    const sqliteStats = this.sqlite.getOverallStats();
    const knowledgeStats = await this.knowledge.getStats();
    const compatibilitySummary = this.sqlite.getCompatibilitySummary();

    return {
      sqlite: {
        compatibility: sqliteStats.compatibility.count,
      },
      knowledge: {
        total: knowledgeStats.total,
        byType: knowledgeStats.byType,
        verified: knowledgeStats.verified,
        topTags: knowledgeStats.topTags.slice(0, 5),
      },
      compatibility: {
        byVersion: compatibilitySummary.byVersion,
        byCategory: compatibilitySummary.byCategory.slice(0, 5),
      },
    };
  }

  /**
   * 개발자 지식과 호환성 정보 연결
   * 특정 호환성 소프트웨어에 대한 개발자 경험 지식 찾기
   */
  async findKnowledgeForSoftware(
    productName: string,
    productVersion?: string
  ): Promise<KnowledgeSearchResult[]> {
    await this.initialize();

    const query = productVersion
      ? `${productName} ${productVersion}`
      : productName;

    return await this.knowledge.searchKnowledge(query, {
      limit: 5,
    });
  }

  /**
   * 지식 추가 시 관련 호환성 정보 자동 연결
   */
  async addKnowledgeWithAutoLink(input: AddKnowledgeInput): Promise<{
    knowledgeId: string;
    relatedCompatibility: CompatibilitySoftware[];
  }> {
    await this.initialize();

    // 지식 추가
    const knowledgeId = await this.knowledge.addKnowledge(input);

    // 관련 호환성 소프트웨어 검색
    const searchText = `${input.title} ${input.content}`;
    const relatedCompatibility = this.sqlite.fullTextSearchCompatibility(searchText, 5);

    return {
      knowledgeId,
      relatedCompatibility,
    };
  }

  /**
   * 인덱스 최적화 (주기적 실행 권장)
   */
  async optimizeAll(): Promise<void> {
    await this.initialize();

    console.error('⚡ 전체 데이터베이스 최적화 시작...');

    // SQLite 최적화 — 연결 재생성 없이 수행한다.
    // (과거 close() 후 process.cwd() 기준 경로로 재오픈했는데, MCP 서버는 임의의
    //  cwd 에서 기동되므로 잘못된 DB 를 열 수 있었고, getSQLite() 로 보관된
    //  참조도 무효화되는 문제가 있었다.)
    console.error('  SQLite 최적화 중...');
    this.sqlite.optimize();

    // LanceDB 최적화
    console.error('  LanceDB 최적화 중...');
    await this.knowledge.createIndex();
    await this.knowledge.optimize();

    console.error('✅ 전체 최적화 완료');
  }

  /**
   * 데이터베이스 닫기
   */
  close(): void {
    this.sqlite.close();
    console.error('📦 하이브리드 데이터베이스 연결 종료');
  }
}

// 싱글톤 인스턴스
let hybridInstance: HybridDatabaseManager | null = null;

/**
 * 싱글톤 하이브리드 매니저 가져오기
 */
export function getHybridManager(): HybridDatabaseManager {
  if (!hybridInstance) {
    hybridInstance = new HybridDatabaseManager();
  }
  return hybridInstance;
}

/**
 * 초기화된 하이브리드 매니저 가져오기
 */
export async function getInitializedHybridManager(): Promise<HybridDatabaseManager> {
  const manager = getHybridManager();
  await manager.initialize();
  return manager;
}

