#!/usr/bin/env node

/**
 * Test for compatibility search tool (consolidated)
 * Tests: search_compatible_software (with includeKnowledge option)
 * 
 * ⚠️ NOTE: The following tools are disabled and merged into search_compatible_software:
 *    - list_framework_versions, list_compatibility_categories → description에 통합
 *    - find_knowledge_for_software → includeKnowledge 옵션으로 통합
 *    - get_recommendations → search_compatible_software + search_knowledge로 대체
 *    - get_compatibility_summary, get_overall_stats, smart_search → 보조 도구 제거
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testCompatibility() {
  console.log("🔍 Testing Compatibility Search Features\n");
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

    // Test 1: search_compatible_software (by version)
    console.log("📋 Test 1: search_compatible_software (by version)");
    try {
      const result = await client.callTool({
        name: "search_compatible_software",
        arguments: { frameworkVersion: "4.2" },
      });
      console.log("   ✅ Success");
      results.push({ name: "search_compatible_software (version)", status: "✅" });
    } catch (e) {
      console.log("   ❌ Failed:", e.message);
      results.push({ name: "search_compatible_software (version)", status: "❌" });
    }

    // Test 2: search_compatible_software (by category)
    console.log("📋 Test 2: search_compatible_software (by category)");
    try {
      const result = await client.callTool({
        name: "search_compatible_software",
        arguments: { category: "CMS Solution" },
      });
      console.log("   ✅ Success");
      results.push({ name: "search_compatible_software (category)", status: "✅" });
    } catch (e) {
      console.log("   ❌ Failed:", e.message);
      results.push({ name: "search_compatible_software (category)", status: "❌" });
    }

    // Test 3: search_compatible_software (by product name)
    console.log("📋 Test 3: search_compatible_software (by product name)");
    try {
      const result = await client.callTool({
        name: "search_compatible_software",
        arguments: { productName: "Spring" },
      });
      console.log("   ✅ Success");
      results.push({ name: "search_compatible_software (product)", status: "✅" });
    } catch (e) {
      console.log("   ❌ Failed:", e.message);
      results.push({ name: "search_compatible_software (product)", status: "❌" });
    }

    // Test 4: search_compatible_software (with includeKnowledge)
    console.log("📋 Test 4: search_compatible_software (includeKnowledge: true)");
    try {
      const result = await client.callTool({
        name: "search_compatible_software",
        arguments: { 
          frameworkVersion: "4.2",
          includeKnowledge: true,
        },
      });
      const text = result.content[0].text;
      const hasKnowledge = text.includes("지식") || text.includes("knowledge") || text.includes("경험");
      console.log("   ✅ Success" + (hasKnowledge ? " - Knowledge included" : ""));
      results.push({ name: "search_compatible_software (knowledge)", status: "✅" });
    } catch (e) {
      console.log("   ❌ Failed:", e.message);
      results.push({ name: "search_compatible_software (knowledge)", status: "❌" });
    }

    // Test 5: search_compatible_software (with minLevel)
    console.log("📋 Test 5: search_compatible_software (minLevel: 2)");
    try {
      const result = await client.callTool({
        name: "search_compatible_software",
        arguments: { 
          frameworkVersion: "4.3",
          minLevel: 2,
        },
      });
      console.log("   ✅ Success");
      results.push({ name: "search_compatible_software (minLevel)", status: "✅" });
    } catch (e) {
      console.log("   ❌ Failed:", e.message);
      results.push({ name: "search_compatible_software (minLevel)", status: "❌" });
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

testCompatibility().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
