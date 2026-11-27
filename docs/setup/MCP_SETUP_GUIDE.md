# 설치와 MCP 클라이언트 등록 가이드

이 문서는 `egovframe-mcp-search` 서버(지식검색 MCP)의 배포 파일을 받아 AI 클라이언트(MCP 클라이언트)에 등록하고 사용하는 방법을 설명합니다. 배포 파일을 만드는 방법은 [DEPLOYMENT_GUIDE.md](../operations/DEPLOYMENT_GUIDE.md)에서, 지식베이스를 갱신하는 방법은 [KNOWLEDGE_BASE_GUIDE.md](../operations/KNOWLEDGE_BASE_GUIDE.md)에서 다룹니다.

## 요구 사항

| 항목 | 내용 |
|------|------|
| Node.js | 22 (`>=22 <23`). `node -v` 를 실행했을 때 `v22` 로 시작하는 버전이 나와야 합니다. |
| 운영체제와 CPU | Windows x64, macOS (Apple Silicon, Intel), Linux x64 (glibc). 운영체제와 CPU 에 맞는 배포 파일을 사용합니다. |
| 디스크 | 배포 파일 하나가 약 330MB 입니다. |

Node.js 22 가 필요한 이유는 서버가 쓰는 `better-sqlite3` 의 네이티브 바이너리가 Node.js 메이저 버전에 맞춰 만들어지고, 배포 파일에는 Node.js 22 용 바이너리가 들어 있기 때문입니다.

다른 메이저 버전으로 실행해도 서버는 시작되고 도구 목록도 보이지만, SQLite 를 읽는 조회(공통컴포넌트, 호환 소프트웨어)가 `네이티브 모듈(better-sqlite3)을 불러오지 못했습니다` 로 시작하는 오류를 돌려줍니다. 공식 가이드와 개발자 지식 검색은 SQLite 를 쓰지 않아 그대로 동작합니다.

## 배포 파일 내려받기

[표준프레임워크 포털](https://www.egovframe.go.kr/home/sub.do?menuNo=114)에서 사용하는 운영체제와 CPU 에 맞는 파일을 내려받아 로컬 디스크에 둡니다. 압축은 풀지 않습니다.

| 운영체제와 CPU | 파일 |
|----------------|------|
| Windows x64 | `egovframe-mcp-search-5.1.0-win32-x64.tgz` |
| macOS (Apple Silicon) | `egovframe-mcp-search-5.1.0-darwin-arm64.tgz` |
| macOS (Intel) | `egovframe-mcp-search-5.1.0-darwin-x64.tgz` |
| Linux x64 (glibc) | `egovframe-mcp-search-5.1.0-linux-x64.tgz` |

- 배포 파일에는 서버, 의존 패키지, 임베딩 모델, 지식베이스가 모두 들어 있으므로 빌드나 인덱스 구축은 필요하지 않습니다.
- Linux 용 파일은 glibc 기반 배포판(Ubuntu, Debian, RHEL 등)용입니다.
- 내려받은 파일의 체크섬은 [릴리스 노트](../release-notes/v5.1.0-beta.md#체크섬)의 값과 견주어 확인할 수 있습니다.

## 서버 실행 명령

어느 AI 클라이언트에서나 서버를 실행하는 명령은 같습니다. 이 문서의 예시에서 `<TGZ>` 는 내려받은 tgz 파일의 절대 경로입니다.

| 운영체제 | 실행 명령 |
|----------|-----------|
| macOS, Linux | `npx -y --package=<TGZ> egovframe-mcp-search` |
| Windows | `cmd /c npx -y --package=<TGZ> egovframe-mcp-search` |

- **경로는 절대 경로로 적습니다.** AI 클라이언트가 서버를 어느 디렉토리에서 실행할지 정해져 있지 않기 때문입니다.
- **Windows 에서는 `cmd /c` 로 감쌉니다.** Windows 의 `npx` 는 실제로는 `npx.cmd` 라는 배치 파일이어서, AI 클라이언트에 따라서는 직접 실행하지 못하기 때문입니다.
- **포트를 열지 않습니다.** 이 서버는 stdio 로 통신하는 MCP 서버입니다. 포트를 열고 계속 실행되는 서비스가 아니며, AI 클라이언트가 필요할 때 프로세스를 실행합니다.
- **서버를 시작할 때마다 20초 정도 걸립니다.** 배포 파일의 용량이 커서 `npx` 가 실행을 준비하는 데 시간이 걸리기 때문입니다. AI 클라이언트의 서버 시작 대기 시간이 이보다 짧으면 연결에 실패할 수 있으므로, 대기 시간을 늘려서 사용합니다([Codex](#codex) 항목 참조).
- **`npx` 는 Node.js 22 의 것이어야 합니다.** 기본 Node.js 가 22 가 아니면 `command` 의 `npx` 를 Node.js 22 설치본에 들어 있는 `npx` 의 절대 경로로 바꿉니다.

서버는 지식베이스, 임베딩 모델, 공통컴포넌트 소스를 실행 디렉토리가 아니라 패키지 위치를 기준으로 찾으므로, 경로를 알려 주는 환경 변수는 필요하지 않습니다.

### 등록하기 전에 실행해 보기

AI 클라이언트에 등록하기 전에 터미널에서 다음 명령으로 실행 명령이 맞는지 확인할 수 있습니다. 버전(`5.1.0`)이 출력되면 Node.js 와 tgz 의 경로가 맞는 것입니다.

```bash
npx -y --package=<TGZ> egovframe-mcp-search --version
```

## 공통 JSON 형식

`mcpServers` 형식을 쓰는 AI 클라이언트의 MCP 서버 설정에 넣는 공통 형식입니다. 설정 파일에 `mcpServers` 항목이 이미 있으면 그 안에 `egovframe-mcp-search` 만 추가합니다.

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

- JSON 문자열 안에서는 Windows 경로의 역슬래시를 두 번씩 적거나(`C:\\egovframe-mcp\\...`) 슬래시(`C:/egovframe-mcp/...`)를 씁니다.
- 클라이언트가 셸의 `PATH` 를 물려받지 않아 `npx` 를 찾지 못하면 `command` 에 Node.js 22 의 `npx` 절대 경로를 적습니다. 경로는 macOS/Linux 에서는 `which npx`, Windows 에서는 `where npx` 로 확인합니다.
- tgz 를 새 버전으로 바꾸면 파일 이름이 달라지므로 등록한 경로도 함께 고칩니다.

## AI 클라이언트별 등록

| AI 클라이언트 | 등록 방법 | 유의 사항 |
|---------------|-----------|-----------|
| [Claude Code](#claude-code) | `claude mcp add` 명령 또는 `~/.claude.json` (Windows 는 `%USERPROFILE%\.claude.json`) | 공통 JSON 형식 |
| [Codex](#codex) | `codex mcp add` 명령 또는 `~/.codex/config.toml` (Windows 는 `%USERPROFILE%\.codex\config.toml`) | TOML 형식. CLI 로 등록한 뒤에도 `startup_timeout_sec` 추가 |
| [Cursor](#cursor) | `~/.cursor/mcp.json` (Windows 는 `%USERPROFILE%\.cursor\mcp.json`) | 공통 JSON 형식에 `"type": "stdio"` 추가 |
| [VS Code (GitHub Copilot)](#vs-code-github-copilot) | `~/.copilot/mcp-config.json` (Windows 는 `%USERPROFILE%\.copilot\mcp-config.json`) | 공통 JSON 형식에 `"tools": ["*"]`, `"type": "stdio"` 추가 |
| [Cline](#cline) | Cline 패널의 MCP Servers 에서 여는 `cline_mcp_settings.json` | 공통 JSON 형식 |
| [OpenCode](#opencode) | `opencode mcp add` 명령 | `--global` 옵션으로 전역 등록 |

### Claude Code

CLI 로 등록하는 방법을 권장합니다.

```bash
# macOS, Linux
claude mcp add --scope user egovframe-mcp-search -- npx -y --package=<TGZ> egovframe-mcp-search

# Windows
claude mcp add --scope user egovframe-mcp-search -- cmd /c npx -y --package=<TGZ> egovframe-mcp-search
```

`--scope user` 는 모든 프로젝트에서 이 서버를 쓰도록 등록한다는 뜻입니다. 등록 상태는 `claude mcp list` 또는 세션 안의 `/mcp` 로 확인합니다.

설정 파일로 등록하려면 `~/.claude.json`(Windows 는 `%USERPROFILE%\.claude.json`)의 최상위 `mcpServers` 에 [공통 JSON 형식](#공통-json-형식)의 `egovframe-mcp-search` 항목을 추가합니다.

### Codex

CLI 로 등록합니다.

```bash
# macOS, Linux
codex mcp add egovframe-mcp-search -- npx -y --package=<TGZ> egovframe-mcp-search

# Windows
codex mcp add egovframe-mcp-search -- cmd /c npx -y --package=<TGZ> egovframe-mcp-search
```

Codex 는 서버 시작을 기본 10초까지만 기다리므로, CLI 로 등록한 뒤에도 `config.toml` 의 서버 항목에 `startup_timeout_sec` 값을 추가해야 합니다. 설정 파일은 `~/.codex/config.toml`(Windows 는 `%USERPROFILE%\.codex\config.toml`)이고, 최상위 키는 `mcp_servers` 입니다.

**macOS, Linux**

```toml
[mcp_servers.egovframe-mcp-search]
command = "npx"
args = ["-y", "--package=<TGZ>", "egovframe-mcp-search"]
startup_timeout_sec = 120
```

**Windows**

```toml
[mcp_servers.egovframe-mcp-search]
command = "cmd"
args = ["/c", "npx", "-y", "--package=<TGZ>", "egovframe-mcp-search"]
startup_timeout_sec = 120
```

### Cursor

설정 파일 `~/.cursor/mcp.json`(Windows 는 `%USERPROFILE%\.cursor\mcp.json`)에 다음 형식으로 추가합니다.

**macOS, Linux**

```json
{
  "mcpServers": {
    "egovframe-mcp-search": {
      "type": "stdio",
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
      "type": "stdio",
      "command": "cmd",
      "args": ["/c", "npx", "-y", "--package=<TGZ>", "egovframe-mcp-search"]
    }
  }
}
```

### VS Code (GitHub Copilot)

설정 파일 `~/.copilot/mcp-config.json`(Windows 는 `%USERPROFILE%\.copilot\mcp-config.json`)에 다음 형식으로 추가합니다.

**macOS, Linux**

```json
{
  "mcpServers": {
    "egovframe-mcp-search": {
      "tools": ["*"],
      "type": "stdio",
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
      "tools": ["*"],
      "type": "stdio",
      "command": "cmd",
      "args": ["/c", "npx", "-y", "--package=<TGZ>", "egovframe-mcp-search"]
    }
  }
}
```

VS Code 의 워크스페이스 설정 파일(`<프로젝트 루트>/.vscode/mcp.json`)에 등록할 때에는 최상위 키가 `mcpServers` 가 아니라 `servers` 입니다. Windows 에서는 `command` 와 `args` 를 위의 Windows 예시와 같게 적습니다.

```json
{
  "servers": {
    "egovframe-mcp-search": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "--package=<TGZ>", "egovframe-mcp-search"]
    }
  }
}
```

등록한 뒤에 Copilot Chat 을 에이전트 모드로 전환하면 도구가 보입니다.

### Cline

VS Code 의 Cline 패널에서 MCP Servers 아이콘, Configure 탭, Configure MCP Servers 를 차례로 누르면 `cline_mcp_settings.json` 파일이 열립니다. 이 파일에 [공통 JSON 형식](#공통-json-형식)의 `egovframe-mcp-search` 항목을 추가합니다. 파일을 저장하면 Cline 이 서버에 다시 연결합니다.

### OpenCode

CLI 로 등록하는 방법을 권장합니다.

```bash
# macOS, Linux
opencode mcp add egovframe-mcp-search --global -- npx -y --package=<TGZ> egovframe-mcp-search

# Windows
opencode mcp add egovframe-mcp-search --global -- cmd /c npx -y --package=<TGZ> egovframe-mcp-search
```

설정 파일(`~/.config/opencode/opencode.json`)에 직접 적을 때에는 형식이 다른 클라이언트와 다릅니다. 최상위 키는 `mcp` 이고, `command` 하나에 명령과 인자를 모두 배열로 적습니다.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "egovframe-mcp-search": {
      "type": "local",
      "command": ["npx", "-y", "--package=<TGZ>", "egovframe-mcp-search"],
      "enabled": true
    }
  }
}
```

## 등록 확인

등록이 끝나면 클라이언트의 도구 목록에 다음 도구 하나가 보입니다.

| 도구 | 설명 |
|------|------|
| `egov_search_knowledge` | 공식 가이드, 개발자 지식, 공통컴포넌트, 호환 소프트웨어의 통합 검색 (읽기 전용) |

파라미터와 응답 형태는 [MCP_REFERENCE.md](../reference/MCP_REFERENCE.md)에, scope 별 사용법은 [EGOV_SEARCH_KNOWLEDGE_TOOL.md](../reference/EGOV_SEARCH_KNOWLEDGE_TOOL.md)에 있습니다.

## 다른 실행 형태

`npx` 를 거치지 않고 Node.js 로 진입점(`build/index.js`)을 직접 실행하도록 등록할 수도 있습니다. 이 형태에서는 `npx` 가 실행을 준비하는 시간이 들지 않으므로, 서버 시작 대기 시간을 늘릴 수 없는 AI 클라이언트에서 쓰기에 알맞습니다. 등록하는 값은 다음 두 가지입니다.

| 항목 | 값 |
|------|-----|
| `command` | Node.js 22 실행 파일의 절대 경로 |
| `args` | 진입점 `build/index.js` 의 절대 경로 |

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

`command` 에 `node` 라고만 적으면 AI 클라이언트가 실행되는 환경의 `PATH` 에서 먼저 찾은 Node.js 가 쓰이고, 그 버전이 22 가 아닐 수 있습니다. Node.js 22 실행 파일의 경로는 Node.js 22 를 쓰는 셸에서 다음 명령으로 확인합니다.

```bash
node -p process.execPath
```

터미널에서 `<command 값> <args 값> --version` 을 실행했을 때 버전(`5.1.0`)이 출력되면 두 경로가 맞는 것입니다.

### 전역 설치해서 실행

배포 파일을 npm 으로 전역 설치합니다.

```bash
npm install -g --offline ./egovframe-mcp-search-<버전>-<타깃>.tgz
npm root -g
```

`--offline` 은 npm 이 레지스트리에 접근하지 않게 하는 옵션입니다. 필요한 패키지가 모두 tgz 안에 있으므로 이 옵션을 준 채로 설치가 끝납니다. `npm root -g` 가 출력한 디렉토리 아래의 `egovframe-mcp-search` 가 설치 위치이고, 등록할 진입점은 `<설치 위치>/build/index.js` 입니다. 설치하면 `egovframe-mcp-search` 명령도 함께 등록되므로, `egovframe-mcp-search --version` 으로 설치를 확인할 수 있습니다. 전역 위치 대신 다른 디렉토리에 설치하려면 두 명령에 `--prefix <디렉토리>` 를 함께 줍니다.

### 저장소를 클론해서 실행

```bash
git clone https://github.com/eGovFramework/egovframe-mcp-search.git
cd egovframe-mcp-search
nvm use                                                       # nvm 을 쓰는 경우. .nvmrc 가 Node.js 22 를 가리킵니다
git submodule update --init templates/common-components-src   # 공통컴포넌트 소스
npm install                                                   # prepare 스크립트가 build/ 까지 만듭니다
npm run fetch-model                                           # 임베딩 모델을 models/ 에 내려받습니다
```

지식베이스(`knowledge-base/`)는 저장소에 들어 있으므로 `npm run build-index` 는 인덱스를 다시 만들 때만 실행합니다. 등록할 진입점은 `<저장소 경로>/build/index.js` 입니다.

## 환경 변수

서버 등록에 필요한 환경 변수는 없습니다. 이 프로젝트가 정의한 환경 변수는 아래 두 개뿐이고, 코드는 이 밖의 전용 변수를 읽지 않습니다. 사용자 데이터 디렉토리의 기본 위치를 정할 때에는 운영체제의 홈 디렉토리와 `XDG_DATA_HOME`(Linux), `LOCALAPPDATA`(Windows)를 참고합니다.

| 환경 변수 | 설명 | 기본값 |
|-----------|------|--------|
| `EGOV_MCP_DATA_DIR` | `update` 명령이 갱신분을 저장하고 서버가 번들보다 먼저 읽는 사용자 데이터 디렉토리 | macOS `~/Library/Application Support/egovframe-mcp-search`, Linux `$XDG_DATA_HOME/egovframe-mcp-search`(`XDG_DATA_HOME` 이 없으면 `~/.local/share/egovframe-mcp-search`), Windows `%LOCALAPPDATA%\egovframe-mcp-search` |
| `EGOV_MCP_UPDATE_URL` | 개발자 지식 스냅샷을 내려받는 주소. `update` 명령과 `build-index` 의 온라인 모드만 읽으며 서버 동작과는 관계가 없습니다. | GitHub 저장소 `eGovFramework/egovframe-mcp-search-upload-data` 의 최신 릴리스 |

`EGOV_MCP_DATA_DIR` 를 지정해서 `update` 를 실행했다면, 서버가 그 갱신분을 읽도록 클라이언트 등록의 `env` 에도 같은 값을 넣습니다.

## 도구 승인

`egov_search_knowledge` 는 조회만 하는 도구이고 `tools/list` 에도 `readOnlyHint: true` 로 표시되므로, 클라이언트의 자동 승인 대상으로 등록해도 됩니다. 등록 방법은 클라이언트마다 다르므로 사용하는 클라이언트의 문서를 따릅니다. 서버 항목에 `alwaysAllow` 키를 받는 클라이언트라면 다음처럼 서버 항목 안에 도구 이름을 추가합니다.

```json
{
  "mcpServers": {
    "egovframe-mcp-search": {
      "command": "npx",
      "args": ["-y", "--package=<TGZ>", "egovframe-mcp-search"],
      "alwaysAllow": ["egov_search_knowledge"]
    }
  }
}
```

## 사용 예시

자연어로 요청하면 AI 가 `egov_search_knowledge` 호출로 옮깁니다. 아래의 JSON 은 각 요청에 해당하는 호출 인자의 예입니다.

### 지식 검색

```text
eGovFrame에서 MyBatis 설정 방법을 공식 가이드와 개발자 지식까지 함께 찾아줘.
```

`scope` 를 `all` 로 지정하면 네 출처를 함께 검색합니다. `query` 만 주고 `scope` 를 생략해도 같습니다.

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

서버가 시작된 뒤의 오류는 도구 응답의 본문으로 돌아오므로, 본문의 문구로 원인을 구분할 수 있습니다.

| 증상 | 확인할 것 |
|------|-----------|
| 클라이언트에 서버가 보이지 않거나 연결이 시간 초과로 실패함 | `npx` 로 실행하면 서버를 시작할 때마다 20초 정도 걸립니다. 서버 시작 대기 시간을 설정할 수 있는 클라이언트에서는 대기 시간을 늘립니다(Codex 는 `startup_timeout_sec`). 늘릴 수 없는 클라이언트에서는 [다른 실행 형태](#다른-실행-형태)로 등록합니다. |
| 서버가 시작하자마자 종료됨 | `<TGZ>` 가 절대 경로인지, 그 파일이 실제로 있는지, 장비의 운영체제와 CPU 에 맞는 파일인지 확인합니다. 터미널에서 `npx -y --package=<TGZ> egovframe-mcp-search --version` 을 실행하면 버전이 출력되어야 합니다. |
| Windows 에서 `spawn npx ENOENT` 같은 오류로 서버가 시작되지 않음 | AI 클라이언트가 배치 파일인 `npx.cmd` 를 직접 실행하지 못한 경우입니다. `command` 를 `cmd` 로 하고 `args` 의 앞에 `/c`, `npx` 를 두는 형태로 등록합니다. |
| macOS, Linux 의 GUI 클라이언트에서 `npx` 를 찾지 못함 | GUI 앱은 셸의 `PATH` 를 물려받지 않을 수 있습니다. nvm 등으로 Node.js 를 설치했다면 `which npx` 로 확인한 절대 경로를 `command` 에 적습니다. |
| `ERR_MODULE_NOT_FOUND: Cannot find package '...'` 로 서버가 종료됨 | `npx` 캐시에 불완전한 설치가 남은 경우입니다. 처음 실행하는 도중에 클라이언트가 대기 시간 초과로 서버를 종료하면 이런 캐시가 남을 수 있습니다. 캐시 디렉토리(macOS, Linux 는 `~/.npm/_npx`, Windows 는 `%LOCALAPPDATA%\npm-cache\_npx`)를 지운 뒤, 클라이언트를 켜기 전에 터미널에서 [등록하기 전에 실행해 보기](#등록하기-전에-실행해-보기)의 명령을 한 번 실행합니다. |
| `네이티브 모듈(better-sqlite3)을 불러오지 못했습니다. 배포 패키지는 Node.js 22 와 패키지를 만든 플랫폼에서만 동작합니다 ...` | 대개 서버가 Node.js 22 가 아닌 버전으로 실행된 경우입니다. 문구에 적힌 현재 Node.js 버전을 확인하고, `command` 의 `npx`(직접 실행하는 형태라면 `node`)를 Node.js 22 의 절대 경로로 바꿉니다. 같은 문구가 서버 시작 시 로그(stderr)에도 한 번 남습니다. |
| `임베딩 모델을 찾을 수 없습니다 (models/Xenova/multilingual-e5-small). ...` | 저장소 클론에서 `npm run fetch-model` 을 실행하지 않은 상태입니다. 이때 공식 가이드와 개발자 지식의 의미 검색은 실패하고, 공통컴포넌트와 호환 소프트웨어 조회는 동작합니다. |
| `임베딩 모델 파일을 읽지 못했습니다 (models/Xenova/multilingual-e5-small). ...` | 모델 파일이 손상되었거나 읽을 권한이 없습니다. 저장소 클론은 `models` 디렉토리를 지우고 `npm run fetch-model` 을 다시 실행하고, 배포 파일은 다시 내려받습니다. 그 뒤에 서버를 다시 시작합니다. 영향을 받는 조회는 모델이 없을 때와 같습니다. |
| `공통컴포넌트 소스가 설치되어 있지 않습니다. ...` | 저장소 클론에서 서브모듈을 받지 않은 상태입니다. `git submodule update --init templates/common-components-src` 를 실행합니다. 소스 파일, DDL, DML 조회에만 영향이 있습니다. |
| `지식베이스 DB(knowledge-base/egovframe.db)를 찾을 수 없습니다. ...`, `공식 가이드 인덱스(knowledge-base/egovframe_guide.lance)를 찾을 수 없습니다. ...`, `개발자 지식 인덱스(knowledge-base/developer_knowledge.lance)를 찾을 수 없습니다. ...` | 패키지 위치에 `knowledge-base/` 가 없거나 일부가 빠져 있습니다. 서버는 빠진 파일을 새로 만들지 않습니다. 배포 파일은 다시 내려받고, 저장소 클론은 `git restore knowledge-base` 로 되돌립니다. 빠진 부분을 쓰지 않는 조회는 그대로 동작합니다. |
| `공식 가이드 인덱스를 읽지 못했습니다. ...`, `개발자 지식 인덱스를 읽지 못했습니다. ...` | 서버가 실행되는 동안 인덱스 파일이 바뀌었거나 일부가 없어진 경우입니다. 서버는 인덱스를 다시 열어 한 번 더 시도한 뒤에 이 문구를 돌려줍니다. 지식베이스를 갱신하거나 다시 구축한 직후라면 서버를 다시 시작하고, 계속되면 배포 파일을 다시 내려받거나 저장소 클론에서 `npm run build-index` 로 인덱스를 다시 구축합니다. |
| `MCP error -32602: Tool <이름> not found` | 등록되지 않은 도구 이름을 호출했습니다. 옛 검색·조회 도구(`search_guide`, `list_common_components` 등)는 `egov_search_knowledge` 의 `scope` 와 `action` 으로 호출합니다. `egov_check_compliance` 는 `egovframe-mcp-check` 서버가, `egov_scaffold_project`, `egov_add_entity`, `egov_add_query_view` 는 `egovframe-mcp-codegen` 서버가 제공하므로 해당 서버를 따로 등록합니다. |
| `update` 로 받은 갱신분이 검색에 반영되지 않음 | 실행 중인 서버는 이미 연 인덱스를 계속 읽습니다. 클라이언트에서 서버를 다시 시작합니다. `EGOV_MCP_DATA_DIR` 를 썼다면 등록의 `env` 에 같은 값이 있는지 확인합니다. 서버 로그(stderr)에 `갱신분을 읽지 못해 동봉 인덱스를 사용합니다` 가 남아 있으면 갱신분을 읽을 수 없는 상태이므로, `update --rollback` 으로 직전 상태로 되돌린 뒤 다시 갱신합니다. |
