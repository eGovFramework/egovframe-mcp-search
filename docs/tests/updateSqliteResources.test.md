# `updateSqliteResources.test.ts`

update CLI 가 호환 소프트웨어 목록(SQLite 리소스 `compatibility`)을 갱신하는 흐름을 검증하는 통합 테스트입니다. 이 기능은 현재 비활성화되어 있어서 파일 전체를 `describe.skip` 으로 건너뜁니다.

> - 위치: `tests/integration/updateSqliteResources.test.ts`
> - 실행: `npm test` 또는 `npx vitest run tests/integration/updateSqliteResources.test.ts` (현재는 모든 케이스가 `skipped` 로 표시됨)
> - 분류: 통합 테스트. `src/cli/update.ts` 의 `runUpdate()` 를 직접 호출함

## 1. 이 테스트가 검증하는 것

호환 소프트웨어 갱신은 번들의 `knowledge-base/egovframe.db` 를 사용자 데이터 디렉터리(오버레이)로 복사한 사본에 적용하도록 설계되어 있습니다. 이 파일은 반입 파일(`--from-file`) 경로로 다음을 확인하도록 작성되어 있습니다.

- 반입한 호환 소프트웨어 JSON 을 오버레이의 SQLite 사본에 적재합니다.
- 패키지가 갱신되어 번들이 바뀌면 오버레이 사본을 무효로 보고, 다음 update 실행이 보관해 둔 적용 원본을 새 번들 위에 다시 적용합니다.
- `--rollback` 으로 적용분을 지우면 오버레이의 SQLite 사본도 지워져서 번들만 쓰는 상태로 돌아갑니다.

현재 `src/cli/update.ts` 는 SQLite 리소스의 갱신과 롤백 호출을 주석으로 막아 두었습니다. 이 테스트의 첫 케이스와 같은 인자(`update --resource=compatibility --from-file <디렉터리> --yes`)로 실행하면 `SQLite 리소스 갱신은 현재 비활성화되어 있어 건너뜁니다.` 라고 알리고 종료 코드 0 으로 끝나며, 오버레이에는 아무것도 만들지 않습니다. 호환 소프트웨어 목록은 패키지를 올릴 때만 바뀝니다. 그래서 이 테스트도 건너뛰고 있습니다.

## 2. 파일 구조와 헬퍼

이 파일은 [_helper.md](./_helper.md)의 헬퍼를 쓰지 않고, 서버도 실행하지 않습니다. `describe` 는 `update CLI — SQLite 리소스 (from-file)` 하나입니다. 건너뛰게 한 줄 바로 위에 원래의 조건 줄이 주석으로 남아 있습니다.

```ts
// describe.skipIf(!fs.existsSync(BUNDLED_DB_PATH))('update CLI — SQLite 리소스 (from-file)', () => {
describe.skip('update CLI — SQLite 리소스 (from-file)', () => {
```

건너뛰는 동안에는 `beforeAll` 과 `afterAll` 도 실행되지 않으므로 아래의 준비 작업은 일어나지 않습니다.

| 도우미와 준비 | 하는 일 |
|---|---|
| `COMPAT_JSON` | 반입할 호환 소프트웨어 한 건(`반입WAS` 1.0, 프레임워크 4.3) |
| `countRows(dbPath, table)` | `SQLiteManager` 로 DB 를 열어 테이블의 행 수를 셈 |
| `setBundledGeneratedAt(value)` | 번들의 `knowledge-base/state.json` 을 `generated_at` 이 `value` 인 내용으로 덮어써서 패키지가 갱신된 상황을 만듦 |
| `beforeAll` | 임시 디렉터리(`egov-sqlite-it-*`)를 만들고 `EGOV_MCP_DATA_DIR` 을 그 안의 `overlay` 로 지정함. 번들 `state.json` 을 쓰고, 번들 DB 의 호환 소프트웨어 행 수를 기록하고, 반입 디렉터리(`import/compatibility/compatibility-software.json`)와 빈 반입 디렉터리(`import-empty`)를 만듦 |
| `afterAll` | 환경 변수를 되돌리고, 번들 `state.json` 이 원래 없었으면 지우고, 임시 디렉터리를 지움 |

이 파일의 케이스는 차례로 이어지는 하나의 시나리오입니다.

## 3. 케이스 상세

| 케이스 | 실행 | 확인하는 것 |
|---|---|---|
| `호환성 SW 반입 적용 — 오버레이 SQLite 가 생성되고 적재된다` | `runUpdate(["--resource=compatibility", "--from-file", <반입 디렉터리>, "--yes"])` | 반환값이 0 임. 오버레이 SQLite 사본이 생기고 유효함. 사본의 `compatibility_software` 가 반입한 1행뿐임. 상태에 `compatibility` 의 `dir` 이 기록되고 `row_count` 가 1 임. 적용 원본 `compatibility-software.json` 이 그 디렉터리에 보관됨 |
| `패키지 갱신(번들 state 변경) 시 무효화되고, update 실행이 재적용으로 치유한다` | 번들 `state.json` 의 `generated_at` 을 바꾼 뒤, 빈 반입 디렉터리로 `runUpdate` 를 호출 | `generated_at` 을 바꾼 직후에는 오버레이 사본이 유효하지 않음. `runUpdate` 의 반환값이 0 이고, 그 뒤에는 사본이 다시 유효하며 `compatibility_software` 가 1행임 |
| `--rollback 으로 호환성 적용분을 제거하면 오버레이 SQLite 자체가 제거된다 (순수 번들 복귀)` | `runUpdate(["--rollback=compatibility"])` | 반환값이 0 임. 상태에 `compatibility` 항목이 없고 오버레이 SQLite 사본이 없음. 번들 DB 의 `compatibility_software` 행 수가 처음 기록한 값과 같음 |

## 4. 실행 방법

```bash
# 이 파일만. 지금은 모든 케이스가 skipped 로 표시됩니다
npx vitest run tests/integration/updateSqliteResources.test.ts
```

테스트를 되살리려면 `src/cli/update.ts` 에서 `[SQLite 갱신 비활성화]` 표식이 붙은 주석 블록을 되살려 기능을 다시 켠 뒤, 이 파일의 `describe.skip` 줄을 지우고 주석으로 남겨 둔 `describe.skipIf(...)` 줄을 되살립니다. 그 전에 5절의 주의 사항을 확인합니다.

## 5. 의존성과 전제 조건

| 항목 | 내용 |
|---|---|
| 호환 소프트웨어 갱신 기능 | `src/cli/update.ts` 에서 켜져 있어야 합니다. 현재는 꺼져 있습니다 |
| `knowledge-base/egovframe.db` | 원래의 조건 줄은 이 파일이 없으면 건너뜁니다 |
| 네트워크, `build/`, 임베딩 모델 | 필요하지 않습니다 |

건너뛰는 동안에는 저장소의 파일을 바꾸지 않습니다. 되살리면 다음 두 가지가 저장소의 파일에 영향을 주므로, 되살리기 전에 테스트를 먼저 고칩니다.

- `beforeAll` 과 둘째 케이스가 `knowledge-base/state.json` 을 덮어씁니다. `afterAll` 은 이 파일이 원래 없었을 때만 지우므로, 원래 있던 `state.json` 은 테스트가 쓴 내용으로 남습니다. 지금 저장소에는 이 파일이 없습니다.
- `countRows` 가 번들의 `knowledge-base/egovframe.db` 를 `SQLiteManager` 의 기본 모드인 쓰기 모드로 엽니다. 쓰기 모드는 저널 모드를 WAL 로 바꾸고 스키마 스크립트를 다시 실행하므로 git 이 추적하는 DB 파일이 바뀝니다. 읽기 전용(`{ readonly: true }`)으로 열도록 고쳐야 합니다.

## 6. 흔한 실패와 진단

| 증상 | 원인 | 대응 |
|---|---|---|
| 모든 케이스가 `skipped` 로 표시됨 | `describe.skip` 으로 건너뛰고 있습니다 | 실패가 아닙니다. 기능이 꺼져 있는 동안의 정상 상태입니다 |
| 기능을 켜지 않고 `describe.skip` 만 풀었을 때 첫 케이스가 실패 | `runUpdate` 가 호환 소프트웨어 갱신을 건너뛰어서 오버레이 SQLite 사본이 만들어지지 않습니다 | `src/cli/update.ts` 의 `[SQLite 갱신 비활성화]` 블록을 함께 되살립니다 |
| 되살린 뒤 `git status` 에 `knowledge-base/egovframe.db` 나 `knowledge-base/state.json` 이 나타남 | 5절에 적은 대로 테스트가 번들의 파일을 씁니다 | `git restore knowledge-base/egovframe.db` 로 DB 를 되돌리고 `state.json` 을 테스트 전의 상태로 되돌린 뒤, 테스트가 번들의 파일을 쓰지 않게 고칩니다 |
