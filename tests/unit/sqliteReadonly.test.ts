/**
 * SQLiteManager 읽기 전용 모드 단위 테스트
 *
 * MCP 서버는 조회만 하는데도 예전에는 DB 를 읽기/쓰기로 열어 WAL 전환과 트리거 재생성을
 * 매번 수행했다. 그 결과 조회만으로 배포된 DB 파일이 바뀌었고(git 이 추적하는 파일이 수정됨),
 * 쓰기 권한이 없는 설치 위치에서는 모든 SQLite 조회가 실패했다.
 * 서버 경로가 쓰는 읽기 전용 모드와, build-index 가 쓰는 배포용 마무리를 검증한다.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SQLiteManager } from "../../src/database/sqliteManager.js";
import { UserFacingError } from "../../src/utils/errors.js";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const sha256 = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

describe("SQLiteManager 읽기 전용 모드", () => {
  let tmpDir: string;
  let dbDir: string;
  let dbPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "egov-sqlite-ro-"));
    dbDir = path.join(tmpDir, "knowledge-base");
    dbPath = path.join(dbDir, "egovframe.db");

    // build-index 가 하는 일을 흉내 낸다: 쓰기 모드로 적재한 뒤 배포용으로 마무리
    const writer = new SQLiteManager(dbPath);
    writer.addComponentCategoriesBatch([
      { category_id: "cat-test", name: "테스트카테고리", name_en: null, description: null, description_en: null },
    ]);
    writer.addCommonComponentsBatch([
      {
        component_id: "bbs",
        name: "게시판",
        name_en: null,
        category_id: "cat-test",
        package_name: "egovframework.com.cop.bbs",
        description: "게시판에 게시물을 등록한다",
        description_en: null,
        use_tables: null,
        version: "1.0.0",
        has_web: true,
        added_options: null,
      },
    ]);
    writer.addCompatibilitySoftwareBatch([
      {
        product_name: "JEUS",
        product_version: "JEUS 8.5",
        framework_version: "4.3",
        category: "WAS",
        compatibility_level: 2,
        vendor: "(주)티맥스소프트",
        verified_date: "2026-01-01",
        description: "호환 확인",
        url: undefined,
      },
    ]);
    writer.finalizeForDistribution();
    writer.close();
  });

  afterEach(async () => {
    // 권한을 바꾼 테스트가 있어도 정리할 수 있도록 되돌린다
    if (await fs.pathExists(dbDir)) {
      await fs.chmod(dbDir, 0o755);
      if (await fs.pathExists(dbPath)) await fs.chmod(dbPath, 0o644);
    }
    await fs.remove(tmpDir);
  });

  it("배포용 마무리 후에는 저널 모드가 DELETE 이고 WAL 부속 파일이 남지 않는다", () => {
    expect(fs.readdirSync(dbDir)).toEqual(["egovframe.db"]);
    // SQLite 헤더 18~19 바이트: 1 = 롤백 저널(DELETE), 2 = WAL
    const header = fs.readFileSync(dbPath).subarray(18, 20);
    expect([...header]).toEqual([1, 1]);
  });

  it("읽기 전용으로 열어 조회해도 DB 파일이 바뀌지 않고 부속 파일도 생기지 않는다", () => {
    const before = sha256(dbPath);

    const reader = new SQLiteManager(dbPath, { readonly: true });
    expect(reader.searchComponents("게시판").map((c) => c.component_id)).toEqual(["bbs"]);
    expect(reader.searchCompatibleSoftware({ frameworkVersion: "4.3" }).map((s) => s.product_name)).toEqual(["JEUS"]);
    expect(reader.getCategories()).toEqual(["WAS"]);
    reader.close();

    expect(sha256(dbPath)).toBe(before);
    expect(fs.readdirSync(dbDir)).toEqual(["egovframe.db"]);
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "쓰기 권한이 없는 설치 위치의 DB 도 읽기 전용으로 조회할 수 있다",
    async () => {
      await fs.chmod(dbPath, 0o444);
      await fs.chmod(dbDir, 0o555);

      const reader = new SQLiteManager(dbPath, { readonly: true });
      expect(reader.searchComponents("게시판").map((c) => c.component_id)).toEqual(["bbs"]);
      reader.close();
    },
  );

  it("읽기 전용 모드는 없는 DB 파일을 만들지 않고 조치 방법을 담은 오류를 던진다", () => {
    const missingDir = path.join(tmpDir, "not-installed");
    const missing = path.join(missingDir, "egovframe.db");

    let thrown: unknown;
    try {
      new SQLiteManager(missing, { readonly: true });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(UserFacingError);
    const message = (thrown as Error).message;
    expect(message).toContain("knowledge-base/egovframe.db");
    expect(message).toContain("build-index");
    expect(message).not.toContain(tmpDir); // 절대 경로를 노출하지 않는다
    expect(fs.existsSync(missingDir)).toBe(false);
  });

  it("읽기 전용 연결로는 쓰기를 할 수 없다", () => {
    const reader = new SQLiteManager(dbPath, { readonly: true });
    expect(() => reader.clearCompatibilitySoftware()).toThrow();
    reader.close();
  });

  it("쓰기 모드(기본값)는 지금처럼 없는 DB 파일을 새로 만든다", () => {
    const fresh = path.join(tmpDir, "fresh", "egovframe.db");
    const writer = new SQLiteManager(fresh);
    writer.close();
    expect(fs.existsSync(fresh)).toBe(true);
  });
});
