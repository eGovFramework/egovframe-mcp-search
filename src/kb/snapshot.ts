/**
 * 개발자 지식(Q&A/FAQ) 스냅샷 형식
 *
 * 발행 파이프라인 ↔ build-index ↔ update CLI 가 공유하는 canonical 산출물:
 *   manifest.json       { schema_version, dataset_version, generated_at,
 *                         embedding_model: { id }, row_count }
 *   snapshot.jsonl.gz   한 줄에 게시글 하나 (id 정렬, 결정적 직렬화)
 *
 * 행별 해시·서명은 두지 않는다 (채널 신뢰 전제). 증분 diff 는 직전 적용
 * 스냅샷을 통째로 보관해 두고 id 기준으로 본문을 직접 비교해 계산한다 —
 * 스냅샷 전체(~10MB)를 어차피 받으므로 해시 없이도 증분이 성립한다.
 *
 * 스냅샷이 아직 없는 환경(발행 파이프라인 가동 전)을 위해 기존 xlsx 2종에서
 * 동일 형식의 스냅샷을 합성하는 경로를 제공한다 — build-index 가 xlsx 로
 * 빌드하더라도 tgz 에 스냅샷이 동봉되어 사용자 update 의 diff 부트스트랩이
 * 성립한다.
 */

import fs from 'fs-extra';
import path from 'node:path';
import zlib from 'node:zlib';
import { z } from 'zod';
import XLSX from 'xlsx';
import { SCHEMA_VERSION, EMBEDDING_MODEL_ID } from '../utils/dataPaths.js';
import type { AddKnowledgeInput } from '../types/knowledge.js';

// ─── 스키마 ──────────────────────────────────────────────

export const snapshotRowSchema = z.object({
  /** 원천 게시글 ID (QA_ID / FAQ_ID). 행 단위 증분의 키 */
  id: z.string().min(1),
  kind: z.enum(['qa', 'faq']),
  title: z.string(),
  question: z.string(),
  answer: z.string(),
  category: z.string().optional(),
  language: z.string().optional(),
});

export type SnapshotRow = z.infer<typeof snapshotRowSchema>;

export const manifestSchema = z.object({
  schema_version: z.number().int(),
  dataset_version: z.string().min(1),
  generated_at: z.string(),
  embedding_model: z.object({ id: z.string() }),
  row_count: z.number().int().nonnegative(),
});

export type SnapshotManifest = z.infer<typeof manifestSchema>;

/** 스냅샷 파일 표준 이름 (릴리스 자산·번들 동봉·오버레이 보관 공통) */
export const SNAPSHOT_FILENAME = 'snapshot.jsonl.gz';
export const MANIFEST_FILENAME = 'manifest.json';

/** gzip 해제 상한 (row_count 1.8만 기준 원문 ~42MB — 여유 포함) */
const SNAPSHOT_MAX_BYTES = 256 * 1024 * 1024;

// ─── 파싱 / 직렬화 ───────────────────────────────────────

export function parseManifestFile(filePath: string): SnapshotManifest {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = manifestSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(`manifest.json 형식이 올바르지 않습니다: ${parsed.error.issues[0]?.message ?? '알 수 없는 오류'}`);
  }
  return parsed.data;
}

/** snapshot.jsonl.gz 파싱 (gzip 폭탄 가드 + 행별 zod 검증) */
export function parseSnapshotFile(filePath: string): SnapshotRow[] {
  let jsonl: string;
  try {
    jsonl = zlib
      .gunzipSync(fs.readFileSync(filePath), { maxOutputLength: SNAPSHOT_MAX_BYTES })
      .toString('utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') {
      throw new Error('스냅샷 압축 해제 결과가 상한을 초과합니다 (gzip 폭탄 가드)');
    }
    throw new Error('스냅샷 gzip 해제에 실패했습니다 — 파일이 손상되었을 수 있습니다');
  }

  const rows: SnapshotRow[] = [];
  const lines = jsonl.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') continue;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      throw new Error(`스냅샷 ${i + 1}번째 줄이 JSON 이 아닙니다`);
    }
    const parsed = snapshotRowSchema.safeParse(obj);
    if (!parsed.success) {
      throw new Error(`스냅샷 ${i + 1}번째 줄 형식 오류: ${parsed.error.issues[0]?.message ?? ''}`);
    }
    rows.push(parsed.data);
  }
  return rows;
}

/** canonical 직렬화 — id 정렬 + 고정 키 순서 → 데이터 무변경 시 바이트 동일 */
export function writeSnapshotFile(filePath: string, rows: SnapshotRow[]): void {
  const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id, 'en'));
  const jsonl = sorted
    .map((r) =>
      JSON.stringify({
        id: r.id,
        kind: r.kind,
        title: r.title,
        question: r.question,
        answer: r.answer,
        ...(r.category !== undefined && { category: r.category }),
        ...(r.language !== undefined && { language: r.language }),
      }),
    )
    .join('\n');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, zlib.gzipSync(Buffer.from(jsonl + '\n', 'utf-8')));
}

export function writeManifestFile(filePath: string, manifest: SnapshotManifest): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
}

// ─── 버전 비교 ───────────────────────────────────────────

/**
 * dataset_version("YYYY-MM-DD.N") 비교. a<b → 음수, 동일 → 0, a>b → 양수.
 * 형식 밖 문자열은 단순 사전순으로 비교한다.
 */
export function compareDatasetVersion(a: string, b: string): number {
  const re = /^(\d{4}-\d{2}-\d{2})\.(\d+)$/;
  const ma = a.match(re);
  const mb = b.match(re);
  if (ma && mb) {
    const dateCmp = ma[1].localeCompare(mb[1], 'en');
    if (dateCmp !== 0) return dateCmp;
    return Number(ma[2]) - Number(mb[2]);
  }
  return a.localeCompare(b, 'en');
}

// ─── 증분 diff ───────────────────────────────────────────

export interface SnapshotDiff {
  added: SnapshotRow[];
  changed: SnapshotRow[];
  removedIds: string[];
}

/** 본문 동일성 비교 키 (id 제외 전체 필드) */
function rowContentKey(r: SnapshotRow): string {
  return JSON.stringify([r.kind, r.title, r.question, r.answer, r.category ?? '', r.language ?? '']);
}

/** 직전 적용 스냅샷과 새 스냅샷을 id 기준으로 대조한다 */
export function diffSnapshots(oldRows: SnapshotRow[], newRows: SnapshotRow[]): SnapshotDiff {
  const oldById = new Map(oldRows.map((r) => [r.id, r]));
  const diff: SnapshotDiff = { added: [], changed: [], removedIds: [] };

  const newIds = new Set<string>();
  for (const row of newRows) {
    newIds.add(row.id);
    const prev = oldById.get(row.id);
    if (!prev) {
      diff.added.push(row);
    } else if (rowContentKey(prev) !== rowContentKey(row)) {
      diff.changed.push(row);
    }
  }
  for (const oldRow of oldRows) {
    if (!newIds.has(oldRow.id)) {
      diff.removedIds.push(oldRow.id);
    }
  }
  return diff;
}

// ─── xlsx → 스냅샷 합성 (발행 파이프라인 가동 전 폴백) ───

/** HTML 잔재 제거 + 공백 정규화 (기존 build-index 의 cleanText 이관) */
export function cleanText(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  const text = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint'
    ? value.toString()
    : '';

  return text
    .replaceAll('<br />', '\n')
    .replaceAll('<br/>', '\n')
    .replaceAll('<br>', '\n')
    .replaceAll(/<[^>]+>/g, ' ')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll(/\r\n?/g, '\n')
    .replaceAll(/[ \t]+/g, ' ')
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim();
}

/** 파일명으로 게시판 종류 추정 (기존 build-index 의 inferKnowledgeKind 이관) */
export function inferKnowledgeKind(filePath: string): 'faq' | 'qa' {
  const baseName = path.basename(filePath).toLowerCase();
  return baseName.includes('faq') || baseName.includes('자주묻') ? 'faq' : 'qa';
}

/**
 * 포털 추출 xlsx 를 스냅샷 행으로 변환한다.
 * 원천 ID(QA_ID/FAQ_ID)가 비어 있는 행은 위치 기반 폴백 id 를 부여한다
 * (증분 안정성이 떨어지지만 실데이터에는 거의 없는 경우).
 */
export function xlsxToSnapshotRows(filePath: string): SnapshotRow[] {
  const workbook = XLSX.readFile(filePath);
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '' });
  const kind = inferKnowledgeKind(filePath);

  const result: SnapshotRow[] = [];
  rows.forEach((row, idx) => {
    const title = cleanText(row.QESTN_SJ) || `${kind.toUpperCase()} ${idx + 1}`;
    const question = cleanText(row.QESTN_CN);
    const answer = cleanText(row.ANSWER_CN);
    if (!question && !answer) return;

    const originalId = cleanText(kind === 'faq' ? row.FAQ_ID : row.QA_ID);
    const category = cleanText(row.QESTN_CT || row.QESTN_ST);
    const language = cleanText(row.FAQ_NATION || row.QA_LANG_CD || row.NATIONALITY);

    result.push({
      id: originalId !== '' ? `${kind}:${originalId}` : `${kind}:row-${idx + 1}`,
      kind,
      title,
      question,
      answer,
      ...(category !== '' && { category }),
      ...(language !== '' && { language }),
    });
  });
  return result;
}

/** xlsx 파일들의 mtime 최댓값에서 합성 dataset_version 을 유도 (YYYY-MM-DD.0) */
export function synthesizeDatasetVersion(xlsxPaths: string[]): string {
  let latest = 0;
  for (const p of xlsxPaths) {
    try {
      latest = Math.max(latest, fs.statSync(p).mtimeMs);
    } catch {
      // 무시 — 남은 파일 기준
    }
  }
  const date = latest > 0 ? new Date(latest) : new Date();
  return `${date.toISOString().slice(0, 10)}.0`;
}

export function buildManifest(datasetVersion: string, rowCount: number): SnapshotManifest {
  return {
    schema_version: SCHEMA_VERSION,
    dataset_version: datasetVersion,
    generated_at: new Date().toISOString(),
    embedding_model: { id: EMBEDDING_MODEL_ID },
    row_count: rowCount,
  };
}

// ─── 스냅샷 행 → 인덱싱 입력 변환 ────────────────────────

/**
 * 스냅샷 행을 LanceDB 인덱싱 입력으로 변환한다.
 * 기존 xlsx 직접 인덱싱(readKnowledgeExcel)과 동일한 매핑을 유지해
 * 스냅샷 경로/xlsx 경로의 검색 결과가 달라지지 않게 한다.
 */
export function snapshotRowToKnowledgeInput(row: SnapshotRow): AddKnowledgeInput {
  return {
    type: 'solution',
    title: row.title,
    content: [`질문:\n${row.question}`, `답변:\n${row.answer}`].filter(Boolean).join('\n\n'),
    context: row.kind === 'faq' ? '표준프레임워크 FAQ' : '표준프레임워크 묻고답하기',
    tags: ['egovframe', 'developer_knowledge', row.kind],
    relatedTo: ['faq', 'qa', 'egovframe'],
    importance: row.kind === 'faq' ? 4 : 3,
    verified: true,
    metadata: {
      source: 'templates/developer_knowledge',
      sourceFile: `snapshot:${row.kind}`,
      sourceType: row.kind,
      originalId: row.id.replace(/^(qa|faq):/, ''),
      category: row.category ?? '',
      language: row.language ?? '',
    },
  };
}
