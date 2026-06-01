# MCP API 레퍼런스

이 문서는 현재 MCP 클라이언트에 공개되는 API만 설명합니다.

## Tools

현재 공개 도구는 **2개**입니다.

| Tool | 분류 | 쓰기 여부 |
|------|------|-----------|
| `egov_ddl_assist` | DDL 작성/검토 보조 oracle (행정안전부 공통표준용어 사전) | 읽기 전용 |
| `egov_search_knowledge` | 통합 지식/레퍼런스 검색 (가이드·지식·표준용어·컴포넌트·호환성) | 읽기 전용 |

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

### `egov_ddl_assist`

행정안전부 공통표준용어 사전(`standard_terms` / `standard_words` / `standard_domains`, 8차 2025-11) + 기관 custom 사전(`custom_terms` / `custom_words` / `custom_domains`, 단일 기관)을 lookup oracle 로 제공해 LLM 의 CREATE TABLE / ALTER TABLE 작성을 보조합니다. DDL 문장 자체를 생성하지 않고 영문 컬럼명·SQL 타입 *조각*만 반환 — 조립은 호출자 책임.

**우선순위 정책**: `custom > standard` (transparent override). 모든 응답에 `source: "custom" | "standard"` 표기. 같은 한글명이 양쪽에 있으면 custom 이 1차 매치되고 가려진 표준은 `standardEquivalent` 에 함께 노출. 기관 custom 등록은 [templates/custom_terms/README.md](../templates/custom_terms/README.md) 참고.

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `action` | string | ✓ | `lookup_term` \| `decompose_phrase` \| `resolve_domain` \| `propose_column` \| `validate_column` \| `suggest_table_columns` |
| `input` | string | ✓ | action 별 입력 (한글 용어/구문, 도메인명, 영문 컬럼명 등) |
| `domainHint` | string | - | `propose_column` 전용. 분해 폴백 시 SQL 타입 결정용 도메인명 |
| `sqlType` | string | - | `validate_column` 전용. 실제 사용된 SQL 타입 (예: `VARCHAR(100)`) |
| `limit` | number | - | `suggest_table_columns` 전용. 반환 후보 수 상한 (기본 30, 최대 100) |

#### Action

| action | 입력 | 출력 핵심 | 예시 |
|--------|------|-----------|------|
| `lookup_term` | 한글 용어 | `{matchType: "exact"\|"synonym"\|"none", term/candidates}` | `사용자명` → `USER_NM` + `VARCHAR(100)` |
| `decompose_phrase` | 한글 구문 | `{tokens, suggestedColumnName, unmatchedSegments}` | `신규사용자등록일자` → `NEW_USER_REG_YMD` |
| `resolve_domain` | 도메인명 | `{domain: {dataType, dataLength, ddlFragment}}` | `명V100` → `VARCHAR(100)` |
| `propose_column` | 한글 구문 (+ `domainHint?`) | `{method, columnName, ddlFragment, confidence, ...}` | `회원가입일자` → `MBR_JOIN_YMD CHAR(8)` (confidence 1.0) |
| `validate_column` | 영문 컬럼명 (+ `sqlType?`) | `{status, typeStatus, findings, matches}` | `USER_NM` + `VARCHAR(50)` → `type_mismatch` (표준은 `VARCHAR(100)`) |
| `suggest_table_columns` | 한글 테이블 개념 (+ `limit?`) | `{total, suggestions: [{koreanName, englishName, ddlFragment, matchType}, ...]}` | `회원` → 회원ID/회원명/회원가입일자/... 후보 |

#### `propose_column` 매칭 우선순위

1. **exact** (`confidence: 1.0`) — 표준 용어 정확 매칭
2. **synonym** (`confidence: 0.85`) — `synonyms` 컬럼 콤마 분리 후 정확 매칭. `note` 로 표준명 권장
3. **composed** (`confidence: 0.5~0.85`) — 표준 단어로 longest-prefix 분해 후 영문 조합. SQL 타입은 `domainHint` 가 있어야 결정

대표 사용:

```json
{ "action": "lookup_term", "input": "사용자명" }
```

```json
{ "action": "propose_column", "input": "신규사용자등록일자", "domainHint": "연월일C8" }
```

```json
{ "action": "validate_column", "input": "USER_NM", "sqlType": "VARCHAR(50)" }
```

```json
{ "action": "suggest_table_columns", "input": "게시판", "limit": 20 }
```

응답은 모두 JSON 문자열(`content[0].text`) 로 반환됩니다.

## Prompts

현재 `ListPromptsRequestSchema`/`GetPromptRequestSchema` 핸들러를 제공하지 않습니다.

## Resources

현재 동적 MCP Resources는 제공하지 않습니다.

## 제거된 옛 도구 이름 처리

`src/index.ts`는 `McpServer` + `server.registerTool(...)` 로 위 2개 도구만 등록합니다. 과거 분리되어 있던 이름(`search_guide`, `search_standard_terms`, `list_common_components`, `egov_scaffold_project` 등)에 대한 별도 안내용 가드 핸들러는 두지 않습니다 — 등록되지 않은 도구 이름으로 호출이 들어오면 SDK 가 표준 JSON-RPC `Method not found` 에러를 자동 반환합니다.
