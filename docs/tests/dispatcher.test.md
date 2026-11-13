# `dispatcher.test.ts`

진입점(`build/index.js`)이 명령줄 인자를 어떻게 처리하는지 검증하는 통합 테스트입니다.

> - 위치: `tests/integration/dispatcher.test.ts`
> - 실행: `npm test` 또는 `npx vitest run tests/integration/dispatcher.test.ts`
> - 분류: 통합 테스트. 빌드된 진입점을 인자와 함께 자식 프로세스로 실행함

## 1. 이 테스트가 검증하는 것

`build/index.js`(소스는 `src/index.ts`)는 인자에 따라 동작을 나눕니다. 인자가 없으면 stdio MCP 서버를 실행하고, `update` 는 지식베이스 갱신 CLI 를 실행하며, `--version`(`-v`)과 `--help`(`-h`)는 버전과 사용법을 출력합니다. 그 밖의 인자는 알 수 없는 명령으로 처리합니다.

이 파일은 그 가운데 다음을 고정합니다.

- `--version`, `--help` 와 그 줄임 표기가 종료 코드 0 으로 끝납니다.
- 알 수 없는 명령은 종료 코드 1 로 끝나고 사용법을 함께 출력합니다.
- 어느 경우에도 stdout 에는 아무것도 쓰지 않습니다. stdout 은 MCP stdio 전송 전용이라서, 여기에 다른 출력이 섞이면 MCP 클라이언트가 메시지를 해석하지 못합니다.

인자 없이 실행하는 경우는 [server.test.md](./server.test.md)와 [searchKnowledge.test.md](./searchKnowledge.test.md)가 서버를 실행하면서 확인하고, `update` 의 동작은 [updateKnowledge.test.md](./updateKnowledge.test.md)가 `runUpdate()` 를 직접 호출해서 확인합니다.

## 2. 파일 구조와 헬퍼

`describe` 는 `integration — 진입점 디스패처` 하나입니다. [_helper.md](./_helper.md)에서 `REPO_ROOT` 와 `SERVER_ENTRY` 만 가져오고, MCP 클라이언트는 쓰지 않습니다.

파일 안의 `run(...args)` 가 진입점을 실행합니다.

```ts
function run(...args: string[]) {
  const result = spawnSync(process.execPath, [SERVER_ENTRY, ...args], {
    encoding: "utf-8",
    input: "",
    timeout: 20_000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
```

테스트를 실행하고 있는 Node 실행 파일(`process.execPath`)로 진입점을 실행하고, stdin 에는 빈 입력을 주며, 20초 안에 끝나지 않으면 중단합니다.

## 3. 케이스 상세

| 케이스 | 실행 | 확인하는 것 |
|---|---|---|
| `--version 은 package.json 의 버전을 stderr 에 출력하고 정상 종료한다` | `--version` 과 `-v` 를 각각 실행 | 종료 코드가 0 이고, stderr 의 내용(앞뒤 공백 제외)이 `package.json` 의 `version` 과 같으며, stdout 이 비어 있음 |
| `--help 는 사용법을 stderr 에 출력하고 정상 종료한다` | `--help` 와 `-h` 를 각각 실행 | 종료 코드가 0 이고, stderr 에 `사용법:` 과 `update --check` 가 있으며 `알 수 없는 명령` 이 없고, stdout 이 비어 있음 |
| `알 수 없는 명령은 사용법과 함께 실패로 종료한다` | `bogus` 를 실행 | 종료 코드가 1 이고, stderr 에 `알 수 없는 명령입니다: bogus` 와 `사용법:` 이 있으며, stdout 이 비어 있음 |

## 4. 실행 방법

```bash
# 전체 (빌드 후 단위 테스트와 통합 테스트)
npm test

# 이 파일만 (build/index.js 가 이미 있어야 함)
npx vitest run tests/integration/dispatcher.test.ts
```

같은 동작을 직접 확인할 때는 진입점을 실행합니다. 출력이 stderr 로 나오므로 `2>&1` 을 붙여야 파이프로 넘길 수 있습니다.

```bash
node build/index.js --version
node build/index.js --help
```

## 5. 의존성과 전제 조건

| 항목 | 내용 |
|---|---|
| `build/index.js` | `npm test` 는 빌드를 먼저 실행합니다. vitest 만 실행할 때는 `npm run build` 를 먼저 실행합니다 |
| `package.json` | 버전을 비교하는 케이스가 읽습니다. 진입점도 버전을 `package.json` 에서 읽습니다 |
| 지식베이스, 임베딩 모델, 공통컴포넌트 소스 | 필요하지 않습니다 |

건너뛰는 케이스가 없고, 저장소의 파일을 바꾸지 않습니다.

## 6. 흔한 실패와 진단

| 증상 | 원인 | 대응 |
|---|---|---|
| 모든 케이스가 실패하고, 실패 내용에 `expected 1 to be +0` 이나 `Cannot find module '.../build/index.js'` 가 보임 | `build/index.js` 가 없습니다 | `npm run build` 를 실행하거나 `npm test` 로 실행합니다 |
| stdout 이 비어 있어야 하는 단언이 실패 | CLI 경로에서 `console.log` 처럼 stdout 에 쓰는 코드가 추가되었습니다 | 출력을 `console.error` 로 바꿉니다 |
| `--version` 케이스에서 stderr 의 내용이 버전과 다름 | 버전 앞뒤에 다른 출력이 추가되었습니다 | `--version` 은 버전 문자열만 출력하게 합니다 |
| `src/index.ts` 를 고쳤는데 결과가 바뀌지 않음 | 테스트는 `build/index.js` 를 실행합니다 | `npm run build` 를 다시 실행합니다 |
