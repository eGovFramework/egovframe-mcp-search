/**
 * Developer Knowledge Manager (LanceDB)
 * 개발자 경험 기반 지식 관리 시스템
 */

import * as lancedb from '@lancedb/lancedb';
import { getEmbedder } from './embedder.js';
import {
  DeveloperKnowledge,
  KnowledgeSearchResult,
  KnowledgeSearchOptions,
  KnowledgeStats,
  AddKnowledgeInput,
  UpdateKnowledgeInput,
  RecentKnowledge,
  KnowledgeType,
} from '../types/knowledge.js';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { resolveDeveloperKnowledgeDbDir } from '../utils/dataPaths.js';
import { UserFacingError } from '../utils/errors.js';

export class DeveloperKnowledgeManager {
  private db!: lancedb.Connection;
  private table!: any;
  private dbPath: string;
  private tableName = 'developer_knowledge';

  constructor(dbPath?: string) {
    const currentFile = fileURLToPath(import.meta.url);
    // 오버레이(사용자 update 적용분) 우선, 없으면 번들 knowledge-base
    this.dbPath = dbPath || resolveDeveloperKnowledgeDbDir(currentFile);
  }

  /**
   * Arrow Vector를 일반 배열로 변환
   */
  private toArraySafe(value: any): any[] {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (value.toArray && typeof value.toArray === 'function') {
      return value.toArray();
    }
    return [];
  }

  private normalizeMetadata(metadata: Record<string, any> = {}): Record<string, any> {
    const knownKeys = new Set([
      'author',
      'version',
      'environment',
      'category',
      'file',
      'section',
      'source',
      'sourceFile',
      'sourceType',
      'originalId',
      'language',
      'chunkIndex',
      'chunkCount',
    ]);
    const extra = Object.fromEntries(
      Object.entries(metadata).filter(([key]) => !knownKeys.has(key))
    );

    return {
      author: this.metadataString(metadata.author),
      version: this.metadataString(metadata.version),
      environment: this.metadataString(metadata.environment),
      category: this.metadataString(metadata.category),
      file: this.metadataString(metadata.file),
      section: this.metadataString(metadata.section),
      source: this.metadataString(metadata.source),
      sourceFile: this.metadataString(metadata.sourceFile),
      sourceType: this.metadataString(metadata.sourceType),
      originalId: this.metadataString(metadata.originalId),
      language: this.metadataString(metadata.language),
      chunkIndex: this.metadataNumber(metadata.chunkIndex),
      chunkCount: this.metadataNumber(metadata.chunkCount),
      extra: JSON.stringify(extra),
    };
  }

  private metadataString(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
      return value.toString();
    }
    return '';
  }

  private metadataNumber(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
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
        `개발자 지식 인덱스(knowledge-base/${this.tableName}.lance)를 찾을 수 없습니다. 설치한 패키지에 ` +
          'knowledge-base 디렉토리가 포함되어 있는지 확인하세요. 저장소를 클론해 쓰는 경우에는 ' +
          'npm run build-index 로 인덱스를 구축할 수 있습니다.',
      );
    }

    try {
      this.db = await lancedb.connect(this.dbPath);
      
      try {
        this.table = await this.db.openTable(this.tableName);
        console.error(`✅ 개발자 지식 베이스 로드 완료 (${this.tableName})`);
      } catch (error) {
        if (!createIfMissing) {
          throw error;
        }
        console.error(`📝 개발자 지식 베이스를 새로 생성합니다...`);
        await this.createTable();
      }
    } catch (error) {
      console.error('❌ LanceDB 초기화 실패:', error);
      throw error;
    }
  }

  /**
   * 테이블 생성
   */
  private async createTable(): Promise<void> {
    // 더미 데이터로 테이블 생성 (스키마 추론을 위해 타입이 명확한 데이터 사용)
    const now = new Date().toISOString();
    const dummyData = {
      id: '__placeholder__',
      type: 'tip',
      title: 'Placeholder',
      content: 'This is a placeholder entry that will be deleted.',
      context: '',
      tags: ['placeholder'], // 빈 배열 대신 요소가 있는 배열
      relatedTo: ['placeholder'], // 빈 배열 대신 요소가 있는 배열
      importance: 1,
      verified: false,
      createdAt: now,
      updatedAt: now,
      // LanceDB는 struct 필드가 고정되므로 실제 사용 필드를 모두 포함한다.
      metadata: this.normalizeMetadata({
        file: 'placeholder',
        section: 'placeholder',
        version: 'placeholder',
      }),
      vector: new Array(384).fill(0),
    };
    
    this.table = await this.db.createTable(this.tableName, [dummyData]);
    
    // 더미 데이터 삭제
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
      console.error('🗑️ 기존 개발자 지식 데이터 전체 삭제 완료');
    } catch {
      // 테이블이 없는 경우 무시
    }
  }

  /**
   * 지식 추가
   */
  async addKnowledge(input: AddKnowledgeInput): Promise<string> {
    const embedder = getEmbedder();
    
    // 검색용 텍스트 생성 (제목 + 내용 + 컨텍스트 + 태그)
    const searchText = this.createSearchText(
      input.title,
      input.content,
      input.context,
      input.tags
    );
    
    console.error(`🔨 임베딩 생성 중: "${input.title}"...`);
    const vector = await embedder.embed(searchText, 'passage');
    
    const now = new Date().toISOString();
    const id = randomUUID();
    
    const knowledge: DeveloperKnowledge = {
      id,
      type: input.type,
      title: input.title,
      content: input.content,
      context: input.context,
      tags: input.tags || [],
      relatedTo: input.relatedTo || [],
      importance: input.importance || 3,
      verified: input.verified || false,
      createdAt: now,
      updatedAt: now,
      metadata: this.normalizeMetadata(input.metadata),
      vector: Array.from(vector),
    };
    
    await this.table.add([knowledge]);
    
    console.error(`✅ 지식 추가 완료: "${input.title}" (ID: ${id})`);
    return id;
  }

  /**
   * 배치 지식 추가
   */
  async addKnowledgeBatch(inputs: AddKnowledgeInput[]): Promise<string[]> {
    const embedder = getEmbedder();
    
    console.error(`📦 ${inputs.length}개 지식 항목 처리 중...`);
    
    // 검색 텍스트 생성
    const searchTexts = inputs.map(input =>
      this.createSearchText(input.title, input.content, input.context, input.tags)
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
    
    const now = new Date().toISOString();
    const ids: string[] = [];
    
    const knowledgeList: DeveloperKnowledge[] = inputs.map((input, idx) => {
      const id = randomUUID();
      ids.push(id);
      
      return {
        id,
        type: input.type,
        title: input.title,
        content: input.content,
        context: input.context,
        tags: input.tags || [],
        relatedTo: input.relatedTo || [],
        importance: input.importance || 3,
        verified: input.verified || false,
        createdAt: now,
        updatedAt: now,
        metadata: this.normalizeMetadata(input.metadata),
        vector: Array.from(vectors[idx]),
      };
    });
    
    await this.table.add(knowledgeList);
    
    console.error(`✅ ${inputs.length}개 지식 항목 추가 완료`);
    return ids;
  }

  /**
   * 지식 검색 (의미 기반)
   */
  async searchKnowledge(
    query: string,
    options: KnowledgeSearchOptions = {}
  ): Promise<KnowledgeSearchResult[]> {
    const {
      limit = 5,
      type,
      tags,
      minImportance = 1,
      verifiedOnly = false,
    } = options;
    
    const embedder = getEmbedder();
    const queryVector = await embedder.embed(query, 'query');
    
    // 필터 조건 생성
    const filters: string[] = [];
    
    if (type) {
      filters.push(`type = '${type}'`);
    }
    
    if (minImportance > 1) {
      filters.push(`importance >= ${minImportance}`);
    }
    
    if (verifiedOnly) {
      filters.push(`verified = true`);
    }
    
    // 벡터 검색 쿼리 — 인덱스를 건너뛰고 전수 검색한다.
    // 동봉 테이블의 IVF_PQ 인덱스는 기본 설정으로 일부 파티션만 훑어, 필터(where)에 맞는 행이
    // 있어도 0건이나 limit 미만을 돌려주고 가장 가까운 행을 놓친다. 약 1.8만 행 규모에서는
    // 전수 검색이 인덱스 검색과 지연 시간이 같다. where 는 사전 필터라 조건에 맞는 행 안에서 limit 건을 채운다.
    // 거리는 코사인 거리로 계산한다 (기본값 l2 는 제곱 유클리드 거리라 1 - 거리가 유사도가 되지 않는다).
    // distanceType 은 전수 검색일 때만 유효하다 — 인덱스(l2 로 학습됨)를 타면 무시된다.
    let searchQuery = this.table
      .vectorSearch(Array.from(queryVector))
      .bypassVectorIndex()
      .distanceType('cosine')
      .limit(limit * 2); // 태그 필터링을 위해 더 많이 가져옴
    
    if (filters.length > 0) {
      searchQuery = searchQuery.where(filters.join(' AND '));
    }
    
    let results = await searchQuery.toArray();
    
    // 태그 필터링 (복잡한 조건이라 결과에서 처리)
    if (tags && tags.length > 0) {
      results = results.filter((r: any) => {
        const resultTags = this.toArraySafe(r.tags);
        return tags.some(tag => resultTags.includes(tag));
      });
    }
    
    // 결과 포맷팅
    return results.slice(0, limit).map((r: any) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      content: r.content,
      context: r.context,
      tags: this.toArraySafe(r.tags),
      importance: r.importance,
      score: r._distance,  // 코사인 거리 (낮을수록 유사, 1 - score 가 코사인 유사도)
      createdAt: r.createdAt,
      metadata: r.metadata || {},
    }));
  }

  /**
   * 최근 지식 목록 조회
   */
  async listRecentKnowledge(
    limit: number = 10,
    type?: KnowledgeType
  ): Promise<RecentKnowledge[]> {
    let query = this.table.query();
    
    if (type) {
      query = query.where(`type = '${type}'`);
    }
    
    const results = await query.toArray();
    
    // 날짜순 정렬 (최신순)
    const sorted = results.sort((a: any, b: any) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    
    return sorted.slice(0, limit).map((r: any) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      tags: this.toArraySafe(r.tags),
      importance: r.importance,
      verified: r.verified,
      createdAt: r.createdAt,
    }));
  }

  /**
   * ID로 지식 조회
   */
  async getKnowledgeById(id: string): Promise<DeveloperKnowledge | null> {
    const results = await this.table
      .query()
      .where(`id = '${id}'`)
      .toArray();
    
    return results.length > 0 ? (results[0] as DeveloperKnowledge) : null;
  }

  /**
   * 지식 업데이트
   */
  async updateKnowledge(input: UpdateKnowledgeInput): Promise<void> {
    const existing = await this.getKnowledgeById(input.id);
    
    if (!existing) {
      throw new Error(`지식 ID ${input.id}를 찾을 수 없습니다.`);
    }
    
    // 업데이트된 필드만 병합
    const updated: DeveloperKnowledge = {
      ...existing,
      ...(input.title !== undefined && { title: input.title }),
      ...(input.content !== undefined && { content: input.content }),
      ...(input.context !== undefined && { context: input.context }),
      ...(input.tags !== undefined && { tags: input.tags }),
      ...(input.relatedTo !== undefined && { relatedTo: input.relatedTo }),
      ...(input.importance !== undefined && { importance: input.importance }),
      ...(input.verified !== undefined && { verified: input.verified }),
      ...(input.metadata !== undefined && { 
        metadata: this.normalizeMetadata({ ...existing.metadata, ...input.metadata })
      }),
      updatedAt: new Date().toISOString(),
    };
    
    // 내용이 변경되면 벡터도 재생성
    if (
      input.title !== undefined ||
      input.content !== undefined ||
      input.context !== undefined ||
      input.tags !== undefined
    ) {
      const embedder = getEmbedder();
      const searchText = this.createSearchText(
        updated.title,
        updated.content,
        updated.context,
        updated.tags
      );
      
      const vector = await embedder.embed(searchText, 'passage');
      updated.vector = Array.from(vector);
    }
    
    // 기존 삭제 후 추가 (LanceDB는 in-place update 불가)
    await this.table.delete(`id = '${input.id}'`);
    await this.table.add([updated]);
    
    console.error(`✅ 지식 업데이트 완료: "${updated.title}"`);
  }

  /**
   * 지식 삭제
   */
  async deleteKnowledge(id: string): Promise<void> {
    await this.table.delete(`id = '${id}'`);
    console.error(`🗑️ 지식 삭제 완료: ID ${id}`);
  }

  /**
   * sourceType 기준 행 목록 조회 (증분 갱신의 삭제 스코핑용).
   *
   * LanceDB 의 중첩 struct 필드(metadata.originalId) 술어 지원이 버전에 따라
   * 불안정하므로, 전체를 한 번 스캔해 메모리에서 거른 뒤 최상위 id 로
   * 삭제하는 우회 경로를 제공한다 (README §11-1 스파이크의 안전한 해법).
   */
  async listSourceRows(
    sourceTypes: string[],
  ): Promise<Array<{ id: string; originalId: string }>> {
    const wanted = new Set(sourceTypes);
    let records: any[];
    try {
      records = await this.table.query().select(['id', 'metadata']).toArray();
    } catch {
      // select 미지원/실패 시 전체 컬럼 스캔 폴백
      records = await this.table.query().toArray();
    }
    return records
      .filter((r) => wanted.has(r.metadata?.sourceType))
      .map((r) => ({ id: String(r.id), originalId: String(r.metadata?.originalId ?? '') }));
  }

  /**
   * 최상위 id 목록으로 일괄 삭제 (IN 절 청크 분할)
   */
  async deleteByIds(ids: string[]): Promise<void> {
    const CHUNK = 500;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const list = chunk.map((id) => `'${id.replace(/'/g, "''")}'`).join(', ');
      await this.table.delete(`id IN (${list})`);
    }
  }

  /**
   * 태그별 통계
   */
  async getTagStats(): Promise<Array<{ tag: string; count: number }>> {
    const all = await this.table.query().toArray();
    const tagCounts: Record<string, number> = {};
    
    all.forEach((k: any) => {
      const tags = this.toArraySafe(k.tags);
      
      tags.forEach((tag: string) => {
        if (tag) {
          tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        }
      });
    });
    
    return Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([tag, count]) => ({ tag, count }));
  }

  /**
   * 지식 베이스 통계
   */
  async getStats(): Promise<KnowledgeStats> {
    const all = await this.table.query().toArray();
    
    const byType: Record<KnowledgeType, number> = {
      'solution': 0,
      'tip': 0,
      'pattern': 0,
      'error-fix': 0,
      'best-practice': 0,
      'gotcha': 0,
    };
    
    const byImportance: Record<number, number> = {
      1: 0, 2: 0, 3: 0, 4: 0, 5: 0,
    };
    
    let verifiedCount = 0;
    
    all.forEach((k: any) => {
      const type = k.type as KnowledgeType;
      if (type && byType[type] !== undefined) {
        byType[type] = (byType[type] || 0) + 1;
      }
      
      const importance = k.importance;
      if (importance && byImportance[importance] !== undefined) {
        byImportance[importance] = (byImportance[importance] || 0) + 1;
      }
      
      if (k.verified) verifiedCount++;
    });
    
    const topTags = await this.getTagStats();
    
    return {
      total: all.length,
      byType,
      byImportance,
      verified: verifiedCount,
      unverified: all.length - verifiedCount,
      topTags: topTags.slice(0, 10),
    };
  }

  /**
   * 벡터 인덱스 생성 (성능 향상)
   */
  async createIndex(): Promise<void> {
    console.error('🔨 벡터 인덱스 생성 중...');
    
    try {
      await this.table.createIndex('vector', {
        config: lancedb.Index.ivfPq({
          numPartitions: 256,
          numSubVectors: 96,
        }),
      });
      
      console.error('✅ 벡터 인덱스 생성 완료');
    } catch (error) {
      console.warn('⚠️ 인덱스 생성 실패 (데이터가 부족할 수 있음):', error);
    }
  }

  /**
   * 테이블 최적화
   */
  async optimize(): Promise<void> {
    console.error('⚡ 테이블 최적화 중...');
    await this.table.optimize();
    console.error('✅ 최적화 완료');
  }

  /**
   * 검색 텍스트 생성 (임베딩용)
   */
  private createSearchText(
    title: string,
    content: string,
    context?: string,
    tags?: string[]
  ): string {
    const parts = [
      `제목: ${title}`,
      `내용: ${content}`,
    ];
    
    if (context) {
      parts.push(`상황: ${context}`);
    }
    
    if (tags && tags.length > 0) {
      parts.push(`태그: ${tags.join(', ')}`);
    }
    
    return parts.join('\n');
  }
}


