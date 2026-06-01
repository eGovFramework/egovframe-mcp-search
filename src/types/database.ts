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
  korean_name: string;             // 공통표준용어명
  english_name: string;            // 공통표준용어영문약어명
  description?: string;            // 공통표준용어설명
  domain_name?: string;            // 공통표준도메인명
  allowed_values?: string;         // 허용값
  storage_format?: string;         // 저장 형식
  display_format?: string;         // 표현 형식
  standard_code_name?: string;     // 행정표준코드명
  authority?: string;              // 소관기관명
  synonyms?: string;               // 용어 이음동의어 목록 (LLM DDL 보조의 핵심 신호)
  revision_round?: string;         // 제정차수 (예: "8차(2025-11)")
  revision_type?: string;          // 개정구분명 (폐기/변경)
  revision_item?: string;          // 개정항목
  revision_reason?: string;        // 개정사유
}

// 표준 단어
export interface StandardWord {
  id?: number;
  korean_name: string;            // 공통표준단어명
  english_name: string;           // 공통표준단어영문약어명
  english_full_name?: string;     // 공통표준단어 영문명
  description?: string;           // 공통표준단어 설명
  is_format_word?: boolean;       // 형식단어여부
  domain_category?: string;       // 공통표준도메인분류명
  synonyms?: string;              // 이음동의어 목록
  forbidden_words?: string;       // 금칙어 목록
  revision_round?: string;        // 제정차수
  revision_type?: string;         // 개정구분명
  revision_item?: string;         // 개정항목
  revision_reason?: string;       // 개정사유
}

// 표준 도메인
export interface StandardDomain {
  id?: number;
  domain_name: string;            // 공통표준도메인명
  domain_group?: string;          // 공통표준도메인그룹명
  domain_category?: string;       // 공통표준도메인분류명
  description?: string;           // 공통표준도메인설명
  data_type: string;              // 데이터타입
  data_length?: string;           // 데이터길이
  decimal_length?: string;        // 데이터소수점길이
  storage_format?: string;        // 저장형식
  display_format?: string;        // 표현형식
  unit?: string;                  // 단위
  allowed_values?: string;        // 허용값
  standard_code_name?: string;    // (구) 행정표준 코드명 — 8차 CSV에는 없음, 레거시 호환용 보존
  revision_round?: string;        // 제정차수
  revision_type?: string;         // 개정구분명
  revision_item?: string;         // 개정항목
  revision_reason?: string;       // 개정사유
}

// ==================== 기관 Custom 사전 ====================
//
// 행정안전부 공통표준용어를 기관별로 확장한 사전. 단일 기관 deployment 기준.
// 스키마는 standard_* 와 동일하게 미러링 (직렬화/검증 코드 재사용).
// 충돌 시 우선순위: custom > standard (transparent — 표준 동등 항목이 있으면 응답에 함께 노출).

// 기관 Custom 용어
export interface CustomTerm {
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
  synonyms?: string;
  revision_round?: string;
  revision_type?: string;
  revision_item?: string;
  revision_reason?: string;
}

// 기관 Custom 단어
export interface CustomWord {
  id?: number;
  korean_name: string;
  english_name: string;
  english_full_name?: string;
  description?: string;
  is_format_word?: boolean;
  domain_category?: string;
  synonyms?: string;
  forbidden_words?: string;
  revision_round?: string;
  revision_type?: string;
  revision_item?: string;
  revision_reason?: string;
}

// 기관 Custom 도메인
export interface CustomDomain {
  id?: number;
  domain_name: string;
  domain_group?: string;
  domain_category?: string;
  description?: string;
  data_type: string;
  data_length?: string;
  decimal_length?: string;
  storage_format?: string;
  display_format?: string;
  unit?: string;
  allowed_values?: string;
  standard_code_name?: string;
  revision_round?: string;
  revision_type?: string;
  revision_item?: string;
  revision_reason?: string;
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

