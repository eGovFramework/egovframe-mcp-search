# 테스트 가이드

## 기본 확인

```bash
npm run build
```

TypeScript 컴파일과 실행 파일 권한 설정을 함께 확인합니다.

## MCP 서버 수동 확인

```bash
npm run inspector
```

Inspector에서 공개 도구 목록이 **`egov_search_knowledge` 와 `egov_ddl_assist` 둘**인지 확인합니다.

| Tool | 확인 포인트 |
|------|-------------|
| `egov_search_knowledge` | 통합 검색 입력 스키마와 scope/action/filter 동작 |
| `egov_ddl_assist` | action/input/domainHint 입력 스키마와 lookup/decompose/validate 동작 |

## 자동화된 통합 테스트

```bash
npm test
```

`tests/integration/server.test.ts` 가 다음을 동결합니다.

- 서버가 stdio 로 정상 핸드셰이크 응답
- `tools/list` 가 `egov_search_knowledge` 와 `egov_ddl_assist` 두 도구만 노출
- 각 도구가 `description` + `inputSchema(type=object)` 를 가진다
- `egov_search_knowledge` 의 핵심 파라미터 6개(`query`/`scope`/`action`/`filters`/`limit`/`strictScope`) 모두 존재
- `egov_ddl_assist` 의 핵심 파라미터(`action`/`input`/`domainHint`)와 `action` enum 6종 모두 존재

## 인덱스 생성 확인

지식 검색 또는 공통컴포넌트 검색을 확인하려면 먼저 인덱스를 생성합니다.

```bash
npm run build-index
```

## 테스트 정비 원칙

새 테스트를 추가하거나 기존 테스트를 정리할 때는 MCP 클라이언트에 실제 노출되는 도구를 기준으로 작성합니다.

- 검색, 표준용어, 호환성, 공통컴포넌트는 `egov_search_knowledge` 경유로 테스트합니다.
- 지식 변경 API는 런타임 MCP 도구로 테스트하지 않습니다. 원천 데이터 갱신과 인덱스 재생성을 별도로 검증합니다.
- 옛 스캐폴딩/아키텍처/엔티티 추가 관련 테스트(`tests/scaffold/`, `tests/utils/ddlNormalizer.test.ts`, `tests/integration/checkCompliance.test.ts` 등)는 해당 도구가 본 서버에서 제거되면서 함께 삭제되었습니다.
