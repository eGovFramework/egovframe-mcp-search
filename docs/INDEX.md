# eGovFrame MCP Server 문서

`src/index.ts` 기준으로 MCP 클라이언트에 실제 노출되는 도구는 **`egov_search_knowledge` 하나**이며, 본 문서들은 이 도구와 운영에 필요한 내용만 다룹니다.

## 사용자 문서

| 문서 | 설명 |
|------|------|
| [MCP_SETUP_GUIDE.md](./MCP_SETUP_GUIDE.md) | Cursor/Claude Desktop 등 클라이언트 설정 방법 |
| [MCP_REFERENCE.md](./MCP_REFERENCE.md) | 현재 MCP API 레퍼런스 |
| [EXPOSED_TOOLS.md](./EXPOSED_TOOLS.md) | `ListToolsRequestSchema` 기준 실제 노출 도구 |
| [EGOV_SEARCH_KNOWLEDGE_TOOL.md](./EGOV_SEARCH_KNOWLEDGE_TOOL.md) | 통합 지식 검색 사용법 |
| [test-scenarios/](./test-scenarios/) | `egov_search_knowledge` 시나리오 모음 |

## 개발자 문서

| 문서 | 설명 |
|------|------|
| [TESTING_GUIDE.md](./TESTING_GUIDE.md) | 빌드와 테스트 실행 방법 |
| [tests/](./tests/) | `tests/**/*.test.ts` 파일별 의도·케이스 정리 |
| [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) | 로컬/패키지 배포 가이드 |
| [HYBRID_SYSTEM_GUIDE.md](./HYBRID_SYSTEM_GUIDE.md) | SQLite + LanceDB 구조 |
| [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) | 지식/참조 데이터베이스 스키마 |

## 현재 공개 도구

| Tool | 용도 |
|------|------|
| `egov_search_knowledge` | 공식 가이드, 개인 지식, 표준용어, 공통컴포넌트, 호환성 정보를 통합 검색 |

## 정리 기준

프로젝트 스캐폴딩, 엔티티/조회화면 추가, 아키텍처 준수 검사, CRUD/설정 생성, DDL 정규화, 직접 지식 변경 API 등 과거에 노출되었던 도구는 모두 외부 인터페이스에서 제거되었습니다. 옛 이름으로 호출되면 `src/index.ts`의 가드가 "통합 검색으로 흡수됨/노출 중단됨" 안내 에러를 돌려줍니다.
