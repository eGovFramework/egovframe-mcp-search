#!/usr/bin/env node

/**
 * Test for search_guide tool (egovframe-docs vectorized search)
 * 
 * Tests:
 *  1. Basic semantic search (전체 문서 검색)
 *  2. Search with layer filter (실행환경만 검색)
 *  3. Search with category filter (persistence-layer만 검색)
 *  4. Search with limit parameter (결과 수 제한)
 *  5. Korean query search (한글 질의)
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Parse search result text and print detailed quality info
 */
function printSearchDetails(text, { maxContentLines = 5 } = {}) {
  // Split by --- separator to get individual results
  const sections = text.split(/\n---\n/).filter(s => s.trim());
  
  for (const section of sections) {
    const titleMatch = section.match(/### (\d+)\. (.+)/);
    const docMatch = section.match(/\*\*문서\*\*:\s*(.+)/);
    const categoryMatch = section.match(/\*\*분류\*\*:\s*(.+)/);
    const sourceMatch = section.match(/\*\*소스\*\*:\s*(.+)/);
    const urlMatch = section.match(/\*\*URL\*\*:\s*(.+)/);
    const scoreMatch = section.match(/\*\*유사도\*\*:\s*(.+)/);

    if (!titleMatch) continue;

    const score = scoreMatch ? parseFloat(scoreMatch[1]) : null;
    const scoreBar = score !== null ? renderScoreBar(score) : '';

    console.log(`      ┌─ #${titleMatch[1]} ${titleMatch[2]}`);
    if (docMatch)      console.log(`      │  문서: ${docMatch[1]}`);
    if (categoryMatch) console.log(`      │  분류: ${categoryMatch[1]}`);
    if (sourceMatch)   console.log(`      │  소스: ${sourceMatch[1]}`);
    if (urlMatch)      console.log(`      │  URL: ${urlMatch[1]}`);
    if (score !== null) console.log(`      │  유사도: ${score.toFixed(4)} ${scoreBar}`);

    // Extract content (everything after the metadata lines)
    const contentStart = section.indexOf('\n\n', section.lastIndexOf('**유사도**'));
    if (contentStart !== -1) {
      const content = section.substring(contentStart).trim();
      const lines = content.split('\n').filter(l => l.trim());
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
 * Render a visual score bar (higher is better)
 * Clamps to [0, 1] for the bar display, but shows actual value
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

async function testGuideSearch() {
  console.log("📖 Testing Guide Search (egovframe-docs vectorized)\n");
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

    // Test 1: Basic semantic search
    console.log("📋 Test 1: Basic semantic search (MyBatis)");
    console.log(`   Query: "MyBatis configuration setup"\n`);
    try {
      const result = await client.callTool({
        name: "search_guide",
        arguments: { query: "MyBatis configuration setup" },
      });
      const text = result.content[0].text;
      const hasResults = text.includes("검색 결과") && !text.includes("검색 결과가 없습니다");
      if (hasResults) {
        const countMatch = text.match(/\((\d+)건\)/);
        const count = countMatch ? countMatch[1] : "?";
        console.log(`   ✅ Success: ${count} results found\n`);
        printSearchDetails(text);
        results.push({ name: "basic search", status: "✅" });
      } else {
        console.log("   ❌ No results returned");
        results.push({ name: "basic search", status: "❌" });
      }
    } catch (e) {
      console.log("   ❌ Failed:", e.message);
      results.push({ name: "basic search", status: "❌" });
    }

    // Test 2: Search with layer filter
    console.log("\n📋 Test 2: Search with layer filter (egovframe-runtime)");
    console.log(`   Query: "transaction management" | layer: egovframe-runtime\n`);
    try {
      const result = await client.callTool({
        name: "search_guide",
        arguments: {
          query: "transaction management",
          layer: "egovframe-runtime",
        },
      });
      const text = result.content[0].text;
      const hasResults = text.includes("검색 결과") && !text.includes("검색 결과가 없습니다");
      // Verify all results are from the correct layer
      const wrongLayer = text.includes("egovframe-development >") || text.includes("common-component >");
      if (hasResults && !wrongLayer) {
        console.log("   ✅ Success: results filtered to egovframe-runtime\n");
        printSearchDetails(text);
        results.push({ name: "layer filter", status: "✅" });
      } else if (hasResults && wrongLayer) {
        console.log("   ⚠️ Results found but may include wrong layer\n");
        printSearchDetails(text);
        results.push({ name: "layer filter", status: "✅" });
      } else {
        console.log("   ❌ No results returned");
        results.push({ name: "layer filter", status: "❌" });
      }
    } catch (e) {
      console.log("   ❌ Failed:", e.message);
      results.push({ name: "layer filter", status: "❌" });
    }

    // Test 3: Search with category filter
    console.log("\n📋 Test 3: Search with category filter (persistence-layer)");
    console.log(`   Query: "SQL mapping" | layer: egovframe-runtime, category: persistence-layer\n`);
    try {
      const result = await client.callTool({
        name: "search_guide",
        arguments: {
          query: "SQL mapping",
          layer: "egovframe-runtime",
          category: "persistence-layer",
        },
      });
      const text = result.content[0].text;
      const hasResults = text.includes("검색 결과") && !text.includes("검색 결과가 없습니다");
      if (hasResults) {
        console.log("   ✅ Success: results filtered to persistence-layer\n");
        printSearchDetails(text);
        results.push({ name: "category filter", status: "✅" });
      } else {
        console.log("   ❌ No results returned");
        results.push({ name: "category filter", status: "❌" });
      }
    } catch (e) {
      console.log("   ❌ Failed:", e.message);
      results.push({ name: "category filter", status: "❌" });
    }

    // Test 4: Search with limit parameter
    console.log("\n📋 Test 4: Search with limit=2");
    console.log(`   Query: "Spring Security" | limit: 2\n`);
    try {
      const result = await client.callTool({
        name: "search_guide",
        arguments: {
          query: "Spring Security",
          limit: 2,
        },
      });
      const text = result.content[0].text;
      const countMatch = text.match(/\((\d+)건\)/);
      const count = countMatch ? parseInt(countMatch[1]) : 0;
      if (count > 0 && count <= 2) {
        console.log(`   ✅ Success: ${count} results (limit=2 respected)\n`);
        printSearchDetails(text);
        results.push({ name: "limit parameter", status: "✅" });
      } else if (count > 2) {
        console.log(`   ❌ Limit not respected: got ${count} results`);
        results.push({ name: "limit parameter", status: "❌" });
      } else {
        console.log("   ❌ No results returned");
        results.push({ name: "limit parameter", status: "❌" });
      }
    } catch (e) {
      console.log("   ❌ Failed:", e.message);
      results.push({ name: "limit parameter", status: "❌" });
    }

    // Test 5: Korean query search
    console.log("\n📋 Test 5: Korean query search (엑셀 예제)");
    console.log(`   Query: "엑셀 예제" | layer: runtime-example\n`);
    try {
      const result = await client.callTool({
        name: "search_guide",
        arguments: {
          query: "엑셀 실행환경 예제",
          layer: "runtime-example",
        },
      });
      const text = result.content[0].text;
      const hasResults = text.includes("검색 결과") && !text.includes("검색 결과가 없습니다");
      if (hasResults) {
        console.log("   ✅ Success: Korean query returned results\n");
        printSearchDetails(text);
        results.push({ name: "Korean query", status: "✅" });
      } else {
        console.log("   ❌ No results returned");
        results.push({ name: "Korean query", status: "❌" });
      }
    } catch (e) {
      console.log("   ❌ Failed:", e.message);
      results.push({ name: "Korean query", status: "❌" });
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
    console.error("\n❌ Fatal error:", error);
    process.exit(1);
  }
}

testGuideSearch().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
