# 지식베이스 구축과 갱신 가이드

이 문서는 `egovframe-mcp-search` 서버가 읽는 지식베이스를 다루는 두 가지 방법을 설명합니다.

| 방법 | 실행하는 곳 | 용도 |
|------|-------------|------|
| [`npm run build-index`](#지식베이스-구축-build-index) | 저장소 클론 (유지보수자) | `templates/` 의 원본 데이터로 패키지에 동봉할 `knowledge-base/` 를 다시 만듭니다. |
| [`update` 명령](#지식베이스-갱신-update-명령) | 배포 파일을 받은 사용처 | 패키지를 다시 설치하지 않고 공식 가이드, 개발자 지식, 공통컴포넌트 소스를 갱신합니다. |

저장 구조와 검색 방식은 [HYBRID_SYSTEM_GUIDE.md](../architecture/HYBRID_SYSTEM_GUIDE.md)에, 테이블과 파일의 형식은 [DATABASE_SCHEMA.md](../architecture/DATABASE_SCHEMA.md)에 있습니다.

## 동봉된 지식베이스

5.1.0 Beta 의 저장소와 배포 파일에는 다음 지식베이스가 들어 있습니다. 리소스별 버전은 `knowledge-base/state.json` 에 기록되어 있습니다.

| 리소스 | 버전 | 규모 |
|--------|------|------|
| 공식 가이드 | egovframe-docs `v5.0.0-end-2026-contribution` | 7,011 청크 |
| 개발자 지식 | 포털 자료 2026-11-24 기준 (`2026-11-24.0`) | 8,665건 (묻고답하기 8,306건, FAQ 105건, 적용가이드 PDF 청크 254건) |
| 공통컴포넌트 | 메타 5.1.0. 소스 버전은 기록되어 있지 않음 | 155개 컴포넌트 |
| 호환 소프트웨어 | 포털 자료 2026-11-24 기준 (`2026-11-24.0`) | 626건 |

## 지식베이스 구축 (build-index)

`npm run build-index` 는 `templates/` 의 원본 데이터로 `knowledge-base/` 를 다시 만듭니다. 저장소와 배포 파일에 지식베이스가 이미 들어 있으므로, 원본 데이터나 색인 규칙(청킹 등)을 바꿨을 때만 저장소 클론에서 실행합니다. 공식 가이드와 개발자 지식 전체를 다시 임베딩하므로 임베딩 모델(`models/`)이 필요합니다. 스크립트가 안내하는 예상 소요 시간은 수십 분이고, Apple Silicon 장비에서는 10분 안팎이 걸립니다.

```bash
npm run build-index                                    # 대화형: 소스 모드(기본 online)와 버전 태그를 묻고 실행 계획을 확인
npm run build-index -- --yes                           # 비대화형: bundled 모드 (네트워크 접속 없음)
npm run build-index -- --source=online --yes           # 비대화형 online: 소스는 현재 체크아웃을 유지
npm run build-index -- --source=online \
  --guide-tag=v5.0.0-end-2026-contribution \
  --components-tag=v5.0.7 --yes                        # 소스 버전(태그) 지정
npm run build-index -- --source=local \
  --template-dir=/media/usb/kb --yes                   # 반입한 디렉토리 사용 (폐쇄망)
```

옵션 값은 `--옵션=값` 형태로 적습니다. `--yes` 는 `-y` 로 줄여 쓸 수 있습니다. 터미널이 아닌 환경에서 `--yes` 없이 실행하면 빌드 계획만 출력하고 중단합니다.

### 소스 모드

| 소스 모드 | 동작 |
|-----------|------|
| `online` | github.com 에서 공통컴포넌트와 가이드 소스 저장소의 태그를 받아 옵니다. 대화형 실행에서는 적용할 태그를 묻고, 비대화형 실행에서는 `--guide-tag`, `--components-tag` 로 지정한 태그를 체크아웃하며, 지정하지 않으면 현재 체크아웃을 유지합니다. 개발자 지식은 릴리스 스냅샷을 내려받고, 받지 못하면 `templates/developer_knowledge/` 의 파일을 씁니다. github.com 에 접속할 수 없으면 대화형 실행은 `local` 과 `bundled` 가운데 하나를 다시 묻고, 비대화형 실행은 `bundled` 로 진행합니다. |
| `local` | `--template-dir` 아래의 `egovframe_guide/`(가이드 마크다운)와 `developer_knowledge/`(스냅샷 쌍 또는 xlsx)를 씁니다. 없는 것은 저장소의 `templates/` 로 대신합니다. 공통컴포넌트 메타, 호환 소프트웨어 목록, 적용가이드 PDF 는 항상 저장소의 `templates/` 에서 읽습니다. |
| `bundled` | 저장소의 현재 체크아웃만 쓰고 네트워크에 접속하지 않습니다. `--source` 없이 `--yes` 만 주었을 때의 기본값입니다. 묻고답하기 원본 Excel(`templates/developer_knowledge/묻고답하기-LET_TN_QA_INFO.xlsx`)은 git 이 추적하지 않으므로, 이 모드로 개발자 지식을 다시 만들려면 그 파일을 같은 자리에 따로 두어야 합니다. 파일이 없으면 FAQ 와 적용가이드 PDF 만으로 만들어집니다 ([KNOWN_ISSUES.md](../development/KNOWN_ISSUES.md) 의 BI-13). |

### 원본과 결과물

| 인덱스 | 원본 |
|--------|------|
| 호환 소프트웨어 (SQLite) | `templates/compatibility/compatibility-software.json` |
| 공통컴포넌트 메타데이터 (SQLite) | `templates/common-components.json`. 사용 테이블 목록은 `templates/common-components-src` 의 DDL 스크립트와 매퍼 XML 에서 도출합니다. |
| 개발자 지식 (LanceDB) | 릴리스 스냅샷(`manifest.json`, `snapshot.jsonl.gz`) 또는 `templates/developer_knowledge/` 의 xlsx 파일, 그리고 같은 디렉토리의 적용가이드 PDF |
| 공식 가이드 (LanceDB) | `templates/egovframe_guide/` (서브모듈) |

결과물은 `egovframe.db`(SQLite), `egovframe_guide.lance/` 와 `developer_knowledge.lance/`(LanceDB), `state.json`(리소스별 적용 버전 기록), `manifest.json` 과 `snapshot.jsonl.gz`(개발자 지식 스냅샷)입니다. `update` 명령은 `state.json` 으로 동봉 리소스의 현재 버전을 판단하고, `snapshot.jsonl.gz` 를 기준으로 개발자 지식의 변경분을 계산합니다.

### 알아 둘 점

- 소스 모드, 버전 태그, 실행 계획 확인 같은 질문은 모두 빌드를 시작하기 전에 끝나고, 그 뒤로는 입력 없이 끝까지 진행합니다.
- 새 인덱스는 `knowledge-base.staging/` 에 만든 뒤 검증을 거쳐 `knowledge-base/` 와 교체하므로, 도중에 실패해도 기존 인덱스는 그대로 남습니다. 직전 인덱스는 `knowledge-base.prev/` 에 하나 보존됩니다.
- 개발자 지식이나 공식 가이드의 원본이 없으면 그 리소스는 건너뛰고 기존 인덱스를 그대로 둡니다.
- 공통컴포넌트의 사용 테이블 목록은 어느 소스 모드에서나 저장소의 `templates/common-components-src` 소스 트리에서 도출합니다. 이 서브모듈이 없으면 메타(`templates/common-components.json`)에 적힌 목록을 그대로 적재하고 경고를 출력합니다. 소스 트리의 태그와 메타의 버전이 다를 때에도 경고를 출력하며, 이 경고는 오류가 아닙니다.
- 다시 구축하면 가이드 청크의 ID 가 새로 매겨지므로, 이전 응답에서 받은 `filters.chunkId` 값은 쓸 수 없습니다.
- 실행 중인 MCP 서버는 열어 둔 SQLite DB 를 계속 읽고, LanceDB 인덱스는 읽기에 실패한 뒤에야 다시 엽니다. 그래서 다시 구축한 뒤에는 서버를 재시작합니다.
- 동봉 인덱스의 내용에 기대는 테스트가 있으므로, 다시 구축한 뒤에는 `npm test` 를 다시 실행합니다.

## 지식베이스 갱신 (update 명령)

`update` 는 지식베이스를 원격의 자료로 갱신하는 명령입니다. 진입점(`build/index.js`)은 인자 없이 실행하면 MCP 서버를, 첫 인자가 `update` 이면 이 명령을 실행합니다. 명령의 출력은 모두 stderr 로 나갑니다.

갱신분은 패키지 디렉토리가 아니라 **사용자 데이터 디렉토리(오버레이)** 에 저장하므로, 배포 파일은 바뀌지 않습니다. 서버는 리소스마다 오버레이에 유효한 갱신분이 있으면 그것을 읽고, 없으면 패키지에 동봉된 것을 읽습니다. 오버레이의 공식 가이드나 개발자 지식 인덱스를 읽다가 실패하면 동봉 인덱스로 물러나서 응답하고, 그 사실을 서버 로그(stderr)에 남깁니다.

### 실행 형태

```bash
npx -y --package=<TGZ> egovframe-mcp-search update [옵션]   # 배포 파일을 npx 로 실행하는 경우 (<TGZ> 는 tgz 의 절대 경로)
egovframe-mcp-search update [옵션]                          # 배포 파일을 npm install -g 로 설치한 경우
node build/index.js update [옵션]                           # 저장소를 클론한 경우 (저장소 루트에서 실행)
```

저장소 루트에서 `npx egovframe-mcp-search` 형태를 쓰면 npm 이 실행할 때마다 `prepare` 스크립트(`npm run build`)를 먼저 실행하므로, 저장소에서는 `node build/index.js update` 를 씁니다. 아래의 예는 전역 설치한 형태로 적었습니다.

```bash
egovframe-mcp-search update --check                    # 현재 버전과 원격의 최신 버전만 조회
egovframe-mcp-search update                            # 전체 리소스 갱신
egovframe-mcp-search update --resource=guide           # 리소스 한정 (쉼표로 여러 개 지정)
egovframe-mcp-search update --resource=components --components-tag=v5.0.7   # 버전 지정 (가이드는 --guide-tag)
egovframe-mcp-search update --from-file /media/usb/kb  # 반입한 파일로 갱신 (폐쇄망)
egovframe-mcp-search update --rollback                 # 직전 적용본으로 되돌림
egovframe-mcp-search update --rollback=guide           # 지정한 리소스만 되돌림
```

### 5.1.0 Beta 에서 주의할 점

5.1.0 Beta 에서는 갱신하기 전에 `--check` 로 갱신 후보를 먼저 확인하고, 필요한 리소스와 버전을 `--resource`, `--guide-tag`, `--components-tag` 로 지정해서 갱신하기를 권장합니다. 2026-11-27 에 동봉 지식베이스에서 `update --check` 를 실행한 결과는 다음과 같았습니다.

| 리소스 | 현재 버전 (동봉) | 표시된 갱신 후보 | 설명 |
|--------|------------------|------------------|------|
| 공식 가이드 | `v5.0.0-end-2026-contribution` | `v5.0.0-ready-2026-contribution` | 후보로 표시된 태그(2026-05-27 커밋)가 동봉본의 태그(2026-11-17 커밋)보다 오래된 것입니다. 숫자 부분이 같은 태그는 접미사의 알파벳 순으로 견주기 때문입니다. |
| 공통컴포넌트 | (기록 없음) | `v5.0.7` | 동봉된 소스는 버전 기록이 없는 5.1.0 소스여서, 공개 저장소의 최신 태그가 후보로 표시됩니다. 적용하면 소스 트리가 v5.0.7 로 바뀌고, 컴포넌트 목록과 설명(메타 5.1.0)은 그대로 남습니다. |
| 개발자 지식 | `2026-11-24.0` | 원격 확인 실패 | 스냅샷 릴리스가 게시되어 있지 않으면 이렇게 표시됩니다. |
| 호환 소프트웨어 | `2026-11-24.0` | - | 갱신이 비활성화되어 있습니다. |

옵션 없이 `update` 를 실행하면 이 후보들이 적용 대상이 되므로, 공식 가이드는 더 오래된 자료로, 공통컴포넌트 소스는 v5.0.7 로 바뀌게 됩니다(후보가 이렇게 표시되는 것까지 확인했고, 실제로 적용해 보지는 않았습니다). 이미 적용했다면 `update --rollback` 으로 되돌립니다. 이 문제는 [KNOWN_ISSUES.md](../development/KNOWN_ISSUES.md) 의 BI-14 에 정리되어 있습니다.

### 옵션

| 옵션 | 설명 |
|------|------|
| `--check` | 현재 적용 버전과 원격의 최신 버전을 출력하고 끝냄 |
| `--resource=<이름,...>` | 대상 리소스 한정. 이름은 `developer_knowledge`(별칭 `knowledge`), `guide`, `components`, `compatibility` |
| `--guide-tag=<태그>`, `--components-tag=<태그>` | 가이드, 공통컴포넌트의 버전 지정 |
| `--from-file=<디렉토리>` | 내려받는 대신 반입한 디렉토리의 파일로 갱신 |
| `--rollback[=<이름,...>]` | 직전 적용본으로 되돌림 |
| `--full` | 개발자 지식의 Q&A·FAQ 전체를 다시 임베딩 |
| `--force` | 가이드와 공통컴포넌트는 같은 버전도 다시 적용, 개발자 지식은 더 낮은 버전도 적용 |
| `--keep-previous` | 공통컴포넌트의 직전 버전 디렉토리 보존 |
| `--yes`, `-y` | 확인 질문 생략 |

### 리소스별 갱신 방식

| 리소스 | 갱신 방식 | 소스 |
|--------|-----------|------|
| `developer_knowledge` (개발자 지식의 Q&A·FAQ) | 직전에 적용한 스냅샷과 id 를 대조해 바뀐 행만 다시 임베딩. 기준 스냅샷이 없거나 `--full` 을 주면 Q&A·FAQ 전체를 다시 임베딩. 적용가이드 PDF 의 청크는 그대로 유지 | 릴리스 스냅샷 (`manifest.json` + `snapshot.jsonl.gz`) |
| `guide` (공식 가이드) | 전체 재인덱싱 | GitHub 태그의 마크다운 (이미지를 뺀 sparse checkout, 실패하면 소스 tarball) |
| `components` (공통컴포넌트 소스) | 소스 트리 교체. 임베딩 없음. 컴포넌트 목록, 설명, 사용 테이블 목록(SQLite)은 패키지에 동봉된 것을 그대로 사용 | GitHub 태그의 소스 tarball |
| `compatibility` (호환 소프트웨어) | 비활성화. 갱신하지 않고 건너뜀 | 새 버전의 배포 파일로만 반영 |

### 동작

- 오버레이 위치는 macOS `~/Library/Application Support/egovframe-mcp-search`, Linux `$XDG_DATA_HOME/egovframe-mcp-search`(`XDG_DATA_HOME` 이 없으면 `~/.local/share/egovframe-mcp-search`), Windows `%LOCALAPPDATA%\egovframe-mcp-search` 입니다. `EGOV_MCP_DATA_DIR` 환경 변수로 바꿀 수 있습니다. 이 변수와 함께 `update` 를 실행했다면, 클라이언트 등록의 `env` 에도 같은 값을 넣어야 서버가 그 오버레이를 읽습니다.
- 터미널에서 실행하면 갱신하기 전에 한 번 확인을 받습니다. `--yes` 를 주거나 터미널이 아닌 환경에서 실행하면 묻지 않고 진행합니다.
- `--from-file` 없이 실행하면 GitHub 에서 갱신분을 받으므로 네트워크가 필요합니다. 원격을 확인하지 못한 리소스는 상태 줄에 `원격 확인 실패 (오프라인?)` 로 표시되고 이전 상태로 남습니다. 어느 리소스도 원격을 확인하지 못했을 때에도 마지막 줄은 `모든 리소스가 최신입니다` 로 나오므로, 상태 줄을 함께 확인합니다.
- 리소스는 서로 독립적으로 갱신합니다. 하나가 실패해도 나머지는 적용되고, 실패한 리소스는 이전 상태를 유지하며, 종료 코드는 1 입니다.
- 공식 가이드와 개발자 지식의 갱신분과 롤백 결과는 MCP 서버를 다시 시작한 뒤부터 검색에 반영됩니다. 공통컴포넌트 소스는 실행 중인 서버에도 다음 조회부터 반영됩니다.
- 공식 가이드와 개발자 지식의 임베딩은 로컬 모델(`models/`)로 계산합니다.
- 두 개를 동시에 실행하면 나중 것이 `다른 update 가 실행 중입니다` 로 거부됩니다.
- 오버레이의 갱신분은 패키지를 새 버전으로 바꾼 뒤에도 동봉본보다 우선합니다(버전을 비교하지 않습니다). 그래서 새 배포 파일을 쓰기 시작한 뒤에도 예전에 받은 갱신분이 계속 쓰입니다. 새 패키지에 동봉된 지식베이스를 쓰려면 `--rollback` 으로 오버레이 항목을 없애고, 최신 자료가 필요하면 `update` 를 다시 실행합니다.
- `--rollback` 은 직전 적용본이 남아 있으면 그것으로 돌아가고, 없으면 오버레이 항목을 지워 패키지 동봉본을 다시 쓰게 합니다. 직전 적용본으로 돌아간 리소스는 한 번 더 실행해야 오버레이 항목이 지워집니다. 개발자 지식과 가이드는 직전 적용본을 하나 보존하고, 공통컴포넌트는 `--keep-previous` 로 갱신했을 때만 보존합니다.
- 개발자 지식 스냅샷을 내려받는 주소는 `EGOV_MCP_UPDATE_URL` 환경 변수로 바꿀 수 있습니다. 릴리스 저장소에 스냅샷이 게시되어 있지 않거나 접속할 수 없으면 `--check` 는 이 리소스를 "원격 확인 실패" 로 표시합니다. 다른 리소스에 새 버전이 있어 갱신이 진행되면 이 리소스만 실패로 처리합니다.
- 저장소와 배포 파일에 동봉된 `knowledge-base/` 에는 버전 기록(`state.json`)과 개발자 지식 스냅샷(`manifest.json`, `snapshot.jsonl.gz`)이 들어 있습니다. 그래서 `--check` 는 동봉 리소스의 현재 버전을 `state.json` 에 기록된 값으로 표시하고, 개발자 지식은 처음 갱신할 때부터 동봉 스냅샷과 대조해서 바뀐 행만 다시 임베딩합니다. 이 파일들이 없는 지식베이스에서는 현재 버전이 "(기록 없음)" 으로 표시되고, 처음 갱신할 때 가이드와 공통컴포넌트는 원격의 최신 태그를 새 버전으로 보고 내려받으며, 개발자 지식은 Q&A·FAQ 전체를 다시 임베딩합니다.

### 폐쇄망에서 반입한 파일로 갱신

반입 디렉토리에 다음 파일을 넣고 `--from-file` 로 지정합니다. 파일이 없는 리소스는 건너뜁니다.

| 리소스 | 반입 디렉토리에 넣는 것 |
|--------|--------------------------|
| 개발자 지식 | `manifest.json` 과 `snapshot.jsonl.gz` |
| 공식 가이드 | `guide-md.tar.gz` 또는 `egovframe_guide/` 디렉토리 (최상위가 문서 루트) |
| 공통컴포넌트 | `components-src.tar.gz` (GitHub 소스 tarball 처럼 최상위 디렉토리 하나 아래에 소스 전체가 들어 있는 형태) |

가이드와 공통컴포넌트는 `--guide-tag`, `--components-tag` 로 버전을 함께 알려 줍니다. 생략하면 버전이 `from-file` 로 기록되어, 다음에 반입한 파일이 같은 버전으로 판단되어 건너뛰어집니다(`--force` 로 다시 적용할 수 있습니다).

### 호환 소프트웨어 갱신의 비활성화

호환 소프트웨어(SQLite) 갱신은 현재 비활성화되어 있습니다. SQLite 로 갱신하는 리소스가 호환 소프트웨어 하나뿐이라, 오버레이에 SQLite 사본을 유지할 실익이 적다고 판단했기 때문입니다. `update` 와 `--rollback` 은 `compatibility` 를 처리하지 않고 건너뛰며, 호환 소프트웨어 목록은 새 버전의 배포 파일을 사용해야 바뀝니다. 구현은 `src/cli/sqlite/` 에 남아 있습니다.
