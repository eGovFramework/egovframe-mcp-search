# `updateKnowledge.test.ts`

update CLI 가 개발자 지식(`developer_knowledge`)을 증분 갱신하고 롤백하는 흐름을 검증하는 통합 테스트입니다.

> - 위치: `tests/integration/updateKnowledge.test.ts`
> - 실행: `npm test` 또는 `npx vitest run tests/integration/updateKnowledge.test.ts`
> - 분류: 통합 테스트. `src/cli/update.ts` 의 `runUpdate()` 를 직접 호출하고, 실제 LanceDB 와 로컬 임베딩 모델을 씀

## 1. 이 테스트가 검증하는 것

`egovframe-mcp-search update` 는 개발자 지식의 새 스냅샷을 직전에 적용한 스냅샷과 `id` 로 비교해서 바뀐 행만 다시 임베딩합니다. 이 파일은 반입 파일(`--from-file`) 경로로 그 흐름 전체를 한 번 실행합니다. 네트워크는 쓰지 않습니다.

- 새로 생긴 행과 내용이 바뀐 행만 반영합니다.
- 스냅샷에 없는 적용가이드 PDF 청크는 지우지 않습니다. 삭제 대상을 묻고답하기와 FAQ 행으로 한정하기 때문입니다.
- 갱신분은 새 버전 디렉터리에 쓰고, 상태 파일(`state.json`)이 새 디렉터리를 가리키게 바꿉니다. 직전 버전 디렉터리는 롤백용으로 남깁니다.
- 같은 스냅샷을 다시 적용하면 아무것도 바꾸지 않습니다.
- `--rollback` 은 직전 버전 디렉터리로 되돌립니다.

인자 해석은 단위 테스트 `tests/unit/updateArgs.test.ts` 가, 스냅샷 형식과 비교는 `tests/unit/snapshot.test.ts` 가, 오버레이 경로 해석은 `tests/unit/dataPaths.test.ts` 가 다룹니다.

## 2. 파일 구조와 헬퍼

이 파일은 [_helper.md](./_helper.md)의 헬퍼를 쓰지 않고, 서버도 실행하지 않습니다. `describe` 는 `update CLI — developer_knowledge (from-file)` 하나이며, 임베딩 모델이 없으면 `describe.skipIf` 로 전체를 건너뜁니다.

`beforeAll` 이 임시 디렉터리(`os.tmpdir()` 아래의 `egov-update-it-*`)에 다음을 준비하고, `afterAll` 이 환경 변수를 되돌린 뒤 임시 디렉터리를 지웁니다.

| 준비하는 것 | 내용 |
|---|---|
| `EGOV_MCP_DATA_DIR` | 임시 디렉터리의 `overlay` 로 지정합니다. 갱신분이 사용자의 실제 데이터 디렉터리가 아니라 이곳에 쓰입니다 |
| 기존 적용본 | `overlay/resources/developer_knowledge/v-seed` 에 LanceDB 테이블을 만들고 묻고답하기 행 A(`qa:100`), B(`qa:200`)와 PDF 청크 한 건을 넣습니다. 직전 적용 스냅샷 `snapshot.applied.jsonl.gz` 에는 A 와 B 를 기록합니다 |
| 오버레이 상태 | `overlay/state.json` 에 `developer_knowledge` 의 버전을 `2026-01-01.0`, 디렉터리를 `v-seed` 로 기록합니다 |
| 반입 디렉터리 | `import/manifest.json`(버전 `2026-01-02.0`, 3행)과 `import/snapshot.jsonl.gz` 를 만듭니다. 스냅샷은 A(그대로), B(답변 변경), C(`faq:300`, 신규)입니다 |

이 파일의 케이스는 위의 상태에서 차례로 이어지는 하나의 시나리오입니다. 앞 케이스가 남긴 상태를 뒤 케이스가 이어받습니다. `beforeAll` 과 첫 케이스의 제한 시간은 180초이고, 나머지 두 케이스는 60초입니다.

## 3. 케이스 상세

| 케이스 | 실행 | 확인하는 것 |
|---|---|---|
| `증분 갱신 — 변경분만 반영하고 PDF 청크를 보존한다` | `runUpdate(["--from-file", <반입 디렉터리>, "--resource=developer_knowledge", "--yes"])` | 반환값이 0 임. 상태의 버전이 `2026-01-02.0`, `row_count` 가 3 이고, `dir` 이 새 디렉터리로 바뀌었으며 `previous_dir` 이 `v-seed` 디렉터리임. 새 디렉터리의 테이블에 묻고답하기와 FAQ 행의 원본 ID 가 `100`, `200`, `300` 이고 PDF 청크가 한 건 남아 전체가 4행임. 새 디렉터리에 `snapshot.applied.jsonl.gz` 가 있음 |
| `같은 스냅샷 재적용은 "이미 최신" 으로 스킵한다 (멱등성)` | 같은 인자로 `runUpdate` 를 다시 호출 | 반환값이 0 이고, 상태의 `dir` 과 `applied_at` 이 호출 전과 같음 |
| `--rollback 으로 직전 버전에 복귀한다` | `runUpdate(["--rollback=developer_knowledge"])` | 반환값이 0 임. 상태의 `dir` 이 `v-seed` 디렉터리이고 `previous_dir` 이 없음. `v-seed` 의 테이블이 처음 넣은 대로 3행임(A, B, PDF 청크) |

`runUpdate` 의 출력은 stderr 로 나오므로 테스트 출력에서 진행 상황을 볼 수 있습니다. 첫 케이스에서는 `신규 1 · 변경 1 · 삭제 0 (PDF 1청크 보존)` 이, 둘째 케이스에서는 `이미 최신입니다 (2026-01-02.0)` 가, 셋째 케이스에서는 `직전 버전 디렉토리로 복귀` 가 나옵니다.

## 4. 실행 방법

```bash
# 전체 (빌드 후 단위 테스트와 통합 테스트)
npm test

# 이 파일만 (빌드가 필요 없음)
npx vitest run tests/integration/updateKnowledge.test.ts
```

케이스가 차례로 이어지는 시나리오이므로 `-t` 로 케이스 하나만 골라 실행하지 않습니다.

## 5. 의존성과 전제 조건

| 항목 | 내용 |
|---|---|
| 임베딩 모델 | `models/Xenova/multilingual-e5-small/onnx/model_quantized.onnx` 가 있어야 합니다. 없으면 파일 전체를 건너뜁니다. `npm run fetch-model` 로 받습니다 |
| 네트워크 | 필요하지 않습니다. 반입 파일 경로만 쓰고 임베딩은 로컬 모델로 만듭니다 |
| `build/`, 동봉 지식베이스 | 필요하지 않습니다. `src/` 의 함수를 직접 import 하고, 기존 적용본을 임시 디렉터리에 직접 만듭니다 |
| 임시 디렉터리 | `os.tmpdir()` 아래에 쓸 수 있어야 합니다 |

저장소의 `knowledge-base/` 와 사용자의 실제 데이터 디렉터리(오버레이)를 바꾸지 않습니다.

## 6. 흔한 실패와 진단

| 증상 | 원인 | 대응 |
|---|---|---|
| 파일 전체가 `skipped` 로 표시됨 | 임베딩 모델이 없습니다 | 실패가 아닙니다. 실행하려면 `npm run fetch-model` 로 모델을 받습니다 |
| `-t` 로 롤백 케이스만 실행했을 때 `expected undefined to be 'resources/developer_knowledge/v-seed'` 로 실패 | 앞 케이스가 만든 직전 버전이 없어서 롤백이 오버레이 적용분을 지웠습니다 | 파일 전체를 실행합니다 |
| `runUpdate` 의 반환값이 1 | 갱신 중에 오류가 났습니다 | 테스트 출력에서 `개발자 지식(Q&A/FAQ) 갱신 실패:` 가 들어 있는 줄의 원인을 확인합니다 |
| 첫 케이스에서 행 수 단언이 실패 | 삭제 대상을 묻고답하기와 FAQ 로 한정하는 처리나 스냅샷 비교(`diffSnapshots`)가 바뀌었습니다 | `src/cli/lancedb/developerKnowledge.ts` 의 삭제 대상 계산을 확인합니다 |
