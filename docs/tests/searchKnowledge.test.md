# `searchKnowledge.test.ts`

`egov_search_knowledge` 를 호출했을 때 돌아오는 응답을 검증하는 통합 테스트입니다. [server.test.md](./server.test.md)가 무엇이 노출되는지를 고정한다면, 이 파일은 노출된 도구를 호출하면 무엇이 돌아오는지를 고정합니다.

> - 위치: `tests/integration/searchKnowledge.test.ts`
> - 실행: `npm test` 또는 `npx vitest run tests/integration/searchKnowledge.test.ts`
> - 분류: 통합 테스트. 빌드된 서버를 자식 프로세스로 실행하고 저장소에 동봉된 지식베이스를 조회함

## 1. 이 테스트가 검증하는 것

- `action` 처리: `components` 범위에서 `action` 을 지정하면 `filters.componentId` 가 함께 있어도 상세 정보가 아니라 그 `action` 의 결과가 돌아옵니다.
- 공식 가이드 응답의 형식: 결과의 URL, 본문 속 제목과 구분선의 처리, 잘린 본문의 코드 블록 닫기, 같은 본문의 중복 제거, `filters.chunkId` 로 청크 하나를 읽는 조회를 확인합니다.
- `scope` 추론: `scope` 를 생략하면 `action`, 필터의 종류, `query` 의 유무에 따라 조회할 출처가 정해집니다.
- 입력 검증: `limit` 의 범위를 벗어난 값, `filters` 의 알 수 없는 키, 타입이 틀린 값, 지나치게 긴 값을 입력 스키마가 거부합니다. 값이 `null` 이거나 빈 문자열인 입력은 지정하지 않은 것으로 받습니다.
- 출처별 조회: 공통컴포넌트(후보 안내, 겹치던 ID, 사용 테이블, 키워드 검색의 안내 줄, `dml` 과 `readSource` 의 구간 조회), 호환 소프트웨어(`filters.offset`, `filters.level`, `filters.vendor`, 키워드 검색 응답의 필드), 개발자 지식(최근 목록, `tags` 와 `type` 의 안내), 통합 검색(출처별 필터 적용, 출처마다 싣는 건수)의 응답을 확인합니다.
- 쓰이지 않은 입력의 안내: 선택된 `scope` 나 `action` 이 쓰지 않는 필터와 최상위 `query`, `limit` 은 무시하고, 응답에 그 사실을 알리는 줄을 붙입니다.
- 공개 스키마: `tools/list` 로 공개되는 입력 스키마와 `annotations`, 서버 버전이 정해 둔 것과 같습니다.
- 파일 보존: 조회 호출은 `knowledge-base/egovframe.db` 를 바꾸지 않습니다.

모든 호출이 MCP 클라이언트와 서버를 거치므로 입력 스키마 검증부터 응답 포맷까지 한 번에 확인합니다. 조회 로직의 세부 규칙은 단위 테스트가 다룹니다([README.md](./README.md)의 단위 테스트 표 참고).

## 2. 파일 구조와 헬퍼

- `describe` 묶음마다 `beforeAll` 에서 [`createMcpClient()`](./_helper.md)로 서버를 하나씩 실행하고 `afterAll` 에서 닫습니다. 마지막 묶음인 `integration — 지식베이스 파일 보존` 만은 서버 종료 시점까지 확인해야 해서 케이스 안에서 전용 클라이언트를 만들고 닫습니다.
- 호출은 헬퍼의 `callSearchKnowledge(client, args)` 로 하고, 결과의 `text`(본문)와 `isError`(오류 결과 여부)를 확인합니다.
- 파일 안에 도우미 함수가 둘 있습니다. `parseJsonBlock(text)` 는 응답의 첫 번째 `json` 코드 블록을 파싱하고, `splitSections(text)` 는 통합 검색 응답을 `---` 구분선으로 나눕니다. 묶음 안에만 있는 도우미로는 동봉 가이드 인덱스에서 본문이 가장 긴 청크를 고르는 `longestChunk()`, 응답의 표에 실린 컴포넌트 ID 를 순서대로 뽑는 `listedIds(text)` 가 있습니다.
- 어떤 종류의 응답이 돌아왔는지는 그 응답에만 나오는 문구로 구분합니다.

| 상수 | 문구 | 나오는 응답 |
|---|---|---|
| `DETAIL_MARKER` | `### 기본 정보` | 공통컴포넌트 상세 정보 |
| `ALL_MARKER` | `통합 지식 검색 결과` | 통합 검색(`scope` 가 `all`) |
| `OVERVIEW_MARKER` | `공통컴포넌트 카테고리` | 공통컴포넌트 카테고리 개요 |
| `COMPAT_MARKER` | `호환 소프트웨어 검색 결과` | 호환 소프트웨어 조회 |
| `IGNORED_MARKER` (필터 안내 묶음, 입력 안내 묶음) | `적용되지 않아 무시한 필터` | 무시한 필터를 알리는 안내 줄 |
| `UNUSED_PARAM_MARKER` | `쓰이지 않아 무시한 파라미터` | 쓰이지 않은 최상위 `query`, `limit` 을 알리는 안내 줄 |
| `ANY_TERM_MARKER` | `들어 있는 항목을 표시합니다` | 공통컴포넌트 목록에서 일부 검색어만 일치한 결과임을 알리는 안내 줄 |
| `IGNORED_MARKER` (공통컴포넌트 조회 묶음) | `일치하는 항목이 없어 검색에 쓰지 않은 낱말` | 일치하는 항목이 없어 쓰지 않은 낱말을 알리는 안내 줄 |
| `DROPPED_MARKER` | `목록의 모든 항목에 해당해 검색에 쓰지 않은 낱말` | 검색에서 뺀 낱말을 알리는 안내 줄 |
| `WITHOUT_FILTERS_MARKER` | `필터를 빼면` | 필터를 뺀 조회를 권하는 안내 줄 |

`IGNORED_MARKER` 는 묶음에 따라 가리키는 문구가 다릅니다. 아래 표에서는 안내 줄을 다음 이름으로 부릅니다.

- 무시한 필터 안내 줄: `적용되지 않아 무시한 필터` 가 든 줄
- 쓰이지 않은 파라미터 안내 줄: `쓰이지 않아 무시한 파라미터` 가 든 줄
- 대체 검색 안내 줄: `들어 있는 항목을 표시합니다` 가 든 줄
- 쓰지 않은 낱말 안내 줄: `일치하는 항목이 없어 검색에 쓰지 않은 낱말` 이 든 줄
- 뺀 낱말 안내 줄: `목록의 모든 항목에 해당해 검색에 쓰지 않은 낱말` 이 든 줄

## 3. 케이스 상세

케이스 열은 `it` 이름 그대로입니다. 전제 열의 `모델` 은 임베딩 모델이 없으면 건너뛰는 케이스이고, `소스` 는 공통컴포넌트 소스가 없으면 건너뛰는 케이스입니다. `isError` 라고 적은 칸은 도구가 오류 결과로 응답하는지를 확인한다는 뜻입니다.

### 3-1. components 의 action 처리

`describe` 이름은 `integration — egov_search_knowledge components action 라우팅` 입니다. 이 묶음의 호출은 모두 `scope: "components"` 를 지정하며, 표에는 나머지 인자만 적습니다.

| 케이스 | 호출 | 확인하는 것 | 전제 |
|---|---|---|---|
| `action 없이 componentId 만 주면 상세 정보를 반환한다` | `filters: { componentId: "bbs" }` | `### 기본 정보` 와 `egovframework.com.cop.bbs` 가 있음 | |
| `action get 은 componentId 의 상세 정보를 반환한다` | `action: "get"`, `filters: { componentId: "bbs" }` | `### 기본 정보` 가 있음 | |
| `빈 문자열 action 은 지정하지 않은 것으로 처리한다` | `action: ""`, `filters: { componentId: "bbs" }` | `### 기본 정보` 가 있음 | |
| `action get 에 componentId 가 없으면 오류로 응답한다` | `action: "get"` | `isError`. 본문에 `filters.componentId is required` 가 있음 | |
| `action ddl 은 componentId 가 있어도 상세 정보가 아니라 CREATE TABLE 문을 반환한다` | `action: "ddl"`, `filters: { componentId: "bbs", dbType: "mysql" }` | `### 기본 정보` 가 없고 `DDL (mysql)` 과 `CREATE TABLE` 이 있음 | 소스 |
| `action dml 은 componentId 가 있어도 상세 정보가 아니라 INSERT 문을 반환한다` | `action: "dml"`, `filters: { componentId: "bbs", dbType: "mysql" }` | `### 기본 정보` 가 없고 `초기 데이터 (mysql)` 과 `INSERT INTO` 가 있음 | 소스 |
| `action sourceFiles 는 componentId 가 있어도 상세 정보가 아니라 소스 파일 목록을 반환한다` | `action: "sourceFiles"`, `filters: { componentId: "bbs" }` | `### 기본 정보` 가 없고 `소스 파일 목록` 과 `src/main/java/egovframework/com/cop/bbs/` 가 있음. 다음 단계 안내에 `readSource` 가 있고 예전 도구 이름 `read_component_source` 가 없음 | 소스 |
| `action readSource 는 componentId 를 함께 줘도 파일 내용을 반환한다` | `action: "readSource"`, `filters: { componentId: "bbs", filePath: "src/main/java/egovframework/com/cop/bbs/service/Blog.java" }` | `### 기본 정보` 가 없고 파일 경로와 `java` 코드 블록이 있음 | 소스 |
| `action dependencies 는 배열 componentIds 로 의존성을 해결한다` | `action: "dependencies"`, `filters: { componentIds: ["bbs", "cmy"] }` | `의존성 해결 결과` 와 `egovframework.com.cop.bbs` 가 있음 | |
| `action dependencies 는 단수형 componentId 도 받아 의존성을 해결한다` | `action: "dependencies"`, `filters: { componentId: "bbs" }` | `### 기본 정보` 가 없고 `의존성 해결 결과` 가 있음 | |
| `action dependencies 에 컴포넌트 지정이 없으면 오류로 응답한다` | `action: "dependencies"` | `isError`. 본문에 `filters.componentIds` 가 있음 | |
| `componentId 별칭(filters.id)은 상세 조회 외의 action 에서도 인식된다` | `action: "ddl"`, `filters: { id: "bbs", dbType: "mysql" }` | `DDL (mysql)` 이 있음 | 소스 |
| `지원하지 않는 action 은 목록으로 넘어가지 않고 오류로 응답한다` | `action: "schema"` | `isError`. 본문에 지원하는 값인 `sourceFiles` 가 있고 `공통컴포넌트 카테고리` 가 없음 | |
| `Object.prototype 의 속성 이름을 action 으로 줘도 오류로 응답한다` | `action` 을 `"constructor"`, `"toString"`, `"__proto__"` 로 바꿔 가며 호출 | 세 경우 모두 `isError` | |

### 3-2. 공식 가이드 검색

`describe` 이름은 `integration — egov_search_knowledge 가이드 검색` 입니다.

| 케이스 | 호출 | 확인하는 것 | 전제 |
|---|---|---|---|
| `결과의 URL 은 가이드 사이트의 문서 주소를 가리킨다` | `scope: "guide"`, `query: "MyBatis 설정 방법"` | `**URL**: https://egovframework.github.io/egovframe-docs/` 로 시작하는 문서 주소가 있고 `doku.php` 가 없음 | 모델 |

### 3-3. 공식 가이드 검색 결과의 형식

`describe` 이름은 `integration — egov_search_knowledge 가이드 검색 결과의 형식` 입니다. 아래 네 케이스의 호출은 모두 `scope: "guide"` 를 지정하며, 표에는 나머지 인자만 적습니다.

| 케이스 | 호출 | 확인하는 것 | 전제 |
|---|---|---|---|
| `본문 속의 제목과 구분선이 결과의 제목·구분선과 섞이지 않는다` | `query: "Nexus 사용법 로그인 Repository 추가 artifact 등록"`, `limit: 3` | 코드 블록 밖의 제목 줄이 응답 제목(`## eGovFrame 가이드 검색 결과`)과 결과 제목(`### 1. ` 꼴) 세 개뿐이고, 구분선(`---`)이 결과 수보다 하나 적은 두 개임 | 모델 |
| `본문을 자를 때 열려 있는 코드 블록을 닫는다` | `query` 를 `"MyBatis 설정 방법"`, `"JEUS 설정"`, `"트랜잭션 설정 XML"`, `"스케줄링 설정"` 으로 바꿔 가며 `limit: 5` 로 호출 | 네 응답 모두 코드 블록을 여닫는 줄(백틱 세 개로 시작하는 줄)의 수가 짝수임 | 모델 |
| `본문이 같은 청크는 한 번만 싣는다` | `query: "Cache Size Device 설정 메모리 최대 오브젝트 수"`, `limit: 5` | 결과가 둘 이상이고, 결과마다 머리 부분을 뺀 본문이 서로 다름 | 모델 |
| `category 가 없는 문서는 분류에 layer 만 적는다` | `query: "시작하기 가이드 문서 구성"`, `filters: { layer: "gettingstarted.md" }` | `- **분류**: gettingstarted.md` 줄이 있고, 분류가 `gettingstarted.md > ` 로 끝나는 줄이 없음 | 모델 |

이 묶음 안에 `describe` 가 하나 더 있습니다. 이름은 `잘린 본문 이어 읽기 (filters.chunkId)` 이고, 바깥 묶음의 서버를 함께 씁니다. 앞의 세 케이스는 동봉된 공식 가이드 인덱스(`knowledge-base/egovframe_guide.lance`)를 LanceDB 로 직접 읽어 본문이 가장 긴 청크를 고르고, 그 청크의 ID 로 도구를 호출합니다. 청크 ID 는 인덱스를 다시 구축하면 바뀌므로 테스트에 고정해 두지 않습니다. 아래 표에서 `chunkId` 만 적은 칸은 그 청크의 ID 를 뜻하고, N 은 읽은 청크의 본문 길이입니다.

| 케이스 | 호출 | 확인하는 것 | 전제 |
|---|---|---|---|
| `chunkId 를 주면 query 없이 그 청크의 본문을 돌려주고, 표시한 범위를 알려 준다` | `scope: "guide"`, `filters: { chunkId }` | 오류가 아님. 청크의 제목이 있음. `전체 N자 중 1~M자를 표시했습니다` 가 있음(M 은 N 과 6,000 가운데 작은 값). N 이 6,000 을 넘으면 `filters.offset: 6000` 이, 넘지 않으면 `(청크의 끝)` 이 있음. 원문 앞부분의 한 줄이 응답에 그대로 있음 | |
| `scope 를 생략해도 chunkId 만으로 가이드 청크를 읽고, filters.offset 부터 이어 읽는다` | `filters: { chunkId, offset }`. `offset` 은 N 의 절반이고 `scope` 는 주지 않음 | 오류가 아님. 범위 안내가 `전체 N자 중` 다음에 `offset` 보다 1 큰 위치부터 시작함 | |
| `청크를 이어 읽을 때 함께 준 query 와 limit 은 쓰이지 않았다고 알린다` | `scope: "guide"`, `query: "트랜잭션"`, `limit: 3`, `filters: { chunkId }` | 쓰이지 않은 파라미터 안내 줄에 `query` 와 `limit` 이 있음 | |
| `없는 chunkId 는 다시 검색하라는 안내로 답한다` | `scope: "guide"`, `filters: { chunkId: "00000000-0000-0000-0000-000000000000" }` | `isError`. 본문에 `chunkId` 와 `다시 검색` 이 있음 | |
| `검색 결과가 알려 준 chunkId 로 그 청크를 읽을 수 있다` | `scope: "guide"`, `query: "받은쪽지함관리 컴포넌트의 배포파일명과 포함 테이블"`, `limit: 5` 를 호출한 뒤, 응답에 실린 `chunkId` 가운데 첫 번째 값으로 `scope: "guide"`, `filters: { chunkId }` 를 호출 | 첫 응답에 예전의 잘림 표지 `... (truncated)` 가 없음. 둘째 응답이 오류가 아니고 `전체 N자 중 1~` 로 시작하는 범위 안내가 있음. 첫 응답에 `chunkId` 가 하나도 없으면 둘째 호출은 하지 않음 | 모델 |

지금의 동봉 인덱스에는 6,000자를 넘는 청크가 없어서 첫 케이스는 `(청크의 끝)` 쪽을 확인합니다. 긴 청크를 6,000자씩 나눠 읽는 규칙과 조각 줄, 같은 절의 조각 묶기는 단위 테스트 `tests/unit/guideGateway.test.ts` 가 고정 데이터로 확인합니다.

### 3-4. scope 추론

`describe` 이름은 `integration — egov_search_knowledge scope 추론` 입니다.

| 케이스 | 호출 | 확인하는 것 | 전제 |
|---|---|---|---|
| `scope 없이 action 을 주면 query 가 있어도 components 로 처리한다` | `query: "게시판"`, `action: "ddl"`, `filters: { componentId: "bbs", dbType: "mysql" }` | `DDL (mysql)` 이 있고 `통합 지식 검색 결과` 가 없음 | 소스 |
| `scope 없이 준 action 의 필수 필터가 빠지면 통합 검색에 묻히지 않고 오류로 응답한다` | `query: "설정"`, `action: "sourceFiles"` | `isError`. 본문에 `filters.componentId is required` 가 있음 | |
| `query 없이 어느 출처의 분류도 아닌 category 만 주면 compatibility 로 처리해 쓸 수 있는 분류를 알려 준다` | `filters: { category: "Web Server" }` | 오류가 아님. `호환 소프트웨어 검색 결과` 가 있고 `공통컴포넌트 카테고리` 가 없음. 응답의 `total` 이 0 이고 `available.categories` 에 `WAS` 가 있음 | |
| `호환성 전용 필터만 주면 compatibility 로 처리한다` | `filters: { minLevel: 2 }` | `호환 소프트웨어 검색 결과` 가 있고 `공통컴포넌트 카테고리` 가 없음 | |
| `호환 소프트웨어 분류 이름을 category 로 주면 compatibility 로 처리한다` | `filters: { category: "WAS" }` | `호환 소프트웨어 검색 결과` 가 있음 | |
| `가이드 전용 필터(layer)는 query 가 없으면 가이드 검색의 query 필수 오류로 응답한다` | `filters: { layer: "egovframe-runtime" }` | `isError`. 본문이 `query is required for guide search` 임 | |
| `지식 전용 필터(tags)는 query 가 없으면 지식 검색의 query 필수 오류로 응답한다` | `filters: { tags: ["faq"] }` | `isError`. 본문이 `query is required for knowledge search` 임 | |
| `layer 필터와 query 를 주면 가이드만 검색한다` | `query: "트랜잭션 설정"`, `filters: { layer: "egovframe-runtime" }` | `eGovFrame 가이드 검색 결과` 가 있고 `통합 지식 검색 결과` 가 없음 | 모델 |
| `가이드 분류 이름을 category 로 주면 가이드만 검색한다` | `query: "트랜잭션 설정"`, `filters: { category: "persistence-layer" }` | `eGovFrame 가이드 검색 결과` 가 있고 `통합 지식 검색 결과` 가 없음 | 모델 |
| `효과가 없는 기본값을 채운 필터는 출처를 정하지 않는다` | `filters: { includeKnowledge: false, verifiedOnly: false, sort: "relevance", minImportance: 1 }` | 오류가 아님. 필터를 주지 않은 호출처럼 `공통컴포넌트 카테고리` 개요가 나오고 `호환 소프트웨어 검색 결과` 가 없음 | |
| `문자나 숫자가 하나도 없는 query 는 없는 것으로 처리한다` | `scope: "guide"`, `query: "???"` 와, `query: "?!"` 만 준 호출 | 첫 호출은 `isError` 이고 본문이 `query is required for guide search` 임. 둘째 호출은 `공통컴포넌트 카테고리` 개요를 돌려줌 | |
| `components 가 아닌 scope 에 action 을 주면 오류로 응답한다` | `scope` 를 `"guide"`, `"knowledge"`, `"compatibility"`, `"all"` 로 바꿔 가며 `query: "게시판"`, `action: "ddl"`, `filters: { componentId: "bbs" }` | 네 경우 모두 `isError`. 본문에 `components` 가 있음 | |
| `공백뿐인 query 는 없는 것으로 처리한다` | 공백 세 칸뿐인 `query` 만 준 호출과, `scope: "guide"` 에 공백, 줄바꿈, 탭뿐인 `query` 를 준 호출 | 첫 호출은 `공통컴포넌트 카테고리` 개요를 돌려줌. 둘째 호출은 `isError` 이고 본문이 `query is required for guide search` 임 | |
| `strictScope 는 결과에 영향을 주지 않는다` | `scope: "components"`, `query: "게시판"` 을 `strictScope: true` 와 함께 준 호출과 빼고 준 호출 | 두 응답의 본문이 같음 | |

### 3-5. 입력 검증

`describe` 이름은 `integration — egov_search_knowledge 입력 검증` 입니다. 입력 스키마를 어긴 호출은 예외가 아니라 `isError` 결과로 돌아오며, 본문에 어긋난 필드의 이름이 들어 있습니다.

| 케이스 | 호출 | 확인하는 것 | 전제 |
|---|---|---|---|
| `limit 은 1 이상의 정수만 받는다` | `scope: "components"`, `query: "게시판"` 에 `limit` 을 `0`, `-1`, `2.5` 로 바꿔 가며 호출 | 세 경우 모두 `isError`. 본문에 `limit` 이 있음 | |
| `스키마 최댓값(200)을 넘는 limit 은 거부한다` | `scope: "components"`, `query: "게시판"`, `limit: 201` | `isError`. 본문에 `limit` 이 있음 | |
| `filters.limit 에도 같은 검증을 적용한다` | `scope: "components"`, `query: "게시판"`, `filters: { limit: -5 }` | `isError`. 본문에 `limit` 이 있음 | |
| `filters 의 알 수 없는 키는 무시하지 않고 거부한다` | `scope: "components"`, `filters: { componentid: "bbs" }` | `isError`. 본문에 `componentid` 가 있음 | |
| `filters 값의 타입이 틀리면 거부한다` | `scope: "compatibility"`, `filters: { frameworkVersion: 4.3 }` 과, `scope: "knowledge"`, `query: "설정"`, `filters: { tags: "faq" }` | 두 호출 모두 `isError`. 본문에 각각 `frameworkVersion`, `tags` 가 있음 | |
| `값이 null 이거나 빈 문자열인 선택 파라미터와 필터는 지정하지 않은 것으로 받는다` | 네 호출. 첫째는 `scope: "compatibility"` 에 `query`, `action`, `limit`, `strictScope` 를 모두 `null` 로 주고 `filters: { frameworkVersion: "4.3", vendor: null, category: null, productName: "", minLevel: null }` 를 줌. 둘째는 `scope: "knowledge"`, `filters: { sort: "recent", type: "", knowledgeScope: "", tags: null }`, `limit: 1`. 셋째는 `scope: ""`, `filters: { componentId: "uia" }`. 넷째는 `scope: "components"`, `filters: null` | 네 호출 모두 오류가 아님. 첫째 응답의 `filters` 에는 `frameworkVersion` 만 있음. 둘째 응답의 `count` 가 1 임. 셋째 응답에 `### 기본 정보` 가 있음. 넷째 응답은 `공통컴포넌트 카테고리` 개요임 | |
| `지나치게 긴 값은 입력 검증 오류로 거부한다` | `scope: "components"` 에 10,001자인 `query` 를 준 호출, `scope: "compatibility"` 에 501자인 `filters.vendor` 를 준 호출, `scope: "knowledge"`, `query: "설정"` 에 항목이 21개인 `filters.tags` 를 준 호출 | 세 호출 모두 `isError`. 본문에 각각 `query`, `vendor`, `tags` 가 있음 | |
| `범위별 최댓값을 넘는 limit 은 최댓값으로 줄이고 그 사실을 알린다` | `scope: "compatibility"`, `filters: { frameworkVersion: "4.2" }`, `limit: 150` | 오류가 아님. 본문에 `요청한 limit 150 은(는) compatibility 범위의 최댓값 50 으로 줄여 적용했습니다` 가 있음. 응답의 `limit` 이 50 이고 `software` 가 50건 이하임 | |
| `호환 소프트웨어를 최댓값만큼 조회한 응답은 50,000자를 넘지 않는다` | `scope: "compatibility"`, `limit: 50` 을 조건 없이 준 호출, `query: "CMS"` 를 더한 호출, `query: "CMS"` 와 `filters: { includeKnowledge: true }` 를 더한 호출 | 세 호출 모두 오류가 아니고 `software` 가 50건이며, 본문이 40,000자 미만임 | |

마지막 케이스의 이름에 있는 50,000자는 큰 결과를 본문 대신 파일로 넘기는 MCP 클라이언트의 기준을 가리킵니다. 단언은 그보다 작은 40,000자를 기준으로 봅니다.

### 3-6. 공통컴포넌트 조회

`describe` 이름은 `integration — egov_search_knowledge 공통컴포넌트 조회` 입니다. 이 묶음의 호출은 `scope: "components"` 를 지정하며, 표에는 나머지 인자만 적습니다. `scope` 를 주지 않은 호출은 칸에 따로 적었습니다.

| 케이스 | 호출 | 확인하는 것 | 전제 |
|---|---|---|---|
| `컴포넌트를 찾지 못하면 비슷한 컴포넌트의 ID 를 함께 알려 준다` | `filters: { componentId: "로그인" }` | 오류가 아님. `컴포넌트를 찾을 수 없습니다: 로그인` 과 `비슷한 컴포넌트` 가 있음. 후보가 다섯 개이고 첫 후보가 `uia` 이며, `uap` 로그인정책관리가 후보에 있음 | |
| `후보가 없는 입력에는 후보 목록을 붙이지 않는다` | `filters: { componentId: "zzz-없는컴포넌트" }` | `컴포넌트를 찾을 수 없습니다: zzz-없는컴포넌트` 가 있고 `비슷한 컴포넌트` 가 없음 | |
| `기호로 이은 입력을 조각으로 나눠 후보를 찾지 않는다` | `filters.componentId` 를 `"zzz-없는-컴포넌트"`, `"egovframework.com.zzz"` 로 바꿔 가며 호출 | 두 경우 모두 오류가 아니고, 본문 전체가 `컴포넌트를 찾을 수 없습니다: <입력>` 한 줄임 | |
| `컴포넌트 이름으로도 ddl 을 조회할 수 있다` | `action: "ddl"`, `filters: { componentId: "블로그관리" }` | `DDL (mysql)` 과 `CREATE TABLE` 이 있음 | 소스 |
| `파일 기능에서 컴포넌트를 찾지 못해도 후보를 알려 준다` | `action: "sourceFiles"`, `filters: { componentId: "로그인" }` | 오류가 아님. `컴포넌트를 찾을 수 없습니다: 로그인` 이 있고 `uap` 로그인정책관리가 후보에 있음 | 소스 |
| `메타의 id 가 겹치던 컴포넌트를 각각 조회할 수 있다` | `filters: { componentId }` 를 표 아래에 적은 ID 로 바꿔 가며 호출 | 응답의 첫 줄이 그 ID 의 컴포넌트 이름(`## <이름>`)임 | |
| `상세 정보의 사용 테이블은 컴포넌트가 실제로 쓰는 테이블이다` | `action: "get"` 에 `filters: { componentId: "cca" }` 를 준 호출과 `filters: { componentId: "mcm" }` 을 준 호출 | 공통코드(`cca`)의 응답에 `COMTCCMMNCODE` 가 있고 `COMTNCOMMUTE` 가 없음. 메뉴생성관리(`mcm`)의 응답에 `COMTNMENUINFO` 가 있고 `COMTNPRIVACYLOG` 가 없음 | |
| `ddl 은 컴포넌트가 실제로 쓰는 테이블의 CREATE 문을 돌려준다` | `action: "ddl"`, `filters: { componentId: "cca" }` | `CREATE TABLE COMTCCMMNCODE` 가 있고 `CREATE TABLE COMTNCOMMUTE` 가 없음 | 소스 |
| `동봉 DB 에는 메타에 적힌 컴포넌트가 모두 들어 있다` | 다른 인자 없음 | 통계의 `총 컴포넌트` 수가 `templates/common-components.json` 의 `totalComponents` 와 같음 | |
| `action 과 함께 써야 하는 필터만 주면 개요 대신 필요한 action 을 알려 준다` | 세 호출. 첫째는 `filters: { componentIds: ["bbs", "cmy"] }`. 둘째는 `scope` 없이 `filters: { filePath: "pom.xml" }`. 셋째는 `scope` 없이 `query: "게시판"`, `filters: { dbType: "oracle" }` | 세 호출 모두 `isError`. 본문에 필요한 `action` 이 따옴표로 묶여 있음: 첫째는 `"dependencies"`, 둘째는 `"readSource"`, 셋째는 `"ddl"` 과 `"dml"`. 첫째 본문에는 `filters.componentIds` 도 있음 | |
| `상세 조회에 쓰이지 않은 action 전용 필터는 어느 action 에서 쓰는지 함께 알린다` | `filters: { componentId: "uia", dbType: "oracle" }` | 오류가 아니고 `### 기본 정보` 가 있음. 무시한 필터 안내 줄에 `dbType` 과 `"ddl"` 이 있음 | |
| `query 와 목록 필터를 함께 주면 두 조건을 모두 적용한다` | `query: "login"`, `filters: { categoryId: "로그인" }`, `limit: 10` | `uia` 가 있고, 다른 카테고리에 속한 `rsc` 와 `oauth` 가 없음 | |
| `필터 목록에 limit 을 주면 전체 건수와 함께 그만큼만 보여 준다` | `filters: { keyword: "로그인" }`, `limit: 3` | 제목이 `공통컴포넌트 목록 (N개 중 3개 표시)` 형태임 | |
| `limit 을 주지 않은 필터 목록은 조건에 맞는 컴포넌트를 모두 보여 준다` | `filters: { hasWeb: false }` | 제목에 `개 중` 이 없고 건수가 20 보다 큼 | |
| `키워드 검색 결과가 limit 보다 많으면 전체 건수를 알린다` | `query: "관리"`, `limit: 2` | 제목이 `공통컴포넌트 목록 (N개 중 2개 표시)` 형태임 | |
| `낱말의 가운데에 든 검색어로도 찾는다` | `query: "증서"` | `sec`(인증서로그인)가 있고, 본문에 `모든 검색어가 들어 있는 항목이 없어` 가 없음 | |
| `모든 검색어가 든 컴포넌트가 없으면 대체 검색으로 찾았다는 것과 쓰지 않은 낱말을 알린다` | `query: "게시판 템플릿 없는낱말"` | `tpl` 이 있고 `모든 검색어가 들어 있는 항목이 없어` 가 있음. `검색에 쓰지 않은 낱말` 이 든 줄에 `없는낱말` 이 있고 `게시판` 이 없음 | |
| `대체 검색 안내는 쓴 검색어와 실제로 적용한 일치 기준을 밝힌다` | `query: "증서 통계 권한관리"` | `모든 검색어가 들어 있는 항목이 없어` 가 든 줄에 `검색어 3개 가운데 1개 이상` 과 `(검색어: 증서, 통계, 권한관리)` 가 있음 | |
| `query 에 OR 가 있으면 OR 로 찾았다고 알리고, 모든 검색어가 든 항목이 없다고 적지 않는다` | `query: "게시판 OR 댓글"`, `limit: 3` | 표의 첫 행이 두 낱말이 모두 든 `cmt` 임. 대체 검색 안내 줄이 `> query 에 OR 가 있어, 검색어 2개 가운데 1개 이상이 들어 있는 항목을 표시합니다 (검색어: 게시판, 댓글).` 하나임. `모든 검색어가 들어 있는 항목이 없어` 가 없음 | |
| `검색에서 뺀 낱말은 모든 검색어가 일치한 결과에도 따로 알린다` | `query: "게시판 컴포넌트"`, `limit: 3` 과, `query: "What's the login component?"`, `limit: 3` | 첫 응답은 표의 첫 행이 `bbs` 이고, 뺀 낱말 안내 줄이 `> 한 글자이거나, 영어 기능어이거나, 목록의 모든 항목에 해당해 검색에 쓰지 않은 낱말: 컴포넌트.` 하나이며, 대체 검색 안내 줄과 쓰지 않은 낱말 안내 줄이 없음. 둘째 응답은 뺀 낱말 안내 줄이 하나이고 `: What, the, component.` 로 끝남 | |
| `결과가 없으면 일치하는 항목이 없어 쓰지 않은 낱말과 검색에서 뺀 낱말을 모두 알린다` | `query: "Is the zzzqqq with x"` | `공통컴포넌트 목록 (0개)` 가 있음. 쓰지 않은 낱말 안내 줄이 `> 일치하는 항목이 없어 검색에 쓰지 않은 낱말: zzzqqq.` 임. 뺀 낱말 안내 줄이 하나이고 `: Is, the, with, x.` 로 끝남. 대체 검색 안내 줄이 없음 | |
| `필터 때문에 0건이면 필터를 뺐을 때 같은 query 에 일치하는 건수를 알린다` | 먼저 `query: "로그인"`, `limit: 1` 로 전체 건수 N 을 구함. 그다음 `query: "로그인"`, `filters: { categoryId: "게시판" }` 을 호출. 끝으로 `query: "zzzqqq"` 에 같은 필터를 준 호출, `query: "zzzqqq"` 만 준 호출, `query: "게시판"` 에 같은 필터를 준 호출 | N 이 1 보다 큼. 둘째 응답에 `공통컴포넌트 목록 (0개)`, `> 일치하는 항목이 없어 검색에 쓰지 않은 낱말: 로그인.`, `> 필터(categoryId)를 적용한 범위에는 일치하는 컴포넌트가 없습니다. 필터를 빼면 같은 query 로 N개를 찾습니다.` 가 있음. 나머지 세 응답에는 `필터를 빼면` 안내가 없음 | |
| `목록의 모든 항목에 해당하는 낱말은 쓸 수 있는 다른 검색어가 없으면 빼지 않고 검색어로 쓴다` | `query: "zzzqqq 컴포넌트"` | 결과가 한 건 이상임. 대체 검색 안내 줄이 하나이고 `(검색어: 컴포넌트)` 가 있음. 쓰지 않은 낱말 안내 줄이 `> 일치하는 항목이 없어 검색에 쓰지 않은 낱말: zzzqqq.` 임. 뺀 낱말 안내 줄이 없음 | |
| `검색어를 추출할 수 없는 query 는 없는 것으로 보고 필터 목록을 돌려준다` | `query: "*"`, `filters: { categoryId: "로그인" }` | `uia` 가 있음 | |
| `action dml 에 filters.table 과 filters.offset 을 주면 그 테이블의 구간만 반환한다` | `action: "dml"`, `filters: { componentId: "uia", dbType: "mysql", table: "COMTCCMMNDETAILCODE", offset: 100 }`, `limit: 50` | `- **테이블**: COMTCCMMNDETAILCODE` 와 `총 N건 중 101~150` 이 있고 `INSERT INTO` 가 50번 나옴 | 소스 |
| `action readSource 는 큰 파일을 나눠 돌려주고 이어 읽을 offset 을 알려 준다` | `action: "readSource"`, `filters: { filePath: "script/dml/mysql/com_DML_mysql.sql" }` 과, 같은 호출에 `filters.offset: 30000` 을 더한 호출 | 첫 응답에 `전체 N자 중 1~30,000자` 와 `filters.offset: 30000` 이 있음. 둘째 응답에 `30,001~60,000자` 와 `filters.offset: 60000` 이 있음. 두 응답의 본문이 서로 다름 | 소스 |
| `UTF-8 이 아닌 인코딩으로 읽은 파일은 머리말에 인코딩을 적는다` | `action: "readSource"` 로 `src/main/webapp/WEB-INF/jsp/egovframework/com/utl/sys/prm/EgovProcessMon.jsp` 와 `src/main/java/egovframework/com/cop/bbs/service/Blog.java` 를 각각 호출 | JSP 응답의 첫 줄이 `(751 bytes, jsp, EUC-KR)` 로 끝나고 `jsp` 코드 블록이 있음. Java 응답의 첫 줄은 `bytes, java)` 로 끝나서 인코딩 표시가 없음 | 소스 |
| `끝까지 읽은 파일에는 이어 읽기 안내를 붙이지 않는다` | `action: "readSource"`, `filters: { filePath: "src/main/java/egovframework/com/cop/bbs/service/Blog.java" }` | 본문에 `filters.offset` 이 없음 | 소스 |

겹치던 ID 케이스가 확인하는 ID 와 이름은 다음과 같습니다: `bbs` 게시판, `blog-management` 블로그관리, `cmt` 댓글관리, `uss-cmt` 출퇴근관리, `sim` 일정관리, `syi-sim` 시스템연계관리, `utl-sim` 시스템정보확인, `prm` 프로그램관리, `sys-prm` 프로세스 모니터링, `com` 협업공통, `sts-com` 통계공통.

### 3-7. 호환 소프트웨어 조회

`describe` 이름은 `integration — egov_search_knowledge 호환 소프트웨어 조회` 입니다. 이 묶음의 호출은 `scope: "compatibility"` 를 지정하며, 표에는 나머지 인자만 적습니다. `scope` 를 주지 않은 호출은 칸에 따로 적었습니다. 확인하는 값은 응답의 JSON 필드입니다.

| 케이스 | 호출 | 확인하는 것 | 전제 |
|---|---|---|---|
| `filters.offset 으로 다음 구간을 조회한다` | `filters: { category: "CMS Solution" }`, `limit: 10` 과, 같은 호출에 `filters.offset: 10` 을 더한 호출 | 첫 응답의 `total` 이 20 보다 크고 `offset` 이 0 임. 둘째 응답의 `offset` 이 10, `count` 가 10 이고 `total` 이 첫 응답과 같음. 두 구간에 겹치는 제품이 없음(제품명, 제품 버전, 프레임워크 버전으로 비교) | |
| `filters.level 은 그 호환성 레벨의 제품만 돌려준다 (scope 를 생략해도 compatibility 로 처리한다)` | `scope` 없이 `filters: { level: 1 }`, `limit: 50` 을 호출하고, 견줄 값으로 `filters: { minLevel: 1 }`, `limit: 1` 을 호출 | 첫 호출은 오류가 아님. 응답의 `filters.level` 이 1 이고 `total` 이 0 보다 크며, 실린 행의 `compatibility_level` 이 모두 1 임. 무시한 필터 안내 줄이 없음. `total` 이 `minLevel: 1` 로 조회한 `total` 보다 작음 | |
| `level 에 1, 2 가 아닌 값을 주면 입력 검증 오류다` | `filters: { level: 3 }` | `isError`. 본문에 `level` 이 있음 | |
| `제품명을 나열해 모든 검색어가 든 행이 없으면, 쓴 검색어와 낮춘 일치 기준을 함께 돌려준다` | `query: "JEUS Tibero WebLogic"`, `limit: 50` | 오류가 아님. `matchMode` 가 `any-term`, `usedTerms` 가 `["JEUS", "Tibero", "WebLogic"]`, `requiredMatches` 가 1 임. 제품명이 `JEUS` 인 행과 `Tibero` 인 행이 있음 | |
| `query 에 OR 가 있으면 orQuery 를 싣고, 낱말 가운데 하나라도 든 행을 돌려준다` | `query: "티맥스 OR LG"`, `limit: 50` 과, `OR` 가 없는 `query: "JEUS Tibero WebLogic"` | 첫 응답은 `matchMode` 가 `any-term`, `orQuery` 가 `true`, `usedTerms` 가 `["티맥스", "LG"]`, `requiredMatches` 가 1 이고 `droppedTerms` 가 없음. 업체명에 티맥스가 든 행과 LG 가 든 행이 모두 있고, 그 행들은 확인일자가 최근인 순으로 놓임. 'LG' 를 제품명의 낱말 가운데에서 찾은 행(2026-11-24 의 데이터에서는 `RealGridJS`)은 그 뒤에 옴. 둘째 응답에는 `orQuery` 가 없음 | |
| `검색에서 뺀 검색어는 droppedTerms 로 싣고, 뺀 낱말이 제품명에 든 제품을 맨 앞에 싣는다` | `query: "eGov CMS"`, `limit: 6` 과, `query: "Is Tibero compatible with eGovFrame 4.3?"`, `limit: 3` | 첫 응답은 `matchMode` 가 `all-terms`, `droppedTerms` 가 `["eGov"]` 이고 `usedTerms` 와 `ignoredTerms` 가 없음. `total` 이 100 보다 크고, 여섯 행 가운데 앞의 다섯 행만 제품명에 eGov 가 들어 있음. 둘째 응답은 `matchMode` 가 `any-term`, `usedTerms` 가 `["Tibero", "4.3"]`, `ignoredTerms` 가 `["compatible"]`, `droppedTerms` 가 `["Is", "with", "eGovFrame"]` 이고, 제품명이 `Tibero` 인 행이 2건임 | |
| `vendor 필터는 법인 표기가 달라도 같은 업체의 제품을 모두 돌려준다` | `filters.vendor` 를 `"(주)아이액츠"`, `"㈜아이액츠"`, `"주식회사 아이액츠"`, `"아이액츠"` 로 바꿔 가며 호출 | 응답의 `filters.vendor` 가 받은 값 그대로임. 네 응답의 `total` 이 모두 같고 1 보다 큼 | |

### 3-8. 적용되지 않는 필터 안내

`describe` 이름은 `integration — egov_search_knowledge 적용되지 않는 필터 안내` 입니다.

| 케이스 | 호출 | 확인하는 것 | 전제 |
|---|---|---|---|
| `조회에 쓰이지 않은 필터는 무시했다고 알린다` | `scope: "components"`, `query: "게시판"`, `filters: { tags: ["faq"], frameworkVersion: "4.3" }` | 무시한 필터 안내 줄에 `tags` 와 `frameworkVersion` 이 있음 | |
| `조회에 쓰인 필터만 준 호출에는 안내를 붙이지 않는다` | `scope: "components"`, `query: "게시판"`, `filters: { hasWeb: true }` 와, `scope: "compatibility"`, `filters: { frameworkVersion: "4.3", offset: 5 }` | 두 응답 모두 무시한 필터 안내 줄이 없음 | |
| `action 이 쓰지 않는 필터도 알린다` | `scope: "components"`, `action: "get"`, `filters: { componentId: "uia", dbType: "oracle", table: "COMTNEMPLYRINFO" }` | 무시한 필터 안내 줄에 `dbType` 과 `table` 이 있고 `componentId` 가 없음 | |
| `호환 소프트웨어 조회에서 쓰이지 않는 필터를 알린다` | `scope: "compatibility"`, `filters: { frameworkVersion: "4.3", layer: "egovframe-runtime" }` | 무시한 필터 안내 줄에 `layer` 가 있고 `frameworkVersion` 이 없음 | |

### 3-9. 쓰이지 않은 입력 안내

`describe` 이름은 `integration — egov_search_knowledge 쓰이지 않은 입력 안내` 입니다. 쓰이지 않은 최상위 파라미터의 안내와 함께, 별칭에 서로 다른 값을 준 호출, 빈 값만 든 배열, 응답에 되돌려 싣는 입력의 줄바꿈, 데이터에 없는 필터 값의 안내를 확인합니다.

| 케이스 | 호출 | 확인하는 것 | 전제 |
|---|---|---|---|
| `action 이 쓰지 않는 최상위 query 와 limit 을 알린다` | `scope: "components"`, `action: "get"`, `query: "게시판 상세"`, `limit: 5`, `filters: { componentId: "bbs" }` | 쓰이지 않은 파라미터 안내 줄에 `query` 와 `limit` 이 있음 | |
| `componentId 로 상세를 조회할 때 함께 준 query 를 알린다` | `scope: "components"`, `query: "게시판"`, `filters: { componentId: "bbs" }` | 쓰이지 않은 파라미터 안내 줄에 `query` 가 있고 `limit` 이 없음 | |
| `조회에 쓰인 query 와 limit 에는 안내를 붙이지 않는다` | 네 호출. `scope: "components"`, `query: "게시판"`, `limit: 3`. `scope: "components"`, `filters: { hasWeb: true }`, `limit: 3`. `scope: "compatibility"`, `query: "JEUS"`, `limit: 3`. `scope: "knowledge"`, `filters: { sort: "recent" }`, `limit: 2` | 네 호출 모두 오류가 아니고 쓰이지 않은 파라미터 안내 줄이 없음 | |
| `카테고리 개요는 limit 을 쓰지 않으므로 알린다` | `scope: "components"`, `limit: 3` | 쓰이지 않은 파라미터 안내 줄에 `limit` 이 있음 | |
| `최근 지식 목록은 query 를 쓰지 않으므로 알린다` | `scope: "knowledge"`, `query: "로그인"`, `filters: { sort: "recent" }`, `limit: 2` | 쓰이지 않은 파라미터 안내 줄에 `query` 가 있고 `limit` 이 없음 | |
| `sort recent 와 함께 준 knowledgeScope all 은 무시했다고 알린다` | `scope: "knowledge"`, `filters: { sort: "recent", knowledgeScope: "all" }`, `limit: 2` | 무시한 필터 안내 줄에 `knowledgeScope` 가 있음 | |
| `dml 기본 보기는 limit 을 쓰지 않으므로 알린다` | `scope: "components"`, `action: "dml"`, `filters: { componentId: "bbs" }`, `limit: 5` | 쓰이지 않은 파라미터 안내 줄에 `limit` 이 있음 | 소스 |
| `dml 구간 조회에서 최댓값을 넘는 limit 은 줄였다고 알린다` | `scope: "components"`, `action: "dml"`, `filters: { componentId: "bbs", table: "COMTCCMMNDETAILCODE" }`, `limit: 150` | 본문에 `요청한 limit 150 은(는) dml 구간 조회의 최댓값 100 으로 줄여 적용했습니다` 가 있고, 쓰이지 않은 파라미터 안내 줄이 없음 | 소스 |
| `통합 검색의 한 섹션이 쓰지 않은 limit 과 query 는 무시했다고 알리지 않는다` | `scope: "all"`, `query: "JEUS 설정"`, `filters: { componentId: "uia", limit: 1 }` | 오류가 아니고 `### 기본 정보` 가 있음. 무시한 필터 안내 줄과 쓰이지 않은 파라미터 안내 줄이 모두 없음 | |
| `componentId 와 별칭에 서로 다른 값을 주면 오류로 응답한다` | `scope: "components"`, `action: "get"`, `filters: { componentId: "bbs", component: "uia" }` 와, `scope: "components"`, `action: "dependencies"`, `filters: { componentIds: ["bbs"], componentId: "uia", id: "cmt" }` | 두 호출 모두 `isError`. 첫 본문에 `filters.componentId` 와 `filters.component` 가, 둘째 본문에 `filters.id` 가 있음 | |
| `componentId 와 별칭에 같은 컴포넌트를 주면 정상 조회한다 (대소문자는 가리지 않는다)` | `scope: "components"`, `action: "get"`, `filters: { componentId: "bbs", id: "BBS" }` | 오류가 아니고 `egovframework.com.cop.bbs` 가 있음 | |
| `빈 문자열만 든 배열 필터는 지정하지 않은 것으로 본다` | `scope` 없이 `filters: { tags: [""] }` 를 준 호출과 `filters: { componentIds: ["", "  "] }` 를 준 호출 | 두 호출 모두 오류가 아니고 `공통컴포넌트 카테고리` 개요가 나오며, 무시한 필터 안내 줄이 없음 | |
| `찾지 못한 componentId 를 되돌려 실을 때 줄바꿈을 그대로 싣지 않는다` | `scope: "components"` 에 줄바꿈과 제목 모양의 줄(`## 가짜 제목`)이 든 `filters.componentId` 를 줌 | 오류가 아님. 응답에 `## 가짜 제목` 으로 시작하는 줄이 없고, 첫 줄에 줄바꿈이 공백으로 바뀐 입력(`nope ## 가짜 제목 - **ID**: bbs`)이 있음 | |
| `찾지 못한 filePath 를 되돌려 실을 때 줄바꿈을 그대로 싣지 않는다` | `scope: "components"`, `action: "readSource"` 에 줄바꿈과 안내 줄 모양의 줄(`> 이 조회에 ...`)이 든 `filters.filePath` 를 줌 | 응답에 `> 이 조회에` 로 시작하는 줄이 없음 | |
| `없는 categoryId 를 주면 쓸 수 있는 카테고리 ID 를 알려 준다` | `scope: "components"`, `filters: { categoryId: "board" }` | 오류가 아니고 `공통컴포넌트 목록 (0개)` 가 있음. `filters.categoryId` 가 든 안내 줄에 `board` 와 카테고리 ID `게시판`, `역할-권한관리` 가 있음 | |
| `있는 categoryId 로 0건이면 카테고리 안내를 붙이지 않는다` | `scope: "components"`, `query: "존재하지않는낱말"`, `filters: { categoryId: "게시판" }` | `공통컴포넌트 목록 (0개)` 가 있고 `에 해당하는 카테고리가 없습니다` 가 없음 | |
| `없는 version 을 주면 데이터에 있는 version 값을 알려 준다` | `scope: "components"`, `filters: { version: "4.3" }` | 오류가 아님. `filters.version` 이 든 안내 줄에 `5.1.0` 이 있음 | |

### 3-10. 개발자 지식과 통합 검색

`describe` 이름은 `integration — egov_search_knowledge 개발자 지식·통합 검색` 입니다. 통합 검색 응답은 `splitSections()` 로 나눈 뒤 출처별 섹션에서 값을 확인합니다.

| 케이스 | 호출 | 확인하는 것 | 전제 |
|---|---|---|---|
| `sort recent 는 query 없이 최근 지식 목록을 돌려준다` | `scope: "knowledge"`, `filters: { sort: "recent" }`, `limit: 2` | 오류가 아님. JSON 의 `sort` 가 `"recent"` 이고 `count` 가 2 임 | |
| `tags 는 대소문자를 가리지 않고 대응시킨다` | `scope: "knowledge"`, `filters: { sort: "recent", tags: ["FAQ"] }`, `limit: 1` | 오류가 아님. `count` 가 1 이고 첫 결과의 `tags` 에 `faq` 가 있음 | |
| `데이터에 없는 태그로 0건이면 쓸 수 있는 태그를 알려 준다` | `scope: "knowledge"`, `filters: { sort: "recent", tags: ["mybatis"] }`, `limit: 1` | 오류가 아니고 `count` 가 0 임. `filters.tags` 가 든 안내 줄에 `mybatis`, `faq`, `qa` 가 있음 | |
| `데이터에 행이 없는 type 으로 0건이면 데이터에 있는 type 을 알려 준다` | `scope: "knowledge"`, `filters: { sort: "recent", type: "tip" }`, `limit: 1` | 오류가 아니고 `count` 가 0 임. `filters.type` 이 든 안내 줄에 `solution` 과 `best-practice` 가 있음 | |
| `결과가 있으면 태그와 type 안내를 붙이지 않는다` | `scope: "knowledge"`, `filters: { sort: "recent", tags: ["faq"], type: "solution" }`, `limit: 1` | 오류가 아니고 `count` 가 1 임. 본문에 `filters.tags` 와 `filters.type` 이 없음 | |
| `knowledgeScope all 의 호환 소프트웨어가 limit 에서 잘리면 전체 건수와 나머지를 보는 방법을 알린다` | `scope: "knowledge"`, `query: "CMS"`, `filters: { knowledgeScope: "all" }`, `limit: 2` | 오류가 아님. `compatibility` 가 2건이고 `compatibilityTotal` 이 2 보다 큼. `호환 소프트웨어는 전체` 가 든 안내 줄에 `전체 N건 중 2건`(N 은 `compatibilityTotal`)과 `scope: "compatibility"` 가 있음 | 모델 |
| `통합 검색의 개발자 지식 섹션은 id 와 본문 발췌를 싣는다` | `scope: "all"`, `query: "로그인이 안됩니다"` | 개발자 지식 섹션의 `results` 가 한 건 이상임. 결과마다 `id` 가 문자열, `similarity` 가 숫자이고 `content` 가 600자 이하임. 섹션에 전체 본문을 보는 방법(`scope: "knowledge"`)의 안내가 있음 | 모델 |
| `통합 검색에서 호환 소프트웨어 분류를 category 로 주면 가이드에는 그 필터를 적용하지 않는다` | `scope: "all"`, `query: "JEUS"`, `filters: { category: "WAS" }`, `limit: 2` | `알 수 없는 category` 오류가 없음. 공식 가이드 섹션의 결과가 1건 또는 2건이고, 호환 소프트웨어 섹션의 `filters.category` 가 `"WAS"` 임 | 모델 |
| `통합 검색에서 가이드 분류를 category 로 주면 호환 소프트웨어에는 그 필터를 적용하지 않는다` | `scope: "all"`, `query: "트랜잭션"`, `filters: { category: "persistence-layer" }`, `limit: 2` | 공식 가이드 섹션의 분류에 `> persistence-layer` 가 있고, 호환 소프트웨어 섹션의 `filters` 에 `category` 가 없음 | 모델 |
| `통합 검색은 limit 이 10 을 넘으면 출처마다 10건까지만 싣고 줄였다고 한 번만 알린다` | `scope: "all"`, `query: "CMS"`, `limit: 200` | 오류가 아님. 호환 소프트웨어 섹션의 `total` 이 10 보다 크고 `limit` 이 10, `software` 가 10건이며, 다음 구간 안내에 `filters.offset: 10` 이 있음. `줄여 적용했습니다` 가 든 줄이 응답 전체에 하나뿐이고, 그 줄에 `요청한 limit 200`, `출처마다 최대 10건`, `scope` 로 출처를 지정하라는 문구가 있음. 본문이 40,000자 미만임 | |
| `통합 검색의 filters.limit 도 출처마다 10건으로 줄인다` | `scope: "all"`, `query: "CMS"`, `filters: { limit: 50 }` | 오류가 아님. 호환 소프트웨어 섹션의 `software` 가 10건이고 본문에 `요청한 limit 50` 이 있음 | |
| `통합 검색의 limit 이 10 이하면 그대로 적용하고 줄였다는 안내를 붙이지 않는다` | `scope: "all"`, `query: "CMS"`, `limit: 10` | 오류가 아님. 호환 소프트웨어 섹션의 `software` 가 10건이고 본문에 `줄여 적용했습니다` 가 없음 | |
| `통합 검색의 호환 소프트웨어 섹션은 "eGov CMS" 에서 제품명에 eGov 가 든 제품을 맨 앞에 싣는다` | `scope: "all"`, `query: "eGov CMS"` | 오류가 아님. 호환 소프트웨어 섹션의 `matchMode` 가 `all-terms`, `droppedTerms` 가 `["eGov"]`, `limit` 이 5 임. 다섯 행의 제품명이 차례로 `MC@CMS eGov` 네 건과 `DL-WCMS for eGovframe` 임 (제품명에 eGov 가 든 행이 다섯이라 섹션을 모두 차지함) | |
| `knowledgeScope all 의 호환 소프트웨어도 "eGov CMS" 에서 제품명에 eGov 가 든 제품을 맨 앞에 싣는다` | `scope: "knowledge"`, `query: "eGov CMS"`, `filters: { knowledgeScope: "all" }`, `limit: 6` | 오류가 아님. `compatibilityTotal` 이 100 보다 큼. `compatibility` 여섯 건 가운데 앞의 다섯 건만 `product` 에 eGov 가 들어 있음 | 모델 |
| `통합 검색의 호환 소프트웨어 구간 안내는 scope 를 compatibility 로 지정하라고 알린다` | `scope: "all"`, `query: "CMS"`, `limit: 2` | 오류가 아님. 호환 소프트웨어 섹션에 `filters.offset: 2` 와 `scope: "compatibility"` 가 있고 `같은 호출에` 가 없음 | |
| `가이드 검색에 없는 layer 값을 주면 쓸 수 있는 값을 알려 준다` | `scope: "guide"`, `query: "트랜잭션"`, `filters: { layer: "runtime" }` | `isError`. 본문에 `egovframe-runtime` 이 있음 | 모델 |

전제가 비어 있는 통합 검색 케이스는 임베딩 모델이 없어도 실행됩니다. 그때는 공식 가이드 섹션과 개발자 지식 섹션에 `임베딩 모델을 찾을 수 없습니다` 가 든 오류 문구가 실리지만 응답 전체는 오류가 아닙니다. 이 케이스들은 호환 소프트웨어 섹션과 줄여 적용했다는 안내, 본문의 길이만 확인하므로 그대로 통과합니다.

### 3-11. 공개 스키마

`describe` 이름은 `integration — egov_search_knowledge 공개 스키마` 입니다. 도구를 호출하지 않고 `client.listTools()` 가 돌려준 `egov_search_knowledge` 의 정의를 확인합니다. 건너뛰는 케이스가 없습니다.

| 케이스 | 확인하는 것 |
|---|---|
| `query 의 설명은 지금의 키워드 검색 규칙과 응답의 필드를 적는다` | `query` 의 `description` 이 `Search question or keywords. Required for the guide, knowledge and all scopes` 로 시작함. 예전 규칙을 가리키는 `word prefix` 가 없고 `substrings` 가 있음. `matchMode`, `all-terms`, `any-term`, `usedTerms`, `requiredMatches`, `ignoredTerms`, `droppedTerms`, `orQuery` 가 모두 들어 있음. 길이가 1,300자 이하임 |
| `action 은 지원하는 값의 enum 으로 공개된다` | `action` 의 `enum` 이 `["get", "info", "dependencies", "sourceFiles", "readSource", "ddl", "dml"]` 임 |
| `limit 은 1~200 의 정수로 공개된다` | `limit` 이 `type: "integer"`, `minimum: 1`, `maximum: 200` 임 |
| `filters 는 키와 타입이 정해진 객체로 공개되고 정의되지 않은 키를 허용하지 않는다` | `filters.additionalProperties` 가 `false` 임. `layer`, `category`, `type`, `tags`, `componentId`, `componentIds`, `filePath`, `dbType`, `frameworkVersion`, `minLevel`, `level`, `includeKnowledge`, `table`, `chunkId`, `offset`, `limit` 키가 있고 키마다 `description` 이 비어 있지 않음. `frameworkVersion` 의 타입은 `string`, `tags` 는 `array`, `offset` 은 0 이상의 `integer` 임 |
| `읽기 전용 도구임을 annotations 로 알린다` | `annotations` 의 `readOnlyHint` 가 `true`, `destructiveHint` 가 `false` 임 |
| `서버 버전은 package.json 의 버전과 같다` | `client.getServerVersion()` 의 `version` 이 `package.json` 의 `version` 과 같음 |

`query` 의 설명은 호출하는 모델이 호출마다 읽는 글이라서 길이에 상한을 둡니다. 설명은 규칙을 줄여 적은 것이고, 키워드 검색의 동작은 [EGOV_SEARCH_KNOWLEDGE_TOOL.md](../EGOV_SEARCH_KNOWLEDGE_TOOL.md)가 설명합니다.

### 3-12. 지식베이스 파일 보존

`describe` 이름은 `integration — 지식베이스 파일 보존` 입니다.

| 케이스 | 호출 | 확인하는 것 |
|---|---|---|
| `조회 호출은 git 이 추적하는 SQLite 지식베이스 파일을 바꾸지 않는다` | 전용 클라이언트로 `scope: "components"`, `query: "게시판"` 과 `scope: "compatibility"`, `filters: { frameworkVersion: "4.3" }` 를 호출한 뒤 클라이언트를 닫고 0.5초 기다림 | 두 호출이 오류가 아니고, `knowledge-base/egovframe.db` 의 SHA-256 해시가 호출 전과 같음 |

## 4. 실행 방법

```bash
# 전체 (빌드 후 단위 테스트와 통합 테스트)
npm test

# 이 파일만 (build/index.js 가 이미 있어야 함)
npx vitest run tests/integration/searchKnowledge.test.ts

# 묶음 하나만: -t 에 describe 이름의 일부를 줌
npx vitest run tests/integration/searchKnowledge.test.ts -t "scope 추론"
```

## 5. 의존성과 전제 조건

| 항목 | 내용 |
|---|---|
| `build/index.js` | `npm test` 는 빌드를 먼저 실행합니다. vitest 만 실행할 때는 `npm run build` 를 먼저 실행합니다 |
| 동봉 지식베이스 | `knowledge-base/egovframe.db`, `knowledge-base/egovframe_guide.lance`, `knowledge-base/developer_knowledge.lance` 를 조회합니다. 저장소에 들어 있으므로 `npm run build-index` 를 실행할 필요가 없습니다. 가장 긴 청크를 고르는 케이스는 가이드 테이블을 `@lancedb/lancedb` 로 직접 읽습니다 |
| `templates/common-components.json` | 컴포넌트 수를 비교하는 케이스가 읽습니다 |
| 임베딩 모델 | 전제가 `모델` 인 케이스에 필요합니다. 없으면 그 케이스만 건너뜁니다. `npm run fetch-model` 로 받습니다 |
| 공통컴포넌트 소스 | 전제가 `소스` 인 케이스에 필요합니다. 없으면 그 케이스만 건너뜁니다. `git submodule update --init templates/common-components-src` 로 받습니다 |
| 사용자 데이터 디렉터리(오버레이) | 영향을 주지 않습니다. 헬퍼가 서버에 빈 임시 디렉터리를 `EGOV_MCP_DATA_DIR` 로 넘기므로, 개발자가 update CLI 로 적용해 둔 갱신분이 있어도 서버는 동봉 지식베이스를 읽습니다 |

기대값의 일부는 동봉 데이터의 내용에 맞춰져 있습니다. 예를 들어 `EgovProcessMon.jsp` 의 크기(751 bytes), `COMTCCMMNDETAILCODE` 의 INSERT 문 수, `CMS Solution` 분류의 제품 수, `eGov CMS` 로 찾았을 때 앞에 오는 제품명, 업체 `아이액츠` 의 제품, `로그인` 으로 찾은 후보의 순서가 그렇습니다. 공식 가이드 케이스의 `query` 도 동봉 인덱스에 있는 문서를 전제로 골랐습니다. 지식베이스를 다시 만들거나 공통컴포넌트 소스의 버전을 바꾸면 이 값들을 함께 확인합니다.

이 테스트는 저장소의 파일을 바꾸지 않습니다.

## 6. 흔한 실패와 진단

| 증상 | 원인 | 대응 |
|---|---|---|
| 모든 묶음이 실패. 마지막 묶음은 케이스 안에서, 나머지 묶음은 `beforeAll` 에서 실패함 | `build/index.js` 가 없거나 서버가 실행되지 않았습니다 | [_helper.md](./_helper.md)의 "흔한 실패와 진단" 표를 봅니다 |
| `src/` 를 고쳤는데 결과가 바뀌지 않음 | 서버는 `build/` 의 코드로 실행됩니다 | `npm run build` 를 다시 실행하거나 `npm test` 로 실행합니다 |
| 전제가 `모델` 또는 `소스` 인 케이스가 `skipped` 로 표시됨 | 임베딩 모델이나 공통컴포넌트 소스가 없습니다 | 실패가 아닙니다. 모두 실행하려면 5절의 명령으로 파일을 받습니다 |
| 본문에 `네이티브 모듈(better-sqlite3)을 불러오지 못했습니다` 가 나오며 SQLite 를 쓰는 케이스가 실패 | 서버를 실행한 `node`(`PATH` 에서 찾은 것)의 메이저 버전이 `node_modules` 를 설치할 때의 Node 와 다릅니다 | `nvm use` 로 `.nvmrc` 의 버전(22)을 맞춘 뒤 다시 실행합니다 |
| 파일 크기, 건수, 제품명이나 후보의 순서를 비교하는 케이스만 실패 | 지식베이스나 공통컴포넌트 소스의 내용이 기대값을 정할 때와 달라졌습니다 | `git status` 로 `knowledge-base/` 와 서브모듈이 바뀌었는지 확인합니다. 데이터가 의도대로 바뀐 것이면 테스트의 기대값을 고칩니다 |
| `조회 호출은 git 이 추적하는 SQLite 지식베이스 파일을 바꾸지 않는다` 케이스가 실패 | 서버가 `knowledge-base/egovframe.db` 를 쓰기 가능한 모드로 열었습니다 | `SQLiteManager` 를 여는 코드의 `readonly` 옵션을 확인하고, `git status` 로 파일이 바뀌었는지 확인한 뒤 `git restore knowledge-base/egovframe.db` 로 되돌립니다 |
