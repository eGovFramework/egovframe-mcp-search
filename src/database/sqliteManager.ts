/**
 * SQLite Database Manager
 * 정형 데이터 관리 (호환성 정보, 표준 용어, 단어, 도메인)
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getSQLiteDBPath } from '../utils/projectPath.js';
import { sanitizeFts5MatchQuery } from '../utils/fts5Query.js';
import {
  CompatibilitySoftware,
  StandardTerm,
  StandardWord,
  StandardDomain,
  CompatibilitySearchFilter,
  CompatibilitySummary,
  ComponentCategory,
  CommonComponent,
  ComponentDependency,
  ComponentSearchFilter,
  ComponentSummary,
  DependencyResolution,
} from '../types/database.js';

export class SQLiteManager {
  private db: Database.Database;
  private dbPath: string;

  constructor(dbPath?: string) {
    // 프로젝트 루트 기준의 절대 경로 사용
    // 현재 파일 위치를 기준으로 프로젝트 루트 찾기
    const currentFile = fileURLToPath(import.meta.url);
    this.dbPath = dbPath || getSQLiteDBPath(currentFile);
    
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
    
    this.initializeTables();
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

      -- 표준 용어 테이블
      CREATE TABLE IF NOT EXISTS standard_terms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        korean_name TEXT NOT NULL UNIQUE,
        english_name TEXT NOT NULL,
        description TEXT,
        domain_name TEXT,
        allowed_values TEXT,
        storage_format TEXT,
        display_format TEXT,
        standard_code_name TEXT,
        authority TEXT
      );

      -- 표준 단어 테이블
      CREATE TABLE IF NOT EXISTS standard_words (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        korean_name TEXT NOT NULL UNIQUE,
        english_name TEXT NOT NULL,
        english_full_name TEXT,
        description TEXT,
        is_format_word INTEGER DEFAULT 0,
        domain_category TEXT,
        synonyms TEXT,
        forbidden_words TEXT
      );

      -- 표준 도메인 테이블
      CREATE TABLE IF NOT EXISTS standard_domains (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        domain_name TEXT NOT NULL UNIQUE,
        domain_group TEXT,
        domain_category TEXT,
        description TEXT,
        data_type TEXT NOT NULL,
        data_length TEXT,
        decimal_length TEXT,
        storage_format TEXT,
        display_format TEXT,
        unit TEXT,
        allowed_values TEXT,
        standard_code_name TEXT
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
      CREATE INDEX IF NOT EXISTS idx_term_english 
        ON standard_terms(english_name);
      CREATE INDEX IF NOT EXISTS idx_word_english 
        ON standard_words(english_name);

      -- FTS5 전체 텍스트 검색 테이블 (호환성 소프트웨어)
      CREATE VIRTUAL TABLE IF NOT EXISTS compatibility_fts USING fts5(
        product_name, vendor, category, description,
        content=compatibility_software,
        content_rowid=id
      );

      -- FTS5 트리거 (데이터 동기화)
      CREATE TRIGGER IF NOT EXISTS compatibility_ai AFTER INSERT ON compatibility_software BEGIN
        INSERT INTO compatibility_fts(rowid, product_name, vendor, category, description)
        VALUES (new.id, new.product_name, new.vendor, new.category, new.description);
      END;

      CREATE TRIGGER IF NOT EXISTS compatibility_ad AFTER DELETE ON compatibility_software BEGIN
        DELETE FROM compatibility_fts WHERE rowid = old.id;
      END;

      CREATE TRIGGER IF NOT EXISTS compatibility_au AFTER UPDATE ON compatibility_software BEGIN
        DELETE FROM compatibility_fts WHERE rowid = old.id;
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
      CREATE TRIGGER IF NOT EXISTS components_ai AFTER INSERT ON common_components BEGIN
        INSERT INTO components_fts(rowid, name, name_en, description, description_en, package_name)
        VALUES (new.id, new.name, new.name_en, new.description, new.description_en, new.package_name);
      END;

      CREATE TRIGGER IF NOT EXISTS components_ad AFTER DELETE ON common_components BEGIN
        DELETE FROM components_fts WHERE rowid = old.id;
      END;

      CREATE TRIGGER IF NOT EXISTS components_au AFTER UPDATE ON common_components BEGIN
        DELETE FROM components_fts WHERE rowid = old.id;
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
      sql += ' AND vendor LIKE ?';
      params.push(`%${filters.vendor}%`);
    }

    if (filters.productName) {
      sql += ' AND product_name LIKE ?';
      params.push(`%${filters.productName}%`);
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
    const safe = sanitizeFts5MatchQuery(query);
    if (!safe) {
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
    `).all(safe, limit) as CompatibilitySoftware[];
    } catch {
      return this.fallbackCompatibilityKeywordSearch(safe, limit);
    }
  }

  private fallbackCompatibilityKeywordSearch(sanitizedQuery: string, limit: number): CompatibilitySoftware[] {
    const tokens = sanitizedQuery.split(/\s+/).filter((t) => t.length >= 2).slice(0, 8);
    if (tokens.length === 0) {
      return [];
    }

    const clause = tokens.map(() => '(product_name LIKE ? OR vendor LIKE ? OR description LIKE ? OR category LIKE ?)').join(' OR ');
    const params: string[] = [];
    for (const t of tokens) {
      const p = `%${t}%`;
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

  // ==================== 표준 용어 관리 ====================

  /**
   * 표준 용어 추가
   */
  addStandardTerm(term: Omit<StandardTerm, 'id'>): number {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO standard_terms 
      (korean_name, english_name, description, domain_name, 
       allowed_values, storage_format, display_format, standard_code_name, authority)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const info = stmt.run(
      term.korean_name,
      term.english_name,
      term.description || null,
      term.domain_name || null,
      term.allowed_values || null,
      term.storage_format || null,
      term.display_format || null,
      term.standard_code_name || null,
      term.authority || null
    );

    return info.lastInsertRowid as number;
  }

  /**
   * 표준 용어 배치 추가
   */
  addStandardTermsBatch(terms: Omit<StandardTerm, 'id'>[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO standard_terms 
      (korean_name, english_name, description, domain_name, 
       allowed_values, storage_format, display_format, standard_code_name, authority)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction((list: typeof terms) => {
      for (const term of list) {
        stmt.run(
          term.korean_name,
          term.english_name,
          term.description || null,
          term.domain_name || null,
          term.allowed_values || null,
          term.storage_format || null,
          term.display_format || null,
          term.standard_code_name || null,
          term.authority || null
        );
      }
    });

    transaction(terms);
    console.error(`✅ ${terms.length}개의 표준 용어 추가 완료`);
  }

  /**
   * 표준 용어 검색
   */
  searchStandardTerm(keyword: string, limit: number = 20, offset: number = 0): StandardTerm[] {
    if (!keyword) {
      // 키워드가 없으면 전체 목록 반환 (페이징 지원)
      return this.db.prepare(`
        SELECT * FROM standard_terms
        ORDER BY korean_name
        LIMIT ? OFFSET ?
      `).all(limit, offset) as StandardTerm[];
    }
    return this.db.prepare(`
      SELECT * FROM standard_terms
      WHERE korean_name LIKE ? OR english_name LIKE ? OR description LIKE ?
      ORDER BY korean_name
      LIMIT ? OFFSET ?
    `).all(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, limit, offset) as StandardTerm[];
  }

  /**
   * 한글명으로 표준 용어 조회
   */
  getStandardTermByName(koreanName: string): StandardTerm | undefined {
    return this.db.prepare(`
      SELECT * FROM standard_terms
      WHERE korean_name = ?
    `).get(koreanName) as StandardTerm | undefined;
  }

  /**
   * 표준 용어 전체 텍스트 검색 (FTS5 사용)
   */
  fullTextSearchTerms(query: string, limit: number = 20): StandardTerm[] {
    // FTS5 테이블이 없을 수 있으므로 일반 LIKE 검색 사용
    return this.db.prepare(`
      SELECT * FROM standard_terms
      WHERE korean_name LIKE ? 
         OR english_name LIKE ? 
         OR description LIKE ?
         OR domain_name LIKE ?
         OR standard_code_name LIKE ?
      ORDER BY 
        CASE 
          WHEN korean_name = ? THEN 1
          WHEN english_name = ? THEN 2
          WHEN korean_name LIKE ? THEN 3
          WHEN english_name LIKE ? THEN 4
          ELSE 5
        END,
        korean_name
      LIMIT ?
    `).all(
      `%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`,
      query, query, `${query}%`, `${query}%`,
      limit
    ) as StandardTerm[];
  }

  // ==================== 표준 단어 관리 ====================

  /**
   * 표준 단어 배치 추가
   */
  addStandardWordsBatch(words: Omit<StandardWord, 'id'>[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO standard_words 
      (korean_name, english_name, english_full_name, description, is_format_word, domain_category, synonyms, forbidden_words)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction((list: typeof words) => {
      for (const word of list) {
        stmt.run(
          word.korean_name,
          word.english_name,
          word.english_full_name || null,
          word.description || null,
          word.is_format_word ? 1 : 0,
          word.domain_category || null,
          word.synonyms || null,
          word.forbidden_words || null
        );
      }
    });

    transaction(words);
    console.error(`✅ ${words.length}개의 표준 단어 추가 완료`);
  }

  // ==================== 표준 도메인 관리 ====================

  /**
   * 표준 도메인 배치 추가
   */
  addStandardDomainsBatch(domains: Omit<StandardDomain, 'id'>[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO standard_domains 
      (domain_name, domain_group, domain_category, description, data_type, data_length, decimal_length, storage_format, display_format, unit, allowed_values, standard_code_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction((list: typeof domains) => {
      for (const domain of list) {
        stmt.run(
          domain.domain_name,
          domain.domain_group || null,
          domain.domain_category || null,
          domain.description || null,
          domain.data_type,
          domain.data_length || null,
          domain.decimal_length || null,
          domain.storage_format || null,
          domain.display_format || null,
          domain.unit || null,
          domain.allowed_values || null,
          domain.standard_code_name || null
        );
      }
    });

    transaction(domains);
    console.error(`✅ ${domains.length}개의 표준 도메인 추가 완료`);
  }

  /**
   * 전체 통계
   */
  getOverallStats() {
    return {
      compatibility: this.db.prepare('SELECT COUNT(*) as count FROM compatibility_software').get() as { count: number },
      terms: this.db.prepare('SELECT COUNT(*) as count FROM standard_terms').get() as { count: number },
      words: this.db.prepare('SELECT COUNT(*) as count FROM standard_words').get() as { count: number },
      domains: this.db.prepare('SELECT COUNT(*) as count FROM standard_domains').get() as { count: number },
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
      sql += ' AND (c.name LIKE ? OR c.name_en LIKE ? OR c.description LIKE ? OR c.package_name LIKE ?)';
      const kw = `%${filters.keyword}%`;
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
    const safe = sanitizeFts5MatchQuery(query);
    if (!safe) {
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
    `).all(safe, limit) as CommonComponent[];
    } catch {
      return this.fallbackComponentKeywordSearch(safe, limit);
    }
  }

  private fallbackComponentKeywordSearch(sanitizedQuery: string, limit: number): CommonComponent[] {
    const tokens = sanitizedQuery.split(/\s+/).filter((t) => t.length >= 2).slice(0, 8);
    if (tokens.length === 0) {
      return [];
    }

    const clause = tokens
      .map(() => '(c.name LIKE ? OR c.name_en LIKE ? OR c.description LIKE ? OR c.package_name LIKE ?)')
      .join(' OR ');
    const params: string[] = [];
    for (const t of tokens) {
      const p = `%${t}%`;
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
  close() {
    this.db.close();
    console.error('📦 SQLite 데이터베이스 연결 종료');
  }
}


