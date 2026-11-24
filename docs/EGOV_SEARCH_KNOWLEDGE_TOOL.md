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

검색 대상은 서버와 함께 설치된 지식베이스입니다. `update` CLI(`egovframe-mcp-search update`)로 갱신분을 받았으면 공식 가이드, 개발자 지식, 공통컴포넌트 소스는 그 갱신분을 먼저 읽습니다. 이 도구는 이미 있는 자료를 조회만 하며, 지식을 저장하거나 수정하지 않습니다.

---

## 입력 스키마

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `query` | string | - | 검색 질문 또는 키워드. 최대 10,000자. `guide`, `knowledge`, `all` 에서는 필수(`knowledge` 의 `filters.sort: "recent"` 조회와 `guide` 의 `filters.chunkId` 조회는 예외). `components`, `compatibility` 에서는 선택이며 키워드 검색에 쓰임 |
| `scope` | string | - | 검색 범위. `auto`(기본값), `guide`, `knowledge`, `components`, `compatibility`, `all` 가운데 하나 |
| `action` | string | - | `components` 범위의 세부 조회 동작. `get`, `info`, `dependencies`, `sourceFiles`, `readSource`, `ddl`, `dml` 가운데 하나 |
| `filters` | object | - | 범위별 필터와 구간 조회 키(`limit`, `offset`). 정의된 키만 허용 |
| `limit` | integer | - | 최대 결과 수. 1~200 의 정수. `filters.limit` 보다 우선 |
| `strictScope` | boolean | - | 효과 없음. 예전 호출과의 호환을 위해 받기만 함 |

기본 동작:

- `scope` 를 생략하거나 `auto` 로 지정하면 입력값을 보고 검색 범위를 추론합니다. 명시한 `scope` 는 항상 그대로 적용됩니다.
- 값이 `null` 이거나 빈 문자열인 파라미터와 필터는 지정하지 않은 것으로 봅니다. `filters` 가 `null` 인 경우, 빈 배열, 빈 문자열만 든 배열(`"tags": [""]`)도 같습니다. 다만 `filters` 자체는 객체이거나 `null` 이어야 하며, `filters` 에 빈 문자열을 주면 입력 검증 오류가 됩니다.
- 글자나 숫자가 하나도 없는 `query`(공백뿐인 값, `???`, `-`, 이모지뿐인 값)는 지정하지 않은 것으로 봅니다.
- 문자열 입력(`query` 와 문자열 필터)은 유니코드 NFC 로 정규화하고, 줄바꿈과 탭을 포함한 제어 문자가 이어진 구간을 공백 하나로 바꾼 뒤 앞뒤 공백을 떼어 씁니다.
- 길이에는 상한이 있습니다. `query` 는 10,000자, 문자열 필터는 500자, `tags` 는 20개(각 100자), `componentIds` 는 50개까지이며, 넘으면 입력 검증 오류가 됩니다.
- `filters` 는 정의된 키만 받습니다. 정의되지 않은 키와 타입이 맞지 않는 값은 입력 검증 오류가 됩니다. 반면 정의되지 않은 최상위 파라미터는 오류 없이 버려지므로, 필터를 `filters` 밖에 적으면 적용되지 않습니다.
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

의미 검색은 `query` 와 뜻이 가까운 문서를 찾으므로 문장으로 물어도 됩니다. 키워드 검색은 `query` 의 낱말이 들어 있는 항목을 찾으므로 문장보다 핵심 낱말 몇 개가 잘 맞습니다. 키워드 검색의 규칙은 바로 아래 절에 있습니다.

---

## 키워드 검색

`components` 와 `compatibility` 의 `query` 는 키워드 검색입니다. 두 범위가 같은 규칙을 쓰고, 통합 검색의 공통컴포넌트 섹션과 호환 소프트웨어 섹션에도 같은 규칙이 적용됩니다.

### 검색어 읽기

- `query` 의 앞 2,000자만 읽습니다. 전각 영숫자와 전각 기호는 반각으로 바꿔 읽습니다.
- 문자와 숫자, 그리고 낱말 안쪽의 `.`, `-`, `_` 가 이어진 것이 낱말 하나입니다(`4.3`, `spring-boot`, `egovframework.com.cop.bbs`). 그 밖의 기호와 공백에서 낱말을 나눕니다.
- 따로 적은 `AND`, `OR`, `NOT`, `NEAR` 는 대소문자와 관계없이 검색어에서 뺍니다. 이 가운데 `OR` 만 찾는 방식을 바꾸며, 부정 검색과 근접 검색은 하지 않습니다.
- 대소문자만 다른 낱말은 한 번만 씁니다. 낱말을 하나도 읽을 수 없으면 `query` 를 지정하지 않은 것으로 봅니다.

### 일치 판정

- 검색어가 검색 컬럼 가운데 하나에 부분 문자열로 들어 있으면 그 항목과 일치합니다. ASCII 영문자의 대소문자는 가리지 않으며, 낱말의 가운데나 뒤쪽에 든 것도 일치합니다. 예를 들어 `코드` 는 `공통코드` 와 일치합니다.
- 검색 컬럼은 공통컴포넌트가 컴포넌트 ID, 이름, 영문명, 설명, 영문 설명, 패키지명이고, 호환 소프트웨어가 제품명, 제품 버전 표기, 업체명, 분류, 설명입니다. 이 가운데 공통컴포넌트의 컴포넌트 ID, 이름, 영문명과 호환 소프트웨어의 제품명, 제품 버전 표기를 아래에서 이름 컬럼이라고 부릅니다.
- 호환 소프트웨어의 프레임워크 버전과 확인일자는 부분 문자열로 견주지 않습니다. 프레임워크 버전은 검색어가 그 값과 같을 때만 일치하고(`v4.3`, `4.3.0` 은 `4.3` 으로 봅니다), 확인일자는 검색어가 `YYYY`, `YYYY-MM`, `YYYY-MM-DD` 꼴이고 확인일자가 그 값으로 시작할 때 일치합니다. 예를 들어 `2025` 는 2025년에 확인된 항목과 일치합니다.
- 필터를 함께 주면 필터를 적용한 대상 안에서 찾습니다.

### 검색에서 빼는 낱말

항목을 가려 주지 못하는 낱말은 검색어에서 빼고, 뺀 낱말을 응답에 알립니다.

- 영어 기능어: `a`, `the`, `is`, `are`, `with`, `for`, `in`, `of`, `to`, `what`, `how` 등 31개입니다. `query` 에 영어 기능어가 아닌 두 글자 이상의 낱말이 있을 때만 뺍니다. `Q&A` 의 `A` 처럼 다른 낱말과 `&`, `/`, `+` 로 이어 적은 낱말은 영어 기능어로 보지 않습니다.
- 목록의 모든 항목에 해당하는 낱말: `eGovFrame`, `egovframework`, `egov`, `전자정부`, `표준프레임워크`, `전자정부프레임워크`, `전자정부표준프레임워크` 이고, 공통컴포넌트에서는 `컴포넌트`, `공통컴포넌트`, `component`, `components` 도 해당합니다. 조사가 붙은 꼴(`eGovFrame에서`, `컴포넌트를`)도 같습니다. 영어 기능어도 이 낱말도 아닌 두 글자 이상의 낱말 가운데 일치하는 항목이 있는 것이 있을 때만 뺍니다. `query` 에 `OR` 가 있으면 이름 컬럼에 그 낱말이 든 항목이 있는 낱말은 빼지 않습니다.
- 한 글자 낱말: 한 글자 낱말까지 모두 일치하는 항목이 없을 때 뺍니다. `query` 에 `OR` 가 있을 때도 뺍니다. 낱말이 모두 한 글자이면 빼지 않습니다.

앞의 두 가지를 뺀 뒤 남은 낱말 가운데 앞의 16개만 검색에 씁니다. 그 뒤의 낱말은 검색에 쓰이지 않고 응답에도 표시되지 않습니다.

### 찾는 순서

1. 고른 검색어가 모두 일치하는 항목을 찾습니다. 찾으면 그 항목들이 결과입니다.
2. 그런 항목이 없으면 일부 검색어가 일치하는 항목을 찾습니다.
   - 일치하는 항목이 있는 검색어만 씁니다. 적힌 그대로는 일치하는 항목이 없는 검색어는 조사를 뗀 꼴(`JEUS는` 은 `JEUS`)로 견주고, 그래도 없으면 구분 기호의 자리를 유연하게 견줍니다. 유연하게 견줄 때는 검색어 안쪽의 `.`, `-`, `_` 자리에 공백이나 다른 기호 하나가 오거나 아무 글자도 오지 않은 표기와 일치합니다(`K2Web-Wizard` 는 `K2Web Wizard` 와, `sts_com` 은 `sts-com` 과 일치합니다). `8.5` 처럼 숫자 사이에 있는 구분 기호는 적힌 그대로 견줍니다.
   - 쓰는 검색어의 절반(올림) 이상이 일치한 항목을 돌려줍니다. 그런 항목이 없으면 가장 많은 검색어가 일치한 항목의 일치 수로 기준을 낮춥니다.
   - 쓰는 검색어 가운데 대상 항목의 절반 넘게 일치하는 흔한 검색어와 그렇지 않은 검색어가 섞여 있으면, 흔한 검색어만 일치한 항목은 돌려주지 않습니다.
3. `query` 에 `OR` 가 있으면 1번을 건너뛰고, 쓰는 검색어 가운데 하나 이상이 일치한 항목을 모두 돌려줍니다.

### 정렬

결과는 다음 기준을 차례로 적용해 정렬합니다.

1. 일치한 검색어가 많은 항목이 앞에 옵니다.
2. 검색에서 뺀 `eGovFrame` 같은 낱말이 이름 컬럼에 든 항목이 앞에 옵니다. 예를 들어 `eGov CMS` 는 `CMS` 가 든 항목을 모두 돌려주되 제품명에 `eGov` 가 든 제품이 맨 앞입니다.
3. 영문 검색어가 다른 낱말의 가운데에서만 일치한 항목은 뒤로 갑니다. 예를 들어 `ECM` 을 찾으면 분류가 `ECM Solution` 인 항목이 제품명 `TimeCMS` 의 가운데에서만 일치한 항목보다 앞에 옵니다.
4. 이름 컬럼에 일치한 검색어가 많은 항목이 앞에 옵니다. 같으면 이름 컬럼 안에서 3번의 기준을 한 번 더 적용합니다.
5. 나머지는 기본 정렬을 따릅니다. 공통컴포넌트는 이름이 짧은 순과 컴포넌트 ID 순이고, 호환 소프트웨어는 확인일자가 최근인 순입니다.

### 응답에 표시되는 내용

찾은 방식과 쓰지 않은 낱말은 응답에 표시됩니다. `compatibility` 는 JSON 필드로, `components` 는 안내 줄로 알립니다.

| 알리는 내용 | `compatibility` 의 JSON 필드 | `components` 의 안내 줄 |
|-------------|------------------------------|-------------------------|
| 찾은 방식 | `matchMode`. 모든 검색어가 일치한 결과는 `all-terms`, 일부 검색어가 일치한 결과는 `any-term` | 일부 검색어가 일치한 결과일 때 `> 모든 검색어가 들어 있는 항목이 없어, 검색어 N개 가운데 M개 이상이 들어 있는 항목을 표시합니다 (검색어: ...).` |
| `OR` 로 찾았는지 | `orQuery: true` | 위 안내의 앞부분이 `> query 에 OR 가 있어, ...` 로 바뀜 |
| 실제로 쓴 검색어와 일치 기준 | `usedTerms`, `requiredMatches` (`any-term` 일 때만) | 위 안내의 N, M 과 검색어 목록 |
| 일치하는 항목이 없어 쓰지 않은 검색어 | `ignoredTerms` | `> 일치하는 항목이 없어 검색에 쓰지 않은 낱말: ....` |
| 검색에서 뺀 낱말 | `droppedTerms` | `> 한 글자이거나, 영어 기능어이거나, 목록의 모든 항목에 해당해 검색에 쓰지 않은 낱말: ....` |
| 0건인 원인 | `totalWithoutQuery`. 키워드 검색이 0건인데 같은 필터만 적용하면 항목이 있을 때의 그 건수 | 필터를 준 검색이 0건인데 필터를 빼면 일치하는 컴포넌트가 있을 때 `> 필터(...)를 적용한 범위에는 일치하는 컴포넌트가 없습니다. 필터를 빼면 같은 query 로 N개를 찾습니다.` |

- `usedTerms` 에는 쓴 검색어가 실립니다. 조사를 떼어 쓴 검색어는 뗀 꼴로, 구분 기호를 유연하게 견준 검색어는 적힌 그대로 실립니다. 쓴 검색어가 없으면 `usedTerms` 는 빈 배열이고 `requiredMatches` 는 0 입니다.
- `components` 의 안내 줄은 제목 바로 아래에 나오고, 필터에 관한 안내만 응답 끝에 나옵니다.
- 예를 들어 `scope: "compatibility"` 에 `query: "JEUS 추천해 주세요"` 를 주면 `"matchMode": "any-term"`, `"usedTerms": ["JEUS"]`, `"requiredMatches": 1`, `"ignoredTerms": ["추천해", "주세요"]` 와 함께 JEUS 3건이 돌아옵니다. `scope: "components"` 에 `query: "게시판 컴포넌트"` 를 주면 `컴포넌트` 를 뺀 13개가 돌아오고 뺀 낱말을 알리는 안내 줄이 붙습니다.

### 알아 둘 점

- 키워드 검색은 낱말이 들어 있는지만 봅니다. 문장으로 적으면 군말이 섞여 결과가 달라지므로 핵심 낱말 몇 개만 적는 편이 낫습니다.
- 기호로 이은 검색어는 통째로 견주고 낱말을 따로 찾지 않습니다. `components` 에서 `게시판-댓글` 은 0건이고, 띄어 적은 `게시판 댓글` 은 댓글관리(`cmt`) 1건을 찾습니다.
- 제품명에 버전 숫자를 함께 적으면 숫자만 일치한 항목이 섞입니다. `compatibility` 에서 `Flamingo 1.0` 은 184건이 나오고 첫 20건에 Flamingo 가 없지만, `Flamingo` 만 적으면 그 제품 1건이 나옵니다. 프레임워크 버전은 `filters.frameworkVersion` 으로, 제품은 `filters.productName` 으로 고르는 편이 정확합니다.

---

## 자동 Scope 추론

`scope` 를 생략하거나 `auto` 로 지정하면 아래 표를 위에서부터 확인해 처음 맞는 규칙으로 범위를 정합니다.

| 순서 | 조건 | 추론 scope |
|------|------|------------|
| 1 | `action` 이 있음 | `components` |
| 2 | 공통컴포넌트 필터(`componentId`, `component`, `id`, `componentIds`, `filePath`, `dbType`, `table`, `categoryId`, `hasWeb`)가 있음 | `components` |
| 3 | 호환 소프트웨어 필터(`frameworkVersion`, `vendor`, `productName`, `minLevel`, `level`, `includeKnowledge`)가 있거나, `category` 값이 호환 소프트웨어의 분류 이름임 | `compatibility` |
| 4 | `layer` 나 `chunkId` 가 있거나, `category` 값이 공식 가이드의 category 임 | `guide` |
| 5 | 개발자 지식 필터(`type`, `tags`, `minImportance`, `verifiedOnly`, `sort`)가 있음 | `knowledge` |
| 6 | 위 조건에 해당하지 않고 `query` 가 있음 | `all` |
| 7 | 위 조건에 해당하지 않고 `query` 는 없으며 `category` 가 있음 | `compatibility` (0건과 함께 쓸 수 있는 분류를 알려 줌) |
| 8 | 위 조건에 해당하지 않음 | `components` (카테고리 개요) |

- `keyword`, `version`, `limit`, `offset`, `knowledgeScope` 는 추론에 쓰이지 않습니다.
- 값이 기본값과 같은 필터(`includeKnowledge: false`, `verifiedOnly: false`, `sort: "relevance"`, `minImportance: 1`)는 추론에 쓰이지 않습니다. 쓰지 않는 필터를 기본값으로 채워 보내는 클라이언트의 호출이 한 출처로 좁혀지지 않게 하려는 것입니다.
- 값이 `null`, 빈 문자열, 빈 배열인 필터는 지정하지 않은 것으로 봅니다.
- 7번은 `category` 값이 어느 출처의 분류도 아닐 때입니다. 공식 가이드의 category 이면 4번에 따라 `guide` 가 되고, `query` 가 없으므로 오류가 됩니다.

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
| `compatibility` | 20 | 50 |
| `all` | 출처마다 5 | 출처마다 10 |
| `components` 의 `action: "dml"` 에 `filters.table` 을 준 조회 | 100 | 100 |

- 범위별 최댓값을 넘는 `limit` 은 최댓값으로 줄여 적용하고, 응답 끝에 `> 요청한 limit 50 은(는) guide 범위의 최댓값 20 으로 줄여 적용했습니다.` 같은 안내를 붙입니다. `dml` 의 테이블 조회는 `> 요청한 limit 150 은(는) dml 구간 조회의 최댓값 100 으로 줄여 적용했습니다.` 로 알리고, 통합 검색은 섹션마다 알리지 않고 응답 끝에 한 번만 알립니다.
- 카테고리 개요, 상세 정보, 의존성, 소스 파일 목록, `readSource`, `ddl`, 기본 보기의 `dml`, `filters.chunkId` 로 읽는 가이드 청크는 `limit` 을 쓰지 않습니다.

`filters.offset` 은 이어서 조회할 위치를 가리키는 0 이상의 정수이며, 다음 네 조회에서만 쓰입니다.

| 조회 | `filters.offset` 의 뜻 |
|------|------------------------|
| `compatibility` | 건너뛸 결과 수 |
| `components` 의 `action: "dml"` 에 `filters.table` 을 준 조회 | 건너뛸 INSERT 문 수 |
| `components` 의 `action: "readSource"` | 읽기 시작할 문자 위치 |
| `guide` 의 `filters.chunkId` 조회 | 읽기 시작할 문자 위치 |

네 조회 모두 남은 내용이 있으면 다음 호출에 줄 `filters.offset` 값을 응답 끝에 알려 줍니다. 그 밖의 조회에서는 `filters.offset` 이 무시되며, 통합 검색도 여기에 해당합니다.

---

## 쓰이지 않은 입력의 안내

호출에 넣었지만 그 조회가 쓰지 않은 입력은 응답 끝에 알립니다.

`filters` 에 정의된 키라도 선택된 `scope` 나 `action` 이 쓰지 않는 키는 조회에 적용되지 않습니다. 이때 응답 끝에 무시한 키를 알리는 줄이 붙습니다. 예를 들어 `scope: "guide"` 에 `filters.tags` 와 `filters.frameworkVersion` 을 함께 주면 다음 안내가 붙습니다.

```text
> 이 조회에 적용되지 않아 무시한 필터: tags, frameworkVersion.
```

무시한 필터가 `action` 과 함께 써야 하는 필터(`componentIds`, `filePath`, `dbType`, `table`)이면 어느 `action` 에서 쓰는지도 함께 알려 줍니다.

```text
> 이 조회에 적용되지 않아 무시한 필터: dbType. (dbType 은(는) action "ddl" 또는 "dml" 에서 씁니다.)
```

최상위 `query` 와 `limit` 이 쓰이지 않았을 때는 다음 안내가 붙습니다.

```text
> 이 조회에 쓰이지 않아 무시한 파라미터: query, limit.
```

- `action` 조회, `filters.componentId` 로 조회한 상세 정보, 카테고리 개요, `filters.chunkId` 로 읽는 가이드 청크는 `query` 와 `limit` 을 쓰지 않습니다. `action: "dml"` 에 `filters.table` 을 준 조회만 `limit` 을 씁니다.
- `sort: "recent"` 목록은 `query` 를 쓰지 않습니다. 이때 준 `knowledgeScope: "all"` 도 무시한 필터로 알립니다.
- 값이 기본값과 같은 필터(`includeKnowledge: false`, `verifiedOnly: false`, `sort: "relevance"`, `minImportance: 1`)는 결과를 바꾸지 않으므로 안내에 나오지 않습니다.
- 통합 검색은 필터를 그 필터를 쓰는 출처에만 넘기므로, 응답 끝에는 어느 출처에도 넘기지 않은 필터(`sort`, `knowledgeScope`, `offset`)만 알립니다.

이 안내가 보이면 결과가 그 입력으로 걸러지지 않았다는 뜻이므로, 입력에 맞는 `scope` 나 `action` 으로 다시 호출합니다.

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

공식 가이드를 의미 검색합니다. 검색에는 `query` 가 필수입니다. 아래 호출은 실행환경(`egovframe-runtime`)의 `persistence-layer` 문서 안에서만 찾습니다.

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
| `chunkId` | string | 본문을 읽을 가이드 청크의 ID. 검색 결과에 적힌 값을 넣음. 아래 "청크 이어 읽기" 참고 |
| `offset` | integer | `chunkId` 와 함께 쓰는 읽기 시작 위치(문자 수) |

- `layer` 와 `category` 는 대소문자와 앞뒤 공백을 가리지 않습니다.
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
- **조각**: 2/3 (이 조각의 chunkId: "<ID>", 이전 조각: "<ID>", 다음 조각: "<ID>")
- **유사도**: <코사인 유사도, 소수 넷째 자리>

<본문>
```

- 결과 사이는 `---` 로 구분됩니다.
- 제목은 `<문서 제목>: <절 제목>` 꼴이고, 첫 절 앞의 도입부는 문서 제목만 적습니다. 공식 가이드는 절 단위로 색인되어 있으며, 긴 절은 소절이나 여러 조각으로 나뉘어 있습니다. 소절은 `절 > 소절` 로 적고, 조각은 제목 끝에 `(2/3)` 같은 번호를 붙입니다. 이웃한 소절을 한 청크로 합친 경우에는 합친 소절의 이름을 `/` 로 이어 적습니다(`설명 > Input / Output`).
- `분류` 는 category 가 없는 문서이면 layer 만 적습니다. `URL` 은 `https://egovframework.github.io/egovframe-docs` 아래의 주소이며, 주소가 없는 문서에는 이 줄이 없습니다.
- `조각` 줄은 여러 조각으로 나뉜 절의 결과에만 있습니다. 첫 조각에는 다음 조각만, 마지막 조각에는 이전 조각만 적습니다.
- 같은 절의 조각이 여러 개 검색되면 유사도가 가장 높은 조각 하나로 묶고, 본문 아래에 `> 같은 절의 다른 조각도 검색되었습니다: 5/8 (chunkId "<ID>"), 2/8 (chunkId "<ID>"), 7/8 (chunkId "<ID>") 외 4개.` 같은 안내를 적습니다. 다른 조각은 셋까지 적고 나머지는 수로 알립니다.
- 본문이 같은 청크는 한 번만 싣습니다.
- 본문 안의 마크다운 제목은 굵은 글씨(`**...**`)로, 구분선은 `* * *` 로 바뀌어 실립니다. 결과 제목(`### 1. ...`)과 결과 사이의 구분선(`---`)과 구별하기 위한 것이며, 코드 블록 안은 그대로입니다.
- 본문은 1,500자까지 싣습니다. 더 긴 본문은 앞 1,500자만 싣고 다음 안내를 붙입니다.

```text
> 전체 N자 중 1~1,500자를 표시했습니다. 나머지는 `scope: "guide"`, `filters.chunkId: "<ID>"`, `filters.offset: 1500` 으로 이어서 읽을 수 있습니다.
```

#### 청크 이어 읽기: `filters.chunkId`

`filters.chunkId` 를 주면 검색하지 않고 그 청크의 본문을 `filters.offset` 부터 읽습니다. `query` 는 필요 없습니다. 잘린 본문의 나머지를 읽거나, `조각` 줄에 적힌 이전 조각과 다음 조각을 읽을 때 씁니다.

```json
{
  "scope": "guide",
  "filters": {
    "chunkId": "<검색 결과에 적힌 chunkId>",
    "offset": 1500
  }
}
```

응답은 `## <청크 제목>` 아래에 문서, 분류, 소스, URL 줄과 본문이 나오고, 표시한 범위를 알리는 안내로 끝납니다. 조각으로 나뉜 절의 청크이면 몇 번째 조각인지와 이웃 조각의 ID 를 알리는 안내가 하나 더 붙습니다.

```text
> 전체 N자 중 1,501~N자를 표시했습니다 (청크의 끝).

> 이 절은 3조각으로 나뉘어 있고, 이 청크는 2번째 조각입니다. 이전 조각의 chunkId 는 "<ID>", 다음 조각의 chunkId 는 "<ID>" 입니다 (`filters.chunkId` 에 넣어 읽습니다).
```

- 한 번에 6,000자까지 돌려주고, 남은 내용이 있으면 다음 호출에 줄 `filters.offset` 값을 알려 줍니다. 동봉 인덱스의 청크는 모두 6,000자보다 짧아 한 번에 끝까지 읽힙니다.
- 청크 ID 는 지식베이스를 갱신하거나 다시 구축하면 바뀝니다. 없는 ID 를 주면 다시 검색해서 새 ID 를 확인하라는 오류가 돌아옵니다.
- 이 조회는 임베딩 모델을 쓰지 않습니다.

---

### 2. 개발자 지식 검색: `knowledge`

개발자 지식을 의미 검색합니다. 개발자 지식은 전자정부 표준프레임워크 포털의 묻고답하기, FAQ, 적용가이드 PDF 를 인덱싱한 자료입니다. 묻고답하기와 FAQ 는 글 하나가 항목 하나입니다. 적용가이드는 PDF 를 600자 이하의 청크로 나눈 항목이어서 제목 끝에 `(k/n)` 꼴의 순번이 붙고, 이웃한 청크는 100자까지 겹칩니다. 아래 호출은 FAQ 안에서만 찾습니다.

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
| `tags` | string[] | 태그 가운데 하나라도 가진 항목만 조회. 대소문자를 가리지 않음. 데이터에 있는 태그는 모든 항목에 붙는 `egovframe`, `developer_knowledge` 와 출처를 가르는 `qa`(묻고답하기), `faq`(FAQ), `guide`·`pdf`(적용가이드) |
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
| `knowledgeScope: "all"` | `success`, `scope`, `query`, `totalResults`, `compatibilityTotal`, `compatibility`, `knowledge` | `compatibility` 항목: `product`, `framework`, `category`, `level`, `vendor`, `description`. `knowledge` 항목: `title`, `type`, `content`, `tags`, `importance` |

- 의미 검색의 `content` 는 본문 전체이고, `similarity` 는 소수 셋째 자리로 반올림한 코사인 유사도입니다. `options` 에는 실제로 적용한 `limit` 과 필터가 담깁니다.
- `context` 는 출처 이름이며, 값은 `표준프레임워크 묻고답하기`, `표준프레임워크 FAQ`, `표준프레임워크 적용가이드 PDF` 가운데 하나입니다.
- 응답의 `query` 는 200자를 넘으면 앞 200자 뒤에 `…` 를 붙여 줄입니다.
- `title` 과 `content` 에 든 주민등록번호 형식의 값(생년월일 6자리, 하이픈, 7자리)은 `******-*******` 로 가려서 싣습니다. 포털의 공개 게시판에서 온 글이라 본문에 그런 값이 적혀 있을 수 있기 때문입니다.
- `sort: "recent"` 는 본문 없이 목록만 돌려주며, `type`, `tags`, `minImportance`, `verifiedOnly` 필터를 적용합니다. `createdAt` 은 글을 쓴 날짜가 아니라 인덱싱한 시각입니다.
- 결과가 없으면 의미 검색은 `"resultCount": 0` 과 빈 `results` 를, `sort: "recent"` 는 `"count": 0` 과 빈 `results` 를 돌려주고, `knowledgeScope: "all"` 은 `knowledge` 가 빈 배열입니다. 이때 데이터에 없는 태그를 주었으면 `> filters.tags 의 "mybatis" 은(는) 데이터에 없는 태그입니다. 데이터에 있는 태그: egovframe, developer_knowledge, qa, faq, guide, pdf (대소문자는 가리지 않습니다).` 가, 데이터에 항목이 없는 `type` 을 주었으면 `> filters.type "tip" 인 항목은 데이터에 없습니다. 데이터에 있는 type: solution (묻고답하기 Q&A, FAQ), best-practice (적용가이드 PDF).` 가 응답 끝에 붙습니다.
- `knowledgeScope: "all"` 은 `query` 의 모든 검색어와 일치하는 호환 소프트웨어를 `limit` 건까지 `compatibility` 에 함께 싣고, 그 전체 건수를 `compatibilityTotal` 로 알립니다. `totalResults` 는 이 응답에 실은 건수의 합입니다. 이 목록은 "키워드 검색" 절의 규칙으로 찾되 일부 검색어만 일치하는 항목은 싣지 않으며, `query` 의 `OR` 도 따르지 않습니다. `knowledge` 의 `content` 는 200자 이내의 미리보기이고, 개발자 지식 필터는 `knowledge` 에만 적용됩니다. 호환 소프트웨어를 일부만 실었으면 응답 끝에 다음 안내가 붙습니다.

```text
> 호환 소프트웨어는 전체 3건 중 2건을 실었습니다. 나머지는 `scope: "compatibility"` 로 같은 query 를 조회합니다.
```

---

### 3. 공통컴포넌트 조회: `components`

공통컴포넌트의 목록, 상세 정보, 의존성, 소스 파일, DDL, DML 을 조회합니다. `action` 이 없으면 함께 준 값에 따라 조회 방식이 정해지며, 여러 값을 함께 주면 아래 표에서 위에 있는 행이 우선합니다.

| 준 값 | 조회 방식 | 응답 제목 |
|-------|-----------|-----------|
| `filters.componentId` | 상세 정보(`action: "get"` 과 같음) | `## <컴포넌트 이름>` |
| `query` | 키워드 검색. 목록 필터를 함께 주면 모두 적용 | `## 공통컴포넌트 목록 (N개)` |
| 목록 필터(`categoryId`, `keyword`, `hasWeb`, `version`)만 | 카테고리별로 묶은 목록 | `## 공통컴포넌트 목록 (N개)` |
| 없음 | 카테고리 개요와 통계 | `## eGovFrame 공통컴포넌트 카테고리`, `## eGovFrame 공통컴포넌트 통계` |

`action` 과 함께 써야 하는 필터(`componentIds`, `filePath`, `dbType`, `table`)를 `action` 없이 주면 목록이나 개요로 답하지 않고, 필요한 `action` 을 알려 주는 오류가 됩니다. `filters.componentId` 를 함께 주었으면 상세 정보를 돌려주고 그 필터를 무시했다고 알립니다.

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
    "hasWeb": false,
    "version": "5.1.0"
  }
}
```

목록 응답의 형식은 다음과 같습니다.

- 키워드 검색 결과는 `컴포넌트 ID`, `컴포넌트`, `카테고리`, `패키지명`, `버전` 열의 표입니다. 일치하는 컴포넌트가 `limit` 보다 많으면 제목이 `## 공통컴포넌트 목록 (N개 중 M개 표시)` 가 됩니다.
- 필터 목록은 카테고리마다 `### <카테고리> (N개)` 제목과 `컴포넌트 ID`, `컴포넌트`, `패키지명`, `설명` 열의 표로 나옵니다. `limit` 을 주지 않으면 조건에 맞는 컴포넌트를 모두 보여 줍니다.
- 카테고리 개요는 `#`, `카테고리`, `카테고리 ID`, `영문명`, `컴포넌트 수` 열의 표입니다. `categoryId` 필터에는 이 표의 카테고리 ID, 카테고리, 영문명 가운데 어느 값이든 쓸 수 있습니다.
- 키워드 검색이 일부 검색어만 일치한 결과를 돌려주었거나 검색에 쓰지 않은 낱말이 있으면 제목 아래에 안내 줄이 붙습니다. 문구는 "키워드 검색" 절의 표에 있습니다.
- 결과가 없으면 `## 공통컴포넌트 목록 (0개)` 아래에 `검색 결과가 없습니다.` 가 나옵니다. 이때 `filters.categoryId` 가 어느 카테고리도 아니면 `> filters.categoryId "<값>" 에 해당하는 카테고리가 없습니다.` 로 시작하는 안내가 쓸 수 있는 카테고리 ID 를 모두 나열하고, `filters.version` 이 데이터에 없는 값이면 `> filters.version "5.0.0" 과(와) 같은 version 값을 가진 컴포넌트가 없습니다. 데이터에 있는 version 값: 4.3.1.` 같은 안내가 붙습니다.

#### 컴포넌트 지정

`filters.componentId` 에는 컴포넌트 ID(`uia`), 패키지명(`egovframework.com.uat.uia`), 정확한 컴포넌트 이름(`일반로그인`, `General Login`) 가운데 하나를 넣습니다. 대소문자와 앞뒤 공백은 가리지 않으며, 이름은 같은 이름의 컴포넌트가 하나뿐일 때만 쓸 수 있습니다.

`filters.component` 와 `filters.id` 는 `componentId` 의 별칭이므로 셋 가운데 하나만 지정합니다. 서로 다른 값을 주면 어느 컴포넌트를 조회할지 정할 수 없어 오류가 됩니다. 대소문자만 다른 값은 같은 값으로 봅니다.

컴포넌트 ID 는 목록과 검색 결과 표의 첫 열에 나옵니다. 대부분 패키지명의 마지막 마디와 같지만 그렇지 않은 컴포넌트가 있습니다. 예를 들어 `egovframework.com.utl.sim`(시스템정보확인)의 ID 는 `utl-sim` 이고, `sim` 은 `egovframework.com.cop.smt.sim`(일정관리)의 ID 입니다. 게시판(`bbs`)과 블로그관리(`blog-management`)는 패키지 `egovframework.com.cop.bbs` 를 함께 쓰며, 이 패키지명으로 지정하면 게시판이 선택됩니다.

컴포넌트를 찾지 못하면 오류가 아닌 일반 응답으로 안내 문구가 돌아옵니다. 같은 입력으로 키워드 검색한 후보가 있으면 5개까지 컴포넌트 ID, 이름, 패키지명을 함께 나열합니다. 예를 들어 `componentId` 에 `로그인` 을 주면 다음과 같이 응답합니다.

```text
컴포넌트를 찾을 수 없습니다: 로그인

비슷한 컴포넌트 (`filters.componentId` 에는 아래의 컴포넌트 ID 를 넣습니다):
- `uia` 일반로그인 (egovframework.com.uat.uia)
- `sec` 인증서로그인 (egovframework.com.utl.sec)
- `uap` 로그인정책관리 (egovframework.com.uat.uap)
- `slm` 중복로그인 방지 (egovframework.com.utl.slm)
- `rsc` 로그인세션정보체크 (egovframework.com.utl.sys.rsc)
```

#### action

| action | 쓰는 필터 | 응답 |
|--------|-----------|------|
| `get`, `info` | `componentId`(필수) | `## <컴포넌트 이름>` 아래에 기본 정보(ID, 영문명, 카테고리, 패키지명, 버전, 웹 배포), 설명, 사용 테이블, 의존성 |
| `dependencies` | `componentIds` 또는 `componentId`(둘 중 하나 필수) | `## 의존성 해결 결과` 아래에 요청한 컴포넌트, 자동 추가된 의존성, 전체 필요 컴포넌트, 필요 패키지 목록 |
| `sourceFiles` | `componentId`(필수) | `## <컴포넌트 이름> 소스 파일 목록` 아래에 패키지, 총 파일 수, 종류별 파일 경로, 수집 범위 안내 |
| `readSource` | `filePath`(필수), `offset` | 파일 정보 한 줄과 내용을 담은 코드 블록 |
| `ddl` | `componentId`(필수), `dbType` | `## <컴포넌트 이름> DDL (<dbType>)` 아래에 요약과 CREATE TABLE, 인덱스, 뷰 문. 외래 키가 참조하는 테이블과 ALTER 문으로 둔 외래 키 제약 포함 |
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
- `sourceFiles` 는 파일을 Java 소스, MyBatis Mapper XML, JSP 뷰, CSS 스타일, JavaScript, Spring 설정, 메시지 리소스, 이미지로 나눠 보여 주고, 끝에 `readSource` 호출 방법과 수집 범위를 안내합니다. 해당하는 파일이 없는 종류는 나오지 않습니다.
- `sourceFiles` 의 목록에는 컴포넌트의 패키지 경로(게시판이면 `com/cop/bbs`)와 같은 디렉토리에 있는 파일과 그 컴포넌트에 귀속되는 Spring 설정만 실립니다. JavaScript 는 `src/main/webapp/js/egovframework/<패키지 경로>` 아래의 `.js` 파일입니다. 다른 경로에 있는 파일(다른 컴포넌트의 화면·스크립트·메시지, 전역 Spring 설정, 프로퍼티 파일)은 그 컴포넌트가 쓰더라도 나오지 않습니다.

#### 소스 파일 읽기: `readSource`

`filters.filePath` 에는 공통컴포넌트 소스 루트를 기준으로 한 상대 경로를 넣습니다. `sourceFiles` 가 알려 주는 경로가 이 형식입니다. 응답 첫 줄은 파일 경로, 바이트 수, 코드 블록 언어이고 그 아래에 내용이 코드 블록으로 나옵니다.

```text
**파일**: `<경로>` (<바이트 수> bytes, <언어>)
```

한 번에 30,000자까지 돌려줍니다. 남은 내용이 있으면 응답 끝에 다음 안내가 붙습니다.

```text
> 전체 N자 중 1~30,000자를 표시했습니다. 이어서 읽으려면 같은 호출에 `filters.offset: 30000` 을 주세요.
```

안내된 값을 `filters.offset` 에 주어 이어서 읽습니다. 아래는 30,000자가 넘는 통합 DDL 스크립트의 두 번째 구간을 읽는 호출입니다.

```json
{
  "scope": "components",
  "action": "readSource",
  "filters": {
    "filePath": "script/ddl/mysql/com_DDL_mysql.sql",
    "offset": 30000
  }
}
```

- 마지막 구간의 응답은 `> 전체 N자 중 a~b자를 표시했습니다 (파일의 끝).` 으로 끝납니다.
- EUC-KR 로 저장된 텍스트 파일도 읽을 수 있으며, 이때는 첫 줄의 언어 뒤에 `, EUC-KR` 이 붙습니다.
- 이미지 같은 바이너리 파일은 내용 대신 `[바이너리 파일 - UTF-8 텍스트가 아니어서 내용을 표시하지 않습니다]` 를 돌려줍니다. UTF-8 로도 EUC-KR 로도 읽히지 않는 텍스트 파일도 바이너리로 판정하며, EUC-KR 에 없는 CP949 확장 글자가 든 파일이 여기에 해당합니다.
- 절대 경로, 소스 루트 밖의 경로, `.git` 아래의 경로, 없는 파일은 `파일을 찾을 수 없거나 접근할 수 없습니다: <경로>` 로 응답합니다. 이 응답은 오류로 표시되지 않습니다.

#### DDL 과 DML: `ddl`, `dml`

`filters.dbType` 으로 DB 종류를 고릅니다. 지원하는 값은 `mysql`(기본값), `maria`, `oracle`, `postgres`, `tibero`, `cubrid`, `altibase`, `goldilocks` 이고, 별칭 `mariadb`, `postgresql`, `pgsql` 도 받습니다. 대소문자는 가리지 않으며, 그 밖의 값은 오류가 됩니다.

`ddl` 은 컴포넌트의 사용 테이블과 뷰의 CREATE 문, 그리고 그 테이블의 인덱스를 통합 DDL 스크립트에서 골라 돌려줍니다. 받은 DDL 을 그대로 실행할 수 있도록 외래 키도 따라가서 싣습니다.

- 외래 키가 참조하는 테이블이 사용 테이블에 없으면 그 테이블의 DDL 도 함께 싣고, 요약에 `- **외래 키 참조로 함께 실은 테이블**: 1개 (COMTNQUSTNRTMPLAT)` 같은 줄로 알립니다. SQL 머리말에도 `-- 외래 키가 참조해서 함께 실은 테이블 1개: COMTNQUSTNRTMPLAT` 줄이 들어갑니다. 질문관리(`qqm`)의 DDL 이 이 경우입니다.
- `cubrid` 처럼 외래 키를 CREATE TABLE 안이 아니라 ALTER 문으로 따로 두는 DB 는 결과에 실린 테이블 사이의 제약을 DDL 끝에 싣고, 요약에 `- **외래 키 제약**: 17건 (ALTER 문, DDL 끝에 실음)` 같은 줄로 알립니다. `cubrid` 의 이 문들은 원본에서 초기 데이터 스크립트의 INSERT 문 뒤에 있으므로, 초기 데이터를 넣은 뒤에 실행하라는 주석이 SQL 안에 들어 있습니다. `goldilocks` 스크립트에는 외래 키가 없습니다.
- 스크립트에서 정의를 찾지 못한 테이블이나 뷰가 있으면 `- DDL 을 찾지 못한 객체: <이름>` 줄로 알려 줍니다.

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
| `hasWeb` | boolean | 상세 정보의 "웹 배포" 값으로 목록과 키워드 검색을 한정. 이 값은 공통컴포넌트 목록(`components.xls`)의 `webexist` 로, 컴포넌트가 프로젝트에 `web.xml` 을 가져오는지를 나타냄. JSP 화면이 있는지와는 다르며, 동봉 데이터에서 `true` 는 5개 |
| `version` | string | 컴포넌트 메타데이터의 버전으로 목록과 키워드 검색을 한정. 동봉 데이터의 값은 `5.1.0` 하나 |
| `limit`, `offset` | integer | 구간 조회. "limit 과 offset" 절 참고 |

---

### 4. 호환 소프트웨어 검색: `compatibility`

eGovFrame 버전별 호환 소프트웨어 목록을 조회합니다. `query` 없이 필터만으로 조회할 수 있고, `query` 를 주면 필터를 적용한 대상 안에서 키워드 검색을 합니다. 키워드 검색은 제품명, 제품 버전 표기, 업체명, 분류, 설명에서 찾고 프레임워크 버전과 확인일자로도 찾습니다. 규칙은 "키워드 검색" 절에 있습니다. 아래 호출은 제품명에 `JEUS` 가 들어 있는 호환 소프트웨어와 그 제품을 언급하는 개발자 지식을 함께 조회합니다.

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
| `vendor` | string | 업체명의 부분 문자열. 법인 표기(`㈜`, `(주)`, `주식회사`)와 공백의 차이는 가리지 않음. `(주)아이액츠`, `㈜아이액츠`, `주식회사 아이액츠`, `아이액츠` 가 모두 같은 결과를 돌려줌 |
| `productName` | string | 제품명 또는 제품 버전 표기의 부분 문자열. 예: `JEUS`, `JEUS 8.5` |
| `level` | integer | 호환 레벨이 이 값과 같은 항목만 조회. `1` 또는 `2` |
| `minLevel` | integer | 호환 레벨이 이 값 이상인 항목만 조회. `1` 또는 `2`. `1` 은 전체와 같으므로 레벨 1 만 고르려면 `level` 을 씀 |
| `includeKnowledge` | boolean | `true` 이면 결과 제품을 언급하는 개발자 지식을 함께 조회 |
| `limit`, `offset` | integer | 구간 조회. "limit 과 offset" 절 참고 |

`level` 과 `minLevel` 을 함께 주면 둘 다 적용합니다.

응답은 `## 호환 소프트웨어 검색 결과` 제목 아래의 JSON 코드 블록입니다.

| 필드 | 설명 |
|------|------|
| `success` | `true` |
| `total` | 조건에 맞는 전체 건수 |
| `count` | 이번 응답에 담긴 건수 |
| `limit`, `offset` | 실제로 적용한 값 |
| `filters` | 실제로 적용한 필터. `frameworkVersion` 은 맞춘 표기로, `vendor` 는 받은 값 그대로 실림 |
| `matchMode`, `orQuery`, `usedTerms`, `requiredMatches`, `ignoredTerms`, `droppedTerms`, `totalWithoutQuery` | 키워드 검색을 했을 때만 있음. 뜻은 "키워드 검색" 절의 표 참고 |
| `available` | 결과가 0건이고 `frameworkVersion` 이나 `category` 가 데이터에 없는 값일 때만 있음. 쓸 수 있는 값을 담은 `frameworkVersions`, `categories` 배열 |
| `software` | 결과 배열. 항목의 필드는 `product_name`, `product_version`, `framework_version`, `category`, `compatibility_level`, `vendor`, `verified_date`, `description`, `url` |
| `relatedKnowledge` | `includeKnowledge` 가 `true` 일 때만 있음. 항목은 `product` 와 `knowledge` 배열(`id`, `title`, `excerpt`, `type`, `importance`, `tags`). 제품을 언급하는 지식이 없으면 빈 배열 |
| `knowledgeLookup` | `includeKnowledge` 가 `true` 일 때만 있음. 이번 응답에 나온 제품 수(제품명 기준) `pageProducts` 와 그 가운데 지식을 조회한 제품 수 `searchedProducts` |
| `knowledgeWarning` | 관련 지식 조회가 실패했을 때만 있음. 이때도 `software` 는 그대로 돌려줌. 임베딩 모델이나 개발자 지식 인덱스가 없는 경우처럼 조치할 수 있는 원인이면 끝에 `원인: <문구>` 가 붙음 |

- `query` 없는 조회는 확인일자(`verified_date`)가 최근인 순서로 정렬합니다. 확인일자가 날짜 형식이 아닌 항목은 맨 뒤에 놓입니다.
- `includeKnowledge` 는 이번 응답에 나온 제품 가운데 앞에서부터 5개까지 조회하고, 제품마다 제목이나 본문이 그 제품명을 언급하는 개발자 지식을 5건까지 싣습니다. 제품명은 낱말 경계로 견주므로, 제품명이 다른 낱말의 일부로 들어 있을 뿐인 글은 싣지 않습니다. `excerpt` 는 본문에서 제품명이 처음 나오는 자리를 중심으로 한 200자 이내의 발췌이고, 제목과 발췌의 주민등록번호 형식은 가려집니다. 나머지 제품의 지식은 `filters.productName` 으로 그 제품을 좁혀 조회합니다. 이 조회에는 임베딩 모델이 필요합니다.

결과가 `limit` 보다 많으면 응답 끝에 다음 구간의 `filters.offset` 값을 알려 줍니다. 한 번에 받을 수 있는 최댓값은 50건이므로 51번째부터는 `filters.offset` 으로 이어서 조회합니다. 예를 들어 `limit` 을 주지 않았는데 결과가 20건보다 많으면 첫 응답은 다음 안내로 끝납니다.

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
- `limit` 은 출처마다 따로 적용되며, 생략하면 출처마다 5건이고 최댓값은 출처마다 10건입니다. 통합 검색은 어느 출처에 무엇이 있는지 훑어보는 용도이므로, 한 출처의 결과를 더 보려면 그 출처를 `scope` 로 지정해 조회합니다. 10 을 넘는 `limit` 을 주면 10 으로 줄여 적용하고 응답 끝에 다음 안내를 한 번 붙입니다.

```text
> 통합 검색은 출처마다 최대 10건을 싣습니다. 요청한 limit 200 은(는) 10 으로 줄여 적용했습니다. 한 출처의 결과를 더 보려면 `scope` 로 그 출처를 지정해 조회하세요.
```

- 필터는 그 필터를 쓰는 출처에만 적용됩니다. 위 호출에서 `layer` 는 공식 가이드에, `tags` 는 개발자 지식에만 적용됩니다. `category` 는 값이 속한 출처에만 적용하고, 어느 출처의 값도 아니면 공식 가이드와 호환 소프트웨어 양쪽에 넘겨 각 출처가 쓸 수 있는 값을 알리게 합니다.
- `filters.componentId` 를 주면 공통컴포넌트 섹션은 목록 대신 그 컴포넌트의 상세 정보가 되고, `filters.chunkId` 를 주면 공식 가이드 섹션은 검색 결과 대신 그 청크의 본문이 됩니다.
- 공통컴포넌트 섹션과 호환 소프트웨어 섹션은 "키워드 검색" 절의 규칙을 그대로 따릅니다.
- `sort`, `knowledgeScope`, `offset` 은 통합 검색에서 쓰이지 않으며, 주면 무시한 필터로 안내됩니다. 호환 소프트웨어 섹션은 결과가 더 있으면 `scope` 를 지정해서 다음 구간을 조회하라고 안내합니다.

```text
> 전체 N건 중 1~5번째 결과를 표시했습니다. 다음 구간은 `scope: "compatibility"` 를 지정하고 `filters.offset: 5` 을 주어 조회합니다.
```

- 개발자 지식 섹션은 `id`, `similarity` 와 함께 `content` 를 600자 이내의 발췌로 싣습니다. 묻고답하기 본문은 질문과 답변의 앞부분이 함께 들어갑니다. 섹션 끝에는 다음 안내가 붙습니다.

```text
> 개발자 지식의 본문은 600자를 넘으면 발췌해서 싣습니다. 전체 본문은 같은 query 에 `scope: "knowledge"` 를 지정해 검색하면 볼 수 있습니다.
```

- 한 출처에서 오류가 나면 그 섹션만 `## 공식 가이드` 같은 출처 이름 아래에 `검색 중 오류가 발생했습니다: <원인>` 으로 나오고, 나머지 섹션은 그대로 나옵니다. 이때 응답 전체는 오류로 표시되지 않습니다. 네 출처가 모두 실패하면 응답 전체가 오류로 표시되고, 본문에는 출처별 실패 문구가 그대로 들어 있습니다.

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
| `query` 가 10,000자를 넘음 | `["query"]` |
| `filters` 에 정의되지 않은 키 | `["filters"]` |
| 필터 값의 타입이나 범위가 맞지 않거나 길이 상한을 넘음 (예: `"hasWeb": "true"`, `"frameworkVersion": 4.3`, `"minLevel": 3`, 500자를 넘는 문자열) | `["filters", "<키>"]` |

### 실행 오류

| 상황 | 오류 문구 |
|------|-----------|
| `guide`, `knowledge`, `all` 검색에 `query` 가 없음 | `query is required for guide search` (`knowledge`, `all` 도 같은 형태) |
| `components` 가 아닌 `scope` 에 `action` 을 줌 | `action "ddl" is supported only for the components scope. Use scope "components" (or omit scope); received scope "guide".` |
| `filters.componentId`, `filters.component`, `filters.id` 에 서로 다른 값을 줌 | `filters.componentId, filters.component, filters.id 는 같은 뜻의 별칭인데 서로 다른 값이 들어 있습니다 (filters.componentId: "bbs", filters.id: "cmy"). 하나만 지정하세요. 여러 컴포넌트의 의존성은 action "dependencies" 와 filters.componentIds 배열로 조회합니다.` |
| `action` 없이 `action` 과 함께 써야 하는 필터를 줌 | `action 을 지정하지 않아 다음 필터를 쓸 수 없습니다: filters.dbType 은(는) action "ddl" 또는 "dml" 와(과) 함께 씁니다.` |
| `get`, `info` 에 `componentId` 가 없음 | `filters.componentId is required for component detail lookup` |
| `dependencies` 에 `componentIds` 와 `componentId` 가 모두 없음 | `filters.componentIds (or filters.componentId) is required for component dependency resolution` |
| `sourceFiles` 에 `componentId` 가 없음 | `filters.componentId is required for component source file listing` |
| `readSource` 에 `filePath` 가 없음 | `filters.filePath is required for component source reading` |
| `ddl`, `dml` 에 `componentId` 가 없음 | `filters.componentId is required for component ddl lookup` (`dml` 은 `... dml lookup`) |
| 지원하지 않는 `dbType` | `지원하지 않는 DB 타입입니다: h2 (지원: mysql, maria, oracle, postgres, tibero, cubrid, altibase, goldilocks. 별칭: mariadb, postgresql, pgsql)` |
| `dml` 의 `table` 이 컴포넌트가 쓰는 테이블이 아님 | `'<table>' 은(는) 이 컴포넌트가 사용하는 테이블이 아닙니다. 사용 가능한 테이블: ...` |
| `guide` 의 `layer`, `category` 가 인덱스에 없는 값임 | `알 수 없는 layer 값입니다: "<값>". 사용할 수 있는 값: ...` (`category` 도 같은 형태) |
| `guide` 의 `chunkId` 에 해당하는 청크가 없음 | `filters.chunkId 에 해당하는 가이드 청크를 찾을 수 없습니다: <ID>. 청크 ID 는 지식베이스를 갱신하거나 다시 구축하면 바뀝니다. scope guide 로 다시 검색해서 새 ID 를 확인하세요.` |
| 통합 검색에서 네 출처가 모두 실패함 | `# 통합 지식 검색 결과` 아래에 출처마다 `검색 중 오류가 발생했습니다: <원인>` |

설치 상태가 원인인 오류는 조치 방법을 함께 알려 줍니다.

| 상황 | 오류 문구의 앞부분 |
|------|--------------------|
| 지식베이스 DB 가 없음 (`readSource` 를 뺀 `components` 조회, `compatibility`, `knowledge` 의 `knowledgeScope: "all"`) | `지식베이스 DB(knowledge-base/egovframe.db)를 찾을 수 없습니다.` |
| 공식 가이드 또는 개발자 지식 인덱스가 없음 | `공식 가이드 인덱스(knowledge-base/egovframe_guide.lance)를 찾을 수 없습니다.` (개발자 지식은 `개발자 지식 인덱스(knowledge-base/developer_knowledge.lance)를 ...`) |
| 공식 가이드 또는 개발자 지식 인덱스를 다시 시도해도 읽지 못함 (데이터 파일이 빠진 불완전한 인덱스 등) | `공식 가이드 인덱스를 읽지 못했습니다. 지식베이스를 갱신하거나 다시 구축한 직후라면 MCP 서버를 재시작하세요.` (개발자 지식은 `개발자 지식 인덱스를 ...`) |
| 임베딩 모델이 없음 (의미 검색) | `임베딩 모델을 찾을 수 없습니다 (models/Xenova/multilingual-e5-small).` |
| 임베딩 모델 파일이 손상되었거나 읽을 수 없음 (의미 검색) | `임베딩 모델 파일을 읽지 못했습니다 (models/Xenova/multilingual-e5-small).` |
| 공통컴포넌트 소스가 없음 (`sourceFiles`, `readSource`, `ddl`, `dml`) | `공통컴포넌트 소스가 설치되어 있지 않습니다.` |
| Node.js 버전이나 플랫폼이 맞지 않아 SQLite 모듈을 불러오지 못함 (지식베이스 DB 가 없을 때와 같은 조회) | `네이티브 모듈(better-sqlite3)을 불러오지 못했습니다.` |
| 그 밖의 내부 오류 | `내부 오류가 발생했습니다. 자세한 내용은 MCP 서버 로그(stderr)를 확인하세요.` |

- 문제가 생긴 대상을 쓰지 않는 조회는 그대로 동작합니다. 지식베이스 DB 나 SQLite 모듈에 문제가 있어도 공식 가이드 검색과 개발자 지식 검색은 동작하고, 임베딩 모델에 문제가 있어도 공통컴포넌트 조회, 호환 소프트웨어 조회, `sort: "recent"` 목록, `filters.chunkId` 조회는 동작합니다.
- 공식 가이드 조회와 개발자 지식 조회(통합 검색의 두 섹션 포함)는 인덱스를 읽다가 실패하면 열어 둔 연결을 버리고 한 번 다시 시도하며, 그래도 읽지 못할 때 위의 오류를 돌려줍니다. 실행 중에 인덱스가 교체되어 난 실패는 이 재시도에서 새 인덱스를 다시 열어 정상으로 응답합니다. `update` CLI 로 받은 갱신분을 읽다가 실패했으면 동봉 인덱스로 물러나서 다시 시도합니다. `includeKnowledge` 의 관련 지식 조회는 다시 시도하지 않고 실패를 `knowledgeWarning` 으로 알립니다.

### 오류로 표시되지 않는 응답

찾는 대상이 없는 경우는 오류가 아니라 일반 결과로 돌아옵니다.

| 상황 | 응답 |
|------|------|
| 없는 컴포넌트를 `componentId` 로 지정 | `컴포넌트를 찾을 수 없습니다: <입력>` 과 후보 목록 |
| `dependencies` 에 해석할 수 없는 입력 | 결과 안의 `### 찾을 수 없는 입력 (N개)` |
| `readSource` 로 읽을 수 없는 경로 | `파일을 찾을 수 없거나 접근할 수 없습니다: <경로>` |
| `components` 목록과 검색에 결과 없음 | `## 공통컴포넌트 목록 (0개)` 과 `검색 결과가 없습니다.`, 원인을 알 수 있으면 그 안내 줄 |
| `knowledge` 검색에 결과 없음 | `"resultCount": 0`(`sort: "recent"` 는 `"count": 0`, `knowledgeScope: "all"` 은 빈 `knowledge`), 데이터에 없는 `tags` 나 `type` 을 주었으면 그 안내 줄 |
| `compatibility` 검색에 결과 없음 | `"total": 0`, 값이 잘못된 필터가 있으면 `available`, 키워드 검색이면 `ignoredTerms` 와 `totalWithoutQuery` |
| 통합 검색의 일부 출처에서 오류 | 해당 섹션의 `검색 중 오류가 발생했습니다: <원인>` |

---

## 설계 메모

- 이 도구는 읽기 전용입니다. `tools/list` 의 annotations 는 `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false` 입니다.
- 조회 기능을 도구 하나로 묶어 MCP 클라이언트에 노출하는 도구 수를 줄입니다. 새 조회 기능은 새 도구를 추가하기보다 `scope` 와 `action` 을 확장하는 방향으로 먼저 검토합니다.
- 출처별 조회 함수는 `src/tools/` 의 `commonComponents.ts`, `compatibility.ts`, `knowledge.ts` 와 `src/rag/guideManager.ts` 에 있고, `egovSearchKnowledge.ts` 가 `scope` 와 `action` 에 따라 호출합니다. 이 함수들은 개별 도구로 등록하지 않습니다.
- 서버는 지식베이스를 읽기 전용으로 열며, 인덱스나 DB 가 없어도 새로 만들지 않고 오류로 알립니다.
- 응답 하나의 크기에는 상한을 둡니다. 통합 검색은 출처마다 10건, 호환 소프트웨어 조회는 한 번에 50건, `readSource` 는 한 번에 30,000자, 가이드 검색 결과의 본문은 1,500자까지 싣고 나머지는 이어서 조회하게 합니다. MCP 클라이언트가 큰 도구 결과를 자르거나 본문 대신 파일로 넘기기 때문입니다.
- 서버는 `initialize` 응답의 `instructions` 에 사용법 요약을 싣습니다. `scope` 로 출처를 고르고, `action` 은 `components` 범위에서만 쓰며, 필터는 모두 `filters` 객체 안에 넣는다는 내용입니다.
