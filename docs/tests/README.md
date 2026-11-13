# `tests/` 디렉터리 문서 인덱스

`tests/` 아래 테스트 파일의 의도와 케이스를 사람이 빨리 읽을 수 있도록 정리한 문서 모음입니다. 통합 테스트(`tests/integration`)는 테스트 파일마다 문서를 하나씩 두고, 단위 테스트(`tests/unit`)는 이 문서의 표로 정리합니다.

통합 테스트 문서는 다음 여섯 항목으로 구성합니다. 헬퍼 문서([_helper.md](./_helper.md))는 테스트가 아닌 파일을 설명하므로 구성이 다릅니다.

1. 이 테스트가 검증하는 것
2. 파일 구조와 헬퍼
3. 케이스 상세
4. 실행 방법
5. 의존성과 전제 조건
6. 흔한 실패와 진단

## 디렉터리와 매핑

### 통합 테스트 (`tests/integration`)

| 파일 | 검증하는 것 | 문서 |
|---|---|---|
| `_helper.ts` | 통합 테스트 공용 헬퍼 (테스트 파일이 아님) | [_helper.md](./_helper.md) |
| `server.test.ts` | 서버가 stdio 로 응답하는지와 노출 도구 목록 | [server.test.md](./server.test.md) |
| `searchKnowledge.test.ts` | `egov_search_knowledge` 호출의 응답: `action` 처리, `scope` 추론, 입력 검증, 출처별 조회, 공개 스키마 | [searchKnowledge.test.md](./searchKnowledge.test.md) |
| `dispatcher.test.ts` | 진입점(`build/index.js`)의 인자 처리: `--version`, `--help`, 알 수 없는 명령 | [dispatcher.test.md](./dispatcher.test.md) |
| `ensureTemplateSources.test.ts` | `build-index` 가 쓰는 템플릿 소스 확보와 버전 태그 선택 | [ensureTemplateSources.test.md](./ensureTemplateSources.test.md) |
| `updateKnowledge.test.ts` | update CLI 의 개발자 지식 증분 갱신과 롤백 | [updateKnowledge.test.md](./updateKnowledge.test.md) |
| `updateSqliteResources.test.ts` | update CLI 의 호환 소프트웨어(SQLite) 갱신. 기능이 비활성화된 동안 `describe.skip` 으로 건너뜀 | [updateSqliteResources.test.md](./updateSqliteResources.test.md) |

### 단위 테스트 (`tests/unit`)

단위 테스트는 `src/` 의 모듈을 직접 import 해서 검증합니다. 파일마다 문서를 두지 않고 아래 표에 주제별로 정리합니다. 케이스 목록은 각 파일의 머리 주석과 `describe`, `it` 이름에서 확인합니다.

**공통컴포넌트**

| 파일 | 검증하는 것 |
|---|---|
| `componentQuery.test.ts` | `SQLiteManager` 의 공통컴포넌트 조회(`queryComponents`): 부분 일치 대체 검색, 필터, 정렬, `limit` 과 전체 건수, 한 건 조회(`findComponent`), 의존성 해결(`resolveDependencies`) |
| `componentTools.test.ts` | 공통컴포넌트 도구(`src/tools/commonComponents.ts`)의 메타데이터 조회와 결과 포맷(표의 칸, 카테고리 목록, 의존성 해결 결과, 컴포넌트 목록) |
| `componentIds.test.ts` | 메타(`templates/common-components.json`)에서 겹치는 `id` 를 고유하게 만드는 규칙(`assignUniqueComponentIds`) |
| `componentsFts.test.ts` | FTS 인덱스 `components_fts` 에 갱신 전의 토큰이 남지 않는지와 `rebuildComponentsFts()` 의 복구 |
| `componentSourceFiles.test.ts` | 소스 파일 목록(`collectComponentSourceFiles`)에서 Spring 설정 파일을 컴포넌트에 귀속시키는 규칙 |
| `componentSourceRead.test.ts` | 소스 파일 읽기(`readSourceFileInRoot`): 소스 루트 밖과 `.git` 차단, 바이너리 판정, 큰 파일 나눠 읽기, EUC-KR 텍스트 |
| `componentDdl.test.ts` | DDL 추출(`extractTableDDLs`)과 포맷: 한 줄짜리 문, 뷰, 찾지 못한 객체, 동봉 스크립트(8개 DB 타입) 회귀 |
| `componentDml.test.ts` | DML 추출(`extractTableDMLs`)과 포맷: 테이블별 미리보기, `table` 지정 구간 조회, 동봉 스크립트(8개 DB 타입) |
| `componentDbType.test.ts` | `ddl`, `dml` 의 `dbType` 검증(`normalizeDbType`)과 지원하지 않는 값의 오류 |
| `componentFileWrappers.test.ts` | 파일 기능의 공개 함수(`getComponentSourceFiles`, `readComponentSource`, `getComponentDDL`, `getComponentDML`). 임시 DB 와 임시 소스 트리 사용 |
| `componentFsErrors.test.ts` | 파일 시스템 오류 처리: 권한 거부 오류에 절대 경로가 실리지 않는지, 없는 대상을 "찾을 수 없음"으로 처리하는지 |
| `componentSourcesMissing.test.ts` | 공통컴포넌트 소스가 설치되지 않았을 때 `sourceFiles`, `readSource`, `ddl`, `dml` 이 설치 방법을 담은 오류로 알리는지 |

**호환 소프트웨어**

| 파일 | 검증하는 것 |
|---|---|
| `compatibilityQuery.test.ts` | `SQLiteManager` 의 호환 소프트웨어 조회(`queryCompatibleSoftware`): 부분 일치 대체 검색, 필터, 전체 건수와 구간 조회, 확인일자 순 정렬, 결과 행의 컬럼 |
| `compatibilityTool.test.ts` | 호환 소프트웨어 검색 도구(`src/tools/compatibility.ts`): `matchMode`, 필터 값 다듬기, `frameworkVersion` 정규화, 결과가 없을 때의 `available` 안내, `includeKnowledge` |
| `compatibilityFts.test.ts` | FTS 인덱스 `compatibility_fts` 에 갱신과 삭제 전의 토큰이 남지 않는지와 `rebuildCompatibilityFts()` 의 복구 |

**키워드 검색과 SQLite 공통**

| 파일 | 검증하는 것 |
|---|---|
| `fts5Query.test.ts` | 검색어 추출(`extractSearchTerms`)과 FTS5 `MATCH` 식 조립(`buildFts5MatchQuery`) |
| `keywordSearch.test.ts` | `SQLiteManager` 키워드 검색(`components`, `compatibility`): 복합어의 앞부분, 문장부호, 버전 번호 입력 |
| `sqlLike.test.ts` | `LIKE` 와일드카드 이스케이프(`escapeLikePattern`)와 실제 조회에서의 리터럴 일치 |
| `sqliteReadonly.test.ts` | `SQLiteManager` 읽기 전용 모드: 조회로 DB 파일이 바뀌지 않는지, 없는 DB 파일을 만들지 않는지 |
| `sqliteLoaders.test.ts` | SQLite 적재 공용 로직(`src/kb/sqliteLoaders.ts`): 호환 소프트웨어 JSON 과 공통컴포넌트 JSON 의 검증, 적재, 재적재 |

**공식 가이드**

| 파일 | 검증하는 것 |
|---|---|
| `guideChunking.test.ts` | 공식 가이드 문서 청킹(`chunkMarkdown`)과 색인 대상 판정(`src/kb/guideIndexer.ts`): 경로에서 `layer`, `category` 를 구하는 규칙, draft 문서 제외 |
| `guideFrontMatter.test.ts` | 공식 가이드 문서의 Hugo 프론트매터 파싱(`parseFrontMatter`) |
| `guideFilter.test.ts` | 공식 가이드 검색의 `layer`, `category` 필터: 저장된 값에 대응시키기, 없는 값 거부, where 절에서의 리터럴 처리 |

**개발자 지식**

| 파일 | 검증하는 것 |
|---|---|
| `knowledgeTool.test.ts` | 개발자 지식 도구(`src/tools/knowledge.ts`): 의미 검색 결과의 필드, 본문 발췌 길이, 최근 목록의 필터, 호환 제품을 함께 찾는 검색(`filters.knowledgeScope` 가 `all` 일 때의 경로), 응답에 되돌려 주는 `query` 의 길이 제한, `query` 필수 여부 |
| `knowledgeFilter.test.ts` | 개발자 지식 검색의 필터 조립(`buildKnowledgeFilter`): `type` 검증, `tags` 필터, 값의 리터럴 처리 |
| `knowledgeRecent.test.ts` | 최근 지식 목록(`listRecentKnowledge`)의 필터와 읽는 컬럼 |
| `knowledgeById.test.ts` | `id` 기준 조회, 갱신, 삭제에서 `id` 가 리터럴로만 쓰이는지 |
| `knowledgeExcerpt.test.ts` | 본문 발췌(`excerptKnowledgeContent`): 줄인 본문에 답변의 앞부분이 남는지 |

**벡터 검색과 LanceDB 공통**

| 파일 | 검증하는 것 |
|---|---|
| `embedder.test.ts` | 로컬 임베더(`src/rag/embedder.ts`): 모델 로드 실패 안내, 입력 길이 제한(`truncateEmbedInput`) |
| `lanceFilter.test.ts` | LanceDB where 절 조립 도우미(`src/utils/lanceFilter.ts`): 문자열 값의 리터럴 처리, `clampSearchLimit` |
| `lanceOpenOnly.test.ts` | LanceDB 매니저의 열기 전용 초기화: 없는 테이블을 만들지 않고 안내 오류를 던지는지 |
| `vectorSearchExhaustive.test.ts` | 공식 가이드와 개발자 지식의 벡터 검색이 전수 검색으로 동작하는지 |
| `vectorSearchLimit.test.ts` | 벡터 검색과 최근 목록의 `limit` 방어(음수, 0, 소수, 아주 큰 값) |
| `vectorSearchScore.test.ts` | 벡터 검색 결과의 `score` 가 코사인 거리인지 |

**지식베이스 구축과 갱신**

| 파일 | 검증하는 것 |
|---|---|
| `dataPaths.test.ts` | 오버레이 경로 해석(`src/utils/dataPaths.ts`): 오버레이 유효성 판정과 번들 폴백, SQLite 오버레이 규칙 |
| `snapshot.test.ts` | 개발자 지식 스냅샷 형식(`src/kb/snapshot.ts`): 직렬화, 버전 비교, 스냅샷 비교(`diffSnapshots`), xlsx 변환 |
| `sources.test.ts` | 원격 소스 정의(`src/kb/sources.ts`): 버전 태그 비교와 추출, URL 조립. 네트워크를 쓰지 않음 |
| `download.test.ts` | 다운로드 유틸(`src/utils/download.ts`): 로컬 HTTP 서버로 크기 상한과 부분 파일 정리를 확인 |
| `tarSafe.test.ts` | tar.gz 해제(`extractTarGz`)의 방어: 경로 탈출, 절대 경로, 심볼릭 링크, 해제 총량과 엔트리 수 상한 |
| `templateSources.test.ts` | 템플릿 소스 갱신 전략 결정(`resolveSourceStrategy`), 버전 태그 선별(`filterVersionTags`), 태그 선택 입력 처리(`runTagSelectionPrompt`) |
| `updateArgs.test.ts` | update CLI 인자 파서(`parseUpdateArgs`)와 `sanitizeVersionDirName` |

**공통 유틸과 오류 처리**

| 파일 | 검증하는 것 |
|---|---|
| `errors.test.ts` | 도구 오류 문구 변환(`toUserMessage`): 내부 오류의 절대 경로와 SQL 이 응답에 실리지 않는지 |
| `text.test.ts` | 문자열 유틸 `sliceHead` |

**고정 데이터와 도우미**

이름이 `_` 로 시작하는 파일은 테스트가 함께 쓰는 고정 데이터와 도우미입니다. vitest 는 `*.test.ts` 만 실행하므로 이 파일들은 테스트로 실행되지 않습니다.

| 파일 | 내용 |
|---|---|
| `_compatibilityFixture.ts` | 호환 소프트웨어 조회 테스트가 함께 쓰는 고정 데이터 |
| `_componentFixture.ts` | 공통컴포넌트 조회 테스트가 함께 쓰는 고정 데이터 |
| `_knowledgeTableFixture.ts` | 임시 디렉터리에 개발자 지식 테이블(`developer_knowledge`)을 만드는 도우미 |
| `_lanceFixtures.ts` | 동봉 LanceDB 테이블을 읽기 전용으로 여는 도우미와, 질의 임베딩을 저장된 벡터로 대신하는 도우미 |
| `_sqlStatements.ts` | `SQLiteManager` 가 실행한 조회 문의 `ORDER BY` 절을 확인하는 도우미 |

## 한눈에 보는 테스트 구성

| 구분 | 테스트 파일 | 실행 방식 | `build/` |
|---|---|---|---|
| 단위 | `tests/unit/*.test.ts` | `src/` 의 모듈을 직접 import | 필요 없음 |
| 통합 (서버 프로세스 실행) | `server.test.ts`, `searchKnowledge.test.ts`, `dispatcher.test.ts` | `build/index.js` 를 자식 프로세스로 실행 | 필요 |
| 통합 (함수 직접 호출) | `ensureTemplateSources.test.ts`, `updateKnowledge.test.ts`, `updateSqliteResources.test.ts` | `src/` 의 함수를 임시 디렉터리에서 실행 | 필요 없음 |

- vitest 는 `tests/**/*.test.ts` 를 실행 대상으로 삼고(`vitest.config.mjs` 의 `include`), 테스트 파일을 하나씩 차례로 실행합니다(`fileParallelism: false`). 테스트 하나의 제한 시간은 30초입니다(`testTimeout`).
- `npm test` 는 `npm run build` 로 `build/` 를 새로 만든 뒤 `vitest run` 으로 단위 테스트와 통합 테스트를 모두 실행합니다.
- `npx vitest run` 은 빌드를 하지 않습니다. `src/` 를 고친 뒤 서버 프로세스를 실행하는 통합 테스트를 다시 돌릴 때는 `npm run build` 를 먼저 실행하거나 `npm test` 를 씁니다.
- 테스트는 `.nvmrc` 에 적힌 Node.js 22 로 실행합니다. `server.test.ts` 와 `searchKnowledge.test.ts` 는 `PATH` 에서 찾은 `node` 로 서버를 실행하므로 셸의 Node 버전도 같아야 합니다.
- 예전의 수동 스크립트 `tests/test-*.mjs` 는 제거된 도구 이름을 호출하고 있어서 삭제되었습니다. `tests/` 에는 vitest 가 실행하는 `*.test.ts` 와 그 도우미 파일만 있습니다.

### 건너뛰는 조건

필요한 파일이 없으면 해당 테스트는 실패하지 않고 건너뜁니다. vitest 출력에는 `skipped` 로 표시됩니다.

| 조건 | 건너뛰는 테스트 |
|---|---|
| 임베딩 모델(`models/Xenova/multilingual-e5-small/onnx/model_quantized.onnx`)이 없음 | 의미 검색이 필요한 케이스: `searchKnowledge.test.ts` 의 일부, `updateKnowledge.test.ts` 전체, 단위 테스트 `embedder`, `guideChunking`, `knowledgeFilter`, `vectorSearchExhaustive`, `vectorSearchScore` 의 일부 |
| 공통컴포넌트 소스(`templates/common-components-src/pom.xml`)가 없음 | 소스 파일, DDL, DML 내용이 필요한 케이스: `searchKnowledge.test.ts` 의 일부, 단위 테스트 `componentDdl`, `componentDml`, `componentSourceFiles`, `componentSourceRead` 가운데 동봉 소스 트리를 읽는 묶음 |
| 공식 가이드 원문(`templates/egovframe_guide`)이 없음 | `guideFrontMatter.test.ts` 가운데 공식 가이드 원문 전체를 읽는 묶음 |
| 동봉 LanceDB 테이블(`knowledge-base/egovframe_guide.lance`, `knowledge-base/developer_knowledge.lance`)이 없음 | 동봉 테이블을 읽는 단위 테스트 묶음 |
| `describe.skip` | `updateSqliteResources.test.ts` 전체 (호환 소프트웨어 갱신 기능이 비활성화된 동안) |
| Windows 이거나 root 계정으로 실행 | 파일 권한을 막아서 확인하는 케이스 (`componentFsErrors.test.ts`, `sqliteReadonly.test.ts` 의 일부) |

임베딩 모델은 `npm run fetch-model` 로 받고, 공통컴포넌트 소스와 공식 가이드 원문은 `git submodule update --init` 로 받습니다.

### 지식베이스 파일 보존

테스트는 저장소의 지식베이스 파일(`knowledge-base/`)을 바꾸지 않습니다. 서버는 `knowledge-base/egovframe.db` 를 읽기 전용으로 열고, 쓰기가 필요한 테스트는 임시 디렉터리나 메모리에 새로 만든 DB 와 테이블을 씁니다. `searchKnowledge.test.ts` 의 마지막 케이스가 조회 전후의 `knowledge-base/egovframe.db` 해시를 비교해서 이 성질을 확인합니다. 건너뛰고 있는 `updateSqliteResources.test.ts` 는 예외입니다. 지금 내용 그대로 되살리면 `knowledge-base/` 의 파일을 쓰므로, 되살리기 전에 [해당 문서](./updateSqliteResources.test.md)의 주의 사항을 읽습니다.

## 자주 쓰는 실행 명령

| 목적 | 명령 |
|---|---|
| 전체 (빌드, 단위, 통합) | `npm test` |
| 단위 테스트만 (빌드 불필요) | `npx vitest run tests/unit` |
| 통합 테스트만 (이미 빌드된 상태) | `npx vitest run tests/integration` |
| 특정 파일 | `npx vitest run tests/integration/server.test.ts` |
| 이름으로 고르기 | `npx vitest run tests/integration/searchKnowledge.test.ts -t "scope 추론"` |
| 워치 모드 (빌드하지 않음) | `npm run test:watch` |

`-t` 에는 `describe` 나 `it` 이름의 일부를 줍니다.

## 문서를 어떻게 갱신하는가

- 통합 테스트 파일을 추가하면 같은 이름의 `.md` 를 여섯 항목 형식으로 만들고 위의 통합 테스트 표에 행을 추가합니다. 케이스를 추가하거나 이름을 바꾸면 해당 문서의 케이스 상세를 함께 고칩니다.
- 단위 테스트 파일을 추가하거나 지우면 위의 단위 테스트 표에서 해당 주제의 행을 고칩니다. 단위 테스트는 파일별 문서를 만들지 않습니다.
- `tests/integration/_helper.ts` 의 export 를 바꾸면 [_helper.md](./_helper.md)의 표를 고칩니다.
- 테스트 건수와 실행 시간처럼 자주 바뀌는 값은 문서에 적지 않습니다.
- 코드와 문서가 어긋나면 코드를 기준으로 삼습니다. 문서는 테스트의 의도와 그 테스트를 둔 이유를 사람이 읽을 수 있게 남기는 용도입니다.
