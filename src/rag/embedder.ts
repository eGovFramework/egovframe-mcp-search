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

import { pipeline, env } from '@xenova/transformers';
import { fileURLToPath } from 'url';
import { getModelsPath } from '../utils/projectPath.js';
import { EMBEDDING_MODEL_ID } from '../utils/dataPaths.js';
import { sliceHead } from '../utils/text.js';

// 폐쇄망 대응: 패키지에 동봉된 로컬 모델(models/)만 사용하고 원격 다운로드를 금지한다.
// 절대 경로로 지정해 MCP 서버가 임의의 cwd 에서 실행돼도 모델을 찾을 수 있게 한다.
env.localModelPath = getModelsPath(fileURLToPath(import.meta.url));
env.allowRemoteModels = false;

/** 임베딩 용도 구분 (E5 모델 prefix) */
export type EmbedPurpose = 'query' | 'passage';

/**
 * 임베딩 입력으로 모델에 넘기는 최대 글자 수.
 *
 * 모델은 앞의 512 토큰만 읽으므로 그 뒤의 내용은 결과에 영향이 없다. 그런데 토크나이저에는
 * 입력 전체가 넘어가서, 12만 자쯤부터 스택 오버플로가 나고 수 MB 면 프로세스가 메모리 부족으로
 * 죽는다. 그래서 앞부분만 남긴다.
 *
 * 512 토큰을 채우는 데 필요한 글자 수는 문서마다 다르다. 동봉 데이터(가이드 2,277 청크,
 * 개발자 지식 18,046 행)의 색인 입력을 재 보면 대부분 2,000자 안쪽이지만, 표와 공백이 많은
 * 가이드 청크는 최대 3,409자가 필요했다 (2,000자에서 자르면 15개 청크의 임베딩이 달라진다).
 * 그 두 배가 넘는 여유를 두어 색인 결과가 달라지지 않게 한다.
 */
export const MAX_EMBED_INPUT_CHARS = 8000;

/** 임베딩 입력을 MAX_EMBED_INPUT_CHARS 글자까지만 남긴다 (질의·문서 공통). */
export function truncateEmbedInput(text: string): string {
  return sliceHead(text, MAX_EMBED_INPUT_CHARS);
}

export class LocalEmbedder {
  private model: any = null;
  private modelName = EMBEDDING_MODEL_ID;  // 384차원, 다국어 모델 (models/ 에 동봉, ~130MB)
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
    console.error(`   (로컬 모델 사용: ${env.localModelPath} — 원격 다운로드 없음)`);
    
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
      // E5 모델: purpose에 따라 prefix 추가. 본문은 모델이 읽는 범위를 넉넉히 덮는 길이까지만 넘긴다
      const prefixedText = `${purpose}: ${truncateEmbedInput(text)}`;
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
