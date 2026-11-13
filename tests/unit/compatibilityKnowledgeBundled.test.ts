/**
 * 호환 소프트웨어 조회의 includeKnowledge 를 동봉 지식베이스와 실제 임베딩 모델로 확인하는 회귀 테스트
 *
 * 고정 데이터로는 드러나지 않고 실제 데이터에서 확인된 문제를 그 데이터로 고정한다.
 * - 제품명을 부분 문자열로만 견주던 때에는 제품 'CESS' 에 access-denied-page·loginSuccess.do 가 들어 있을 뿐인 글이,
 *   'xFRAME' 에 X-Frame-Options 헤더를 묻는 글이, 'REDi' 에 Redis 를 묻는 글이 관련 지식으로 실렸다.
 * - 제품명의 앞뒤가 숫자여도 언급으로 보지 않던 때에는 제품명에 버전 숫자를 붙여 쓴 글('Nexacro14')이 빠졌다.
 *
 * 임베딩 모델(models/)과 동봉 LanceDB 테이블이 모두 있을 때만 실행한다. 도구가 여는 하이브리드 매니저를 동봉
 * 지식베이스로 고정해, 개발자가 update 로 적용해 둔 갱신분(사용자 데이터 디렉토리)이 결과를 바꾸지 않게 한다.
 * SQLite 와 LanceDB 테이블은 읽기만 한다.
 *
 * 기대값은 이 테스트를 쓴 시점의 동봉 인덱스에서 확인한 결과다. 개발자 지식 인덱스가 갱신되어 그 제품을
 * 언급하는 글이 새로 들어오면 기대값을 다시 확인한다.
 */
import { describe, it, expect, vi, afterAll } from "vitest";
import { hasEmbeddingModel } from "../integration/_helper.js";
import { BUNDLED_KB, HAS_BUNDLED_TABLES } from "./_lanceFixtures.js";

const bundled = vi.hoisted(() => ({ manager: undefined as { close(): void } | undefined }));

vi.mock("../../src/database/hybridManager.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/database/hybridManager.js")>();
  return {
    ...actual,
    // basePath 를 주면 오버레이를 보지 않고 그 디렉토리의 SQLite(읽기 전용)와 LanceDB 테이블을 연다
    getHybridManager: () => {
      bundled.manager ??= new actual.HybridDatabaseManager(BUNDLED_KB);
      return bundled.manager;
    },
  };
});

import { searchCompatibleSoftware } from "../../src/tools/compatibility.js";

describe.skipIf(!hasEmbeddingModel() || !HAS_BUNDLED_TABLES)("includeKnowledge — 동봉 지식베이스", () => {
  afterAll(() => {
    bundled.manager?.close();
  });

  /** 제품 하나의 관련 지식 제목 (그 제품을 언급하는 글이 없으면 빈 배열) */
  const relatedTitles = async (productName: string): Promise<string[]> => {
    const response = await searchCompatibleSoftware({ productName, includeKnowledge: true });
    expect(response.count, `productName=${productName}`).toBeGreaterThan(0);
    // 지식 조회가 실패해 비어 있는 것이 아닌지 확인한다
    expect(response, `productName=${productName}`).not.toHaveProperty("knowledgeWarning");
    expect(response.knowledgeLookup?.searchedProducts, `productName=${productName}`).toBeGreaterThan(0);
    const entry = response.relatedKnowledge?.find((related) => related.product === productName);
    return entry ? entry.knowledge.map((item) => item.title) : [];
  };

  it("CESS: access-denied-page, loginSuccess.do 가 들어 있을 뿐인 글을 싣지 않는다", async () => {
    // 부분 문자열로 견주던 때에는 "context-security.xml 관련", "Access is denied 오류" 등 다섯 건이 실렸다.
    // 네 글자인 제품명은 대소문자를 가리지 않지만, 'access'·'Success' 의 'cess' 는 바로 앞이 영문자라 걸러진다
    expect(await relatedTitles("CESS")).toEqual([]);
  }, 120_000);

  it("REDi: Redis 를 묻는 글을 싣지 않는다", async () => {
    // 부분 문자열로 견주던 때에는 "Redis 설정 문의" 등 두 건이 실렸다. 'Redis' 의 'Redi' 는 바로 뒤가 영문자라 걸러진다
    expect(await relatedTitles("REDi")).toEqual([]);
  }, 120_000);

  it("Nexacro: 제품명에 버전 숫자를 붙여 쓴 글도 싣는다", async () => {
    // "넥사크로 관련" 은 본문에 제품명을 'Nexacro14' 로만 적었다. 앞뒤가 숫자여도 언급으로 보지 않던 때에는 실리지 않았다
    expect(await relatedTitles("Nexacro")).toContain("넥사크로 관련");
  }, 120_000);

  it("xFRAME: X-Frame-Options 헤더를 묻는 글을 싣지 않는다", async () => {
    // 부분 문자열로 견주던 때에는 "xframeoptions 문의", "ifram 사용" 두 건이 실렸다
    expect(await relatedTitles("xFRAME")).toEqual([]);
  }, 120_000);

  it("DevOnFrame: 제품을 언급하는 글은 그대로 싣는다 (대소문자가 다르고 조사가 붙어 있다)", async () => {
    expect(await relatedTitles("DevOnFrame")).toEqual(["DevonFrame과 전자정부Frame과 어떤차이점이 있나요?"]);
  }, 120_000);
});
