# 테스트 가이드

테스트는 Node.js 22 에서 실행합니다. 저장소를 클론한 뒤의 준비 절차는 [MCP_SETUP_GUIDE.md](../setup/MCP_SETUP_GUIDE.md#저장소를-클론해서-실행)에 있습니다. 테스트 파일마다 무엇을 검증하는지는 [tests/](./tests/README.md)의 문서에 정리되어 있습니다.

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
npx tsc -p tsconfig.tests.json                    # 테스트 코드의 타입 검사 (파일을 만들지 않습니다)
```

`vitest.config.mjs` 는 `tests/**/*.test.ts` 만 수집하고, 테스트 파일을 하나씩 차례로 실행하며(`fileParallelism: false`), 테스트 하나의 제한 시간은 30초입니다. 통합 테스트 가운데 서버나 진입점을 실행하는 테스트는 `build/index.js` 를 쓰므로, `npm test` 가 아닌 명령으로 통합 테스트를 실행할 때는 먼저 `npm run build` 를 실행합니다. vitest 는 타입을 검사하지 않으므로 테스트 코드의 타입 오류는 `tsconfig.tests.json` 으로 따로 확인합니다. 이 검사는 npm 스크립트에 연결되어 있지 않습니다.

## 테스트 구성

통합 테스트(`tests/integration/`)는 빌드된 서버나 명령 전체를 실행해서 검증합니다. `_helper.ts` 는 서버를 stdio 로 띄워 연결하는 공용 도우미입니다. 도우미는 서버에 빈 임시 디렉토리를 `EGOV_MCP_DATA_DIR` 로 주므로, 개발자가 `update` 로 적용해 둔 갱신분이 테스트 결과에 영향을 주지 않습니다.

| 파일 | 검증 대상 |
|------|-----------|
| `server.test.ts` | 서버가 stdio 로 응답하는지, `tools/list` 가 `egov_search_knowledge` 하나만 노출하는지, 도구에 `description` 과 `inputSchema` 가 있는지, 최상위 파라미터 6개(`query`, `scope`, `action`, `filters`, `limit`, `strictScope`)가 있는지, 처리되지 않은 프라미스 거부가 나도 서버 프로세스가 종료되지 않는지 |
| `searchKnowledge.test.ts` | `egov_search_knowledge` 를 실제로 호출했을 때의 동작: `action` 처리와 scope 추론, 입력 검증, 가이드 검색과 결과의 형식, 청크 이어 읽기(`filters.chunkId`), 공통컴포넌트와 호환 소프트웨어 조회, 적용되지 않은 필터와 쓰이지 않은 입력의 안내, 개발자 지식과 통합 검색, 공개 스키마, 조회가 지식베이스 파일을 바꾸지 않는지 |
| `helperIsolation.test.ts` | 사용자 데이터 디렉토리에 갱신분이 있어도 테스트 서버가 동봉 지식베이스를 읽는지 |
| `dispatcher.test.ts` | 진입점의 `--version`, `--help`, 알 수 없는 명령 처리와 stdout 에 아무것도 쓰지 않는지 |
| `ensureTemplateSources.test.ts` | `build-index` 가 가이드와 공통컴포넌트 소스를 확보하는 과정과 소스의 버전 표기를 읽는 규칙. 임시 디렉토리의 로컬 git 저장소를 쓰며 네트워크에 접근하지 않습니다. |
| `updateKnowledge.test.ts` | `update --from-file` 의 개발자 지식 증분 갱신과 롤백. 임시 사용자 데이터 디렉토리를 씁니다. |
| `updateSqliteResources.test.ts` | `update` 의 호환 소프트웨어 갱신. 이 기능이 비활성화되어 있어 `describe.skip` 으로 건너뜁니다. |

단위 테스트(`tests/unit/`)는 `src/` 의 모듈을 직접 불러서 검증합니다. 이름이 `_` 로 시작하는 파일은 테스트가 함께 쓰는 고정 데이터와 도우미입니다.

| 영역 | 파일 | 검증 대상 |
|------|------|-----------|
| 공통컴포넌트 | `component*.test.ts` | SQLite 조회와 도구 함수, ID 를 고유하게 만드는 규칙, 사용 테이블 목록을 소스 트리에서 도출하는 규칙, 소스 파일 목록과 읽기, DDL 과 DML 추출, `dbType` 검증, 소스가 없을 때와 파일 시스템 오류의 처리, FTS 테이블 동기화 |
| 호환 소프트웨어 | `compatibility*.test.ts`, `vendorName`, `frameworkVersion`, `productMention` | SQLite 조회, 검색 도구, 동봉 데이터에서의 관련 지식(`includeKnowledge`), FTS 테이블 동기화, 업체명과 프레임워크 버전 표기의 정규화, 글이 제품명을 언급하는지의 판정 |
| 키워드 검색과 SQLite | `keywordSearch`, `bundledKeywordSearch`, `fts5Query`, `sqlLike`, `sqliteReadonly`, `sqliteLoaders` | 검색어 추출, 부분 문자열 일치와 정렬, 동봉 데이터에서의 검색 결과, LIKE 이스케이프, 읽기 전용 열기, JSON 적재 |
| 공식 가이드 | `guide*.test.ts` | 문서 청킹과 긴 절을 조각으로 나누는 규칙, 가이드 원문 전체의 청킹, 프론트매터 파싱, `layer` 와 `category` 필터, 한 절의 조각 목록, 검색 응답의 조각 안내와 청크 이어 읽기 |
| 개발자 지식 | `knowledge*.test.ts`, `pdfKnowledge*.test.ts`, `sensitiveText` | 검색 필터, 최근 목록, 본문 발췌, id 기준 조회, 검색 도구, 응답에 싣는 제목과 발췌, 적용가이드 PDF 를 청크로 나누는 규칙, 주민등록번호 형식의 가림 |
| 벡터 검색 공통 | `vectorSearch*.test.ts`, `lance*.test.ts`, `embedder` | 전수 검색, `limit` 방어, 유사도 점수, where 절 조립, 열기 전용 초기화, 임베더와 모델 로드 실패의 처리 |
| 조회용 매니저와 서버 구성 | `hybrid*.test.ts`, `serverImportGraph`, `projectPath` | SQLite 를 필요할 때 여는지, `knowledgeScope: "all"` 의 호환 소프트웨어 결과, 서버가 인덱스 구축과 갱신용 모듈을 불러오지 않는지, 패키지 위치 탐색 |
| 갱신과 인덱스 구축 지원 | `dataPaths`, `sources`, `download`, `tarSafe`, `snapshot`, `templateSources`, `updateArgs` | 오버레이 경로 해석, 원격 소스 주소, 다운로드와 tar 해제의 방어, 스냅샷 형식과 xlsx 에서의 합성, 소스 확보, `update` 인자 해석 |
| 공용 유틸 | `errors`, `text` | 오류 문구 변환, 문자열 처리 |

## 건너뛰는 테스트

준비되지 않은 자원에 의존하는 테스트는 실패하지 않고 건너뜁니다. 결과 요약의 `skipped` 수가 평소와 다르면 아래 자원을 확인합니다.

| 없는 자원 | 건너뛰는 테스트 | 준비 방법 |
|-----------|-----------------|-----------|
| 임베딩 모델 (`models/`) | 실제 모델로 임베딩하는 테스트(의미 검색, 임시 디렉토리에 색인하는 테스트), 실제 토큰 수를 세는 테스트, `updateKnowledge.test.ts` | `npm run fetch-model` |
| 공통컴포넌트 소스 (`templates/common-components-src`) | 실제 소스 파일, DDL, DML 내용을 읽는 테스트, 사용 테이블 목록을 실제 소스 트리에서 도출하는 테스트 | `git submodule update --init templates/common-components-src` |
| 가이드 원문 (`templates/egovframe_guide`) | 가이드 원문 전체의 프론트매터와 청킹을 검사하는 테스트 | `git submodule update --init templates/egovframe_guide` |

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

구축된 지식베이스(`knowledge-base/`)가 저장소에 들어 있으므로, 검색 동작을 확인하려고 인덱스를 새로 만들 필요는 없습니다. 테스트와 서버는 이 파일들을 읽기만 하며 바꾸지 않습니다. `npm run build-index` 는 인덱스의 원본이나 색인 규칙을 바꿨을 때만 실행하며, 방법은 [KNOWLEDGE_BASE_GUIDE.md](../operations/KNOWLEDGE_BASE_GUIDE.md#지식베이스-구축-build-index)에 있습니다. 동봉 인덱스의 내용에 기대는 테스트가 있으므로, 인덱스를 다시 구축한 뒤에는 `npm test` 를 다시 실행해 확인합니다.

## 테스트 정비 원칙

새 테스트를 추가하거나 기존 테스트를 정리할 때는 MCP 클라이언트에 실제 노출되는 도구를 기준으로 작성합니다.

- 도구의 호출 동작은 통합 테스트에서 `egov_search_knowledge` 를 호출해서 검증하고, 내부 모듈의 규칙은 단위 테스트로 검증합니다.
- 새 기능에는 단위 테스트와 통합 테스트를 함께 추가합니다.
- 지식베이스를 바꾸는 동작(`update` 명령, 인덱스 구축)은 MCP 도구가 아니므로 도구 호출로 테스트하지 않습니다. 임시 디렉토리를 대상으로 따로 검증하고, 저장소의 `knowledge-base/` 와 `templates/` 는 건드리지 않습니다.
- 자원이 없을 때 건너뛰어야 하는 테스트는 `tests/integration/_helper.ts` 의 `hasEmbeddingModel()`, `hasComponentSources()` 같은 확인 함수로 조건을 겁니다.
