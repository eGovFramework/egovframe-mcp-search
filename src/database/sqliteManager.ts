/**
 * SQLite Database Manager
 * 정형 데이터 관리 (호환성 정보, 공통컴포넌트)
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getSQLiteDBPath } from '../utils/projectPath.js';
import { buildFts5MatchQuery, extractSearchTerms } from '../utils/fts5Query.js';
import { escapeLikePattern } from '../utils/sqlLike.js';
import { UserFacingError } from '../utils/errors.js';
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
   * 전체 텍스트 검색 — 모든 검색어가 접두 일치하는 행을 배열로 돌려준다. 행에는 id 와 created_at 도 들어 있다.
   *
   * queryCompatibleSoftware 와 달리 부분 일치 대체 검색으로 넘어가지 않는다. 배열만 돌려주는 이 메서드는
   * 결과를 찾은 방식(matchMode)을 알릴 수 없어, 대체 검색 결과를 돌려주면 호출부가 관련성이 낮은 행을
   * 아무 표시 없이 쓰게 된다. 접두 일치 결과가 없거나 검색어가 하나도 추출되지 않으면 빈 배열을 돌려준다.
   */
  fullTextSearchCompatibility(query: string, limit: number = 20): CompatibilitySoftware[] {
    const terms = extractSearchTerms(query);
    if (terms.length === 0) {
      return [];
    }
    const page: SqlPage = { limit: toSqlLimit(limit), offset: 0 };
    const found = this.allTermsSearch<CompatibilitySoftware>(COMPATIBILITY_SEARCH_ALL_COLUMNS, terms, NO_FILTER, page);
    return found ? found.rows : [];
  }

  /**
   * 호환성 소프트웨어 조회 (키워드 + 필터).
   *
   * 필터는 키워드 검색과 같은 SQL 문에서 적용하고 LIMIT 은 그 뒤에 적용한다.
   * - query 에서 검색어가 추출되면 모든 검색어가 접두 일치하는 행을 먼저 찾고(all-terms),
   *   그런 행이 없으면 일부 검색어가 부분 문자열로 들어 있는 행을 찾는다(any-term).
   * - query 가 없거나 검색어가 하나도 추출되지 않으면("*", "?" 등) 필터에 맞는 행을
   *   확인일자가 최근인 순으로 돌려준다.
   *
   * total 은 같은 조건에 맞는 전체 건수이고, rows 는 그 가운데 offset 부터 limit 건이다.
   * rows 에는 내부용 컬럼(id, created_at)을 넣지 않는다.
   */
  queryCompatibleSoftware(options: CompatibilityQueryOptions = {}): CompatibilityQueryResult {
    return this.selectCompatibleSoftware<CompatibilitySoftwareInfo>(COMPATIBILITY_SEARCH, options);
  }

  /** 호환성 소프트웨어 조회의 본체. target.columns 에 적힌 컬럼을 조회한다. */
  private selectCompatibleSoftware<Row>(
    target: KeywordSearchTarget,
    options: CompatibilityQueryOptions,
  ): { rows: Row[]; total: number; matchMode?: KeywordMatchMode } {
    const filter = this.buildCompatibilityFilter(options.filters ?? {});
    const page: SqlPage = { limit: toSqlLimit(options.limit), offset: toSqlOffset(options.offset) };

    const terms = extractSearchTerms(options.query ?? '');
    if (terms.length > 0) {
      return this.keywordSearch<Row>(target, terms, filter, page);
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

    if (filters.minLevel) {
      clauses.push('cs.compatibility_level >= ?');
      params.push(filters.minLevel);
    }

    const vendor = trimFilter(filters.vendor);
    if (vendor) {
      clauses.push("cs.vendor LIKE ? ESCAPE '\\'");
      params.push(`%${escapeLikePattern(vendor)}%`);
    }

    // 제품명 필터는 버전 표기(product_version, 예: 'JEUS 8.5')와도 비교한다.
    // 조회 결과에 보이는 값을 그대로 넣어도 찾을 수 있어야 한다.
    const productName = trimFilter(filters.productName);
    if (productName) {
      const pattern = `%${escapeLikePattern(productName)}%`;
      clauses.push("(cs.product_name LIKE ? ESCAPE '\\' OR cs.product_version LIKE ? ESCAPE '\\')");
      params.push(pattern, pattern);
    }

    return { sql: clauses.map((clause) => ` AND ${clause}`).join(''), params };
  }

  // ==================== 키워드 검색 공통 ====================

  /**
   * 키워드 검색 (호환성 소프트웨어와 공통컴포넌트가 함께 쓴다).
   *
   * 1) 모든 검색어를 접두 일치 AND 로 묶은 FTS5 MATCH 로 찾는다 (allTermsSearch).
   * 2) 필터까지 적용한 결과가 0건이면 부분 일치 대체 검색(partialTermSearch)으로 넘어간다.
   *    0건인지는 페이지가 아니라 전체 건수로 판단한다 (offset 이 끝을 넘었다고 검색 방식을 바꾸지 않는다).
   */
  private keywordSearch<Row>(
    target: KeywordSearchTarget,
    terms: string[],
    filter: SqlCondition,
    page: SqlPage,
  ): { rows: Row[]; total: number; matchMode: KeywordMatchMode } {
    const allTerms = this.allTermsSearch<Row>(target, terms, filter, page);
    if (allTerms) {
      return { ...allTerms, matchMode: 'all-terms' };
    }
    return { ...this.partialTermSearch<Row>(target, terms, filter, page), matchMode: 'any-term' };
  }

  /**
   * 접두 일치 AND 검색: 모든 검색어가 낱말의 앞부분과 일치하는 행을 FTS5 MATCH 로 찾는다.
   *
   * 필터까지 적용한 결과가 0건이거나 FTS5 가 MATCH 식을 해석하지 못하면 null 을 돌려준다.
   * 그 밖의 오류(잠금, 손상, 테이블 없음 등)는 결과 없음으로 가리지 않고 그대로 던진다.
   */
  private allTermsSearch<Row>(
    target: KeywordSearchTarget,
    terms: string[],
    filter: SqlCondition,
    page: SqlPage,
  ): { rows: Row[]; total: number } | null {
    const match = buildFts5MatchQuery(terms);
    if (!match) {
      return null;
    }

    const from = `FROM ${target.ftsTable} fts
           JOIN ${target.table} ON ${target.rowid} = fts.rowid
           ${target.joins ?? ''}
           WHERE ${target.ftsTable} MATCH ?${filter.sql}`;
    try {
      const total = (
        this.db.prepare(`SELECT COUNT(*) AS count ${from}`).get(match, ...filter.params) as { count: number }
      ).count;
      if (total === 0) {
        return null;
      }
      const rows = this.db
        .prepare(
          `SELECT ${target.columns} ${from}
             ORDER BY rank, ${target.rowid}
             LIMIT ? OFFSET ?`,
        )
        .all(match, ...filter.params, page.limit, page.offset) as Row[];
      return { rows, total };
    } catch (error) {
      // MATCH 식을 FTS5 가 해석하지 못한 경우에만 결과 없음으로 본다.
      if (!isFts5QueryError(error)) {
        throw error;
      }
      return null;
    }
  }

  /**
   * 부분 일치 대체 검색.
   *
   * 각 검색어는 대상 컬럼에 부분 문자열로 들어 있는지로 판정한다. 아래 검색어는 세지 않는다.
   * - 길이가 2 미만인 검색어
   * - 테이블 전체 행의 절반을 넘게 일치하는 검색어 (변별력이 없다)
   * - 필터를 적용한 검색 대상 안에서 일치하는 행이 하나도 없는 검색어
   *   (문장으로 물을 때 섞이는 군말이 일치 기준을 올려 결과를 0건으로 만들지 않게 한다)
   *
   * 남은 검색어가 k 개일 때 ceil(k/2) 개 이상 일치한 행만 돌려준다 (k 가 0 이면 빈 결과).
   * 일치한 검색어 수가 많은 행을 먼저, 그다음은 대상의 기본 정렬을 따른다. 필터는 같은 SQL 문에서 적용한다.
   */
  private partialTermSearch<Row>(
    target: KeywordSearchTarget,
    terms: string[],
    filter: SqlCondition,
    page: SqlPage,
  ): { rows: Row[]; total: number } {
    const termMatches = `(${target.likeColumns.map((column) => `${column} LIKE ? ESCAPE '\\'`).join(' OR ')})`;
    const bindPattern = (pattern: string) => target.likeColumns.map(() => pattern);

    const tableRows = (
      this.db.prepare(`SELECT COUNT(*) AS count FROM ${target.table}`).get() as { count: number }
    ).count;
    const countInTable = this.db.prepare(`SELECT COUNT(*) AS count FROM ${target.table} WHERE ${termMatches}`);
    // 필터가 없으면 검색 대상이 테이블 전체이므로 따로 세지 않는다
    const countInScope = filter.sql
      ? this.db.prepare(
          `SELECT COUNT(*) AS count FROM ${target.table} ${target.joins ?? ''} WHERE ${termMatches}${filter.sql}`,
        )
      : null;

    // 세기로 한 검색어의 LIKE 패턴. 이 배열의 길이가 k 다.
    const patterns: string[] = [];
    for (const term of terms) {
      // 글자 수는 코드 포인트로 센다 (String.length 는 UTF-16 단위라 한 글자가 2 로 나올 수 있다)
      if (Array.from(term).length < 2) {
        continue;
      }
      // LIKE 패턴 길이 한도를 넘는 검색어는 어떤 행과도 일치할 수 없다
      const pattern = containsPattern(term);
      if (pattern === null) {
        continue;
      }
      const params = bindPattern(pattern);
      const inTable = (countInTable.get(...params) as { count: number }).count;
      if (inTable * 2 > tableRows) {
        continue;
      }
      // 테이블 전체에서 일치하는 행이 없으면 필터를 적용한 대상 안에도 없다
      const inScope =
        countInScope && inTable > 0
          ? (countInScope.get(...params, ...filter.params) as { count: number }).count
          : inTable;
      if (inScope === 0) {
        continue;
      }
      patterns.push(pattern);
    }

    if (patterns.length === 0) {
      return { rows: [], total: 0 };
    }
    const required = Math.ceil(patterns.length / 2);

    const matchedTerms = patterns.map(() => `(CASE WHEN ${termMatches} THEN 1 ELSE 0 END)`).join(' + ');
    const matchedTermsParams = patterns.flatMap(bindPattern);
    const from = `FROM ${target.table} ${target.joins ?? ''} WHERE (${matchedTerms}) >= ?${filter.sql}`;
    const fromParams = [...matchedTermsParams, required, ...filter.params];

    const total = (this.db.prepare(`SELECT COUNT(*) AS count ${from}`).get(...fromParams) as { count: number })
      .count;
    if (total === 0) {
      return { rows: [], total: 0 };
    }

    const rows = this.db
      .prepare(
        `SELECT ${target.columns} ${from}
         ORDER BY (${matchedTerms}) DESC, ${target.defaultOrder}, ${target.rowid}
         LIMIT ? OFFSET ?`,
      )
      .all(...fromParams, ...matchedTermsParams, page.limit, page.offset) as Row[];
    return { rows, total };
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
   * 공통컴포넌트 메타(의존성 → 컴포넌트 → 카테고리) 테이블 비움 — JSON 기준 deterministic 재적재용.
   * (REPLACE 만으로는 원본에서 삭제되거나 id 가 바뀐 행이 남는다)
   */
  clearCommonComponents(): void {
    this.db.transaction(() => {
      this.db.exec('DELETE FROM component_dependencies;');
      this.db.exec('DELETE FROM common_components;');
      this.db.exec('DELETE FROM component_categories;');
    })();
    console.error('🧹 공통컴포넌트 테이블 비움');
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
      ORDER BY (${column} = ?) DESC
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
   * - query 에서 검색어가 추출되면 모든 검색어가 접두 일치하는 컴포넌트를 먼저 찾고(all-terms),
   *   그런 컴포넌트가 없으면 일부 검색어가 이름·영문명·설명·패키지명에 부분 문자열로 들어 있는
   *   컴포넌트를 찾는다(any-term).
   * - query 가 없거나 검색어가 하나도 추출되지 않으면 필터에 맞는 컴포넌트를
   *   카테고리·이름 순으로 돌려준다.
   *
   * total 은 조건에 맞는 전체 건수이고, rows 는 그 가운데 앞에서부터 limit 건이다.
   */
  queryComponents(options: ComponentQueryOptions = {}): ComponentQueryResult {
    const filter = this.buildComponentFilter(options.filters ?? {});
    const page: SqlPage = { limit: toSqlLimit(options.limit), offset: 0 };

    const terms = extractSearchTerms(options.query ?? '');
    if (terms.length > 0) {
      return this.keywordSearch<CommonComponent>(COMPONENT_SEARCH, terms, filter, page);
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
      const pattern = `%${escapeLikePattern(filters.keyword)}%`;
      clauses.push(
        "(c.name LIKE ? ESCAPE '\\' OR c.name_en LIKE ? ESCAPE '\\' OR c.description LIKE ? ESCAPE '\\' OR c.package_name LIKE ? ESCAPE '\\')",
      );
      params.push(pattern, pattern, pattern, pattern);
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

/** 키워드 검색 대상 하나를 기술하는 SQL 조각. */
interface KeywordSearchTarget {
  /** 조회할 컬럼 목록 */
  columns: string;
  /** 본 테이블과 별칭. 전체 행 수와 검색어별 일치 행 수도 이 테이블에서 센다 */
  table: string;
  /** 조회할 컬럼을 채우는 데 필요한 JOIN (행 수를 바꾸지 않는 것만) */
  joins?: string;
  /** FTS5 테이블 이름 */
  ftsTable: string;
  /** FTS rowid 와 짝이 되는 본 테이블의 키. 정렬의 마지막 기준(동률 해소)으로도 쓴다 */
  rowid: string;
  /** 부분 일치 대체 검색이 검색어를 찾아보는 컬럼 */
  likeColumns: string[];
  /** 부분 일치 대체 검색에서 일치한 검색어 수 다음에 적용하는 기본 정렬 */
  defaultOrder: string;
}

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
  ftsTable: 'compatibility_fts',
  rowid: 'cs.id',
  likeColumns: ['cs.product_name', 'cs.vendor', 'cs.description', 'cs.category'],
  defaultOrder: 'cs.verified_date DESC',
};

/** 배열을 돌려주는 기존 메서드용: id 로 행을 구분하는 호출부가 있어 모든 컬럼을 조회한다. */
const COMPATIBILITY_SEARCH_ALL_COLUMNS: KeywordSearchTarget = { ...COMPATIBILITY_SEARCH, columns: 'cs.*' };

const COMPONENT_SEARCH: KeywordSearchTarget = {
  columns: 'c.*, cat.name as category_name',
  table: 'common_components c',
  joins: 'LEFT JOIN component_categories cat ON c.category_id = cat.category_id',
  ftsTable: 'components_fts',
  rowid: 'c.id',
  likeColumns: ['c.name', 'c.name_en', 'c.description', 'c.package_name'],
  defaultOrder: 'c.component_id',
};

/** SQLite 가 허용하는 LIKE 패턴의 최대 길이 (SQLITE_MAX_LIKE_PATTERN_LENGTH 기본값, 바이트). */
const MAX_LIKE_PATTERN_BYTES = 50000;

/**
 * 검색어를 부분 문자열로 찾는 LIKE 패턴 (`LIKE ? ESCAPE '\'` 와 함께 쓴다).
 * 패턴이 SQLite 의 길이 한도를 넘으면 null 을 돌려준다. 그런 검색어는 어떤 행과도 일치할 수 없다.
 */
function containsPattern(term: string): string | null {
  const pattern = `%${escapeLikePattern(term)}%`;
  return Buffer.byteLength(pattern, 'utf8') > MAX_LIKE_PATTERN_BYTES ? null : pattern;
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

/** FTS5 가 MATCH 식을 해석하지 못해 낸 오류인지 판별한다. */
function isFts5QueryError(error: unknown): boolean {
  return error instanceof Database.SqliteError && error.message.startsWith('fts5:');
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
