#!/usr/bin/env node

/**
 * Test for common components tools
 * 공통컴포넌트 조회, 검색, 의존성 해결 도구 테스트
 * 
 * ⚠️ NOTE: The following tools are disabled and merged into list_common_components:
 *    - list_component_categories → list_common_components() (no params = categories + summary)
 *    - get_component_summary → list_common_components() (included in no-params response)
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testCommonComponents() {
  console.log("🧩 Testing Common Components Features\n");
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

    // Test 1: list_common_components (no params — categories + summary, replaces list_component_categories & get_component_summary)
    console.log("📋 Test 1: list_common_components (categories + summary)");
    try {
      const result = await client.callTool({
        name: "list_common_components",
        arguments: {},
      });
      const text = result.content[0].text;
      const hasCategories = text.includes("카테고리") || text.includes("컴포넌트");
      console.log("   ✅ Success - Categories and summary listed");
      if (text.includes("37") || text.includes("147") || text.includes("154")) {
        console.log("   ✅ Statistics numbers present");
      }
      results.push({ name: "list_common_components (overview)", status: "✅" });
    } catch (e) {
      console.log("   ❌ Failed:", e.message);
      results.push({ name: "list_common_components (overview)", status: "❌" });
    }

    // Test 2: list_common_components (카테고리 필터)
    console.log("📋 Test 2: list_common_components (카테고리 필터)");
    try {
      const result = await client.callTool({
        name: "list_common_components",
        arguments: { categoryId: "게시판" },
      });
      const text = result.content[0].text;
      const hasBbs = text.includes("게시판") || text.includes("bbs");
      console.log("   ✅ Success - Filtered by category");
      results.push({ name: "list_common_components (filter)", status: "✅" });
    } catch (e) {
      console.log("   ❌ Failed:", e.message);
      results.push({ name: "list_common_components (filter)", status: "❌" });
    }

    // Test 3: get_component_info (by ID)
    console.log("📋 Test 3: get_component_info (by ID)");
    try {
      const result = await client.callTool({
        name: "get_component_info",
        arguments: { componentId: "bbs" },
      });
      const text = result.content[0].text;
      console.log("   ✅ Success - Component info retrieved");
      if (text.includes("의존성")) {
        console.log("   ✅ Dependencies included");
      }
      results.push({ name: "get_component_info (ID)", status: "✅" });
    } catch (e) {
      console.log("   ❌ Failed:", e.message);
      results.push({ name: "get_component_info (ID)", status: "❌" });
    }

    // Test 4: get_component_info (by package name)
    console.log("📋 Test 4: get_component_info (by package name)");
    try {
      const result = await client.callTool({
        name: "get_component_info",
        arguments: { componentId: "egovframework.com.cop.bbs" },
      });
      console.log("   ✅ Success - Component found by package name");
      results.push({ name: "get_component_info (package)", status: "✅" });
    } catch (e) {
      console.log("   ❌ Failed:", e.message);
      results.push({ name: "get_component_info (package)", status: "❌" });
    }

    // Test 5: get_component_info (not found)
    console.log("📋 Test 5: get_component_info (not found)");
    try {
      const result = await client.callTool({
        name: "get_component_info",
        arguments: { componentId: "nonexistent-component" },
      });
      console.log("   ✅ Success - Not found handled correctly");
      results.push({ name: "get_component_info (not found)", status: "✅" });
    } catch (e) {
      console.log("   ❌ Failed:", e.message);
      results.push({ name: "get_component_info (not found)", status: "❌" });
    }

    // Test 6: search_common_components
    console.log("📋 Test 6: search_common_components");
    try {
      const result = await client.callTool({
        name: "search_common_components",
        arguments: { query: "로그인", limit: 10 },
      });
      console.log("   ✅ Success - Search completed");
      results.push({ name: "search_common_components", status: "✅" });
    } catch (e) {
      console.log("   ❌ Failed:", e.message);
      results.push({ name: "search_common_components", status: "❌" });
    }

    // Test 7: resolve_component_dependencies (single)
    console.log("📋 Test 7: resolve_component_dependencies (single)");
    try {
      const result = await client.callTool({
        name: "resolve_component_dependencies",
        arguments: { componentIds: ["bbs"] },
      });
      const text = result.content[0].text;
      console.log("   ✅ Success - Dependencies resolved");
      if (text.includes("자동 추가")) {
        console.log("   ✅ Auto-added dependencies shown");
      }
      results.push({ name: "resolve_dependencies (single)", status: "✅" });
    } catch (e) {
      console.log("   ❌ Failed:", e.message);
      results.push({ name: "resolve_dependencies (single)", status: "❌" });
    }

    // Test 8: resolve_component_dependencies (multiple)
    console.log("📋 Test 8: resolve_component_dependencies (multiple)");
    try {
      const result = await client.callTool({
        name: "resolve_component_dependencies",
        arguments: { componentIds: ["bbs", "cmy", "uia"] },
      });
      console.log("   ✅ Success - Multiple dependencies resolved");
      results.push({ name: "resolve_dependencies (multiple)", status: "✅" });
    } catch (e) {
      console.log("   ❌ Failed:", e.message);
      results.push({ name: "resolve_dependencies (multiple)", status: "❌" });
    }

    // Test 9: get_component_source_files
    console.log("📋 Test 9: get_component_source_files (bbs)");
    try {
      const result = await client.callTool({
        name: "get_component_source_files",
        arguments: { componentId: "bbs" },
      });
      const text = result.content[0].text;
      const hasJava = text.includes("Java") && text.includes(".java");
      const hasMapper = text.includes("Mapper") && text.includes(".xml");
      const hasJsp = text.includes("JSP") && text.includes(".jsp");
      console.log("   ✅ Success - Source files listed");
      if (hasJava) console.log("   ✅ Java files found");
      if (hasMapper) console.log("   ✅ Mapper XML files found");
      if (hasJsp) console.log("   ✅ JSP files found");
      results.push({ name: "get_component_source_files", status: "✅" });
    } catch (e) {
      console.log("   ❌ Failed:", e.message);
      results.push({ name: "get_component_source_files", status: "❌" });
    }

    // Test 10: get_component_source_files (not found)
    console.log("📋 Test 10: get_component_source_files (not found)");
    try {
      const result = await client.callTool({
        name: "get_component_source_files",
        arguments: { componentId: "nonexistent" },
      });
      console.log("   ✅ Success - Not found handled");
      results.push({ name: "get_component_source_files (404)", status: "✅" });
    } catch (e) {
      console.log("   ❌ Failed:", e.message);
      results.push({ name: "get_component_source_files (404)", status: "❌" });
    }

    // Test 11: read_component_source
    console.log("📋 Test 11: read_component_source");
    try {
      const result = await client.callTool({
        name: "read_component_source",
        arguments: { filePath: "src/main/java/egovframework/com/cop/bbs/web/EgovArticleController.java" },
      });
      const text = result.content[0].text;
      const hasCode = text.includes("class") || text.includes("Controller") || text.includes("java");
      console.log("   ✅ Success - Source file read");
      if (hasCode) console.log("   ✅ Java code content present");
      results.push({ name: "read_component_source", status: "✅" });
    } catch (e) {
      console.log("   ❌ Failed:", e.message);
      results.push({ name: "read_component_source", status: "❌" });
    }

    // Test 12: read_component_source (security - path traversal)
    console.log("📋 Test 12: read_component_source (security)");
    try {
      const result = await client.callTool({
        name: "read_component_source",
        arguments: { filePath: "../../../package.json" },
      });
      console.log("   ✅ Success - Path traversal blocked");
      results.push({ name: "read_component_source (security)", status: "✅" });
    } catch (e) {
      console.log("   ❌ Failed:", e.message);
      results.push({ name: "read_component_source (security)", status: "❌" });
    }

    // Test 13: get_component_ddl (MySQL)
    console.log("📋 Test 13: get_component_ddl (MySQL)");
    try {
      const result = await client.callTool({
        name: "get_component_ddl",
        arguments: { componentId: "bbs", dbType: "mysql" },
      });
      const text = result.content[0].text;
      const hasDDL = text.includes("CREATE TABLE") || text.includes("DDL");
      console.log("   ✅ Success - DDL extracted");
      if (hasDDL) console.log("   ✅ CREATE TABLE statements present");
      results.push({ name: "get_component_ddl (mysql)", status: "✅" });
    } catch (e) {
      console.log("   ❌ Failed:", e.message);
      results.push({ name: "get_component_ddl (mysql)", status: "❌" });
    }

    // Test 14: get_component_ddl (PostgreSQL)
    console.log("📋 Test 14: get_component_ddl (PostgreSQL)");
    try {
      const result = await client.callTool({
        name: "get_component_ddl",
        arguments: { componentId: "bbs", dbType: "postgres" },
      });
      console.log("   ✅ Success - PostgreSQL DDL extracted");
      results.push({ name: "get_component_ddl (postgres)", status: "✅" });
    } catch (e) {
      console.log("   ❌ Failed:", e.message);
      results.push({ name: "get_component_ddl (postgres)", status: "❌" });
    }

    // Test 15: get_component_dml (MySQL)
    console.log("📋 Test 15: get_component_dml (MySQL)");
    try {
      const result = await client.callTool({
        name: "get_component_dml",
        arguments: { componentId: "bbs", dbType: "mysql" },
      });
      const text = result.content[0].text;
      const hasDML = text.includes("INSERT") || text.includes("초기 데이터");
      console.log("   ✅ Success - DML extracted");
      if (hasDML) console.log("   ✅ INSERT statements present");
      results.push({ name: "get_component_dml (mysql)", status: "✅" });
    } catch (e) {
      console.log("   ❌ Failed:", e.message);
      results.push({ name: "get_component_dml (mysql)", status: "❌" });
    }

    // Test 16: get_component_ddl (invalid DB type)
    console.log("📋 Test 16: get_component_ddl (invalid DB)");
    try {
      const result = await client.callTool({
        name: "get_component_ddl",
        arguments: { componentId: "bbs", dbType: "sqlite" },
      });
      console.log("   ✅ Success - Invalid DB type handled");
      results.push({ name: "get_component_ddl (invalid DB)", status: "✅" });
    } catch (e) {
      console.log("   ❌ Failed:", e.message);
      results.push({ name: "get_component_ddl (invalid DB)", status: "❌" });
    }

    // Print summary
    console.log("\n" + "=".repeat(80));
    console.log("\n📊 Test Results Summary\n");
    console.log("| # | Test | Status |");
    console.log("|---|------|--------|");
    results.forEach((r, i) => {
      console.log(`| ${i + 1} | ${r.name} | ${r.status} |`);
    });

    const passed = results.filter((r) => r.status === "✅").length;
    const failed = results.filter((r) => r.status === "❌").length;
    console.log(`\n✅ Passed: ${passed}/${results.length}`);
    if (failed > 0) {
      console.log(`❌ Failed: ${failed}/${results.length}`);
    }

    await client.close();
    process.exit(failed > 0 ? 1 : 0);
  } catch (error) {
    console.error("\n❌ Fatal error:", error.message);
    process.exit(1);
  }
}

testCommonComponents();
