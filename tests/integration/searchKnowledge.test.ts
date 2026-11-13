/**
 * egov_search_knowledge 호출 동작 통합 테스트
 *
 * 빌드된 서버(build/index.js)를 stdio 로 띄우고, 저장소에 동봉된 지식베이스
 * (knowledge-base/egovframe.db, templates/common-components-src)에 대해
 * scope/action 라우팅과 입력 검증이 문서화된 대로 동작하는지 검증한다.
 *
 * server.test.ts 가 "무엇이 노출되는가"를 고정한다면, 이 파일은
 * "노출된 도구를 호출하면 무엇이 돌아오는가"를 고정한다.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import {
  REPO_ROOT,
  callSearchKnowledge,
  createMcpClient,
  hasComponentSources,
  hasEmbeddingModel,
} from "./_helper.js";

describe("integration — egov_search_knowledge components action 라우팅", () => {
  let client: Client;

  beforeAll(async () => {
    client = await createMcpClient();
  });

  afterAll(async () => {
    await client?.close();
  });

  const search = (args: Record<string, unknown>) => callSearchKnowledge(client, args);

  /** 상세 조회 화면에만 나오는 표지 */
  const DETAIL_MARKER = "### 기본 정보";

  it("action 없이 componentId 만 주면 상세 정보를 반환한다", async () => {
    const res = await search({ scope: "components", filters: { componentId: "bbs" } });
    expect(res.isError).toBe(false);
    expect(res.text).toContain(DETAIL_MARKER);
    expect(res.text).toContain("egovframework.com.cop.bbs");
  });

  it("action get 은 componentId 의 상세 정보를 반환한다", async () => {
    const res = await search({ scope: "components", action: "get", filters: { componentId: "bbs" } });
    expect(res.isError).toBe(false);
    expect(res.text).toContain(DETAIL_MARKER);
  });

  it("빈 문자열 action 은 지정하지 않은 것으로 처리한다", async () => {
    const res = await search({ scope: "components", action: "", filters: { componentId: "bbs" } });
    expect(res.isError).toBe(false);
    expect(res.text).toContain(DETAIL_MARKER);
  });

  it("action get 에 componentId 가 없으면 오류로 응답한다", async () => {
    const res = await search({ scope: "components", action: "get" });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("filters.componentId is required");
  });

  it.skipIf(!hasComponentSources())(
    "action ddl 은 componentId 가 있어도 상세 정보가 아니라 CREATE TABLE 문을 반환한다",
    async () => {
      const res = await search({
        scope: "components",
        action: "ddl",
        filters: { componentId: "bbs", dbType: "mysql" },
      });
      expect(res.isError).toBe(false);
      expect(res.text).not.toContain(DETAIL_MARKER);
      expect(res.text).toContain("DDL (mysql)");
      expect(res.text).toMatch(/CREATE TABLE/i);
    },
  );

  it.skipIf(!hasComponentSources())(
    "action dml 은 componentId 가 있어도 상세 정보가 아니라 INSERT 문을 반환한다",
    async () => {
      const res = await search({
        scope: "components",
        action: "dml",
        filters: { componentId: "bbs", dbType: "mysql" },
      });
      expect(res.isError).toBe(false);
      expect(res.text).not.toContain(DETAIL_MARKER);
      expect(res.text).toContain("초기 데이터 (mysql)");
      expect(res.text).toMatch(/INSERT INTO/i);
    },
  );

  it.skipIf(!hasComponentSources())(
    "action sourceFiles 는 componentId 가 있어도 상세 정보가 아니라 소스 파일 목록을 반환한다",
    async () => {
      const res = await search({
        scope: "components",
        action: "sourceFiles",
        filters: { componentId: "bbs" },
      });
      expect(res.isError).toBe(false);
      expect(res.text).not.toContain(DETAIL_MARKER);
      expect(res.text).toContain("소스 파일 목록");
      expect(res.text).toContain("src/main/java/egovframework/com/cop/bbs/");
      // 다음 단계 안내는 지금 노출된 호출 형태(action readSource)를 가리켜야 한다
      expect(res.text).toContain("readSource");
      expect(res.text).not.toContain("read_component_source");
    },
  );

  it.skipIf(!hasComponentSources())(
    "action readSource 는 componentId 를 함께 줘도 파일 내용을 반환한다",
    async () => {
      const filePath = "src/main/java/egovframework/com/cop/bbs/service/Blog.java";
      const res = await search({
        scope: "components",
        action: "readSource",
        filters: { componentId: "bbs", filePath },
      });
      expect(res.isError).toBe(false);
      expect(res.text).not.toContain(DETAIL_MARKER);
      expect(res.text).toContain(filePath);
      expect(res.text).toContain("```java");
    },
  );

  it("action dependencies 는 배열 componentIds 로 의존성을 해결한다", async () => {
    const res = await search({
      scope: "components",
      action: "dependencies",
      filters: { componentIds: ["bbs", "cmy"] },
    });
    expect(res.isError).toBe(false);
    expect(res.text).toContain("의존성 해결 결과");
    expect(res.text).toContain("egovframework.com.cop.bbs");
  });

  it("action dependencies 는 단수형 componentId 도 받아 의존성을 해결한다", async () => {
    const res = await search({
      scope: "components",
      action: "dependencies",
      filters: { componentId: "bbs" },
    });
    expect(res.isError).toBe(false);
    expect(res.text).not.toContain(DETAIL_MARKER);
    expect(res.text).toContain("의존성 해결 결과");
  });

  it("action dependencies 에 컴포넌트 지정이 없으면 오류로 응답한다", async () => {
    const res = await search({ scope: "components", action: "dependencies" });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("filters.componentIds");
  });

  it.skipIf(!hasComponentSources())(
    "componentId 별칭(filters.id)은 상세 조회 외의 action 에서도 인식된다",
    async () => {
      const res = await search({
        scope: "components",
        action: "ddl",
        filters: { id: "bbs", dbType: "mysql" },
      });
      expect(res.isError).toBe(false);
      expect(res.text).toContain("DDL (mysql)");
    },
  );

  it("지원하지 않는 action 은 목록으로 넘어가지 않고 오류로 응답한다", async () => {
    const res = await search({ scope: "components", action: "schema" });
    expect(res.isError).toBe(true);
    // 오류 메시지가 지원 action 을 알려 줘서 LLM 이 스스로 교정할 수 있어야 한다
    expect(res.text).toContain("sourceFiles");
    expect(res.text).not.toContain("공통컴포넌트 카테고리");
  });

  it("Object.prototype 의 속성 이름을 action 으로 줘도 오류로 응답한다", async () => {
    for (const action of ["constructor", "toString", "__proto__"]) {
      const res = await search({ scope: "components", action });
      expect(res.isError, `action=${action}`).toBe(true);
    }
  });
});

describe("integration — egov_search_knowledge 가이드 검색", () => {
  let client: Client;

  beforeAll(async () => {
    client = await createMcpClient();
  });

  afterAll(async () => {
    await client?.close();
  });

  it.skipIf(!hasEmbeddingModel())("결과의 URL 은 가이드 사이트의 문서 주소를 가리킨다", async () => {
    const res = await callSearchKnowledge(client, { scope: "guide", query: "MyBatis 설정 방법" });
    expect(res.isError).toBe(false);
    expect(res.text).toMatch(/\*\*URL\*\*: https:\/\/egovframework\.github\.io\/egovframe-docs\/[a-z0-9_-]+\//);
    expect(res.text).not.toContain("doku.php");
  });
});

describe("integration — egov_search_knowledge 가이드 검색 결과의 형식", () => {
  let client: Client;

  beforeAll(async () => {
    client = await createMcpClient();
  });

  afterAll(async () => {
    await client?.close();
  });

  const search = (args: Record<string, unknown>) => callSearchKnowledge(client, args);

  /** 코드 블록 밖의 줄만 고른다. */
  const linesOutsideFences = (text: string): string[] => {
    const lines: string[] = [];
    let inFence = false;
    for (const line of text.split("\n")) {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        continue;
      }
      if (!inFence) lines.push(line);
    }
    return lines;
  };

  it.skipIf(!hasEmbeddingModel())("본문 속의 제목과 구분선이 결과의 제목·구분선과 섞이지 않는다", async () => {
    // 이 문서의 본문에는 '### 1. 로그인 하기' 같은 제목이 들어 있다
    const res = await search({
      scope: "guide",
      query: "Nexus 사용법 로그인 Repository 추가 artifact 등록",
      limit: 3,
    });
    expect(res.isError).toBe(false);
    const outside = linesOutsideFences(res.text);

    const headings = outside.filter((line) => /^#{1,6}\s/.test(line));
    expect(headings.filter((line) => !/^## eGovFrame 가이드 검색 결과|^### \d+\. /.test(line))).toEqual([]);
    expect(headings.filter((line) => /^### \d+\. /.test(line))).toHaveLength(3);
    // 결과 사이의 구분선은 결과 수보다 하나 적다
    expect(outside.filter((line) => line.trim() === "---")).toHaveLength(2);
  });

  it.skipIf(!hasEmbeddingModel())("본문을 자를 때 열려 있는 코드 블록을 닫는다", async () => {
    for (const query of ["MyBatis 설정 방법", "JEUS 설정", "트랜잭션 설정 XML", "스케줄링 설정"]) {
      const res = await search({ scope: "guide", query, limit: 5 });
      expect(res.isError, query).toBe(false);
      const fences = res.text.split("\n").filter((line) => /^\s*```/.test(line));
      expect(fences.length % 2, `${query}: 코드 펜스 ${fences.length}개`).toBe(0);
    }
  });

  it.skipIf(!hasEmbeddingModel())("본문이 같은 청크는 한 번만 싣는다", async () => {
    // cache.md 와 cache-ehcache.md 는 같은 본문의 절을 갖고 있다
    const res = await search({
      scope: "guide",
      query: "Cache Size Device 설정 메모리 최대 오브젝트 수",
      limit: 5,
    });
    expect(res.isError).toBe(false);
    const bodies = res.text
      .split("\n\n---\n\n")
      .map((block) => block.split("\n\n").slice(1).join("\n\n").replace(/\s+/g, " ").trim())
      .filter((body) => body.length > 0);
    expect(bodies.length).toBeGreaterThan(1);
    expect(new Set(bodies).size).toBe(bodies.length);
  });

  describe("잘린 본문 이어 읽기 (filters.chunkId)", () => {
    /** 동봉 가이드 인덱스에서 본문이 가장 긴 청크를 직접 읽는다 (도구를 거치지 않는다). */
    async function longestChunk(): Promise<{ id: string; content: string; title: string }> {
      const lancedb = await import("@lancedb/lancedb");
      const table = await (await lancedb.connect(path.join(REPO_ROOT, "knowledge-base"))).openTable("egovframe_guide");
      const rows = (await table.query().select(["id", "title", "content"]).toArray()) as Array<{
        id: string;
        title: string;
        content: string;
      }>;
      return rows.reduce((longest, row) => (row.content.length > longest.content.length ? row : longest));
    }

    it("chunkId 를 주면 query 없이 그 청크의 본문을 offset 부터 돌려주고 다음 offset 을 알려 준다", async () => {
      const chunk = await longestChunk();
      expect(chunk.content.length).toBeGreaterThan(20_000);

      const first = await search({ scope: "guide", filters: { chunkId: chunk.id } });
      expect(first.isError).toBe(false);
      expect(first.text).toContain(chunk.title);
      expect(first.text).toMatch(/전체 [\d,]+자 중 1~6,000자/);
      expect(first.text).toContain("filters.offset: 6000");

      const middle = await search({ scope: "guide", filters: { chunkId: chunk.id, offset: 12000 } });
      expect(middle.isError).toBe(false);
      expect(middle.text).toMatch(/전체 [\d,]+자 중 12,001~18,000자/);
      // 원문에서 그 자리에 있는 문장이 응답에 들어 있다 (제목·구분선이 아닌 평범한 줄을 고른다)
      const plainLine = chunk.content
        .substring(12000, 18000)
        .split("\n")
        .find((line) => line.trim().length > 20 && !/^\s*(#|-{3,}|`{3,}|\|)/.test(line));
      expect(plainLine).toBeDefined();
      expect(middle.text).toContain(plainLine!.trim());
    });

    it("scope 를 생략해도 chunkId 만으로 가이드 청크를 읽는다", async () => {
      const chunk = await longestChunk();
      const res = await search({ filters: { chunkId: chunk.id, offset: 6000 } });
      expect(res.isError).toBe(false);
      expect(res.text).toMatch(/전체 [\d,]+자 중 6,001~12,000자/);
    });

    it("청크를 이어 읽을 때 함께 준 query 와 limit 은 쓰이지 않았다고 알린다", async () => {
      const chunk = await longestChunk();
      const res = await search({ scope: "guide", query: "트랜잭션", limit: 3, filters: { chunkId: chunk.id } });
      expect(res.isError).toBe(false);
      const note = res.text.split("\n").find((line) => line.includes("쓰이지 않아 무시한 파라미터")) ?? "";
      expect(note).toContain("query");
      expect(note).toContain("limit");
    });

    it("없는 chunkId 는 다시 검색하라는 안내로 답한다", async () => {
      const res = await search({ scope: "guide", filters: { chunkId: "00000000-0000-0000-0000-000000000000" } });
      expect(res.isError).toBe(true);
      expect(res.text).toContain("chunkId");
      expect(res.text).toContain("다시 검색");
    });

    it.skipIf(!hasEmbeddingModel())("검색 결과의 본문이 잘리면 이어 읽는 방법을 chunkId 와 함께 알려 준다", async () => {
      const res = await search({
        scope: "guide",
        query: "받은쪽지함관리 컴포넌트의 배포파일명과 포함 테이블",
        limit: 5,
      });
      expect(res.isError).toBe(false);
      const note = res.text.match(/전체 ([\d,]+)자 중 1~1,500자를 표시했습니다[^\n]*filters\.chunkId: "([0-9a-f-]{36})"[^\n]*filters\.offset: 1500/);
      expect(note).not.toBeNull();
      expect(res.text).not.toContain("... (truncated)");

      const next = await search({ scope: "guide", filters: { chunkId: note![2], offset: 1500 } });
      expect(next.isError).toBe(false);
      expect(next.text).toMatch(/전체 [\d,]+자 중 1,501~/);
    });
  });

  it.skipIf(!hasEmbeddingModel())("category 가 없는 문서는 분류에 layer 만 적는다", async () => {
    const res = await search({ scope: "guide", query: "시작하기 가이드 문서 구성", filters: { layer: "gettingstarted.md" } });
    expect(res.isError).toBe(false);
    expect(res.text).toContain("- **분류**: gettingstarted.md\n");
    expect(res.text).not.toContain("gettingstarted.md > \n");
  });
});

describe("integration — egov_search_knowledge scope 추론", () => {
  let client: Client;

  beforeAll(async () => {
    client = await createMcpClient();
  });

  afterAll(async () => {
    await client?.close();
  });

  const search = (args: Record<string, unknown>) => callSearchKnowledge(client, args);

  /** 통합 검색(scope all)으로 처리됐을 때만 나오는 표지 */
  const ALL_MARKER = "통합 지식 검색 결과";
  /** 공통컴포넌트 카테고리 개요에만 나오는 표지 */
  const OVERVIEW_MARKER = "공통컴포넌트 카테고리";
  /** 호환 소프트웨어 검색 결과에만 나오는 표지 */
  const COMPAT_MARKER = "호환 소프트웨어 검색 결과";

  it.skipIf(!hasComponentSources())(
    "scope 없이 action 을 주면 query 가 있어도 components 로 처리한다",
    async () => {
      const res = await search({
        query: "게시판",
        action: "ddl",
        filters: { componentId: "bbs", dbType: "mysql" },
      });
      expect(res.isError).toBe(false);
      expect(res.text).toContain("DDL (mysql)");
      expect(res.text).not.toContain(ALL_MARKER);
    },
  );

  it("scope 없이 준 action 의 필수 필터가 빠지면 통합 검색에 묻히지 않고 오류로 응답한다", async () => {
    const res = await search({ query: "설정", action: "sourceFiles" });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("filters.componentId is required");
  });

  it("호환성 전용 필터만 주면 compatibility 로 처리한다", async () => {
    const res = await search({ filters: { minLevel: 2 } });
    expect(res.isError).toBe(false);
    expect(res.text).toContain(COMPAT_MARKER);
    expect(res.text).not.toContain(OVERVIEW_MARKER);
  });

  it("호환 소프트웨어 분류 이름을 category 로 주면 compatibility 로 처리한다", async () => {
    const res = await search({ filters: { category: "WAS" } });
    expect(res.isError).toBe(false);
    expect(res.text).toContain(COMPAT_MARKER);
  });

  it("가이드 전용 필터(layer)는 query 가 없으면 가이드 검색의 query 필수 오류로 응답한다", async () => {
    const res = await search({ filters: { layer: "egovframe-runtime" } });
    expect(res.isError).toBe(true);
    expect(res.text).toBe("query is required for guide search");
  });

  it("지식 전용 필터(tags)는 query 가 없으면 지식 검색의 query 필수 오류로 응답한다", async () => {
    const res = await search({ filters: { tags: ["faq"] } });
    expect(res.isError).toBe(true);
    expect(res.text).toBe("query is required for knowledge search");
  });

  it.skipIf(!hasEmbeddingModel())("layer 필터와 query 를 주면 가이드만 검색한다", async () => {
    const res = await search({ query: "트랜잭션 설정", filters: { layer: "egovframe-runtime" } });
    expect(res.isError).toBe(false);
    expect(res.text).toContain("eGovFrame 가이드 검색 결과");
    expect(res.text).not.toContain(ALL_MARKER);
  });

  it.skipIf(!hasEmbeddingModel())("가이드 분류 이름을 category 로 주면 가이드만 검색한다", async () => {
    const res = await search({ query: "트랜잭션 설정", filters: { category: "persistence-layer" } });
    expect(res.isError).toBe(false);
    expect(res.text).toContain("eGovFrame 가이드 검색 결과");
    expect(res.text).not.toContain(ALL_MARKER);
  });

  it("효과가 없는 기본값을 채운 필터는 출처를 정하지 않는다", async () => {
    // 쓰지 않는 필터를 기본값으로 채워 보내는 클라이언트: 필터를 주지 않은 호출과 같은 출처로 가야 한다
    const res = await search({
      filters: { includeKnowledge: false, verifiedOnly: false, sort: "relevance", minImportance: 1 },
    });
    expect(res.isError).toBe(false);
    expect(res.text).toContain(OVERVIEW_MARKER);
    expect(res.text).not.toContain(COMPAT_MARKER);
  });

  it("문자나 숫자가 하나도 없는 query 는 없는 것으로 처리한다", async () => {
    const guide = await search({ scope: "guide", query: "???" });
    expect(guide.isError).toBe(true);
    expect(guide.text).toBe("query is required for guide search");

    const auto = await search({ query: "?!" });
    expect(auto.isError).toBe(false);
    expect(auto.text).toContain(OVERVIEW_MARKER);
  });

  it("components 가 아닌 scope 에 action 을 주면 오류로 응답한다", async () => {
    for (const scope of ["guide", "knowledge", "compatibility", "all"]) {
      const res = await search({ scope, query: "게시판", action: "ddl", filters: { componentId: "bbs" } });
      expect(res.isError, `scope=${scope}`).toBe(true);
      expect(res.text, `scope=${scope}`).toContain("components");
    }
  });

  it("공백뿐인 query 는 없는 것으로 처리한다", async () => {
    const overview = await search({ query: "   " });
    expect(overview.isError).toBe(false);
    expect(overview.text).toContain(OVERVIEW_MARKER);

    const guide = await search({ scope: "guide", query: " \n\t " });
    expect(guide.isError).toBe(true);
    expect(guide.text).toBe("query is required for guide search");
  });

  it("strictScope 는 결과에 영향을 주지 않는다", async () => {
    const without = await search({ scope: "components", query: "게시판" });
    const withStrict = await search({ scope: "components", query: "게시판", strictScope: true });
    expect(withStrict.isError).toBe(false);
    expect(withStrict.text).toBe(without.text);
  });
});

describe("integration — egov_search_knowledge 입력 검증", () => {
  let client: Client;

  beforeAll(async () => {
    client = await createMcpClient();
  });

  afterAll(async () => {
    await client?.close();
  });

  const search = (args: Record<string, unknown>) => callSearchKnowledge(client, args);

  it("limit 은 1 이상의 정수만 받는다", async () => {
    for (const limit of [0, -1, 2.5]) {
      const res = await search({ scope: "components", query: "게시판", limit });
      expect(res.isError, `limit=${limit}`).toBe(true);
      expect(res.text, `limit=${limit}`).toContain("limit");
    }
  });

  it("스키마 최댓값(200)을 넘는 limit 은 거부한다", async () => {
    const res = await search({ scope: "components", query: "게시판", limit: 201 });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("limit");
  });

  it("filters.limit 에도 같은 검증을 적용한다", async () => {
    const res = await search({ scope: "components", query: "게시판", filters: { limit: -5 } });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("limit");
  });

  it("filters 의 알 수 없는 키는 무시하지 않고 거부한다", async () => {
    const res = await search({ scope: "components", filters: { componentid: "bbs" } });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("componentid");
  });

  it("filters 값의 타입이 틀리면 거부한다", async () => {
    const version = await search({ scope: "compatibility", filters: { frameworkVersion: 4.3 } });
    expect(version.isError).toBe(true);
    expect(version.text).toContain("frameworkVersion");

    const tags = await search({ scope: "knowledge", query: "설정", filters: { tags: "faq" } });
    expect(tags.isError).toBe(true);
    expect(tags.text).toContain("tags");
  });

  it("값이 null 이거나 빈 문자열인 선택 파라미터와 필터는 지정하지 않은 것으로 받는다", async () => {
    const compatibility = await search({
      scope: "compatibility",
      query: null,
      action: null,
      limit: null,
      strictScope: null,
      filters: { frameworkVersion: "4.3", vendor: null, category: null, productName: "", minLevel: null },
    });
    expect(compatibility.isError).toBe(false);
    expect(parseJsonBlock(compatibility.text).filters).toEqual({ frameworkVersion: "4.3" });

    const knowledge = await search({
      scope: "knowledge",
      filters: { sort: "recent", type: "", knowledgeScope: "", tags: null },
      limit: 1,
    });
    expect(knowledge.isError).toBe(false);
    expect(parseJsonBlock(knowledge.text).count).toBe(1);

    const emptyScope = await search({ scope: "", filters: { componentId: "uia" } });
    expect(emptyScope.isError).toBe(false);
    expect(emptyScope.text).toContain("### 기본 정보");

    const nullFilters = await search({ scope: "components", filters: null });
    expect(nullFilters.isError).toBe(false);
    expect(nullFilters.text).toContain("공통컴포넌트 카테고리");
  });

  it("지나치게 긴 값은 입력 검증 오류로 거부한다", async () => {
    const longQuery = await search({ scope: "components", query: "가".repeat(10_001) });
    expect(longQuery.isError).toBe(true);
    expect(longQuery.text).toContain("query");

    const longFilter = await search({ scope: "compatibility", filters: { vendor: "a".repeat(501) } });
    expect(longFilter.isError).toBe(true);
    expect(longFilter.text).toContain("vendor");

    const manyTags = await search({
      scope: "knowledge",
      query: "설정",
      filters: { tags: Array.from({ length: 21 }, (_, i) => `t${i}`) },
    });
    expect(manyTags.isError).toBe(true);
    expect(manyTags.text).toContain("tags");
  });

  it("범위별 최댓값을 넘는 limit 은 최댓값으로 줄이고 그 사실을 알린다", async () => {
    const res = await search({ scope: "compatibility", filters: { frameworkVersion: "4.2" }, limit: 150 });
    expect(res.isError).toBe(false);
    expect(res.text).toContain("최댓값 100");
  });
});

/** 응답 본문에서 첫 번째 json 코드 블록을 꺼내 파싱한다. */
function parseJsonBlock(text: string): any {
  const match = text.match(/```json\n([\s\S]*?)\n```/);
  if (!match) throw new Error("응답에 json 코드 블록이 없습니다");
  return JSON.parse(match[1]);
}

/** 통합 검색 응답을 출처별 섹션으로 나눈다. */
function splitSections(text: string): string[] {
  return text.split("\n\n---\n\n");
}

describe("integration — egov_search_knowledge 공통컴포넌트 조회", () => {
  let client: Client;

  beforeAll(async () => {
    client = await createMcpClient();
  });

  afterAll(async () => {
    await client?.close();
  });

  const search = (args: Record<string, unknown>) => callSearchKnowledge(client, args);

  it("컴포넌트를 찾지 못하면 비슷한 컴포넌트의 ID 를 함께 알려 준다", async () => {
    // '로그인' 은 ID 도 패키지명도 아니고, 같은 이름의 컴포넌트도 없다
    const res = await search({ scope: "components", filters: { componentId: "로그인" } });
    expect(res.isError).toBe(false);
    expect(res.text).toContain("컴포넌트를 찾을 수 없습니다: 로그인");
    // 후보는 같은 입력으로 키워드 검색한 상위 5건이다
    expect(res.text).toContain("비슷한 컴포넌트");
    expect(res.text).toContain("- `uap` 로그인정책관리");
    expect(res.text.match(/^- `/gm)?.length).toBe(5);
  });

  it("후보가 없는 입력에는 후보 목록을 붙이지 않는다", async () => {
    const res = await search({ scope: "components", filters: { componentId: "zzz-없는-컴포넌트" } });
    expect(res.isError).toBe(false);
    expect(res.text).toContain("컴포넌트를 찾을 수 없습니다: zzz-없는-컴포넌트");
    expect(res.text).not.toContain("비슷한 컴포넌트");
  });

  it.skipIf(!hasComponentSources())("컴포넌트 이름으로도 ddl 을 조회할 수 있다", async () => {
    const byName = await search({ scope: "components", action: "ddl", filters: { componentId: "블로그관리" } });
    expect(byName.isError).toBe(false);
    expect(byName.text).toContain("DDL (mysql)");
    expect(byName.text).toMatch(/CREATE TABLE/i);
  });

  it.skipIf(!hasComponentSources())("파일 기능에서 컴포넌트를 찾지 못해도 후보를 알려 준다", async () => {
    const res = await search({ scope: "components", action: "sourceFiles", filters: { componentId: "로그인" } });
    expect(res.isError).toBe(false);
    expect(res.text).toContain("컴포넌트를 찾을 수 없습니다: 로그인");
    expect(res.text).toContain("- `uap` 로그인정책관리");
  });

  it("메타의 id 가 겹치던 컴포넌트를 각각 조회할 수 있다", async () => {
    // templates/common-components.json 에서 id 가 겹치는 항목: 적재할 때 뒤 항목이 새 id 를 받는다
    const expected: Array<[string, string]> = [
      ["bbs", "게시판"],
      ["blog-management", "블로그관리"],
      ["cmt", "댓글관리"],
      ["uss-cmt", "출퇴근관리"],
      ["sim", "일정관리"],
      ["syi-sim", "시스템연계관리"],
      ["utl-sim", "시스템정보확인"],
      ["prm", "프로그램관리"],
      ["sys-prm", "프로세스 모니터링"],
      ["com", "협업공통"],
      ["sts-com", "통계공통"],
    ];
    for (const [componentId, name] of expected) {
      const res = await search({ scope: "components", filters: { componentId } });
      expect(res.isError, componentId).toBe(false);
      expect(res.text.split("\n")[0], componentId).toBe(`## ${name}`);
    }
  });

  it("상세 정보의 사용 테이블은 컴포넌트가 실제로 쓰는 테이블이다", async () => {
    // 메타의 useTables 에는 공통코드가 출퇴근 테이블로, 메뉴생성관리가 개인정보 로그 테이블로 적혀 있다
    const code = await search({ scope: "components", action: "get", filters: { componentId: "cca" } });
    expect(code.isError).toBe(false);
    expect(code.text).toContain("COMTCCMMNCODE");
    expect(code.text).not.toContain("COMTNCOMMUTE");

    const menu = await search({ scope: "components", action: "get", filters: { componentId: "mcm" } });
    expect(menu.text).toContain("COMTNMENUINFO");
    expect(menu.text).not.toContain("COMTNPRIVACYLOG");
  });

  it.skipIf(!hasComponentSources())("ddl 은 컴포넌트가 실제로 쓰는 테이블의 CREATE 문을 돌려준다", async () => {
    const res = await search({ scope: "components", action: "ddl", filters: { componentId: "cca" } });
    expect(res.isError).toBe(false);
    expect(res.text).toMatch(/CREATE TABLE COMTCCMMNCODE\b/);
    expect(res.text).not.toMatch(/CREATE TABLE COMTNCOMMUTE\b/);
  });

  it("동봉 DB 에는 메타에 적힌 컴포넌트가 모두 들어 있다", async () => {
    const meta = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "templates", "common-components.json"), "utf-8"),
    ) as { totalComponents: number };
    const res = await search({ scope: "components" });
    expect(res.isError).toBe(false);
    expect(res.text).toContain(`- **총 컴포넌트**: ${meta.totalComponents}개`);
  });

  it("action 과 함께 써야 하는 필터만 주면 개요 대신 필요한 action 을 알려 준다", async () => {
    const dependencies = await search({ scope: "components", filters: { componentIds: ["bbs", "cmy"] } });
    expect(dependencies.isError).toBe(true);
    expect(dependencies.text).toContain("filters.componentIds");
    expect(dependencies.text).toContain('"dependencies"');

    const readSource = await search({ filters: { filePath: "pom.xml" } });
    expect(readSource.isError).toBe(true);
    expect(readSource.text).toContain('"readSource"');

    const script = await search({ query: "게시판", filters: { dbType: "oracle" } });
    expect(script.isError).toBe(true);
    expect(script.text).toContain('"ddl"');
    expect(script.text).toContain('"dml"');
  });

  it("상세 조회에 쓰이지 않은 action 전용 필터는 어느 action 에서 쓰는지 함께 알린다", async () => {
    const res = await search({ scope: "components", filters: { componentId: "uia", dbType: "oracle" } });
    expect(res.isError).toBe(false);
    expect(res.text).toContain("### 기본 정보");
    const note = res.text.split("\n").find((line) => line.includes("적용되지 않아 무시한 필터")) ?? "";
    expect(note).toContain("dbType");
    expect(note).toContain('"ddl"');
  });

  it("query 와 목록 필터를 함께 주면 두 조건을 모두 적용한다", async () => {
    const res = await search({ scope: "components", query: "login", filters: { categoryId: "로그인" }, limit: 10 });
    expect(res.isError).toBe(false);
    expect(res.text).toContain("`uia`");
    // 'login' 으로는 찾히지만 다른 카테고리에 속한 컴포넌트는 빠져야 한다
    expect(res.text).not.toContain("`rsc`");
    expect(res.text).not.toContain("`oauth`");
  });

  it("필터 목록에 limit 을 주면 전체 건수와 함께 그만큼만 보여 준다", async () => {
    const res = await search({ scope: "components", filters: { keyword: "로그인" }, limit: 3 });
    expect(res.isError).toBe(false);
    expect(res.text).toMatch(/공통컴포넌트 목록 \(\d+개 중 3개 표시\)/);
  });

  it("limit 을 주지 않은 필터 목록은 조건에 맞는 컴포넌트를 모두 보여 준다", async () => {
    const res = await search({ scope: "components", filters: { hasWeb: true } });
    expect(res.isError).toBe(false);
    expect(res.text).not.toContain("개 중");
    const count = Number(res.text.match(/공통컴포넌트 목록 \((\d+)개\)/)?.[1]);
    expect(count).toBeGreaterThan(20);
  });

  it("키워드 검색 결과가 limit 보다 많으면 전체 건수를 알린다", async () => {
    const res = await search({ scope: "components", query: "관리", limit: 2 });
    expect(res.isError).toBe(false);
    expect(res.text).toMatch(/공통컴포넌트 목록 \(\d+개 중 2개 표시\)/);
  });

  it("낱말 접두 일치로 찾지 못해 부분 일치로 찾은 결과는 그 사실을 알린다", async () => {
    // '증서' 로 시작하는 낱말은 없고 '인증서로그인' 의 가운데에만 있다
    const res = await search({ scope: "components", query: "증서" });
    expect(res.isError).toBe(false);
    expect(res.text).toContain("`sec`");
    expect(res.text).toContain("일부 검색어만 일치");
  });

  it("검색어를 추출할 수 없는 query 는 없는 것으로 보고 필터 목록을 돌려준다", async () => {
    const res = await search({ scope: "components", query: "*", filters: { categoryId: "로그인" } });
    expect(res.isError).toBe(false);
    expect(res.text).toContain("`uia`");
  });

  it.skipIf(!hasComponentSources())(
    "action dml 에 filters.table 과 filters.offset 을 주면 그 테이블의 구간만 반환한다",
    async () => {
      const res = await search({
        scope: "components",
        action: "dml",
        filters: { componentId: "uia", dbType: "mysql", table: "COMTCCMMNDETAILCODE", offset: 100 },
        limit: 50,
      });
      expect(res.isError).toBe(false);
      expect(res.text).toContain("- **테이블**: COMTCCMMNDETAILCODE");
      expect(res.text).toMatch(/총 \d+건 중 101~150/);
      expect(res.text.match(/INSERT INTO/gi)?.length).toBe(50);
    },
  );

  it.skipIf(!hasComponentSources())(
    "action readSource 는 큰 파일을 나눠 돌려주고 이어 읽을 offset 을 알려 준다",
    async () => {
      const filePath = "script/dml/mysql/com_DML_mysql.sql";
      const first = await search({ scope: "components", action: "readSource", filters: { filePath } });
      expect(first.isError).toBe(false);
      expect(first.text).toMatch(/전체 [\d,]+자 중 1~60,000자/);
      expect(first.text).toContain("filters.offset: 60000");

      const second = await search({
        scope: "components",
        action: "readSource",
        filters: { filePath, offset: 60000 },
      });
      expect(second.isError).toBe(false);
      expect(second.text).toMatch(/전체 [\d,]+자 중 60,001~120,000자/);
      expect(second.text).toContain("filters.offset: 120000");
      // 두 구간의 본문은 서로 다르다
      expect(second.text.slice(200, 600)).not.toBe(first.text.slice(200, 600));
    },
  );

  it.skipIf(!hasComponentSources())("UTF-8 이 아닌 인코딩으로 읽은 파일은 머리말에 인코딩을 적는다", async () => {
    const eucKr = await search({
      scope: "components",
      action: "readSource",
      filters: { filePath: "src/main/webapp/WEB-INF/jsp/egovframework/com/utl/sys/prm/EgovProcessMon.jsp" },
    });
    expect(eucKr.isError).toBe(false);
    expect(eucKr.text.split("\n")[0]).toMatch(/\(751 bytes, jsp, EUC-KR\)$/);
    expect(eucKr.text).toContain("```jsp");

    const utf8 = await search({
      scope: "components",
      action: "readSource",
      filters: { filePath: "src/main/java/egovframework/com/cop/bbs/service/Blog.java" },
    });
    expect(utf8.text.split("\n")[0]).toMatch(/bytes, java\)$/);
  });

  it.skipIf(!hasComponentSources())("끝까지 읽은 파일에는 이어 읽기 안내를 붙이지 않는다", async () => {
    const res = await search({
      scope: "components",
      action: "readSource",
      filters: { filePath: "src/main/java/egovframework/com/cop/bbs/service/Blog.java" },
    });
    expect(res.isError).toBe(false);
    expect(res.text).not.toContain("filters.offset");
  });
});

describe("integration — egov_search_knowledge 호환 소프트웨어 조회", () => {
  let client: Client;

  beforeAll(async () => {
    client = await createMcpClient();
  });

  afterAll(async () => {
    await client?.close();
  });

  const search = (args: Record<string, unknown>) => callSearchKnowledge(client, args);

  it("filters.offset 으로 다음 구간을 조회한다", async () => {
    const filters = { category: "CMS Solution" };
    const first = parseJsonBlock((await search({ scope: "compatibility", filters, limit: 10 })).text);
    const second = parseJsonBlock(
      (await search({ scope: "compatibility", filters: { ...filters, offset: 10 }, limit: 10 })).text,
    );

    expect(first.total).toBeGreaterThan(20);
    expect(first.offset).toBe(0);
    expect(second.offset).toBe(10);
    expect(second.total).toBe(first.total);
    expect(second.count).toBe(10);
    const firstNames = first.software.map((s: any) => `${s.product_name}|${s.product_version}|${s.framework_version}`);
    const secondNames = second.software.map((s: any) => `${s.product_name}|${s.product_version}|${s.framework_version}`);
    expect(secondNames.filter((name: string) => firstNames.includes(name))).toEqual([]);
  });
});

describe("integration — egov_search_knowledge 적용되지 않는 필터 안내", () => {
  let client: Client;

  beforeAll(async () => {
    client = await createMcpClient();
  });

  afterAll(async () => {
    await client?.close();
  });

  const search = (args: Record<string, unknown>) => callSearchKnowledge(client, args);

  /** 무시한 필터를 알리는 안내 줄의 표지 */
  const IGNORED_MARKER = "적용되지 않아 무시한 필터";

  it("조회에 쓰이지 않은 필터는 무시했다고 알린다", async () => {
    const res = await search({
      scope: "components",
      query: "게시판",
      filters: { tags: ["faq"], frameworkVersion: "4.3" },
    });
    expect(res.isError).toBe(false);
    const note = res.text.split("\n").find((line) => line.includes(IGNORED_MARKER)) ?? "";
    expect(note).toContain("tags");
    expect(note).toContain("frameworkVersion");
  });

  it("조회에 쓰인 필터만 준 호출에는 안내를 붙이지 않는다", async () => {
    const list = await search({ scope: "components", query: "게시판", filters: { hasWeb: true } });
    expect(list.isError).toBe(false);
    expect(list.text).not.toContain(IGNORED_MARKER);

    const compatibility = await search({ scope: "compatibility", filters: { frameworkVersion: "4.3", offset: 5 } });
    expect(compatibility.isError).toBe(false);
    expect(compatibility.text).not.toContain(IGNORED_MARKER);
  });

  it("action 이 쓰지 않는 필터도 알린다", async () => {
    const res = await search({
      scope: "components",
      action: "get",
      filters: { componentId: "uia", dbType: "oracle", table: "COMTNEMPLYRINFO" },
    });
    expect(res.isError).toBe(false);
    const note = res.text.split("\n").find((line) => line.includes(IGNORED_MARKER)) ?? "";
    expect(note).toContain("dbType");
    expect(note).toContain("table");
    expect(note).not.toContain("componentId");
  });

  it("호환 소프트웨어 조회에서 쓰이지 않는 필터를 알린다", async () => {
    const res = await search({ scope: "compatibility", filters: { frameworkVersion: "4.3", layer: "egovframe-runtime" } });
    expect(res.isError).toBe(false);
    const note = res.text.split("\n").find((line) => line.includes(IGNORED_MARKER)) ?? "";
    expect(note).toContain("layer");
    expect(note).not.toContain("frameworkVersion");
  });
});

describe("integration — egov_search_knowledge 쓰이지 않은 입력 안내", () => {
  let client: Client;

  beforeAll(async () => {
    client = await createMcpClient();
  });

  afterAll(async () => {
    await client?.close();
  });

  const search = (args: Record<string, unknown>) => callSearchKnowledge(client, args);

  /** 쓰이지 않은 최상위 파라미터(query, limit)를 알리는 안내 줄의 표지 */
  const UNUSED_PARAM_MARKER = "쓰이지 않아 무시한 파라미터";
  /** 무시한 필터를 알리는 안내 줄의 표지 */
  const IGNORED_MARKER = "적용되지 않아 무시한 필터";
  const noteLine = (text: string, marker: string) => text.split("\n").find((line) => line.includes(marker)) ?? "";

  it("action 이 쓰지 않는 최상위 query 와 limit 을 알린다", async () => {
    const res = await search({
      scope: "components",
      action: "get",
      query: "게시판 상세",
      limit: 5,
      filters: { componentId: "bbs" },
    });
    expect(res.isError).toBe(false);
    const note = noteLine(res.text, UNUSED_PARAM_MARKER);
    expect(note).toContain("query");
    expect(note).toContain("limit");
  });

  it("componentId 로 상세를 조회할 때 함께 준 query 를 알린다", async () => {
    const res = await search({ scope: "components", query: "게시판", filters: { componentId: "bbs" } });
    expect(res.isError).toBe(false);
    const note = noteLine(res.text, UNUSED_PARAM_MARKER);
    expect(note).toContain("query");
    expect(note).not.toContain("limit");
  });

  it("조회에 쓰인 query 와 limit 에는 안내를 붙이지 않는다", async () => {
    const calls: Array<Record<string, unknown>> = [
      { scope: "components", query: "게시판", limit: 3 },
      { scope: "components", filters: { hasWeb: true }, limit: 3 },
      { scope: "compatibility", query: "JEUS", limit: 3 },
      { scope: "knowledge", filters: { sort: "recent" }, limit: 2 },
    ];
    for (const call of calls) {
      const res = await search(call);
      expect(res.isError, JSON.stringify(call)).toBe(false);
      expect(res.text, JSON.stringify(call)).not.toContain(UNUSED_PARAM_MARKER);
    }
  });

  it("카테고리 개요는 limit 을 쓰지 않으므로 알린다", async () => {
    const res = await search({ scope: "components", limit: 3 });
    expect(res.isError).toBe(false);
    expect(noteLine(res.text, UNUSED_PARAM_MARKER)).toContain("limit");
  });

  it("최근 지식 목록은 query 를 쓰지 않으므로 알린다", async () => {
    const res = await search({ scope: "knowledge", query: "로그인", filters: { sort: "recent" }, limit: 2 });
    expect(res.isError).toBe(false);
    const note = noteLine(res.text, UNUSED_PARAM_MARKER);
    expect(note).toContain("query");
    expect(note).not.toContain("limit");
  });

  it("sort recent 와 함께 준 knowledgeScope all 은 무시했다고 알린다", async () => {
    const res = await search({ scope: "knowledge", filters: { sort: "recent", knowledgeScope: "all" }, limit: 2 });
    expect(res.isError).toBe(false);
    expect(noteLine(res.text, IGNORED_MARKER)).toContain("knowledgeScope");
  });

  it.skipIf(!hasComponentSources())("dml 기본 보기는 limit 을 쓰지 않으므로 알린다", async () => {
    const res = await search({ scope: "components", action: "dml", filters: { componentId: "bbs" }, limit: 5 });
    expect(res.isError).toBe(false);
    expect(noteLine(res.text, UNUSED_PARAM_MARKER)).toContain("limit");
  });

  it.skipIf(!hasComponentSources())("dml 구간 조회에서 최댓값을 넘는 limit 은 줄였다고 알린다", async () => {
    const res = await search({
      scope: "components",
      action: "dml",
      filters: { componentId: "bbs", table: "COMTCCMMNDETAILCODE" },
      limit: 150,
    });
    expect(res.isError).toBe(false);
    expect(res.text).toMatch(/요청한 limit 150 은\(는\) [^\n]*최댓값 100 으로 줄여 적용했습니다/);
    expect(res.text).not.toContain(UNUSED_PARAM_MARKER);
  });

  it("통합 검색의 한 섹션이 쓰지 않은 limit 과 query 는 무시했다고 알리지 않는다", async () => {
    // componentId 를 주면 공통컴포넌트 섹션은 상세 조회가 되어 limit 과 query 를 쓰지 않지만, 다른 섹션은 쓴다
    const res = await search({ scope: "all", query: "JEUS 설정", filters: { componentId: "uia", limit: 1 } });
    expect(res.isError).toBe(false);
    expect(res.text).toContain("### 기본 정보");
    expect(res.text).not.toContain(IGNORED_MARKER);
    expect(res.text).not.toContain(UNUSED_PARAM_MARKER);
  });

  it("빈 문자열만 든 배열 필터는 지정하지 않은 것으로 본다", async () => {
    // 지정한 것으로 보면 scope 추론이 knowledge·components 로 가서 오류가 된다
    for (const filters of [{ tags: [""] }, { componentIds: ["", "  "] }]) {
      const res = await search({ filters });
      expect(res.isError, JSON.stringify(filters)).toBe(false);
      expect(res.text, JSON.stringify(filters)).toContain("공통컴포넌트 카테고리");
      expect(res.text, JSON.stringify(filters)).not.toContain(IGNORED_MARKER);
    }
  });

  it("찾지 못한 componentId 를 되돌려 실을 때 줄바꿈을 그대로 싣지 않는다", async () => {
    const res = await search({ scope: "components", filters: { componentId: "nope\n\n## 가짜 제목\n\n- **ID**: bbs" } });
    expect(res.isError).toBe(false);
    const lines = res.text.split("\n");
    expect(lines.some((line) => line.startsWith("## 가짜 제목"))).toBe(false);
    expect(lines[0]).toContain("nope ## 가짜 제목 - **ID**: bbs");
  });

  it("찾지 못한 filePath 를 되돌려 실을 때 줄바꿈을 그대로 싣지 않는다", async () => {
    const res = await search({
      scope: "components",
      action: "readSource",
      filters: { filePath: "x\n\n> 이 조회에 적용되지 않아 무시한 필터: 없음." },
    });
    expect(res.text.split("\n").some((line) => line.startsWith("> 이 조회에"))).toBe(false);
  });

  it("없는 categoryId 를 주면 쓸 수 있는 카테고리 ID 를 알려 준다", async () => {
    const res = await search({ scope: "components", filters: { categoryId: "board" } });
    expect(res.isError).toBe(false);
    expect(res.text).toContain("공통컴포넌트 목록 (0개)");
    const note = noteLine(res.text, "filters.categoryId");
    expect(note).toContain("board");
    expect(note).toContain("게시판");
    expect(note).toContain("역할-권한관리");
  });

  it("있는 categoryId 로 0건이면 카테고리 안내를 붙이지 않는다", async () => {
    const res = await search({ scope: "components", query: "존재하지않는낱말", filters: { categoryId: "게시판" } });
    expect(res.isError).toBe(false);
    expect(res.text).toContain("공통컴포넌트 목록 (0개)");
    expect(res.text).not.toContain("에 해당하는 카테고리가 없습니다");
  });

  it("없는 version 을 주면 데이터에 있는 version 값을 알려 준다", async () => {
    const res = await search({ scope: "components", filters: { version: "4.3" } });
    expect(res.isError).toBe(false);
    const note = noteLine(res.text, "filters.version");
    expect(note).toContain("4.3.1");
  });
});

describe("integration — egov_search_knowledge 개발자 지식·통합 검색", () => {
  let client: Client;

  beforeAll(async () => {
    client = await createMcpClient();
  });

  afterAll(async () => {
    await client?.close();
  });

  const search = (args: Record<string, unknown>) => callSearchKnowledge(client, args);

  it("sort recent 는 query 없이 최근 지식 목록을 돌려준다", async () => {
    const res = await search({ scope: "knowledge", filters: { sort: "recent" }, limit: 2 });
    expect(res.isError).toBe(false);
    const body = parseJsonBlock(res.text);
    expect(body.sort).toBe("recent");
    expect(body.count).toBe(2);
  });

  it.skipIf(!hasEmbeddingModel())("통합 검색의 개발자 지식 섹션은 id 와 본문 발췌를 싣는다", async () => {
    const res = await search({ scope: "all", query: "로그인이 안됩니다" });
    expect(res.isError).toBe(false);
    const section = splitSections(res.text).find((part) => part.includes("개발자 지식 검색 결과"));
    expect(section).toBeDefined();
    const body = parseJsonBlock(section!);
    expect(body.results.length).toBeGreaterThan(0);
    for (const result of body.results) {
      expect(typeof result.id).toBe("string");
      expect(typeof result.similarity).toBe("number");
      expect(result.content.length).toBeLessThanOrEqual(600);
    }
    // 발췌만 실었다는 것과 전체 본문을 보는 방법을 알린다
    expect(section).toContain('scope: "knowledge"');
  });

  it.skipIf(!hasEmbeddingModel())(
    "통합 검색에서 호환 소프트웨어 분류를 category 로 주면 가이드에는 그 필터를 적용하지 않는다",
    async () => {
      const res = await search({ scope: "all", query: "JEUS", filters: { category: "WAS" }, limit: 2 });
      expect(res.isError).toBe(false);
      const sections = splitSections(res.text);
      const guide = sections.find((part) => part.includes("가이드 검색 결과")) ?? "";
      const compatibility = sections.find((part) => part.includes("호환 소프트웨어 검색 결과")) ?? "";
      expect(res.text).not.toContain("알 수 없는 category");
      expect(guide).toMatch(/가이드 검색 결과 \([12]건\)/);
      expect(parseJsonBlock(compatibility).filters.category).toBe("WAS");
    },
  );

  it.skipIf(!hasEmbeddingModel())(
    "통합 검색에서 가이드 분류를 category 로 주면 호환 소프트웨어에는 그 필터를 적용하지 않는다",
    async () => {
      const res = await search({ scope: "all", query: "트랜잭션", filters: { category: "persistence-layer" }, limit: 2 });
      expect(res.isError).toBe(false);
      const sections = splitSections(res.text);
      const guide = sections.find((part) => part.includes("가이드 검색 결과")) ?? "";
      const compatibility = sections.find((part) => part.includes("호환 소프트웨어 검색 결과")) ?? "";
      expect(guide).toContain("> persistence-layer");
      expect(parseJsonBlock(compatibility).filters.category).toBeUndefined();
    },
  );

  it("통합 검색의 호환 소프트웨어 구간 안내는 scope 를 compatibility 로 지정하라고 알린다", async () => {
    // 통합 검색은 filters.offset 을 쓰지 않으므로 '같은 호출에 offset 을 주라' 고 안내하면 안 된다
    const res = await search({ scope: "all", query: "CMS", limit: 2 });
    expect(res.isError).toBe(false);
    const section = splitSections(res.text).find((part) => part.includes("호환 소프트웨어 검색 결과")) ?? "";
    expect(section).toContain("filters.offset: 2");
    expect(section).toContain('scope: "compatibility"');
    expect(section).not.toContain("같은 호출에");
  });

  it.skipIf(!hasEmbeddingModel())("가이드 검색에 없는 layer 값을 주면 쓸 수 있는 값을 알려 준다", async () => {
    const res = await search({ scope: "guide", query: "트랜잭션", filters: { layer: "runtime" } });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("egovframe-runtime");
  });
});

describe("integration — egov_search_knowledge 공개 스키마", () => {
  let client: Client;

  beforeAll(async () => {
    client = await createMcpClient();
  });

  afterAll(async () => {
    await client?.close();
  });

  const getTool = async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "egov_search_knowledge");
    if (!tool) throw new Error("egov_search_knowledge 가 노출되지 않았습니다");
    return tool;
  };

  it("action 은 지원하는 값의 enum 으로 공개된다", async () => {
    const props = (await getTool()).inputSchema.properties as Record<string, any>;
    expect(props.action.enum).toEqual(["get", "info", "dependencies", "sourceFiles", "readSource", "ddl", "dml"]);
  });

  it("limit 은 1~200 의 정수로 공개된다", async () => {
    const props = (await getTool()).inputSchema.properties as Record<string, any>;
    expect(props.limit).toMatchObject({ type: "integer", minimum: 1, maximum: 200 });
  });

  it("filters 는 키와 타입이 정해진 객체로 공개되고 정의되지 않은 키를 허용하지 않는다", async () => {
    const props = (await getTool()).inputSchema.properties as Record<string, any>;
    expect(props.filters.additionalProperties).toBe(false);
    const filterProps = props.filters.properties as Record<string, any>;
    for (const key of [
      "layer",
      "category",
      "type",
      "tags",
      "componentId",
      "componentIds",
      "filePath",
      "dbType",
      "frameworkVersion",
      "minLevel",
      "includeKnowledge",
      "table",
      "chunkId",
      "offset",
      "limit",
    ]) {
      expect(filterProps, `filters.${key}`).toHaveProperty(key);
      expect(String(filterProps[key].description ?? ""), `filters.${key} 설명`).not.toBe("");
    }
    expect(filterProps.frameworkVersion.type).toBe("string");
    expect(filterProps.tags.type).toBe("array");
    expect(filterProps.offset).toMatchObject({ type: "integer", minimum: 0 });
  });

  it("읽기 전용 도구임을 annotations 로 알린다", async () => {
    const tool = await getTool();
    expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
  });

  it("서버 버전은 package.json 의 버전과 같다", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf-8")) as { version: string };
    expect(client.getServerVersion()?.version).toBe(pkg.version);
  });
});

describe("integration — 지식베이스 파일 보존", () => {
  const dbPath = path.join(REPO_ROOT, "knowledge-base", "egovframe.db");
  const sha256 = () => crypto.createHash("sha256").update(fs.readFileSync(dbPath)).digest("hex");

  it("조회 호출은 git 이 추적하는 SQLite 지식베이스 파일을 바꾸지 않는다", async () => {
    const before = sha256();

    // 서버 프로세스가 종료될 때까지(WAL 체크포인트 시점 포함) 확인하도록 전용 클라이언트를 쓴다
    const client = await createMcpClient();
    const components = await callSearchKnowledge(client, { scope: "components", query: "게시판" });
    const compatibility = await callSearchKnowledge(client, {
      scope: "compatibility",
      filters: { frameworkVersion: "4.3" },
    });
    await client.close();
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(components.isError).toBe(false);
    expect(compatibility.isError).toBe(false);
    expect(sha256()).toBe(before);
  });
});
