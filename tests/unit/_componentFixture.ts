/**
 * 공통컴포넌트 조회 테스트가 함께 쓰는 고정 데이터.
 *
 * 여러 테스트가 행 수와 낱말 분포에 기대므로 값을 바꿀 때는 아래 성질을 지켜야 한다.
 * - 컴포넌트는 8행, 카테고리는 5개.
 * - "기능"·"제공함" 은 7행의 설명에, "egovframework" 는 8행 모두의 패키지명에 들어 있다 (변별력 없는 낱말).
 * - "증서" 는 '인증서로그인'·'공인인증서로' 의 가운데에만 있다 (낱말의 앞에서부터 견주면 찾을 수 없다).
 * - 카테고리 '역할/권한관리' 는 ID('역할-권한관리')와 이름이 다르다.
 * - 영문명 'Authority Management' 는 두 컴포넌트(ram, drm)가 함께 쓴다.
 * - cmm 의 설명에는 줄바꿈과 '|' 가 들어 있다.
 * - 적재 순서(uia, sec, bbs, tpl, ram, drm, bst, cmm)는 목록의 정렬(카테고리 이름 → 컴포넌트 이름)과 다르다.
 *   카테고리 이름 순은 게시판 < 공통 < 로그인 < 역할/권한관리 < 통계 이고, 로그인 안에서는 이름 순
 *   ('인증서로그인' < '일반로그인')이 적재 순서(uia, sec)와 반대다.
 */
import type { SQLiteManager } from "../../src/database/sqliteManager.js";

export const CATEGORIES = [
  { category_id: "로그인", name: "로그인", name_en: "Login", description: undefined, description_en: undefined },
  { category_id: "게시판", name: "게시판", name_en: "BBS", description: undefined, description_en: undefined },
  {
    category_id: "역할-권한관리",
    name: "역할/권한관리",
    name_en: "Role/Authority Management",
    description: undefined,
    description_en: undefined,
  },
  { category_id: "통계", name: "통계", name_en: "Statistics", description: undefined, description_en: undefined },
  { category_id: "공통", name: "공통", name_en: "Common", description: undefined, description_en: undefined },
];

const component = (
  component_id: string,
  name: string,
  name_en: string,
  category_id: string,
  package_name: string,
  description: string,
  extra: { version?: string; has_web?: boolean } = {},
) => ({
  component_id,
  name,
  name_en,
  category_id,
  package_name,
  description,
  description_en: undefined,
  use_tables: undefined,
  version: extra.version ?? "5.1.0",
  has_web: extra.has_web ?? true,
  added_options: undefined,
});

export const COMPONENTS = [
  component("uia", "일반로그인", "General Login", "로그인", "egovframework.com.uat.uia", "아이디와 비밀번호로 로그인하는 기능을 제공함"),
  component("sec", "인증서로그인", "Certifications Login", "로그인", "egovframework.com.utl.sec", "공인인증서로 로그인하는 기능을 제공함"),
  component("bbs", "게시판", "BBS", "게시판", "egovframework.com.cop.bbs", "게시물을 등록하고 조회하는 기능을 제공함"),
  component("tpl", "게시판 템플릿", "BBS Template", "게시판", "egovframework.com.cop.tpl", "게시판의 템플릿을 관리하는 기능을 제공함"),
  component("ram", "권한관리", "Authority Management", "역할-권한관리", "egovframework.com.sec.ram", "시스템 사용자의 권한을 관리하는 기능을 제공함"),
  component("drm", "부서권한관리", "Authority Management", "역할-권한관리", "egovframework.com.sec.drm", "부서별 권한을 관리하는 기능을 제공함"),
  component("bst", "게시물통계", "Post Statistics", "통계", "egovframework.com.sts.bst", "게시물의 통계를 조회하는 기능을 제공함", {
    version: "5.0.0",
  }),
  component("cmm", "공통", "Common", "공통", "egovframework.com.cmm", "공통으로 쓰는 설정 파일\n- 이중등록방지 | 메시지", {
    version: "5.0.0",
    has_web: false,
  }),
];

/** bbs 는 컴포넌트 행이 없는 패키지(egovframework.com.missing.pkg)에도 의존한다. */
export const DEPENDENCIES = [
  { component_id: "uia", depends_on_package: "egovframework.com.cmm" },
  { component_id: "uia", depends_on_package: "egovframework.com.sec.ram" },
  { component_id: "ram", depends_on_package: "egovframework.com.cmm" },
  { component_id: "ram", depends_on_package: "egovframework.com.sec.drm" },
  { component_id: "drm", depends_on_package: "egovframework.com.cmm" },
  { component_id: "bbs", depends_on_package: "egovframework.com.cmm" },
  { component_id: "bbs", depends_on_package: "egovframework.com.cop.tpl" },
  { component_id: "bbs", depends_on_package: "egovframework.com.missing.pkg" },
  { component_id: "tpl", depends_on_package: "egovframework.com.cmm" },
];

/** 고정 데이터를 DB 에 적재한다. */
export function seedComponents(sqlite: SQLiteManager): void {
  sqlite.addComponentCategoriesBatch(CATEGORIES);
  sqlite.addCommonComponentsBatch(COMPONENTS);
  sqlite.addComponentDependenciesBatch(DEPENDENCIES);
}

/** 행을 구분하기 쉬운 값(component_id)만 뽑는다. */
export const idsOf = (rows: Array<{ component_id: string }>): string[] => rows.map((row) => row.component_id);
