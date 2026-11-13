/**
 * SQLite Database Types
 * 정형 데이터 구조 정의 (호환성 정보, 공통컴포넌트 등)
 */

// 호환성 소프트웨어 정보
export interface CompatibilitySoftware {
  id?: number;
  product_name: string;
  product_version: string;
  framework_version: string;  // '4.3', '4.2', '4.1', '4.0', '3.10' 등
  category: string;  // 'CMS Solution', 'Portal Solution', 'Framework Solution' 등
  compatibility_level: 1 | 2;  // 1 또는 2
  vendor: string;
  verified_date: string;  // ISO 8601 date string (YYYY-MM-DD)
  description?: string;
  url?: string;
  created_at?: string;
}

// 호환성 소프트웨어 검색 필터
export interface CompatibilitySearchFilter {
  frameworkVersion?: string;
  category?: string;
  minLevel?: 1 | 2;
  vendor?: string;
  productName?: string;
}

/**
 * 키워드 검색이 결과를 찾은 방식.
 * - all-terms: 모든 검색어가 일치하는 행을 찾았다 (접두 일치 AND 검색)
 * - any-term: 그런 행이 없어, 일부 검색어만 일치하는 행을 부분 문자열로 찾았다
 */
export type KeywordMatchMode = 'all-terms' | 'any-term';

// 호환성 소프트웨어 조회 옵션
export interface CompatibilityQueryOptions {
  query?: string;  // 키워드 질의
  limit?: number;  // 최대 행 수 (생략하면 제한 없음)
}

// 호환성 소프트웨어 조회 결과
export interface CompatibilityQueryResult {
  rows: CompatibilitySoftware[];
  matchMode?: KeywordMatchMode;  // 키워드 검색을 수행했을 때만 채워진다
}

// 호환성 요약 통계
export interface CompatibilitySummary {
  byVersion: Array<{ framework_version: string; count: number }>;
  byCategory: Array<{ category: string; count: number }>;
  byLevel: Array<{ compatibility_level: number; count: number }>;
  recentlyAdded: CompatibilitySoftware[];
}

// ==================== 공통컴포넌트 관련 타입 ====================

// 공통컴포넌트 카테고리
export interface ComponentCategory {
  id?: number;
  category_id: string;        // 'login', 'board' 등
  name: string;               // '로그인', '게시판' 등
  name_en: string;            // 'Login', 'BBS' 등
  description?: string;
  description_en?: string;
  component_count?: number;   // 조회 시 계산됨
}

// 공통컴포넌트
export interface CommonComponent {
  id?: number;
  component_id: string;       // 'uia', 'bbs' 등
  name: string;               // '일반로그인', '게시판' 등
  name_en?: string;
  category_id: string;        // FK to ComponentCategory
  category_name?: string;     // 조회 시 JOIN
  package_name: string;       // 'egovframework.com.uat.uia'
  description?: string;
  description_en?: string;
  use_tables?: string;        // JSON array of table names
  version: string;            // '4.3.1', '5.0.0' 등
  has_web: boolean;           // 웹 배포 여부
  added_options?: string;
}

// 공통컴포넌트 의존성
export interface ComponentDependency {
  id?: number;
  component_id: string;       // 의존하는 컴포넌트
  depends_on_package: string; // 의존 대상 패키지명
}

// 컴포넌트 검색 필터
export interface ComponentSearchFilter {
  categoryId?: string;
  keyword?: string;
  hasWeb?: boolean;
  version?: string;
}

// 컴포넌트 요약 통계
export interface ComponentSummary {
  totalCategories: number;
  totalComponents: number;
  byCategory: Array<{ category_id: string; name: string; count: number }>;
  byVersion: Array<{ version: string; count: number }>;
}

// 의존성 해결 결과
export interface DependencyResolution {
  requested: string[];        // 요청한 컴포넌트들
  resolved: string[];         // 의존성 포함 전체 목록
  added: string[];            // 자동 추가된 의존성들
  packages: string[];         // 패키지명 목록
}

