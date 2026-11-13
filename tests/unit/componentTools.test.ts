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

    it("없는 패키지명을 넣으면 패키지명의 조각만 일치하는 컴포넌트를 후보로 돌려주지 않는다", () => {
      // 'egovframework.com.cop.zzz' 는 어느 컴포넌트의 패키지도 아니다. 조각으로 나눠 찾던 때에는 'com'(모든 패키지명)과
      // 'cop'(bbs, tpl)이 일치해, 입력과 관계없는 컴포넌트가 "비슷한 컴포넌트" 로 붙었다
      for (const input of ["egovframework.com.cop.zzz", "egovframework.com.zzz"]) {
        const info = getComponentInfo(input);
        expect(info.component, `input=${input}`).toBeNull();
        expect(info.suggestions, `input=${input}`).toEqual([]);
      }
    });

    it("구분 기호만 다르게 적은 패키지명과 영문명은 그 컴포넌트를 후보로 돌려준다", () => {
      expect(idsOf(getComponentInfo("egovframework-com-cop-bbs").suggestions)).toEqual(["bbs"]);
      expect(idsOf(getComponentInfo("General_Login").suggestions)).toEqual(["uia"]);
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

    it("카테고리 이름, 컴포넌트 이름 순으로 돌려준다 (적재 순서가 아니다)", () => {
      // 적재 순서는 uia, sec, bbs, tpl, ram, drm, bst, cmm 이다
      const BY_NAME = ["bbs", "tpl", "cmm", "sec", "uia", "ram", "drm", "bst"];
      expect(idsOf(listCommonComponents().components)).toEqual(BY_NAME);
      expect(idsOf(listCommonComponents({ version: "4.3.1" }, 3).components)).toEqual(["bbs", "tpl", "sec"]);
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

    it("keyword 에 NUL 문자가 들었거나 지나치게 긴 값을 줘도 오류 없이 0건으로 응답한다", () => {
      // NUL 이 든 값은 필터가 무시되어 전체가 나왔고, LIKE 패턴 한도(50,000바이트)를 넘는 값은 SQLite 오류가 났다
      for (const keyword of ["\u0000게시판", "a".repeat(50000)]) {
        const label = `값 ${Buffer.byteLength(keyword, "utf8")}바이트`;
        expect(listCommonComponents({ keyword }), label).toMatchObject({ components: [], total: 0 });
        expect(searchComponents("게시", 20, { keyword }), label).toMatchObject({ results: [], total: 0 });
      }
    });
  });

  describe("searchComponents", () => {
    it("모든 검색어가 일치하는 컴포넌트를 찾으면 all-terms 를 알린다", () => {
      const found = searchComponents("게시판 템플릿");
      expect(idsOf(found.results)).toEqual(["tpl"]);
      expect(found).toMatchObject({ query: "게시판 템플릿", total: 1, matchMode: "all-terms" });
    });

    it("모든 검색어가 든 컴포넌트가 없어 대체 검색으로 찾았으면 any-term 을 알린다", () => {
      // 게시판: 2행 / DDL·보여줘: 0행(세지 않는다) → 게시판이 일치하는 행을 찾는다 ('컴포넌트' 는 검색어로 쓰지 않는다)
      const found = searchComponents("게시판 컴포넌트 DDL 보여줘");
      expect(idsOf(found.results)).toEqual(["bbs", "tpl"]);
      expect(found).toMatchObject({ total: 2, matchMode: "any-term" });

      const partial = searchComponents("게시판 보여줘");
      expect(idsOf(partial.results)).toEqual(["bbs", "tpl"]);
      expect(partial).toMatchObject({ total: 2, matchMode: "any-term" });

      // 일치하는 검색어가 하나도 없으면 결과가 없다
      const nothing = searchComponents("컴포넌트 DDL 보여줘");
      expect(nothing.results).toEqual([]);
      expect(nothing).toMatchObject({ total: 0, matchMode: "any-term" });
    });

    it("목록의 모든 항목에 해당하는 낱말을 빼고 남은 검색어가 모두 일치하면 all-terms 다", () => {
      // '컴포넌트' 를 검색어로 쓰던 때에는 그 낱말이 든 컴포넌트가 없어 대체 검색(any-term)이 되었다
      const found = searchComponents("게시판 컴포넌트");
      expect(idsOf(found.results)).toEqual(["bbs", "tpl"]);
      expect(found).toMatchObject({ total: 2, matchMode: "all-terms", droppedTerms: ["컴포넌트"] });
      expect(found).not.toHaveProperty("usedTerms");
      expect(found).not.toHaveProperty("ignoredTerms");
    });

    it("낱말의 가운데나 뒤쪽에 든 검색어로 찾은 결과는 all-terms 다", () => {
      const found = searchComponents("증서");
      expect(idsOf(found.results)).toEqual(["sec"]);
      expect(found).toMatchObject({ total: 1, matchMode: "all-terms" });
    });

    it("일치하는 컴포넌트가 없어 쓰지 않은 검색어를 ignoredTerms 로 알린다", () => {
      // '컴포넌트' 는 일치하는 컴포넌트가 있는지 보기 전에 빼는 낱말이라 droppedTerms 에 따로 실린다
      const sentence = searchComponents("게시판 컴포넌트 DDL 보여줘");
      expect(sentence.ignoredTerms).toEqual(["DDL", "보여줘"]);
      expect(sentence.droppedTerms).toEqual(["컴포넌트"]);
      // 결과가 0건이어도 알린다. 쓸 수 있는 다른 검색어가 없으면 '컴포넌트' 도 빼지 않고 검색어로 견주므로,
      // 일치하는 컴포넌트가 없는 검색어로 함께 실린다 (고정 데이터에는 '컴포넌트' 가 든 컴포넌트가 없다)
      const nothing = searchComponents("컴포넌트 DDL 보여줘");
      expect(nothing.total).toBe(0);
      expect(nothing.ignoredTerms).toEqual(["컴포넌트", "DDL", "보여줘"]);
      expect(nothing).not.toHaveProperty("droppedTerms");
      // 필터를 적용한 대상 안에서 일치하는 컴포넌트가 없는 검색어도 알린다
      expect(searchComponents("증서 게시판", 20, { categoryId: "로그인" }).ignoredTerms).toEqual(["게시판"]);
    });

    it("대체 검색으로 찾았으면 쓴 검색어(usedTerms)와 적용한 일치 기준(requiredMatches)을 알린다", () => {
      // 시판: bbs, tpl / 플릿: tpl / 통계: bst → 셋 가운데 둘 이상이 든 tpl
      const half = searchComponents("시판 플릿 통계");
      expect(idsOf(half.results)).toEqual(["tpl"]);
      expect(half).toMatchObject({ matchMode: "any-term", usedTerms: ["시판", "플릿", "통계"], requiredMatches: 2 });

      // 둘 이상이 함께 든 컴포넌트가 없으면 기준을 낮춰 찾고, 낮춘 기준을 알린다
      const lowered = searchComponents("증서 통계 권한관리");
      expect(idsOf(lowered.results)).toEqual(["ram", "bst", "drm", "sec"]);
      expect(lowered).toMatchObject({
        total: 4,
        matchMode: "any-term",
        usedTerms: ["증서", "통계", "권한관리"],
        requiredMatches: 1,
      });

      // 조사를 떼어 쓴 검색어는 뗀 꼴이고, 쓰지 않은 검색어는 들어가지 않는다
      expect(searchComponents("게시판을 만들고")).toMatchObject({ usedTerms: ["게시판"], requiredMatches: 1 });
      // 쓸 검색어가 하나도 없으면 빈 목록과 0 이다
      expect(searchComponents("컴포넌트 DDL 보여줘")).toMatchObject({ total: 0, usedTerms: [], requiredMatches: 0 });
    });

    it("모든 검색어가 일치했거나 검색어가 없으면 usedTerms 와 requiredMatches 를 싣지 않는다", () => {
      for (const found of [searchComponents("게시판 템플릿"), searchComponents("?!")]) {
        expect(found).not.toHaveProperty("usedTerms");
        expect(found).not.toHaveProperty("requiredMatches");
      }
    });

    it("모든 검색어를 썼으면 ignoredTerms 를 싣지 않는다", () => {
      for (const query of ["게시판 템플릿", "증서 시판", "게시판을"]) {
        const found = searchComponents(query);
        expect(found.results.length, `query=${query}`).toBeGreaterThan(0);
        expect(found, `query=${query}`).not.toHaveProperty("ignoredTerms");
      }
      expect(searchComponents("?!")).not.toHaveProperty("ignoredTerms");
    });

    it("영어 기능어와 프레임워크 자체를 가리키는 낱말도 droppedTerms 로 알린다", () => {
      const sentence = searchComponents("how to implement login in eGovFrame");
      expect(idsOf(sentence.results)).toEqual(["uia", "sec"]);
      expect(sentence).toMatchObject({
        matchMode: "any-term",
        usedTerms: ["login"],
        ignoredTerms: ["implement"],
        droppedTerms: ["how", "to", "in", "eGovFrame"],
      });
      // 그런 낱말뿐이면 빼지 않는다
      expect(searchComponents("egovframework")).not.toHaveProperty("droppedTerms");
    });

    it("한 글자라서 뺀 검색어를 droppedTerms 로 알린다", () => {
      // 'x', 'y' 까지 든 컴포넌트는 없어, 두 글자를 빼고 '증서' 로 찾았다 (모든 검색어가 일치한 결과에도 싣는다)
      const retried = searchComponents("x y 증서");
      expect(idsOf(retried.results)).toEqual(["sec"]);
      expect(retried).toMatchObject({ matchMode: "all-terms", droppedTerms: ["x", "y"] });
      expect(retried).not.toHaveProperty("ignoredTerms");

      // 대체 검색 결과에서는 일치하는 컴포넌트가 없는 검색어와 구분해 싣는다
      expect(searchComponents("y 증서 없는말")).toMatchObject({
        matchMode: "any-term",
        usedTerms: ["증서"],
        ignoredTerms: ["없는말"],
        droppedTerms: ["y"],
      });

      // 뺀 검색어가 없으면 싣지 않는다
      for (const query of ["로그인 서", "게시판 템플릿", "게시판을 만들고", "?!"]) {
        expect(searchComponents(query), `query=${query}`).not.toHaveProperty("droppedTerms");
      }
    });

    it("query 에 OR 가 있으면 하나 이상 일치하는 컴포넌트를 돌려주고 orQuery 로 알린다", () => {
      // '게시판 템플릿' 은 두 검색어가 모두 든 tpl 한 건이다. OR 로 이으면 '게시판' 만 든 bbs 도 나온다
      const found = searchComponents("게시판 OR 템플릿");
      expect(idsOf(found.results)).toEqual(["tpl", "bbs"]);
      expect(found).toMatchObject({
        total: 2,
        matchMode: "any-term",
        orQuery: true,
        usedTerms: ["게시판", "템플릿"],
        requiredMatches: 1,
      });
      expect(searchComponents("증서 OR 없는말")).toMatchObject({ orQuery: true, usedTerms: ["증서"], ignoredTerms: ["없는말"] });

      // OR 가 없으면 싣지 않는다 (모든 검색어가 든 컴포넌트가 없어 대체 검색으로 넘어간 결과도 같다)
      for (const query of ["게시판 템플릿", "게시판 AND 템플릿", "게시판 보여줘", "?!", "OR"]) {
        expect(searchComponents(query), `query=${query}`).not.toHaveProperty("orQuery");
      }
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

    const ANY_TERM_NOTE = "> 모든 검색어가 들어 있는 항목이 없어, 검색어의 절반 이상이 들어 있는 항목을 표시합니다.";

    it("대체 검색으로 찾은 결과(any-term)이면 그 사실을 제목 아래에 적는다", () => {
      for (const groupByCategory of [true, false]) {
        const lines = formatComponentList([uia, sec], groupByCategory, { matchMode: "any-term" }).split("\n");
        expect(lines.slice(0, 4), `groupByCategory=${groupByCategory}`).toEqual([
          "## 공통컴포넌트 목록 (2개)",
          "",
          ANY_TERM_NOTE,
          "",
        ]);
      }
    });

    it("쓴 검색어와 일치 기준을 받으면 any-term 안내에 그 수와 검색어를 적는다", () => {
      for (const groupByCategory of [true, false]) {
        const lines = formatComponentList([uia, sec], groupByCategory, {
          matchMode: "any-term",
          usedTerms: ["로그인", "인증서", "통계"],
          requiredMatches: 2,
        }).split("\n");
        expect(lines.slice(0, 4), `groupByCategory=${groupByCategory}`).toEqual([
          "## 공통컴포넌트 목록 (2개)",
          "",
          "> 모든 검색어가 들어 있는 항목이 없어, 검색어 3개 가운데 2개 이상이 들어 있는 항목을 표시합니다 (검색어: 로그인, 인증서, 통계).",
          "",
        ]);
      }
      // 기준을 낮춰 찾은 결과
      expect(
        formatComponentList([uia], false, { matchMode: "any-term", usedTerms: ["증서", "통계", "권한관리"], requiredMatches: 1 }),
      ).toContain("검색어 3개 가운데 1개 이상이 들어 있는 항목을 표시합니다 (검색어: 증서, 통계, 권한관리).");
    });

    it("쓴 검색어를 받지 못하면 지금까지의 문구를 그대로 쓴다", () => {
      // 일치 기준만 받았거나 쓴 검색어가 비어 있어도 같다 (적을 검색어가 없다)
      for (const options of [
        { matchMode: "any-term" as const },
        { matchMode: "any-term" as const, requiredMatches: 1 },
        { matchMode: "any-term" as const, usedTerms: [], requiredMatches: 0 },
        { matchMode: "any-term" as const, usedTerms: ["로그인"] },
      ]) {
        const lines = formatComponentList([uia, sec], false, options).split("\n");
        expect(lines[2], JSON.stringify(options)).toBe(ANY_TERM_NOTE);
      }
    });

    it("query 에 OR 가 있어 찾은 결과(orQuery)이면 모든 검색어가 든 항목이 없다고 적지 않고 OR 로 찾았다고 적는다", () => {
      for (const groupByCategory of [true, false]) {
        const text = formatComponentList([uia, sec], groupByCategory, {
          matchMode: "any-term",
          orQuery: true,
          usedTerms: ["로그인", "인증서"],
          requiredMatches: 1,
        });
        expect(text.split("\n").slice(0, 4), `groupByCategory=${groupByCategory}`).toEqual([
          "## 공통컴포넌트 목록 (2개)",
          "",
          "> query 에 OR 가 있어, 검색어 2개 가운데 1개 이상이 들어 있는 항목을 표시합니다 (검색어: 로그인, 인증서).",
          "",
        ]);
        // 모든 검색어가 든 항목이 있어도 OR 로 찾으므로, 그런 항목이 없다는 문구는 사실과 다르다
        expect(text).not.toContain("모든 검색어가 들어 있는 항목이 없어");
      }
    });

    it("orQuery 인데 쓴 검색어를 받지 못하면 검색어를 적지 않은 문구를 쓴다", () => {
      for (const options of [
        { matchMode: "any-term" as const, orQuery: true },
        { matchMode: "any-term" as const, orQuery: true, requiredMatches: 1 },
        { matchMode: "any-term" as const, orQuery: true, usedTerms: ["로그인"] },
      ]) {
        const lines = formatComponentList([uia, sec], false, options).split("\n");
        expect(lines[2], JSON.stringify(options)).toBe(
          "> query 에 OR 가 있어, 검색어 가운데 하나 이상이 들어 있는 항목을 표시합니다.",
        );
      }
    });

    it("orQuery 여도 쓰지 않은 낱말과 뺀 낱말은 그 다음 줄에 적고, 결과가 없으면 항목을 표시한다는 안내는 적지 않는다", () => {
      const lines = formatComponentList([uia], false, {
        matchMode: "any-term",
        orQuery: true,
        usedTerms: ["로그인"],
        requiredMatches: 1,
        ignoredTerms: ["없는말"],
        droppedTerms: ["x"],
      }).split("\n");
      expect(lines.slice(0, 8)).toEqual([
        "## 공통컴포넌트 목록 (1개)",
        "",
        "> query 에 OR 가 있어, 검색어 1개 가운데 1개 이상이 들어 있는 항목을 표시합니다 (검색어: 로그인).",
        "",
        "> 일치하는 항목이 없어 검색에 쓰지 않은 낱말: 없는말.",
        "",
        "> 한 글자이거나, 영어 기능어이거나, 목록의 모든 항목에 해당해 검색에 쓰지 않은 낱말: x.",
        "",
      ]);

      const empty = formatComponentList([], false, {
        total: 0,
        matchMode: "any-term",
        orQuery: true,
        usedTerms: [],
        requiredMatches: 0,
        ignoredTerms: ["없는말", "다른말"],
      });
      expect(empty.split("\n")).toEqual([
        "## 공통컴포넌트 목록 (0개)",
        "",
        "> 일치하는 항목이 없어 검색에 쓰지 않은 낱말: 없는말, 다른말.",
        "",
        "검색 결과가 없습니다.",
        "",
      ]);
    });

    it("orQuery 가 false 이거나 없으면 대체 검색 안내를 그대로 쓴다", () => {
      for (const orQuery of [false, undefined]) {
        const text = formatComponentList([uia], false, {
          matchMode: "any-term",
          orQuery,
          usedTerms: ["로그인", "통계"],
          requiredMatches: 1,
        });
        expect(text, `orQuery=${orQuery}`).toContain(
          "> 모든 검색어가 들어 있는 항목이 없어, 검색어 2개 가운데 1개 이상이 들어 있는 항목을 표시합니다 (검색어: 로그인, 통계).",
        );
        expect(text, `orQuery=${orQuery}`).not.toContain("query 에 OR 가 있어");
      }
      // 모든 검색어가 일치한 결과에는 orQuery 를 줘도 적지 않는다 (OR 로 찾은 결과는 언제나 any-term 이다)
      expect(formatComponentList([uia], false, { matchMode: "all-terms", orQuery: true })).not.toContain("OR 가 있어");
    });

    it("쓴 검색어와 일치 기준 다음 줄에 쓰지 않은 낱말을 적는다", () => {
      const lines = formatComponentList([uia], false, {
        matchMode: "any-term",
        usedTerms: ["로그인"],
        requiredMatches: 1,
        ignoredTerms: ["컴포넌트", "보여줘"],
      }).split("\n");
      expect(lines.slice(0, 6)).toEqual([
        "## 공통컴포넌트 목록 (1개)",
        "",
        "> 모든 검색어가 들어 있는 항목이 없어, 검색어 1개 가운데 1개 이상이 들어 있는 항목을 표시합니다 (검색어: 로그인).",
        "",
        "> 일치하는 항목이 없어 검색에 쓰지 않은 낱말: 컴포넌트, 보여줘.",
        "",
      ]);
    });

    it("모든 검색어가 일치했거나 matchMode 를 주지 않으면 적지 않는다", () => {
      for (const text of [
        formatComponentList([uia, sec], false, { matchMode: "all-terms" }),
        formatComponentList([uia, sec], false, { matchMode: "all-terms", usedTerms: ["로그인"], requiredMatches: 1 }),
        formatComponentList([uia, sec], false),
        formatComponentList([uia, sec]),
      ]) {
        expect(text).not.toContain("모든 검색어가 들어 있는 항목이 없어");
        expect(text).not.toContain("검색에 쓰지 않은 낱말");
      }
    });

    it("검색에 쓰지 않은 낱말(ignoredTerms)이 있으면 any-term 안내 다음 줄에 적는다", () => {
      for (const groupByCategory of [true, false]) {
        const lines = formatComponentList([uia, sec], groupByCategory, {
          matchMode: "any-term",
          ignoredTerms: ["컴포넌트", "보여줘"],
        }).split("\n");
        expect(lines.slice(0, 6), `groupByCategory=${groupByCategory}`).toEqual([
          "## 공통컴포넌트 목록 (2개)",
          "",
          ANY_TERM_NOTE,
          "",
          "> 일치하는 항목이 없어 검색에 쓰지 않은 낱말: 컴포넌트, 보여줘.",
          "",
        ]);
        // 안내 다음에 표가 이어진다
        expect(lines[6].startsWith(groupByCategory ? "### " : "| 컴포넌트 ID |")).toBe(true);
      }
    });

    it("쓰지 않은 낱말이 하나뿐이어도, any-term 안내가 없어도 적는다", () => {
      const lines = formatComponentList([uia], false, { ignoredTerms: ["DDL"] }).split("\n");
      expect(lines.slice(0, 4)).toEqual([
        "## 공통컴포넌트 목록 (1개)",
        "",
        "> 일치하는 항목이 없어 검색에 쓰지 않은 낱말: DDL.",
        "",
      ]);
    });

    it("ignoredTerms 가 비어 있으면 적지 않는다", () => {
      expect(formatComponentList([uia, sec], false, { matchMode: "any-term", ignoredTerms: [] })).not.toContain(
        "검색에 쓰지 않은 낱말",
      );
    });

    const DROPPED_NOTE =
      "> 한 글자이거나, 영어 기능어이거나, 목록의 모든 항목에 해당해 검색에 쓰지 않은 낱말: x, with, 컴포넌트.";

    it("검색에서 뺀 낱말(droppedTerms)은 일치하는 항목이 없어 쓰지 않은 낱말 다음 줄에 따로 적는다", () => {
      const lines = formatComponentList([uia], false, {
        matchMode: "any-term",
        usedTerms: ["로그인"],
        requiredMatches: 1,
        ignoredTerms: ["보여줘"],
        droppedTerms: ["x", "with", "컴포넌트"],
      }).split("\n");
      expect(lines.slice(0, 8)).toEqual([
        "## 공통컴포넌트 목록 (1개)",
        "",
        "> 모든 검색어가 들어 있는 항목이 없어, 검색어 1개 가운데 1개 이상이 들어 있는 항목을 표시합니다 (검색어: 로그인).",
        "",
        "> 일치하는 항목이 없어 검색에 쓰지 않은 낱말: 보여줘.",
        "",
        DROPPED_NOTE,
        "",
      ]);
    });

    it("모든 검색어가 일치한 결과에도 뺀 낱말을 적는다", () => {
      for (const groupByCategory of [true, false]) {
        const lines = formatComponentList([sec], groupByCategory, {
          matchMode: "all-terms",
          droppedTerms: ["x", "with", "컴포넌트"],
        }).split("\n");
        expect(lines.slice(0, 4), `groupByCategory=${groupByCategory}`).toEqual([
          "## 공통컴포넌트 목록 (1개)",
          "",
          DROPPED_NOTE,
          "",
        ]);
        // 안내 다음에 표가 이어진다
        expect(lines[4].startsWith(groupByCategory ? "### " : "| 컴포넌트 ID |")).toBe(true);
      }
    });

    it("결과가 없어도 뺀 낱말을 적는다", () => {
      const text = formatComponentList([], false, {
        total: 0,
        matchMode: "any-term",
        usedTerms: [],
        requiredMatches: 0,
        ignoredTerms: ["없는말"],
        droppedTerms: ["x", "with", "컴포넌트"],
      });
      expect(text.split("\n")).toEqual([
        "## 공통컴포넌트 목록 (0개)",
        "",
        "> 일치하는 항목이 없어 검색에 쓰지 않은 낱말: 없는말.",
        "",
        DROPPED_NOTE,
        "",
        "검색 결과가 없습니다.",
        "",
      ]);
    });

    it("droppedTerms 가 비어 있거나 없으면 적지 않는다", () => {
      for (const options of [{ matchMode: "all-terms" as const, droppedTerms: [] }, { matchMode: "all-terms" as const }]) {
        expect(formatComponentList([uia, sec], false, options)).not.toContain("검색에 쓰지 않은 낱말");
      }
    });

    it("결과가 없으면 쓰지 않은 낱말만 적고, 항목을 표시한다는 any-term 안내는 적지 않는다", () => {
      const text = formatComponentList([], false, {
        total: 0,
        matchMode: "any-term",
        usedTerms: [],
        requiredMatches: 0,
        ignoredTerms: ["컴포넌트", "DDL", "보여줘"],
      });
      expect(text.split("\n")).toEqual([
        "## 공통컴포넌트 목록 (0개)",
        "",
        "> 일치하는 항목이 없어 검색에 쓰지 않은 낱말: 컴포넌트, DDL, 보여줘.",
        "",
        "검색 결과가 없습니다.",
        "",
      ]);
    });
  });
});
