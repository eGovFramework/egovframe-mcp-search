# 현재 노출 Tools

`src/index.ts`의 `ListToolsRequestSchema` 응답 기준으로 MCP 클라이언트에 실제 노출되는 도구만 정리합니다.

> 기준 파일: `src/index.ts`
> 현재 노출 tools: **1개**

## 전체 목록

| # | Tool | 분류 | 설명 |
|---|------|------|------|
| 1 | `egov_search_knowledge` | 통합 지식 검색 | 공식 가이드, 개인 지식, 표준용어, 공통컴포넌트, 호환성을 하나의 관문으로 통합 |

## `egov_search_knowledge`

검색/조회 계열 기능은 개별 도구로 노출하지 않고 이 도구의 `scope`, `action`, `filters`로 라우팅합니다.

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `query` | string | - | 검색 질문 또는 키워드. `guide`, `knowledge`, `all` 검색에서는 필요 |
| `scope` | string | - | `auto`, `guide`, `knowledge`, `terms`, `components`, `compatibility`, `all` |
| `action` | string | - | 세부 조회 동작. 예: `get`, `dependencies`, `sourceFiles`, `readSource`, `ddl`, `dml` |
| `filters` | object | - | 범위별 필터. 예: `componentId`, `dbType`, `koreanName`, `frameworkVersion` |
| `limit` | number | - | 최대 결과 수 |
| `strictScope` | boolean | - | `true`면 지정 scope만 검색 |

### Scope

| scope | 설명 |
|-------|------|
| `auto` | 입력값과 필터를 보고 검색 범위 자동 추론 |
| `guide` | eGovFrame 공식 Developer Guide 검색 |
| `knowledge` | 개인 지식 베이스 검색 |
| `terms` | 표준용어 검색 및 상세 조회 |
| `components` | 공통컴포넌트 목록, 상세, 의존성, 소스, DDL/DML 조회 |
| `compatibility` | eGovFrame 버전별 호환 소프트웨어 검색 |
| `all` | 주요 지식 소스 통합 검색 |

### 예시

```json
{
  "query": "Spring Boot 기반 eGovFrame에서 Transaction 설정은 어떻게 하나요?",
  "scope": "all",
  "limit": 5
}
```

```json
{
  "scope": "components",
  "action": "ddl",
  "filters": {
    "componentId": "bbs",
    "dbType": "mysql"
  }
}
```

자세한 라우팅 규칙과 예시는 [EGOV_SEARCH_KNOWLEDGE_TOOL.md](./EGOV_SEARCH_KNOWLEDGE_TOOL.md)를 참고합니다.

## 노출되지 않는 도구

다음 도구 이름은 `ListToolsRequestSchema` 응답에 포함되지 않습니다. 옛 클라이언트가 이 이름으로 호출하면 `src/index.ts`의 가드가 명확한 에러를 돌려줍니다.

| 구분 | 도구 |
|------|------|
| 통합 검색으로 대체 | `search_guide`, `search_knowledge`, `search_standard_terms`, `get_standard_term`, `search_compatible_software`, 공통컴포넌트 조회 계열 |
| 본 서버에서 제거 | `egov_check_compliance`, `egov_scaffold_project`, `egov_add_entity`, `egov_add_query_view` |
| 외부 비노출(과거) | `generate_crud`, `generate_config`, `normalize_ddl`, `review_code` |
| 내부 지식 관리(과거) | `add_knowledge`, `update_knowledge`, `delete_knowledge` |
