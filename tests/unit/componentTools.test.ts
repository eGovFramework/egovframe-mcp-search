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
import { CATEGORIES, COMPONENTS, idsOf, seedComponents } from "./_componentFixture.js";

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
  formatCategoryList,
  formatComponentInfo,
  formatComponentList,
  formatComponentSummary,
  formatDependencyResolution,
  getComponentInfo,
  listCommonComponents,
  resolveDependencies,
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
    // 도구 모듈이 연 DB 연결은 닫을 방법이 없다. 열린 파일을 지울 수 없는 플랫폼(Windows)에서는
    // 정리 실패를 무시한다 (OS 임시 디렉토리라 남아도 무방하다).
    await fs.remove(tmpDir).catch(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getComponentInfo", () => {
    it("ID 의 대소문자와 앞뒤 공백이 달라도 상세 정보를 돌려준다", () => {
      for (const id of ["bbs", "BBS", " bbs "]) {
        const info = getComponentInfo(id);
        expect(info.component?.component_id, `id=${JSON.stringify(id)}`).toBe("bbs");
        expect(info.dependencies).toEqual([
          "egovframework.com.cmm",
          "egovframework.com.cop.tpl",
          "egovframework.com.missing.pkg",
        ]);
        expect(idsOf(info.dependencyComponents)).toEqual(["cmm", "tpl"]);
        expect(info.suggestions).toEqual([]);
      }
    });

    it("패키지명이나 하나뿐인 이름으로도 찾는다", () => {
      expect(getComponentInfo("EGOVFRAMEWORK.COM.UAT.UIA").component?.component_id).toBe("uia");
      expect(getComponentInfo("게시판").component?.component_id).toBe("bbs");
      expect(getComponentInfo("General Login").component?.component_id).toBe("uia");
      // 이름으로 찾았을 때도 의존성은 찾은 컴포넌트의 ID 로 조회한다
      expect(getComponentInfo("General Login").dependencies).toEqual([
        "egovframework.com.cmm",
        "egovframework.com.sec.ram",
      ]);
    });

    it("찾지 못하면 키워드 검색으로 후보(suggestions)를 함께 돌려준다", () => {
      // 영문명이 같은 컴포넌트가 둘이라 하나로 정할 수 없다
      const ambiguous = getComponentInfo("Authority Management");
      expect(ambiguous.component).toBeNull();
      expect(ambiguous.dependencies).toEqual([]);
      expect(idsOf(ambiguous.suggestions).sort()).toEqual(["drm", "ram"]);

      const partial = getComponentInfo("게시판 관련");
      expect(partial.component).toBeNull();
      expect(idsOf(partial.suggestions)).toEqual(["bbs", "tpl"]);
    });

    it("후보는 5건까지만 돌려주고, 없으면 빈 배열이다", () => {
      // 모든 컴포넌트의 패키지명이 egovframework 로 시작한다
      expect(getComponentInfo("egovframework").suggestions).toHaveLength(5);
      const none = getComponentInfo("zzz-없는-컴포넌트");
      expect(none.component).toBeNull();
      expect(none.suggestions).toEqual([]);
    });
  });

  describe("resolveDependencies", () => {
    it("ID·패키지명을 가리지 않고 해석하고, 해석하지 못한 입력과 컴포넌트 없는 패키지를 알린다", () => {
      const resolution = resolveDependencies(["BBS", "nonexistent"]);
      expect(resolution.requested).toEqual(["bbs"]);
      expect(resolution.added).toEqual(["cmm", "tpl"]);
      expect(resolution.notFound).toEqual(["nonexistent"]);
      expect(resolution.unresolvedPackages).toEqual(["egovframework.com.missing.pkg"]);
    });
  });

  describe("listCommonComponents", () => {
    it("categoryId 는 카테고리 ID·이름·영문명 어느 것으로든 지정할 수 있다", () => {
      for (const categoryId of ["역할-권한관리", "역할/권한관리", "role/authority management"]) {
        const listed = listCommonComponents({ categoryId });
        expect(idsOf(listed.components).sort(), `categoryId=${categoryId}`).toEqual(["drm", "ram"]);
        expect(listed.total).toBe(2);
      }
    });

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
      // 게시판: 2행 / 컴포넌트·DDL·보여줘: 0행(세지 않는다) → 게시판이 일치하는 행을 찾는다
      const found = searchComponents("게시판 컴포넌트 DDL 보여줘");
      expect(idsOf(found.results)).toEqual(["bbs", "tpl"]);
      expect(found).toMatchObject({ total: 2, matchMode: "any-term" });

      const partial = searchComponents("게시판 컴포넌트");
      expect(idsOf(partial.results)).toEqual(["bbs", "tpl"]);
      expect(partial).toMatchObject({ total: 2, matchMode: "any-term" });

      // 일치하는 검색어가 하나도 없으면 결과가 없다
      const nothing = searchComponents("컴포넌트 DDL 보여줘");
      expect(nothing.results).toEqual([]);
      expect(nothing).toMatchObject({ total: 0, matchMode: "any-term" });
    });

    it("예상하지 못한 오류는 다른 검색으로 바꾸지 않고 그대로 던진다", () => {
      // 키워드 조회만 실패하게 한다. 예전에는 이 오류를 삼키고 keyword 필터 목록으로 대신 응답했다
      const original = SQLiteManager.prototype.queryComponents;
      vi.spyOn(SQLiteManager.prototype, "queryComponents").mockImplementation(function (
        this: SQLiteManager,
        options = {},
      ) {
        if (options.query) {
          throw new Error("database disk image is malformed");
        }
        return original.call(this, options);
      });

      expect(() => searchComponents("게시판")).toThrow("database disk image is malformed");
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

  /** 표의 줄만 골라, 이스케이프되지 않은 '|' 로 나눈 칸 수를 센다. */
  const columnCounts = (text: string): number[] =>
    text
      .split("\n")
      .filter((line) => line.startsWith("|"))
      .map((line) => line.split(/(?<!\\)\|/).length);

  describe("표의 셀", () => {
    // 설명에 줄바꿈과 '|' 가 들어 있는 컴포넌트 (고정 데이터의 cmm)
    const cmm = { ...COMPONENTS[7], category_name: "공통" };
    const tricky = {
      ...uia,
      component_id: "x|y",
      name: "이름|\n둘째 줄",
      category_name: "분류|A",
      package_name: "pkg.a|b",
      version: "1|0",
    };

    it("설명의 줄바꿈은 공백으로 바꾸고 '|' 는 이스케이프해 한 행에 싣는다", () => {
      const text = formatComponentList([uia, cmm], true);
      const row = text.split("\n").find((line) => line.includes("`cmm`"));
      expect(row).toContain("공통으로 쓰는 설정 파일 - 이중등록방지 \\| 메시지");
      // 머리글·구분선·행의 칸 수가 모두 같다 (행이 여러 줄로 갈라지지 않는다)
      expect(new Set(columnCounts(text)).size).toBe(1);
      expect(text.split("\n").filter((line) => line.startsWith("- 이중등록방지"))).toEqual([]);
    });

    it("설명은 줄바꿈을 정리한 뒤 50자에서 자른다", () => {
      const long = { ...uia, description: `${"가".repeat(30)}\n${"나".repeat(30)}` };
      const row = formatComponentList([long], true).split("\n").find((line) => line.includes("`uia`"));
      expect(row).toContain(`${"가".repeat(30)} ${"나".repeat(19)}... |`);
    });

    it("컴포넌트 목록의 두 표 형식 모두 모든 문자열 칸을 다듬는다", () => {
      for (const groupByCategory of [true, false]) {
        const text = formatComponentList([uia, tricky], groupByCategory);
        expect(new Set(columnCounts(text)).size, `groupByCategory=${groupByCategory}`).toBe(1);
        expect(text).toContain("이름\\| 둘째 줄");
        expect(text).toContain("`x\\|y`");
        expect(text).toContain("`pkg.a\\|b`");
      }
      expect(formatComponentList([tricky], false)).toContain("분류\\|A");
      expect(formatComponentList([tricky], false)).toContain("1\\|0");
    });

    it("설명이나 영문명이 없으면 '-' 를 적는다", () => {
      const bare = { ...uia, description: undefined };
      expect(formatComponentList([bare], true)).toMatch(/\| - \|\n/);
      const text = formatCategoryList([
        { category_id: "c1", name: "분류", name_en: "", description: undefined, description_en: undefined, component_count: 1 },
      ]);
      expect(text).toContain("| 1 | 분류 | `c1` | - | 1개 |");
    });

    it("카테고리 표의 칸도 다듬는다", () => {
      const text = formatCategoryList([
        {
          category_id: "a|b",
          name: "첫 줄\n둘째 줄",
          name_en: "A | B",
          description: undefined,
          description_en: undefined,
          component_count: 2,
        },
      ]);
      expect(text).toContain("| 1 | 첫 줄 둘째 줄 | `a\\|b` | A \\| B | 2개 |");
      expect(new Set(columnCounts(text)).size).toBe(1);
    });

    it("상세 정보의 의존성 표와 통계 표의 칸도 다듬는다", () => {
      const dependency = { ...sec, name: "의존|컴포넌트\n둘째 줄", package_name: "pkg.dep" };
      const info = formatComponentInfo(uia, ["pkg.dep", "pkg.none"], [dependency]);
      expect(info).toContain("### 기본 정보");
      expect(info).toContain("| `pkg.dep` | 의존\\|컴포넌트 둘째 줄 |");
      expect(info).toContain("| `pkg.none` | - |");
      expect(new Set(columnCounts(info)).size).toBe(1);

      const summary = formatComponentSummary({
        totalCategories: 2,
        totalComponents: 3,
        byCategory: [
          { category_id: "c1", name: "분류|하나", count: 2 },
          { category_id: "c2", name: null as unknown as string, count: 1 },
        ],
        byVersion: [{ version: "4.3.1\n", count: 3 }],
      });
      expect(summary).toContain("| 분류\\|하나 | 2개 |");
      // 카테고리 행이 없어 이름을 알 수 없으면 ID 를 적는다
      expect(summary).toContain("| c2 | 1개 |");
      expect(summary).toContain("| 4.3.1 | 3개 |");
    });
  });

  describe("결과가 없는 컴포넌트 목록", () => {
    it("제목을 출력하고 그 아래에 결과가 없다고 적는다", () => {
      for (const groupByCategory of [true, false]) {
        const text = formatComponentList([], groupByCategory);
        expect(text.startsWith("## 공통컴포넌트 목록 (0개)\n\n")).toBe(true);
        expect(text).toContain("검색 결과가 없습니다.");
      }
      expect(formatComponentList([], false, { total: 0, matchMode: "any-term" })).toContain(
        "## 공통컴포넌트 목록 (0개)",
      );
    });
  });

  describe("formatCategoryList", () => {
    const categories = CATEGORIES.map((category, index) => ({ ...category, component_count: index + 1 }));

    it("categoryId 필터에 쓸 카테고리 ID 열을 표에 넣는다", () => {
      const text = formatCategoryList(categories);
      expect(text).toContain("## eGovFrame 공통컴포넌트 카테고리");
      expect(text).toContain(`총 **${CATEGORIES.length}개** 카테고리`);

      const lines = text.split("\n");
      const header = lines.find((line) => line.includes("카테고리 ID"));
      expect(header).toBeDefined();
      expect(header).toContain("컴포넌트 수");

      // 이름과 ID 가 다른 카테고리는 두 값이 한 행에 함께 나온다
      const row = lines.find((line) => line.includes("역할/권한관리"));
      expect(row).toContain("역할-권한관리");
      expect(row).toContain("Role/Authority Management");
      expect(row).toContain("3개");
    });

    it("머리글과 각 행의 열 수가 같다", () => {
      const tableLines = formatCategoryList(categories)
        .split("\n")
        .filter((line) => line.startsWith("|"));
      const columns = tableLines.map((line) => line.split("|").length);
      expect(tableLines).toHaveLength(CATEGORIES.length + 2);
      expect(new Set(columns).size).toBe(1);
    });
  });

  describe("formatDependencyResolution", () => {
    const resolution = {
      requested: ["bbs"],
      resolved: ["bbs", "cmm", "tpl"],
      added: ["cmm", "tpl"],
      packages: ["egovframework.com.cop.bbs", "egovframework.com.cmm", "egovframework.com.cop.tpl"],
      notFound: [] as string[],
      unresolvedPackages: [] as string[],
    };

    it("제목과 기존 섹션을 유지한다", () => {
      const text = formatDependencyResolution(resolution);
      expect(text).toContain("## 의존성 해결 결과");
      expect(text).toContain("### 요청한 컴포넌트 (1개)\n\n- bbs\n");
      expect(text).toContain("### 자동 추가된 의존성 (2개)\n\n- cmm\n- tpl\n");
      expect(text).toContain("### 전체 필요 컴포넌트 (3개)\n\n- bbs\n- cmm\n- tpl\n");
      expect(text).toContain("### 필요 패키지 목록 (3개)");
      expect(text).toContain("egovframework.com.cop.bbs\negovframework.com.cmm\negovframework.com.cop.tpl");
    });

    it("두 목록이 비어 있으면 해당 섹션을 출력하지 않는다", () => {
      const text = formatDependencyResolution(resolution);
      expect(text).not.toContain("찾을 수 없는");
      expect(text).not.toContain("컴포넌트 정보가 없는");
    });

    it("해석하지 못한 입력(notFound)이 있으면 출력한다", () => {
      const text = formatDependencyResolution({ ...resolution, notFound: ["nonexistent", "게시판"] });
      expect(text).toContain("찾을 수 없는 입력 (2개)");
      expect(text).toContain("- nonexistent\n- 게시판\n");
    });

    it("컴포넌트 행이 없는 의존 패키지(unresolvedPackages)가 있으면 출력한다", () => {
      const text = formatDependencyResolution({
        ...resolution,
        unresolvedPackages: ["egovframework.com.missing.pkg"],
      });
      expect(text).toContain("컴포넌트 정보가 없는 의존 패키지 (1개)");
      expect(text).toContain("egovframework.com.missing.pkg");
    });

    it("하나도 해석하지 못했으면 빈 목록 대신 '없음' 을 적는다", () => {
      const text = formatDependencyResolution({
        requested: [],
        resolved: [],
        added: [],
        packages: [],
        notFound: ["nonexistent"],
        unresolvedPackages: [],
      });
      expect(text).toContain("## 의존성 해결 결과");
      expect(text).toContain("### 요청한 컴포넌트 (0개)\n\n없음\n");
      expect(text).toContain("### 전체 필요 컴포넌트 (0개)\n\n없음\n");
      expect(text).toContain("### 필요 패키지 목록 (0개)\n\n없음\n");
      expect(text).toContain("- nonexistent");
      expect(text).not.toContain("```\n\n```");
    });
  });

  describe("formatComponentList", () => {
    it("카테고리별 표와 한 줄 표 모두에 컴포넌트 ID 열을 넣는다", () => {
      for (const groupByCategory of [true, false]) {
        const lines = formatComponentList([uia, sec], groupByCategory).split("\n");
        const header = lines.find((line) => line.startsWith("|") && line.includes("컴포넌트 ID"));
        expect(header, `groupByCategory=${groupByCategory}`).toBeDefined();

        // 상세 조회(filters.componentId)에 넣을 ID 가 이름·패키지명과 같은 행에 있다
        const row = lines.find((line) => line.includes("일반로그인"));
        expect(row).toMatch(/\|\s*`?uia`?\s*\|/);
        expect(row).toContain("egovframework.com.uat.uia");

        const columns = lines.filter((line) => line.startsWith("|")).map((line) => line.split("|").length);
        expect(new Set(columns).size).toBe(1);
      }
    });

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
