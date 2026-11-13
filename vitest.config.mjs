import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // tests/unit 과 tests/integration 의 .test.ts 파일을 실행한다.
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules/**", "build/**"],
    // 통합 테스트는 파일마다 MCP 서버 프로세스를 띄우고, 일부 테스트는 임베딩 모델을 불러온다.
    // 파일을 병렬로 실행하면 서로의 시간 제한에 영향을 주므로 순차로 실행한다.
    fileParallelism: false,
    testTimeout: 30000,
  },
});
