# `tests/integration/_helper.ts`

통합 테스트 공용 헬퍼입니다. MCP 서버(`build/index.js`)를 stdio 자식 프로세스로 실행해 Client SDK 로 연결하는 코드와, 테스트를 건너뛸지 판단할 때 쓰는 확인 함수를 한곳에 모았습니다. 헬퍼가 실행한 서버는 개발자의 사용자 데이터 디렉터리(오버레이)를 읽지 않고 저장소에 동봉된 지식베이스만 읽습니다.

> - 위치: `tests/integration/_helper.ts`
> - 분류: 공용 헬퍼 (테스트 파일이 아니므로 vitest 가 실행하지 않음)
> - 의존: `@modelcontextprotocol/sdk` 의 `Client`, `StdioClientTransport`

## 1. 이 헬퍼가 제공하는 것

| export | 내용 | 쓰는 곳 |
|---|---|---|
| `REPO_ROOT` | 저장소 루트의 절대 경로 (`tests/integration` 에서 두 단계 위) | `server.test.ts`, `searchKnowledge.test.ts`, `dispatcher.test.ts`, 단위 테스트의 `_lanceFixtures.ts`, `guideChunkCorpus`, `guideChunking`, `guideFrontMatter`, `vectorSearchExhaustive` |
| `SERVER_ENTRY` | 빌드된 진입점 `build/index.js` 의 절대 경로 | `createMcpClient()`, `dispatcher.test.ts` |
| `createMcpClient()` | 서버를 자식 프로세스로 실행하고 연결을 마친 `Client` 를 돌려줌 | `server.test.ts`, `searchKnowledge.test.ts`, `helperIsolation.test.ts` |
| `SearchKnowledgeResult` | `callSearchKnowledge()` 의 반환 타입. `text` 는 content 의 text 항목을 줄바꿈으로 이은 본문이고, `isError` 는 도구가 오류 결과로 응답했는지를 나타냄 | `callSearchKnowledge()` 의 반환값으로만 쓰임 |
| `callSearchKnowledge(client, args)` | `egov_search_knowledge` 를 호출하고 `SearchKnowledgeResult` 를 돌려줌 | `searchKnowledge.test.ts`, `helperIsolation.test.ts` |
| `hasComponentSources()` | 공통컴포넌트 소스(`templates/common-components-src/pom.xml`)가 있는지 | `searchKnowledge.test.ts` |
| `hasEmbeddingModel()` | 임베딩 모델(`models/Xenova/multilingual-e5-small/onnx/model_quantized.onnx`)이 있는지 | `searchKnowledge.test.ts`, 단위 테스트 `compatibilityKnowledgeBundled`, `embedder`, `guideChunkCorpus`, `guideChunking`, `knowledgeFilter`, `pdfKnowledgeChunks`, `vectorSearchExhaustive`, `vectorSearchScore` |

`ensureTemplateSources.test.ts`, `updateKnowledge.test.ts`, `updateSqliteResources.test.ts` 는 서버를 실행하지 않고 `src/` 의 함수를 직접 호출하므로 이 헬퍼를 쓰지 않습니다.

## 2. `createMcpClient()` 가 하는 일

```ts
const ISOLATED_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "egov-mcp-test-data-"));
process.once("exit", () => {
  fs.rmSync(ISOLATED_DATA_DIR, { recursive: true, force: true });
});

export async function createMcpClient(): Promise<Client> {
  if (!fs.existsSync(SERVER_ENTRY)) {
    throw new Error(
      `${SERVER_ENTRY} 가 없습니다. 'npm run build' 를 먼저 실행하세요. (또는 npm test 가 자동으로 빌드합니다.)`,
    );
  }
  const transport = new StdioClientTransport({
    command: "node",
    args: [SERVER_ENTRY],
    env: { EGOV_MCP_DATA_DIR: ISOLATED_DATA_DIR },
  });
  const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
  return client;
}
```

- `build/index.js` 가 없으면 위의 오류를 던집니다. `npm test` 는 항상 빌드를 먼저 하므로 이 오류가 나지 않고, `npx vitest run tests/integration/...` 처럼 vitest 만 실행했을 때 나타납니다.
- 서버 프로세스는 `PATH` 에서 찾은 `node` 로 실행합니다.
- 서버에는 SDK 가 기본으로 넘기는 환경 변수(macOS 와 Linux 에서는 `HOME`, `LOGNAME`, `PATH`, `SHELL`, `TERM`, `USER`)에 `EGOV_MCP_DATA_DIR` 을 더해 전달합니다. 그 값은 헬퍼 모듈이 만든 빈 임시 디렉터리(`ISOLATED_DATA_DIR`)입니다. 서버는 사용자 데이터 디렉터리에 update CLI 로 적용한 갱신분이 있으면 동봉 지식베이스 대신 그것을 읽는데, 빈 디렉터리를 주면 언제나 동봉 지식베이스를 읽습니다. 테스트를 실행하는 셸에서 `EGOV_MCP_DATA_DIR` 을 지정해도 서버에는 헬퍼의 값이 전달됩니다.
- 서버의 stderr 는 테스트 출력에 그대로 나옵니다. `[egovframe-mcp-search]` 로 시작하는 `Server started successfully` 와, 오류 응답을 확인하는 케이스에서 나오는 `egov_search_knowledge rejected: ...` 는 정상 로그입니다.

임시 디렉터리는 헬퍼 모듈을 불러올 때 `os.tmpdir()` 아래에 `egov-mcp-test-data-` 로 시작하는 이름으로 하나 만듭니다. 서버를 실행하지 않고 `REPO_ROOT` 나 `hasEmbeddingModel()` 만 가져다 쓰는 단위 테스트에서도 만들어집니다. 프로세스가 끝날 때 지우도록 등록되어 있지만, vitest 로 실행하면 이 정리가 수행되지 않아 헬퍼를 불러온 테스트 파일마다 빈 디렉터리가 하나씩 남습니다(vitest 1.6.1 에서 확인). 남은 디렉터리는 비어 있으므로 지워도 됩니다.

## 3. `callSearchKnowledge()` 와 확인 함수

`callSearchKnowledge(client, args)` 는 `client.callTool({ name: "egov_search_knowledge", arguments: args })` 를 호출하고, 응답 content 의 text 항목을 줄바꿈으로 이어 `text` 로 돌려줍니다. 호출이 MCP 클라이언트와 서버를 모두 거치므로 입력 스키마 검증도 함께 확인됩니다. 입력 스키마를 어긴 호출은 예외가 아니라 `isError` 가 `true` 인 결과로 돌아옵니다.

`hasComponentSources()` 와 `hasEmbeddingModel()` 은 `it.skipIf(...)`, `describe.skipIf(...)` 의 조건으로 씁니다. 공통컴포넌트 소스는 git 서브모듈이고 임베딩 모델은 git 이 추적하지 않는 파일이라서 저장소를 클론한 직후에는 둘 다 없을 수 있습니다. 두 함수는 저장소 안의 파일만 확인합니다.

## 4. 사용 패턴

서버를 실행하는 통합 테스트는 `describe` 마다 다음과 같이 서버를 하나씩 실행하고 끝나면 닫습니다.

```ts
import { createMcpClient } from "./_helper.js";

let client: Client;
beforeAll(async () => { client = await createMcpClient(); });
afterAll(async () => { await client?.close(); });
```

`client?.close()` 의 옵셔널 체이닝은 `beforeAll` 이 도중에 실패해서 `client` 에 값이 없을 때 `afterAll` 이 오류를 하나 더 던지지 않게 합니다.

## 5. 변경 시 주의

- `REPO_ROOT` 는 이 파일의 위치에서 `../..` 로 계산합니다. 파일을 다른 깊이의 디렉터리로 옮기면 이 경로도 함께 고쳐야 합니다.
- 단위 테스트도 이 파일에서 `REPO_ROOT` 와 `hasEmbeddingModel` 을 가져다 씁니다. export 이름을 바꾸거나 지울 때는 `tests/unit` 도 함께 확인합니다.
- 서버를 사용자 데이터 디렉터리와 격리하는 동작은 [helperIsolation.test.md](./helperIsolation.test.md)의 테스트가 확인합니다. `createMcpClient()` 의 `env` 를 바꿀 때는 그 테스트를 함께 실행합니다. 그 밖의 동작은 헬퍼를 쓰는 통합 테스트가 통과하는지로 확인합니다.

## 6. 흔한 실패와 진단

| 증상 | 원인과 대응 |
|---|---|
| `.../build/index.js 가 없습니다. 'npm run build' 를 먼저 실행하세요.` | 빌드 산출물이 없습니다. `npm run build` 를 실행하거나 `npm test` 로 실행합니다 |
| `MCP error -32000: Connection closed` | 서버가 연결 도중에 종료되었습니다. `node build/index.js` 를 직접 실행해서 stderr 의 오류를 확인합니다 |
| `beforeAll` 이 `Hook timed out in 10000ms.` 로 실패 | 서버 프로세스는 실행되었지만 연결 요청에 응답하지 않았습니다. vitest 의 hook 제한 시간은 기본값 10초입니다. `node build/index.js` 를 직접 실행해서 stderr 의 오류를 확인하고, stdout 에 JSON-RPC 메시지가 아닌 출력이 섞이지 않는지 확인합니다 |
| `src/` 를 고쳤는데 테스트 결과가 바뀌지 않음 | 서버는 `build/` 의 코드로 실행됩니다. `npm run build` 를 다시 실행합니다 |
| `os.tmpdir()` 아래에 `egov-mcp-test-data-` 로 시작하는 빈 디렉터리가 쌓임 | 2절에 적은 대로 vitest 실행에서는 헬퍼의 임시 디렉터리가 지워지지 않습니다. 테스트가 실행 중이 아닐 때 지웁니다 |
