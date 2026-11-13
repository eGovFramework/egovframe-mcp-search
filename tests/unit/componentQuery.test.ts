/**
 * SQLiteManager 공통컴포넌트 조회 단위 테스트
 *
 * 키워드 조회(queryComponents)의 동작을 고정한다.
 * 임시 디렉토리의 새 DB 만 사용한다 (knowledge-base/egovframe.db 에 의존하지 않음).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SQLiteManager } from "../../src/database/sqliteManager.js";
import { COMPONENTS, idsOf, seedComponents } from "./_componentFixture.js";
import { connectionOf, orderByClausesOf, statementsOf } from "./_sqlStatements.js";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";

/** 고정 데이터에 없는 컴포넌트 하나 (검색 대상 컬럼의 값만 정하고 나머지는 cmm 의 것을 쓴다). */
const extra = (component_id: string, name: string, name_en: string, description: string) => ({
  ...COMPONENTS[7],
  component_id,
  name,
  name_en,
  package_name: `egovframework.com.extra.${component_id}`,
  description,
});

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

  describe("1단계: 모든 검색어가 부분 문자열로 일치하는 컴포넌트 (all-terms)", () => {
    it("모든 검색어가 일치하는 컴포넌트가 있으면 그것만 돌려주고 matchMode 는 all-terms 다", () => {
      const result = sqlite.queryComponents({ query: "게시판 템플릿" });
      expect(idsOf(result.rows)).toEqual(["tpl"]);
      expect(result.total).toBe(1);
      expect(result.matchMode).toBe("all-terms");
    });

    it("낱말의 가운데나 뒤쪽에 든 검색어도 찾는다", () => {
      // 낱말 단위 접두 일치로는 '인증서로그인' 의 '증서', '게시판' 의 '시판' 을 찾지 못했다
      const cases: Array<[string, string[]]> = [
        ["증서", ["sec"]],
        ["시판", ["bbs", "tpl"]],
        ["로그인", ["uia", "sec"]],
        ["시판 플릿", ["tpl"]],
      ];
      for (const [query, expected] of cases) {
        const result = sqlite.queryComponents({ query });
        expect(idsOf(result.rows), `query=${query}`).toEqual(expected);
        expect(result.matchMode, `query=${query}`).toBe("all-terms");
      }
    });

    it("낱말의 앞에서 일치하는 컴포넌트가 있어도 뒤쪽에 든 컴포넌트를 빠뜨리지 않는다", () => {
      // 접두 일치 결과가 한 건이라도 있으면 거기서 멈춰, '코드' 로는 '코드관리' 만 나오고 '공통코드' 가 빠졌다
      sqlite.addCommonComponentsBatch([
        extra("acr", "코드관리", "Code Management", "코드를 관리함"),
        extra("cca", "공통코드", "Common Code", "공통으로 쓰는 값을 관리함"),
      ]);
      const result = sqlite.queryComponents({ query: "코드" });
      expect(idsOf(result.rows)).toEqual(["acr", "cca"]);
      expect(result.matchMode).toBe("all-terms");
    });

    it("많은 컴포넌트에 들어 있는 검색어도 그대로 쓴다", () => {
      // '능을'('기능을' 의 뒤쪽)과 '공함'('제공함' 의 뒤쪽)은 일곱 컴포넌트의 설명에 들어 있다
      const result = sqlite.queryComponents({ query: "능을 공함" });
      expect(result.total).toBe(7);
      expect(result.matchMode).toBe("all-terms");
      expect(idsOf(result.rows)).not.toContain("cmm");
    });

    it("컴포넌트 ID·이름·영문명·설명·영문 설명·패키지명에서 찾는다", () => {
      sqlite.addCommonComponentsBatch([
        {
          ...extra("x9-only-id", "웹로그", "Blog", "글을 올리는 기능"),
          package_name: "egovframework.com.cop.blg",
          description_en: "Manages personal weblog postings",
        },
      ]);
      const found = (query: string) => idsOf(sqlite.queryComponents({ query }).rows);
      expect(found("x9-only")).toEqual(["x9-only-id"]); // component_id 에만 있다
      expect(found("반로그")).toEqual(["uia"]); // name
      expect(found("ertificat")).toEqual(["sec"]); // name_en
      expect(found("밀번호")).toEqual(["uia"]); // description
      expect(found("ostings")).toEqual(["x9-only-id"]); // description_en 에만 있다
      expect(found("tl.se")).toEqual(["sec"]); // package_name
    });

    it("카테고리 이름에서는 찾지 않는다 (카테고리는 categoryId 필터로 지정한다)", () => {
      // '역할' 은 카테고리 '역할/권한관리' 의 이름에만 있다
      expect(sqlite.queryComponents({ query: "역할" }).rows).toEqual([]);
    });

    it("버전 컬럼에서는 찾지 않는다 (버전은 version 필터로 지정한다)", () => {
      // 호환 소프트웨어 검색은 검색어를 프레임워크 버전과도 견주지만, 공통컴포넌트 검색에는 그런 컬럼이 없다.
      // '5.0.0' 은 bst 와 cmm 의 version 에만, '4.3.1' 은 나머지 여섯 컴포넌트의 version 에만 있다
      expect(sqlite.queryComponents({ query: "5.0.0" }).rows).toEqual([]);
      expect(sqlite.queryComponents({ query: "4.3.1" }).rows).toEqual([]);
    });

    it("영문자의 대소문자를 가리지 않는다", () => {
      expect(idsOf(sqlite.queryComponents({ query: "LOGIN" }).rows)).toEqual(["uia", "sec"]);
      expect(idsOf(sqlite.queryComponents({ query: "EGOVFRAMEWORK.COM.COP.BBS" }).rows)).toEqual(["bbs"]);
    });

    it("두 글자 이상인 검색어가 있으면 한 글자 검색어는 쓰지 않는다", () => {
      // 'y' 는 영문명 'Authority Management' 를 쓰는 두 컴포넌트(ram, drm)에만 들어 있다.
      // 검색어로 쓰면 '증서' 와 함께 든 컴포넌트가 없어 결과가 달라진다
      const result = sqlite.queryComponents({ query: "x y 증서" });
      expect(idsOf(result.rows)).toEqual(["sec"]);
      expect(result.matchMode).toBe("all-terms");
    });

    it("모든 검색어가 한 글자이면 그대로 쓴다", () => {
      const result = sqlite.queryComponents({ query: "y" });
      expect(idsOf(result.rows)).toEqual(["ram", "drm"]);
      expect(result.matchMode).toBe("all-terms");
    });

    it("FTS5 인덱스를 읽지 않는다 (인덱스가 없어도 같은 결과를 돌려준다)", () => {
      // 1단계에서 끝나는 조회와 2단계까지 가는 조회 모두 FTS5 표를 읽지 않는다
      for (const query of ["게시판 템플릿", "게시판을 없는말"]) {
        const statements = statementsOf(sqlite, () => sqlite.queryComponents({ query }));
        expect(statements.length, `query=${query}`).toBeGreaterThan(0);
        expect(statements.filter((sql) => /MATCH|_fts/i.test(sql)), `query=${query}`).toEqual([]);
      }

      const before = sqlite.queryComponents({ query: "게시판 템플릿" });
      connectionOf(sqlite).exec("DROP TABLE components_fts");
      expect(sqlite.queryComponents({ query: "게시판 템플릿" })).toEqual(before);
      expect(idsOf(before.rows)).toEqual(["tpl"]);
    });

    it("조회 중 오류는 결과 없음으로 가리지 않고 그대로 던진다", () => {
      connectionOf(sqlite).exec("DROP TABLE component_dependencies; DROP TABLE common_components;");
      expect(() => sqlite.queryComponents({ query: "게시판" })).toThrow(/common_components/);
    });
  });

  describe("키워드 검색의 정렬", () => {
    it("이름(컴포넌트 ID·이름·영문명)에 일치한 검색어가 많은 컴포넌트를 먼저 돌려준다", () => {
      // '통계': bst 는 이름에, 새로 넣은 aaa 는 설명에만 들어 있다. 이름의 길이로도 컴포넌트 ID 로도 aaa 가 먼저다
      sqlite.addCommonComponentsBatch([extra("aaa", "집계", "Summary", "통계 자료를 모음")]);
      expect(idsOf(sqlite.queryComponents({ query: "통계" }).rows)).toEqual(["bst", "aaa"]);
    });

    it("컴포넌트 ID 에만 일치한 컴포넌트가 설명에만 일치한 컴포넌트보다 앞에 온다", () => {
      // 'zq9' 는 한 컴포넌트의 ID(와 패키지명)에, 다른 컴포넌트의 설명에만 들어 있다.
      // 설명에만 든 컴포넌트의 이름이 더 짧아, 컴포넌트 ID 를 이름으로 세지 않으면 그 컴포넌트가 먼저 나온다
      sqlite.addCommonComponentsBatch([
        extra("ab1", "가", "Beta Tool", "zq9 와 함께 쓴다"),
        extra("zq9", "가나다라", "Alpha Tool", "설명 없음"),
      ]);
      const result = sqlite.queryComponents({ query: "zq9" });
      expect(idsOf(result.rows)).toEqual(["zq9", "ab1"]);
      expect(result.matchMode).toBe("all-terms");
    });

    it("영문명에만 일치한 컴포넌트가 설명에만 일치한 컴포넌트보다 앞에 온다", () => {
      // 'xylophone' 은 한 컴포넌트의 영문명에만, 다른 컴포넌트의 설명에만 들어 있다.
      // 설명에만 든 컴포넌트의 이름이 더 짧아, 영문명을 이름으로 세지 않으면 그 컴포넌트가 먼저 나온다
      sqlite.addCommonComponentsBatch([
        extra("de1", "나", "Other", "xylophone 을 다룬다"),
        extra("en1", "가나다라", "Xylophone", "설명 없음"),
      ]);
      const result = sqlite.queryComponents({ query: "xylophone" });
      expect(idsOf(result.rows)).toEqual(["en1", "de1"]);
      expect(result.matchMode).toBe("all-terms");
    });

    it("이름에 일치한 검색어 수가 같으면 이름이 짧은 컴포넌트를 먼저 돌려준다", () => {
      // 이름이 짧을수록 검색어가 이름에서 차지하는 비중이 크다: '일반로그인'(uia, 5자) < '인증서로그인'(sec, 6자).
      // 컴포넌트 ID 순으로는 sec 가 먼저다
      expect(idsOf(sqlite.queryComponents({ query: "로그인" }).rows)).toEqual(["uia", "sec"]);
    });

    it("이름의 길이도 같으면 컴포넌트 ID 순으로 돌려준다", () => {
      // 여덟 컴포넌트 모두 패키지명에만 일치한다. 이름의 길이는 공통 2, 게시판 3, 권한관리 4, 게시물통계·일반로그인 5,
      // 부서권한관리·인증서로그인 6, 게시판 템플릿 7 이고, 길이가 같은 쌍(bst·uia, drm·sec)은 컴포넌트 ID 순이다.
      // 적재 순서는 uia, sec, bbs, tpl, ram, drm, bst, cmm 이다
      expect(idsOf(sqlite.queryComponents({ query: "egovframework" }).rows)).toEqual([
        "cmm",
        "bbs",
        "ram",
        "bst",
        "uia",
        "drm",
        "sec",
        "tpl",
      ]);
    });
  });

  describe("2단계: 대체 검색 (any-term)", () => {
    it("문장으로 물어도 뜻이 있는 검색어가 일치하는 컴포넌트를 찾는다", () => {
      // 게시판: 2행 / 컴포넌트: 0행(제외) → k=1
      const result = sqlite.queryComponents({ query: "게시판 컴포넌트" });
      expect(idsOf(result.rows)).toEqual(["bbs", "tpl"]);
      expect(result.matchMode).toBe("any-term");
    });

    it("일치하는 행이 하나도 없는 검색어는 세지 않는다 (군말이 섞인 문장형 질의)", () => {
      // 게시판: 2행 / 만들기·방법: 0행(제외) → k=1.
      // 0행인 검색어까지 세면 k=3 이 되어 두 개 이상 일치해야 하므로 결과가 없어진다
      const result = sqlite.queryComponents({ query: "게시판 만들기 방법" });
      expect(idsOf(result.rows)).toEqual(["bbs", "tpl"]);
      expect(result.total).toBe(2);
      expect(result.matchMode).toBe("any-term");
    });

    it("일치하는 컴포넌트가 있는 검색어가 하나도 없으면 빈 결과를 돌려준다", () => {
      // 만들기·방법·없는말: 0행 → k=0
      const result = sqlite.queryComponents({ query: "만들기 방법 없는말" });
      expect(result.rows).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.matchMode).toBe("any-term");
    });

    it("많은 컴포넌트에 들어 있는 검색어도 빼지 않는다 (일치한 검색어가 많은 컴포넌트가 앞에 올 뿐이다)", () => {
      // 전체의 절반 넘게 일치하는 검색어를 버리던 때에는 '기능'(일곱 컴포넌트)이 빠져 bbs, tpl 만 나왔다.
      // 기능·게시판이 모두 든 bbs, tpl 이 먼저고, '기능' 만 든 다섯 컴포넌트가 이름이 짧은 순으로 뒤따른다
      const result = sqlite.queryComponents({ query: "기능 게시판 없는말" });
      expect(idsOf(result.rows)).toEqual(["bbs", "tpl", "ram", "bst", "uia", "drm", "sec"]);
      expect(result.total).toBe(7);
      expect(result.matchMode).toBe("any-term");
    });

    it("남은 검색어의 절반 이상(올림)이 일치하는 컴포넌트가 있으면 그것만 돌려준다", () => {
      // 시판: bbs, tpl / 플릿: tpl / 통계: bst → k=3, 두 개 이상 일치해야 하므로 tpl 만 남는다
      const result = sqlite.queryComponents({ query: "시판 플릿 통계" });
      expect(idsOf(result.rows)).toEqual(["tpl"]);
      expect(result.terms?.required).toBe(2);
    });

    it("절반 이상이 일치하는 컴포넌트가 없으면 일치 기준을 1씩 낮춰 찾는다", () => {
      // 증서: sec / 통계: bst / 권한관리: ram, drm → k=3. 둘 이상이 함께 든 컴포넌트가 없어 기준을 1 로 낮춘다.
      // 기준을 낮추지 않던 때에는 0건이었다. 네 컴포넌트 모두 이름에 하나씩 일치해 이름이 짧은 순으로 나온다
      const result = sqlite.queryComponents({ query: "증서 통계 권한관리" });
      expect(idsOf(result.rows)).toEqual(["ram", "bst", "drm", "sec"]);
      expect(result.total).toBe(4);
      expect(result.matchMode).toBe("any-term");
      expect(result.terms).toEqual({ used: ["증서", "통계", "권한관리"], ignored: [], required: 1 });
    });

    it("일치한 검색어 수가 많은 컴포넌트를 먼저 돌려준다 (이름의 길이보다 앞선 기준이다)", () => {
      // bst 는 게시물·통계·조회 세 개, bbs 는 게시물·조회 두 개가 일치한다 (네 개가 모두 든 컴포넌트는 없다).
      // tpl 은 템플릿 하나만 일치해 기준(절반)에 못 미친다
      const result = sqlite.queryComponents({ query: "게시물 통계 조회 템플릿" });
      expect(idsOf(result.rows)).toEqual(["bst", "bbs"]);
      expect(result.total).toBe(2);
      expect(result.matchMode).toBe("any-term");
    });

    it("일치한 검색어 수가 같으면 이름에 일치한 검색어가 많은 컴포넌트를 먼저 돌려준다", () => {
      // '통계': bst 는 이름에, 새로 넣은 aaa 는 설명에만 들어 있다. 이름의 길이로도 컴포넌트 ID 로도 aaa 가 먼저다
      sqlite.addCommonComponentsBatch([extra("aaa", "집계", "Summary", "통계 자료를 모음")]);
      const result = sqlite.queryComponents({ query: "통계 없는말" });
      expect(idsOf(result.rows)).toEqual(["bst", "aaa"]);
      expect(result.matchMode).toBe("any-term");
    });

    it("일치한 검색어 수와 이름에 일치한 수가 같으면 이름이 짧은 컴포넌트를 먼저 돌려준다", () => {
      // 증서: sec / 시판: bbs, tpl → 함께 든 컴포넌트는 없고, 세 컴포넌트 모두 이름에 하나씩 일치한다.
      // 이름의 길이는 게시판 3, 인증서로그인 6, 게시판 템플릿 7 이다
      expect(idsOf(sqlite.queryComponents({ query: "증서 시판" }).rows)).toEqual(["bbs", "sec", "tpl"]);
    });

    it("limit 은 대체 검색 결과에도 적용하고, total 은 전체 일치 건수다", () => {
      const result = sqlite.queryComponents({ query: "게시판 컴포넌트", limit: 1 });
      expect(idsOf(result.rows)).toEqual(["bbs"]);
      expect(result.total).toBe(2);
      expect(result.matchMode).toBe("any-term");
    });

    it("조사가 붙은 검색어는 조사를 떼고 찾는다", () => {
      const cases: Array<[string, string[]]> = [
        ["게시판을", ["bbs", "tpl"]],
        ["템플릿으로", ["tpl"]],
        ["BBS는", ["bbs", "tpl"]],
        ["권한관리에서 게시판을", ["bbs", "ram", "drm", "tpl"]],
      ];
      for (const [query, expected] of cases) {
        const result = sqlite.queryComponents({ query });
        expect(idsOf(result.rows), `query=${query}`).toEqual(expected);
        expect(result.matchMode, `query=${query}`).toBe("any-term");
      }
    });

    it("조사를 뗀 꼴도 필터를 적용한 대상 안에서 일치하는 컴포넌트가 있어야 쓴다", () => {
      // '게시판' 은 로그인 카테고리 안에는 없다
      expect(sqlite.queryComponents({ query: "게시판을", filters: { categoryId: "로그인" } }).rows).toEqual([]);
      expect(
        idsOf(sqlite.queryComponents({ query: "게시판을 로그인을", filters: { categoryId: "로그인" } }).rows),
      ).toEqual(["uia", "sec"]);
    });
  });

  describe("쓴 검색어와 쓰지 않은 검색어 (terms)", () => {
    const termsOf = (query: string, filters = {}) => sqlite.queryComponents({ query, filters }).terms;

    it("모든 검색어가 일치하는 컴포넌트를 찾았으면 검색어를 모두 used 로 돌려준다", () => {
      expect(termsOf("게시판 템플릿")).toEqual({ used: ["게시판", "템플릿"], ignored: [], required: 2 });
    });

    it("대체 검색에서는 일치하는 컴포넌트가 없어 쓰지 않은 검색어를 ignored 로 돌려준다", () => {
      expect(termsOf("게시판 컴포넌트 DDL 보여줘")).toEqual({
        used: ["게시판"],
        ignored: ["컴포넌트", "DDL", "보여줘"],
        required: 1,
      });
      expect(termsOf("만들기 방법")).toEqual({ used: [], ignored: ["만들기", "방법"], required: 0 });
    });

    it("조사를 떼어 쓴 검색어는 used 에 뗀 꼴로 싣는다", () => {
      expect(termsOf("게시판을 만들고")).toEqual({ used: ["게시판"], ignored: ["만들고"], required: 1 });
      expect(termsOf("BBS는")).toEqual({ used: ["BBS"], ignored: [], required: 1 });
    });

    it("필터를 적용한 대상 안에서 일치하는 컴포넌트가 없는 검색어도 ignored 다", () => {
      expect(termsOf("증서 게시판 관리", { categoryId: "로그인" })).toEqual({
        used: ["증서"],
        ignored: ["게시판", "관리"],
        required: 1,
      });
    });

    it("두 글자 이상인 검색어가 있어 뺀 한 글자 검색어는 used 에도 ignored 에도 싣지 않는다", () => {
      expect(termsOf("x y 증서")).toEqual({ used: ["증서"], ignored: [], required: 1 });
      expect(termsOf("y")).toEqual({ used: ["y"], ignored: [], required: 1 });
    });

    it("검색어가 추출되지 않은 조회에는 terms 를 넣지 않는다", () => {
      expect(sqlite.queryComponents({ filters: { categoryId: "게시판" } })).not.toHaveProperty("terms");
      expect(sqlite.queryComponents({ query: "?!" })).not.toHaveProperty("terms");
    });
  });

  describe("필터", () => {
    it("키워드 검색 결과에 카테고리 필터를 함께 적용한다", () => {
      // '관리' 는 ram·drm(역할-권한관리)의 이름, tpl(게시판)의 설명과 일치한다
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
      // '게시' 가 든 컴포넌트: bbs, tpl(4.3.1), bst(5.0.0)
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

    it("대체 검색에도 필터를 적용한다", () => {
      // 증서: sec / 시판: bbs, tpl → 한 개 이상 일치
      expect(idsOf(sqlite.queryComponents({ query: "증서 시판" }).rows)).toEqual(["bbs", "sec", "tpl"]);
      const login = sqlite.queryComponents({ query: "증서 시판", filters: { categoryId: "로그인" } });
      expect(idsOf(login.rows)).toEqual(["sec"]);
      expect(login.total).toBe(1);
      expect(login.matchMode).toBe("any-term");
    });

    it("필터까지 만족하는 컴포넌트가 없으면 대체 검색으로 넘어간다", () => {
      // '게시판 관리' 는 tpl 하나와 일치하지만 tpl 은 4.3.1 이다.
      // 대체 검색: 게시판 2행, 관리 3행 모두 4.3.1 이라 5.0.0 안에는 일치하는 행이 없다 → k=0
      const result = sqlite.queryComponents({ query: "게시판 관리", filters: { version: "5.0.0" } });
      expect(result.rows).toEqual([]);
      expect(result.matchMode).toBe("any-term");
    });

    it("필터를 적용한 대상 안에서 일치하는 행이 없는 검색어는 세지 않는다", () => {
      // 대상(로그인)은 uia, sec 두 행이다. 게시판(2행)과 관리(3행)는 표에는 있지만 대상 안에는 없다 → k=1(증서).
      // 표 전체에서 일치한 검색어를 모두 세면 k=3 이 되어, '증서' 하나만 일치하는 sec 이 탈락한다
      const result = sqlite.queryComponents({ query: "증서 게시판 관리", filters: { categoryId: "로그인" } });
      expect(idsOf(result.rows)).toEqual(["sec"]);
      expect(result.total).toBe(1);
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

  describe("keyword 필터에 쓸 수 없는 값", () => {
    const NO_ROWS = { rows: [], total: 0 };

    it("NUL 문자가 든 keyword 는 필터를 무시하지 않고 일치하는 컴포넌트가 없는 조건으로 처리한다", () => {
      // SQLite 의 LIKE 는 패턴을 NUL 에서 끊어 읽는다. '\u0000게시판' 은 '%' 만 남아 모든 행과 일치한다
      expect(sqlite.queryComponents({ filters: { keyword: "\u0000게시판" } })).toEqual(NO_ROWS);
      expect(sqlite.queryComponents({ filters: { keyword: "\u0000" } })).toEqual(NO_ROWS);
      // NUL 뒤가 잘리면 '%템플릿' 이 되어, 값에 없는 문자열인데도 '게시판 템플릿' 과 일치한다
      expect(sqlite.queryComponents({ filters: { keyword: "템플릿\u0000없는말" } })).toEqual(NO_ROWS);
      // NUL 이 없는 같은 값은 그대로 찾는다
      expect(idsOf(sqlite.queryComponents({ filters: { keyword: "템플릿" } }).rows)).toEqual(["tpl"]);
    });

    it("키워드 검색과 함께 줘도 같다", () => {
      // 필터가 무시되면 '게시' 의 세 행이 그대로 나온다
      expect(sqlite.queryComponents({ query: "게시", filters: { keyword: "\u0000템플릿" } })).toEqual({
        ...NO_ROWS,
        matchMode: "any-term",
        terms: { used: [], ignored: ["게시"], required: 0 },
      });
      // 다른 검색어로 물어도 같다
      expect(sqlite.queryComponents({ query: "증서", filters: { keyword: "\u0000" } }).total).toBe(0);
    });

    it("LIKE 패턴 길이 한도를 넘는 값은 오류 없이 일치하는 컴포넌트가 없는 조건으로 처리한다", () => {
      // UTF-8 로 SQLite 의 LIKE 패턴 한도(50,000바이트)를 넘는 값
      for (const keyword of ["a".repeat(50000), "가".repeat(20000)]) {
        const bytes = Buffer.byteLength(keyword, "utf8");
        expect(sqlite.queryComponents({ filters: { keyword } }), `${bytes}바이트`).toEqual(NO_ROWS);
        expect(sqlite.queryComponents({ query: "게시", filters: { keyword } }).total, `query + ${bytes}바이트`).toBe(0);
        expect(sqlite.queryComponents({ query: "증서", filters: { keyword } }).total, `query + ${bytes}바이트`).toBe(0);
      }
    });

    it("배열을 돌려주는 getCommonComponents 와 searchComponents 도 같다", () => {
      expect(sqlite.getCommonComponents({ keyword: "\u0000게시판" })).toEqual([]);
      expect(sqlite.getCommonComponents({ keyword: "a".repeat(50000) })).toEqual([]);
      expect(sqlite.searchComponents("게시", 20, { keyword: "\u0000" })).toEqual([]);
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

  describe("resolveDependencies", () => {
    it("요청한 컴포넌트와 그 의존 컴포넌트를 모두 모은다", () => {
      const resolution = sqlite.resolveDependencies(["uia"]);
      expect(resolution.requested).toEqual(["uia"]);
      expect(resolution.resolved).toEqual(["uia", "cmm", "ram", "drm"]);
      expect(resolution.added).toEqual(["cmm", "ram", "drm"]);
      expect(resolution.packages).toEqual([
        "egovframework.com.uat.uia",
        "egovframework.com.cmm",
        "egovframework.com.sec.ram",
        "egovframework.com.sec.drm",
      ]);
      expect(resolution.notFound).toEqual([]);
      expect(resolution.unresolvedPackages).toEqual([]);
    });

    it("패키지명으로 요청한 컴포넌트를 자동 추가된 의존성으로 세지 않는다", () => {
      const resolution = sqlite.resolveDependencies(["egovframework.com.uat.uia"]);
      expect(resolution.requested).toEqual(["uia"]);
      expect(resolution.added).toEqual(["cmm", "ram", "drm"]);
    });

    it("입력의 앞뒤 공백을 떼고, 같은 컴포넌트를 가리키는 입력은 한 번만 센다", () => {
      const resolution = sqlite.resolveDependencies(["uia", " uia", "UIA", "egovframework.com.uat.uia", "", "  "]);
      expect(resolution.requested).toEqual(["uia"]);
      expect(resolution.resolved).toEqual(["uia", "cmm", "ram", "drm"]);
      expect(resolution.notFound).toEqual([]);
    });

    it("해석하지 못한 입력은 notFound 로 돌려준다", () => {
      const mixed = sqlite.resolveDependencies(["nonexistent", "uia", " nonexistent ", "게시판"]);
      expect(mixed.requested).toEqual(["uia"]);
      // 이름으로는 해석하지 않는다 (ID 또는 패키지명만)
      expect(mixed.notFound).toEqual(["nonexistent", "게시판"]);

      const none = sqlite.resolveDependencies(["nonexistent"]);
      expect(none).toEqual({
        requested: [],
        resolved: [],
        added: [],
        packages: [],
        notFound: ["nonexistent"],
        unresolvedPackages: [],
      });
    });

    it("요청한 컴포넌트끼리 의존하면 자동 추가된 의존성에 넣지 않는다", () => {
      const resolution = sqlite.resolveDependencies(["uia", "ram"]);
      expect(resolution.requested).toEqual(["uia", "ram"]);
      expect(resolution.added.sort()).toEqual(["cmm", "drm"]);
    });

    it("의존 패키지 가운데 컴포넌트 행이 없는 것은 unresolvedPackages 로 돌려준다", () => {
      const resolution = sqlite.resolveDependencies(["bbs"]);
      expect(resolution.resolved).toEqual(["bbs", "cmm", "tpl"]);
      expect(resolution.packages).toEqual([
        "egovframework.com.cop.bbs",
        "egovframework.com.cmm",
        "egovframework.com.cop.tpl",
      ]);
      expect(resolution.unresolvedPackages).toEqual(["egovframework.com.missing.pkg"]);
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

  describe("필터 목록의 정렬 (카테고리 이름 → 컴포넌트 이름 → id)", () => {
    // 적재 순서(id 순)는 uia, sec, bbs, tpl, ram, drm, bst, cmm 이다.
    // 카테고리 이름 순은 게시판 < 공통 < 로그인 < 역할/권한관리 < 통계 이고,
    // 로그인 안에서는 이름 순('인증서로그인' < '일반로그인')이 적재 순서(uia, sec)와 반대다.
    const BY_NAME = ["bbs", "tpl", "cmm", "sec", "uia", "ram", "drm", "bst"];

    it("카테고리 이름, 컴포넌트 이름 순으로 돌려준다 (적재 순서가 아니다)", () => {
      expect(idsOf(COMPONENTS)).toEqual(["uia", "sec", "bbs", "tpl", "ram", "drm", "bst", "cmm"]);
      expect(idsOf(sqlite.queryComponents().rows)).toEqual(BY_NAME);
      expect(idsOf(sqlite.getCommonComponents())).toEqual(BY_NAME);
    });

    it("필터나 limit 을 줘도 같은 순서에서 고른다", () => {
      expect(idsOf(sqlite.queryComponents({ filters: { version: "4.3.1" } }).rows)).toEqual([
        "bbs",
        "tpl",
        "sec",
        "uia",
        "ram",
        "drm",
      ]);
      expect(idsOf(sqlite.queryComponents({ filters: { categoryId: "로그인" } }).rows)).toEqual(["sec", "uia"]);
      expect(idsOf(sqlite.queryComponents({ filters: { keyword: "로그인" } }).rows)).toEqual(["sec", "uia"]);
      expect(idsOf(sqlite.queryComponents({ filters: { hasWeb: true }, limit: 4 }).rows)).toEqual([
        "bbs",
        "tpl",
        "sec",
        "uia",
      ]);
      // 적재 순서는 bst, cmm 이다
      expect(idsOf(sqlite.getCommonComponents({ version: "5.0.0" }))).toEqual(["cmm", "bst"]);
    });

    it("카테고리는 ID 가 아니라 이름으로 정렬한다", () => {
      // ID('가-기타')로는 맨 앞이지만 이름('기타')으로는 공통과 로그인 사이인 카테고리
      sqlite.addComponentCategoriesBatch([
        { category_id: "가-기타", name: "기타", name_en: "Etc", description: undefined, description_en: undefined },
      ]);
      sqlite.addCommonComponentsBatch([
        {
          ...COMPONENTS[7],
          component_id: "etc",
          name: "기타 도구",
          category_id: "가-기타",
          package_name: "egovframework.com.etc",
        },
      ]);
      expect(idsOf(sqlite.queryComponents().rows)).toEqual([
        "bbs",
        "tpl",
        "cmm",
        "etc",
        "sec",
        "uia",
        "ram",
        "drm",
        "bst",
      ]);
    });

    it("카테고리와 이름이 모두 같은 컴포넌트는 id(적재) 순으로 돌려준다", () => {
      // 이름이 '게시판' 인 컴포넌트를 두 개 더, 컴포넌트 ID 의 역순으로 적재한다
      sqlite.addCommonComponentsBatch([
        { ...COMPONENTS[2], component_id: "bbs-z", package_name: "egovframework.com.cop.bbs.z" },
        { ...COMPONENTS[2], component_id: "bbs-a", package_name: "egovframework.com.cop.bbs.a" },
      ]);
      const result = sqlite.queryComponents({ filters: { categoryId: "게시판" } });
      expect(result.rows.map((row) => row.name)).toEqual(["게시판", "게시판", "게시판", "게시판 템플릿"]);
      expect(idsOf(result.rows)).toEqual(["bbs", "bbs-z", "bbs-a", "tpl"]);
    });

    it("행을 돌려주는 조회 문은 세 경로 모두 정렬의 마지막 기준으로 id 를 둔다", () => {
      // 지금의 SQLite 는 정렬 기준이 모두 같은 행을 읽은 순서대로 내고, 컴포넌트 표는 id 순으로 읽힌다.
      // 그래서 id 기준을 빼도 결과가 달라지지 않아, 위 테스트처럼 결과만 봐서는 빠진 것을 알 수 없다.
      // SQL 은 정렬 기준이 같은 행의 순서를 보장하지 않으므로, 실행한 문에 id 기준이 있는지를 직접 확인한다.
      const paths: Array<[string, () => unknown]> = [
        ["필터 목록", () => sqlite.queryComponents({ filters: { categoryId: "게시판" } })],
        ["키워드 검색(all-terms)", () => sqlite.queryComponents({ query: "게시판" })],
        ["대체 검색(any-term)", () => sqlite.queryComponents({ query: "시판 없는말" })],
      ];
      for (const [name, run] of paths) {
        const clauses = orderByClausesOf(sqlite, run);
        expect(clauses, name).toHaveLength(1);
        expect(clauses[0], name).toMatch(/, c\.id(?: ASC)? LIMIT \? OFFSET \?$/);
      }
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
