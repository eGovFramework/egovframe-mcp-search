/**
 * 가이드 원문 전체로 확인하는 청킹 성질 테스트
 *
 * 가이드 원문(git 서브모듈 templates/egovframe_guide)이 체크아웃되어 있을 때만 돈다. 원문 전체를 색인 경로와
 * 같은 판정(kb/guideIndexer 의 chunkGuideDocument)과 같은 상한(기본값)으로 나눈 결과에서 다음을 확인한다.
 *
 * - 한 절의 조각들을 순서대로 이으면 절의 본문이 그대로 나온다 (내용이 빠지거나 바뀌지 않는다).
 * - 색인에서 빠지는 글은 50자 미만인 ## 절이나 개요 전체뿐이다. 긴 절을 나눈 결과는 짧아도 빠지지 않는다.
 * - 본문에서 빠진 제목 줄(title 로 올라간 제목)의 문구는 그 문서의 어느 청크의 title 이나 content 에 있다.
 * - 조각은 스스로 읽히는 마크다운이다 (펜스의 짝, 표 머리).
 * - 임베딩 입력이 모델의 입력 창(512 토큰)에 들어간다. 실제 토큰 수는 임베딩 모델의 토크나이저가 있을 때만 센다.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { AutoTokenizer } from "@xenova/transformers";
import { parseFrontMatter } from "../../src/rag/guideManager.js";
import {
  GUIDE_CHUNK_TOKEN_BUDGET,
  GUIDE_PIECE_MIN_CHARS,
  GUIDE_SECTION_MIN_CHARS,
  chunkMarkdown,
  estimateGuideChunkTokens,
  guideSearchText,
  splitGuideSections,
  type GuideSection,
} from "../../src/rag/guideChunking.js";
import { chunkGuideDocument } from "../../src/kb/guideIndexer.js";
import { truncateEmbedInput } from "../../src/rag/embedder.js";
import { EMBEDDING_MODEL_ID } from "../../src/utils/dataPaths.js";
import { REPO_ROOT, hasEmbeddingModel } from "../integration/_helper.js";

/** 가이드 원문 디렉토리 (git 서브모듈. 체크아웃되어 있지 않으면 비어 있다) */
const GUIDE_SOURCE_DIR = path.join(REPO_ROOT, "templates", "egovframe_guide");

/** 색인 경로(kb/guideIndexer 의 collectMarkdownFiles)와 같은 규칙으로 마크다운 파일을 모은다. */
function collectMarkdown(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== ".git" && entry.name !== ".github" && entry.name !== "images") collectMarkdown(full, out);
    } else if (entry.name.endsWith(".md") && entry.name !== "README.md" && entry.name !== "how-to-write-Frontmatter.md") {
      out.push(full);
    }
  }
  return out;
}

const GUIDE_FILES = collectMarkdown(GUIDE_SOURCE_DIR);

interface GuideDocument {
  relativePath: string;
  body: string;
  sections: GuideSection[];
  chunks: NonNullable<ReturnType<typeof chunkGuideDocument>>;
}

/** 색인되는 문서(초안과 본문이 너무 짧은 문서 제외)를 기본 상한으로 나눈 결과 */
function loadDocuments(): GuideDocument[] {
  const documents: GuideDocument[] = [];
  for (const file of GUIDE_FILES) {
    const relativePath = path.relative(GUIDE_SOURCE_DIR, file).split(path.sep).join("/");
    const raw = fs.readFileSync(file, "utf-8");
    const chunks = chunkGuideDocument(raw, relativePath);
    if (!chunks) continue;
    const { frontmatter, body } = parseFrontMatter(raw);
    documents.push({ relativePath, body, sections: splitGuideSections(body, frontmatter, relativePath), chunks });
  }
  return documents;
}

const FENCE_LINE = /^\s*(`{3,}|~{3,})/;

/** 본문에서 펜스가 열린 채 끝나는지 (게이트웨이의 formatGuideContent 와 같은 규칙으로 센다). */
function endsInsideFence(content: string): boolean {
  let fence: string | null = null;
  for (const line of content.split("\n")) {
    const match = line.match(FENCE_LINE);
    if (!match) continue;
    if (fence === null) {
      fence = match[1];
    } else if (match[1][0] === fence[0] && match[1].length >= fence.length) {
      fence = null;
    }
  }
  return fence !== null;
}

/**
 * 줄마다 펜스 밖 제목 줄의 수준(1~6)을 돌려준다 (제목이 아니면 0).
 * 청킹이 본문을 읽는 규칙(여는 펜스와 같은 문자이고 길이가 같거나 긴 펜스가 닫는다)을 확인용으로 따로 짠 것이다.
 */
function headingLevelsOf(lines: string[]): number[] {
  const levels: number[] = [];
  let fence: string | null = null;
  for (const line of lines) {
    const match = line.match(FENCE_LINE);
    if (match && fence === null) {
      fence = match[1];
      levels.push(0);
    } else if (match && fence !== null && match[1][0] === fence[0] && match[1].length >= fence.length) {
      fence = null;
      levels.push(0);
    } else {
      levels.push(fence === null ? (line.match(/^(#{1,6})\s+\S/)?.[1].length ?? 0) : 0);
    }
  }
  return levels;
}

describe.skipIf(GUIDE_FILES.length === 0)("가이드 원문 전체의 청킹", () => {
  const documents = loadDocuments();
  const allSections = documents.flatMap((document) => document.sections.map((section) => ({ document, section })));
  const allChunks = documents.flatMap((document) => document.chunks);

  it("원문을 충분히 읽었다 (문서 300개 이상, 절 3,000개 이상)", () => {
    expect(documents.length).toBeGreaterThan(300);
    expect(allSections.length).toBeGreaterThan(3000);
    expect(allSections.filter(({ section }) => section.pieces.length > 1).length).toBeGreaterThan(300);
  });

  it("chunkGuideDocument 의 청크는 절의 조각을 순서대로 늘어놓은 것이다", () => {
    for (const document of documents) {
      expect(
        document.chunks.map((chunk) => chunk.content),
        document.relativePath,
      ).toEqual(document.sections.flatMap((section) => section.pieces.map((piece) => piece.content)));
    }
  });

  it("한 절의 조각들을 순서대로 이으면 절의 본문이 그대로 나온다", () => {
    const failures: string[] = [];
    for (const { document, section } of allSections) {
      const label = `${document.relativePath} | ${section.section}`;
      // 절의 본문은 문서 본문에 그대로 있다
      if (document.body.slice(section.offset, section.offset + section.body.length) !== section.body) {
        failures.push(`본문 위치: ${label}`);
        continue;
      }
      // 조각의 구간이 본문을 처음부터 끝까지 순서대로 덮고, 구간 사이에는 공백만 있다
      let position = 0;
      let rebuilt = "";
      for (const piece of section.pieces) {
        const gap = section.body.slice(position, piece.start);
        if (piece.start < position || !/^\s*$/.test(gap)) failures.push(`구간 사이: ${label}`);
        // 조각의 본문에서 다시 연 펜스·표 머리(lead)와 닫는 펜스(trail)를 빼면 원문의 구간이다
        const core = piece.content.slice(piece.lead.length, piece.content.length - piece.trail.length);
        if (!piece.content.startsWith(piece.lead) || !piece.content.endsWith(piece.trail)) failures.push(`덧붙인 부분: ${label}`);
        if (core !== section.body.slice(piece.start, piece.end)) failures.push(`구간 내용: ${label}`);
        rebuilt += gap + core;
        position = piece.end;
      }
      if (rebuilt !== section.body) failures.push(`이어 붙인 결과: ${label}`);
    }
    expect(failures).toEqual([]);
  });

  it("조각에 덧붙인 것은 원문에 있는 여는 펜스 줄, 그 펜스를 닫는 줄, 표의 머리 행과 구분 행뿐이다", () => {
    const failures: string[] = [];
    for (const { document, section } of allSections) {
      const label = `${document.relativePath} | ${section.section}`;
      for (const piece of section.pieces) {
        // 이 조각보다 앞에 있는 원문의 줄들 (절의 첫 줄은 들여쓰기가 잘려 있으므로 문서 본문에서 읽는다)
        const before = document.body.slice(0, section.offset + piece.start).split("\n");
        if (piece.lead !== "") {
          const leadLines = piece.lead.split("\n");
          // lead 는 줄바꿈으로 끝나는 한 줄(펜스) 또는 두 줄(표 머리)이고, 그 줄들은 이 조각보다 앞의 원문에 이어서 나온다
          const lines = leadLines.slice(0, -1);
          const isFence = lines.length === 1 && FENCE_LINE.test(lines[0]);
          const isTableHead = lines.length === 2 && lines[0].includes("|") && /^[\s|:-]+$/.test(lines[1]);
          const inSource = before.some((_, i) => lines.every((line, k) => before[i + k] === line));
          if (leadLines.at(-1) !== "" || !(isFence || isTableHead) || !inSource) failures.push(`lead: ${label}`);
        }
        if (piece.trail !== "" && !/^\n\s*(`{3,}|~{3,})$/.test(piece.trail)) failures.push(`trail: ${label}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("코드 블록을 나눈 조각은 펜스의 짝이 맞는다", () => {
    // 원문이 펜스를 닫지 않은 절은 마지막 조각도 열린 채 끝나므로, 본문의 짝이 맞는 절만 본다
    const balanced = allSections.filter(({ section }) => !endsInsideFence(section.body));
    expect(balanced.length).toBeGreaterThan(allSections.length * 0.99);
    const open = balanced
      .flatMap(({ document, section }) => section.pieces.map((piece) => ({ document, section, piece })))
      .filter(({ piece }) => endsInsideFence(piece.content))
      .map(({ document, section }) => `${document.relativePath} | ${section.section}`);
    expect(open).toEqual([]);
  });

  it("색인에서 빠지는 글은 50자 미만인 ## 절이나 개요 전체뿐이고, 본문에서 빠진 제목 줄의 문구는 그 문서의 청크에 있다", () => {
    const lostText: string[] = [];
    const lostHeadings: string[] = [];
    let droppedSections = 0;
    let liftedHeadings = 0;
    for (const document of documents) {
      const lines = document.body.split("\n");
      const levels = headingLevelsOf(lines);
      const starts: number[] = [];
      let offset = 0;
      for (const line of lines) {
        starts.push(offset);
        offset += line.length + 1;
      }
      // 절의 본문(색인된 구간)이 덮는 글자. 절은 문서의 순서대로 나오고 서로 겹치지 않는다
      const covered = new Uint8Array(document.body.length + 1);
      let position = 0;
      for (const section of document.sections) {
        expect(section.offset, document.relativePath).toBeGreaterThanOrEqual(position);
        covered.fill(1, section.offset, section.offset + section.body.length);
        position = section.offset + section.body.length;
      }
      /** 줄의 글(앞뒤 공백 제외)이 색인된 구간 안에 있는지 */
      const isCovered = (index: number) => {
        const line = lines[index];
        const first = starts[index] + (line.length - line.trimStart().length);
        const last = starts[index] + line.trimEnd().length - 1;
        return covered[first] === 1 && covered[last] === 1;
      };
      const phraseOf = (index: number) => lines[index].replace(/^#{1,6}\s+/, "").trim();

      // 개요(첫 ## 앞)와 ## 절마다 본다
      const h2 = levels.flatMap((level, index) => (level === 2 ? [index] : []));
      const ranges = [
        { head: -1, from: 0, to: h2[0] ?? lines.length },
        ...h2.map((head, k) => ({ head, from: head + 1, to: h2[k + 1] ?? lines.length })),
      ];
      for (const range of ranges) {
        const content: number[] = [];
        for (let index = range.from; index < range.to; index++) {
          if (lines[index].trim() !== "") content.push(index);
        }
        // 개요의 맨 앞에 있는 # 줄(문서 제목)은 색인하지 않는다
        if (range.head < 0 && content.length > 0 && (levels[content[0]] === 1 || /^#\s*$/.test(lines[content[0]]))) {
          content.shift();
        }
        const label = `${document.relativePath}:${range.head + 1}`;
        if (!content.some(isCovered)) {
          // 절 전체가 색인에서 빠졌다: 50자 미만이어야 한다
          if (content.length === 0) continue;
          const last = content[content.length - 1];
          const text = document.body.slice(starts[content[0]], starts[last] + lines[last].length).trim();
          droppedSections += 1;
          if (text.length >= GUIDE_SECTION_MIN_CHARS) lostText.push(`${label} 절 전체 ${text.length}자`);
          continue;
        }
        // 색인된 절에서 본문에 없는 줄은 title 로 올라간 제목 줄(### 이하)뿐이다
        for (const index of content) {
          if (isCovered(index)) continue;
          if (levels[index] < 3) {
            lostText.push(`${document.relativePath}:${index + 1} ${JSON.stringify(lines[index].slice(0, 60))}`);
            continue;
          }
          liftedHeadings += 1;
          const phrase = phraseOf(index);
          if (!document.chunks.some((chunk) => chunk.title.includes(phrase) || chunk.content.includes(phrase))) {
            lostHeadings.push(`${document.relativePath}:${index + 1} ${JSON.stringify(lines[index].slice(0, 60))}`);
          }
        }
        // ## 제목의 문구는 그 절에서 나온 청크의 title 에 있다
        if (range.head >= 0 && !document.chunks.some((chunk) => chunk.title.includes(phraseOf(range.head)))) {
          lostHeadings.push(`${label} ${JSON.stringify(lines[range.head].slice(0, 60))}`);
        }
      }
    }
    expect(lostText).toEqual([]);
    expect(lostHeadings).toEqual([]);
    // 원문에 두 경우가 실제로 있다 (한 줄짜리 참고자료 절, 긴 절을 나눈 제목)
    expect(droppedSections).toBeGreaterThan(10);
    expect(liftedHeadings).toBeGreaterThan(1000);
  });

  it("조각 번호: 여러 조각으로 나뉜 절에만 ' (k/n)' 이 차례대로 붙고, title 과 section 의 번호가 같다", () => {
    for (const document of documents) {
      let index = 0;
      for (const section of document.sections) {
        const count = section.pieces.length;
        for (let part = 1; part <= count; part++) {
          const chunk = document.chunks[index++];
          const suffix = count > 1 ? ` (${part}/${count})` : "";
          expect(chunk.title, document.relativePath).toBe(`${section.title}${suffix}`);
          expect(chunk.section, document.relativePath).toBe(`${section.section}${suffix}`);
        }
      }
      expect(index).toBe(document.chunks.length);
    }
  });

  it("여러 조각으로 나뉜 절의 section 은 한 문서 안에서 하나뿐이다 (조각 번호로 이웃 조각을 가릴 수 있다)", () => {
    const duplicated: string[] = [];
    let marked = 0;
    for (const document of documents) {
      const seen = new Set<string>();
      for (const section of document.sections) {
        if (section.pieces.length < 2) continue;
        if (seen.has(section.section)) duplicated.push(`${document.relativePath}: ${section.section}`);
        seen.add(section.section);
        if (/ \[\d+\]$/.test(section.section)) marked += 1;
      }
    }
    expect(duplicated).toEqual([]);
    // 원문에 제목 경로가 같은 긴 절이 실제로 있다 (예: 한 절 아래의 'Sample TestCase' 소절 여러 개)
    expect(marked).toBeGreaterThan(0);
  });

  it("모든 청크의 임베딩 입력이 추정 토큰 상한 안에 든다", () => {
    const over = allChunks
      .filter((chunk) => estimateGuideChunkTokens(chunk) > GUIDE_CHUNK_TOKEN_BUDGET)
      .map((chunk) => `${chunk.source} | ${chunk.section} | ${Math.round(estimateGuideChunkTokens(chunk))}`);
    expect(over).toEqual([]);
  });

  it("나눈 조각 가운데 200자 미만인 것은 1% 미만이다", () => {
    const pieces = allSections.filter(({ section }) => section.pieces.length > 1).flatMap(({ section }) => section.pieces);
    const short = pieces.filter((piece) => piece.content.length < GUIDE_PIECE_MIN_CHARS);
    expect(short.length / pieces.length).toBeLessThan(0.01);
  });

  it("본문이 50자 미만인 청크는 없다", () => {
    expect(allChunks.filter((chunk) => chunk.content.length < GUIDE_SECTION_MIN_CHARS).map((chunk) => chunk.title)).toEqual([]);
  });

  it("색인 경로(chunkGuideDocument)는 기본 상한의 chunkMarkdown 결과를 그대로 쓴다", () => {
    for (const document of documents.slice(0, 40)) {
      const { frontmatter, body } = parseFrontMatter(fs.readFileSync(path.join(GUIDE_SOURCE_DIR, document.relativePath), "utf-8"));
      expect(chunkMarkdown(body, frontmatter, document.relativePath)).toEqual(document.chunks);
    }
  });

  it.skipIf(!hasEmbeddingModel())(
    "실제 임베딩 입력이 512 토큰 이하인 청크가 99% 이상이다",
    async () => {
      // 색인과 같은 토크나이저 (로컬 파일 전용. embedder 모듈이 경로를 설정한다)
      const tokenizer = await AutoTokenizer.from_pretrained(EMBEDDING_MODEL_ID);
      const tokenCounts = allChunks.map((chunk) => {
        // LocalEmbedder.embed 가 모델에 넘기는 문자열과 같다
        const input = `passage: ${truncateEmbedInput(guideSearchText(chunk.title, chunk.content, chunk.layer, chunk.category))}`;
        return tokenizer.encode(input).length;
      });
      const over = tokenCounts.filter((tokens) => tokens > 512).length;
      expect(tokenCounts.length).toBeGreaterThan(3000);
      expect(over / tokenCounts.length).toBeLessThan(0.01);
    },
    120_000,
  );
});
