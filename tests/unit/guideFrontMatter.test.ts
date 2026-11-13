/**
 * 가이드 문서의 Hugo 프론트매터 파싱(parseFrontMatter) 단위 테스트
 *
 * egovframe-docs 에 실제로 있는 형태들을 다룬다: 블록 전체를 들여쓴 문서, CRLF 문서,
 * 콜론 앞에 공백이 있는 키('url : /path/'), 중첩된 menu 키, draft 문서.
 * 가이드 원문(templates/egovframe_guide — git 서브모듈)이 체크아웃되어 있으면 전체 문서로도 확인한다.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseFrontMatter } from "../../src/rag/guideManager.js";
import { REPO_ROOT } from "../integration/_helper.js";

const doc = (...lines: string[]) => lines.join("\n");

describe("parseFrontMatter", () => {
  it("기본 형식: 최상위 키와 본문을 나눈다", () => {
    const { frontmatter, body } = parseFrontMatter(
      doc(
        "---",
        "title: Transaction 서비스",
        'linkTitle: "Transaction"',
        "description: Spring 트랜잭션 서비스를 설명한다.",
        "url: /egovframe-runtime/persistence-layer/transaction/",
        "menu:",
        "    depth:",
        "        name: Transaction",
        "        weight: 9",
        '        parent: "persistence-layer"',
        "---",
        "# Transaction 서비스",
        "",
        "## 개요",
      ),
    );
    expect(frontmatter.title).toBe("Transaction 서비스");
    expect(frontmatter.linkTitle).toBe("Transaction");
    expect(frontmatter.description).toBe("Spring 트랜잭션 서비스를 설명한다.");
    expect(frontmatter.url).toBe("/egovframe-runtime/persistence-layer/transaction/");
    expect(body).toBe("# Transaction 서비스\n\n## 개요");
  });

  it("프론트매터가 없는 문서는 본문 전체를 그대로 돌려준다", () => {
    const content = "# 표준프레임워크 실행환경 가이드\n\n## 실행환경\n";
    expect(parseFrontMatter(content)).toEqual({ frontmatter: { title: "" }, body: content });
  });

  it("title 이 없으면 linkTitle 을 제목으로 쓴다", () => {
    expect(parseFrontMatter(doc("---", 'linkTitle: "개요"', "---", "본문")).frontmatter.title).toBe("개요");
  });

  it("블록 전체가 들여쓰기된 문서도 최상위 키를 읽는다", () => {
    const { frontmatter, body } = parseFrontMatter(
      doc(
        "---",
        "  title: Basic 로그",
        "  linkTitle: Basic 로그",
        '  description: "JDK 의 Logger 로 로그를 남긴다."',
        "  url: /common-component/elementary-technology/new-components-v3.2/basiclog/",
        "  menu:",
        "    depth:",
        "      name: Basic 로그",
        "      weight: 10",
        '      parent: "new-components-v3.2"',
        '      identifier: "basiclog"',
        "---",
        "",
        "# 요소기술 - Basic 로그",
      ),
    );
    expect(frontmatter.title).toBe("Basic 로그");
    expect(frontmatter.description).toBe("JDK 의 Logger 로 로그를 남긴다.");
    expect(frontmatter.url).toBe("/common-component/elementary-technology/new-components-v3.2/basiclog/");
    expect(body).toBe("\n# 요소기술 - Basic 로그");
  });

  it("중첩된 menu 하위 키는 최상위 키를 덮어쓰지 않는다", () => {
    const { frontmatter } = parseFrontMatter(
      doc(
        "---",
        "  menu:",
        "    depth:",
        "      title: 메뉴에 쓰는 제목",
        "      url: /menu/only/",
        "      draft: true",
        "  title: 문서 제목",
        "  url: /real/url/",
        "---",
        "본문",
      ),
    );
    expect(frontmatter.title).toBe("문서 제목");
    expect(frontmatter.url).toBe("/real/url/");
    expect(frontmatter.draft).toBe(false);
  });

  it("최상위 키가 없으면 중첩 키의 값을 대신 쓰지 않는다", () => {
    const { frontmatter } = parseFrontMatter(
      doc("---", "menu:", "  depth:", "    title: 메뉴 제목", "    url: /menu/", "---", "본문"),
    );
    expect(frontmatter.title).toBe("");
    expect(frontmatter.url).toBeUndefined();
  });

  it("같은 키가 여러 번 나오면 처음 것을 쓴다", () => {
    const { frontmatter } = parseFrontMatter(
      doc("---", "title: 첫 번째", "url: /first/", "title: 두 번째", "url: /second/", "---", "본문"),
    );
    expect(frontmatter.title).toBe("첫 번째");
    expect(frontmatter.url).toBe("/first/");
  });

  it("CRLF 문서도 프론트매터를 읽고, 본문에 YAML 블록이나 CR 이 남지 않는다", () => {
    const { frontmatter, body } = parseFrontMatter(
      [
        "---",
        "title: 공통컴포넌트",
        'linkTitle: "공통컴포넌트"',
        "url: /common-component/",
        "menu:",
        "  main:",
        '    name: "공통컴포넌트"',
        "---",
        "# 공통컴포넌트",
        "",
        "공통컴포넌트는 재사용성을 극대화한다.",
      ].join("\r\n"),
    );
    expect(frontmatter.title).toBe("공통컴포넌트");
    expect(frontmatter.url).toBe("/common-component/");
    expect(body).toBe("# 공통컴포넌트\n\n공통컴포넌트는 재사용성을 극대화한다.");
    expect(body).not.toContain("\r");
    expect(body).not.toContain("linkTitle");
  });

  it("프론트매터가 없는 CRLF 문서의 본문도 LF 로 맞춘다", () => {
    expect(parseFrontMatter("# 제목\r\n\r\n본문\r\n").body).toBe("# 제목\n\n본문\n");
  });

  it("콜론 앞에 공백이 있는 키도 읽는다", () => {
    const { frontmatter } = parseFrontMatter(
      doc(
        "---",
        "title : View",
        "url : /egovframe-runtime/presentation-layer/web-servlet-view/",
        "---",
        "# View",
      ),
    );
    expect(frontmatter.title).toBe("View");
    expect(frontmatter.url).toBe("/egovframe-runtime/presentation-layer/web-servlet-view/");

    const quoted = parseFrontMatter(doc("---", 'url : "/egovframe-runtime/ioc-container/"', "---", "본문"));
    expect(quoted.frontmatter.url).toBe("/egovframe-runtime/ioc-container/");
  });

  it("값을 감싼 큰따옴표를 벗기고, 값 안의 큰따옴표 때문에 키를 버리지 않는다", () => {
    const { frontmatter } = parseFrontMatter(
      doc(
        "---",
        'title: "MyBatis 적용 가이드"',
        'linkTitle: Hello world"',
        'description: 이 문서는 "Inversion of Control" 글을 번역한 내용이다.',
        "---",
        "본문",
      ),
    );
    expect(frontmatter.title).toBe("MyBatis 적용 가이드");
    expect(frontmatter.linkTitle).toBe("Hello world");
    expect(frontmatter.description).toBe('이 문서는 "Inversion of Control" 글을 번역한 내용이다.');
  });

  it("draft 값을 읽는다", () => {
    const draftOf = (...lines: string[]) => parseFrontMatter(doc("---", ...lines, "---", "본문")).frontmatter.draft;
    expect(draftOf("draft: true", "title: 운영 가이드")).toBe(true);
    expect(draftOf("title: MongoDB support", "draft: true")).toBe(true);
    expect(draftOf("  draft : True", "  title: 들여쓴 문서")).toBe(true);
    expect(draftOf("draft: false", "title: 게시된 문서")).toBe(false);
    expect(draftOf("title: draft 키가 없는 문서")).toBe(false);
    expect(parseFrontMatter("# 프론트매터 없는 문서").frontmatter.draft).toBeUndefined();
  });
});

/** 가이드 원문 디렉토리 (git 서브모듈 — 체크아웃되어 있지 않으면 비어 있다) */
const GUIDE_SOURCE_DIR = path.join(REPO_ROOT, "templates", "egovframe_guide");

function collectMarkdown(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== ".git" && entry.name !== ".github" && entry.name !== "images") collectMarkdown(full, out);
    } else if (entry.name.endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

const GUIDE_FILES = collectMarkdown(GUIDE_SOURCE_DIR);

describe.skipIf(GUIDE_FILES.length === 0)("parseFrontMatter — 가이드 원문 전체", () => {
  /**
   * 프론트매터 블록(--- 사이)에서 가장 바깥 들여쓰기의 줄(최상위 키)만 돌려준다. 블록이 없으면 null.
   */
  function yamlBlock(raw: string): string[] | null {
    const lines = raw.replace(/\r\n/g, "\n").split("\n");
    if (lines[0].trim() !== "---") return null;
    const end = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
    if (end < 0) return null;

    const indentOf = (line: string) => line.length - line.trimStart().length;
    const block = lines.slice(1, end).filter((line) => line.trim() !== "");
    const outermost = Math.min(...block.map(indentOf));
    return block.filter((line) => indentOf(line) === outermost);
  }

  it("블록에 title / url 키가 있는 문서는 모두 그 값을 읽는다", () => {
    const missed: string[] = [];
    let withTitle = 0;
    let withUrl = 0;

    for (const file of GUIDE_FILES) {
      const raw = fs.readFileSync(file, "utf-8");
      const block = yamlBlock(raw);
      if (!block) continue;
      const { frontmatter, body } = parseFrontMatter(raw);
      const rel = path.relative(GUIDE_SOURCE_DIR, file);

      if (block.some((line) => /^[ \t]*title[ \t]*:[ \t]*\S/.test(line))) {
        withTitle += 1;
        if (!frontmatter.title) missed.push(`title: ${rel}`);
      }
      if (block.some((line) => /^[ \t]*url[ \t]*:[ \t]*\S/.test(line))) {
        withUrl += 1;
        if (!frontmatter.url?.startsWith("/")) missed.push(`url: ${rel}`);
      }
      if (body.startsWith("---") || body.includes("\r")) missed.push(`body: ${rel}`);
    }

    expect(withTitle).toBeGreaterThan(100);
    expect(withUrl).toBeGreaterThan(100);
    expect(missed).toEqual([]);
  });

  it("draft: true 인 문서만 draft 로 읽는다", () => {
    for (const file of GUIDE_FILES) {
      const raw = fs.readFileSync(file, "utf-8");
      const block = yamlBlock(raw);
      if (!block) continue;
      const expected = block.some((line) => /^[ \t]*draft[ \t]*:[ \t]*true[ \t]*$/i.test(line));
      expect(parseFrontMatter(raw).frontmatter.draft, path.relative(GUIDE_SOURCE_DIR, file)).toBe(expected);
    }
  });
});
