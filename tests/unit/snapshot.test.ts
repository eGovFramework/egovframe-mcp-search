/**
 * 개발자 지식 스냅샷 형식 단위 테스트
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import XLSX from 'xlsx';
import { INDEXED_KNOWLEDGE_TAGS, INDEXED_KNOWLEDGE_TYPES } from '../../src/types/knowledge.js';
import {
  parseSnapshotFile,
  writeSnapshotFile,
  parseManifestFile,
  writeManifestFile,
  buildManifest,
  compareDatasetVersion,
  diffSnapshots,
  xlsxToSnapshotRows,
  snapshotRowToKnowledgeInput,
  type SnapshotRow,
} from '../../src/kb/snapshot.js';

const ROW_A: SnapshotRow = {
  id: 'qa:100', kind: 'qa', title: '질문 제목', question: '어떻게 하나요?', answer: '이렇게 합니다.',
};
const ROW_B: SnapshotRow = {
  id: 'faq:1', kind: 'faq', title: 'FAQ 제목', question: 'FAQ 질문', answer: 'FAQ 답변', category: '일반',
};

describe('snapshot format', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'egov-snap-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('write → parse 라운드트립이 데이터를 보존한다', async () => {
    const p = path.join(tmpDir, 'snapshot.jsonl.gz');
    writeSnapshotFile(p, [ROW_A, ROW_B]);
    const rows = parseSnapshotFile(p);
    // canonical 직렬화는 id 정렬 — faq:1 < qa:100
    expect(rows.map((r) => r.id)).toEqual(['faq:1', 'qa:100']);
    expect(rows[1]).toEqual(ROW_A);
    expect(rows[0]).toEqual(ROW_B);
  });

  it('동일 데이터는 입력 순서와 무관하게 동일 바이트를 생성한다 (결정적 직렬화)', async () => {
    const p1 = path.join(tmpDir, 's1.jsonl.gz');
    const p2 = path.join(tmpDir, 's2.jsonl.gz');
    writeSnapshotFile(p1, [ROW_A, ROW_B]);
    writeSnapshotFile(p2, [ROW_B, ROW_A]);
    expect((await fs.readFile(p1)).equals(await fs.readFile(p2))).toBe(true);
  });

  it('형식 오류 행을 줄 번호와 함께 거부한다', async () => {
    const zlib = await import('node:zlib');
    const bad = zlib.gzipSync(Buffer.from('{"id":"x","kind":"invalid"}\n'));
    const p = path.join(tmpDir, 'bad.jsonl.gz');
    await fs.writeFile(p, bad);
    expect(() => parseSnapshotFile(p)).toThrow(/1번째 줄/);
  });

  it('manifest write → parse 라운드트립', async () => {
    const p = path.join(tmpDir, 'manifest.json');
    writeManifestFile(p, buildManifest('2026-08-24.1', 2));
    const m = parseManifestFile(p);
    expect(m.dataset_version).toBe('2026-08-24.1');
    expect(m.row_count).toBe(2);
    expect(m.embedding_model.id).toContain('e5-small');
  });
});

describe('compareDatasetVersion', () => {
  it('날짜 우선, 같은 날짜는 순번 숫자 비교', () => {
    expect(compareDatasetVersion('2026-08-24.1', '2026-08-11.1')).toBeGreaterThan(0);
    expect(compareDatasetVersion('2026-08-24.2', '2026-08-24.10')).toBeLessThan(0);
    expect(compareDatasetVersion('2026-08-24.1', '2026-08-24.1')).toBe(0);
  });
});

describe('diffSnapshots', () => {
  it('신규/변경/삭제를 3분류한다', () => {
    const oldRows = [ROW_A, ROW_B];
    const newRows: SnapshotRow[] = [
      { ...ROW_A, answer: '수정된 답변입니다.' }, // 변경
      { id: 'qa:200', kind: 'qa', title: '새 질문', question: 'Q', answer: 'A' }, // 신규
      // ROW_B 부재 → 삭제
    ];
    const diff = diffSnapshots(oldRows, newRows);
    expect(diff.added.map((r) => r.id)).toEqual(['qa:200']);
    expect(diff.changed.map((r) => r.id)).toEqual(['qa:100']);
    expect(diff.removedIds).toEqual(['faq:1']);
  });

  it('무변경이면 세 목록 모두 비어 있다', () => {
    const diff = diffSnapshots([ROW_A, ROW_B], [ROW_B, ROW_A]);
    expect(diff.added).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
    expect(diff.removedIds).toHaveLength(0);
  });
});

describe('xlsxToSnapshotRows', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'egov-xlsx-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('QA xlsx 를 스냅샷 행으로 변환한다 (HTML 정리 포함)', async () => {
    const p = path.join(tmpDir, '묻고답하기-LET_TN_QA_INFO.xlsx');
    const sheet = XLSX.utils.json_to_sheet([
      { QA_ID: '18234', QESTN_SJ: '제목<br/>둘째줄', QESTN_CN: '<p>질문 본문</p>', ANSWER_CN: '답변 &amp; 내용' },
      { QA_ID: '18235', QESTN_SJ: '빈 행', QESTN_CN: '', ANSWER_CN: '' }, // 제외 대상
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Sheet1');
    XLSX.writeFile(wb, p);

    const rows = xlsxToSnapshotRows(p);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('qa:18234');
    expect(rows[0].kind).toBe('qa');
    expect(rows[0].title).toBe('제목\n둘째줄');
    expect(rows[0].question).toBe('질문 본문');
    expect(rows[0].answer).toBe('답변 & 내용');
  });

  it('답변이 없는 글은 스냅샷에 넣지 않는다', async () => {
    // 답변이 달리지 않은 질문(테스트 글, 스팸 포함)은 해결 사례가 아니다
    const p = path.join(tmpDir, '묻고답하기-LET_TN_QA_INFO.xlsx');
    const sheet = XLSX.utils.json_to_sheet([
      { QA_ID: '1', QESTN_SJ: '답변 있는 글', QESTN_CN: '질문', ANSWER_CN: '답변' },
      { QA_ID: '2', QESTN_SJ: '테스트입니다.', QESTN_CN: '테스트', ANSWER_CN: '' },
      { QA_ID: '3', QESTN_SJ: '공백뿐인 답변', QESTN_CN: '질문', ANSWER_CN: '   <br/> ' },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Sheet1');
    XLSX.writeFile(wb, p);

    expect(xlsxToSnapshotRows(p).map((row) => row.id)).toEqual(['qa:1']);
  });

  it('FAQ 파일명은 kind=faq 로 인식한다', async () => {
    const p = path.join(tmpDir, '자주묻는질문-LET_TN_FAQ_INFO.xlsx');
    const sheet = XLSX.utils.json_to_sheet([
      { FAQ_ID: '12', QESTN_SJ: 'FAQ 제목', QESTN_CN: 'Q', ANSWER_CN: 'A' },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Sheet1');
    XLSX.writeFile(wb, p);

    const rows = xlsxToSnapshotRows(p);
    expect(rows[0].id).toBe('faq:12');
    expect(rows[0].kind).toBe('faq');
  });
});

describe('snapshotRowToKnowledgeInput — 민감한 식별번호', () => {
  it('제목과 본문의 주민등록번호 형식을 가려서 색인 입력을 만든다', () => {
    // 테스트용으로 지어낸 값이다
    const input = snapshotRowToKnowledgeInput({
      id: 'qa:900',
      kind: 'qa',
      title: '개인정보 900101-1234567 문의',
      question: '번호 900101-1234567 가 보입니다',
      answer: '850505-2345678 은 가려야 합니다',
    });

    expect(input.title).toBe('개인정보 ******-******* 문의');
    expect(input.content).toBe('질문:\n번호 ******-******* 가 보입니다\n\n답변:\n******-******* 은 가려야 합니다');
  });
});

describe('snapshotRowToKnowledgeInput', () => {
  it('붙이는 태그와 type 은 없는 값을 안내할 때 쓰는 목록(INDEXED_KNOWLEDGE_*)에 들어 있다', () => {
    for (const kind of ['qa', 'faq'] as const) {
      const input = snapshotRowToKnowledgeInput({ ...ROW_A, kind });

      const tags = input.tags ?? [];
      expect(tags.length).toBeGreaterThan(0);
      for (const tag of tags) {
        expect(INDEXED_KNOWLEDGE_TAGS as readonly string[], tag).toContain(tag);
        expect(tag, tag).toBe(tag.toLowerCase());
      }
      expect(INDEXED_KNOWLEDGE_TYPES as readonly string[]).toContain(input.type);
    }
  });

  it('기존 xlsx 인덱싱과 동일한 매핑을 유지한다', () => {
    const input = snapshotRowToKnowledgeInput(ROW_A);
    expect(input.type).toBe('solution');
    expect(input.content).toBe('질문:\n어떻게 하나요?\n\n답변:\n이렇게 합니다.');
    expect(input.context).toBe('표준프레임워크 묻고답하기');
    expect(input.importance).toBe(3);
    expect(input.metadata?.sourceType).toBe('qa');
    expect(input.metadata?.originalId).toBe('100'); // "qa:" 접두 제거
  });
});
