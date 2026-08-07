/**
 * 임베딩 모델(Xenova/multilingual-e5-small)을 models/ 디렉토리에 내려받는다.
 *
 * - models/ 는 git 에 커밋하지 않는다 (model_quantized.onnx 가 113MB 로
 *   GitHub 100MB 제한 초과). 대신 이 스크립트로 언제든 재생성한다.
 * - 배포 tgz 에는 package.json 의 files 를 통해 models/ 가 동봉되므로,
 *   폐쇄망 사용처에서는 다운로드가 일어나지 않는다 (embedder 가
 *   env.allowRemoteModels=false 로 원격을 차단).
 * - 멱등: 모델이 이미 있으면 아무것도 하지 않는다.
 *
 * 사용법: npm run fetch-model
 */
import { existsSync } from 'fs';
import { pipeline, env } from '@xenova/transformers';

const MODEL = 'Xenova/multilingual-e5-small';
const ONNX = new URL(`../models/${MODEL}/onnx/model_quantized.onnx`, import.meta.url);

if (existsSync(ONNX)) {
  console.log(`이미 존재: models/${MODEL} — 건너뜀`);
  process.exit(0);
}

console.log(`모델 다운로드 중: ${MODEL} (약 130MB — 네트워크 필요)`);
env.cacheDir = new URL('../models', import.meta.url).pathname;
env.allowLocalModels = false; // 캐시 강제 재검증이 아니라, 이 실행에서 원격 수신을 보장

const p = await pipeline('feature-extraction', MODEL);
const out = await p('query: 동작 확인', { pooling: 'mean', normalize: true });
if (out.data.length !== 384) {
  throw new Error(`임베딩 차원 검증 실패: ${out.data.length} (기대값 384)`);
}
console.log(`완료: models/${MODEL} (임베딩 차원 384 검증됨)`);
