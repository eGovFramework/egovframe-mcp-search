# `server.test.ts`

MCP 서버의 **연결성 + 도구 인벤토리**를 검증하는 통합 테스트.

> 위치: `tests/integration/server.test.ts`
> 실행: `npm test` 또는 `npx vitest run tests/integration/server.test.ts`
> 분류: integration — MCP Client SDK 로 서버를 자식 프로세스로 띄움

## 1. 이 테스트가 검증하는 것

이 파일 하나로 "**현재 노출 도구 인벤토리가 합의된 상태와 일치하는가**"를 동결합니다.

1. 서버가 stdio 로 응답한다 — `client.listTools()` 가 배열을 반환
2. **노출 도구가 정확히 `egov_search_knowledge` 하나뿐**
3. 각 도구가 `description` 과 `inputSchema(type=object)` 를 갖는다
4. `egov_search_knowledge` 의 핵심 파라미터 6개(`query`, `scope`, `action`, `filters`, `limit`, `strictScope`)가 모두 inputSchema 에 있다

## 2. 합의된 도구 목록(`EXPECTED_TOOLS`)

```ts
const EXPECTED_TOOLS = ["egov_search_knowledge"];
```

이 배열을 바꾸는 것은 곧 외부 API 표면을 바꾸는 행위입니다. PR 단위로 신중히 검토되어야 합니다.

## 3. 케이스 상세

### 3-1. 서버가 stdio 로 응답한다

가장 낮은 수준의 스모크. `tools.tools` 가 배열이기만 하면 통과.

### 3-2. 노출 도구가 정확히 egov_search_knowledge 하나뿐이다

```ts
const actual = tools.tools.map((t) => t.name).sort();
expect(actual).toEqual(EXPECTED_TOOLS);
```

`.toEqual` 이라 **부분 일치가 아닌 정확 일치**입니다. 도구가 1개라도 추가되거나 빠지면 빨강. 신규 도구가 들어왔다면 의도된 변경인지 확인 후 `EXPECTED_TOOLS` 도 함께 갱신합니다.

### 3-3. 각 도구가 description 과 inputSchema 를 갖는다

```ts
for (const t of tools.tools) {
  expect(t.description).toBeTruthy();
  expect(t.inputSchema).toBeTruthy();
  expect((t.inputSchema as any).type).toBe("object");
}
```

LLM 라우팅 품질의 토대를 동결합니다. description 이 빈 문자열이면 LLM 이 도구를 못 고르므로 회귀 위험이 큽니다.

### 3-4. `egov_search_knowledge` 핵심 파라미터

`query / scope / action / filters / limit / strictScope` 6개가 inputSchema 에 모두 있는지 확인합니다.

## 4. 실행 방법

```bash
# 전체
npm test

# 이 파일만
npx vitest run tests/integration/server.test.ts
```

## 5. 의존성과 전제 조건

| 항목 | 어디서 보장되는가 |
|---|---|
| `@modelcontextprotocol/sdk` Client/StdioTransport | `dependencies` |
| `vitest` | `devDependencies` |
| `build/index.js` 존재 | `npm test` 가 `npm run build` 선행 |
| 외부 데이터(`knowledge-base/*.db`) | **불필요** — `listTools` 만 호출 |

자기완결적입니다. 색인된 DB 없이도 통과합니다.

## 6. 흔한 실패와 진단

| 증상 | 원인 후보 | 대응 |
|---|---|---|
| 3-2가 빨강 — 도구 수 불일치 | `src/index.ts` 의 `ListToolsRequestSchema` 핸들러에 새 도구 추가/제거 후 `EXPECTED_TOOLS` 미갱신 | 의도된 변경이면 `EXPECTED_TOOLS` 갱신 + `docs/EXPOSED_TOOLS.md` / `docs/MCP_REFERENCE.md` 함께 갱신 |
| 3-3이 빨강 — description 비어있음 | 도구 등록 시 description 누락 | `src/index.ts` 의 해당 도구 객체에 description 추가 |

## 7. 단위 테스트로 옮기지 못하는 이유

`ListToolsRequestSchema` 응답을 함수 단위로 단위 테스트 할 수도 있지만, 그렇게 하면 다음 회귀가 잡히지 않습니다.

- `Server.setRequestHandler(ListToolsRequestSchema, ...)` 자체가 누락되는 경우
- SDK 메이저 버전 충돌로 응답 직렬화가 깨지는 경우
- stdio 핸드셰이크가 비정상 종료되는 경우

이 셋은 **자식 프로세스 + Client SDK 왕복**으로만 잡힙니다.
