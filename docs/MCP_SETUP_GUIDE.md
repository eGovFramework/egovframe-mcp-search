# MCP 설정 및 사용 가이드

## 설치

```bash
npm install
npm run build
```

선택 사항으로 지식/참조 데이터 인덱스를 생성합니다.

```bash
npm run build-index
```

## Cursor 설정

Cursor의 MCP 설정에 빌드된 서버 진입점을 등록합니다.

```json
{
  "mcpServers": {
    "egovframe-mcp-search": {
      "command": "node",
      "args": ["/path/to/egovframe-mcp-search/build/index.js"],
      "env": {
        "EGOVFRAME_TEMPLATE_PATH": "/path/to/egovframe-mcp-search/templates",
        "EGOVFRAME_KNOWLEDGE_DB": "/path/to/egovframe-mcp-search/knowledge-base"
      }
    }
  }
}
```

## Claude Desktop 설정

macOS 기준 설정 파일은 `~/Library/Application Support/Claude/claude_desktop_config.json`입니다.

```json
{
  "mcpServers": {
    "egovframe-mcp-search": {
      "command": "node",
      "args": ["/path/to/egovframe-mcp-search/build/index.js"],
      "env": {
        "EGOVFRAME_TEMPLATE_PATH": "/path/to/egovframe-mcp-search/templates",
        "EGOVFRAME_KNOWLEDGE_DB": "/path/to/egovframe-mcp-search/knowledge-base"
      }
    }
  }
}
```

Windows에서는 `%APPDATA%\\Claude\\claude_desktop_config.json`에 같은 구조로 등록합니다.

## 환경변수

| 환경변수 | 설명 | 기본값 |
|----------|------|--------|
| `EGOVFRAME_TEMPLATE_PATH` | 템플릿 파일 경로 | `./templates` |
| `EGOVFRAME_KNOWLEDGE_DB` | SQLite/LanceDB 지식 베이스 경로 | `./knowledge-base` |

## 현재 제공 기능

| Tool | 설명 |
|------|------|
| `egov_search_knowledge` | 공식 가이드, 개인 지식, 공통컴포넌트, 호환성 통합 검색(읽기 전용) |

## 자동 승인 권장값

`egov_search_knowledge`는 읽기 전용이라 자동 승인 목록에 넣어도 안전합니다.

```json
{
  "alwaysAllow": [
    "egov_search_knowledge"
  ]
}
```

## 사용 예시

### 지식 검색

```text
eGovFrame에서 MyBatis 설정 방법을 공식 가이드와 기존 지식까지 함께 찾아줘.
```

내부적으로는 `egov_search_knowledge`가 `scope: "all"` 또는 자동 추론으로 관련 지식 소스를 검색합니다.

### 공통컴포넌트 조회

```text
게시판 공통컴포넌트의 의존성과 MySQL DDL을 확인해줘.
```

`egov_search_knowledge`의 `scope: "components"`와 `action`/`filters`를 사용합니다.

### 호환 소프트웨어 확인

```text
eGovFrame 4.3과 호환되는 RDBMS 목록을 알려줘.
```

`egov_search_knowledge`의 `scope: "compatibility"`로 라우팅됩니다.

## 문제 해결

| 증상 | 확인할 것 |
|------|-----------|
| 서버가 보이지 않음 | `npm run build`가 성공했는지, `build/index.js` 경로가 맞는지 확인 |
| 지식 검색 결과가 비어 있음 | `npm run build-index` 실행 여부와 `EGOVFRAME_KNOWLEDGE_DB` 경로 확인 |
| 옛 도구 이름으로 호출 시 에러 | `egov_check_compliance`/`egov_scaffold_project`/`egov_add_entity`/`egov_add_query_view` 등은 본 서버에서 제거되었습니다. 호출 측에서 `egov_search_knowledge`만 사용하도록 갱신 |
