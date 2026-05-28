# eGovFrame MCP Search

> **eGovFrame 가이드 · 표준 용어 · 공통컴포넌트 · 호환성 정보를 하나의 MCP 도구로 통합 검색**

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org)

## 📖 MCP 개요

**MCP (Model Context Protocol)** 는 Anthropic 이 공개한 개방형 표준으로, LLM 클라이언트(Claude Desktop, Cursor, Claude Code 등) 와 외부 도구/데이터 소스를 안전하고 일관된 방식으로 연결합니다. MCP 서버는 stdio 또는 HTTP 위에 JSON-RPC 로 동작하며, LLM 에게 호출 가능한 **Tool** 목록과 각 Tool 의 입력 스키마를 노출합니다.

**eGovFrame MCP Search** 는 전자정부 표준프레임워크 개발에 필요한 **다섯 종류의 지식 소스**를 단일 MCP 도구(`egov_search_knowledge`) 로 통합 노출합니다:

1. **공식 개발자 가이드** — eGovFrame 공식 위키 콘텐츠 (의미 기반 검색)
2. **개발자 개인 지식** — 팀이 축적한 노하우/스니펫 (의미 기반 검색)
3. **표준 용어 · 단어 · 도메인** — 행정안전부 표준 용어집 (정형 검색)
4. **공통컴포넌트** — 메타/의존성/소스파일/DDL/DML 일체 (정형 + 파일시스템)
5. **호환 SW 목록** — 프레임워크 버전별 검증 호환성 (정형 검색)

내부적으로는 **SQLite (정형) + LanceDB (벡터/의미 기반) 하이브리드 스토리지**를 사용하며, 모든 데이터는 로컬에 저장되어 **완전 오프라인** 으로 동작합니다. 임베딩은 `@xenova/transformers` 의 `multilingual-e5-small` (384차원) 모델을 로컬에서 실행합니다.

LLM 은 사용자 질의로부터 `scope` (검색 영역) 와 `action` (하위 동작) 만 결정하면 되고, 실제 라우팅/조회/포맷팅은 모두 서버가 수행합니다.

## 🛠️ 제공 도구 (Tools)

이 MCP 서버는 **단 하나의 도구**만 외부에 노출합니다: `egov_search_knowledge`. 과거 분리되어 있던 십수 개의 도구(`search_guide`, `search_standard_terms`, `list_common_components` 등) 는 이 도구의 `scope`/`action` 파라미터로 통합되었으며, 옛 이름으로 호출하면 안내 에러가 반환됩니다.

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

## 🚀 설치 (Installation)

### Prerequisites

- **Node.js**: v18.0.0 이상 (v22.x 권장)
- **npm**: v8.0.0 이상

### Install & Build

```bash
npm install
npm run build
```

### Knowledge Base 구축

표준 용어 / 공통컴포넌트 / 호환성 데이터 / eGovFrame 가이드를 로컬 SQLite + LanceDB 에 인덱싱합니다:

```bash
npm run build-index
```

처음 한 번만 수행하면 됩니다. 결과는 `knowledge-base/` 폴더 아래에 생성됩니다 (`egovframe.db`, `egovframe_guide.lance/`, `developer_knowledge.lance/`). 약 15–25MB 소요.

- 표준 용어 6,400+ 건
- 표준 단어 1,000+ 건
- 표준 도메인 100+ 건
- eGovFrame 공식 가이드 문서 임베딩

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
│  egov_search_knowledge (단일 외부 도구)         │
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
| `tools/egovSearchKnowledge.ts` | 단일 외부 도구 — scope/action 라우터                             |
| `tools/commonComponents.ts`    | 공통컴포넌트 메타/의존성/DDL/DML/소스 조회                        |
| `tools/standardTerms.ts`       | 표준 용어/단어/도메인 정형 검색                                   |
| `tools/compatibility.ts`       | 호환 SW 검색                                                   |
| `tools/knowledge.ts`           | 개인 지식 검색 (의미 기반)                                       |
| `scripts/buildIndex.ts`        | `templates/` → `knowledge-base/` 인덱스 구축                    |

## 🗂️ 폴더 구조 (Project Structure)

```
egovframe-mcp-search/
├── src/
│   ├── index.ts                            # MCP 서버 진입점 (egov_search_knowledge 만 노출)
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
│   │   └── projectPath.ts                  # 경로 유틸
│   └── scripts/
│       └── buildIndex.ts                   # 인덱스 빌더 (npm run build-index)
│
├── templates/                              # build-index 입력 원본 데이터
│   ├── common-components-src/              # 공통컴포넌트 소스/SQL 원본
│   ├── common-components.json              # 공통컴포넌트 메타/의존성 매니페스트
│   ├── compatibility/                      # 호환 SW 카탈로그 (Excel/JSON)
│   ├── ddlguide/                           # 표준 용어/단어/도메인 원본
│   ├── developer_knowledge/                # 개인 지식 원본
│   └── egovframe_guide/                    # 공식 가이드 마크다운/PDF
│
├── knowledge-base/                         # build-index 산출물 (gitignored)
│   ├── egovframe.db                        # SQLite (표준용어/호환성/컴포넌트 메타)
│   ├── egovframe_guide.lance/              # LanceDB (가이드 임베딩)
│   └── developer_knowledge.lance/          # LanceDB (개인 지식 임베딩)
│
├── tests/                                  # Vitest 통합 테스트
│   └── integration/server.test.ts          # 노출 surface 고정 (egov_search_knowledge 만)
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
