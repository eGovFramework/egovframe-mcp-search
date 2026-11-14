# eGovFrame MCP Search 문서

`egovframe-mcp-search` 서버가 MCP 클라이언트에 노출하는 도구는 **`egov_search_knowledge` 하나**입니다(등록 위치는 `src/server.ts`). 이 디렉토리의 문서는 이 도구의 사용법과 서버의 설치, 운영, 개발에 필요한 내용을 다룹니다.

## 사용자 문서

| 문서 | 설명 |
|------|------|
| [MCP_SETUP_GUIDE.md](./MCP_SETUP_GUIDE.md) | 설치 형태별 준비 사항, Cursor, Claude Desktop 등 MCP 클라이언트 등록 방법, 환경 변수, 문제 해결 |
| [MCP_REFERENCE.md](./MCP_REFERENCE.md) | MCP API 요약: 파라미터, 필터, 응답과 오류의 형태 |
| [EXPOSED_TOOLS.md](./EXPOSED_TOOLS.md) | `tools/list` 기준 노출 도구와 노출되지 않는 옛 도구 이름 |
| [EGOV_SEARCH_KNOWLEDGE_TOOL.md](./EGOV_SEARCH_KNOWLEDGE_TOOL.md) | `egov_search_knowledge` 의 scope 별 사용법과 호출 예시 |
| [test-scenarios/](./test-scenarios/) | `egov_search_knowledge` 시나리오 모음 |

## 개발자 문서

| 문서 | 설명 |
|------|------|
| [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) | 플랫폼별 배포 tgz 의 제작과 설치, 저장소 클론 실행, 지식베이스 갱신 |
| [HYBRID_SYSTEM_GUIDE.md](./HYBRID_SYSTEM_GUIDE.md) | SQLite, LanceDB, 공통컴포넌트 소스 트리로 이루어진 저장 구조와 검색 방식, 인덱스 재구축, 번들과 오버레이 |
| [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) | SQLite 와 LanceDB 테이블의 스키마 |
| [TESTING_GUIDE.md](./TESTING_GUIDE.md) | 빌드와 테스트 실행 방법, 테스트 구성 |
| [KNOWN_ISSUES.md](./KNOWN_ISSUES.md) | 확인했지만 고치지 않고 남긴 문제와 후속 작업 (재현 방법, 원인, 고칠 방법, 결정이 필요한 항목) |
| [tests/](./tests/) | 테스트 코드를 설명하는 문서 |

## 현재 공개 도구

| Tool | 용도 |
|------|------|
| `egov_search_knowledge` | 공식 가이드, 개발자 지식, 공통컴포넌트, 호환 소프트웨어의 통합 검색 (읽기 전용) |

## 정리 기준

프로젝트 스캐폴딩, 엔티티와 조회 화면 추가, 아키텍처 준수 검사, CRUD 와 설정 생성, DDL 정규화, 표준·Custom 용어사전 기반 DDL 보조(`egov_ddl_assist`), 지식을 직접 변경하는 API 등 과거에 노출되던 도구는 모두 이 서버의 외부 인터페이스에서 제거되었습니다. 이 이름들은 `src/server.ts` 에 등록되지 않으므로, 옛 이름으로 호출하면 `isError: true` 인 도구 결과(`MCP error -32602: Tool <이름> not found`)가 돌아옵니다. 옛 이름의 목록은 [EXPOSED_TOOLS.md](./EXPOSED_TOOLS.md#노출되지-않는-도구)에 있습니다.
