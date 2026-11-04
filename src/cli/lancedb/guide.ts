/**
 * update CLI — guide (LanceDB) 갱신
 *
 * GitHub 태그 소스(md)를 sparse checkout(이미지 제외)으로 받아 새 버전
 * 디렉토리에 전량 재인덱싱한다. sparse checkout 이 실패하면 소스 tarball
 * 에서 md 만 추출하는 경로로 폴백한다.
 */

import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import {
  EMBEDDING_MODEL_ID,
  resolveResource,
  type ResourceState,
} from '../../utils/dataPaths.js';
import { DOCS_REPO, listRemoteVersionTags, sourceTarballUrl } from '../../kb/sources.js';
import { downloadToFile } from '../../utils/download.js';
import { extractTarGz } from '../../utils/tarSafe.js';
import { GuideSearchManager } from '../../rag/guideManager.js';
import { indexGuideDirectory } from '../../kb/guideIndexer.js';
import { runGit, EGOVDOCS_REPO } from '../../scripts/templateSources.js';
import {
  CLI_FILE,
  RESOURCE_LABELS,
  overlayResourceDir,
  commitResourceState,
  pruneOldVersions,
  type UpdateOptions,
} from '../shared.js';

export interface GuideUpdateResult {
  version: string;
  chunks: number;
}

/** md 소스 확보 — sparse checkout 우선, 실패 시 tarball 폴백 */
async function acquireGuideMarkdown(tag: string, tmpDir: string): Promise<string> {
  const checkoutDir = path.join(tmpDir, 'docs');

  // 1순위: partial clone + sparse checkout (이미지 blob 을 아예 받지 않음)
  try {
    runGit([
      'clone', '--depth', '1', '--filter=blob:none', '--sparse',
      '--branch', tag, EGOVDOCS_REPO, checkoutDir,
    ]);
    runGit(['sparse-checkout', 'set', '--no-cone', '/*', '!**/images/**'], checkoutDir);
    if (await fs.pathExists(path.join(checkoutDir, '_index.md'))) {
      console.error('  ✓ sparse checkout 완료 (이미지 제외)');
      return checkoutDir;
    }
  } catch {
    console.error('  ⚠️ git sparse checkout 실패 — 소스 tarball 로 폴백합니다.');
  }

  // 폴백: 전체 tarball 에서 md 만 추출
  const tarPath = path.join(tmpDir, 'guide-src.tar.gz');
  console.error('  ⬇ 소스 tarball 다운로드 (전송량이 클 수 있습니다)...');
  await downloadToFile(sourceTarballUrl(DOCS_REPO, tag), tarPath, {
    timeoutMs: 600_000,
    maxBytes: 512 * 1024 * 1024,
  });
  await fs.remove(checkoutDir);
  extractTarGz(tarPath, checkoutDir, {
    stripComponents: 1,
    filter: (rel) => rel.endsWith('.md'),
  });
  await fs.remove(tarPath);
  return checkoutDir;
}

export async function updateGuide(options: UpdateOptions): Promise<GuideUpdateResult | 'skip'> {
  const label = RESOURCE_LABELS.guide;
  console.error(`\n▶ ${label} 갱신...`);

  const effective = resolveResource('guide', CLI_FILE);
  const currentVersion = effective.state?.version ?? null;

  // 대상 버전/소스 결정
  let targetVersion: string;
  let mdRoot: string;
  let origin: ResourceState['origin'];
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'egov-update-guide-'));

  try {
    if (options.fromFileDir) {
      origin = 'from-file';
      targetVersion = options.guideTag ?? 'from-file';
      const treeDir = path.join(options.fromFileDir, 'egovframe_guide');
      const tarFile = path.join(options.fromFileDir, 'guide-md.tar.gz');
      if (await fs.pathExists(path.join(treeDir, '_index.md'))) {
        mdRoot = treeDir;
      } else if (await fs.pathExists(tarFile)) {
        mdRoot = path.join(tmpDir, 'docs');
        extractTarGz(tarFile, mdRoot, { filter: (rel) => rel.endsWith('.md') });
      } else {
        console.error('  ⚠️ 반입 디렉토리에 egovframe_guide/ 또는 guide-md.tar.gz 가 없어 스킵합니다.');
        return 'skip';
      }
    } else {
      origin = 'release';
      targetVersion =
        options.guideTag ?? (await listRemoteVersionTags(DOCS_REPO))[0];
      if (!targetVersion) {
        console.error('  ⚠️ 원격에서 버전 태그를 찾지 못해 스킵합니다.');
        return 'skip';
      }
      if (targetVersion === currentVersion && !options.force) {
        console.error(`  ✓ 이미 최신입니다 (${currentVersion})`);
        return 'skip';
      }
      mdRoot = await acquireGuideMarkdown(targetVersion, tmpDir);
    }

    if (targetVersion === currentVersion && !options.force) {
      console.error(`  ✓ 이미 최신입니다 (${currentVersion})`);
      return 'skip';
    }

    // 전량 재인덱싱 — 새 버전 디렉토리에 새 테이블 구축
    const { abs: versionDir, rel: versionRel } = overlayResourceDir('guide', targetVersion);
    await fs.remove(versionDir);
    await fs.ensureDir(versionDir);

    const manager = new GuideSearchManager(versionDir);
    await manager.initialize(); // 빈 디렉토리 → 새 테이블 생성
    const stats = await indexGuideDirectory(manager, mdRoot);

    // 검증 프로브
    if (stats.totalChunks === 0) {
      throw new Error('가이드 청크가 0개입니다 — 소스가 비었거나 형식이 다릅니다. 이 버전은 적용하지 않습니다.');
    }

    const previousDir = effective.source === 'overlay' ? effective.state?.dir : undefined;
    commitResourceState('guide', {
      version: targetVersion,
      dir: versionRel,
      previous_dir: previousDir,
      chunk_count: stats.totalChunks,
      origin,
      embedding_model: EMBEDDING_MODEL_ID,
      applied_at: new Date().toISOString(),
    });
    await pruneOldVersions('guide', [versionRel, previousDir]);

    return { version: targetVersion, chunks: stats.totalChunks };
  } finally {
    await fs.remove(tmpDir).catch(() => {});
  }
}
