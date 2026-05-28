# SQLite + LanceDB 하이브리드 시스템

이 프로젝트는 정형 참조 데이터는 SQLite에, 비정형 문서/지식 검색용 벡터 데이터는 LanceDB에 저장합니다.

## 구성

| 영역 | 저장소 | 용도 |
|------|--------|------|
| 표준용어/단어/도메인 | SQLite | 정확 조회, 필터링, 페이지네이션 |
| 호환 소프트웨어 | SQLite | 버전, 벤더, 제품명 기반 조회 |
| 공통컴포넌트 메타데이터 | SQLite | 컴포넌트 목록, 상세, 의존성, DDL/DML 참조 |
| eGovFrame 가이드 문서 | LanceDB | 자연어 기반 의미 검색 |
| 개인 지식 | LanceDB | 개발 경험, 오류 해결, 패턴 검색 |

## 주요 코드

| 파일 | 역할 |
|------|------|
| `src/database/hybridManager.ts` | SQLite와 LanceDB 초기화/조합 |
| `src/database/sqliteManager.ts` | SQLite 연결과 정형 데이터 조회 |
| `src/rag/knowledgeManager.ts` | 개인 지식 벡터 검색 |
| `src/rag/guideManager.ts` | eGovFrame 가이드 벡터 검색 |
| `src/rag/embedder.ts` | 로컬 임베딩 모델 실행 |
| `src/scripts/buildIndex.ts` | 지식/참조 데이터 인덱스 생성 |

## 공개 도구와의 관계

하이브리드 저장소는 직접 MCP API로 노출되지 않습니다. 지식/참조 데이터는 다음 공개 도구를 통해 접근합니다.

| Tool | 사용하는 데이터 |
|------|----------------|
| `egov_search_knowledge` | SQLite와 LanceDB의 지식/참조 데이터 통합 검색 |

본 서버에서 노출되는 도구는 `egov_search_knowledge` 단 하나이며, 그 외 옛 도구(`egov_check_compliance`, `egov_scaffold_project` 등)는 모두 제거되었습니다.

## 초기화

```bash
npm run build
npm run build-index
```

`build-index`는 표준용어, 호환성, 공통컴포넌트, 가이드 문서, 개인 지식 인덱스를 현재 데이터 소스로부터 재생성합니다.

## 로컬 실행 특성

- 외부 임베딩 API를 호출하지 않고 로컬 모델을 사용합니다.
- 데이터베이스는 기본적으로 프로젝트의 로컬 경로에 생성됩니다.
- 지식 원천 파일을 수정한 뒤에는 인덱스를 다시 빌드해야 검색 결과가 갱신됩니다.

## 관련 문서

- [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md)
- [EGOV_SEARCH_KNOWLEDGE_TOOL.md](./EGOV_SEARCH_KNOWLEDGE_TOOL.md)
