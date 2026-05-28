# `tests/integration/_helper.ts`

통합 테스트 공용 헬퍼. MCP 서버(`build/index.js`)를 stdio 로 자식 프로세스로 띄우고 Client SDK 로 연결하는 보일러플레이트를 한 곳에 모았다.

> 위치: `tests/integration/_helper.ts`
> 분류: 공용 유틸 (스스로는 테스트가 아님)
> 의존: `@modelcontextprotocol/sdk` Client / StdioClientTransport

## 1. 이 헬퍼가 제공하는 것

| export | 용도 |
|---|---|
| `REPO_ROOT` | `tests/integration/` 에서 두 단계 위 — 저장소 루트 절대경로 |
| `SERVER_ENTRY` | `${REPO_ROOT}/build/index.js` — 빌드 산출물 진입점 |
| `SAMPLE_PROJECT_PATH` | `tests/test-output/my-egov-app` — 일부 통합 시나리오가 입력으로 쓰는 샘플 프로젝트(존재해야만 의미 있음) |
| `createMcpClient()` | `StdioClientTransport` 로 서버를 띄우고 `Client.connect()` 까지 끝낸 `Client` 인스턴스를 반환 |
| `hasSampleProject()` | `SAMPLE_PROJECT_PATH` 의 존재 여부 — 데이터 의존 테스트가 skip 판단에 사용 |

## 2. `createMcpClient()` 가 하는 일

```ts
if (!fs.existsSync(SERVER_ENTRY)) throw new Error("...build 가 없습니다.");
const transport = new StdioClientTransport({ command: "node", args: [SERVER_ENTRY] });
const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
await client.connect(transport);
return client;
```

`build/index.js` 가 없으면 친절한 한국어 에러로 실패한다. `npm test` 는 항상 `npm run build` 를 선행하기 때문에 평소엔 보지 못하지만, `npx vitest run tests/integration/...` 만 단독 실행하면 부딪힐 수 있는 에러다.

## 3. 사용 패턴

각 통합 테스트 파일은 동일한 보일러플레이트를 반복하지 않는다.

```ts
import { createMcpClient } from "./_helper.js";

let client: Client;
beforeAll(async () => { client = await createMcpClient(); });
afterAll(async () => { await client?.close(); });
```

`client?.close()` 의 옵셔널 체이닝은 `beforeAll` 이 도중에 실패해 `client` 가 미할당된 상황에서도 `afterAll` 이 추가 에러를 던지지 않게 하는 안전장치다.

## 4. 변경 시 주의

- `REPO_ROOT` 의 상대 깊이(`../..`) 는 `tests/integration/` 위치 기준이다. 디렉터리를 옮기면 비율을 같이 조정해야 한다.
- 헬퍼 자체를 import 해 단위 테스트로 검증하기보다, 이 헬퍼를 쓰는 통합 테스트가 통과하면 사실상 검증된 상태로 간주한다.

## 5. 흔한 실패와 진단

| 증상 | 원인 후보 |
|---|---|
| `build/index.js 가 없습니다` 에러 | `npm run build` 가 누락. `npm test` 한 번이면 해결 |
| `MCP error -1: Connection closed` | 서버가 부팅 직후 크래시. `node build/index.js` 단독 실행으로 stderr 확인 |
| stdio 핸드셰이크 무한 대기 | SDK 버전 충돌. `@modelcontextprotocol/sdk` 클라이언트와 서버가 같은 메이저 버전인지 확인 |
