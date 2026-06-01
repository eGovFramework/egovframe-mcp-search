import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 새로 작성하는 .test.ts 파일만 vitest로 실행한다.
    // tests/ 아래의 기존 .mjs 스크립트는 별개의 통합 스크립트로 유지.
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules/**", "build/**", "tests/test-output/**"],
    // 통합 테스트가 동일한 knowledge-base/egovframe.db 를 공유하므로
    // 파일 간 병렬 실행 시 fixture 가 서로 영향을 줄 수 있다. 순차 실행으로 격리.
    fileParallelism: false,
    // 골든 파일 테스트가 실제 파일 시스템에 쓰므로 isolate를 끄지 않고 기본값 사용.
    testTimeout: 30000,
  },
});
