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
      "limit",
    ]) {
      expect(filterProps, `filters.${key}`).toHaveProperty(key);
      expect(String(filterProps[key].description ?? ""), `filters.${key} 설명`).not.toBe("");
    }
    expect(filterProps.frameworkVersion.type).toBe("string");
    expect(filterProps.tags.type).toBe("array");
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
