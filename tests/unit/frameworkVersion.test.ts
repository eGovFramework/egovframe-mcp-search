/**
 * 프레임워크 버전 표기 정규화(src/utils/frameworkVersion.ts) 단위 테스트
 *
 * 호환 소프트웨어의 frameworkVersion 필터와 키워드 검색이 같은 정규화를 쓴다.
 */
import { describe, it, expect } from "vitest";
import { normalizeFrameworkVersion } from "../../src/utils/frameworkVersion.js";

describe("normalizeFrameworkVersion", () => {
  it("앞의 v 또는 V 를 떼고 x.y.z 를 x.y 로 줄인다", () => {
    expect(normalizeFrameworkVersion("4.3")).toBe("4.3");
    expect(normalizeFrameworkVersion("v4.3")).toBe("4.3");
    expect(normalizeFrameworkVersion("V4.3")).toBe("4.3");
    expect(normalizeFrameworkVersion("4.3.0")).toBe("4.3");
    expect(normalizeFrameworkVersion("v4.3.1")).toBe("4.3");
    expect(normalizeFrameworkVersion("  4.3 \n")).toBe("4.3");
  });

  it("버전은 숫자가 아니라 문자열로 다룬다 (3.10 과 3.1 은 다른 버전)", () => {
    expect(normalizeFrameworkVersion("3.10")).toBe("3.10");
    expect(normalizeFrameworkVersion("3.10.2")).toBe("3.10");
    expect(normalizeFrameworkVersion("3.1")).toBe("3.1");
  });

  it("그 밖의 꼴은 공백만 떼고 그대로 둔다", () => {
    expect(normalizeFrameworkVersion("4")).toBe("4");
    expect(normalizeFrameworkVersion("4.3.0.1")).toBe("4.3.0.1");
    expect(normalizeFrameworkVersion("latest")).toBe("latest");
    expect(normalizeFrameworkVersion("version 4.3")).toBe("version 4.3");
    // 숫자가 뒤따르지 않는 v 는 버전 표기의 접두가 아니다
    expect(normalizeFrameworkVersion("vendor")).toBe("vendor");
  });
});
