/**
 * SQLite 적재 공용 로직 (호환성 SW)
 *
 * build-index(1/5 단계)와 update CLI(compatibility 리소스)가 동일한
 * 파싱·검증·적재 코드를 공유한다 — 두 경로의 결과가 달라지지 않도록.
 * 경로는 전부 파라미터로 받는다 (호출자가 번들 템플릿 디렉토리든
 * 사용자 반입 디렉토리든 지정).
 */

import fs from 'fs-extra';
import { z } from 'zod';
import { SQLiteManager } from '../database/sqliteManager.js';

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
