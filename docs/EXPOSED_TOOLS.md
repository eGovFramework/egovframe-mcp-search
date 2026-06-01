# 현재 노출 Tools

`src/index.ts`의 `server.registerTool(...)` 등록 기준(= `tools/list` 응답)으로 MCP 클라이언트에 실제 노출되는 도구만 정리합니다.

> 기준 파일: `src/index.ts`
> 현재 노출 tools: **2개**

## 전체 목록

| # | Tool | 분류 | 설명 |
|---|------|------|------|
| 1 | `egov_ddl_assist` | DDL 작성/검토 보조 | 행정안전부 공통표준용어 사전 oracle. 한글 → 표준 영문 컬럼명/SQL 타입 변환, 검증, 후보 제안 |
| 2 | `egov_search_knowledge` | 통합 지식 검색 (읽기 전용) | 공식 가이드, 개인 지식, 표준용어, 공통컴포넌트(미리 정의된 CREATE TABLE 포함), 호환성을 하나의 관문으로 |

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

## `egov_ddl_assist`

행정안전부 공통표준용어 사전(`standard_terms`/`standard_words`/`standard_domains`) + 기관 custom 사전(`custom_terms`/`custom_words`/`custom_domains`)을 lookup oracle 로 노출하여 LLM 이 CREATE TABLE / ALTER TABLE 을 작성할 때 표준 영문 컬럼명과 SQL 타입을 즉시 받게 한다. 도구는 DDL 문장을 자체 생성하지 않고 *조각*만 반환 — 조립은 호출자(LLM) 책임.

**우선순위**: custom > standard (transparent override). 같은 한글명/도메인명이 양쪽 모두에 있으면 custom 결과를 1차로 반환하면서 표준 동등 항목을 `standardEquivalent` 로 함께 노출. 모든 응답에 `source: "custom" | "standard"` 표기. 기관 custom 사전 등록 방법은 [templates/custom_terms/README.md](../templates/custom_terms/README.md) 참고.

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `action` | string | ✓ | `lookup_term` \| `decompose_phrase` \| `resolve_domain` \| `propose_column` \| `validate_column` \| `suggest_table_columns` |
| `input` | string | ✓ | action 별 입력 (한글 용어/구문, 도메인명, 영문 컬럼명 등) |
| `domainHint` | string | - | `propose_column` 전용. 분해 폴백 시 SQL 타입 결정용 도메인명 |
| `sqlType` | string | - | `validate_column` 전용. 실제 사용된 SQL 타입 (예: `VARCHAR(100)`, `NUMERIC(15,4)`). 생략 시 영문명만 검증 |
| `limit` | number | - | `suggest_table_columns` 전용. 반환 후보 수 상한. 기본 30, 최대 100 |

### Action

| action | input 예시 | 출력 요약 | 주 용도 |
|--------|-----------|----------|---------|
| `lookup_term` | `사용자명` | `{matchType: "custom_exact"\|"exact"\|"custom_synonym"\|"synonym"\|"none", term: {source, englishName, resolvedDomain.ddlFragment, synonyms, ...}, standardEquivalent?}` | 용어 정확/동의어 매칭 (custom 우선) |
| `decompose_phrase` | `신규사용자등록일자` | `{tokens: [...], suggestedColumnName: "NEW_USER_REG_YMD", unmatchedSegments: []}` | 한글 구문 → 표준 단어 분해 + 영문 조합 후보 |
| `resolve_domain` | `명V100` | `{domain: {dataType: "VARCHAR", dataLength: "100", ddlFragment: "VARCHAR(100)"}}` | 도메인명 → SQL 타입 |
| `propose_column` | `회원가입일자` | `{method, columnName, ddlFragment: "MBR_JOIN_YMD CHAR(8)", confidence}` | 엔드투엔드 한글 → 컬럼 DDL fragment |
| `validate_column` | `USER_NM` + `sqlType: "VARCHAR(50)"` | `{status: "type_mismatch", findings: [{level, code, message}, ...], matches: [...]}` | 영문 컬럼명/타입이 표준에 부합하는지 검증 |
| `suggest_table_columns` | `회원` | `{total, suggestions: [{koreanName, englishName, ddlFragment, matchType}, ...]}` | 한글 테이블 개념 → 관련 표준 용어 ranked 후보 |

### 매칭 우선순위 (`propose_column`)

1. **exact** (`confidence: 1.0`) — `standard_terms.korean_name` 정확 매칭 → 영문약어 + 도메인 모두 결정
2. **synonym** (`confidence: 0.85`) — `standard_terms.synonyms` 콤마 분리 후 정확 매칭. `note` 로 표준명 권장
3. **composed** (`confidence: 0.5~0.85`) — 표준 용어에 없을 때 `standard_words` 사용해 longest-prefix 분해 후 영문 조합. 도메인은 `domainHint` 로 받아야 정확한 길이 결정

### 예시

```json
{ "action": "lookup_term", "input": "사용자명" }
```
```json
{ "action": "decompose_phrase", "input": "주문상품금액" }
```
```json
{ "action": "resolve_domain", "input": "연월일C8" }
```
```json
{ "action": "propose_column", "input": "신규사용자등록일자", "domainHint": "연월일C8" }
```
```json
{ "action": "validate_column", "input": "USER_NM", "sqlType": "VARCHAR(50)" }
```
```json
{ "action": "suggest_table_columns", "input": "회원", "limit": 20 }
```

### validate_column findings 코드

| code | level | 의미 |
|------|-------|------|
| `EXACT_MATCH` | info | 영문약어가 표준 용어 1건과 정확 매칭 |
| `MULTIPLE_MATCHES` | info | 영문약어에 한글 용어가 N건 매핑됨 (컨텍스트로 선택 필요) |
| `CUSTOM_MATCH` | info | 영문약어가 기관 custom 사전에서만 매칭 (표준 미등재). matchSource: "custom" |
| `CUSTOM_OVERRIDES_STANDARD` | info | 영문약어가 custom + standard 양쪽에 있음. custom 이 우선 — `standardEquivalentMatches` 에 가려진 표준 정의 노출 |
| `NON_STANDARD_NAME` | error | 표준 + custom 사전 어디에도 등재되지 않은 영문약어 |
| `TYPE_OK` | info | sqlType 이 매칭된 (custom 또는 표준) 도메인 정의와 일치 |
| `TYPE_MISMATCH` | error | sqlType 이 매칭된 도메인과 불일치 (타입/길이/소수점) |
| `UNPARSEABLE_SQL_TYPE` | warning | sqlType 문자열을 파싱하지 못함 |
| `DOMAIN_UNRESOLVED` | warning | 매칭된 용어의 도메인을 해석할 수 없어 타입 검증 보류 |

## 노출되지 않는 도구

다음 도구 이름은 `src/index.ts` 에 등록되지 않으므로 `tools/list` 응답에 포함되지 않습니다. 옛 클라이언트가 이 이름으로 호출하면 SDK 가 표준 JSON-RPC `Method not found` 에러를 돌려줍니다(별도 안내 가드는 두지 않습니다).

| 구분 | 도구 |
|------|------|
| 통합 검색으로 대체 | `search_guide`, `search_knowledge`, `search_standard_terms`, `get_standard_term`, `search_compatible_software`, 공통컴포넌트 조회 계열 |
| 본 서버에서 제거 | `egov_check_compliance`, `egov_scaffold_project`, `egov_add_entity`, `egov_add_query_view` |
| 외부 비노출(과거) | `generate_crud`, `generate_config`, `normalize_ddl`, `review_code` |
| 내부 지식 관리(과거) | `add_knowledge`, `update_knowledge`, `delete_knowledge` |
