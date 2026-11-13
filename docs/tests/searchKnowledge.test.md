# `searchKnowledge.test.ts`

`egov_search_knowledge` 를 호출했을 때 돌아오는 응답을 검증하는 통합 테스트입니다. [server.test.md](./server.test.md)가 무엇이 노출되는지를 고정한다면, 이 파일은 노출된 도구를 호출하면 무엇이 돌아오는지를 고정합니다.

> - 위치: `tests/integration/searchKnowledge.test.ts`
> - 실행: `npm test` 또는 `npx vitest run tests/integration/searchKnowledge.test.ts`
> - 분류: 통합 테스트. 빌드된 서버를 자식 프로세스로 실행하고 저장소에 동봉된 지식베이스를 조회함

## 1. 이 테스트가 검증하는 것

- `action` 처리: `components` 범위에서 `action` 을 지정하면 `filters.componentId` 가 함께 있어도 상세 정보가 아니라 그 `action` 의 결과가 돌아옵니다.
- `scope` 추론: `scope` 를 생략하면 `action`, 필터의 종류, `query` 의 유무에 따라 조회할 출처가 정해집니다.
- 입력 검증: `limit` 의 범위를 벗어난 값, `filters` 의 알 수 없는 키, 타입이 틀린 값을 입력 스키마가 거부합니다.
- 출처별 조회: 공통컴포넌트(후보 안내, 겹치던 ID, 목록과 키워드 검색, `dml` 과 `readSource` 의 구간 조회), 호환 소프트웨어(`filters.offset`), 개발자 지식(최근 목록), 통합 검색(출처별 필터 적용)의 응답을 확인합니다.
- 필터 안내: 선택된 `scope` 나 `action` 이 쓰지 않는 필터는 무시하고, 응답에 그 사실을 알리는 줄을 붙입니다.
- 공개 스키마: `tools/list` 로 공개되는 입력 스키마와 `annotations`, 서버 버전이 정해 둔 것과 같습니다.
- 파일 보존: 조회 호출은 `knowledge-base/egovframe.db` 를 바꾸지 않습니다.

모든 호출이 MCP 클라이언트와 서버를 거치므로 입력 스키마 검증부터 응답 포맷까지 한 번에 확인합니다. 조회 로직의 세부 규칙은 단위 테스트가 다룹니다([README.md](./README.md)의 단위 테스트 표 참고).

## 2. 파일 구조와 헬퍼

- `describe` 묶음마다 `beforeAll` 에서 [`createMcpClient()`](./_helper.md)로 서버를 하나씩 실행하고 `afterAll` 에서 닫습니다. 마지막 묶음인 `integration — 지식베이스 파일 보존` 만은 서버 종료 시점까지 확인해야 해서 케이스 안에서 전용 클라이언트를 만들고 닫습니다.
- 호출은 헬퍼의 `callSearchKnowledge(client, args)` 로 하고, 결과의 `text`(본문)와 `isError`(오류 결과 여부)를 확인합니다.
- 파일 안에 도우미 함수가 둘 있습니다. `parseJsonBlock(text)` 는 응답의 첫 번째 `json` 코드 블록을 파싱하고, `splitSections(text)` 는 통합 검색 응답을 `---` 구분선으로 나눕니다.
- 어떤 종류의 응답이 돌아왔는지는 그 응답에만 나오는 문구로 구분합니다.

| 상수 | 문구 | 나오는 응답 |
|---|---|---|
| `DETAIL_MARKER` | `### 기본 정보` | 공통컴포넌트 상세 정보 |
| `ALL_MARKER` | `통합 지식 검색 결과` | 통합 검색(`scope` 가 `all`) |
| `OVERVIEW_MARKER` | `공통컴포넌트 카테고리` | 공통컴포넌트 카테고리 개요 |
| `COMPAT_MARKER` | `호환 소프트웨어 검색 결과` | 호환 소프트웨어 조회 |
| `IGNORED_MARKER` | `적용되지 않아 무시한 필터` | 무시한 필터를 알리는 안내 줄 |

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

### 3-3. scope 추론

`describe` 이름은 `integration — egov_search_knowledge scope 추론` 입니다.

| 케이스 | 호출 | 확인하는 것 | 전제 |
|---|---|---|---|
| `scope 없이 action 을 주면 query 가 있어도 components 로 처리한다` | `query: "게시판"`, `action: "ddl"`, `filters: { componentId: "bbs", dbType: "mysql" }` | `DDL (mysql)` 이 있고 `통합 지식 검색 결과` 가 없음 | 소스 |
| `scope 없이 준 action 의 필수 필터가 빠지면 통합 검색에 묻히지 않고 오류로 응답한다` | `query: "설정"`, `action: "sourceFiles"` | `isError`. 본문에 `filters.componentId is required` 가 있음 | |
| `호환성 전용 필터만 주면 compatibility 로 처리한다` | `filters: { minLevel: 2 }` | `호환 소프트웨어 검색 결과` 가 있고 `공통컴포넌트 카테고리` 가 없음 | |
| `호환 소프트웨어 분류 이름을 category 로 주면 compatibility 로 처리한다` | `filters: { category: "WAS" }` | `호환 소프트웨어 검색 결과` 가 있음 | |
| `가이드 전용 필터(layer)는 query 가 없으면 가이드 검색의 query 필수 오류로 응답한다` | `filters: { layer: "egovframe-runtime" }` | `isError`. 본문이 `query is required for guide search` 임 | |
| `지식 전용 필터(tags)는 query 가 없으면 지식 검색의 query 필수 오류로 응답한다` | `filters: { tags: ["faq"] }` | `isError`. 본문이 `query is required for knowledge search` 임 | |
| `layer 필터와 query 를 주면 가이드만 검색한다` | `query: "트랜잭션 설정"`, `filters: { layer: "egovframe-runtime" }` | `eGovFrame 가이드 검색 결과` 가 있고 `통합 지식 검색 결과` 가 없음 | 모델 |
| `가이드 분류 이름을 category 로 주면 가이드만 검색한다` | `query: "트랜잭션 설정"`, `filters: { category: "persistence-layer" }` | `eGovFrame 가이드 검색 결과` 가 있고 `통합 지식 검색 결과` 가 없음 | 모델 |
| `components 가 아닌 scope 에 action 을 주면 오류로 응답한다` | `scope` 를 `"guide"`, `"knowledge"`, `"compatibility"`, `"all"` 로 바꿔 가며 `query: "게시판"`, `action: "ddl"`, `filters: { componentId: "bbs" }` | 네 경우 모두 `isError`. 본문에 `components` 가 있음 | |
| `공백뿐인 query 는 없는 것으로 처리한다` | 공백 세 칸뿐인 `query` 만 준 호출과, `scope: "guide"` 에 공백, 줄바꿈, 탭뿐인 `query` 를 준 호출 | 첫 호출은 `공통컴포넌트 카테고리` 개요를 돌려줌. 둘째 호출은 `isError` 이고 본문이 `query is required for guide search` 임 | |
| `strictScope 는 결과에 영향을 주지 않는다` | `scope: "components"`, `query: "게시판"` 을 `strictScope: true` 와 함께 준 호출과 빼고 준 호출 | 두 응답의 본문이 같음 | |

### 3-4. 입력 검증

`describe` 이름은 `integration — egov_search_knowledge 입력 검증` 입니다. 입력 스키마를 어긴 호출은 예외가 아니라 `isError` 결과로 돌아오며, 본문에 어긋난 필드의 이름이 들어 있습니다.

| 케이스 | 호출 | 확인하는 것 | 전제 |
|---|---|---|---|
| `limit 은 1 이상의 정수만 받는다` | `scope: "components"`, `query: "게시판"` 에 `limit` 을 `0`, `-1`, `2.5` 로 바꿔 가며 호출 | 세 경우 모두 `isError`. 본문에 `limit` 이 있음 | |
| `스키마 최댓값(200)을 넘는 limit 은 거부한다` | `scope: "components"`, `query: "게시판"`, `limit: 201` | `isError`. 본문에 `limit` 이 있음 | |
| `filters.limit 에도 같은 검증을 적용한다` | `scope: "components"`, `query: "게시판"`, `filters: { limit: -5 }` | `isError`. 본문에 `limit` 이 있음 | |
| `filters 의 알 수 없는 키는 무시하지 않고 거부한다` | `scope: "components"`, `filters: { componentid: "bbs" }` | `isError`. 본문에 `componentid` 가 있음 | |
| `filters 값의 타입이 틀리면 거부한다` | `scope: "compatibility"`, `filters: { frameworkVersion: 4.3 }` 과, `scope: "knowledge"`, `query: "설정"`, `filters: { tags: "faq" }` | 두 호출 모두 `isError`. 본문에 각각 `frameworkVersion`, `tags` 가 있음 | |
| `범위별 최댓값을 넘는 limit 은 최댓값으로 줄이고 그 사실을 알린다` | `scope: "compatibility"`, `filters: { frameworkVersion: "4.2" }`, `limit: 150` | 오류가 아니고 본문에 `최댓값 100` 이 있음 | |

### 3-5. 공통컴포넌트 조회

`describe` 이름은 `integration — egov_search_knowledge 공통컴포넌트 조회` 입니다. 이 묶음의 호출은 모두 `scope: "components"` 를 지정하며, 표에는 나머지 인자만 적습니다.

| 케이스 | 호출 | 확인하는 것 | 전제 |
|---|---|---|---|
| `컴포넌트를 찾지 못하면 비슷한 컴포넌트의 ID 를 함께 알려 준다` | `filters: { componentId: "로그인" }` | 오류가 아님. `컴포넌트를 찾을 수 없습니다: 로그인` 과 `비슷한 컴포넌트` 가 있고, 후보가 다섯 개이며 그 가운데 `uap`(로그인정책관리)가 있음 | |
| `후보가 없는 입력에는 후보 목록을 붙이지 않는다` | `filters: { componentId: "zzz-없는-컴포넌트" }` | `컴포넌트를 찾을 수 없습니다: zzz-없는-컴포넌트` 가 있고 `비슷한 컴포넌트` 가 없음 | |
| `컴포넌트 이름으로도 ddl 을 조회할 수 있다` | `action: "ddl"`, `filters: { componentId: "블로그관리" }` | `DDL (mysql)` 과 `CREATE TABLE` 이 있음 | 소스 |
| `파일 기능에서 컴포넌트를 찾지 못해도 후보를 알려 준다` | `action: "sourceFiles"`, `filters: { componentId: "로그인" }` | 오류가 아님. `컴포넌트를 찾을 수 없습니다: 로그인` 과 후보 `uap` 가 있음 | 소스 |
| `메타의 id 가 겹치던 컴포넌트를 각각 조회할 수 있다` | `filters: { componentId }` 를 표 아래에 적은 ID 로 바꿔 가며 호출 | 응답의 첫 줄이 그 ID 의 컴포넌트 이름(`## <이름>`)임 | |
| `동봉 DB 에는 메타에 적힌 컴포넌트가 모두 들어 있다` | 다른 인자 없음 | 통계의 `총 컴포넌트` 수가 `templates/common-components.json` 의 `totalComponents` 와 같음 | |
| `query 와 목록 필터를 함께 주면 두 조건을 모두 적용한다` | `query: "login"`, `filters: { categoryId: "로그인" }`, `limit: 10` | `uia` 가 있고, 다른 카테고리에 속한 `rsc` 와 `oauth` 가 없음 | |
| `필터 목록에 limit 을 주면 전체 건수와 함께 그만큼만 보여 준다` | `filters: { keyword: "로그인" }`, `limit: 3` | 제목이 `공통컴포넌트 목록 (N개 중 3개 표시)` 형태임 | |
| `limit 을 주지 않은 필터 목록은 조건에 맞는 컴포넌트를 모두 보여 준다` | `filters: { hasWeb: true }` | 제목에 `개 중` 이 없고 건수가 20 보다 큼 | |
| `키워드 검색 결과가 limit 보다 많으면 전체 건수를 알린다` | `query: "관리"`, `limit: 2` | 제목이 `공통컴포넌트 목록 (N개 중 2개 표시)` 형태임 | |
| `낱말 접두 일치로 찾지 못해 부분 일치로 찾은 결과는 그 사실을 알린다` | `query: "증서"` | `sec` 가 있고 `일부 검색어만 일치` 안내가 있음 | |
| `검색어를 추출할 수 없는 query 는 없는 것으로 보고 필터 목록을 돌려준다` | `query: "*"`, `filters: { categoryId: "로그인" }` | `uia` 가 있음 | |
| `action dml 에 filters.table 과 filters.offset 을 주면 그 테이블의 구간만 반환한다` | `action: "dml"`, `filters: { componentId: "uia", dbType: "mysql", table: "COMTCCMMNDETAILCODE", offset: 100 }`, `limit: 50` | `- **테이블**: COMTCCMMNDETAILCODE` 와 `총 N건 중 101~150` 이 있고 `INSERT INTO` 가 50번 나옴 | 소스 |
| `action readSource 는 큰 파일을 나눠 돌려주고 이어 읽을 offset 을 알려 준다` | `action: "readSource"`, `filters: { filePath: "script/dml/mysql/com_DML_mysql.sql" }` 과, 같은 호출에 `filters.offset: 60000` 을 더한 호출 | 첫 응답에 `전체 N자 중 1~60,000자` 와 `filters.offset: 60000` 이 있음. 둘째 응답에 `60,001~120,000자` 와 `filters.offset: 120000` 이 있음. 두 응답의 본문이 서로 다름 | 소스 |
| `UTF-8 이 아닌 인코딩으로 읽은 파일은 머리말에 인코딩을 적는다` | `action: "readSource"` 로 `src/main/webapp/WEB-INF/jsp/egovframework/com/utl/sys/prm/EgovProcessMon.jsp` 와 `src/main/java/egovframework/com/cop/bbs/service/Blog.java` 를 각각 호출 | JSP 응답의 첫 줄이 `(751 bytes, jsp, EUC-KR)` 로 끝나고 `jsp` 코드 블록이 있음. Java 응답의 첫 줄은 `bytes, java)` 로 끝나서 인코딩 표시가 없음 | 소스 |
| `끝까지 읽은 파일에는 이어 읽기 안내를 붙이지 않는다` | `action: "readSource"`, `filters: { filePath: "src/main/java/egovframework/com/cop/bbs/service/Blog.java" }` | 본문에 `filters.offset` 이 없음 | 소스 |

겹치던 ID 케이스가 확인하는 ID 와 이름은 다음과 같습니다: `bbs` 게시판, `blog-management` 블로그관리, `cmt` 댓글관리, `uss-cmt` 출퇴근관리, `sim` 일정관리, `syi-sim` 시스템연계관리, `utl-sim` 시스템정보확인, `prm` 프로그램관리, `sys-prm` 프로세스 모니터링, `com` 협업공통, `sts-com` 통계공통.

### 3-6. 호환 소프트웨어 조회

`describe` 이름은 `integration — egov_search_knowledge 호환 소프트웨어 조회` 입니다.

| 케이스 | 호출 | 확인하는 것 | 전제 |
|---|---|---|---|
| `filters.offset 으로 다음 구간을 조회한다` | `scope: "compatibility"`, `filters: { category: "CMS Solution" }`, `limit: 10` 과, 같은 호출에 `filters.offset: 10` 을 더한 호출 | 첫 응답의 `total` 이 20 보다 크고 `offset` 이 0 임. 둘째 응답의 `offset` 이 10, `count` 가 10 이고 `total` 이 첫 응답과 같음. 두 구간에 겹치는 제품이 없음(제품명, 제품 버전, 프레임워크 버전으로 비교) | |

### 3-7. 적용되지 않는 필터 안내

`describe` 이름은 `integration — egov_search_knowledge 적용되지 않는 필터 안내` 입니다. 안내 줄은 본문에서 `적용되지 않아 무시한 필터` 가 들어 있는 줄입니다.

| 케이스 | 호출 | 확인하는 것 | 전제 |
|---|---|---|---|
| `조회에 쓰이지 않은 필터는 무시했다고 알린다` | `scope: "components"`, `query: "게시판"`, `filters: { tags: ["faq"], frameworkVersion: "4.3" }` | 안내 줄에 `tags` 와 `frameworkVersion` 이 있음 | |
| `조회에 쓰인 필터만 준 호출에는 안내를 붙이지 않는다` | `scope: "components"`, `query: "게시판"`, `filters: { hasWeb: true }` 와, `scope: "compatibility"`, `filters: { frameworkVersion: "4.3", offset: 5 }` | 두 응답 모두 안내 줄이 없음 | |
| `action 이 쓰지 않는 필터도 알린다` | `scope: "components"`, `action: "get"`, `filters: { componentId: "uia", dbType: "oracle", table: "COMTNEMPLYRINFO" }` | 안내 줄에 `dbType` 과 `table` 이 있고 `componentId` 가 없음 | |
| `호환 소프트웨어 조회에서 쓰이지 않는 필터를 알린다` | `scope: "compatibility"`, `filters: { frameworkVersion: "4.3", layer: "egovframe-runtime" }` | 안내 줄에 `layer` 가 있고 `frameworkVersion` 이 없음 | |

### 3-8. 개발자 지식과 통합 검색

`describe` 이름은 `integration — egov_search_knowledge 개발자 지식·통합 검색` 입니다.

| 케이스 | 호출 | 확인하는 것 | 전제 |
|---|---|---|---|
| `sort recent 는 query 없이 최근 지식 목록을 돌려준다` | `scope: "knowledge"`, `filters: { sort: "recent" }`, `limit: 2` | 오류가 아님. JSON 의 `sort` 가 `"recent"` 이고 `count` 가 2 임 | |
| `통합 검색의 개발자 지식 섹션은 id 와 본문 발췌를 싣는다` | `scope: "all"`, `query: "로그인이 안됩니다"` | 개발자 지식 섹션의 `results` 가 한 건 이상임. 결과마다 `id` 가 문자열, `similarity` 가 숫자이고 `content` 가 600자 이하임. 섹션에 전체 본문을 보는 방법(`scope: "knowledge"`)의 안내가 있음 | 모델 |
| `통합 검색에서 호환 소프트웨어 분류를 category 로 주면 가이드에는 그 필터를 적용하지 않는다` | `scope: "all"`, `query: "JEUS"`, `filters: { category: "WAS" }`, `limit: 2` | `알 수 없는 category` 오류가 없음. 공식 가이드 섹션의 결과가 1건 또는 2건이고, 호환 소프트웨어 섹션의 `filters.category` 가 `"WAS"` 임 | 모델 |
| `통합 검색에서 가이드 분류를 category 로 주면 호환 소프트웨어에는 그 필터를 적용하지 않는다` | `scope: "all"`, `query: "트랜잭션"`, `filters: { category: "persistence-layer" }`, `limit: 2` | 공식 가이드 섹션의 분류에 `> persistence-layer` 가 있고, 호환 소프트웨어 섹션의 `filters` 에 `category` 가 없음 | 모델 |
| `가이드 검색에 없는 layer 값을 주면 쓸 수 있는 값을 알려 준다` | `scope: "guide"`, `query: "트랜잭션"`, `filters: { layer: "runtime" }` | `isError`. 본문에 `egovframe-runtime` 이 있음 | 모델 |

### 3-9. 공개 스키마

`describe` 이름은 `integration — egov_search_knowledge 공개 스키마` 입니다. 도구를 호출하지 않고 `client.listTools()` 가 돌려준 `egov_search_knowledge` 의 정의를 확인합니다. 건너뛰는 케이스가 없습니다.

| 케이스 | 확인하는 것 |
|---|---|
| `action 은 지원하는 값의 enum 으로 공개된다` | `action` 의 `enum` 이 `["get", "info", "dependencies", "sourceFiles", "readSource", "ddl", "dml"]` 임 |
| `limit 은 1~200 의 정수로 공개된다` | `limit` 이 `type: "integer"`, `minimum: 1`, `maximum: 200` 임 |
| `filters 는 키와 타입이 정해진 객체로 공개되고 정의되지 않은 키를 허용하지 않는다` | `filters.additionalProperties` 가 `false` 임. `layer`, `category`, `type`, `tags`, `componentId`, `componentIds`, `filePath`, `dbType`, `frameworkVersion`, `minLevel`, `includeKnowledge`, `table`, `offset`, `limit` 키가 있고 키마다 `description` 이 비어 있지 않음. `frameworkVersion` 의 타입은 `string`, `tags` 는 `array`, `offset` 은 0 이상의 `integer` 임 |
| `읽기 전용 도구임을 annotations 로 알린다` | `annotations` 의 `readOnlyHint` 가 `true`, `destructiveHint` 가 `false` 임 |
| `서버 버전은 package.json 의 버전과 같다` | `client.getServerVersion()` 의 `version` 이 `package.json` 의 `version` 과 같음 |

### 3-10. 지식베이스 파일 보존

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
| 동봉 지식베이스 | `knowledge-base/egovframe.db`, `knowledge-base/egovframe_guide.lance`, `knowledge-base/developer_knowledge.lance` 를 조회합니다. 저장소에 들어 있으므로 `npm run build-index` 를 실행할 필요가 없습니다 |
| `templates/common-components.json` | 컴포넌트 수를 비교하는 케이스가 읽습니다 |
| 임베딩 모델 | 전제가 `모델` 인 케이스에 필요합니다. 없으면 그 케이스만 건너뜁니다. `npm run fetch-model` 로 받습니다 |
| 공통컴포넌트 소스 | 전제가 `소스` 인 케이스에 필요합니다. 없으면 그 케이스만 건너뜁니다. `git submodule update --init templates/common-components-src` 로 받습니다 |
| 사용자 데이터 디렉터리(오버레이) | 서버는 update CLI 로 적용한 갱신분이 있으면 동봉 지식베이스보다 그것을 먼저 읽습니다. 이 테스트의 기대값은 동봉 지식베이스 기준이므로, 갱신분이 적용된 환경에서는 일부 케이스의 결과가 달라질 수 있습니다 |

기대값의 일부는 동봉 데이터의 내용에 맞춰져 있습니다. 예를 들어 `EgovProcessMon.jsp` 의 크기(751 bytes), `COMTCCMMNDETAILCODE` 의 INSERT 문 수, `CMS Solution` 분류의 제품 수가 그렇습니다. 지식베이스를 다시 만들거나 공통컴포넌트 소스의 버전을 바꾸면 이 값들을 함께 확인합니다.

이 테스트는 저장소의 파일을 바꾸지 않습니다.

## 6. 흔한 실패와 진단

| 증상 | 원인 | 대응 |
|---|---|---|
| 모든 묶음이 `beforeAll` 에서 실패 | `build/index.js` 가 없거나 서버가 실행되지 않았습니다 | [_helper.md](./_helper.md)의 "흔한 실패와 진단" 표를 봅니다 |
| `src/` 를 고쳤는데 결과가 바뀌지 않음 | 서버는 `build/` 의 코드로 실행됩니다 | `npm run build` 를 다시 실행하거나 `npm test` 로 실행합니다 |
| 전제가 `모델` 또는 `소스` 인 케이스가 `skipped` 로 표시됨 | 임베딩 모델이나 공통컴포넌트 소스가 없습니다 | 실패가 아닙니다. 모두 실행하려면 5절의 명령으로 파일을 받습니다 |
| 본문에 `네이티브 모듈(better-sqlite3)을 불러오지 못했습니다` 가 나오며 SQLite 를 쓰는 케이스가 실패 | 서버를 실행한 `node`(`PATH` 에서 찾은 것)의 메이저 버전이 `node_modules` 를 설치할 때의 Node 와 다릅니다 | `nvm use` 로 `.nvmrc` 의 버전(22)을 맞춘 뒤 다시 실행합니다 |
| 파일 크기나 건수를 비교하는 케이스만 실패 | 지식베이스나 공통컴포넌트 소스의 내용이 기대값을 정할 때와 달라졌거나, 오버레이의 갱신분을 읽고 있습니다 | `node build/index.js update --check` 의 출력에서 `(update 적용분)` 으로 표시된 리소스가 있는지 확인합니다. 데이터가 의도대로 바뀐 것이면 테스트의 기대값을 고칩니다 |
| `조회 호출은 git 이 추적하는 SQLite 지식베이스 파일을 바꾸지 않는다` 케이스가 실패 | 서버가 `knowledge-base/egovframe.db` 를 쓰기 가능한 모드로 열었습니다 | `SQLiteManager` 를 여는 코드의 `readonly` 옵션을 확인하고, `git status` 로 파일이 바뀌었는지 확인한 뒤 `git restore knowledge-base/egovframe.db` 로 되돌립니다 |
