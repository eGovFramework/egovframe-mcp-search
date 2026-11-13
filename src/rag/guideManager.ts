/**
 * eGovFrame Guide Search Manager (LanceDB)
 * 전자정부 표준프레임워크 공식 문서 검색 시스템
 * 
 * egovframe-docs 마크다운 파일을 벡터화하여 의미 기반 검색 제공
 */

import * as lancedb from '@lancedb/lancedb';
import { getEmbedder } from './embedder.js';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { resolveGuideDbDir } from '../utils/dataPaths.js';
import { UserFacingError } from '../utils/errors.js';
import { lanceEquals } from '../utils/lanceFilter.js';

// ─── 타입 정의 ────────────────────────────────────────────

/** 가이드 문서 청크 */
export interface GuideChunk {
  id: string;
  title: string;       // 문서제목: 섹션제목 (예: "MyBatis 적용 가이드: Step 3. DAO 작성")
  content: string;     // 섹션 본문 (마크다운)
  source: string;      // 상대 파일 경로 (예: "egovframe-runtime/persistence-layer/dataaccess-mybatis-guide.md")
  layer: string;       // 최상위 카테고리 (예: "egovframe-runtime")
  category: string;    // 하위 카테고리 (예: "persistence-layer")
  section: string;     // 섹션 제목 (예: "Step 3. DAO 작성")
  docTitle: string;    // 문서 제목 (예: "MyBatis 적용 가이드")
  url: string;         // Hugo URL (예: "/egovframe-runtime/persistence-layer/dataaccess-mybatis-guide/")
  vector: number[];    // 384차원 임베딩 벡터
}

/** 가이드 검색 결과 */
export interface GuideSearchResult {
  id: string;
  title: string;
  content: string;
  source: string;
  layer: string;
  category: string;
  section: string;
  docTitle: string;
  url: string;
  score: number;       // 코사인 거리 (낮을수록 유사, 1 - score 가 코사인 유사도)
}

/** 가이드 검색 옵션 */
export interface GuideSearchOptions {
  limit?: number;
  layer?: string;      // 특정 레이어만 검색 (예: "egovframe-runtime")
  category?: string;   // 특정 카테고리만 검색 (예: "persistence-layer")
}

/** 가이드 인덱싱 통계 */
export interface GuideIndexStats {
  totalFiles: number;
  totalChunks: number;
  skippedFiles: number;
  byLayer: Record<string, number>;
}

/** Hugo 프론트매터 파싱 결과 */
interface FrontMatter {
  title: string;
  linkTitle?: string;
  description?: string;
  url?: string;
}

// ─── 프론트매터 파싱 ──────────────────────────────────────

/**
 * Hugo YAML 프론트매터 파싱 (경량 구현, 외부 의존성 없음)
 */
export function parseFrontMatter(content: string): { frontmatter: FrontMatter; body: string } {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  
  if (!fmMatch) {
    return {
      frontmatter: { title: '' },
      body: content,
    };
  }

  const yamlStr = fmMatch[1];
  const body = fmMatch[2];

  // 간단한 YAML 파싱 (top-level key: value만)
  const fm: Record<string, string> = {};
  for (const line of yamlStr.split('\n')) {
    const match = line.match(/^(\w+):\s*"?([^"]*)"?\s*$/);
    if (match) {
      fm[match[1]] = match[2].trim();
    }
  }

  return {
    frontmatter: {
      title: fm.title || fm.linkTitle || '',
      linkTitle: fm.linkTitle,
      description: fm.description,
      url: fm.url,
    },
    body,
  };
}

// ─── 마크다운 청킹 ───────────────────────────────────────

/**
 * 마크다운 파일을 ## 헤더 기준으로 섹션 분할
 * 긴 섹션(>2000자)은 ### 헤더로 추가 분할
 */
export function chunkMarkdown(
  body: string,
  frontmatter: FrontMatter,
  filePath: string,  // 상대 경로
): Omit<GuideChunk, 'id' | 'vector'>[] {
  const pathParts = filePath.split('/');
  const layer = pathParts[0] || 'unknown';
  const category = pathParts.length > 2 ? pathParts[1] : '';
  const docTitle = frontmatter.title || path.basename(filePath, '.md');
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

// ─── GuideSearchManager 클래스 ───────────────────────────

export class GuideSearchManager {
  private db!: lancedb.Connection;
  private table!: any;
  private dbPath: string;
  private tableName = 'egovframe_guide';

  constructor(dbPath?: string) {
    const currentFile = fileURLToPath(import.meta.url);
    // 오버레이(사용자 update 적용분) 우선, 없으면 번들 knowledge-base
    this.dbPath = dbPath || resolveGuideDbDir(currentFile);
  }

  /**
   * 데이터베이스 초기화
   *
   * createIfMissing (기본 true): 테이블이 없으면 새로 만든다. 인덱스 구축과 update CLI 가 쓴다.
   * 검색 서버는 false 로 호출한다. 이때는 테이블을 만들지 않고, 인덱스가 설치되지 않았다는
   * 안내 오류를 던진다 (빈 테이블을 만들어 "결과 0건"으로 보이게 하지 않는다).
   */
  async initialize(options: { createIfMissing?: boolean } = {}): Promise<void> {
    const createIfMissing = options.createIfMissing ?? true;

    if (!createIfMissing && !fs.existsSync(path.join(this.dbPath, `${this.tableName}.lance`))) {
      throw new UserFacingError(
        `공식 가이드 인덱스(knowledge-base/${this.tableName}.lance)를 찾을 수 없습니다. 설치한 패키지에 ` +
          'knowledge-base 디렉토리가 포함되어 있는지 확인하세요. 저장소를 클론해 쓰는 경우에는 ' +
          'npm run build-index 로 인덱스를 구축할 수 있습니다.',
      );
    }

    try {
      this.db = await lancedb.connect(this.dbPath);

      try {
        this.table = await this.db.openTable(this.tableName);
        console.error(`✅ eGovFrame 가이드 검색 테이블 로드 완료 (${this.tableName})`);
      } catch (error) {
        if (!createIfMissing) {
          throw error;
        }
        console.error(`📝 eGovFrame 가이드 테이블을 새로 생성합니다...`);
        await this.createTable();
      }
    } catch (error) {
      console.error('❌ LanceDB 초기화 실패:', error);
      throw error;
    }
  }

  /**
   * 테이블 생성 (스키마 추론용 더미 데이터)
   */
  private async createTable(): Promise<void> {
    const dummyData = {
      id: '__placeholder__',
      title: 'Placeholder',
      content: 'This is a placeholder entry.',
      source: 'placeholder.md',
      layer: 'placeholder',
      category: 'placeholder',
      section: 'placeholder',
      docTitle: 'Placeholder',
      url: '/placeholder/',
      vector: new Array(384).fill(0),
    };

    this.table = await this.db.createTable(this.tableName, [dummyData]);
    await this.table.delete(`id = '__placeholder__'`);
    console.error(`✅ 테이블 '${this.tableName}' 생성 완료`);
  }

  /**
   * 기존 데이터 전체 삭제 (재인덱싱 시)
   */
  async clearAll(): Promise<void> {
    try {
      await this.db.dropTable(this.tableName);
      await this.createTable();
      console.error('🗑️ 기존 가이드 데이터 전체 삭제 완료');
    } catch {
      // 테이블이 없는 경우 무시
    }
  }

  /**
   * 배치 가이드 청크 추가
   */
  async addGuideBatch(chunks: Omit<GuideChunk, 'id' | 'vector'>[]): Promise<number> {
    if (chunks.length === 0) return 0;

    const embedder = getEmbedder();

    console.error(`📦 ${chunks.length}개 가이드 청크 처리 중...`);

    // 검색 텍스트 생성
    const searchTexts = chunks.map(chunk =>
      this.createSearchText(chunk.title, chunk.content, chunk.layer, chunk.category)
    );

    // 배치 임베딩 생성 (인덱싱용: passage prefix)
    const vectors = await embedder.embedBatch(searchTexts, {
      purpose: 'passage',
      onProgress: (current, total) => {
        if (current % 100 === 0 || current === total) {
          console.error(`  임베딩 진행률: ${current}/${total}`);
        }
      },
    });

    const guideChunks: GuideChunk[] = chunks.map((chunk, idx) => ({
      ...chunk,
      id: randomUUID(),
      vector: Array.from(vectors[idx]),
    }));

    await this.table.add(guideChunks);

    console.error(`✅ ${chunks.length}개 가이드 청크 추가 완료`);
    return chunks.length;
  }

  /**
   * 가이드 검색 (의미 기반)
   */
  async searchGuide(
    query: string,
    options: GuideSearchOptions = {}
  ): Promise<GuideSearchResult[]> {
    const { limit = 5, layer, category } = options;

    const embedder = getEmbedder();
    const queryVector = await embedder.embed(query, 'query');

    // 필터 조건 생성
    const filters: string[] = [];

    if (layer) {
      filters.push(lanceEquals('layer', layer));
    }

    if (category) {
      filters.push(lanceEquals('category', category));
    }

    // 벡터 검색 — 인덱스를 건너뛰고 전수 검색한다.
    // 동봉 테이블의 IVF_PQ 인덱스는 기본 설정으로 일부 파티션만 훑어, 필터(where)에 맞는 청크가
    // 있어도 빠뜨리고 손상된 인덱스 항목 때문에 엉뚱한 문서를 돌려준다. 수천 행 규모에서는
    // 전수 검색이 인덱스 검색과 지연 시간이 같다. where 는 사전 필터라 조건에 맞는 청크 안에서 limit 건을 채운다.
    // 거리는 코사인 거리로 계산한다 (기본값 l2 는 제곱 유클리드 거리라 1 - 거리가 유사도가 되지 않는다).
    // distanceType 은 전수 검색일 때만 유효하다 — 인덱스(l2 로 학습됨)를 타면 무시된다.
    let searchQuery = this.table
      .vectorSearch(Array.from(queryVector))
      .bypassVectorIndex()
      .distanceType('cosine')
      .limit(limit);

    if (filters.length > 0) {
      searchQuery = searchQuery.where(filters.join(' AND '));
    }

    const results = await searchQuery.toArray();

    return results.map((r: any) => ({
      id: r.id,
      title: r.title,
      content: r.content,
      source: r.source,
      layer: r.layer,
      category: r.category,
      section: r.section,
      docTitle: r.docTitle,
      url: r.url,
      score: r._distance,
    }));
  }

  /**
   * 인덱스 통계 조회
   */
  async getStats(): Promise<{ total: number; byLayer: Record<string, number> }> {
    const all = await this.table.query().toArray();

    const byLayer: Record<string, number> = {};
    for (const row of all) {
      const layer = row.layer;
      byLayer[layer] = (byLayer[layer] || 0) + 1;
    }

    return { total: all.length, byLayer };
  }

  /**
   * 벡터 인덱스 생성 (성능 향상)
   */
  async createIndex(): Promise<void> {
    console.error('🔨 가이드 벡터 인덱스 생성 중...');

    try {
      await this.table.createIndex('vector', {
        config: lancedb.Index.ivfPq({
          numPartitions: 256,
          numSubVectors: 96,
        }),
      });
      console.error('✅ 가이드 벡터 인덱스 생성 완료');
    } catch (error) {
      console.warn('⚠️ 인덱스 생성 실패 (데이터가 부족할 수 있음):', error);
    }
  }

  /**
   * 테이블 최적화
   */
  async optimize(): Promise<void> {
    console.error('⚡ 가이드 테이블 최적화 중...');
    await this.table.optimize();
    console.error('✅ 최적화 완료');
  }

  /**
   * 검색 텍스트 생성 (임베딩용)
   */
  private createSearchText(
    title: string,
    content: string,
    layer: string,
    category: string,
  ): string {
    const parts = [
      `제목: ${title}`,
      `내용: ${content}`,
    ];

    if (layer) {
      parts.push(`분류: ${layer}`);
    }

    if (category) {
      parts.push(`카테고리: ${category}`);
    }

    return parts.join('\n');
  }
}

// ─── 싱글톤 인스턴스 ─────────────────────────────────────

let guideManagerInstance: GuideSearchManager | null = null;

/**
 * 싱글톤 GuideSearchManager 인스턴스 가져오기
 */
export function getGuideManager(): GuideSearchManager {
  if (!guideManagerInstance) {
    guideManagerInstance = new GuideSearchManager();
  }
  return guideManagerInstance;
}

let guideManagerReady: Promise<GuideSearchManager> | null = null;

/**
 * 초기화된 GuideSearchManager 인스턴스 반환 (검색 서버용)
 *
 * 테이블은 한 번만 열어 재사용하고, 없는 테이블을 새로 만들지 않는다.
 * 초기화에 실패하면 다음 호출에서 다시 시도한다.
 */
export async function getInitializedGuideManager(): Promise<GuideSearchManager> {
  if (!guideManagerReady) {
    const manager = getGuideManager();
    guideManagerReady = manager.initialize({ createIfMissing: false }).then(
      () => manager,
      (error: unknown) => {
        guideManagerReady = null;
        throw error;
      },
    );
  }
  return guideManagerReady;
}
