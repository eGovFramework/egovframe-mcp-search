/**
 * Hybrid Database Manager
 * SQLite (정형 데이터) + LanceDB (비정형 지식)를 통합 관리
 */

import { SQLiteManager } from './sqliteManager.js';
import { DeveloperKnowledgeManager } from '../rag/knowledgeManager.js';
import { fileURLToPath } from 'url';
import { getKnowledgeBasePath } from '../utils/projectPath.js';
import { resolveDeveloperKnowledgeDbDir, resolveSQLiteDbPath } from '../utils/dataPaths.js';
import { CompatibilitySoftware } from '../types/database.js';
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
  limit?: number;
}

export interface HybridSearchResult {
  /** 모든 검색어가 일치하는 호환성 소프트웨어 (앞에서부터 limit 건) */
  compatibility: CompatibilitySoftware[];
  /**
   * 모든 검색어가 일치하는 호환성 소프트웨어의 전체 건수 (limit 적용 전).
   * compatibility 는 limit 건까지만 담으므로, 이 값이 더 크면 뒤에 남은 행이 있다. 찾지 않았으면 0 이다
   */
  compatibilityTotal: number;
  knowledge: KnowledgeSearchResult[];
  /**
   * 이 결과에 담아 돌려준 건수의 합 (compatibility 와 knowledge 의 길이).
   * 조건에 맞는 전체 건수가 아니다: 호환성 소프트웨어의 전체 일치 건수는 compatibilityTotal 이고,
   * 지식은 가까운 순으로 limit 건을 고른 것이라 전체 건수라는 것이 없다
   */
  totalResults: number;
}

/**
 * 검색 서버가 쓰는 조회 전용 매니저.
 * SQLite 는 읽기 전용으로 열고, LanceDB 테이블이 없어도 새로 만들지 않는다.
 * (인덱스 구축과 update CLI 는 이 클래스를 거치지 않고 각 매니저를 직접 쓴다.)
 */
export class HybridDatabaseManager {
  /** SQLite 연결. getSQLite() 를 처음 부를 때 연다 */
  private sqlite: SQLiteManager | null = null;
  private readonly sqlitePath: string;
  private knowledge: DeveloperKnowledgeManager;
  private isInitialized = false;
  private initializing: Promise<void> | null = null;

  constructor(basePath?: string) {
    // 현재 파일 위치를 기준으로 프로젝트 루트 찾기
    const currentFile = fileURLToPath(import.meta.url);
    const dbPath = basePath || getKnowledgeBasePath(currentFile);
    
    console.error(`📂 현재 파일: ${currentFile}`);
    console.error(`📂 Knowledge Base 경로: ${dbPath}`);
    
    // SQLite 는 여기서 열지 않고 경로만 정해 둔다 (getSQLite 참조).
    // basePath 미지정 시 SQLite 도 오버레이(compatibility 적용분) 우선
    this.sqlitePath = basePath ? path.join(basePath, 'egovframe.db') : resolveSQLiteDbPath(currentFile);
    
    // LanceDB 초기화 (비동기 - initialize()에서 처리)
    // basePath 미지정 시 오버레이(사용자 update 적용분) 우선 해석
    this.knowledge = new DeveloperKnowledgeManager(
      basePath ? dbPath : resolveDeveloperKnowledgeDbDir(currentFile),
    );
  }

  /**
   * 개발자 지식(LanceDB) 테이블을 연다.
   *
   * - 동시에 여러 호출이 들어와도 한 번만 초기화하고, 실패하면 다음 호출에서 다시 시도한다.
   * - 임베딩 모델은 여기서 미리 불러오지 않는다. 의미 검색을 처음 실행할 때 임베더가 스스로
   *   불러오므로, 모델이 필요 없는 조회(최근 순 목록 등)는 모델 없이도 동작한다.
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }
    if (!this.initializing) {
      console.error('🚀 하이브리드 데이터베이스 초기화 중...');
      this.initializing = this.knowledge.initialize({ createIfMissing: false }).then(
        () => {
          this.isInitialized = true;
          this.initializing = null;
          console.error('✅ 하이브리드 데이터베이스 초기화 완료');
        },
        (error: unknown) => {
          this.initializing = null;
          throw error;
        },
      );
    }
    return this.initializing;
  }

  /**
   * SQLite 관리자 반환 (읽기 전용 연결).
   *
   * 처음 부를 때 연다. 개발자 지식 검색은 LanceDB 만 쓰므로, DB 파일이 없거나 네이티브 모듈을
   * 불러오지 못해도(Node 버전 불일치) 지식 검색까지 함께 막히지 않게 하기 위해서다.
   * 여는 데 실패하면 연결을 남기지 않으므로 다음 호출에서 다시 시도한다.
   */
  getSQLite(): SQLiteManager {
    if (!this.sqlite) {
      this.sqlite = new SQLiteManager(this.sqlitePath, { readonly: true });
    }
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
      limit = 10,
    } = options;

    const result: HybridSearchResult = {
      compatibility: [],
      compatibilityTotal: 0,
      knowledge: [],
      totalResults: 0,
    };

    // 병렬로 검색 실행
    const searches: Promise<void>[] = [];

    // 1. 호환성 소프트웨어 검색 (키워드 기반): 모든 검색어가 일치하는 행을 limit 건까지, 전체 건수와 함께
    if (includeCompatibility) {
      searches.push(
        (async () => {
          const { rows, total } = this.getSQLite().queryCompatibleSoftwareAllTerms(query, limit);
          result.compatibility = rows;
          result.compatibilityTotal = total;
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

    // 돌려준 건수의 합이다 (전체 일치 건수가 아니다)
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
    const compatibility = this.getSQLite().searchCompatibleSoftware({
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

    const sqliteStats = this.getSQLite().getOverallStats();
    const knowledgeStats = await this.knowledge.getStats();
    const compatibilitySummary = this.getSQLite().getCompatibilitySummary();

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
    const relatedCompatibility = this.getSQLite().fullTextSearchCompatibility(searchText, 5);

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
    this.getSQLite().optimize();

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
    // SQLite 는 연 적이 있을 때만 닫는다
    this.sqlite?.close();
    this.sqlite = null;
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
 * 열어 둔 연결(SQLite, 개발자 지식 인덱스)을 버린다. 다음 호출에서 경로를 다시 해석해 새로 연다.
 * 실행 중에 인덱스가 교체되어 읽기에 실패했을 때 쓴다.
 */
export function resetHybridManager(): void {
  if (hybridInstance) {
    try {
      hybridInstance.close();
    } catch {
      // 닫는 중의 오류는 무시한다 (어차피 버리는 연결이다)
    }
  }
  hybridInstance = null;
}

/**
 * 초기화된 하이브리드 매니저 가져오기
 */
export async function getInitializedHybridManager(): Promise<HybridDatabaseManager> {
  const manager = getHybridManager();
  await manager.initialize();
  return manager;
}

