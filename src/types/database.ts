/**
 * SQLite Database Types
 * 정형 데이터 구조 정의 (호환성 정보, 표준 용어 등)
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

// 표준 용어
export interface StandardTerm {
  id?: number;
  korean_name: string;
  english_name: string;
  description?: string;
  domain_name?: string;
  allowed_values?: string;
  storage_format?: string;
  display_format?: string;
  standard_code_name?: string;
  authority?: string;
}

// 표준 단어
export interface StandardWord {
  id?: number;
  korean_name: string;            // 공통표준 단어명
  english_name: string;           // 공통표준단어 영문약어명
  english_full_name?: string;     // 공통표준단어 영문명
  description?: string;           // 공통표준단어 설명
  is_format_word?: boolean;       // 형식단어 여부
  domain_category?: string;       // 공통표준도메인 분류명
  synonyms?: string;              // 이음동의어 목록
  forbidden_words?: string;       // 금칙어 목록
}

// 표준 도메인
export interface StandardDomain {
  id?: number;
  domain_name: string;            // 공통표준도메인명
  domain_group?: string;          // 공통표준도메인 그룹명
  domain_category?: string;       // 공통표준도메인 분류명
  description?: string;           // 공통표준도메인 설명
  data_type: string;              // 데이터 타입
  data_length?: string;           // 데이터 길이
  decimal_length?: string;        // 소수점길이
  storage_format?: string;        // 저장형식
  display_format?: string;        // 표현형식
  unit?: string;                  // 단위
  allowed_values?: string;        // 허용값
  standard_code_name?: string;    // 행정표준 코드명
}

// 호환성 소프트웨어 검색 필터
export interface CompatibilitySearchFilter {
  frameworkVersion?: string;
  category?: string;
  minLevel?: 1 | 2;
  vendor?: string;
  productName?: string;
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

