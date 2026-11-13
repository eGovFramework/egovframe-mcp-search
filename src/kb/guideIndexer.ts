/**
 * 가이드(md) 인덱싱 공용 로직
 *
 * build-index(4/5 단계)와 update CLI(가이드 전량 재인덱싱)가 동일한
 * 수집·청킹·임베딩 코드를 공유한다 — 두 경로의 검색 결과가 달라지지 않도록.
 */

import fs from 'fs-extra';
import path from 'node:path';
import {
  GuideSearchManager,
  parseFrontMatter,
  chunkMarkdown,
  type GuideChunk,
  type GuideIndexStats,
} from '../rag/guideManager.js';
import { getEmbedder } from '../rag/embedder.js';

/**
 * 마크다운 파일 재귀 수집 (이미지/git/github 제외)
 */
export async function collectMarkdownFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    // 무시할 디렉토리
    if (entry.isDirectory()) {
      if (entry.name === '.git' || entry.name === '.github' || entry.name === 'images') {
        continue;
      }
      results.push(...await collectMarkdownFiles(fullPath));
    } else if (entry.name.endsWith('.md')) {
      // 무시할 파일
      if (entry.name === 'README.md' || entry.name === 'how-to-write-Frontmatter.md') {
        continue;
      }
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * 가이드 디렉토리 기준 상대 경로를 POSIX 구분자(/)로 돌려준다.
 *
 * 이 경로에서 layer / category 를 구하고 source 로 저장하므로, 플랫폼의 구분자를 그대로 쓰면
 * Windows 에서 색인한 인덱스는 경로 전체가 layer 가 되어 필터가 아무것도 고르지 못한다.
 *
 * @param pathModule 경로 구현 (기본값: 현재 플랫폼) — 다른 플랫폼의 동작을 검증할 때 바꾼다
 */
export function relativeGuidePath(
  guideDir: string,
  filePath: string,
  pathModule: Pick<typeof path, 'relative' | 'sep'> = path,
): string {
  return pathModule.relative(guideDir, filePath).split(pathModule.sep).join('/');
}

/**
 * guideDir 하위 md 전체를 (이미 초기화된) 매니저의 테이블로 전량 인덱싱한다.
 * 호출 전에 테이블을 비워 두는 것은 호출자 책임 (clearAll 또는 새 디렉토리).
 */
export async function indexGuideDirectory(
  guideManager: GuideSearchManager,
  guideDir: string,
): Promise<GuideIndexStats> {
  const embedder = getEmbedder();
  await embedder.initialize();

  // 1. 마크다운 파일 수집
  const mdFiles = await collectMarkdownFiles(guideDir);
  console.error(`  📄 발견된 마크다운 파일: ${mdFiles.length}개`);

  // 2. 파일별 청킹
  const allChunks: Omit<GuideChunk, 'id' | 'vector'>[] = [];
  let skippedFiles = 0;

  for (const filePath of mdFiles) {
    const relativePath = relativeGuidePath(guideDir, filePath);
    const content = await fs.readFile(filePath, 'utf-8');

    // 프론트매터 파싱
    const { frontmatter, body } = parseFrontMatter(content);

    // 본문이 너무 짧은 파일 건너뛰기 (인덱스 파일 등)
    const cleanBody = body.replace(/^#\s+.*\n?/, '').trim();
    if (cleanBody.length < 50) {
      skippedFiles++;
      continue;
    }

    // 청킹
    allChunks.push(...chunkMarkdown(body, frontmatter, relativePath));
  }

  console.error(`  📊 총 ${allChunks.length}개 청크 생성 (${skippedFiles}개 파일 건너뜀)`);

  // 3. 배치 인덱싱 (100개씩)
  const BATCH_SIZE = 100;
  let totalIndexed = 0;

  for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
    const batch = allChunks.slice(i, Math.min(i + BATCH_SIZE, allChunks.length));
    await guideManager.addGuideBatch(batch);
    totalIndexed += batch.length;
    console.error(`  진행률: ${totalIndexed}/${allChunks.length} (${Math.round((totalIndexed / allChunks.length) * 100)}%)`);
  }

  // 4. 인덱스 최적화
  console.error('\n  🔨 가이드 벡터 인덱스 생성 중...');
  await guideManager.createIndex();
  await guideManager.optimize();

  // 5. 통계 생성
  const byLayer: Record<string, number> = {};
  for (const chunk of allChunks) {
    byLayer[chunk.layer] = (byLayer[chunk.layer] || 0) + 1;
  }

  return {
    totalFiles: mdFiles.length - skippedFiles,
    totalChunks: allChunks.length,
    skippedFiles,
    byLayer,
  };
}
