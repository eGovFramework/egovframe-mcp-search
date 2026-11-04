#!/usr/bin/env node

/**
 * 진입점 디스패처
 *
 *   egovframe-mcp-search              # 인자 없음 → stdio MCP 서버 (기존 등록 호환)
 *   egovframe-mcp-search update ...   # 지식베이스 갱신 CLI
 *
 * CLI 출력은 전부 stderr 로 낸다 — stdout 은 stdio 전송(JSON-RPC) 전용이라
 * 오염되면 MCP 클라이언트가 깨진다.
 */

const [, , command, ...rest] = process.argv;

if (command === undefined) {
  // 서버 모듈은 import 시점에 stdio 전송을 시작한다
  await import('./server.js');
} else if (command === 'update') {
  const { runUpdate } = await import('./cli/update.js');
  process.exitCode = await runUpdate(rest);
} else {
  console.error(`알 수 없는 명령입니다: ${command}`);
  console.error('');
  console.error('사용법:');
  console.error('  egovframe-mcp-search                 MCP 서버 실행 (stdio)');
  console.error('  egovframe-mcp-search update          지식베이스 갱신 (전체 리소스)');
  console.error('  egovframe-mcp-search update --check  갱신 가능 여부만 조회');
  process.exitCode = 1;
}
