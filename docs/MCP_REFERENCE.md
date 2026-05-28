# MCP API 레퍼런스

이 문서는 현재 MCP 클라이언트에 공개되는 API만 설명합니다.

## Tools

현재 공개 도구는 **1개**입니다.

| Tool | 분류 | 쓰기 여부 |
|------|------|-----------|
| `egov_search_knowledge` | 통합 지식/레퍼런스 검색 | 읽기 전용 |

### `egov_search_knowledge`

eGovFrame 관련 지식과 참조 데이터를 통합 검색하는 읽기 전용 관문입니다.

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `query` | string | - | 검색 질문 또는 키워드 |
| `scope` | string | - | `auto`, `guide`, `knowledge`, `terms`, `components`, `compatibility`, `all` |
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
  "scope": "terms",
  "action": "get",
  "filters": {
    "koreanName": "게시판ID"
  }
}
```

자세한 라우팅 규칙과 예시는 [EGOV_SEARCH_KNOWLEDGE_TOOL.md](./EGOV_SEARCH_KNOWLEDGE_TOOL.md)를 참고합니다.

## Prompts

현재 `ListPromptsRequestSchema`/`GetPromptRequestSchema` 핸들러를 제공하지 않습니다.

## Resources

현재 동적 MCP Resources는 제공하지 않습니다.

## 숨겨진 내부 핸들러

`src/index.ts`에는 옛 클라이언트 호출에 대한 안내용 가드가 남아 있습니다(`hiddenUnifiedToolNames`, `hiddenGenerationToolNames`, `internalKnowledgeMutationToolNames`, `retiredToolNames`). 이 이름들로 호출이 들어오면 "통합 검색으로 흡수됨" 또는 "본 서버에서 제거됨" 안내 에러를 돌려줍니다. 외부 노출 도구로 취급하지 않습니다.
