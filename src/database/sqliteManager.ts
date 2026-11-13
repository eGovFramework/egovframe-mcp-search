/**
 * SQLite Database Manager
 * 정형 데이터 관리 (호환성 정보, 공통컴포넌트)
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getSQLiteDBPath } from '../utils/projectPath.js';
import {
  COMPATIBILITY_GENERIC_WORDS,
  COMPONENT_GENERIC_WORDS,
  codePointLength,
  dropGenericTerms,
  extractSearchTerms,
  flexibleForm,
  isEnglishFunctionWord,
  isEnglishTerm,
  listedTargetWord,
  parseKeywordQuery,
  particleStrippedForms,
  wordStartGlobPattern,
  type KeywordQuery,
} from '../utils/fts5Query.js';
import { escapeLikePattern } from '../utils/sqlLike.js';
import { UserFacingError } from '../utils/errors.js';
import { normalizeFrameworkVersion } from '../utils/frameworkVersion.js';
import { VENDOR_IGNORED_SEQUENCES, stripVendorDesignation } from '../utils/vendorName.js';
import {
  CompatibilitySoftware,
  CompatibilitySearchFilter,
  CompatibilitySummary,
  ComponentCategory,
  CommonComponent,
  ComponentDependency,
  ComponentSearchFilter,
  ComponentSummary,
  DependencyResolution,
  CompatibilityQueryOptions,
  CompatibilityQueryResult,
  CompatibilitySoftwareInfo,
  ComponentQueryOptions,
  ComponentQueryResult,
  KeywordMatchMode,
  KeywordTermUsage,
} from '../types/database.js';

export interface SQLiteManagerOptions {
  /**
   * true 면 기존 DB 를 읽기 전용으로 연다 (MCP 서버의 조회 경로).
   * 파일이 없어도 만들지 않고, 저널 모드 변경이나 테이블·트리거 생성 같은 쓰기를 하지 않는다.
   * 인덱스 구축(build-index)과 update CLI 는 기본값(false)인 쓰기 모드를 쓴다.
   */
  readonly?: boolean;
}

/** 읽기 전용 모드에서 DB 파일이 없을 때의 안내. 절대 경로는 넣지 않는다. */
const MISSING_DB_MESSAGE =
  '지식베이스 DB(knowledge-base/egovframe.db)를 찾을 수 없습니다. 설치한 패키지에 knowledge-base 디렉토리가 ' +
  '포함되어 있는지 확인하세요. 저장소를 클론해 쓰는 경우에는 npm run build-index 로 인덱스를 구축할 수 있습니다.';

export class SQLiteManager {
  private db: Database.Database;
  private dbPath: string;

  constructor(dbPath?: string, options: SQLiteManagerOptions = {}) {
    // 프로젝트 루트 기준의 절대 경로 사용
    // 현재 파일 위치를 기준으로 프로젝트 루트 찾기
    const currentFile = fileURLToPath(import.meta.url);
    this.dbPath = dbPath || getSQLiteDBPath(currentFile);

    if (options.readonly) {
      // 조회 전용: 파일을 만들지 않고, WAL 전환과 테이블·트리거 생성을 하지 않는다.
      // (쓰기 모드로 열면 조회만 해도 배포된 DB 파일이 바뀌고, 쓰기 권한이 없는 설치 위치에서는 실패한다.)
      if (!fs.existsSync(this.dbPath)) {
        throw new UserFacingError(MISSING_DB_MESSAGE);
      }
      this.db = new Database(this.dbPath, { readonly: true, fileMustExist: true });
      return;
    }

    // 디렉토리가 없으면 생성
    const dbDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
      console.error(`📁 데이터베이스 디렉토리 생성: ${dbDir}`);
    }
    
    console.error(`📂 현재 파일: ${currentFile}`);
    console.error(`📂 SQLite DB 경로: ${this.dbPath}`);
    
    this.db = new Database(this.dbPath);

    // WAL 모드로 설정 (동시성 향상)
    this.db.pragma('journal_mode = WAL');

    // INSERT OR REPLACE 의 암묵적 DELETE 에서도 삭제 트리거가 발화하도록 설정.
    // OFF(기본값)이면 components_ad 트리거가 건너뛰어져 external-content FTS5
    // (components_fts) 인덱스에 옛 토큰이 남는 드리프트가 누적된다.
    this.db.pragma('recursive_triggers = ON');

    // 여러 프로세스가 같은 DB 를 동시에 쓰기 모드로 열어도 트리거 DROP/CREATE 가 서로 끼어들지
    // 않도록 스키마 스크립트 전체를 하나의 IMMEDIATE 트랜잭션으로 실행한다.
    this.db.transaction(() => this.initializeTables()).immediate();
  }

  private initializeTables() {
    this.db.exec(`
      -- 호환성 소프트웨어 테이블
      CREATE TABLE IF NOT EXISTS compatibility_software (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_name TEXT NOT NULL,
        product_version TEXT NOT NULL,
        framework_version TEXT NOT NULL,
        category TEXT NOT NULL,
        compatibility_level INTEGER CHECK(compatibility_level IN (1, 2)) NOT NULL,
        vendor TEXT NOT NULL,
        verified_date TEXT NOT NULL,
        description TEXT,
        url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(product_name, product_version, framework_version)
      );

      -- 인덱스 생성
      CREATE INDEX IF NOT EXISTS idx_compat_framework 
        ON compatibility_software(framework_version);
      CREATE INDEX IF NOT EXISTS idx_compat_category 
        ON compatibility_software(category);
      CREATE INDEX IF NOT EXISTS idx_compat_level 
        ON compatibility_software(compatibility_level);
      CREATE INDEX IF NOT EXISTS idx_compat_verified_date 
        ON compatibility_software(verified_date DESC);

      -- FTS5 전체 텍스트 검색 테이블 (호환성 소프트웨어)
      CREATE VIRTUAL TABLE IF NOT EXISTS compatibility_fts USING fts5(
        product_name, vendor, category, description,
        content=compatibility_software,
        content_rowid=id
      );

      -- FTS5 트리거 (데이터 동기화)
      -- components_fts 와 동일한 external-content 규칙: 일반 DELETE 문 대신
      -- old 값을 동봉하는 'delete' 특수 커맨드를 사용해야 하며, 과거의 잘못된
      -- 트리거를 교정하기 위해 매 연결마다 DROP 후 재생성한다.
      DROP TRIGGER IF EXISTS compatibility_ai;
      DROP TRIGGER IF EXISTS compatibility_ad;
      DROP TRIGGER IF EXISTS compatibility_au;

      CREATE TRIGGER compatibility_ai AFTER INSERT ON compatibility_software BEGIN
        INSERT INTO compatibility_fts(rowid, product_name, vendor, category, description)
        VALUES (new.id, new.product_name, new.vendor, new.category, new.description);
      END;

      CREATE TRIGGER compatibility_ad AFTER DELETE ON compatibility_software BEGIN
        INSERT INTO compatibility_fts(compatibility_fts, rowid, product_name, vendor, category, description)
        VALUES ('delete', old.id, old.product_name, old.vendor, old.category, old.description);
      END;

      CREATE TRIGGER compatibility_au AFTER UPDATE ON compatibility_software BEGIN
        INSERT INTO compatibility_fts(compatibility_fts, rowid, product_name, vendor, category, description)
        VALUES ('delete', old.id, old.product_name, old.vendor, old.category, old.description);
        INSERT INTO compatibility_fts(rowid, product_name, vendor, category, description)
        VALUES (new.id, new.product_name, new.vendor, new.category, new.description);
      END;

      -- ==================== 공통컴포넌트 테이블 ====================
      
      -- 공통컴포넌트 카테고리 테이블
      CREATE TABLE IF NOT EXISTS component_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        name_en TEXT,
        description TEXT,
        description_en TEXT
      );

      -- 공통컴포넌트 테이블
      -- package_name 은 고유하지 않다: 게시판과 블로그관리처럼 한 패키지를 함께 쓰는 컴포넌트가 있다.
      CREATE TABLE IF NOT EXISTS common_components (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        component_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        name_en TEXT,
        category_id TEXT NOT NULL,
        package_name TEXT,
        description TEXT,
        description_en TEXT,
        use_tables TEXT,
        version TEXT DEFAULT '4.3.1',
        has_web INTEGER DEFAULT 1,
        added_options TEXT,
        FOREIGN KEY (category_id) REFERENCES component_categories(category_id)
      );

      -- 공통컴포넌트 의존성 테이블
      CREATE TABLE IF NOT EXISTS component_dependencies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        component_id TEXT NOT NULL,
        depends_on_package TEXT NOT NULL,
        UNIQUE(component_id, depends_on_package),
        FOREIGN KEY (component_id) REFERENCES common_components(component_id)
      );

      -- 공통컴포넌트 인덱스
      CREATE INDEX IF NOT EXISTS idx_comp_category 
        ON common_components(category_id);
      CREATE INDEX IF NOT EXISTS idx_comp_package 
        ON common_components(package_name);
      CREATE INDEX IF NOT EXISTS idx_comp_dep_component 
        ON component_dependencies(component_id);
      CREATE INDEX IF NOT EXISTS idx_comp_dep_package 
        ON component_dependencies(depends_on_package);

      -- 공통컴포넌트 FTS5 전체 텍스트 검색
      CREATE VIRTUAL TABLE IF NOT EXISTS components_fts USING fts5(
        name, name_en, description, description_en, package_name,
        content=common_components,
        content_rowid=id
      );

      -- 컴포넌트 FTS 트리거
      -- external-content FTS5 는 일반 DELETE 문으로 인덱스 토큰을 제거할 수 없다
      -- (AFTER DELETE 시점엔 content 행이 이미 없어 원본 토큰을 알 수 없음).
      -- 반드시 old 값을 실어 보내는 'delete' 특수 커맨드를 사용해야 하며,
      -- 과거의 잘못된 트리거(DELETE FROM ... WHERE rowid=)를 교정하기 위해
      -- 매 연결마다 DROP 후 올바른 형태로 재생성한다 (비용 무시 가능).
      DROP TRIGGER IF EXISTS components_ai;
      DROP TRIGGER IF EXISTS components_ad;
      DROP TRIGGER IF EXISTS components_au;

      CREATE TRIGGER components_ai AFTER INSERT ON common_components BEGIN
        INSERT INTO components_fts(rowid, name, name_en, description, description_en, package_name)
        VALUES (new.id, new.name, new.name_en, new.description, new.description_en, new.package_name);
      END;

      CREATE TRIGGER components_ad AFTER DELETE ON common_components BEGIN
        INSERT INTO components_fts(components_fts, rowid, name, name_en, description, description_en, package_name)
        VALUES ('delete', old.id, old.name, old.name_en, old.description, old.description_en, old.package_name);
      END;

      CREATE TRIGGER components_au AFTER UPDATE ON common_components BEGIN
        INSERT INTO components_fts(components_fts, rowid, name, name_en, description, description_en, package_name)
        VALUES ('delete', old.id, old.name, old.name_en, old.description, old.description_en, old.package_name);
        INSERT INTO components_fts(rowid, name, name_en, description, description_en, package_name)
        VALUES (new.id, new.name, new.name_en, new.description, new.description_en, new.package_name);
      END;
    `);

    console.error('✅ SQLite 데이터베이스 초기화 완료');
  }

  // ==================== 호환성 소프트웨어 관리 ====================

  /**
   * 호환성 소프트웨어 추가
   */
  addCompatibilitySoftware(software: Omit<CompatibilitySoftware, 'id' | 'created_at'>): number {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO compatibility_software 
      (product_name, product_version, framework_version, category, 
       compatibility_level, vendor, verified_date, description, url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const info = stmt.run(
      software.product_name,
      software.product_version,
      software.framework_version,
      software.category,
      software.compatibility_level,
      software.vendor,
      software.verified_date,
      software.description || null,
      software.url || null
    );

    return info.lastInsertRowid as number;
  }

  /**
   * 호환성 소프트웨어 배치 추가
   */
  addCompatibilitySoftwareBatch(softwareList: Omit<CompatibilitySoftware, 'id' | 'created_at'>[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO compatibility_software 
      (product_name, product_version, framework_version, category, 
       compatibility_level, vendor, verified_date, description, url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction((list: typeof softwareList) => {
      for (const software of list) {
        stmt.run(
          software.product_name,
          software.product_version,
          software.framework_version,
          software.category,
          software.compatibility_level,
          software.vendor,
          software.verified_date,
          software.description || null,
          software.url || null
        );
      }
    });

    transaction(softwareList);
    console.error(`✅ ${softwareList.length}개의 호환성 소프트웨어 추가 완료`);
  }

  /**
   * 호환성 소프트웨어 검색 — 필터에 맞는 행을 배열로 돌려준다.
   * limit 을 생략하면 전체를 돌려준다. 행에는 id 와 created_at 도 들어 있다.
   */
  searchCompatibleSoftware(filters: CompatibilitySearchFilter = {}, limit?: number): CompatibilitySoftware[] {
    return this.selectCompatibleSoftware<CompatibilitySoftware>(COMPATIBILITY_SEARCH_ALL_COLUMNS, { filters, limit })
      .rows;
  }

  /**
   * 키워드 검색 — 모든 검색어가 일치하는 행을 배열로 돌려준다. 행에는 id 와 created_at 도 들어 있다.
   * queryCompatibleSoftwareAllTerms 의 rows 다. 전체 일치 건수가 필요하면 그 메서드를 쓴다.
   */
  fullTextSearchCompatibility(query: string, limit: number = 20): CompatibilitySoftware[] {
    return this.queryCompatibleSoftwareAllTerms(query, limit).rows;
  }

  /**
   * 키워드 검색 — 모든 검색어가 일치하는 행(rows, 앞에서부터 limit 건)과 그 전체 건수(total)를 돌려준다.
   * 행에는 id 와 created_at 도 들어 있다. 일치 규칙과 정렬은 queryCompatibleSoftware 의 1단계(all-terms)와 같다.
   *
   * queryCompatibleSoftware 와 달리 대체 검색(any-term)으로 넘어가지 않는다. 이 메서드의 결과는 통합 검색이
   * 결과를 찾은 방식(matchMode)의 표시 없이 싣기 때문에, 대체 검색 결과를 돌려주면 일부 검색어만 일치한 행이
   * 아무 표시 없이 쓰인다. 모든 검색어가 일치하는 행이 없거나 검색어가 하나도 추출되지 않으면 빈 결과(total 0)다.
   * 같은 이유로 query 에 OR 가 있어도 따르지 않는다: OR 는 검색어에서 빠질 뿐이고, 모든 검색어가 일치하는 행만 돌려준다.
   */
  queryCompatibleSoftwareAllTerms(
    query: string,
    limit: number = 20,
  ): { rows: CompatibilitySoftware[]; total: number } {
    const target = COMPATIBILITY_SEARCH_ALL_COLUMNS;
    // 가려 주지 못하는 낱말은 조회(keywordSearch)와 같이 뺀다. 검색어가 하나도 추출되지 않으면 빈 배열 그대로다
    const parsed = parseKeywordQuery(query);
    const terms = dropGenericTerms(parsed.terms, target.genericTerms, parsed.joinedTerms);
    if (terms.length === 0) {
      return { rows: [], total: 0 };
    }
    const page: SqlPage = { limit: toSqlLimit(limit), offset: 0 };
    const found = this.allTermsStage<CompatibilitySoftware>(target, terms, NO_FILTER, page, []);
    return found ? { rows: found.rows, total: found.total } : { rows: [], total: 0 };
  }

  /**
   * 호환성 소프트웨어 조회 (키워드 + 필터).
   *
   * 필터는 키워드 검색과 같은 SQL 문에서 적용하고 LIMIT 은 그 뒤에 적용한다.
   * - query 에서 검색어가 추출되면 키워드 검색(keywordSearch)으로 찾는다. 검색어는 제품명·제품 버전 표기·
   *   업체명·분류·설명에 부분 문자열로 들어 있으면 일치한다. 프레임워크 버전과 확인일자는 부분 문자열로
   *   견주지 않고 따로 정한 규칙으로 견준다 (compatibilityTermConditions). 모든 검색어가 일치하는 행을 먼저
   *   찾고(all-terms), 그런 행이 없으면 대체 검색으로 찾는다(any-term). query 에 단독 낱말 OR 가 있으면
   *   처음부터 검색어 가운데 하나 이상이 일치하는 행을 찾는다 (any-term, terms.orQuery).
   * - query 가 없거나 검색어가 하나도 추출되지 않으면("*", "?" 등) 필터에 맞는 행을
   *   확인일자가 최근인 순으로 돌려준다.
   * - 확인일자 순은 어느 경로에서나 같다 (COMPATIBILITY_NEWEST_FIRST): verified_date 가 날짜 꼴이 아닌 행은
   *   맨 뒤로 간다. 키워드 검색에서는 앞선 정렬 기준(selectByMatchedTerms: 일치한 검색어 수, 이름에 일치한 검색어 수
   *   등)이 모두 같은 행끼리 이 순서를 따른다.
   *
   * total 은 같은 조건에 맞는 전체 건수이고, rows 는 그 가운데 offset 부터 limit 건이다.
   * rows 에는 내부용 컬럼(id, created_at)을 넣지 않는다.
   * 키워드 검색을 했으면 결과를 찾은 방식(matchMode)과 쓴 검색어·쓰지 않은 검색어(terms)를 함께 돌려준다.
   */
  queryCompatibleSoftware(options: CompatibilityQueryOptions = {}): CompatibilityQueryResult {
    return this.selectCompatibleSoftware<CompatibilitySoftwareInfo>(COMPATIBILITY_SEARCH, options);
  }

  /** 호환성 소프트웨어 조회의 본체. target.columns 에 적힌 컬럼을 조회한다. */
  private selectCompatibleSoftware<Row>(
    target: KeywordSearchTarget,
    options: CompatibilityQueryOptions,
  ): { rows: Row[]; total: number; matchMode?: KeywordMatchMode; terms?: KeywordTermUsage } {
    const filter = this.buildCompatibilityFilter(options.filters ?? {});
    const page: SqlPage = { limit: toSqlLimit(options.limit), offset: toSqlOffset(options.offset) };

    const query = parseKeywordQuery(options.query ?? '');
    if (query.terms.length > 0) {
      return this.keywordSearch<Row>(target, query, filter, page);
    }

    const from = `FROM ${target.table} WHERE 1=1${filter.sql}`;
    const total = (
      this.db.prepare(`SELECT COUNT(*) AS count ${from}`).get(...filter.params) as { count: number }
    ).count;
    const rows = this.db
      .prepare(
        `SELECT ${target.columns} ${from}
         ORDER BY ${target.defaultOrder}, ${target.rowid}
         LIMIT ? OFFSET ?`,
      )
      .all(...filter.params, page.limit, page.offset) as Row[];
    return { rows, total };
  }

  /**
   * 호환성 소프트웨어 필터를 WHERE 절에 덧붙일 조건으로 바꾼다 (테이블 별칭 cs 기준).
   * 문자열 필터는 앞뒤 공백을 떼고, 비어 있으면 주지 않은 것으로 본다.
   */
  private buildCompatibilityFilter(filters: CompatibilitySearchFilter): SqlCondition {
    const clauses: string[] = [];
    const params: unknown[] = [];

    const frameworkVersion = trimFilter(filters.frameworkVersion);
    if (frameworkVersion) {
      clauses.push('cs.framework_version = ?');
      params.push(frameworkVersion);
    }

    // 카테고리는 대소문자를 구분하지 않는다 ('cms solution' = 'CMS Solution')
    const category = trimFilter(filters.category);
    if (category) {
      clauses.push('cs.category = ? COLLATE NOCASE');
      params.push(category);
    }

    // level 은 그 레벨과 같은 행, minLevel 은 그 레벨 이상인 행이다. 함께 주면 둘 다 적용한다.
    // minLevel 만으로는 레벨 1 인 행만 고를 수 없다 (minLevel 1 은 모든 행이다).
    if (typeof filters.level === 'number') {
      clauses.push('cs.compatibility_level = ?');
      params.push(filters.level);
    }

    if (filters.minLevel) {
      clauses.push('cs.compatibility_level >= ?');
      params.push(filters.minLevel);
    }

    // 업체명은 법인 표기(㈜, (주), 주식회사)와 공백의 차이를 없애고 비교한다.
    // 조회 결과에 보이는 업체명을 어느 표기로 넣어도 그 업체의 행을 모두 찾을 수 있어야 한다.
    const vendor = trimFilter(filters.vendor);
    if (vendor) {
      addVendorClause(clauses, params, 'cs.vendor', vendor);
    }

    // 제품명 필터는 버전 표기(product_version, 예: 'JEUS 8.5')와도 비교한다.
    // 조회 결과에 보이는 값을 그대로 넣어도 찾을 수 있어야 한다.
    const productName = trimFilter(filters.productName);
    if (productName) {
      addContainsClause(clauses, params, ['cs.product_name', 'cs.product_version'], productName);
    }

    return { sql: clauses.map((clause) => ` AND ${clause}`).join(''), params };
  }

  // ==================== 키워드 검색 공통 ====================

  /**
   * 키워드 검색 (호환성 소프트웨어와 공통컴포넌트가 함께 쓴다).
   *
   * 검색어가 행과 일치한다는 것은 검색어가 대상의 검색 컬럼(searchColumns) 가운데 하나에 부분 문자열로
   * 들어 있다는 뜻이다 (LIKE. ASCII 영문자는 대소문자를 가리지 않는다). FTS5 인덱스는 쓰지 않는다:
   * 낱말 단위 접두 일치로는 한국어 복합어의 뒤쪽이나 가운데에 든 낱말('공통코드' 의 '코드')을 찾지 못하고,
   * 두 표 모두 수백 행이라 전체를 훑어도 느리지 않다.
   * 부분 문자열로 견주면 안 되는 컬럼은 대상이 따로 정한 조건(termConditions)으로 견준다. 검색어 그대로의
   * 일치 판정은 아래의 모든 단계가 termMatcher 가 만든 조건 하나를 쓴다. 대체 검색은 그대로는 일치하는 행이 없는
   * 검색어를 조사를 뗀 꼴과 유연한 꼴(구분 기호의 자리를 너그럽게 견주는 flexibleTermMatcher)로도 견준다.
   *
   * 0) 행을 가려 주지 못하는 낱말을 검색어에서 뺀다 (selectSearchTerms): 영어 기능어와, 대상의 모든 항목에
   *    해당하는 낱말(target.genericTerms). 빼도 찾을 것이 남을 때만 뺀다.
   * 1) 모든 검색어가 일치하는 행을 찾는다 (allTermsStage). 한 글자 검색어도 쓰고, 그렇게 해서 찾은 행이 없을
   *    때만 한 글자 검색어를 빼고 다시 찾는다.
   * 2) 필터까지 적용한 결과가 0건이면 한 글자 검색어를 뺀 채로(dropSingleCharacterTerms) 대체 검색
   *    (anyTermSearch)으로 넘어간다: 일치하는 행이 있는 검색어만 남기고(usableTerms. 그대로, 조사를 뗀 꼴, 유연한 꼴
   *    가운데 일치하는 행이 있는 첫 꼴을 쓴다), 그 절반 이상이 일치하는 행을 찾는다.
   *    그런 행이 없으면 일치 기준을 낮춰 가며 찾는다. 대상 행의 절반 넘게 일치하는 흔한 검색어만 일치한 행은
   *    돌려주지 않는다.
   *    0건인지는 페이지가 아니라 전체 건수로 판단한다 (offset 이 끝을 넘었다고 검색 방식을 바꾸지 않는다).
   *
   * query 에 단독 낱말 OR 가 있으면(query.orQuery) 1)을 건너뛰고 2)로 간다. 'A OR B' 는 둘 가운데 하나라도 든 행을
   * 찾는 것이라, 둘 다 든 행이 있다고 거기서 끝내면 한쪽만 든 행이 빠진다. 이때는 일치하는 행이 있는 검색어 가운데
   * 하나 이상이 일치하는 행을 모두 돌려준다 (일치 기준 1, 흔한 검색어만 일치한 행도 돌려준다).
   *
   * 어느 경로에서나 일치한 검색어가 많은 행, 뺀 대상 낱말이 이름 컬럼(nameColumns)에 든 행, 낱말의 처음에서 일치한
   * 영문 검색어가 많은 행, 이름 컬럼에 일치한 검색어가 많은 행, 대상의 기본 정렬, rowid 순으로 돌려준다
   * (selectByMatchedTerms).
   *
   * 결과의 terms 는 실제로 쓴 검색어(used), 일치하는 행이 없어 쓰지 않은 검색어(ignored), 일치하는 행이 있는지와
   * 관계없이 검색에서 뺀 검색어(dropped: 가려 주지 못하는 낱말과 한 글자 검색어), 결과의 행마다 일치한 검색어의
   * 최소 수(required)다. OR 가 있어 2)로 바로 간 결과에는 orQuery 를 true 로 싣는다.
   */
  private keywordSearch<Row>(
    target: KeywordSearchTarget,
    query: KeywordQuery,
    filter: SqlCondition,
    page: SqlPage,
  ): { rows: Row[]; total: number; matchMode: KeywordMatchMode; terms: KeywordTermUsage } {
    const { orQuery } = query;
    // 검색어의 쓸 꼴은 0단계와 대체 검색이 함께 쓴다. 검색어마다 한 번만 구한다
    const formOf = this.formResolver(target, filter);
    const selected = this.selectSearchTerms(target, query, filter, formOf);
    /**
     * 검색에서 뺀 검색어: 가려 주지 못해 뺀 낱말과, 고른 검색어 가운데 검색에 넘긴 검색어(searched)에 들지 못한
     * 한 글자 검색어. query 에 적힌 순서다
     */
    const droppedFrom = (searched: string[]): string[] =>
      query.terms.filter(
        (term) => selected.dropped.includes(term) || (selected.terms.includes(term) && !searched.includes(term)),
      );

    // OR 가 있으면 모든 검색어가 일치하는 행을 먼저 찾지 않는다
    const allTerms = orQuery
      ? null
      : this.allTermsStage<Row>(target, selected.terms, filter, page, selected.droppedInName);
    if (allTerms) {
      const { used, rows, total } = allTerms;
      const usage: KeywordTermUsage = { used, ignored: [], dropped: droppedFrom(used), required: used.length };
      return { rows, total, matchMode: 'all-terms', terms: usage };
    }

    const searchable = dropSingleCharacterTerms(selected.terms);
    const { usable, ignored } = usableTerms(searchable, formOf);
    const fallback = this.anyTermSearch<Row>(target, usable, filter, page, orQuery, selected.droppedInName);
    return {
      rows: fallback.rows,
      total: fallback.total,
      matchMode: 'any-term',
      terms: {
        // 조사를 떼어 쓴 것은 뗀 꼴, 유연한 꼴로 쓴 것은 그 꼴을 만든 검색어 그대로다
        used: usable.map((term) => term.form),
        ignored,
        dropped: droppedFrom(searchable),
        required: fallback.required,
        ...(orQuery ? { orQuery: true } : {}),
      },
    };
  }

  /**
   * 0단계: query 에서 추출한 검색어 가운데 검색에 쓸 것을 고른다. 행을 가려 주지 못하는 낱말을 빼는 규칙은 여기에만 있다.
   *
   * 가려 주지 못하는 낱말은 두 가지다 (목록과 판정은 utils/fts5Query).
   * - 영어 기능어(isEnglishFunctionWord): 영어 문장으로 물을 때 섞이는 낱말이다. 부분 문자열로 견주면 제품명의
   *   일부와 우연히 일치한다 ('is' 가 'aXis' 와).
   * - 대상 낱말(listedTargetWord): 검색 대상의 모든 항목에 해당하는 낱말(target.genericTerms)과 그 조사 붙은 꼴이다
   *   ('eGovFrame', '전자정부의', 공통컴포넌트에서는 '컴포넌트' 도). 검색어로 쓰면 설명에 그 낱말이 우연히 든 행으로
   *   결과가 좁혀지거나, 어느 행에도 없어 모든 검색어가 일치하는 행을 찾지 못한다.
   *
   * 빼도 찾을 것이 남을 때만 뺀다.
   * (가) 영어 기능어는 query 에 영어 기능어가 아닌 두 글자 이상의 검색어가 하나라도 있을 때만 뺀다. 그 검색어가 대상
   *      낱말이어도 된다 ("the eGovFrame" 의 'the' 는 뺀다). 그런 검색어가 없으면 빼지 않는다: 남는 것이 한 글자뿐이면
   *      그 글자의 부분 문자열 검색이 되고("in S" 에서 'in' 을 빼면 'S' 가 든 수백 행), 기능어처럼 보이는 낱말이 찾는
   *      이름일 수 있다 (제품 'in_S', "Q A").
   * (나) 대상 낱말은, 영어 기능어도 대상 낱말도 아닌 두 글자 이상의 검색어 가운데 쓸 수 있는 것이 하나라도 있을 때만
   *      뺀다. 쓸 수 있다는 것은 필터를 적용한 대상 안에 일치하는 행이 있다는 뜻이고, 대체 검색과 같은 꼴 고르기
   *      (formOf: 그대로, 조사를 뗀 꼴, 유연한 꼴)로 판정한다. 그런 검색어가 없는데 빼면 남은 검색어로는 한 행도 찾지
   *      못한다 ("컴포넌트 목록", "eGovFrame 8"). 빼지 않은 대상 낱말은 보통의 검색어로 쓴다.
   * (다) query 에 OR 가 있을 때는, 필터를 적용한 대상 안에 이름 컬럼(nameColumns)에 그 낱말이 든 행이 있는 대상
   *      낱말을 빼지 않는다 ("eGov OR JEUS" 는 제품명에 eGov 가 든 행도 돌려준다). 그런 행이 없는 대상 낱말은
   *      (나)를 따른다.
   * (라) 뺀 대상 낱말은 정렬에 쓴다: 그 낱말이 이름 컬럼에 든 행을 먼저 돌려준다 (droppedInName. selectByMatchedTerms 의
   *      정렬 기준). "eGov CMS" 는 CMS 가 든 행을 모두 돌려주되 제품명에 eGov 가 든 제품을 맨 앞에 놓는다.
   *      조사가 붙은 꼴은 목록에 있는 꼴로 견주고('eGovFrame에서' → 'eGovFrame'), 같은 낱말은 한 번만 센다.
   *      영어 기능어는 정렬에 쓰지 않는다.
   *
   * 어느 경우에도 검색어가 하나는 남는다: (가)는 기능어가 아닌 검색어가 있을 때만, (나)는 쓸 수 있는 다른 검색어가 있을
   * 때만 빼기 때문이다. 영어 기능어뿐이거나 대상 낱말뿐인 query 는 그대로 찾는다.
   *
   * dropped 는 뺀 낱말(query 에 적힌 꼴, 적힌 순서)이다. 빼지 않고 쓴 영어 기능어와 대상 낱말은 넣지 않는다.
   */
  private selectSearchTerms(
    target: KeywordSearchTarget,
    query: KeywordQuery,
    filter: SqlCondition,
    formOf: FormResolver,
  ): { terms: string[]; dropped: string[]; droppedInName: SqlExpression[] } {
    const { terms, joinedTerms, orQuery } = query;
    const isFunctionWord = (term: string): boolean => isEnglishFunctionWord(term, joinedTerms);
    const listedOf = (term: string): string | null => listedTargetWord(term, target.genericTerms);
    /** 대상 낱말(목록에 있는 꼴)이 이름 컬럼에 들어 있다는 조건. 목록의 낱말은 짧고 NUL 이 없어 패턴을 그대로 만든다 */
    const inName = (listed: string): SqlExpression =>
      likeAnyColumn(target.nameColumns, `%${escapeLikePattern(listed)}%`);

    // (가) 영어 기능어. 대상 낱말은 모두 두 글자 이상이라, 대상 낱말이 하나라도 있으면 영어 기능어는 여기서 모두 빠진다
    const dropsFunctionWords = terms.some((term) => !isFunctionWord(term) && codePointLength(term) >= 2);
    const functionWords = dropsFunctionWords ? terms.filter(isFunctionWord) : [];
    const kept = terms.filter((term) => !functionWords.includes(term));

    // (다) 뺄 후보인 대상 낱말. OR 가 있으면 이름 컬럼에 든 행이 있는 것은 후보에서 뺀다
    const candidates = kept.flatMap((term) => {
      const listed = listedOf(term);
      if (listed === null || (orQuery && this.countInScope(target, inName(listed), filter) > 0)) {
        return [];
      }
      return [{ term, listed }];
    });
    if (candidates.length === 0) {
      return { terms: kept, dropped: functionWords, droppedInName: [] };
    }

    // (나) 후보를 빼고 남는 검색어 가운데, 대상 낱말이 아닌 두 글자 이상의 검색어를 하나라도 쓸 수 있어야 뺀다
    const droppable = candidates.map((candidate) => candidate.term);
    const remaining = kept.filter((term) => !droppable.includes(term));
    const findsRows = remaining.some(
      (term) => listedOf(term) === null && codePointLength(term) >= 2 && formOf(term) !== null,
    );
    if (!findsRows) {
      return { terms: kept, dropped: functionWords, droppedInName: [] };
    }

    // (라) 뺀 대상 낱말마다 이름 컬럼에 든 행을 가리는 조건 하나 (대소문자만 다른 낱말은 같은 낱말이다)
    const droppedWords = new Map(candidates.map(({ listed }) => [listed.toLowerCase(), listed]));
    return {
      terms: remaining,
      dropped: terms.filter((term) => functionWords.includes(term) || droppable.includes(term)),
      droppedInName: [...droppedWords.values()].map(inName),
    };
  }

  /** 검색어의 쓸 꼴을 고르는 함수를 만든다 (firstMatchingForm). 같은 검색어는 한 번만 조회한다. */
  private formResolver(target: KeywordSearchTarget, filter: SqlCondition): FormResolver {
    const resolved = new Map<string, UsableTerm | null>();
    return (term) => {
      let form = resolved.get(term);
      if (form === undefined) {
        form = this.firstMatchingForm(target, term, filter);
        resolved.set(term, form);
      }
      return form;
    };
  }

  /**
   * 1단계: 모든 검색어가 일치하는 행을 찾는다. 찾은 행과 실제로 쓴 검색어(used)를 돌려주고, 없으면 null 이다.
   *
   * 한 글자 검색어도 넣어 찾는다. 모든 검색어가 일치해야 하므로 검색어가 늘면 결과는 좁아질 뿐이고, 한 글자를
   * 빼면 그 글자가 가려 주던 행을 잃는다 ('롤 관리' 에서 '롤' 을 빼면 '관리' 가 든 컴포넌트가 모두 나온다).
   * 그렇게 해서 0건이고 두 글자 이상인 검색어가 함께 있으면, 한 글자 검색어를 빼고 한 번 더 찾는다.
   * 부분 문자열로 견주는 한 글자는 어느 행에도 없거나 엉뚱한 행에만 있는 일이 흔해, 나머지 검색어가 모두
   * 일치하는 행이 있는데도 그 한 글자 때문에 대체 검색으로 넘어가는 것을 막는다.
   *
   * droppedInName 은 정렬에 쓰는 조건이다 (selectByMatchedTerms).
   */
  private allTermsStage<Row>(
    target: KeywordSearchTarget,
    terms: string[],
    filter: SqlCondition,
    page: SqlPage,
    droppedInName: SqlExpression[],
  ): { rows: Row[]; total: number; used: string[] } | null {
    const withoutSingles = dropSingleCharacterTerms(terms);
    const attempts = withoutSingles.length < terms.length ? [terms, withoutSingles] : [terms];
    for (const used of attempts) {
      const found = this.allTermsSearch<Row>(target, used, filter, page, droppedInName);
      if (found) {
        return { ...found, used };
      }
    }
    return null;
  }

  /**
   * 모든 검색어가 일치하는 행을 찾는다. 필터까지 적용한 결과가 0건이면 null 을 돌려준다.
   * 조회 중 오류(잠금, 손상, 테이블 없음 등)는 결과 없음으로 가리지 않고 그대로 던진다.
   */
  private allTermsSearch<Row>(
    target: KeywordSearchTarget,
    terms: string[],
    filter: SqlCondition,
    page: SqlPage,
    droppedInName: SqlExpression[],
  ): { rows: Row[]; total: number } | null {
    const matchers: TermMatcher[] = [];
    for (const term of terms) {
      const matcher = termMatcher(target, term);
      // 견줄 조건을 만들 수 없는 검색어는 어떤 행과도 일치하지 않으므로, 모든 검색어가 일치하는 행도 없다
      if (matcher === null) {
        return null;
      }
      matchers.push(matcher);
    }
    if (matchers.length === 0) {
      return null;
    }

    const found = this.selectByMatchedTerms<Row>(target, matchers, matchers.length, filter, page, droppedInName);
    return found.total > 0 ? found : null;
  }

  /**
   * 검색어(matchers) 가운데 required 개 이상이 일치하는 행을 조회한다. 필터는 같은 SQL 문에서 적용한다.
   *
   * 정렬:
   * (1) 일치한 검색어 수가 많은 행.
   * (2) 뺀 대상 낱말이 이름 컬럼에 든 수가 많은 행 (droppedInName. selectSearchTerms 의 (라)). 대상 낱말은 검색어에서
   *     빼지만, 그 낱말이 제품명에 든 제품('MC@CMS eGov')을 찾는 query 일 수 있어 그런 행을 앞에 놓는다.
   *     뺀 대상 낱말이 없는 조회에는 이 기준이 없다.
   * (3) 낱말의 처음에서 일치한 영문 검색어 수가 많은 행 (TermMatcher.startsWord). 두세 글자 영문 검색어는 다른
   *     낱말 속에서도 일치해('TimeCMS' 의 'ECM'), 낱말로 일치한 행('ECM Solution')이 그런 행에 밀리지 않게 한다.
   *     한글이나 기호가 든 검색어와 숫자뿐인 검색어는 세지 않으므로, 영문 검색어가 없는 조회에는 이 기준이 없다.
   * (4) 이름 컬럼에 일치한 검색어 수가 많은 행. 설명에만 검색어가 든 행은 버리지 않고 뒤로 보낸다.
   * (5) 대상의 기본 정렬.
   * (6) rowid.
   * (흔한 검색어만 일치한 행을 거르는 일은 대체 검색이 filter 에 조건을 더해서 한다. distinctiveScope 참조.)
   */
  private selectByMatchedTerms<Row>(
    target: KeywordSearchTarget,
    matchers: TermMatcher[],
    required: number,
    filter: SqlCondition,
    page: SqlPage,
    droppedInName: SqlExpression[],
  ): { rows: Row[]; total: number } {
    const matchedTerms = countOf(matchers.map((matcher) => matcher.matches));
    const matchedInName = countOf(matchers.map((matcher) => matcher.inName));
    // 낱말의 처음을 따지는 검색어가 하나도 없으면 그 정렬 기준을 두지 않는다 (모든 행이 0 이라 순서를 바꾸지 않는다)
    const wordStarts = matchers.flatMap((matcher) => (matcher.startsWord === null ? [] : [matcher.startsWord]));
    const matchedAtWordStart = wordStarts.length > 0 ? countOf(wordStarts) : null;

    const from = `FROM ${target.table} ${target.joins ?? ''} WHERE (${matchedTerms.sql}) >= ?${filter.sql}`;
    const fromParams = [...matchedTerms.params, required, ...filter.params];

    const total = (this.db.prepare(`SELECT COUNT(*) AS count ${from}`).get(...fromParams) as { count: number })
      .count;
    if (total === 0) {
      return { rows: [], total: 0 };
    }

    // 정렬 기준과 그 바인딩 값을 같은 순서로 잇는다
    const ranking = [
      matchedTerms,
      ...(droppedInName.length > 0 ? [countOf(droppedInName)] : []),
      ...(matchedAtWordStart ? [matchedAtWordStart] : []),
      matchedInName,
    ];
    const rows = this.db
      .prepare(
        `SELECT ${target.columns} ${from}
         ORDER BY ${ranking.map((count) => `(${count.sql}) DESC`).join(', ')},
                  ${target.defaultOrder}, ${target.rowid}
         LIMIT ? OFFSET ?`,
      )
      .all(...fromParams, ...ranking.flatMap((count) => count.params), page.limit, page.offset) as Row[];
    return { rows, total };
  }

  /**
   * 대체 검색: 모든 검색어가 일치하는 행이 없을 때, 쓸 수 있는 검색어의 절반 이상이 일치하는 행을 찾는다.
   *
   * 쓸 수 있는 검색어(usable)는 필터를 적용한 대상 안에 일치하는 행이 있는 검색어다 (usableTerms). 문장으로 물을 때
   * 섞이는 군말('추천', '되나요')이 일치 기준을 올려 결과를 0건으로 만들지 않게 한다.
   *
   * 쓸 수 있는 검색어가 k 개일 때 ceil(k/2) 개 이상 일치한 행을 돌려준다 (k 가 0 이면 빈 결과).
   * 그 기준을 채운 행이 없으면 행이 나오는 데까지 기준을 낮춘다 (highestMatchCount). 제품명 셋을 나열한 query 처럼
   * 한 행에 두 검색어가 함께 들 수 없는 경우에 0건을 돌려주면, 호출자는 그 제품들이 목록에 없다고 읽는다.
   * 쓸 수 있는 검색어는 저마다 대상 안에 일치하는 행이 있으므로, k 가 1 이상이면 결과가 0건이 되지 않는다.
   *
   * 흔한 검색어만 일치한 행은 돌려주지 않는다 (distinctiveScope). 일치 기준도 그 조건을 건 채로 낮춘다.
   * 정렬과 필터 적용은 selectByMatchedTerms 를 따른다 (droppedInName 은 그 정렬에 쓰는 조건이다).
   *
   * anyOne 이 true 이면(query 에 OR 가 있다) 쓸 수 있는 검색어 가운데 하나 이상이 일치하는 행을 모두 돌려준다:
   * 일치 기준은 처음부터 1 이고, 흔한 검색어만 일치한 행도 거르지 않는다. 호출자가 낱말을 OR 로 이어 어느 것이든
   * 든 행을 달라고 한 것이라, 절반 이상이 일치한 행이 있다고 나머지를 빼거나 흔한 낱말이라고 거르지 않는다.
   *
   * 결과의 required 는 실제로 적용한 일치 기준이다 (k 가 0 이면 0).
   */
  private anyTermSearch<Row>(
    target: KeywordSearchTarget,
    usable: UsableTerm[],
    filter: SqlCondition,
    page: SqlPage,
    anyOne: boolean,
    droppedInName: SqlExpression[],
  ): { rows: Row[]; total: number; required: number } {
    if (usable.length === 0) {
      return { rows: [], total: 0, required: 0 };
    }

    const matchers = usable.map((term) => term.matcher);
    const scope = anyOne ? filter : this.distinctiveScope(target, usable, filter);

    // 절반(올림)에서 시작한다 (anyOne 이면 처음부터 1 이다). 그 기준을 채운 행이 없으면, 가장 많은 검색어가 일치한
    // 행의 일치 수로 기준을 낮춘다. 기준을 1씩 낮춰 가며 행이 나올 때까지 찾는 것과 같은 결과이고, 낮추는 단계마다
    // 표를 다시 훑지 않는다.
    // 행이 있는지는 페이지가 아니라 전체 건수로 판단한다 (offset 이 끝을 넘었다고 기준을 낮추지 않는다)
    let required = anyOne ? 1 : Math.ceil(matchers.length / 2);
    let found = this.selectByMatchedTerms<Row>(target, matchers, required, scope, page, droppedInName);
    if (found.total === 0 && required > 1) {
      required = this.highestMatchCount(target, matchers, scope);
      found = this.selectByMatchedTerms<Row>(target, matchers, required, scope, page, droppedInName);
    }
    return { ...found, required };
  }

  /**
   * 조건(scope)을 채우는 행 가운데 가장 많은 검색어가 일치한 행의 일치한 검색어 수.
   *
   * 대체 검색이 일치 기준을 낮출 때 쓴다. 대체 검색이 쓰는 검색어는 저마다 필터를 적용한 대상 안에 일치하는 행이
   * 있고, 흔한 검색어를 거르는 조건(distinctiveScope)도 그런 검색어가 일치한 행을 남기므로 1 이상이다.
   */
  private highestMatchCount(target: KeywordSearchTarget, matchers: TermMatcher[], scope: SqlCondition): number {
    const matchedTerms = countOf(matchers.map((matcher) => matcher.matches));
    const row = this.db
      .prepare(
        `SELECT MAX(${matchedTerms.sql}) AS highest FROM ${target.table} ${target.joins ?? ''}
         WHERE 1=1${scope.sql}`,
      )
      .get(...matchedTerms.params, ...scope.params) as { highest: number };
    return row.highest;
  }

  /**
   * 검색어의 꼴 가운데, 필터를 적용한 대상 안에 일치하는 행이 있는 첫 꼴을 고른다. 없으면 null 이다.
   *
   * 다음 순서로 견준다.
   * 1) 검색어 그대로.
   * 2) 조사를 뗀 꼴 (particleStrippedForms). 조사가 붙은 제품명('JEUS는', '티맥스는')으로도 찾게 한다.
   * 3) 검색어 그대로의 유연한 꼴 (flexibleTermMatcher). 낱말을 기호로 이어 적은 검색어가 저장된 표기와 구분 기호만
   *    다를 때('K2Web-Wizard' 와 'K2Web Wizard', 'sts_com' 과 'sts-com', 'Web-Square' 와 'WebSquare')에도 찾게 한다.
   * 4) 조사를 뗀 꼴의 유연한 꼴 ('K2Web-Wizard는').
   *
   * 기호에서 나눈 조각으로는 찾지 않는다. 조각은 다른 낱말의 일부와 일치해 결과를 부풀린다: 없는 패키지명
   * 'egovframework.com.zzz' 의 'com' 이 모든 컴포넌트와, 'REST-API' 의 'REST' 가 'restrictions' 와 일치한다.
   *
   * 돌려주는 form 은 쓴 꼴의 표기다. 유연한 꼴로 쓴 것은 그 꼴을 만든 검색어 그대로다 (3은 query 에 적힌 검색어,
   * 4는 조사를 뗀 꼴).
   */
  private firstMatchingForm(target: KeywordSearchTarget, term: string, filter: SqlCondition): UsableTerm | null {
    const forms = [term, ...particleStrippedForms(term)];
    for (const matcherOf of [termMatcher, flexibleTermMatcher]) {
      for (const form of forms) {
        const matcher = matcherOf(target, form);
        // 견줄 조건을 만들 수 없는 꼴은 어떤 행과도 일치하지 않는다
        if (matcher === null) {
          continue;
        }
        const rows = this.countInScope(target, matcher.matches, filter);
        if (rows > 0) {
          return { form, matcher, rows };
        }
      }
    }
    return null;
  }

  /**
   * 대체 검색의 대상을 가려 주는 검색어가 하나 이상 일치한 행으로 좁힌 조건을 돌려준다 (좁힐 것이 없으면 filter 그대로).
   *
   * 가려 주는 검색어는 필터를 적용한 대상 행의 절반 이하와 일치하는 검색어이고, 절반 넘게 일치하는 검색어는
   * 흔한 검색어다. 대체 검색은 검색어의 절반만 일치해도 돌려주므로, 흔한 검색어('제품', '기능')만 일치한 행까지
   * 돌려주면 그 행들이 결과를 채워 찾는 행이 묻힌다 ('티맥스 제품 목록' 이 '제품' 이 든 수백 행을 돌려주고
   * 티맥스 행 일부가 삼백 번째 뒤로 밀린다).
   * 흔한 검색어를 버리지는 않는다: 일치한 검색어 수(정렬과 일치 기준)에는 그대로 센다.
   * 쓸 수 있는 검색어가 모두 흔한 검색어이면 좁히지 않는다 ('CMS 추천' 은 CMS 가 든 행을 그대로 돌려준다).
   */
  private distinctiveScope(target: KeywordSearchTarget, usable: UsableTerm[], filter: SqlCondition): SqlCondition {
    const scopeRows = this.countInScope(target, EVERY_ROW, filter);
    const distinctive = usable.filter((term) => term.rows * 2 <= scopeRows);
    // 모든 검색어가 가려 주는 검색어이면, 하나 이상 일치한 행은 이미 이 조건을 채운다
    if (distinctive.length === 0 || distinctive.length === usable.length) {
      return filter;
    }
    const condition = anyOf(distinctive.map((term) => term.matcher.matches));
    return { sql: `${filter.sql} AND ${condition.sql}`, params: [...filter.params, ...condition.params] };
  }

  /** 조건(condition)을 채우는 행이 필터를 적용한 대상 안에 몇 건인지. */
  private countInScope(target: KeywordSearchTarget, condition: SqlExpression, filter: SqlCondition): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM ${target.table} ${target.joins ?? ''}
         WHERE ${condition.sql}${filter.sql}`,
      )
      .get(...condition.params, ...filter.params) as { count: number };
    return row.count;
  }

  /**
   * 호환성 통계 조회
   */
  getCompatibilitySummary(): CompatibilitySummary {
    const byVersion = this.db.prepare(`
      SELECT framework_version, COUNT(*) as count
      FROM compatibility_software
      GROUP BY framework_version
      ORDER BY framework_version DESC
    `).all() as Array<{ framework_version: string; count: number }>;

    const byCategory = this.db.prepare(`
      SELECT category, COUNT(*) as count
      FROM compatibility_software
      GROUP BY category
      ORDER BY count DESC
    `).all() as Array<{ category: string; count: number }>;

    const byLevel = this.db.prepare(`
      SELECT compatibility_level, COUNT(*) as count
      FROM compatibility_software
      GROUP BY compatibility_level
    `).all() as Array<{ compatibility_level: number; count: number }>;

    const recentlyAdded = this.db.prepare(`
      SELECT * FROM compatibility_software
      ORDER BY created_at DESC
      LIMIT 10
    `).all() as CompatibilitySoftware[];

    return {
      byVersion,
      byCategory,
      byLevel,
      recentlyAdded,
    };
  }

  /**
   * 카테고리 목록 조회
   */
  getCategories(): string[] {
    const results = this.db.prepare(`
      SELECT DISTINCT category FROM compatibility_software
      ORDER BY category
    `).all() as Array<{ category: string }>;

    return results.map(r => r.category);
  }

  /**
   * 프레임워크 버전 목록 조회 — 최신 버전부터.
   * major, minor 를 정수로 비교한다 (문자열로 정렬하면 3.10 이 3.2 보다 작게 취급된다).
   */
  getFrameworkVersions(): string[] {
    const results = this.db.prepare(`
      SELECT DISTINCT framework_version FROM compatibility_software
    `).all() as Array<{ framework_version: string }>;

    return results.map(r => r.framework_version).sort(compareVersionsDescending);
  }

  /**
   * 전체 통계
   */
  getOverallStats() {
    return {
      compatibility: this.db.prepare('SELECT COUNT(*) as count FROM compatibility_software').get() as { count: number },
      componentCategories: this.db.prepare('SELECT COUNT(*) as count FROM component_categories').get() as { count: number },
      commonComponents: this.db.prepare('SELECT COUNT(*) as count FROM common_components').get() as { count: number },
    };
  }

  // ==================== 공통컴포넌트 관리 ====================

  /**
   * 컴포넌트 카테고리 추가
   */
  addComponentCategory(category: Omit<ComponentCategory, 'id'>): number {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO component_categories 
      (category_id, name, name_en, description, description_en)
      VALUES (?, ?, ?, ?, ?)
    `);

    const info = stmt.run(
      category.category_id,
      category.name,
      category.name_en || null,
      category.description || null,
      category.description_en || null
    );

    return info.lastInsertRowid as number;
  }

  /**
   * 컴포넌트 카테고리 배치 추가
   */
  addComponentCategoriesBatch(categories: Omit<ComponentCategory, 'id'>[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO component_categories 
      (category_id, name, name_en, description, description_en)
      VALUES (?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction((list: typeof categories) => {
      for (const cat of list) {
        stmt.run(
          cat.category_id,
          cat.name,
          cat.name_en || null,
          cat.description || null,
          cat.description_en || null
        );
      }
    });

    transaction(categories);
    console.error(`✅ ${categories.length}개의 컴포넌트 카테고리 추가 완료`);
  }

  /**
   * 공통컴포넌트 추가
   */
  addCommonComponent(component: Omit<CommonComponent, 'id'>): number {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO common_components 
      (component_id, name, name_en, category_id, package_name, 
       description, description_en, use_tables, version, has_web, added_options)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const info = stmt.run(
      component.component_id,
      component.name,
      component.name_en || null,
      component.category_id,
      component.package_name,
      component.description || null,
      component.description_en || null,
      component.use_tables || null,
      component.version || '4.3.1',
      component.has_web ? 1 : 0,
      component.added_options || null
    );

    return info.lastInsertRowid as number;
  }

  /**
   * 공통컴포넌트 배치 추가
   */
  addCommonComponentsBatch(components: Omit<CommonComponent, 'id'>[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO common_components 
      (component_id, name, name_en, category_id, package_name, 
       description, description_en, use_tables, version, has_web, added_options)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction((list: typeof components) => {
      for (const comp of list) {
        stmt.run(
          comp.component_id,
          comp.name,
          comp.name_en || null,
          comp.category_id,
          comp.package_name,
          comp.description || null,
          comp.description_en || null,
          comp.use_tables || null,
          comp.version || '4.3.1',
          comp.has_web ? 1 : 0,
          comp.added_options || null
        );
      }
    });

    transaction(components);
    console.error(`✅ ${components.length}개의 공통컴포넌트 추가 완료`);
  }

  /**
   * 컴포넌트 의존성 배치 추가
   */
  addComponentDependenciesBatch(dependencies: Omit<ComponentDependency, 'id'>[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO component_dependencies 
      (component_id, depends_on_package)
      VALUES (?, ?)
    `);

    const transaction = this.db.transaction((list: typeof dependencies) => {
      for (const dep of list) {
        stmt.run(dep.component_id, dep.depends_on_package);
      }
    });

    transaction(dependencies);
    console.error(`✅ ${dependencies.length}개의 컴포넌트 의존성 추가 완료`);
  }

  /**
   * components_fts 인덱스를 content 테이블(common_components) 기준으로 전체 재구축.
   *
   * recursive_triggers 가 OFF 였던 과거 연결에서 INSERT OR REPLACE 가 남긴
   * 드리프트(옛 토큰 잔존)를 치유한다. 수백 건 규모라 비용은 무시 가능 —
   * 컴포넌트 메타를 재적재하는 경로(build-index)에서 항상 호출한다.
   */
  rebuildComponentsFts(): void {
    this.db.prepare(`INSERT INTO components_fts(components_fts) VALUES('rebuild')`).run();
    console.error('✅ components_fts 인덱스 재구축 완료');
  }

  /**
   * compatibility_fts 인덱스 전체 재구축 — rebuildComponentsFts 와 동일한
   * 사유의 드리프트 치유. 호환성 데이터를 재적재하는 경로에서 항상 호출한다.
   */
  rebuildCompatibilityFts(): void {
    this.db.prepare(`INSERT INTO compatibility_fts(compatibility_fts) VALUES('rebuild')`).run();
    console.error('✅ compatibility_fts 인덱스 재구축 완료');
  }

  /**
   * 호환성 SW 테이블 비움 — JSON 기준 deterministic 재적재용.
   * (REPLACE 만으로는 원본에서 삭제된 행이 남는다)
   */
  clearCompatibilitySoftware(): void {
    this.db.exec('DELETE FROM compatibility_software;');
    console.error('🧹 호환성 SW 테이블 비움');
  }

  /**
   * 공통컴포넌트 메타(의존성, 컴포넌트, 카테고리, FTS 인덱스) 테이블을 지우고 현재 정의로 다시 만든다
   * — JSON 기준 deterministic 재적재용. (REPLACE 만으로는 원본에서 삭제되거나 id 가 바뀐 행이 남는다)
   *
   * 행만 지우지 않고 테이블째 다시 만드는 이유: CREATE TABLE IF NOT EXISTS 는 이미 있는 테이블의
   * 정의를 바꾸지 않으므로, 이전 스키마(package_name 고유 제약)로 만들어진 DB 에는 한 패키지를
   * 함께 쓰는 컴포넌트를 적재할 수 없다. FTS 인덱스가 본 테이블과 어긋나 있는 DB 에서도 안전하다.
   */
  clearCommonComponents(): void {
    this.db.transaction(() => {
      this.db.exec(`
        DROP TRIGGER IF EXISTS components_ai;
        DROP TRIGGER IF EXISTS components_ad;
        DROP TRIGGER IF EXISTS components_au;
        DROP TABLE IF EXISTS components_fts;
        DROP TABLE IF EXISTS component_dependencies;
        DROP TABLE IF EXISTS common_components;
        DROP TABLE IF EXISTS component_categories;
      `);
      this.initializeTables();
    })();
    console.error('🧹 공통컴포넌트 테이블을 다시 만듦');
  }

  /**
   * 컴포넌트 카테고리 목록 조회
   */
  getComponentCategories(): (ComponentCategory & { component_count: number })[] {
    return this.db.prepare(`
      SELECT cc.*, 
             (SELECT COUNT(*) FROM common_components WHERE category_id = cc.category_id) as component_count
      FROM component_categories cc
      ORDER BY cc.name
    `).all() as (ComponentCategory & { component_count: number })[];
  }

  /**
   * 공통컴포넌트 목록 조회 (카테고리별) — 필터에 맞는 컴포넌트를 배열로 돌려준다.
   * limit 을 생략하면 전체를 돌려준다.
   */
  getCommonComponents(filters: ComponentSearchFilter = {}, limit?: number): CommonComponent[] {
    return this.queryComponents({ filters, limit }).rows;
  }

  /**
   * 컴포넌트 ID로 조회.
   * 앞뒤 공백을 떼고 대소문자를 구분하지 않는다 ('BBS', ' bbs ' → bbs).
   */
  getComponentById(componentId: string): CommonComponent | undefined {
    return this.getComponentByKey('c.component_id', componentId);
  }

  /**
   * 패키지명으로 컴포넌트 조회.
   * 앞뒤 공백을 떼고 대소문자를 구분하지 않는다.
   */
  getComponentByPackage(packageName: string): CommonComponent | undefined {
    return this.getComponentByKey('c.package_name', packageName);
  }

  /**
   * 식별자 컬럼(component_id 또는 package_name)으로 컴포넌트 하나를 찾는다.
   * 대소문자만 다른 값이 함께 있으면 글자가 그대로 같은 행을 고른다.
   * 한 패키지를 함께 쓰는 컴포넌트(게시판과 블로그관리)는 먼저 적재한 것을 고른다.
   */
  private getComponentByKey(column: 'c.component_id' | 'c.package_name', value: string): CommonComponent | undefined {
    const key = trimFilter(value);
    if (!key) {
      return undefined;
    }
    return this.db.prepare(`
      SELECT ${COMPONENT_SEARCH.columns}
      FROM ${COMPONENT_SEARCH.table}
      ${COMPONENT_SEARCH.joins}
      WHERE ${column} = ? COLLATE NOCASE
      ORDER BY (${column} = ?) DESC, c.id
      LIMIT 1
    `).get(key, key) as CommonComponent | undefined;
  }

  /**
   * 컴포넌트 하나를 찾는다 — 호출자가 ID, 패키지명, 이름 가운데 무엇을 넘겼는지 모를 때 쓴다.
   *
   * ID, 패키지명 순으로 찾고, 둘 다 아니면 이름(name) 또는 영문명(name_en)이 정확히 같은
   * 컴포넌트가 하나뿐일 때 그것을 돌려준다. 같은 이름을 쓰는 컴포넌트가 여럿이면 고르지 않는다.
   */
  findComponent(idOrPackageOrName: string): CommonComponent | undefined {
    const byIdentifier = this.getComponentById(idOrPackageOrName) ?? this.getComponentByPackage(idOrPackageOrName);
    if (byIdentifier) {
      return byIdentifier;
    }

    const name = trimFilter(idOrPackageOrName);
    if (!name) {
      return undefined;
    }
    const sameName = this.db.prepare(`
      SELECT ${COMPONENT_SEARCH.columns}
      FROM ${COMPONENT_SEARCH.table}
      ${COMPONENT_SEARCH.joins}
      WHERE c.name = ? COLLATE NOCASE OR c.name_en = ? COLLATE NOCASE
      LIMIT 2
    `).all(name, name) as CommonComponent[];
    return sameName.length === 1 ? sameName[0] : undefined;
  }

  /**
   * 컴포넌트 의존성 조회
   */
  getComponentDependencies(componentId: string): string[] {
    const results = this.db.prepare(`
      SELECT depends_on_package 
      FROM component_dependencies 
      WHERE component_id = ?
    `).all(componentId) as Array<{ depends_on_package: string }>;

    return results.map(r => r.depends_on_package);
  }

  /**
   * 컴포넌트 전체 텍스트 검색 — 키워드로 찾은 컴포넌트를 배열로 돌려준다.
   * 검색 규칙은 queryComponents 와 같고, filters 를 주면 검색 결과에 함께 적용한다.
   * 단, 검색어가 하나도 추출되지 않으면 목록이 아니라 빈 배열을 돌려준다.
   */
  searchComponents(query: string, limit: number = 20, filters: ComponentSearchFilter = {}): CommonComponent[] {
    if (extractSearchTerms(query).length === 0) {
      return [];
    }
    return this.queryComponents({ query, filters, limit }).rows;
  }

  /**
   * 공통컴포넌트 조회 (키워드 + 필터).
   *
   * 필터(categoryId, hasWeb, version, keyword)는 키워드 검색과 같은 SQL 문에서 적용하고
   * LIMIT 은 그 뒤에 적용한다.
   * - query 에서 검색어가 추출되면 키워드 검색(keywordSearch)으로 찾는다. 검색어는 컴포넌트 ID·이름·영문명·
   *   설명·영문 설명·패키지명에 부분 문자열로 들어 있으면 일치한다. 모든 검색어가 일치하는 컴포넌트를 먼저
   *   찾고(all-terms), 그런 컴포넌트가 없으면 대체 검색으로 찾는다(any-term). query 에 단독 낱말 OR 가 있으면
   *   처음부터 검색어 가운데 하나 이상이 일치하는 컴포넌트를 찾는다 (any-term, terms.orQuery).
   * - query 가 없거나 검색어가 하나도 추출되지 않으면 필터에 맞는 컴포넌트를
   *   카테고리·이름 순으로 돌려준다.
   *
   * total 은 조건에 맞는 전체 건수이고, rows 는 그 가운데 앞에서부터 limit 건이다.
   */
  queryComponents(options: ComponentQueryOptions = {}): ComponentQueryResult {
    const filter = this.buildComponentFilter(options.filters ?? {});
    const page: SqlPage = { limit: toSqlLimit(options.limit), offset: 0 };

    const query = parseKeywordQuery(options.query ?? '');
    if (query.terms.length > 0) {
      return this.keywordSearch<CommonComponent>(COMPONENT_SEARCH, query, filter, page);
    }

    const from = `FROM ${COMPONENT_SEARCH.table} ${COMPONENT_SEARCH.joins} WHERE 1=1${filter.sql}`;
    const total = (
      this.db.prepare(`SELECT COUNT(*) AS count ${from}`).get(...filter.params) as { count: number }
    ).count;
    const rows = this.db
      .prepare(
        `SELECT ${COMPONENT_SEARCH.columns} ${from}
         ORDER BY cat.name, c.name, ${COMPONENT_SEARCH.rowid}
         LIMIT ? OFFSET ?`,
      )
      .all(...filter.params, page.limit, page.offset) as CommonComponent[];
    return { rows, total };
  }

  /** 공통컴포넌트 필터를 WHERE 절에 덧붙일 조건으로 바꾼다 (테이블 별칭 c 기준). */
  private buildComponentFilter(filters: ComponentSearchFilter): SqlCondition {
    const clauses: string[] = [];
    const params: unknown[] = [];

    // 카테고리는 ID 뿐 아니라 이름·영문명으로도 지정할 수 있다. 카테고리 목록에 보이는 값
    // 어느 것을 넣어도 찾을 수 있어야 한다 (ID 는 '역할-권한관리', 이름은 '역할/권한관리' 처럼 다를 수 있다).
    const categoryId = trimFilter(filters.categoryId);
    if (categoryId) {
      clauses.push(
        `(c.category_id = ? COLLATE NOCASE OR c.category_id IN (
            SELECT category_id FROM component_categories
            WHERE name = ? COLLATE NOCASE OR name_en = ? COLLATE NOCASE))`,
      );
      params.push(categoryId, categoryId, categoryId);
    }

    if (filters.hasWeb !== undefined) {
      clauses.push('c.has_web = ?');
      params.push(filters.hasWeb ? 1 : 0);
    }

    if (filters.version) {
      clauses.push('c.version = ?');
      params.push(filters.version);
    }

    if (filters.keyword) {
      addContainsClause(clauses, params, ['c.name', 'c.name_en', 'c.description', 'c.package_name'], filters.keyword);
    }

    return { sql: clauses.map((clause) => ` AND ${clause}`).join(''), params };
  }

  /**
   * 의존성 해결 (선택한 컴포넌트들의 모든 의존성 포함)
   *
   * 입력은 컴포넌트 ID 또는 패키지명이다. 앞뒤 공백을 떼고 중복을 없앤 뒤 먼저 컴포넌트 ID 로
   * 해석한다. 해석하지 못한 입력은 notFound 로, 의존 대상으로 적혀 있지만 컴포넌트 행이 없는
   * 패키지는 unresolvedPackages 로 돌려준다.
   */
  resolveDependencies(componentIds: string[]): DependencyResolution {
    // 1) 입력을 컴포넌트 ID 로 해석한다
    const requested: string[] = [];
    const notFound: string[] = [];
    for (const input of new Set(componentIds.map((value) => trimFilter(value)))) {
      if (!input) {
        continue;
      }
      const component = this.getComponentById(input) ?? this.getComponentByPackage(input);
      if (!component) {
        notFound.push(input);
      } else if (!requested.includes(component.component_id)) {
        requested.push(component.component_id);
      }
    }

    // 2) 요청한 컴포넌트에서 출발해 의존 패키지를 따라간다
    const resolved = new Set<string>();
    const packages = new Set<string>();
    const unresolvedPackages = new Set<string>();
    const queue = [...requested];

    while (queue.length > 0) {
      const componentId = queue.shift()!;
      if (resolved.has(componentId)) continue;

      const component = this.getComponentById(componentId);
      if (!component) continue;

      resolved.add(component.component_id);
      if (component.package_name) {
        packages.add(component.package_name);
      }

      for (const dependency of this.getComponentDependencies(component.component_id)) {
        if (packages.has(dependency)) continue;

        const dependencyComponent = this.getComponentByPackage(dependency);
        if (!dependencyComponent) {
          unresolvedPackages.add(dependency);
        } else if (!resolved.has(dependencyComponent.component_id)) {
          queue.push(dependencyComponent.component_id);
        }
      }
    }

    // 자동 추가분은 호출자가 넘긴 문자열이 아니라 해석된 요청 ID 를 기준으로 가린다
    const added = [...resolved].filter((id) => !requested.includes(id));

    return {
      requested,
      resolved: [...resolved],
      added,
      packages: [...packages],
      notFound,
      unresolvedPackages: [...unresolvedPackages],
    };
  }

  /**
   * 컴포넌트 통계 조회
   */
  getComponentSummary(): ComponentSummary {
    const totalCategories = (this.db.prepare(`
      SELECT COUNT(*) as count FROM component_categories
    `).get() as { count: number }).count;

    const totalComponents = (this.db.prepare(`
      SELECT COUNT(*) as count FROM common_components
    `).get() as { count: number }).count;

    const byCategory = this.db.prepare(`
      SELECT c.category_id, cat.name, COUNT(*) as count
      FROM common_components c
      LEFT JOIN component_categories cat ON c.category_id = cat.category_id
      GROUP BY c.category_id
      ORDER BY count DESC
    `).all() as Array<{ category_id: string; name: string; count: number }>;

    const byVersion = this.db.prepare(`
      SELECT version, COUNT(*) as count
      FROM common_components
      GROUP BY version
      ORDER BY version DESC
    `).all() as Array<{ version: string; count: number }>;

    return {
      totalCategories,
      totalComponents,
      byCategory,
      byVersion,
    };
  }

  /**
   * 데이터베이스 닫기
   */
  /**
   * 쿼리 플래너 통계 갱신 + WAL 체크포인트(부속 -wal/-shm 파일 정리).
   * 연결을 유지한 채 수행하므로 외부에서 보관 중인 참조가 무효화되지 않는다.
   */
  optimize(): void {
    this.db.pragma('optimize');
    this.db.pragma('wal_checkpoint(TRUNCATE)');
  }

  /**
   * 배포용 마무리: WAL 을 체크포인트하고 저널 모드를 DELETE 로 되돌린다.
   *
   * WAL 모드로 남은 DB 는 읽기 전용 연결도 -shm/-wal 부속 파일을 만들어야 해서, 쓰기 권한이 없는
   * 설치 위치에서는 열리지 않는다. build-index 가 SQLite 적재를 마친 뒤 닫기 직전에 호출한다.
   * (그 뒤에 쓰기 모드로 다시 열면 생성자가 WAL 로 되돌리므로, 반드시 마지막 단계여야 한다.)
   */
  finalizeForDistribution(): void {
    this.db.pragma('wal_checkpoint(TRUNCATE)');
    this.db.pragma('journal_mode = DELETE');
  }

  close() {
    this.db.close();
    console.error('📦 SQLite 데이터베이스 연결 종료');
  }
}

// ==================== 조회용 도우미 ====================

/** WHERE 절에 덧붙이는 조건. sql 은 비어 있거나 ' AND ...' 로 시작한다. */
interface SqlCondition {
  sql: string;
  params: unknown[];
}

/** 덧붙일 조건이 없는 경우 */
const NO_FILTER: SqlCondition = { sql: '', params: [] };

/** 바인딩 값이 딸린 SQL 조건식 하나. params 는 sql 에 적힌 '?' 의 순서대로다. */
interface SqlExpression {
  sql: string;
  params: unknown[];
}

/** 키워드 검색 대상 하나를 기술하는 SQL 조각. */
interface KeywordSearchTarget {
  /** 조회할 컬럼 목록 */
  columns: string;
  /** 본 테이블과 별칭 */
  table: string;
  /** 조회할 컬럼을 채우는 데 필요한 JOIN (행 수를 바꾸지 않는 것만) */
  joins?: string;
  /** 본 테이블의 키. 정렬의 마지막 기준(동률 해소)으로 쓴다 */
  rowid: string;
  /** 검색어를 찾아보는 컬럼. 이 가운데 하나에 검색어가 부분 문자열로 들어 있으면 그 검색어가 일치한 것이다 */
  searchColumns: string[];
  /** searchColumns 가운데 이름에 해당하는 컬럼. 여기에 일치한 검색어가 많은 행을 먼저 돌려준다 */
  nameColumns: string[];
  /**
   * 부분 문자열이 아닌 규칙으로 검색어와 견주는 컬럼의 조건. 이 가운데 하나를 채워도 그 검색어가 일치한 것이다.
   * 검색어가 어떤 컬럼과 견줄 수 없는 꼴이면 그 컬럼의 조건은 돌려주지 않는다. 그런 컬럼이 없는 대상은 생략한다
   */
  termConditions?: (term: string) => SqlExpression[];
  /**
   * 이 대상의 모든 항목에 해당해 행을 가려 주지 못하는 낱말 (소문자). 언제 검색어에서 빼는지는 selectSearchTerms 가
   * 정한다. 영어 기능어는 어느 대상에나 적용하므로 여기에 넣지 않는다 (utils/fts5Query 의 ENGLISH_FUNCTION_WORDS)
   */
  genericTerms: ReadonlySet<string>;
  /**
   * 기본 정렬. 키워드 검색에서는 selectByMatchedTerms 의 정렬 기준(일치한 검색어 수, 뺀 대상 낱말이 이름에 든 수,
   * 낱말의 처음에서 일치한 영문 검색어 수, 이름에 일치한 검색어 수) 다음에 적용하고, 호환성 소프트웨어는 키워드 없는
   * 필터 조회에도 이 정렬을 쓴다
   */
  defaultOrder: string;
}

/** 검색어 하나를 행과 견주는 조건 */
interface TermMatcher {
  /**
   * 같은 조건인지를 가리는 키. 대체 검색이 같은 꼴이 되는 검색어를 한 번만 쓰는 데 쓴다.
   * 검색어 그대로 견주는 조건은 소문자로 바꾼 검색어이고(LIKE 처럼 ASCII 영문자의 대소문자를 가리지 않는다),
   * 유연한 꼴은 GLOB 패턴이다 ('*' 로 시작하므로 검색어의 키와 겹치지 않는다)
   */
  key: string;
  /** 검색어가 행과 일치한다 */
  matches: SqlExpression;
  /** 검색어가 이름 컬럼(nameColumns)에서 일치한다 (matches 와 같은 방법으로 견준다) */
  inName: SqlExpression;
  /**
   * 검색어가 낱말의 처음에서 일치한다: 검색 컬럼(searchColumns) 가운데 하나에서 값의 맨 앞이거나 바로 앞 글자가
   * ASCII 영문자가 아닌 자리에 들어 있다. 영문 검색어(ASCII 영문자와 숫자로만 되어 있고 영문자가 든 검색어)에만
   * 있고, 한글이나 기호가 든 검색어와 숫자뿐인 검색어는 null 이다
   */
  startsWord: SqlExpression | null;
}

/** 대체 검색이 쓰기로 한 검색어 하나 */
interface UsableTerm {
  /** 검색에 쓰는 꼴의 표기 (조사를 떼어 쓰면 뗀 꼴. 유연한 꼴로 쓰면 그 꼴을 만든 검색어 그대로) */
  form: string;
  /** 그 꼴을 행과 견주는 조건 */
  matcher: TermMatcher;
  /** 필터를 적용한 대상 안에서 그 꼴과 일치하는 행 수 (1 이상) */
  rows: number;
}

/**
 * 검색어의 쓸 꼴을 돌려주는 함수: 필터를 적용한 대상 안에 일치하는 행이 있는 첫 꼴이고, 없으면 null 이다.
 * SQLiteManager 의 formResolver 가 조회 한 번(대상과 필터)에 하나씩 만든다.
 */
type FormResolver = (term: string) => UsableTerm | null;

/**
 * 대체 검색에 쓸 수 있는 검색어를 고른다: 필터를 적용한 대상 안에 일치하는 행이 있는 검색어.
 *
 * 검색어마다 일치하는 행이 있는 첫 꼴을 쓰고(formOf), 어느 꼴도 일치하는 행이 없는 검색어는 쓰지 않는다 (ignored).
 * 쓰는 꼴이 다른 검색어와 같으면 한 번만 쓴다 ('JEUS JEUS는' 의 'JEUS', 'K2Web-Wizard K2Web_Wizard' 의 유연한 꼴).
 * 같은 꼴인지는 견주는 조건의 키(TermMatcher.key)로 가린다.
 */
function usableTerms(terms: string[], formOf: FormResolver): { usable: UsableTerm[]; ignored: string[] } {
  const usable: UsableTerm[] = [];
  const ignored: string[] = [];
  const usedKeys = new Set<string>();
  for (const term of terms) {
    const match = formOf(term);
    if (match === null) {
      ignored.push(term);
    } else if (!usedKeys.has(match.matcher.key)) {
      usedKeys.add(match.matcher.key);
      usable.push(match);
    }
  }
  return { usable, ignored };
}

/** 어떤 행이나 채우는 조건 (필터만 적용한 대상의 행 수를 셀 때 쓴다) */
const EVERY_ROW: SqlExpression = { sql: '1=1', params: [] };

/** 조건 가운데 하나라도 채운다는 조건. 바인딩 값은 조건이 적힌 순서대로 잇는다. */
function anyOf(conditions: SqlExpression[]): SqlExpression {
  return {
    sql: `(${conditions.map((condition) => condition.sql).join(' OR ')})`,
    params: conditions.flatMap((condition) => condition.params),
  };
}

/** 조건마다 채웠으면 1 을 더해, 채운 조건의 수를 세는 식. 바인딩 값은 조건이 적힌 순서대로 잇는다. */
function countOf(conditions: SqlExpression[]): SqlExpression {
  return {
    sql: conditions.map((condition) => `(CASE WHEN ${condition.sql} THEN 1 ELSE 0 END)`).join(' + '),
    params: conditions.flatMap((condition) => condition.params),
  };
}

/**
 * 검색어 하나를 대상의 행과 견주는 조건을 만든다.
 *
 * 검색어는 searchColumns 가운데 하나에 부분 문자열로 들어 있거나 대상이 따로 정한 조건(termConditions)
 * 가운데 하나를 채우면 일치한다. 키워드 검색의 모든 단계(all-terms, any-term, 일치하는 행이 있는 검색어인지의
 * 판정)가 검색어 그대로와 조사를 뗀 꼴을 이 조건으로 견주므로, 일치 규칙을 바꿀 때는 여기만 바꾼다.
 * (구분 기호의 자리를 너그럽게 견주는 유연한 꼴의 조건은 flexibleTermMatcher 가 따로 만든다.)
 *
 * 영문 검색어(isEnglishTerm)에는 낱말의 처음에서 일치했는지를 가리는 조건(startsWord)도 만든다.
 * 정렬에만 쓰고, 행이 일치하는지는 바꾸지 않는다 (selectByMatchedTerms).
 * 대상이 따로 정한 조건(termConditions)은 이 조건에 넣지 않는다. 그 조건이 견주는 프레임워크 버전('4.3')과
 * 확인일자('2025', '2024-11')는 '.' 이나 '-' 가 들었거나 숫자뿐이라 영문 검색어가 아니다.
 *
 * LIKE 패턴을 만들 수 없는 값(containsPattern)은 어떤 행과도 일치하지 않는 것으로 보고 null 을 돌려준다.
 */
function termMatcher(target: KeywordSearchTarget, term: string): TermMatcher | null {
  const pattern = containsPattern(term);
  if (pattern === null) {
    return null;
  }
  return {
    key: term.toLowerCase(),
    matches: anyOf([likeAnyColumn(target.searchColumns, pattern), ...(target.termConditions?.(term) ?? [])]),
    inName: likeAnyColumn(target.nameColumns, pattern),
    startsWord: isEnglishTerm(term) ? wordStartAnyColumn(target.searchColumns, wordStartGlobPattern(term)) : null,
  };
}

/**
 * 검색어의 유연한 꼴을 대상의 행과 견주는 조건을 만든다. 유연한 자리가 없는 검색어는 null 이다.
 *
 * 유연한 꼴은 검색어 안쪽의 '.', '-', '_' 의 자리에 다른 기호나 공백이 오거나 아무것도 오지 않은 표기와도 일치한다
 * (규칙은 utils/fts5Query 의 flexibleForm). 대체 검색이 쓸 꼴을 고를 때만 쓴다 (firstMatchingForm).
 *
 * 검색 컬럼(searchColumns) 가운데 하나에서 두 패턴 가운데 하나와 일치하면 그 검색어가 일치한 것이고,
 * 이름 컬럼에서 일치했는지(inName)도 같은 패턴을 nameColumns 에 견준다.
 * 대상이 따로 정한 조건(termConditions)과 낱말의 처음 조건(startsWord)은 두지 않는다. 프레임워크 버전과
 * 확인일자는 검색어 그대로일 때만 견주고, 유연한 꼴은 낱말의 처음과 끝에서만 일치하도록 패턴이 이미 가린다.
 *
 * GLOB 패턴마다 LIKE 패턴 하나를 짝지어 먼저 견준다 (prefilteredGlobAnyColumn). 유연한 자리에 글자 하나가 온 꼴은
 * 부분 사이를 '_'(아무 글자 하나)로 이은 패턴, 붙은 꼴은 부분을 그대로 이은 패턴이다. GLOB 과 일치하는 값은 반드시
 * 그 LIKE 와도 일치하므로 결과는 달라지지 않는다. 대부분의 값이 LIKE 에서 걸러져, 동봉 데이터에서 유연한 꼴 하나를
 * 호환 소프트웨어 표 전체에 견주는 시간이 1.7ms 남짓에서 0.2ms 남짓으로 줄어든다.
 */
function flexibleTermMatcher(target: KeywordSearchTarget, term: string): TermMatcher | null {
  const form = flexibleForm(term);
  if (form === null) {
    return null;
  }
  const [spaced, joined] = form.patterns;
  const escapedParts = form.parts.map(escapeLikePattern);
  const inAnyOf = (columns: string[]): SqlExpression =>
    anyOf([
      prefilteredGlobAnyColumn(columns, `%${escapedParts.join('_')}%`, spaced),
      prefilteredGlobAnyColumn(columns, `%${escapedParts.join('')}%`, joined),
    ]);
  return {
    key: spaced,
    matches: inAnyOf(target.searchColumns),
    inName: inAnyOf(target.nameColumns),
    startsWord: null,
  };
}

/** 확인일자와 견줄 수 있는 검색어의 꼴: YYYY, YYYY-MM, YYYY-MM-DD */
const DATE_PREFIX_TERM = /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/;

/**
 * 호환성 소프트웨어의 프레임워크 버전과 확인일자를 검색어와 견주는 조건.
 *
 * 응답에 보이는 두 컬럼으로도 찾을 수 있어야 하지만("4.3", "2025"), 부분 문자열로 견주면 버전 숫자가 다른
 * 값의 일부와 우연히 일치한다 ('JEUS 21' 의 '21' 이 확인일자 '2019-03-21' 과, '10' 이 프레임워크 버전 '3.10' 과).
 * - framework_version: 검색어가 그 행의 버전과 같을 때만 일치한다. 검색어는 frameworkVersion 필터와 같은
 *   정규화(normalizeFrameworkVersion)를 거친다 ('v4.3', '4.3.0' → '4.3').
 * - verified_date: 검색어가 YYYY, YYYY-MM, YYYY-MM-DD 꼴일 때만 견주고, 확인일자가 그 값으로 시작하면 일치한다.
 */
function compatibilityTermConditions(term: string): SqlExpression[] {
  const conditions: SqlExpression[] = [
    { sql: 'cs.framework_version = ?', params: [normalizeFrameworkVersion(term)] },
  ];
  if (DATE_PREFIX_TERM.test(term)) {
    // 꼴이 ASCII 숫자와 '-' 뿐이라 글자 수(term.length)가 SQLite 의 substr 이 세는 문자 수와 같다
    conditions.push({ sql: 'substr(cs.verified_date, 1, ?) = ?', params: [term.length, term] });
  }
  return conditions;
}

/**
 * 호환성 소프트웨어를 확인일자가 최근인 순으로 놓는 정렬.
 *
 * verified_date 는 'YYYY-MM-DD' 문자열이라 문자열 내림차순이 곧 최신순이다. 다만 원본 데이터에는 필드가 밀려
 * 이 컬럼에 벤더명이나 URL 이 들어 있는 행이 있고, 그런 값('㈜…', 'https://…')은 문자열 내림차순에서 어떤
 * 날짜보다도 앞에 온다. YYYY-MM-DD 꼴로 시작하는 행을 먼저 놓아 날짜가 아닌 값을 뒤로 보낸다.
 * 데이터는 고치지 않으며, 날짜가 아닌 값끼리는 문자열 내림차순 그대로다.
 */
const COMPATIBILITY_NEWEST_FIRST =
  "(cs.verified_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*') DESC, cs.verified_date DESC";

const COMPATIBILITY_SEARCH: KeywordSearchTarget = {
  // 조회 결과로 내보내는 컬럼만 명시한다. 내부용 id(재구축마다 바뀜)와 created_at(적재 시각)은 넣지 않는다.
  columns: [
    'cs.product_name',
    'cs.product_version',
    'cs.framework_version',
    'cs.category',
    'cs.compatibility_level',
    'cs.vendor',
    'cs.verified_date',
    'cs.description',
    'cs.url',
  ].join(', '),
  table: 'compatibility_software cs',
  rowid: 'cs.id',
  // 제품 버전 표기(product_version, 예: 'JEUS 8')에만 든 낱말로도 찾을 수 있어야 한다
  searchColumns: ['cs.product_name', 'cs.product_version', 'cs.vendor', 'cs.category', 'cs.description'],
  nameColumns: ['cs.product_name', 'cs.product_version'],
  // 프레임워크 버전과 확인일자는 부분 문자열이 아닌 규칙으로 견준다
  termConditions: compatibilityTermConditions,
  // 목록의 모든 행이 이 프레임워크와의 호환성에 관한 것이다 ('eGovFrame 4.3 호환 CMS' 의 'eGovFrame')
  genericTerms: COMPATIBILITY_GENERIC_WORDS,
  defaultOrder: COMPATIBILITY_NEWEST_FIRST,
};

/** 배열을 돌려주는 기존 메서드용: 행 전체(CompatibilitySoftware, id 와 created_at 포함)를 돌려주므로 모든 컬럼을 조회한다. */
const COMPATIBILITY_SEARCH_ALL_COLUMNS: KeywordSearchTarget = { ...COMPATIBILITY_SEARCH, columns: 'cs.*' };

const COMPONENT_SEARCH: KeywordSearchTarget = {
  columns: 'c.*, cat.name as category_name',
  table: 'common_components c',
  joins: 'LEFT JOIN component_categories cat ON c.category_id = cat.category_id',
  rowid: 'c.id',
  searchColumns: ['c.component_id', 'c.name', 'c.name_en', 'c.description', 'c.description_en', 'c.package_name'],
  nameColumns: ['c.component_id', 'c.name', 'c.name_en'],
  // 목록의 모든 항목이 이 프레임워크의 컴포넌트다 ('게시판 컴포넌트' 의 '컴포넌트')
  genericTerms: COMPONENT_GENERIC_WORDS,
  // 이름이 짧을수록 검색어가 이름에서 차지하는 비중이 크다 ('로그인' 에는 '로그인화면이미지관리' 보다 '일반로그인' 이 가깝다).
  // 일치한 검색어 수가 같은 컴포넌트는 이름이 짧은 것부터, 길이도 같으면 컴포넌트 ID 순으로 놓는다
  defaultOrder: 'LENGTH(c.name), c.component_id',
};

/** SQLite 가 허용하는 LIKE 패턴의 최대 길이 (SQLITE_MAX_LIKE_PATTERN_LENGTH 기본값, 바이트). */
const MAX_LIKE_PATTERN_BYTES = 50000;

/**
 * 값(검색어 또는 필터 값)을 부분 문자열로 찾는 LIKE 패턴 (`LIKE ? ESCAPE '\'` 와 함께 쓴다).
 *
 * 아래 값으로는 패턴을 만들 수 없어 null 을 돌려준다. 호출부는 그런 값을 어떤 행과도 일치하지 않는 것으로 다룬다.
 * - NUL 문자가 든 값: SQLite 의 LIKE 는 패턴을 NUL 에서 끊어 읽는다. NUL 뒤가 버려져 값과 다른 패턴이 되고
 *   ('\u0000abc' 는 '%' 만 남는다), 값을 포함하지 않는 행과 일치한다.
 * - 패턴이 SQLite 의 길이 한도를 넘는 값: 조회가 'LIKE or GLOB pattern too complex' 오류로 실패한다.
 */
function containsPattern(value: string): string | null {
  if (value.includes('\u0000')) {
    return null;
  }
  const pattern = `%${escapeLikePattern(value)}%`;
  return Buffer.byteLength(pattern, 'utf8') > MAX_LIKE_PATTERN_BYTES ? null : pattern;
}

/** 컬럼 가운데 하나라도 LIKE 패턴과 일치한다는 조건. 패턴은 컬럼마다 한 번씩 바인딩한다. */
function likeAnyColumn(columns: string[], pattern: string): SqlExpression {
  return {
    sql: `(${columns.map((column) => `${column} LIKE ? ESCAPE '\\'`).join(' OR ')})`,
    params: columns.map(() => pattern),
  };
}

/**
 * 컬럼 가운데 하나라도 검색어가 낱말의 처음에 들어 있다는 조건. pattern 은 wordStartGlobPattern 이 만든 GLOB
 * 패턴이고 컬럼마다 한 번씩 바인딩한다.
 *
 * 값 앞에 공백 한 칸을 붙여 견준다. 값의 맨 앞도 "앞 글자가 ASCII 영문자가 아닌 자리" 가 되어, 패턴 하나로
 * 낱말의 처음을 모두 가린다. 값이 NULL 인 컬럼은 붙인 결과도 NULL 이라 일치하지 않는다.
 */
function wordStartAnyColumn(columns: string[], pattern: string): SqlExpression {
  return {
    sql: `(${columns.map((column) => `(' ' || ${column}) GLOB ?`).join(' OR ')})`,
    params: columns.map(() => pattern),
  };
}

/**
 * 컬럼 가운데 하나라도 유연한 꼴의 GLOB 패턴(flexibleForm 이 만든 것)과 일치한다는 조건.
 * 두 패턴은 컬럼마다 한 번씩, LIKE 패턴과 GLOB 패턴의 순서로 바인딩한다.
 *
 * GLOB 은 값의 앞뒤에 공백 한 칸씩을 붙여 견준다. 값의 맨 앞과 맨 끝도 "영문자가 아닌 글자" 옆이 되어, 패턴이 낱말의
 * 처음과 끝을 한 가지 꼴로 가린다. 값이 NULL 인 컬럼은 일치하지 않는다.
 *
 * likePattern 은 GLOB 과 일치하는 값이라면 반드시 일치하는 느슨한 패턴이다 (`LIKE ? ESCAPE '\'`). GLOB 보다 먼저
 * 견줘, 일치할 수 없는 값에는 공백을 붙이지도 GLOB 을 견주지도 않는다. 문자 집합으로 시작하는 GLOB 패턴은 값의
 * 글자마다 처음부터 다시 견줘야 해서, 첫 글자를 찾아 건너뛰는 LIKE 보다 훨씬 느리다.
 */
function prefilteredGlobAnyColumn(columns: string[], likePattern: string, globPattern: string): SqlExpression {
  return {
    sql: `(${columns
      .map((column) => `(${column} LIKE ? ESCAPE '\\' AND (' ' || ${column} || ' ') GLOB ?)`)
      .join(' OR ')})`,
    params: columns.flatMap(() => [likePattern, globPattern]),
  };
}

/**
 * "컬럼 가운데 하나라도 value 를 부분 문자열로 포함한다" 는 필터 조건을 clauses 와 params 에 덧붙인다.
 * value 로 LIKE 패턴을 만들 수 없으면(containsPattern) 어떤 행과도 일치하지 않는 조건을 덧붙인다.
 * 필터를 빼 버리면 필터를 주지 않은 것과 같은 결과가 나오므로, 조건 자체는 반드시 남긴다.
 */
function addContainsClause(clauses: string[], params: unknown[], columns: string[], value: string): void {
  const pattern = containsPattern(value);
  if (pattern === null) {
    clauses.push('1=0');
    return;
  }
  const condition = likeAnyColumn(columns, pattern);
  clauses.push(condition.sql);
  params.push(...condition.params);
}

/**
 * "업체명 컬럼이 vendor 를 부분 문자열로 포함한다" 는 필터 조건을 clauses 와 params 에 덧붙인다.
 *
 * 필터 값과 컬럼 값 양쪽에서 법인 표기와 공백을 뗀 뒤 비교한다 (utils/vendorName 의 목록을 같은 순서로 적용한다).
 * '㈜아이액츠', '(주)아이액츠', '주식회사 아이액츠', '아이액츠' 가 같은 행을 찾는다. 영문자의 대소문자는 가리지 않는다.
 *
 * 법인 표기와 공백뿐인 값('(주)')은 떼면 남는 것이 없어 모든 행과 일치하게 된다. 그런 값은 그 표기가 적힌 행을
 * 찾는 것으로 보고 떼지 않은 채 글자 그대로 비교한다.
 */
function addVendorClause(clauses: string[], params: unknown[], column: string, vendor: string): void {
  const bare = stripVendorDesignation(vendor);
  if (bare === '') {
    addContainsClause(clauses, params, [column], vendor);
    return;
  }
  const pattern = containsPattern(bare);
  if (pattern === null) {
    clauses.push('1=0');
    return;
  }
  // REPLACE 를 목록의 순서대로 겹친다: 가장 안쪽이 먼저 적용되고, 그 '?' 가 SQL 문에서도 가장 먼저 나온다
  const stripped = VENDOR_IGNORED_SEQUENCES.reduce((expression) => `REPLACE(${expression}, ?, '')`, column);
  clauses.push(`${stripped} LIKE ? ESCAPE '\\'`);
  params.push(...VENDOR_IGNORED_SEQUENCES, pattern);
}

/** 조회할 범위. SQL 의 LIMIT / OFFSET 에 그대로 넣는 정수다. */
interface SqlPage {
  limit: number;
  offset: number;
}

/** SQL LIMIT 에 넣을 값. 생략하면 -1(제한 없음), 그 밖에는 1 이상의 정수로 맞춘다. */
function toSqlLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || Number.isNaN(limit)) {
    return -1;
  }
  return Math.min(Math.max(1, Math.floor(limit)), Number.MAX_SAFE_INTEGER);
}

/** SQL OFFSET 에 넣을 값. 생략하면 0, 그 밖에는 0 이상의 정수로 맞춘다. */
function toSqlOffset(offset: number | undefined): number {
  if (typeof offset !== 'number' || Number.isNaN(offset)) {
    return 0;
  }
  return Math.min(Math.max(0, Math.floor(offset)), Number.MAX_SAFE_INTEGER);
}

/**
 * 한 글자 검색어를 뺀 검색어 목록: 두 글자 이상인 검색어가 하나라도 있으면 한 글자 검색어를 뺀다.
 * 부분 문자열로 찾으면 한 글자는 너무 많은 행과 일치한다 ('JEUS 8' 의 '8' 은 다른 버전의 8 과도 일치한다).
 * 모든 검색어가 일치하는 행을 찾을 때는 한 글자가 결과를 좁히기만 하므로 빼지 않고, 그렇게 해서 찾은 행이
 * 없을 때와 일부 검색어만 일치해도 되는 대체 검색에서 이 목록을 쓴다 (keywordSearch, allTermsStage).
 * 모든 검색어가 한 글자이면 그대로 돌려준다. 글자 수는 코드 포인트로 센다.
 */
function dropSingleCharacterTerms(terms: string[]): string[] {
  const longer = terms.filter((term) => codePointLength(term) >= 2);
  return longer.length > 0 ? longer : terms;
}

/** 문자열 필터 값의 앞뒤 공백을 뗀다. 문자열이 아니거나 비어 있으면 빈 문자열. */
function trimFilter(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** '4.3', '3.10' 같은 버전을 정수 배열로 바꾼다. 그런 꼴이 아니면 null. */
function parseVersion(version: string): number[] | null {
  return /^\d+(\.\d+)*$/.test(version) ? version.split('.').map(Number) : null;
}

/**
 * 버전 문자열을 최신순(내림차순)으로 정렬하는 비교 함수.
 * 자리마다 정수로 비교하고, 버전 꼴이 아닌 값은 뒤로 보낸다.
 */
function compareVersionsDescending(a: string, b: string): number {
  const partsA = parseVersion(a);
  const partsB = parseVersion(b);
  if (partsA && partsB) {
    for (let i = 0; i < Math.max(partsA.length, partsB.length); i += 1) {
      const difference = (partsB[i] ?? 0) - (partsA[i] ?? 0);
      if (difference !== 0) {
        return difference;
      }
    }
    return 0;
  }
  if (partsA) return -1;
  if (partsB) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}
