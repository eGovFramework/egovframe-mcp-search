/**
 * egov_ddl_assist behavioral integration test
 *
 * MCP wire 를 경유하여 6개 action 의 핵심 시나리오를 검증한다.
 * 사용자 DB (knowledge-base/egovframe.db) 의 표준 용어/단어/도메인 데이터에 의존하므로
 * beforeAll 에서 sanity check ('사용자명' → 'USER_NM') 가 실패하면
 * "npm run build-index 를 먼저 실행하세요" 안내와 함께 즉시 중단된다.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createMcpClient } from "./_helper.js";

describe("integration — egov_ddl_assist behavior", () => {
  let client: Client;

  /** 도구 호출 + content[0].text JSON 파싱 wrapper. */
  async function callDdl(args: Record<string, unknown>): Promise<any> {
    const result = await client.callTool({
      name: "egov_ddl_assist",
      arguments: args,
    });
    const content = result.content as Array<{ type: string; text: string }>;
    if (!content || content.length === 0 || typeof content[0].text !== "string") {
      throw new Error(`예상치 못한 응답 모양: ${JSON.stringify(result)}`);
    }
    return JSON.parse(content[0].text);
  }

  beforeAll(async () => {
    client = await createMcpClient();

    // Sanity: 표준 데이터 적재 여부 확인.
    const seed = await callDdl({ action: "lookup_term", input: "사용자명" });
    if (!seed.success || seed.matchType !== "exact") {
      throw new Error(
        "표준 용어 '사용자명' 이 DB 에 없습니다. 'npm run build-index -- --yes' 를 먼저 실행하세요.\n" +
          `(받은 응답: ${JSON.stringify(seed)})`,
      );
    }
  });

  afterAll(async () => {
    await client?.close();
  });

  // ==================== lookup_term ====================

  describe("lookup_term", () => {
    it("정확 매칭: 사용자명 → USER_NM (도메인 명V100, VARCHAR(100))", async () => {
      const r = await callDdl({ action: "lookup_term", input: "사용자명" });
      expect(r.success).toBe(true);
      expect(r.matchType).toBe("exact");
      expect(r.term.englishName).toBe("USER_NM");
      expect(r.term.domainName).toBe("명V100");
      expect(r.term.resolvedDomain).not.toBeNull();
      expect(r.term.resolvedDomain.dataType).toBe("VARCHAR");
      expect(r.term.resolvedDomain.dataLength).toBe("100");
      expect(r.term.resolvedDomain.ddlFragment).toBe("VARCHAR(100)");
    });

    it("동의어 매칭: 사용자이름 → 사용자명 (USER_NM) 후보", async () => {
      const r = await callDdl({ action: "lookup_term", input: "사용자이름" });
      expect(r.success).toBe(true);
      expect(r.matchType).toBe("synonym");
      expect(Array.isArray(r.candidates)).toBe(true);
      expect(r.candidates.length).toBeGreaterThan(0);
      expect(r.candidates[0].englishName).toBe("USER_NM");
      expect(r.note).toMatch(/표준명/);
    });

    it("미등재 용어 → matchType: none, success: false", async () => {
      const r = await callDdl({
        action: "lookup_term",
        input: "_절대존재안하는용어zzz",
      });
      expect(r.success).toBe(false);
      expect(r.matchType).toBe("none");
    });
  });

  // ==================== decompose_phrase ====================

  describe("decompose_phrase", () => {
    it("신규사용자등록일자 → 4개 토큰 + NEW_USER_REG_YMD", async () => {
      const r = await callDdl({
        action: "decompose_phrase",
        input: "신규사용자등록일자",
      });
      expect(r.success).toBe(true);
      expect(r.suggestedColumnName).toBe("NEW_USER_REG_YMD");
      expect(r.unmatchedSegments).toEqual([]);
      const matched = r.tokens.filter((t: any) => t.matched);
      expect(matched).toHaveLength(4);
      expect(matched.map((t: any) => t.korean)).toEqual(["신규", "사용자", "등록", "일자"]);
      expect(matched.map((t: any) => t.english)).toEqual(["NEW", "USER", "REG", "YMD"]);
    });

    it("주문상품금액 → 마지막 토큰 '금액' 이 형식단어로 표시", async () => {
      const r = await callDdl({
        action: "decompose_phrase",
        input: "주문상품금액",
      });
      expect(r.suggestedColumnName).toBe("ORDR_GDS_AMT");
      const last = r.tokens[r.tokens.length - 1];
      expect(last.korean).toBe("금액");
      expect(last.isFormatWord).toBe(true);
    });
  });

  // ==================== resolve_domain ====================

  describe("resolve_domain", () => {
    it("명V100 → VARCHAR(100)", async () => {
      const r = await callDdl({ action: "resolve_domain", input: "명V100" });
      expect(r.success).toBe(true);
      expect(r.domain.dataType).toBe("VARCHAR");
      expect(r.domain.dataLength).toBe("100");
      expect(r.domain.ddlFragment).toBe("VARCHAR(100)");
    });

    it("금액N15 → NUMERIC(15)", async () => {
      const r = await callDdl({ action: "resolve_domain", input: "금액N15" });
      expect(r.success).toBe(true);
      expect(r.domain.dataType).toBe("NUMERIC");
      expect(r.domain.dataLength).toBe("15");
      expect(r.domain.ddlFragment).toBe("NUMERIC(15)");
    });

    it("미등재 도메인 → success: false", async () => {
      const r = await callDdl({
        action: "resolve_domain",
        input: "절대없는도메인xyz",
      });
      expect(r.success).toBe(false);
    });
  });

  // ==================== propose_column ====================

  describe("propose_column", () => {
    it("exact: 사용자명 → confidence 1.0 + 'USER_NM VARCHAR(100)' fragment", async () => {
      const r = await callDdl({ action: "propose_column", input: "사용자명" });
      expect(r.method).toBe("exact");
      expect(r.confidence).toBe(1.0);
      expect(r.columnName).toBe("USER_NM");
      expect(r.ddlFragment).toBe("USER_NM VARCHAR(100)");
    });

    it("synonym: 사용자이름 → 표준명 권장 note + USER_NM", async () => {
      const r = await callDdl({ action: "propose_column", input: "사용자이름" });
      expect(r.method).toBe("synonym");
      expect(r.confidence).toBeCloseTo(0.85, 2);
      expect(r.columnName).toBe("USER_NM");
      expect(r.note).toMatch(/사용자명/);
    });

    it("composed (hint 없음): NEW_USER_REG_YMD + domainHint 안내", async () => {
      const r = await callDdl({
        action: "propose_column",
        input: "신규사용자등록일자",
      });
      expect(r.method).toBe("composed");
      expect(r.columnName).toBe("NEW_USER_REG_YMD");
      expect(r.confidence).toBeLessThan(0.85);
      expect(r.note).toMatch(/domainHint/);
      expect(r.ddlFragment).toBe("NEW_USER_REG_YMD"); // SQL 타입 없음
    });

    it("composed + 유효 hint (연월일C8): 'NEW_USER_REG_YMD CHAR(8)'", async () => {
      const r = await callDdl({
        action: "propose_column",
        input: "신규사용자등록일자",
        domainHint: "연월일C8",
      });
      expect(r.method).toBe("composed");
      expect(r.ddlFragment).toBe("NEW_USER_REG_YMD CHAR(8)");
      expect(r.inferredDomain).not.toBeNull();
      expect(r.inferredDomain.ddlFragment).toBe("CHAR(8)");
    });

    it("composed + 잘못된 hint: inferredDomain null + 친절한 안내", async () => {
      const r = await callDdl({
        action: "propose_column",
        input: "신규사용자등록일자",
        domainHint: "절대없는도메인xyz",
      });
      expect(r.inferredDomain).toBeNull();
      expect(r.note).toMatch(/도메인 사전 어디에도 없습니다/);
    });
  });

  // ==================== validate_column ====================

  describe("validate_column", () => {
    it("USER_NM + VARCHAR(100) → standard / ok / TYPE_OK", async () => {
      const r = await callDdl({
        action: "validate_column",
        input: "USER_NM",
        sqlType: "VARCHAR(100)",
      });
      expect(r.status).toBe("standard");
      expect(r.typeStatus).toBe("ok");
      const codes = r.findings.map((f: any) => f.code);
      expect(codes).toContain("EXACT_MATCH");
      expect(codes).toContain("TYPE_OK");
    });

    it("USER_NM + VARCHAR(50) → type_mismatch (길이 불일치)", async () => {
      const r = await callDdl({
        action: "validate_column",
        input: "USER_NM",
        sqlType: "VARCHAR(50)",
      });
      expect(r.status).toBe("type_mismatch");
      expect(r.typeStatus).toBe("mismatch");
      const mismatchFinding = r.findings.find((f: any) => f.code === "TYPE_MISMATCH");
      expect(mismatchFinding).toBeDefined();
      expect(mismatchFinding.level).toBe("error");
      expect(mismatchFinding.message).toMatch(/길이 불일치/);
    });

    it("USER_NM + CHAR(100) → type_mismatch (타입 불일치)", async () => {
      const r = await callDdl({
        action: "validate_column",
        input: "USER_NM",
        sqlType: "CHAR(100)",
      });
      expect(r.status).toBe("type_mismatch");
      const finding = r.findings.find((f: any) => f.code === "TYPE_MISMATCH");
      expect(finding.message).toMatch(/데이터 타입 불일치/);
    });

    it("USR_NM_미등재xyz → non_standard", async () => {
      const r = await callDdl({
        action: "validate_column",
        input: "USR_NM_미등재xyz",
        sqlType: "VARCHAR(100)",
      });
      expect(r.status).toBe("non_standard");
      expect(r.success).toBe(false);
      const codes = r.findings.map((f: any) => f.code);
      expect(codes).toContain("NON_STANDARD_NAME");
    });

    it("USER_NM (sqlType 생략) → standard / skipped", async () => {
      const r = await callDdl({ action: "validate_column", input: "USER_NM" });
      expect(r.status).toBe("standard");
      expect(r.typeStatus).toBe("skipped");
    });

    it("USER_NM + 파싱 불가 sqlType → UNPARSEABLE_SQL_TYPE finding", async () => {
      const r = await callDdl({
        action: "validate_column",
        input: "USER_NM",
        sqlType: "garbage type !!!",
      });
      expect(r.typeStatus).toBe("unknown");
      const codes = r.findings.map((f: any) => f.code);
      expect(codes).toContain("UNPARSEABLE_SQL_TYPE");
    });
  });

  // ==================== suggest_table_columns ====================

  describe("suggest_table_columns", () => {
    it("게시판 → BBS_ 접두 후보 다수", async () => {
      const r = await callDdl({
        action: "suggest_table_columns",
        input: "게시판",
        limit: 10,
      });
      expect(r.success).toBe(true);
      expect(r.total).toBeGreaterThan(0);
      expect(r.suggestions.some((s: any) => s.englishName.startsWith("BBS_"))).toBe(true);
      // 각 후보에 ddlFragment 가 포함되는지
      expect(r.suggestions[0].ddlFragment).toBeTruthy();
    });

    it("매칭 없는 키워드 → success: false / total: 0", async () => {
      const r = await callDdl({
        action: "suggest_table_columns",
        input: "_절대없는개념zzz",
      });
      expect(r.success).toBe(false);
      expect(r.total).toBe(0);
      expect(Array.isArray(r.suggestions)).toBe(true);
      expect(r.suggestions).toHaveLength(0);
    });
  });

  // ==================== error handling ====================

  describe("error handling", () => {
    it("미지원 action → success: false + 안내 메시지", async () => {
      const r = await callDdl({ action: "unknown_action_zzz", input: "test" });
      expect(r.success).toBe(false);
      expect(r.message).toMatch(/알 수 없는 action/);
    });

    it("빈 input → success: false", async () => {
      const r = await callDdl({ action: "lookup_term", input: "" });
      expect(r.success).toBe(false);
    });
  });
});
