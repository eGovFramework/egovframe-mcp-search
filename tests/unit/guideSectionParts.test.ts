/**
 * 가이드 절의 조각 번호 해석(parseSectionPart)과 이웃 조각 조회(GuideSearchManager.getSectionParts) 단위 테스트
 *
 * 긴 절은 여러 조각으로 나뉘어 section 끝에 " (k/n)" 이 붙는다. 게이트웨이가 "이 절의 이전 조각과 다음 조각" 을
 * 안내할 수 있도록, 같은 문서의 같은 절에 속한 조각을 조각 번호 순으로 찾는다.
 *
 * 조회는 임시 디렉토리의 테이블에서 확인한다 (임베딩 모델을 쓰지 않는다). 동봉 테이블은 조각 번호가 없는
 * 이전 청킹으로 만들어져 있을 수 있으므로, 그런 행에서도 오류 없이 동작하는지 읽기 전용으로 확인한다.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import * as lancedb from "@lancedb/lancedb";
import { GuideSearchManager, parseSectionPart } from "../../src/rag/guideManager.js";
import { chunkMarkdown } from "../../src/rag/guideChunking.js";
import { BUNDLED_KB, GUIDE_TABLE, HAS_BUNDLED_TABLES, openBundledTable, spread } from "./_lanceFixtures.js";

describe("parseSectionPart", () => {
  it("section 끝의 ' (k/n)' 을 해석한다", () => {
    expect(parseSectionPart("설정 > 캐시 (2/5)")).toEqual({ base: "설정 > 캐시", part: 2, count: 5 });
    expect(parseSectionPart("개요 (1/2)")).toEqual({ base: "개요", part: 1, count: 2 });
    expect(parseSectionPart("배포파일, 패키지, 테이블 간 관계 (118/120)")).toEqual({
      base: "배포파일, 패키지, 테이블 간 관계",
      part: 118,
      count: 120,
    });
  });

  it("조각 번호가 없으면 null 이다", () => {
    for (const section of ["설정 > 캐시", "개요", "", "설정 (2)", "설정 (a/b)", "(2/5)", "설정(2/5)", "설정 (2/5) 이후", "설정 (2/5) "]) {
      expect(parseSectionPart(section), JSON.stringify(section)).toBeNull();
    }
  });

  it("조각 번호로 볼 수 없는 숫자는 해석하지 않는다", () => {
    // 0 번째 조각, 전체보다 큰 번호, 조각이 하나뿐인 절, 0 으로 시작하는 표기
    for (const section of ["설정 (0/3)", "설정 (4/3)", "설정 (1/1)", "설정 (01/3)", "설정 (1/03)", "설정 (-1/3)", "설정 (1.5/3)"]) {
      expect(parseSectionPart(section), section).toBeNull();
    }
  });

  it("맨 끝의 조각 번호만 떼어 낸다 (제목에 같은 모양의 문구가 있어도)", () => {
    expect(parseSectionPart("설치 (1/2) (3/4)")).toEqual({ base: "설치 (1/2)", part: 3, count: 4 });
    expect(parseSectionPart("예제 [2] (1/2)")).toEqual({ base: "예제 [2]", part: 1, count: 2 });
  });

  it("합쳐진 소절의 이름이 실린 section 에서도 맨 끝의 조각 번호만 떼어 낸다", () => {
    // 이웃 소절을 합친 묶음은 section 에 소절의 이름을 ' / ' 로 잇고, 넘는 수는 ' 외 N개' 로 적는다
    expect(parseSectionPart("설명 > Input / Output (2/3)")).toEqual({ base: "설명 > Input / Output", part: 2, count: 3 });
    expect(parseSectionPart("API > 조회 / 등록 / 수정 / 삭제 외 2개 (1/2)")).toEqual({
      base: "API > 조회 / 등록 / 수정 / 삭제 외 2개",
      part: 1,
      count: 2,
    });
    // 같은 제목 경로를 구별하는 순번 ' [k]' 은 이름의 일부로 남는다
    expect(parseSectionPart("설명 > Input / Output [2] (1/2)")).toEqual({ base: "설명 > Input / Output [2]", part: 1, count: 2 });
    for (const section of ["설명 > Input / Output", "API > 조회 / 등록 외 2개", "설명 > Input / Output [2]"]) {
      expect(parseSectionPart(section), section).toBeNull();
    }
  });

  it("문자열이 아닌 값에도 오류를 내지 않는다", () => {
    expect(parseSectionPart(undefined as unknown as string)).toBeNull();
    expect(parseSectionPart(null as unknown as string)).toBeNull();
    expect(parseSectionPart(42 as unknown as string)).toBeNull();
  });

  it("chunkMarkdown 이 붙인 조각 번호를 그대로 되돌린다", () => {
    const sentence = (i: number) => `캐시 문단의 ${i}번째 문장입니다.`;
    const paragraphs = Array.from({ length: 8 }, (_, p) => Array.from({ length: 5 }, (_, i) => sentence(p * 5 + i)).join(" "));
    const chunks = chunkMarkdown(
      ["## 설정", "", ...paragraphs.flatMap((p) => [p, ""])].join("\n"),
      { title: "캐시 가이드" },
      "egovframe-runtime/foundation-layer/cache.md",
      { tokenBudget: 160, minPieceChars: 40 },
    );
    expect(chunks.length).toBeGreaterThan(2);
    chunks.forEach((chunk, index) => {
      expect(parseSectionPart(chunk.section)).toEqual({ base: "설정", part: index + 1, count: chunks.length });
      expect(parseSectionPart(chunk.title)).toEqual({ base: "캐시 가이드: 설정", part: index + 1, count: chunks.length });
    });
  });
});

describe("GuideSearchManager.getSectionParts", () => {
  let tmpDir: string;
  let manager: GuideSearchManager;

  const DOC = "egovframe-runtime/foundation-layer/cache.md";
  const OTHER_DOC = "egovframe-runtime/foundation-layer/session.md";
  const QUOTED_DOC = "egovframe-runtime/it's/o'brien.md";

  /** 행마다 다른 축만 1 인 단위 벡터 (조회는 벡터를 쓰지 않는다) */
  let nextAxis = 0;
  const row = (id: string, source: string, section: string) => {
    const axis = nextAxis++;
    return {
      id,
      title: `캐시 가이드: ${section}`,
      content: `본문 ${id}`,
      source,
      layer: "egovframe-runtime",
      category: "foundation-layer",
      section,
      docTitle: "캐시 가이드",
      url: "",
      vector: Array.from({ length: 384 }, (_, k) => (k === axis ? 1 : 0)),
    };
  };

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "egov-guide-parts-"));
    const db = await lancedb.connect(tmpDir);
    await db.createTable(GUIDE_TABLE, [
      // 조각 번호 순서와 다르게 넣는다 (테이블에 들어간 순서에 기대지 않는지 확인)
      row("cache-3", DOC, "설정 > 캐시 (3/3)"),
      row("cache-1", DOC, "설정 > 캐시 (1/3)"),
      row("intro", DOC, "설정"),
      row("cache-2", DOC, "설정 > 캐시 (2/3)"),
      // 제목 경로가 조회하는 절로 시작하지만 다른 절
      row("ttl-1", DOC, "설정 > 캐시 > 만료 (1/2)"),
      row("ttl-2", DOC, "설정 > 캐시 > 만료 (2/2)"),
      row("cache-name", DOC, "설정 > 캐시 이름"),
      // 다른 문서의 같은 절
      row("other-1", OTHER_DOC, "설정 > 캐시 (1/2)"),
      row("other-2", OTHER_DOC, "설정 > 캐시 (2/2)"),
      // 조각 번호가 없는 절과 번호가 붙은 절의 제목 경로가 같은 문서 (## 앞의 개요와 '## 개요' 절)
      row("overview-plain", DOC, "개요"),
      row("overview-2", DOC, "개요 (2/2)"),
      row("overview-1", DOC, "개요 (1/2)"),
      // 조각 번호가 없는 같은 제목 경로의 절 두 개 (이전 청킹으로 만든 인덱스에도 있는 형태)
      row("ref-a", DOC, "참고자료"),
      row("ref-b", DOC, "참고자료"),
      // 합쳐진 소절의 이름이 실린 절, 같은 제목 경로를 구별하는 순번이 붙은 절, 이름이 그 절로 시작하는 번호 없는 절
      row("merged-2", DOC, "설명 > Input / Output (2/2)"),
      row("merged-1", DOC, "설명 > Input / Output (1/2)"),
      row("merged-again-1", DOC, "설명 > Input / Output [2] (1/2)"),
      row("merged-again-2", DOC, "설명 > Input / Output [2] (2/2)"),
      row("merged-more", DOC, "설명 > Input / Output 외 1개"),
      // 작은따옴표가 든 값
      row("quoted-2", QUOTED_DOC, "it's (2/2)"),
      row("quoted-1", QUOTED_DOC, "it's (1/2)"),
      row("quoted-plain", QUOTED_DOC, "x' OR '1'='1"),
    ]);
    manager = new GuideSearchManager(tmpDir);
    await manager.initialize({ createIfMissing: false });
  });

  afterAll(async () => {
    await fs.remove(tmpDir);
  });

  it("같은 문서의 같은 절에 속한 조각을 조각 번호 순으로 돌려준다", async () => {
    expect(await manager.getSectionParts(DOC, "설정 > 캐시")).toEqual([
      { id: "cache-1", part: 1, count: 3 },
      { id: "cache-2", part: 2, count: 3 },
      { id: "cache-3", part: 3, count: 3 },
    ]);
    expect(await manager.getSectionParts(DOC, "설정 > 캐시 > 만료")).toEqual([
      { id: "ttl-1", part: 1, count: 2 },
      { id: "ttl-2", part: 2, count: 2 },
    ]);
  });

  it("다른 문서의 같은 절은 섞지 않는다", async () => {
    expect((await manager.getSectionParts(OTHER_DOC, "설정 > 캐시")).map((part) => part.id)).toEqual(["other-1", "other-2"]);
  });

  it("조각 번호가 없는 절은 조각 하나(1/1)로 돌려준다", async () => {
    expect(await manager.getSectionParts(DOC, "설정")).toEqual([{ id: "intro", part: 1, count: 1 }]);
    expect(await manager.getSectionParts(DOC, "설정 > 캐시 이름")).toEqual([{ id: "cache-name", part: 1, count: 1 }]);
    // 제목 경로가 같은 절이 둘이면 둘 다 조각 하나짜리 절이다
    expect(await manager.getSectionParts(DOC, "참고자료")).toEqual([
      { id: "ref-a", part: 1, count: 1 },
      { id: "ref-b", part: 1, count: 1 },
    ]);
  });

  it("번호가 붙은 조각이 있으면 그것만 돌려준다 (제목 경로가 같은 번호 없는 절을 섞지 않는다)", async () => {
    expect(await manager.getSectionParts(DOC, "개요")).toEqual([
      { id: "overview-1", part: 1, count: 2 },
      { id: "overview-2", part: 2, count: 2 },
    ]);
  });

  it("합쳐진 소절의 이름이나 순번 ' [k]' 이 실린 절도 이름이 같은 조각끼리만 묶는다", async () => {
    expect(await manager.getSectionParts(DOC, "설명 > Input / Output")).toEqual([
      { id: "merged-1", part: 1, count: 2 },
      { id: "merged-2", part: 2, count: 2 },
    ]);
    expect(await manager.getSectionParts(DOC, "설명 > Input / Output [2]")).toEqual([
      { id: "merged-again-1", part: 1, count: 2 },
      { id: "merged-again-2", part: 2, count: 2 },
    ]);
    expect(await manager.getSectionParts(DOC, "설명 > Input / Output 외 1개")).toEqual([{ id: "merged-more", part: 1, count: 1 }]);
    // 묶음에 든 소절 하나의 이름은 절의 이름이 아니다
    expect(await manager.getSectionParts(DOC, "설명 > Input")).toEqual([]);
    expect(await manager.getSectionParts(DOC, "설명 > Output")).toEqual([]);
  });

  it("없는 문서나 없는 절은 빈 배열이다", async () => {
    expect(await manager.getSectionParts(DOC, "없는 절")).toEqual([]);
    expect(await manager.getSectionParts("없는/문서.md", "설정 > 캐시")).toEqual([]);
    expect(await manager.getSectionParts("", "")).toEqual([]);
    // 조각 번호까지 붙인 문자열은 절의 이름이 아니다
    expect(await manager.getSectionParts(DOC, "설정 > 캐시 (2/3)")).toEqual([]);
  });

  it("작은따옴표가 든 값으로 조회해도 질의가 깨지거나 조건이 바뀌지 않는다", async () => {
    expect(await manager.getSectionParts(QUOTED_DOC, "it's")).toEqual([
      { id: "quoted-1", part: 1, count: 2 },
      { id: "quoted-2", part: 2, count: 2 },
    ]);
    expect(await manager.getSectionParts(QUOTED_DOC, "x' OR '1'='1")).toEqual([{ id: "quoted-plain", part: 1, count: 1 }]);
    // 조건을 항상 참으로 바꾸려는 값: 리터럴로만 쓰이면 어떤 문서와도 같지 않다
    for (const hostile of ["x' OR '1'='1", "' OR source != '", "x'; DROP TABLE egovframe_guide; --", "%", "_"]) {
      expect(await manager.getSectionParts(hostile, "설정 > 캐시"), hostile).toEqual([]);
      expect(await manager.getSectionParts(DOC, hostile), hostile).toEqual([]);
    }
    // 테이블이 그대로다
    expect(await manager.getSectionParts(DOC, "설정 > 캐시")).toHaveLength(3);
  });
});

describe.skipIf(!HAS_BUNDLED_TABLES)("GuideSearchManager.getSectionParts — 동봉 테이블 (읽기 전용)", () => {
  it("조각 번호가 있든 없든 모든 행에서 오류 없이 그 행을 포함한 조각 목록을 돌려준다", async () => {
    const manager = new GuideSearchManager(BUNDLED_KB);
    await manager.initialize({ createIfMissing: false });
    const table = await openBundledTable(GUIDE_TABLE);
    const rows = (await table.query().select(["id", "source", "section"]).toArray()) as Array<{
      id: string;
      source: string;
      section: string;
    }>;
    expect(rows.length).toBeGreaterThan(1000);

    for (const row of spread(rows, 60)) {
      const parsed = parseSectionPart(row.section);
      const parts = await manager.getSectionParts(row.source, parsed ? parsed.base : row.section);
      const label = `${row.source} | ${row.section}`;
      const own = parts.find((part) => part.id === row.id);
      if (parsed) {
        expect(own, label).toEqual({ id: row.id, part: parsed.part, count: parsed.count });
      } else if (parts.every((part) => part.count === 1)) {
        expect(own, label).toEqual({ id: row.id, part: 1, count: 1 });
      } else {
        // 제목 경로가 같은 번호 붙은 절이 있는 문서: 번호가 붙은 조각만 돌려준다
        expect(parts.every((part) => part.count > 1), label).toBe(true);
      }
      // 조각 번호 순
      expect(parts.map((part) => part.part), label).toEqual([...parts.map((part) => part.part)].sort((a, b) => a - b));
    }
  });
});
