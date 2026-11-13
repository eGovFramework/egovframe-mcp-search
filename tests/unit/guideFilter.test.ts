/**
 * 가이드 검색의 layer / category 필터 처리 단위 테스트
 *
 * - 입력 값을 테이블에 저장된 값에 대소문자 구분 없이 대응시키는지
 * - 대응되는 값이 없으면 유효한 값을 나열해 거부하는지
 * - 필터 값이 where 절에서 리터럴로만 쓰이는지
 *
 * 동봉 LanceDB 테이블은 읽기만 하고, 쓰기가 필요한 검증은 임시 디렉토리의 테이블에서 한다.
 * 질의 임베딩은 저장된 벡터로 대신한다 (_lanceFixtures 참고).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import * as lancedb from "@lancedb/lancedb";
import {
  GuideSearchManager,
  buildGuideFacets,
  getInitializedGuideManager,
  resolveGuideFilter,
  type GuideFacets,
} from "../../src/rag/guideManager.js";
import { getEmbedder } from "../../src/rag/embedder.js";
import { egovSearchKnowledge } from "../../src/tools/egovSearchKnowledge.js";
import { UserFacingError } from "../../src/utils/errors.js";
import {
  BUNDLED_KB,
  GUIDE_TABLE,
  HAS_BUNDLED_TABLES,
  loadVectorRows,
  openBundledTable,
  useQueryVector,
  type VectorRow,
} from "./_lanceFixtures.js";

const STORED_VECTOR_QUERY = "(저장된 벡터로 대체)";

/** where 절의 조건을 바꾸거나 질의를 깨뜨리려는 값들 */
const INJECTION_VALUES = [
  "it's",
  "x' OR '1'='1",
  "egovframe-development' OR layer = 'common-component",
  "x'; DROP TABLE egovframe_guide; --",
];

/**
 * 테이블에서 layer / category 고유 값을 읽은 횟수를 센다 (afterEach 의 vi.restoreAllMocks() 로 되돌린다).
 *
 * 매니저의 내부 필드에 기대지 않도록 LanceDB 테이블 구현 클래스의 query() 를 관찰한다.
 * 벡터 질의도 내부에서 query() 를 거치므로, 두 컬럼만 고르는 호출만 센다.
 */
async function countFacetReads(): Promise<() => number> {
  type Query = ReturnType<lancedb.Table["query"]>;
  const tablePrototype = Object.getPrototypeOf(await openBundledTable(GUIDE_TABLE)) as lancedb.Table;
  const originalQuery = tablePrototype.query as (this: lancedb.Table) => Query;
  let reads = 0;
  vi.spyOn(tablePrototype, "query").mockImplementation(function (this: lancedb.Table): Query {
    const query = originalQuery.call(this);
    const originalSelect = query.select.bind(query);
    query.select = ((columns: Parameters<Query["select"]>[0]) => {
      if (Array.isArray(columns) && columns.join(",") === "layer,category") reads += 1;
      return originalSelect(columns);
    }) as Query["select"];
    return query;
  });
  return () => reads;
}

/** 던져진 오류를 값으로 받는다. */
function catchError(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

const SAMPLE_FACETS: GuideFacets = buildGuideFacets([
  ...Array.from({ length: 5 }, () => ({ layer: "egovframe-runtime", category: "persistence-layer" })),
  ...Array.from({ length: 3 }, () => ({ layer: "egovframe-runtime", category: "intro" })),
  ...Array.from({ length: 2 }, () => ({ layer: "egovframe-runtime", category: "" })),
  ...Array.from({ length: 4 }, () => ({ layer: "common-component", category: "security" })),
  ...Array.from({ length: 1 }, () => ({ layer: "common-component", category: "intro" })),
  ...Array.from({ length: 1 }, () => ({ layer: "docs", category: "" })),
]);

describe("buildGuideFacets", () => {
  it("layer 고유 값을 청크 수 내림차순으로 센다", () => {
    expect(SAMPLE_FACETS.layers).toEqual([
      { value: "egovframe-runtime", count: 10 },
      { value: "common-component", count: 5 },
      { value: "docs", count: 1 },
    ]);
  });

  it("category 는 모든 layer 를 합쳐 세고, 빈 값은 목록에 넣지 않는다", () => {
    expect(SAMPLE_FACETS.categories).toEqual([
      { value: "persistence-layer", count: 5 },
      { value: "intro", count: 4 },
      { value: "security", count: 4 },
    ]);
  });

  it("layer 별 category 목록을 만든다 (category 가 없는 layer 는 빈 목록)", () => {
    expect(SAMPLE_FACETS.categoriesByLayer).toEqual({
      "egovframe-runtime": [
        { value: "persistence-layer", count: 5 },
        { value: "intro", count: 3 },
      ],
      "common-component": [
        { value: "security", count: 4 },
        { value: "intro", count: 1 },
      ],
      docs: [],
    });
  });
});

describe("resolveGuideFilter", () => {
  it("필터가 없으면 아무 조건도 만들지 않는다", () => {
    expect(resolveGuideFilter(SAMPLE_FACETS)).toEqual({ layers: [], categories: [] });
    expect(resolveGuideFilter(SAMPLE_FACETS, "", "   ")).toEqual({ layers: [], categories: [] });
  });

  it("저장된 값과 같으면 그대로 쓴다", () => {
    expect(resolveGuideFilter(SAMPLE_FACETS, "egovframe-runtime", "persistence-layer")).toEqual({
      layers: ["egovframe-runtime"],
      categories: ["persistence-layer"],
    });
  });

  it("대소문자와 앞뒤 공백이 달라도 저장된 값에 대응시킨다", () => {
    expect(resolveGuideFilter(SAMPLE_FACETS, "EGOVFRAME-RUNTIME").layers).toEqual(["egovframe-runtime"]);
    expect(resolveGuideFilter(SAMPLE_FACETS, "  Common-Component  ").layers).toEqual(["common-component"]);
    expect(resolveGuideFilter(SAMPLE_FACETS, undefined, " Persistence-Layer ").categories).toEqual([
      "persistence-layer",
    ]);
  });

  it("대소문자만 다른 값이 여럿 저장돼 있으면 정확히 같은 값을 우선하고, 없으면 모두 고른다", () => {
    const facets = buildGuideFacets([
      { layer: "Docs", category: "Intro" },
      { layer: "docs", category: "intro" },
    ]);
    expect(resolveGuideFilter(facets, "docs").layers).toEqual(["docs"]);
    expect(resolveGuideFilter(facets, "DOCS").layers.sort()).toEqual(["Docs", "docs"]);
    expect(resolveGuideFilter(facets, undefined, "Intro").categories).toEqual(["Intro"]);
    expect(resolveGuideFilter(facets, undefined, "INTRO").categories.sort()).toEqual(["Intro", "intro"]);
  });

  it("없는 layer 는 저장된 layer 를 모두 나열해 거부한다", () => {
    const error = catchError(() => resolveGuideFilter(SAMPLE_FACETS, "runtime"));
    expect(error).toBeInstanceOf(UserFacingError);
    const message = (error as Error).message;
    expect(message).toContain('"runtime"');
    for (const layer of ["egovframe-runtime", "common-component", "docs"]) {
      expect(message).toContain(layer);
    }
  });

  it("없는 category 는 layer 가 없으면 전체 category 를 나열해 거부한다", () => {
    const error = catchError(() => resolveGuideFilter(SAMPLE_FACETS, undefined, "데이터처리"));
    expect(error).toBeInstanceOf(UserFacingError);
    const message = (error as Error).message;
    for (const category of ["persistence-layer", "intro", "security"]) {
      expect(message).toContain(category);
    }
  });

  it("layer 가 주어지면 그 layer 의 category 안에서만 찾고, 없으면 그 layer 의 값만 나열한다", () => {
    // intro 는 두 layer 에 모두 있다
    expect(resolveGuideFilter(SAMPLE_FACETS, "common-component", "INTRO")).toEqual({
      layers: ["common-component"],
      categories: ["intro"],
    });

    // security 는 common-component 에만 있다
    const error = catchError(() => resolveGuideFilter(SAMPLE_FACETS, "egovframe-runtime", "security"));
    expect(error).toBeInstanceOf(UserFacingError);
    const listed = (error as Error).message.split("사용할 수 있는 값:")[1];
    expect(listed).toContain("persistence-layer");
    expect(listed).toContain("intro");
    expect(listed).not.toContain("security");
  });

  it("category 가 없는 layer 에 category 를 주면 값이 없다고 알린다", () => {
    const error = catchError(() => resolveGuideFilter(SAMPLE_FACETS, "docs", "intro"));
    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as Error).message).toContain("docs");
  });

  it("조건을 바꾸려는 값은 없는 값으로 거부한다", () => {
    for (const value of INJECTION_VALUES) {
      expect(catchError(() => resolveGuideFilter(SAMPLE_FACETS, value)), value).toBeInstanceOf(UserFacingError);
      expect(catchError(() => resolveGuideFilter(SAMPLE_FACETS, undefined, value)), value).toBeInstanceOf(
        UserFacingError,
      );
    }
  });
});

describe("resolveGuideFilter — 오류 문구의 '사용할 수 있는 값' 목록", () => {
  /** 오류 문구에 나열하는 값의 최대 개수 */
  const MAX_LISTED = 30;

  /** 거부 오류의 문구 (거부하지 않으면 테스트 실패) */
  const rejection = (facets: GuideFacets, layer?: string, category?: string): string => {
    const error = catchError(() => resolveGuideFilter(facets, layer, category));
    expect(error).toBeInstanceOf(UserFacingError);
    return (error as Error).message;
  };

  /** 문구 끝의 '외 N개' 표기 (없으면 빈 문자열) */
  const omittedNote = (message: string): string => message.match(/ 외 \d+개$/)?.[0] ?? "";

  /** 문구에서 나열된 값만 꺼낸다 ('외 N개' 표기는 뺀다) */
  const listedValues = (message: string): string[] =>
    message
      .slice(0, message.length - omittedNote(message).length)
      .split("사용할 수 있는 값: ")[1]
      .split(", ");

  /**
   * 고유 값이 count 개인 청크 목록. i 번째 값은 (count - i) 개의 청크를 가지므로
   * 청크 수 내림차순 목록에서 i 번째에 온다.
   */
  const rowsWithValues = (count: number, toRow: (name: string) => { layer: string; category: string }) =>
    Array.from({ length: count }, (_, i) =>
      Array.from({ length: count - i }, () => toRow(`value-${String(i + 1).padStart(4, "0")}`)),
    ).flat();

  const layerFacets = (count: number) =>
    buildGuideFacets(rowsWithValues(count, (name) => ({ layer: name, category: "" })));
  const categoryFacets = (count: number) =>
    buildGuideFacets(rowsWithValues(count, (name) => ({ layer: "runtime", category: name })));

  it("값이 30개 이하면 전부 나열한다", () => {
    expect(rejection(SAMPLE_FACETS, "runtime")).toBe(
      '알 수 없는 layer 값입니다: "runtime". 사용할 수 있는 값: egovframe-runtime, common-component, docs',
    );
    expect(rejection(SAMPLE_FACETS, undefined, "데이터처리")).toBe(
      '알 수 없는 category 값입니다: "데이터처리". 사용할 수 있는 값: persistence-layer, intro, security',
    );
    expect(rejection(SAMPLE_FACETS, "egovframe-runtime", "security")).toBe(
      '알 수 없는 category 값입니다: "security" (layer egovframe-runtime). 사용할 수 있는 값: persistence-layer, intro',
    );
    expect(rejection(SAMPLE_FACETS, "docs", "intro")).toBe(
      '알 수 없는 category 값입니다: "intro" (layer docs). 사용할 수 있는 값: (없음)',
    );
  });

  it("값이 정확히 30개면 '외 N개' 없이 전부 나열한다", () => {
    const facets = layerFacets(MAX_LISTED);
    const message = rejection(facets, "없는-layer");
    expect(omittedNote(message)).toBe("");
    expect(listedValues(message)).toEqual(facets.layers.map((facet) => facet.value));
  });

  it("layer 값이 31개 이상이면 청크가 많은 30개만 나열하고 나머지는 '외 N개' 로 줄인다", () => {
    const facets = layerFacets(MAX_LISTED + 1);
    const message = rejection(facets, "없는-layer");

    expect(omittedNote(message)).toBe(" 외 1개");
    expect(listedValues(message)).toEqual(facets.layers.slice(0, MAX_LISTED).map((facet) => facet.value));
    expect(message).not.toContain(facets.layers[MAX_LISTED].value);
  });

  it("고유 값이 수천 개여도 문구가 길어지지 않는다", () => {
    // 경로 전체가 layer 로 색인된 옛 인덱스: 문서마다 layer 값이 하나씩 생긴다
    const total = 5000;
    const facets = buildGuideFacets(
      Array.from({ length: total }, (_, i) => ({
        layer: `egovframe-runtime\\persistence-layer\\dataaccess-mybatis-guide-${i}.md`,
        category: "",
      })),
    );
    const message = rejection(facets, "egovframe-runtime");

    expect(message.length).toBeLessThan(2500);
    expect(omittedNote(message)).toBe(` 외 ${total - MAX_LISTED}개`);
    expect(listedValues(message)).toHaveLength(MAX_LISTED);
  });

  it("category 목록에도 같은 상한을 적용한다 (layer 를 준 경우와 주지 않은 경우 모두)", () => {
    const facets = categoryFacets(MAX_LISTED + 12);
    const expected = facets.categories.slice(0, MAX_LISTED).map((facet) => facet.value);

    const withoutLayer = rejection(facets, undefined, "없는-category");
    expect(omittedNote(withoutLayer)).toBe(" 외 12개");
    expect(listedValues(withoutLayer)).toEqual(expected);

    const withLayer = rejection(facets, "runtime", "없는-category");
    expect(withLayer).toContain("(layer runtime)");
    expect(omittedNote(withLayer)).toBe(" 외 12개");
    expect(listedValues(withLayer)).toEqual(expected);
  });
});

describe.skipIf(!HAS_BUNDLED_TABLES)("가이드 검색 — 동봉 테이블의 layer / category 필터", () => {
  let manager: GuideSearchManager;
  let rows: VectorRow[];

  beforeAll(async () => {
    manager = new GuideSearchManager(BUNDLED_KB);
    await manager.initialize();
    rows = await loadVectorRows(await openBundledTable(GUIDE_TABLE), ["layer", "category"]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("getFacets 는 테이블에 저장된 고유 값과 청크 수를 돌려준다", async () => {
    const facets = await manager.getFacets();

    const layerCounts = new Map<string, number>();
    for (const row of rows) {
      layerCounts.set(String(row.layer), (layerCounts.get(String(row.layer)) ?? 0) + 1);
    }
    expect(new Map(facets.layers.map((f) => [f.value, f.count]))).toEqual(layerCounts);
    expect(facets.layers.reduce((sum, f) => sum + f.count, 0)).toBe(rows.length);

    for (const layer of ["egovframe-runtime", "egovframe-development", "common-component"]) {
      expect(facets.layers.map((f) => f.value)).toContain(layer);
    }
    expect(facets.categoriesByLayer["common-component"].map((f) => f.value)).toContain("security");
    expect(facets.categoriesByLayer["egovframe-runtime"].map((f) => f.value)).toContain("persistence-layer");
    expect(facets.categories.every((f) => f.value !== "")).toBe(true);
  });

  it("getFacets 는 테이블을 한 번만 읽고 캐시한다", async () => {
    const fresh = new GuideSearchManager(BUNDLED_KB);
    await fresh.initialize();
    const facetReads = await countFacetReads();

    const first = await fresh.getFacets();
    const second = await fresh.getFacets();
    useQueryVector(rows[0].vector);
    await fresh.searchGuide(STORED_VECTOR_QUERY, { limit: 1, layer: "egovframe-runtime" });
    await fresh.searchGuide(STORED_VECTOR_QUERY, { limit: 1, category: "security" });

    expect(facetReads()).toBe(1);
    expect(second).toEqual(first);
  });

  /**
   * 검색 서버는 요청마다 getInitializedGuideManager() 로 매니저를 얻는다. 그때마다 테이블을 다시 열면
   * 고유 값 캐시(테이블 핸들이 같을 때만 유효)가 요청마다 버려진다. 싱글톤이 테이블을 한 번만 열어
   * 캐시가 요청 사이에 유지되는지 확인한다.
   */
  describe("서버가 쓰는 싱글톤 매니저", () => {
    let overlayDir: string;
    let savedDataDir: string | undefined;

    beforeAll(async () => {
      // 싱글톤은 오버레이(사용자 update 적용분)를 먼저 찾는다 — 빈 디렉토리로 돌려 동봉 테이블을 열게 한다
      overlayDir = await fs.mkdtemp(path.join(os.tmpdir(), "egov-guide-overlay-"));
      savedDataDir = process.env.EGOV_MCP_DATA_DIR;
      process.env.EGOV_MCP_DATA_DIR = overlayDir;
    });

    afterAll(async () => {
      if (savedDataDir === undefined) delete process.env.EGOV_MCP_DATA_DIR;
      else process.env.EGOV_MCP_DATA_DIR = savedDataDir;
      await fs.remove(overlayDir);
    });

    it("getInitializedGuideManager() 를 요청마다 다시 불러도 layer / category 는 한 번만 읽는다", async () => {
      const facetReads = await countFacetReads();
      useQueryVector(rows[0].vector);

      // 게이트웨이의 가이드 검색과 같은 순서다: 요청마다 매니저를 얻고, layer 필터로 검색한다
      for (let request = 0; request < 5; request++) {
        const guide = await getInitializedGuideManager();
        const results = await guide.searchGuide(STORED_VECTOR_QUERY, { limit: 1, layer: "egovframe-runtime" });
        expect(results.map((r) => r.layer)).toEqual(["egovframe-runtime"]);
      }

      expect(facetReads()).toBe(1);
    });

    it("게이트웨이(scope=guide)로 layer 필터 검색을 되풀이해도 고유 값을 다시 읽지 않는다", async () => {
      const facetReads = await countFacetReads();
      const embed = vi.spyOn(getEmbedder(), "embed").mockResolvedValue(rows[0].vector);

      for (let request = 0; request < 5; request++) {
        await egovSearchKnowledge({
          scope: "guide",
          query: STORED_VECTOR_QUERY,
          filters: { layer: "egovframe-runtime" },
          limit: 1,
        });
      }

      // 다섯 번 모두 필터를 해석한 뒤 검색까지 갔다
      expect(embed).toHaveBeenCalledTimes(5);
      // 같은 싱글톤을 쓴다 — 앞 테스트가 채운 캐시가 있으면 0회, 이 테스트만 돌리면 1회다
      expect(facetReads()).toBeLessThanOrEqual(1);
    });
  });

  it("getFacets 가 돌려준 객체를 바꿔도 캐시는 바뀌지 않는다", async () => {
    const first = await manager.getFacets();
    const expected = structuredClone(first);
    first.layers.length = 0;
    first.categoriesByLayer = {};
    expect(await manager.getFacets()).toEqual(expected);
  });

  it("대소문자·공백이 다른 layer 도 저장된 값으로 걸러 준다", async () => {
    useQueryVector(rows[0].vector);
    for (const layer of ["EGOVFRAME-RUNTIME", "Egovframe-Runtime", "  egovframe-runtime  "]) {
      const results = await manager.searchGuide(STORED_VECTOR_QUERY, { limit: 5, layer });
      expect(results, layer).toHaveLength(5);
      expect(results.every((r) => r.layer === "egovframe-runtime")).toBe(true);
    }
  });

  it("대소문자가 다른 category 도 저장된 값으로 걸러 준다", async () => {
    useQueryVector(rows[0].vector);
    const results = await manager.searchGuide(STORED_VECTOR_QUERY, { limit: 5, category: "Persistence-Layer" });
    expect(results).toHaveLength(5);
    expect(results.every((r) => r.category === "persistence-layer")).toBe(true);
  });

  it("layer 와 category 를 함께 주면 둘 다 만족하는 청크만 돌려준다", async () => {
    useQueryVector(rows[0].vector);
    const results = await manager.searchGuide(STORED_VECTOR_QUERY, {
      limit: 5,
      layer: "common-component",
      category: "security",
    });
    expect(results).toHaveLength(5);
    expect(results.every((r) => r.layer === "common-component" && r.category === "security")).toBe(true);
  });

  it("없는 layer / category 는 임베딩 전에 유효한 값을 나열해 거부한다", async () => {
    const embed = vi.spyOn(getEmbedder(), "embed").mockResolvedValue(rows[0].vector);

    const layerError = await manager.searchGuide("트랜잭션", { layer: "runtime" }).catch((e: unknown) => e);
    expect(layerError).toBeInstanceOf(UserFacingError);
    expect((layerError as Error).message).toContain("egovframe-runtime");
    expect((layerError as Error).message).toContain("common-component");

    const categoryError = await manager
      .searchGuide("트랜잭션", { layer: "egovframe-runtime", category: "security" })
      .catch((e: unknown) => e);
    expect(categoryError).toBeInstanceOf(UserFacingError);
    const listed = (categoryError as Error).message.split("사용할 수 있는 값:")[1];
    expect(listed).toContain("persistence-layer");
    expect(listed).not.toContain("user-authentication");

    expect(embed).not.toHaveBeenCalled();
  });

  it("작은따옴표가 든 값은 필터를 풀지도 질의를 깨뜨리지도 않고 없는 값으로 거부된다", async () => {
    useQueryVector(rows[0].vector);
    for (const value of INJECTION_VALUES) {
      await expect(manager.searchGuide(STORED_VECTOR_QUERY, { limit: 5, layer: value }), value).rejects.toBeInstanceOf(
        UserFacingError,
      );
      await expect(
        manager.searchGuide(STORED_VECTOR_QUERY, { limit: 5, category: value }),
        value,
      ).rejects.toBeInstanceOf(UserFacingError);
    }
  });

  it("필터가 없으면 고유 값을 읽지 않고 전체에서 검색한다", async () => {
    const fresh = new GuideSearchManager(BUNDLED_KB);
    await fresh.initialize();
    const facetReads = await countFacetReads();
    useQueryVector(rows[0].vector);
    expect(await fresh.searchGuide(STORED_VECTOR_QUERY, { limit: 3 })).toHaveLength(3);
    expect(facetReads()).toBe(0);
  });
});

describe("가이드 검색 — 저장된 값에 작은따옴표·대소문자 변형이 있는 테이블", () => {
  let tmpDir: string;
  let manager: GuideSearchManager;

  /** i 번째 축만 1 인 단위 벡터 */
  const unit = (i: number) => Array.from({ length: 384 }, (_, k) => (k === i ? 1 : 0));

  const chunk = (id: string, layer: string, category: string, axis: number) => ({
    id,
    title: `문서 ${id}`,
    content: `본문 ${id}`,
    source: `${layer}/${category}/${id}.md`,
    layer,
    category,
    section: "개요",
    docTitle: `문서 ${id}`,
    url: "",
    vector: unit(axis),
  });

  const search = async (options: { layer?: string; category?: string }) => {
    useQueryVector(unit(0));
    const results = await manager.searchGuide(STORED_VECTOR_QUERY, { limit: 10, ...options });
    return results.map((r) => r.id).sort();
  };

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "egov-guide-filter-"));
    const db = await lancedb.connect(tmpDir);
    await db.createTable(GUIDE_TABLE, [
      chunk("a", "o'brien", "Intro", 0),
      chunk("b", "o'brien", "intro", 1),
      chunk("c", "Plain", "intro", 2),
      chunk("d", "plain", "it's", 3),
    ]);
    manager = new GuideSearchManager(tmpDir);
    await manager.initialize();
  });

  afterAll(async () => {
    await fs.remove(tmpDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("작은따옴표가 든 저장 값으로 걸러도 질의가 깨지지 않는다", async () => {
    expect(await search({ layer: "o'brien" })).toEqual(["a", "b"]);
    expect(await search({ layer: "O'BRIEN" })).toEqual(["a", "b"]);
    expect(await search({ category: "it's" })).toEqual(["d"]);
    expect(await search({ category: "IT'S" })).toEqual(["d"]);
  });

  it("정확히 같은 값이 있으면 그 값만, 없으면 대소문자만 다른 값을 모두 고른다", async () => {
    expect(await search({ layer: "plain" })).toEqual(["d"]);
    expect(await search({ layer: "PLAIN" })).toEqual(["c", "d"]);
    expect(await search({ category: "intro" })).toEqual(["b", "c"]);
    expect(await search({ category: "INTRO" })).toEqual(["a", "b", "c"]);
    expect(await search({ layer: "O'Brien", category: "intro" })).toEqual(["b"]);
  });

  it("테이블에 청크가 추가되면 고유 값 목록도 갱신된다", async () => {
    expect((await manager.getFacets()).layers.map((f) => f.value)).not.toContain("new-layer");

    vi.spyOn(getEmbedder(), "embedBatch").mockResolvedValue([Float32Array.from(unit(4))]);
    await manager.addGuideBatch([
      {
        title: "새 문서",
        content: "새 본문",
        source: "new-layer/new-category/e.md",
        layer: "new-layer",
        category: "new-category",
        section: "개요",
        docTitle: "새 문서",
        url: "",
      },
    ]);

    const facets = await manager.getFacets();
    expect(facets.layers.map((f) => f.value)).toContain("new-layer");
    expect(facets.categoriesByLayer["new-layer"]).toEqual([{ value: "new-category", count: 1 }]);
    expect(await search({ layer: "NEW-LAYER" })).toHaveLength(1);
  });
});
