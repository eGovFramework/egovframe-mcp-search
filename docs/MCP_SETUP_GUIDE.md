# MCP 설정 및 사용 가이드

이 문서는 `egovframe-mcp-search` 서버를 MCP 클라이언트에 등록하고 사용하는 방법을 설명합니다. 배포 tgz 를 만드는 방법과 지식베이스 갱신은 [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)에서 다룹니다.

## 설치

Node.js 22 가 필요합니다. 서버가 쓰는 `better-sqlite3` 의 네이티브 바이너리는 Node.js 메이저 버전에 맞춰 만들어지고, 배포 tgz 에는 Node.js 22 용 바이너리가 들어 있기 때문입니다. `node -v` 의 출력이 `v22` 로 시작하는지 먼저 확인합니다.

### 배포 tgz 를 받은 경우

장비의 운영체제와 CPU 에 맞는 파일(`egovframe-mcp-search-<버전>-<타깃>.tgz`)을 설치합니다. 의존 패키지, 임베딩 모델, 지식베이스가 모두 들어 있으므로 빌드나 인덱스 구축은 필요하지 않습니다.

```bash
npm install -g --offline ./egovframe-mcp-search-<버전>-<타깃>.tgz
npm root -g
```

`--offline` 은 npm 이 레지스트리에 접근하지 않게 하는 옵션입니다. 필요한 패키지가 모두 tgz 안에 있으므로 이 옵션을 준 채로 설치가 끝납니다. `npm root -g` 가 출력한 디렉토리 아래의 `egovframe-mcp-search` 가 설치 위치이고, 클라이언트에 등록할 진입점은 `<설치 위치>/build/index.js` 입니다. 전역 위치 대신 다른 디렉토리에 설치하려면 두 명령에 `--prefix <디렉토리>` 를 함께 줍니다.

### 저장소를 클론한 경우

```bash
nvm use                                                       # nvm 을 쓰는 경우. .nvmrc 가 Node.js 22 를 가리킵니다
git submodule update --init templates/common-components-src   # 공통컴포넌트 소스
npm install                                                   # prepare 스크립트가 build/ 까지 만듭니다
npm run fetch-model                                           # 임베딩 모델을 models/ 에 내려받습니다
```

지식베이스(`knowledge-base/`)는 저장소에 들어 있으므로 `npm run build-index` 는 인덱스를 다시 만들 때만 실행합니다. 진입점은 `<저장소 경로>/build/index.js` 입니다.

## 클라이언트 등록 항목

어느 클라이언트에서나 다음 두 값을 정확히 적어야 합니다.

| 항목 | 값 |
|------|-----|
| `command` | Node.js 22 실행 파일의 절대 경로 |
| `args` | 진입점 `build/index.js` 의 절대 경로 |

`command` 에 `node` 라고만 적으면 클라이언트가 실행되는 환경의 `PATH` 에서 먼저 찾은 Node.js 가 쓰이고, 그 버전이 22 가 아닐 수 있습니다. 다른 메이저 버전으로 실행해도 서버는 시작되고 도구 목록도 보이지만, SQLite 를 읽는 조회(공통컴포넌트, 호환 소프트웨어)가 `네이티브 모듈(better-sqlite3)을 불러오지 못했습니다` 로 시작하는 오류를 돌려줍니다. 공식 가이드와 개발자 지식 검색은 SQLite 를 쓰지 않아 그대로 동작합니다. Node.js 22 실행 파일의 경로는 Node.js 22 를 쓰는 셸에서 다음 명령으로 확인합니다.

```bash
node -p process.execPath
```

서버는 지식베이스, 임베딩 모델, 공통컴포넌트 소스를 실행 디렉토리가 아니라 `build/index.js` 가 놓인 패키지 위치를 기준으로 찾습니다. 그래서 `args` 의 경로만 정확하면 클라이언트가 어느 디렉토리에서 서버를 실행하든 동작하고, `env` 는 적지 않아도 됩니다.

터미널에서 `<command 값> <args 값> --version` 을 실행했을 때 버전(예: `1.0.0`)이 출력되면 두 경로가 맞는 것입니다.

## Cursor 설정

Cursor 의 MCP 설정에 서버를 등록합니다.

```json
{
  "mcpServers": {
    "egovframe-mcp-search": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/egovframe-mcp-search/build/index.js"]
    }
  }
}
```

## Claude Desktop 설정

macOS 의 설정 파일은 `~/Library/Application Support/Claude/claude_desktop_config.json` 입니다.

```json
{
  "mcpServers": {
    "egovframe-mcp-search": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/egovframe-mcp-search/build/index.js"]
    }
  }
}
```

Windows 의 설정 파일은 `%APPDATA%\Claude\claude_desktop_config.json` 이고 구조는 같습니다. JSON 문자열 안에서는 경로의 역슬래시를 두 번씩 적습니다.

```json
{
  "mcpServers": {
    "egovframe-mcp-search": {
      "command": "C:\\absolute\\path\\to\\node.exe",
      "args": ["C:\\absolute\\path\\to\\egovframe-mcp-search\\build\\index.js"]
    }
  }
}
```

## 환경변수

서버 등록에 필요한 환경 변수는 없습니다. 코드가 읽는 변수는 아래 두 개뿐이며, 이 표에 없는 변수는 `env` 에 넣어도 효과가 없습니다.

| 환경변수 | 설명 | 기본값 |
|----------|------|--------|
| `EGOV_MCP_DATA_DIR` | `update` 명령이 갱신분을 저장하고 서버가 번들보다 먼저 읽는 사용자 데이터 디렉토리 | macOS `~/Library/Application Support/egovframe-mcp-search`, Linux `$XDG_DATA_HOME/egovframe-mcp-search`(`XDG_DATA_HOME` 이 없으면 `~/.local/share/egovframe-mcp-search`), Windows `%LOCALAPPDATA%\egovframe-mcp-search` |
| `EGOV_MCP_UPDATE_URL` | 개발자 지식 스냅샷을 내려받는 주소. `update` 명령과 `build-index` 의 온라인 모드만 읽으며 서버 동작과는 관계가 없습니다. | GitHub 저장소 `eGovFramework/egovframe-mcp-search-upload-data` 의 최신 릴리스 |

`EGOV_MCP_DATA_DIR` 를 지정해서 `update` 를 실행했다면, 서버가 그 갱신분을 읽도록 클라이언트 등록의 `env` 에도 같은 값을 넣습니다.

## 현재 제공 기능

| Tool | 설명 |
|------|------|
| `egov_search_knowledge` | 공식 가이드, 개발자 지식, 공통컴포넌트, 호환 소프트웨어의 통합 검색 (읽기 전용) |

파라미터와 응답 형태는 [MCP_REFERENCE.md](./MCP_REFERENCE.md), scope 별 사용법은 [EGOV_SEARCH_KNOWLEDGE_TOOL.md](./EGOV_SEARCH_KNOWLEDGE_TOOL.md)를 참고합니다.

## 자동 승인 권장값

`egov_search_knowledge` 는 조회만 하는 도구이고 `tools/list` 에도 `readOnlyHint: true` 로 표시되므로, 클라이언트의 자동 승인 대상으로 등록해도 됩니다. 등록 방법은 클라이언트마다 다르므로 사용하는 클라이언트의 문서를 따릅니다. 서버 항목에 `alwaysAllow` 키를 받는 클라이언트라면 다음처럼 서버 항목 안에 도구 이름을 추가합니다.

```json
{
  "mcpServers": {
    "egovframe-mcp-search": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/egovframe-mcp-search/build/index.js"],
      "alwaysAllow": ["egov_search_knowledge"]
    }
  }
}
```

## 사용 예시

자연어로 요청하면 LLM 이 `egov_search_knowledge` 호출로 옮깁니다. 아래의 JSON 은 각 요청에 해당하는 호출 인자의 예입니다.

### 지식 검색

```text
eGovFrame에서 MyBatis 설정 방법을 공식 가이드와 개발자 지식까지 함께 찾아줘.
```

`scope` 를 `all` 로 지정하거나 생략하면 네 출처를 함께 검색합니다.

```json
{ "query": "MyBatis 설정 방법", "scope": "all" }
```

### 공통컴포넌트 조회

```text
게시판 공통컴포넌트의 의존성과 MySQL DDL을 확인해줘.
```

`scope: "components"` 에 `action` 과 `filters` 를 함께 씁니다. 의존성과 DDL 은 각각 한 번씩 호출합니다.

```json
{ "scope": "components", "action": "dependencies", "filters": { "componentId": "bbs" } }
```

```json
{ "scope": "components", "action": "ddl", "filters": { "componentId": "bbs", "dbType": "mysql" } }
```

### 호환 소프트웨어 확인

```text
eGovFrame 4.3과 호환되는 WAS를 알려줘.
```

`scope: "compatibility"` 에 버전과 분류 필터를 줍니다.

```json
{ "scope": "compatibility", "filters": { "frameworkVersion": "4.3", "category": "WAS" } }
```

## 문제 해결

오류는 도구 응답의 본문으로 돌아오므로, 본문의 문구로 원인을 구분할 수 있습니다.

| 증상 | 확인할 것 |
|------|-----------|
| 클라이언트에 서버가 보이지 않거나 시작하자마자 종료됨 | `command` 와 `args` 가 절대 경로인지, `args` 의 `build/index.js` 가 실제로 있는지 확인합니다. 배포 tgz 는 장비의 운영체제와 CPU 에 맞는 타깃인지 확인합니다. 터미널에서 `<command 값> <args 값> --version` 을 실행하면 버전이 출력되어야 합니다. |
| `네이티브 모듈(better-sqlite3)을 불러오지 못했습니다. 배포 패키지는 Node.js 22 와 패키지를 만든 플랫폼에서만 동작합니다 ...` | 대개 `command` 가 Node.js 22 가 아닌 실행 파일을 가리키는 경우입니다. 문구에 적힌 현재 Node.js 버전을 확인하고 `command` 를 Node.js 22 실행 파일의 절대 경로로 바꿉니다. 같은 문구가 서버 시작 시 로그(stderr)에도 한 번 남습니다. |
| `임베딩 모델을 찾을 수 없습니다 (models/Xenova/multilingual-e5-small). ...` | 저장소 클론에서 `npm run fetch-model` 을 실행하지 않은 상태입니다. 이때 공식 가이드와 개발자 지식의 의미 검색은 실패하고, 공통컴포넌트와 호환 소프트웨어 조회는 동작합니다. |
| `공통컴포넌트 소스가 설치되어 있지 않습니다. ...` | 저장소 클론에서 서브모듈을 받지 않은 상태입니다. `git submodule update --init templates/common-components-src` 를 실행합니다. 소스 파일, DDL, DML 조회에만 영향이 있습니다. |
| `지식베이스 DB(knowledge-base/egovframe.db)를 찾을 수 없습니다. ...`, `공식 가이드 인덱스(knowledge-base/egovframe_guide.lance)를 찾을 수 없습니다. ...`, `개발자 지식 인덱스(knowledge-base/developer_knowledge.lance)를 찾을 수 없습니다. ...` | 설치 위치에 `knowledge-base/` 가 없거나 일부가 빠져 있습니다. 서버는 빠진 파일을 새로 만들지 않습니다. 배포 tgz 는 다시 설치하고, 저장소 클론은 `git restore knowledge-base` 로 되돌립니다. |
| `MCP error -32602: Tool <이름> not found` | 등록되지 않은 도구 이름을 호출했습니다. 옛 검색·조회 도구(`search_guide`, `list_common_components` 등)는 `egov_search_knowledge` 의 `scope` 와 `action` 으로 호출합니다. `egov_check_compliance` 는 `egovframe-mcp-check` 서버가, `egov_scaffold_project`, `egov_add_entity`, `egov_add_query_view` 는 `egovframe-mcp-codegen` 서버가 제공하므로 해당 서버를 따로 등록합니다. |
| `update` 로 받은 갱신분이 검색에 반영되지 않음 | 실행 중인 서버는 이미 연 인덱스를 계속 읽습니다. 클라이언트에서 서버를 다시 시작합니다. `EGOV_MCP_DATA_DIR` 를 썼다면 등록의 `env` 에 같은 값이 있는지 확인합니다. |
