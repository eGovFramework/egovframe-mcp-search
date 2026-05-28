# `tests/` 디렉터리 — 문서 인덱스

`tests/**/*.test.ts` 의 의도와 동작을 사람이 빨리 읽을 수 있도록 정리한 문서 모음입니다. 각 문서는 다음 형식을 따릅니다.

1. 이 테스트가 검증하는 것
2. 파일 구조 / 헬퍼
3. 케이스 상세
4. 실행 방법
5. 의존성과 전제 조건
6. 흔한 실패와 진단

## 디렉터리와 매핑

| 테스트 파일 | 분류 | 문서 |
|---|---|---|
| `tests/integration/_helper.ts` | 공용 헬퍼 | [_helper.md](./_helper.md) |
| `tests/integration/server.test.ts` | integration | [server.test.md](./server.test.md) |

## 한눈에 보는 테스트 피라미드

```
        ┌────────────────────────────────────────────┐
 통합   │ server.test.ts                             │  ← MCP stdio 자식 프로세스, build/index.js 필요
        └────────────────────────────────────────────┘
```

- **MCP 통합 테스트**(`integration/server.test.ts`)는 `build/index.js` 를 자식 프로세스로 띄우고 MCP Client SDK 로 호출합니다. `npm test` 가 자동으로 빌드 → 통합 테스트 순서를 챙깁니다.
- 옛 `tests/scaffold/`, `tests/utils/`, `tests/test-*.mjs` 등 스캐폴딩/아키텍처 관련 테스트는 해당 도구가 본 서버에서 제거되면서 함께 삭제되었습니다.

## 자주 쓰는 실행 커맨드

| 목적 | 명령 |
|---|---|
| 전체 (빌드 + 통합) | `npm test` |
| 통합만 (이미 빌드된 상태) | `npx vitest run tests/integration` |
| 워치 모드 | `npm run test:watch` |
| 특정 파일 | `npx vitest run tests/integration/server.test.ts` |

## 문서를 어떻게 갱신하는가

- 테스트 파일을 추가/변경하면 같은 이름의 `.md` 도 갱신합니다.
- 코드와 문서가 어긋나면 **코드가 진실의 원천**입니다. 문서는 의도와 회귀 사유를 사람이 읽을 수 있게 보존하는 용도입니다.
