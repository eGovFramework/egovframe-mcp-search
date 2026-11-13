/**
 * 적용가이드 PDF 를 청크로 나눠 개발자 지식 입력으로 만드는 과정(src/scripts/buildIndex.ts) 단위 테스트
 *
 * 임베딩 모델은 입력의 앞 512 토큰만 읽는다. 청크가 그보다 길면 뒷부분은 벡터에 반영되지 않아 의미 검색으로
 * 찾을 수 없다. 그래서 청크의 임베딩 입력(제목·표지·상황·태그 포함)이 512 토큰 안에 들어가야 한다.
 * 나누는 규칙은 순수 함수(chunkPdfText)로 검증하고, 토큰 수는 동봉 PDF 와 토크나이저가 있을 때 실제 입력으로 확인한다.
 *
 * buildIndex.ts 는 직접 실행될 때만 인덱싱을 시작하므로, import 해서 함수만 불러 쓴다.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { AutoTokenizer } from "@xenova/transformers";
import {
  PDF_CHUNK_MAX_CHARS,
  PDF_CHUNK_OVERLAP_CHARS,
  TEMPLATES_DIR,
  chunkPdfText,
  pdfTextToKnowledge,
  readPdfKnowledge,
} from "../../src/scripts/buildIndex.js";
import { getEmbedder } from "../../src/rag/embedder.js";
import { DeveloperKnowledgeManager } from "../../src/rag/knowledgeManager.js";
import type { AddKnowledgeInput } from "../../src/types/knowledge.js";
import { EMBEDDING_MODEL_ID } from "../../src/utils/dataPaths.js";
import { hasEmbeddingModel } from "../integration/_helper.js";

/**
 * 한 줄이 lineLength 글자인 줄 count 개. 줄마다 번호가 달라 내용이 겹치지 않는다.
 * 번호 뒤는 같은 글자가 이어지지 않는 글자열로 채운다 (같은 글자만 이어지면 그 안의 어느 자리에서 잘랐는지 구별할 수 없다).
 */
function linesOf(label: string, count: number, lineLength: number): string[] {
  const filler = "가나다라마바사아자차카타파하".repeat(Math.ceil(lineLength / 14));
  return Array.from({ length: count }, (_, i) => `${label}${i + 1} ${filler}`.slice(0, lineLength));
}

/** 한 줄이 lineLength 글자인 줄 lineCount 개로 된 문단. */
function paragraphOfLines(label: string, lineCount: number, lineLength: number): string {
  return linesOf(label, lineCount, lineLength).join("\n");
}

/**
 * 청크를 원문에서 차례로 찾아 구간 [start, end) 로 돌려준다.
 * 겹친 청크는 앞 청크 안에서 시작하므로, 앞 청크의 시작 다음 글자부터 찾는다.
 */
function locateChunks(source: string, chunks: string[]): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  let searchFrom = 0;
  for (const chunk of chunks) {
    const start = source.indexOf(chunk, searchFrom);
    expect(start, `원문에서 찾지 못한 청크: ${JSON.stringify(chunk.slice(0, 40))}`).toBeGreaterThanOrEqual(0);
    spans.push({ start, end: start + chunk.length });
    searchFrom = start + 1;
  }
  return spans;
}

/**
 * 겹친 부분을 빼고 이으면 원문과 같은지 확인한다.
 * 청크마다 앞 청크의 끝 뒤에 오는 부분만 남겼을 때, 그 사이와 원문의 양 끝에는 공백만 남아야 하고
 * 청크마다 새로 싣는 내용이 있어야 한다.
 */
function expectChunksCoverSource(source: string, chunks: string[]): void {
  let covered = 0;
  for (const span of locateChunks(source, chunks)) {
    expect(source.slice(covered, Math.max(covered, span.start)).trim()).toBe("");
    expect(span.end).toBeGreaterThan(covered);
    covered = span.end;
  }
  expect(source.slice(covered).trim()).toBe("");
}

/** 나누는 단위(문단, 줄, 문장, 낱말, 글자)가 서로 다른 본문 */
const SAMPLE_TEXTS: Record<string, string> = {
  "짧은 문단 여러 개": Array.from({ length: 12 }, (_, i) => paragraphOfLines(`문단${i + 1}줄`, 3, 18)).join("\n\n"),
  "긴 문단 하나": paragraphOfLines("줄", 40, 24),
  "짧은 문단과 긴 문단": [
    paragraphOfLines("머리줄", 2, 16),
    paragraphOfLines("본문줄", 30, 22),
    "-- 1 of 2 --",
    paragraphOfLines("꼬리줄", 12, 31),
    "-- 2 of 2 --",
  ].join("\n\n"),
  "문장이 이어진 긴 줄": Array.from({ length: 30 }, (_, i) => `${i + 1}번 문장은 여기에서 끝난다.`).join(" "),
  "낱말만 이어진 긴 줄": Array.from({ length: 80 }, (_, i) => `낱말${i + 1}`).join(" "),
  "공백이 없는 글자열": Array.from({ length: 40 }, (_, i) => `[${i + 1}]가나다라마`).join(""),
};

/** 상한과 겹침의 조합 (겹침은 상한의 절반 이하) */
const LIMITS: Array<{ maxChars: number; overlapChars: number }> = [
  { maxChars: 20, overlapChars: 0 },
  { maxChars: 20, overlapChars: 7 },
  { maxChars: 50, overlapChars: 0 },
  { maxChars: 50, overlapChars: 25 },
  { maxChars: 137, overlapChars: 30 },
  { maxChars: 600, overlapChars: 0 },
  { maxChars: 600, overlapChars: 100 },
];

describe("chunkPdfText — 본문 정리", () => {
  it("꺾쇠로 감싼 글자를 지우지 않는다", () => {
    // PDF 본문의 꺾쇠는 HTML 태그가 아니다. 태그로 보고 지우면 "<" 부터 다음 ">" 까지가 통째로 사라진다
    const text = [
      "<Ver. 5.0>",
      "185 요소기술 포맷/계산/변환 특수문자열처리",
      "HTML 특수문자를 처리하는 기능을 제",
      "공함( '<' 문자열을 '&LT;'로, '&' 문자",
      "열을 '&amp' 로 변환하여 처리)",
      "186 요소기술 포맷/계산/변환 환율계산",
      "< 표준프레임워크 세부 적용 기준 >",
    ].join("\n");

    expect(chunkPdfText(text)).toEqual([text]);
  });

  it("HTML 엔티티와 태그 모양의 글자를 바꾸지 않는다", () => {
    const text = "A &amp; B 는 &lt;tag&gt; 와 &quot;인용&quot;, &nbsp; 를 쓴다. 줄바꿈 태그 <br> 와 <br /> 도 글자 그대로다.";

    expect(chunkPdfText(text)).toEqual([text]);
  });

  it("자모가 분리된(NFD) 글을 NFC 로 합친다", () => {
    // 색인된 본문은 응답에 그대로 실린다. Q&A 본문(cleanText)과 같은 기준으로 정규화한다
    const text = "표준프레임워크 적용가이드";

    expect(chunkPdfText(text.normalize("NFD"))).toEqual([text]);
  });

  it("공백을 정리한다: 이어진 공백과 탭은 한 칸으로, 줄바꿈은 LF 로, 이어진 빈 줄은 하나로 줄인다", () => {
    const text = "  정보시스템 \t구축 \t발주자를   위한\r\n표준프레임워크 \t적용가이드\r\n\r\n\r\n\r\n-- 1 of 113 --\n\n\n목 \t차  ";

    expect(chunkPdfText(text)).toEqual([
      "정보시스템 구축 발주자를 위한\n표준프레임워크 적용가이드\n\n-- 1 of 113 --\n\n목 차",
    ]);
  });

  it("줄바꿈 앞뒤의 공백과 탭을 지운다 (공백만 든 줄은 빈 줄이 된다)", () => {
    const text = "첫 줄 \t\n \t둘째 줄 \n \t \n\t\n   \n \t셋째 줄";

    expect(chunkPdfText(text)).toEqual(["첫 줄\n둘째 줄\n\n셋째 줄"]);
  });
});

describe("chunkPdfText — 청크 크기", () => {
  it("상한과 겹침을 주지 않으면 PDF_CHUNK_MAX_CHARS 와 PDF_CHUNK_OVERLAP_CHARS 로 나눈다", () => {
    const text = Array.from({ length: 8 }, (_, i) => paragraphOfLines(`문단${i + 1}줄`, 25, 39)).join("\n\n");
    const chunks = chunkPdfText(text);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks).toEqual(chunkPdfText(text, PDF_CHUNK_MAX_CHARS, PDF_CHUNK_OVERLAP_CHARS));
    expect(chunks).not.toEqual(chunkPdfText(text, PDF_CHUNK_MAX_CHARS, 0));
    expect(Math.max(...chunks.map((chunk) => chunk.length))).toBeLessThanOrEqual(PDF_CHUNK_MAX_CHARS);
  });

  it.each(Object.entries(SAMPLE_TEXTS))("겹침을 포함해 어느 청크도 상한을 넘지 않는다 — %s", (_name, text) => {
    for (const { maxChars, overlapChars } of LIMITS) {
      const lengths = chunkPdfText(text, maxChars, overlapChars).map((chunk) => chunk.length);
      expect(Math.max(...lengths), `상한 ${maxChars}, 겹침 ${overlapChars}`).toBeLessThanOrEqual(maxChars);
      expect(Math.min(...lengths), `상한 ${maxChars}, 겹침 ${overlapChars}`).toBeGreaterThan(0);
    }
  });

  it("상한 이하의 본문은 청크 하나로 둔다", () => {
    const text = `${paragraphOfLines("첫 문단 줄", 2, 20)}\n\n${paragraphOfLines("둘째 문단 줄", 2, 20)}`;

    expect(chunkPdfText(text, text.length)).toEqual([text]);
    expect(chunkPdfText(text, text.length, 0)).toEqual([text]);
  });

  it("빈 본문과 공백뿐인 본문은 청크를 만들지 않는다", () => {
    expect(chunkPdfText("")).toEqual([]);
    expect(chunkPdfText(" \n\n\t \r\n ")).toEqual([]);
  });

  it("상한이나 겹침으로 쓸 수 없는 값은 거부한다", () => {
    for (const maxChars of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => chunkPdfText("본문", maxChars)).toThrow(RangeError);
    }
    for (const overlapChars of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => chunkPdfText("본문", 100, overlapChars)).toThrow(RangeError);
    }
  });
});

describe("chunkPdfText — 내용 보존", () => {
  it.each(Object.entries(SAMPLE_TEXTS))("겹친 부분을 빼고 이으면 원문과 같다 (청크 사이에서는 공백만 빠진다) — %s", (_name, text) => {
    for (const { maxChars, overlapChars } of LIMITS) {
      expectChunksCoverSource(text, chunkPdfText(text, maxChars, overlapChars));
    }
  });

  it("겹침이 없으면 청크를 이은 것이 원문과 같다", () => {
    const lines = linesOf("줄", 12, 20);

    expect(chunkPdfText(lines.join("\n"), 90, 0).join("\n")).toBe(lines.join("\n"));
  });

  it("줄 끝의 공백과 공백만 든 줄이 있어도, 겹친 부분을 빼고 이으면 정리한 본문과 같다", () => {
    // 줄마다 끝에 공백과 탭을 두고, 문단 사이에는 공백과 탭만 든 줄을 둔다
    const paragraphs = Array.from({ length: 6 }, (_, i) => linesOf(`문단${i + 1}줄`, 4, 21).map((line) => `${line} \t`));
    const text = paragraphs.map((lines) => lines.join("\n")).join("\n \t\n");
    // 상한을 본문의 길이로 주면 정리한 본문이 청크 하나로 나온다
    const [normalized] = chunkPdfText(text, text.length, 0);

    // 정리는 공백만 바꾼다
    expect(normalized).not.toMatch(/[ \t]\n|\n[ \t]|\n{3,}/);
    expect(normalized.replace(/\s/g, "")).toBe(text.replace(/\s/g, ""));
    for (const { maxChars, overlapChars } of LIMITS) {
      expectChunksCoverSource(normalized, chunkPdfText(text, maxChars, overlapChars));
    }
  });
});

describe("chunkPdfText — 나누는 자리", () => {
  it("문단이 상한 안에 들어가면 문단 경계에서만 나눈다", () => {
    // 문단 하나가 41자: 두 문단(84자)까지 한 청크에 들어가고 세 문단(127자)은 들어가지 않는다
    const paragraphs = Array.from({ length: 5 }, (_, i) => paragraphOfLines(`문단${i + 1}줄`, 2, 20));

    expect(chunkPdfText(paragraphs.join("\n\n"), 100, 0)).toEqual([
      `${paragraphs[0]}\n\n${paragraphs[1]}`,
      `${paragraphs[2]}\n\n${paragraphs[3]}`,
      paragraphs[4],
    ]);
  });

  it("줄을 더 담을 자리가 남아도 상한 안에 드는 문단은 쪼개지 않는다", () => {
    const first = paragraphOfLines("첫 문단 줄", 2, 20); // 41자
    const second = paragraphOfLines("둘째 문단 줄", 3, 20); // 62자

    // 첫 청크에는 둘째 문단의 두 줄이 더 들어갈 자리(49자)가 남지만, 둘째 문단을 통째로 다음 청크에 담는다
    expect(chunkPdfText(`${first}\n\n${second}`, 90, 0)).toEqual([first, second]);
  });

  it("공백이나 탭만 든 줄도 빈 줄처럼 문단 경계로 본다", () => {
    const first = "첫 문단 첫 줄\n첫 문단 둘째 줄"; // 18자
    const second = "둘째 문단 첫 줄\n둘째 문단 둘째 줄\n둘째 문단 셋째 줄"; // 31자

    // 두 문단은 40자 안에 함께 들어가지 않고 둘째 문단은 들어간다.
    // 두 문단을 한 문단으로 보면 둘째 문단이 줄 경계에서 쪼개져 첫 줄이 앞 청크에 담긴다
    expect(chunkPdfText(`${first}\n\n${second}`, 40, 0)).toEqual([first, second]);
    for (const separator of ["\n \n", "\n\t\n", "\n \t \n", " \n\n", "\n\n\t", " \n \n ", "\n \n\t\n"]) {
      const text = `${first}${separator}${second}`;

      expect(chunkPdfText(text, 40, 0), JSON.stringify(separator)).toEqual([first, second]);
      // 한 청크에 함께 담길 때에도 두 문단 사이에는 빈 줄 하나만 남는다
      expect(chunkPdfText(text), JSON.stringify(separator)).toEqual([`${first}\n\n${second}`]);
    }
  });

  it("상한보다 긴 문단은 줄 경계에서 나눈다", () => {
    const lines = linesOf("줄", 10, 20); // 네 줄이 83자, 다섯 줄이 104자

    expect(chunkPdfText(lines.join("\n"), 90, 0)).toEqual([
      lines.slice(0, 4).join("\n"),
      lines.slice(4, 8).join("\n"),
      lines.slice(8).join("\n"),
    ]);
  });

  it("긴 문단은 앞 청크의 남은 자리부터 채운다 (긴 문단 앞에서 청크를 끊지 않는다)", () => {
    const heading = "- 12 -"; // 6자
    const lines = linesOf("줄", 9, 20);

    // 긴 문단마다 새 청크에서 시작하면 쪽마다 몇 줄짜리 자투리 청크가 남는다
    expect(chunkPdfText(`${heading}\n\n${lines.join("\n")}`, 90, 0)).toEqual([
      `${heading}\n\n${lines.slice(0, 3).join("\n")}`, // 6 + 2 + 62 = 70자, 한 줄을 더하면 91자
      lines.slice(3, 7).join("\n"),
      lines.slice(7).join("\n"),
    ]);
  });

  it("상한보다 긴 줄은 문장 경계에서 나눈다", () => {
    const sentences = Array.from({ length: 8 }, (_, i) => `${i + 1}번 문장은 여기에서 끝난다.`); // 문장 하나가 16자

    // 세 문장이 50자
    expect(chunkPdfText(sentences.join(" "), 50, 0)).toEqual([
      sentences.slice(0, 3).join(" "),
      sentences.slice(3, 6).join(" "),
      sentences.slice(6).join(" "),
    ]);
  });

  it("물음표와 느낌표, 닫는 따옴표와 괄호 뒤도 문장 경계로 본다", () => {
    const sentences = [
      "첫 문장이다.",
      '"둘째 문장이다."',
      "셋째 문장입니까?",
      "넷째 문장이다!",
      "(다섯째 문장이다.)",
      "여섯째 문장이다.",
    ];

    // 어느 두 문장도 12자 안에 함께 들어가지 않는다
    expect(chunkPdfText(sentences.join(" "), 12, 0)).toEqual(sentences);
  });

  it("숫자 바로 뒤의 마침표는 문장의 끝으로 보지 않는다 (목록 번호)", () => {
    const items = ["1. 개요를 적는다.", "2. 적용 범위를 적는다.", "3. 용어를 정의한다.", "4. 절차를 적는다."]; // 11, 14, 12, 11자

    // 번호 뒤의 공백을 문장 경계로 보면 "1. 개요를 적는다. 2." 처럼 번호가 제 항목과 떨어져 앞 청크의 끝에 남는다
    expect(chunkPdfText(items.join(" "), 25, 0)).toEqual([items[0], items[1], `${items[2]} ${items[3]}`]);
    // 빼는 것은 마침표뿐이다. 숫자 뒤의 물음표와 느낌표는 문장의 끝이다
    expect(chunkPdfText("값은 3? 아니면 4! 둘 다 아니다.", 8, 0)).toEqual(["값은 3?", "아니면 4!", "둘 다 아니다."]);
  });

  it("날짜의 마침표에서 나누지 않는다 (날짜가 두 청크로 갈리지 않는다)", () => {
    const text = "이 고시는 2025. 1. 7. 부터 시행한다. 다음 개정은 2026. 12. 31. 까지 한다.";

    expect(chunkPdfText(text, 20, 0)).toEqual(["이 고시는 2025. 1. 7. 부터", "시행한다. 다음 개정은", "2026. 12. 31. 까지 한다."]);
  });

  it("번호 바로 뒤의 공백에서는 낱말도 나누지 않는다 (번호를 항목의 첫 낱말과 함께 둔다)", () => {
    const text = "1. 개요 2. 적용 범위 3. 용어 정의 4. 적용 절차 5. 예외 사항 6. 문의처 7. 붙임";

    // 문장 부호가 없어 낱말 사이에서 나눈다. 17자를 꽉 채우면 "... 범위 3." 에서 끊기지만, 번호는 다음 청크로 넘긴다
    expect(chunkPdfText(text, 17, 0)).toEqual(["1. 개요 2. 적용 범위", "3. 용어 정의 4. 적용 절차", "5. 예외 사항 6. 문의처", "7. 붙임"]);
    for (const maxChars of [8, 10, 12, 14, 17, 20, 23, 26, 30]) {
      const chunks = chunkPdfText(text, maxChars, 0);

      expect(chunks.join(" "), `상한 ${maxChars}`).toBe(text);
      for (const chunk of chunks) {
        expect(chunk, `상한 ${maxChars}`).not.toMatch(/\d\.$/);
      }
    }
    // 번호 뒤의 공백이 여러 칸이어도 그 사이에서 나누지 않는다 (줄바꿈 없는 공백 U+00A0 은 본문을 정리할 때 한 칸으로 줄이지 않는다)
    const nbsp = String.fromCharCode(0xa0);
    expect(chunkPdfText(`가나다라 1.${nbsp}${nbsp}개요`, 9, 0)).toEqual(["가나다라", `1.${nbsp}${nbsp}개요`]);
  });

  it("번호와 뒤따르는 낱말이 함께 상한을 넘으면 그 사이의 공백에서 나눈다 (공백이 있는 한 글자 수로 자르지 않는다)", () => {
    expect(chunkPdfText("12. 가나다라마 34. 바사아자차", 6, 0)).toEqual(["12.", "가나다라마", "34.", "바사아자차"]);
  });

  it("문장 부호가 없는 긴 줄은 낱말 사이에서 나눈다", () => {
    const words = Array.from({ length: 30 }, (_, i) => `낱말${i + 1}`);
    const chunks = chunkPdfText(words.join(" "), 20, 0);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join(" ")).toBe(words.join(" "));
    for (const chunk of chunks) {
      expect(chunk).toMatch(/^낱말\d+( 낱말\d+)*$/);
    }
  });

  it("공백이 없는 긴 글자열만 글자 수로 나누고, 비슷한 길이로 나눈다", () => {
    const text = Array.from({ length: 13 }, (_, i) => `${String(i).padStart(2, "0")}가나다라마바사아`).join(""); // 130자

    const chunks = chunkPdfText(text, 50, 0);

    // 50, 50, 30자가 아니라 세 조각을 고르게 나눈다 (끝에 몇 글자짜리 조각이 남지 않게)
    expect(chunks.map((chunk) => chunk.length)).toEqual([44, 43, 43]);
    expect(chunks.join("")).toBe(text);
  });

  it("글자 수로 나눌 때 서로게이트 쌍의 가운데에서 자르지 않는다", () => {
    const text = "😀".repeat(33); // UTF-16 코드 단위로 66

    const chunks = chunkPdfText(text, 13, 0);

    expect(chunks.join("")).toBe(text);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(13);
      expect(Array.from(chunk).every((character) => character === "😀")).toBe(true);
    }
  });
});

describe("chunkPdfText — 이웃한 청크의 겹침", () => {
  it("뒤 청크는 앞 청크의 마지막 줄로 시작한다", () => {
    const lines = linesOf("줄", 12, 20);

    // 첫 청크는 겹침을 싣지 않으므로 상한(90자)까지 네 줄을 담는다. 그 뒤로는 겹침 25자를 뺀 65자에 세 줄씩 담고,
    // 앞 청크의 마지막 한 줄(20자)을 앞에 다시 싣는다
    expect(chunkPdfText(lines.join("\n"), 90, 25)).toEqual([
      lines.slice(0, 4).join("\n"),
      lines.slice(3, 7).join("\n"),
      lines.slice(6, 10).join("\n"),
      lines.slice(9).join("\n"),
    ]);
  });

  it("겹침은 줄 경계에서 시작하고 겹침 길이를 넘지 않는다", () => {
    const lines = linesOf("줄", 12, 20);

    // 겹침 50자에는 두 줄(41자)이 들어간다. 세 번째 줄을 중간부터 싣지 않는다
    expect(chunkPdfText(lines.join("\n"), 150, 50)).toEqual([
      lines.slice(0, 7).join("\n"),
      lines.slice(5, 11).join("\n"),
      lines.slice(9).join("\n"),
    ]);
  });

  it.each(Object.entries(SAMPLE_TEXTS))("겹친 길이는 겹침 상한을 넘지 않는다 — %s", (_name, text) => {
    for (const { maxChars, overlapChars } of LIMITS) {
      const spans = locateChunks(text, chunkPdfText(text, maxChars, overlapChars));
      for (let i = 1; i < spans.length; i++) {
        expect(spans[i].start).toBeGreaterThan(spans[i - 1].start);
        expect(spans[i - 1].end - spans[i].start, `상한 ${maxChars}, 겹침 ${overlapChars}`).toBeLessThanOrEqual(overlapChars);
      }
    }
  });

  it("줄이 겹침 길이보다 길면 문장 경계에서 겹침을 시작한다", () => {
    const sentences = Array.from({ length: 8 }, (_, i) => `${i + 1}번 문장은 여기에서 끝난다.`); // 문장 하나가 16자

    expect(chunkPdfText(sentences.join(" "), 70, 20)).toEqual([
      sentences.slice(0, 4).join(" "),
      sentences.slice(3, 7).join(" "),
      sentences.slice(6).join(" "),
    ]);

    // 겹침 25자의 범위는 한 문장 앞의 끝 낱말("끝난다.")부터라서, 범위에서 가장 앞에 있는 낱말의 처음과
    // 문장의 처음이 서로 다른 자리다. 낱말의 처음("끝난다. 4번 ...")이 아니라 문장의 처음("4번 ...")을 고른다
    expect(chunkPdfText(sentences.join(" "), 70, 25)).toEqual([
      sentences.slice(0, 4).join(" "),
      sentences.slice(3, 6).join(" "),
      sentences.slice(5).join(" "),
    ]);
  });

  it("문장도 겹침 길이보다 길면 낱말 경계에서 겹침을 시작한다", () => {
    const words = Array.from({ length: 30 }, (_, i) => `낱말${i + 1}`);
    const chunks = chunkPdfText(words.join(" "), 30, 10);

    expect(chunks[0]).toBe(words.slice(0, 7).join(" "));
    // 앞 청크의 끝 10자 안에서 시작하는 낱말은 "낱말6" 과 "낱말7" 이다
    expect(chunks[1]).toBe(words.slice(5, 11).join(" "));
    for (const chunk of chunks) {
      expect(chunk).toMatch(/^낱말\d+( 낱말\d+)*$/);
    }
  });

  it("겹침은 번호 바로 뒤의 낱말에서 시작하지 않는다", () => {
    const text = "1. 개요 2. 적용 범위 3. 용어 정의 4. 적용 절차 5. 예외 사항 6. 문의처 7. 붙임";

    // 겹침 7자의 범위에 번호("4.")와 그 뒤의 낱말("적용")이 함께 있다. 번호에서 시작한다
    expect(chunkPdfText(text, 30, 7)).toEqual([
      "1. 개요 2. 적용 범위 3. 용어 정의 4. 적용",
      "4. 적용 절차 5. 예외 사항 6. 문의처",
      "6. 문의처 7. 붙임",
    ]);
    // 겹침 4자의 범위에는 번호 뒤의 낱말("적용")만 있다. 번호를 떼고 낱말에서 시작하지 않고, 겹치지 않는다
    expect(chunkPdfText(text, 30, 4)).toEqual(["1. 개요 2. 적용 범위 3. 용어 정의 4. 적용", "절차 5. 예외 사항 6. 문의처 7. 붙임"]);
  });

  it("나눌 자리가 없는 글자열은 겹치지 않는다", () => {
    const text = Array.from({ length: 13 }, (_, i) => `${String(i).padStart(2, "0")}가나다라마바사아`).join(""); // 130자

    expect(chunkPdfText(text, 50, 10).join("")).toBe(text);
  });

  it("겹침은 앞 청크의 본문 전체를 다시 싣지 않는다", () => {
    const longParagraph = linesOf("본문 줄", 6, 20); // 125자
    const shortParagraph = "표지 첫 줄\n표지 둘째 줄"; // 14자
    const lastParagraph = paragraphOfLines("끝 문단 줄", 4, 21); // 87자

    // 겹침 40자 안에 짧은 문단(14자)이 통째로 들어가지만, 그 문단의 둘째 줄부터만 다시 싣는다
    expect(chunkPdfText([longParagraph.join("\n"), shortParagraph, lastParagraph].join("\n\n"), 130, 40)).toEqual([
      longParagraph.join("\n"),
      `${longParagraph[5]}\n\n${shortParagraph}`,
      `표지 둘째 줄\n\n${lastParagraph}`,
    ]);
  });

  it("겹침이 상한의 절반을 넘으면 절반까지만 겹친다", () => {
    const text = paragraphOfLines("줄", 12, 20);

    expect(chunkPdfText(text, 90, 1000)).toEqual(chunkPdfText(text, 90, 45));
  });
});

describe("chunkPdfText — 처리 시간", () => {
  /**
   * 본문 하나를 나누는 데 쓸 수 있는 CPU 시간의 한계(밀리초).
   *
   * 걸린 시간은 벽시계 시간이 아니라 이 프로세스가 쓴 CPU 시간(process.cpuUsage 의 user 와 system 의 합)으로 잰다.
   * 벽시계 시간은 다른 프로세스가 코어를 쓰는 동안에도 흐르므로, 바쁜 장비에서는 구현이 그대로여도 늘어난다.
   * CPU 시간은 프로세스 전체의 값이라 가비지 컬렉션처럼 다른 스레드가 쓴 시간도 들어간다. 테스트 파일을 병렬로
   * 실행하면 다른 파일을 실행하는 스레드가 쓴 시간까지 들어간다 (vitest.config.mjs 는 파일을 순차로 실행한다).
   *
   * Apple M4 Max(코어 16개)에서 이 파일을 vitest 로 실행해 잰 CPU 시간은 다음과 같다. 실행마다 한 번씩 잰 표본의 범위다.
   * - 긴 줄 본문: 따로 부하를 걸지 않은 60번 실행에서 122~194ms. 계산만 하는 프로세스 32개를 함께 돌린 32번 실행에서
   *   168~245ms (그때의 벽시계 시간은 287~507ms).
   * - 닫는 괄호 본문: 같은 60번 실행에서 2~5ms, 같은 32번 실행에서 2~11ms.
   * - 구현을 되돌린 사본(4번씩 실행): splitSpan 이 본문 전체에서 찾게 하면 긴 줄 본문에 10.8~13.9초를 쓰고, 문장 경계
   *   정규식의 맨 앞 조건 (?=\s) 를 빼면 닫는 괄호 본문에 25.8~31.5초를 쓴다.
   * - 테스트 파일을 병렬로 실행하게 하고 전체 테스트를 돌린 3번에서는 긴 줄 본문의 CPU 시간이 2.7~3.4초였다.
   * 5초는 파일을 순차로 실행할 때 지금 구현이 쓴 가장 큰 값(245ms)의 약 20배이고, 되돌린 구현이 쓴 가장 작은 값(10.8초)의
   * 절반보다 작다.
   */
  const CPU_TIME_LIMIT_MS = 5000;

  /** run 을 한 번 실행하는 동안 이 프로세스가 쓴 CPU 시간(밀리초)과 run 의 결과 */
  const withCpuTime = <T>(run: () => T): { cpuMs: number; result: T } => {
    const before = process.cpuUsage();
    const result = run();
    const used = process.cpuUsage(before);
    return { cpuMs: (used.user + used.system) / 1000, result };
  };

  it("문장 부호가 없는 긴 줄이 많은 본문을 CPU 시간 5초 안에 나눈다", () => {
    // 낱말이 공백으로만 나뉜 700자 남짓한 줄 4,000개 (약 280만 자).
    // 긴 줄 하나를 문장 경계에서 나누려 할 때 그 줄이 아니라 본문의 끝까지 훑으면, 걸리는 시간이 줄 수의 제곱으로 늘어난다
    const longLine = (seed: number): string => {
      let line = `낱말${seed % 97}가나다`;
      for (let i = 1; line.length < 700; i++) {
        line += ` 낱말${(seed + i) % 97}가나다`;
      }
      return line;
    };
    const text = Array.from({ length: 4000 }, (_, i) => longLine(i)).join("\n");
    expect(text.length).toBeGreaterThan(2_800_000);

    const { cpuMs, result: chunks } = withCpuTime(() => chunkPdfText(text));

    expect(cpuMs, "쓴 CPU 시간(ms)").toBeLessThan(CPU_TIME_LIMIT_MS);
    // 빨리 끝난 결과가 올바른 결과인지도 본다
    expect(Math.max(...chunks.map((chunk) => chunk.length))).toBeLessThanOrEqual(PDF_CHUNK_MAX_CHARS);
    expectChunksCoverSource(text, chunks);
  }, 120_000);

  it("닫는 괄호가 길게 이어진 본문을 CPU 시간 5초 안에 나눈다", () => {
    // 문장 경계는 끝 부호 뒤에 닫는 따옴표나 괄호가 몇 개든 이어질 수 있다고 본다. 그 조건을 공백이 아닌 자리에서도
    // 따지면, 닫는 괄호가 이어진 글자열 안의 자리마다 그 앞의 괄호를 모두 되짚어 길이의 제곱만큼 시간이 걸린다
    const text = `가나다${")".repeat(200_000)} 라마바. 사아자`;

    const { cpuMs, result: chunks } = withCpuTime(() => chunkPdfText(text));

    expect(cpuMs, "쓴 CPU 시간(ms)").toBeLessThan(CPU_TIME_LIMIT_MS);
    // 공백이 없는 글자열은 겹치지 않으므로, 청크를 이으면 공백을 뺀 본문과 같다
    expect(Math.max(...chunks.map((chunk) => chunk.length))).toBeLessThanOrEqual(PDF_CHUNK_MAX_CHARS);
    expect(chunks.join("").replace(/\s/g, "")).toBe(text.replace(/\s/g, ""));
  }, 120_000);
});

describe("pdfTextToKnowledge — 청크를 개발자 지식 입력으로 만든다", () => {
  const pdfPath = path.join(TEMPLATES_DIR, "developer_knowledge", "application-guide.pdf");
  // 어느 상한에서도 청크가 여러 개 나오도록 1,000자 문단을 여섯 개 둔다
  const text = Array.from({ length: 6 }, (_, i) => paragraphOfLines(`문단${i + 1}줄`, 25, 39)).join("\n\n");

  it("청크마다 입력을 하나씩 만들고 본문에 청크를 그대로 싣는다", () => {
    const chunks = chunkPdfText(text);
    const inputs = pdfTextToKnowledge(pdfPath, text);

    expect(chunks.length).toBeGreaterThan(1);
    expect(inputs.map((input) => input.content)).toEqual(chunks);
  });

  it("제목의 (순번/전체) 와 metadata 의 chunkIndex, chunkCount 가 청크 수와 맞는다", () => {
    const inputs = pdfTextToKnowledge(pdfPath, text);
    const count = inputs.length;

    inputs.forEach((input, index) => {
      expect(input.title).toBe(`application-guide (${index + 1}/${count})`);
      expect(input.metadata?.chunkIndex).toBe(index + 1);
      expect(input.metadata?.chunkCount).toBe(count);
    });
  });

  it("유형, 출처, 태그는 적용가이드 PDF 의 값으로 채운다", () => {
    const [first] = pdfTextToKnowledge(pdfPath, text);

    expect(first).toMatchObject({
      type: "best-practice",
      context: "표준프레임워크 적용가이드 PDF",
      tags: ["egovframe", "developer_knowledge", "guide", "pdf"],
      importance: 5,
      verified: true,
      metadata: {
        source: "templates/developer_knowledge",
        sourceFile: path.join("templates", "developer_knowledge", "application-guide.pdf"),
        sourceType: "pdf",
      },
    });
  });

  it("NFD 로 들어온 한글 파일 이름을 제목과 sourceFile 에서 NFC 로 정규화한다", () => {
    const nfdName = "적용가이드".normalize("NFD");
    const [first] = pdfTextToKnowledge(path.join(TEMPLATES_DIR, "developer_knowledge", `${nfdName}.pdf`), text);

    expect(first.title.startsWith("적용가이드 (1/")).toBe(true);
    expect(first.metadata?.sourceFile).toBe(path.join("templates", "developer_knowledge", "적용가이드.pdf"));
  });

  it("본문이 비어 있으면 입력을 만들지 않는다", () => {
    expect(pdfTextToKnowledge(pdfPath, "")).toEqual([]);
    expect(pdfTextToKnowledge(pdfPath, " \n\n \t ")).toEqual([]);
  });
});

/** 인덱스 구축이 읽는 PDF: templates/developer_knowledge 바로 아래의 .pdf 파일 */
const PDF_DIR = path.join(TEMPLATES_DIR, "developer_knowledge");
const BUNDLED_PDFS = fs.existsSync(PDF_DIR)
  ? fs
      .readdirSync(PDF_DIR)
      .filter((name) => name.toLowerCase().endsWith(".pdf"))
      .map((name) => path.join(PDF_DIR, name))
  : [];

describe.skipIf(BUNDLED_PDFS.length === 0)("동봉 적용가이드 PDF 의 청크", () => {
  /** PDF 파일별 지식 입력 */
  let inputsByFile: AddKnowledgeInput[][];

  beforeAll(async () => {
    inputsByFile = [];
    for (const pdfPath of BUNDLED_PDFS) {
      inputsByFile.push(await readPdfKnowledge(pdfPath));
    }
  }, 120_000);

  it("PDF 마다 청크가 나오고, 어느 청크도 PDF_CHUNK_MAX_CHARS 를 넘지 않는다", () => {
    for (const inputs of inputsByFile) {
      expect(inputs.length).toBeGreaterThan(0);
      expect(Math.max(...inputs.map((input) => input.content.length))).toBeLessThanOrEqual(PDF_CHUNK_MAX_CHARS);
    }
  });

  it("제목의 (순번/전체) 와 metadata 의 chunkIndex, chunkCount 가 청크 수와 맞는다", () => {
    inputsByFile.forEach((inputs, fileIndex) => {
      const baseTitle = path.basename(BUNDLED_PDFS[fileIndex], ".pdf").normalize("NFC");
      inputs.forEach((input, index) => {
        expect(input.title).toBe(`${baseTitle} (${index + 1}/${inputs.length})`);
        expect(input.metadata?.chunkIndex).toBe(index + 1);
        expect(input.metadata?.chunkCount).toBe(inputs.length);
      });
    });
  });

  // 토크나이저(models/ — git 미추적)가 있어야 토큰 수를 셀 수 있다
  it.skipIf(!hasEmbeddingModel())(
    "모든 청크의 임베딩 입력이 모델이 읽는 512 토큰 안에 들어간다",
    async () => {
      const inputs = inputsByFile.flat();

      // 모델을 돌리지 않고, 색인 경로(addKnowledgeBatch)가 모델에 넘기는 입력만 기록한다.
      // 제목·표지·상황·태그와 접두 "passage: " 까지 실제 색인과 같은 문자열이 기록된다.
      const recorded: string[] = [];
      const embedder = getEmbedder() as unknown as { model: unknown };
      embedder.model = async (text: string) => {
        recorded.push(text);
        return { data: new Float32Array(384) };
      };
      const logs = vi.spyOn(console, "error").mockImplementation(() => {});
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "egov-pdf-chunks-"));
      try {
        const manager = new DeveloperKnowledgeManager(tmpDir);
        await manager.initialize();
        await manager.addKnowledgeBatch(inputs);
      } finally {
        embedder.model = null;
        logs.mockRestore();
        await fs.remove(tmpDir);
      }
      expect(recorded).toHaveLength(inputs.length);
      expect(recorded.every((text) => text.startsWith("passage: 제목: "))).toBe(true);

      const tokenizer = await AutoTokenizer.from_pretrained(EMBEDDING_MODEL_ID);
      expect(tokenizer.model_max_length).toBe(512);
      // 특수 토큰(<s>, </s>)을 포함한 수다. 파이프라인은 이 수가 512 를 넘으면 뒤를 잘라 낸다
      const tooLong = recorded
        .map((text, index) => ({ title: inputs[index].title, tokens: tokenizer.encode(text).length }))
        .filter((entry) => entry.tokens > tokenizer.model_max_length);
      expect(tooLong).toEqual([]);
    },
    120_000,
  );
});
