# SQLite + LanceDB 하이브리드 시스템

이 서버는 정형 참조 데이터를 SQLite 에, 의미 검색용 벡터 데이터를 LanceDB 에 저장하고, 공통컴포넌트의 소스와 SQL 스크립트는 파일 트리에서 직접 읽습니다. 모두 로컬 파일이며 외부 서비스를 호출하지 않습니다.

## 구성

| 영역 | 저장소 | 용도 |
|------|--------|------|
| 호환 소프트웨어 | SQLite (`knowledge-base/egovframe.db`) | 버전, 분류, 업체, 제품명 조건 조회와 FTS5 키워드 검색 |
| 공통컴포넌트 메타데이터 | SQLite (`knowledge-base/egovframe.db`) | 카테고리, 컴포넌트 목록과 상세, 의존성, 사용 테이블 목록, FTS5 키워드 검색 |
| 공통컴포넌트 소스, DDL, DML | 파일 트리 (`templates/common-components-src/`) | 소스 파일 목록과 내용. DDL 과 DML 은 `script/ddl/<DB>/`, `script/dml/<DB>/` 의 SQL 파일에서 컴포넌트가 쓰는 테이블의 문만 골라냅니다. |
| 공식 가이드 | LanceDB (`knowledge-base/egovframe_guide.lance`) | 의미 검색 |
| 개발자 지식 | LanceDB (`knowledge-base/developer_knowledge.lance`) | 포털의 묻고답하기, FAQ, 적용가이드의 의미 검색 |
| 임베딩 모델 | 파일 (`models/Xenova/multilingual-e5-small`) | 검색 질의를 384차원 벡터로 변환 |

테이블과 컬럼은 [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md)에 정리되어 있습니다.

## 주요 코드

| 파일 | 역할 |
|------|------|
| `src/database/sqliteManager.ts` | SQLite 연결과 정형 데이터 조회 |
| `src/database/hybridManager.ts` | 서버의 조회용 매니저. SQLite 를 읽기 전용으로 열고 개발자 지식 테이블을 엽니다. |
| `src/rag/guideManager.ts` | 공식 가이드 벡터 검색 |
| `src/rag/knowledgeManager.ts` | 개발자 지식 벡터 검색 |
| `src/rag/embedder.ts` | 로컬 임베딩 모델 실행 |
| `src/tools/commonComponents.ts` | 공통컴포넌트 메타 조회와 소스 트리 읽기 |
| `src/utils/dataPaths.ts` | 데이터 경로 해석 (오버레이 우선, 번들 대체) |
| `src/scripts/buildIndex.ts` | 인덱스 구축 (`npm run build-index`) |
| `src/cli/update.ts` | 지식베이스 갱신 명령 (`update`) |

## 공개 도구와의 관계

저장소는 MCP API 로 직접 노출되지 않고, `egov_search_knowledge` 의 scope 를 통해서만 읽힙니다. 이 도구는 조회만 하며 저장소에 쓰지 않습니다.

| scope | 읽는 저장소 |
|-------|-------------|
| `guide` | LanceDB 의 공식 가이드 테이블 |
| `knowledge` | LanceDB 의 개발자 지식 테이블. `filters.knowledgeScope: "all"` 이면 SQLite 의 호환 소프트웨어도 함께 읽습니다. 조회용 매니저가 SQLite 를 함께 열기 때문에 SQLite DB 를 열 수 없으면 이 scope 도 실패합니다. |
| `components` | SQLite 의 공통컴포넌트 메타데이터. `sourceFiles`, `readSource`, `ddl`, `dml` 은 소스 파일 트리를 함께 읽습니다. |
| `compatibility` | SQLite 의 호환 소프트웨어. `filters.includeKnowledge: true` 이면 개발자 지식 테이블도 함께 읽습니다. |
| `all` | 위의 네 가지 모두 |

`guide` 와 `knowledge` 의 의미 검색, `includeKnowledge` 는 임베딩 모델이 있어야 하고, 나머지 조회는 모델 없이 동작합니다. 노출 도구의 목록은 [EXPOSED_TOOLS.md](./EXPOSED_TOOLS.md)를 참고합니다.

## 인덱스 재구축

저장소와 배포 tgz 에는 구축된 `knowledge-base/` 가 들어 있으므로 인덱스를 따로 만들 필요가 없습니다. `templates/` 의 원본을 바꿨을 때만 저장소 클론에서 다시 만듭니다.

```bash
npm run build-index             # 대화형: 소스 모드(online, local, bundled)를 묻습니다
npm run build-index -- --yes    # 비대화형: 현재 체크아웃의 원본만 사용합니다 (네트워크 접근 없음)
```

터미널이 아닌 환경에서 `--yes` 없이 실행하면 빌드 계획만 출력하고 중단합니다. `build-index` 는 다음 원본에서 인덱스를 만듭니다. 그 밖의 옵션은 [README](../README.md)를 참고합니다.

| 인덱스 | 원본 |
|--------|------|
| 호환 소프트웨어 (SQLite) | `templates/compatibility/compatibility-software.json` |
| 공통컴포넌트 메타데이터 (SQLite) | `templates/common-components.json` |
| 개발자 지식 (LanceDB) | 릴리스 스냅샷(`manifest.json`, `snapshot.jsonl.gz`) 또는 `templates/developer_knowledge/` 의 xlsx 파일, 그리고 같은 디렉토리의 적용가이드 PDF |
| 공식 가이드 (LanceDB) | `templates/egovframe_guide/` (서브모듈) |

질문은 모두 시작 단계에서 끝나고, 그 뒤에는 `knowledge-base.staging/` 에 새 인덱스를 만든 다음 검증을 거쳐 `knowledge-base/` 와 한 번에 교체합니다. 직전 인덱스는 `knowledge-base.prev/` 에 하나 남습니다. 개발자 지식이나 공식 가이드의 원본이 없으면 그 리소스는 건너뛰고 기존 인덱스를 그대로 둡니다. 두 리소스를 다시 임베딩하므로 임베딩 모델(`models/`)이 필요하고 시간이 오래 걸립니다.

## 번들과 오버레이

패키지(저장소 또는 설치 위치) 안의 데이터를 번들이라고 하고, `update` 명령이 사용자 데이터 디렉토리에 저장한 갱신분을 오버레이라고 합니다. 서버는 리소스마다 다음 규칙으로 읽을 위치를 정합니다(`src/utils/dataPaths.ts`).

| 리소스 | 읽는 위치 |
|--------|-----------|
| 공식 가이드 테이블, 개발자 지식 테이블, 공통컴포넌트 소스 트리 | 오버레이에 유효한 갱신분이 있으면 오버레이, 없으면 번들 |
| SQLite DB | 오버레이에 유효한 사본이 있으면 오버레이, 없으면 번들. 호환 소프트웨어 갱신이 비활성화되어 있어 새 사본이 만들어지지 않으므로 보통 번들을 읽습니다. |
| 임베딩 모델 | 항상 번들 |

오버레이의 갱신분은 상태 파일의 구조 버전이 현재 패키지와 맞고 데이터가 실제로 있을 때만 유효하며, 벡터 테이블은 임베딩 모델도 같아야 합니다. 유효하지 않으면 오류 없이 번들을 읽습니다. 오버레이의 위치와 `update` 명령은 [MCP_SETUP_GUIDE.md](./MCP_SETUP_GUIDE.md#환경변수)와 [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md#지식베이스-갱신-update-명령)에서 다룹니다.

## 로컬 실행 특성

- 외부 임베딩 API 를 호출하지 않고 로컬 모델을 사용합니다. 모델의 원격 다운로드는 막혀 있으므로, `models/` 가 없으면 의미 검색이 `임베딩 모델을 찾을 수 없습니다` 로 시작하는 오류를 돌려줍니다.
- 데이터 경로는 실행 디렉토리가 아니라 패키지 위치를 기준으로 정해집니다.
- 서버는 SQLite 를 읽기 전용으로 열고, DB 파일이나 LanceDB 테이블이 없어도 새로 만들지 않습니다. 없을 때는 무엇이 없는지 알리는 오류를 돌려줍니다.
- `build-index` 는 항상 저장소의 `knowledge-base/` 에 인덱스를 만듭니다. 오버레이에 유효한 갱신분이 있는 리소스는 오버레이가 먼저 읽히므로, 번들을 다시 만들어도 그 리소스의 검색 결과는 바뀌지 않습니다.
- 인덱스를 다시 만들거나 `update` 를 실행한 뒤에는 MCP 서버를 다시 시작해야 반영됩니다.

## 관련 문서

- [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md)
- [EGOV_SEARCH_KNOWLEDGE_TOOL.md](./EGOV_SEARCH_KNOWLEDGE_TOOL.md)
- [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)
