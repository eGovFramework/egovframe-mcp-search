/**
 * 가이드 문서 청킹
 *
 * 마크다운 문서를 색인 단위(청크)로 나누고, 청크의 임베딩 입력을 만든다.
 * 이 모듈은 순수 함수만 둔다 (LanceDB 와 임베딩 모델을 불러오지 않는다).
 */

import path from 'path';
import type { GuideChunk } from './guideManager.js';

/**
 * 가이드 청크의 검색 텍스트 (임베딩용).
 * GuideSearchManager 가 색인할 때 이 문자열을 임베딩한다.
 */
export function guideSearchText(title: string, content: string, layer: string, category: string): string {
  const parts = [`제목: ${title}`, `내용: ${content}`];

  if (layer) {
    parts.push(`분류: ${layer}`);
  }

  if (category) {
    parts.push(`카테고리: ${category}`);
  }

  return parts.join('\n');
}

/**
 * 마크다운 파일을 ## 헤더 기준으로 섹션 분할
 * 긴 섹션(>2000자)은 ### 헤더로 추가 분할
 *
 * relativePath 는 가이드 디렉토리 기준 상대 경로다. 구분자를 POSIX(/)로 맞춘 뒤 layer 와
 * category 를 구하므로, Windows 의 역슬래시 경로가 와도 색인 내용(source, layer, category)이 같다.
 */
export function chunkMarkdown(
  body: string,
  frontmatter: { title: string; url?: string },
  relativePath: string,
): Omit<GuideChunk, 'id' | 'vector'>[] {
  const filePath = relativePath.replace(/\\/g, '/');
  const pathParts = filePath.split('/');
  const layer = pathParts[0] || 'unknown';
  const category = pathParts.length > 2 ? pathParts[1] : '';
  const docTitle = frontmatter.title || path.posix.basename(filePath, '.md');
  const url = frontmatter.url || '';

  const chunks: Omit<GuideChunk, 'id' | 'vector'>[] = [];

  // ## 기준 분할
  const h2Sections = body.split(/^##\s+/gm);
  
  for (let i = 0; i < h2Sections.length; i++) {
    const raw = h2Sections[i].trim();
    if (!raw) continue;

    if (i === 0) {
      // 첫 번째 청크: ## 이전 내용 (개요/소개)
      // H1 제거
      const cleanedContent = raw.replace(/^#\s+.*\n?/, '').trim();
      if (cleanedContent.length >= 50) {
        chunks.push({
          title: docTitle,
          content: cleanedContent,
          source: filePath,
          layer,
          category,
          section: '개요',
          docTitle,
          url,
        });
      }
      continue;
    }

    // ## 섹션
    const lines = raw.split('\n');
    const sectionHeading = lines[0].trim();
    const sectionContent = lines.slice(1).join('\n').trim();

    if (sectionContent.length < 50) continue;

    // 긴 섹션은 ### 기준으로 추가 분할
    if (sectionContent.length > 2000) {
      const h3Sections = sectionContent.split(/^###\s+/gm);

      if (h3Sections.length > 1) {
        // ### 이전 내용
        const preH3 = h3Sections[0].trim();
        if (preH3.length >= 50) {
          chunks.push({
            title: `${docTitle}: ${sectionHeading}`,
            content: preH3,
            source: filePath,
            layer,
            category,
            section: sectionHeading,
            docTitle,
            url,
          });
        }

        // 각 ### 섹션
        for (let j = 1; j < h3Sections.length; j++) {
          const h3Lines = h3Sections[j].split('\n');
          const h3Heading = h3Lines[0].trim();
          const h3Content = h3Lines.slice(1).join('\n').trim();

          if (h3Content.length < 50) continue;

          chunks.push({
            title: `${docTitle}: ${sectionHeading} > ${h3Heading}`,
            content: h3Content,
            source: filePath,
            layer,
            category,
            section: `${sectionHeading} > ${h3Heading}`,
            docTitle,
            url,
          });
        }
        continue;
      }
    }

    // 일반 크기 섹션 - 그대로 추가
    chunks.push({
      title: `${docTitle}: ${sectionHeading}`,
      content: sectionContent,
      source: filePath,
      layer,
      category,
      section: sectionHeading,
      docTitle,
      url,
    });
  }

  return chunks;
}
