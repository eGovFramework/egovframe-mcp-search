# `egov_search_knowledge` Tool 가이드

`egov_search_knowledge`는 eGovFrame 개발에 필요한 지식 조회 기능을 하나의 관문으로 묶은 통합 검색 tool입니다.

기존에 외부로 각각 노출되던 공식 문서 검색, 개인 지식 검색, 공통컴포넌트 조회, 호환 소프트웨어 검색 tools는 더 이상 직접 노출하지 않고, 이 tool의 `scope`와 `action`으로 호출합니다.

> 구현 파일: `src/tools/egovSearchKnowledge.ts`  
> 등록 위치: `src/index.ts`  
> 쓰기 여부: 읽기 전용

---

## 목적

`egov_search_knowledge`의 목적은 MCP 클라이언트가 검색/조회 목적의 세부 tools를 일일이 선택하지 않아도 되도록 하는 것입니다.

이 tool 하나로 다음 작업을 처리합니다.

- eGovFrame 공식 Developer Guide 검색
- 개인 지식 베이스 검색
- 공통컴포넌트 목록/상세/의존성 조회
- 공통컴포넌트 소스 파일, DDL, DML 조회
- eGovFrame 버전별 호환 소프트웨어 검색
- 주요 지식 소스 통합 검색

---

## 입력 스키마

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `query` | string | - | 검색 질문 또는 키워드. `guide`, `knowledge`, `all` 검색에서는 필수 |
| `scope` | string | - | 검색 범위. `auto`, `guide`, `knowledge`, `components`, `compatibility`, `all` |
| `action` | string | - | 세부 조회 동작. 주로 `components` 범위에서 사용 |
| `filters` | object | - | 범위별 필터 |
| `limit` | number | - | 최대 결과 수. `filters.limit`보다 우선 적용 |
| `strictScope` | boolean | - | `true`면 지정한 `scope`만 검색. 기본값은 `false` |

기본 동작:

- `scope`를 생략하거나 `auto`로 지정하면 입력값을 보고 검색 범위를 자동 추론합니다.
- 일반 키워드 검색에서 `scope`가 지정되어도 `strictScope`가 `true`가 아니면 통합 검색으로 확장합니다.
- `filters`를 생략하면 빈 객체로 처리합니다.
- `limit`를 생략하면 scope별 기본값을 사용합니다.

---

## Scope

| scope | 설명 | 주요 내부 기능 |
|-------|------|----------------|
| `auto` | 입력값 기반 자동 라우팅 | `inferScope()` |
| `guide` | 공식 Developer Guide 검색 | `searchGuide()` |
| `knowledge` | 개인 지식 베이스 검색 | `searchPersonalKnowledge()` |
| `components` | 공통컴포넌트 조회 | `searchComponentsGateway()` |
| `compatibility` | 호환 소프트웨어 검색 | `searchCompatibility()` |
| `all` | 주요 지식 소스 통합 검색 | `searchAll()` |

---

## 자동 Scope 추론

`scope: "auto"`이거나 `scope`가 없으면 다음 규칙으로 범위를 결정합니다.

| 조건 | 추론 scope |
|------|------------|
| `filters.componentId`, `filters.componentIds`, `filters.filePath` 중 하나가 있음 | `components` |
| `filters.frameworkVersion`, `filters.vendor`, `filters.productName` 중 하나가 있음 | `compatibility` |
| 위 조건이 없고 `query`가 있음 | `all` |
| 위 조건이 없고 `query`도 없음 | `components` |

---

## Scope 오지정 방지 정책

`scope`는 기본적으로 hard filter가 아니라 hint로 취급합니다. 예를 들어 아래처럼 `scope: "guide"`가 들어와도 일반 키워드 검색이면 공식 문서만 보지 않고 주요 지식 소스를 함께 검색합니다.

```json
{
  "query": "MyBatis 설정 방법",
  "scope": "guide",
  "limit": 10
}
```

이 호출은 `strictScope`가 없으므로 `all` 검색으로 확장됩니다. 이렇게 하는 이유는 LLM이나 사용자가 `guide`, `knowledge`, `components` 같은 범위를 잘못 선택해도 검색 결과를 놓치지 않기 위해서입니다.

정확히 특정 소스만 검색해야 할 때는 `strictScope: true`를 지정합니다.

```json
{
  "query": "MyBatis 설정 방법",
  "scope": "guide",
  "strictScope": true,
  "limit": 10
}
```

예외:

- `action`이 있는 조회는 명시적 요청으로 보고 해당 scope만 사용합니다.
- `componentId`, `frameworkVersion`처럼 특정 소스를 가리키는 필터가 있으면 자동 추론이 우선합니다.

---

## 적절한 프롬프트 예시

사용자는 반드시 `scope`를 정확히 지정할 필요가 없습니다. 자연어 프롬프트에서는 “공식 문서, 지식 베이스, 공통컴포넌트까지 함께 찾아달라”처럼 검색 범위를 넓게 요청하는 편이 안전합니다.

### 일반 지식 검색

아래와 같은 프롬프트는 `scope: "all"` 또는 `scope: "auto"`에 적합합니다.

```text
표준프레임워크에서 MyBatis 설정 방법을 찾아줘. 공식 가이드와 기존 지식이 있으면 함께 비교해서 알려줘.
```

```text
Spring Boot 기반 eGovFrame에서 Transaction 설정은 어떻게 하는지 관련 문서와 예시를 찾아줘.
```

```text
파일 업로드 기능을 구현하려고 하는데 참고할 공통컴포넌트, 공식 문서, 주의사항을 같이 찾아줘.
```

권장 tool 호출:

```json
{
  "query": "MyBatis 설정 방법",
  "scope": "auto",
  "limit": 10
}
```

또는:

```json
{
  "query": "파일 업로드 기능 공통컴포넌트 공식 문서 주의사항",
  "scope": "all",
  "limit": 10
}
```

### 공식 문서만 근거로 확인

공식 Developer Guide만 확인해야 하는 경우에는 `strictScope: true`를 함께 사용합니다.

```text
공식 eGovFrame Developer Guide 기준으로만 MyBatis 설정 방법을 찾아줘. 개인 지식이나 공통컴포넌트 검색 결과는 제외해줘.
```

권장 tool 호출:

```json
{
  "query": "MyBatis 설정 방법",
  "scope": "guide",
  "strictScope": true,
  "limit": 10
}
```

### 개인 지식 베이스 우선 검색

과거에 저장한 해결 사례나 팀 내부 노하우를 찾고 싶을 때 사용합니다.

```text
전에 저장해 둔 트랜잭션 설정 오류 해결 사례를 찾아줘. 검증된 error-fix 위주로 보여줘.
```

권장 tool 호출:

```json
{
  "query": "트랜잭션 설정 오류",
  "scope": "knowledge",
  "filters": {
    "type": "error-fix",
    "verifiedOnly": true
  },
  "limit": 5
}
```

### 공통컴포넌트 탐색

컴포넌트 ID를 모를 때는 자연어 검색부터 시작합니다.

```text
게시판 기능을 구현할 때 참고할 수 있는 공통컴포넌트를 찾아줘. 관련 컴포넌트와 패키지명을 알려줘.
```

권장 tool 호출:

```json
{
  "query": "게시판",
  "scope": "components",
  "limit": 10
}
```

컴포넌트 ID를 알고 있을 때는 상세 조회를 사용합니다.

```text
bbs 공통컴포넌트의 구조, 의존성, 사용하는 테이블을 알려줘.
```

권장 tool 호출:

```json
{
  "scope": "components",
  "action": "get",
  "filters": {
    "componentId": "bbs"
  }
}
```

### 공통컴포넌트 소스/DDL/DML 조회

소스 파일 목록을 먼저 확인한 뒤 필요한 파일을 읽는 흐름이 좋습니다.

```text
bbs 공통컴포넌트에 포함된 Java, Mapper XML, JSP 파일 목록을 보여줘.
```

권장 tool 호출:

```json
{
  "scope": "components",
  "action": "sourceFiles",
  "filters": {
    "componentId": "bbs"
  }
}
```

DDL 조회:

```text
bbs 공통컴포넌트에서 필요한 MySQL 테이블 생성 DDL을 추출해줘.
```

권장 tool 호출:

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

DML 조회:

```text
bbs 공통컴포넌트 초기 데이터 INSERT 문을 MySQL 기준으로 보여줘.
```

권장 tool 호출:

```json
{
  "scope": "components",
  "action": "dml",
  "filters": {
    "componentId": "bbs",
    "dbType": "mysql"
  }
}
```

### 호환 소프트웨어 검색

eGovFrame 버전별 호환 솔루션을 확인할 때 사용합니다.

```text
eGovFrame 4.3에서 사용할 수 있는 CMS Solution을 찾아줘. 관련 지식이 있으면 같이 보여줘.
```

권장 tool 호출:

```json
{
  "scope": "compatibility",
  "filters": {
    "frameworkVersion": "4.3",
    "category": "CMS Solution",
    "includeKnowledge": true
  }
}
```

### 피해야 할 프롬프트

아래처럼 검색 대상을 지나치게 좁히면 관련 결과를 놓칠 수 있습니다.

```text
knowledge에서만 MyBatis 설정 방법을 찾아줘.
```

더 나은 프롬프트:

```text
MyBatis 설정 방법을 찾아줘. 공식 가이드, 저장된 지식, 관련 공통컴포넌트가 있으면 함께 알려줘.
```

아래처럼 tool 이름을 직접 지정하는 방식도 권장하지 않습니다.

```text
search_guide로 MyBatis 설정을 검색해줘.
```

더 나은 프롬프트:

```text
egov_search_knowledge로 MyBatis 설정 방법을 검색해줘. 특정 소스에 한정하지 말고 관련 자료를 함께 찾아줘.
```

---

## Scope별 사용법

### 1. 공식 문서 검색: `guide`

eGovFrame 공식 Developer Guide를 의미 기반으로 검색합니다.

```json
{
  "scope": "guide",
  "query": "MyBatis 설정 방법",
  "filters": {
    "layer": "egovframe-runtime",
    "category": "persistence-layer"
  },
  "limit": 5
}
```

지원 필터:

| 필터 | 타입 | 설명 |
|------|------|------|
| `layer` | string | 문서 레이어. 예: `egovframe-runtime`, `egovframe-development`, `common-component`, `runtime-example` |
| `category` | string | 하위 카테고리. 예: `persistence-layer`, `presentation-layer`, `batch-layer`, `security` |
| `limit` | number | 최대 결과 수 |

---

### 2. 개인 지식 검색: `knowledge`

개인 지식 베이스를 검색합니다.

```json
{
  "scope": "knowledge",
  "query": "트랜잭션 설정 오류",
  "filters": {
    "type": "error-fix",
    "tags": ["spring", "transaction"],
    "verifiedOnly": true
  },
  "limit": 5
}
```

지원 필터:

| 필터 | 타입 | 설명 |
|------|------|------|
| `knowledgeScope` | string | 내부 지식 검색 범위. `all`이면 지식+호환성 통합 검색 |
| `sort` | string | `relevance`, `recent` |
| `type` | string | `solution`, `tip`, `pattern`, `error-fix`, `best-practice`, `gotcha` |
| `tags` | string[] | 태그 필터 |
| `minImportance` | number | 최소 중요도. `1`~`5` |
| `verifiedOnly` | boolean | 검증된 지식만 조회 |

---

### 3. 공통컴포넌트 조회: `components`

공통컴포넌트 목록, 상세 정보, 의존성, 소스, DDL, DML을 조회합니다.

목록/검색:

```json
{
  "scope": "components",
  "query": "게시판",
  "limit": 10
}
```

카테고리/통계 개요:

```json
{
  "scope": "components"
}
```

필터 기반 목록:

```json
{
  "scope": "components",
  "filters": {
    "categoryId": "게시판",
    "hasWeb": true,
    "version": "4.3.1"
  }
}
```

상세 조회:

```json
{
  "scope": "components",
  "action": "get",
  "filters": {
    "componentId": "bbs"
  }
}
```

의존성 조회:

```json
{
  "scope": "components",
  "action": "dependencies",
  "filters": {
    "componentIds": ["bbs", "cmy"]
  }
}
```

소스 파일 목록:

```json
{
  "scope": "components",
  "action": "sourceFiles",
  "filters": {
    "componentId": "bbs"
  }
}
```

소스 파일 읽기:

```json
{
  "scope": "components",
  "action": "readSource",
  "filters": {
    "filePath": "src/main/java/egovframework/com/cop/bbs/web/EgovArticleController.java"
  }
}
```

DDL 조회:

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

DML 조회:

```json
{
  "scope": "components",
  "action": "dml",
  "filters": {
    "componentId": "bbs",
    "dbType": "mysql"
  }
}
```

지원 action:

| action | 설명 | 필수 필터 |
|--------|------|-----------|
| `get` 또는 `info` | 컴포넌트 상세 정보 조회 | `componentId` |
| `dependencies` | 선택 컴포넌트들의 전이 의존성 조회 | `componentIds` |
| `sourceFiles` | 컴포넌트 소스 파일 목록 조회 | `componentId` |
| `readSource` | 소스 파일 내용 조회 | `filePath` |
| `ddl` | 컴포넌트 필요 테이블 DDL 조회 | `componentId` |
| `dml` | 컴포넌트 초기 데이터 DML 조회 | `componentId` |

지원 필터:

| 필터 | 타입 | 설명 |
|------|------|------|
| `componentId` | string | 컴포넌트 ID 또는 패키지명 |
| `componentIds` | string[] | 의존성 조회 대상 컴포넌트 ID 배열 |
| `component` | string | `componentId` 별칭 |
| `id` | string | `componentId` 별칭 |
| `categoryId` | string | 카테고리 필터 |
| `keyword` | string | 목록 조회용 검색어 |
| `hasWeb` | boolean | 웹 배포 가능 여부 |
| `version` | string | 컴포넌트 버전 |
| `filePath` | string | `common-components-src` 내부 상대 경로 |
| `dbType` | string | `mysql`, `maria`, `oracle`, `postgres`, `tibero`, `cubrid`, `altibase`, `goldilocks` |

---

### 4. 호환 소프트웨어 검색: `compatibility`

eGovFrame 버전별 호환 소프트웨어/솔루션을 검색합니다.

```json
{
  "scope": "compatibility",
  "filters": {
    "frameworkVersion": "4.3",
    "category": "CMS Solution",
    "minLevel": 1,
    "includeKnowledge": true
  }
}
```

지원 필터:

| 필터 | 타입 | 설명 |
|------|------|------|
| `frameworkVersion` | string | eGovFrame 버전. 예: `4.3`, `4.2`, `4.1` |
| `category` | string | 소프트웨어 카테고리 |
| `minLevel` | number | 최소 호환 레벨. `1` 또는 `2` |
| `vendor` | string | 벤더명 |
| `productName` | string | 제품명. 없으면 `query`를 제품명 검색어로 사용 |
| `includeKnowledge` | boolean | 관련 개발 지식 포함 여부 |

---

### 5. 통합 검색: `all`

공식 문서, 개인 지식, 공통컴포넌트, 호환 소프트웨어를 함께 검색합니다.

```json
{
  "scope": "all",
  "query": "파일 업로드 공통컴포넌트 보안 설정",
  "limit": 5
}
```

특징:

- `query`가 필수입니다.
- 각 하위 검색 중 일부가 실패해도 전체 검색은 계속 진행합니다.
- 실패한 섹션에는 오류 메시지를 표시합니다.

---

## 숨겨진 기존 Tools와 대체 호출

다음 tools는 외부 노출에서 제거되었고, 직접 호출도 차단됩니다. 모두 `egov_search_knowledge`를 통해 호출해야 합니다.

| 기존 Tool | 대체 호출 |
|-----------|-----------|
| `search_guide` | `egov_search_knowledge(scope: "guide")` |
| `search_knowledge` | `egov_search_knowledge(scope: "knowledge")` |
| `search_compatible_software` | `egov_search_knowledge(scope: "compatibility")` |
| `list_common_components` | `egov_search_knowledge(scope: "components")` |
| `get_component_info` | `egov_search_knowledge(scope: "components", action: "get")` |
| `search_common_components` | `egov_search_knowledge(scope: "components", query: "...")` |
| `resolve_component_dependencies` | `egov_search_knowledge(scope: "components", action: "dependencies")` |
| `get_component_source_files` | `egov_search_knowledge(scope: "components", action: "sourceFiles")` |
| `read_component_source` | `egov_search_knowledge(scope: "components", action: "readSource")` |
| `get_component_ddl` | `egov_search_knowledge(scope: "components", action: "ddl")` |
| `get_component_dml` | `egov_search_knowledge(scope: "components", action: "dml")` |

> 표준용어 관련 옛 도구(`search_standard_terms`, `get_standard_term`)와 `scope: "terms"` 는 대체 경로 없이 기능 자체가 제거되었습니다.

---

## 오류 조건

| 상황 | 오류 |
|------|------|
| `guide`, `knowledge`, `all` 검색에서 `query`가 없음 | `query is required ...` |
| `components`의 `dependencies` action에서 `componentIds`가 없거나 빈 배열 | `filters.componentIds is required ...` |
| `components`의 `sourceFiles` action에서 `componentId`가 없음 | `filters.componentId is required ...` |
| `components`의 `readSource` action에서 `filePath`가 없음 | `filters.filePath is required ...` |
| `components`의 `ddl`/`dml` action에서 `componentId`가 없음 | `filters.componentId is required ...` |
| 지원하지 않는 `scope` | `Unsupported egov_search_knowledge scope ...` |

---

## 설계 메모

- 이 tool은 읽기 전용입니다.
- 검색/조회 목적의 외부 tool 수를 줄이기 위한 facade 역할을 합니다.
- 기존 세부 기능의 handler와 내부 함수는 유지하지만 외부 노출과 직접 호출은 차단합니다.
- 현재 공개 MCP 인터페이스에서는 지식/레퍼런스 조회 전담 tool로 유지합니다.

