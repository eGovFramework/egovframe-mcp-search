# 배포 가이드

이 문서는 `egovframe-mcp-search` 서버의 배포 파일을 만들고 점검하는 방법을 설명합니다. 배포 파일을 AI 클라이언트에 등록하는 방법은 [MCP_SETUP_GUIDE.md](../setup/MCP_SETUP_GUIDE.md)에서, 지식베이스를 다시 구축하거나 갱신하는 방법은 [KNOWLEDGE_BASE_GUIDE.md](./KNOWLEDGE_BASE_GUIDE.md)에서 다룹니다.

## 배포 방식

`package.json` 이 `"private": true` 이므로 npm 레지스트리에는 게시하지 않습니다. 배포 방식은 두 가지입니다.

| 방식 | 대상 | 요약 |
|------|------|------|
| 플랫폼별 배포 tgz | 사용처, 폐쇄망 | `npm run pack:platforms` 로 만든 tgz 파일을 표준프레임워크 포털에 게시합니다. 의존 패키지, 임베딩 모델, 지식베이스가 모두 들어 있어, 사용처에서는 빌드나 인덱스 구축 없이 `npx` 로 실행합니다. |
| 저장소 클론 | 개발자 | 저장소를 클론해서 빌드한 `build/index.js` 를 직접 등록합니다. |

## 요구 사항

- **Node.js 22**: 두 방식 모두 Node.js 22 로 실행해야 합니다. `better-sqlite3` 의 네이티브 바이너리가 Node.js 메이저 버전에 맞춰 만들어지고, 배포 tgz 에는 패키징에 쓴 Node.js 22 용 바이너리가 그대로 들어가기 때문입니다. `package.json` 의 `engines` 는 `>=22 <23` 입니다. 다른 메이저 버전에서 설치하면 npm 이 경고(`EBADENGINE`)를 내지만 설치는 그대로 진행되므로, `node -v` 로 직접 확인합니다.
- **타깃 일치**: 배포 tgz 는 운영체제와 CPU 별로 따로 만들어지므로, 설치할 장비와 같은 타깃의 파일을 씁니다. Linux 용 tgz 는 glibc 기반 배포판용입니다.
- **디스크**: 5.1.0 의 tgz 는 타깃에 따라 323MB 에서 342MB 이고, darwin-arm64 기준으로 압축을 푼 크기는 약 860MB 입니다.

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

기본 타깃은 `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, `win32-x64` 이고, 결과물은 git 이 추적하지 않는 `dist/` 에 `egovframe-mcp-search-<버전>-<타깃>.tgz` 로 생깁니다. 5.1.0 Beta 에서는 이 가운데 `linux-arm64` 를 뺀 네 타깃의 파일을 배포했습니다. 스크립트는 다음 순서로 동작합니다.

1. `models/` 에 임베딩 모델이 없으면 `npm run fetch-model` 로 내려받습니다.
2. 타깃마다 `node_modules` 를 지우고 그 타깃용으로 다시 설치한 뒤 `npm pack` 을 실행합니다. `npm pack` 은 `prepare` 스크립트로 빌드를 수행하고, `bundleDependencies` 설정에 따라 `node_modules` 를 tgz 에 함께 넣습니다.
3. 만든 tgz 를 풀어서 Linux 타깃의 musl 용 패키지를 지우고, 번들된 의존 패키지의 설치 스크립트(`preinstall`, `install`, `postinstall`)가 아무 일도 하지 않게 바꾼 뒤 다시 압축합니다. 그래서 사용처에서 설치할 때 네이티브 모듈을 다시 빌드하거나 내려받지 않습니다.
4. 끝나면 `npm ci` 로 현재 플랫폼용 `node_modules` 를 복원합니다.

타깃별 패키지를 내려받으므로 네트워크가 필요합니다. 실행하는 동안 `node_modules` 와 `build/` 가 다시 만들어지므로, 같은 체크아웃의 서버나 테스트를 함께 실행하지 않습니다. `npm pack` 은 `--dry-run` 을 주어도 `prepare` 스크립트로 `build/` 를 지우고 다시 컴파일하므로, 서버를 실행 중인 체크아웃에서는 `npm pack` 도 실행하지 않습니다.

tgz 는 이 스크립트로 만듭니다. `npm ci` 를 실행한 직후가 아닌 `node_modules` 에서 `npm pack` 만 실행하면 네이티브 바이너리(`better_sqlite3.node` 등)가 tgz 에서 빠질 수 있습니다.

tgz 에는 다음이 들어갑니다.

| tgz 안의 경로 | 내용 |
|---------------|------|
| `package/build/` | 컴파일된 서버와 `update` 명령 (`build/index.js` 가 진입점) |
| `package/knowledge-base/` | SQLite DB(`egovframe.db`), LanceDB 인덱스, 상태 파일(`state.json`, `manifest.json`, `snapshot.jsonl.gz`) |
| `package/models/` | 임베딩 모델 `Xenova/multilingual-e5-small` |
| `package/templates/common-components-src/` | 공통컴포넌트 소스와 DDL, DML 스크립트 |
| `package/node_modules/` | 타깃 플랫폼용 네이티브 바이너리를 포함한 실행 의존 패키지 |
| `package/docs/` | 상세 문서 (README 가 링크하는 문서). 패키징한 시점의 `docs/` 가 그대로 들어갑니다. |
| `package/package.json`, `package/README.md`, `package/LICENSE` | 패키지 정보 |

`src/`, `tests/`, `scripts/` 와 `templates/` 의 나머지 원본은 들어가지 않습니다.

## 배포 tgz 사용 (사용처)

사용처에서는 tgz 의 압축을 풀지 않고 `npx -y --package=<tgz 의 절대 경로> egovframe-mcp-search` 로 실행하도록 AI 클라이언트에 등록합니다. 클라이언트별 등록 방법과 전역 설치(`npm install -g --offline`)해서 쓰는 방법은 [MCP_SETUP_GUIDE.md](../setup/MCP_SETUP_GUIDE.md)에 있습니다. 운영할 때 알아 둘 점은 다음과 같습니다.

- 실행하거나 설치할 때 npm 레지스트리에 접근하지 않습니다. 필요한 패키지가 모두 tgz 안에 있기 때문입니다.
- `npx` 로 실행하면 서버를 시작할 때마다 20초 정도 걸립니다(Apple Silicon 장비에서 `--version` 을 실행해 약 24초로 측정했습니다). 서버 시작 대기 시간이 짧은 클라이언트에서는 대기 시간을 늘려서 등록합니다.
- 서버는 패키지 위치의 파일을 읽기만 합니다. 패키지 위치에 쓰기 권한이 없는 계정으로 실행해도 동작합니다.

## 저장소 클론으로 실행 (개발자)

준비 명령은 [MCP_SETUP_GUIDE.md](../setup/MCP_SETUP_GUIDE.md#저장소를-클론해서-실행)에 있습니다. 저장소에 들어 있는 것과 따로 받아야 하는 것은 다음과 같습니다.

| 대상 | 저장소 포함 여부 | 준비 방법 |
|------|------------------|-----------|
| `knowledge-base/` (지식베이스) | 포함 | 준비할 것이 없습니다. 다시 만들 때만 `npm run build-index` 를 실행합니다. |
| `build/` (빌드 결과) | 미포함 | `npm install` 또는 `npm run build` |
| `models/` (임베딩 모델) | 미포함 | `npm run fetch-model` (약 130MB, 네트워크 필요) |
| `templates/common-components-src` (공통컴포넌트 소스) | 서브모듈 | `git submodule update --init templates/common-components-src` |
| `templates/egovframe_guide` (가이드 원문) | 서브모듈 | 인덱스를 다시 만들 때와 가이드 원문을 검사하는 테스트를 실행할 때만 필요합니다. `git submodule update --init templates/egovframe_guide` |

`npm run fetch-model` 은 모델이 이미 있으면 내려받지 않고, 모델을 불러와서 확인만 합니다. 불러오지 못한 모델(내려받다가 끊긴 파일 등)은 지우고 종료 코드 1 로 끝나므로, 한 번 더 실행해서 다시 내려받습니다. 인덱스를 다시 만드는 방법은 [KNOWLEDGE_BASE_GUIDE.md](./KNOWLEDGE_BASE_GUIDE.md#지식베이스-구축-build-index)를 참고합니다.

## 배포 전 체크리스트

| 확인 항목 | 기대 결과 |
|-----------|-----------|
| Node.js 버전 | `node -v` 가 `v22` 로 시작합니다. 패키징에 쓴 Node.js 가 번들 바이너리의 버전을 정합니다. |
| 테스트 | `npm test` 가 통과합니다. |
| 공통컴포넌트 소스와 모델 | `templates/common-components-src/pom.xml` 과 `models/Xenova/multilingual-e5-small/onnx/model_quantized.onnx` 가 있습니다. |
| 지식베이스 상태 파일 | `knowledge-base/` 에 `state.json`, `manifest.json`, `snapshot.jsonl.gz` 가 있습니다. 저장소에 인덱스와 함께 들어 있고 `npm run build-index` 가 다시 만드는 파일입니다. 없으면 사용처의 `update --check` 가 현재 버전을 `(기록 없음)` 으로 표시하고 개발자 지식의 첫 갱신이 전량 재임베딩이 됩니다. |
| 이전 산출물 | `dist/` 에 이전에 만든 tgz 가 섞여 있지 않습니다. 버전이 같으면 파일 이름도 같습니다. |
| 체크섬 | 게시할 파일의 MD5 와 SHA256 을 계산해 릴리스 노트(`docs/release-notes/`)에 적습니다. macOS 와 Linux 에서는 `shasum -a 256 dist/*.tgz` 로 SHA256 을 계산합니다. tgz 를 다시 만들면 체크섬이 바뀌므로 릴리스 노트의 값도 함께 고칩니다. |
| 번들 내용 | 아래 명령이 여섯 줄을 출력합니다. |
| 실행 확인 | `npx -y --package=<tgz 의 절대 경로> egovframe-mcp-search --version` 이 버전을 출력하고, MCP Inspector 나 실제 클라이언트에서 `tools/list` 에 `egov_search_knowledge` 하나가 보이며, 공식 가이드, 개발자 지식, 공통컴포넌트, 호환 소프트웨어 조회가 각각 결과를 돌려줍니다. |

```bash
tar -tzf dist/egovframe-mcp-search-<버전>-<타깃>.tgz | grep -E "^package/(build/server\.js|knowledge-base/egovframe\.db|models/.*\.onnx|templates/common-components-src/pom\.xml|node_modules/better-sqlite3/build/Release/better_sqlite3\.node|node_modules/sharp/build/Release/.*\.node)$"
```

네이티브 바이너리(`.node`) 두 줄이 빠져 있으면 그 tgz 는 쓸 수 없습니다. `sharp` 의 바이너리가 없으면 서버가 시작하지 못하고, `better-sqlite3` 의 바이너리가 없으면 공통컴포넌트와 호환 소프트웨어 조회가 `네이티브 모듈(better-sqlite3)을 불러오지 못했습니다` 로 시작하는 오류를 돌려줍니다. npm 이 설치해 둔 `node_modules` 에서 패키지를 지웠거나 `node_modules` 를 다른 곳에서 복사해 온 상태로 패킹하면 이런 tgz 가 만들어집니다. 이때 `npm pack` 은 번들 의존 패키지를 디스크에 있는 그대로 담지 않고 각 패키지가 배포 파일로 지정한 것만 담으므로, 설치할 때 만들어진 바이너리가 빠집니다. 그래서 `node_modules` 를 손으로 고치거나 복사해 쓰지 말고 스크립트가 다시 설치하게 둡니다.

## 지식베이스 갱신

배포한 뒤에 사용처에서 지식베이스를 갱신하는 `update` 명령과, 패키지에 동봉할 지식베이스를 다시 만드는 `npm run build-index` 는 [KNOWLEDGE_BASE_GUIDE.md](./KNOWLEDGE_BASE_GUIDE.md)에서 다룹니다. 호환 소프트웨어 목록은 `update` 명령으로 갱신되지 않으므로, 목록을 바꾸려면 지식베이스를 다시 구축해서 새 배포 tgz 를 만듭니다.

## 운영 메모

이 서버는 stdio 로 통신하는 MCP 서버입니다. 포트를 열고 계속 떠 있는 HTTP 서비스가 아니며, Claude Code 나 Cursor 같은 MCP 클라이언트가 필요할 때 프로세스를 실행합니다. 서버 로그는 stderr 로 나가고 stdout 은 MCP 메시지 전송에만 씁니다. 처리되지 않은 프라미스 거부가 나도 서버 프로세스는 종료하지 않고 그 내용을 로그에 남깁니다.
