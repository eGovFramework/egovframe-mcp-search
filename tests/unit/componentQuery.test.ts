/**
 * SQLiteManager 공통컴포넌트 조회 단위 테스트
 *
 * 키워드 조회(queryComponents)의 동작을 고정한다.
 * 임시 디렉토리의 새 DB 만 사용한다 (knowledge-base/egovframe.db 에 의존하지 않음).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SQLiteManager } from "../../src/database/sqliteManager.js";
import { idsOf, seedComponents } from "./_componentFixture.js";
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

    it("검색어가 하나도 추출되지 않으면 빈 결과를 돌려준다", () => {
      const result = sqlite.queryComponents({ query: "?!" });
      expect(result.rows).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.matchMode).toBeUndefined();
    });

    it("FTS5 질의 오류가 아닌 오류는 다른 검색으로 바꾸지 않고 그대로 던진다", () => {
      (sqlite as any).db.exec("DROP TABLE components_fts");
      expect(() => sqlite.queryComponents({ query: "게시판" })).toThrow(/components_fts/);
    });
  });

  describe("searchComponents (배열을 돌려주는 기존 메서드)", () => {
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
