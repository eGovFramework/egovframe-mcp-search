# eGovFrame MCP Search 문서

`egovframe-mcp-search` 서버(지식검색 MCP)가 MCP 클라이언트에 노출하는 도구는 **`egov_search_knowledge` 하나**입니다(등록 위치는 `src/server.ts`). 이 디렉토리의 문서는 이 도구의 사용법과 서버의 설치, 운영, 개발에 필요한 내용을 주제별 폴더로 나누어 다룹니다. 서버의 개요와 빠른 설치 방법은 저장소 최상위의 [README](../README.md)에 있습니다.

## 폴더 구성

| 폴더 | 주제 | 주요 독자 |
|------|------|-----------|
| [setup/](./setup/) | 설치와 AI 클라이언트 등록 | 사용자 |
| [reference/](./reference/) | 도구의 파라미터, 필터, 응답과 오류의 형태 | 사용자, 도구를 호출하는 프롬프트의 작성자 |
| [architecture/](./architecture/) | 저장 구조와 검색 방식, DB 스키마 | 개발자 |
| [operations/](./operations/) | 배포 파일 제작, 지식베이스 구축과 갱신 | 유지보수자, 운영자 |
| [development/](./development/) | 테스트, 알려진 문제 | 개발자 |
| [release-notes/](./release-notes/) | 버전별 릴리스 노트 | 모든 독자 |

## 사용자 문서

| 문서 | 설명 |
|------|------|
| [setup/MCP_SETUP_GUIDE.md](./setup/MCP_SETUP_GUIDE.md) | 배포 파일(tgz)을 받아 AI 클라이언트(Claude Code, Codex, Cursor, VS Code, Cline, OpenCode)에 등록하는 방법, 다른 실행 형태, 환경 변수, 문제 해결 |
| [reference/EGOV_SEARCH_KNOWLEDGE_TOOL.md](./reference/EGOV_SEARCH_KNOWLEDGE_TOOL.md) | `egov_search_knowledge` 의 scope 별 사용법, 키워드 검색 규칙, 프롬프트와 호출 예시, 응답과 오류 문구 |
| [reference/MCP_REFERENCE.md](./reference/MCP_REFERENCE.md) | MCP API 요약: 서버 정보, 파라미터, 필터, 응답과 오류의 형태 |
| [reference/EXPOSED_TOOLS.md](./reference/EXPOSED_TOOLS.md) | `tools/list` 에 실리는 도구 정보와, 노출되지 않는 옛 도구 이름의 목록 |
| [release-notes/v5.1.0-beta.md](./release-notes/v5.1.0-beta.md) | 5.1.0 Beta 릴리스 노트와 배포 파일의 체크섬 |

## 개발자와 운영자 문서

| 문서 | 설명 |
|------|------|
| [architecture/HYBRID_SYSTEM_GUIDE.md](./architecture/HYBRID_SYSTEM_GUIDE.md) | SQLite, LanceDB, 공통컴포넌트 소스 트리로 이루어진 저장 구조와 검색 방식, 번들과 오버레이 |
| [architecture/DATABASE_SCHEMA.md](./architecture/DATABASE_SCHEMA.md) | SQLite 와 LanceDB 테이블의 스키마, 데이터 통계 |
| [operations/DEPLOYMENT_GUIDE.md](./operations/DEPLOYMENT_GUIDE.md) | 플랫폼별 배포 tgz 의 제작과 점검, 저장소 클론 실행 |
| [operations/KNOWLEDGE_BASE_GUIDE.md](./operations/KNOWLEDGE_BASE_GUIDE.md) | 지식베이스 구축(`build-index`)과 갱신(`update` 명령) |
| [development/TESTING_GUIDE.md](./development/TESTING_GUIDE.md) | 빌드와 테스트 실행 방법, 테스트 구성 |
| [development/KNOWN_ISSUES.md](./development/KNOWN_ISSUES.md) | 확인했지만 고치지 않고 남긴 문제와 후속 작업 (재현 방법, 원인, 고칠 방법, 결정이 필요한 항목) |
| [development/tests/](./development/tests/README.md) | 테스트 코드를 파일별로 설명하는 문서 |

## 공개 도구

| Tool | 용도 |
|------|------|
| `egov_search_knowledge` | 공식 가이드, 개발자 지식, 공통컴포넌트, 호환 소프트웨어의 통합 검색 (읽기 전용) |

이 서버는 검색과 조회만 제공합니다. 프로젝트와 코드 생성은 [egovframe-mcp-codegen](https://github.com/eGovFramework/egovframe-mcp-codegen) 서버가, 아키텍처 준수 점검은 [egovframe-mcp-check](https://github.com/eGovFramework/egovframe-mcp-check) 서버가 제공하므로, 그 기능이 필요하면 해당 서버를 따로 등록합니다.
