# `egov_search_knowledge` 도구 가이드

`egov_search_knowledge` 는 eGovFrame 개발에 필요한 참고 자료를 조회하는 통합 검색 도구입니다. 이 서버가 MCP 클라이언트에 노출하는 도구는 이것 하나이며, 공식 가이드 검색, 개발자 지식 검색, 공통컴포넌트 조회, 호환 소프트웨어 검색을 `scope` 와 `action` 파라미터로 골라 호출합니다.

> 구현 파일: `src/tools/egovSearchKnowledge.ts`  
> 등록 위치: `src/server.ts`  
> 쓰기 여부: 읽기 전용

---

## 목적

`egov_search_knowledge` 의 목적은 MCP 클라이언트가 조회 대상마다 다른 도구를 고르지 않아도 되게 하는 것입니다.

이 도구 하나로 다음 작업을 처리합니다.

- 공식 가이드(eGovFrame Developer Guide) 검색
- 개발자 지식(전자정부 표준프레임워크 포털의 묻고답하기·FAQ·적용가이드) 검색
- 공통컴포넌트 목록, 상세 정보, 의존성 조회
- 공통컴포넌트 소스 파일, DDL, DML 조회
- eGovFrame 버전별 호환 소프트웨어 검색
- 위 네 출처의 통합 검색

검색 대상은 서버와 함께 설치된 지식베이스입니다. 이 도구는 이미 있는 자료를 조회만 하며, 지식을 저장하거나 수정하지 않습니다.

---

## 입력 스키마

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `query` | string | - | 검색 질문 또는 키워드. `guide`, `knowledge`, `all` 에서는 필수(`knowledge` 의 `filters.sort: "recent"` 조회는 예외). `components`, `compatibility` 에서는 선택이며 키워드 검색에 쓰임 |
| `scope` | string | - | 검색 범위. `auto`(기본값), `guide`, `knowledge`, `components`, `compatibility`, `all` 가운데 하나 |
| `action` | string | - | `components` 범위의 세부 조회 동작. `get`, `info`, `dependencies`, `sourceFiles`, `readSource`, `ddl`, `dml` 가운데 하나 |
| `filters` | object | - | 범위별 필터와 구간 조회 키(`limit`, `offset`). 정의된 키만 허용 |
| `limit` | integer | - | 최대 결과 수. 1~200 의 정수. `filters.limit` 보다 우선 |
| `strictScope` | boolean | - | 효과 없음. 예전 호출과의 호환을 위해 받기만 함 |

기본 동작:

- `scope` 를 생략하거나 `auto` 로 지정하면 입력값을 보고 검색 범위를 추론합니다. 명시한 `scope` 는 항상 그대로 적용됩니다.
- 공백뿐인 `query` 와 빈 문자열 `action` 은 지정하지 않은 것으로 봅니다.
- `filters` 는 정의된 키만 받습니다. 정의되지 않은 키와 타입이 맞지 않는 값은 입력 검증 오류가 됩니다. 반면 정의되지 않은 최상위 파라미터는 오류 없이 버려집니다.
- `limit` 을 생략하면 범위별 기본값을 씁니다. 규칙은 아래 "limit 과 offset" 절에 있습니다.
- 정확한 JSON Schema 는 `tools/list` 응답의 `inputSchema` 에서 확인할 수 있습니다.

---

## Scope

| scope | 검색 대상 | 검색 방식 | 주요 내부 함수 |
|-------|-----------|-----------|----------------|
| `auto` | 입력값으로 추론한 범위 | 추론한 범위의 방식을 따름 | `inferScope()` |
| `guide` | 공식 가이드 | 의미 검색 | `searchGuide()` |
| `knowledge` | 개발자 지식 | 의미 검색 | `searchDeveloperKnowledge()` |
| `components` | 공통컴포넌트 | 키워드 검색, 목록, 상세 정보, `action` 조회 | `searchComponentsGateway()` |
| `compatibility` | 호환 소프트웨어 | 키워드 검색, 필터 조회 | `searchCompatibility()` |
| `all` | 위 네 출처 | 출처별 검색을 한 번에 실행 | `searchAll()` |

의미 검색은 `query` 와 뜻이 가까운 문서를 찾으므로 문장으로 물어도 됩니다. 키워드 검색은 `query` 의 낱말이 들어 있는 항목을 찾으므로 문장보다 핵심 낱말 몇 개가 잘 맞습니다.

키워드 검색은 `components` 와 `compatibility` 에서 같은 규칙으로 동작합니다.

1. `query` 에서 낱말을 최대 16개까지 추출합니다. 낱말을 하나도 추출할 수 없는 `query`(예: `*`)는 지정하지 않은 것으로 봅니다.
2. `query` 의 모든 낱말이 항목에 있는 낱말의 앞부분과 일치하는 항목을 찾습니다. 예를 들어 `게시판` 은 `게시판에` 와도 일치합니다.
3. 2번에서 찾은 항목이 없으면 부분 일치 대체 검색을 합니다. 낱말의 절반 이상이 부분 문자열로 들어 있는 항목을 일치한 낱말이 많은 순으로 돌려줍니다. 한 글자짜리 낱말, 전체 항목의 절반 넘게 일치하는 낱말, 일치하는 항목이 하나도 없는 낱말은 세지 않습니다.

대체 검색으로 찾은 결과에는 표시가 붙습니다. `components` 는 제목 아래에 안내 줄을 넣고, `compatibility` 는 JSON 에 `"matchMode": "any-term"` 을 싣습니다. 2번에서 찾은 결과의 `matchMode` 는 `"all-terms"` 입니다.

---

## 자동 Scope 추론

`scope` 를 생략하거나 `auto` 로 지정하면 아래 표를 위에서부터 확인해 처음 맞는 규칙으로 범위를 정합니다.

| 순서 | 조건 | 추론 scope |
|------|------|------------|
| 1 | `action` 이 있음 | `components` |
| 2 | 공통컴포넌트 필터(`componentId`, `component`, `id`, `componentIds`, `filePath`, `dbType`, `table`, `categoryId`, `hasWeb`)가 있음 | `components` |
| 3 | 호환 소프트웨어 필터(`frameworkVersion`, `vendor`, `productName`, `minLevel`, `includeKnowledge`)가 있거나, `category` 값이 호환 소프트웨어의 분류 이름임 | `compatibility` |
| 4 | `layer` 가 있거나, `category` 값이 공식 가이드의 category 임 | `guide` |
| 5 | 개발자 지식 필터(`type`, `tags`, `minImportance`, `verifiedOnly`, `sort`)가 있음 | `knowledge` |
| 6 | 위 조건에 해당하지 않고 `query` 가 있음 | `all` |
| 7 | 위 조건에 해당하지 않고 `query` 도 없음 | `components` (카테고리 개요) |

`keyword`, `version`, `limit`, `offset`, `knowledgeScope` 는 추론에 쓰이지 않습니다. 값이 빈 문자열이거나 빈 배열인 필터도 지정하지 않은 것으로 봅니다.

---

## Scope 지정과 통합 검색

명시한 `scope` 는 그대로 적용됩니다. 예를 들어 아래 호출은 공식 가이드만 검색하며 다른 출처로 범위를 넓히지 않습니다.

```json
{
  "query": "MyBatis 설정 방법",
  "scope": "guide",
  "limit": 10
}
```

LLM 이나 사용자가 범위를 잘못 골라 결과를 놓치는 일을 피하려면 `scope` 를 생략합니다. 출처를 가리키는 필터와 `action` 이 없으면 `query` 만으로 네 출처를 모두 검색하는 통합 검색이 실행됩니다.

```json
{
  "query": "MyBatis 설정 방법"
}
```

참고 사항:

- `strictScope` 는 값을 주어도 결과가 달라지지 않습니다. 예전 호출과의 호환을 위해 스키마에만 남아 있습니다.
- `scope` 를 명시하면 다른 출처를 가리키는 필터가 있어도 명시한 범위를 검색합니다. 그 범위에서 쓰지 않는 필터는 무시되고 응답 끝에 안내가 붙습니다.
- `action` 은 `components` 범위에서만 지원합니다. 다른 `scope` 를 명시하고 `action` 을 주면 오류가 됩니다.

---

## limit 과 offset

`limit` 은 최상위 파라미터와 `filters.limit` 두 곳에 줄 수 있고, 둘 다 주면 최상위 값이 쓰입니다. 두 값 모두 1~200 의 정수여야 하며, 0, 음수, 소수, 201 이상은 입력 검증 오류가 됩니다.

| 조회 | 기본값 | 최댓값 |
|------|--------|--------|
| `guide` | 5 | 20 |
| `knowledge` | 5 | 20 |
| `components` 키워드 검색 | 20 | 200 |
| `components` 필터 목록(`query` 없이 목록 필터만 준 조회) | 조건에 맞는 전체 | 200 |
| `compatibility` | 20 | 100 |
| `all` | 출처마다 5 | 출처별 최댓값 |
| `components` 의 `action: "dml"` 에 `filters.table` 을 준 조회 | 100 | 100 |

- 범위별 최댓값을 넘는 `limit` 은 최댓값으로 줄여 적용하고, 응답 끝에 `> 요청한 limit 50 은(는) guide 범위의 최댓값 20 으로 줄여 적용했습니다.` 같은 안내를 붙입니다. `dml` 의 테이블 조회만 안내 없이 100건으로 맞춥니다.
- 카테고리 개요, 상세 정보, 의존성, 소스 파일 목록, `readSource`, `ddl`, 기본 보기의 `dml` 은 `limit` 을 쓰지 않습니다.

`filters.offset` 은 이어서 조회할 위치를 가리키는 0 이상의 정수이며, 다음 세 조회에서만 쓰입니다.

| 조회 | `filters.offset` 의 뜻 |
|------|------------------------|
| `compatibility` | 건너뛸 결과 수 |
| `components` 의 `action: "dml"` 에 `filters.table` 을 준 조회 | 건너뛸 INSERT 문 수 |
| `components` 의 `action: "readSource"` | 읽기 시작할 문자 위치 |

세 조회 모두 남은 내용이 있으면 다음 호출에 줄 `filters.offset` 값을 응답 끝에 알려 줍니다. 그 밖의 조회에서는 `filters.offset` 이 무시되며, 통합 검색도 여기에 해당합니다.

---

## 적용되지 않은 필터 안내

`filters` 에 정의된 키라도 선택된 `scope` 나 `action` 이 쓰지 않는 키는 조회에 적용되지 않습니다. 이때 응답 끝에 무시한 키를 알리는 줄이 붙습니다. 예를 들어 `scope: "guide"` 에 `filters.tags` 와 `filters.frameworkVersion` 을 함께 주면 다음 안내가 붙습니다.

```text
> 이 조회에 적용되지 않아 무시한 필터: tags, frameworkVersion.
```

이 안내가 보이면 결과가 그 필터로 걸러지지 않았다는 뜻이므로, 필터에 맞는 `scope` 로 다시 호출합니다.

---

## 적절한 프롬프트 예시

사용자가 `scope` 를 직접 지정할 필요는 없습니다. 자연어 프롬프트에서 찾으려는 자료의 종류를 밝히면 LLM 이 그에 맞는 호출을 만들 수 있습니다. 아래는 프롬프트와 그에 대응하는 권장 호출입니다.

### 통합 검색

여러 출처를 함께 보려면 출처를 한정하지 않고 요청합니다.

```text
웹에디터 기능을 붙이려고 하는데 참고할 공식 가이드, 포털 묻고답하기 사례, 공통컴포넌트, 호환 소프트웨어를 같이 찾아줘.
```

권장 도구 호출:

```json
{
  "query": "웹에디터",
  "limit": 3
}
```

통합 검색은 공통컴포넌트와 호환 소프트웨어를 키워드로 찾습니다. 두 출처의 결과까지 원하면 `query` 를 문장 대신 핵심 낱말로 줍니다.

### 공식 가이드만 확인

공식 가이드만 근거로 삼아야 할 때는 `scope: "guide"` 를 지정합니다.

```text
공식 가이드 기준으로만 배치 Job 설정 방법을 찾아줘. 포털 묻고답하기나 공통컴포넌트 검색 결과는 제외해줘.
```

권장 도구 호출:

```json
{
  "query": "배치 Job 설정 방법",
  "scope": "guide",
  "limit": 5
}
```

### 개발자 지식 검색

포털의 묻고답하기와 FAQ 에서 비슷한 사례를 찾을 때 사용합니다.

```text
트랜잭션 설정 오류와 비슷한 포털 묻고답하기 사례를 찾아줘.
```

권장 도구 호출:

```json
{
  "query": "트랜잭션 설정 오류",
  "scope": "knowledge",
  "limit": 5
}
```

### 공통컴포넌트 탐색

컴포넌트 ID 를 모를 때는 키워드 검색부터 시작합니다. 검색 결과 표의 첫 열이 이후 조회에 쓰는 컴포넌트 ID 입니다.

```text
게시판 기능을 구현할 때 참고할 수 있는 공통컴포넌트를 찾아줘. 컴포넌트 ID 와 패키지명을 알려줘.
```

권장 도구 호출:

```json
{
  "query": "게시판",
  "scope": "components",
  "limit": 10
}
```

컴포넌트 ID 를 알면 상세 정보를 조회합니다.

```text
bbs 공통컴포넌트의 설명, 의존성, 사용하는 테이블을 알려줘.
```

권장 도구 호출:

```json
{
  "scope": "components",
  "action": "get",
  "filters": {
    "componentId": "bbs"
  }
}
```

### 공통컴포넌트 소스, DDL, DML 조회

소스 파일 목록을 먼저 확인한 뒤 필요한 파일을 읽습니다.

```text
bbs 공통컴포넌트에 포함된 Java, Mapper XML, JSP 파일 목록을 보여줘.
```

권장 도구 호출:

```json
{
  "scope": "components",
  "action": "sourceFiles",
  "filters": {
    "componentId": "bbs"
  }
}
```

목록에 나온 경로를 `filters.filePath` 에 그대로 넣어 파일을 읽습니다.

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

```text
bbs 공통컴포넌트에 필요한 MySQL 테이블 생성 DDL 을 보여줘.
```

권장 도구 호출:

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
bbs 공통컴포넌트의 초기 데이터 INSERT 문을 MySQL 기준으로 보여줘.
```

권장 도구 호출:

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

eGovFrame 버전별 호환 소프트웨어를 확인할 때 사용합니다.

```text
eGovFrame 4.3 에서 사용할 수 있는 CMS Solution 을 찾아줘.
```

권장 도구 호출:

```json
{
  "scope": "compatibility",
  "filters": {
    "frameworkVersion": "4.3",
    "category": "CMS Solution"
  }
}
```

### 피해야 할 프롬프트

아래처럼 검색 대상을 한 출처로 좁히면 다른 출처에 있는 자료는 결과에 나오지 않습니다. 명시한 `scope` 가 그대로 적용되기 때문입니다.

```text
knowledge에서만 MyBatis 설정 방법을 찾아줘.
```

더 나은 프롬프트:

```text
MyBatis 설정 방법을 찾아줘. 공식 가이드, 포털 묻고답하기 사례, 관련 공통컴포넌트가 있으면 함께 알려줘.
```

등록되지 않은 예전 도구 이름을 지정하는 프롬프트도 피합니다.

```text
search_guide로 MyBatis 설정을 검색해줘.
```

더 나은 프롬프트:

```text
egov_search_knowledge로 MyBatis 설정 방법을 검색해줘. 특정 출처에 한정하지 말고 관련 자료를 함께 찾아줘.
```

---

## Scope 별 사용법

### 1. 공식 가이드 검색: `guide`

공식 가이드를 의미 검색합니다. `query` 가 필수입니다. 아래 호출은 실행환경(`egovframe-runtime`)의 `persistence-layer` 문서 안에서만 찾습니다.

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
| `layer` | string | 공식 가이드의 최상위 영역. 동봉된 공식 가이드의 주요 값은 `egovframe-runtime`, `egovframe-development`, `common-component` |
| `category` | string | `layer` 아래의 하위 영역. 예: `persistence-layer`, `presentation-layer`, `batch-layer`, `security` |

- 두 필터는 대소문자와 앞뒤 공백을 가리지 않습니다.
- 인덱스에 없는 값을 주면 `알 수 없는 layer 값입니다: "runtime". 사용할 수 있는 값: ...` 처럼 쓸 수 있는 값을 나열한 오류가 돌아옵니다. `layer` 를 함께 주면 `category` 는 그 `layer` 에 속한 값에서만 찾습니다.
- 필터를 주면 조건에 맞는 문서 안에서 `limit` 건을 채웁니다.

응답 형식:

```text
## eGovFrame 가이드 검색 결과 (N건)

### 1. <제목>
- **문서**: <문서 제목>
- **분류**: <layer> > <category>
- **소스**: <공식 가이드 원문의 상대 경로>
- **URL**: <문서 주소>
- **유사도**: <코사인 유사도, 소수 넷째 자리>

<본문>
```

- 결과 사이는 `---` 로 구분됩니다.
- `URL` 은 `https://egovframework.github.io/egovframe-docs` 아래의 주소이며, 주소가 없는 문서에는 이 줄이 없습니다.
- 본문은 1,500자를 넘으면 잘리고 끝에 `... (truncated)` 가 붙습니다.

---

### 2. 개발자 지식 검색: `knowledge`

개발자 지식을 의미 검색합니다. 개발자 지식은 전자정부 표준프레임워크 포털의 묻고답하기, FAQ, 적용가이드 PDF 를 인덱싱한 자료입니다. 아래 호출은 FAQ 안에서만 찾습니다.

```json
{
  "scope": "knowledge",
  "query": "DB 연결 종료 문제",
  "filters": {
    "tags": ["faq"]
  },
  "limit": 5
}
```

지원 필터:

| 필터 | 타입 | 설명 |
|------|------|------|
| `type` | string | 지식 유형. `solution`, `tip`, `pattern`, `error-fix`, `best-practice`, `gotcha` 가운데 하나. 동봉 데이터에는 `solution`(묻고답하기, FAQ)과 `best-practice`(적용가이드)만 있음 |
| `tags` | string[] | 태그 가운데 하나라도 가진 항목만 조회. 대소문자까지 일치해야 함. 동봉 데이터에서 출처를 가르는 태그는 `qa`, `faq`, `guide`, `pdf` |
| `minImportance` | integer | 최소 중요도(1~5). 동봉 데이터는 묻고답하기 3, FAQ 4, 적용가이드 5 |
| `verifiedOnly` | boolean | 검증된 항목만 조회. 동봉 데이터는 모두 검증된 항목 |
| `sort` | string | `relevance`(기본값, 의미 검색) 또는 `recent`(최근에 인덱싱된 순서의 목록) |
| `knowledgeScope` | string | `knowledge`(기본값) 또는 `all`(호환 소프트웨어를 함께 조회) |

`sort: "recent"` 는 `query` 없이 호출할 수 있고, `query` 를 주어도 쓰지 않습니다.

```json
{
  "scope": "knowledge",
  "filters": {
    "sort": "recent",
    "tags": ["faq"]
  },
  "limit": 3
}
```

응답은 `## 개발자 지식 검색 결과` 제목 아래의 JSON 코드 블록이며, 조회 방식에 따라 필드가 다릅니다.

| 조회 방식 | 최상위 필드 | 결과 항목의 필드 |
|-----------|-------------|------------------|
| 의미 검색(기본) | `success`, `query`, `options`, `resultCount`, `results` | `id`, `type`, `title`, `content`, `context`, `tags`, `importance`, `similarity` |
| `sort: "recent"` | `success`, `sort`, `count`, `results` | `id`, `type`, `title`, `tags`, `importance`, `createdAt` |
| `knowledgeScope: "all"` | `success`, `scope`, `query`, `totalResults`, `compatibility`, `knowledge` | `compatibility` 항목: `product`, `framework`, `category`, `level`, `vendor`, `description`. `knowledge` 항목: `title`, `type`, `content`, `tags`, `importance` |

- 의미 검색의 `content` 는 본문 전체이고, `similarity` 는 소수 셋째 자리로 반올림한 코사인 유사도입니다. `options` 에는 실제로 적용한 `limit` 과 필터가 담깁니다.
- 응답의 `query` 는 200자를 넘으면 앞 200자 뒤에 `…` 를 붙여 줄입니다.
- `sort: "recent"` 는 본문 없이 목록만 돌려주며, `type`, `tags`, `minImportance`, `verifiedOnly` 필터를 적용합니다. `createdAt` 은 글을 쓴 날짜가 아니라 인덱싱한 시각입니다.
- `knowledgeScope: "all"` 은 `query` 의 모든 낱말과 일치하는 호환 소프트웨어를 `compatibility` 에 함께 싣습니다. 이때는 부분 일치 대체 검색을 하지 않습니다. `knowledge` 의 `content` 는 200자 이내의 미리보기이고, 개발자 지식 필터는 `knowledge` 에만 적용됩니다.
- 결과가 없으면 `"resultCount": 0` 과 빈 `results` 가 돌아옵니다.

---

### 3. 공통컴포넌트 조회: `components`

공통컴포넌트의 목록, 상세 정보, 의존성, 소스 파일, DDL, DML 을 조회합니다. `action` 이 없으면 함께 준 값에 따라 조회 방식이 정해지며, 여러 값을 함께 주면 아래 표에서 위에 있는 행이 우선합니다.

| 준 값 | 조회 방식 | 응답 제목 |
|-------|-----------|-----------|
| `filters.componentId` | 상세 정보(`action: "get"` 과 같음) | `## <컴포넌트 이름>` |
| `query` | 키워드 검색. 목록 필터를 함께 주면 모두 적용 | `## 공통컴포넌트 목록 (N개)` |
| 목록 필터(`categoryId`, `keyword`, `hasWeb`, `version`)만 | 카테고리별로 묶은 목록 | `## 공통컴포넌트 목록 (N개)` |
| 없음 | 카테고리 개요와 통계 | `## eGovFrame 공통컴포넌트 카테고리`, `## eGovFrame 공통컴포넌트 통계` |

카테고리 개요:

```json
{
  "scope": "components"
}
```

필터 목록:

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

목록 응답의 형식은 다음과 같습니다.

- 키워드 검색 결과는 `컴포넌트 ID`, `컴포넌트`, `카테고리`, `패키지명`, `버전` 열의 표입니다. 일치하는 컴포넌트가 `limit` 보다 많으면 제목이 `## 공통컴포넌트 목록 (N개 중 M개 표시)` 가 됩니다.
- 필터 목록은 카테고리마다 `### <카테고리> (N개)` 제목과 `컴포넌트 ID`, `컴포넌트`, `패키지명`, `설명` 열의 표로 나옵니다. `limit` 을 주지 않으면 조건에 맞는 컴포넌트를 모두 보여 줍니다.
- 카테고리 개요는 `#`, `카테고리`, `카테고리 ID`, `영문명`, `컴포넌트 수` 열의 표입니다. `categoryId` 필터에는 이 표의 카테고리 ID, 카테고리, 영문명 가운데 어느 값이든 쓸 수 있습니다.
- 부분 일치 대체 검색으로 찾은 결과에는 제목 아래에 `> 낱말 접두 일치로는 찾지 못해 부분 일치로 찾은 결과입니다 (일부 검색어만 일치하는 항목이 포함될 수 있습니다).` 안내가 붙습니다.
- 결과가 없으면 `## 공통컴포넌트 목록 (0개)` 아래에 `검색 결과가 없습니다.` 가 나옵니다.

#### 컴포넌트 지정

`filters.componentId` 에는 컴포넌트 ID(`uia`), 패키지명(`egovframework.com.uat.uia`), 정확한 컴포넌트 이름(`일반로그인`, `General Login`) 가운데 하나를 넣습니다. 대소문자와 앞뒤 공백은 가리지 않으며, 이름은 같은 이름의 컴포넌트가 하나뿐일 때만 쓸 수 있습니다. `filters.component` 와 `filters.id` 는 `componentId` 의 별칭입니다.

컴포넌트 ID 는 목록과 검색 결과 표의 첫 열에 나옵니다. 대부분 패키지명의 마지막 마디와 같지만 그렇지 않은 컴포넌트가 있습니다. 예를 들어 `egovframework.com.utl.sim`(시스템정보확인)의 ID 는 `utl-sim` 이고, `sim` 은 `egovframework.com.cop.smt.sim`(일정관리)의 ID 입니다. 게시판(`bbs`)과 블로그관리(`blog-management`)는 패키지 `egovframework.com.cop.bbs` 를 함께 쓰며, 이 패키지명으로 지정하면 게시판이 선택됩니다.

컴포넌트를 찾지 못하면 오류가 아닌 일반 응답으로 안내 문구가 돌아옵니다. 같은 입력으로 키워드 검색한 후보가 있으면 5개까지 컴포넌트 ID, 이름, 패키지명을 함께 나열합니다. 예를 들어 `componentId` 에 `로그인` 을 주면 다음과 같이 응답합니다.

```text
컴포넌트를 찾을 수 없습니다: 로그인

비슷한 컴포넌트 (`filters.componentId` 에는 아래의 컴포넌트 ID 를 넣습니다):
- `uap` 로그인정책관리 (egovframework.com.uat.uap)
- `lsi` 로그인화면이미지관리 (egovframework.com.uss.ion.lsi)
- `rsc` 로그인세션정보체크 (egovframework.com.utl.sys.rsc)
- `oauth` 소셜 인증 기반 로그인 기능 (egovframework.com.ext.oauth)
- `slm` 중복로그인 방지 (egovframework.com.utl.slm)
```

#### action

| action | 쓰는 필터 | 응답 |
|--------|-----------|------|
| `get`, `info` | `componentId`(필수) | `## <컴포넌트 이름>` 아래에 기본 정보(ID, 영문명, 카테고리, 패키지명, 버전, 웹 배포), 설명, 사용 테이블, 의존성 |
| `dependencies` | `componentIds` 또는 `componentId`(둘 중 하나 필수) | `## 의존성 해결 결과` 아래에 요청한 컴포넌트, 자동 추가된 의존성, 전체 필요 컴포넌트, 필요 패키지 목록 |
| `sourceFiles` | `componentId`(필수) | `## <컴포넌트 이름> 소스 파일 목록` 아래에 패키지, 총 파일 수, 종류별 파일 경로 |
| `readSource` | `filePath`(필수), `offset` | 파일 정보 한 줄과 내용을 담은 코드 블록 |
| `ddl` | `componentId`(필수), `dbType` | `## <컴포넌트 이름> DDL (<dbType>)` 아래에 요약과 CREATE TABLE, 인덱스, 뷰 문 |
| `dml` | `componentId`(필수), `dbType`, `table`, `limit`, `offset` | `## <컴포넌트 이름> 초기 데이터 (<dbType>)` 아래에 요약과 INSERT 문 |

`get`, `sourceFiles`, `readSource`, `ddl`, `dml` 의 기본 호출은 위 "적절한 프롬프트 예시"에 있습니다. 의존성은 다음과 같이 조회합니다.

```json
{
  "scope": "components",
  "action": "dependencies",
  "filters": {
    "componentIds": ["bbs", "cmy"]
  }
}
```

- `dependencies` 는 의존하는 컴포넌트를 끝까지 따라가 필요한 컴포넌트 전체를 구합니다. 입력은 컴포넌트 ID 와 패키지명만 받습니다. 해석하지 못한 입력은 `### 찾을 수 없는 입력 (N개)` 에, 의존 대상이지만 컴포넌트 정보가 없는 패키지는 `### 컴포넌트 정보가 없는 의존 패키지 (N개)` 에 따로 나옵니다.
- `sourceFiles` 는 파일을 Java 소스, MyBatis Mapper XML, JSP 뷰, CSS 스타일, Spring 설정, 메시지 리소스, 이미지로 나눠 보여 주고, 끝에 `readSource` 호출 방법을 안내합니다.
- `ddl` 은 스크립트에서 정의를 찾지 못한 테이블이나 뷰가 있으면 `- DDL 을 찾지 못한 객체: <이름>` 줄로 알려 줍니다.

#### 소스 파일 읽기: `readSource`

`filters.filePath` 에는 공통컴포넌트 소스 루트를 기준으로 한 상대 경로를 넣습니다. `sourceFiles` 가 알려 주는 경로가 이 형식입니다. 응답 첫 줄은 파일 경로, 바이트 수, 코드 블록 언어이고 그 아래에 내용이 코드 블록으로 나옵니다.

```text
**파일**: `<경로>` (<바이트 수> bytes, <언어>)
```

한 번에 60,000자까지 돌려줍니다. 남은 내용이 있으면 응답 끝에 다음 안내가 붙습니다.

```text
> 전체 N자 중 1~60,000자를 표시했습니다. 이어서 읽으려면 같은 호출에 `filters.offset: 60000` 을 주세요.
```

안내된 값을 `filters.offset` 에 주어 이어서 읽습니다. 아래는 60,000자가 넘는 통합 DDL 스크립트의 두 번째 구간을 읽는 호출입니다.

```json
{
  "scope": "components",
  "action": "readSource",
  "filters": {
    "filePath": "script/ddl/mysql/com_DDL_mysql.sql",
    "offset": 60000
  }
}
```

- EUC-KR 로 저장된 텍스트 파일도 읽을 수 있으며, 이때는 첫 줄의 언어 뒤에 `, EUC-KR` 이 붙습니다.
- 이미지 같은 바이너리 파일은 내용 대신 `[바이너리 파일 - UTF-8 텍스트가 아니어서 내용을 표시하지 않습니다]` 를 돌려줍니다.
- 절대 경로, 소스 루트 밖의 경로, `.git` 아래의 경로, 없는 파일은 `파일을 찾을 수 없거나 접근할 수 없습니다: <경로>` 로 응답합니다. 이 응답은 오류로 표시되지 않습니다.

#### DDL 과 DML: `ddl`, `dml`

`filters.dbType` 으로 DB 종류를 고릅니다. 지원하는 값은 `mysql`(기본값), `maria`, `oracle`, `postgres`, `tibero`, `cubrid`, `altibase`, `goldilocks` 이고, 별칭 `mariadb`, `postgresql`, `pgsql` 도 받습니다. 대소문자는 가리지 않으며, 그 밖의 값은 오류가 됩니다.

`dml` 의 기본 보기는 테이블마다 처음 20건만 싣습니다. 응답에는 `- **INSERT 문**: 전체 N건 중 M건 표시 (테이블마다 처음 20건)` 형태의 요약, `테이블`, `전체`, `표시`, `생략` 열의 표, 초기 데이터가 없는 테이블 목록, SQL 코드 블록이 차례로 나옵니다. 생략된 INSERT 문이 있으면 `filters.table` 로 조회하는 방법을 응답 끝에 안내합니다.

한 테이블의 INSERT 문을 모두 보려면 `filters.table` 을 주고 `limit`(기본값과 최댓값 100)과 `filters.offset` 으로 구간을 나눠 조회합니다.

```json
{
  "scope": "components",
  "action": "dml",
  "filters": {
    "componentId": "bbs",
    "dbType": "mysql",
    "table": "COMTCCMMNDETAILCODE",
    "offset": 100
  },
  "limit": 100
}
```

이 응답에는 `- **INSERT 문**: 총 N건 중 101~200` 형태로 구간이 표시되고, 남은 INSERT 문이 있으면 다음 안내가 붙습니다.

```text
> 남은 K건은 같은 호출에 `filters.offset: 200` 을 주어 이어서 조회할 수 있습니다.
```

`filters.table` 은 대소문자를 가리지 않습니다. 컴포넌트가 쓰지 않는 테이블을 주면 쓸 수 있는 테이블 이름을 나열한 오류가 돌아옵니다.

#### 지원 필터

| 필터 | 타입 | 설명 |
|------|------|------|
| `componentId` | string | 조회할 컴포넌트. 컴포넌트 ID, 패키지명, 정확한 컴포넌트 이름 가운데 하나 |
| `component`, `id` | string | `componentId` 의 별칭 |
| `componentIds` | string[] | `dependencies` 의 대상. 컴포넌트 ID 또는 패키지명의 배열 |
| `filePath` | string | `readSource` 로 읽을 파일. 소스 루트 기준 상대 경로 |
| `dbType` | string | `ddl`, `dml` 의 DB 종류. 기본값 `mysql` |
| `table` | string | `dml` 에서 INSERT 문을 조회할 테이블 하나 |
| `categoryId` | string | 목록과 키워드 검색을 한 카테고리로 한정. 카테고리 ID, 국문 이름, 영문 이름 가운데 하나 |
| `keyword` | string | 목록과 키워드 검색에 적용하는 부분 문자열 필터. 이름, 영문명, 설명, 패키지명에서 찾음 |
| `hasWeb` | boolean | 웹 화면 포함 여부(상세 정보의 "웹 배포")로 목록과 키워드 검색을 한정 |
| `version` | string | 컴포넌트 메타데이터의 버전으로 목록과 키워드 검색을 한정. 동봉 데이터의 값은 `4.3.1` 하나 |
| `limit`, `offset` | integer | 구간 조회. "limit 과 offset" 절 참고 |

---

### 4. 호환 소프트웨어 검색: `compatibility`

eGovFrame 버전별 호환 소프트웨어 목록을 조회합니다. `query` 없이 필터만으로 조회할 수 있고, `query` 를 주면 키워드 검색 결과에 필터를 함께 적용합니다. 아래 호출은 제품명에 `JEUS` 가 들어 있는 호환 소프트웨어와 그 제품을 언급하는 개발자 지식을 함께 조회합니다.

```json
{
  "scope": "compatibility",
  "filters": {
    "productName": "JEUS",
    "includeKnowledge": true
  }
}
```

지원 필터:

| 필터 | 타입 | 설명 |
|------|------|------|
| `frameworkVersion` | string | eGovFrame 버전. `"4.3"`, `"3.10"` 같은 문자열로 주며 `"v4.3"`, `"4.3.0"` 은 `"4.3"` 으로 맞춰 적용. 숫자 타입은 입력 검증 오류. 동봉 데이터의 버전은 2.7, 3.0, 3.1, 3.5~3.10, 4.0~4.3 |
| `category` | string | 소프트웨어 분류 이름. 대소문자를 가리지 않음. 예: `CMS Solution`, `Portal Solution`, `DBMS`, `WAS` |
| `vendor` | string | 업체명의 부분 문자열 |
| `productName` | string | 제품명 또는 제품 버전 표기의 부분 문자열. 예: `JEUS`, `JEUS 8.5` |
| `minLevel` | integer | 최소 호환 레벨. `1` 또는 `2` |
| `includeKnowledge` | boolean | `true` 이면 결과 제품을 언급하는 개발자 지식을 함께 조회 |
| `limit`, `offset` | integer | 구간 조회. "limit 과 offset" 절 참고 |

응답은 `## 호환 소프트웨어 검색 결과` 제목 아래의 JSON 코드 블록입니다.

| 필드 | 설명 |
|------|------|
| `success` | `true` |
| `total` | 조건에 맞는 전체 건수 |
| `count` | 이번 응답에 담긴 건수 |
| `limit`, `offset` | 실제로 적용한 값 |
| `filters` | 실제로 적용한 필터 |
| `matchMode` | 키워드 검색을 했을 때만 있음. `all-terms` 또는 `any-term` |
| `available` | 결과가 0건이고 `frameworkVersion` 이나 `category` 가 데이터에 없는 값일 때만 있음. 쓸 수 있는 값을 담은 `frameworkVersions`, `categories` 배열 |
| `software` | 결과 배열. 항목의 필드는 `product_name`, `product_version`, `framework_version`, `category`, `compatibility_level`, `vendor`, `verified_date`, `description`, `url` |
| `relatedKnowledge` | `includeKnowledge` 가 `true` 이고 결과가 있을 때만 있음. 항목은 `product` 와 `knowledge` 배열(`id`, `title`, `type`, `importance`, `tags`) |
| `knowledgeWarning` | 관련 지식 조회가 실패했을 때만 있음. 이때도 `software` 는 그대로 돌려줌 |

- `query` 없는 조회는 확인일자(`verified_date`)가 최근인 순서로 정렬합니다. 확인일자가 날짜 형식이 아닌 항목은 맨 뒤에 놓입니다.
- `includeKnowledge` 는 결과의 앞에서부터 제품명 5개까지 찾아보고, 제목이나 본문에 제품명이 들어 있는 개발자 지식만 싣습니다. 이 조회에는 임베딩 모델이 필요합니다.

결과가 `limit` 보다 많으면 응답 끝에 다음 구간의 `filters.offset` 값을 알려 줍니다. 예를 들어 `limit` 을 주지 않았는데 결과가 20건보다 많으면 첫 응답은 다음 안내로 끝납니다.

```text
> 전체 N건 중 1~20번째 결과를 표시했습니다. 다음 구간은 같은 호출에 `filters.offset: 20` 을 주어 조회합니다.
```

안내된 값을 `filters.offset` 에 주어 다음 구간을 조회합니다. 아래는 위 "적절한 프롬프트 예시"의 호환 소프트웨어 호출에 이어 두 번째 구간을 조회하는 호출입니다.

```json
{
  "scope": "compatibility",
  "filters": {
    "frameworkVersion": "4.3",
    "category": "CMS Solution",
    "offset": 20
  }
}
```

---

### 5. 통합 검색: `all`

공식 가이드, 개발자 지식, 공통컴포넌트, 호환 소프트웨어를 한 번에 검색합니다. `scope` 를 생략하고 `query` 만 주어도 통합 검색이 실행됩니다.

```json
{
  "scope": "all",
  "query": "로그인",
  "filters": {
    "layer": "common-component",
    "tags": ["faq"]
  },
  "limit": 2
}
```

- `query` 가 필수입니다.
- 응답은 `# 통합 지식 검색 결과` 제목 아래에 네 출처의 섹션이 `---` 로 나뉘어 차례로 나옵니다. 섹션 제목과 형식은 각 `scope` 를 단독으로 호출했을 때와 같습니다(`## eGovFrame 가이드 검색 결과 (N건)`, `## 개발자 지식 검색 결과`, `## 공통컴포넌트 목록 (N개)`, `## 호환 소프트웨어 검색 결과`).
- `limit` 은 출처마다 따로 적용되며, 생략하면 출처마다 5건입니다.
- 필터는 그 필터를 쓰는 출처에만 적용됩니다. 위 호출에서 `layer` 는 공식 가이드에, `tags` 는 개발자 지식에만 적용됩니다. `category` 는 값이 속한 출처에만 적용하고, 어느 출처의 값도 아니면 공식 가이드와 호환 소프트웨어 양쪽에 넘깁니다.
- `sort`, `knowledgeScope`, `offset` 은 통합 검색에서 쓰이지 않으며, 주면 무시한 필터로 안내됩니다. 호환 소프트웨어 섹션에 `filters.offset` 안내가 붙더라도 다음 구간은 `scope: "compatibility"` 로 조회합니다.
- 개발자 지식 섹션은 `id`, `similarity` 와 함께 `content` 를 600자 이내의 발췌로 싣습니다. 묻고답하기 본문은 질문과 답변의 앞부분이 함께 들어갑니다. 섹션 끝에는 다음 안내가 붙습니다.

```text
> 개발자 지식의 본문은 600자를 넘으면 발췌해서 싣습니다. 전체 본문은 같은 query 에 `scope: "knowledge"` 를 지정해 검색하면 볼 수 있습니다.
```

- 한 출처에서 오류가 나면 그 섹션만 `## 공식 가이드` 같은 출처 이름 아래에 `검색 중 오류가 발생했습니다: <원인>` 으로 나오고, 나머지 섹션은 그대로 나옵니다. 이때 응답 전체는 오류로 표시되지 않습니다.

---

## 통합된 예전 도구와 대체 호출

아래 이름의 도구는 등록되어 있지 않습니다. 예전 이름으로 호출하면 `MCP error -32602: Tool <이름> not found` 가 담긴 오류 결과가 돌아오므로, `egov_search_knowledge` 의 `scope` 와 `action` 으로 호출합니다.

| 예전 도구 | 대체 호출 |
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

> 표준용어 관련 예전 도구(`search_standard_terms`, `get_standard_term`)와 `scope: "terms"` 는 대체 경로 없이 기능 자체가 제거되었습니다.

---

## 오류 응답

오류는 JSON-RPC 오류가 아니라 `isError: true` 인 도구 결과로 돌아오며, 본문 텍스트에 원인이 담깁니다. 응답에는 스택 트레이스, 절대 경로, 내부 SQL 이 실리지 않습니다.

### 입력 검증 오류

입력 스키마에 맞지 않는 호출은 도구가 실행되기 전에 거부됩니다. 본문은 `MCP error -32602: Input validation error: Invalid arguments for tool egov_search_knowledge: [...]` 형태이고, 배열 안의 `path` 가 어느 값이 틀렸는지 알려 줍니다.

| 상황 | `path` |
|------|--------|
| 지원하지 않는 `scope` (예: `terms`) | `["scope"]` |
| 지원하지 않는 `action` (예: `sourcefiles`. 대소문자를 구분함) | `["action"]` |
| `limit` 이 1~200 의 정수가 아님 | `["limit"]` |
| `filters` 에 정의되지 않은 키 | `["filters"]` |
| 필터 값의 타입이나 범위가 맞지 않음 (예: `"hasWeb": "true"`, `"frameworkVersion": 4.3`, `"minLevel": 3`) | `["filters", "<키>"]` |

### 실행 오류

| 상황 | 오류 문구 |
|------|-----------|
| `guide`, `knowledge`, `all` 검색에 `query` 가 없음 | `query is required for guide search` (`knowledge`, `all` 도 같은 형태) |
| `components` 가 아닌 `scope` 에 `action` 을 줌 | `action "ddl" is supported only for the components scope. Use scope "components" (or omit scope); received scope "guide".` |
| `get`, `info` 에 `componentId` 가 없음 | `filters.componentId is required for component detail lookup` |
| `dependencies` 에 `componentIds` 와 `componentId` 가 모두 없음 | `filters.componentIds (or filters.componentId) is required for component dependency resolution` |
| `sourceFiles` 에 `componentId` 가 없음 | `filters.componentId is required for component source file listing` |
| `readSource` 에 `filePath` 가 없음 | `filters.filePath is required for component source reading` |
| `ddl`, `dml` 에 `componentId` 가 없음 | `filters.componentId is required for component ddl lookup` (`dml` 은 `... dml lookup`) |
| 지원하지 않는 `dbType` | `지원하지 않는 DB 타입입니다: h2 (지원: mysql, maria, oracle, postgres, tibero, cubrid, altibase, goldilocks. 별칭: mariadb, postgresql, pgsql)` |
| `dml` 의 `table` 이 컴포넌트가 쓰는 테이블이 아님 | `'<table>' 은(는) 이 컴포넌트가 사용하는 테이블이 아닙니다. 사용 가능한 테이블: ...` |
| `guide` 의 `layer`, `category` 가 인덱스에 없는 값임 | `알 수 없는 layer 값입니다: "<값>". 사용할 수 있는 값: ...` (`category` 도 같은 형태) |

설치 상태가 원인인 오류는 조치 방법을 함께 알려 줍니다.

| 상황 | 오류 문구의 앞부분 |
|------|--------------------|
| 지식베이스 DB 가 없음 (`components`, `compatibility`, `knowledge`) | `지식베이스 DB(knowledge-base/egovframe.db)를 찾을 수 없습니다.` |
| 공식 가이드 또는 개발자 지식 인덱스가 없음 | `공식 가이드 인덱스(knowledge-base/egovframe_guide.lance)를 찾을 수 없습니다.` (개발자 지식은 `개발자 지식 인덱스(knowledge-base/developer_knowledge.lance)를 ...`) |
| 임베딩 모델이 없음 (의미 검색) | `임베딩 모델을 찾을 수 없습니다 (models/Xenova/multilingual-e5-small).` |
| 공통컴포넌트 소스가 없음 (`sourceFiles`, `readSource`, `ddl`, `dml`) | `공통컴포넌트 소스가 설치되어 있지 않습니다.` |
| Node.js 버전이나 플랫폼이 맞지 않아 SQLite 모듈을 불러오지 못함 (`components`, `compatibility`, `knowledge`) | `네이티브 모듈(better-sqlite3)을 불러오지 못했습니다.` |
| 그 밖의 내부 오류 | `내부 오류가 발생했습니다. 자세한 내용은 MCP 서버 로그(stderr)를 확인하세요.` |

### 오류로 표시되지 않는 응답

찾는 대상이 없는 경우는 오류가 아니라 일반 결과로 돌아옵니다.

| 상황 | 응답 |
|------|------|
| 없는 컴포넌트를 `componentId` 로 지정 | `컴포넌트를 찾을 수 없습니다: <입력>` 과 후보 목록 |
| `dependencies` 에 해석할 수 없는 입력 | 결과 안의 `### 찾을 수 없는 입력 (N개)` |
| `readSource` 로 읽을 수 없는 경로 | `파일을 찾을 수 없거나 접근할 수 없습니다: <경로>` |
| `components` 목록과 검색에 결과 없음 | `## 공통컴포넌트 목록 (0개)` 과 `검색 결과가 없습니다.` |
| `knowledge` 검색에 결과 없음 | `"resultCount": 0` |
| `compatibility` 검색에 결과 없음 | `"total": 0`, 값이 잘못된 필터가 있으면 `available` |
| 통합 검색의 한 출처에서 오류 | 해당 섹션의 `검색 중 오류가 발생했습니다: <원인>` |

---

## 설계 메모

- 이 도구는 읽기 전용입니다. `tools/list` 의 annotations 는 `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false` 입니다.
- 조회 기능을 도구 하나로 묶어 MCP 클라이언트에 노출하는 도구 수를 줄입니다. 새 조회 기능은 새 도구를 추가하기보다 `scope` 와 `action` 을 확장하는 방향으로 먼저 검토합니다.
- 출처별 조회 함수는 `src/tools/` 의 `commonComponents.ts`, `compatibility.ts`, `knowledge.ts` 와 `src/rag/guideManager.ts` 에 있고, `egovSearchKnowledge.ts` 가 `scope` 와 `action` 에 따라 호출합니다. 이 함수들은 개별 도구로 등록하지 않습니다.
- 서버는 지식베이스를 읽기 전용으로 열며, 인덱스나 DB 가 없어도 새로 만들지 않고 오류로 알립니다.
