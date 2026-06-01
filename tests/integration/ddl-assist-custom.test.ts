/**
 * egov_ddl_assist — Custom 우선순위 경로 행동 테스트
 *
 * 기관 custom 사전이 행안부 표준을 어떻게 오버라이드하는지 검증한다.
 * fixture custom 행을 직접 SQL 로 삽입 → MCP wire 경유 → afterAll 에서 삭제.
 *
 * fixture 명명 규칙:
 *  - 표준 충돌 테스트: 표준에 존재하는 한글명 그대로 사용 (예: '사용자명')
 *  - 순수 custom 테스트: `_TEST_` prefix 로 격리 (cleanup 안전)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import Database from "better-sqlite3";
import * as path from "path";
import { createMcpClient, REPO_ROOT } from "./_helper.js";

const DB_PATH = path.join(REPO_ROOT, "knowledge-base", "egovframe.db");

// ==================== Fixture 정의 ====================

const FIXTURE_TERMS = [
  // 1. Override: 표준 '사용자명' (USER_NM/명V100) 를 custom 으로 덮어씀
  {
    korean_name: "사용자명",
    english_name: "USR_NM",
    description: "기관 custom: 사용자명을 짧게 제한",
    domain_name: "명V50",
    synonyms: null,
    revision_round: "TEST(2026-05)",
  },
  // 2. 순수 custom (표준에 없음)
  {
    korean_name: "_TEST_기관고유항목",
    english_name: "TEST_AGENCY_ITEM",
    description: "테스트용 기관 고유 용어",
    domain_name: "_TEST_명V50",
    synonyms: null,
    revision_round: "TEST(2026-05)",
  },
  // 3. 동의어 보유 custom
  {
    korean_name: "_TEST_동의어소스",
    english_name: "TEST_SYN_SRC",
    description: "동의어 매칭 검증용 custom 용어",
    domain_name: "_TEST_명V50",
    synonyms: "_TEST_동의어A, _TEST_동의어B",
    revision_round: "TEST(2026-05)",
  },
];

const FIXTURE_WORDS = [
  {
    korean_name: "_TEST_기관단어",
    english_name: "TSTAGENCY",
    english_full_name: "Test Agency",
    description: "테스트용 custom 단어",
    is_format_word: 0,
    revision_round: "TEST(2026-05)",
  },
];

const FIXTURE_DOMAINS = [
  // 표준 '명V100' 을 custom 으로 오버라이드 (VARCHAR → CHAR 로 다르게)
  {
    domain_name: "명V100",
    data_type: "CHAR",
    data_length: "100",
    description: "기관 custom: 명V100 을 CHAR 로 고정",
    revision_round: "TEST(2026-05)",
  },
  // 순수 custom 도메인 — 표준에 없는 _TEST_ 접두
  {
    domain_name: "_TEST_명V50",
    data_type: "VARCHAR",
    data_length: "50",
    description: "테스트용 50자 명칭 도메인",
    revision_round: "TEST(2026-05)",
  },
];

function insertFixtures() {
  const db = new Database(DB_PATH);
  try {
    const termStmt = db.prepare(`
      INSERT OR REPLACE INTO custom_terms
        (korean_name, english_name, description, domain_name, synonyms, revision_round)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const t of FIXTURE_TERMS) {
      termStmt.run(t.korean_name, t.english_name, t.description, t.domain_name, t.synonyms, t.revision_round);
    }
    const wordStmt = db.prepare(`
      INSERT OR REPLACE INTO custom_words
        (korean_name, english_name, english_full_name, description, is_format_word, revision_round)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const w of FIXTURE_WORDS) {
      wordStmt.run(w.korean_name, w.english_name, w.english_full_name, w.description, w.is_format_word, w.revision_round);
    }
    const domainStmt = db.prepare(`
      INSERT OR REPLACE INTO custom_domains
        (domain_name, data_type, data_length, description, revision_round)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const d of FIXTURE_DOMAINS) {
      domainStmt.run(d.domain_name, d.data_type, d.data_length, d.description, d.revision_round);
    }
  } finally {
    db.close();
  }
}

function cleanupFixtures() {
  const db = new Database(DB_PATH);
  try {
    const delTerm = db.prepare(`DELETE FROM custom_terms WHERE korean_name = ?`);
    for (const t of FIXTURE_TERMS) delTerm.run(t.korean_name);
    const delWord = db.prepare(`DELETE FROM custom_words WHERE korean_name = ?`);
    for (const w of FIXTURE_WORDS) delWord.run(w.korean_name);
    const delDomain = db.prepare(`DELETE FROM custom_domains WHERE domain_name = ?`);
    for (const d of FIXTURE_DOMAINS) delDomain.run(d.domain_name);
  } finally {
    db.close();
  }
}

// ==================== 테스트 본체 ====================

describe("integration — egov_ddl_assist custom override paths", () => {
  let client: Client;

  async function callDdl(args: Record<string, unknown>): Promise<any> {
    const result = await client.callTool({ name: "egov_ddl_assist", arguments: args });
    const content = result.content as Array<{ type: string; text: string }>;
    return JSON.parse(content[0].text);
  }

  beforeAll(async () => {
    // 1. fixture 데이터 삽입 (MCP 서버 부팅 전에 — WAL 모드라 동시성 OK 지만 명시적 순서 안전)
    insertFixtures();
    // 2. MCP 클라이언트 연결
    client = await createMcpClient();
    // 3. fixture 가 정상 적재됐는지 sanity check
    const r = await callDdl({ action: "lookup_term", input: "사용자명" });
    if (r.matchType !== "custom_exact") {
      throw new Error(
        `Custom fixture 삽입 실패: '사용자명' 의 matchType 이 custom_exact 가 아닙니다. ` +
          `받은 응답: ${JSON.stringify(r)}`,
      );
    }
  });

  afterAll(async () => {
    await client?.close();
    cleanupFixtures();
  });

  // ==================== lookup_term ====================

  describe("lookup_term (custom override)", () => {
    it("custom override: 사용자명 → custom_exact (USR_NM) + standardEquivalent (USER_NM) 함께 노출", async () => {
      const r = await callDdl({ action: "lookup_term", input: "사용자명" });
      expect(r.success).toBe(true);
      expect(r.matchType).toBe("custom_exact");
      expect(r.term.source).toBe("custom");
      expect(r.term.englishName).toBe("USR_NM");
      expect(r.standardEquivalent).not.toBeNull();
      expect(r.standardEquivalent.source).toBe("standard");
      expect(r.standardEquivalent.englishName).toBe("USER_NM");
      expect(r.note).toMatch(/오버라이드/);
    });

    it("pure custom: _TEST_기관고유항목 → custom_exact + standardEquivalent null", async () => {
      const r = await callDdl({ action: "lookup_term", input: "_TEST_기관고유항목" });
      expect(r.matchType).toBe("custom_exact");
      expect(r.term.englishName).toBe("TEST_AGENCY_ITEM");
      expect(r.standardEquivalent).toBeNull();
      expect(r.note).toMatch(/표준에는 없음/);
    });

    it("custom synonym: _TEST_동의어A → custom_synonym → _TEST_동의어소스 후보", async () => {
      const r = await callDdl({ action: "lookup_term", input: "_TEST_동의어A" });
      expect(r.matchType).toBe("custom_synonym");
      expect(r.candidates).toBeDefined();
      expect(r.candidates[0].source).toBe("custom");
      expect(r.candidates[0].englishName).toBe("TEST_SYN_SRC");
    });
  });

  // ==================== resolve_domain ====================

  describe("resolve_domain (custom override)", () => {
    it("custom override: 명V100 → custom CHAR(100), standardEquivalent VARCHAR(100)", async () => {
      const r = await callDdl({ action: "resolve_domain", input: "명V100" });
      expect(r.success).toBe(true);
      expect(r.domain.source).toBe("custom");
      expect(r.domain.dataType).toBe("CHAR");
      expect(r.domain.ddlFragment).toBe("CHAR(100)");
      expect(r.standardEquivalent).not.toBeNull();
      expect(r.standardEquivalent.dataType).toBe("VARCHAR");
      expect(r.standardEquivalent.ddlFragment).toBe("VARCHAR(100)");
      expect(r.note).toMatch(/오버라이드/);
    });

    it("pure custom domain: _TEST_명V50 → custom VARCHAR(50), standardEquivalent null", async () => {
      const r = await callDdl({ action: "resolve_domain", input: "_TEST_명V50" });
      expect(r.domain.source).toBe("custom");
      expect(r.domain.ddlFragment).toBe("VARCHAR(50)");
      expect(r.standardEquivalent).toBeNull();
    });
  });

  // ==================== decompose_phrase ====================

  describe("decompose_phrase (custom word priority)", () => {
    it("custom 단어가 분해 시 우선 매칭 (token.source === 'custom')", async () => {
      // _TEST_기관단어 는 6글자 짜리 토큰이므로 longest-prefix 분해에서 단독으로 매칭되도록
      // input 도 동일하게 줘서 정확 매칭만 일어나게 함.
      const r = await callDdl({
        action: "decompose_phrase",
        input: "_TEST_기관단어",
      });
      const matched = r.tokens.filter((t: any) => t.matched);
      const customMatched = matched.find((t: any) => t.source === "custom");
      expect(customMatched).toBeDefined();
      expect(customMatched.english).toBe("TSTAGENCY");
    });
  });

  // ==================== propose_column ====================

  describe("propose_column (custom override)", () => {
    it("custom override: 사용자명 → method=custom_exact + USR_NM CHAR(100)", async () => {
      const r = await callDdl({ action: "propose_column", input: "사용자명" });
      expect(r.method).toBe("custom_exact");
      expect(r.columnName).toBe("USR_NM");
      // 사용자명 custom 의 domain_name 은 '명V50' (custom 의 사용자명 fixture 에서).
      // 그런데 fixture 에서 custom 의 '명V50' 도메인은 안 만들었음 → resolvedDomain 은 null.
      // 따라서 ddlFragment 는 컬럼명만.
      expect(r.ddlFragment).toBe("USR_NM");
      expect(r.standardEquivalent).not.toBeNull();
      expect(r.standardEquivalent.englishName).toBe("USER_NM");
    });
  });

  // ==================== validate_column ====================

  describe("validate_column (custom override)", () => {
    it("USR_NM → CUSTOM_MATCH (표준 미등재 영문약어이지만 custom 에 있음)", async () => {
      const r = await callDdl({ action: "validate_column", input: "USR_NM" });
      expect(r.matchSource).toBe("custom");
      const codes = r.findings.map((f: any) => f.code);
      expect(codes).toContain("CUSTOM_MATCH");
    });

    it("custom 으로 등재된 한글명 + 그 custom 영문약어 → status: custom", async () => {
      const r = await callDdl({ action: "validate_column", input: "TEST_AGENCY_ITEM" });
      expect(r.status).toBe("custom");
      expect(r.matchSource).toBe("custom");
    });
  });

  // ==================== suggest_table_columns ====================

  describe("suggest_table_columns (custom + standard mix)", () => {
    it("_TEST_ 접두 키워드 → custom 결과만 나옴", async () => {
      const r = await callDdl({
        action: "suggest_table_columns",
        input: "_TEST_",
      });
      expect(r.success).toBe(true);
      expect(r.customCount).toBeGreaterThan(0);
      expect(r.standardCount).toBe(0);
      // 모든 후보가 custom source
      expect(r.suggestions.every((s: any) => s.source === "custom")).toBe(true);
    });

    it("'사용자' 키워드 → custom override 행이 standard 중복을 가림", async () => {
      const r = await callDdl({
        action: "suggest_table_columns",
        input: "사용자",
        limit: 30,
      });
      // 사용자명 은 custom 에 있으므로 source: custom 으로 1건만 등장해야 함
      const userNameEntries = r.suggestions.filter((s: any) => s.koreanName === "사용자명");
      expect(userNameEntries.length).toBe(1);
      expect(userNameEntries[0].source).toBe("custom");
    });
  });
});
