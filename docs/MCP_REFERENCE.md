# MCP API 레퍼런스

이 문서는 `egovframe-mcp-search` 서버가 MCP 클라이언트에 공개하는 API 를 요약합니다. scope 별 사용법과 호출 예시는 [EGOV_SEARCH_KNOWLEDGE_TOOL.md](./EGOV_SEARCH_KNOWLEDGE_TOOL.md)에서 다룹니다.

## 서버

| 항목 | 값 |
|------|-----|
| 서버 이름 | `egovframe-mcp-search` |
| 서버 버전 | `package.json` 의 `version` (현재 `1.0.0`) |
| 전송 방식 | stdio |
| capabilities | `tools` |
| `instructions` | `initialize` 응답에 실리는 영문 사용법 요약. `scope` 로 출처를 고르고, `action` 은 `components` 에서만 쓰며, 필터는 모두 `filters` 객체 안에 넣는다는 내용입니다. |

## Tools

공개 도구는 **1개**입니다.

| Tool | 분류 | 쓰기 여부 |
|------|------|-----------|
| `egov_search_knowledge` | 통합 검색 (공식 가이드, 개발자 지식, 공통컴포넌트, 호환 소프트웨어) | 읽기 전용 |

### `egov_search_knowledge`

eGovFrame 참조 자료를 조회하는 읽기 전용 도구입니다. 무언가를 저장하거나 새로 생성하지 않습니다. `annotations` 는 `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false` 입니다.

#### 파라미터

모든 파라미터는 선택입니다. 정의되지 않은 최상위 키는 오류 없이 버려지므로, 필터는 반드시 `filters` 객체 안에 넣습니다. 값이 `null` 인 파라미터는 지정하지 않은 것으로 봅니다. `filters` 를 뺀 나머지 파라미터는 값이 빈 문자열이어도 지정하지 않은 것으로 봅니다.

| 파라미터 | 타입 | 설명 |
|----------|------|------|
| `query` | string (최대 10,000자) | 검색 질문 또는 키워드. `guide`, `knowledge`, `all` 에서는 필수이고(`knowledge` 의 `filters.sort: "recent"` 와 `guide` 의 `filters.chunkId` 는 예외), `components` 와 `compatibility` 에서는 키워드 검색어로 쓰입니다. 글자나 숫자가 하나도 없는 값(공백뿐인 값, `???`)은 지정하지 않은 것으로 봅니다. |
| `scope` | string (enum) | `auto`(기본), `guide`, `knowledge`, `components`, `compatibility`, `all`. `auto` 는 `action` 과 `filters` 가 가리키는 출처를 고릅니다. 가리키는 출처가 없으면 `query` 가 있을 때 `all` 로, 없을 때 `components` 로 처리하며, 이때 목록 필터도 없으면 공통컴포넌트 카테고리 개요로 응답합니다. `query` 없이 가이드 분류가 아닌 `filters.category` 만 준 호출은 `compatibility` 로 처리합니다. |
| `action` | string (enum) | `components` 에서만 쓰는 세부 동작. `get`, `info`, `dependencies`, `sourceFiles`, `readSource`, `ddl`, `dml`. |
| `filters` | object | scope 별 필터. 아래 표에 있는 키만 받습니다. |
| `limit` | integer (1~200) | 최대 결과 수. `filters.limit` 과 함께 주면 최상위 값이 우선합니다. |
| `strictScope` | boolean | 효과가 없습니다. 기존 호출과의 호환을 위해 받기만 하며, 명시한 `scope` 는 항상 그대로 쓰입니다. |

문자열 입력(`query` 와 문자열 필터)은 유니코드 NFC 로 정규화하고, 줄바꿈과 탭을 포함한 제어 문자가 이어진 구간을 공백 하나로 바꾼 뒤 앞뒤 공백을 떼어 씁니다.

#### `filters` 키

따로 적지 않은 키의 값은 최대 500자의 문자열입니다. 값이 `null` 이거나 빈 문자열인 키, 빈 배열, 빈 문자열만 든 배열은 지정하지 않은 것으로 봅니다. `filters` 자체가 `null` 이어도 같습니다.

| 적용 대상 | 키 |
|-----------|-----|
| `guide` | `layer`, `category`, `chunkId` |
| `knowledge` | `type`(`solution`, `tip`, `pattern`, `error-fix`, `best-practice`, `gotcha` 중 하나), `tags`(문자열 배열, 최대 20개, 각 100자 이하), `minImportance`(1~5 의 정수), `verifiedOnly`(boolean), `sort`(`relevance` 또는 `recent`), `knowledgeScope`(`knowledge` 또는 `all`) |
| `components` | `componentId`(별칭 `component`, `id`), `componentIds`(문자열 배열, 최대 50개), `filePath`, `dbType`, `table`, `categoryId`, `keyword`, `version`, `hasWeb`(boolean) |
| `compatibility` | `frameworkVersion`, `category`, `vendor`, `productName`, `level`(1 또는 2), `minLevel`(1 또는 2), `includeKnowledge`(boolean) |
| 구간 조회 | `limit`(1~200 의 정수), `offset`(0 이상의 정수) |

- `chunkId` 는 가이드 검색 결과가 알려 주는 청크 ID 입니다. 이 값을 주면 검색하지 않고 그 청크의 본문을 `offset` 부터 6,000자씩 돌려주며, `query` 가 필요 없습니다.
- `type` 은 여섯 값을 받지만, 동봉된 데이터에는 `solution`(묻고답하기, FAQ)과 `best-practice`(적용가이드)만 있습니다.
- `componentId` 에는 컴포넌트 ID, 패키지명, 정확한 컴포넌트 이름을 쓸 수 있습니다. `componentId`, `component`, `id` 에 서로 다른 값을 함께 주면 오류입니다.
- `dbType` 은 `mysql`(기본), `maria`, `oracle`, `postgres`, `tibero`, `cubrid`, `altibase`, `goldilocks` 중 하나이고, 별칭 `mariadb`, `postgresql`, `pgsql` 도 받습니다.
- `frameworkVersion` 은 `"4.3"` 같은 문자열로 적습니다. 숫자는 받지 않습니다.
- `level` 은 호환성 레벨이 그 값과 같은 행을 고르고, `minLevel` 은 그 값 이상인 행을 고릅니다. 그래서 `minLevel: 1` 은 모든 행과 일치합니다.
- `offset` 은 이어서 조회할 위치입니다. `compatibility` 조회에서는 건너뛸 행의 수, `dml` 의 `table` 조회에서는 건너뛸 INSERT 문의 수, `readSource` 와 `chunkId` 조회에서는 이어 읽을 문자 위치입니다.

정의되지 않은 키, 타입이 맞지 않는 값, 길이나 개수의 상한을 넘는 값은 입력 검증 오류가 됩니다. 정의된 키라도 선택된 scope 나 action 이 쓰지 않으면 무시하고, 응답 끝에 `> 이 조회에 적용되지 않아 무시한 필터: tags, frameworkVersion.` 형태로 알립니다. 조회가 쓰지 않은 최상위 `query` 와 `limit` 도 `> 이 조회에 쓰이지 않아 무시한 파라미터: query, limit.` 형태로 알립니다. 값이 기본값과 같은 필터(`includeKnowledge: false`, `verifiedOnly: false`, `sort: "relevance"`, `minImportance: 1`)는 출처를 고르는 데 쓰이지 않고, 무시한 필터로도 알리지 않습니다.

#### `action` (`components` 전용)

| `action` | 대상을 정하는 필터 | 반환 |
|----------|--------------------|------|
| (생략) | `componentId` | 컴포넌트 상세. `componentId` 가 없으면 `query` 와 목록 필터에 따라 키워드 검색 결과, 필터 목록, 카테고리 개요 중 하나를 돌려줍니다. |
| `get`, `info` | `componentId` | 컴포넌트 상세 (기본 정보, 설명, 사용 테이블, 의존성) |
| `dependencies` | `componentIds` 또는 `componentId` | 의존성 해결 결과 |
| `sourceFiles` | `componentId` | 소스 파일 목록 |
| `readSource` | `filePath`, `offset` | 파일 내용 (한 번에 30,000자) |
| `ddl` | `componentId`, `dbType` | CREATE TABLE, 인덱스, 뷰 문. 외래 키가 참조하는 테이블의 문도 함께 싣습니다. |
| `dml` | `componentId`, `dbType`, `table`, `limit`, `offset` | 초기 데이터 INSERT 문. `table` 을 주지 않으면 테이블마다 처음 20건을 싣습니다. |

`action` 을 지정한 조회는 `query` 를 쓰지 않고, `limit` 은 `dml` 의 `table` 조회에서만 씁니다. `action` 을 `components` 가 아닌 scope 와 함께 주면 오류입니다. `action` 과 `componentId` 가 모두 없는 `components` 호출에 `componentIds`, `filePath`, `dbType`, `table` 가운데 하나라도 주면, `query` 나 다른 필터가 함께 있어도 필요한 `action` 을 알리는 오류가 됩니다. `componentId` 를 함께 주었으면 컴포넌트 상세를 돌려주고 그 필터는 무시한 필터로 알립니다.

#### `limit` 의 기본값과 최댓값

| scope | 기본값 | 최댓값 |
|-------|--------|--------|
| `guide` | 5 | 20 |
| `knowledge` | 5 | 20 |
| `components` (키워드 검색) | 20 | 200 |
| `compatibility` | 20 | 50 |
| `all` | 출처마다 5 | 출처마다 10 |

최댓값을 넘는 값은 최댓값으로 줄여 적용하고, 응답 끝에 `> 요청한 limit 25 은(는) guide 범위의 최댓값 20 으로 줄여 적용했습니다.` 형태로 알립니다. 통합 검색(`all`)은 ``> 통합 검색은 출처마다 최대 10건을 싣습니다. 요청한 limit 200 은(는) 10 으로 줄여 적용했습니다. 한 출처의 결과를 더 보려면 `scope` 로 그 출처를 지정해 조회하세요.`` 를 응답 끝에 한 번만 붙입니다. `query` 없이 목록 필터만 준 공통컴포넌트 조회는 `limit` 을 주지 않으면 조건에 맞는 컴포넌트를 모두 돌려줍니다. `action: "dml"` 에 `filters.table` 을 준 조회에서는 `limit` 이 한 번에 돌려줄 INSERT 문의 수이며, 기본값과 최댓값이 모두 100 입니다.

#### 응답

응답의 `content` 는 `text` 항목 하나입니다. 본문 뒤에는 무시한 입력, 줄여 적용한 `limit`, 다음 구간을 조회하는 방법을 알리는 `> ` 로 시작하는 안내 줄이 붙을 수 있습니다.

| scope | `text` 의 형태 |
|-------|----------------|
| `guide` | 마크다운. `## eGovFrame 가이드 검색 결과 (N건)` 아래에 결과마다 제목, 문서, 분류, 소스, URL, 유사도, 본문이 나옵니다. 색인할 때 여러 조각으로 나뉜 절의 결과에는 조각 번호와 이웃 조각의 청크 ID 를 적은 `조각` 줄이 더 있습니다. 1,500자를 넘는 본문은 앞 1,500자만 싣고, 나머지를 `filters.chunkId` 로 이어 읽는 방법을 알립니다. |
| `knowledge` | `## 개발자 지식 검색 결과` 아래의 JSON 코드 블록 |
| `components` | 마크다운 (표, 목록, 코드 블록) |
| `compatibility` | `## 호환 소프트웨어 검색 결과` 아래의 JSON 코드 블록. `query` 를 준 조회에는 키워드 검색이 일치한 방식을 알리는 `matchMode`(`all-terms` 또는 `any-term`)가 함께 실립니다. |
| `all` | `# 통합 지식 검색 결과` 아래에 네 출처의 결과가 `---` 로 나뉘어 이어집니다. |

#### 대표 호출

공통컴포넌트를 키워드로 찾습니다. 동봉된 데이터에서는 응답이 `## 공통컴포넌트 목록 (13개 중 5개 표시)` 로 시작하는 표입니다.

```json
{
  "query": "게시판",
  "scope": "components",
  "limit": 5
}
```

표준프레임워크 4.3 과 호환되는 소프트웨어를 조회합니다. 응답 JSON 의 `total` 은 조건에 맞는 전체 건수, `count` 는 이번에 돌려준 건수이고(동봉된 데이터에서는 42 와 20), 남은 결과는 `filters.offset` 으로 이어서 조회합니다.

```json
{
  "scope": "compatibility",
  "filters": {
    "frameworkVersion": "4.3"
  }
}
```

공식 가이드를 의미 검색합니다.

```json
{
  "query": "MyBatis 설정 방법",
  "scope": "guide",
  "limit": 1
}
```

## 오류 응답

도구 호출의 오류는 JSON-RPC 오류가 아니라 `isError: true` 인 도구 결과로 돌아오고, 원인은 `content` 의 `text` 에 담깁니다.

| 상황 | `text` |
|------|--------|
| 등록되지 않은 도구 이름 호출 | `MCP error -32602: Tool <이름> not found` |
| 입력 스키마 위반 (enum 에 없는 `scope` 나 `action`, 범위를 벗어난 `limit`, 상한을 넘는 문자열 길이나 배열 길이, `filters` 의 정의되지 않은 키나 틀린 타입) | `MCP error -32602: Input validation error: Invalid arguments for tool egov_search_knowledge: [...]`. 배열의 항목마다 틀린 위치를 가리키는 `path` 와 `message` 가 있습니다. |
| 필수 값 누락, 지원하지 않는 조합 | 원인 문구. 예: `query is required for guide search`, `filters.componentId is required for component ddl lookup` |
| 인덱스에 없는 `filters.chunkId` | `filters.chunkId 에 해당하는 가이드 청크를 찾을 수 없습니다: <값>.` 으로 시작하는 문구. 청크 ID 는 지식베이스를 갱신하거나 다시 구축하면 바뀌므로, 다시 검색해서 새 ID 를 얻습니다. |
| 지식베이스, 임베딩 모델, 공통컴포넌트 소스가 없거나 읽을 수 없음, Node.js 버전이 맞지 않음 | 원인과 조치를 담은 문구. [MCP_SETUP_GUIDE.md](./MCP_SETUP_GUIDE.md#문제-해결)의 표를 참고합니다. |
| 통합 검색에서 네 출처가 모두 실패 | 출처별 실패 문구를 담은 통합 검색 본문. 일부 출처만 실패하면 `isError` 없이 정상 응답이고, 실패한 출처의 자리에만 `검색 중 오류가 발생했습니다: <원인>` 이 실립니다. |
| 그 밖의 내부 오류 | `내부 오류가 발생했습니다. 자세한 내용은 MCP 서버 로그(stderr)를 확인하세요.` |

등록되지 않은 이름 `search_guide` 를 호출한 결과는 다음과 같습니다.

```json
{
  "content": [{ "type": "text", "text": "MCP error -32602: Tool search_guide not found" }],
  "isError": true
}
```

`limit` 에 문자열 `"5"` 를 준 호출의 결과는 다음과 같습니다.

```json
{
  "content": [
    {
      "type": "text",
      "text": "MCP error -32602: Input validation error: Invalid arguments for tool egov_search_knowledge: [\n  {\n    \"expected\": \"number\",\n    \"code\": \"invalid_type\",\n    \"path\": [\n      \"limit\"\n    ],\n    \"message\": \"Invalid input: expected number, received string\"\n  }\n]"
    }
  ],
  "isError": true
}
```

조건에 맞는 결과가 없거나 컴포넌트를 찾지 못한 것은 오류가 아닙니다. 이때는 `isError` 없이 안내 문구나 빈 결과가 돌아옵니다. 응답에는 스택 트레이스, 절대 경로, 내부 SQL 이 실리지 않습니다.

## Prompts

프롬프트를 제공하지 않습니다. `prompts/list` 요청은 JSON-RPC 오류 `-32601 Method not found` 로 거부됩니다.

## Resources

리소스를 제공하지 않습니다. `resources/list` 와 `resources/templates/list` 요청은 JSON-RPC 오류 `-32601 Method not found` 로 거부됩니다.

## 제거된 옛 도구 이름 처리

`src/server.ts` 는 `McpServer` 와 `server.registerTool(...)` 로 위의 도구 하나만 등록합니다. 과거에 따로 노출되던 이름(`search_guide`, `list_common_components`, `egov_scaffold_project` 등)과 표준·Custom 용어사전 기능을 제거하면서 없앤 이름(`egov_ddl_assist`, `search_standard_terms`, `get_standard_term`)을 안내하는 핸들러는 두지 않습니다. 이런 이름으로 호출하면 위 표의 "등록되지 않은 도구 이름 호출" 과 같은 결과가 돌아옵니다. 옛 이름의 목록은 [EXPOSED_TOOLS.md](./EXPOSED_TOOLS.md#노출되지-않는-도구)에 있습니다.
