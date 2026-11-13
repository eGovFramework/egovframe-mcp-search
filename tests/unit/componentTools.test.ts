/**
 * 공통컴포넌트 도구(src/tools/commonComponents.ts)의 메타데이터 영역 단위 테스트
 *
 * 조회 함수는 모듈 안의 getDB() 로 저장소의 knowledge-base/egovframe.db 를 연다.
 * 테스트가 그 파일을 건드리지 않도록 DB 경로를 정하는 resolveSQLiteDbPath 만 대역으로 바꿔
 * 임시 디렉토리의 새 DB 를 가리키게 한다. SQLiteManager 와 조회·포맷 코드는 실제 그대로다.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import { SQLiteManager } from "../../src/database/sqliteManager.js";
import { COMPONENTS, idsOf, seedComponents } from "./_componentFixture.js";

const paths = vi.hoisted(() => ({ sqliteDb: "" }));

vi.mock("../../src/utils/dataPaths.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/dataPaths.js")>();
  return {
    ...actual,
    resolveSQLiteDbPath: () => {
      // 경로가 비어 있으면 SQLiteManager 가 저장소의 DB 를 열게 되므로 반드시 막는다
      if (!paths.sqliteDb) {
        throw new Error("테스트용 DB 경로가 아직 정해지지 않았습니다");
      }
      return paths.sqliteDb;
    },
  };
});

import {
  formatComponentList,
  listCommonComponents,
  searchComponents,
} from "../../src/tools/commonComponents.js";

describe("공통컴포넌트 도구 — 메타데이터 조회", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "egov-component-tools-"));
    paths.sqliteDb = path.join(tmpDir, "egovframe.db");
    const seeder = new SQLiteManager(paths.sqliteDb);
    seedComponents(seeder);
    seeder.close();
  });

  afterAll(async () => {
    await fs.remove(tmpDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("listCommonComponents", () => {
    it("limit 을 주면 그만큼만 돌려주고 total 로 전체 건수를 알린다", () => {
      const listed = listCommonComponents({ version: "4.3.1" }, 2);
      expect(listed.components).toHaveLength(2);
      expect(listed.total).toBe(6);
      expect(listed.filters).toEqual({ version: "4.3.1" });
    });

    it("limit 을 주지 않으면 지금처럼 전체를 돌려준다", () => {
      const listed = listCommonComponents({ version: "4.3.1" });
      expect(listed.components).toHaveLength(6);
      expect(listed.total).toBe(6);
      expect(listCommonComponents().components).toHaveLength(COMPONENTS.length);
    });
  });

  describe("searchComponents", () => {
    it("모든 검색어가 일치하는 컴포넌트를 찾으면 all-terms 를 알린다", () => {
      const found = searchComponents("게시판 템플릿");
      expect(idsOf(found.results)).toEqual(["tpl"]);
      expect(found).toMatchObject({ query: "게시판 템플릿", total: 1, matchMode: "all-terms" });
    });

    it("일부 검색어만 일치하는 컴포넌트로 대체했으면 any-term 을 알린다", () => {
      const found = searchComponents("게시판 컴포넌트 DDL 보여줘");
      // 게시판: 2행 / 컴포넌트·DDL·보여줘: 0행 → k=4, 두 개 이상 일치하는 행이 없다
      expect(found.results).toEqual([]);
      expect(found.matchMode).toBe("any-term");

      const partial = searchComponents("게시판 컴포넌트");
      expect(idsOf(partial.results)).toEqual(["bbs", "tpl"]);
      expect(partial).toMatchObject({ total: 2, matchMode: "any-term" });
    });

    it("total 은 limit 과 무관하게 전체 일치 건수다", () => {
      const found = searchComponents("게시판 컴포넌트", 1);
      expect(idsOf(found.results)).toEqual(["bbs"]);
      expect(found.total).toBe(2);
    });

    it("검색어가 하나도 추출되지 않으면 빈 결과를 돌려준다", () => {
      expect(searchComponents("?!")).toMatchObject({ results: [], total: 0 });
      expect(searchComponents("")).toMatchObject({ results: [], total: 0 });
      // 필터가 있어도 검색어 없는 검색은 목록으로 바뀌지 않는다
      expect(searchComponents("?!", 20, { categoryId: "게시판" })).toMatchObject({ results: [], total: 0 });
    });

    it("선택 인자로 받은 목록 필터(categoryId, hasWeb, version, keyword)를 검색에 함께 적용한다", () => {
      expect(idsOf(searchComponents("게시").results).sort()).toEqual(["bbs", "bst", "tpl"]);
      expect(idsOf(searchComponents("게시", 20, { version: "5.0.0" }).results)).toEqual(["bst"]);
      expect(idsOf(searchComponents("게시", 20, { keyword: "템플릿" }).results)).toEqual(["tpl"]);
      expect(idsOf(searchComponents("관리", 20, { categoryId: "게시판" }).results)).toEqual(["tpl"]);
      expect(searchComponents("공통", 20, { hasWeb: true })).toMatchObject({ results: [], total: 0 });

      const filtered = searchComponents("게시", 1, { version: "4.3.1" });
      expect(filtered.results).toHaveLength(1);
      expect(filtered.total).toBe(2);
    });
  });
});

describe("공통컴포넌트 도구 — 결과 포맷", () => {
  const [uia, sec] = COMPONENTS.map((component) => ({ ...component, category_name: component.category_id }));

  describe("formatComponentList", () => {
    it("일부만 표시할 때는 제목 줄에 'N개 중 M개 표시' 를 적는다", () => {
      expect(formatComponentList([uia, sec], true, { total: 6 })).toContain("## 공통컴포넌트 목록 (6개 중 2개 표시)");
      expect(formatComponentList([uia, sec], false, { total: 6 })).toContain(
        "## 공통컴포넌트 목록 (6개 중 2개 표시)",
      );
    });

    it("전체를 표시하거나 total 을 주지 않으면 지금처럼 건수만 적는다", () => {
      expect(formatComponentList([uia, sec], true, { total: 2 })).toContain("## 공통컴포넌트 목록 (2개)");
      expect(formatComponentList([uia, sec])).toContain("## 공통컴포넌트 목록 (2개)");
      expect(formatComponentList([uia, sec], false)).toContain("## 공통컴포넌트 목록 (2개)");
    });

    it("일부 검색어만 일치한 결과(any-term)이면 그 사실을 적는다", () => {
      const text = formatComponentList([uia, sec], false, { matchMode: "any-term" });
      expect(text).toContain("## 공통컴포넌트 목록 (2개)");
      expect(text).toContain("일부 검색어만 일치");
    });

    it("모든 검색어가 일치했거나 matchMode 를 주지 않으면 적지 않는다", () => {
      expect(formatComponentList([uia, sec], false, { matchMode: "all-terms" })).not.toContain("일부 검색어만");
      expect(formatComponentList([uia, sec], false)).not.toContain("일부 검색어만");
      expect(formatComponentList([uia, sec])).not.toContain("일부 검색어만");
    });
  });
});
