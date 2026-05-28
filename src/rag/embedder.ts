/**
 * Local Embedder using Transformers.js
 * 로컬에서 실행되는 임베딩 생성기 (외부 API 호출 없음)
 * 
 * 모델: multilingual-e5-small (384차원, 다국어 지원)
 * - 한국어/영어 모두 높은 검색 품질 제공
 * - E5 모델은 query/passage prefix 필요:
 *   - 검색 쿼리: "query: 게시판 구현 방법"
 *   - 인덱싱 문서: "passage: 게시판은 글을 등록하고..."
 */

import { pipeline } from '@xenova/transformers';

/** 임베딩 용도 구분 (E5 모델 prefix) */
export type EmbedPurpose = 'query' | 'passage';

export class LocalEmbedder {
  private model: any = null;
  private modelName = 'Xenova/multilingual-e5-small';  // 384차원, 다국어 모델 (~120MB)
  private isInitializing = false;
  private initPromise: Promise<void> | null = null;

  /**
   * 모델 초기화 (첫 사용 시 자동 다운로드)
   */
  async initialize(): Promise<void> {
    // 이미 초기화되었으면 스킵
    if (this.model) {
      return;
    }

    // 초기화 중이면 대기
    if (this.isInitializing && this.initPromise) {
      return this.initPromise;
    }

    this.isInitializing = true;
    this.initPromise = this._doInitialize();
    
    try {
      await this.initPromise;
    } finally {
      this.isInitializing = false;
      this.initPromise = null;
    }
  }

  private async _doInitialize(): Promise<void> {
    console.error(`🤖 임베딩 모델 로드 중: ${this.modelName}`);
    console.error('   (첫 실행 시 모델 다운로드 - 약 30MB, 1-2분 소요)');
    
    try {
      this.model = await pipeline('feature-extraction', this.modelName);
      console.error('✅ 임베딩 모델 로드 완료');
    } catch (error) {
      console.error('❌ 임베딩 모델 로드 실패:', error);
      throw new Error(`임베딩 모델 로드 실패: ${error}`);
    }
  }

  /**
   * 단일 텍스트 임베딩 생성
   * @param text 임베딩할 텍스트
   * @param purpose 'query' (검색 쿼리) 또는 'passage' (인덱싱 문서). E5 모델 prefix에 사용
   */
  async embed(text: string, purpose: EmbedPurpose = 'query'): Promise<Float32Array> {
    await this.initialize();

    if (!this.model) {
      throw new Error('임베딩 모델이 초기화되지 않았습니다.');
    }

    try {
      // E5 모델: purpose에 따라 prefix 추가
      const prefixedText = `${purpose}: ${text}`;
      const output = await this.model(prefixedText, {
        pooling: 'mean',
        normalize: true,
      });

      return output.data as Float32Array;
    } catch (error) {
      console.error('❌ 임베딩 생성 실패:', error);
      throw new Error(`임베딩 생성 실패: ${error}`);
    }
  }

  /**
   * 배치 임베딩 생성 (효율적인 대량 처리)
   * @param purpose 'query' (검색 쿼리) 또는 'passage' (인덱싱 문서)
   */
  async embedBatch(
    texts: string[],
    options: {
      batchSize?: number;
      onProgress?: (current: number, total: number) => void;
      purpose?: EmbedPurpose;
    } = {}
  ): Promise<Float32Array[]> {
    const { batchSize = 32, onProgress, purpose = 'passage' } = options;
    
    await this.initialize();

    const results: Float32Array[] = [];
    const total = texts.length;

    console.error(`📦 ${total}개 텍스트 임베딩 생성 시작... (purpose: ${purpose})`);

    for (let i = 0; i < total; i += batchSize) {
      const batch = texts.slice(i, Math.min(i + batchSize, total));
      const batchResults = await Promise.all(batch.map(text => this.embed(text, purpose)));
      
      results.push(...batchResults);

      const current = Math.min(i + batchSize, total);
      
      if (onProgress) {
        onProgress(current, total);
      }

      if (current < total) {
        const percentage = Math.round((current / total) * 100);
        console.error(`  진행률: ${current}/${total} (${percentage}%)`);
      }
    }

    console.error(`✅ 임베딩 생성 완료: ${total}개`);
    return results;
  }

  /**
   * 모델 정보 조회
   */
  getModelInfo() {
    return {
      name: this.modelName,
      dimensions: 384,
      isLoaded: this.model !== null,
      description: 'multilingual-e5-small: 다국어 임베딩 모델 (한국어/영어/100+ 언어 지원)',
    };
  }

  /**
   * 메모리 정리
   */
  dispose() {
    this.model = null;
    console.error('🧹 임베딩 모델 메모리 해제');
  }
}

// 싱글톤 인스턴스 (메모리 효율)
let embedderInstance: LocalEmbedder | null = null;

/**
 * 싱글톤 임베더 인스턴스 가져오기
 */
export function getEmbedder(): LocalEmbedder {
  if (!embedderInstance) {
    embedderInstance = new LocalEmbedder();
  }
  return embedderInstance;
}
