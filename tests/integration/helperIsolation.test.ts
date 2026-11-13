/**
 * 통합 테스트 헬퍼가 서버를 사용자 환경으로부터 격리하는지 확인한다
 *
 * 서버는 사용자 데이터 디렉토리(오버레이)에 갱신분이 있으면 동봉 지식베이스 대신 그것을 읽는다.
 * 테스트가 띄우는 서버가 개발자의 실제 갱신분을 읽으면, 저장소가 그대로여도 테스트 결과가 달라진다.
 */
import { describe, it, expect, afterEach } from "vitest";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { callSearchKnowledge, createMcpClient } from "./_helper.js";
import { SCHEMA_VERSION } from "../../src/utils/dataPaths.js";

/**
 * 홈 디렉토리가 home 일 때 서버가 쓰는 오버레이 루트 (src/utils/dataPaths.ts 의 getOverlayRoot 와 같은 규칙).
 * 테스트 프로세스(워커)에서는 환경 변수를 바꿔도 os.homedir() 가 따라오지 않으므로 직접 계산한다.
 */
function overlayRootUnder(home: string): string {
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "egovframe-mcp-search");
  }
  if (process.platform === "win32") {
    return path.join(home, "AppData", "Local", "egovframe-mcp-search");
  }
  return path.join(home, ".local", "share", "egovframe-mcp-search");
}

describe("integration — 테스트 서버의 격리", () => {
  const saved = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    XDG_DATA_HOME: process.env.XDG_DATA_HOME,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
  };
  let fakeHome: string | undefined;

  afterEach(async () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (fakeHome) await fs.remove(fakeHome);
    fakeHome = undefined;
  });

  it("개발자 홈의 오버레이에 갱신분이 있어도 테스트 서버는 동봉 지식베이스를 읽는다", async () => {
    // 홈 디렉토리를 임시 디렉토리로 바꾸고, 그 아래의 오버레이에 공통컴포넌트 소스 갱신분을 꾸민다
    fakeHome = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "egov-fake-home-")));
    // 헬퍼가 띄우는 서버는 이 환경 변수들을 물려받는다
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;
    delete process.env.XDG_DATA_HOME;
    process.env.LOCALAPPDATA = path.join(fakeHome, "AppData", "Local");

    const overlayRoot = overlayRootUnder(fakeHome);
    const versionDir = "resources/common_components/v-fake";
    await fs.outputFile(path.join(overlayRoot, versionDir, "pom.xml"), "<project/>");
    await fs.outputFile(path.join(overlayRoot, versionDir, "ONLY_IN_OVERLAY.txt"), "overlay");
    await fs.writeJSON(path.join(overlayRoot, "state.json"), {
      schema_version: SCHEMA_VERSION,
      resources: { common_components: { version: "v-fake", dir: versionDir } },
    });

    const client = await createMcpClient();
    try {
      const res = await callSearchKnowledge(client, {
        scope: "components",
        action: "readSource",
        filters: { filePath: "ONLY_IN_OVERLAY.txt" },
      });
      // 오버레이를 읽었다면 이 파일의 내용이 나온다
      expect(res.text).toContain("파일을 찾을 수 없거나 접근할 수 없습니다");
    } finally {
      await client.close();
    }
  });
});
