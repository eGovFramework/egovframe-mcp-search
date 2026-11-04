#!/usr/bin/env node

/**
 * Test for search_knowledge (read-only)
 *
 * 이 스크립트는 search_knowledge 의 다양한 모드만 검증합니다.
 * add_knowledge / update_knowledge / delete_knowledge 는 internalKnowledgeMutationToolNames
 * 로 차단되었으므로 더 이상 테스트하지 않습니다(소스 파일을 직접 수정해 인덱스를 재빌드하는 방식으로 대체).
 *
 * Tests:
 *   1. search_knowledge (semantic, default)
 *   2. search_knowledge (sort: recent)         ← 옛 list_recent_knowledge 대체
 *   3. search_knowledge (scope: all, 크로스 도메인) ← 옛 smart_search 대체
 *   4. search_knowledge (type filter)
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 유사도 점수(0~1)를 시각적 막대 그래프로 렌더링한다.
 */
function renderScoreBar(score) {
  const width = 20;
  const clamped = Math.max(0, Math.min(1, score));
  const filled = Math.round(clamped * width);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  const pct = (score * 100).toFixed(1);
  const quality = score >= 0.5 ? '🟢' : score >= 0.3 ? '🟡' : '🔴';
  return `[${bar}] ${pct}% ${quality}`;
}

/**
 * search_knowledge 결과를 트리 구조로 상세 출력한다.
 */
function printKnowledgeResults(parsed, { maxContentLines = 3 } = {}) {
  if (!parsed.results || parsed.results.length === 0) {
    console.log('      (no results)');
    return;
  }
  for (const [idx, r] of parsed.results.entries()) {
    const score = r.similarity !== undefined ? parseFloat(r.similarity) : null;
    const scoreBar = score !== null ? renderScoreBar(score) : '';

    console.log(`      ┌─ #${idx + 1} ${r.title}`);
    console.log(`      │  유형: ${r.type || '-'}  중요도: ${'★'.repeat(r.importance || 0)}${'☆'.repeat(5 - (r.importance || 0))}`);
    if (r.tags?.length)   console.log(`      │  태그: [${r.tags.join(', ')}]`);
    if (r.context)        console.log(`      │  컨텍스트: ${r.context.length > 80 ? r.context.substring(0, 80) + '...' : r.context}`);
    if (score !== null)   console.log(`      │  유사도: ${score.toFixed(4)} ${scoreBar}`);
    if (r.createdAt)      console.log(`      │  생성일: ${r.createdAt}`);

    if (r.content) {
      const lines = r.content.split('\n').filter(l => l.trim());
      const preview = lines.slice(0, maxContentLines);
      if (preview.length > 0) {
        console.log(`      │  ── 본문 미리보기 ──`);
        preview.forEach(l => {
          const truncated = l.length > 100 ? l.substring(0, 100) + '...' : l;
          console.log(`      │  ${truncated}`);
        });
        if (lines.length > maxContentLines) {
          console.log(`      │  ... (${lines.length - maxContentLines} more lines)`);
        }
      }
    }
    console.log(`      └${'─'.repeat(60)}`);
  }
}

/**
 * search_knowledge(scope: "all") 크로스 도메인 검색 결과를 도메인별로 출력한다.
 */
function printCrossDomainResults(parsed) {
  if (parsed.knowledge?.length > 0) {
    console.log(`      📚 지식 (${parsed.knowledge.length}건):`);
    for (const k of parsed.knowledge) {
      const content = k.content?.length > 80 ? k.content.substring(0, 80) + '...' : k.content;
      console.log(`      │  [${k.type}] ${k.title} - ${content}`);
    }
  }
  if (parsed.compatibility?.length > 0) {
    console.log(`      🔗 호환성 (${parsed.compatibility.length}건):`);
    for (const c of parsed.compatibility.slice(0, 5)) {
      console.log(`      │  ${c.product} → eGovFrame ${c.framework} [${c.category}]`);
    }
    if (parsed.compatibility.length > 5) {
      console.log(`      │  ... (${parsed.compatibility.length - 5} more)`);
    }
  }
}

async function testKnowledge() {
  console.log("📚 Testing search_knowledge (read-only)\n");
  console.log("=".repeat(80) + "\n");

  const transport = new StdioClientTransport({
    command: "node",
    args: [path.join(__dirname, "..", "build", "index.js")],
  });

  const client = new Client(
    { name: "test-client", version: "1.0.0" },
    { capabilities: {} }
  );

  const results = [];

  try {
    await client.connect(transport);
    console.log("✅ Connected to MCP server\n");

    // Test 1: search_knowledge (semantic, default)
    console.log("📋 Test 1: search_knowledge (semantic - default)");
    console.log(`   Query: "test"\n`);
    try {
      const result = await client.callTool({
        name: "search_knowledge",
        arguments: { query: "test" },
      });
      const parsed = JSON.parse(result.content[0].text);
      console.log(`   ✅ Success: ${parsed.resultCount} results\n`);
      printKnowledgeResults(parsed);
      results.push({ name: "search_knowledge (semantic)", status: "✅" });
    } catch (e) {
      console.log("   ❌ Failed:", e.message);
      results.push({ name: "search_knowledge (semantic)", status: "❌" });
    }

    // Test 2: search_knowledge (sort: recent)
    console.log("\n📋 Test 2: search_knowledge (sort: recent)");
    console.log(`   Query: "test" | sort: recent, limit: 5\n`);
    try {
      const result = await client.callTool({
        name: "search_knowledge",
        arguments: { query: "test", sort: "recent", limit: 5 },
      });
      const parsed = JSON.parse(result.content[0].text);
      console.log(`   ✅ Success: ${parsed.count} results\n`);
      printKnowledgeResults(parsed);
      results.push({ name: "search_knowledge (recent)", status: "✅" });
    } catch (e) {
      console.log("   ❌ Failed:", e.message);
      results.push({ name: "search_knowledge (recent)", status: "❌" });
    }

    // Test 3: search_knowledge (scope: all, 크로스 도메인)
    console.log("\n📋 Test 3: search_knowledge (scope: all)");
    console.log(`   Query: "게시판" | scope: all\n`);
    try {
      const result = await client.callTool({
        name: "search_knowledge",
        arguments: { query: "게시판", scope: "all" },
      });
      const parsed = JSON.parse(result.content[0].text);
      console.log(`   ✅ Success: ${parsed.totalResults} total results (cross-domain)\n`);
      printCrossDomainResults(parsed);
      results.push({ name: "search_knowledge (scope all)", status: "✅" });
    } catch (e) {
      console.log("   ❌ Failed:", e.message);
      results.push({ name: "search_knowledge (scope all)", status: "❌" });
    }

    // Test 4: search_knowledge (type filter)
    console.log("\n📋 Test 4: search_knowledge (type filter)");
    console.log(`   Query: "eGovFrame 버전 업그레이드" | type: best-practice\n`);
    try {
      const result = await client.callTool({
        name: "search_knowledge",
        arguments: { query: "eGovFrame 버전 업그레이드", type: "best-practice" },
      });
      const parsed = JSON.parse(result.content[0].text);
      console.log(`   ✅ Success: ${parsed.resultCount} results\n`);
      printKnowledgeResults(parsed);
      results.push({ name: "search_knowledge (type filter)", status: "✅" });
    } catch (e) {
      console.log("   ❌ Failed:", e.message);
      results.push({ name: "search_knowledge (type filter)", status: "❌" });
    }

    // Summary
    console.log("\n" + "=".repeat(80));
    console.log("\n📊 Test Results:\n");
    results.forEach(r => console.log(`   ${r.status} ${r.name}`));

    const passed = results.filter(r => r.status === "✅").length;
    const failed = results.filter(r => r.status === "❌").length;
    console.log(`\n✨ ${passed}/${results.length} tests passed!`);

    await client.close();
    process.exit(failed > 0 ? 1 : 0);
  } catch (error) {
    console.error("\n❌ Fatal error:", error.message);
    process.exit(1);
  }
}

testKnowledge().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
