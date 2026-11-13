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

// 조회 결과로 내보내는 호환성 소프트웨어 행 (내부용 id, created_at 제외)
export type CompatibilitySoftwareInfo = Omit<CompatibilitySoftware, 'id' | 'created_at'>;

// 호환성 소프트웨어 검색 필터
export interface CompatibilitySearchFilter {
  frameworkVersion?: string;
  category?: string;
  minLevel?: 1 | 2;
  vendor?: string;
  productName?: string;
}

/**
 * 키워드 검색이 결과를 찾은 방식. 검색어가 행과 일치한다는 것은 검색어가 검색 대상 컬럼 가운데 하나에
 * 부분 문자열로 들어 있다는 뜻이다.
 * - all-terms: 모든 검색어가 일치하는 행을 찾았다
 * - any-term: 모든 검색어가 일치하는 행이 없어 대체 검색으로 찾았다. 일치하는 행이 있는 검색어만 남기고
 *   (조사가 붙은 검색어는 조사를 떼어 본다), 그 절반 이상이 일치하는 행을 돌려준다. 0건일 수도 있다
 */
export type KeywordMatchMode = 'all-terms' | 'any-term';

// 호환성 소프트웨어 조회 옵션
export interface CompatibilityQueryOptions {
  query?: string;  // 키워드 질의
  filters?: CompatibilitySearchFilter;  // 키워드와 함께(AND) 적용할 필터
  limit?: number;  // 최대 행 수 (생략하면 제한 없음)
  offset?: number;  // 건너뛸 행 수 (기본 0)
}

// 호환성 소프트웨어 조회 결과
export interface CompatibilityQueryResult {
  rows: CompatibilitySoftwareInfo[];  // offset 부터 limit 건
  total: number;  // 같은 조건에 맞는 전체 건수 (limit/offset 적용 전)
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

// 공통컴포넌트 조회 옵션
export interface ComponentQueryOptions {
  query?: string;  // 키워드 질의
  filters?: ComponentSearchFilter;  // 키워드와 함께(AND) 적용할 필터
  limit?: number;  // 최대 행 수 (생략하면 제한 없음)
}

// 공통컴포넌트 조회 결과
export interface ComponentQueryResult {
  rows: CommonComponent[];  // 앞에서부터 limit 건
  total: number;  // 조건에 맞는 전체 건수 (limit 적용 전)
  matchMode?: KeywordMatchMode;  // 키워드 검색을 수행했을 때만 채워진다
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
  requested: string[];        // 요청한 컴포넌트들 (해석된 컴포넌트 ID, 중복 없음)
  resolved: string[];         // 의존성 포함 전체 목록
  added: string[];            // 자동 추가된 의존성들 (요청한 컴포넌트는 들어가지 않는다)
  packages: string[];         // 패키지명 목록
  notFound: string[];         // 컴포넌트 ID 나 패키지명으로 해석하지 못한 입력
  unresolvedPackages: string[]; // 의존 대상이지만 컴포넌트 행이 없는 패키지
}

