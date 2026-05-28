#!/usr/bin/env node

/**
 * Test for standard terms tools (consolidated)
 * Tests: search_standard_terms (with fulltext, list mode), get_standard_term
 * 
 * ⚠️ NOTE: The following tools are disabled and merged into search_standard_terms:
 *    - list_standard_terms → search_standard_terms() (no query = full list)
 *    - fulltext_search_terms → search_standard_terms(fulltext: true)
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testStandardTerms() {
  console.log("📖 Testing Standard Terms Features\n");
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

    // Test 1: search_standard_terms (no query — full list, replaces list_standard_terms)
    console.log("📋 Test 1: search_standard_terms (full list)");
    try {
      const result = await client.callTool({
        name: "search_standard_terms",
        arguments: { limit: 10, offset: 0 },
      });
      console.log("   ✅ Success");
      results.push({ name: "search_standard_terms (list)", status: "✅" });
    } catch (e) {
      console.log("   ❌ Failed:", e.message);
      results.push({ name: "search_standard_terms (list)", status: "❌" });
    }

    // Test 2: search_standard_terms (name search)
    console.log("📋 Test 2: search_standard_terms (name search)");
    try {
      const result = await client.callTool({
        name: "search_standard_terms",
        arguments: { query: "게시판" },
      });
      console.log("   ✅ Success");
      results.push({ name: "search_standard_terms (name)", status: "✅" });
    } catch (e) {
      console.log("   ❌ Failed:", e.message);
      results.push({ name: "search_standard_terms (name)", status: "❌" });
    }

    // Test 3: search_standard_terms (fulltext search, replaces fulltext_search_terms)
    console.log("📋 Test 3: search_standard_terms (fulltext)");
    try {
      const result = await client.callTool({
        name: "search_standard_terms",
        arguments: { query: "사용자", fulltext: true },
      });
      console.log("   ✅ Success");
      results.push({ name: "search_standard_terms (fulltext)", status: "✅" });
    } catch (e) {
      console.log("   ❌ Failed:", e.message);
      results.push({ name: "search_standard_terms (fulltext)", status: "❌" });
    }

    // Test 4: search_standard_terms (with pagination)
    console.log("📋 Test 4: search_standard_terms (pagination)");
    try {
      const result = await client.callTool({
        name: "search_standard_terms",
        arguments: { limit: 5, offset: 10 },
      });
      console.log("   ✅ Success");
      results.push({ name: "search_standard_terms (pagination)", status: "✅" });
    } catch (e) {
      console.log("   ❌ Failed:", e.message);
      results.push({ name: "search_standard_terms (pagination)", status: "❌" });
    }

    // Test 5: get_standard_term
    console.log("📋 Test 5: get_standard_term");
    try {
      const result = await client.callTool({
        name: "get_standard_term",
        arguments: { koreanName: "게시판ID" },
      });
      console.log("   ✅ Success");
      results.push({ name: "get_standard_term", status: "✅" });
    } catch (e) {
      console.log("   ❌ Failed:", e.message);
      results.push({ name: "get_standard_term", status: "❌" });
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

testStandardTerms().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
