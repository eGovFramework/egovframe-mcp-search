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
  level?: 1 | 2;  // 호환성 레벨이 이 값과 같은 행
  minLevel?: 1 | 2;  // 호환성 레벨이 이 값 이상인 행 (level 과 함께 주면 둘 다 적용한다)
  vendor?: string;  // 업체명의 부분 문자열 (법인 표기와 공백의 차이는 가리지 않는다)
  productName?: string;  // 제품명 또는 제품 버전 표기의 부분 문자열
}

/**
 * 키워드 검색이 결과를 찾은 방식. 검색어가 행과 일치한다는 것은 검색어가 검색 대상 컬럼 가운데 하나에
 * 부분 문자열로 들어 있다는 뜻이다. 호환 소프트웨어의 프레임워크 버전과 확인일자는 부분 문자열로 견주지 않는다:
 * 프레임워크 버전은 검색어와 같을 때('v4.3', '4.3.0' 은 '4.3' 으로 읽는다), 확인일자는 YYYY·YYYY-MM·YYYY-MM-DD
 * 꼴의 검색어로 시작할 때 일치한다.
 * - all-terms: 모든 검색어가 일치하는 행을 찾았다
 * - any-term: 모든 검색어가 일치하는 행이 없어 대체 검색으로 찾았다. 일치하는 행이 있는 검색어만 남기고
 *   (조사가 붙은 검색어는 조사를 떼어 보고, 그래도 없으면 '.', '-', '_' 에서 나눈 조각을 견준다),
 *   그 절반 이상이 일치하는 행을 돌려준다. 그런 행이 없으면
 *   일치 기준을 1씩 낮춰 행이 나올 때까지 찾는다. 남은 검색어가 하나도 없을 때만 0건이다.
 *   남은 검색어 가운데 대상 행(필터를 적용한 뒤)의 절반 이하와 일치하는 검색어가 있으면, 그런 검색어가 하나
 *   이상 일치한 행만 돌려준다. 대상 행의 절반 넘게 일치하는 흔한 검색어만 일치한 행은 돌려주지 않는다.
 *   query 에 단독 낱말 OR 가 있을 때도 any-term 이다 (KeywordTermUsage.orQuery). 이때는 모든 검색어가 일치하는
 *   행을 먼저 찾지 않고, 남은 검색어 가운데 하나 이상이 일치하는 행을 모두 돌려준다 (흔한 검색어만 일치한 행도 돌려준다)
 *
 * 어느 방식이든 일치한 검색어가 많은 행, 낱말의 처음에서 일치한 영문 검색어가 많은 행, 이름에 일치한 검색어가 많은 행
 * 순으로 돌려준다. 낱말의 처음은 값의 맨 앞이거나 바로 앞 글자가 ASCII 영문자가 아닌 자리다 ('ECM' 은 'TimeCMS' 보다
 * 'ECM Solution' 이 먼저다). ASCII 영문자와 숫자로만 되어 있고 영문자가 든 검색어만 세고, 한글이나 기호가 든 검색어와
 * 숫자뿐인 검색어는 세지 않는다
 */
export type KeywordMatchMode = 'all-terms' | 'any-term';

/**
 * 키워드 검색이 query 에서 추출한 검색어를 어떻게 썼는지.
 * 검색어로 추출하지 않는 접속사(AND, OR 등)는 어느 쪽에도 들어가지 않는다.
 */
export interface KeywordTermUsage {
  /**
   * 실제로 검색에 쓴 검색어. 조사를 떼어 쓴 검색어는 뗀 꼴이고 ('JEUS는' → 'JEUS'), 저장된 표기와 달라
   * '.', '-', '_' 에서 나눠 쓴 검색어는 조각이다 ('K2Web-Wizard' → 'K2Web', 'Wizard')
   */
  used: string[];
  /**
   * 일치하는 행이 없어 쓰지 않은 검색어 (query 에 적힌 꼴 그대로). 조사를 뗀 꼴도, 기호에서 나눈 조각도
   * 일치하는 행이 없는 검색어다
   */
  ignored: string[];
  /**
   * 일치하는 행이 있는지와 관계없이 검색에서 뺀 검색어 (query 에 적힌 꼴 그대로, 적힌 순서대로).
   * - 행을 가려 주지 못하는 낱말: 영어 기능어(is, with, the 등)와, 검색 대상의 모든 항목에 해당하는 낱말
   *   (eGovFrame, 전자정부, 표준프레임워크 등. 공통컴포넌트에서는 컴포넌트, component 등도 든다).
   *   다른 검색어가 남을 때만 뺀다
   * - 한 글자 검색어: 모든 검색어가 일치하는 행을 찾을 때는 쓰고, 그렇게 해서 찾은 행이 없고 두 글자 이상인
   *   검색어가 함께 있을 때만 뺀다
   *
   * 뺀 것이 없으면 빈 배열이다
   */
  dropped: string[];
  /**
   * 결과의 행마다 일치한 검색어(used)의 최소 수. all-terms 는 used 의 길이이고, any-term 은 실제로 적용한
   * 일치 기준이다 (used 의 절반을 올림한 수에서 시작해, 행이 없으면 1 까지 낮춘다. query 에 OR 가 있으면
   * 처음부터 1 이다). used 가 비면 0 이다
   */
  required: number;
  /**
   * query 에 단독 낱말 OR(대소문자 무관)가 있어, 모든 검색어가 일치하는 행을 먼저 찾지 않고 검색어 가운데 하나
   * 이상이 일치하는 행을 찾았을 때만 true 로 싣는다 (matchMode 는 any-term). 이 표시가 없는 any-term 결과는
   * 모든 검색어가 일치하는 행이 없어 대체 검색으로 넘어간 것이다. AND, NOT, NEAR 는 검색어에서 빠질 뿐이다
   */
  orQuery?: true;
}

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
  terms?: KeywordTermUsage;  // 키워드 검색을 수행했을 때만 채워진다
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
  terms?: KeywordTermUsage;  // 키워드 검색을 수행했을 때만 채워진다
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

