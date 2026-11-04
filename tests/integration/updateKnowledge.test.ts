/**
 * update CLI — 개발자 지식 증분 갱신 통합 테스트 (실제 LanceDB + 로컬 임베딩)
 *
 * 폐쇄망 반입(--from-file) 경로로 전체 흐름을 검증한다:
 * 잠금 → 반입 파일 검증 → 단조성 → 부트스트랩 복사 → id 대조 diff →
 * 삭제 스코핑(PDF 보존) → 변경분 임베딩 → 검증 프로브 → state 원자 교체 → 롤백.
 *
 * 임베딩 모델(models/)이 저장소에 있어야 한다 (없으면 skip).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runUpdate } from '../../src/cli/update.js';
import {
  writeSnapshotFile,
  writeManifestFile,
  buildManifest,
  snapshotRowToKnowledgeInput,
  type SnapshotRow,
} from '../../src/kb/snapshot.js';
import {
  SCHEMA_VERSION,
  EMBEDDING_MODEL_ID,
  readOverlayState,
  writeOverlayStateAtomic,
  getOverlayRoot,
} from '../../src/utils/dataPaths.js';
import { DeveloperKnowledgeManager } from '../../src/rag/knowledgeManager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const MODEL_PRESENT = fs.existsSync(
  path.join(REPO_ROOT, 'models', 'Xenova', 'multilingual-e5-small', 'onnx', 'model_quantized.onnx'),
);

const ROW_A: SnapshotRow = { id: 'qa:100', kind: 'qa', title: '유지 행', question: '질문 A', answer: '답변 A' };
const ROW_B: SnapshotRow = { id: 'qa:200', kind: 'qa', title: '변경 행', question: '질문 B', answer: '옛 답변 B' };
const ROW_B2: SnapshotRow = { ...ROW_B, answer: '새 답변 B' };
const ROW_C: SnapshotRow = { id: 'faq:300', kind: 'faq', title: '신규 행', question: '질문 C', answer: '답변 C' };

const SEED_VERSION = '2026-01-01.0';
const NEW_VERSION = '2026-01-02.0';
const SEED_DIR_REL = path.join('resources', 'developer_knowledge', 'v-seed');

describe.skipIf(!MODEL_PRESENT)('update CLI — developer_knowledge (from-file)', () => {
  let tmpRoot: string;
  let fromFileDir: string;
  let savedEnv: string | undefined;

  beforeAll(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'egov-update-it-'));
    savedEnv = process.env.EGOV_MCP_DATA_DIR;
    process.env.EGOV_MCP_DATA_DIR = path.join(tmpRoot, 'overlay');

    // ── 오버레이 시드: 기존 적용본 (A, B) + PDF 청크 1개 ──
    const seedDirAbs = path.join(getOverlayRoot(), SEED_DIR_REL);
    const manager = new DeveloperKnowledgeManager(seedDirAbs);
    await manager.initialize();
    await manager.addKnowledgeBatch([
      snapshotRowToKnowledgeInput(ROW_A),
      snapshotRowToKnowledgeInput(ROW_B),
      {
        type: 'best-practice',
        title: '적용가이드 PDF 청크',
        content: '스냅샷 스코프 밖 — 삭제 스코핑으로 보존되어야 한다.',
        context: '표준프레임워크 적용가이드 PDF',
        tags: ['pdf'],
        relatedTo: [],
        importance: 5,
        verified: true,
        metadata: { source: 'templates/developer_knowledge', sourceType: 'pdf' },
      },
    ]);
    writeSnapshotFile(path.join(seedDirAbs, 'snapshot.applied.jsonl.gz'), [ROW_A, ROW_B]);

    writeOverlayStateAtomic({
      schema_version: SCHEMA_VERSION,
      embedding_model: { id: EMBEDDING_MODEL_ID },
      resources: {
        developer_knowledge: {
          version: SEED_VERSION,
          dir: SEED_DIR_REL,
          row_count: 2,
          origin: 'from-file',
          embedding_model: EMBEDDING_MODEL_ID,
        },
      },
    });

    // ── 반입 디렉토리: 새 스냅샷 (A 유지, B 변경, C 신규) ──
    fromFileDir = path.join(tmpRoot, 'import');
    writeManifestFile(path.join(fromFileDir, 'manifest.json'), buildManifest(NEW_VERSION, 3));
    writeSnapshotFile(path.join(fromFileDir, 'snapshot.jsonl.gz'), [ROW_A, ROW_B2, ROW_C]);
  }, 180_000);

  afterAll(async () => {
    if (savedEnv === undefined) delete process.env.EGOV_MCP_DATA_DIR;
    else process.env.EGOV_MCP_DATA_DIR = savedEnv;
    await fs.remove(tmpRoot);
  });

  it('증분 갱신 — 변경분만 반영하고 PDF 청크를 보존한다', async () => {
    const code = await runUpdate([
      '--from-file', fromFileDir, '--resource=developer_knowledge', '--yes',
    ]);
    expect(code).toBe(0);

    const state = readOverlayState();
    const entry = state?.resources.developer_knowledge;
    expect(entry?.version).toBe(NEW_VERSION);
    expect(entry?.dir).not.toBe(SEED_DIR_REL);
    expect(entry?.previous_dir).toBe(SEED_DIR_REL);
    expect(entry?.row_count).toBe(3);

    // 새 버전 디렉토리 내용 검증
    const manager = new DeveloperKnowledgeManager(path.join(getOverlayRoot(), entry!.dir!));
    await manager.initialize();

    const qaFaq = await manager.listSourceRows(['qa', 'faq']);
    expect(qaFaq.map((r) => r.originalId).sort()).toEqual(['100', '200', '300']);

    const pdf = await manager.listSourceRows(['pdf']);
    expect(pdf).toHaveLength(1); // 삭제 스코핑 — PDF 전멸 방지

    const stats = await manager.getStats();
    expect(stats.total).toBe(4); // qa/faq 3 + pdf 1

    // 다음 diff 기준본이 새 버전 디렉토리에 보관된다
    expect(
      await fs.pathExists(path.join(getOverlayRoot(), entry!.dir!, 'snapshot.applied.jsonl.gz')),
    ).toBe(true);
  }, 180_000);

  it('같은 스냅샷 재적용은 "이미 최신" 으로 스킵한다 (멱등성)', async () => {
    const before = readOverlayState()?.resources.developer_knowledge;
    const code = await runUpdate([
      '--from-file', fromFileDir, '--resource=developer_knowledge', '--yes',
    ]);
    expect(code).toBe(0);
    const after = readOverlayState()?.resources.developer_knowledge;
    expect(after?.dir).toBe(before?.dir);
    expect(after?.applied_at).toBe(before?.applied_at);
  }, 60_000);

  it('--rollback 으로 직전 버전에 복귀한다', async () => {
    const code = await runUpdate(['--rollback=developer_knowledge']);
    expect(code).toBe(0);

    const entry = readOverlayState()?.resources.developer_knowledge;
    expect(entry?.dir).toBe(SEED_DIR_REL);
    expect(entry?.previous_dir).toBeUndefined();

    // 복귀한 디렉토리는 시드 상태 (A, B + PDF)
    const manager = new DeveloperKnowledgeManager(path.join(getOverlayRoot(), SEED_DIR_REL));
    await manager.initialize();
    const stats = await manager.getStats();
    expect(stats.total).toBe(3);
  }, 60_000);
});
