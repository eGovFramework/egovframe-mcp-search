/**
 * SQLite 적재 공용 로직 (호환성 SW, 공통컴포넌트 메타)
 *
 * build-index(1/5 단계)와 update CLI(compatibility 리소스)가 동일한
 * 파싱·검증·적재 코드를 공유한다 — 두 경로의 결과가 달라지지 않도록.
 * 경로는 전부 파라미터로 받는다 (호출자가 번들 템플릿 디렉토리든
 * 사용자 반입 디렉토리든 지정).
 */

import fs from 'fs-extra';
import { z } from 'zod';
import { SQLiteManager } from '../database/sqliteManager.js';
import { assignUniqueComponentIds, type RenamedComponentId } from './componentIds.js';

// ─── 호환성 SW (JSON) ────────────────────────────────────

/** compatibility-software.json 행 스키마 — 다운로드 산출물 검증용 */
export const compatibilityRowSchema = z.object({
  product_name: z.string().min(1),
  product_version: z.string(),
  framework_version: z.string(),
  category: z.string(),
  compatibility_level: z.number().int(),
  vendor: z.string(),
  verified_date: z.string(),
  description: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
});

export type CompatibilityRow = z.infer<typeof compatibilityRowSchema>;

/** JSON 파일 파싱 + 행별 스키마 검증 (실패 시 사용자 친화 에러) */
export async function parseCompatibilityJson(jsonPath: string): Promise<CompatibilityRow[]> {
  let data: unknown;
  try {
    data = await fs.readJSON(jsonPath);
  } catch {
    throw new Error('compatibility-software.json 을 JSON 으로 읽을 수 없습니다.');
  }
  if (!Array.isArray(data)) {
    throw new Error('compatibility-software.json 형식 오류: 최상위가 배열이 아닙니다.');
  }
  return data.map((row, idx) => {
    const parsed = compatibilityRowSchema.safeParse(row);
    if (!parsed.success) {
      throw new Error(
        `compatibility-software.json ${idx + 1}번째 항목 형식 오류: ${parsed.error.issues[0]?.message ?? ''}`,
      );
    }
    return parsed.data;
  });
}

/**
 * 호환성 SW 를 JSON 기준 deterministic 재적재한다
 * (clear 후 insert — 원본에서 삭제된 행이 남지 않는다).
 * @returns 적재 행 수
 */
export async function loadCompatibilityFromJson(
  sqlite: SQLiteManager,
  jsonPath: string,
): Promise<number> {
  const rows = await parseCompatibilityJson(jsonPath);

  sqlite.clearCompatibilitySoftware();
  sqlite.addCompatibilitySoftwareBatch(rows.map((d) => ({
    ...d,
    compatibility_level: d.compatibility_level === 1 ? 1 : 2,
    description: d.description ?? undefined,
    url: d.url ?? undefined,
  })));
  // 과거 연결(잘못된 트리거)이 남긴 FTS 드리프트 치유
  sqlite.rebuildCompatibilityFts();
  return rows.length;
}

// ─── 공통컴포넌트 메타 (JSON) ────────────────────────────

/** common-components.json 의 카테고리 항목 */
const componentCategorySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  nameEn: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  descriptionEn: z.string().nullable().optional(),
});

/** common-components.json 의 컴포넌트 항목 */
const componentEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  nameEn: z.string().nullable().optional(),
  categoryId: z.string().min(1),
  packageName: z.string().min(1),
  description: z.string().nullable().optional(),
  descriptionEn: z.string().nullable().optional(),
  dependencies: z.array(z.string()).optional(),
  useTables: z.array(z.string()).optional(),
  version: z.string().nullable().optional(),
  hasWeb: z.boolean().optional(),
  addedOptions: z.string().nullable().optional(),
});

const componentMetaSchema = z.object({
  categories: z.array(componentCategorySchema),
  components: z.array(componentEntrySchema),
});

/** loadCommonComponentsFromJson 의 결과 */
export interface ComponentLoadResult {
  /** 적재한 카테고리 수 */
  categories: number;
  /** 적재한 컴포넌트 수 (메타의 항목 수와 같다) */
  components: number;
  /** 적재한 의존성 수 */
  dependencies: number;
  /** id 가 다른 항목과 겹쳐서 새 id 를 받은 컴포넌트 (kb/componentIds 의 규칙) */
  renamed: Array<RenamedComponentId & { name: string }>;
}

/**
 * 공통컴포넌트 메타를 JSON 기준으로 deterministic 재적재한다
 * (clear 후 insert — 원본에서 삭제되거나 id 가 바뀐 행이 남지 않는다).
 *
 * 메타의 id 는 서로 겹칠 수 있으므로 적재 전에 고유한 id 로 바꾼다. 겹친 채로 적재하면
 * 뒤 항목이 앞 항목을 덮어써 컴포넌트가 사라진다 (kb/componentIds 참조).
 */
export async function loadCommonComponentsFromJson(
  sqlite: SQLiteManager,
  jsonPath: string,
): Promise<ComponentLoadResult> {
  let data: unknown;
  try {
    data = await fs.readJSON(jsonPath);
  } catch {
    throw new Error('common-components.json 을 JSON 으로 읽을 수 없습니다.');
  }
  const parsed = componentMetaSchema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `common-components.json 형식 오류: ${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`.trimEnd(),
    );
  }
  const meta = parsed.data;
  const { ids, renamed } = assignUniqueComponentIds(meta.components);

  sqlite.clearCommonComponents();

  sqlite.addComponentCategoriesBatch(
    meta.categories.map((category) => ({
      category_id: category.id,
      name: category.name,
      name_en: category.nameEn ?? '',
      description: category.description ?? undefined,
      description_en: category.descriptionEn ?? undefined,
    })),
  );

  sqlite.addCommonComponentsBatch(
    meta.components.map((component, index) => ({
      component_id: ids[index],
      name: component.name,
      name_en: component.nameEn ?? undefined,
      category_id: component.categoryId,
      package_name: component.packageName,
      description: component.description ?? undefined,
      description_en: component.descriptionEn ?? undefined,
      use_tables: JSON.stringify(component.useTables ?? []),
      // 버전이 비어 있으면 SQLiteManager 가 기본값을 채운다
      version: component.version ?? '',
      has_web: component.hasWeb ?? false,
      added_options: component.addedOptions ?? undefined,
    })),
  );

  // 한 컴포넌트에 같은 패키지가 두 번 적혀 있으면 한 번만 적재한다
  const dependencies = meta.components.flatMap((component, index) =>
    [...new Set(component.dependencies ?? [])].map((dependsOnPackage) => ({
      component_id: ids[index],
      depends_on_package: dependsOnPackage,
    })),
  );
  sqlite.addComponentDependenciesBatch(dependencies);

  // 과거 연결(recursive_triggers OFF)에서 REPLACE 가 남긴 FTS 드리프트 치유
  sqlite.rebuildComponentsFts();

  return {
    categories: meta.categories.length,
    components: meta.components.length,
    dependencies: dependencies.length,
    renamed: renamed.map((entry) => ({ ...entry, name: meta.components[entry.index].name })),
  };
}
