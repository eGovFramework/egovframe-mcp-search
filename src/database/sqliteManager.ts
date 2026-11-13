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
      CREATE TABLE IF NOT EXISTS common_components (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        component_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        name_en TEXT,
        category_id TEXT NOT NULL,
        package_name TEXT UNIQUE,
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
   * 호환성 소프트웨어 검색
   */
  searchCompatibleSoftware(filters: CompatibilitySearchFilter = {}, limit?: number): CompatibilitySoftware[] {
    let sql = 'SELECT * FROM compatibility_software WHERE 1=1';
    const params: any[] = [];

    if (filters.frameworkVersion) {
      sql += ' AND framework_version = ?';
      params.push(filters.frameworkVersion);
    }

    if (filters.category) {
      sql += ' AND category = ?';
      params.push(filters.category);
    }

    if (filters.minLevel) {
      sql += ' AND compatibility_level >= ?';
      params.push(filters.minLevel);
    }

    if (filters.vendor) {
      sql += " AND vendor LIKE ? ESCAPE '\\'";
      params.push(`%${escapeLikePattern(filters.vendor)}%`);
    }

    if (filters.productName) {
      sql += " AND product_name LIKE ? ESCAPE '\\'";
      params.push(`%${escapeLikePattern(filters.productName)}%`);
    }

    sql += ' ORDER BY verified_date DESC';

    if (limit && Number.isFinite(limit) && limit > 0) {
      sql += ' LIMIT ?';
      params.push(Math.floor(limit));
    }

    return this.db.prepare(sql).all(...params) as CompatibilitySoftware[];
  }

  /**
   * 전체 텍스트 검색
   */
  fullTextSearchCompatibility(query: string, limit: number = 20): CompatibilitySoftware[] {
    const terms = extractSearchTerms(query);
    const match = buildFts5MatchQuery(terms);
    if (!match) {
      return [];
    }

    try {
      return this.db.prepare(`
      SELECT cs.* 
      FROM compatibility_fts fts
      JOIN compatibility_software cs ON cs.id = fts.rowid
      WHERE compatibility_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(match, limit) as CompatibilitySoftware[];
    } catch {
      return this.fallbackCompatibilityKeywordSearch(terms, limit);
    }
  }

  private fallbackCompatibilityKeywordSearch(terms: string[], limit: number): CompatibilitySoftware[] {
    const tokens = terms.filter((t) => t.length >= 2).slice(0, 8);
    if (tokens.length === 0) {
      return [];
    }

    const clause = tokens
      .map(() => "(product_name LIKE ? ESCAPE '\\' OR vendor LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\')")
      .join(' OR ');
    const params: string[] = [];
    for (const t of tokens) {
      const p = `%${escapeLikePattern(t)}%`;
      params.push(p, p, p, p);
    }

    return this.db
      .prepare(
        `SELECT * FROM compatibility_software WHERE ${clause} ORDER BY verified_date DESC LIMIT ?`,
      )
      .all(...params, limit) as CompatibilitySoftware[];
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
   * 프레임워크 버전 목록 조회
   */
  getFrameworkVersions(): string[] {
    const results = this.db.prepare(`
      SELECT DISTINCT framework_version FROM compatibility_software
      ORDER BY framework_version DESC
    `).all() as Array<{ framework_version: string }>;

    return results.map(r => r.framework_version);
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
   * 공통컴포넌트 목록 조회 (카테고리별)
   */
  getCommonComponents(filters: ComponentSearchFilter = {}): CommonComponent[] {
    let sql = `
      SELECT c.*, cat.name as category_name
      FROM common_components c
      LEFT JOIN component_categories cat ON c.category_id = cat.category_id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (filters.categoryId) {
      sql += ' AND c.category_id = ?';
      params.push(filters.categoryId);
    }

    if (filters.hasWeb !== undefined) {
      sql += ' AND c.has_web = ?';
      params.push(filters.hasWeb ? 1 : 0);
    }

    if (filters.version) {
      sql += ' AND c.version = ?';
      params.push(filters.version);
    }

    if (filters.keyword) {
      sql += " AND (c.name LIKE ? ESCAPE '\\' OR c.name_en LIKE ? ESCAPE '\\' OR c.description LIKE ? ESCAPE '\\' OR c.package_name LIKE ? ESCAPE '\\')";
      const kw = `%${escapeLikePattern(filters.keyword)}%`;
      params.push(kw, kw, kw, kw);
    }

    sql += ' ORDER BY cat.name, c.name';

    return this.db.prepare(sql).all(...params) as CommonComponent[];
  }

  /**
   * 컴포넌트 ID로 조회
   */
  getComponentById(componentId: string): CommonComponent | undefined {
    return this.db.prepare(`
      SELECT c.*, cat.name as category_name
      FROM common_components c
      LEFT JOIN component_categories cat ON c.category_id = cat.category_id
      WHERE c.component_id = ?
    `).get(componentId) as CommonComponent | undefined;
  }

  /**
   * 패키지명으로 컴포넌트 조회
   */
  getComponentByPackage(packageName: string): CommonComponent | undefined {
    return this.db.prepare(`
      SELECT c.*, cat.name as category_name
      FROM common_components c
      LEFT JOIN component_categories cat ON c.category_id = cat.category_id
      WHERE c.package_name = ?
    `).get(packageName) as CommonComponent | undefined;
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
   * 컴포넌트 전체 텍스트 검색
   */
  searchComponents(query: string, limit: number = 20): CommonComponent[] {
    const terms = extractSearchTerms(query);
    const match = buildFts5MatchQuery(terms);
    if (!match) {
      return [];
    }

    try {
      return this.db.prepare(`
      SELECT c.*, cat.name as category_name
      FROM components_fts fts
      JOIN common_components c ON c.id = fts.rowid
      LEFT JOIN component_categories cat ON c.category_id = cat.category_id
      WHERE components_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(match, limit) as CommonComponent[];
    } catch {
      return this.fallbackComponentKeywordSearch(terms, limit);
    }
  }

  private fallbackComponentKeywordSearch(terms: string[], limit: number): CommonComponent[] {
    const tokens = terms.filter((t) => t.length >= 2).slice(0, 8);
    if (tokens.length === 0) {
      return [];
    }

    const clause = tokens
      .map(() => "(c.name LIKE ? ESCAPE '\\' OR c.name_en LIKE ? ESCAPE '\\' OR c.description LIKE ? ESCAPE '\\' OR c.package_name LIKE ? ESCAPE '\\')")
      .join(' OR ');
    const params: string[] = [];
    for (const t of tokens) {
      const p = `%${escapeLikePattern(t)}%`;
      params.push(p, p, p, p);
    }

    return this.db
      .prepare(
        `
        SELECT c.*, cat.name as category_name
        FROM common_components c
        LEFT JOIN component_categories cat ON c.category_id = cat.category_id
        WHERE ${clause}
        ORDER BY c.component_id
        LIMIT ?
      `,
      )
      .all(...params, limit) as CommonComponent[];
  }

  /**
   * 의존성 해결 (선택한 컴포넌트들의 모든 의존성 포함)
   */
  resolveDependencies(componentIds: string[]): DependencyResolution {
    const resolved = new Set<string>();
    const packages = new Set<string>();
    const queue = [...componentIds];

    while (queue.length > 0) {
      const compId = queue.shift()!;
      if (resolved.has(compId)) continue;

      const component = this.getComponentById(compId);
      if (!component) {
        // 패키지명으로도 시도
        const byPkg = this.getComponentByPackage(compId);
        if (byPkg) {
          resolved.add(byPkg.component_id);
          packages.add(byPkg.package_name);
          const deps = this.getComponentDependencies(byPkg.component_id);
          for (const dep of deps) {
            if (!packages.has(dep)) {
              const depComp = this.getComponentByPackage(dep);
              if (depComp && !resolved.has(depComp.component_id)) {
                queue.push(depComp.component_id);
              }
            }
          }
        }
        continue;
      }

      resolved.add(compId);
      packages.add(component.package_name);

      // 의존성 추가
      const deps = this.getComponentDependencies(compId);
      for (const dep of deps) {
        if (!packages.has(dep)) {
          const depComp = this.getComponentByPackage(dep);
          if (depComp && !resolved.has(depComp.component_id)) {
            queue.push(depComp.component_id);
          }
        }
      }
    }

    const added = [...resolved].filter(id => !componentIds.includes(id));

    return {
      requested: componentIds,
      resolved: [...resolved],
      added,
      packages: [...packages],
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


