/**
 * 공통컴포넌트 관리 도구
 * 
 * eGovFrame 공통컴포넌트를 조회, 검색, 의존성 해결하는 기능 제공
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
 * 검색어는 컴포넌트 ID·이름·영문명·설명·영문 설명·패키지명에 부분 문자열로 들어 있으면 일치한다.
 * 모든 검색어가 일치하는 컴포넌트를 먼저 찾고, 없으면 대체 검색으로 찾는다.
 * filters(categoryId, hasWeb, version, keyword)를 주면 검색 결과에 함께(AND) 적용한다.
 * - total: 일치하는 전체 건수 (results 는 그 가운데 앞에서부터 limit 건)
 * - matchMode: 결과를 찾은 방식 (all-terms: 모든 검색어가 일치하는 컴포넌트, any-term: 그런 컴포넌트가 없어
 *   대체 검색으로 찾은 컴포넌트. 일부 검색어만 일치한다). 검색어가 하나도 추출되지 않으면 없다.
 * - usedTerms, requiredMatches: matchMode 가 any-term 일 때만 있다. 대체 검색에 쓴 검색어(조사를 떼어 쓴
 *   검색어는 뗀 꼴)와, 결과의 컴포넌트마다 일치한 검색어의 최소 수다 (쓴 검색어의 절반을 올림한 수에서 시작해,
 *   그 기준을 채운 컴포넌트가 없으면 1 까지 낮춘 값. 쓴 검색어가 없으면 0).
 * - ignoredTerms: 일치하는 컴포넌트가 없어 검색에 쓰지 않은 검색어 (query 에 적힌 꼴). 그런 검색어가 없으면 없다.
 * - droppedTerms: 일치하는 컴포넌트가 있는지와 관계없이 검색에서 뺀 검색어 (query 에 적힌 꼴). 한 글자 검색어가
 *   여기에 든다: 한 글자 검색어까지 일치하는 컴포넌트가 없으면 두 글자 이상인 검색어만으로 찾는다.
 *   matchMode 가 all-terms 여도 싣고, 뺀 검색어가 없으면 없다.
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
  usedTerms?: string[];
  requiredMatches?: number;
  ignoredTerms?: string[];
  droppedTerms?: string[];
} {
  // 검색어가 하나도 없으면 찾을 것이 없다 (필터만으로 목록을 보려면 listCommonComponents 를 쓴다)
  if (extractSearchTerms(query).length === 0) {
    return { results: [], query, total: 0 };
  }

  // 조회 중 예상하지 못한 오류는 다른 검색으로 바꾸지 않고 그대로 던진다.
  // (대체 검색으로 넘어가는 일은 queryComponents 가 matchMode 와 함께 처리한다.)
  const found = getDB().queryComponents({ query, filters, limit });

  return {
    results: found.rows,
    query,
    total: found.total,
    ...(found.matchMode ? { matchMode: found.matchMode } : {}),
    ...(found.matchMode === 'any-term' && found.terms
      ? { usedTerms: found.terms.used, requiredMatches: found.terms.required }
      : {}),
    ...(found.terms && found.terms.ignored.length > 0 ? { ignoredTerms: found.terms.ignored } : {}),
    ...(found.terms && found.terms.dropped.length > 0 ? { droppedTerms: found.terms.dropped } : {}),
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
 * 대체 검색(any-term)으로 찾은 결과임을 알리는 안내 줄.
 *
 * 쓴 검색어와 일치 기준을 받으면 검색어 몇 개 가운데 몇 개 이상이 든 항목인지와 그 검색어를 적는다.
 * 받지 못하면 지금까지 쓰던 문구("절반 이상")를 그대로 쓴다. 이 문구는 쓴 검색어를 넘기지 않는 호출부를 위한
 * 것이고, 일치 기준은 절반에서 1 까지 낮아질 수 있으므로 기준을 낮춰 찾은 결과에서는 실제 기준과 다를 수 있다.
 */
function anyTermNote(usedTerms: string[] | undefined, requiredMatches: number | undefined): string {
  if (!usedTerms || usedTerms.length === 0 || requiredMatches === undefined) {
    return '> 모든 검색어가 들어 있는 항목이 없어, 검색어의 절반 이상이 들어 있는 항목을 표시합니다.';
  }
  return (
    `> 모든 검색어가 들어 있는 항목이 없어, 검색어 ${usedTerms.length}개 가운데 ${requiredMatches}개 이상이 ` +
    `들어 있는 항목을 표시합니다 (검색어: ${usedTerms.join(', ')}).`
  );
}

/**
 * 결과 포맷팅 - 컴포넌트 목록
 *
 * 두 표 형식 모두 첫 열에 컴포넌트 ID 를 싣는다. 상세 조회·의존성·소스·DDL/DML 조회에 넣는 값이다.
 * 결과가 없으면 제목 아래에 '검색 결과가 없습니다.' 를 적는다.
 * - options.total: 조건에 맞는 전체 건수. 표시하는 건수보다 크면 제목에 'N개 중 M개 표시' 를 적는다.
 * - options.matchMode: 'any-term' 이면 대체 검색으로 찾은 결과임을 제목 아래에 적는다 (결과가 있을 때만).
 * - options.usedTerms, options.requiredMatches: 대체 검색에 쓴 검색어와 적용한 일치 기준. 둘 다 받으면
 *   any-term 안내에 검색어 몇 개 가운데 몇 개 이상이 든 항목인지와 그 검색어를 적는다. 받지 못하면
 *   (쓴 검색어가 비어 있을 때도) 지금까지의 문구("절반 이상")를 그대로 쓴다.
 * - options.ignoredTerms: 일치하는 항목이 없어 검색에 쓰지 않은 낱말. 비어 있지 않으면 any-term 안내 다음에 적는다.
 * - options.droppedTerms: 한 글자라서 검색에서 뺀 낱말. 비어 있지 않으면 위의 안내 다음에 따로 적는다.
 *   모든 검색어가 일치한 결과(all-terms)에도, 결과가 없을 때도 적는다.
 */
export function formatComponentList(
  components: CommonComponent[],
  groupByCategory: boolean = true,
  options: {
    total?: number;
    matchMode?: KeywordMatchMode;
    usedTerms?: string[];
    requiredMatches?: number;
    ignoredTerms?: string[];
    droppedTerms?: string[];
  } = {}
): string {
  const shown = components.length;
  const countLabel =
    options.total !== undefined && options.total > shown ? `${options.total}개 중 ${shown}개 표시` : `${shown}개`;
  let output = `## 공통컴포넌트 목록 (${countLabel})\n\n`;

  // any-term 은 모든 검색어가 든 항목이 없어, 남은 검색어 가운데 일부가 든 항목을 찾았다는 뜻이다.
  // 표시할 항목이 없으면 이 안내는 적지 않는다.
  if (options.matchMode === 'any-term' && shown > 0) {
    output += `${anyTermNote(options.usedTerms, options.requiredMatches)}\n\n`;
  }
  if (options.ignoredTerms && options.ignoredTerms.length > 0) {
    output += `> 일치하는 항목이 없어 검색에 쓰지 않은 낱말: ${options.ignoredTerms.join(', ')}.\n\n`;
  }
  // 일치하는 항목이 있는지와 관계없이 뺀 낱말은 따로 적는다 (위의 낱말과 뺀 이유가 다르다)
  if (options.droppedTerms && options.droppedTerms.length > 0) {
    output += `> 한 글자라서 검색에 쓰지 않은 낱말: ${options.droppedTerms.join(', ')}.\n\n`;
  }

  // 결과가 없어도 제목은 출력한다 (통합 검색 결과에서 어느 섹션인지 알 수 있어야 한다)
  if (shown === 0) {
    return `${output}검색 결과가 없습니다.\n`;
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
 * 공통컴포넌트 소스 트리가 설치되어 있는지 확인한다.
 *
 * 소스 트리는 git 서브모듈이라 저장소만 클론하면 비어 있다. 그대로 두면 sourceFiles,
 * readSource, ddl, dml 이 평범한 "없음" 응답을 돌려줘 원인을 알 수 없으므로,
 * 루트에 pom.xml(오버레이 유효성 판정과 같은 표지)이 없으면 설치 방법을 담은 오류로 알린다.
 */
export function assertComponentSourcesInstalled(srcRoot: string): void {
  if (!fs.existsSync(path.join(srcRoot, 'pom.xml'))) {
    throw new UserFacingError(
      '공통컴포넌트 소스가 설치되어 있지 않습니다. 저장소를 클론해 쓰는 경우 ' +
      'git submodule update --init templates/common-components-src 를 실행하세요.'
    );
  }
}

/** 설치되어 있는지 확인한 공통컴포넌트 소스 루트 */
function requireComponentSrcRoot(): string {
  const srcRoot = getComponentSrcRoot();
  assertComponentSourcesInstalled(srcRoot);
  return srcRoot;
}

/**
 * 컴포넌트의 소스 파일 목록 조회
 * 패키지명 기반으로 Java, Mapper XML, JSP, CSS, JavaScript, Config, Message 파일을 탐색
 */
export interface ComponentSourceFiles {
  componentId: string;
  componentName: string;
  packageName: string;
  java: string[];
  mapperXml: string[];
  jsp: string[];
  css: string[];
  javascript: string[];
  images: string[];
  config: string[];
  message: string[];
  total: number;
}

export function getComponentSourceFiles(componentId: string): ComponentSourceFiles | null {
  const srcRoot = requireComponentSrcRoot();

  const db = getDB();
  let component = db.getComponentById(componentId);

  if (!component) {
    component = db.getComponentByPackage(componentId);
    if (!component) return null;
  }

  return collectComponentSourceFiles(srcRoot, component);
}

/**
 * 소스 루트에서 컴포넌트의 파일을 종류별로 모은다.
 * getComponentSourceFiles 의 본체로, 소스 루트와 컴포넌트 메타데이터를 인자로 받는다.
 */
export function collectComponentSourceFiles(
  srcRoot: string,
  component: Pick<CommonComponent, 'component_id' | 'name' | 'package_name'>
): ComponentSourceFiles {
  const pkgName = component.package_name;

  const pkgParts = pkgName.split('.');
  const subPath = packageSubPath(pkgName);
  const fullPkgPath = pkgParts.join('/');
  const schedulingConfigName = getSchedulingConfigName(pkgParts);

  // 각 카테고리별 디렉토리에서 파일 탐색
  const java = listFilesRecursive(
    path.join(srcRoot, 'src/main/java', fullPkgPath),
    ['.java'],
    srcRoot
  );
  
  const mapperXml = listFilesRecursive(
    path.join(srcRoot, 'src/main/resources/egovframework/mapper', subPath),
    ['.xml'],
    srcRoot
  );
  
  const jsp = listFilesRecursive(
    path.join(srcRoot, 'src/main/webapp/WEB-INF/jsp/egovframework', subPath),
    ['.jsp'],
    srcRoot
  );
  
  const css = listFilesRecursive(
    path.join(srcRoot, 'src/main/webapp/css/egovframework', subPath),
    ['.css'],
    srcRoot
  );
  
  const javascript = listFilesRecursive(
    path.join(srcRoot, 'src/main/webapp/js/egovframework', subPath),
    ['.js'],
    srcRoot
  );

  const images = listFilesRecursive(
    path.join(srcRoot, 'src/main/webapp/images/egovframework', subPath),
    ['.jpg', '.png', '.gif', '.svg', '.ico'],
    srcRoot
  );
  
  const springDir = path.join(srcRoot, 'src/main/resources/egovframework/spring/com');
  const springXml = listFilesRecursive(springDir, ['.xml'], srcRoot);

  // 이 컴포넌트의 스케줄링 설정만 포함한다. 파일 이름이 정확히 일치해야 한다
  // (패키지 마디는 세 글자 코드라 부분 문자열로 고르면 무관한 파일이 섞인다)
  const schedulingConfig = springXml.filter(f => path.basename(f) === schedulingConfigName);

  // ID 생성기 설정(idgn/)은 엔티티 이름을 따서 파일 이름으로는 귀속시킬 수 없다.
  // 컴포넌트가 그 파일이 정의한 빈을 실제로 참조할 때만 포함한다
  const idgnConfig = selectReferencedIdgnConfigs(
    srcRoot,
    springXml.filter(f => path.relative(springDir, f).split(path.sep)[0] === 'idgn'),
    java,
    schedulingConfig
  );

  // spring/com 바로 아래의 설정은 대부분 여러 컴포넌트가 함께 쓰는 전역 설정이다.
  // 파일 이름이 컴포넌트 ID 와 같거나 컴포넌트 패키지의 클래스를 빈으로 정의한 파일만 포함한다
  const ownConfig = selectOwnSpringConfigs(
    srcRoot,
    springXml.filter(f => path.dirname(f) === springDir),
    component.component_id,
    pkgName
  );

  const config = springXml.filter(f => schedulingConfig.includes(f) || idgnConfig.has(f) || ownConfig.has(f));

  const message = listFilesRecursive(
    path.join(srcRoot, 'src/main/resources/egovframework/message', subPath),
    ['.properties'],
    srcRoot
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
    javascript: toRelative(javascript),
    images: toRelative(images),
    config: toRelative(config),
    message: toRelative(message),
    total:
      java.length + mapperXml.length + jsp.length + css.length + javascript.length + images.length + config.length + message.length,
  };
  
  return result;
}

/**
 * 패키지명에서 리소스 디렉토리의 상대 경로를 얻는다: egovframework.com.cop.bbs → com/cop/bbs
 * (Mapper XML, JSP, CSS, JavaScript, 이미지, 메시지가 이 경로 아래에 있다)
 */
function packageSubPath(packageName: string): string {
  const pkgParts = packageName.split('.');
  const egovIdx = pkgParts.indexOf('egovframework');
  return egovIdx >= 0 ? pkgParts.slice(egovIdx + 1).join('/') : pkgParts.join('/');
}

/**
 * 컴포넌트의 스케줄링 설정 파일 이름.
 * 'context-scheduling-' + (egovframework.com 뒤의 패키지 마디를 '-' 로 이은 값) + '.xml'
 * 예: egovframework.com.sym.log.wlg → context-scheduling-sym-log-wlg.xml
 * egovframework.com 아래의 패키지가 아니면 null.
 */
function getSchedulingConfigName(pkgParts: string[]): string | null {
  const egovIdx = pkgParts.indexOf('egovframework');
  const subParts = egovIdx >= 0 && pkgParts[egovIdx + 1] === 'com' ? pkgParts.slice(egovIdx + 2) : [];
  return subParts.length > 0 ? `context-scheduling-${subParts.join('-')}.xml` : null;
}

/** Java 소스가 @Resource(name = "...") 로 주입받는 빈 이름 */
const RESOURCE_NAME_PATTERN = /@Resource\s*\(\s*name\s*=\s*"([^"]+)"/g;

/** Spring 설정 XML 이 ref="..." 로 참조하는 빈 이름 */
const BEAN_REF_PATTERN = /\bref\s*=\s*"([^"]+)"/g;

/** Spring 설정 XML 이 정의하는 빈 이름 (<bean name="..."> 또는 <bean id="...">) */
const BEAN_DEFINITION_PATTERN = /<bean\b[^>]*?\b(?:name|id)\s*=\s*"([^"]+)"/g;

/** Spring 설정 XML 이 정의하는 빈의 클래스 이름 (<bean class="...">) */
const BEAN_CLASS_PATTERN = /<bean(?:\s[^>]*?)?\sclass\s*=\s*"([^"]+)"/g;

/** XML 주석 */
const XML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g;

/** 소스 트리 안의 파일을 UTF-8 텍스트로 읽는다 (파일이 없으면 null) */
function readSourceTreeText(srcRoot: string, filePath: string): string | null {
  return readFromSourceTree(path.relative(srcRoot, filePath), 'file', () =>
    fs.readFileSync(filePath, 'utf-8')
  );
}

/** 소스 트리 안의 파일에서 패턴의 첫 번째 캡처 그룹을 모은다 (파일이 없으면 아무것도 모으지 않는다) */
function collectFromSourceFile(srcRoot: string, filePath: string, pattern: RegExp, into: Set<string>): void {
  const text = readSourceTreeText(srcRoot, filePath);
  if (text === null) return;
  for (const match of text.matchAll(pattern)) {
    into.add(match[1]);
  }
}

/**
 * spring/com 바로 아래의 설정 가운데 이 컴포넌트의 것으로 볼 수 있는 파일을 고른다.
 *
 * 다음 둘 중 하나에 해당하는 파일만 고른다. 파일 이름의 부분 문자열로는 추측하지 않는다.
 * - 파일 이름이 'context-<컴포넌트 ID>.xml' 과 정확히 같다 (대소문자 무시).
 *   예: ldap → context-ldap.xml (컴포넌트 패키지의 빈이 없어 이름으로만 찾을 수 있다)
 * - 파일이 컴포넌트 패키지의 클래스를 빈으로 정의한다 (주석 처리된 정의는 세지 않는다).
 *   예: egovframework.com.cop.ems → context-mail.xml 의 EgovMultiPartEmail 빈
 *
 * 패키지는 '.' 경계까지 비교한다. egovframework.com.cop.bbs 는
 * egovframework.com.cop.bbsx.Foo 의 패키지가 아니다.
 */
function selectOwnSpringConfigs(
  srcRoot: string,
  topLevelFiles: string[],
  componentId: string,
  packageName: string
): Set<string> {
  const selected = new Set<string>();
  const ownFileName = `context-${componentId}.xml`.toLowerCase();
  const classPrefix = `${packageName}.`;

  for (const file of topLevelFiles) {
    if (path.basename(file).toLowerCase() === ownFileName) {
      selected.add(file);
      continue;
    }

    const text = readSourceTreeText(srcRoot, file);
    if (text === null) continue;
    for (const match of text.replace(XML_COMMENT_PATTERN, '').matchAll(BEAN_CLASS_PATTERN)) {
      if (match[1].startsWith(classPrefix)) {
        selected.add(file);
        break;
      }
    }
  }

  return selected;
}

/**
 * ID 생성기 설정 가운데 컴포넌트가 실제로 쓰는 파일을 고른다.
 *
 * 파일이 정의한 빈을 컴포넌트의 Java 소스가 @Resource(name = "...") 로 주입받거나
 * 컴포넌트의 스케줄링 설정이 ref="..." 로 참조할 때만 고른다. 파일 이름으로 추측하지 않는다.
 */
function selectReferencedIdgnConfigs(
  srcRoot: string,
  idgnFiles: string[],
  javaFiles: string[],
  schedulingFiles: string[]
): Set<string> {
  const selected = new Set<string>();
  if (idgnFiles.length === 0) return selected;

  const referenced = new Set<string>();
  for (const file of javaFiles) {
    collectFromSourceFile(srcRoot, file, RESOURCE_NAME_PATTERN, referenced);
  }
  for (const file of schedulingFiles) {
    collectFromSourceFile(srcRoot, file, BEAN_REF_PATTERN, referenced);
  }
  if (referenced.size === 0) return selected;

  for (const file of idgnFiles) {
    const defined = new Set<string>();
    collectFromSourceFile(srcRoot, file, BEAN_DEFINITION_PATTERN, defined);
    if ([...defined].some(name => referenced.has(name))) {
      selected.add(file);
    }
  }

  return selected;
}

/** 대상이 없다고 볼 fs 오류: 없는 경로, 경로 중간이 파일, 디렉토리를 파일로 읽음, 링크 순환 */
const MISSING_PATH_ERROR_CODES: ReadonlySet<string> = new Set([
  'ENOENT',
  'ENOTDIR',
  'EISDIR',
  'ELOOP',
  'ENAMETOOLONG',
]);

/**
 * 소스 트리 안의 파일·디렉토리를 읽는 fs 호출을 감싼다.
 *
 * Node 의 fs 오류 메시지에는 절대 경로가 들어 있어 그대로 내보낼 수 없다.
 * - 대상이 없는 경우는 null (호출한 쪽이 "찾을 수 없음"으로 처리)
 * - 권한 거부는 소스 루트 기준 상대 경로만 담은 UserFacingError
 * - 그 밖의 오류는 그대로 던진다 (서버가 고정 문구로 바꾸고 상세는 stderr 에 남긴다)
 */
function readFromSourceTree<T>(relPath: string, kind: 'file' | 'directory', read: () => T): T | null {
  try {
    return read();
  } catch (error) {
    const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
    if (code !== undefined && MISSING_PATH_ERROR_CODES.has(code)) {
      return null;
    }
    if (code === 'EACCES' || code === 'EPERM') {
      const subject = kind === 'file' ? '파일을' : '디렉토리를';
      throw new UserFacingError(`${subject} 읽을 수 없습니다: ${relPath} (권한 거부)`);
    }
    throw error;
  }
}

/** 디렉토리에서 특정 확장자 파일을 재귀적으로 탐색 (없는 디렉토리는 빈 목록) */
function listFilesRecursive(dirPath: string, extensions: string[], srcRoot: string): string[] {
  const items = readFromSourceTree(path.relative(srcRoot, dirPath), 'directory', () =>
    fs.readdirSync(dirPath, { withFileTypes: true })
  );
  if (!items) return [];

  const results: string[] = [];

  for (const item of items) {
    const fullPath = path.join(dirPath, item.name);
    if (item.isDirectory()) {
      results.push(...listFilesRecursive(fullPath, extensions, srcRoot));
    } else if (item.isFile()) {
      // macOS 의 tar 가 확장 속성을 담아 만드는 AppleDouble 파일("._이름")은 소스가 아니다
      if (item.name.startsWith('._')) continue;
      const ext = path.extname(item.name).toLowerCase();
      if (extensions.length === 0 || extensions.includes(ext)) {
        results.push(fullPath);
      }
    }
  }

  return results.sort();
}

/**
 * readSource 가 한 번에 돌려주는 최대 문자 수.
 *
 * 응답 하나가 MCP 클라이언트의 출력 상한(Claude Code 의 기본값은 25,000 토큰)을 넘지 않게 하는 크기다.
 * 구간의 크기는 호출자가 줄일 수 없으므로 토큰이 많은 내용을 기준으로 잡는다: SQL 스크립트의 대문자 식별자나
 * 압축된 스크립트는 두 글자가 한 토큰쯤 된다. Java, 매퍼 XML, JSP 는 거의 모두 이 크기 안에 들어가 한 번에 읽힌다.
 */
export const SOURCE_READ_MAX_CHARS = 30_000;

/** readComponentSource 의 조회 옵션 */
export interface ReadComponentSourceOptions {
  /**
   * 읽기 시작할 위치 (문자 단위 — JS 문자열 인덱스, 기본 0).
   * 앞선 결과의 nextOffset 을 넘기면 이어서 읽는다.
   */
  offset?: number;
}

/** readSource 가 텍스트로 읽는 인코딩 */
export type SourceTextEncoding = 'utf-8' | 'euc-kr';

/** readComponentSource 의 결과 */
export interface ComponentSourceContent {
  /** 소스 루트 기준 상대 경로 */
  filePath: string;
  /** 이번 호출이 돌려주는 텍스트 (최대 SOURCE_READ_MAX_CHARS 자). 바이너리 파일은 내용 대신 안내 문구 */
  content: string;
  /** 코드 블록 언어. 바이너리 파일은 'binary' */
  language: string;
  /** 파일을 텍스트로 읽은 인코딩. 바이너리 파일은 null */
  encoding: SourceTextEncoding | null;
  /** 파일의 실제 바이트 수 */
  size: number;
  /** content 뒤에 아직 읽지 않은 내용이 남았는지 */
  truncated: boolean;
  /** 파일 전체의 문자 수 (바이너리 파일은 0) */
  totalChars: number;
  /** content 가 시작하는 위치 (문자 단위) */
  offset: number;
  /** 이어 읽을 때 넘길 offset. 남은 내용이 없으면 null */
  nextOffset: number | null;
}

/**
 * 컴포넌트 소스 파일 내용 읽기
 * 보안: common-components-src 디렉토리 내부만 허용하고, 그 안의 저장소 메타데이터(.git)는 읽지 않는다
 *
 * 텍스트는 한 번에 SOURCE_READ_MAX_CHARS 자까지 돌려주고, options.offset 으로 이어 읽는다.
 * UTF-8 로 읽고, UTF-8 이 아니면 EUC-KR 로 읽는다 (어느 쪽으로 읽었는지는 encoding).
 * 바이너리 파일은 내용 없이 메타데이터만 돌려준다.
 */
export function readComponentSource(
  filePath: string,
  options: ReadComponentSourceOptions = {}
): ComponentSourceContent | null {
  return readSourceFileInRoot(requireComponentSrcRoot(), filePath, options);
}

/** 소스 루트 안에서 해석한 파일 경로 */
interface ResolvedSourcePath {
  /** 심볼릭 링크를 모두 푼 실제 경로 */
  realPath: string;
  /** 실제 소스 루트 기준 상대 경로 */
  relPath: string;
}

/** 저장소 메타데이터의 이름: .git 디렉토리, 또는 서브모듈·워크트리의 .git 파일 */
const GIT_METADATA_NAME = '.git';

/**
 * 경로 마디 가운데 이름이 '.git' 인 것이 있는지 (대소문자 무시).
 * .gitignore, .github 처럼 이름이 .git 으로 시작할 뿐인 마디는 해당하지 않는다.
 */
function hasGitMetadataSegment(somePath: string): boolean {
  return somePath.split(/[\\/]/).some(segment => segment.toLowerCase() === GIT_METADATA_NAME);
}

/**
 * 호출자가 준 경로를 소스 루트 안의 실제 경로로 해석한다.
 *
 * 루트와 대상의 심볼릭 링크를 모두 푼 뒤 path.relative 로 포함 여부를 판정한다.
 * 문자열 접두 비교와 달리, 이름만 루트를 접두어로 가진 형제 디렉토리(v-1 과 v-10)나
 * 루트 밖을 가리키는 심볼릭 링크가 통과하지 못한다.
 * 절대 경로 입력, 존재하지 않는 경로, 루트 밖의 경로, 루트 자신은 null.
 *
 * 저장소 메타데이터(.git)도 null 이다. 소스 루트가 독립 클론이면 .git/config 에 원격
 * 주소와 자격증명이 들어 있을 수 있다. 요청 경로와, 심볼릭 링크를 푼 실제 경로(루트 기준
 * 상대 경로)를 모두 검사하므로 루트 안의 링크가 .git 안을 가리켜도 통과하지 못한다.
 */
function resolveSourcePath(srcRoot: string, filePath: string): ResolvedSourcePath | null {
  // 절대 경로는 받지 않는다 (sourceFiles 가 알려 주는 경로는 모두 상대 경로다)
  if (typeof filePath !== 'string' || path.isAbsolute(filePath) || filePath.includes('\0')) {
    return null;
  }
  if (hasGitMetadataSegment(filePath)) {
    return null;
  }

  let realRoot: string;
  let realPath: string;
  try {
    realRoot = fs.realpathSync(srcRoot);
    realPath = fs.realpathSync(path.resolve(realRoot, filePath));
  } catch {
    // 존재하지 않거나 따라갈 수 없는 경로
    return null;
  }

  const relPath = path.relative(realRoot, realPath);
  const outsideRoot = relPath === '..' || relPath.startsWith(`..${path.sep}`) || path.isAbsolute(relPath);
  if (relPath === '' || outsideRoot) {
    return null;
  }
  // 링크를 따라간 끝이 .git 안이면 요청 경로에는 .git 이 없어도 거부한다
  if (hasGitMetadataSegment(relPath)) {
    return null;
  }

  return { realPath, relPath };
}

/** 텍스트로 읽어 볼 인코딩 (앞에서부터 시도한다) */
const SOURCE_TEXT_ENCODINGS: readonly SourceTextEncoding[] = ['utf-8', 'euc-kr'];

/** C1 제어 문자 (U+0080~U+009F). 텍스트 파일에는 나오지 않는다 */
const C1_CONTROL_CHARACTERS = /[\u0080-\u009f]/;

/** 디코딩한 텍스트와 그 인코딩 */
interface DecodedSourceText {
  text: string;
  encoding: SourceTextEncoding;
}

/**
 * 버퍼를 지정한 인코딩으로 디코딩한다. 그 인코딩으로 유효한 바이트열이 아니면 null.
 *
 * ICU 를 빼고 빌드한 Node 처럼 런타임에 그 인코딩의 디코더가 없으면 TextDecoder 생성이
 * RangeError 를 던진다. 그때도 예외를 전파하지 않고 null 을 돌려준다.
 */
function decodeStrict(buffer: Buffer, encoding: SourceTextEncoding): string | null {
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
}

/**
 * 버퍼를 텍스트로 디코딩한다. 텍스트가 아니면 null.
 *
 * 확장자가 아니라 내용으로 판정한다: NUL 바이트가 있으면 바이너리다. 없으면 UTF-8 로,
 * UTF-8 로 유효하지 않으면 EUC-KR 로 디코딩해 보고(EUC-KR 로 남아 있는 오래된 JSP 가
 * 있다) 둘 다 실패하거나 EUC-KR 디코딩 결과에 C1 제어 문자가 섞이면 바이너리다. 확장자 목록에 없는 글꼴(.ttf, .woff)·문서(.hwp, .xls)도
 * 걸러지고, 텍스트인 .svg 는 읽을 수 있다. 맨 앞의 UTF-8 BOM 은 디코더가 떼어 낸다.
 */
function decodeSourceText(buffer: Buffer): DecodedSourceText | null {
  if (buffer.includes(0)) return null;
  for (const encoding of SOURCE_TEXT_ENCODINGS) {
    const text = decodeStrict(buffer, encoding);
    if (text === null) continue;
    // ICU 의 EUC-KR 디코더는 0x80~0x9F 단독 바이트를 오류 없이 C1 제어 문자로 바꾼다.
    // 실제 EUC-KR 텍스트에는 없는 글자이므로, 이 글자가 나오면 텍스트가 아닌 바이트열로 본다.
    if (encoding !== 'utf-8' && C1_CONTROL_CHARACTERS.test(text)) continue;
    return { text, encoding };
  }
  return null;
}

/** offset 을 0 이상 totalChars 이하의 정수로 맞춘다 (유한한 숫자가 아니면 0) */
function normalizeCharOffset(offset: number | undefined, totalChars: number): number {
  if (typeof offset !== 'number' || !Number.isFinite(offset)) return 0;
  return Math.min(totalChars, Math.max(0, Math.floor(offset)));
}

/** UTF-16 상위 서로게이트(쌍의 앞쪽 절반)인지 */
function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

/**
 * 소스 루트를 인자로 받는 readComponentSource 의 본체.
 * 루트 밖의 파일은 읽지 않으며, 찾을 수 없거나 읽으면 안 되는 경로에는 null 을 돌려준다.
 */
export function readSourceFileInRoot(
  srcRoot: string,
  filePath: string,
  options: ReadComponentSourceOptions = {}
): ComponentSourceContent | null {
  // 보안: srcRoot 내부의 실제 경로인지 검증
  const resolved = resolveSourcePath(srcRoot, filePath);
  if (!resolved) return null;
  const { realPath, relPath } = resolved;

  // 일반 파일만 읽는다 (디렉토리 등은 찾을 수 없음)
  const file = readFromSourceTree(relPath, 'file', () => {
    const stat = fs.statSync(realPath);
    return stat.isFile() ? { size: stat.size, buffer: fs.readFileSync(realPath) } : null;
  });
  if (!file) return null;

  const decoded = decodeSourceText(file.buffer);

  // 바이너리 파일은 내용 없이 메타데이터만 돌려준다.
  // 안내 문구는 UTF-8 만 말한다: EUC-KR 디코더가 없는 런타임에서는 EUC-KR 텍스트도 여기로 온다
  if (decoded === null) {
    return {
      filePath: relPath,
      content: '[바이너리 파일 - UTF-8 텍스트가 아니어서 내용을 표시하지 않습니다]',
      language: 'binary',
      encoding: null,
      size: file.size,
      truncated: false,
      totalChars: 0,
      offset: 0,
      nextOffset: null,
    };
  }

  // 텍스트는 offset 부터 상한까지만 돌려준다 (위치와 길이는 디코딩한 문자열 기준)
  const { text, encoding } = decoded;
  const totalChars = text.length;
  const offset = normalizeCharOffset(options.offset, totalChars);
  let end = Math.min(totalChars, offset + SOURCE_READ_MAX_CHARS);
  // 서로게이트 쌍(이모지 등)의 한가운데에서 자르지 않는다
  if (end < totalChars && end - offset > 1 && isHighSurrogate(text.charCodeAt(end - 1))) {
    end -= 1;
  }
  const truncated = end < totalChars;

  return {
    filePath: relPath,
    content: text.slice(offset, end),
    language: getLanguageFromExtension(path.extname(realPath).toLowerCase()),
    encoding,
    // 디코딩한 문자 수가 아니라 파일의 실제 바이트 수
    size: file.size,
    truncated,
    totalChars,
    offset,
    nextOffset: truncated ? end : null,
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
    { title: 'JavaScript', files: result.javascript, icon: '📜' },
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
  // 목록이 완전하다고 오해하지 않도록 수집 범위를 밝힌다
  output += `>\n> 이 목록은 패키지 경로(\`${packageSubPath(result.packageName)}\`)와 같은 디렉토리에 있는 파일과 이 컴포넌트에 귀속되는 Spring 설정만 싣습니다. 다른 경로에 있는 파일(다른 컴포넌트의 화면·스크립트·메시지, 전역 Spring 설정, 프로퍼티 파일)은 이 컴포넌트가 쓰더라도 나오지 않습니다.\n`;
  
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
  /** tables 에는 없지만 외래 키가 참조해서 DDL 을 함께 실은 테이블 (찾은 순서, 대문자) */
  referencedTables: string[];
  /** ALTER 문으로 따로 실은 외래 키 제약의 수 (외래 키를 CREATE TABLE 밖에 두는 DB 의 스크립트) */
  foreignKeyCount: number;
}

/**
 * 컴포넌트에 필요한 DDL(CREATE TABLE, CREATE VIEW) 추출
 * useTables 기반으로 해당 테이블·뷰의 DDL만 골라서 반환한다.
 *
 * 받은 DDL 을 그대로 실행할 수 있도록 외래 키를 따라간다:
 * - 외래 키가 참조하는 테이블이 useTables 에 없으면 그 테이블의 DDL 도 함께 싣는다 (참조를 이어서 따라간다).
 * - 외래 키를 CREATE TABLE 안이 아니라 ALTER 문으로 따로 두는 DB(cubrid 는 초기 데이터 스크립트의 끝)는
 *   결과에 실린 테이블 사이의 제약을 DDL 끝에 싣는다.
 */
export function getComponentDDL(componentId: string, dbType: string = 'mysql'): ComponentDDLResult | null {
  // 지원하지 않는 dbType 은 컴포넌트 없음(null)과 구분되도록 오류로 알린다
  const normalizedDbType = requireDbType(dbType);
  // 소스 트리가 없으면 컴포넌트를 조회하기 전에 알린다
  const srcRoot = requireComponentSrcRoot();

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
      referencedTables: [],
      foreignKeyCount: 0,
    };
  }
  
  // DDL 파일 읽기
  const fullDDL = readDbScript(srcRoot, 'ddl', normalizedDbType);

  if (fullDDL === null) {
    return {
      componentId: component.component_id,
      componentName: component.name,
      dbType: normalizedDbType,
      tables,
      ddl: `-- DDL 파일을 찾을 수 없습니다: ${normalizedDbType}`,
      tableCount: 0,
      viewCount: 0,
      missing: [...tables],
      referencedTables: [],
      foreignKeyCount: 0,
    };
  }

  // ALTER 문으로 따로 둔 외래 키 제약을 두 스크립트에서 모두 찾는다 (cubrid 는 초기 데이터 스크립트의 끝에 둔다)
  const alterForeignKeys: SourcedForeignKey[] = [
    ...extractForeignKeyStatements(fullDDL).map((fk) => ({ ...fk, fromDataScript: false })),
    ...extractForeignKeyStatements(readDbScript(srcRoot, 'dml', normalizedDbType) ?? '').map((fk) => ({
      ...fk,
      fromDataScript: true,
    })),
  ];
  const { extracted, referencedTables, foreignKeys } = extractWithForeignKeys(fullDDL, tables, alterForeignKeys);

  let ddl = extracted.ddl;
  if (foreignKeys.length > 0) {
    ddl += '\n\n\n' + [
      '-- =============================================',
      `-- 외래 키 제약 ${foreignKeys.length}건`,
      `-- ${normalizedDbType} 스크립트는 외래 키를 CREATE TABLE 안이 아니라 ALTER 문으로 따로 둔다.`,
      ...(foreignKeys.some((fk) => fk.fromDataScript)
        ? ['-- 원본에서는 초기 데이터 스크립트의 INSERT 문 뒤에 있으므로, 초기 데이터를 넣은 뒤에 실행한다.']
        : []),
      '-- =============================================',
      ...foreignKeys.map((fk) => fk.text),
    ].join('\n');
  }

  return {
    componentId: component.component_id,
    componentName: component.name,
    dbType: normalizedDbType,
    tables,
    ddl,
    tableCount: extracted.foundCount,
    viewCount: extracted.viewCount,
    missing: extracted.missing,
    referencedTables,
    foreignKeyCount: foreignKeys.length,
  };
}

/** ALTER 문으로 따로 둔 외래 키 제약과 그 문을 읽은 스크립트 */
interface SourcedForeignKey extends ForeignKeyStatement {
  /** 초기 데이터(DML) 스크립트에서 읽었는지 */
  fromDataScript: boolean;
}

/**
 * 요청한 테이블의 DDL 을 추출하고, 외래 키가 참조하는 테이블을 이어서 따라가 함께 싣는다.
 * 스크립트에 CREATE TABLE 이 없는 참조 테이블은 보탤 수 없으므로 건너뛴다.
 * foreignKeys 는 결과에 실린 두 테이블 사이의 ALTER 문 제약만 담는다.
 */
function extractWithForeignKeys(
  fullDDL: string,
  tables: string[],
  alterForeignKeys: SourcedForeignKey[],
): { extracted: ExtractedDDL; referencedTables: string[]; foreignKeys: SourcedForeignKey[] } {
  const defined = new Set([...fullDDL.matchAll(/^\s*CREATE\s+TABLE\s+(\w+)/gim)].map((match) => match[1].toUpperCase()));
  const referencedTables: string[] = [];

  let extracted = extractTableDDLs(fullDDL, tables);
  let created = new Set<string>();
  for (;;) {
    const missing = new Set(extracted.missing.map((name) => name.toUpperCase()));
    created = new Set([...tables.map((name) => name.toUpperCase()).filter((name) => !missing.has(name)), ...referencedTables]);

    const targets = [
      ...collectReferencedTables(extracted.ddl),
      ...alterForeignKeys.filter((fk) => created.has(fk.table)).map((fk) => fk.references),
    ];
    const fresh = [...new Set(targets)].filter((name) => !created.has(name) && defined.has(name));
    if (fresh.length === 0) break;

    referencedTables.push(...fresh);
    extracted = extractTableDDLs(fullDDL, tables, referencedTables);
  }

  const seenStatements = new Set<string>();
  const foreignKeys = alterForeignKeys.filter((fk) => {
    if (!created.has(fk.table) || !created.has(fk.references) || seenStatements.has(fk.text)) return false;
    seenStatements.add(fk.text);
    return true;
  });

  return { extracted, referencedTables, foreignKeys };
}

/** SQL 에서 REFERENCES 뒤에 오는 테이블 이름을 모은다 (대문자, 나온 순서) */
function collectReferencedTables(sql: string): string[] {
  return [...sql.matchAll(/\bREFERENCES\s+[\[`"]?(\w+)/gi)].map((match) => match[1].toUpperCase());
}

/** ALTER 문으로 따로 둔 외래 키 제약 한 건 */
export interface ForeignKeyStatement {
  /** 제약을 거는 테이블 (대문자) */
  table: string;
  /** 참조하는 테이블 (대문자) */
  references: string;
  /** 문 전체 (종결자 포함) */
  text: string;
}

/** ALTER CLASS|TABLE <테이블> 로 시작하는 줄 */
const ALTER_TABLE_START = /^ALTER\s+(?:CLASS|TABLE)\s+[\[`"]?(\w+)/i;

/** 새 문이 시작되는 줄 (종결자 없이 열려 있던 ALTER 문을 버리는 기준) */
const SQL_STATEMENT_START = /^(?:ALTER|CREATE|INSERT|UPDATE|DELETE|DROP|COMMIT)\b/i;

/**
 * 스크립트에서 `ALTER CLASS|TABLE <테이블> ADD [CONSTRAINT 이름] FOREIGN KEY (...) REFERENCES <테이블> ...;`
 * 문을 추출한다. 여러 줄에 걸친 문은 종결자(;)까지 한 문으로 읽고, 외래 키가 아닌 ALTER 문은 넣지 않는다.
 */
export function extractForeignKeyStatements(script: string): ForeignKeyStatement[] {
  const statements: ForeignKeyStatement[] = [];
  let open: { table: string; lines: string[] } | null = null;

  for (const line of script.split('\n')) {
    const trimmedLine = line.trim();

    // 종결자를 만나지 못한 ALTER 문은 다음 문이 시작되는 줄에서 버린다 (뒤따르는 문을 삼키지 않도록)
    if (open && SQL_STATEMENT_START.test(trimmedLine)) {
      open = null;
    }
    if (!open) {
      const start = trimmedLine.match(ALTER_TABLE_START);
      if (!start) continue;
      open = { table: start[1].toUpperCase(), lines: [] };
    }

    open.lines.push(line.replace(/\s+$/, ''));
    if (trimmedLine.endsWith(';')) {
      const text = open.lines.join('\n');
      const reference = text.match(/\bFOREIGN\s+KEY\b[\s\S]*?\bREFERENCES\s+[\[`"]?(\w+)/i);
      if (reference) {
        statements.push({ table: open.table, references: reference[1].toUpperCase(), text });
      }
      open = null;
    }
  }

  return statements;
}

/** 기본 보기에서 테이블마다 보여 주는 INSERT 문 수 */
export const DML_PREVIEW_ROWS_PER_TABLE = 20;

/** table 지정 조회가 한 번에 돌려주는 INSERT 문 수의 기본값이자 상한 */
export const DML_TABLE_PAGE_SIZE = 100;

/** getComponentDML 의 조회 옵션 */
export interface ComponentDMLOptions {
  /**
   * 이 테이블의 INSERT 문만 조회한다 (대소문자 구분 없음).
   * 생략하면 기본 보기: 테이블마다 처음 20건만 보여 준다.
   */
  table?: string;
  /** table 지정 시 한 번에 돌려줄 건수 (기본 100, 최대 100). 기본 보기에서는 쓰지 않는다 */
  limit?: number;
  /** table 지정 시 건너뛸 건수 (기본 0). 기본 보기에서는 쓰지 않는다 */
  offset?: number;
}

/** 테이블별 INSERT 문 건수 */
export interface DMLTableCount {
  table: string;
  /** 스크립트에 있는 전체 건수 */
  total: number;
  /** 이번 결과의 dml 에 담긴 건수 */
  shown: number;
}

/** extractTableDMLs 의 결과 */
export interface ExtractedDML {
  dml: string;
  /** dml 에 담긴 INSERT 문 수 */
  statementCount: number;
  /** 조회 대상의 전체 INSERT 문 수 (기본 보기: 요청한 테이블 전체, table 지정: 그 테이블) */
  totalCount: number;
  /**
   * 테이블별 건수.
   * 기본 보기: 데이터가 있는 테이블(스크립트 순서) 다음에 데이터가 없는 테이블.
   * table 지정: 그 테이블 한 건.
   */
  tableCounts: DMLTableCount[];
  /** table 지정 조회에서 선택된 테이블 이름. 기본 보기는 null */
  table: string | null;
  /** table 지정 조회에서 적용된 시작 위치 (0 부터). 기본 보기는 0 */
  offset: number;
  /** 적용된 건수 상한. 기본 보기는 테이블당 미리보기 건수, table 지정 조회는 limit */
  limit: number;
}

/** getComponentDML 의 결과 */
export interface ComponentDMLResult extends ExtractedDML {
  componentId: string;
  componentName: string;
  dbType: string;
  /** 컴포넌트가 사용하는 테이블·뷰 이름 (use_tables) */
  tables: string[];
}

/**
 * 컴포넌트에 필요한 DML(INSERT 초기 데이터) 추출
 *
 * 공통코드·ID 생성 테이블 때문에 전체 INSERT 문은 컴포넌트당 600건(12만 자)을 넘는다.
 * 기본 보기는 테이블마다 처음 20건만 돌려주고, options.table 을 주면 그 테이블의
 * INSERT 문을 offset 부터 limit(최대 100)건씩 나눠 돌려준다.
 */
export function getComponentDML(
  componentId: string,
  dbType: string = 'mysql',
  options: ComponentDMLOptions = {}
): ComponentDMLResult | null {
  // 지원하지 않는 dbType 은 컴포넌트 없음(null)과 구분되도록 오류로 알린다
  const normalizedDbType = requireDbType(dbType);
  // 소스 트리가 없으면 컴포넌트를 조회하기 전에 알린다
  const srcRoot = requireComponentSrcRoot();

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

  const base = {
    componentId: component.component_id,
    componentName: component.name,
    dbType: normalizedDbType,
    tables,
  };

  // 컴포넌트가 쓰지 않는 테이블을 지정했으면 스크립트를 읽기 전에 알린다
  const selectedTable = resolveDmlTable(tables, options.table);

  if (tables.length === 0) {
    return {
      ...base,
      ...emptyDml('-- 이 컴포넌트에는 사용 테이블이 정의되어 있지 않습니다.', selectedTable),
    };
  }

  // DML 파일 읽기
  const fullDML = readDbScript(srcRoot, 'dml', normalizedDbType);

  if (fullDML === null) {
    return {
      ...base,
      ...emptyDml(`-- DML 파일을 찾을 수 없습니다: ${normalizedDbType}`, selectedTable),
    };
  }

  return {
    ...base,
    ...extractTableDMLs(fullDML, tables, options),
  };
}

/**
 * 통합 DB 스크립트(script/<ddl|dml>/<dbType>/com_<DDL|DML>_<dbType>.sql)를 읽는다.
 * 파일이 없으면 null, 읽을 권한이 없으면 상대 경로만 담은 UserFacingError.
 */
export function readDbScript(srcRoot: string, kind: 'ddl' | 'dml', dbType: DbType): string | null {
  const relPath = path.join('script', kind, dbType, `com_${kind.toUpperCase()}_${dbType}.sql`);
  return readFromSourceTree(relPath, 'file', () => fs.readFileSync(path.join(srcRoot, relPath), 'utf-8'));
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

/** 오류 문구에 싣는 입력값의 최대 길이 */
const INPUT_ECHO_MAX_LENGTH = 40;

/** 호출자가 준 값을 오류 문구에 실을 수 있게 다듬는다 (공백·줄바꿈 정리, 길이 제한) */
function echoInput(value: unknown): string {
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text.length > INPUT_ECHO_MAX_LENGTH ? `${text.slice(0, INPUT_ECHO_MAX_LENGTH)}…` : text;
}

/** DB 타입을 정규화하고, 지원하지 않는 값이면 지원 목록을 담은 오류를 던진다 */
function requireDbType(dbType: string): DbType {
  const normalized = normalizeDbType(dbType);
  if (normalized) return normalized;

  throw new UserFacingError(
    `지원하지 않는 DB 타입입니다: ${echoInput(dbType)} ` +
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
  /** 요청한 이름 가운데 CREATE TABLE 을 찾은 테이블 수 */
  foundCount: number;
  /** 요청한 이름 가운데 CREATE VIEW 를 찾은 뷰 수 */
  viewCount: number;
  /** 요청한 이름 가운데 CREATE TABLE / CREATE VIEW 를 찾지 못한 것 (요청한 표기 그대로) */
  missing: string[];
}

/**
 * 전체 DDL에서 특정 테이블·뷰의 CREATE 문 추출
 * CREATE TABLE ~ ; 블록을 파싱하고 해당 테이블의 INDEX도 포함한다.
 * CREATE VIEW 로 정의된 객체는 자신이 조회하는 테이블 뒤에 오도록 맨 끝에 모은다.
 *
 * referencedNames 는 요청한 테이블의 외래 키가 참조해서 함께 싣는 테이블이다. 같은 방식으로 추출하되
 * 요청한 수(foundCount, viewCount)와 찾지 못한 객체(missing)에는 넣지 않고, 머리말에 따로 적는다.
 */
export function extractTableDDLs(fullDDL: string, tableNames: string[], referencedNames: string[] = []): ExtractedDDL {
  const requestedNames = new Set(tableNames.map(t => t.toUpperCase()));
  const upperTableNames = new Set([...requestedNames, ...referencedNames.map(t => t.toUpperCase())]);
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

  const foundCount = [...foundTables].filter(name => requestedNames.has(name)).length;
  const viewCount = [...foundViews].filter(name => requestedNames.has(name)).length;
  // 요청한 이름과 겹치지 않는 참조 테이블 가운데 실제로 추출한 것 (대소문자만 다른 중복은 한 번만)
  const referencedFound = [...new Set(referencedNames.map(name => name.toUpperCase()))].filter(
    name => !requestedNames.has(name) && foundTables.has(name),
  );
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
  const referencedLine =
    referencedFound.length > 0
      ? `-- 외래 키가 참조해서 함께 실은 테이블 ${referencedFound.length}개: ${referencedFound.join(', ')}\n`
      : '';
  const header = `-- =============================================\n-- 요청 ${seen.size}개 중 ${counts} DDL 추출\n-- 요청: ${tableNames.join(', ')}\n${referencedLine}-- =============================================\n`;

  return {
    ddl: header + '\n' + extractedBlocks.join('\n\n\n'),
    foundCount,
    viewCount,
    missing,
  };
}

/** 스크립트에서 읽은 INSERT 문 한 줄 */
interface DmlStatement {
  /** 대상 테이블 이름 — 대문자 */
  table: string;
  line: string;
  /** 바로 앞줄에 있던 구역 주석 (없으면 빈 문자열) */
  comment: string;
}

/** 요청한 테이블의 INSERT 문을 스크립트 순서대로 읽는다 */
function parseDmlStatements(fullDML: string, upperTableNames: Set<string>): DmlStatement[] {
  const statements: DmlStatement[] = [];
  let prevComment = '';

  for (const line of fullDML.split('\n')) {
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

    // INSERT INTO TABLENAME 패턴 매칭 — 줄 머리에 고정한다. 다른 문의 문자열 값에 든
    // 'INSERT INTO <테이블>' 을 그 테이블의 INSERT 문으로 읽지 않도록
    const match = trimmedLine.match(/^INSERT\s+INTO\s+(\w+)/i);
    if (match) {
      const table = match[1].toUpperCase();
      if (upperTableNames.has(table)) {
        statements.push({ table, line, comment: prevComment });
      }
    }

    prevComment = '';
  }

  return statements;
}

/** INSERT 문을 줄 목록에 덧붙인다. 구역 주석이 있으면 빈 줄로 띄우고 먼저 넣는다 */
function pushDmlStatement(lines: string[], statement: DmlStatement): void {
  if (statement.comment) {
    if (lines.length > 0) lines.push('');
    lines.push(statement.comment);
  }
  lines.push(statement.line);
}

/** INSERT 문 없이 안내 주석만 담은 결과 */
function emptyDml(dml: string, table: string | null): ExtractedDML {
  return {
    dml,
    statementCount: 0,
    totalCount: 0,
    tableCounts: [],
    table,
    offset: 0,
    limit: table === null ? DML_PREVIEW_ROWS_PER_TABLE : DML_TABLE_PAGE_SIZE,
  };
}

/**
 * table 옵션을 컴포넌트의 테이블 이름으로 바꾼다 (대소문자 구분 없음).
 * 지정하지 않았으면 null, 컴포넌트가 쓰지 않는 테이블이면 사용 가능한 이름을 담은 오류.
 */
function resolveDmlTable(tableNames: string[], table: string | undefined): string | null {
  const requested = typeof table === 'string' ? table.trim() : '';
  if (requested === '') return null;

  const found = tableNames.find(name => name.toUpperCase() === requested.toUpperCase());
  if (found) return found;

  const available = tableNames.length > 0
    ? `사용 가능한 테이블: ${tableNames.join(', ')}`
    : '이 컴포넌트에는 사용 테이블이 정의되어 있지 않습니다.';
  throw new UserFacingError(
    `'${echoInput(requested)}' 은(는) 이 컴포넌트가 사용하는 테이블이 아닙니다. ${available}`
  );
}

/** limit 을 1~100 의 정수로 맞춘다 (숫자가 아니면 기본값 100) */
function normalizeDmlLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || Number.isNaN(limit)) return DML_TABLE_PAGE_SIZE;
  return Math.min(DML_TABLE_PAGE_SIZE, Math.max(1, Math.floor(limit)));
}

/** offset 을 0 이상의 정수로 맞춘다 (유한한 숫자가 아니면 0) */
function normalizeDmlOffset(offset: number | undefined): number {
  if (typeof offset !== 'number' || !Number.isFinite(offset)) return 0;
  return Math.max(0, Math.floor(offset));
}

/** 기본 보기: 테이블마다 처음 몇 건만 담고 테이블별 전체 건수를 함께 돌려준다 */
function previewDmlByTable(statements: DmlStatement[], tableNames: string[]): ExtractedDML {
  // 요청한 표기 (대소문자만 다른 중복 요청은 처음 것)
  const spelling = new Map<string, string>();
  for (const name of tableNames) {
    const upper = name.toUpperCase();
    if (!spelling.has(upper)) spelling.set(upper, name);
  }

  const totals = new Map<string, number>();
  for (const statement of statements) {
    totals.set(statement.table, (totals.get(statement.table) ?? 0) + 1);
  }

  const shown = new Map<string, number>();
  const lines: string[] = [];
  for (const statement of statements) {
    const count = shown.get(statement.table) ?? 0;
    if (count >= DML_PREVIEW_ROWS_PER_TABLE) continue;

    pushDmlStatement(lines, statement);
    shown.set(statement.table, count + 1);

    // 미리보기 건수를 채운 자리에 생략 건수를 남긴다
    const total = totals.get(statement.table) ?? 0;
    if (count + 1 === DML_PREVIEW_ROWS_PER_TABLE && total > DML_PREVIEW_ROWS_PER_TABLE) {
      const name = spelling.get(statement.table) ?? statement.table;
      lines.push(`-- (${name}: 전체 ${total}건 중 ${total - DML_PREVIEW_ROWS_PER_TABLE}건 생략)`);
    }
  }

  const tableCounts: DMLTableCount[] = [
    ...[...totals].map(([upper, total]) => ({
      table: spelling.get(upper) ?? upper,
      total,
      shown: shown.get(upper) ?? 0,
    })),
    ...[...spelling]
      .filter(([upper]) => !totals.has(upper))
      .map(([, name]) => ({ table: name, total: 0, shown: 0 })),
  ];
  const totalCount = statements.length;
  const statementCount = tableCounts.reduce((sum, count) => sum + count.shown, 0);
  const result = {
    statementCount,
    totalCount,
    tableCounts,
    table: null,
    offset: 0,
    limit: DML_PREVIEW_ROWS_PER_TABLE,
  };

  if (statementCount === 0) {
    return {
      ...result,
      dml: `-- 요청된 테이블(${tableNames.join(', ')})에 대한 초기 데이터가 없습니다.`,
    };
  }

  const counts = statementCount < totalCount
    ? `전체 ${totalCount}건 중 ${statementCount}건 — 테이블마다 처음 ${DML_PREVIEW_ROWS_PER_TABLE}건`
    : `${statementCount}건`;
  const header = `-- =============================================\n-- ${tableNames.length}개 테이블 관련 초기 데이터 (${counts})\n-- 테이블: ${tableNames.join(', ')}\n-- =============================================\n`;

  return {
    ...result,
    dml: header + '\n' + lines.join('\n'),
  };
}

/** table 지정 조회: 한 테이블의 INSERT 문을 offset 부터 limit 건 돌려준다 */
function pageDmlOfTable(statements: DmlStatement[], table: string, options: ComponentDMLOptions): ExtractedDML {
  const upper = table.toUpperCase();
  const rows = statements.filter(statement => statement.table === upper);
  const limit = normalizeDmlLimit(options.limit);
  const offset = normalizeDmlOffset(options.offset);
  const page = rows.slice(offset, offset + limit);
  const result = {
    statementCount: page.length,
    totalCount: rows.length,
    tableCounts: [{ table, total: rows.length, shown: page.length }],
    table,
    offset,
    limit,
  };

  if (rows.length === 0) {
    return { ...result, dml: `-- ${table} 테이블에는 초기 데이터가 없습니다.` };
  }
  if (page.length === 0) {
    return {
      ...result,
      dml: `-- ${table} 초기 데이터: 총 ${rows.length}건 — offset ${offset} 부터는 남은 INSERT 문이 없습니다.`,
    };
  }

  const lines: string[] = [];
  for (const statement of page) {
    pushDmlStatement(lines, statement);
  }
  const header = `-- =============================================\n-- ${table} 초기 데이터: 총 ${rows.length}건 중 ${offset + 1}~${offset + page.length}\n-- =============================================\n`;

  return {
    ...result,
    dml: header + '\n' + lines.join('\n'),
  };
}

/**
 * 전체 DML에서 특정 테이블의 INSERT 문 추출
 *
 * options.table 이 없으면 테이블마다 처음 20건만(기본 보기), 있으면 그 테이블의
 * INSERT 문을 offset 부터 limit 건 돌려준다.
 */
export function extractTableDMLs(
  fullDML: string,
  tableNames: string[],
  options: ComponentDMLOptions = {}
): ExtractedDML {
  const selectedTable = resolveDmlTable(tableNames, options.table);
  const upperTableNames = new Set(tableNames.map(t => t.toUpperCase()));
  const statements = parseDmlStatements(fullDML, upperTableNames);

  return selectedTable === null
    ? previewDmlByTable(statements, tableNames)
    : pageDmlOfTable(statements, selectedTable, options);
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
  if (result.referencedTables.length > 0) {
    // 사용 테이블은 아니지만 외래 키가 참조해서, 받은 DDL 을 그대로 실행할 수 있도록 함께 실은 테이블
    output += `- **외래 키 참조로 함께 실은 테이블**: ${result.referencedTables.length}개 (${result.referencedTables.join(', ')})\n`;
  }
  if (result.foreignKeyCount > 0) {
    output += `- **외래 키 제약**: ${result.foreignKeyCount}건 (ALTER 문, DDL 끝에 실음)\n`;
  }
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
export function formatComponentDML(result: ComponentDMLResult): string {
  let output = `## ${result.componentName} 초기 데이터 (${result.dbType})\n\n`;
  output += `- **컴포넌트**: ${result.componentId}\n`;
  output += `- **DB 종류**: ${result.dbType}\n`;

  if (result.table !== null) {
    // 한 테이블의 구간 조회
    const last = result.offset + result.statementCount;
    output += `- **테이블**: ${result.table}\n`;
    if (result.statementCount > 0) {
      output += `- **INSERT 문**: 총 ${result.totalCount}건 중 ${result.offset + 1}~${last}\n\n`;
    } else if (result.totalCount > 0) {
      output += `- **INSERT 문**: 총 ${result.totalCount}건 (offset ${result.offset} 부터는 남은 INSERT 문이 없습니다)\n\n`;
    } else {
      output += '- **INSERT 문**: 총 0건\n\n';
    }
    output += '```sql\n';
    output += result.dml;
    output += '\n```\n';
    if (result.statementCount > 0 && last < result.totalCount) {
      output += `\n> 남은 ${result.totalCount - last}건은 같은 호출에 \`filters.offset: ${last}\` 을 주어 이어서 조회할 수 있습니다.\n`;
    }
    return output;
  }

  // 기본 보기: 테이블마다 처음 몇 건
  const omitted = result.totalCount - result.statementCount;
  output += `- **관련 테이블**: ${result.tables.length}개\n`;
  output += omitted > 0
    ? `- **INSERT 문**: 전체 ${result.totalCount}건 중 ${result.statementCount}건 표시 (테이블마다 처음 ${result.limit}건)\n\n`
    : `- **INSERT 문**: ${result.statementCount}건\n\n`;

  const withData = result.tableCounts.filter(count => count.total > 0);
  if (withData.length > 0) {
    output += '| 테이블 | 전체 | 표시 | 생략 |\n';
    output += '|--------|------|------|------|\n';
    for (const count of withData) {
      output += `| ${count.table} | ${count.total} | ${count.shown} | ${count.total - count.shown} |\n`;
    }
    output += '\n';

    const withoutData = result.tableCounts.filter(count => count.total === 0);
    if (withoutData.length > 0) {
      output += `초기 데이터가 없는 테이블: ${withoutData.map(count => count.table).join(', ')}\n\n`;
    }
  }

  output += '```sql\n';
  output += result.dml;
  output += '\n```\n';

  if (omitted > 0) {
    output += '\n> 생략된 INSERT 문이 있습니다. 특정 테이블의 전체 내용은 `egov_search_knowledge` 를 `scope: "components"`, `action: "dml"`, 같은 `filters.componentId`·`filters.dbType` 에 `filters.table: <테이블명>` 을 더해 호출하고, `limit`(한 번에 최대 100건)과 `filters.offset` 으로 구간을 나눠 조회할 수 있습니다.\n';
  }

  return output;
}
