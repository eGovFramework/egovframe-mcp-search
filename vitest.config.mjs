import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 새로 작성하는 .test.ts 파일만 vitest로 실행한다.
    // tests/ 아래의 기존 .mjs 스크립트는 별개의 통합 스크립트로 유지.
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules/**", "build/**", "tests/test-output/**"],
    // 골든 파일 테스트가 실제 파일 시스템에 쓰므로 isolate를 끄지 않고 기본값 사용.
    testTimeout: 30000,
  },
});
