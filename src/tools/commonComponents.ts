/**
 * 공통컴포넌트 관리 도구
 * 
 * 154종 eGovFrame 공통컴포넌트를 조회, 검색, 의존성 해결하는 기능 제공
 * 소스코드 탐색, DDL/DML 추출 기능 포함
 */

import { SQLiteManager } from '../database/sqliteManager.js';
import { resolveComponentsSrcRoot, resolveSQLiteDbPath } from '../utils/dataPaths.js';
import { UserFacingError } from '../utils/errors.js';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import {
  ComponentCategory,
  CommonComponent,
  ComponentSearchFilter,
  ComponentSummary,
  DependencyResolution,
  KeywordMatchMode,
} from '../types/database.js';
import { extractSearchTerms } from '../utils/fts5Query.js';

const currentFile = fileURLToPath(import.meta.url);
let dbInstance: SQLiteManager | null = null;

function getDB(): SQLiteManager {
  if (!dbInstance) {
    // 검색 서버의 조회 경로이므로 읽기 전용으로 연다
    dbInstance = new SQLiteManager(resolveSQLiteDbPath(currentFile), { readonly: true });
  }
  return dbInstance;
}

/** 공통컴포넌트 소스 루트 디렉토리 (오버레이 우선 → 번들 폴백) */
function getComponentSrcRoot(): string {
  return resolveComponentsSrcRoot(currentFile);
}

/** 지원 DB 종류 */
export const SUPPORTED_DB_TYPES = ['mysql', 'maria', 'oracle', 'postgres', 'tibero', 'cubrid', 'altibase', 'goldilocks'] as const;
export type DbType = typeof SUPPORTED_DB_TYPES[number];

/**
 * 컴포넌트 카테고리 목록 조회
 */
export function listComponentCategories(): {
  categories: (ComponentCategory & { component_count: number })[];
  total: number;
} {
  const db = getDB();
  const categories = db.getComponentCategories();
  
  return {
    categories,
    total: categories.length,
  };
}

/**
 * 공통컴포넌트 목록 조회
 *
 * limit 을 주면 앞에서부터 그만큼만 돌려주고, 주지 않으면 전체를 돌려준다.
 * total 은 limit 과 무관하게 필터에 맞는 전체 건수다.
 */
export function listCommonComponents(filters: ComponentSearchFilter = {}, limit?: number): {
  components: CommonComponent[];
  total: number;
  filters: ComponentSearchFilter;
} {
  const db = getDB();
  const { rows, total } = db.queryComponents({ filters, limit });

  return {
    components: rows,
    total,
    filters,
  };
}

/** 컴포넌트를 찾지 못했을 때 함께 돌려주는 후보의 최대 건수 */
const MAX_COMPONENT_SUGGESTIONS = 5;

/**
 * 컴포넌트 상세 정보 조회
 *
 * componentId 에는 컴포넌트 ID 나 패키지명을 넣는다 (앞뒤 공백과 대소문자는 가리지 않는다).
 * 둘 다 아니면 이름이나 영문명이 정확히 같은 컴포넌트가 하나뿐일 때 그것을 돌려준다.
 * 찾지 못하면 component 는 null 이고, 같은 입력으로 키워드 검색한 상위 5건을 suggestions 로 돌려준다.
 */
export function getComponentInfo(componentId: string): {
  component: CommonComponent | null;
  dependencies: string[];
  dependencyComponents: CommonComponent[];
  suggestions: CommonComponent[];
} {
  const db = getDB();
  const component = db.findComponent(componentId);

  if (!component) {
    return {
      component: null,
      dependencies: [],
      dependencyComponents: [],
      suggestions: db.searchComponents(componentId, MAX_COMPONENT_SUGGESTIONS),
    };
  }

  const dependencies = db.getComponentDependencies(component.component_id);
  const dependencyComponents = dependencies
    .map(pkg => db.getComponentByPackage(pkg))
    .filter((c): c is CommonComponent => c !== undefined);

  return {
    component,
    dependencies,
    dependencyComponents,
    suggestions: [],
  };
}

/**
 * 컴포넌트 검색 (키워드 검색)
 *
 * 모든 검색어가 일치하는 컴포넌트를 먼저 찾고, 없으면 일부 검색어만 일치하는 컴포넌트를 찾는다.
 * filters(categoryId, hasWeb, version, keyword)를 주면 검색 결과에 함께(AND) 적용한다.
 * - total: 일치하는 전체 건수 (results 는 그 가운데 앞에서부터 limit 건)
 * - matchMode: 결과를 찾은 방식 (all-terms: 모든 검색어 일치, any-term: 일부 검색어만 일치).
 *   검색어가 하나도 추출되지 않으면 없다.
 */
export function searchComponents(
  query: string,
  limit: number = 20,
  filters: ComponentSearchFilter = {}
): {
  results: CommonComponent[];
  query: string;
  total: number;
  matchMode?: KeywordMatchMode;
} {
  // 검색어가 하나도 없으면 찾을 것이 없다 (필터만으로 목록을 보려면 listCommonComponents 를 쓴다)
  if (extractSearchTerms(query).length === 0) {
    return { results: [], query, total: 0 };
  }

  // 조회 중 예상하지 못한 오류는 다른 검색으로 바꾸지 않고 그대로 던진다.
  // (검색어 일부만 일치하는 결과로 대체하는 일은 queryComponents 가 matchMode 와 함께 처리한다.)
  const found = getDB().queryComponents({ query, filters, limit });

  return {
    results: found.rows,
    query,
    total: found.total,
    ...(found.matchMode ? { matchMode: found.matchMode } : {}),
  };
}

/**
 * 의존성 해결
 * 선택한 컴포넌트들의 모든 의존성을 해결하여 필요한 전체 컴포넌트 목록 반환
 */
export function resolveDependencies(componentIds: string[]): DependencyResolution {
  const db = getDB();
  return db.resolveDependencies(componentIds);
}

/**
 * 컴포넌트 통계 조회
 */
export function getComponentSummary(): ComponentSummary {
  const db = getDB();
  return db.getComponentSummary();
}

/**
 * 표의 셀에 넣을 문자열로 다듬는다.
 *
 * 줄바꿈은 공백 하나로 바꾸고 '|' 는 이스케이프해, 값 하나가 표의 한 칸에만 들어가게 한다.
 * maxLength 를 주면 그 길이에서 자르고 '...' 를 붙인다. 값이 없거나 비어 있으면 '-' 를 돌려준다.
 */
function tableCell(value: string | null | undefined, maxLength?: number): string {
  let text = (value ?? '').replace(/\s*[\r\n]+\s*/g, ' ').trim();
  if (maxLength !== undefined && text.length > maxLength) {
    text = `${text.slice(0, maxLength)}...`;
  }
  return text === '' ? '-' : text.replace(/\|/g, '\\|');
}

/**
 * 결과 포맷팅 - 카테고리 목록
 *
 * '카테고리 ID' 열의 값이 categoryId 필터에 쓰는 값이다 (이름과 다른 카테고리가 있다).
 */
export function formatCategoryList(
  categories: (ComponentCategory & { component_count: number })[]
): string {
  let output = '## eGovFrame 공통컴포넌트 카테고리\n\n';
  output += `총 **${categories.length}개** 카테고리\n\n`;
  output += '| # | 카테고리 | 카테고리 ID | 영문명 | 컴포넌트 수 |\n';
  output += '|---|----------|-------------|--------|-------------|\n';

  categories.forEach((cat, idx) => {
    output += `| ${idx + 1} | ${tableCell(cat.name)} | \`${tableCell(cat.category_id)}\` | ${tableCell(cat.name_en)} | ${cat.component_count}개 |\n`;
  });
  
  return output;
}

/**
 * 결과 포맷팅 - 컴포넌트 목록
 *
 * 두 표 형식 모두 첫 열에 컴포넌트 ID 를 싣는다. 상세 조회·의존성·소스·DDL/DML 조회에 넣는 값이다.
 * 결과가 없으면 제목 아래에 '검색 결과가 없습니다.' 를 적는다.
 * - options.total: 조건에 맞는 전체 건수. 표시하는 건수보다 크면 제목에 'N개 중 M개 표시' 를 적는다.
 * - options.matchMode: 'any-term' 이면 일부 검색어만 일치한 결과임을 제목 아래에 적는다.
 */
export function formatComponentList(
  components: CommonComponent[],
  groupByCategory: boolean = true,
  options: { total?: number; matchMode?: KeywordMatchMode } = {}
): string {
  const shown = components.length;
  const countLabel =
    options.total !== undefined && options.total > shown ? `${options.total}개 중 ${shown}개 표시` : `${shown}개`;
  let output = `## 공통컴포넌트 목록 (${countLabel})\n\n`;

  // 결과가 없어도 제목은 출력한다 (통합 검색 결과에서 어느 섹션인지 알 수 있어야 한다)
  if (shown === 0) {
    return `${output}검색 결과가 없습니다.\n`;
  }

  if (options.matchMode === 'any-term') {
    output += '> 모든 검색어가 일치하는 컴포넌트가 없어, 일부 검색어만 일치하는 컴포넌트를 표시합니다.\n\n';
  }

  if (groupByCategory) {
    // 카테고리별 그룹핑
    const byCategory = new Map<string, CommonComponent[]>();
    for (const comp of components) {
      const catName = comp.category_name || comp.category_id;
      if (!byCategory.has(catName)) {
        byCategory.set(catName, []);
      }
      byCategory.get(catName)!.push(comp);
    }
    
    for (const [catName, comps] of byCategory) {
      output += `### ${catName} (${comps.length}개)\n\n`;
      output += '| 컴포넌트 ID | 컴포넌트 | 패키지명 | 설명 |\n';
      output += '|-------------|----------|----------|------|\n';
      
      for (const comp of comps) {
        output += `| \`${tableCell(comp.component_id)}\` | ${tableCell(comp.name)} | \`${tableCell(comp.package_name)}\` | ${tableCell(comp.description, 50)} |\n`;
      }
      output += '\n';
    }
  } else {
    output += '| 컴포넌트 ID | 컴포넌트 | 카테고리 | 패키지명 | 버전 |\n';
    output += '|-------------|----------|----------|----------|------|\n';
    
    for (const comp of components) {
      output += `| \`${tableCell(comp.component_id)}\` | ${tableCell(comp.name)} | ${tableCell(comp.category_name || comp.category_id)} | \`${tableCell(comp.package_name)}\` | ${tableCell(comp.version)} |\n`;
    }
  }
  
  return output;
}

/**
 * 결과 포맷팅 - 컴포넌트 상세 정보
 */
export function formatComponentInfo(
  component: CommonComponent,
  dependencies: string[],
  dependencyComponents: CommonComponent[]
): string {
  let output = `## ${component.name}\n\n`;
  
  // 기본 정보
  output += '### 기본 정보\n\n';
  output += `- **ID**: ${component.component_id}\n`;
  output += `- **영문명**: ${component.name_en || '-'}\n`;
  output += `- **카테고리**: ${component.category_name || component.category_id}\n`;
  output += `- **패키지명**: \`${component.package_name}\`\n`;
  output += `- **버전**: ${component.version}\n`;
  output += `- **웹 배포**: ${component.has_web ? 'Yes' : 'No'}\n\n`;
  
  // 설명
  if (component.description) {
    output += '### 설명\n\n';
    output += `${component.description}\n\n`;
  }
  
  // 사용 테이블
  if (component.use_tables) {
    output += '### 사용 테이블\n\n';
    try {
      const tables = JSON.parse(component.use_tables);
      if (Array.isArray(tables) && tables.length > 0) {
        output += '```\n';
        output += tables.join('\n');
        output += '\n```\n\n';
      }
    } catch {
      output += `\`${component.use_tables}\`\n\n`;
    }
  }
  
  // 의존성
  if (dependencies.length > 0) {
    output += `### 의존성 (${dependencies.length}개)\n\n`;
    
    if (dependencyComponents.length > 0) {
      output += '| 패키지 | 컴포넌트명 |\n';
      output += '|--------|------------|\n';
      
      for (const dep of dependencies) {
        const depComp = dependencyComponents.find(c => c.package_name === dep);
        output += `| \`${tableCell(dep)}\` | ${tableCell(depComp?.name)} |\n`;
      }
    } else {
      output += '```\n';
      output += dependencies.join('\n');
      output += '\n```\n';
    }
  }
  
  return output;
}

/** 항목을 한 줄에 하나씩 나열한다. 비어 있으면 '없음' 을 적는다. */
function formatBulletList(items: string[]): string {
  return items.length > 0 ? items.map(item => `- ${item}`).join('\n') : '없음';
}

/**
 * 결과 포맷팅 - 의존성 해결 결과
 *
 * 해석하지 못한 입력(notFound)과 컴포넌트 정보가 없는 의존 패키지(unresolvedPackages)는
 * 있을 때만 출력한다.
 */
export function formatDependencyResolution(resolution: DependencyResolution): string {
  let output = '## 의존성 해결 결과\n\n';

  output += `### 요청한 컴포넌트 (${resolution.requested.length}개)\n\n`;
  output += formatBulletList(resolution.requested);
  output += '\n\n';

  if (resolution.notFound.length > 0) {
    output += `### 찾을 수 없는 입력 (${resolution.notFound.length}개)\n\n`;
    output += '컴포넌트 ID 나 패키지명과 일치하지 않아 결과에 넣지 않았습니다.\n\n';
    output += formatBulletList(resolution.notFound.map(input => input.replace(/\s+/g, ' ')));
    output += '\n\n';
  }

  if (resolution.added.length > 0) {
    output += `### 자동 추가된 의존성 (${resolution.added.length}개)\n\n`;
    output += formatBulletList(resolution.added);
    output += '\n\n';
  }

  output += `### 전체 필요 컴포넌트 (${resolution.resolved.length}개)\n\n`;
  output += formatBulletList(resolution.resolved);
  output += '\n\n';

  output += `### 필요 패키지 목록 (${resolution.packages.length}개)\n\n`;
  if (resolution.packages.length > 0) {
    output += '```\n';
    output += resolution.packages.join('\n');
    output += '\n```\n';
  } else {
    output += '없음\n';
  }

  if (resolution.unresolvedPackages.length > 0) {
    output += `\n### 컴포넌트 정보가 없는 의존 패키지 (${resolution.unresolvedPackages.length}개)\n\n`;
    output += '의존 대상으로 적혀 있지만 컴포넌트 목록에 없어, 위 목록에 넣지 못한 패키지입니다.\n\n';
    output += '```\n';
    output += resolution.unresolvedPackages.join('\n');
    output += '\n```\n';
  }

  return output;
}

/**
 * 결과 포맷팅 - 컴포넌트 통계
 */
export function formatComponentSummary(summary: ComponentSummary): string {
  let output = '## eGovFrame 공통컴포넌트 통계\n\n';
  
  output += `- **총 카테고리**: ${summary.totalCategories}개\n`;
  output += `- **총 컴포넌트**: ${summary.totalComponents}개\n\n`;
  
  output += '### 카테고리별 분포 (상위 10개)\n\n';
  output += '| 카테고리 | 컴포넌트 수 |\n';
  output += '|----------|-------------|\n';
  
  for (const cat of summary.byCategory.slice(0, 10)) {
    output += `| ${tableCell(cat.name || cat.category_id)} | ${cat.count}개 |\n`;
  }
  
  if (summary.byCategory.length > 10) {
    output += `\n*외 ${summary.byCategory.length - 10}개 카테고리*\n`;
  }
  
  output += '\n### 버전별 분포\n\n';
  output += '| 버전 | 컴포넌트 수 |\n';
  output += '|------|-------------|\n';
  
  for (const ver of summary.byVersion) {
    output += `| ${tableCell(ver.version)} | ${ver.count}개 |\n`;
  }
  
  return output;
}


// ================================================================
// Tier 1: 소스코드 탐색
// ================================================================

/**
 * 컴포넌트의 소스 파일 목록 조회
 * 패키지명 기반으로 Java, Mapper XML, JSP, CSS, Config, Message 파일을 탐색
 */
export interface ComponentSourceFiles {
  componentId: string;
  componentName: string;
  packageName: string;
  java: string[];
  mapperXml: string[];
  jsp: string[];
  css: string[];
  images: string[];
  config: string[];
  message: string[];
  total: number;
}

export function getComponentSourceFiles(componentId: string): ComponentSourceFiles | null {
  const db = getDB();
  let component = db.getComponentById(componentId);
  
  if (!component) {
    component = db.getComponentByPackage(componentId);
    if (!component) return null;
  }
  
  const srcRoot = getComponentSrcRoot();
  const pkgName = component.package_name;
  
  // 패키지명에서 상대 경로 추출: egovframework.com.cop.bbs → com/cop/bbs
  const pkgParts = pkgName.split('.');
  const egovIdx = pkgParts.indexOf('egovframework');
  const subPath = egovIdx >= 0 
    ? pkgParts.slice(egovIdx + 1).join('/') 
    : pkgParts.join('/');
  const fullPkgPath = pkgParts.join('/');
  
  // 각 카테고리별 디렉토리에서 파일 탐색
  const java = listFilesRecursive(
    path.join(srcRoot, 'src/main/java', fullPkgPath),
    ['.java']
  );
  
  const mapperXml = listFilesRecursive(
    path.join(srcRoot, 'src/main/resources/egovframework/mapper', subPath),
    ['.xml']
  );
  
  const jsp = listFilesRecursive(
    path.join(srcRoot, 'src/main/webapp/WEB-INF/jsp/egovframework', subPath),
    ['.jsp']
  );
  
  const css = listFilesRecursive(
    path.join(srcRoot, 'src/main/webapp/css/egovframework', subPath),
    ['.css']
  );
  
  const images = listFilesRecursive(
    path.join(srcRoot, 'src/main/webapp/images/egovframework', subPath),
    ['.jpg', '.png', '.gif', '.svg', '.ico']
  );
  
  const config = listFilesRecursive(
    path.join(srcRoot, 'src/main/resources/egovframework/spring/com'),
    ['.xml']
  ).filter(f => {
    // scheduling 파일 중 해당 컴포넌트 관련만 필터
    const basename = path.basename(f).toLowerCase();
    const lastPkg = pkgParts[pkgParts.length - 1];
    const secondLastPkg = pkgParts.length >= 2 ? pkgParts[pkgParts.length - 2] : '';
    return basename.includes(lastPkg) || basename.includes(`${secondLastPkg}-${lastPkg}`);
  });
  
  const message = listFilesRecursive(
    path.join(srcRoot, 'src/main/resources/egovframework/message', subPath),
    ['.properties']
  );
  
  // 모든 경로를 srcRoot 기준 상대 경로로 변환
  const toRelative = (files: string[]) => files.map(f => path.relative(srcRoot, f));
  
  const result: ComponentSourceFiles = {
    componentId: component.component_id,
    componentName: component.name,
    packageName: pkgName,
    java: toRelative(java),
    mapperXml: toRelative(mapperXml),
    jsp: toRelative(jsp),
    css: toRelative(css),
    images: toRelative(images),
    config: toRelative(config),
    message: toRelative(message),
    total: java.length + mapperXml.length + jsp.length + css.length + images.length + config.length + message.length,
  };
  
  return result;
}

/** 디렉토리에서 특정 확장자 파일을 재귀적으로 탐색 */
function listFilesRecursive(dirPath: string, extensions: string[]): string[] {
  if (!fs.existsSync(dirPath)) return [];
  
  const results: string[] = [];
  const items = fs.readdirSync(dirPath, { withFileTypes: true });
  
  for (const item of items) {
    const fullPath = path.join(dirPath, item.name);
    if (item.isDirectory()) {
      results.push(...listFilesRecursive(fullPath, extensions));
    } else if (item.isFile()) {
      const ext = path.extname(item.name).toLowerCase();
      if (extensions.length === 0 || extensions.includes(ext)) {
        results.push(fullPath);
      }
    }
  }
  
  return results.sort();
}

/**
 * 컴포넌트 소스 파일 내용 읽기
 * 보안: common-components-src 디렉토리 내부만 허용
 */
export function readComponentSource(filePath: string): {
  filePath: string;
  content: string;
  language: string;
  size: number;
} | null {
  const srcRoot = getComponentSrcRoot();
  
  // 상대 경로를 절대 경로로 변환
  const absolutePath = path.isAbsolute(filePath) 
    ? filePath 
    : path.resolve(srcRoot, filePath);
  
  // 보안: srcRoot 내부인지 검증
  const normalizedPath = path.normalize(absolutePath);
  const normalizedRoot = path.normalize(srcRoot);
  if (!normalizedPath.startsWith(normalizedRoot)) {
    return null;
  }
  
  if (!fs.existsSync(normalizedPath) || !fs.statSync(normalizedPath).isFile()) {
    return null;
  }
  
  // 바이너리 파일 제외
  const ext = path.extname(normalizedPath).toLowerCase();
  const binaryExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.ico', '.class', '.jar', '.war'];
  if (binaryExtensions.includes(ext)) {
    return {
      filePath: path.relative(srcRoot, normalizedPath),
      content: `[바이너리 파일 - ${ext} 형식은 텍스트로 표시할 수 없습니다]`,
      language: 'binary',
      size: fs.statSync(normalizedPath).size,
    };
  }
  
  const content = fs.readFileSync(normalizedPath, 'utf-8');
  const language = getLanguageFromExtension(ext);
  
  return {
    filePath: path.relative(srcRoot, normalizedPath),
    content,
    language,
    size: content.length,
  };
}

function getLanguageFromExtension(ext: string): string {
  const map: Record<string, string> = {
    '.java': 'java',
    '.xml': 'xml',
    '.jsp': 'jsp',
    '.html': 'html',
    '.css': 'css',
    '.js': 'javascript',
    '.properties': 'properties',
    '.sql': 'sql',
    '.txt': 'text',
  };
  return map[ext] || 'text';
}

/**
 * 컴포넌트 소스 파일 목록 포맷팅
 */
export function formatComponentSourceFiles(result: ComponentSourceFiles): string {
  let output = `## ${result.componentName} 소스 파일 목록\n\n`;
  output += `- **패키지**: \`${result.packageName}\`\n`;
  output += `- **총 파일 수**: ${result.total}개\n\n`;
  
  const sections = [
    { title: 'Java 소스', files: result.java, icon: '☕' },
    { title: 'MyBatis Mapper XML', files: result.mapperXml, icon: '🗄️' },
    { title: 'JSP 뷰', files: result.jsp, icon: '🌐' },
    { title: 'CSS 스타일', files: result.css, icon: '🎨' },
    { title: 'Spring 설정', files: result.config, icon: '⚙️' },
    { title: '메시지 리소스', files: result.message, icon: '📝' },
    { title: '이미지', files: result.images, icon: '🖼️' },
  ];
  
  for (const section of sections) {
    if (section.files.length === 0) continue;
    output += `### ${section.icon} ${section.title} (${section.files.length}개)\n\n`;
    output += '```\n';
    for (const f of section.files) {
      output += `${f}\n`;
    }
    output += '```\n\n';
  }
  
  output += '> 개별 파일 내용은 `egov_search_knowledge` 를 `scope: "components"`, `action: "readSource"`, `filters.filePath: <위 경로>` 로 호출해 조회할 수 있습니다.\n';
  
  return output;
}


// ================================================================
// Tier 2: DB 스크립트 추출
// ================================================================

/** getComponentDDL 의 결과 */
export interface ComponentDDLResult {
  componentId: string;
  componentName: string;
  dbType: string;
  /** 컴포넌트가 사용하는 테이블·뷰 이름 (use_tables) */
  tables: string[];
  ddl: string;
  /** DDL 을 추출한 테이블 수 (뷰 제외) */
  tableCount: number;
  /** DDL 을 추출한 뷰 수 */
  viewCount: number;
  /** tables 가운데 스크립트에서 CREATE TABLE / CREATE VIEW 를 찾지 못한 이름 */
  missing: string[];
}

/**
 * 컴포넌트에 필요한 DDL(CREATE TABLE, CREATE VIEW) 추출
 * useTables 기반으로 해당 테이블·뷰의 DDL만 골라서 반환
 */
export function getComponentDDL(componentId: string, dbType: string = 'mysql'): ComponentDDLResult | null {
  // 지원하지 않는 dbType 은 컴포넌트 없음(null)과 구분되도록 오류로 알린다
  const normalizedDbType = requireDbType(dbType);
  
  const db = getDB();
  let component = db.getComponentById(componentId);
  if (!component) {
    component = db.getComponentByPackage(componentId);
    if (!component) return null;
  }
  
  // useTables 파싱
  let tables: string[] = [];
  if (component.use_tables) {
    try {
      tables = JSON.parse(component.use_tables);
    } catch {
      tables = [];
    }
  }
  
  if (tables.length === 0) {
    return {
      componentId: component.component_id,
      componentName: component.name,
      dbType: normalizedDbType,
      tables: [],
      ddl: '-- 이 컴포넌트에는 사용 테이블이 정의되어 있지 않습니다.',
      tableCount: 0,
      viewCount: 0,
      missing: [],
    };
  }
  
  // DDL 파일 읽기
  const srcRoot = getComponentSrcRoot();
  const ddlFilePath = path.join(srcRoot, 'script', 'ddl', normalizedDbType, `com_DDL_${normalizedDbType}.sql`);
  
  if (!fs.existsSync(ddlFilePath)) {
    return {
      componentId: component.component_id,
      componentName: component.name,
      dbType: normalizedDbType,
      tables,
      ddl: `-- DDL 파일을 찾을 수 없습니다: ${normalizedDbType}`,
      tableCount: 0,
      viewCount: 0,
      missing: [...tables],
    };
  }
  
  const fullDDL = fs.readFileSync(ddlFilePath, 'utf-8');
  const extractedDDL = extractTableDDLs(fullDDL, tables);
  
  return {
    componentId: component.component_id,
    componentName: component.name,
    dbType: normalizedDbType,
    tables,
    ddl: extractedDDL.ddl,
    tableCount: extractedDDL.foundCount,
    viewCount: extractedDDL.viewCount,
    missing: extractedDDL.missing,
  };
}

/**
 * 컴포넌트에 필요한 DML(INSERT 초기 데이터) 추출
 */
export function getComponentDML(componentId: string, dbType: string = 'mysql'): {
  componentId: string;
  componentName: string;
  dbType: string;
  tables: string[];
  dml: string;
  statementCount: number;
} | null {
  // 지원하지 않는 dbType 은 컴포넌트 없음(null)과 구분되도록 오류로 알린다
  const normalizedDbType = requireDbType(dbType);
  
  const db = getDB();
  let component = db.getComponentById(componentId);
  if (!component) {
    component = db.getComponentByPackage(componentId);
    if (!component) return null;
  }
  
  // useTables 파싱
  let tables: string[] = [];
  if (component.use_tables) {
    try {
      tables = JSON.parse(component.use_tables);
    } catch {
      tables = [];
    }
  }
  
  if (tables.length === 0) {
    return {
      componentId: component.component_id,
      componentName: component.name,
      dbType: normalizedDbType,
      tables: [],
      dml: '-- 이 컴포넌트에는 사용 테이블이 정의되어 있지 않습니다.',
      statementCount: 0,
    };
  }
  
  // DML 파일 읽기
  const srcRoot = getComponentSrcRoot();
  const dmlFilePath = path.join(srcRoot, 'script', 'dml', normalizedDbType, `com_DML_${normalizedDbType}.sql`);
  
  if (!fs.existsSync(dmlFilePath)) {
    return {
      componentId: component.component_id,
      componentName: component.name,
      dbType: normalizedDbType,
      tables,
      dml: `-- DML 파일을 찾을 수 없습니다: ${normalizedDbType}`,
      statementCount: 0,
    };
  }
  
  const fullDML = fs.readFileSync(dmlFilePath, 'utf-8');
  const extractedDML = extractTableDMLs(fullDML, tables);
  
  return {
    componentId: component.component_id,
    componentName: component.name,
    dbType: normalizedDbType,
    tables,
    dml: extractedDML.dml,
    statementCount: extractedDML.statementCount,
  };
}

/** DB 타입 별칭 → 정규 이름 */
const DB_TYPE_ALIASES: ReadonlyMap<string, DbType> = new Map<string, DbType>([
  ['mariadb', 'maria'],
  ['postgresql', 'postgres'],
  ['pgsql', 'postgres'],
]);

/**
 * DB 타입 정규화. 지원하지 않는 값이면 null.
 * 지원 목록(배열)과 별칭 Map 만 조회하므로 'constructor', '__proto__' 같은
 * Object.prototype 속성 이름이 지원 타입으로 통과하지 않는다.
 */
export function normalizeDbType(dbType: string): DbType | null {
  if (typeof dbType !== 'string') return null;
  const normalized = dbType.toLowerCase().trim();
  const supported = SUPPORTED_DB_TYPES.find(type => type === normalized);
  return supported ?? DB_TYPE_ALIASES.get(normalized) ?? null;
}

/** 오류 문구에 싣는 dbType 입력값의 최대 길이 */
const DB_TYPE_ECHO_MAX_LENGTH = 40;

/** DB 타입을 정규화하고, 지원하지 않는 값이면 지원 목록을 담은 오류를 던진다 */
function requireDbType(dbType: string): DbType {
  const normalized = normalizeDbType(dbType);
  if (normalized) return normalized;
  
  const given = String(dbType).trim();
  const shown = given.length > DB_TYPE_ECHO_MAX_LENGTH ? `${given.slice(0, DB_TYPE_ECHO_MAX_LENGTH)}…` : given;
  throw new UserFacingError(
    `지원하지 않는 DB 타입입니다: ${shown} ` +
    `(지원: ${SUPPORTED_DB_TYPES.join(', ')}. 별칭: ${[...DB_TYPE_ALIASES.keys()].join(', ')})`
  );
}

/** 추출 중인 CREATE 문 한 개 */
interface DdlBlock {
  kind: 'table' | 'index' | 'view';
  /** 문이 대상으로 삼는 테이블(뷰) 이름 — 대문자 */
  target: string;
  lines: string[];
}

/**
 * CREATE 문의 첫 줄에서 종류와 대상을 읽는다.
 * 대상이 요청 목록에 없거나 추출 대상이 아닌 문이면 null.
 */
function openDdlBlock(trimmedLine: string, upperTableNames: Set<string>): DdlBlock | null {
  const patterns: Array<[DdlBlock['kind'], RegExp]> = [
    // CREATE TABLE TABLENAME
    ['table', /^CREATE\s+TABLE\s+(\w+)/i],
    // CREATE [UNIQUE] INDEX 인덱스명 ON TABLENAME
    ['index', /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+\S+\s+ON\s+(\w+)/i],
    // CREATE [OR REPLACE] VIEW VIEWNAME
    ['view', /^CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(\w+)/i],
  ];
  for (const [kind, pattern] of patterns) {
    const match = trimmedLine.match(pattern);
    if (match) {
      const target = match[1].toUpperCase();
      return upperTableNames.has(target) ? { kind, target, lines: [] } : null;
    }
  }
  return null;
}

/** extractTableDDLs 의 결과 */
export interface ExtractedDDL {
  ddl: string;
  /** CREATE TABLE 을 찾은 테이블 수 */
  foundCount: number;
  /** CREATE VIEW 를 찾은 뷰 수 */
  viewCount: number;
  /** 요청한 이름 가운데 CREATE TABLE / CREATE VIEW 를 찾지 못한 것 (요청한 표기 그대로) */
  missing: string[];
}

/**
 * 전체 DDL에서 특정 테이블·뷰의 CREATE 문 추출
 * CREATE TABLE ~ ; 블록을 파싱하고 해당 테이블의 INDEX도 포함한다.
 * CREATE VIEW 로 정의된 객체는 자신이 조회하는 테이블 뒤에 오도록 맨 끝에 모은다.
 */
export function extractTableDDLs(fullDDL: string, tableNames: string[]): ExtractedDDL {
  const upperTableNames = new Set(tableNames.map(t => t.toUpperCase()));
  const lines = fullDDL.split('\n');
  const tableBlocks: string[] = [];
  const viewBlocks: string[] = [];
  const foundTables = new Set<string>();
  const foundViews = new Set<string>();

  let block: DdlBlock | null = null;

  const closeBlock = (open: DdlBlock) => {
    // 종결자 없이 닫히는 블록은 뒤따른 빈 줄을 떼어 낸다
    while (open.lines.length > 0 && open.lines[open.lines.length - 1].trim() === '') {
      open.lines.pop();
    }
    const text = open.lines.join('\n');
    if (open.kind === 'view') {
      viewBlocks.push(text);
      foundViews.add(open.target);
    } else {
      tableBlocks.push(text);
      if (open.kind === 'table') foundTables.add(open.target);
    }
  };

  for (const line of lines) {
    const trimmedLine = line.trim();

    // 새 CREATE 문 시작 감지
    if (/^CREATE\s/i.test(trimmedLine)) {
      // 종결자를 만나지 못해 열려 있던 블록은 여기서 닫는다 (다음 문을 삼키지 않도록)
      if (block) closeBlock(block);
      block = openDdlBlock(trimmedLine, upperTableNames);
    }

    if (!block) continue;
    block.lines.push(line);

    // 세미콜론으로 문 종료 감지 — 블록을 연 줄도 검사한다 (시작과 끝이 같은 줄인 문)
    if (trimmedLine.endsWith(';')) {
      closeBlock(block);
      block = null;
    }
  }
  if (block) closeBlock(block);

  // 요청한 이름 가운데 정의를 찾지 못한 것 (대소문자만 다른 중복 요청은 한 번만)
  const seen = new Set<string>();
  const missing: string[] = [];
  for (const name of tableNames) {
    const upper = name.toUpperCase();
    if (seen.has(upper)) continue;
    seen.add(upper);
    if (!foundTables.has(upper) && !foundViews.has(upper)) missing.push(name);
  }

  const foundCount = foundTables.size;
  const viewCount = foundViews.size;
  const extractedBlocks = [...tableBlocks, ...viewBlocks];

  if (extractedBlocks.length === 0) {
    return {
      ddl: `-- 요청된 테이블(${tableNames.join(', ')})에 대한 DDL을 찾을 수 없습니다.`,
      foundCount: 0,
      viewCount: 0,
      missing,
    };
  }

  const counts = `테이블 ${foundCount}개` + (viewCount > 0 ? `, 뷰 ${viewCount}개` : '');
  const header = `-- =============================================\n-- 요청 ${seen.size}개 중 ${counts} DDL 추출\n-- 요청: ${tableNames.join(', ')}\n-- =============================================\n`;

  return {
    ddl: header + '\n' + extractedBlocks.join('\n\n\n'),
    foundCount,
    viewCount,
    missing,
  };
}

/**
 * 전체 DML에서 특정 테이블의 INSERT 문 추출
 */
function extractTableDMLs(fullDML: string, tableNames: string[]): { dml: string; statementCount: number } {
  const upperTableNames = new Set(tableNames.map(t => t.toUpperCase()));
  const lines = fullDML.split('\n');
  const extractedLines: string[] = [];
  let statementCount = 0;
  let prevComment = '';
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // 코멘트 라인 보존
    if (trimmedLine.startsWith('--')) {
      prevComment = line;
      continue;
    }
    
    if (trimmedLine === '') {
      prevComment = '';
      continue;
    }
    
    // INSERT INTO TABLENAME 패턴 매칭
    const match = trimmedLine.match(/INSERT\s+INTO\s+(\w+)/i);
    if (match) {
      const tableName = match[1].toUpperCase();
      if (upperTableNames.has(tableName)) {
        // 섹션 코멘트가 있으면 먼저 추가
        if (prevComment && extractedLines.length > 0 && 
            extractedLines[extractedLines.length - 1] !== prevComment) {
          extractedLines.push('');
          extractedLines.push(prevComment);
        } else if (prevComment && extractedLines.length === 0) {
          extractedLines.push(prevComment);
        }
        extractedLines.push(line);
        statementCount++;
      }
    }
    
    prevComment = '';
  }
  
  if (extractedLines.length === 0) {
    return {
      dml: `-- 요청된 테이블(${tableNames.join(', ')})에 대한 초기 데이터가 없습니다.`,
      statementCount: 0,
    };
  }
  
  const header = `-- =============================================\n-- ${tableNames.length}개 테이블 관련 초기 데이터 (${statementCount}건)\n-- 테이블: ${tableNames.join(', ')}\n-- =============================================\n`;
  
  return {
    dml: header + '\n' + extractedLines.join('\n'),
    statementCount,
  };
}

/**
 * DDL 결과 포맷팅
 */
export function formatComponentDDL(result: ComponentDDLResult): string {
  let output = `## ${result.componentName} DDL (${result.dbType})\n\n`;
  output += `- **컴포넌트**: ${result.componentId}\n`;
  output += `- **DB 종류**: ${result.dbType}\n`;
  output += `- **필요 테이블**: ${result.tables.length}개\n`;
  output += `- **추출된 DDL**: ${result.tableCount}개 테이블`;
  if (result.viewCount > 0) {
    output += `, ${result.viewCount}개 뷰`;
  }
  output += '\n';
  if (result.missing.length > 0) {
    // 스크립트에 정의가 없는 이름을 밝혀, 빠진 객체를 호출자가 알 수 있게 한다
    output += `- DDL 을 찾지 못한 객체: ${result.missing.join(', ')}\n`;
  }
  output += '\n```sql\n';
  output += result.ddl;
  output += '\n```\n';
  
  return output;
}

/**
 * DML 결과 포맷팅
 */
export function formatComponentDML(result: {
  componentId: string;
  componentName: string;
  dbType: string;
  tables: string[];
  dml: string;
  statementCount: number;
}): string {
  let output = `## ${result.componentName} 초기 데이터 (${result.dbType})\n\n`;
  output += `- **컴포넌트**: ${result.componentId}\n`;
  output += `- **DB 종류**: ${result.dbType}\n`;
  output += `- **관련 테이블**: ${result.tables.length}개\n`;
  output += `- **INSERT 문**: ${result.statementCount}건\n\n`;
  output += '```sql\n';
  output += result.dml;
  output += '\n```\n';
  
  return output;
}
