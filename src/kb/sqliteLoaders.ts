/**
 * SQLite 적재 공용 로직 (호환성 SW · 기관 Custom 사전)
 *
 * build-index(1/12, 5~8/12 단계)와 update CLI(compatibility/custom_terms
 * 리소스)가 동일한 파싱·검증·적재 코드를 공유한다 — 두 경로의 결과가
 * 달라지지 않도록. 경로는 전부 파라미터로 받는다 (호출자가 번들 템플릿
 * 디렉토리든 사용자 반입 디렉토리든 지정).
 */

import fs from 'fs-extra';
import path from 'node:path';
import { z } from 'zod';
import { parse as parseCsvSync } from 'csv-parse/sync';
import { SQLiteManager } from '../database/sqliteManager.js';

// ─── CSV 헬퍼 (buildIndex 에서 이관) ─────────────────────

/**
 * data.go.kr 표준 데이터셋 CSV 파일을 행 단위 객체 배열로 읽는다.
 * BOM 처리, 따옴표 안 콤마/줄바꿈, 행별 컬럼 수 가변 모두 csv-parse 가 처리.
 */
export async function readCsvRows(filePath: string): Promise<Record<string, string>[]> {
  const buffer = await fs.readFile(filePath);
  return parseCsvSync(buffer, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
    relax_column_count: true,
  }) as Record<string, string>[];
}

/**
 * 행안부 표준 CSV 의 "-" 또는 빈 문자열을 null 로 정규화.
 */
export function normalizeCell(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (s === '' || s === '-') return null;
  return s;
}

/**
 * `제정차수` 컬럼에 (폐기) 만 표기되고 폐기후제정 이 아닌 행은 deprecated 로 간주.
 * DDL 보조 시 LLM 이 폐기된 옛 표준을 잡지 않도록 적재 단계에서 거른다.
 */
export function isDeprecatedRevision(revisionRound: string | null | undefined): boolean {
  if (!revisionRound) return false;
  return revisionRound.includes('(폐기)') && !revisionRound.includes('폐기후제정');
}

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

// ─── 기관 Custom 사전 (CSV) ──────────────────────────────
//
// CSV 포맷은 행안부 표준 CSV 와 동일하게 둔다 (행에서 행으로 복붙 가능, 파서 재사용).
// 파일이 없으면 조용히 건너뛴다 (기관에서 아직 등록 안 한 상태도 정상).

export const CUSTOM_TERMS_CSV = 'custom_standard_terms.csv';
export const CUSTOM_WORDS_CSV = 'custom_standard_words.csv';
export const CUSTOM_DOMAINS_CSV = 'custom_standard_domains.csv';

export async function loadCustomTerms(sqlite: SQLiteManager, dir: string): Promise<number> {
  const file = path.join(dir, CUSTOM_TERMS_CSV);
  if (!await fs.pathExists(file)) {
    console.warn(`  ⚠️ Custom 용어 CSV 가 없습니다: ${CUSTOM_TERMS_CSV} — 건너뜀.`);
    return 0;
  }

  const rows = await readCsvRows(file);
  let dropped = 0;
  const terms = rows
    .filter((r) => {
      if (!r['공통표준용어명'] || !r['공통표준용어영문약어명']) return false;
      if (isDeprecatedRevision(r['제정차수'])) {
        dropped++;
        return false;
      }
      return true;
    })
    .map((r) => ({
      korean_name: r['공통표준용어명'].trim(),
      english_name: r['공통표준용어영문약어명'].trim(),
      description: normalizeCell(r['공통표준용어설명']) ?? undefined,
      domain_name: normalizeCell(r['공통표준도메인명']) ?? undefined,
      allowed_values: normalizeCell(r['허용값']) ?? undefined,
      storage_format: normalizeCell(r['저장 형식']) ?? undefined,
      display_format: normalizeCell(r['표현 형식']) ?? undefined,
      standard_code_name: normalizeCell(r['행정표준코드명']) ?? undefined,
      authority: normalizeCell(r['소관기관명']) ?? undefined,
      synonyms: normalizeCell(r['용어 이음동의어 목록']) ?? undefined,
      revision_round: normalizeCell(r['제정차수']) ?? undefined,
      revision_type: normalizeCell(r['개정구분명(폐기 또는 변경)']) ?? undefined,
      revision_item: normalizeCell(r['개정항목']) ?? undefined,
      revision_reason: normalizeCell(r['개정사유']) ?? undefined,
    }));

  if (terms.length === 0) {
    console.error(`  ⚠️ 활성 Custom 용어가 없습니다 (CSV: ${rows.length}행, 폐기 제외: ${dropped}건)`);
    return 0;
  }
  sqlite.addCustomTermsBatch(terms);
  console.error(`  ✓ ${terms.length}개의 Custom 용어 추가 완료 (CSV: ${rows.length}행, 폐기 제외: ${dropped}건)`);
  return terms.length;
}

export async function loadCustomWords(sqlite: SQLiteManager, dir: string): Promise<number> {
  const file = path.join(dir, CUSTOM_WORDS_CSV);
  if (!await fs.pathExists(file)) {
    console.warn(`  ⚠️ Custom 단어 CSV 가 없습니다: ${CUSTOM_WORDS_CSV} — 건너뜀.`);
    return 0;
  }

  const rows = await readCsvRows(file);
  let dropped = 0;
  const words = rows
    .filter((r) => {
      if (!r['공통표준단어명'] || !r['공통표준단어영문약어명']) return false;
      if (isDeprecatedRevision(r['제정차수'])) {
        dropped++;
        return false;
      }
      return true;
    })
    .map((r) => ({
      korean_name: r['공통표준단어명'].trim(),
      english_name: r['공통표준단어영문약어명'].trim(),
      english_full_name: normalizeCell(r['공통표준단어 영문명']) ?? undefined,
      description: normalizeCell(r['공통표준단어 설명']) ?? undefined,
      is_format_word: normalizeCell(r['형식단어여부']) === 'Y',
      domain_category: normalizeCell(r['공통표준도메인분류명']) ?? undefined,
      synonyms: normalizeCell(r['이음동의어 목록']) ?? undefined,
      forbidden_words: normalizeCell(r['금칙어 목록']) ?? undefined,
      revision_round: normalizeCell(r['제정차수']) ?? undefined,
      revision_type: normalizeCell(r['개정구분명(폐기 또는 변경)']) ?? undefined,
      revision_item: normalizeCell(r['개정항목']) ?? undefined,
      revision_reason: normalizeCell(r['개정사유']) ?? undefined,
    }));

  if (words.length === 0) {
    console.error(`  ⚠️ 활성 Custom 단어가 없습니다 (CSV: ${rows.length}행, 폐기 제외: ${dropped}건)`);
    return 0;
  }
  sqlite.addCustomWordsBatch(words);
  console.error(`  ✓ ${words.length}개의 Custom 단어 추가 완료 (CSV: ${rows.length}행, 폐기 제외: ${dropped}건)`);
  return words.length;
}

export async function loadCustomDomains(sqlite: SQLiteManager, dir: string): Promise<number> {
  const file = path.join(dir, CUSTOM_DOMAINS_CSV);
  if (!await fs.pathExists(file)) {
    console.warn(`  ⚠️ Custom 도메인 CSV 가 없습니다: ${CUSTOM_DOMAINS_CSV} — 건너뜀.`);
    return 0;
  }

  const rows = await readCsvRows(file);
  let dropped = 0;
  const domains = rows
    .filter((r) => {
      if (!r['공통표준도메인명'] || !r['데이터타입']) return false;
      if (isDeprecatedRevision(r['제정차수'])) {
        dropped++;
        return false;
      }
      return true;
    })
    .map((r) => ({
      domain_name: r['공통표준도메인명'].trim(),
      data_type: r['데이터타입'].trim(),
      domain_group: normalizeCell(r['공통표준도메인그룹명']) ?? undefined,
      domain_category: normalizeCell(r['공통표준도메인분류명']) ?? undefined,
      description: normalizeCell(r['공통표준도메인설명']) ?? undefined,
      data_length: normalizeCell(r['데이터길이']) ?? undefined,
      decimal_length: normalizeCell(r['데이터소수점길이']) ?? undefined,
      storage_format: normalizeCell(r['저장형식']) ?? undefined,
      display_format: normalizeCell(r['표현형식']) ?? undefined,
      unit: normalizeCell(r['단위']) ?? undefined,
      allowed_values: normalizeCell(r['허용값']) ?? undefined,
      revision_round: normalizeCell(r['제정차수']) ?? undefined,
      revision_type: normalizeCell(r['개정구분명(폐기 또는 변경)']) ?? undefined,
      revision_item: normalizeCell(r['개정항목']) ?? undefined,
      revision_reason: normalizeCell(r['개정사유']) ?? undefined,
    }));

  if (domains.length === 0) {
    console.error(`  ⚠️ 활성 Custom 도메인이 없습니다 (CSV: ${rows.length}행, 폐기 제외: ${dropped}건)`);
    return 0;
  }
  sqlite.addCustomDomainsBatch(domains);
  console.error(`  ✓ ${domains.length}개의 Custom 도메인 추가 완료 (CSV: ${rows.length}행, 폐기 제외: ${dropped}건)`);
  return domains.length;
}

/** Custom 사전 3종 일괄 재적재 (clear 후 로드) — 적재 건수 요약 반환 */
export async function reloadCustomDictionaries(
  sqlite: SQLiteManager,
  dir: string,
): Promise<{ terms: number; words: number; domains: number }> {
  sqlite.clearCustomReferenceData();
  const terms = await loadCustomTerms(sqlite, dir);
  const words = await loadCustomWords(sqlite, dir);
  const domains = await loadCustomDomains(sqlite, dir);
  return { terms, words, domains };
}

// ─── Custom ↔ Standard 충돌 보고 ─────────────────────────

export function reportShadowingConflicts(sqlite: SQLiteManager) {
  const db = (sqlite as any).db; // 내부 better-sqlite3 인스턴스 접근
  const termConflicts = db.prepare(`
    SELECT ct.korean_name,
           ct.english_name AS custom_eng, st.english_name AS std_eng,
           ct.domain_name AS custom_domain, st.domain_name AS std_domain
    FROM custom_terms ct
    JOIN standard_terms st ON ct.korean_name = st.korean_name
    WHERE ct.english_name != st.english_name OR IFNULL(ct.domain_name,'') != IFNULL(st.domain_name,'')
  `).all() as Array<{ korean_name: string; custom_eng: string; std_eng: string; custom_domain: string | null; std_domain: string | null }>;

  const domainConflicts = db.prepare(`
    SELECT cd.domain_name,
           cd.data_type AS custom_type, sd.data_type AS std_type,
           cd.data_length AS custom_len, sd.data_length AS std_len
    FROM custom_domains cd
    JOIN standard_domains sd ON cd.domain_name = sd.domain_name
    WHERE cd.data_type != sd.data_type OR IFNULL(cd.data_length,'') != IFNULL(sd.data_length,'')
  `).all() as Array<{ domain_name: string; custom_type: string; std_type: string; custom_len: string | null; std_len: string | null }>;

  const wordConflicts = db.prepare(`
    SELECT cw.korean_name,
           cw.english_name AS custom_eng, sw.english_name AS std_eng
    FROM custom_words cw
    JOIN standard_words sw ON cw.korean_name = sw.korean_name
    WHERE cw.english_name != sw.english_name
  `).all() as Array<{ korean_name: string; custom_eng: string; std_eng: string }>;

  const total = termConflicts.length + domainConflicts.length + wordConflicts.length;
  if (total === 0) {
    console.error('  ✓ Custom 이 standard 를 가리는 항목 없음.');
    return;
  }

  console.error(`  ⚠️ Custom override 감지: 용어 ${termConflicts.length}건 / 단어 ${wordConflicts.length}건 / 도메인 ${domainConflicts.length}건`);
  for (const c of termConflicts.slice(0, 20)) {
    console.error(`     [용어] '${c.korean_name}': custom=${c.custom_eng}/${c.custom_domain ?? '-'} ⇄ standard=${c.std_eng}/${c.std_domain ?? '-'}`);
  }
  for (const c of wordConflicts.slice(0, 20)) {
    console.error(`     [단어] '${c.korean_name}': custom=${c.custom_eng} ⇄ standard=${c.std_eng}`);
  }
  for (const c of domainConflicts.slice(0, 20)) {
    console.error(`     [도메인] '${c.domain_name}': custom=${c.custom_type}(${c.custom_len ?? '-'}) ⇄ standard=${c.std_type}(${c.std_len ?? '-'})`);
  }
  if (total > 60) {
    console.error(`     … (총 ${total}건 중 최대 60건만 표시)`);
  }
  console.error('  ℹ️ Override 는 의도된 동작입니다 — lookup 시 custom 이 우선되고, 응답에 standard 동등 항목이 함께 노출됩니다.');
}
