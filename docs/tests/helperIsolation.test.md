# `helperIsolation.test.ts`

통합 테스트 헬퍼([_helper.md](./_helper.md))가 실행한 서버가 개발자의 사용자 데이터 디렉터리(오버레이)를 읽지 않는지 검증하는 통합 테스트입니다.

> - 위치: `tests/integration/helperIsolation.test.ts`
> - 실행: `npm test` 또는 `npx vitest run tests/integration/helperIsolation.test.ts`
> - 분류: 통합 테스트. 헬퍼의 `createMcpClient()` 로 서버를 자식 프로세스로 실행함

## 1. 이 테스트가 검증하는 것

서버는 사용자 데이터 디렉터리에 update CLI 로 적용한 갱신분이 있으면 저장소에 동봉된 지식베이스 대신 그것을 읽습니다. 테스트가 실행한 서버가 개발자의 실제 갱신분을 읽으면, 저장소가 그대로여도 개발자마다 테스트 결과가 달라집니다.

헬퍼는 서버에 빈 임시 디렉터리를 `EGOV_MCP_DATA_DIR` 로 넘겨서 이 문제를 막습니다. 이 파일은 그 격리가 실제로 동작하는지를 확인합니다. 홈 디렉터리 아래의 기본 오버레이 위치에 테스트용 갱신분을 만들어 두고, 헬퍼로 실행한 서버가 그 갱신분이 아니라 동봉된 공통컴포넌트 소스를 읽는지 봅니다.

## 2. 파일 구조와 헬퍼

`describe` 는 `integration — 테스트 서버의 격리` 하나이고 케이스도 하나입니다. 헬퍼에서 `createMcpClient()` 와 `callSearchKnowledge()` 를 가져오고, `src/utils/dataPaths.ts` 에서 `SCHEMA_VERSION` 을 가져옵니다.

| 도우미와 정리 | 하는 일 |
|---|---|
| `overlayRootUnder(home)` | 홈 디렉터리가 `home` 일 때 서버가 쓰는 오버레이 위치를 계산함. `src/utils/dataPaths.ts` 의 `getOverlayRoot()` 와 같은 규칙으로, macOS 는 `Library/Application Support/egovframe-mcp-search`, Windows 는 `AppData/Local/egovframe-mcp-search`, 그 밖에는 `.local/share/egovframe-mcp-search` 임 |
| `afterEach` | 케이스가 바꾼 환경 변수(`HOME`, `USERPROFILE`, `XDG_DATA_HOME`, `LOCALAPPDATA`)를 원래 값으로 되돌리고, 임시 홈 디렉터리를 지움 |

테스트 프로세스에서 환경 변수를 바꾸는 이유는 헬퍼가 실행하는 서버가 그 값을 물려받기 때문입니다. Client SDK 는 `HOME`(Windows 에서는 `USERPROFILE`, `LOCALAPPDATA`)을 서버 프로세스에 넘깁니다.

## 3. 케이스 상세

| 케이스 | 준비와 호출 | 확인하는 것 |
|---|---|---|
| `개발자 홈의 오버레이에 갱신분이 있어도 테스트 서버는 동봉 지식베이스를 읽는다` | 임시 디렉터리(`os.tmpdir()` 아래의 `egov-fake-home-*`)를 홈 디렉터리로 지정합니다. 그 아래의 오버레이 위치에 테스트용 공통컴포넌트 소스 갱신분을 만듭니다. `resources/common_components/v-fake/` 에 `pom.xml` 과 `ONLY_IN_OVERLAY.txt` 를 두고, `state.json` 에 `common_components` 의 버전 `v-fake` 와 그 디렉터리를 기록합니다. 그다음 `createMcpClient()` 로 서버를 실행해 `scope: "components"`, `action: "readSource"`, `filters: { filePath: "ONLY_IN_OVERLAY.txt" }` 를 호출합니다 | 본문에 `파일을 찾을 수 없거나 접근할 수 없습니다` 가 있습니다 |

`ONLY_IN_OVERLAY.txt` 는 테스트가 만든 오버레이에만 있는 파일입니다. 서버가 오버레이를 읽었다면 이 파일의 내용이 응답에 실리고, 동봉된 소스 트리를 읽었다면 파일을 찾지 못합니다.

## 4. 실행 방법

```bash
# 전체 (빌드 후 단위 테스트와 통합 테스트)
npm test

# 이 파일만 (build/index.js 가 이미 있어야 함)
npx vitest run tests/integration/helperIsolation.test.ts
```

## 5. 의존성과 전제 조건

| 항목 | 내용 |
|---|---|
| `build/index.js` | `npm test` 는 빌드를 먼저 실행합니다. vitest 만 실행할 때는 `npm run build` 를 먼저 실행합니다 |
| 공통컴포넌트 소스 | `templates/common-components-src` 가 있어야 합니다. 이 케이스에는 건너뛰는 조건이 걸려 있지 않아서, 소스가 없으면 건너뛰지 않고 실패합니다. `git submodule update --init templates/common-components-src` 로 받습니다 |
| 임베딩 모델, LanceDB 테이블 | 필요하지 않습니다. 호출이 공통컴포넌트 소스 파일 읽기 하나뿐입니다 |
| 임시 디렉터리 | `os.tmpdir()` 아래에 쓸 수 있어야 합니다 |

저장소의 파일과 개발자의 실제 사용자 데이터 디렉터리를 바꾸지 않습니다. 테스트용 오버레이는 임시 홈 디렉터리 안에만 만듭니다.

## 6. 흔한 실패와 진단

| 증상 | 원인 | 대응 |
|---|---|---|
| 받은 값이 `공통컴포넌트 소스가 설치되어 있지 않습니다. ...` 로 시작하며 실패 | 공통컴포넌트 소스 서브모듈을 받지 않았습니다 | `git submodule update --init templates/common-components-src` 를 실행한 뒤 다시 실행합니다 |
| 받은 값에 `ONLY_IN_OVERLAY.txt` 의 내용(`overlay`)이 실려 실패 | 서버가 홈 디렉터리의 오버레이를 읽었습니다. 헬퍼가 `EGOV_MCP_DATA_DIR` 을 넘기지 않게 되었거나, 서버가 이 환경 변수를 따르지 않게 되었습니다 | `tests/integration/_helper.ts` 의 `createMcpClient()` 가 넘기는 `env` 와 `src/utils/dataPaths.ts` 의 `getOverlayRoot()` 를 확인합니다 |
| `.../build/index.js 가 없습니다. 'npm run build' 를 먼저 실행하세요.` | 빌드 산출물이 없습니다 | `npm run build` 를 실행하거나 `npm test` 로 실행합니다 |
