# eGovFrame MCP Search

> **eGovFrame 공식 가이드 · 개발자 지식 · 공통컴포넌트 · 호환 소프트웨어를 하나의 MCP 도구로 통합 검색**

[![eGovFrame](https://img.shields.io/badge/eGovFrame-5.1.0-134F8C?labelColor=white&logo=data:image/svg%2Bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNzMuMjgyIDE3My4yODIiPjxwYXRoIGZpbGw9IiNmZmYiIGQ9Ik0xNzMuMjgyIDg2LjY1YzAgNDcuODQ0LTM4Ljc5NCA4Ni42MzItODYuNjQ2IDg2LjYzMkMzOC43OTkgMTczLjI4MiAwIDEzNC40OTQgMCA4Ni42NSAwIDM4Ljc4OCAzOC43OTkgMCA4Ni42MzYgMGM0Ny44NTIgMCA4Ni42NDYgMzguNzg4IDg2LjY0NiA4Ni42NSIvPjxwYXRoIGZpbGw9IiMwMDM3NjQiIGQ9Ik0xMjcuMzg5IDgwLjU5OGMtMTMuNzkxLTkuMzY1LTMxLjQzOS01LjU0Mi00MC43MTcgOC41MzMtNy43MiAxMS43NjctMTkuNDA1IDEzLjIzNS0yMy45MDYgMTMuMjM1LTE0Ljc1MSAwLTI0LjgyNC0xMC4zNjctMjcuODE4LTIxLjA5NWgtLjAxYy0uMDM5LS4xMDgtLjA1OS0uMi0uMDktLjMwNy0uMDI1LS4xMi0uMDU2LS4yMzMtLjA4OS0uMzY2LTEuMTc3LTQuNDY3LTEuNDY3LTYuNjA5LTEuNDY3LTExLjM2OCAwLTI1LjY1IDI2LjMyMS01NC4yMTMgNjQuMjE1LTU0LjIxMyAzOC44MjkgMCA2MS4wNSAyOS41NDUgNjYuNzggNDUuOTc5LS4xMDctLjI5NS0uMjA5LS41ODEtLjI5MS0uODc3LTExLjAxNS0zMi4xMjUtNDEuNDc0LTU1LjIxNi03Ny4zNTctNTUuMjE2LTQ1LjEzIDAtODEuNzI5IDM2LjU5LTgxLjcyOSA4MS43MzkgMCA0MC4zNTEgMjkuMTA4IDc0Ljg5MSA2OS40NzkgNzQuODkxIDMyLjE5NyAwIDUzLjg0Mi0xOC4wNTIgNjMuNzU3LTQyLjkzIDUuNDUtMTMuNjE0IDEuNTk1LTI5LjYwNS0xMC43NTctMzguMDA1Ii8%2BPHBhdGggZmlsbD0iI2U0MDMyZSIgZD0iTTE2NC43ODggNjIuNTg5Yy00Ljc3Ny0xNi4wMjYtMjcuMTUzLTQ3LjU3MS02Ny4yODItNDcuNTcxLTM3Ljg5NCAwLTY0LjIxNCAyOC41NjMtNjQuMjE0IDU0LjIxMiAwIDQuNzU5LjI5IDYuOTAxIDEuNDY2IDExLjM2OC0uNDg5LTEuOTUxLS43NC0zLjkwOC0uNzQtNS44MjMgMC0yNi43MjEgMjYuNzQxLTQ1LjIyNyA1NC4yNDgtNDUuMjI3IDM3LjIxOCAwIDY3LjM4OCAzMC4xNzQgNjcuMzg4IDY3LjM5IDAgMjkuMTczLTE2Ljc4NSA1NC40MzctNDEuMTc5IDY2LjU2NXYuMDIzYzMxLjQ1NS0xMS4zOTEgNTMuOTA4LTQxLjUxMiA1My45MDgtNzYuODg0IDAtOC4zNzgtMS4xMjctMTUuNzU5LTMuNTk1LTI0LjA1MyIvPjwvc3ZnPg%3D%3D)](https://www.egovframe.go.kr)
[![Node](https://img.shields.io/badge/node-22.x-brightgreen.svg)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

## 📖 MCP 개요

**MCP (Model Context Protocol)** 는 Anthropic 이 공개한 개방형 표준으로, LLM 클라이언트(Claude Desktop, Cursor, Claude Code 등)와 외부 도구·데이터 소스를 일관된 방식으로 연결합니다. MCP 서버는 JSON-RPC 로 통신하면서, LLM 이 호출할 수 있는 **도구(Tool)** 목록과 각 도구의 입력 스키마를 클라이언트에 알려 줍니다. 이 서버는 stdio 전송을 사용합니다.

**eGovFrame MCP Search** 는 전자정부 표준프레임워크(eGovFrame) 개발에 필요한 네 가지 자료를 `egov_search_knowledge` 도구 하나로 검색합니다.

1. **공식 가이드**: 표준프레임워크 공식 가이드 문서([egovframe-docs](https://github.com/eGovFramework/egovframe-docs))의 의미 검색
2. **개발자 지식**: 표준프레임워크 포털의 묻고답하기(Q&A), FAQ, 적용가이드 PDF 의 의미 검색
3. **공통컴포넌트**: 컴포넌트 목록과 상세 정보, 의존성, 소스 파일, DDL·DML 스크립트 조회
4. **호환 소프트웨어**: 표준프레임워크 버전별 호환 소프트웨어 목록 조회

자료는 SQLite(정형 데이터)와 LanceDB(벡터 검색)에 나누어 저장합니다. 지식베이스와 임베딩 모델(`Xenova/multilingual-e5-small`, 384차원)이 모두 로컬에 있어서, 검색할 때는 네트워크에 접속하지 않습니다.

도구는 읽기 전용입니다. 지식베이스에 이미 있는 자료를 찾아 줄 뿐이고, 새 스키마를 설계하거나 내용을 저장하지 않습니다. LLM 은 사용자의 질문에서 `scope`(검색할 출처)와 `action`(공통컴포넌트의 하위 동작)을 정하면 되고, 출처별 조회와 응답 구성은 서버가 처리합니다.

## 🛠️ 제공 도구 (Tools)

이 MCP 서버는 도구 **하나**만 노출합니다. 리소스와 프롬프트는 노출하지 않습니다.

| Tool | 분류 | 용도 |
|------|------|------|
| [`egov_search_knowledge`](#egov_search_knowledge) | 통합 검색 (읽기 전용) | 공식 가이드, 개발자 지식, 공통컴포넌트(미리 만들어진 CREATE TABLE·INSERT 문 포함), 호환 소프트웨어 조회 |

예전에 따로 있던 도구(`search_guide`, `list_common_components` 등)는 모두 `egov_search_knowledge` 의 `scope` 와 `action` 으로 통합되었습니다. 등록되지 않은 이름으로 호출하면 JSON-RPC 오류가 아니라 `isError: true` 인 도구 결과(`MCP error -32602: Tool <이름> not found`)가 돌아옵니다.

아래는 요약입니다. 파라미터와 응답 형식의 상세한 설명은 [`docs/EGOV_SEARCH_KNOWLEDGE_TOOL.md`](docs/EGOV_SEARCH_KNOWLEDGE_TOOL.md) 에 있습니다.

### `egov_search_knowledge`

| 파라미터 | 타입 | 설명 |
|----------|------|------|
| `query` | string | 검색 질문 또는 키워드. `guide`, `knowledge`, `all` 에서는 필수(`knowledge` 에서 `filters.sort` 가 `"recent"` 이면 예외). `components` 와 `compatibility` 에서는 선택이며, 주면 키워드 검색을 실행 |
| `scope` | enum | 검색할 출처: `auto`(기본), `guide`, `knowledge`, `components`, `compatibility`, `all` |
| `action` | enum | `components` 에서만 쓰는 하위 동작: `get`, `info`, `dependencies`, `sourceFiles`, `readSource`, `ddl`, `dml` |
| `filters` | object | scope 별 필터. 정의되지 않은 키나 타입이 틀린 값은 입력 검증 오류 |
| `limit` | integer | 최대 결과 수(1~200). 기본값은 `guide` 5, `knowledge` 5, `components` 키워드 검색 20, `compatibility` 20 이고, `all` 은 출처마다 5 |
| `strictScope` | boolean | 효과 없음. 하위 호환을 위해 받기만 함 |

- 파라미터는 모두 선택입니다. 아무것도 주지 않으면 공통컴포넌트의 카테고리 개요와 통계가 돌아옵니다.
- `limit` 의 scope 별 최댓값은 `guide` 20, `knowledge` 20, `components` 200, `compatibility` 100 입니다. 더 큰 값은 최댓값으로 줄여 적용하고, 응답 끝에 그 사실을 알립니다.
- 선택된 scope 나 action 이 쓰지 않는 필터는 무시하고, 무시한 키를 응답 끝에 알립니다.
- 입력 스키마를 어긴 호출과 실행 중에 난 오류는 `isError: true` 인 결과로 돌아옵니다.

### scope 매트릭스

| scope | 대상 (저장소) | 조회 방식 | `filters` 키 | 질문 예 |
|-------|---------------|-----------|--------------|---------|
| `guide` | 공식 가이드 (LanceDB) | 의미 검색 | `layer`, `category` | "트랜잭션 설정 방법" |
| `knowledge` | 개발자 지식 (LanceDB) | 의미 검색, 최근 색인 순 목록 | `type`, `tags`, `minImportance`, `verifiedOnly`, `sort`, `knowledgeScope` | "페이징 처리가 안 될 때의 Q&A 사례" |
| `components` | 공통컴포넌트 (SQLite + 소스 파일) | 키워드 검색, 목록, `action` 별 조회 | `componentId`, `componentIds`, `filePath`, `dbType`, `table`, `categoryId`, `keyword`, `hasWeb`, `version` | "게시판 컴포넌트의 의존성, DDL, 소스 파일" |
| `compatibility` | 호환 소프트웨어 (SQLite) | 필터 조회, 키워드 검색 | `frameworkVersion`, `category`, `vendor`, `productName`, `minLevel`, `includeKnowledge` | "표준프레임워크 4.3 과 호환되는 CMS" |
| `all` | 네 출처 전부 | 출처마다 검색한 결과를 한 응답에 모으는 통합 검색 | 각 필터는 그 필터를 쓰는 출처에만 적용 | "페이징 처리 관련 자료 전부" |
| `auto` | 입력에서 추론 | 아래 규칙 참조 | - | scope 를 지정하지 않은 호출 |

구간을 나눠 조회할 때는 `filters.offset` 을 씁니다. `compatibility`, `components` 의 `action: "dml"`(`filters.table` 을 준 경우), `action: "readSource"` 에서 쓸 수 있습니다. `filters.limit` 은 최상위 `limit` 과 같은 뜻이고, 둘 다 주면 최상위 값이 우선합니다.

`scope` 를 생략하면(`auto`) 다음 순서로 출처를 정합니다.

1. `action` 이 있거나 컴포넌트 필터(`componentId`, `componentIds`, `filePath`, `dbType`, `table`, `categoryId`, `hasWeb`)가 있으면 `components`
2. 호환성 필터(`frameworkVersion`, `vendor`, `productName`, `minLevel`, `includeKnowledge`)가 있거나 `category` 값이 호환 소프트웨어의 분류 이름이면 `compatibility`
3. `layer` 가 있거나 `category` 값이 공식 가이드의 category 이면 `guide`
4. 지식 필터(`type`, `tags`, `minImportance`, `verifiedOnly`, `sort`)가 있으면 `knowledge`
5. 그 밖에는 `query` 가 있으면 `all`, 없으면 `components` 의 카테고리 개요

### components 의 action 별 동작

| action | 필요한 `filters` | 동작 |
|--------|------------------|------|
| (없음) | - | `componentId` 가 있으면 상세 정보, `query` 가 있으면 키워드 검색, `categoryId`·`keyword`·`hasWeb`·`version` 만 있으면 목록, 아무것도 없으면 카테고리 개요와 통계 |
| `get` / `info` | `componentId` | 컴포넌트 상세 정보 (기본 정보, 설명, 사용 테이블, 의존성) |
| `dependencies` | `componentIds`(배열) 또는 `componentId` | 간접 의존성까지 모두 해결한 결과 (추가로 필요한 컴포넌트, 전체 컴포넌트와 패키지 목록) |
| `sourceFiles` | `componentId` | 컴포넌트의 소스 파일 목록 |
| `readSource` | `filePath` | 소스 파일 하나의 내용. 한 번에 60,000자까지이며 `filters.offset` 으로 이어서 읽음 |
| `ddl` | `componentId`, `dbType`(선택) | 컴포넌트가 쓰는 테이블의 CREATE TABLE, 인덱스, 뷰 문 |
| `dml` | `componentId`, `dbType`(선택), `table`(선택) | 초기 데이터 INSERT 문. 기본은 테이블마다 처음 20건이고, `table` 을 주면 그 테이블을 `limit`(최대 100)과 `filters.offset` 으로 나눠 조회 |

- `componentId` 에는 컴포넌트 ID(`bbs`), 패키지명(`egovframework.com.cop.bbs`), 정확한 컴포넌트 이름(`게시판`)을 쓸 수 있습니다. 컴포넌트 ID 는 키워드 검색과 목록의 결과에 나옵니다.
- `filePath` 는 `sourceFiles` 가 출력한 경로(소스 루트 기준 상대 경로)를 그대로 씁니다.
- `dbType` 은 `mysql`(기본), `maria`, `oracle`, `postgres`, `tibero`, `cubrid`, `altibase`, `goldilocks` 가운데 하나이고, 별칭 `mariadb`, `postgresql`, `pgsql` 도 받습니다. 그 밖의 값은 오류입니다.

## 🚀 설치 (Installation)

### Prerequisites

- **Node.js 22**: 저장소의 `.nvmrc` 가 22 를 가리킵니다. `better-sqlite3` 의 네이티브 바이너리는 설치하거나 패키징할 때의 Node 메이저 버전에 맞춰 만들어집니다. MCP 클라이언트가 다른 메이저 버전의 `node` 로 서버를 실행하면 서버는 시작되지만, 공식 가이드 검색을 뺀 나머지 조회(개발자 지식, 공통컴포넌트, 호환 소프트웨어)가 "네이티브 모듈(better-sqlite3)을 불러오지 못했습니다" 오류로 응답합니다. `package.json` 의 `engines` 는 `>=20` 으로 적혀 있지만, 개발과 패키징과 실행은 모두 Node.js 22 를 기준으로 합니다.
- **npm**: Node.js 22 에 포함된 npm (10.x)
- **git**: 서브모듈과 가이드 소스를 받는 데 사용

### Install & Build

저장소를 클론해서 쓰는 절차입니다.

```bash
git clone https://github.com/eGovFramework/egovframe-mcp-search.git
cd egovframe-mcp-search
nvm use                        # nvm 을 쓰는 경우: .nvmrc 에 따라 Node.js 22 선택
git submodule update --init    # templates/common-components-src, templates/egovframe_guide
npm install                    # 의존성 설치. prepare 스크립트가 빌드(npm run build)까지 실행
npm run fetch-model            # 임베딩 모델을 models/ 에 내려받음 (약 130MB, 네트워크 필요)
```

저장소에는 미리 구축한 지식베이스(`knowledge-base/`)가 들어 있으므로, 위 단계를 마치면 바로 MCP 클라이언트에 등록할 수 있습니다(아래 "MCP 클라이언트 설정" 참조).

- `models/` 는 파일 크기 때문에 git 에 넣지 않습니다. 모델이 없으면 공식 가이드와 개발자 지식의 의미 검색이 "임베딩 모델을 찾을 수 없습니다 (models/Xenova/multilingual-e5-small). 저장소를 클론해 쓰는 경우 npm run fetch-model 을 실행하세요." 로 응답합니다. 공통컴포넌트와 호환 소프트웨어 조회는 모델 없이 동작합니다.
- `templates/common-components-src` 서브모듈이 없으면 공통컴포넌트의 `sourceFiles`, `readSource`, `ddl`, `dml` 이 "공통컴포넌트 소스가 설치되어 있지 않습니다" 오류로 응답합니다. 목록, 상세 정보, 의존성 조회는 서브모듈 없이 동작합니다.
- `templates/egovframe_guide` 서브모듈은 `npm run build-index` 로 가이드 인덱스를 다시 만들 때만 필요합니다.

### 배포 패키지 (tgz)

저장소를 클론하기 어려운 환경(폐쇄망 등)에는 플랫폼별 tgz 로 배포합니다. tgz 에는 `package.json` 의 `files`(`build`, `templates/common-components-src`, `knowledge-base`, `models`)와, `bundleDependencies` 설정에 따라 실행에 필요한 의존성(`node_modules`)이 함께 들어 있습니다. 그래서 설치할 때 다른 패키지를 내려받지 않습니다.

```bash
npm run pack:platforms                            # 기본 타깃 5종의 tgz 를 dist/ 에 생성
PACK_TARGETS="linux-x64" npm run pack:platforms   # 타깃을 지정해서 생성
```

- 기본 타깃은 `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, `win32-x64` 이고, 결과물은 `dist/egovframe-mcp-search-<버전>-<타깃>.tgz` 입니다. linux 타깃은 glibc 용입니다.
- Node.js 22 에서 실행합니다. `better-sqlite3` 바이너리가 패키징할 때의 Node 메이저 버전에 고정되므로, 만들어진 tgz 는 Node.js 22 와 해당 플랫폼에서만 동작합니다.
- 스크립트가 타깃마다 `node_modules` 를 지우고 `npm ci` 를 다시 실행하므로 네트워크가 필요합니다. `models/` 가 없으면 먼저 내려받습니다. `templates/common-components-src` 서브모듈은 확인하지 않으므로 미리 초기화해 둡니다.
- tgz 는 이 스크립트로 만듭니다. `npm ci` 를 실행한 직후가 아닌 `node_modules` 에서 `npm pack` 만 실행하면 네이티브 바이너리(`better_sqlite3.node` 등)가 tgz 에서 빠질 수 있습니다.

대상 PC 에서는 Node.js 22 로 설치합니다.

```bash
npm install -g ./egovframe-mcp-search-<버전>-<타깃>.tgz
egovframe-mcp-search --version
```

설치하면 `egovframe-mcp-search` 명령이 생기고, 패키지는 전역 `node_modules`(`npm root -g` 로 확인) 아래의 `egovframe-mcp-search/` 에 놓입니다. MCP 클라이언트에는 그 안의 `build/index.js` 를 등록합니다.

### Knowledge Base 구축

`npm run build-index` 는 `templates/` 의 원본 데이터로 `knowledge-base/` 를 다시 만듭니다. 저장소와 배포 tgz 에 지식베이스가 이미 들어 있으므로, 원본 데이터를 바꿨거나 인덱스를 새로 만들어야 할 때만 실행합니다. 공식 가이드와 개발자 지식 전체를 다시 임베딩하므로 임베딩 모델(`models/`)이 필요하고, 스크립트가 출력하는 예상 소요 시간은 수십 분입니다.

```bash
npm run build-index                                    # 대화형: 소스 모드(기본 online)와 버전 태그를 묻고 실행 계획을 확인
npm run build-index -- --yes                           # 비대화형: bundled 모드 (네트워크 접속 없음)
npm run build-index -- --source=online --yes           # 비대화형 online: 소스는 현재 체크아웃을 유지
npm run build-index -- --source=online \
  --guide-tag=v5.0.0-ready-2026-contribution \
  --components-tag=v5.0.1 --yes                        # 소스 버전(태그) 지정
npm run build-index -- --source=local \
  --template-dir=/media/usb/kb --yes                   # 반입한 디렉토리 사용 (폐쇄망)
```

옵션 값은 `--옵션=값` 형태로 적습니다. `--yes` 는 `-y` 로 줄여 쓸 수 있습니다.

| 소스 모드 | 동작 |
|-----------|------|
| `online` | github.com 에서 공통컴포넌트와 가이드 소스 저장소의 태그를 받아 옵니다. 대화형 실행에서는 적용할 태그를 묻고, 비대화형 실행에서는 `--guide-tag`, `--components-tag` 로 지정한 태그를 체크아웃하며, 지정하지 않으면 현재 체크아웃을 유지합니다. 개발자 지식은 릴리스 스냅샷을 내려받고, 받지 못하면 `templates/developer_knowledge/` 의 파일을 씁니다. github.com 에 접속할 수 없으면 대화형 실행은 `local` 과 `bundled` 가운데 하나를 다시 묻고, 비대화형 실행은 `bundled` 로 진행합니다. |
| `local` | `--template-dir` 아래의 `egovframe_guide/`(가이드 마크다운)와 `developer_knowledge/`(스냅샷 쌍 또는 xlsx)를 씁니다. 없는 것은 저장소의 `templates/` 로 대신합니다. 공통컴포넌트 메타, 호환 소프트웨어 목록, 적용가이드 PDF 는 항상 저장소의 `templates/` 에서 읽습니다. |
| `bundled` | 저장소의 현재 체크아웃만 쓰고 네트워크에 접속하지 않습니다. `--source` 없이 `--yes` 만 주었을 때의 기본값입니다. |

소스 모드, 버전 태그, 실행 계획 확인 같은 질문은 모두 빌드를 시작하기 전에 끝나고, 그 뒤로는 입력 없이 끝까지 진행합니다. 새 인덱스는 `knowledge-base.staging/` 에 만든 뒤 검증을 거쳐 `knowledge-base/` 와 교체하므로, 도중에 실패해도 기존 인덱스는 그대로 남습니다. 직전 인덱스는 `knowledge-base.prev/` 에 하나 보존됩니다.

결과물은 `egovframe.db`(SQLite), `egovframe_guide.lance/` 와 `developer_knowledge.lance/`(LanceDB), `state.json`(리소스별 적용 버전 기록), `manifest.json` 과 `snapshot.jsonl.gz`(개발자 지식 스냅샷)입니다. `update` CLI 는 `state.json` 으로 동봉 리소스의 현재 버전을 판단하고, `snapshot.jsonl.gz` 를 기준으로 개발자 지식의 변경분을 계산합니다.

## 🔄 지식베이스 갱신 (update CLI)

`update` 는 지식베이스를 원격의 최신 자료로 갱신하는 CLI 입니다. 갱신분은 패키지 디렉토리가 아니라 **사용자 데이터 디렉토리(오버레이)** 에 저장하므로, 패키지를 다시 설치하거나 업그레이드해도 남습니다. 서버는 리소스마다 오버레이에 유효한 갱신분이 있으면 그것을 읽고, 없으면 패키지에 동봉된 것을 읽습니다.

```bash
egovframe-mcp-search update [옵션]     # tgz 를 npm install -g 로 설치한 경우
node build/index.js update [옵션]      # 저장소를 클론한 경우 (저장소 루트에서 실행)
```

`npx egovframe-mcp-search update` 도 이 두 곳(전역 설치한 PC, 저장소 루트)에서는 같은 CLI 를 실행합니다. 이 패키지는 npm 레지스트리에 게시하지 않으므로(`"private": true`), 그 밖의 위치에서는 `npx` 형태를 쓰지 않습니다. CLI 의 출력은 모두 stderr 로 나갑니다.

```bash
egovframe-mcp-search update --check                    # 현재 버전과 원격의 최신 버전만 조회
egovframe-mcp-search update                            # 전체 리소스 갱신
egovframe-mcp-search update --resource=guide           # 리소스 한정 (쉼표로 여러 개 지정)
egovframe-mcp-search update --resource=components --components-tag=v5.0.7   # 버전 지정 (가이드는 --guide-tag)
egovframe-mcp-search update --from-file /media/usb/kb  # 반입한 파일로 갱신 (폐쇄망)
egovframe-mcp-search update --rollback                 # 직전 적용본으로 되돌림
egovframe-mcp-search update --rollback=guide           # 지정한 리소스만 되돌림
```

| 옵션 | 설명 |
|------|------|
| `--check` | 현재 적용 버전과 원격의 최신 버전을 출력하고 끝냄 |
| `--resource=<이름,...>` | 대상 리소스 한정. 이름은 `developer_knowledge`(별칭 `knowledge`), `guide`, `components`, `compatibility` |
| `--guide-tag=<태그>`, `--components-tag=<태그>` | 가이드, 공통컴포넌트의 버전 지정 |
| `--from-file=<디렉토리>` | 내려받는 대신 반입한 디렉토리의 파일로 갱신 |
| `--rollback[=<이름,...>]` | 직전 적용본으로 되돌림 |
| `--full` | 개발자 지식의 Q&A·FAQ 전체를 다시 임베딩 |
| `--force` | 가이드와 공통컴포넌트는 같은 버전도 다시 적용, 개발자 지식은 더 낮은 버전도 적용 |
| `--keep-previous` | 공통컴포넌트의 직전 버전 디렉토리 보존 |
| `--yes`, `-y` | 확인 질문 생략 |

| 리소스 | 갱신 방식 | 소스 |
|--------|-----------|------|
| `developer_knowledge` (개발자 지식의 Q&A·FAQ) | 직전에 적용한 스냅샷과 id 를 대조해 바뀐 행만 다시 임베딩. 기준 스냅샷이 없거나 `--full` 을 주면 Q&A·FAQ 전체를 다시 임베딩. 적용가이드 PDF 의 청크는 그대로 유지 | 릴리스 스냅샷 (`manifest.json` + `snapshot.jsonl.gz`) |
| `guide` (공식 가이드) | 전체 재인덱싱 | GitHub 태그의 마크다운 (이미지를 뺀 sparse checkout, 실패하면 소스 tarball) |
| `components` (공통컴포넌트 소스) | 소스 트리 교체. 임베딩 없음. 컴포넌트 목록과 설명(SQLite)은 패키지에 동봉된 것을 그대로 사용 | GitHub 태그의 소스 tarball |
| `compatibility` (호환 소프트웨어) | 비활성화. 갱신하지 않고 건너뜀 | 패키지(tgz) 업그레이드로만 반영 |

- 오버레이 위치는 macOS `~/Library/Application Support/egovframe-mcp-search`, Linux `$XDG_DATA_HOME/egovframe-mcp-search`(`XDG_DATA_HOME` 이 없으면 `~/.local/share/egovframe-mcp-search`), Windows `%LOCALAPPDATA%\egovframe-mcp-search` 입니다. `EGOV_MCP_DATA_DIR` 환경 변수로 바꿀 수 있습니다.
- 터미널에서 실행하면 갱신하기 전에 한 번 확인을 받습니다. `--yes` 를 주거나 터미널이 아닌 환경에서 실행하면 묻지 않고 진행합니다.
- 리소스는 서로 독립적으로 갱신합니다. 하나가 실패해도 나머지는 적용되고, 실패한 리소스는 이전 상태를 유지하며, 종료 코드는 1 입니다.
- 공식 가이드와 개발자 지식의 갱신분과 롤백 결과는 MCP 서버를 다시 시작한 뒤부터 검색에 반영됩니다. 공통컴포넌트 소스는 실행 중인 서버에도 다음 조회부터 반영됩니다.
- 공식 가이드와 개발자 지식의 임베딩은 로컬 모델(`models/`)로 계산합니다.
- 오버레이의 갱신분은 패키지를 업그레이드한 뒤에도 동봉본보다 우선합니다(버전을 비교하지 않습니다). 새 패키지의 동봉본을 쓰려면 `update` 로 다시 갱신하거나 `--rollback` 으로 오버레이 항목을 없앱니다.
- `--rollback` 은 직전 적용본이 남아 있으면 그것으로 돌아가고, 없으면 오버레이 항목을 지워 패키지 동봉본을 다시 쓰게 합니다. 개발자 지식과 가이드는 직전 적용본을 하나 보존하고, 공통컴포넌트는 `--keep-previous` 로 갱신했을 때만 보존합니다.
- 폐쇄망에서는 반입 디렉토리에 `manifest.json` 과 `snapshot.jsonl.gz`(개발자 지식), `guide-md.tar.gz` 또는 `egovframe_guide/` 디렉토리(가이드, 최상위가 문서 루트), `components-src.tar.gz`(공통컴포넌트, GitHub 소스 tarball 처럼 최상위 디렉토리 하나 아래에 소스 전체가 들어 있는 형태)를 넣고 `--from-file` 로 지정합니다. 파일이 없는 리소스는 건너뜁니다. 가이드와 공통컴포넌트는 `--guide-tag`, `--components-tag` 로 버전을 함께 알려 줍니다. 생략하면 버전이 `from-file` 로 기록되어, 다음에 반입한 파일이 같은 버전으로 판단되어 건너뛰어집니다(`--force` 로 다시 적용할 수 있습니다).
- 개발자 지식 스냅샷을 내려받는 주소는 `EGOV_MCP_UPDATE_URL` 환경 변수로 바꿀 수 있습니다. 릴리스 저장소에 스냅샷이 게시되어 있지 않거나 접속할 수 없으면 `--check` 는 이 리소스를 "원격 확인 실패" 로 표시합니다. 다른 리소스에 새 버전이 있어 갱신이 진행되면 이 리소스만 실패로 처리합니다.
- 현재 저장소에 커밋된 `knowledge-base/` 에는 버전 기록(`state.json`)과 스냅샷 파일(`manifest.json`, `snapshot.jsonl.gz`)이 없습니다. 이 상태에서는 `--check` 가 동봉 리소스의 현재 버전을 "(기록 없음)" 으로 표시하고, 처음 갱신할 때 가이드와 공통컴포넌트는 원격의 최신 태그를 새 버전으로 보고 내려받으며, 개발자 지식은 Q&A·FAQ 전체를 다시 임베딩합니다. `npm run build-index` 로 지식베이스를 다시 만들면 세 파일이 함께 생깁니다.

**호환 소프트웨어(SQLite) 갱신은 현재 비활성화되어 있습니다.** SQLite 로 갱신하는 리소스가 호환 소프트웨어 하나뿐이라, 오버레이에 SQLite 사본을 유지할 실익이 적다고 판단했기 때문입니다. `update` 와 `--rollback` 은 `compatibility` 를 처리하지 않고 건너뛰며, 호환 소프트웨어 목록은 패키지(tgz)를 업그레이드해야 바뀝니다. 구현은 `src/cli/sqlite/` 에 남아 있습니다.

## 🔧 MCP 클라이언트 설정 (Configuration)

MCP 클라이언트에는 Node.js 22 로 `build/index.js` 를 실행하도록 등록합니다. 경로는 절대 경로로 적습니다.

### Claude Desktop

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "egovframe-mcp-search": {
      "command": "/path/to/node",
      "args": ["/path/to/egovframe-mcp-search/build/index.js"]
    }
  }
}
```

**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "egovframe-mcp-search": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["C:\\path\\to\\egovframe-mcp-search\\build\\index.js"]
    }
  }
}
```

- `command` 는 Node.js 22 실행 파일이어야 합니다. 경로는 macOS/Linux 에서는 `which node`, Windows 에서는 `where node` 로 확인하고, 그 `node` 의 `node -v` 가 v22 인지 확인합니다. 클라이언트가 셸의 nvm 설정을 따르지 않을 수 있으므로 `"command": "node"` 보다 절대 경로가 안전합니다.
- tgz 를 `npm install -g` 로 설치했다면 `args` 에는 `npm root -g` 가 출력한 디렉토리 아래의 `egovframe-mcp-search/build/index.js` 를 적습니다.
- 서버는 `build/index.js` 가 속한 패키지 디렉토리에서 `knowledge-base/`, `models/`, `templates/common-components-src/` 를 찾으므로, 경로를 알려 주는 환경 변수는 필요하지 않습니다.
- 이 프로젝트가 정의한 환경 변수는 `EGOV_MCP_DATA_DIR`(오버레이 위치)와 `EGOV_MCP_UPDATE_URL`(개발자 지식 스냅샷을 내려받는 주소) 둘입니다. 서버가 읽는 것은 `EGOV_MCP_DATA_DIR` 뿐입니다. `update` 를 이 변수와 함께 실행했다면, 클라이언트 등록의 `env` 에도 같은 값을 넣어야 서버가 그 오버레이를 읽습니다.

### Cursor

`.cursor/mcp.json` 또는 settings 에서 같은 형식으로 등록합니다.

클라이언트별 설정의 상세한 내용은 [`docs/MCP_SETUP_GUIDE.md`](docs/MCP_SETUP_GUIDE.md) 에 있습니다.

## 💡 사용 예시 (Usage Examples)

각 예시의 JSON 은 LLM 이 `egov_search_knowledge` 에 넘기는 인자입니다.

### 예시 1. 공식 가이드 검색 (의미 검색)

```
User: "eGovFrame Spring Boot 환경에서 트랜잭션 어떻게 설정해?"
```

```json
{ "query": "Spring Boot 트랜잭션 설정", "scope": "guide", "limit": 5 }
```

`## eGovFrame 가이드 검색 결과 (5건)` 아래에 결과마다 제목, 문서, 분류, 소스 경로, URL, 유사도, 본문이 나옵니다.

### 예시 2. 통합 검색 (scope 생략)

```
User: "페이징 처리 관련 자료 다 보여줘"
```

```json
{ "query": "페이징 처리" }
```

`scope` 와 필터가 없고 `query` 만 있으므로 `all` 로 처리됩니다. `# 통합 지식 검색 결과` 아래에 공식 가이드, 개발자 지식, 공통컴포넌트, 호환 소프트웨어 네 섹션이 출처마다 5건까지 나옵니다.

### 예시 3. 호환 소프트웨어 조회

```
User: "eGovFrame 4.3 에서 검증된 CMS 솔루션이 뭐가 있어?"
```

```json
{ "scope": "compatibility", "filters": { "frameworkVersion": "4.3", "category": "CMS Solution" }, "limit": 50 }
```

`## 호환 소프트웨어 검색 결과` 아래의 JSON 에 조건에 맞는 전체 건수(`total`)와 제품 목록(`software`)이 확인일자가 최근인 순서로 나옵니다.

### 예시 4. 공통컴포넌트 의존성 확인

```
User: "bbs (게시판) 공통컴포넌트가 어떤 다른 컴포넌트에 의존하지?"
```

```json
{ "scope": "components", "action": "dependencies", "filters": { "componentId": "bbs" } }
```

`## 의존성 해결 결과` 아래에 요청한 컴포넌트, 자동 추가된 의존성, 전체 필요 컴포넌트, 필요 패키지 목록이 나옵니다.

### 예시 5. 공통컴포넌트 DDL 조회

```
User: "bbs 공통컴포넌트의 MySQL용 DDL 좀 보여줘"
```

```json
{ "scope": "components", "action": "ddl", "filters": { "componentId": "bbs", "dbType": "mysql" } }
```

`## 게시판 DDL (mysql)` 아래에 컴포넌트가 쓰는 테이블의 CREATE TABLE, 인덱스, 뷰 문이 나옵니다.

### 예시 6. 공통컴포넌트 소스 코드 읽기

```
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

## 🏗️ 아키텍처 (Architecture)

### 하이브리드 스토리지

```
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
| 소스 파일 (files) | 공통컴포넌트의 소스와 DDL·DML 스크립트 | `templates/common-components-src/` |

서버는 SQLite 를 읽기 전용으로 열고, LanceDB 테이블은 있는 것을 열기만 합니다. 임베딩은 `@xenova/transformers` 로 `Xenova/multilingual-e5-small`(384차원) 모델을 로컬에서 실행해 계산합니다. `update` CLI 로 갱신한 리소스는 사용자 데이터 디렉토리(오버레이)에서 읽습니다.

### 핵심 모듈

| 모듈                            | 역할                                                            |
|--------------------------------|----------------------------------------------------------------|
| `index.ts`                     | 진입점. 인자에 따라 MCP 서버 또는 `update` CLI 를 실행            |
| `server.ts`                    | MCP 서버. `egov_search_knowledge` 등록과 입력 스키마              |
| `tools/egovSearchKnowledge.ts` | `scope`/`action` 에 따른 분기와 응답 구성                         |
| `tools/commonComponents.ts`    | 공통컴포넌트 목록, 상세, 의존성, 소스, DDL·DML 조회                |
| `tools/compatibility.ts`       | 호환 소프트웨어 조회                                             |
| `tools/knowledge.ts`           | 개발자 지식 검색                                                 |
| `rag/embedder.ts`              | 로컬 임베딩 (Transformers.js)                                    |
| `rag/guideManager.ts`          | 공식 가이드의 LanceDB 의미 검색                                   |
| `rag/knowledgeManager.ts`      | 개발자 지식의 LanceDB 의미 검색                                   |
| `database/sqliteManager.ts`    | SQLite 접근 (호환 소프트웨어, 공통컴포넌트 메타)                   |
| `database/hybridManager.ts`    | SQLite 와 개발자 지식(LanceDB)을 함께 다루는 진입점                |
| `utils/dataPaths.ts`           | 리소스별 데이터 경로 해석 (오버레이 우선, 없으면 패키지 동봉본)     |
| `cli/update.ts`                | 지식베이스 갱신 CLI                                              |
| `scripts/buildIndex.ts`        | `templates/` 에서 `knowledge-base/` 를 만드는 인덱스 구축          |

## 🗂️ 폴더 구조 (Project Structure)

```
egovframe-mcp-search/
├── src/
│   ├── index.ts                            # 진입점 (인자 없음: MCP 서버, update: 갱신 CLI, --version, --help)
│   ├── server.ts                           # MCP 서버 (egov_search_knowledge 등록, 입력 스키마)
│   ├── cli/
│   │   ├── update.ts                       # 갱신 CLI 본체 (옵션 해석, 잠금, 상태 조회, 롤백, 리소스별 실행)
│   │   ├── shared.ts                       # CLI 공용 (옵션 타입, 리소스 표시 이름, 오버레이 버전 디렉토리)
│   │   ├── lancedb/                        # LanceDB 리소스 갱신: developerKnowledge.ts, guide.ts
│   │   ├── sqlite/                         # SQLite 리소스 갱신: overlay.ts, compatibility.ts (현재 비활성화)
│   │   └── common-components/              # 공통컴포넌트 소스 트리 갱신: commonComponents.ts
│   ├── kb/
│   │   ├── snapshot.ts                     # 개발자 지식 스냅샷 형식 (manifest, jsonl.gz, 변경분 계산)
│   │   ├── sources.ts                      # 원격 소스 주소와 태그 조회
│   │   ├── guideIndexer.ts                 # 가이드 마크다운 인덱싱 (build-index 와 update 공용)
│   │   ├── sqliteLoaders.ts                # SQLite 적재 (호환 소프트웨어, 공통컴포넌트 메타)
│   │   └── componentIds.ts                 # 공통컴포넌트 메타의 겹치는 id 를 고유하게 변환
│   ├── database/
│   │   ├── sqliteManager.ts                # SQLite 접근 계층
│   │   └── hybridManager.ts                # SQLite + 개발자 지식(LanceDB) 진입점
│   ├── rag/
│   │   ├── embedder.ts                     # 로컬 임베딩 (Transformers.js)
│   │   ├── guideManager.ts                 # 공식 가이드 의미 검색
│   │   └── knowledgeManager.ts             # 개발자 지식 의미 검색
│   ├── tools/
│   │   ├── egovSearchKnowledge.ts          # 도구 본체 (scope/action 분기, 응답 구성)
│   │   ├── commonComponents.ts             # 공통컴포넌트 메타, 소스, DDL, DML
│   │   ├── compatibility.ts                # 호환 소프트웨어
│   │   └── knowledge.ts                    # 개발자 지식
│   ├── types/                              # 공용 타입 (database.ts, knowledge.ts)
│   ├── utils/
│   │   ├── dataPaths.ts                    # 리소스별 경로 해석 (오버레이 우선), state.json 읽기와 쓰기
│   │   ├── projectPath.ts                  # 패키지 루트 기준 경로
│   │   ├── errors.ts                       # 도구 응답에 싣는 오류 문구
│   │   ├── fts5Query.ts, sqlLike.ts, lanceFilter.ts   # SQLite·LanceDB 검색식과 조건식 조립
│   │   ├── knowledgeExcerpt.ts, text.ts    # 개발자 지식 본문 발췌, 문자열 자르기
│   │   └── download.ts, tarSafe.ts         # HTTPS 내려받기, tar.gz 해제 (update 와 build-index 가 사용)
│   └── scripts/
│       ├── buildIndex.ts                   # 인덱스 구축 (npm run build-index)
│       └── templateSources.ts              # templates/ 의 소스 저장소 확보와 태그 선택
│
├── scripts/
│   ├── pack-platforms.sh                   # 플랫폼별 tgz 생성 (npm run pack:platforms)
│   └── fetch-model.mjs                     # 임베딩 모델 내려받기 (npm run fetch-model)
│
├── templates/                              # build-index 의 입력 원본
│   ├── common-components-src/              # 공통컴포넌트 소스와 SQL 스크립트 (git 서브모듈)
│   ├── common-components.json              # 공통컴포넌트 메타와 의존성
│   ├── compatibility/                      # 호환 소프트웨어 목록 (compatibility-software.json)
│   ├── developer_knowledge/                # 개발자 지식 원본 (포털 Q&A·FAQ xlsx, 적용가이드 PDF)
│   └── egovframe_guide/                    # 공식 가이드 마크다운 (git 서브모듈)
│
├── knowledge-base/                         # build-index 결과물 (git 에 포함)
│   ├── egovframe.db                        # SQLite (호환 소프트웨어, 공통컴포넌트 메타)
│   ├── egovframe_guide.lance/              # LanceDB (공식 가이드)
│   └── developer_knowledge.lance/          # LanceDB (개발자 지식)
│                                           # build-index 를 실행하면 state.json, manifest.json, snapshot.jsonl.gz 도 생성
│
├── models/                                 # 임베딩 모델 (git 미추적, npm run fetch-model 로 생성, tgz 에 동봉)
│
├── tests/                                  # Vitest 테스트
│   ├── unit/                               # 단위 테스트
│   └── integration/                        # 통합 테스트 (빌드된 서버와 CLI 를 실제로 실행)
│
├── docs/                                   # 상세 문서 (아래 "추가 문서" 참조)
├── notebooks/                              # 데이터 변환 스크립트와 탐색 노트북
├── build/                                  # tsc 결과물 (git 미추적)
├── dist/                                   # pack:platforms 결과물 tgz (git 미추적)
├── .nvmrc                                  # Node.js 22
├── package.json
├── tsconfig.json
└── vitest.config.mjs
```

## 🧪 테스트 (Testing)

자동화 테스트는 [Vitest](https://vitest.dev/) 로 작성되어 있고, 단위 테스트(`tests/unit`)와 통합 테스트(`tests/integration`)로 나뉩니다. 통합 테스트에는 빌드된 서버를 stdio 로 실행해 `egov_search_knowledge` 를 실제로 호출하는 테스트가 들어 있습니다. 임베딩 모델이나 서브모듈이 없으면 그것이 필요한 테스트는 건너뜁니다.

| 명령어                | 동작                                                |
|----------------------|----------------------------------------------------|
| `npm test`           | `npm run build` 후 `vitest run` (단위 + 통합 테스트 전체) |
| `npm run test:watch` | watch 모드 (빌드하지 않음)                           |

특정 파일만 실행:

```bash
npm run build
npx vitest run tests/integration/server.test.ts
```

### MCP Inspector (수동 디버깅)

```bash
npm run inspector
```

빌드된 `build/index.js` 를 MCP Inspector 에 연결해 `egov_search_knowledge` 를 직접 호출해 볼 수 있습니다. `npx` 가 Inspector 패키지를 내려받으므로 네트워크가 필요합니다.

자세한 내용은 [`docs/TESTING_GUIDE.md`](docs/TESTING_GUIDE.md) 에 있습니다.

## 🔒 프라이버시 (Privacy)

MCP 서버가 검색에 쓰는 데이터는 모두 **로컬**에 있습니다.

- 검색 중에 외부 API 를 호출하지 않습니다.
- 질의와 검색 결과를 외부로 보내지 않습니다.
- 임베딩도 로컬 모델(Transformers.js)로 계산합니다.
- 네트워크가 없는 폐쇄망에서 사용할 수 있습니다.

네트워크에 접속하는 것은 설치와 갱신 과정에서 자료를 내려받는 명령입니다.

- `git submodule update --init`: 공통컴포넌트와 가이드 소스 (github.com)
- `npm run fetch-model`: 임베딩 모델 (huggingface.co)
- `update` CLI 와 `npm run build-index` 의 online 모드: 가이드, 공통컴포넌트 소스, 개발자 지식 스냅샷 (github.com, api.github.com)
- `npm install`, `npm run pack:platforms`, `npm run inspector`: npm 패키지 (npm 레지스트리)

폐쇄망에서는 `update --from-file` 과 `build-index` 의 bundled 또는 local 모드를 씁니다.

## 📖 추가 문서

| 문서                                                                                        | 설명                                            |
|--------------------------------------------------------------------------------------------|-------------------------------------------------|
| [`docs/INDEX.md`](docs/INDEX.md)                                                           | 문서 안내                                        |
| [`docs/MCP_SETUP_GUIDE.md`](docs/MCP_SETUP_GUIDE.md)                                       | Cursor / Claude Desktop 설정 가이드             |
| [`docs/MCP_REFERENCE.md`](docs/MCP_REFERENCE.md)                                           | 공개 MCP API 레퍼런스                            |
| [`docs/EXPOSED_TOOLS.md`](docs/EXPOSED_TOOLS.md)                                           | 노출 도구 목록                                   |
| [`docs/EGOV_SEARCH_KNOWLEDGE_TOOL.md`](docs/EGOV_SEARCH_KNOWLEDGE_TOOL.md)                 | `egov_search_knowledge` 사용법 (scope, action, 필터, 응답 형식) |
| [`docs/HYBRID_SYSTEM_GUIDE.md`](docs/HYBRID_SYSTEM_GUIDE.md)                               | SQLite + LanceDB 하이브리드 시스템              |
| [`docs/DATABASE_SCHEMA.md`](docs/DATABASE_SCHEMA.md)                                       | DB 스키마                                       |
| [`docs/DEPLOYMENT_GUIDE.md`](docs/DEPLOYMENT_GUIDE.md)                                     | 배포 가이드                                      |
| [`docs/TESTING_GUIDE.md`](docs/TESTING_GUIDE.md)                                           | 빌드/테스트 가이드                               |
| [`docs/tests/`](docs/tests/)                                                               | 테스트 파일별 설명                               |
| [`docs/test-scenarios/`](docs/test-scenarios/)                                             | 폐쇄망 OSS LLM 테스트 시나리오                  |

## 🔗 함께 쓰는 자매 MCP

- **[egovframe-mcp-codegen](https://github.com/eGovFramework/egovframe-mcp-codegen)**: DDL 로부터 eGovFrame 프로젝트와 엔티티 코드 생성
- **[egovframe-mcp-check](https://github.com/eGovFramework/egovframe-mcp-check)**: eGovFrame 프로젝트의 레이어별 컴플라이언스 정적 분석

## 📄 라이선스

Apache-2.0 라이선스를 따릅니다. 전문은 [`LICENSE`](LICENSE) 에 있습니다.

## 🙏 Credits

- eGovFrame Framework Team
- Model Context Protocol by Anthropic
- LanceDB for vector database
- Transformers.js for local embeddings

Based on [egovframe-vscode-initializr](https://github.com/egovframework/egovframe-vscode-initializr).

---

**Made with ❤️ for eGovFrame developers**
