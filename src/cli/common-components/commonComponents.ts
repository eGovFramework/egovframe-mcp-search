/**
 * update CLI — common_components (소스 트리) 갱신
 *
 * GitHub 태그 소스 tarball 을 새 버전 디렉토리에 해제해 트리를 교체한다
 * (임베딩 0, SQLite 미변경). 컴포넌트 목록·설명·FTS 는 동봉 SQLite 메타
 * 기준이므로, 소스 태그와 메타 버전이 어긋나면 경고만 남긴다.
 * 해제본이 크기 때문에 직전 버전은 --keep-previous 지정 시에만 보존한다.
 */

import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import { resolveResource, type ResourceState } from '../../utils/dataPaths.js';
import { COMPONENTS_REPO, listRemoteVersionTags, sourceTarballUrl } from '../../kb/sources.js';
import { downloadToFile } from '../../utils/download.js';
import { extractTarGz } from '../../utils/tarSafe.js';
import {
  CLI_FILE,
  RESOURCE_LABELS,
  overlayResourceDir,
  commitResourceState,
  pruneOldVersions,
  type UpdateOptions,
} from '../shared.js';

export interface ComponentsUpdateResult {
  version: string;
  files: number;
  metadataVersion: string | null;
}

export async function updateComponents(options: UpdateOptions): Promise<ComponentsUpdateResult | 'skip'> {
  const label = RESOURCE_LABELS.common_components;
  console.error(`\n▶ ${label} 갱신...`);

  const effective = resolveResource('common_components', CLI_FILE);
  const currentVersion = effective.state?.source_version ?? effective.state?.version ?? null;
  const metadataVersion = effective.state?.metadata_version ?? null;

  let targetVersion: string;
  let origin: ResourceState['origin'];
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'egov-update-comp-'));

  try {
    let tarPath: string;
    if (options.fromFileDir) {
      origin = 'from-file';
      targetVersion = options.componentsTag ?? 'from-file';
      tarPath = path.join(options.fromFileDir, 'components-src.tar.gz');
      if (!await fs.pathExists(tarPath)) {
        console.error('  ⚠️ 반입 디렉토리에 components-src.tar.gz 가 없어 스킵합니다.');
        return 'skip';
      }
      if (targetVersion === currentVersion && !options.force) {
        console.error(`  ✓ 이미 최신입니다 (${currentVersion})`);
        return 'skip';
      }
    } else {
      origin = 'release';
      targetVersion =
        options.componentsTag ?? (await listRemoteVersionTags(COMPONENTS_REPO))[0];
      if (!targetVersion) {
        console.error('  ⚠️ 원격에서 버전 태그를 찾지 못해 스킵합니다.');
        return 'skip';
      }
      if (targetVersion === currentVersion && !options.force) {
        console.error(`  ✓ 이미 최신입니다 (${currentVersion})`);
        return 'skip';
      }
      tarPath = path.join(tmpDir, 'components-src.tar.gz');
      console.error(`  ⬇ 소스 tarball 다운로드 (${targetVersion})...`);
      await downloadToFile(sourceTarballUrl(COMPONENTS_REPO, targetVersion), tarPath, {
        timeoutMs: 600_000,
        maxBytes: 512 * 1024 * 1024,
      });
    }

    // 트리 교체 — 임베딩 0, SQLite 미변경
    const { abs: versionDir, rel: versionRel } = overlayResourceDir('common_components', targetVersion);
    await fs.remove(versionDir);
    const stats = extractTarGz(tarPath, versionDir, { stripComponents: 1 });

    // 검증 프로브
    if (!await fs.pathExists(path.join(versionDir, 'pom.xml'))) {
      throw new Error('해제 결과에 pom.xml 이 없습니다 — 아카이브 구성이 예상과 다릅니다. 이 버전은 적용하지 않습니다.');
    }
    console.error(`  ✓ 트리 해제 완료: ${stats.files}개 파일`);

    // 직전 버전은 기본 미보존 (해제본 ~300MB — 롤백은 재다운로드로)
    const previousDir =
      options.keepPrevious && effective.source === 'overlay' ? effective.state?.dir : undefined;
    commitResourceState('common_components', {
      source_version: targetVersion,
      metadata_version: metadataVersion ?? undefined,
      dir: versionRel,
      previous_dir: previousDir,
      file_count: stats.files,
      origin,
      applied_at: new Date().toISOString(),
    });
    await pruneOldVersions('common_components', [versionRel, previousDir]);

    // 메타 버전 불일치 경고 — 목록·설명·FTS 는 동봉 메타 기준
    if (metadataVersion && normalizeVersion(targetVersion) !== normalizeVersion(metadataVersion)) {
      console.error(`  ⚠️ 소스 ${targetVersion} / 메타 ${metadataVersion} — 컴포넌트 목록·설명은 메타 기준입니다.`);
      console.error('     메타 갱신은 MCP 패키지(tgz) 업그레이드로만 반영됩니다.');
    }

    return { version: targetVersion, files: stats.files, metadataVersion };
  } finally {
    await fs.remove(tmpDir).catch(() => {});
  }
}

function normalizeVersion(value: string): string {
  return value.replace(/^v/, '');
}
