# eGovFrame MCP Search

> **eGovFrame 가이드 · 공통컴포넌트 · 호환성 정보를 하나의 MCP 도구로 통합 검색**

[![eGovFrame](https://img.shields.io/badge/eGovFrame-5.1.0-134F8C?labelColor=white&logo=data:image/svg%2Bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNzMuMjgyIDE3My4yODIiPjxwYXRoIGZpbGw9IiNmZmYiIGQ9Ik0xNzMuMjgyIDg2LjY1YzAgNDcuODQ0LTM4Ljc5NCA4Ni42MzItODYuNjQ2IDg2LjYzMkMzOC43OTkgMTczLjI4MiAwIDEzNC40OTQgMCA4Ni42NSAwIDM4Ljc4OCAzOC43OTkgMCA4Ni42MzYgMGM0Ny44NTIgMCA4Ni42NDYgMzguNzg4IDg2LjY0NiA4Ni42NSIvPjxwYXRoIGZpbGw9IiMwMDM3NjQiIGQ9Ik0xMjcuMzg5IDgwLjU5OGMtMTMuNzkxLTkuMzY1LTMxLjQzOS01LjU0Mi00MC43MTcgOC41MzMtNy43MiAxMS43NjctMTkuNDA1IDEzLjIzNS0yMy45MDYgMTMuMjM1LTE0Ljc1MSAwLTI0LjgyNC0xMC4zNjctMjcuODE4LTIxLjA5NWgtLjAxYy0uMDM5LS4xMDgtLjA1OS0uMi0uMDktLjMwNy0uMDI1LS4xMi0uMDU2LS4yMzMtLjA4OS0uMzY2LTEuMTc3LTQuNDY3LTEuNDY3LTYuNjA5LTEuNDY3LTExLjM2OCAwLTI1LjY1IDI2LjMyMS01NC4yMTMgNjQuMjE1LTU0LjIxMyAzOC44MjkgMCA2MS4wNSAyOS41NDUgNjYuNzggNDUuOTc5LS4xMDctLjI5NS0uMjA5LS41ODEtLjI5MS0uODc3LTExLjAxNS0zMi4xMjUtNDEuNDc0LTU1LjIxNi03Ny4zNTctNTUuMjE2LTQ1LjEzIDAtODEuNzI5IDM2LjU5LTgxLjcyOSA4MS43MzkgMCA0MC4zNTEgMjkuMTA4IDc0Ljg5MSA2OS40NzkgNzQuODkxIDMyLjE5NyAwIDUzLjg0Mi0xOC4wNTIgNjMuNzU3LTQyLjkzIDUuNDUtMTMuNjE0IDEuNTk1LTI5LjYwNS0xMC43NTctMzguMDA1Ii8%2BPHBhdGggZmlsbD0iI2U0MDMyZSIgZD0iTTE2NC43ODggNjIuNTg5Yy00Ljc3Ny0xNi4wMjYtMjcuMTUzLTQ3LjU3MS02Ny4yODItNDcuNTcxLTM3Ljg5NCAwLTY0LjIxNCAyOC41NjMtNjQuMjE0IDU0LjIxMiAwIDQuNzU5LjI5IDYuOTAxIDEuNDY2IDExLjM2OC0uNDg5LTEuOTUxLS43NC0zLjkwOC0uNzQtNS44MjMgMC0yNi43MjEgMjYuNzQxLTQ1LjIyNyA1NC4yNDgtNDUuMjI3IDM3LjIxOCAwIDY3LjM4OCAzMC4xNzQgNjcuMzg4IDY3LjM5IDAgMjkuMTczLTE2Ljc4NSA1NC40MzctNDEuMTc5IDY2LjU2NXYuMDIzYzMxLjQ1NS0xMS4zOTEgNTMuOTA4LTQxLjUxMiA1My45MDgtNzYuODg0IDAtOC4zNzgtMS4xMjctMTUuNzU5LTMuNTk1LTI0LjA1MyIvPjwvc3ZnPg%3D%3D)](https://www.egovframe.go.kr)
[![Node](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

## 📖 MCP 개요

**MCP (Model Context Protocol)** 는 Anthropic 이 공개한 개방형 표준으로, LLM 클라이언트(Claude Desktop, Cursor, Claude Code 등) 와 외부 도구/데이터 소스를 안전하고 일관된 방식으로 연결합니다. MCP 서버는 stdio 또는 HTTP 위에 JSON-RPC 로 동작하며, LLM 에게 호출 가능한 **Tool** 목록과 각 Tool 의 입력 스키마를 노출합니다.

**eGovFrame MCP Search** 는 전자정부 표준프레임워크 개발에 필요한 **네 종류의 지식 소스**를 `egov_search_knowledge` 도구 하나로 통합 노출합니다. 통합 검색하는 네 소스는 다음과 같습니다:

1. **공식 개발자 가이드** — eGovFrame 공식 위키 콘텐츠 (의미 기반 검색)
2. **개발자 개인 지식** — 팀이 축적한 노하우/스니펫 (의미 기반 검색)
3. **공통컴포넌트** — 메타/의존성/소스파일/DDL/DML 일체 (정형 + 파일시스템)
4. **호환 SW 목록** — 프레임워크 버전별 검증 호환성 (정형 검색)

내부적으로는 **SQLite (정형) + LanceDB (벡터/의미 기반) 하이브리드 스토리지**를 사용하며, 모든 데이터는 로컬에 저장되어 **완전 오프라인** 으로 동작합니다. 임베딩은 `@xenova/transformers` 의 `multilingual-e5-small` (384차원) 모델을 로컬에서 실행합니다.

LLM 은 사용자 질의로부터 `scope` (검색 영역) 와 `action` (하위 동작) 만 결정하면 되고, 실제 라우팅/조회/포맷팅은 모두 서버가 수행합니다.

## 🛠️ 제공 도구 (Tools)

이 MCP 서버는 **한 개의 도구**를 외부에 노출합니다.

| Tool | 분류 | 핵심 용도 |
|------|------|-----------|
| [`egov_search_knowledge`](#egov_search_knowledge) | 통합 지식/레퍼런스 검색 (읽기 전용) | 가이드·개인 지식·공통컴포넌트(미리 정의된 CREATE TABLE 포함)·호환성 SW 를 하나의 관문으로 조회 |

이 도구는 이미 존재하는 자료만 조회하며, 새 스키마를 설계하지는 않습니다. 옛 이름의 분리 도구(`search_guide`, `list_common_components` 등)는 모두 `egov_search_knowledge` 의 `scope`/`action` 파라미터로 통합되었습니다. 이 이름들은 더 이상 등록되지 않으므로, 옛 이름으로 호출하면 SDK 가 표준 JSON-RPC `Method not found` 에러를 반환합니다.

### `egov_search_knowledge`

| 파라미터        | 타입    | 필수 | 설명                                                                            |
|---------------|--------|------|---------------------------------------------------------------------------------|
| query         | string |      | 검색 질의/키워드. `guide`/`knowledge`/`compatibility` 키워드 검색 / `all` 에 필수 |
| scope         | enum   |      | 검색 영역 — `auto` (기본) / `guide` / `knowledge` / `components` / `compatibility` / `all` |
| action        | string |      | 하위 동작. components: `get`/`info`/`dependencies`/`sourceFiles`/`readSource`/`ddl`/`dml` |
| filters       | object |      | scope 별 필터 (아래 표 참조)                                                    |
| limit         | number |      | 검색 결과 최대 개수                                                              |
| strictScope   | bool   |      | true 면 추론/지정 scope 내에서만 검색. `auto` 의 광역 키워드 확장을 막을 때 사용  |

### scope 매트릭스

| scope          | 데이터 출처            | 주요 filter                                    | 대표 use case                            |
|---------------|-----------------------|----------------------------------------------|------------------------------------------|
| `guide`       | LanceDB (가이드)      | `layer`, `category`, `limit`                  | "트랜잭션 설정 방법?"                    |
| `knowledge`   | LanceDB (개인 지식)   | `limit`                                       | "지난번 김대리가 정리한 페이징 트러블슈팅" |
| `components`  | SQLite + 파일시스템    | `componentId`, `componentIds`, `dbType`, `filePath` | "bbs 공통컴포넌트 의존성/DDL/소스파일"    |
| `compatibility` | SQLite              | `frameworkVersion`, `vendor`, `productName`, `includeKnowledge` | "eGovFrame 4.3 호환 CMS"     |
| `auto`        | (입력으로부터 추론)    | -                                             | 사용자가 scope 를 의식하지 않게           |
| `all`         | 가이드 + 지식 + 컴포넌트 + 호환성 | -                                 | 광역 키워드 검색                          |

### components 의 action 별 동작

| action          | 동작                                                                        |
|----------------|-----------------------------------------------------------------------------|
| `get` / `info` | 단일 컴포넌트 메타 (요약 / 카테고리 / 설명)                                   |
| `dependencies` | 의존 공통컴포넌트 트리 (transitive 포함)                                      |
| `sourceFiles`  | 컴포넌트의 모든 소스 파일 목록 (경로/타입)                                     |
| `readSource`   | 특정 `filePath` 의 원본 소스 코드                                              |
| `ddl`          | `dbType` (mysql/oracle/h2) 별 CREATE TABLE 문                                |
| `dml`          | 초기 데이터 INSERT 문                                                         |

## 🚀 설치 (Installation)

### Prerequisites

- **Node.js**: v20.0.0 이상 (v22.x 권장) — better-sqlite3 v12 가 Node 20/22/23/24 만 지원
- **npm**: v8.0.0 이상

### Install & Build

```bash
npm install
npm run build
```

### Knowledge Base 구축

공통컴포넌트 / 호환성 데이터 / 개발자 지식 / eGovFrame 가이드를 로컬 SQLite + LanceDB 에 인덱싱합니다:

```bash
npm run build-index
```

처음 한 번만 수행하면 됩니다. 결과는 `knowledge-base/` 폴더 아래에 생성됩니다 (`egovframe.db`, `egovframe_guide.lance/`, `developer_knowledge.lance/`, `state.json`, 스냅샷 동봉 파일). 

모든 대화형 질문(소스 모드·버전 태그 선택)은 **프리플라이트**에서 끝나고, 이후 빌드는 무인으로 완주합니다. 빌드는 `knowledge-base.staging/` 에 재구축한 뒤 검증을 거쳐 **원자 교체**되므로, 도중에 실패해도 기존 인덱스는 손상되지 않습니다 (직전본은 `knowledge-base.prev/` 에 1개 보존).

```bash
npm run build-index                                    # 대화형 — 소스 모드 선택 (online/local/bundled)
npm run build-index -- --yes                           # 비대화형 = bundled (네트워크 접근 0)
npm run build-index -- --source=online --yes           # 비대화형 온라인 (버전 태그는 현재 유지)
npm run build-index -- --source=online \
  --guide-tag=v5.0.0 --components-tag=v5.0.1 --yes     # 버전 고정 (재현 빌드)
npm run build-index -- --source=local \
  --template-dir=/media/usb/kb --yes                   # 폐쇄망 반입 경로 사용
```

| 소스 모드 | 동작 |
|-----------|------|
| `online`  | GitHub 에서 최신 소스·스냅샷 확보 (도달성 프로브 실패 시 프리플라이트에서 재질의) |
| `local`   | `--template-dir` 하위의 반입 소스 사용 (폐쇄망) |
| `bundled` | 레포 현재 체크아웃만 사용 — **네트워크 접근 0** (`--yes` 의 기본값) |

## 🔄 지식베이스 갱신 (update CLI)

설치·패키징된 MCP 에서도 지식베이스를 최신으로 갱신할 수 있습니다. 갱신분은 패키지 디렉토리가 아니라 **사용자 데이터 디렉토리(오버레이)** 에 저장되므로 npm 재설치/업그레이드/npx 캐시 정리에 소실되지 않습니다.

```bash
npx egovframe-mcp-search update                # 전체 리소스 갱신 (TTY 면 확인 1회)
npx egovframe-mcp-search update --check        # 현재/최신 버전 조회만
npx egovframe-mcp-search update --resource=guide
npx egovframe-mcp-search update --from-file /media/usb/kb   # 폐쇄망 반입 (동일 코드 경로)
npx egovframe-mcp-search update --rollback     # 직전 버전 복귀
```

| 리소스 | 갱신 단위 | 소스 | 클라이언트 비용 |
|--------|-----------|------|----------------|
| `developer_knowledge` (Q&A/FAQ) | **행 증분** — 직전 적용 스냅샷과 id 대조 | 릴리스 스냅샷 (`manifest.json` + `snapshot.jsonl.gz`) | 변경분만 로컬 임베딩 (수십 건 ≈ 수십 초) |
| `guide` | **전량 재인덱싱** | GitHub 태그 (sparse checkout, 이미지 제외) | md 전체 재임베딩 (수 분) |
| `components` | **트리 교체** | GitHub 태그 소스 tarball (~37MB) | 임베딩 0 — 압축 해제만. SQLite 메타(목록·설명·FTS)는 동봉본 유지 |
| `compatibility` (호환성 SW) | **비활성화** (2026-11) — "건너뜀" 안내만 출력 | — | 호환성 SW 목록은 MCP 패키지(tgz) 업그레이드로 반영 |

- 오버레이 위치: macOS `~/Library/Application Support/egovframe-mcp-search`, Linux `~/.local/share/egovframe-mcp-search`, Windows `%LOCALAPPDATA%\egovframe-mcp-search` (`EGOV_MCP_DATA_DIR` 로 override)
- 리소스별 **독립 갱신** — 하나가 실패해도 나머지는 적용되고, 실패한 리소스는 이전 상태를 유지합니다
- 임베딩 모델이 패키지에 동봉되어 갱신의 임베딩도 **완전 오프라인**으로 동작합니다
- 폐쇄망: 반입 담당자가 준비한 디렉토리(`manifest.json`/`snapshot.jsonl.gz`, `guide-md.tar.gz`, `components-src.tar.gz`)를 `--from-file` 로 지정 — 온라인 경로와 100% 동일한 코드로 검증·적용됩니다

**호환성 SW(SQLite) 갱신은 현재 비활성화**: 표준·Custom 용어사전 제거 후 SQLite 로 갱신되는 리소스가 호환성 SW 하나만 남아, 오버레이 SQLite 사본을 유지할 실익이 적다고 판단해 update 경로를 막았습니다. `--resource=compatibility` 와 `--rollback=compatibility` 는 "비활성화 — 건너뜀" 안내만 출력하며, 호환성 SW 목록은 MCP 패키지(tgz) 업그레이드로 반영됩니다. (구현은 `src/cli/sqlite/` 에 남아 있어 되살릴 수 있습니다.)

## 🔧 MCP 클라이언트 설정 (Configuration)

### Claude Desktop

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "egovframe-mcp-search": {
      "command": "/path/to/node",
      "args": ["/path/to/egovframe-mcp-search/build/index.js"],
      "env": {
        "EGOVFRAME_TEMPLATE_PATH": "/path/to/egovframe-mcp-search/templates",
        "EGOVFRAME_KNOWLEDGE_DB": "/path/to/egovframe-mcp-search/knowledge-base"
      }
    }
  }
}
```

**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "egovframe-mcp-search": {
      "command": "node",
      "args": ["C:\\path\\to\\egovframe-mcp-search\\build\\index.js"],
      "env": {
        "EGOVFRAME_TEMPLATE_PATH": "C:\\path\\to\\egovframe-mcp-search\\templates",
        "EGOVFRAME_KNOWLEDGE_DB": "C:\\path\\to\\egovframe-mcp-search\\knowledge-base"
      }
    }
  }
}
```

> Node.js 경로는 macOS/Linux 의 경우 `which node`, Windows 는 `where node` 로 확인하세요.

### Cursor

`.cursor/mcp.json` 또는 settings 에서 동일 형식으로 등록.

## 💡 사용 예시 (Usage Examples)

### 예시 1. 공식 가이드 검색 (의미 기반)

```
User: "eGovFrame Spring Boot 환경에서 트랜잭션 어떻게 설정해?"

Claude: (egov_search_knowledge 호출, scope: "guide")
```

호출되는 입력 예:
```json
{
  "query": "Spring Boot 트랜잭션 설정",
  "scope": "guide",
  "limit": 5
}
```

### 예시 2. 광역 키워드 검색 (auto)

```
User: "페이징 처리 관련 자료 다 보여줘"

Claude: (scope: "auto" → 가이드 + 개인지식 + 공통컴포넌트 + 호환성을 동시에 조회)
```

### 예시 3. 호환 SW 검색

```
User: "eGovFrame 4.3 에서 검증된 CMS 솔루션이 뭐가 있어?"

Claude: (scope: "compatibility", filters: { frameworkVersion: "4.3" })
```

### 예시 4. 공통컴포넌트 의존성 확인

```
User: "bbs (게시판) 공통컴포넌트가 어떤 다른 컴포넌트에 의존하지?"

Claude: (scope: "components", action: "dependencies",
         filters: { componentId: "bbs" })
```

### 예시 5. 공통컴포넌트 DDL 조회

```
User: "bbs 공통컴포넌트의 MySQL용 DDL 좀 보여줘"

Claude: (scope: "components", action: "ddl",
         filters: { componentId: "bbs", dbType: "mysql" })
```

### 예시 6. 공통컴포넌트 소스 코드 직접 읽기

```
User: "FileMngService 의 실제 구현 좀 열어봐"

Claude:
  1) (scope: "components", action: "sourceFiles", filters: { componentId: "fileMng" })
  2) (scope: "components", action: "readSource",
      filters: { componentId: "fileMng", filePath: "src/.../EgovFileMngServiceImpl.java" })
```

## 🏗️ 아키텍처 (Architecture)

### 하이브리드 스토리지

```
┌────────────────────────────────────────────────┐
│         eGovFrame MCP Search Server            │
├────────────────────────────────────────────────┤
│             egov_search_knowledge               │
│                  │                              │
│        ┌─────────┴──────────┐                  │
│        ▼                    ▼                  │
│  ┌──────────────┐    ┌─────────────────┐      │
│  │   SQLite     │    │   LanceDB       │      │
│  │   (정형)      │    │   (의미/벡터)    │      │
│  └──────────────┘    └─────────────────┘      │
│    • 호환성 목록           • 공식 가이드        │
│    • 공통컴포넌트 메타     • 개인 지식           │
└────────────────────────────────────────────────┘

  임베딩: @xenova/transformers (multilingual-e5-small, 384-dim, 로컬 실행)
```

### 핵심 모듈

| 모듈                            | 역할                                                            |
|--------------------------------|----------------------------------------------------------------|
| `database/sqliteManager.ts`    | SQLite 접근 — 호환성/컴포넌트 메타                               |
| `database/hybridManager.ts`    | SQLite + LanceDB 통합 진입점                                    |
| `rag/embedder.ts`              | 로컬 임베딩 (Transformers.js)                                   |
| `rag/guideManager.ts`          | LanceDB 기반 공식 가이드 검색                                    |
| `rag/knowledgeManager.ts`      | LanceDB 기반 개인 지식 검색                                      |
| `tools/egovSearchKnowledge.ts` | 외부 도구 — 통합 검색 scope/action 라우터                          |
| `tools/commonComponents.ts`    | 공통컴포넌트 메타/의존성/DDL/DML/소스 조회                        |
| `tools/compatibility.ts`       | 호환 SW 검색                                                   |
| `tools/knowledge.ts`           | 개인 지식 검색 (의미 기반)                                       |
| `scripts/buildIndex.ts`        | `templates/` → `knowledge-base/` 인덱스 구축                    |

## 🗂️ 폴더 구조 (Project Structure)

```
egovframe-mcp-search/
├── src/
│   ├── index.ts                            # 진입점 디스패처 (인자 없음 → 서버 / update → CLI)
│   ├── server.ts                           # MCP 서버 (egov_search_knowledge 노출)
│   ├── cli/
│   │   ├── update.ts                       # 지식베이스 갱신 CLI 뼈대 (옵션·잠금·상태·롤백·디스패치)
│   │   ├── shared.ts                       # CLI 공통 기반 (옵션 타입·라벨·오버레이 버전 디렉토리 헬퍼)
│   │   ├── lancedb/                        # LanceDB 리소스 갱신 — developerKnowledge.ts, guide.ts
│   │   ├── sqlite/                         # SQLite 리소스 갱신 — overlay.ts, compatibility.ts (현재 비활성화)
│   │   └── common-components/              # 공통컴포넌트 소스 트리 갱신 — commonComponents.ts
│   ├── kb/
│   │   ├── snapshot.ts                     # 개발자 지식 스냅샷 형식 (manifest/jsonl.gz, diff)
│   │   ├── sources.ts                      # 원격 소스 채널 정의 (URL 상수·태그 조회)
│   │   ├── guideIndexer.ts                 # 가이드 md 인덱싱 공용 로직 (build-index/update 공유)
│   │   └── sqliteLoaders.ts                # SQLite 적재 공용 로직 — 호환성 SW (build-index; update 경로는 비활성화)
│   ├── database/
│   │   ├── sqliteManager.ts                # SQLite 접근 계층
│   │   └── hybridManager.ts                # SQLite + LanceDB 통합
│   ├── rag/
│   │   ├── embedder.ts                     # 로컬 임베딩 (Transformers.js)
│   │   ├── guideManager.ts                 # 가이드 의미 기반 검색
│   │   └── knowledgeManager.ts             # 개인 지식 의미 기반 검색
│   ├── tools/
│   │   ├── egovSearchKnowledge.ts          # 단일 외부 도구 — scope/action 라우터
│   │   ├── commonComponents.ts             # 공통컴포넌트 메타/소스/DDL/DML
│   │   ├── compatibility.ts                # 호환 SW
│   │   └── knowledge.ts                    # 개인 지식
│   ├── types/                              # 공통 타입
│   ├── utils/
│   │   ├── fts5Query.ts                    # SQLite FTS5 쿼리 빌더
│   │   ├── projectPath.ts                  # 경로 유틸
│   │   ├── dataPaths.ts                    # 리소스 단위 오버레이 경로 해석 + state.json
│   │   ├── download.ts                     # HTTPS 다운로드 (크기 상한·타임아웃)
│   │   └── tarSafe.ts                      # tar.gz 안전 해제 (탈출·폭탄 가드)
│   └── scripts/
│       └── buildIndex.ts                   # 인덱스 빌더 (npm run build-index)
│
├── templates/                              # build-index 입력 원본 데이터
│   ├── common-components-src/              # 공통컴포넌트 소스/SQL 원본
│   ├── common-components.json              # 공통컴포넌트 메타/의존성 매니페스트
│   ├── compatibility/                      # 호환 SW 카탈로그 (Excel/JSON)
│   ├── developer_knowledge/                # 개인 지식 원본
│   └── egovframe_guide/                    # 공식 가이드 마크다운/PDF
│
├── knowledge-base/                         # build-index 산출물
│   ├── egovframe.db                        # SQLite (호환성/컴포넌트 메타)
│   ├── egovframe_guide.lance/              # LanceDB (가이드 임베딩)
│   ├── developer_knowledge.lance/          # LanceDB (개인 지식 임베딩)
│   ├── state.json                          # 리소스별 적용 버전 기록
│   ├── manifest.json                       # 동봉 스냅샷 manifest (update diff 부트스트랩)
│   └── snapshot.jsonl.gz                   # 동봉 스냅샷 (Q&A/FAQ canonical)
│
├── tests/                                  # Vitest 통합 테스트
│   └── integration/server.test.ts          # 노출 surface 고정 (egov_search_knowledge)
│
├── docs/                                   # 상세 문서
│   ├── INDEX.md                            # 📚 문서 인덱스
│   ├── MCP_SETUP_GUIDE.md                  # MCP 클라이언트 설정
│   ├── MCP_REFERENCE.md                    # 공개 API 레퍼런스
│   ├── EXPOSED_TOOLS.md                    # 노출 도구 정책
│   ├── EGOV_SEARCH_KNOWLEDGE_TOOL.md       # scope/action 매트릭스
│   ├── HYBRID_SYSTEM_GUIDE.md              # SQLite+LanceDB 설명
│   ├── DATABASE_SCHEMA.md                  # DB 스키마
│   ├── DEPLOYMENT_GUIDE.md                 # 배포
│   ├── TESTING_GUIDE.md                    # 테스트
│   └── test-scenarios/                     # 폐쇄망 OSS LLM 시나리오
│
├── build/                                  # tsc 산출물
├── notebooks/                              # 데이터 탐색 노트북
├── package.json
└── tsconfig.json
```

## 🧪 테스트 (Testing)

자동화 테스트는 [Vitest](https://vitest.dev/) 로 작성되어 있습니다. 외부에 노출되는 surface 가 `egov_search_knowledge` 하나로 고정되어 있는지 확인하는 통합 테스트가 핵심입니다.

| 명령어                | 동작                                                |
|----------------------|----------------------------------------------------|
| `npm test`           | `npm run build` 후 `vitest run` (통합 테스트)      |
| `npm run test:watch` | watch 모드 (build 생략)                            |

특정 파일만 실행:

```bash
npm run build
npx vitest run tests/integration/server.test.ts
```

### MCP Inspector (수동 디버깅)

```bash
npm run inspector
```

빌드된 `build/index.js` 를 MCP Inspector 에 띄워 `egov_search_knowledge` 를 인터랙티브하게 호출할 수 있습니다.

자세한 가이드: [`docs/TESTING_GUIDE.md`](docs/TESTING_GUIDE.md)

## 🔒 프라이버시 (Privacy)

모든 데이터는 **로컬**에 저장됩니다:

- 외부 API 호출 없음
- 클라우드로 전송 없음
- 완전 오프라인 동작 (폐쇄망 환경 사용 가능)
- 임베딩 모델도 로컬 (Transformers.js)

## 📖 추가 문서

| 문서                                                                                        | 설명                                            |
|--------------------------------------------------------------------------------------------|-------------------------------------------------|
| [`docs/INDEX.md`](docs/INDEX.md)                                                           | 📚 문서 안내                                    |
| [`docs/MCP_SETUP_GUIDE.md`](docs/MCP_SETUP_GUIDE.md)                                       | Cursor / Claude Desktop 설정 가이드             |
| [`docs/MCP_REFERENCE.md`](docs/MCP_REFERENCE.md)                                           | 공개 MCP API 레퍼런스                            |
| [`docs/EGOV_SEARCH_KNOWLEDGE_TOOL.md`](docs/EGOV_SEARCH_KNOWLEDGE_TOOL.md)                 | 통합 지식 검색 사용법 (scope/action 매트릭스)    |
| [`docs/HYBRID_SYSTEM_GUIDE.md`](docs/HYBRID_SYSTEM_GUIDE.md)                               | SQLite + LanceDB 하이브리드 시스템              |
| [`docs/DATABASE_SCHEMA.md`](docs/DATABASE_SCHEMA.md)                                       | DB 스키마                                       |
| [`docs/DEPLOYMENT_GUIDE.md`](docs/DEPLOYMENT_GUIDE.md)                                     | 배포 가이드                                      |
| [`docs/TESTING_GUIDE.md`](docs/TESTING_GUIDE.md)                                           | 빌드/테스트 가이드                               |
| [`docs/test-scenarios/`](docs/test-scenarios/)                                             | 폐쇄망 OSS LLM 테스트 시나리오                  |

## 🔗 함께 쓰는 자매 MCP

- **[egovframe-mcp-codegen](../egovframe-mcp-codegen)** — DDL 한 줄로 eGovFrame 프로젝트/엔티티 자동 생성
- **[egovframe-mcp-check](../egovframe-mcp-check)** — 생성된 프로젝트의 아키텍처 컴플라이언스 검증

## 📄 라이선스

Apache-2.0

## 🙏 Credits

- eGovFrame Framework Team
- Model Context Protocol by Anthropic
- LanceDB for vector database
- Transformers.js for local embeddings

Based on [egovframe-vscode-initializr](https://github.com/egovframework/egovframe-vscode-initializr).

---

**Made with ❤️ for eGovFrame developers**
