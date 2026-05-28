# 배포 가이드

## 로컬 실행 배포

현재 저장소는 private 패키지로 설정되어 있으므로 기본 배포 방식은 저장소를 클론해서 로컬 MCP 서버로 등록하는 방식입니다.

```bash
git clone <repository-url>
cd egovframe-mcp-search
npm install
npm run build
npm run build-index
```

MCP 클라이언트에는 `build/index.js`를 `node`로 실행하도록 등록합니다.

```json
{
  "mcpServers": {
    "egovframe-mcp-search": {
      "command": "node",
      "args": ["/path/to/egovframe-mcp-search/build/index.js"],
      "env": {
        "EGOVFRAME_TEMPLATE_PATH": "/path/to/egovframe-mcp-search/templates",
        "EGOVFRAME_KNOWLEDGE_DB": "/path/to/egovframe-mcp-search/knowledge-base"
      }
    }
  }
}
```

## 패키지 배포 시 확인 사항

`package.json`은 현재 `"private": true`입니다. npm 배포를 하려면 의도적으로 다음 항목을 검토해야 합니다.

- 패키지 이름과 scope
- `private: false` 전환 여부
- `files`에 포함할 산출물
- `knowledge-base`를 패키지에 포함할지, 설치 후 `npm run build-index`로 생성하게 할지
- `bin.egovframe-mcp-search` 경로가 `./build/index.js`와 맞는지

## 배포 전 체크리스트

```bash
npm install
npm run build
npm run build-index
```

추가로 MCP Inspector 또는 실제 클라이언트에서 다음을 확인합니다.

| 확인 항목 | 기대 결과 |
|-----------|-----------|
| Tool list | `egov_search_knowledge` 1개만 노출 |
| 통합 검색 | 가이드/지식/표준용어/공통컴포넌트/호환성 검색 가능 |

## 운영 메모

이 서버는 stdio 기반 MCP 서버입니다. 장기 실행 HTTP 서비스처럼 포트를 열어 배포하는 구조가 아니며, Cursor나 Claude Desktop 같은 MCP 클라이언트가 필요할 때 프로세스를 실행합니다.
