# MCP API 레퍼런스

이 문서는 현재 MCP 클라이언트에 공개되는 API만 설명합니다.

## Tools

현재 공개 도구는 **1개**입니다.

| Tool | 분류 | 쓰기 여부 |
|------|------|-----------|
| `egov_search_knowledge` | 통합 지식/레퍼런스 검색 (가이드·지식·컴포넌트·호환성) | 읽기 전용 |

### `egov_search_knowledge`

eGovFrame 관련 지식과 참조 데이터를 통합 검색하는 읽기 전용 관문입니다.

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `query` | string | - | 검색 질문 또는 키워드 |
| `scope` | string | - | `auto`, `guide`, `knowledge`, `components`, `compatibility`, `all` |
| `action` | string | - | 상세 조회 동작. `get`, `dependencies`, `sourceFiles`, `readSource`, `ddl`, `dml` 등 |
| `filters` | object | - | 범위별 필터 |
| `limit` | number | - | 최대 결과 수 |
| `strictScope` | boolean | - | 지정한 scope만 검색할지 여부 |

대표 사용:

```json
{
  "query": "게시판 공통컴포넌트",
  "scope": "components",
  "limit": 5
}
```

```json
{
  "scope": "compatibility",
  "filters": {
    "frameworkVersion": "4.3"
  }
}
```

자세한 라우팅 규칙과 예시는 [EGOV_SEARCH_KNOWLEDGE_TOOL.md](./EGOV_SEARCH_KNOWLEDGE_TOOL.md)를 참고합니다.

## Prompts

현재 `ListPromptsRequestSchema`/`GetPromptRequestSchema` 핸들러를 제공하지 않습니다.

## Resources

현재 동적 MCP Resources는 제공하지 않습니다.

## 제거된 옛 도구 이름 처리

`src/server.ts`는 `McpServer` + `server.registerTool(...)` 로 위 1개 도구만 등록합니다. 과거 분리되어 있던 이름(`search_guide`, `list_common_components`, `egov_scaffold_project` 등)과 표준·Custom 용어사전 기능 제거로 삭제된 이름(`egov_ddl_assist`, `search_standard_terms`, `get_standard_term`)에 대한 별도 안내용 가드 핸들러는 두지 않습니다 — 등록되지 않은 도구 이름으로 호출이 들어오면 SDK 가 표준 JSON-RPC `Method not found` 에러를 자동 반환합니다.
