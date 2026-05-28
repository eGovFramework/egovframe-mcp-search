/**
 * 통합 테스트 공용 헬퍼
 *
 * MCP 서버(`build/index.js`)를 stdio 로 띄우고 Client SDK 로 연결한다.
 * 각 test 파일은 beforeAll 에서 `createMcpClient()` 를 호출하고
 * afterAll 에서 `client.close()` 만 호출하면 된다.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** 저장소 루트: tests/integration → 두 단계 위 */
export const REPO_ROOT = path.resolve(__dirname, "../..");

/** MCP 서버 엔트리(빌드 산출물) */
export const SERVER_ENTRY = path.join(REPO_ROOT, "build", "index.js");

/** 통합 테스트가 입력으로 쓰는 샘플 eGovFrame 프로젝트(존재해야만 동작). */
export const SAMPLE_PROJECT_PATH = path.join(
  REPO_ROOT,
  "tests",
  "test-output",
  "my-egov-app",
);

/**
 * MCP Client 를 생성하고 서버에 연결한다.
 *
 * @throws build/index.js 가 없으면 빌드부터 안 했다는 뜻이므로 친절한 에러를 던진다.
 */
export async function createMcpClient(): Promise<Client> {
  if (!fs.existsSync(SERVER_ENTRY)) {
    throw new Error(
      `${SERVER_ENTRY} 가 없습니다. 'npm run build' 를 먼저 실행하세요. (또는 npm test 가 자동으로 빌드합니다.)`,
    );
  }
  const transport = new StdioClientTransport({
    command: "node",
    args: [SERVER_ENTRY],
  });
  const client = new Client(
    { name: "test-client", version: "1.0.0" },
    { capabilities: {} },
  );
  await client.connect(transport);
  return client;
}

/** 샘플 프로젝트가 디스크에 존재하는지(없으면 데이터 의존 테스트는 skip). */
export function hasSampleProject(): boolean {
  return fs.existsSync(SAMPLE_PROJECT_PATH);
}
