/**
 * 가이드 문서 청킹의 분할 규칙 단위 테스트 (src/rag/guideChunking.ts)
 *
 * 임베딩 모델은 입력의 앞 512 토큰만 읽으므로, 색인 단위(청크)의 임베딩 입력이 그 안에 들어가야 한다.
 * 긴 절을 어디에서 나누는지(더 깊은 제목 → 문단 → 줄 → 줄 안), 나눈 조각이 스스로 읽히는 마크다운인지,
 * 조각 번호를 어떻게 붙이는지, 내용이 빠지지 않는지를 확인한다.
 *
 * 분할 규칙을 작은 입력으로 확인하려고 대부분 상한을 낮춰서(options) 부른다. 기본 상한에서의 동작은
 * 가이드 원문 전체로 확인한다 (guideChunkCorpus.test.ts).
 */
import { describe, it, expect } from "vitest";
import { chunkMarkdown as chunkMarkdownFromManager } from "../../src/rag/guideManager.js";
import {
  GUIDE_CHUNK_TOKEN_BUDGET,
  GUIDE_PIECE_MIN_CHARS,
  chunkMarkdown,
  estimateGuideChunkTokens,
  estimateTokens,
  guideSearchText,
  splitGuideSections,
  type GuideChunkOptions,
  type GuideSection,
} from "../../src/rag/guideChunking.js";

const FRONTMATTER = { title: "캐시 가이드", url: "/egovframe-runtime/foundation-layer/cache/" };
const DOC_PATH = "egovframe-runtime/foundation-layer/cache.md";

/** 작은 입력으로 분할을 일으키는 상한. 제목 등을 뺀 본문 몫은 추정 토큰 120 남짓이다 */
const SMALL: GuideChunkOptions = { tokenBudget: 160, minPieceChars: 40 };

const chunk = (body: string, options: GuideChunkOptions = SMALL) => chunkMarkdown(body, FRONTMATTER, DOC_PATH, options);
const sections = (body: string, options: GuideChunkOptions = SMALL) =>
  splitGuideSections(body, FRONTMATTER, DOC_PATH, options);

/** 문장마다 번호가 달라, 어느 문장이 어느 조각에 들어갔는지 알 수 있는 문단 (문장 하나는 추정 토큰 9 남짓) */
const paragraph = (label: string, sentences: number) =>
  Array.from({ length: sentences }, (_, i) => `${label} 문단의 ${i + 1}번째 문장입니다.`).join(" ");

const doc = (...lines: string[]) => lines.join("\n");

/** 펜스 줄(``` 또는 ~~~)의 수. 스스로 읽히는 조각이면 짝수다 */
const fenceLines = (content: string) => content.split("\n").filter((line) => /^\s*(`{3,}|~{3,})/.test(line)).length;

/**
 * 한 절의 조각들이 절의 본문을 빠짐없이 덮는지 확인한다.
 * 조각의 본문은 lead + (절 본문의 구간) + trail 이고, 구간과 구간 사이에는 공백만 있어야 한다.
 */
function expectLossless(section: GuideSection): void {
  let position = 0;
  for (const piece of section.pieces) {
    expect(section.body.slice(position, piece.start)).toMatch(/^\s*$/);
    expect(piece.content).toBe(piece.lead + section.body.slice(piece.start, piece.end) + piece.trail);
    expect(piece.end).toBeGreaterThan(piece.start);
    position = piece.end;
  }
  expect(section.pieces[0].start).toBe(0);
  expect(position).toBe(section.body.length);
}

describe("estimateTokens — 임베딩 모델 없이 토큰 수를 어림한다", () => {
  it("빈 문자열과 공백은 0 이다", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("  \n\t \r\n")).toBe(0);
  });

  it("공백의 양은 결과에 영향이 없다 (들여쓰기나 표의 칸 맞춤은 토큰이 되지 않는다)", () => {
    expect(estimateTokens("캐시    설정\n\n\n   방법")).toBe(estimateTokens("캐시 설정 방법"));
    expect(estimateTokens("| a     | b     |")).toBe(estimateTokens("| a | b |"));
  });

  it("공백으로 이어 붙인 문자열의 값은 각 문자열 값의 합이다", () => {
    const a = "전자정부 표준프레임워크 실행환경";
    const b = '<bean id="dataSource" class="org.apache.commons.dbcp.BasicDataSource"/>';
    expect(estimateTokens(`${a}\n${b}`)).toBeCloseTo(estimateTokens(a) + estimateTokens(b), 6);
  });

  it("구분선에 쓰는 기호(- = _ .)가 길게 이어지면 길이만큼 늘지 않는다 (표의 구분 행, 수평선)", () => {
    // 토크나이저는 이런 기호가 이어진 구간을 16자에 토큰 하나꼴로 센다
    for (const ch of ["-", "=", "_", "."]) {
      expect(estimateTokens(ch.repeat(120)), ch).toBeLessThan(12);
      expect(estimateTokens(ch.repeat(120)), ch).toBeGreaterThan(estimateTokens(ch.repeat(60)));
    }
    // 짧은 구간과 다른 글자는 글자마다 센다
    expect(estimateTokens("| --- | --- |")).toBeCloseTo(5 * 0.55 + 9 * 0.5, 6);
    expect(estimateTokens("|".repeat(120))).toBeGreaterThan(50);
    expect(estimateTokens("가".repeat(120))).toBeGreaterThan(50);
    expect(estimateTokens("-=".repeat(60))).toBeGreaterThan(50);
  });

  it("같은 글자 수라면 숫자와 기호가 한글이나 영문보다 토큰을 많이 쓴다", () => {
    expect(estimateTokens("1234567890")).toBeGreaterThan(estimateTokens("가나다라마바사아자차"));
    expect(estimateTokens("<>{}[]()=;")).toBeGreaterThan(estimateTokens("abcdefghij"));
    expect(estimateTokens("가나다라마바사아자차")).toBeGreaterThan(estimateTokens("abcdefghij"));
  });
});

describe("chunkMarkdown — 상한 안에 드는 절은 나누지 않고 한 청크로 둔다", () => {
  const body = doc(
    "# 캐시 가이드",
    "",
    paragraph("개요", 6),
    "",
    "## 설정",
    "",
    paragraph("설정", 3),
    "",
    "### 캐시 이름",
    "",
    paragraph("이름", 3),
  );

  it("절 안의 더 깊은 제목은 본문에 그대로 두고, title 과 section 에 조각 번호를 붙이지 않는다", () => {
    const chunks = chunk(body);
    expect(chunks.map((c) => [c.title, c.section])).toEqual([
      ["캐시 가이드", "개요"],
      ["캐시 가이드: 설정", "설정"],
    ]);
    expect(chunks[0].content).toBe(paragraph("개요", 6));
    expect(chunks[1].content).toBe([paragraph("설정", 3), "", "### 캐시 이름", "", paragraph("이름", 3)].join("\n"));
  });

  it("기본 상한에서도 같다", () => {
    expect(chunkMarkdown(body, FRONTMATTER, DOC_PATH)).toEqual(chunk(body));
  });

  it("guideManager 가 내보내는 chunkMarkdown 과 같은 함수다", () => {
    expect(chunkMarkdownFromManager).toBe(chunkMarkdown);
  });
});

describe("chunkMarkdown — 모든 청크의 임베딩 입력이 상한 안에 든다", () => {
  const longBody = doc(
    "# 캐시 가이드",
    "",
    paragraph("개요", 30),
    "",
    "## 설정",
    "",
    ...Array.from({ length: 12 }, (_, i) => [paragraph(`설정${i}`, 4), ""]).flat(),
    "### 만료",
    "",
    "```xml",
    ...Array.from({ length: 60 }, (_, i) => `    <cache name="cache${i}" maxElementsInMemory="${1000 + i}" eternal="false" />`),
    "```",
    "",
    "| 속성 | 설명 |",
    "| --- | --- |",
    ...Array.from({ length: 40 }, (_, i) => `| property${i} | ${i}번째 속성에 대한 설명입니다. |`),
  );

  it("낮춘 상한을 넘는 청크가 없다", () => {
    const chunks = chunk(longBody);
    expect(chunks.length).toBeGreaterThan(10);
    for (const c of chunks) {
      expect(estimateGuideChunkTokens(c), c.title).toBeLessThanOrEqual(SMALL.tokenBudget!);
    }
  });

  it("기본 상한(GUIDE_CHUNK_TOKEN_BUDGET)을 넘는 청크가 없다", () => {
    const chunks = chunkMarkdown(longBody, FRONTMATTER, DOC_PATH);
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) {
      expect(estimateGuideChunkTokens(c), c.title).toBeLessThanOrEqual(GUIDE_CHUNK_TOKEN_BUDGET);
    }
  });

  it("한 청크에 들어가는 절은 나누지 않는다 (조각 번호가 붙을 자리를 미리 떼어 두지 않는다)", () => {
    // 임베딩 입력이 상한에 가깝지만 넘지 않는 절. 조각으로 나눌 때는 조각 번호가 붙을 여유분을 본문 몫에서 빼는데,
    // 그 몫보다는 큰 크기다 (나눌지 정할 때도 여유분을 빼면 이 절은 둘로 나뉜다)
    const chunks = chunk(doc("## 설정", "", paragraph("설정", 13)));
    expect(chunks.map((c) => c.section)).toEqual(["설정"]);
    expect(estimateGuideChunkTokens(chunks[0])).toBeLessThanOrEqual(SMALL.tokenBudget!);
    expect(estimateGuideChunkTokens(chunks[0])).toBeGreaterThan(SMALL.tokenBudget! - 10);
  });

  it("상한은 본문만이 아니라 제목과 분류를 붙인 임베딩 입력 전체에 적용한다", () => {
    const c = chunk(longBody)[0];
    expect(estimateGuideChunkTokens(c)).toBeCloseTo(
      estimateTokens(`passage: ${guideSearchText(c.title, c.content, c.layer, c.category)}`),
      6,
    );
    expect(guideSearchText("제목", "본문", "layer", "category")).toBe("제목: 제목\n내용: 본문\n분류: layer\n카테고리: category");
    expect(guideSearchText("제목", "본문", "layer", "")).toBe("제목: 제목\n내용: 본문\n분류: layer");
  });
});

describe("chunkMarkdown — 긴 절은 더 깊은 제목에서 먼저 나눈다", () => {
  const body = doc(
    "## 설정",
    "",
    paragraph("설정", 6),
    "",
    "### 캐시",
    "",
    paragraph("캐시", 8),
    "",
    "### 세션",
    "",
    paragraph("세션", 6),
    "",
    "#### 만료",
    "",
    paragraph("만료", 7),
    "",
    "#### 복제",
    "",
    paragraph("복제", 7),
  );

  it("제목 경로를 title 과 section 에 넣고, 나뉜 제목 줄은 본문에서 뺀다", () => {
    const chunks = chunk(body);
    expect(chunks.map((c) => [c.title, c.section])).toEqual([
      ["캐시 가이드: 설정", "설정"],
      ["캐시 가이드: 설정 > 캐시", "설정 > 캐시"],
      ["캐시 가이드: 설정 > 세션", "설정 > 세션"],
      ["캐시 가이드: 설정 > 세션 > 만료", "설정 > 세션 > 만료"],
      ["캐시 가이드: 설정 > 세션 > 복제", "설정 > 세션 > 복제"],
    ]);
    expect(chunks.map((c) => c.content)).toEqual([
      paragraph("설정", 6),
      paragraph("캐시", 8),
      paragraph("세션", 6),
      paragraph("만료", 7),
      paragraph("복제", 7),
    ]);
  });

  it("한 청크에 들어가는 소절은 그 안의 더 깊은 제목에서 나누지 않는다", () => {
    const chunks = chunk(
      doc("## 설정", "", paragraph("설정", 8), "", "### 세션", "", paragraph("세션", 3), "", "#### 만료", "", paragraph("만료", 3)),
    );
    expect(chunks.map((c) => c.section)).toEqual(["설정", "설정 > 세션"]);
    expect(chunks[1].content).toBe([paragraph("세션", 3), "", "#### 만료", "", paragraph("만료", 3)].join("\n"));
  });

  it("줄 끝이 CRLF 인 본문에서도 제목과 코드 블록을 같은 자리에서 알아본다", () => {
    const withCode = doc(body, "", "## 실행", "", "```bash", "## 주석", "run", "```", "", paragraph("실행", 6));
    const crlf = chunk(withCode.replace(/\n/g, "\r\n"));
    expect(crlf.map((c) => [c.title, c.section])).toEqual(chunk(withCode).map((c) => [c.title, c.section]));
    expect(crlf.map((c) => c.content.replace(/\r\n/g, "\n"))).toEqual(chunk(withCode).map((c) => c.content));
  });

  it("제목 수준을 건너뛴 문서는 그 절에 있는 가장 얕은 제목에서 나눈다", () => {
    const chunks = chunk(
      doc("## 설정", "", paragraph("설정", 6), "", "#### 캐시", "", paragraph("캐시", 8), "", "##### 만료", "", paragraph("만료", 8), "", "#### 세션", "", paragraph("세션", 8)),
    );
    expect(chunks.map((c) => c.section)).toEqual(["설정", "설정 > 캐시", "설정 > 캐시 > 만료", "설정 > 세션"]);
  });

  it("## 앞의 내용(개요)이 길면 그 안의 제목에서 나눈다 (section 은 '개요 > 제목', title 은 '문서: 제목')", () => {
    const chunks = chunk(
      doc("# 캐시 가이드", "", paragraph("개요", 6), "", "### 배경", "", paragraph("배경", 8), "", "### 범위", "", paragraph("범위", 8), "", "## 설정", "", paragraph("설정", 6)),
    );
    expect(chunks.map((c) => [c.title, c.section])).toEqual([
      ["캐시 가이드", "개요"],
      ["캐시 가이드: 배경", "개요 > 배경"],
      ["캐시 가이드: 범위", "개요 > 범위"],
      ["캐시 가이드: 설정", "설정"],
    ]);
  });
});

describe("chunkMarkdown — 제목이 없으면 문단, 그다음 줄 경계에서 나눈다", () => {
  it("빈 줄로 구분된 문단 경계에서 나누고 문단을 쪼개지 않는다", () => {
    const paragraphs = ["가", "나", "다", "라"].map((label) => paragraph(label, 5));
    const chunks = chunk(doc("## 설정", "", ...paragraphs.flatMap((p) => [p, ""])));
    expect(chunks.map((c) => c.content)).toEqual([
      [paragraphs[0], paragraphs[1]].join("\n\n"),
      [paragraphs[2], paragraphs[3]].join("\n\n"),
    ]);
  });

  it("조각의 크기를 고르게 맞춘다 (앞 조각을 가득 채우고 마지막 조각만 짧게 남기지 않는다)", () => {
    // 문단 여섯 개: 한 조각에 넷까지 들어가므로 앞에서부터 채우면 4 + 2 가 되지만, 조각 수가 같으면 3 + 3 으로 나눈다
    const paragraphs = ["가", "나", "다", "라", "마", "바"].map((label) => paragraph(label, 3));
    const chunks = chunk(doc("## 설정", "", ...paragraphs.flatMap((p) => [p, ""])));
    expect(chunks.map((c) => c.content)).toEqual([
      paragraphs.slice(0, 3).join("\n\n"),
      paragraphs.slice(3).join("\n\n"),
    ]);
  });

  it("문단 경계에서 끊을 수 있으면 문단 안의 줄에서 끊지 않는다 (조각의 크기가 덜 고르더라도)", () => {
    // 4줄 문단과 13줄 문단: 가운데 줄에서 끊으면 크기가 고르지만 긴 문단이 쪼개진다
    const line = (label: string, i: number) => `${label} 목록의 ${i + 1}번째 줄입니다.`;
    const short = Array.from({ length: 4 }, (_, i) => line("앞", i));
    const long = Array.from({ length: 13 }, (_, i) => line("뒤", i));
    const chunks = chunk(doc("## 설정", "", ...short, "", ...long));
    expect(chunks.map((c) => c.content)).toEqual([short.join("\n"), long.join("\n")]);
  });

  it("한 문단이 상한보다 길면 그 문단만 줄 경계에서 나눈다", () => {
    const lines = Array.from({ length: 24 }, (_, i) => `- 항목 ${i + 1}: 목록의 ${i + 1}번째 줄입니다.`);
    const chunks = chunk(doc("## 설정", "", paragraph("도입", 2), "", ...lines));
    expect(chunks.length).toBeGreaterThan(1);
    // 모든 줄이 어느 한 조각에 온전히 들어 있다
    for (const line of lines) {
      expect(chunks.filter((c) => c.content.split("\n").includes(line)), line).toHaveLength(1);
    }
    expect(chunks[0].content.startsWith(paragraph("도입", 2))).toBe(true);
  });

  it("한 줄이 상한보다 길 때만 줄 안에서 나누고, 문장이 끝나는 자리를 고른다", () => {
    const longLine = paragraph("긴줄", 30);
    const chunks = chunk(doc("## 설정", "", longLine));
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.content.startsWith("긴줄 문단의")).toBe(true);
      expect(c.content.endsWith("문장입니다.")).toBe(true);
      expect(estimateGuideChunkTokens(c)).toBeLessThanOrEqual(SMALL.tokenBudget!);
    }
    expect(chunks.map((c) => c.content).join(" ")).toBe(longLine);
  });

  it("공백이 없는 긴 줄도 상한 안의 조각으로 나누고 글자를 잃지 않는다", () => {
    const longWord = "가나다라마바사아자차".repeat(60);
    const chunks = chunk(doc("## 설정", "", longWord));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.content).join("")).toBe(longWord);
    for (const c of chunks) {
      expect(estimateGuideChunkTokens(c)).toBeLessThanOrEqual(SMALL.tokenBudget!);
    }
  });

  it("줄 안에서 나눌 때 서로게이트 쌍(이모지)을 쪼개지 않는다", () => {
    const emojiLine = "😀".repeat(400);
    const chunks = chunk(doc("## 설정", "", emojiLine));
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.content).toMatch(/^(?:😀)+$/u);
    }
    expect(chunks.map((c) => c.content).join("")).toBe(emojiLine);
  });
});

describe("chunkMarkdown — 코드 블록을 나눈 조각은 펜스를 닫고 다시 연다", () => {
  const codeLines = Array.from({ length: 40 }, (_, i) => `    <property name="p${i}" value="${i}" />`);

  it("앞 조각의 펜스를 닫고, 뒤 조각에서 같은 언어 표기로 다시 연다", () => {
    const chunks = chunk(doc("## 설정", "", "설정 파일은 다음과 같다.", "", "```xml", ...codeLines, "```", "", "설정을 마친다."));
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) {
      expect(fenceLines(c.content) % 2, c.title).toBe(0);
    }
    expect(chunks[0].content.startsWith("설정 파일은 다음과 같다.\n\n```xml\n")).toBe(true);
    expect(chunks[0].content.endsWith("\n```")).toBe(true);
    for (const c of chunks.slice(1)) {
      expect(c.content.startsWith("```xml\n    <property")).toBe(true);
    }
    expect(chunks.at(-1)!.content.endsWith("```\n\n설정을 마친다.")).toBe(true);
    // 코드 줄은 어느 한 조각에 온전히, 들여쓰기 그대로 들어 있다
    for (const line of codeLines) {
      expect(chunks.filter((c) => c.content.split("\n").includes(line)), line).toHaveLength(1);
    }
  });

  it("코드 블록을 소개하는 문단은 되도록 그 코드 블록과 같은 조각에 둔다", () => {
    // 앞 문단, 소개 문장, 코드 블록: 소개 문장을 앞 문단 쪽에 붙이면 크기는 더 고르지만 코드 블록이 설명 없이 시작한다
    const before = paragraph("앞", 6);
    const intro = "설정 파일은 다음과 같다.";
    const block = ["```xml", ...codeLines.slice(0, 6), "```"].join("\n");
    const chunks = chunk(doc("## 설정", "", before, "", intro, "", block));
    expect(chunks.map((c) => c.content)).toEqual([before, `${intro}\n\n${block}`]);
  });

  it("소개하는 문단을 코드 블록과 함께 두려고 코드 블록을 쪼개지는 않는다", () => {
    // 소개 문단과 코드 블록을 합치면 상한을 넘는다: 코드 블록을 줄에서 끊는 대신 소개 문단을 앞 조각에 둔다
    const before = paragraph("앞", 6);
    const intro = "설정 파일은 다음과 같이 작성한다. 값은 환경에 맞게 바꾼다.";
    const block = ["```xml", ...codeLines.slice(0, 7), "```"].join("\n");
    const chunks = chunk(doc("## 설정", "", before, "", intro, "", block));
    expect(chunks.map((c) => c.content)).toEqual([`${before}\n\n${intro}`, block]);
  });

  it("여는 펜스 바로 뒤나 닫는 펜스 바로 앞에서는 나누지 않는다 (빈 코드 블록을 만들지 않는다)", () => {
    const chunks = chunk(doc("## 설정", "", paragraph("도입", 11), "", "```xml", ...codeLines.slice(0, 12), "```"));
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) {
      expect(c.content, c.title).not.toMatch(/```xml\n```/);
      expect(fenceLines(c.content) % 2, c.title).toBe(0);
    }
  });

  it("들여쓴 펜스와 ~~~ 펜스도 같은 모양으로 닫고 다시 연다", () => {
    const indented = chunk(doc("## 설정", "", "1. 다음을 실행한다.", "", "   ```bash", ...codeLines, "   ```"));
    expect(indented.length).toBeGreaterThan(1);
    expect(indented[0].content.endsWith("\n   ```")).toBe(true);
    expect(indented[1].content.startsWith("   ```bash\n")).toBe(true);

    const tilde = chunk(doc("## 설정", "", "~~~~java", ...codeLines, "~~~~"));
    expect(tilde.length).toBeGreaterThan(1);
    expect(tilde[0].content.endsWith("\n~~~~")).toBe(true);
    expect(tilde[1].content.startsWith("~~~~java\n")).toBe(true);
  });

  it("여는 펜스 줄이 조각의 큰 부분을 차지할 만큼 길면 다시 열지 않는다 (조각마다 긴 줄을 되풀이하지 않는다)", () => {
    const opener = "```java " + Array.from({ length: 8 }, (_, i) => `title${i}="값${i}"`).join(" ");
    const chunks = chunk(doc("## 설정", "", opener, ...codeLines, "```"));
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.filter((c) => c.content.includes(opener))).toHaveLength(1);
    for (const line of codeLines) {
      expect(chunks.filter((c) => c.content.split("\n").some((l) => l.trim() === line.trim())), line).toHaveLength(1);
    }
    for (const c of chunks) {
      expect(estimateGuideChunkTokens(c), c.title).toBeLessThanOrEqual(SMALL.tokenBudget!);
    }
  });

  it("끊지 않기로 한 자리끼리 묶인 줄이 상한을 넘으면 그 자리에서도 끊는다 (상한과 내용 보존이 먼저다)", () => {
    // 긴 여는 펜스 줄과 긴 첫 코드 줄: 둘을 한 조각에 두면 상한을 넘는다
    const opener = "```java " + Array.from({ length: 8 }, (_, i) => `title${i}="값${i}"`).join(" ");
    const firstLine = Array.from({ length: 12 }, (_, i) => `call${i}(arg${i});`).join(" ");
    const result = sections(doc("## 설정", "", opener, firstLine, ...codeLines.slice(0, 10), "```"));
    expect(result).toHaveLength(1);
    expect(result[0].pieces.length).toBeGreaterThan(2);
    expectLossless(result[0]);
    for (const c of chunk(doc("## 설정", "", opener, firstLine, ...codeLines.slice(0, 10), "```"))) {
      expect(estimateGuideChunkTokens(c), c.title).toBeLessThanOrEqual(SMALL.tokenBudget!);
    }
  });

  it("원문이 닫지 않은 코드 블록은 마지막 조각에서도 닫지 않는다 (원문에 없는 줄을 끝에 지어내지 않는다)", () => {
    const chunks = chunk(doc("## 설정", "", "```xml", ...codeLines));
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks.slice(0, -1)) {
      expect(c.content.endsWith("\n```")).toBe(true);
    }
    expect(chunks.at(-1)!.content.startsWith("```xml\n")).toBe(true);
    expect(chunks.at(-1)!.content.endsWith(codeLines.at(-1)!.trimEnd())).toBe(true);
  });

  it("코드 블록 안의 빈 줄은 문단 경계가 아니다 (그 자리에서 나누어도 펜스를 닫고 다시 연다)", () => {
    const blocks = Array.from({ length: 10 }, (_, i) => [`public void method${i}() {`, `    call${i}();`, "}", ""]).flat();
    const chunks = chunk(doc("## 설정", "", "```java", ...blocks, "```"));
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.content.startsWith("```java\n")).toBe(true);
      expect(c.content.endsWith("```")).toBe(true);
      expect(fenceLines(c.content)).toBe(2);
    }
  });
});

describe("chunkMarkdown — 표를 나눈 조각에는 머리 행과 구분 행을 다시 넣는다", () => {
  const head = ["| 속성 | 설명 |", "| --- | --- |"];
  const rows = Array.from({ length: 30 }, (_, i) => `| property${i} | ${i}번째 속성에 대한 설명입니다. |`);

  it("행 경계에서만 나누고, 뒤 조각은 머리 행과 구분 행으로 시작한다", () => {
    const chunks = chunk(doc("## 속성", "", "속성은 다음과 같다.", "", ...head, ...rows));
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0].content.startsWith(`속성은 다음과 같다.\n\n${head.join("\n")}\n| property0 |`)).toBe(true);
    for (const c of chunks.slice(1)) {
      expect(c.content.startsWith(`${head.join("\n")}\n| property`)).toBe(true);
    }
    for (const row of rows) {
      expect(chunks.filter((c) => c.content.split("\n").includes(row)), row).toHaveLength(1);
    }
  });

  it("표를 소개하는 문단은 되도록 그 표와 같은 조각에 둔다", () => {
    const before = paragraph("앞", 6);
    const intro = "속성은 다음과 같다.";
    const table = [...head, ...rows.slice(0, 5)].join("\n");
    const chunks = chunk(doc("## 속성", "", before, "", intro, "", table));
    expect(chunks.map((c) => c.content)).toEqual([before, `${intro}\n\n${table}`]);
  });

  it("머리 행과 구분 행 사이, 구분 행과 첫 행 사이에서는 나누지 않는다", () => {
    const chunks = chunk(doc("## 속성", "", paragraph("도입", 11), "", ...head, ...rows.slice(0, 8)));
    for (const c of chunks) {
      const lines = c.content.split("\n");
      const at = lines.indexOf(head[0]);
      if (at >= 0) {
        expect(lines[at + 1]).toBe(head[1]);
        expect(lines[at + 2]).toMatch(/^\| property/);
      }
    }
  });

  it("도입 문장과 표의 첫 행이 한 조각에 들어가지 않아도, 머리 행과 구분 행만 앞 조각에 남기지 않는다", () => {
    const wideRows = Array.from({ length: 3 }, (_, i) => `| property${i} | ${paragraph("설명", 10)} |`);
    const intro = "표의 속성은 다음과 같이 정리한다.";
    const chunks = chunk(doc("## 속성", "", intro, "", ...head, ...wideRows));
    expect(chunks.map((c) => c.content)).toEqual([
      intro,
      [...head, wideRows[0]].join("\n"),
      [...head, wideRows[1]].join("\n"),
      [...head, wideRows[2]].join("\n"),
    ]);
  });

  it("칸을 맞추느라 구분 행이 긴 표도 머리를 다시 넣고, 구분 행을 줄 안에서 자르지 않는다", () => {
    const paddedHead = [`| 속성${" ".repeat(60)} | 설명${" ".repeat(60)} |`, `| ${"-".repeat(64)} | ${"-".repeat(64)} |`];
    const chunks = chunk(doc("## 속성", "", ...paddedHead, ...rows));
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.content.startsWith(`${paddedHead.join("\n")}\n| property`), c.title).toBe(true);
    }
  });

  it("선행 | 가 없는 표도 머리를 다시 넣는다", () => {
    const chunks = chunk(doc("## 속성", "", "속성 | 설명", "---|---", ...rows.map((row) => row.slice(2, -2))));
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.content.startsWith("속성 | 설명\n---|---\n")).toBe(true);
    }
  });

  it("머리가 조각의 대부분을 차지할 만큼 크면 다시 넣지 않는다", () => {
    const wideHead = [`| ${paragraph("머리", 8)} | 설명 |`, "| --- | --- |"];
    const chunks = chunk(doc("## 속성", "", ...wideHead, ...rows));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.filter((c) => c.content.includes(wideHead[0]))).toHaveLength(1);
    for (const row of rows) {
      expect(chunks.filter((c) => c.content.split("\n").includes(row)), row).toHaveLength(1);
    }
  });
});

describe("chunkMarkdown — 코드 블록 안의 제목 모양 줄은 제목이 아니다", () => {
  it("펜스 안의 '## ' 줄에서 절을 나누지 않는다", () => {
    const body = doc(
      "## 설치",
      "",
      paragraph("설치", 3),
      "",
      "```bash",
      "## 저장소를 복제한다",
      "git clone https://example.invalid/repo.git",
      "mvn -f repo/pom.xml clean package -DskipTests",
      "```",
      "",
      "## 실행",
      "",
      paragraph("실행", 6),
    );
    const chunks = chunk(body);
    expect(chunks.map((c) => c.section)).toEqual(["설치", "실행"]);
    expect(chunks[0].content).toContain("```bash\n## 저장소를 복제한다\ngit clone");
    expect(chunks[0].content.endsWith("-DskipTests\n```")).toBe(true);
  });

  it("긴 절을 나눌 때도 펜스 안의 '### ' 줄과 '#### ' 줄은 제목으로 보지 않는다", () => {
    const body = doc(
      "## 설치",
      "",
      paragraph("설치", 8),
      "",
      "~~~bash",
      "### 의존성을 내려받는다",
      "#### 시간이 걸린다",
      "mvn dependency:resolve",
      "~~~",
      "",
      "### 확인",
      "",
      paragraph("확인", 8),
    );
    const chunks = chunk(body);
    expect(chunks.map((c) => c.section)).toEqual(["설치", "설치 > 확인"]);
    expect(chunks[0].content).toContain("### 의존성을 내려받는다\n#### 시간이 걸린다\nmvn dependency:resolve");
  });

  it("펜스보다 짧거나 종류가 다른 펜스 줄은 코드 블록을 닫지 않는다", () => {
    const body = doc("## 예제", "", paragraph("예제", 6), "", "````markdown", "```", "## 문서 안의 제목", "```", "````", "", "## 다음", "", paragraph("다음", 6));
    expect(chunk(body).map((c) => c.section)).toEqual(["예제", "다음"]);
  });
});

describe("chunkMarkdown — 조각 번호", () => {
  const paragraphs = ["가", "나", "다", "라", "마", "바"].map((label) => paragraph(label, 5));
  const longSection = paragraphs.flatMap((p) => [p, ""]);

  it("여러 조각으로 나뉜 절은 title 과 section 끝에 ' (k/n)' 을 붙인다", () => {
    const chunks = chunk(doc("## 설정", "", paragraph("설정", 6), "", "### 캐시", "", ...longSection));
    expect(chunks.map((c) => [c.title, c.section])).toEqual([
      ["캐시 가이드: 설정", "설정"],
      ["캐시 가이드: 설정 > 캐시 (1/3)", "설정 > 캐시 (1/3)"],
      ["캐시 가이드: 설정 > 캐시 (2/3)", "설정 > 캐시 (2/3)"],
      ["캐시 가이드: 설정 > 캐시 (3/3)", "설정 > 캐시 (3/3)"],
    ]);
  });

  it("긴 개요는 title 이 '문서 (k/n)', section 이 '개요 (k/n)' 이다", () => {
    const chunks = chunk(doc("# 캐시 가이드", "", ...longSection, "## 설정", "", paragraph("설정", 6)));
    expect(chunks.map((c) => [c.title, c.section])).toEqual([
      ["캐시 가이드 (1/3)", "개요 (1/3)"],
      ["캐시 가이드 (2/3)", "개요 (2/3)"],
      ["캐시 가이드 (3/3)", "개요 (3/3)"],
      ["캐시 가이드: 설정", "설정"],
    ]);
  });

  it("한 문서에서 제목 경로가 같은 절이 둘 이상 나뉘면 둘째부터 순번을 붙여 구별한다", () => {
    const chunks = chunk(
      doc("## 예제", "", ...longSection, "## 설명", "", paragraph("설명", 6), "", "## 예제", "", ...longSection.slice(0, 8), "## 예제", "", paragraph("예제", 6)),
    );
    expect(chunks.map((c) => c.section)).toEqual([
      "예제 (1/3)",
      "예제 (2/3)",
      "예제 (3/3)",
      "설명",
      "예제 [2] (1/2)",
      "예제 [2] (2/2)",
      // 나뉘지 않은 절의 title 과 section 은 그대로다
      "예제",
    ]);
    expect(chunks[4].title).toBe("캐시 가이드: 예제 [2] (1/2)");
    expect(chunks[6].title).toBe("캐시 가이드: 예제");
  });
});

describe("chunkMarkdown — 너무 작은 조각을 만들지 않는다", () => {
  it("본문이 50자 미만인 ## 절과 개요는 색인하지 않는다", () => {
    const chunks = chunk(doc("# 캐시 가이드", "", "짧은 개요", "", "## 설정", "", paragraph("설정", 6), "", "## 참고", "", "- 없음"));
    expect(chunks.map((c) => c.section)).toEqual(["설정"]);
  });

  it("짧은 절이라도 나눈 결과가 아니면 이웃 절과 합치지 않고 따로 색인한다", () => {
    // 60자는 기본 최소 조각 길이(200자)보다 짧지만, ## 절끼리는 합치지 않는다
    const short = "가".repeat(60);
    const chunks = chunkMarkdown(doc("## 하나", "", short, "", "## 둘", "", short), FRONTMATTER, DOC_PATH);
    expect(chunks.map((c) => [c.section, c.content])).toEqual([
      ["하나", short],
      ["둘", short],
    ]);
  });

  it("긴 절을 제목에서 나눌 때, 짧은 소절은 제목 줄과 함께 앞 조각에 합친다", () => {
    const chunks = chunk(
      doc("## 설정", "", paragraph("설정", 6), "", "### 캐시", "", paragraph("캐시", 8), "", "### 참고", "", "캐시는 꺼 둘 수 있다.", "", "### 세션", "", paragraph("세션", 9)),
    );
    // 합친 청크의 이름에는 합쳐진 소절의 이름이 함께 실린다 (아래의 "합친 묶음의 이름" 묶음에서 자세히 확인한다)
    expect(chunks.map((c) => c.section)).toEqual(["설정", "설정 > 캐시 / 참고", "설정 > 세션"]);
    expect(chunks[1].content).toBe([paragraph("캐시", 8), "", "### 참고", "", "캐시는 꺼 둘 수 있다."].join("\n"));
  });

  it("앞 조각이 짧으면 다음 소절을 끌어와 합친다 (도입 문장만 있는 조각을 만들지 않는다)", () => {
    const chunks = chunk(
      doc("## 설정", "", "설정은 다음과 같다.", "", "### 캐시", "", paragraph("캐시", 8), "", "### 세션", "", paragraph("세션", 9)),
    );
    expect(chunks.map((c) => c.section)).toEqual(["설정", "설정 > 세션"]);
    expect(chunks[0].content).toBe(["설정은 다음과 같다.", "", "### 캐시", "", paragraph("캐시", 8)].join("\n"));
  });

  it("합치면 상한을 넘는 짧은 소절: 50자 미만이면 다음 소절에 붙여 다시 나누고, 50자 이상이면 따로 둔다", () => {
    // 이웃 조각이 모두 상한 가까이 차 있어 한 청크로 합칠 수 없는 경우: 25자 소절은 버리지 않고 다음 소절 앞에 붙이고
    // (붙인 묶음은 조각으로 다시 나뉜다), 60자 소절은 따로 남는다
    const chunks = chunk(
      doc(
        "## 설정",
        "",
        paragraph("설정", 13),
        "",
        "### 참고",
        "",
        "캐시는 꺼 둘 수 있다. 기본값은 켜짐이다.",
        "",
        "### 세션",
        "",
        paragraph("세션", 13),
        "",
        "### 주의",
        "",
        "가".repeat(60),
        "",
        "### 복제",
        "",
        paragraph("복제", 13),
      ),
      { tokenBudget: 160, minPieceChars: 100 },
    );
    expect(chunks.map((c) => c.section)).toEqual([
      "설정",
      "설정 > 참고 / 세션 (1/2)",
      "설정 > 참고 / 세션 (2/2)",
      "설정 > 주의",
      "설정 > 복제",
    ]);
    expect(chunks[1].content.startsWith("캐시는 꺼 둘 수 있다. 기본값은 켜짐이다.\n\n### 세션\n\n세션 문단의 1번째 문장입니다.")).toBe(true);
    expect(chunks[3].content).toBe("가".repeat(60));
  });

  it("문단에서 나눈 조각이 짧게 남지 않도록 자르는 자리를 옮긴다", () => {
    // 앞의 두 문단은 한 조각에 들어가지만 셋은 들어가지 않는다. 앞에서부터 채우면 마지막 문단(50자)만 남으므로
    // 자르는 자리를 한 문단 앞으로 옮겨 짧은 조각을 만들지 않는다
    const [first, second, last] = [paragraph("앞", 6), paragraph("뒤", 7), paragraph("끝", 3)];
    expect(last.length).toBeLessThan(60);
    const chunks = chunk(doc("## 설정", "", first, "", second, "", last), { tokenBudget: 160, minPieceChars: 60 });
    expect(chunks.map((c) => c.content)).toEqual([first, [second, last].join("\n\n")]);
  });

  it("기본값: 조각은 200자 미만이면 짧다고 본다", () => {
    expect(GUIDE_PIECE_MIN_CHARS).toBe(200);
  });
});

describe("chunkMarkdown — 나눈 결과로 생긴 짧은 글과 본문 없는 제목 줄을 버리지 않는다", () => {
  /** 본문의 모든 문장(번호가 붙은 문장)이 어느 한 청크에만 들어 있는지 확인한다 */
  const expectEverySentenceOnce = (chunks: ReturnType<typeof chunk>, body: string) => {
    const sentences = body.match(/\S+ 문단의 \d+번째 문장입니다\./g) ?? [];
    expect(sentences.length).toBeGreaterThan(0);
    for (const sentence of sentences) {
      // "1번째" 가 "11번째" 에 들어 있으므로 앞뒤를 끊어서 센다
      const count = chunks.filter((c) => ` ${c.content.replace(/\n/g, " ")} `.includes(` ${sentence} `)).length;
      expect(count, sentence).toBe(1);
    }
  };

  it("50자 미만인 도입부는 첫 소절 앞에 붙인다 (한 청크에 들어가지 않으면 붙인 묶음을 조각으로 나눈다)", () => {
    const body = doc("## 설명", "", "출력 형식을 변환한다.", "", "##### 관련소스", "", paragraph("관련", 6), "", paragraph("소스", 6), "", paragraph("목록", 6));
    const chunks = chunk(body);
    // 도입부를 붙인 묶음은 소절의 내용이 조각마다 이어지므로 소절의 이름을 쓴다
    expect(chunks.map((c) => c.section)).toEqual(["설명 > 관련소스 (1/2)", "설명 > 관련소스 (2/2)"]);
    expect(chunks[0].content).toBe(["출력 형식을 변환한다.", "", "##### 관련소스", "", paragraph("관련", 6)].join("\n"));
    expect(chunks[1].content).toBe([paragraph("소스", 6), "", paragraph("목록", 6)].join("\n"));
    expectEverySentenceOnce(chunks, body);
  });

  it("긴 소절 사이의 50자 미만 소절은 다음 소절 앞에 붙이고, 두 소절의 이름을 함께 싣는다", () => {
    const body = doc(
      "## 사용법", "", "### 가", "", paragraph("가", 12), "", "### 관련 예제", "", "[Parallel 예제](./batch-example.md)", "", "### 나", "", paragraph("나", 7), "", paragraph("다", 7),
    );
    const chunks = chunk(body);
    expect(chunks.map((c) => [c.title, c.section])).toEqual([
      ["캐시 가이드: 사용법 > 가", "사용법 > 가"],
      ["캐시 가이드: 사용법 > 관련 예제 / 나 (1/2)", "사용법 > 관련 예제 / 나 (1/2)"],
      ["캐시 가이드: 사용법 > 관련 예제 / 나 (2/2)", "사용법 > 관련 예제 / 나 (2/2)"],
    ]);
    expect(chunks[1].content).toBe(["[Parallel 예제](./batch-example.md)", "", "### 나", "", paragraph("나", 7)].join("\n"));
    expect(chunks[2].content).toBe(paragraph("다", 7));
    expectEverySentenceOnce(chunks, body);
  });

  it("마지막 소절이 50자 미만이면 앞 묶음의 끝에 붙인다", () => {
    const body = doc("## 사용법", "", "### 가", "", paragraph("가", 7), "", paragraph("나", 7), "", "### 참고", "", "- [관련 예제](./example.md)");
    const chunks = chunk(body);
    expect(chunks.map((c) => c.section)).toEqual(["사용법 > 가 / 참고 (1/2)", "사용법 > 가 / 참고 (2/2)"]);
    expect(chunks[0].content).toBe(paragraph("가", 7));
    expect(chunks[1].content).toBe([paragraph("나", 7), "", "### 참고", "", "- [관련 예제](./example.md)"].join("\n"));
    expectEverySentenceOnce(chunks, body);
  });

  it("더 깊은 제목이 있는 큰 소절 앞에 붙인 짧은 소절은 그 소절의 첫 청크에 실린다", () => {
    const body = doc(
      "## 설명", "", paragraph("설명", 13), "", "### 클래스 다이어그램", "", "![그림](./images/class.png)", "",
      "### 아이디 생성", "", "#### 테이블", "", paragraph("테이블", 9), "", "#### 환경설정", "", paragraph("환경", 9),
    );
    const chunks = chunk(body);
    // 이름은 묶음에 든 제목을 차례로 잇는다: 같은 수준으로 넘어가면 ' / ', 더 깊은 제목으로 내려가면 ' > '
    expect(chunks.map((c) => c.section)).toEqual([
      "설명",
      "설명 > 클래스 다이어그램 / 아이디 생성 > 테이블",
      "설명 > 아이디 생성 > 환경설정",
    ]);
    expect(chunks[1].content).toBe(["![그림](./images/class.png)", "", "### 아이디 생성", "", "#### 테이블", "", paragraph("테이블", 9)].join("\n"));
    expectEverySentenceOnce(chunks, body);
  });

  it("본문이 없는 제목 줄은 다음 소절과 묶어 제목 경로에 싣는다", () => {
    const chunks = chunk(
      doc("## 작업 생성", "", paragraph("도입", 8), "", "##### 팩토리 빈을 이용한 작업 생성", "", "##### 소스 코드", "", paragraph("코드", 9)),
    );
    expect(chunks.map((c) => c.section)).toEqual(["작업 생성", "작업 생성 > 팩토리 빈을 이용한 작업 생성 / 소스 코드"]);
    // 본문 없는 제목은 title 로 올라가고, 다음 소절의 제목 줄은 본문의 첫 줄로 남는다
    expect(chunks[1].title).toBe("캐시 가이드: 작업 생성 > 팩토리 빈을 이용한 작업 생성 / 소스 코드");
    expect(chunks[1].content).toBe(["##### 소스 코드", "", paragraph("코드", 9)].join("\n"));
  });

  it("본문이 없는 제목 줄이 절의 마지막이면 앞 묶음의 끝에 남긴다", () => {
    const chunks = chunk(doc("## 설정", "", paragraph("설정", 8), "", "### 캐시", "", paragraph("캐시", 9), "", "### 예정"));
    expect(chunks.map((c) => c.section)).toEqual(["설정", "설정 > 캐시 / 예정"]);
    expect(chunks[1].content).toBe([paragraph("캐시", 9), "", "### 예정"].join("\n"));
  });

  it("붙인 묶음을 조각으로 나눌 때 제목 줄 바로 뒤에서는 끊지 않는다 (제목만 앞 조각 끝에 남기지 않는다)", () => {
    // 41자 소절(짧은 조각의 기준 40자보다는 길다)을 다음 소절 앞에 붙인다. 제목 줄 뒤에서 끊으면 두 조각의 크기가 더 고르지만
    // 제목이 그 내용과 떨어진다
    const note = "자세한 내용은 관련 예제 문서에 있는 설명과 그림을 함께 보면서 참고한다.";
    const items = Array.from({ length: 11 }, (_, i) => `- 나 목록의 ${i + 1}번째 항목입니다.`);
    expect(note.length).toBeGreaterThanOrEqual(SMALL.minPieceChars!);
    const chunks = chunk(doc("## 사용법", "", "### 가", "", paragraph("가", 12), "", "### 참고", "", note, "", "### 나", "", ...items));
    expect(chunks.map((c) => c.section)).toEqual(["사용법 > 가", "사용법 > 참고 / 나 (1/2)", "사용법 > 참고 / 나 (2/2)"]);
    expect(chunks[1].content).toBe(note);
    expect(chunks[2].content).toBe(["### 나", "", ...items].join("\n"));
  });

  it("붙인 묶음의 조각들도 묶음의 본문을 빠짐없이 덮는다", () => {
    const bodies = [
      doc("## 설명", "", "출력 형식을 변환한다.", "", "##### 관련소스", "", paragraph("관련", 6), "", paragraph("소스", 6), "", paragraph("목록", 6)),
      doc("## 사용법", "", "### 가", "", paragraph("가", 12), "", "### 관련 예제", "", "[Parallel 예제](./batch-example.md)", "", "### 나", "", paragraph("나", 7), "", paragraph("다", 7)),
      doc("## 사용법", "", "### 가", "", paragraph("가", 7), "", paragraph("나", 7), "", "### 참고", "", "- [관련 예제](./example.md)"),
    ];
    for (const body of bodies) {
      const result = sections(body);
      expect(result.some((section) => section.pieces.length > 1)).toBe(true);
      for (const section of result) {
        expectLossless(section);
        expect(body.slice(section.offset, section.offset + section.body.length)).toBe(section.body);
      }
      // 절과 절 사이에 남는 것은 title 로 올라간 제목 줄과 빈 줄뿐이다
      let position = 0;
      for (const section of result) {
        expect(body.slice(position, section.offset).replace(/^#{2,6}[ \t].*$/gm, "").trim()).toBe("");
        position = section.offset + section.body.length;
      }
      expect(body.slice(position).trim()).toBe("");
    }
  });
});

describe("chunkMarkdown — 합친 묶음의 이름에 합쳐진 소절을 함께 싣는다", () => {
  it("소절 뒤에 합쳐진 소절의 이름을 ' / ' 로 이어 title 과 section 에 싣는다", () => {
    const chunks = chunk(
      doc("## 설정", "", paragraph("설정", 6), "", "### 캐시", "", paragraph("캐시", 8), "", "### 참고", "", "캐시는 꺼 둘 수 있다.", "", "### 세션", "", paragraph("세션", 9)),
    );
    expect(chunks.map((c) => [c.title, c.section])).toEqual([
      ["캐시 가이드: 설정", "설정"],
      ["캐시 가이드: 설정 > 캐시 / 참고", "설정 > 캐시 / 참고"],
      ["캐시 가이드: 설정 > 세션", "설정 > 세션"],
    ]);
  });

  it("제목 수준을 건너뛴 소절끼리 합쳐도 같은 방식으로 잇는다 (예: '설명 > Input / Output')", () => {
    const chunks = chunk(
      doc("## 설명", "", paragraph("설명", 6), "", "##### Input", "", paragraph("입력", 8), "", "##### Output", "", "변환된 문자열.", "", "##### 예외", "", paragraph("예외", 9)),
    );
    expect(chunks.map((c) => c.section)).toEqual(["설명", "설명 > Input / Output", "설명 > 예외"]);
    expect(chunks[1].content).toBe([paragraph("입력", 8), "", "##### Output", "", "변환된 문자열."].join("\n"));
  });

  it("합쳐진 소절의 이름은 세 개까지 싣고, 넘는 수는 '외 N개' 로 적는다", () => {
    // 짧은 소절 다섯 개가 앞 소절에 합쳐진다. 이름을 모두 실으면 제목이 본문 몫을 줄이므로 앞의 세 개만 싣는다
    const shorts = ["등록", "수정", "삭제", "복구", "보관"].flatMap((name) => [`### ${name}`, "", `${name}한다.`, ""]);
    const chunks = chunk(doc("## API", "", "### 조회", "", paragraph("조회", 3), "", ...shorts, "### 일괄 처리", "", paragraph("일괄", 9)));
    expect(chunks.map((c) => c.section)).toEqual(["API > 조회 / 등록 / 수정 / 삭제 외 2개", "API > 일괄 처리"]);
    expect(chunks[0].title).toBe("캐시 가이드: API > 조회 / 등록 / 수정 / 삭제 외 2개");
    // 이름에 싣지 않은 소절도 제목 줄은 본문에 그대로 있다
    expect(chunks[0].content).toContain("### 복구\n\n복구한다.\n\n### 보관\n\n보관한다.");
  });

  it("절의 도입부로 시작하는 묶음은 절의 이름만 쓴다 (그 절의 첫 청크다)", () => {
    const chunks = chunk(
      doc("## 설정", "", paragraph("설정", 6), "", "### 참고", "", "캐시는 꺼 둘 수 있다.", "", "### 세션", "", paragraph("세션", 13)),
    );
    expect(chunks.map((c) => [c.title, c.section])).toEqual([
      ["캐시 가이드: 설정", "설정"],
      ["캐시 가이드: 설정 > 세션", "설정 > 세션"],
    ]);
    expect(chunks[0].content).toBe([paragraph("설정", 6), "", "### 참고", "", "캐시는 꺼 둘 수 있다."].join("\n"));
  });

  it("제목이 길어지는 만큼 본문 몫이 줄어든다 (이름을 실으면 상한을 넘는 소절은 합치지 않는다)", () => {
    const longName = "만료 시간과 최대 크기를 정하는 방법";
    const cache = paragraph("캐시", 11);
    const chunks = chunk(
      doc("## 설정", "", paragraph("설정", 6), "", "### 캐시", "", cache, "", `### ${longName}`, "", "기본값을 쓴다.", "", "### 세션", "", paragraph("세션", 9)),
    );
    // 합친 본문은 앞 소절의 이름만 쓰면 상한 안에 들지만, 합쳐진 소절의 이름까지 실으면 넘는다
    const merged = [cache, "", `### ${longName}`, "", "기본값을 쓴다."].join("\n");
    const tokensAs = (section: string) =>
      estimateGuideChunkTokens({ title: `캐시 가이드: ${section}`, content: merged, layer: "egovframe-runtime", category: "foundation-layer" });
    expect(tokensAs("설정 > 캐시")).toBeLessThanOrEqual(SMALL.tokenBudget!);
    expect(tokensAs(`설정 > 캐시 / ${longName}`)).toBeGreaterThan(SMALL.tokenBudget!);

    const cacheChunk = chunks.find((c) => c.content.startsWith(cache))!;
    expect(cacheChunk.section).toBe("설정 > 캐시");
    expect(cacheChunk.content).toBe(cache);
    for (const c of chunks) {
      expect(estimateGuideChunkTokens(c), c.title).toBeLessThanOrEqual(SMALL.tokenBudget!);
    }
  });
});

describe("splitGuideSections — 조각을 이으면 절의 본문이 그대로 나온다", () => {
  const body = doc(
    "# 캐시 가이드",
    "",
    paragraph("개요", 30),
    "",
    "## 설정",
    "",
    "  " + paragraph("들여쓴 첫 줄", 4),
    "",
    "",
    paragraph("빈 줄 두 개 뒤", 9),
    "",
    "1. 다음을 실행한다.",
    "",
    "   ```bash",
    ...Array.from({ length: 30 }, (_, i) => `   run --step ${i}   `),
    "",
    "   # 주석",
    "   ```",
    "",
    "| 속성 | 설명 |",
    "| --- | --- |",
    ...Array.from({ length: 30 }, (_, i) => `| property${i} | ${i}번째 속성에 대한 설명입니다. |`),
    "",
    paragraph("긴줄", 40),
    "",
    "### 만료",
    "",
    paragraph("만료", 20),
  );

  it("조각의 구간이 절의 본문을 순서대로 덮고, 구간 사이에는 공백만 있다", () => {
    const result = sections(body);
    expect(result.map((s) => s.section)).toEqual(["개요", "설정", "설정 > 만료"]);
    for (const section of result) {
      expect(section.pieces.length).toBeGreaterThan(1);
      expectLossless(section);
    }
  });

  it("절의 본문은 문서 본문의 offset 위치에 그대로 있다", () => {
    for (const section of sections(body)) {
      expect(body.slice(section.offset, section.offset + section.body.length)).toBe(section.body);
      expect(section.body).toBe(section.body.trim());
    }
  });

  it("조각에 덧붙인 것은 다시 연 펜스, 닫는 펜스, 표 머리뿐이다", () => {
    const setting = sections(body).find((s) => s.section === "설정")!;
    const leads = new Set(setting.pieces.map((p) => p.lead));
    const trails = new Set(setting.pieces.map((p) => p.trail));
    expect([...leads].sort()).toEqual(["", "   ```bash\n", "| 속성 | 설명 |\n| --- | --- |\n"].sort());
    expect([...trails].sort()).toEqual(["", "\n   ```"].sort());
  });

  it("조각을 겹치지 않는다 (한 구간은 한 조각에만 들어간다)", () => {
    for (const section of sections(body)) {
      for (let i = 1; i < section.pieces.length; i++) {
        expect(section.pieces[i].start).toBeGreaterThanOrEqual(section.pieces[i - 1].end);
      }
    }
  });

  it("chunkMarkdown 의 청크는 절의 조각을 순서대로 늘어놓은 것이다", () => {
    const pieces = sections(body).flatMap((s) => s.pieces.map((p) => p.content));
    expect(chunk(body).map((c) => c.content)).toEqual(pieces);
  });
});
