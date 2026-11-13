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
import {
  callSearchKnowledge,
  createMcpClient,
  hasComponentSources,
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
