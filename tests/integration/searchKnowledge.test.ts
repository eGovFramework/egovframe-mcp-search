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

    // 청크의 길이는 동봉 인덱스를 만든 청킹에 따라 다르다 (긴 절을 조각으로 나누는 청킹에서는 6,000자를 넘는 청크가 없다).
    // 여기서는 실제 청크의 길이에 맞는 안내가 나오는지를 보고, 구간을 나눠 읽는 규칙 자체는
    // tests/unit/guideGateway.test.ts 가 고정 데이터로 확인한다.
    it("chunkId 를 주면 query 없이 그 청크의 본문을 돌려주고, 표시한 범위를 알려 준다", async () => {
      const chunk = await longestChunk();
      const total = chunk.content.length;

      const first = await search({ scope: "guide", filters: { chunkId: chunk.id } });
      expect(first.isError).toBe(false);
      expect(first.text).toContain(chunk.title);
      const firstEnd = Math.min(total, 6000);
      expect(first.text).toContain(`전체 ${total.toLocaleString("en-US")}자 중 1~${firstEnd.toLocaleString("en-US")}자를 표시했습니다`);
      if (total > 6000) {
        expect(first.text).toContain("filters.offset: 6000");
      } else {
        expect(first.text).toContain("(청크의 끝)");
      }
      // 원문의 첫 부분에 있는 문장이 응답에 들어 있다 (제목·구분선이 아닌 평범한 줄을 고른다)
      const plainLine = chunk.content
        .substring(0, firstEnd)
        .split("\n")
        .find((line) => line.trim().length > 20 && !/^\s*(#|-{3,}|`{3,}|\|)/.test(line));
      expect(plainLine).toBeDefined();
      expect(first.text).toContain(plainLine!.trim());
    });

    it("scope 를 생략해도 chunkId 만으로 가이드 청크를 읽고, filters.offset 부터 이어 읽는다", async () => {
      const chunk = await longestChunk();
      const total = chunk.content.length;
      const offset = Math.floor(total / 2);

      const res = await search({ filters: { chunkId: chunk.id, offset } });
      expect(res.isError).toBe(false);
      expect(res.text).toContain(`전체 ${total.toLocaleString("en-US")}자 중 ${(offset + 1).toLocaleString("en-US")}~`);
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

    it.skipIf(!hasEmbeddingModel())("검색 결과가 알려 준 chunkId 로 그 청크를 읽을 수 있다", async () => {
      // 본문이 잘린 결과에는 이어 읽는 안내가, 조각으로 나뉜 절의 결과에는 조각 줄이 chunkId 를 싣는다.
      // 어느 쪽이 나오는지는 동봉 인덱스의 청킹에 따라 다르므로, 응답에 실린 chunkId 가운데 하나를 읽어 본다.
      const res = await search({
        scope: "guide",
        query: "받은쪽지함관리 컴포넌트의 배포파일명과 포함 테이블",
        limit: 5,
      });
      expect(res.isError).toBe(false);
      expect(res.text).not.toContain("... (truncated)");

      const chunkIds = [...res.text.matchAll(/chunkId: "([0-9a-f-]{36})"/g)].map((match) => match[1]);
      if (chunkIds.length === 0) {
        // 모든 결과가 나뉘지 않은 짧은 절이면 실을 chunkId 가 없다
        return;
      }
      const next = await search({ scope: "guide", filters: { chunkId: chunkIds[0] } });
      expect(next.isError).toBe(false);
      expect(next.text).toMatch(/전체 [\d,]+자 중 1~/);
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

  it("query 없이 어느 출처의 분류도 아닌 category 만 주면 compatibility 로 처리해 쓸 수 있는 분류를 알려 준다", async () => {
    // 가이드는 query 가 있어야 하므로, category 하나만으로 답할 수 있는 출처는 호환 소프트웨어뿐이다
    const res = await search({ filters: { category: "Web Server" } });
    expect(res.isError).toBe(false);
    expect(res.text).toContain(COMPAT_MARKER);
    expect(res.text).not.toContain(OVERVIEW_MARKER);
    const body = JSON.parse(res.text.slice(res.text.indexOf("{"), res.text.lastIndexOf("}") + 1));
    expect(body.total).toBe(0);
    expect(body.available.categories).toContain("WAS");
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
    expect(res.text).toContain("요청한 limit 150 은(는) compatibility 범위의 최댓값 50 으로 줄여 적용했습니다");
    const body = parseJsonBlock(res.text);
    expect(body.limit).toBe(50);
    expect(body.software.length).toBeLessThanOrEqual(50);
  });

  it("호환 소프트웨어를 최댓값만큼 조회한 응답은 50,000자를 넘지 않는다", async () => {
    // MCP 클라이언트는 50,000자를 넘는 결과를 본문 대신 파일로 넘기기도 한다
    for (const args of [
      { scope: "compatibility", limit: 50 },
      { scope: "compatibility", query: "CMS", limit: 50 },
      { scope: "compatibility", query: "CMS", limit: 50, filters: { includeKnowledge: true } },
    ]) {
      const res = await search(args);
      expect(res.isError).toBe(false);
      expect(parseJsonBlock(res.text).software.length).toBe(50);
      expect(res.text.length).toBeLessThan(40_000);
    }
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
    // 후보는 같은 입력으로 키워드 검색한 상위 5건이다. 이름에 '로그인' 이 든 컴포넌트가 이름이 짧은 순으로 나온다
    expect(res.text).toContain("비슷한 컴포넌트");
    const candidates = res.text.match(/^- `[^`]+`/gm) ?? [];
    expect(candidates).toHaveLength(5);
    expect(candidates[0]).toBe("- `uia`");
    expect(res.text).toContain("- `uap` 로그인정책관리");
  });

  it("후보가 없는 입력에는 후보 목록을 붙이지 않는다", async () => {
    const res = await search({ scope: "components", filters: { componentId: "zzz-없는컴포넌트" } });
    expect(res.isError).toBe(false);
    expect(res.text).toContain("컴포넌트를 찾을 수 없습니다: zzz-없는컴포넌트");
    expect(res.text).not.toContain("비슷한 컴포넌트");
  });

  it("기호로 이은 입력을 조각으로 나눠 후보를 찾지 않는다", async () => {
    // '-' 나 '.' 에서 나눈 조각으로 찾던 때에는 '없는' 이 설명에 든 컴포넌트 한 건이, 'com' 이 패키지명에 든 컴포넌트
    // 다섯 건이 후보로 붙었다
    for (const componentId of ["zzz-없는-컴포넌트", "egovframework.com.zzz"]) {
      const res = await search({ scope: "components", filters: { componentId } });
      expect(res.isError, componentId).toBe(false);
      expect(res.text, componentId).toBe(`컴포넌트를 찾을 수 없습니다: ${componentId}`);
    }
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

  it("낱말의 가운데에 든 검색어로도 찾는다", async () => {
    // '증서' 는 '인증서로그인' 의 가운데에만 있다. 모든 검색어가 일치했으므로 대체 검색 안내는 붙지 않는다
    const res = await search({ scope: "components", query: "증서" });
    expect(res.isError).toBe(false);
    expect(res.text).toContain("`sec`");
    expect(res.text).not.toContain("모든 검색어가 들어 있는 항목이 없어");
  });

  it("모든 검색어가 든 컴포넌트가 없으면 대체 검색으로 찾았다는 것과 쓰지 않은 낱말을 알린다", async () => {
    const res = await search({ scope: "components", query: "게시판 템플릿 없는낱말" });
    expect(res.isError).toBe(false);
    expect(res.text).toContain("`tpl`");
    expect(res.text).toContain("모든 검색어가 들어 있는 항목이 없어");
    const ignored = res.text.split("\n").find((line) => line.includes("검색에 쓰지 않은 낱말")) ?? "";
    expect(ignored).toContain("없는낱말");
    expect(ignored).not.toContain("게시판");
  });

  it("대체 검색 안내는 쓴 검색어와 실제로 적용한 일치 기준을 밝힌다", async () => {
    // 세 낱말이 함께 든 컴포넌트도, 둘이 함께 든 컴포넌트도 없어 기준이 1 까지 내려간다
    const res = await search({ scope: "components", query: "증서 통계 권한관리" });
    expect(res.isError).toBe(false);
    const note = res.text.split("\n").find((line) => line.includes("모든 검색어가 들어 있는 항목이 없어")) ?? "";
    expect(note).toContain("검색어 3개 가운데 1개 이상");
    expect(note).toContain("(검색어: 증서, 통계, 권한관리)");
  });

  /** 응답에서 marker 가 든 안내 줄들 */
  const noteLines = (text: string, marker: string) => text.split("\n").filter((line) => line.includes(marker));
  /** 일부 검색어만 일치한 결과(any-term)임을 알리는 안내 줄의 표지 */
  const ANY_TERM_MARKER = "들어 있는 항목을 표시합니다";
  /** 일치하는 항목이 없어 쓰지 않은 낱말을 알리는 안내 줄의 표지 */
  const IGNORED_MARKER = "일치하는 항목이 없어 검색에 쓰지 않은 낱말";
  /** 일치하는 항목이 있는지와 관계없이 뺀 낱말을 알리는 안내 줄의 표지 */
  const DROPPED_MARKER = "목록의 모든 항목에 해당해 검색에 쓰지 않은 낱말";
  /** 응답의 표에 실린 컴포넌트 ID (실린 순서) */
  const listedIds = (text: string) => [...text.matchAll(/^\| `([^`]+)` \|/gm)].map((match) => match[1]);

  it("query 에 OR 가 있으면 OR 로 찾았다고 알리고, 모든 검색어가 든 항목이 없다고 적지 않는다", async () => {
    const res = await search({ scope: "components", query: "게시판 OR 댓글", limit: 3 });
    expect(res.isError).toBe(false);
    // 두 낱말이 모두 든 댓글관리(cmt)가 맨 앞이다. "모든 검색어가 들어 있는 항목이 없어" 는 이 결과에서 사실과 다르다
    expect(listedIds(res.text)[0]).toBe("cmt");
    expect(noteLines(res.text, ANY_TERM_MARKER)).toEqual([
      "> query 에 OR 가 있어, 검색어 2개 가운데 1개 이상이 들어 있는 항목을 표시합니다 (검색어: 게시판, 댓글).",
    ]);
    expect(res.text).not.toContain("모든 검색어가 들어 있는 항목이 없어");
  });

  it("검색에서 뺀 낱말은 모든 검색어가 일치한 결과에도 따로 알린다", async () => {
    const res = await search({ scope: "components", query: "게시판 컴포넌트", limit: 3 });
    expect(res.isError).toBe(false);
    expect(listedIds(res.text)[0]).toBe("bbs");
    expect(noteLines(res.text, DROPPED_MARKER)).toEqual([
      "> 한 글자이거나, 영어 기능어이거나, 목록의 모든 항목에 해당해 검색에 쓰지 않은 낱말: 컴포넌트.",
    ]);
    // 남은 검색어는 모두 일치했으므로 다른 안내는 없다
    expect(noteLines(res.text, ANY_TERM_MARKER)).toEqual([]);
    expect(noteLines(res.text, IGNORED_MARKER)).toEqual([]);

    // 영어 문장으로 물어도 같다: 영어 기능어와 목록의 모든 항목에 해당하는 낱말을 뺐다고 알린다
    const sentence = await search({ scope: "components", query: "What's the login component?", limit: 3 });
    expect(sentence.isError).toBe(false);
    expect(noteLines(sentence.text, DROPPED_MARKER)).toHaveLength(1);
    expect(noteLines(sentence.text, DROPPED_MARKER)[0]).toMatch(/: What, the, component\.$/);
  });

  it("결과가 없으면 일치하는 항목이 없어 쓰지 않은 낱말과 검색에서 뺀 낱말을 모두 알린다", async () => {
    const res = await search({ scope: "components", query: "Is the zzzqqq with x" });
    expect(res.isError).toBe(false);
    expect(res.text).toContain("공통컴포넌트 목록 (0개)");
    expect(noteLines(res.text, IGNORED_MARKER)).toEqual(["> 일치하는 항목이 없어 검색에 쓰지 않은 낱말: zzzqqq."]);
    expect(noteLines(res.text, DROPPED_MARKER)).toHaveLength(1);
    expect(noteLines(res.text, DROPPED_MARKER)[0]).toMatch(/: Is, the, with, x\.$/);
    expect(noteLines(res.text, ANY_TERM_MARKER)).toEqual([]);
  });

  it("필터 때문에 0건이면 필터를 뺐을 때 같은 query 에 일치하는 건수를 알린다", async () => {
    /** 필터를 뺀 조회를 권하는 안내 줄의 표지 */
    const WITHOUT_FILTERS_MARKER = "필터를 빼면";
    const everywhere = await search({ scope: "components", query: "로그인", limit: 1 });
    const total = Number(everywhere.text.match(/공통컴포넌트 목록 \((\d+)개 중 1개 표시\)/)?.[1]);
    expect(total).toBeGreaterThan(1);

    // '로그인' 이 든 컴포넌트는 있지만 게시판 카테고리 안에는 없다. 쓰지 않은 낱말의 안내만으로는 0건의 원인이
    // 낱말인지 필터인지 알 수 없다
    const res = await search({ scope: "components", query: "로그인", filters: { categoryId: "게시판" } });
    expect(res.isError).toBe(false);
    expect(res.text).toContain("공통컴포넌트 목록 (0개)");
    expect(noteLines(res.text, IGNORED_MARKER)).toEqual(["> 일치하는 항목이 없어 검색에 쓰지 않은 낱말: 로그인."]);
    expect(noteLines(res.text, WITHOUT_FILTERS_MARKER)).toEqual([
      `> 필터(categoryId)를 적용한 범위에는 일치하는 컴포넌트가 없습니다. 필터를 빼면 같은 query 로 ${total}개를 찾습니다.`,
    ]);

    // 필터를 빼도 일치하는 컴포넌트가 없거나, 필터를 주지 않았거나, 결과가 있으면 이 안내를 붙이지 않는다
    for (const args of [
      { scope: "components", query: "zzzqqq", filters: { categoryId: "게시판" } },
      { scope: "components", query: "zzzqqq" },
      { scope: "components", query: "게시판", filters: { categoryId: "게시판" } },
    ]) {
      const other = await search(args);
      expect(other.isError, JSON.stringify(args)).toBe(false);
      expect(noteLines(other.text, WITHOUT_FILTERS_MARKER), JSON.stringify(args)).toEqual([]);
    }
  });

  it("목록의 모든 항목에 해당하는 낱말은 쓸 수 있는 다른 검색어가 없으면 빼지 않고 검색어로 쓴다", async () => {
    // 'zzzqqq' 는 어느 컴포넌트에도 없다. '컴포넌트' 까지 빼면 0건이 되므로 빼지 않고, 그 낱말이 든 컴포넌트를 돌려준다
    const res = await search({ scope: "components", query: "zzzqqq 컴포넌트" });
    expect(res.isError).toBe(false);
    expect(listedIds(res.text).length).toBeGreaterThan(0);
    expect(noteLines(res.text, ANY_TERM_MARKER)).toHaveLength(1);
    expect(noteLines(res.text, ANY_TERM_MARKER)[0]).toContain("(검색어: 컴포넌트)");
    expect(noteLines(res.text, IGNORED_MARKER)).toEqual(["> 일치하는 항목이 없어 검색에 쓰지 않은 낱말: zzzqqq."]);
    expect(noteLines(res.text, DROPPED_MARKER)).toEqual([]);
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
      expect(first.text).toMatch(/전체 [\d,]+자 중 1~30,000자/);
      expect(first.text).toContain("filters.offset: 30000");

      const second = await search({
        scope: "components",
        action: "readSource",
        filters: { filePath, offset: 30000 },
      });
      expect(second.isError).toBe(false);
      expect(second.text).toMatch(/전체 [\d,]+자 중 30,001~60,000자/);
      expect(second.text).toContain("filters.offset: 60000");
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

  it("filters.level 은 그 호환성 레벨의 제품만 돌려준다 (scope 를 생략해도 compatibility 로 처리한다)", async () => {
    const res = await search({ filters: { level: 1 }, limit: 50 });
    expect(res.isError).toBe(false);
    const body = parseJsonBlock(res.text);
    expect(body.filters.level).toBe(1);
    expect(body.total).toBeGreaterThan(0);
    expect(new Set(body.software.map((s: any) => s.compatibility_level))).toEqual(new Set([1]));
    expect(res.text).not.toContain("적용되지 않아 무시한 필터");

    // minLevel 1 은 '1 이상' 이라 전체가 나온다. level 1 은 그보다 적다
    const atLeast = parseJsonBlock((await search({ scope: "compatibility", filters: { minLevel: 1 }, limit: 1 })).text);
    expect(body.total).toBeLessThan(atLeast.total);
  });

  it("level 에 1, 2 가 아닌 값을 주면 입력 검증 오류다", async () => {
    const res = await search({ scope: "compatibility", filters: { level: 3 } });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("level");
  });

  it("제품명을 나열해 모든 검색어가 든 행이 없으면, 쓴 검색어와 낮춘 일치 기준을 함께 돌려준다", async () => {
    const res = await search({ scope: "compatibility", query: "JEUS Tibero WebLogic", limit: 50 });
    expect(res.isError).toBe(false);
    const body = parseJsonBlock(res.text);
    expect(body.matchMode).toBe("any-term");
    expect(body.usedTerms).toEqual(["JEUS", "Tibero", "WebLogic"]);
    expect(body.requiredMatches).toBe(1);
    const names = new Set(body.software.map((s: any) => s.product_name));
    expect(names.has("JEUS")).toBe(true);
    expect(names.has("Tibero")).toBe(true);
  });

  it("query 에 OR 가 있으면 orQuery 를 싣고, 낱말 가운데 하나라도 든 행을 돌려준다", async () => {
    const res = await search({ scope: "compatibility", query: "티맥스 OR LG", limit: 50 });
    expect(res.isError).toBe(false);
    const body = parseJsonBlock(res.text);
    expect(body.matchMode).toBe("any-term");
    expect(body.orQuery).toBe(true);
    expect(body.usedTerms).toEqual(["티맥스", "LG"]);
    expect(body.requiredMatches).toBe(1);
    expect(body.droppedTerms).toBeUndefined();
    // 두 업체의 행이 섞여 확인일자 순으로 나온다. 영문 검색어(LG)가 일치한 행이 앞을 모두 차지하지 않는다
    const vendors: string[] = body.software.map((s: any) => s.vendor);
    expect(vendors.some((vendor) => vendor.includes("티맥스"))).toBe(true);
    expect(vendors.some((vendor) => vendor.includes("LG"))).toBe(true);
    const dates: string[] = body.software.map((s: any) => s.verified_date);
    expect(dates).toEqual([...dates].sort().reverse());

    // OR 가 없는 조회에는 orQuery 가 없다
    const plain = parseJsonBlock((await search({ scope: "compatibility", query: "JEUS Tibero WebLogic" })).text);
    expect(plain.orQuery).toBeUndefined();
  });

  it("검색에서 뺀 검색어는 droppedTerms 로 싣고, 뺀 낱말이 제품명에 든 제품을 맨 앞에 싣는다", async () => {
    const res = await search({ scope: "compatibility", query: "eGov CMS", limit: 5 });
    expect(res.isError).toBe(false);
    const body = parseJsonBlock(res.text);
    // 'eGov' 를 뺀 나머지 검색어(CMS)가 모두 일치한 결과다
    expect(body.matchMode).toBe("all-terms");
    expect(body.droppedTerms).toEqual(["eGov"]);
    expect(body.usedTerms).toBeUndefined();
    expect(body.ignoredTerms).toBeUndefined();
    expect(body.total).toBeGreaterThan(100);
    expect(body.software.map((s: any) => /egov/i.test(s.product_name))).toEqual([true, true, true, true, false]);

    // 영어 문장: 영어 기능어와 프레임워크를 가리키는 낱말은 droppedTerms, 일치하는 행이 없는 낱말은 ignoredTerms 다
    const sentence = parseJsonBlock(
      (await search({ scope: "compatibility", query: "Is Tibero compatible with eGovFrame 4.3?", limit: 3 })).text,
    );
    expect(sentence.matchMode).toBe("any-term");
    expect(sentence.usedTerms).toEqual(["Tibero", "4.3"]);
    expect(sentence.ignoredTerms).toEqual(["compatible"]);
    expect(sentence.droppedTerms).toEqual(["Is", "with", "eGovFrame"]);
    expect(sentence.software.filter((s: any) => s.product_name === "Tibero")).toHaveLength(2);
  });

  it("vendor 필터는 법인 표기가 달라도 같은 업체의 제품을 모두 돌려준다", async () => {
    const totals = [];
    for (const vendor of ["(주)아이액츠", "㈜아이액츠", "주식회사 아이액츠", "아이액츠"]) {
      const body = parseJsonBlock((await search({ scope: "compatibility", filters: { vendor } })).text);
      expect(body.filters.vendor, vendor).toBe(vendor);
      totals.push(body.total);
    }
    expect(totals[0]).toBeGreaterThan(1);
    expect(new Set(totals).size).toBe(1);
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

  it("componentId 와 별칭에 서로 다른 값을 주면 오류로 응답한다", async () => {
    const res = await search({ scope: "components", action: "get", filters: { componentId: "bbs", component: "uia" } });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("filters.componentId");
    expect(res.text).toContain("filters.component");

    const dependencies = await search({
      scope: "components",
      action: "dependencies",
      filters: { componentIds: ["bbs"], componentId: "uia", id: "cmt" },
    });
    expect(dependencies.isError).toBe(true);
    expect(dependencies.text).toContain("filters.id");
  });

  it("componentId 와 별칭에 같은 컴포넌트를 주면 정상 조회한다 (대소문자는 가리지 않는다)", async () => {
    const res = await search({ scope: "components", action: "get", filters: { componentId: "bbs", id: "BBS" } });
    expect(res.isError).toBe(false);
    expect(res.text).toContain("egovframework.com.cop.bbs");
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

  it("tags 는 대소문자를 가리지 않고 대응시킨다", async () => {
    const res = await search({ scope: "knowledge", filters: { sort: "recent", tags: ["FAQ"] }, limit: 1 });
    expect(res.isError).toBe(false);
    const body = parseJsonBlock(res.text);
    expect(body.count).toBe(1);
    expect(body.results[0].tags).toContain("faq");
  });

  it("데이터에 없는 태그로 0건이면 쓸 수 있는 태그를 알려 준다", async () => {
    const res = await search({ scope: "knowledge", filters: { sort: "recent", tags: ["mybatis"] }, limit: 1 });
    expect(res.isError).toBe(false);
    expect(parseJsonBlock(res.text).count).toBe(0);
    const note = res.text.split("\n").find((line) => line.includes("filters.tags")) ?? "";
    expect(note).toContain("mybatis");
    expect(note).toContain("faq");
    expect(note).toContain("qa");
  });

  it("데이터에 행이 없는 type 으로 0건이면 데이터에 있는 type 을 알려 준다", async () => {
    const res = await search({ scope: "knowledge", filters: { sort: "recent", type: "tip" }, limit: 1 });
    expect(res.isError).toBe(false);
    expect(parseJsonBlock(res.text).count).toBe(0);
    const note = res.text.split("\n").find((line) => line.includes("filters.type")) ?? "";
    expect(note).toContain("solution");
    expect(note).toContain("best-practice");
  });

  it("결과가 있으면 태그와 type 안내를 붙이지 않는다", async () => {
    const res = await search({ scope: "knowledge", filters: { sort: "recent", tags: ["faq"], type: "solution" }, limit: 1 });
    expect(res.isError).toBe(false);
    expect(parseJsonBlock(res.text).count).toBe(1);
    expect(res.text).not.toContain("filters.tags");
    expect(res.text).not.toContain("filters.type");
  });

  it.skipIf(!hasEmbeddingModel())(
    "knowledgeScope all 의 호환 소프트웨어가 limit 에서 잘리면 전체 건수와 나머지를 보는 방법을 알린다",
    async () => {
      const res = await search({ scope: "knowledge", query: "CMS", filters: { knowledgeScope: "all" }, limit: 2 });
      expect(res.isError).toBe(false);
      const body = parseJsonBlock(res.text);
      expect(body.compatibility).toHaveLength(2);
      expect(body.compatibilityTotal).toBeGreaterThan(2);
      const note = res.text.split("\n").find((line) => line.includes("호환 소프트웨어는 전체")) ?? "";
      expect(note).toContain(`전체 ${body.compatibilityTotal}건 중 2건`);
      expect(note).toContain('scope: "compatibility"');
    },
  );

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

  it("통합 검색은 limit 이 10 을 넘으면 출처마다 10건까지만 싣고 줄였다고 한 번만 알린다", async () => {
    // 출처마다 범위의 최댓값(호환 소프트웨어 100건, 공통컴포넌트 200건)까지 실으면 응답 하나가 수만 자를 넘는다
    const res = await search({ scope: "all", query: "CMS", limit: 200 });
    expect(res.isError).toBe(false);
    const compatibility = splitSections(res.text).find((part) => part.includes("호환 소프트웨어 검색 결과")) ?? "";
    const body = parseJsonBlock(compatibility);
    expect(body.total).toBeGreaterThan(10);
    expect(body.limit).toBe(10);
    expect(body.software).toHaveLength(10);
    // 나머지를 보는 방법은 줄인 건수를 기준으로 안내한다
    expect(compatibility).toContain("filters.offset: 10");

    const notes = res.text.split("\n").filter((line) => line.includes("줄여 적용했습니다"));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("요청한 limit 200");
    expect(notes[0]).toContain("출처마다 최대 10건");
    expect(notes[0]).toContain("`scope`");
    expect(res.text.length).toBeLessThan(40_000);
  });

  it("통합 검색의 filters.limit 도 출처마다 10건으로 줄인다", async () => {
    const res = await search({ scope: "all", query: "CMS", filters: { limit: 50 } });
    expect(res.isError).toBe(false);
    const compatibility = splitSections(res.text).find((part) => part.includes("호환 소프트웨어 검색 결과")) ?? "";
    expect(parseJsonBlock(compatibility).software).toHaveLength(10);
    expect(res.text).toContain("요청한 limit 50");
  });

  it("통합 검색의 limit 이 10 이하면 그대로 적용하고 줄였다는 안내를 붙이지 않는다", async () => {
    const res = await search({ scope: "all", query: "CMS", limit: 10 });
    expect(res.isError).toBe(false);
    const compatibility = splitSections(res.text).find((part) => part.includes("호환 소프트웨어 검색 결과")) ?? "";
    expect(parseJsonBlock(compatibility).software).toHaveLength(10);
    expect(res.text).not.toContain("줄여 적용했습니다");
  });

  it('통합 검색의 호환 소프트웨어 섹션은 "eGov CMS" 에서 제품명에 eGov 가 든 제품을 맨 앞에 싣는다', async () => {
    // 'eGov' 를 빼기만 하던 때에는 확인일자가 최근인 CMS 제품 다섯 건이 실려, 제품명에 eGov 가 든 제품이 보이지 않았다
    const res = await search({ scope: "all", query: "eGov CMS" });
    expect(res.isError).toBe(false);
    const section = splitSections(res.text).find((part) => part.includes("호환 소프트웨어 검색 결과")) ?? "";
    const body = parseJsonBlock(section);
    expect(body.matchMode).toBe("all-terms");
    expect(body.droppedTerms).toEqual(["eGov"]);
    expect(body.limit).toBe(5);
    expect(body.software.map((s: any) => /egov/i.test(s.product_name))).toEqual([true, true, true, true, false]);
    expect(body.software.slice(0, 4).map((s: any) => s.product_name)).toEqual([
      "MC@CMS eGov",
      "MC@CMS eGov",
      "MC@CMS eGov",
      "DL-WCMS for eGovframe",
    ]);
  });

  it.skipIf(!hasEmbeddingModel())(
    'knowledgeScope all 의 호환 소프트웨어도 "eGov CMS" 에서 제품명에 eGov 가 든 제품을 맨 앞에 싣는다',
    async () => {
      // 이 목록은 모든 검색어가 일치하는 행만 찾는 조회(queryCompatibleSoftwareAllTerms)가 만든다
      const res = await search({ scope: "knowledge", query: "eGov CMS", filters: { knowledgeScope: "all" }, limit: 5 });
      expect(res.isError).toBe(false);
      const body = parseJsonBlock(res.text);
      expect(body.compatibilityTotal).toBeGreaterThan(100);
      // 이 목록의 product 는 제품 버전 표기다 (예: 'MC@CMS eGov 1.5.0')
      expect(body.compatibility.map((s: any) => /egov/i.test(s.product))).toEqual([true, true, true, true, false]);
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
      "level",
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
