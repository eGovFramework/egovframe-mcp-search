# 테스트 가이드

테스트는 Node.js 22 에서 실행합니다. 저장소를 클론한 뒤의 준비 절차는 [MCP_SETUP_GUIDE.md](./MCP_SETUP_GUIDE.md#저장소를-클론한-경우)에 있습니다.

## 기본 확인

```bash
npm run build
```

`build/` 를 지우고 TypeScript 를 다시 컴파일한 뒤 `build/index.js` 에 실행 권한을 줍니다.

## 자동화 테스트

```bash
npm test                                          # 빌드한 뒤 vitest 로 tests/**/*.test.ts 전체를 실행합니다
npm run test:watch                                # vitest 의 watch 모드 (빌드는 하지 않습니다)
npx vitest run tests/unit                         # 단위 테스트만
npx vitest run tests/integration/server.test.ts   # 파일 하나만
```

`vitest.config.mjs` 는 `tests/**/*.test.ts` 만 수집하고, 테스트 파일을 하나씩 차례로 실행하며(`fileParallelism: false`), 테스트 하나의 제한 시간은 30초입니다. 통합 테스트 가운데 서버나 진입점을 실행하는 테스트는 `build/index.js` 를 쓰므로, `npm test` 가 아닌 명령으로 통합 테스트를 실행할 때는 먼저 `npm run build` 를 실행합니다.

## 테스트 구성

통합 테스트(`tests/integration/`)는 빌드된 서버나 명령 전체를 실행해서 검증합니다. `_helper.ts` 는 서버를 stdio 로 띄워 연결하는 공용 도우미입니다.

| 파일 | 검증 대상 |
|------|-----------|
| `server.test.ts` | 서버가 stdio 로 응답하는지, `tools/list` 가 `egov_search_knowledge` 하나만 노출하는지, 도구에 `description` 과 `inputSchema` 가 있는지, 최상위 파라미터 6개(`query`, `scope`, `action`, `filters`, `limit`, `strictScope`)가 있는지 |
| `searchKnowledge.test.ts` | `egov_search_knowledge` 를 실제로 호출했을 때의 동작: `action` 처리와 scope 추론, 입력 검증, 가이드 검색, 공통컴포넌트와 호환 소프트웨어 조회, 적용되지 않은 필터 안내, 개발자 지식과 통합 검색, 공개 스키마, 조회가 지식베이스 파일을 바꾸지 않는지 |
| `dispatcher.test.ts` | 진입점의 `--version`, `--help`, 알 수 없는 명령 처리와 stdout 에 아무것도 쓰지 않는지 |
| `ensureTemplateSources.test.ts` | `build-index` 가 가이드와 공통컴포넌트 소스를 확보하는 과정. 임시 디렉토리의 로컬 git 저장소를 쓰며 네트워크에 접근하지 않습니다. |
| `updateKnowledge.test.ts` | `update --from-file` 의 개발자 지식 증분 갱신과 롤백. 임시 사용자 데이터 디렉토리를 씁니다. |
| `updateSqliteResources.test.ts` | `update` 의 호환 소프트웨어 갱신. 이 기능이 비활성화되어 있어 `describe.skip` 으로 건너뜁니다. |

단위 테스트(`tests/unit/`)는 `src/` 의 모듈을 직접 불러서 검증합니다. 이름이 `_` 로 시작하는 파일은 테스트가 함께 쓰는 고정 데이터와 도우미입니다.

| 영역 | 파일 | 검증 대상 |
|------|------|-----------|
| 공통컴포넌트 | `component*.test.ts` | SQLite 조회와 도구 함수, ID 를 고유하게 만드는 규칙, 소스 파일 목록과 읽기, DDL 과 DML 추출, `dbType` 검증, 소스가 없을 때와 파일 시스템 오류의 처리, FTS 인덱스 동기화 |
| 호환 소프트웨어 | `compatibility*.test.ts` | SQLite 조회, 검색 도구, FTS 인덱스 동기화 |
| 키워드 검색과 SQLite | `keywordSearch`, `fts5Query`, `sqlLike`, `sqliteReadonly`, `sqliteLoaders` | 검색어 추출과 FTS5 식 조립, LIKE 이스케이프, 읽기 전용 열기, JSON 적재 |
| 공식 가이드 | `guide*.test.ts` | 문서 청킹, 프론트매터 파싱, `layer` 와 `category` 필터 |
| 개발자 지식 | `knowledge*.test.ts` | 검색 필터, 최근 목록, 본문 발췌, id 기준 조회, 검색 도구 |
| 벡터 검색 공통 | `vectorSearch*.test.ts`, `lance*.test.ts`, `embedder` | 전수 검색, `limit` 방어, 유사도 점수, where 절 조립, 열기 전용 초기화, 임베더 |
| 갱신과 인덱스 구축 지원 | `dataPaths`, `sources`, `download`, `tarSafe`, `snapshot`, `templateSources`, `updateArgs` | 오버레이 경로 해석, 원격 소스 주소, 다운로드와 tar 해제의 방어, 스냅샷 형식, 소스 확보, `update` 인자 해석 |
| 공용 유틸 | `errors`, `text` | 오류 문구 변환, 문자열 처리 |

## 건너뛰는 테스트

준비되지 않은 자원에 의존하는 테스트는 실패하지 않고 건너뜁니다. 결과 요약의 `skipped` 수가 평소와 다르면 아래 자원을 확인합니다.

| 없는 자원 | 건너뛰는 테스트 | 준비 방법 |
|-----------|-----------------|-----------|
| 임베딩 모델 (`models/`) | 의미 검색을 실행하는 테스트, `updateKnowledge.test.ts` | `npm run fetch-model` |
| 공통컴포넌트 소스 (`templates/common-components-src`) | 실제 소스 파일, DDL, DML 내용을 읽는 테스트 | `git submodule update --init templates/common-components-src` |
| 가이드 원문 (`templates/egovframe_guide`) | 가이드 원문 전체의 프론트매터를 검사하는 테스트 | `git submodule update --init templates/egovframe_guide` |

`updateSqliteResources.test.ts` 는 자원과 관계없이 항상 건너뛰므로, 세 자원을 모두 준비하면 이 파일의 테스트만 `skipped` 로 남습니다. 다만 파일 권한을 바꿔 보는 일부 테스트는 Windows 와 root 계정에서 건너뜁니다.

## MCP 서버 수동 확인

```bash
npm run inspector
```

`npx` 로 MCP Inspector 를 받아 `build/index.js` 에 연결합니다. Inspector 에서 도구 목록이 **`egov_search_knowledge` 하나**인지 확인하고, scope 별로 호출해 봅니다.

| Tool | 확인 포인트 |
|------|-------------|
| `egov_search_knowledge` | 입력 스키마, `scope`, `action`, `filters` 에 따른 동작 |

## 지식베이스 준비

구축된 지식베이스(`knowledge-base/`)가 저장소에 들어 있으므로, 검색 동작을 확인하려고 인덱스를 새로 만들 필요는 없습니다. 테스트와 서버는 이 파일들을 읽기만 하며 바꾸지 않습니다. `npm run build-index` 는 인덱스의 원본을 바꿨을 때만 실행하며, 방법은 [HYBRID_SYSTEM_GUIDE.md](./HYBRID_SYSTEM_GUIDE.md#인덱스-재구축)에 있습니다.

## 테스트 정비 원칙

새 테스트를 추가하거나 기존 테스트를 정리할 때는 MCP 클라이언트에 실제 노출되는 도구를 기준으로 작성합니다.

- 도구의 호출 동작은 통합 테스트에서 `egov_search_knowledge` 를 호출해서 검증하고, 내부 모듈의 규칙은 단위 테스트로 검증합니다.
- 새 기능에는 단위 테스트와 통합 테스트를 함께 추가합니다.
- 지식베이스를 바꾸는 동작(`update` 명령, 인덱스 구축)은 MCP 도구가 아니므로 도구 호출로 테스트하지 않습니다. 임시 디렉토리를 대상으로 따로 검증하고, 저장소의 `knowledge-base/` 와 `templates/` 는 건드리지 않습니다.
- 자원이 없을 때 건너뛰어야 하는 테스트는 `tests/integration/_helper.ts` 의 `hasEmbeddingModel()`, `hasComponentSources()` 같은 확인 함수로 조건을 겁니다.
