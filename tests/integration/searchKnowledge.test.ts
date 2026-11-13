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
