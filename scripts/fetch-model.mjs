/**
 * 임베딩 모델(Xenova/multilingual-e5-small)을 models/ 디렉토리에 내려받는다.
 *
 * - models/ 는 git 에 커밋하지 않는다 (model_quantized.onnx 가 113MB 로
 *   GitHub 100MB 제한 초과). 대신 이 스크립트로 언제든 재생성한다.
 * - 배포 tgz 에는 package.json 의 files 를 통해 models/ 가 동봉되므로,
 *   폐쇄망 사용처에서는 다운로드가 일어나지 않는다 (embedder 가
 *   env.allowRemoteModels=false 로 원격을 차단).
 * - 멱등: 모델이 이미 있고 정상적으로 불러와지면 아무것도 하지 않는다.
 * - 모델 파일이 있어도 불러와지지 않으면(내려받다가 끊긴 파일 등) 그 파일을 지우고 끝낸다.
 *   다시 실행하면 새로 내려받는다.
 *
 * 사용법: npm run fetch-model
 */
import { existsSync, rmSync } from 'fs';
import { fileURLToPath } from 'url';
import { pipeline, env } from '@xenova/transformers';

const MODEL = 'Xenova/multilingual-e5-small';
const MODELS_DIR = fileURLToPath(new URL('../models', import.meta.url));
const MODEL_DIR = fileURLToPath(new URL(`../models/${MODEL}`, import.meta.url));
const ONNX = fileURLToPath(new URL(`../models/${MODEL}/onnx/model_quantized.onnx`, import.meta.url));

// 대체 실행기(wasm)가 워커를 띄우다 멈추지 않게 한다 (src/rag/embedder.ts 와 같은 설정)
env.backends.onnx.wasm.numThreads = 1;

/** 모델을 불러와 임베딩 하나를 만들어 본다. 384차원이 아니면 오류. */
async function verifyModel() {
  const p = await pipeline('feature-extraction', MODEL);
  const out = await p('query: 동작 확인', { pooling: 'mean', normalize: true });
  if (out.data.length !== 384) {
    throw new Error(`임베딩 차원 검증 실패: ${out.data.length} (기대값 384)`);
  }
}

if (existsSync(ONNX)) {
  // 파일이 있다는 것만으로는 부족하다: 로컬 파일만으로 실제로 불러와지는지 확인한다
  env.localModelPath = MODELS_DIR;
  env.allowRemoteModels = false;
  try {
    await verifyModel();
    console.log(`이미 존재: models/${MODEL} — 건너뜀 (임베딩 차원 384 검증됨)`);
    process.exit(0);
  } catch (error) {
    // 같은 프로세스에서 모델을 다시 불러오지 않는다 (실패한 뒤의 재시도가 멈출 수 있다).
    // 손상된 파일만 지우고, 내려받기는 다음 실행에 맡긴다.
    console.error(`기존 모델 파일을 불러오지 못했습니다 (${error instanceof Error ? error.message : error}).`);
    rmSync(MODEL_DIR, { recursive: true, force: true });
    console.error(`models/${MODEL} 을 지웠습니다. npm run fetch-model 을 다시 실행하면 새로 내려받습니다.`);
    process.exit(1);
  }
}

console.log(`모델 다운로드 중: ${MODEL} (약 130MB — 네트워크 필요)`);
env.cacheDir = MODELS_DIR;
env.allowLocalModels = false; // 캐시 강제 재검증이 아니라, 이 실행에서 원격 수신을 보장
env.allowRemoteModels = true;

await verifyModel();
console.log(`완료: models/${MODEL} (임베딩 차원 384 검증됨)`);
