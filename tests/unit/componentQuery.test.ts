/**
 * SQLiteManager 공통컴포넌트 조회 단위 테스트
 *
 * 키워드 조회(queryComponents)의 동작을 고정한다.
 * 임시 디렉토리의 새 DB 만 사용한다 (knowledge-base/egovframe.db 에 의존하지 않음).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SQLiteManager } from "../../src/database/sqliteManager.js";
import { COMPONENTS, idsOf, seedComponents } from "./_componentFixture.js";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";

describe("SQLiteManager 공통컴포넌트 조회", () => {
  let tmpDir: string;
  let sqlite: SQLiteManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "egov-component-query-"));
    sqlite = new SQLiteManager(path.join(tmpDir, "egovframe.db"));
    seedComponents(sqlite);
  });

  afterEach(async () => {
    sqlite.close();
    await fs.remove(tmpDir);
  });

  describe("부분 일치 대체 검색", () => {
    it("모든 검색어가 일치하는 컴포넌트가 있으면 그것만 돌려주고 matchMode 는 all-terms 다", () => {
      const result = sqlite.queryComponents({ query: "게시판 템플릿" });
      expect(idsOf(result.rows)).toEqual(["tpl"]);
      expect(result.total).toBe(1);
      expect(result.matchMode).toBe("all-terms");
    });

    it("낱말 중간에 있는 검색어는 부분 문자열로 찾고 matchMode 는 any-term 이다", () => {
      // '인증서로그인'·'공인인증서로' 의 중간이라 접두 일치("증서"*)로는 찾지 못한다
      const result = sqlite.queryComponents({ query: "증서" });
      expect(idsOf(result.rows)).toEqual(["sec"]);
      expect(result.total).toBe(1);
      expect(result.matchMode).toBe("any-term");
    });

    it("문장으로 물어도 뜻이 있는 검색어가 일치하는 컴포넌트를 찾는다", () => {
      // 게시판: 2행 / 컴포넌트: 0행 → k=2, 한 개 이상 일치하면 통과
      const result = sqlite.queryComponents({ query: "게시판 컴포넌트" });
      expect(idsOf(result.rows)).toEqual(["bbs", "tpl"]);
      expect(result.matchMode).toBe("any-term");
    });

    it("절반을 넘는 행에 들어 있는 검색어는 빼고, 남은 검색어의 절반 이상이 일치하는 행만 돌려준다", () => {
      // 기능: 7행(제외) / 게시판: 2행 / 없는말: 0행 → k=2, 한 개 이상 일치
      expect(idsOf(sqlite.queryComponents({ query: "기능 게시판 없는말" }).rows)).toEqual(["bbs", "tpl"]);
      // 게시판: 2행 / 만들기: 0행 / 방법: 0행 → k=3, 두 개 이상 일치해야 하므로 없음
      expect(sqlite.queryComponents({ query: "게시판 만들기 방법" }).rows).toEqual([]);
      // 능을('기능을' 의 중간): 7행(제외) / 공함('제공함' 의 중간): 7행(제외) → k=0
      const nothing = sqlite.queryComponents({ query: "능을 공함" });
      expect(nothing.rows).toEqual([]);
      expect(nothing.total).toBe(0);
      expect(nothing.matchMode).toBe("any-term");
    });

    it("일치한 검색어 수가 많은 컴포넌트를 먼저, 같으면 컴포넌트 ID 순으로 돌려준다", () => {
      // 시판: bbs, tpl / 플릿: tpl → tpl 은 2개, bbs 는 1개 일치
      expect(idsOf(sqlite.queryComponents({ query: "시판 플릿" }).rows)).toEqual(["tpl", "bbs"]);
      // 한 개씩 일치하면 ID 순
      expect(idsOf(sqlite.queryComponents({ query: "시판 없는말" }).rows)).toEqual(["bbs", "tpl"]);
    });

    it("이름·영문명·설명·패키지명에서 찾는다", () => {
      expect(idsOf(sqlite.queryComponents({ query: "반로그" }).rows)).toEqual(["uia"]); // name
      expect(idsOf(sqlite.queryComponents({ query: "ertificat" }).rows)).toEqual(["sec"]); // name_en
      expect(idsOf(sqlite.queryComponents({ query: "밀번호" }).rows)).toEqual(["uia"]); // description
      expect(idsOf(sqlite.queryComponents({ query: "tl.se" }).rows)).toEqual(["sec"]); // package_name
    });

    it("한 글자 검색어는 대체 검색에서 쓰지 않는다", () => {
      // 'x', 'y' 를 검색어로 세면 k=3 이 되어 '증서' 하나만 일치하는 행이 탈락한다
      expect(idsOf(sqlite.queryComponents({ query: "x y 증서" }).rows)).toEqual(["sec"]);
    });

    it("limit 은 대체 검색 결과에도 적용하고, total 은 전체 일치 건수다", () => {
      const result = sqlite.queryComponents({ query: "시판 플릿", limit: 1 });
      expect(idsOf(result.rows)).toEqual(["tpl"]);
      expect(result.total).toBe(2);
    });

    it("FTS5 질의 오류가 아닌 오류는 다른 검색으로 바꾸지 않고 그대로 던진다", () => {
      (sqlite as any).db.exec("DROP TABLE components_fts");
      expect(() => sqlite.queryComponents({ query: "게시판" })).toThrow(/components_fts/);
    });
  });

  describe("필터", () => {
    it("키워드 검색 결과에 카테고리 필터를 함께 적용한다", () => {
      // '관리' 는 tpl(게시판), ram·drm(역할-권한관리)의 설명과 일치한다
      expect(idsOf(sqlite.queryComponents({ query: "관리" }).rows).sort()).toEqual(["drm", "ram", "tpl"]);
      expect(
        idsOf(sqlite.queryComponents({ query: "관리", filters: { categoryId: "역할-권한관리" } }).rows).sort(),
      ).toEqual(["drm", "ram"]);
      const board = sqlite.queryComponents({ query: "관리", filters: { categoryId: "게시판" } });
      expect(idsOf(board.rows)).toEqual(["tpl"]);
      expect(board.total).toBe(1);
      expect(board.matchMode).toBe("all-terms");
    });

    it("hasWeb, version, keyword 필터도 키워드 검색에 적용한다", () => {
      // '게시' 로 시작하는 낱말: bbs, tpl(4.3.1), bst(5.0.0)
      expect(idsOf(sqlite.queryComponents({ query: "게시" }).rows).sort()).toEqual(["bbs", "bst", "tpl"]);
      expect(idsOf(sqlite.queryComponents({ query: "게시", filters: { version: "5.0.0" } }).rows)).toEqual(["bst"]);
      expect(idsOf(sqlite.queryComponents({ query: "게시", filters: { keyword: "템플릿" } }).rows)).toEqual(["tpl"]);
      // cmm 만 웹 배포 대상이 아니다
      expect(idsOf(sqlite.queryComponents({ query: "공통", filters: { hasWeb: false } }).rows)).toEqual(["cmm"]);
      expect(sqlite.queryComponents({ query: "공통", filters: { hasWeb: true } }).rows).toEqual([]);
    });

    it("필터는 LIMIT 보다 먼저 적용한다", () => {
      // 필터를 나중에 적용하면 상위 1건만 남긴 뒤 걸러, 버전에 따라 0건이 된다
      for (const version of ["4.3.1", "5.0.0"]) {
        const result = sqlite.queryComponents({ query: "게시", filters: { version }, limit: 1 });
        expect(result.rows.map((row) => row.version)).toEqual([version]);
      }
    });

    it("부분 일치 대체 검색에도 필터를 적용한다", () => {
      // 증서: sec / 시판: bbs, tpl → 한 개 이상 일치
      expect(idsOf(sqlite.queryComponents({ query: "증서 시판" }).rows)).toEqual(["bbs", "sec", "tpl"]);
      const login = sqlite.queryComponents({ query: "증서 시판", filters: { categoryId: "로그인" } });
      expect(idsOf(login.rows)).toEqual(["sec"]);
      expect(login.total).toBe(1);
      expect(login.matchMode).toBe("any-term");
    });

    it("필터까지 만족하는 컴포넌트가 없으면 부분 일치 검색으로 넘어간다", () => {
      // '게시판 관리' 는 tpl 하나와 일치하지만 tpl 은 4.3.1 이다.
      // 대체 검색: 게시판 2행, 관리 3행 → 5.0.0 가운데 일치하는 행이 없다
      const result = sqlite.queryComponents({ query: "게시판 관리", filters: { version: "5.0.0" } });
      expect(result.rows).toEqual([]);
      expect(result.matchMode).toBe("any-term");
    });

    it("query 없이 필터만 주면 카테고리·이름 순 목록을 돌려주고 matchMode 는 넣지 않는다", () => {
      const result = sqlite.queryComponents({ filters: { categoryId: "게시판" } });
      expect(idsOf(result.rows)).toEqual(["bbs", "tpl"]);
      expect(result.total).toBe(2);
      expect(result.matchMode).toBeUndefined();
      expect(idsOf(sqlite.queryComponents({ filters: { hasWeb: false } }).rows)).toEqual(["cmm"]);
    });

    it("query 에서 검색어가 하나도 추출되지 않으면 query 가 없는 것으로 보고 필터만 적용한다", () => {
      const result = sqlite.queryComponents({ query: "?!", filters: { categoryId: "게시판" } });
      expect(idsOf(result.rows)).toEqual(["bbs", "tpl"]);
      expect(result.matchMode).toBeUndefined();
    });

    it("getCommonComponents 는 같은 필터 목록을 배열로 돌려준다", () => {
      expect(idsOf(sqlite.getCommonComponents({ categoryId: "게시판" }))).toEqual(["bbs", "tpl"]);
      expect(idsOf(sqlite.getCommonComponents({ keyword: "로그인" })).sort()).toEqual(["sec", "uia"]);
      expect(sqlite.getCommonComponents()).toHaveLength(COMPONENTS.length);
      expect(sqlite.getCommonComponents({ categoryId: "게시판" })[0].category_name).toBe("게시판");
    });
  });

  describe("컴포넌트 한 건 조회", () => {
    it("컴포넌트 ID 는 앞뒤 공백을 떼고 대소문자를 구분하지 않고 찾는다", () => {
      for (const id of ["bbs", "BBS", "Bbs", " bbs ", "\tbbs\n"]) {
        expect(sqlite.getComponentById(id)?.component_id, `id=${JSON.stringify(id)}`).toBe("bbs");
      }
      expect(sqlite.getComponentById("bbs")?.category_name).toBe("게시판");
      expect(sqlite.getComponentById("없는것")).toBeUndefined();
      expect(sqlite.getComponentById("  ")).toBeUndefined();
    });

    it("패키지명도 앞뒤 공백을 떼고 대소문자를 구분하지 않고 찾는다", () => {
      for (const packageName of ["egovframework.com.cop.bbs", "EGOVFRAMEWORK.COM.COP.BBS", " egovframework.com.cop.bbs\n"]) {
        expect(sqlite.getComponentByPackage(packageName)?.component_id).toBe("bbs");
      }
      expect(sqlite.getComponentByPackage("egovframework.com.none")).toBeUndefined();
    });

    it("대소문자만 다른 ID 가 함께 있으면 글자가 그대로 같은 쪽을 고른다", () => {
      sqlite.addCommonComponentsBatch([
        { ...COMPONENTS[2], component_id: "BBS", name: "대문자 게시판", package_name: "egovframework.com.cop.bbs.upper" },
      ]);
      expect(sqlite.getComponentById("BBS")?.name).toBe("대문자 게시판");
      expect(sqlite.getComponentById("bbs")?.name).toBe("게시판");
    });

    describe("findComponent", () => {
      it("ID, 패키지명 순으로 찾는다", () => {
        expect(sqlite.findComponent("UIA")?.component_id).toBe("uia");
        expect(sqlite.findComponent("egovframework.com.uat.uia")?.component_id).toBe("uia");
        expect(sqlite.findComponent(" Egovframework.Com.Sec.Ram ")?.component_id).toBe("ram");
      });

      it("둘 다 아니면 이름이나 영문명이 정확히 같은 컴포넌트가 하나뿐일 때 그것을 돌려준다", () => {
        expect(sqlite.findComponent("게시판")?.component_id).toBe("bbs");
        expect(sqlite.findComponent("일반로그인")?.component_id).toBe("uia");
        expect(sqlite.findComponent("General Login")?.component_id).toBe("uia");
        expect(sqlite.findComponent(" general login ")?.component_id).toBe("uia");
      });

      it("같은 이름을 쓰는 컴포넌트가 여럿이면 고르지 않는다", () => {
        // 영문명 'Authority Management' 는 ram 과 drm 이 함께 쓴다
        expect(sqlite.findComponent("Authority Management")).toBeUndefined();
      });

      it("이름의 일부만 같아서는 찾지 않는다", () => {
        expect(sqlite.findComponent("로그인")).toBeUndefined();
        expect(sqlite.findComponent("템플릿")).toBeUndefined();
        expect(sqlite.findComponent("없는것")).toBeUndefined();
        expect(sqlite.findComponent("   ")).toBeUndefined();
      });
    });
  });

  describe("categoryId 필터", () => {
    const inCategory = (categoryId: string) => idsOf(sqlite.queryComponents({ filters: { categoryId } }).rows).sort();

    it("카테고리 ID 로 지정한다", () => {
      expect(inCategory("역할-권한관리")).toEqual(["drm", "ram"]);
      expect(inCategory("게시판")).toEqual(["bbs", "tpl"]);
    });

    it("목록에 보이는 카테고리 이름으로도 지정할 수 있다 (ID 와 이름이 다른 카테고리)", () => {
      expect(inCategory("역할/권한관리")).toEqual(["drm", "ram"]);
    });

    it("영문명으로도 지정할 수 있다", () => {
      expect(inCategory("BBS")).toEqual(["bbs", "tpl"]);
      expect(inCategory("Role/Authority Management")).toEqual(["drm", "ram"]);
    });

    it("앞뒤 공백을 떼고 대소문자를 구분하지 않는다", () => {
      expect(inCategory(" bbs ")).toEqual(["bbs", "tpl"]);
      expect(inCategory("LOGIN")).toEqual(["sec", "uia"]);
      expect(inCategory("role/authority management")).toEqual(["drm", "ram"]);
      expect(inCategory("  역할-권한관리\n")).toEqual(["drm", "ram"]);
    });

    it("부분 일치는 아니다. 없는 카테고리는 빈 결과다", () => {
      expect(inCategory("권한관리")).toEqual([]);
      expect(inCategory("없는카테고리")).toEqual([]);
      expect(sqlite.queryComponents({ filters: { categoryId: "없는카테고리" } }).total).toBe(0);
    });

    it("공백뿐이면 주지 않은 것으로 본다", () => {
      expect(inCategory("   ")).toHaveLength(COMPONENTS.length);
    });

    it("키워드 검색과 함께 줄 때도 같은 기준으로 일치시킨다", () => {
      const result = sqlite.queryComponents({ query: "관리", filters: { categoryId: "역할/권한관리" } });
      expect(idsOf(result.rows).sort()).toEqual(["drm", "ram"]);
      expect(idsOf(sqlite.searchComponents("관리", 20, { categoryId: "bbs" }))).toEqual(["tpl"]);
      expect(idsOf(sqlite.getCommonComponents({ categoryId: "Login" })).sort()).toEqual(["sec", "uia"]);
    });
  });

  describe("목록의 limit 과 전체 건수", () => {
    it("limit 을 주면 앞에서부터 그만큼만 돌려주고, total 은 전체 건수다", () => {
      const result = sqlite.queryComponents({ filters: { version: "4.3.1" }, limit: 2 });
      expect(result.rows).toHaveLength(2);
      expect(result.total).toBe(6);
      // 잘린 목록은 전체 목록의 앞부분이다
      const all = sqlite.queryComponents({ filters: { version: "4.3.1" } });
      expect(idsOf(result.rows)).toEqual(idsOf(all.rows).slice(0, 2));
    });

    it("limit 을 주지 않으면 전체를 돌려준다", () => {
      const result = sqlite.queryComponents({ filters: { version: "4.3.1" } });
      expect(result.rows).toHaveLength(6);
      expect(result.total).toBe(6);
      expect(sqlite.queryComponents().rows).toHaveLength(COMPONENTS.length);
    });

    it("getCommonComponents 도 선택 인자로 limit 을 받는다", () => {
      expect(sqlite.getCommonComponents({ version: "4.3.1" }, 2)).toHaveLength(2);
      expect(sqlite.getCommonComponents({ version: "4.3.1" })).toHaveLength(6);
    });

    it("limit 은 1 이상의 정수로 맞춘다", () => {
      expect(sqlite.queryComponents({ limit: 2.5 }).rows).toHaveLength(2);
      expect(sqlite.queryComponents({ limit: 0 }).rows).toHaveLength(1);
      expect(sqlite.queryComponents({ limit: -3 }).rows).toHaveLength(1);
      expect(sqlite.queryComponents({ limit: 1e300 }).rows).toHaveLength(COMPONENTS.length);
      expect(sqlite.queryComponents({ query: "게시", limit: 1.9 }).rows).toHaveLength(1);
    });
  });

  describe("searchComponents (배열을 돌려주는 기존 메서드)", () => {
    it("선택 인자로 받은 필터를 함께 적용한다", () => {
      expect(idsOf(sqlite.searchComponents("게시", 20, { version: "5.0.0" }))).toEqual(["bst"]);
      expect(idsOf(sqlite.searchComponents("증서 시판", 20, { categoryId: "로그인" }))).toEqual(["sec"]);
    });

    it("같은 규칙으로 찾은 컴포넌트를 배열로 돌려준다", () => {
      expect(idsOf(sqlite.searchComponents("게시판 템플릿"))).toEqual(["tpl"]);
      expect(idsOf(sqlite.searchComponents("증서"))).toEqual(["sec"]);
      expect(idsOf(sqlite.searchComponents("시판 플릿", 1))).toEqual(["tpl"]);
    });

    it("category_name 을 함께 돌려준다", () => {
      expect(sqlite.searchComponents("게시판 템플릿")[0].category_name).toBe("게시판");
      expect(sqlite.searchComponents("증서")[0].category_name).toBe("로그인");
    });

    it("검색어가 하나도 추출되지 않으면 빈 배열을 돌려준다", () => {
      expect(sqlite.searchComponents("?!")).toEqual([]);
    });
  });
});
