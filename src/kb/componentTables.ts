/**
 * 공통컴포넌트가 쓰는 테이블 목록(use_tables)을 소스 트리에서 도출한다.
 *
 * 메타(templates/common-components.json)의 useTables 는 엑셀 원본의 빈 칸이 앞 항목의 값으로
 * 채워진 채 만들어져서 믿을 수 없다 (153개 가운데 64개가 바로 앞 항목과 같은 목록을 갖고,
 * 공통코드의 사용 테이블이 출퇴근 테이블로 적혀 있다). 이 목록이 상세 조회의 "사용 테이블" 과
 * ddl·dml 의 추출 대상을 정하므로, 적재할 때 소스 트리에서 다시 만든다.
 *
 * 규칙 (앞에서부터 해당하는 것을 쓴다):
 * 1. 업스트림이 제공하는 컴포넌트별 DDL 스크립트
 *    (src/script/ddl/mysql/<패키지 접미어>_create_mysql.sql)가 만드는 테이블·뷰.
 *    자기 패키지의 스크립트가 없으면 가장 가까운 상위 패키지의 스크립트를 쓴다.
 * 2. 스크립트가 없으면, 모든 컴포넌트별 스크립트에 공통으로 들어 있는 기반 테이블에
 *    컴포넌트 자신의 매퍼 XML 이 참조하는 테이블을 더한 것.
 * 3. 스크립트도 매퍼도 없으면 메타의 목록. 다만 그 목록이 바로 앞 항목과 완전히 같으면
 *    채워 내려진 값으로 보고 기반 테이블만 쓴다.
 * 1 의 경우에도 자기 매퍼가 참조하는 테이블이 스크립트에 빠져 있으면 뒤에 더한다.
 *
 * 컴포넌트별 스크립트의 문은 통합 스크립트(script/ddl/<db>/com_DDL_<db>.sql)에 그대로 들어
 * 있으므로, 이 목록으로 통합 스크립트에서 추출하면 컴포넌트별 스크립트와 같은 내용이 나온다.
 * 테이블 이름은 DB 종류와 무관하므로 mysql 스크립트를 기준으로 읽는다.
 */

import fs from 'fs';
import path from 'path';

/** 컴포넌트별 스크립트의 패키지 접미어가 생략하는 패키지 머리 */
const PACKAGE_ROOT = 'egovframework.com.';

/** 테이블 이름을 읽는 기준 DB (이름은 DB 종류와 무관하다) */
const REFERENCE_DB = 'mysql';

/** 소스 트리에서 읽어 둔 테이블 정보 */
export interface ComponentTableContext {
  /** 소스 트리의 루트 */
  srcRoot: string;
  /** 패키지 접미어(egovframework.com. 뒤) → 그 컴포넌트별 스크립트가 만드는 테이블·뷰 (스크립트 순서) */
  scriptTables: Map<string, string[]>;
  /** 모든 컴포넌트별 스크립트에 공통으로 들어 있는 기반 테이블 (스크립트 순서) */
  baseTables: string[];
  /** 통합 DDL 스크립트가 정의하는 테이블·뷰 (스크립트 순서) */
  knownTables: string[];
}

/** 목록을 어디에서 얻었는지 */
export type ComponentTableSource = 'script' | 'parent-script' | 'mapper' | 'meta' | 'base';

export interface DerivedComponentTables {
  tables: string[];
  source: ComponentTableSource;
}

/**
 * SQL 스크립트에서 CREATE TABLE / CREATE [OR REPLACE] VIEW 문이 만드는 이름을 스크립트 순서대로 읽는다.
 * 줄 머리에서 시작하는 문만 보고(문자열 값 안의 문구는 세지 않는다), 같은 이름은 한 번만 돌려준다.
 */
export function readCreatedObjectNames(sql: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const match of sql.matchAll(/^[ \t]*CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW)\s+(\w+)/gim)) {
    const key = match[1].toUpperCase();
    if (!seen.has(key)) {
      seen.add(key);
      names.push(match[1]);
    }
  }
  return names;
}

/**
 * 소스 트리에서 테이블 정보를 읽는다.
 * 컴포넌트별 스크립트나 통합 스크립트가 없으면(소스 트리가 없거나 구조가 다르면) null.
 */
export function loadComponentTableContext(srcRoot: string): ComponentTableContext | null {
  const scriptDir = path.join(srcRoot, 'src', 'script', 'ddl', REFERENCE_DB);
  const unifiedPath = path.join(srcRoot, 'script', 'ddl', REFERENCE_DB, `com_DDL_${REFERENCE_DB}.sql`);
  const suffix = `_create_${REFERENCE_DB}.sql`;

  let scriptFiles: string[];
  let unified: string;
  try {
    scriptFiles = fs.readdirSync(scriptDir).filter((file) => file.endsWith(suffix)).sort();
    unified = fs.readFileSync(unifiedPath, 'utf-8');
  } catch {
    return null;
  }
  if (scriptFiles.length === 0) {
    return null;
  }

  const scriptTables = new Map<string, string[]>();
  for (const file of scriptFiles) {
    const names = readCreatedObjectNames(fs.readFileSync(path.join(scriptDir, file), 'utf-8'));
    scriptTables.set(file.slice(0, -suffix.length), names);
  }

  // 기반 테이블: 모든 컴포넌트별 스크립트에 들어 있는 이름 (첫 스크립트의 순서를 따른다)
  const lists = [...scriptTables.values()];
  const others = lists.slice(1).map((list) => new Set(list.map((name) => name.toUpperCase())));
  const baseTables = lists[0].filter((name) => others.every((set) => set.has(name.toUpperCase())));

  return { srcRoot, scriptTables, baseTables, knownTables: readCreatedObjectNames(unified) };
}

/** 패키지의 컴포넌트별 스크립트를 찾는다. 자기 패키지에 없으면 상위 패키지를 차례로 본다. */
function findScriptTables(
  packageName: string,
  ctx: ComponentTableContext,
): { tables: string[]; exact: boolean } | null {
  if (!packageName.startsWith(PACKAGE_ROOT)) {
    return null;
  }
  const segments = packageName.slice(PACKAGE_ROOT.length).split('.').filter(Boolean);
  for (let count = segments.length; count >= 1; count -= 1) {
    const tables = ctx.scriptTables.get(segments.slice(0, count).join('.'));
    if (tables) {
      return { tables, exact: count === segments.length };
    }
  }
  return null;
}

/** 디렉토리 아래의 XML 파일을 모두 찾는다. 디렉토리가 없으면 빈 배열. */
function listXmlFiles(dir: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listXmlFiles(full));
    } else if (entry.name.endsWith('.xml')) {
      files.push(full);
    }
  }
  return files;
}

/**
 * 컴포넌트 자신의 매퍼 XML 이 참조하는 테이블.
 * 매퍼 파일이 없으면 null, 있으면 통합 스크립트에 정의된 이름 가운데 매퍼에 낱말로 나오는 것
 * (통합 스크립트 순서, 대소문자 무시).
 */
function readMapperTables(packageName: string, ctx: ComponentTableContext): string[] | null {
  // egovframework.com.cop.bbs → mapper/com/cop/bbs
  const mapperDir = path.join(
    ctx.srcRoot,
    'src',
    'main',
    'resources',
    'egovframework',
    'mapper',
    ...packageName.split('.').slice(1),
  );
  const files = listXmlFiles(mapperDir);
  if (files.length === 0) {
    return null;
  }

  const words = new Set<string>();
  for (const file of files) {
    for (const word of fs.readFileSync(file, 'utf-8').toUpperCase().match(/\w+/g) ?? []) {
      words.add(word);
    }
  }
  return ctx.knownTables.filter((table) => words.has(table.toUpperCase()));
}

/** 앞 목록 뒤에, 앞 목록에 없는 이름만 더한다 (대소문자 무시). */
function appendMissing(tables: string[], extra: readonly string[]): string[] {
  const seen = new Set(tables.map((name) => name.toUpperCase()));
  const merged = [...tables];
  for (const name of extra) {
    if (!seen.has(name.toUpperCase())) {
      seen.add(name.toUpperCase());
      merged.push(name);
    }
  }
  return merged;
}

function sameList(a: readonly string[], b: readonly string[] | undefined): boolean {
  return b !== undefined && a.length === b.length && a.every((name, index) => name === b[index]);
}

/**
 * 컴포넌트 하나의 사용 테이블 목록을 정한다.
 *
 * @param component 메타의 항목 (패키지명과 메타에 적힌 목록)
 * @param previousUseTables 메타에서 바로 앞 항목의 목록 (채워 내려진 값인지 판정하는 데 쓴다)
 */
export function deriveComponentTables(
  component: { packageName: string; useTables?: readonly string[] | null },
  previousUseTables: readonly string[] | undefined,
  ctx: ComponentTableContext,
): DerivedComponentTables {
  const metaTables = [...(component.useTables ?? [])];
  const script = findScriptTables(component.packageName, ctx);
  const mapperTables = readMapperTables(component.packageName, ctx);

  if (script) {
    return {
      source: script.exact ? 'script' : 'parent-script',
      tables: appendMissing(script.tables, mapperTables ?? []),
    };
  }
  if (mapperTables) {
    return { source: 'mapper', tables: appendMissing(ctx.baseTables, mapperTables) };
  }
  if (metaTables.length > 0 && sameList(metaTables, previousUseTables)) {
    return { source: 'base', tables: [...ctx.baseTables] };
  }
  return { source: 'meta', tables: metaTables };
}
