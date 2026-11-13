# `server.test.ts`

MCP 서버가 stdio 로 연결되는지와, 서버가 노출하는 도구 목록이 정해 둔 것과 같은지를 검증하는 통합 테스트입니다.

> - 위치: `tests/integration/server.test.ts`
> - 실행: `npm test` 또는 `npx vitest run tests/integration/server.test.ts`
> - 분류: 통합 테스트. MCP Client SDK 로 서버를 자식 프로세스로 실행함

## 1. 이 테스트가 검증하는 것

이 파일은 서버가 MCP 클라이언트에 노출하는 도구 목록을 고정합니다.

1. 서버가 stdio 로 응답합니다. `client.listTools()` 가 배열을 돌려주는지로 확인합니다.
2. 노출 도구는 `egov_search_knowledge` 하나뿐입니다.
3. 각 도구에 `description` 과, `type` 이 `object` 인 `inputSchema` 가 있습니다.
4. `egov_search_knowledge` 의 `inputSchema` 에 최상위 파라미터 여섯 개(`query`, `scope`, `action`, `filters`, `limit`, `strictScope`)가 모두 있습니다.

`tools/list` 응답은 함수 하나를 호출하는 단위 테스트로는 확인하기 어렵습니다. 도구 등록 호출(`server.registerTool(...)`)이 빠진 경우, 응답 직렬화가 깨진 경우, stdio 연결이 비정상 종료되는 경우는 서버를 자식 프로세스로 실행하고 Client SDK 로 요청을 주고받아야 드러납니다.

도구를 호출했을 때 돌아오는 응답은 [searchKnowledge.test.md](./searchKnowledge.test.md)가 다룹니다.

## 2. 파일 구조와 헬퍼

`describe` 는 `integration — MCP server connectivity & inventory` 하나입니다. `beforeAll` 에서 [`createMcpClient()`](./_helper.md)로 서버를 실행해 연결하고, `afterAll` 에서 `client?.close()` 로 닫습니다. 모든 케이스가 같은 서버 프로세스를 씁니다.

기대하는 도구 목록은 파일 위쪽의 상수입니다.

```ts
const EXPECTED_TOOLS = ["egov_search_knowledge"];
```

이 배열을 바꾸면 서버가 외부에 제공하는 인터페이스가 바뀝니다. 의도한 변경인지 확인한 뒤에 고칩니다.

## 3. 케이스 상세

| 케이스 | 확인하는 것 |
|---|---|
| `서버가 stdio 로 응답한다` | `client.listTools()` 가 돌려준 `tools` 가 배열입니다 |
| `노출 도구가 정확히 egov_search_knowledge 뿐이다` | 도구 이름을 정렬한 배열이 `EXPECTED_TOOLS` 와 같습니다(`toEqual`). 도구가 하나라도 늘거나 줄면 실패합니다 |
| `각 도구가 description 과 inputSchema 를 갖는다` | 모든 도구의 `description` 과 `inputSchema` 가 비어 있지 않고, `inputSchema.type` 이 `"object"` 입니다 |
| `egov_search_knowledge 가 핵심 파라미터를 노출한다` | `inputSchema.properties` 에 `query`, `scope`, `action`, `filters`, `limit`, `strictScope` 가 정의되어 있습니다 |

LLM 은 `description` 을 보고 도구를 고르므로, 설명이 빈 채로 배포되지 않도록 세 번째 케이스로 확인합니다. 파라미터의 타입과 enum 값, `filters` 의 키, `annotations` 는 `searchKnowledge.test.ts` 의 공개 스키마 묶음이 확인합니다.

## 4. 실행 방법

```bash
# 전체 (빌드 후 단위 테스트와 통합 테스트)
npm test

# 이 파일만 (build/index.js 가 이미 있어야 함)
npx vitest run tests/integration/server.test.ts
```

## 5. 의존성과 전제 조건

| 항목 | 내용 |
|---|---|
| `build/index.js` | `npm test` 는 빌드를 먼저 실행합니다. vitest 만 실행할 때는 `npm run build` 를 먼저 실행합니다 |
| `@modelcontextprotocol/sdk` | `dependencies` 에 있습니다. 테스트의 클라이언트와 서버가 같은 설치본을 씁니다 |
| `vitest` | `devDependencies` 에 있습니다 |
| 지식베이스, 임베딩 모델, 공통컴포넌트 소스 | 필요하지 않습니다. 이 테스트는 `tools/list` 만 요청하고, 서버는 도구가 처음 호출될 때 지식베이스를 엽니다 |

건너뛰는 케이스가 없고, 저장소의 파일을 바꾸지 않습니다.

## 6. 흔한 실패와 진단

| 증상 | 원인 | 대응 |
|---|---|---|
| `노출 도구가 정확히 egov_search_knowledge 뿐이다` 케이스가 실패 | `src/server.ts` 의 `server.registerTool(...)` 호출을 추가하거나 지운 뒤 `EXPECTED_TOOLS` 를 고치지 않았습니다 | 의도한 변경이면 `EXPECTED_TOOLS` 와 [EXPOSED_TOOLS.md](../EXPOSED_TOOLS.md), [MCP_REFERENCE.md](../MCP_REFERENCE.md)를 함께 고칩니다 |
| `각 도구가 description 과 inputSchema 를 갖는다` 케이스가 실패 | 도구를 등록할 때 `description` 을 빠뜨렸습니다 | `src/server.ts` 의 도구 등록 객체에 `description` 을 넣습니다 |
| `egov_search_knowledge 가 핵심 파라미터를 노출한다` 케이스가 실패 | `inputSchema` 에서 최상위 파라미터를 지우거나 이름을 바꿨습니다 | 의도한 변경이면 테스트의 키 목록과 도구 문서를 함께 고칩니다 |
| `beforeAll` 에서 실패 | 서버를 실행하지 못했거나 연결하지 못했습니다 | [_helper.md](./_helper.md)의 "흔한 실패와 진단" 표를 봅니다 |
