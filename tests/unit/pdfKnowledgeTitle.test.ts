/**
 * 적용가이드 PDF 청크의 제목 단위 테스트
 *
 * macOS 의 파일 시스템은 한글 파일 이름을 자모가 분리된 NFD 로 돌려준다. 그 이름으로 제목을 만들면
 * 색인에 NFD 문자열이 들어가, 같은 글자를 NFC 로 적은 값과 일치하지 않고 일부 화면에서는 자모가 풀려 보인다.
 */
import { describe, it, expect } from "vitest";
import { pdfChunkTitle } from "../../src/scripts/buildIndex.js";

describe("pdfChunkTitle", () => {
  it("파일 이름에서 확장자를 떼고 청크 번호를 붙인다", () => {
    expect(pdfChunkTitle("/kb/guide/application-guide.pdf", 0, 3)).toBe("application-guide (1/3)");
  });

  it("NFD 로 들어온 한글 파일 이름을 NFC 로 정규화한다", () => {
    const nfdName = "[가이드]표준프레임워크_적용가이드_v5.0".normalize("NFD");
    expect(nfdName).not.toBe(nfdName.normalize("NFC"));

    const title = pdfChunkTitle(`/kb/${nfdName}.pdf`, 39, 87);

    expect(title).toBe("[가이드]표준프레임워크_적용가이드_v5.0 (40/87)");
    expect(title).toBe(title.normalize("NFC"));
  });
});
