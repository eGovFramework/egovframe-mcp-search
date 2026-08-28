# eGovFrame MCP Search

> **eGovFrame 가이드 · 표준 용어 · 공통컴포넌트 · 호환성 정보를 하나의 MCP 도구로 통합 검색**

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org)

## 📖 MCP 개요

**MCP (Model Context Protocol)** 는 Anthropic 이 공개한 개방형 표준으로, LLM 클라이언트(Claude Desktop, Cursor, Claude Code 등) 와 외부 도구/데이터 소스를 안전하고 일관된 방식으로 연결합니다. MCP 서버는 stdio 또는 HTTP 위에 JSON-RPC 로 동작하며, LLM 에게 호출 가능한 **Tool** 목록과 각 Tool 의 입력 스키마를 노출합니다.

**eGovFrame MCP Search** 는 전자정부 표준프레임워크 개발에 필요한 **다섯 종류의 지식 소스**를 `egov_search_knowledge` 도구 하나로 통합 노출하며, 여기에 한글 도메인 기반 스키마 설계를 돕는 `egov_ddl_assist` 도구를 더해 총 **두 개의 도구**를 제공합니다. `egov_search_knowledge` 가 통합 검색하는 다섯 소스는 다음과 같습니다:

1. **공식 개발자 가이드** — eGovFrame 공식 위키 콘텐츠 (의미 기반 검색)
2. **개발자 개인 지식** — 팀이 축적한 노하우/스니펫 (의미 기반 검색)
3. **표준 용어 · 단어 · 도메인** — 행정안전부 표준 용어집 (정형 검색)
4. **공통컴포넌트** — 메타/의존성/소스파일/DDL/DML 일체 (정형 + 파일시스템)
5. **호환 SW 목록** — 프레임워크 버전별 검증 호환성 (정형 검색)

내부적으로는 **SQLite (정형) + LanceDB (벡터/의미 기반) 하이브리드 스토리지**를 사용하며, 모든 데이터는 로컬에 저장되어 **완전 오프라인** 으로 동작합니다. 임베딩은 `@xenova/transformers` 의 `multilingual-e5-small` (384차원) 모델을 로컬에서 실행합니다.

LLM 은 사용자 질의로부터 `scope` (검색 영역) 와 `action` (하위 동작) 만 결정하면 되고, 실제 라우팅/조회/포맷팅은 모두 서버가 수행합니다.

## 🛠️ 제공 도구 (Tools)

이 MCP 서버는 **두 개의 도구**를 외부에 노출합니다.

| Tool | 분류 | 핵심 용도 |
|------|------|-----------|
| [`egov_ddl_assist`](#egov_ddl_assist) | 스키마 설계/검토 oracle | 한글 → 행정안전부 표준 영문 컬럼명/SQL 타입 변환·검증, 테이블 개념별 후보 제안 (CREATE TABLE 작성 보조) |
| [`egov_search_knowledge`](#egov_search_knowledge) | 통합 지식/레퍼런스 검색 (읽기 전용) | 가이드·개인 지식·표준 용어·공통컴포넌트(미리 정의된 CREATE TABLE 포함)·호환성 SW 를 하나의 관문으로 조회 |

두 도구의 역할 경계는 명확합니다 — **새 스키마를 한글 도메인 지식으로 설계/검토할 때는 `egov_ddl_assist`**, **이미 존재하는 자료(가이드·공통컴포넌트의 미리 정의된 DDL·표준용어 사전 검색)를 조회할 때는 `egov_search_knowledge`** 입니다. 옛 이름의 분리 도구(`search_guide`, `search_standard_terms`, `list_common_components` 등)는 모두 `egov_search_knowledge` 의 `scope`/`action` 파라미터로 통합되었습니다. 이 이름들은 더 이상 등록되지 않으므로, 옛 이름으로 호출하면 SDK 가 표준 JSON-RPC `Method not found` 에러를 반환합니다.

### `egov_search_knowledge`

| 파라미터        | 타입    | 필수 | 설명                                                                            |
|---------------|--------|------|---------------------------------------------------------------------------------|
| query         | string |      | 검색 질의/키워드. `guide`/`knowledge`/`compatibility` 키워드 검색 / `all` 에 필수 |
| scope         | enum   |      | 검색 영역 — `auto` (기본) / `guide` / `knowledge` / `terms` / `components` / `compatibility` / `all` |
| action        | string |      | 하위 동작. components: `get`/`info`/`dependencies`/`sourceFiles`/`readSource`/`ddl`/`dml`. terms: `get` |
| filters       | object |      | scope 별 필터 (아래 표 참조)                                                    |
| limit         | number |      | 검색 결과 최대 개수                                                              |
| strictScope   | bool   |      | true 면 추론/지정 scope 내에서만 검색. `auto` 의 광역 키워드 확장을 막을 때 사용  |

### scope 매트릭스

| scope          | 데이터 출처            | 주요 filter                                    | 대표 use case                            |
|---------------|-----------------------|----------------------------------------------|------------------------------------------|
| `guide`       | LanceDB (가이드)      | `layer`, `category`, `limit`                  | "트랜잭션 설정 방법?"                    |
| `knowledge`   | LanceDB (개인 지식)   | `limit`                                       | "지난번 김대리가 정리한 페이징 트러블슈팅" |
| `terms`       | SQLite                | `koreanName`, `englishName`, `fulltext`       | "민원 → MNW", "USR_ID 라는 컬럼의 표준명?" |
| `components`  | SQLite + 파일시스템    | `componentId`, `componentIds`, `dbType`, `filePath` | "bbs 공통컴포넌트 의존성/DDL/소스파일"    |
| `compatibility` | SQLite              | `frameworkVersion`, `vendor`, `productName`, `includeKnowledge` | "eGovFrame 4.3 호환 CMS"     |
| `auto`        | (입력으로부터 추론)    | -                                             | 사용자가 scope 를 의식하지 않게           |
| `all`         | 가이드 + 지식 + 표준  | -                                             | 광역 키워드 검색                          |

### components 의 action 별 동작

| action          | 동작                                                                        |
|----------------|-----------------------------------------------------------------------------|
| `get` / `info` | 단일 컴포넌트 메타 (요약 / 카테고리 / 설명)                                   |
| `dependencies` | 의존 공통컴포넌트 트리 (transitive 포함)                                      |
| `sourceFiles`  | 컴포넌트의 모든 소스 파일 목록 (경로/타입)                                     |
| `readSource`   | 특정 `filePath` 의 원본 소스 코드                                              |
| `ddl`          | `dbType` (mysql/oracle/h2) 별 CREATE TABLE 문                                |
| `dml`          | 초기 데이터 INSERT 문                                                         |

### `egov_ddl_assist`

행정안전부 공통표준용어 사전(`templates/standard_terms/*.csv`, 8차 2025-11) + 기관 custom 사전(`templates/custom_terms/*.csv`, 단일 기관)을 lookup oracle 로 노출합니다. LLM 이 한글 도메인으로 CREATE TABLE 을 작성할 때 표준/Custom 영문 컬럼명과 SQL 타입을 *조각* 단위로 받아 직접 조립하는 방식 — 도구는 DDL 문장을 생성하지 않습니다.

**우선순위**: `custom > standard` (transparent override). 같은 한글명이 양쪽 모두에 있으면 custom 이 우선되고, 응답에 가려진 표준 정의가 `standardEquivalent` 로 함께 노출됩니다. 기관 custom 등록은 [templates/custom_terms/README.md](templates/custom_terms/README.md) 참고.

**Custom 만 빠른 재적재**: 기관 custom CSV 만 수정한 경우 `npm run build-index:custom` (1~2초) 로 LanceDB 재벡터화 없이 바로 반영. 전체 인덱싱은 `npm run build-index` (5~15분).

| 파라미터 | 타입 | 필수 | 설명 |
|---------|-----|------|------|
| `action` | enum | ✓ | `lookup_term` / `decompose_phrase` / `resolve_domain` / `propose_column` / `validate_column` / `suggest_table_columns` |
| `input` | string | ✓ | 한글 용어/구문, 도메인명 또는 영문 컬럼명 |
| `domainHint` | string | - | `propose_column` 분해 폴백 시 SQL 타입 결정용 도메인명 |
| `sqlType` | string | - | `validate_column` 전용. 실제 사용된 SQL 타입 (예: `VARCHAR(100)`) |
| `limit` | number | - | `suggest_table_columns` 전용. 후보 수 상한 (기본 30, 최대 100) |

| action | 입력 예시 | 출력 핵심 |
|--------|----------|----------|
| `lookup_term` | `사용자명` | `{matchType: "exact", term: {englishName: "USER_NM", resolvedDomain.ddlFragment: "VARCHAR(100)", synonyms, ...}}` |
| `decompose_phrase` | `신규사용자등록일자` | `{tokens: [{korean:"신규", english:"NEW"}, ...], suggestedColumnName: "NEW_USER_REG_YMD"}` |
| `resolve_domain` | `명V100` | `{domain: {dataType:"VARCHAR", dataLength:"100", ddlFragment:"VARCHAR(100)"}}` |
| `propose_column` | `회원가입일자` | `{method:"exact", ddlFragment:"MBR_JOIN_YMD CHAR(8)", confidence:1.0}` |
| `validate_column` | `USER_NM` + `sqlType:"VARCHAR(50)"` | `{status:"type_mismatch", findings:[{level:"error", code:"TYPE_MISMATCH", message:"길이 불일치 (입력 50, 표준 100)"}]}` |
| `suggest_table_columns` | `게시판` | `{total, suggestions:[{koreanName:"게시판내용", englishName:"BBS_CN", ddlFragment:"BBS_CN VARCHAR(4000)", matchType:"prefix"}, ...]}` |

**`propose_column` 매칭 우선순위**: ① exact (표준 용어 정확 매칭, `confidence: 1.0`) → ② synonym (동의어 매칭, `0.85`, `note` 로 표준명 권장) → ③ composed (표준 단어 longest-prefix 분해 후 영문 조합, `0.5~0.85`; SQL 타입은 `domainHint` 필요).

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

표준 용어 / 공통컴포넌트 / 호환성 데이터 / 개발자 지식 / eGovFrame 가이드를 로컬 SQLite + LanceDB 에 인덱싱합니다:

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
npx egovframe-mcp-search update --resource=compatibility --compatibility-tag=v4.3.0
npx egovframe-mcp-search update --resource=custom_terms --from-file /data/기관사전   # Custom 사전은 반입 전용
npx egovframe-mcp-search update --from-file /media/usb/kb   # 폐쇄망 반입 (동일 코드 경로)
npx egovframe-mcp-search update --rollback     # 직전 버전 복귀
```

| 리소스 | 갱신 단위 | 소스 | 클라이언트 비용 |
|--------|-----------|------|----------------|
| `developer_knowledge` (Q&A/FAQ) | **행 증분** — 직전 적용 스냅샷과 id 대조 | 릴리스 스냅샷 (`manifest.json` + `snapshot.jsonl.gz`) | 변경분만 로컬 임베딩 (수십 건 ≈ 수십 초) |
| `guide` | **전량 재인덱싱** | GitHub 태그 (sparse checkout, 이미지 제외) | md 전체 재임베딩 (수 분) |
| `components` | **트리 교체** | GitHub 태그 소스 tarball (~37MB) | 임베딩 0 — 압축 해제만. SQLite 메타(목록·설명·FTS)는 동봉본 유지 |
| `compatibility` (호환성 SW) | **SQLite 재적재** — JSON 기준 deterministic | `egovframe-mcp-search-upload-data` 릴리스 자산 (스냅샷과 동일 저장소) | 임베딩 0 — 오버레이 SQLite 에 적재 |
| `custom_terms` (기관 Custom 사전) | **SQLite 재적재** — CSV 3종 | **반입 전용** (`--from-file`, 기관이 직접 준비) | 임베딩 0 — 오버레이 SQLite 에 적재 |

- 오버레이 위치: macOS `~/Library/Application Support/egovframe-mcp-search`, Linux `~/.local/share/egovframe-mcp-search`, Windows `%LOCALAPPDATA%\egovframe-mcp-search` (`EGOV_MCP_DATA_DIR` 로 override)
- 리소스별 **독립 갱신** — 하나가 실패해도 나머지는 적용되고, 실패한 리소스는 이전 상태를 유지합니다
- 임베딩 모델이 패키지에 동봉되어 갱신의 임베딩도 **완전 오프라인**으로 동작합니다
- 폐쇄망: 반입 담당자가 준비한 디렉토리(`manifest.json`/`snapshot.jsonl.gz`, `guide-md.tar.gz`, `components-src.tar.gz`, `compatibility/compatibility-software.json`, `custom_terms/*.csv`)를 `--from-file` 로 지정 — 온라인 경로와 100% 동일한 코드로 검증·적용됩니다

**SQLite 리소스의 특별 규칙 (번들이 이긴다)**: `compatibility` 와 `custom_terms` 는 하나의 오버레이 SQLite 사본을 공유합니다. 사본은 복사 시점의 번들 식별자(base)를 기록하며, **MCP 패키지를 업그레이드하면 사본이 무효화되어 새 번들이 우선**합니다 (신규 표준용어·컴포넌트 메타가 가려지지 않도록). 적용했던 원본(JSON/CSV)은 오버레이에 보관되므로, 업그레이드 후 `update` 를 한 번 실행하면 새 번들 위에 자동 재적용됩니다 (`--check` 가 폴백 상태를 안내).

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

Claude: (scope: "auto" → 가이드 + 개인지식 + 표준용어를 동시에 조회)
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

### 예시 6. 표준 용어 조회

```
User: "'민원' 의 표준 영문 약어와 표준 컬럼명은?"

Claude: (scope: "terms", action: "get", filters: { koreanName: "민원" })
```

### 예시 7. 공통컴포넌트 소스 코드 직접 읽기

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
│  egov_search_knowledge + egov_ddl_assist        │
│                  │                              │
│        ┌─────────┴──────────┐                  │
│        ▼                    ▼                  │
│  ┌──────────────┐    ┌─────────────────┐      │
│  │   SQLite     │    │   LanceDB       │      │
│  │   (정형)      │    │   (의미/벡터)    │      │
│  └──────────────┘    └─────────────────┘      │
│    • 표준 용어/단어/도메인  • 공식 가이드        │
│    • 호환성 목록           • 개인 지식           │
│    • 공통컴포넌트 메타                          │
└────────────────────────────────────────────────┘

  임베딩: @xenova/transformers (multilingual-e5-small, 384-dim, 로컬 실행)
```

### 핵심 모듈

| 모듈                            | 역할                                                            |
|--------------------------------|----------------------------------------------------------------|
| `database/sqliteManager.ts`    | SQLite 접근 — 표준용어/호환성/컴포넌트 메타                       |
| `database/hybridManager.ts`    | SQLite + LanceDB 통합 진입점                                    |
| `rag/embedder.ts`              | 로컬 임베딩 (Transformers.js)                                   |
| `rag/guideManager.ts`          | LanceDB 기반 공식 가이드 검색                                    |
| `rag/knowledgeManager.ts`      | LanceDB 기반 개인 지식 검색                                      |
| `tools/egovSearchKnowledge.ts` | 외부 도구 1 — 통합 검색 scope/action 라우터                        |
| `tools/egovDdlAssist.ts`       | 외부 도구 2 — DDL 작성 보조 (한글 → 표준 영문/SQL 타입)            |
| `tools/commonComponents.ts`    | 공통컴포넌트 메타/의존성/DDL/DML/소스 조회                        |
| `tools/standardTerms.ts`       | 표준 용어/단어/도메인 정형 검색                                   |
| `tools/compatibility.ts`       | 호환 SW 검색                                                   |
| `tools/knowledge.ts`           | 개인 지식 검색 (의미 기반)                                       |
| `scripts/buildIndex.ts`        | `templates/` → `knowledge-base/` 인덱스 구축                    |

## 🗂️ 폴더 구조 (Project Structure)

```
egovframe-mcp-search/
├── src/
│   ├── index.ts                            # 진입점 디스패처 (인자 없음 → 서버 / update → CLI)
│   ├── server.ts                           # MCP 서버 (egov_search_knowledge + egov_ddl_assist 노출)
│   ├── cli/
│   │   └── update.ts                       # 지식베이스 갱신 CLI (npx egovframe-mcp-search update)
│   ├── kb/
│   │   ├── snapshot.ts                     # 개발자 지식 스냅샷 형식 (manifest/jsonl.gz, diff)
│   │   ├── sources.ts                      # 원격 소스 채널 정의 (URL 상수·태그 조회)
│   │   ├── guideIndexer.ts                 # 가이드 md 인덱싱 공용 로직 (build-index/update 공유)
│   │   └── sqliteLoaders.ts                # SQLite 적재 공용 로직 — 호환성 SW·Custom 사전 (build-index/update 공유)
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
│   │   ├── standardTerms.ts                # 표준 용어
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
│   ├── standard_terms/                     # 표준 용어/단어/도메인 CSV (data.go.kr 8차)
│   ├── developer_knowledge/                # 개인 지식 원본
│   └── egovframe_guide/                    # 공식 가이드 마크다운/PDF
│
├── knowledge-base/                         # build-index 산출물
│   ├── egovframe.db                        # SQLite (표준용어/호환성/컴포넌트 메타)
│   ├── egovframe_guide.lance/              # LanceDB (가이드 임베딩)
│   ├── developer_knowledge.lance/          # LanceDB (개인 지식 임베딩)
│   ├── state.json                          # 리소스별 적용 버전 기록
│   ├── manifest.json                       # 동봉 스냅샷 manifest (update diff 부트스트랩)
│   └── snapshot.jsonl.gz                   # 동봉 스냅샷 (Q&A/FAQ canonical)
│
├── tests/                                  # Vitest 통합 테스트
│   └── integration/server.test.ts          # 노출 surface 고정 (egov_search_knowledge, egov_ddl_assist)
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
