# eGovFrame MCP Search

> 표준프레임워크 공식 가이드, 개발자 지식, 공통컴포넌트, 호환 소프트웨어를 도구 하나로 검색하는 지식검색 MCP 서버

![eGovFrame](https://img.shields.io/badge/eGovFrame-5.1.0-134F8C?labelColor=white&logo=data:image/svg%2Bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNzMuMjgyIDE3My4yODIiPjxwYXRoIGZpbGw9IiNmZmYiIGQ9Ik0xNzMuMjgyIDg2LjY1YzAgNDcuODQ0LTM4Ljc5NCA4Ni42MzItODYuNjQ2IDg2LjYzMkMzOC43OTkgMTczLjI4MiAwIDEzNC40OTQgMCA4Ni42NSAwIDM4Ljc4OCAzOC43OTkgMCA4Ni42MzYgMGM0Ny44NTIgMCA4Ni42NDYgMzguNzg4IDg2LjY0NiA4Ni42NSIvPjxwYXRoIGZpbGw9IiMwMDM3NjQiIGQ9Ik0xMjcuMzg5IDgwLjU5OGMtMTMuNzkxLTkuMzY1LTMxLjQzOS01LjU0Mi00MC43MTcgOC41MzMtNy43MiAxMS43NjctMTkuNDA1IDEzLjIzNS0yMy45MDYgMTMuMjM1LTE0Ljc1MSAwLTI0LjgyNC0xMC4zNjctMjcuODE4LTIxLjA5NWgtLjAxYy0uMDM5LS4xMDgtLjA1OS0uMi0uMDktLjMwNy0uMDI1LS4xMi0uMDU2LS4yMzMtLjA4OS0uMzY2LTEuMTc3LTQuNDY3LTEuNDY3LTYuNjA5LTEuNDY3LTExLjM2OCAwLTI1LjY1IDI2LjMyMS01NC4yMTMgNjQuMjE1LTU0LjIxMyAzOC44MjkgMCA2MS4wNSAyOS41NDUgNjYuNzggNDUuOTc5LS4xMDctLjI5NS0uMjA5LS41ODEtLjI5MS0uODc3LTExLjAxNS0zMi4xMjUtNDEuNDc0LTU1LjIxNi03Ny4zNTctNTUuMjE2LTQ1LjEzIDAtODEuNzI5IDM2LjU5LTgxLjcyOSA4MS43MzkgMCA0MC4zNTEgMjkuMTA4IDc0Ljg5MSA2OS40NzkgNzQuODkxIDMyLjE5NyAwIDUzLjg0Mi0xOC4wNTIgNjMuNzU3LTQyLjkzIDUuNDUtMTMuNjE0IDEuNTk1LTI5LjYwNS0xMC43NTctMzguMDA1Ii8%2BPHBhdGggZmlsbD0iI2U0MDMyZSIgZD0iTTE2NC43ODggNjIuNTg5Yy00Ljc3Ny0xNi4wMjYtMjcuMTUzLTQ3LjU3MS02Ny4yODItNDcuNTcxLTM3Ljg5NCAwLTY0LjIxNCAyOC41NjMtNjQuMjE0IDU0LjIxMiAwIDQuNzU5LjI5IDYuOTAxIDEuNDY2IDExLjM2OC0uNDg5LTEuOTUxLS43NC0zLjkwOC0uNzQtNS44MjMgMC0yNi43MjEgMjYuNzQxLTQ1LjIyNyA1NC4yNDgtNDUuMjI3IDM3LjIxOCAwIDY3LjM4OCAzMC4xNzQgNjcuMzg4IDY3LjM5IDAgMjkuMTczLTE2Ljc4NSA1NC40MzctNDEuMTc5IDY2LjU2NXYuMDIzYzMxLjQ1NS0xMS4zOTEgNTMuOTA4LTQxLjUxMiA1My45MDgtNzYuODg0IDAtOC4zNzgtMS4xMjctMTUuNzU5LTMuNTk1LTI0LjA1MyIvPjwvc3ZnPg%3D%3D)
![Node](https://img.shields.io/badge/node-22.x-brightgreen.svg)
![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)

## 개요

**eGovFrame MCP Search (지식검색 MCP)** 는 MCP(Model Context Protocol)를 지원하는 AI 클라이언트(Claude Code, Codex, Cursor 등)에서 전자정부 표준프레임워크 개발에 필요한 자료를 검색하는 MCP 서버입니다. 현재 버전은 5.1.0 Beta 이며, 이 저장소의 최초 배포 버전입니다.

사용자가 AI 클라이언트에 자연어로 질문하면, AI 가 검색할 출처(`scope`)와 조건을 정해서 `egov_search_knowledge` 도구를 호출합니다. 서버는 패키지에 들어 있는 지식베이스(SQLite, LanceDB)에서 자료를 찾아 돌려주고, AI 는 그 검색 결과를 바탕으로 답변을 작성합니다.

## 주요 기능

| 기능 | 설명 | 검색 대상 |
|------|------|-----------|
| 공식 가이드 검색 | 표준프레임워크 공식 [가이드 문서(egovframe-docs)](https://github.com/eGovFramework/egovframe-docs)를 의미 기반으로 검색합니다. | 문서 조각(청크) 7,011건 |
| 개발자 지식 검색 | 표준프레임워크 포털의 [묻고답하기(Q&A)](https://www.egovframe.go.kr/home/sub.do?menuNo=69), [FAQ](https://www.egovframe.go.kr/home/sub.do?menuNo=68), [적용가이드 PDF](https://www.egovframe.go.kr/home/sub.do?menuNo=67) 를 의미 기반으로 검색합니다. | 묻고답하기와 FAQ 8,411건, 적용가이드 PDF 조각 254건 |
| 공통컴포넌트 조회 | 공통컴포넌트의 목록과 상세 정보(설명, 사용 테이블, 의존성), 간접 의존성까지 포함한 의존성 목록, 소스 파일 목록과 내용, 8개 DBMS 별 DDL 과 DML 을 조회합니다. | 컴포넌트 155개 |
| 호환 소프트웨어 조회 | 표준프레임워크 버전별 [호환 소프트웨어 목록](https://www.egovframe.go.kr/home/sub.do?menuNo=73)을 프레임워크 버전, 분류, 제조사, 제품명 필터와 키워드로 조회합니다. | 626건 |
| 통합 검색 | 네 가지 출처를 한 번에 검색하거나, 질문에 맞는 출처를 서버가 자동으로 정합니다. | 위의 네 출처 전부 |

검색 대상의 건수는 5.1.0 Beta 에 동봉된 지식베이스(공식 가이드 `v5.0.0-end-2026-contribution`, 포털 자료 2026-11-24 기준)의 값입니다.

- **오프라인 동작**: 지식베이스와 임베딩 모델(`Xenova/multilingual-e5-small`)이 모두 패키지에 들어 있으므로 검색할 때 네트워크에 접속하지 않습니다. 의존 패키지도 배포 파일에 함께 들어 있어서 인터넷에 연결되지 않은 환경(폐쇄망)에서도 사용할 수 있습니다.
- **읽기 전용**: 도구는 지식베이스에 이미 있는 자료를 찾아 줄 뿐이고, 지식베이스의 내용을 바꾸지 않습니다.

## 제공 도구

이 MCP 서버는 도구 **하나**만 노출합니다. 리소스와 프롬프트는 노출하지 않습니다. 전송 방식은 stdio 입니다.

| 도구 | 용도 |
|------|------|
| [`egov_search_knowledge`](docs/reference/EGOV_SEARCH_KNOWLEDGE_TOOL.md) | 공식 가이드, 개발자 지식, 공통컴포넌트, 호환 소프트웨어의 통합 검색 (읽기 전용) |

아래는 요약입니다. 파라미터, 필터, 응답 형식의 상세한 설명은 [`docs/reference/EGOV_SEARCH_KNOWLEDGE_TOOL.md`](docs/reference/EGOV_SEARCH_KNOWLEDGE_TOOL.md) 와 [`docs/reference/MCP_REFERENCE.md`](docs/reference/MCP_REFERENCE.md) 에 있습니다.

### `egov_search_knowledge`

공식 가이드, 개발자 지식, 공통컴포넌트, 호환 소프트웨어를 검색하고 조회합니다. 파라미터는 모두 선택입니다. 아무것도 주지 않으면 공통컴포넌트의 카테고리 개요와 통계가 돌아옵니다.

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `query` | string | 선택 | 검색 질문 또는 키워드(최대 10,000자). `guide`, `knowledge`, `all` 검색에서는 필요하고, `components` 와 `compatibility` 에서는 키워드 검색어로 쓰입니다. |
| `scope` | enum | 선택 | 검색할 출처: `auto`(기본값), `guide`, `knowledge`, `components`, `compatibility`, `all` |
| `action` | enum | 선택 | `components` 에서만 쓰는 조회 동작: `get`, `info`, `dependencies`, `sourceFiles`, `readSource`, `ddl`, `dml` |
| `filters` | object | 선택 | 출처별 검색 조건(예: `componentId`, `dbType`, `frameworkVersion`). 정의되지 않은 키와 타입이 틀린 값은 입력 검증 오류가 됩니다. |
| `limit` | integer | 선택 | 최대 결과 수(1~200). 출처마다 기본값과 최댓값이 다릅니다. |
| `strictScope` | boolean | 선택 | 효과가 없습니다. 기존 호출과의 호환을 위해 받기만 합니다. |

- 필터는 모두 `filters` 객체 안에 넣습니다. 필터 키를 최상위에 두면 오류 없이 버려져서, 필터가 적용되지 않은 결과가 돌아옵니다.
- 선택된 `scope` 나 `action` 이 쓰지 않는 필터는 무시하고, 무시한 키를 응답 끝에 알립니다.
- 입력 스키마를 어긴 호출과 실행 중에 난 오류는 `isError: true` 인 도구 결과로 돌아옵니다.

#### scope

| scope | 대상 (저장소) | 조회 방식 | 주요 `filters` 키 |
|-------|---------------|-----------|-------------------|
| `guide` | 공식 가이드 (LanceDB) | 의미 검색, `chunkId` 로 조각 하나 읽기 | `layer`, `category`, `chunkId` |
| `knowledge` | 개발자 지식 (LanceDB) | 의미 검색, 최근 색인 순 목록 | `type`, `tags`, `minImportance`, `verifiedOnly`, `sort` |
| `components` | 공통컴포넌트 (SQLite, 소스 파일) | 키워드 검색, 목록, `action` 별 조회 | `componentId`, `componentIds`, `filePath`, `dbType`, `table`, `categoryId` |
| `compatibility` | 호환 소프트웨어 (SQLite) | 필터 조회, 키워드 검색 | `frameworkVersion`, `category`, `vendor`, `productName`, `level` |
| `all` | 네 출처 전부 | 출처마다 검색한 결과를 한 응답에 모으는 통합 검색 | 각 필터는 그 필터를 쓰는 출처에만 적용 |
| `auto` | 입력에서 추론 | `action` 과 `filters` 가 가리키는 출처를 고르고, 가리키는 출처가 없으면 `query` 가 있을 때 `all` 로 처리 | - |

#### components 의 action

| action | 필요한 `filters` | 동작 |
|--------|------------------|------|
| (없음) | - | `componentId` 가 있으면 상세 정보, `query` 가 있으면 키워드 검색, 목록 필터만 있으면 목록, 아무것도 없으면 카테고리 개요와 통계 |
| `get` / `info` | `componentId` | 컴포넌트 상세 정보(기본 정보, 설명, 사용 테이블, 의존성) |
| `dependencies` | `componentIds`(배열) 또는 `componentId` | 간접 의존성까지 모두 해결한 결과 |
| `sourceFiles` | `componentId` | 컴포넌트의 소스 파일(Java, 매퍼 XML, JSP 등)과 Spring 설정의 목록 |
| `readSource` | `filePath` | 소스 파일 하나의 내용. 한 번에 30,000자까지이며 `filters.offset` 으로 이어서 읽습니다. |
| `ddl` | `componentId`, `dbType`(선택) | 컴포넌트가 쓰는 테이블의 CREATE TABLE, 인덱스, 뷰 문 |
| `dml` | `componentId`, `dbType`(선택), `table`(선택) | 초기 데이터 INSERT 문 |

`dbType` 은 `mysql`(기본값), `maria`, `oracle`, `postgres`, `tibero`, `cubrid`, `altibase`, `goldilocks` 가운데 하나입니다.

## 설치

### 요구 사항

- **Node.js**: 서버가 쓰는 `better-sqlite3` 의 네이티브 바이너리가 Node.js 22 전용이므로 Node.js 22(`>=22 <23`)가 필요합니다. 터미널에서 `node -v` 를 실행했을 때 `v22` 로 시작하는 버전이 나와야 합니다. 다른 메이저 버전으로 실행하면 서버는 시작되지만 공통컴포넌트와 호환 소프트웨어 조회가 동작하지 않습니다.
- **운영체제와 CPU**: Windows x64, macOS(Apple Silicon, Intel), Linux x64(glibc 기반 배포판)를 지원합니다.
- **디스크**: 배포 파일 하나가 약 330MB 입니다.

### 1. 배포 파일(tgz) 내려받기

[표준프레임워크 포털](https://www.egovframe.go.kr/home/sub.do?menuNo=114)에서 사용하는 운영체제와 CPU 에 맞는 파일을 내려받습니다.

| 운영체제와 CPU | 파일 |
|----------------|------|
| Windows x64 | `egovframe-mcp-search-5.1.0-win32-x64.tgz` |
| macOS (Apple Silicon) | `egovframe-mcp-search-5.1.0-darwin-arm64.tgz` |
| macOS (Intel) | `egovframe-mcp-search-5.1.0-darwin-x64.tgz` |
| Linux x64 (glibc) | `egovframe-mcp-search-5.1.0-linux-x64.tgz` |

배포 파일에는 서버, 실행에 필요한 의존 패키지, 지식베이스, 임베딩 모델이 모두 들어 있습니다. 압축을 풀거나 따로 설치할 필요 없이, 아래의 명령으로 AI 클라이언트에 등록해서 사용합니다. 파일의 체크섬은 [릴리스 노트](docs/release-notes/v5.1.0-beta.md#체크섬)에 있습니다.

### 2. 서버 실행 명령

AI 클라이언트는 다음 명령으로 서버를 실행합니다. `<TGZ>` 는 내려받은 tgz 파일의 절대 경로입니다.

```bash
npx -y --package=<TGZ> egovframe-mcp-search
```

Windows 에서는 `cmd /c` 로 감싸서 실행합니다.

```bat
cmd /c npx -y --package=<TGZ> egovframe-mcp-search
```

### 3. AI 클라이언트 등록

`mcpServers` 형식을 쓰는 AI 클라이언트에는 다음 항목을 등록합니다.

**macOS, Linux**

```json
{
  "mcpServers": {
    "egovframe-mcp-search": {
      "command": "npx",
      "args": ["-y", "--package=<TGZ>", "egovframe-mcp-search"]
    }
  }
}
```

**Windows**

```json
{
  "mcpServers": {
    "egovframe-mcp-search": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "--package=<TGZ>", "egovframe-mcp-search"]
    }
  }
}
```

배포 파일의 용량이 커서, `npx` 로 실행하면 AI 클라이언트가 서버를 시작할 때마다 20초 정도 걸립니다. AI 클라이언트의 서버 시작 대기 시간이 이보다 짧으면 연결에 실패할 수 있으므로, 대기 시간을 늘려서 사용합니다. 서버 시작을 기본 10초까지만 기다리는 Codex 에서는 [`docs/setup/MCP_SETUP_GUIDE.md`](docs/setup/MCP_SETUP_GUIDE.md#codex) 의 설명대로 `startup_timeout_sec` 값을 추가해야 합니다.

Claude Code, Codex, Cursor, VS Code (GitHub Copilot), Cline, OpenCode 에 등록하는 방법(CLI 명령, 설정 파일의 위치와 형식)은 [`docs/setup/MCP_SETUP_GUIDE.md`](docs/setup/MCP_SETUP_GUIDE.md#ai-클라이언트별-등록) 에 있습니다. 환경 변수와 문제 해결도 같은 문서에서 다룹니다.

### 저장소를 클론해서 실행 (개발자)

저장소를 클론해서 빌드한 서버를 직접 실행하는 절차입니다. Node.js 22 와 git 이 필요합니다.

```bash
git clone https://github.com/eGovFramework/egovframe-mcp-search.git
cd egovframe-mcp-search
nvm use                        # nvm 을 쓰는 경우: .nvmrc 에 따라 Node.js 22 선택
git submodule update --init    # templates/common-components-src, templates/egovframe_guide
npm install                    # 의존성 설치. prepare 스크립트가 빌드(npm run build)까지 실행
npm run fetch-model            # 임베딩 모델을 models/ 에 내려받음 (약 130MB, 네트워크 필요)
```

저장소에는 미리 구축한 지식베이스(`knowledge-base/`)가 들어 있으므로, 위 단계를 마치면 `build/index.js` 를 Node.js 22 로 실행하도록 AI 클라이언트에 등록할 수 있습니다. 등록 방법은 [`docs/setup/MCP_SETUP_GUIDE.md`](docs/setup/MCP_SETUP_GUIDE.md#저장소를-클론해서-실행) 에 있습니다.

## 사용 예시

각 예시의 JSON 은 AI 가 `egov_search_knowledge` 에 넘기는 인자입니다.

### 예시 1. 공식 가이드 검색

```text
User: "eGovFrame Spring Boot 환경에서 트랜잭션 어떻게 설정해?"
```

```json
{ "query": "Spring Boot 트랜잭션 설정", "scope": "guide", "limit": 5 }
```

`## eGovFrame 가이드 검색 결과 (5건)` 아래에 결과마다 제목, 문서, 분류, 소스 경로, URL, 유사도, 본문이 나옵니다. 본문이 1,500자를 넘는 결과는 앞부분만 싣고, 나머지를 읽을 `chunkId` 와 `filters.offset` 값을 안내합니다.

### 예시 2. 통합 검색 (scope 생략)

```text
User: "페이징 처리 관련 자료 다 보여줘"
```

```json
{ "query": "페이징 처리" }
```

`scope` 와 필터가 없고 `query` 만 있으므로 `all` 로 처리됩니다. `# 통합 지식 검색 결과` 아래에 공식 가이드, 개발자 지식, 공통컴포넌트, 호환 소프트웨어 네 섹션이 출처마다 5건까지 나옵니다.

### 예시 3. 호환 소프트웨어 조회

```text
User: "eGovFrame 4.3 에서 검증된 CMS 솔루션이 뭐가 있어?"
```

```json
{ "scope": "compatibility", "filters": { "frameworkVersion": "4.3", "category": "CMS Solution" }, "limit": 50 }
```

`## 호환 소프트웨어 검색 결과` 아래의 JSON 에 조건에 맞는 전체 건수(`total`)와 제품 목록(`software`)이 확인일자가 최근인 순서로 나옵니다.

### 예시 4. 공통컴포넌트 의존성 확인

```text
User: "bbs (게시판) 공통컴포넌트가 어떤 다른 컴포넌트에 의존하지?"
```

```json
{ "scope": "components", "action": "dependencies", "filters": { "componentId": "bbs" } }
```

`## 의존성 해결 결과` 아래에 요청한 컴포넌트, 자동 추가된 의존성, 전체 필요 컴포넌트, 필요 패키지 목록이 나옵니다.

### 예시 5. 공통컴포넌트 DDL 조회

```text
User: "bbs 공통컴포넌트의 MySQL용 DDL 좀 보여줘"
```

```json
{ "scope": "components", "action": "ddl", "filters": { "componentId": "bbs", "dbType": "mysql" } }
```

`## 게시판 DDL (mysql)` 아래에 컴포넌트가 쓰는 테이블의 CREATE TABLE, 인덱스, 뷰 문이 나옵니다.

### 예시 6. 공통컴포넌트 소스 코드 읽기

```text
User: "공통(cmm) 컴포넌트의 EgovFileMngServiceImpl 구현 좀 열어봐"
```

먼저 소스 파일 목록에서 경로를 찾습니다.

```json
{ "scope": "components", "action": "sourceFiles", "filters": { "componentId": "cmm" } }
```

그 경로를 `filePath` 로 넘겨 내용을 읽습니다. `readSource` 에는 `componentId` 가 필요하지 않습니다.

```json
{
  "scope": "components",
  "action": "readSource",
  "filters": { "filePath": "src/main/java/egovframework/com/cmm/service/impl/EgovFileMngServiceImpl.java" }
}
```

## 지식베이스 갱신

패키지에 들어 있는 지식베이스는 배포 시점의 자료입니다. 서버에는 패키지를 다시 설치하지 않고 공식 가이드, 개발자 지식, 공통컴포넌트 소스를 갱신하는 `update` 명령이 함께 들어 있습니다. 갱신한 자료는 패키지가 아니라 사용자 데이터 디렉토리에 저장되고, AI 클라이언트를 다시 시작한 뒤부터 검색에 반영됩니다.

```bash
npx -y --package=<TGZ> egovframe-mcp-search update --check    # 현재 버전과 원격의 최신 버전만 조회
```

5.1.0 Beta 에서는 갱신하기 전에 `--check` 로 갱신 후보를 먼저 확인하기를 권장합니다. 원격의 태그를 버전 순으로 견주는 방식 때문에 동봉된 자료보다 오래된 자료가 갱신 후보로 표시되는 경우가 있기 때문입니다. 호환 소프트웨어 목록은 이 명령으로 갱신되지 않으며, 새 버전의 배포 파일을 사용해야 반영됩니다. 옵션과 주의할 점은 [`docs/operations/KNOWLEDGE_BASE_GUIDE.md`](docs/operations/KNOWLEDGE_BASE_GUIDE.md) 에 있습니다.

## 네트워크 접근

MCP 서버가 검색에 쓰는 데이터는 모두 로컬에 있습니다.

- 검색 중에 외부 API 를 호출하지 않습니다.
- 질의와 검색 결과를 외부로 보내지 않습니다.
- 임베딩도 로컬 모델(Transformers.js)로 계산합니다.

네트워크에 접속하는 것은 자료를 내려받는 다음 명령뿐입니다.

- `update` 명령(`--from-file` 없이 실행할 때)과 `npm run build-index` 의 online 모드: 가이드, 공통컴포넌트 소스, 개발자 지식 스냅샷 (github.com, api.github.com)
- 저장소를 클론해서 쓸 때의 `git submodule update --init`(github.com), `npm run fetch-model`(huggingface.co), `npm install` 과 `npm run pack:platforms`, `npm run inspector`(npm 레지스트리)

폐쇄망에서는 배포 파일을 그대로 사용하고, 자료를 갱신해야 하면 `update --from-file` 로 반입한 파일을 적용합니다.

## 기술 스택

| 구분 | 내용 |
|------|------|
| Protocol | MCP (Model Context Protocol), stdio 전송 |
| MCP SDK | `@modelcontextprotocol/sdk` v1.29.0 |
| Language | TypeScript v5.9.3 |
| Runtime | Node.js 22 (필수) |
| Vector Database | LanceDB (`@lancedb/lancedb` v0.22.3) |
| Database | SQLite (`better-sqlite3` v12.11.1) |
| Embedding | `@xenova/transformers` v2.17.2 (모델 `Xenova/multilingual-e5-small`, 384차원) |
| Schema Validation | `zod` v4.4.3 |
| Test | Vitest v1.6.1 |

## 아키텍처

```text
            MCP client (stdio, JSON-RPC)
                         │
               egov_search_knowledge
                         │
      ┌────────────┬─────┴──────┬───────────────┐
      ▼            ▼            ▼               ▼
    guide      knowledge    components    compatibility
      │            │         │      │           │
      ▼            ▼         ▼      ▼           ▼
   LanceDB      LanceDB   SQLite  files       SQLite
```

| 저장소 | 내용 | 위치 |
|--------|------|------|
| SQLite | 호환 소프트웨어 목록, 공통컴포넌트 메타와 의존성 | `knowledge-base/egovframe.db` |
| LanceDB | 공식 가이드 청크, 개발자 지식의 벡터와 본문 | `knowledge-base/egovframe_guide.lance/`, `knowledge-base/developer_knowledge.lance/` |
| 소스 파일 (files) | 공통컴포넌트의 소스와 DDL, DML 스크립트 | `templates/common-components-src/` |

서버는 SQLite 를 읽기 전용으로 열고, LanceDB 테이블은 있는 것을 열기만 합니다. 임베딩은 `@xenova/transformers` 로 모델을 로컬에서 실행해 계산합니다. 저장 구조와 검색 방식은 [`docs/architecture/HYBRID_SYSTEM_GUIDE.md`](docs/architecture/HYBRID_SYSTEM_GUIDE.md) 에, 테이블 스키마는 [`docs/architecture/DATABASE_SCHEMA.md`](docs/architecture/DATABASE_SCHEMA.md) 에 있습니다.

## 폴더 구조

```text
egovframe-mcp-search/
├── src/
│   ├── index.ts                # 진입점 (인자 없음: MCP 서버, update: 갱신 명령, --version, --help)
│   ├── server.ts               # MCP 서버 (egov_search_knowledge 등록, 입력 스키마)
│   ├── tools/                  # 도구 본체와 출처별 조회 (공통컴포넌트, 호환 소프트웨어, 개발자 지식)
│   ├── rag/                    # 로컬 임베딩, 가이드 청킹, 공식 가이드와 개발자 지식의 의미 검색
│   ├── database/               # SQLite 접근과 키워드 검색, 조회용 매니저
│   ├── kb/                     # 지식베이스 구축과 갱신의 공용 모듈 (스냅샷, 원격 소스, 색인, 적재)
│   ├── cli/                    # update 명령 (리소스별 갱신, 롤백)
│   ├── scripts/                # build-index (인덱스 구축, 소스 저장소 확보)
│   ├── types/                  # 공용 타입
│   └── utils/                  # 경로 해석, 오류 문구, 검색어 처리, 내려받기 등
├── scripts/                    # 배포 tgz 생성, 임베딩 모델 내려받기, 원본 데이터 변환 스크립트
├── templates/                  # build-index 의 입력 원본
│   ├── common-components-src/  # 공통컴포넌트 소스와 SQL 스크립트 (git 서브모듈)
│   ├── common-components.json  # 공통컴포넌트 메타와 의존성
│   ├── compatibility/          # 호환 소프트웨어 목록
│   ├── developer_knowledge/    # 개발자 지식 원본 (FAQ xlsx, 적용가이드 PDF)
│   └── egovframe_guide/        # 공식 가이드 마크다운 (git 서브모듈)
├── knowledge-base/             # build-index 결과물 (git 에 포함)
│   ├── egovframe.db            # SQLite (호환 소프트웨어, 공통컴포넌트 메타)
│   ├── egovframe_guide.lance/  # LanceDB (공식 가이드)
│   ├── developer_knowledge.lance/   # LanceDB (개발자 지식)
│   ├── state.json              # 리소스별 적용 버전 기록
│   └── manifest.json, snapshot.jsonl.gz   # 개발자 지식 스냅샷
├── models/                     # 임베딩 모델 (git 미추적, npm run fetch-model 로 생성, tgz 에 동봉)
├── tests/                      # Vitest 테스트 (unit, integration)
├── docs/                       # 상세 문서 (아래 "문서" 참조)
├── notebooks/                  # 데이터 변환 스크립트와 탐색 노트북
├── build/                      # tsc 결과물 (git 미추적)
└── dist/                       # 배포 tgz (git 미추적)
```

## 빌드와 테스트

| 명령 | 동작 |
|------|------|
| `npm run build` | `build/` 를 지우고 TypeScript 를 다시 컴파일 |
| `npm test` | 빌드한 뒤 Vitest 로 단위 테스트와 통합 테스트 전체를 실행 |
| `npm run inspector` | 빌드된 서버를 MCP Inspector 에 연결 (네트워크 필요) |
| `npm run build-index` | `templates/` 의 원본 데이터로 지식베이스를 다시 구축 |
| `npm run pack:platforms` | 플랫폼별 배포 tgz 를 `dist/` 에 생성 |

테스트 구성은 [`docs/development/TESTING_GUIDE.md`](docs/development/TESTING_GUIDE.md) 에, 배포 파일을 만드는 방법은 [`docs/operations/DEPLOYMENT_GUIDE.md`](docs/operations/DEPLOYMENT_GUIDE.md) 에, 지식베이스를 다시 구축하거나 갱신하는 방법은 [`docs/operations/KNOWLEDGE_BASE_GUIDE.md`](docs/operations/KNOWLEDGE_BASE_GUIDE.md) 에 있습니다.

## 문서

상세 문서는 [`docs/`](docs/README.md) 에 주제별 폴더로 나뉘어 있습니다.

| 문서 | 설명 |
|------|------|
| [`docs/setup/MCP_SETUP_GUIDE.md`](docs/setup/MCP_SETUP_GUIDE.md) | 배포 파일을 AI 클라이언트에 등록하는 방법, 환경 변수, 문제 해결 |
| [`docs/reference/EGOV_SEARCH_KNOWLEDGE_TOOL.md`](docs/reference/EGOV_SEARCH_KNOWLEDGE_TOOL.md) | `egov_search_knowledge` 사용법 (scope, action, 필터, 응답 형식, 프롬프트 예시) |
| [`docs/reference/MCP_REFERENCE.md`](docs/reference/MCP_REFERENCE.md) | 공개 MCP API 요약 (파라미터, 필터, 응답과 오류의 형태) |
| [`docs/reference/EXPOSED_TOOLS.md`](docs/reference/EXPOSED_TOOLS.md) | 노출 도구 목록과 노출되지 않는 옛 도구 이름 |
| [`docs/architecture/HYBRID_SYSTEM_GUIDE.md`](docs/architecture/HYBRID_SYSTEM_GUIDE.md) | SQLite 와 LanceDB 로 이루어진 저장 구조와 검색 방식 |
| [`docs/architecture/DATABASE_SCHEMA.md`](docs/architecture/DATABASE_SCHEMA.md) | 테이블 스키마와 데이터 통계 |
| [`docs/operations/DEPLOYMENT_GUIDE.md`](docs/operations/DEPLOYMENT_GUIDE.md) | 플랫폼별 배포 tgz 의 제작과 점검 |
| [`docs/operations/KNOWLEDGE_BASE_GUIDE.md`](docs/operations/KNOWLEDGE_BASE_GUIDE.md) | 지식베이스 구축(`build-index`)과 갱신(`update` 명령) |
| [`docs/development/TESTING_GUIDE.md`](docs/development/TESTING_GUIDE.md) | 빌드와 테스트 실행 방법, 테스트 구성 |
| [`docs/development/KNOWN_ISSUES.md`](docs/development/KNOWN_ISSUES.md) | 알려진 문제와 후속 작업 |
| [`docs/release-notes/v5.1.0-beta.md`](docs/release-notes/v5.1.0-beta.md) | 5.1.0 Beta 릴리스 노트와 배포 파일의 체크섬 |

## 변경 이력

| 버전 | 배포일 | 내용 |
|------|--------|------|
| v5.1.0 Beta | 2026-11-27 | 최초 배포 버전 ([릴리스 노트](docs/release-notes/v5.1.0-beta.md)) |

이번 버전은 베타 버전입니다. 문제가 있으면 [GitHub Issues](https://github.com/eGovFramework/egovframe-mcp-search/issues) 에 알려 주세요.

## 함께 쓰는 MCP 서버

이 서버는 검색과 조회만 제공합니다. 프로젝트 생성과 준수 점검은 다음 서버가 제공합니다.

- **[egovframe-mcp-codegen](https://github.com/eGovFramework/egovframe-mcp-codegen)**: DDL 로부터 eGovFrame 프로젝트와 엔티티 코드 생성
- **[egovframe-mcp-check](https://github.com/eGovFramework/egovframe-mcp-check)**: eGovFrame 프로젝트의 레이어별 아키텍처 준수 점검 (정적 분석)

## 라이선스

Apache-2.0 라이선스를 따릅니다. 전문은 [`LICENSE`](LICENSE) 에 있습니다.

## Credits

- eGovFrame Framework Team
- Model Context Protocol by Anthropic
- LanceDB for vector database
- Transformers.js for local embeddings

[egovframe-vscode-initializr](https://github.com/eGovFramework/egovframe-vscode-initializr) 를 기반으로 합니다.
