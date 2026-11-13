/**
 * SQLiteManager 키워드 검색(components / compatibility) 단위 테스트
 *
 * 사용자가 입력한 문장을 그대로 FTS5 MATCH 에 넘기던 시절에는
 * - 문장부호 하나로 구문 오류가 나 다른 의미의 LIKE 검색으로 바뀌었고
 * - 한국어 복합어나 조사가 붙은 낱말은 토큰 전체가 일치해야만 검색됐으며
 * - 버전 번호("4.3")가 서로 무관한 숫자 토큰 두 개로 쪼개졌다.
 * 검색어를 구 단위 접두 일치 MATCH 식으로 조립한 뒤의 동작을 고정한다.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SQLiteManager } from "../../src/database/sqliteManager.js";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";

const component = (component_id: string, name: string, package_name: string, description: string) => ({
  component_id,
  name,
  name_en: null,
  category_id: "cat-test",
  package_name,
  description,
  description_en: null,
  use_tables: null,
  version: "1.0.0",
  has_web: true,
  added_options: null,
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
      { category_id: "cat-test", name: "테스트카테고리", name_en: null, description: null, description_en: null },
    ]);
    sqlite.addCommonComponentsBatch([
      component("ram", "권한관리", "egovframework.com.sec.ram", "시스템 사용자의 권한을 관리한다"),
      component("bbs", "게시판", "egovframework.com.cop.bbs", "게시판에 게시물을 등록한다"),
      component("uia", "일반로그인", "egovframework.com.uat.uia", "아이디와 비밀번호로 로그인한다"),
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

    it("문장부호가 붙어도 같은 결과를 돌려준다", () => {
      expect(componentIds("게시판")).toEqual(["bbs"]);
      expect(componentIds("게시판?")).toEqual(["bbs"]);
      expect(componentIds("(게시판)!")).toEqual(["bbs"]);
    });

    it("패키지명 전체로 찾는다", () => {
      expect(componentIds("egovframework.com.uat.uia")).toEqual(["uia"]);
    });

    it("FTS5 연산자 단어만 입력해도 오류 없이 빈 결과를 돌려준다", () => {
      expect(componentIds("AND")).toEqual([]);
      expect(componentIds("NOT")).toEqual([]);
    });
  });

  describe("compatibility", () => {
    it("벤더명의 앞부분만 입력해도 찾는다", () => {
      expect(productNames("티맥스")).toEqual(["JEUS", "Tibero"]);
    });

    it("문장부호가 붙어도 같은 결과를 돌려준다", () => {
      expect(productNames("JEUS")).toEqual(["JEUS"]);
      expect(productNames("JEUS!")).toEqual(["JEUS"]);
    });

    it("버전 번호는 숫자가 붙어 있는 행만 찾는다", () => {
      // 'SampleCMS' 의 설명에는 4 와 3 이 떨어져 있어 4.3 으로 검색되면 안 된다
      expect(productNames("4.3")).toEqual(["JEUS"]);
    });
  });
});
