/**
 * SQLiteManager 키워드 검색(components / compatibility) 단위 테스트
 *
 * 사용자가 입력한 문장을 그대로 FTS5 MATCH 에 넘기던 시절에는
 * - 문장부호 하나로 구문 오류가 나 다른 의미의 LIKE 검색으로 바뀌었고
 * - 버전 번호("4.3")가 서로 무관한 숫자 토큰 두 개로 쪼개졌다.
 * 낱말 단위 접두 일치(FTS5 MATCH)로 바꾼 뒤에도
 * - 한국어 복합어의 뒤쪽이나 가운데에 든 낱말("공통코드" 의 "코드")은 찾지 못했다.
 * 검색어를 추출해 부분 문자열 일치(LIKE)로 찾는 지금의 동작을 고정한다.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SQLiteManager } from "../../src/database/sqliteManager.js";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";

const component = (component_id: string, name: string, package_name: string, description: string) => ({
  component_id,
  name,
  name_en: undefined,
  category_id: "cat-test",
  package_name,
  description,
  description_en: undefined,
  use_tables: undefined,
  version: "1.0.0",
  has_web: true,
  added_options: undefined,
});

const software = (
  product_name: string,
  framework_version: string,
  vendor: string,
  description: string,
  category = "WAS",
) => ({
  product_name,
  product_version: `${product_name} 1.0`,
  framework_version,
  category,
  compatibility_level: 2 as const,
  vendor,
  verified_date: "2026-01-01",
  description,
  url: undefined,
});

describe("SQLiteManager 키워드 검색", () => {
  let tmpDir: string;
  let sqlite: SQLiteManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "egov-keyword-"));
    sqlite = new SQLiteManager(path.join(tmpDir, "egovframe.db"));
    sqlite.addComponentCategoriesBatch([
      { category_id: "cat-test", name: "테스트카테고리", name_en: "Test", description: undefined, description_en: undefined },
    ]);
    sqlite.addCommonComponentsBatch([
      component("ram", "권한관리", "egovframework.com.sec.ram", "시스템 사용자의 권한을 관리한다"),
      component("bbs", "게시판", "egovframework.com.cop.bbs", "게시판에 게시물을 등록한다"),
      component("uia", "일반로그인", "egovframework.com.uat.uia", "아이디와 비밀번호로 로그인한다"),
      component("acr", "행정동 코드관리", "egovframework.com.sym.ccm.acr", "행정코드를 관리한다"),
      component("cca", "공통코드", "egovframework.com.sym.ccm.cca", "여러 화면이 함께 쓰는 값을 등록한다"),
    ]);
    sqlite.addCompatibilitySoftwareBatch([
      software("JEUS", "4.3", "(주)티맥스소프트", "표준프레임워크 4.3 호환 확인"),
      software("Tibero", "4.0", "(주)티맥스티베로", "표준프레임워크 4.0 호환 확인", "DBMS"),
      software("SampleCMS", "3.9", "샘플벤더", "항목 4 개 가운데 3 개 통과", "CMS Solution"),
    ]);
  });

  afterEach(async () => {
    sqlite.close();
    await fs.remove(tmpDir);
  });

  const componentIds = (query: string) => sqlite.searchComponents(query).map((c) => c.component_id).sort();
  const productNames = (query: string) =>
    sqlite.fullTextSearchCompatibility(query).map((s) => s.product_name).sort();

  describe("components", () => {
    it("복합어의 앞부분만 입력해도 찾는다", () => {
      expect(componentIds("권한")).toEqual(["ram"]);
    });

    it("복합어의 뒷부분이나 가운데만 입력해도 찾는다", () => {
      expect(componentIds("로그인")).toEqual(["uia"]);
      expect(componentIds("시판")).toEqual(["bbs"]);
      expect(componentIds("반로그")).toEqual(["uia"]);
    });

    it("낱말의 앞에서 일치하는 컴포넌트가 있어도 뒤쪽에 든 컴포넌트를 빠뜨리지 않는다", () => {
      // '코드' 는 '코드관리'·'행정코드를' 의 앞부분이자 '공통코드' 의 뒷부분이다
      expect(componentIds("코드")).toEqual(["acr", "cca"]);
    });

    it("문장부호가 붙어도 같은 결과를 돌려준다", () => {
      expect(componentIds("게시판")).toEqual(["bbs"]);
      expect(componentIds("게시판?")).toEqual(["bbs"]);
      expect(componentIds("(게시판)!")).toEqual(["bbs"]);
    });

    it("패키지명 전체로 찾는다", () => {
      expect(componentIds("egovframework.com.uat.uia")).toEqual(["uia"]);
    });

    it("검색 연산자로 읽힐 수 있는 낱말만 입력해도 오류 없이 빈 결과를 돌려준다", () => {
      expect(componentIds("AND")).toEqual([]);
      expect(componentIds("NOT")).toEqual([]);
      expect(componentIds('"게시판" OR *')).toEqual(["bbs"]);
    });
  });

  describe("compatibility", () => {
    it("벤더명의 앞부분만 입력해도 찾는다", () => {
      expect(productNames("티맥스")).toEqual(["JEUS", "Tibero"]);
    });

    it("벤더명의 뒷부분만 입력해도 찾는다", () => {
      expect(productNames("소프트")).toEqual(["JEUS"]);
      expect(productNames("티베로")).toEqual(["Tibero"]);
    });

    it("문장부호가 붙어도 같은 결과를 돌려준다", () => {
      expect(productNames("JEUS")).toEqual(["JEUS"]);
      expect(productNames("JEUS!")).toEqual(["JEUS"]);
    });

    it("버전 번호는 숫자가 붙어 있는 행만 찾는다", () => {
      // 'SampleCMS' 의 설명에는 4 와 3 이 떨어져 있어 4.3 으로 검색되면 안 된다
      expect(productNames("4.3")).toEqual(["JEUS"]);
    });

    it("제품 버전 표기로도 찾는다", () => {
      // 'Tibero 1.0' 은 product_version 에만 있다
      expect(productNames("Tibero 1.0")).toEqual(["Tibero"]);
    });
  });
});
