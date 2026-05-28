# 폐쇄망 OSS LLM + eGovFrame MCP 테스트 시나리오

본 폴더는 **폐쇄망 환경에서 OSS LLM(예: Llama, Qwen, Mistral 등)과 eGovFrame MCP Companion**을 연동해 표준프레임워크 지식 베이스에 접근할 수 있는지 검증할 때 사용하는 시나리오 모음입니다.

## 목적

- 본 MCP가 외부 네트워크 없이 `egov_search_knowledge` 한 도구로 동작하는지 확인합니다.
- 공식 가이드/표준용어/공통컴포넌트/호환 소프트웨어 등 주요 지식 소스가 통합 검색 관문에서 정상적으로 라우팅되는지 검증합니다.

## 전제

- Node.js 18 이상이 폐쇄망 서버에 설치되어 있습니다.
- 본 저장소를 폐쇄망으로 반입해 `npm install`, `npm run build`, `npm run build-index`를 사전에 완료한 상태입니다.
- OSS LLM이 MCP 클라이언트(예: Cursor, Claude Desktop, 자체 클라이언트 등)에 연결되어 있고, 본 MCP 서버가 등록되어 있습니다.

## 시나리오 구성

| 번호 | 파일 | 검증 도구 | 난이도 |
|------|------|-----------|--------|
| 00 | [00_사전준비.md](./00_사전준비.md) | 환경 | ★ |
| 01 | [01_지식검색_공식가이드.md](./01_지식검색_공식가이드.md) | `egov_search_knowledge` (`guide` scope) | ★ |
| 02 | [02_표준용어_조회.md](./02_표준용어_조회.md) | `egov_search_knowledge` (`terms` scope) | ★ |
| 03 | [03_공통컴포넌트_탐색.md](./03_공통컴포넌트_탐색.md) | `egov_search_knowledge` (`components` scope) | ★★ |
| 04 | [04_호환소프트웨어_검색.md](./04_호환소프트웨어_검색.md) | `egov_search_knowledge` (`compatibility` scope) | ★ |

## 평가 양식

각 시나리오마다 아래 항목을 기록합니다.

- 시작 시각 / 종료 시각
- 사용한 OSS LLM 모델명과 파라미터(temperature 등)
- 입력한 자연어 프롬프트 원문
- MCP 호출 로그(가능하면 도구명·인자 캡처)
- 응답 요약
- **합격/불합격** 판정 및 근거
- 발견된 이슈 또는 개선 의견

## 사용 권장 순서

1. **00**: 폐쇄망 환경 자체가 의도대로 구성되었는지 먼저 확인합니다.
2. **01 ~ 04**: 각 scope에 대해 LLM이 본 MCP의 지식 베이스에 정상적으로 접근하는지 검증합니다.
