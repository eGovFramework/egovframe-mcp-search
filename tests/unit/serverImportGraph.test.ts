/**
 * 검색 서버(src/server.ts)의 import 그래프 테스트
 *
 * 서버는 읽기 전용 조회만 하므로, 인덱스 구축과 갱신 CLI 가 쓰는 모듈(외부 명령 실행, 다운로드,
 * 엑셀 파싱)을 불러오면 안 된다. 불러오면 시작이 느려지고 메모리를 더 쓰며, "서버의 코드 경로에는
 * 외부 명령을 실행하는 모듈이 없다" 는 보안 근거가 깨진다.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = path.join(REPO_ROOT, "src");

/** 소스 파일 하나가 import 하는 모듈 지정자를 모은다 (정적 import, export from, 동적 import). */
function importSpecifiers(file: string): string[] {
  const source = fs.readFileSync(file, "utf-8");
  const specifiers: string[] = [];
  const patterns = [
    /\bimport\s+(?:type\s+)?[^'";]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bexport\s+[^'";]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      // 타입만 가져오는 import 는 실행 시점에 불러오지 않는다
      if (/^import\s+type\b/.test(match[0])) continue;
      specifiers.push(match[1]);
    }
  }
  return specifiers;
}

/** entry 에서 도달하는 프로젝트 모듈(src 기준 상대 경로)과 패키지 이름을 모은다. */
function walk(entry: string): { modules: Set<string>; packages: Set<string>; importers: Map<string, string[]> } {
  const modules = new Set<string>();
  const packages = new Set<string>();
  const importers = new Map<string, string[]>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    const rel = path.relative(SRC, file);
    if (modules.has(rel)) continue;
    modules.add(rel);
    for (const specifier of importSpecifiers(file)) {
      if (specifier.startsWith(".")) {
        const target = path.resolve(path.dirname(file), specifier.replace(/\.js$/, ".ts"));
        if (fs.existsSync(target)) queue.push(target);
      } else {
        packages.add(specifier);
        importers.set(specifier, [...(importers.get(specifier) ?? []), rel]);
      }
    }
  }
  return { modules, packages, importers };
}

describe("검색 서버의 import 그래프", () => {
  const graph = walk(path.join(SRC, "server.ts"));

  it("도구 구현과 저장소 모듈에 도달한다 (그래프를 제대로 따라갔는지 확인)", () => {
    expect(graph.modules).toContain(path.join("tools", "egovSearchKnowledge.ts"));
    expect(graph.modules).toContain(path.join("database", "sqliteManager.ts"));
    expect(graph.modules).toContain(path.join("rag", "guideManager.ts"));
  });

  it("인덱스 구축과 갱신 CLI 의 모듈을 불러오지 않는다", () => {
    const forbidden = [...graph.modules].filter(
      (module) =>
        module.startsWith(`scripts${path.sep}`) ||
        module.startsWith(`cli${path.sep}`) ||
        module === path.join("utils", "download.ts") ||
        module === path.join("kb", "snapshot.ts") ||
        module === path.join("kb", "sources.ts"),
    );
    expect(forbidden).toEqual([]);
  });

  it("외부 명령을 실행하는 모듈과 엑셀 파서를 불러오지 않는다", () => {
    const forbidden = ["child_process", "node:child_process", "xlsx"].filter((name) => graph.packages.has(name));
    expect(forbidden.map((name) => `${name} ← ${graph.importers.get(name)?.join(", ")}`)).toEqual([]);
  });
});
