# 현재 노출 Tools

`tools/list` 응답을 기준으로 MCP 클라이언트에 실제 노출되는 도구를 정리합니다. 도구는 `src/server.ts` 의 `server.registerTool(...)` 로 등록합니다. `src/index.ts` 는 진입점 디스패처로, 인자 없이 실행하면 이 서버를 띄우고 `update` 인자를 주면 지식베이스 갱신 명령을 실행합니다.

> 기준 파일: `src/server.ts`
> 현재 노출 tools: **1개**

## 전체 목록

| # | Tool | 분류 | 설명 |
|---|------|------|------|
| 1 | `egov_search_knowledge` | 통합 검색 (읽기 전용) | 공식 가이드, 개발자 지식, 공통컴포넌트(소스 파일과 미리 정의된 CREATE TABLE·INSERT 문 포함), 호환 소프트웨어를 도구 하나로 조회 |

## `egov_search_knowledge`

검색과 조회 기능은 개별 도구로 노출하지 않고 이 도구의 `scope`, `action`, `filters` 로 나눕니다.

`tools/list` 에는 다음 정보가 실립니다.

| 항목 | 값 |
|------|-----|
| `name` | `egov_search_knowledge` |
| `title` | `eGovFrame Knowledge Search` |
| `description` | 이미 있는 참조 자료를 찾아 주는 읽기 전용 검색·조회 도구이고, 새 스키마를 만들거나 무언가를 저장하지 않는다는 설명 |
| `annotations` | `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false` |
| `execution` | `taskSupport: "forbidden"` (MCP SDK 가 붙이는 값) |
| `inputSchema` | 아래 여섯 개의 최상위 속성. 필수 속성은 없습니다. |

| 파라미터 | 타입 | 설명 |
|----------|------|------|
| `query` | string | 검색 질문 또는 키워드 (최대 10,000자). `guide`, `knowledge`, `all` 검색에서는 필요합니다. |
| `scope` | string (enum) | `auto`, `guide`, `knowledge`, `components`, `compatibility`, `all`. 생략하면 `auto` 입니다. |
| `action` | string (enum) | `components` 의 세부 조회 동작. `get`, `info`, `dependencies`, `sourceFiles`, `readSource`, `ddl`, `dml` |
| `filters` | object | scope 별 필터. 예: `componentId`, `dbType`, `frameworkVersion`. 정의된 키만 받습니다. |
| `limit` | integer | 최대 결과 수 (1~200) |
| `strictScope` | boolean | 효과가 없습니다. 기존 호출과의 호환을 위해 받기만 합니다. |

`filters` 의 키, `limit` 의 기본값과 최댓값, 응답과 오류의 형태는 [MCP_REFERENCE.md](./MCP_REFERENCE.md)에 정리되어 있습니다.

### Scope

| scope | 설명 |
|-------|------|
| `auto` | `action` 과 `filters` 를 보고 출처를 고릅니다. 출처를 가리키는 값이 없으면 `query` 가 있을 때 통합 검색을 실행하고, 없을 때 공통컴포넌트 조회로 처리해 목록 필터가 없으면 카테고리 개요를 돌려줍니다. 다만 `query` 없이 어느 출처의 분류도 아닌 `filters.category` 만 준 호출은 호환 소프트웨어 조회로 처리합니다. |
| `guide` | 공식 가이드(eGovFrame Developer Guide) 의미 검색 |
| `knowledge` | 개발자 지식(전자정부 표준프레임워크 포털의 묻고답하기, FAQ, 적용가이드) 의미 검색 |
| `components` | 공통컴포넌트의 목록, 키워드 검색, 상세, 의존성, 소스 파일, DDL, DML 조회 |
| `compatibility` | 표준프레임워크 버전별 호환 소프트웨어 조회와 키워드 검색 |
| `all` | 위 네 출처의 통합 검색. 출처마다 기본 5건, 최대 10건을 싣습니다. |

### 예시

통합 검색입니다. 응답은 `# 통합 지식 검색 결과` 아래에 공식 가이드, 개발자 지식, 공통컴포넌트, 호환 소프트웨어의 결과가 차례로 나옵니다.

```json
{
  "query": "Spring Boot 기반 eGovFrame에서 Transaction 설정은 어떻게 하나요?",
  "scope": "all",
  "limit": 5
}
```

게시판 공통컴포넌트의 MySQL 용 DDL 조회입니다. 응답은 `## 게시판 DDL (mysql)` 로 시작하고 CREATE TABLE 문을 담은 SQL 코드 블록이 이어집니다.

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

scope 별 사용법과 더 많은 예시는 [EGOV_SEARCH_KNOWLEDGE_TOOL.md](./EGOV_SEARCH_KNOWLEDGE_TOOL.md)를 참고합니다.

## 노출되지 않는 도구

다음 이름은 `src/server.ts` 에 등록되지 않으므로 `tools/list` 응답에 없습니다. 이 이름으로 호출하면 JSON-RPC 오류가 아니라 `isError: true` 인 도구 결과가 돌아오고, 본문은 `MCP error -32602: Tool <이름> not found` 입니다. 옛 이름을 안내하는 별도 핸들러는 두지 않습니다.

| 구분 | 도구 |
|------|------|
| 통합 검색으로 대체 (`egov_search_knowledge` 의 `scope` 와 `action` 으로 호출) | `search_guide`, `search_knowledge`, `search_compatible_software`, 공통컴포넌트 조회 계열(`list_common_components`, `get_component_info`, `get_component_ddl` 등) |
| 기능 제거 (표준·Custom 용어사전 미제공) | `egov_ddl_assist`, `search_standard_terms`, `get_standard_term` |
| 본 서버에서 제거 (`egovframe-mcp-check` 서버가 제공) | `egov_check_compliance` |
| 본 서버에서 제거 (`egovframe-mcp-codegen` 서버가 제공) | `egov_scaffold_project`, `egov_add_entity`, `egov_add_query_view` |
| 외부 비노출(과거) | `generate_crud`, `generate_config`, `normalize_ddl`, `review_code` |
| 내부 지식 관리(과거) | `add_knowledge`, `update_knowledge`, `delete_knowledge` |
