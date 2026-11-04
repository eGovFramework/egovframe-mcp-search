/**
 * update CLI — developer_knowledge (LanceDB) 갱신
 *
 * 릴리스 스냅샷(manifest + snapshot.jsonl.gz)을 직전 적용 스냅샷과 id 대조해
 * 변경분만 로컬 임베딩한다. 삭제는 sourceType∈{qa,faq} 스코핑으로 PDF 청크를
 * 보존한다. 실효 lance 테이블을 새 버전 디렉토리로 복사한 뒤 그 위에서
 * 작업하므로 도중 실패해도 현재 적용본은 무손상이다.
 */

import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import {
  EMBEDDING_MODEL_ID,
  resolveResource,
  type ResourceState,
} from '../../utils/dataPaths.js';
import { getKnowledgeBasePath } from '../../utils/projectPath.js';
import {
  MANIFEST_FILENAME,
  SNAPSHOT_FILENAME,
  assertManifestCompatible,
  parseManifestFile,
  parseSnapshotFile,
  compareDatasetVersion,
  diffSnapshots,
  snapshotRowToKnowledgeInput,
  type SnapshotRow,
} from '../../kb/snapshot.js';
import { snapshotManifestUrl, snapshotFileUrl } from '../../kb/sources.js';
import { downloadToFile } from '../../utils/download.js';
import { DeveloperKnowledgeManager } from '../../rag/knowledgeManager.js';
import {
  CLI_FILE,
  RESOURCE_LABELS,
  overlayResourceDir,
  commitResourceState,
  pruneOldVersions,
  type UpdateOptions,
} from '../shared.js';

export interface KnowledgeUpdateResult {
  version: string;
  added: number;
  changed: number;
  removed: number;
  fullRebuild: boolean;
}

export async function updateDeveloperKnowledge(options: UpdateOptions): Promise<KnowledgeUpdateResult | 'skip'> {
  const label = RESOURCE_LABELS.developer_knowledge;
  console.error(`\n▶ ${label} 갱신...`);

  // 1. 소스 확보 (릴리스 다운로드 또는 반입 디렉토리)
  let manifestPath: string;
  let snapshotPath: string;
  let origin: ResourceState['origin'];
  let tmpDir: string | null = null;

  if (options.fromFileDir) {
    manifestPath = path.join(options.fromFileDir, MANIFEST_FILENAME);
    snapshotPath = path.join(options.fromFileDir, SNAPSHOT_FILENAME);
    origin = 'from-file';
    if (!await fs.pathExists(manifestPath) || !await fs.pathExists(snapshotPath)) {
      console.error(`  ⚠️ 반입 디렉토리에 ${MANIFEST_FILENAME}/${SNAPSHOT_FILENAME} 이 없어 스킵합니다.`);
      return 'skip';
    }
  } else {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'egov-update-kb-'));
    manifestPath = path.join(tmpDir, MANIFEST_FILENAME);
    snapshotPath = path.join(tmpDir, SNAPSHOT_FILENAME);
    origin = 'release';
    console.error('  ⬇ manifest 다운로드...');
    await downloadToFile(snapshotManifestUrl(), manifestPath, { timeoutMs: 30_000, maxBytes: 10 * 1024 * 1024 });
  }

  try {
    // 2. 검증 — 스키마·모델 호환성
    const manifest = parseManifestFile(manifestPath);
    assertManifestCompatible(manifest);

    // 3. 단조성 — 다운그레이드 기본 거부
    const effective = resolveResource('developer_knowledge', CLI_FILE);
    const currentVersion = effective.state?.version ?? null;
    if (currentVersion) {
      const cmp = compareDatasetVersion(manifest.dataset_version, currentVersion);
      if (cmp === 0 && !options.full) {
        console.error(`  ✓ 이미 최신입니다 (${currentVersion})`);
        return 'skip';
      }
      if (cmp < 0 && !options.force) {
        console.error(
          `  ⚠️ 대상 버전(${manifest.dataset_version})이 현재(${currentVersion})보다 오래되어 거부합니다 (--force 로 강제 가능).`,
        );
        return 'skip';
      }
    }

    // 4. 스냅샷 확보 + 파싱
    if (origin === 'release') {
      console.error('  ⬇ snapshot 다운로드...');
      await downloadToFile(snapshotFileUrl(), snapshotPath, { timeoutMs: 300_000, maxBytes: 128 * 1024 * 1024 });
    }
    const newRows = parseSnapshotFile(snapshotPath);
    if (newRows.length !== manifest.row_count) {
      throw new Error(`스냅샷 행 수(${newRows.length})가 manifest(${manifest.row_count})와 다릅니다.`);
    }

    // 5. 직전 적용 스냅샷 (diff 기준본) — 오버레이 우선, 없으면 번들 동봉본
    let prevRows: SnapshotRow[] | null = null;
    const appliedPath = effective.source === 'overlay'
      ? path.join(effective.dir, 'snapshot.applied.jsonl.gz')
      : path.join(getKnowledgeBasePath(CLI_FILE), SNAPSHOT_FILENAME);
    if (!options.full && await fs.pathExists(appliedPath)) {
      try {
        prevRows = parseSnapshotFile(appliedPath);
      } catch {
        console.error('  ⚠️ 직전 스냅샷을 읽을 수 없어 전량 재구축으로 진행합니다.');
      }
    }

    // 6. 부트스트랩 — 실효 lance 테이블을 새 버전 디렉토리로 복사
    const sourceTable = path.join(effective.dir, 'developer_knowledge.lance');
    if (!await fs.pathExists(sourceTable)) {
      throw new Error('developer_knowledge.lance 를 찾을 수 없습니다 — 패키지 설치가 손상되었을 수 있습니다.');
    }
    const { abs: versionDir, rel: versionRel } = overlayResourceDir('developer_knowledge', manifest.dataset_version);
    await fs.remove(versionDir);
    await fs.copy(sourceTable, path.join(versionDir, 'developer_knowledge.lance'));

    const manager = new DeveloperKnowledgeManager(versionDir);
    await manager.initialize();

    // 7. qa/faq 스코프 행 목록 (삭제 스코핑 — PDF 청크 보호)
    const qaFaqRows = await manager.listSourceRows(['qa', 'faq']);
    const statsBefore = await manager.getStats();
    const pdfCount = statsBefore.total - qaFaqRows.length;

    // 8. 작업 결정 — 증분 diff 또는 전량
    const fullRebuild = options.full || prevRows === null;
    let toAdd: SnapshotRow[];
    let removeLanceIds: string[];
    let addedCount: number;
    let changedCount: number;
    let removedCount: number;

    if (fullRebuild) {
      toAdd = newRows;
      removeLanceIds = qaFaqRows.map((r) => r.id);
      addedCount = newRows.length;
      changedCount = 0;
      removedCount = qaFaqRows.length;
      console.error(`  ↻ 전량 재구축: 기존 Q&A/FAQ ${removedCount}행 제거 후 ${addedCount}행 임베딩 (PDF ${pdfCount}청크 보존)`);
    } else {
      const diff = diffSnapshots(prevRows!, newRows);
      addedCount = diff.added.length;
      changedCount = diff.changed.length;
      removedCount = diff.removedIds.length;
      toAdd = [...diff.added, ...diff.changed];

      // 삭제 대상: removed + changed — (sourceType, originalId) → lance id 매핑
      const byKey = new Map<string, string[]>();
      for (const row of qaFaqRows) {
        const key = row.originalId;
        const list = byKey.get(key);
        if (list) list.push(row.id);
        else byKey.set(key, [row.id]);
      }
      const targetIds = [...diff.removedIds, ...diff.changed.map((r) => r.id)];
      removeLanceIds = targetIds.flatMap((snapshotId) => {
        const originalId = snapshotId.replace(/^(qa|faq):/, '');
        return byKey.get(originalId) ?? [];
      });
      console.error(`  Δ 신규 ${addedCount} · 변경 ${changedCount} · 삭제 ${removedCount} (PDF ${pdfCount}청크 보존)`);

      if (addedCount + changedCount + removedCount === 0) {
        console.error('  ✓ 내용 변경 없음 — 버전 표기만 갱신합니다.');
      }
    }

    // 9. 적용 — 삭제 후 변경분 임베딩
    if (removeLanceIds.length > 0) {
      await manager.deleteByIds(removeLanceIds);
    }
    if (toAdd.length > 0) {
      await manager.addKnowledgeBatch(toAdd.map(snapshotRowToKnowledgeInput));
    }
    await manager.optimize();

    // 10. 검증 프로브 — 행 수 대조
    const statsAfter = await manager.getStats();
    const expected = pdfCount + newRows.length;
    if (statsAfter.total !== expected) {
      throw new Error(`검증 실패: 행 수 ${statsAfter.total} ≠ 기대값 ${expected}. 이 버전은 적용하지 않습니다.`);
    }

    // 11. 다음 diff 기준본 보관 + 상태 원자 교체
    await fs.copy(snapshotPath, path.join(versionDir, 'snapshot.applied.jsonl.gz'));
    const previousDir = effective.source === 'overlay' ? effective.state?.dir : undefined;
    commitResourceState('developer_knowledge', {
      version: manifest.dataset_version,
      dir: versionRel,
      previous_dir: previousDir,
      row_count: newRows.length,
      origin,
      embedding_model: EMBEDDING_MODEL_ID,
      applied_at: new Date().toISOString(),
    });
    await pruneOldVersions('developer_knowledge', [versionRel, previousDir]);

    return {
      version: manifest.dataset_version,
      added: addedCount,
      changed: changedCount,
      removed: removedCount,
      fullRebuild,
    };
  } finally {
    if (tmpDir) await fs.remove(tmpDir).catch(() => {});
  }
}
