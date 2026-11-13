/**
 * LanceDB Knowledge Base Types
 * 비정형 개발자 지식 구조 정의
 */

// 개발자 지식 타입 값 목록 (type 필터 검증과 안내 문구가 이 배열 하나를 함께 쓴다)
export const KNOWLEDGE_TYPES = [
  'solution',       // 해결책
  'tip',            // 팁/힌트
  'pattern',        // 디자인 패턴
  'error-fix',      // 오류 수정
  'best-practice',  // 모범 사례
  'gotcha',         // 주의사항/함정
] as const;

// 개발자 지식 타입
export type KnowledgeType = (typeof KNOWLEDGE_TYPES)[number];

/** 값이 개발자 지식 타입 여섯 가지 가운데 하나인지. */
export function isKnowledgeType(value: unknown): value is KnowledgeType {
  return (KNOWLEDGE_TYPES as readonly unknown[]).includes(value);
}

/**
 * 색인 코드가 개발자 지식에 붙이는 태그 (모두 소문자).
 * Q&A·FAQ 행은 kb/snapshot 의 snapshotRowToKnowledgeInput 이, 적용가이드 PDF 청크는 scripts/buildIndex 의
 * readPdfKnowledge 가 붙인다. 없는 태그를 준 호출에 쓸 수 있는 값을 안내할 때 쓴다.
 */
export const INDEXED_KNOWLEDGE_TAGS = ['egovframe', 'developer_knowledge', 'qa', 'faq', 'guide', 'pdf'] as const;

/** 색인 코드가 만드는 개발자 지식의 type (Q&A·FAQ 는 solution, 적용가이드 PDF 는 best-practice). */
export const INDEXED_KNOWLEDGE_TYPES = ['solution', 'best-practice'] as const satisfies readonly KnowledgeType[];

// 개발자 지식 문서
export interface DeveloperKnowledge {
  id: string;
  type: KnowledgeType;
  title: string;
  content: string;
  context?: string;  // 어떤 상황에서 발생했는지
  tags: string[];
  relatedTo?: string[];  // 관련 표준프레임워크 기능 (예: ['mybatis', 'transaction'])
  importance: 1 | 2 | 3 | 4 | 5;  // 중요도 (5가 가장 중요)
  verified: boolean;  // 검증된 지식인지
  createdAt: string;  // ISO 8601 timestamp
  updatedAt: string;  // ISO 8601 timestamp
  metadata: {
    author?: string;
    version?: string;  // 표준프레임워크 버전
    environment?: string;  // 개발 환경 (예: 'Windows 11', 'macOS', 'Ubuntu')
    category?: string;  // 호환성 카테고리와 연결
    [key: string]: any;
  };
  vector: number[];  // 384차원 임베딩 벡터
}

// 지식 검색 결과
export interface KnowledgeSearchResult {
  id: string;
  type: KnowledgeType;
  title: string;
  content: string;
  context?: string;
  tags: string[];
  importance: number;
  score: number;  // 코사인 거리 (낮을수록 유사, 1 - score 가 코사인 유사도)
  createdAt: string;
  metadata: Record<string, any>;
}

// 지식 필터 조건 (의미 검색과 최근 목록이 같은 조건을 쓴다)
export interface KnowledgeFilterOptions {
  type?: KnowledgeType;
  tags?: string[];  // 하나라도 가진 행 (값은 대소문자까지 일치)
  minImportance?: 1 | 2 | 3 | 4 | 5;
  verifiedOnly?: boolean;
}

// 지식 검색 옵션
export interface KnowledgeSearchOptions extends KnowledgeFilterOptions {
  limit?: number;
}

// 지식 통계
export interface KnowledgeStats {
  total: number;
  byType: Record<KnowledgeType, number>;
  byImportance: Record<number, number>;
  verified: number;
  unverified: number;
  topTags: Array<{ tag: string; count: number }>;
}

// 지식 추가 입력
export interface AddKnowledgeInput {
  type: KnowledgeType;
  title: string;
  content: string;
  context?: string;
  tags?: string[];
  relatedTo?: string[];
  importance?: 1 | 2 | 3 | 4 | 5;
  verified?: boolean;
  metadata?: Record<string, any>;
}

// 지식 업데이트 입력
export interface UpdateKnowledgeInput {
  id: string;
  title?: string;
  content?: string;
  context?: string;
  tags?: string[];
  relatedTo?: string[];
  importance?: 1 | 2 | 3 | 4 | 5;
  verified?: boolean;
  metadata?: Record<string, any>;
}

// 최근 지식 항목 (간략 정보)
export interface RecentKnowledge {
  id: string;
  type: KnowledgeType;
  title: string;
  tags: string[];
  importance: number;
  verified: boolean;
  createdAt: string;
}


