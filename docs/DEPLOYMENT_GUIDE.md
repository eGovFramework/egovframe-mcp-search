# 배포 가이드

이 문서는 `egovframe-mcp-search` 서버를 배포하고 운영하는 방법을 설명합니다. MCP 클라이언트에 등록하는 방법은 [MCP_SETUP_GUIDE.md](./MCP_SETUP_GUIDE.md)에서 다룹니다.

## 배포 방식

`package.json` 이 `"private": true` 이므로 npm 레지스트리에는 게시하지 않습니다. 배포 방식은 두 가지입니다.

| 방식 | 대상 | 요약 |
|------|------|------|
| 플랫폼별 배포 tgz | 사용처, 폐쇄망 | `npm run pack:platforms` 로 만든 tgz 파일을 전달해 설치합니다. 의존 패키지, 임베딩 모델, 지식베이스가 모두 들어 있어 설치 후 빌드나 인덱스 구축이 필요하지 않습니다. |
| 저장소 클론 | 개발자 | 저장소를 클론해서 빌드한 `build/index.js` 를 직접 등록합니다. |

## 요구 사항

- **Node.js 22**: 두 방식 모두 Node.js 22 로 실행해야 합니다. `better-sqlite3` 의 네이티브 바이너리가 Node.js 메이저 버전에 맞춰 만들어지고, 배포 tgz 에는 패키징에 쓴 Node.js 22 용 바이너리가 그대로 들어가기 때문입니다. `package.json` 의 `engines` 는 `>=22 <23` 입니다. 다른 메이저 버전에서 설치하면 npm 이 경고(`EBADENGINE`)를 내지만 설치는 그대로 진행되므로, `node -v` 로 직접 확인합니다.
- **타깃 일치**: 배포 tgz 는 운영체제와 CPU 별로 따로 만들어지므로, 설치할 장비와 같은 타깃의 파일을 씁니다. Linux 용 tgz 는 glibc 기반 배포판용입니다.
- **디스크**: darwin-arm64 기준으로 tgz 는 약 340MB 이고 설치하면 약 1GB 를 차지합니다.

## 배포 tgz 만들기 (유지보수자)

저장소 클론에서 서브모듈(`templates/common-components-src`)을 받아 둔 상태로 실행합니다.

```bash
nvm use                  # Node.js 22
npm ci
npm test
npm run pack:platforms   # scripts/pack-platforms.sh
```

일부 타깃만 만들려면 `PACK_TARGETS` 환경 변수에 타깃을 공백으로 구분해 적습니다.

```bash
PACK_TARGETS="linux-x64 win32-x64" npm run pack:platforms
```

기본 타깃은 `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, `win32-x64` 이고, 결과물은 git 이 추적하지 않는 `dist/` 에 `egovframe-mcp-search-<버전>-<타깃>.tgz` 로 생깁니다. 스크립트는 다음 순서로 동작합니다.

1. `models/` 에 임베딩 모델이 없으면 `npm run fetch-model` 로 내려받습니다.
2. 타깃마다 `node_modules` 를 지우고 그 타깃용으로 다시 설치한 뒤 `npm pack` 을 실행합니다. `npm pack` 은 `prepare` 스크립트로 빌드를 수행하고, `bundleDependencies` 설정에 따라 `node_modules` 를 tgz 에 함께 넣습니다.
3. 만든 tgz 를 풀어서 Linux 타깃의 musl 용 패키지를 지우고, 번들된 의존 패키지의 설치 스크립트(`preinstall`, `install`, `postinstall`)가 아무 일도 하지 않게 바꾼 뒤 다시 압축합니다. 그래서 사용처에서 설치할 때 네이티브 모듈을 다시 빌드하거나 내려받지 않습니다.
4. 끝나면 `npm ci` 로 현재 플랫폼용 `node_modules` 를 복원합니다.

타깃별 패키지를 내려받으므로 네트워크가 필요합니다. 실행하는 동안 `node_modules` 와 `build/` 가 다시 만들어지므로, 같은 체크아웃의 서버나 테스트를 함께 실행하지 않습니다.

tgz 에는 다음이 들어갑니다.

| tgz 안의 경로 | 내용 |
|---------------|------|
| `package/build/` | 컴파일된 서버와 `update` 명령 (`build/index.js` 가 진입점) |
| `package/knowledge-base/` | SQLite DB(`egovframe.db`)와 LanceDB 인덱스 |
| `package/models/` | 임베딩 모델 `Xenova/multilingual-e5-small` |
| `package/templates/common-components-src/` | 공통컴포넌트 소스와 DDL, DML 스크립트 |
| `package/node_modules/` | 타깃 플랫폼용 네이티브 바이너리를 포함한 실행 의존 패키지 |
| `package/docs/` | 상세 문서 (README 가 링크하는 문서) |
| `package/package.json`, `package/README.md`, `package/LICENSE` | 패키지 정보 |

`src/`, `tests/`, `scripts/` 와 `templates/` 의 나머지 원본은 들어가지 않습니다.

## 배포 tgz 설치 (사용처)

설치 명령과 클라이언트 등록 방법은 [MCP_SETUP_GUIDE.md](./MCP_SETUP_GUIDE.md#배포-tgz-를-받은-경우)에 있습니다. 운영할 때 알아 둘 점은 다음과 같습니다.

- 설치할 때 npm 레지스트리에 접근하지 않습니다. `npm install -g --offline` 으로 설치가 끝납니다.
- 설치하면 `egovframe-mcp-search` 명령이 함께 등록됩니다. `egovframe-mcp-search --version` 이 버전을 출력하면 설치가 된 것입니다.
- 서버는 설치 위치의 파일을 읽기만 합니다. 설치 위치에 쓰기 권한이 없는 계정으로 실행해도 동작합니다.

## 저장소 클론으로 실행 (개발자)

준비 명령은 [MCP_SETUP_GUIDE.md](./MCP_SETUP_GUIDE.md#저장소를-클론한-경우)에 있습니다. 저장소에 들어 있는 것과 따로 받아야 하는 것은 다음과 같습니다.

| 대상 | 저장소 포함 여부 | 준비 방법 |
|------|------------------|-----------|
| `knowledge-base/` (지식베이스) | 포함 | 준비할 것이 없습니다. 다시 만들 때만 `npm run build-index` 를 실행합니다. |
| `build/` (빌드 결과) | 미포함 | `npm install` 또는 `npm run build` |
| `models/` (임베딩 모델) | 미포함 | `npm run fetch-model` (약 130MB, 네트워크 필요) |
| `templates/common-components-src` (공통컴포넌트 소스) | 서브모듈 | `git submodule update --init templates/common-components-src` |
| `templates/egovframe_guide` (가이드 원문) | 서브모듈 | 인덱스를 다시 만들 때만 필요합니다. `git submodule update --init templates/egovframe_guide` |

인덱스를 다시 만드는 방법은 [HYBRID_SYSTEM_GUIDE.md](./HYBRID_SYSTEM_GUIDE.md#인덱스-재구축)를 참고합니다.

## 배포 전 체크리스트

| 확인 항목 | 기대 결과 |
|-----------|-----------|
| Node.js 버전 | `node -v` 가 `v22` 로 시작합니다. 패키징에 쓴 Node.js 가 번들 바이너리의 버전을 정합니다. |
| 테스트 | `npm test` 가 통과합니다. |
| 공통컴포넌트 소스와 모델 | `templates/common-components-src/pom.xml` 과 `models/Xenova/multilingual-e5-small/onnx/model_quantized.onnx` 가 있습니다. |
| 지식베이스 상태 파일 | `knowledge-base/` 에 `state.json`, `manifest.json`, `snapshot.jsonl.gz` 가 있습니다. `npm run build-index` 가 만드는 파일이며, 없으면 사용처의 `update --check` 가 현재 버전을 `(기록 없음)` 으로 표시하고 개발자 지식의 첫 갱신이 전량 재임베딩이 됩니다. |
| 이전 산출물 | `dist/` 에 이전에 만든 tgz 가 섞여 있지 않습니다. 버전이 같으면 파일 이름도 같습니다. |
| 번들 내용 | 아래 명령이 여섯 줄을 출력합니다. |
| 설치 확인 | tgz 를 설치한 뒤 `egovframe-mcp-search --version` 이 버전을 출력하고, MCP Inspector 나 실제 클라이언트에서 `tools/list` 에 `egov_search_knowledge` 하나가 보이며, 공식 가이드, 개발자 지식, 공통컴포넌트, 호환 소프트웨어 조회가 각각 결과를 돌려줍니다. |

```bash
tar -tzf dist/egovframe-mcp-search-<버전>-<타깃>.tgz | grep -E "^package/(build/server\.js|knowledge-base/egovframe\.db|models/.*\.onnx|templates/common-components-src/pom\.xml|node_modules/better-sqlite3/build/Release/better_sqlite3\.node|node_modules/sharp/build/Release/.*\.node)$"
```

네이티브 바이너리(`.node`) 두 줄이 빠져 있으면 그 tgz 로 설치한 서버는 시작하지 못합니다. `node_modules` 가 `package-lock.json` 과 어긋난 상태에서 패킹하면 이런 tgz 가 만들어질 수 있으므로, `node_modules` 를 손으로 고치지 말고 스크립트가 다시 설치하게 둡니다.

## 지식베이스 갱신 (update 명령)

`build/index.js` 는 인자 없이 실행하면 MCP 서버를, 첫 인자가 `update` 이면 지식베이스 갱신 명령을 실행합니다. 출력은 모두 stderr 로 나갑니다.

```bash
egovframe-mcp-search update --check                            # 현재 적용 버전과 갱신 후보 조회
egovframe-mcp-search update                                    # 전체 리소스 갱신 (터미널에서는 확인을 한 번 묻고, --yes 로 생략)
egovframe-mcp-search update --resource=guide --guide-tag=<태그>   # 리소스와 버전 지정
egovframe-mcp-search update --from-file <디렉토리>              # 폐쇄망: 반입한 파일로 갱신
egovframe-mcp-search update --rollback                         # 직전 버전으로 복귀
```

명령이 `PATH` 에 없으면 `node <설치 위치>/build/index.js update ...` 로 실행합니다.

- 갱신 대상은 `developer_knowledge`(개발자 지식 중 묻고답하기와 FAQ), `guide`(공식 가이드), `components`(공통컴포넌트 소스)입니다. `compatibility`(호환 소프트웨어)는 갱신이 비활성화되어 있어 건너뛰며, 호환 소프트웨어 목록은 새 배포 tgz 를 설치해야 바뀝니다.
- `--from-file` 없이 실행하면 GitHub 에서 갱신분을 받으므로 네트워크가 필요합니다. 원격을 확인하지 못한 리소스는 상태 줄에 `원격 확인 실패 (오프라인?)` 로 표시되고 이전 상태로 남습니다.
- 갱신분은 설치 위치가 아니라 사용자 데이터 디렉토리에 저장되고, 서버는 그곳에 유효한 갱신분이 있으면 번들보다 먼저 읽습니다. 디렉토리의 위치와 `EGOV_MCP_DATA_DIR` 는 [MCP_SETUP_GUIDE.md](./MCP_SETUP_GUIDE.md#환경변수)에 있습니다.
- 리소스마다 따로 적용합니다. 한 리소스가 실패해도 나머지는 적용되고, 실패한 리소스는 이전 상태로 남으며, 이때 종료 코드는 1 입니다.
- `--from-file` 디렉토리에는 `manifest.json` 과 `snapshot.jsonl.gz`(개발자 지식), `egovframe_guide/` 또는 `guide-md.tar.gz`(공식 가이드), `components-src.tar.gz`(공통컴포넌트)를 둡니다. 파일이 없는 리소스는 건너뜁니다.
- 실행 중인 MCP 서버에는 다음에 서버를 시작할 때부터 반영됩니다.
- 두 개를 동시에 실행하면 나중 것이 `다른 update 가 실행 중입니다` 로 거부됩니다.

## 운영 메모

이 서버는 stdio 로 통신하는 MCP 서버입니다. 포트를 열고 계속 떠 있는 HTTP 서비스가 아니며, Cursor 나 Claude Desktop 같은 MCP 클라이언트가 필요할 때 프로세스를 실행합니다. 서버 로그는 stderr 로 나가고 stdout 은 MCP 메시지 전송에만 씁니다.
