/**
 * 공통컴포넌트 메타의 id 를 고유하게 만드는 규칙 단위 테스트
 *
 * templates/common-components.json 의 id 는 패키지명의 마지막 마디라서 서로 다른 컴포넌트가
 * 같은 id 를 가질 수 있다. 겹친 채로 적재하면 뒤 항목이 앞 항목을 덮어써 컴포넌트가 사라진다.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { assignUniqueComponentIds } from "../../src/kb/componentIds.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const entry = (id: string, packageName: string, nameEn = "") => ({ id, packageName, nameEn });

describe("assignUniqueComponentIds", () => {
  it("겹치지 않는 id 는 그대로 둔다", () => {
    const result = assignUniqueComponentIds([
      entry("uia", "egovframework.com.uat.uia"),
      entry("sec", "egovframework.com.utl.sec"),
    ]);
    expect(result.ids).toEqual(["uia", "sec"]);
    expect(result.renamed).toEqual([]);
  });

  it("처음 나온 항목이 id 를 유지하고, 뒤 항목은 패키지명의 상위 마디를 붙인다", () => {
    const result = assignUniqueComponentIds([
      entry("cmt", "egovframework.com.cop.cmt"),
      entry("cmt", "egovframework.com.uss.cmt"),
    ]);
    expect(result.ids).toEqual(["cmt", "uss-cmt"]);
    expect(result.renamed).toEqual([{ index: 1, from: "cmt", to: "uss-cmt" }]);
  });

  it("세 항목이 겹쳐도 각각 고유한 id 를 얻는다", () => {
    const result = assignUniqueComponentIds([
      entry("sim", "egovframework.com.cop.smt.sim"),
      entry("sim", "egovframework.com.ssi.syi.sim"),
      entry("sim", "egovframework.com.utl.sim"),
    ]);
    expect(result.ids).toEqual(["sim", "syi-sim", "utl-sim"]);
  });

  it("상위 마디 하나로 고유해지지 않으면 마디를 더 붙인다", () => {
    const result = assignUniqueComponentIds([
      entry("prm", "egovframework.com.a.sys.prm"),
      entry("sys-prm", "egovframework.com.x.y"),
      entry("prm", "egovframework.com.b.sys.prm"),
    ]);
    expect(result.ids).toEqual(["prm", "sys-prm", "b-sys-prm"]);
  });

  it("패키지명까지 같으면 영문명을 소문자와 하이픈으로 바꿔 쓴다", () => {
    const result = assignUniqueComponentIds([
      entry("bbs", "egovframework.com.cop.bbs", "BBS"),
      entry("bbs", "egovframework.com.cop.bbs", "Blog Management"),
    ]);
    expect(result.ids).toEqual(["bbs", "blog-management"]);
  });

  it("영문명으로도 고유해지지 않으면 번호를 붙인다", () => {
    const result = assignUniqueComponentIds([
      entry("bbs", "egovframework.com.cop.bbs", "BBS"),
      entry("bbs", "egovframework.com.cop.bbs", "BBS"),
      entry("bbs", "egovframework.com.cop.bbs", ""),
    ]);
    expect(result.ids).toEqual(["bbs", "bbs-2", "bbs-3"]);
  });

  it("대소문자만 다른 id 도 겹친 것으로 본다", () => {
    const result = assignUniqueComponentIds([
      entry("Sim", "egovframework.com.cop.smt.sim"),
      entry("sim", "egovframework.com.utl.sim"),
    ]);
    expect(result.ids).toEqual(["Sim", "utl-sim"]);
  });

  it("입력 순서와 개수를 유지한다", () => {
    const input = [
      entry("a", "p.a"),
      entry("b", "p.b"),
      entry("a", "q.a"),
      entry("c", "p.c"),
    ];
    const result = assignUniqueComponentIds(input);
    expect(result.ids).toHaveLength(input.length);
    expect(result.ids).toEqual(["a", "b", "q-a", "c"]);
  });
});

describe("assignUniqueComponentIds — 동봉 메타(templates/common-components.json)", () => {
  const meta = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "templates", "common-components.json"), "utf-8"),
  ) as { totalComponents: number; components: Array<{ id: string; name: string; packageName: string; nameEn: string }> };

  it("모든 컴포넌트가 고유한 id 를 얻는다", () => {
    const { ids } = assignUniqueComponentIds(meta.components);
    expect(ids).toHaveLength(meta.totalComponents);
    expect(new Set(ids.map((id) => id.toLowerCase())).size).toBe(meta.totalComponents);
  });

  it("id 가 겹치던 컴포넌트는 이름으로 구분되는 id 를 얻는다", () => {
    const { ids } = assignUniqueComponentIds(meta.components);
    const idOf = (name: string) => ids[meta.components.findIndex((component) => component.name === name)];

    expect(idOf("게시판")).toBe("bbs");
    expect(idOf("블로그관리")).toBe("blog-management");
    expect(idOf("댓글관리")).toBe("cmt");
    expect(idOf("출퇴근관리")).toBe("uss-cmt");
    expect(idOf("일정관리")).toBe("sim");
    expect(idOf("시스템연계관리")).toBe("syi-sim");
    expect(idOf("시스템정보확인")).toBe("utl-sim");
    expect(idOf("프로그램관리")).toBe("prm");
    expect(idOf("프로세스 모니터링")).toBe("sys-prm");
    expect(idOf("협업공통")).toBe("com");
    expect(idOf("통계공통")).toBe("sts-com");
  });
});
