/**
 * 가이드 문서 청킹
 *
 * 임베딩 모델(multilingual-e5-small)은 입력의 앞 512 토큰만 읽는다. 색인 단위(청크)가 그보다 길면
 * 뒷부분은 벡터에 반영되지 않아, 색인에 있는 내용인데도 의미 검색으로 찾을 수 없다. 그래서 청크의
 * 임베딩 입력(제목과 분류를 붙인 문자열)이 입력 창에 들어가도록 긴 절을 나눈다.
 *
 * 나누는 순서:
 *   1. 더 깊은 제목(###, #### …). 나뉜 소절은 제목 경로를 title 과 section 에 싣는다 ("문서: 절 > 소절").
 *   2. 빈 줄로 구분된 문단
 *   3. 줄 경계 (표의 행, 코드 블록의 줄, 목록의 항목)
 *   4. 한 줄이 상한보다 길 때만 줄 안 (문장 끝 → 공백 → 임의 위치)
 *
 * 색인하지 않는 것은 본문이 50자 미만인 ## 절과 개요(## 앞의 내용)뿐이다. 긴 절을 나눈 결과로 생긴 짧은 글과
 * 본문 없는 제목 줄은 버리지 않고 이웃에 붙인다.
 *
 * 제목 없이 나뉜 조각은 title 과 section 끝에 " (k/n)" 을 붙인다. 조각은 스스로 읽히는 마크다운이어야
 * 하므로, 코드 블록 중간에서 나누면 앞 조각의 펜스를 닫고 뒤 조각에서 같은 줄로 다시 열며, 표 중간에서
 * 나누면 뒤 조각에 머리 행과 구분 행을 다시 넣는다. 코드 블록과 표는 되도록 그것을 소개하는 앞 문단과
 * 같은 조각에 둔다. 조각끼리 내용을 겹치지 않는다.
 *
 * 이 모듈은 순수 함수만 둔다 (LanceDB 와 임베딩 모델을 불러오지 않는다). 토큰 수는 글자 종류별 가중치로
 * 어림한다. 토크나이저(17MB)를 불러오지 않고도 색인 경로와 테스트가 같은 결과를 얻는다.
 */

import path from 'path';
import type { GuideChunk } from './guideManager.js';

// ─── 상한 ────────────────────────────────────────────────

/**
 * 청크 하나의 임베딩 입력에 허용하는 추정 토큰 수.
 *
 * 모델의 입력 창은 512 토큰(특수 토큰 2개 포함)이다. 추정값은 실제 토큰 수와 어긋나므로 여유를 둔다
 * (estimateTokens 참고: 실제 값은 대개 추정값의 1.27배 이하다).
 * 가이드 원문(마크다운 663개)을 이 값으로 나누면 청크의 임베딩 입력은 실제 토큰 수가 최대 492 이고
 * 512 를 넘는 것이 없다. 420 이면 3개, 440 이면 15개, 480 이면 58개가 512 를 넘는다.
 */
export const GUIDE_CHUNK_TOKEN_BUDGET = 400;

/** 나눈 조각이 이 글자 수보다 짧으면 이웃 조각과 합친다 */
export const GUIDE_PIECE_MIN_CHARS = 200;

/**
 * 본문이 이 글자 수보다 짧은 ## 절과 개요(## 앞의 내용)는 색인하지 않는다.
 * 긴 절을 더 깊은 제목에서 나눈 결과(도입부, 소절)에는 적용하지 않는다: 그런 글은 이보다 짧아도 이웃 묶음에 붙여 색인한다.
 */
export const GUIDE_SECTION_MIN_CHARS = 50;

/** 청킹 조건. 색인 경로는 기본값을 쓴다. 테스트와 측정에서 상한을 바꿔 볼 때만 준다 */
export interface GuideChunkOptions {
  /** 임베딩 입력의 추정 토큰 상한 (기본 GUIDE_CHUNK_TOKEN_BUDGET) */
  tokenBudget?: number;
  /** 짧은 조각으로 보는 글자 수 (기본 GUIDE_PIECE_MIN_CHARS) */
  minPieceChars?: number;
}

// ─── 토큰 수 어림 ────────────────────────────────────────

/**
 * 글자 종류별 토큰 수 가중치.
 *
 * 가이드 원문을 약 900자씩 자른 표본 2,998개에서 모델의 토크나이저가 센 토큰 수에 최소제곱으로 맞춘 값을
 * 반올림했다. 공백은 토큰이 되지 않고(들여쓰기, 표의 칸 맞춤), 숫자와 기호는 글자마다 토큰 하나에 가깝다.
 * 그 표본의 99% 에서 실제 토큰 수는 어림값의 1.27배 이하다 (최대 1.50배, 중앙값 1.01배).
 * 글자 수에 고정 비율을 곱해 어림하면 99% 가 1.39배 이하(최대 1.77배)이고, 공백이 많은 표나 코드는
 * 실제의 2.5배로 어림되어 필요 이상으로 잘게 나뉜다.
 */
const TOKEN_WEIGHTS = {
  /** 공백 뒤에서 새로 시작하는 낱말 하나 */
  word: 0.55,
  hangul: 0.45,
  latin: 0.33,
  digit: 1,
  /** ASCII 기호 */
  symbol: 0.5,
  /** 그 밖의 글자 (한자, 선 그리기 문자, 이모지 등) */
  other: 1,
  /**
   * 구분선에 쓰는 기호(- = _ .)가 5자 넘게 이어질 때 다섯째 글자부터의 한 글자.
   * 토크나이저는 이런 구간을 16자에 토큰 하나꼴로 센다 (64자 → 5토큰, 128자 → 9토큰). 글자마다 세면 칸을 맞춘
   * 표의 구분 행(| ------------ | ---- |)이 실제의 일곱 배쯤으로 어림되어, 표 머리를 다시 넣지 못하고 구분 행을 줄 안에서 자르게 된다.
   */
  ruleRun: 1 / 16,
} as const;

/** 구분선 기호가 이만큼 이어진 뒤부터 ruleRun 으로 센다 */
const RULE_RUN_START = 4;

/** 공백으로 치는 코드 단위: 제어 문자와 유니코드 공백 */
function isSpaceCode(code: number): boolean {
  return (
    code <= 0x20 ||
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  );
}

/** 구분선에 쓰는 기호: - = _ . */
function isRuleCode(code: number): boolean {
  return code === 0x2d || code === 0x3d || code === 0x5f || code === 0x2e;
}

/** 공백이 아닌 코드 단위 하나의 가중치 */
function charWeight(code: number): number {
  if (code >= 0xac00 && code <= 0xd7a3) return TOKEN_WEIGHTS.hangul;
  if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) return TOKEN_WEIGHTS.latin;
  if (code >= 0x30 && code <= 0x39) return TOKEN_WEIGHTS.digit;
  return code < 0x80 ? TOKEN_WEIGHTS.symbol : TOKEN_WEIGHTS.other;
}

/**
 * text 의 [from, to) 구간의 추정 토큰 수를 돌려준다. 구간의 처음부터 새로 센다 (from 을 낱말이 시작하는 자리로 본다).
 * sums 를 주면 구간의 앞 i 글자까지의 값을 sums[i] 에 채운다. limit 를 주면 누적값이 그 값을 넘은 글자까지만 센다.
 */
function accumulateTokens(
  text: string,
  sums?: Float64Array | number[],
  from = 0,
  to = text.length,
  limit = Infinity,
): number {
  let total = 0;
  let afterSpace = true;
  let previous = -1;
  let run = 0;
  for (let i = from; i < to && total <= limit; i++) {
    const code = text.charCodeAt(i);
    run = code === previous ? run + 1 : 1;
    previous = code;
    if (isSpaceCode(code)) {
      afterSpace = true;
    } else {
      if (afterSpace) {
        total += TOKEN_WEIGHTS.word;
        afterSpace = false;
      }
      total += run > RULE_RUN_START && isRuleCode(code) ? TOKEN_WEIGHTS.ruleRun : charWeight(code);
    }
    if (sums) {
      sums[i - from + 1] = total;
    }
  }
  return total;
}

/**
 * 임베딩 모델의 토크나이저 없이 토큰 수를 어림한다.
 *
 * 공백의 양은 결과에 영향이 없고, 공백으로 이어 붙인 문자열의 값은 각 문자열 값의 합이다.
 */
export function estimateTokens(text: string): number {
  return accumulateTokens(text);
}

/** text 의 앞 i 글자를 떼어 냈을 때의 어림값을 i 마다 돌려준다 (길이 text.length + 1). */
function cumulativeTokens(text: string): Float64Array {
  const sums = new Float64Array(text.length + 1);
  accumulateTokens(text, sums);
  return sums;
}

// ─── 임베딩 입력 ─────────────────────────────────────────

/** 임베더가 색인 문서 앞에 붙이는 접두 (E5 모델의 passage 접두. rag/embedder 의 embed 참고) */
const PASSAGE_PREFIX = 'passage: ';

/** 조각 번호와 같은 제목의 절을 구별하는 순번이 title 에 더하는 길이의 여유분 */
const NUMBERING_ALLOWANCE = ' [99] (999/999)';

/**
 * 가이드 청크의 검색 텍스트 (임베딩용).
 * GuideSearchManager 가 색인할 때 이 문자열을 임베딩하고, 청킹은 이 문자열의 길이로 상한을 잰다.
 */
export function guideSearchText(title: string, content: string, layer: string, category: string): string {
  const parts = [`제목: ${title}`, `내용: ${content}`];

  if (layer) {
    parts.push(`분류: ${layer}`);
  }

  if (category) {
    parts.push(`카테고리: ${category}`);
  }

  return parts.join('\n');
}

/** 청크 하나의 임베딩 입력(접두와 제목, 분류 포함)의 추정 토큰 수 */
export function estimateGuideChunkTokens(chunk: Pick<GuideChunk, 'title' | 'content' | 'layer' | 'category'>): number {
  return estimateTokens(PASSAGE_PREFIX + guideSearchText(chunk.title, chunk.content, chunk.layer, chunk.category));
}

// ─── 조각 번호 ───────────────────────────────────────────

/** section 끝의 조각 번호 " (k/n)" */
const SECTION_PART_PATTERN = /^(.+) \(([1-9]\d{0,5})\/([1-9]\d{0,5})\)$/s;

/**
 * section (또는 title) 끝의 " (k/n)" 을 해석한다. 조각 번호가 없으면 null.
 *
 * 청킹이 붙이는 번호만 조각 번호로 본다: 1 ≤ k ≤ n 이고 n 은 2 이상이다 (조각이 하나뿐인 절에는 번호를 붙이지 않는다).
 * base 는 번호를 뗀 나머지로, GuideSearchManager.getSectionParts 에 넘기는 절의 이름이다.
 */
export function parseSectionPart(section: string): { base: string; part: number; count: number } | null {
  if (typeof section !== 'string') {
    return null;
  }
  const match = SECTION_PART_PATTERN.exec(section);
  if (!match) {
    return null;
  }
  const part = Number(match[2]);
  const count = Number(match[3]);
  if (count < 2 || part > count) {
    return null;
  }
  return { base: match[1], part, count };
}

// ─── 줄 읽기 ─────────────────────────────────────────────

/** 펜스 줄 (``` 또는 ~~~, 들여쓰기 허용) */
const FENCE_PATTERN = /^\s*(`{3,}|~{3,})/;

/** 제목 줄 (0열에서 시작하는 # 1~6개와 공백, 문구). 줄 끝의 CR 은 문구에 넣었다가 trim 으로 뗀다 */
const HEADING_PATTERN = /^(#{1,6})\s+(\S[\s\S]*)$/;

/** 표의 구분 행 (| --- | :---: |) */
const TABLE_DELIMITER_PATTERN = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

/** 줄의 종류: 펜스 밖의 줄, 여는 펜스, 코드 블록 안의 줄, 닫는 펜스 */
type LineKind = 'text' | 'open' | 'code' | 'close';

/** 줄 단위로 읽은 문서 본문 */
interface ScannedBody {
  body: string;
  lines: string[];
  /** 줄이 시작하는 위치 (body 기준) */
  starts: number[];
  kinds: LineKind[];
  /** 코드 줄과 닫는 펜스 줄이 속한 코드 블록의 여는 펜스 줄 번호 (그 밖의 줄은 -1) */
  openers: number[];
  /** 펜스 밖 제목 줄의 수준 1~6 (제목이 아니면 0) */
  levels: number[];
  /** 제목 줄의 문구 */
  headings: string[];
}

/**
 * 본문을 줄 단위로 읽어 코드 블록과 제목을 가린다.
 *
 * 코드 블록 안의 # 으로 시작하는 줄(셸 주석 등)은 제목이 아니다. 펜스는 게이트웨이가 본문을 다듬을 때
 * (tools/egovSearchKnowledge 의 formatGuideContent)와 같은 규칙으로 센다: 열린 펜스와 같은 문자이고
 * 길이가 같거나 긴 펜스 줄이 닫는다. 규칙이 다르면 나눈 조각의 펜스를 응답에서 다르게 해석한다.
 */
function scanBody(body: string): ScannedBody {
  const lines = body.split('\n');
  const starts: number[] = [];
  const kinds: LineKind[] = [];
  const openers: number[] = [];
  const levels: number[] = [];
  const headings: string[] = [];

  let offset = 0;
  let fence: string | null = null;
  let opener = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    starts.push(offset);
    offset += line.length + 1;

    let kind: LineKind = fence === null ? 'text' : 'code';
    let level = 0;
    let heading = '';
    const fenceMatch = line.match(FENCE_PATTERN);
    if (fenceMatch && fence === null) {
      kind = 'open';
      fence = fenceMatch[1];
      opener = i;
      openers.push(-1);
    } else if (fenceMatch && fence !== null && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) {
      kind = 'close';
      openers.push(opener);
      fence = null;
      opener = -1;
    } else {
      openers.push(kind === 'code' ? opener : -1);
      const headingMatch = kind === 'text' ? line.match(HEADING_PATTERN) : null;
      if (headingMatch) {
        level = headingMatch[1].length;
        heading = headingMatch[2].trim();
      }
    }
    kinds.push(kind);
    levels.push(level);
    headings.push(heading);
  }

  return { body, lines, starts, kinds, openers, levels, headings };
}

/** lines[from..to) 의 글에서 앞뒤 공백을 뺀 구간 (body 기준 위치). 글이 없으면 start 와 end 가 같다 */
function trimmedSpan(scanned: ScannedBody, from: number, to: number): { start: number; end: number } {
  if (from >= to) {
    const at = from < scanned.starts.length ? scanned.starts[from] : scanned.body.length;
    return { start: at, end: at };
  }
  const start = scanned.starts[from];
  const end = scanned.starts[to - 1] + scanned.lines[to - 1].length;
  const raw = scanned.body.slice(start, end);
  const trimmedStart = start + (raw.length - raw.trimStart().length);
  const trimmedEnd = end - (raw.length - raw.trimEnd().length);
  return trimmedEnd > trimmedStart ? { start: trimmedStart, end: trimmedEnd } : { start, end: start };
}

// ─── 제목 없는 글을 조각으로 나누기 ─────────────────────

/** 절의 조각 하나 */
export interface GuideSectionPiece {
  /** 색인하는 본문: lead + (절 본문의 start~end 구간) + trail */
  content: string;
  /** 절 본문(GuideSection.body)에서 이 조각이 맡은 구간의 시작 */
  start: number;
  /** 구간의 끝 (포함하지 않음) */
  end: number;
  /** 조각 앞에 다시 넣은 줄: 다시 연 펜스 줄, 또는 표의 머리 행과 구분 행 (없으면 빈 문자열) */
  lead: string;
  /** 조각 뒤에 붙인 닫는 펜스 (없으면 빈 문자열) */
  trail: string;
}

/**
 * 뒤 조각에 다시 넣는 줄(표의 머리 행과 구분 행, 여는 펜스 줄)이 상한에서 차지할 수 있는 최대 비율.
 * 넘으면 다시 넣지 않고 줄 경계에서만 끊는다 (조각마다 긴 줄을 되풀이하면 본문이 들어갈 자리가 없다).
 */
const MAX_REPEATED_LINES_SHARE = 1 / 3;

/** 줄의 역할: 표의 머리 행, 구분 행, 본문 행을 가린 LineKind */
type LineRole = LineKind | 'thead' | 'tdelim' | 'trow';

/**
 * 더 나누지 않는 단위: 줄 하나, 또는 상한보다 긴 줄을 줄 안에서 자른 토막.
 * 조각은 이어진 원자들의 묶음이다.
 */
interface Atom {
  /** body 기준 구간 */
  start: number;
  end: number;
  /** 앞 원자와의 경계에서 조각을 끊을 수 있는지 */
  cuttable: boolean;
  /** 앞 원자와의 경계의 종류: 0 문단(빈 줄), 1 줄, 2 줄 안 */
  boundary: 0 | 1 | 2;
  /** 앞 원자가 보통 글이고 이 원자가 코드 블록이나 표의 첫 줄인지 (앞의 글이 이 블록을 소개하는 자리) */
  introduced: boolean;
  /** 앞 원자와 같은 코드 블록이나 표에 든 줄인지 (이 원자 앞에서 끊으면 블록의 안에서 끊는 것이다) */
  insideBlock: boolean;
  /** 이 원자에서 조각이 시작할 때 앞에 다시 넣는 줄 (펜스를 다시 열거나 표 머리를 다시 넣는다) */
  lead: string;
  /** lead 의 추정 토큰 */
  leadTokens: number;
  /** 이 원자 앞에서 끊을 때 앞 조각 끝에 붙이는 닫는 펜스 */
  closeBefore: string;
  /** closeBefore 의 추정 토큰 */
  closeTokens: number;
}

/** 문장이 끝나는 자리: 마침표류와 닫는 따옴표·괄호 뒤의 공백 */
const SENTENCE_END_PATTERN = /[.!?。]["'”’)\]]?(?=\s)/g;

/** 낱말 사이의 공백이 시작하는 자리 */
const WORD_GAP_PATTERN = /\S(?=\s)/g;

/** 누적값의 차로 구한 크기가 상한과 이만큼 안에서 다르면 처음부터 다시 세어 판정한다 (부동소수점 오차의 여유) */
const SUM_TOLERANCE = 1e-6;

/**
 * 상한보다 긴 줄을 줄 안에서 나눈다. 토막의 크기를 고르게 맞추고, 자르는 자리는 문장 끝, 공백, 임의 위치 순으로 고른다.
 * 공백에서 자르면 그 공백은 어느 토막에도 넣지 않는다.
 *
 * 걸리는 시간은 줄 길이에 비례한다. 줄 전체의 누적값은 한 번만 계산하고, 토막마다 그 토막이 들어갈 수 있는 구간
 * (누적값이 상한을 넘는 글자까지)만 다시 본다. 토막마다 남은 줄 전체를 다시 세면 길이의 제곱에 비례한다.
 *
 * @param avail 토막 하나의 추정 토큰 상한
 * @returns 토막의 구간 (text 기준 위치)
 */
function splitLongLine(text: string, avail: number): Array<{ start: number; end: number }> {
  const segments: Array<{ start: number; end: number }> = [];
  const length = text.length;
  const lineSums = cumulativeTokens(text);
  /** 토막이 시작하는 자리에서 새로 센 누적값 (그 토막이 들어갈 수 있는 구간만큼) */
  const sums: number[] = [0];
  let offset = 0;

  while (offset < length) {
    // 남은 줄을 이 자리에서 새로 센 크기. 줄의 처음부터 센 값과는 처음 몇 글자의 값만 다를 수 있으므로
    // (낱말이 시작하는 자리에 더하는 값, 이어진 구분선 기호의 앞 글자들) 그 글자들만 새로 세고 나머지는 누적값의 차로 구한다
    const resync = Math.min(offset + RULE_RUN_START, length);
    let total = accumulateTokens(text, undefined, offset, resync) + (lineSums[length] - lineSums[resync]);
    if (total <= avail + SUM_TOLERANCE) {
      // 상한에 걸친 값은 누적값의 차에 든 부동소수점 오차로 판정이 바뀔 수 있다. 남은 줄을 처음부터 세어 정한다
      total = accumulateTokens(text, undefined, offset, length);
      if (total <= avail) {
        segments.push({ start: offset, end: length });
        break;
      }
    }

    // 이번 토막이 들어갈 수 있는 구간: 누적값이 상한을 넘는 글자까지 센다
    sums.length = 1;
    accumulateTokens(text, sums, offset, length, avail);
    const scanned = sums.length - 1;
    // 상한 안에서 가장 먼 자리(max)와, 남은 줄을 같은 크기로 나눈다고 할 때 이번 토막이 끝날 자리(target)
    const maxIndex = sums[scanned] > avail ? Math.max(1, scanned - 1) : scanned;
    const target = total / Math.ceil(total / avail);
    let targetIndex = 1;
    while (targetIndex < maxIndex && sums[targetIndex] < target) targetIndex += 1;
    let minIndex = 1;
    while (minIndex < targetIndex && sums[minIndex] < target / 2) minIndex += 1;

    // minIndex 이상 maxIndex 이하에서 target 에 가장 가까운 자리를 고른다. 구간 밖은 보지 않는다
    // (자르는 자리 뒤의 공백 한 글자까지가 구간이다)
    const window = text.slice(offset, offset + maxIndex + 1);
    const nearest = (pattern: RegExp): number => {
      let best = -1;
      pattern.lastIndex = 0;
      for (let match = pattern.exec(window); match !== null; match = pattern.exec(window)) {
        const at = match.index + match[0].length;
        if (at >= minIndex && (best < 0 || Math.abs(sums[at] - target) < Math.abs(sums[best] - target))) {
          best = at;
        }
      }
      return best;
    };

    let cut = nearest(SENTENCE_END_PATTERN);
    if (cut < 0) cut = nearest(WORD_GAP_PATTERN);
    if (cut < 0) {
      cut = targetIndex;
      // 서로게이트 쌍(이모지 등)의 가운데에서는 자르지 않는다
      const lastKept = text.charCodeAt(offset + cut - 1);
      if (lastKept >= 0xd800 && lastKept <= 0xdbff) {
        cut = cut > 1 ? cut - 1 : cut + 1;
      }
    }

    segments.push({ start: offset, end: offset + cut });
    let next = offset + cut;
    while (next < length && isSpaceCode(text.charCodeAt(next))) next += 1;
    offset = next;
  }

  return segments;
}

/** 조각 나누기의 비용: 앞의 항목부터 차례로 비교한다 */
type SplitCost = [
  inlineCuts: number,
  shortPieces: number,
  lineCuts: number,
  blockCuts: number,
  introCuts: number,
  pieces: number,
  squares: number,
];

function costLess(a: SplitCost, b: SplitCost): boolean {
  for (let k = 0; k < a.length; k++) {
    if (a[k] !== b[k]) return a[k] < b[k];
  }
  return false;
}

/**
 * 더 깊은 제목이 없는 글(lines[from..to))을 상한 이하의 조각으로 나눈다.
 *
 * 조각은 이어진 줄들의 묶음이고, 다음을 차례로 줄이는 나누기를 고른다 (동적 계획법).
 *   1. 줄 안에서 끊은 횟수. 한 줄이 상한보다 길 때만 생긴다
 *   2. 짧은 조각(minPieceChars 미만)의 수
 *   3. 문단 안의 줄 경계에서 끊은 횟수. 문단 경계에서 끊을 수 있으면 문단을 쪼개지 않는다
 *   4. 그 가운데 코드 블록이나 표의 안에서 끊은 횟수. 빈 줄 없이 이어진 글(목록 안의 코드 블록 등)에서도
 *      블록의 밖에 있는 줄 경계를 먼저 골라, 한 조각에 들어가는 블록을 쪼개지 않는다
 *   5. 코드 블록이나 표와 그것을 소개하는 앞의 글 사이에서 끊은 횟수. 블록이 설명 없이 조각의 처음에 오지 않게 한다
 *   6. 조각 수
 *   7. 조각 크기의 제곱합. 조각 수가 같으면 크기를 고르게 맞춘다 (마지막 조각만 짧게 남기지 않는다)
 *
 * 끊지 않는 자리: 여는 펜스 바로 뒤와 닫는 펜스 바로 앞(빈 코드 블록이 생긴다), 표의 머리 행·구분 행·첫 행 사이,
 * 제목 줄 바로 뒤(제목이 그 내용과 떨어진다. 제목 줄은 짧은 소절을 이웃에 붙인 묶음을 나눌 때만 여기에 온다).
 * 이 자리를 지키면 상한 안에서 나눌 수 없을 때만 이 자리에서도 끊는다.
 *
 * @param budget 조각 본문의 추정 토큰 상한
 * @returns 조각 목록. 구간(start, end)은 body 기준 위치다
 */
function splitIntoPieces(
  scanned: ScannedBody,
  from: number,
  to: number,
  budget: number,
  minPieceChars: number,
): GuideSectionPiece[] {
  const { body, lines, starts, kinds, openers, levels } = scanned;

  // 1) 표를 찾아 줄의 역할을 정한다
  const roles: LineRole[] = kinds.slice(from, to);
  const tableHeads = new Map<number, string>(); // 표의 본문 행 → 다시 넣을 머리
  const isTableRow = (index: number) => kinds[index] === 'text' && lines[index].includes('|') && lines[index].trim() !== '';
  for (let i = from; i + 1 < to; i++) {
    if (roles[i - from] !== 'text' || !isTableRow(i) || !isTableRow(i + 1)) continue;
    if (!TABLE_DELIMITER_PATTERN.test(lines[i + 1])) continue;
    const head = `${lines[i]}\n${lines[i + 1]}\n`;
    // 머리가 조각의 큰 부분을 차지하면 표로 다루지 않는다 (줄 경계에서 끊되 머리를 다시 넣지 않는다)
    if (estimateTokens(head) > budget * MAX_REPEATED_LINES_SHARE) continue;
    roles[i - from] = 'thead';
    roles[i + 1 - from] = 'tdelim';
    let row = i + 2;
    while (row < to && isTableRow(row)) {
      roles[row - from] = 'trow';
      tableHeads.set(row, head);
      row += 1;
    }
    i = row - 1;
  }

  // 2) 줄을 원자로 만든다. 펜스 밖의 빈 줄은 원자가 아니라 문단 경계다
  const atoms: Atom[] = [];
  let previousRole: LineRole | null = null;
  let afterHeading = false;
  let blankBefore = false;
  for (let i = from; i < to; i++) {
    const line = lines[i];
    const role = roles[i - from];
    if (role !== 'code' && line.trim() === '') {
      blankBefore = true;
      continue;
    }

    // 이 줄에서 조각이 시작하거나 이 줄 앞에서 조각이 끝날 때 덧붙일 줄
    let lead = '';
    let close = '';
    if (role === 'code') {
      const openerLine = lines[openers[i]];
      // 여는 펜스 줄이 아주 길면(긴 정보 문자열) 펜스를 닫고 다시 열지 않는다
      if (estimateTokens(openerLine) <= budget * MAX_REPEATED_LINES_SHARE) {
        const marker = (openerLine.match(FENCE_PATTERN) as RegExpMatchArray)[1];
        const indent = openerLine.slice(0, openerLine.length - openerLine.trimStart().length);
        lead = `${openerLine}\n`;
        close = `\n${indent}${marker}`;
      }
    } else if (role === 'trow') {
      lead = tableHeads.get(i) as string;
    }

    // 여는 펜스 바로 뒤, 닫는 펜스 바로 앞, 표의 머리 행·구분 행·첫 행 사이, 제목 줄 바로 뒤에서는 끊지 않는다
    const cuttable =
      previousRole !== 'open' &&
      role !== 'close' &&
      role !== 'tdelim' &&
      !(previousRole === 'tdelim' && role === 'trow') &&
      !afterHeading;
    const continuesCode = role === 'code' && previousRole === 'code';

    // 한 줄이 상한보다 길면 줄 안에서 토막을 낸다 (덧붙일 줄의 몫은 빼고 잰다)
    const leadTokens = estimateTokens(lead);
    const closeTokens = estimateTokens(close);
    const avail = Math.max(budget - leadTokens - closeTokens, budget / 4);
    const segments =
      estimateTokens(line) > avail ? splitLongLine(line, avail) : [{ start: 0, end: line.length }];
    segments.forEach((segment, index) => {
      // 같은 코드 블록의 줄 사이, 그리고 줄 안에서 끊을 때만 앞 조각의 펜스를 닫는다
      const closesFence = index > 0 || continuesCode;
      atoms.push({
        start: starts[i] + segment.start,
        end: starts[i] + segment.end,
        cuttable: index > 0 ? true : cuttable,
        boundary: index > 0 ? 2 : blankBefore ? 0 : 1,
        introduced: index === 0 && previousRole === 'text' && (role === 'open' || role === 'thead'),
        // 코드 줄과 닫는 펜스, 표의 구분 행과 본문 행은 언제나 같은 블록의 줄 뒤에 온다
        insideBlock: index === 0 && (role === 'code' || role === 'close' || role === 'tdelim' || role === 'trow'),
        lead,
        leadTokens,
        closeBefore: closesFence ? close : '',
        closeTokens: closesFence ? closeTokens : 0,
      });
    });

    previousRole = role;
    // 절 안의 제목 줄(### 이하)
    afterHeading = role === 'text' && levels[i] >= 3;
    blankBefore = false;
  }

  const count = atoms.length;
  if (count === 0) {
    return [];
  }

  // 3) 구간의 크기: 원자 사이의 글(줄바꿈, 빈 줄)은 공백이라 크기가 0 이다
  const sizes = new Float64Array(count + 1); // sizes[k] = atoms[0..k) 의 추정 토큰 합
  // 원자의 글이 시작하는 자리(앞 공백 제외)와 끝나는 자리(뒤 공백 제외). 공백뿐인 원자(코드 블록 안의 빈 줄)는 이웃 원자의 값을 따른다
  const textStarts = new Int32Array(count);
  const textEnds = new Int32Array(count);
  const blanks: boolean[] = [];
  for (let k = 0; k < count; k++) {
    const text = body.slice(atoms[k].start, atoms[k].end);
    sizes[k + 1] = sizes[k] + estimateTokens(text);
    blanks.push(text.trim() === '');
    textStarts[k] = atoms[k].start + (text.length - text.trimStart().length);
    textEnds[k] = atoms[k].end - (text.length - text.trimEnd().length);
  }
  for (let k = count - 1; k >= 0; k--) {
    if (blanks[k]) textStarts[k] = k + 1 < count ? textStarts[k + 1] : atoms[k].end;
  }
  for (let k = 0; k < count; k++) {
    if (blanks[k]) textEnds[k] = k > 0 ? textEnds[k - 1] : atoms[k].start;
  }
  // 절의 첫 조각에는 덧붙일 줄이 없고, 마지막 조각 뒤에는 닫을 펜스가 없다
  const leadOf = (first: number) => (first === 0 ? '' : atoms[first].lead);
  const trailOf = (last: number) => (last + 1 < count ? atoms[last + 1].closeBefore : '');
  const pieceTokens = (first: number, last: number) =>
    sizes[last + 1] -
    sizes[first] +
    (first === 0 ? 0 : atoms[first].leadTokens) +
    (last + 1 < count ? atoms[last + 1].closeTokens : 0);
  /**
   * atoms[first..last] 로 만든 조각이 절의 본문에서 맡는 구간과 덧붙일 줄.
   * 절의 첫 조각은 절의 본문처럼 앞의 공백을 뺀다. 뒤 조각은 시작하는 줄의 들여쓰기를 지킨다 (중첩 목록의 항목이나
   * 들여쓴 줄의 모양이 원문과 같다). 닫는 펜스를 붙이지 않는 조각은 뒤의 공백을 뺀다
   */
  const spanOf = (first: number, last: number) => {
    const lead = leadOf(first);
    const trail = trailOf(last);
    const start = first === 0 ? Math.min(textStarts[first], atoms[last].end) : atoms[first].start;
    const end = trail === '' ? Math.max(textEnds[last], atoms[first].start) : atoms[last].end;
    return { start, end, lead, trail };
  };
  /** 조각의 글자 수: 색인되는 본문(덧붙인 줄 포함, 앞뒤 공백 제외)의 길이 */
  const pieceChars = (first: number, last: number) => {
    const span = spanOf(first, last);
    return Math.max(0, span.end - span.start) + span.lead.length + span.trail.length;
  };

  // 4) 동적 계획법. best[j] = atoms[0..j) 를 나누는 가장 좋은 방법의 비용, cutFrom[j] = 그때 마지막 조각이 시작하는 원자
  const solve = (keepUncuttable: boolean): Array<[first: number, last: number]> | null => {
    const best: Array<SplitCost | null> = new Array(count + 1).fill(null);
    const cutFrom = new Int32Array(count + 1).fill(-1);
    best[0] = [0, 0, 0, 0, 0, 0, 0];
    for (let j = 1; j <= count; j++) {
      if (keepUncuttable && j < count && !atoms[j].cuttable) continue;
      const cutKind = j < count ? atoms[j].boundary : -1;
      for (let i = j - 1; i >= 0; i--) {
        // 본문만으로 상한을 넘으면 더 앞에서 시작하는 조각도 넘는다
        if (i < j - 1 && sizes[j] - sizes[i] > budget) break;
        const before = best[i];
        if (before === null) continue;
        const tokens = pieceTokens(i, j - 1);
        // 원자 하나가 상한을 넘는 경우(덧붙일 줄이 아주 긴 경우)에는 그 원자만으로 조각을 만든다
        if (tokens > budget && i < j - 1) continue;
        const candidate: SplitCost = [
          before[0] + (cutKind === 2 ? 1 : 0),
          before[1] + (pieceChars(i, j - 1) < minPieceChars ? 1 : 0),
          before[2] + (cutKind === 1 ? 1 : 0),
          before[3] + (cutKind === 1 && atoms[j].insideBlock ? 1 : 0),
          before[4] + (j < count && atoms[j].introduced ? 1 : 0),
          before[5] + 1,
          before[6] + tokens * tokens,
        ];
        const current = best[j];
        if (current === null || costLess(candidate, current)) {
          best[j] = candidate;
          cutFrom[j] = i;
        }
      }
    }
    if (best[count] === null) {
      return null;
    }
    const found: Array<[first: number, last: number]> = [];
    for (let j = count; j > 0; j = cutFrom[j]) {
      found.unshift([cutFrom[j], j - 1]);
    }
    return found;
  };

  // 끊지 않기로 한 자리끼리 묶인 줄들이 상한을 넘으면 (여는 펜스 줄과 첫 코드 줄이 둘 다 아주 긴 문서 등) 나눌 방법이 없다.
  // 그때는 그 자리에서도 끊게 해서 상한을 지킨다. 원자 하나로 된 조각은 언제나 만들 수 있으므로 두 번째는 반드시 풀린다
  const ranges = solve(true) ?? (solve(false) as Array<[first: number, last: number]>);

  return ranges.map(([first, last]) => {
    const { start, end, lead, trail } = spanOf(first, last);
    return { content: lead + body.slice(start, end) + trail, start, end, lead, trail };
  });
}

// ─── 문서를 절과 조각으로 나누기 ────────────────────────

/** 가이드 문서의 절 하나: 제목 경로가 같은 색인 단위 */
export interface GuideSection {
  /** 조각 번호를 붙이기 전의 title ("문서: 절 > 소절", 개요는 문서 제목) */
  title: string;
  /** 조각 번호를 붙이기 전의 section (제목 경로 "절 > 소절", 개요는 "개요") */
  section: string;
  /** 절의 본문 (앞뒤 공백 제거). 조각들의 구간이 이 문자열을 처음부터 끝까지 덮는다 */
  body: string;
  /** 문서 본문에서 body 가 시작하는 위치 */
  offset: number;
  /** 색인하는 조각. 조각이 하나면 그 본문이 body 와 같다 */
  pieces: GuideSectionPiece[];
}

/** 청킹이 문서에서 쓰는 값 */
interface GuideDocumentInfo {
  /** 가이드 디렉토리 기준 상대 경로 (POSIX 구분자) */
  source: string;
  layer: string;
  category: string;
  docTitle: string;
  url: string;
}

/** 문서 제목과 경로에서 청크의 공통 필드를 구한다. 구분자를 POSIX(/)로 맞춰 Windows 의 역슬래시 경로에서도 값이 같다 */
function describeDocument(frontmatter: { title: string; url?: string }, relativePath: string): GuideDocumentInfo {
  const source = relativePath.replace(/\\/g, '/');
  const pathParts = source.split('/');
  return {
    source,
    layer: pathParts[0] || 'unknown',
    category: pathParts.length > 2 ? pathParts[1] : '',
    docTitle: frontmatter.title || path.posix.basename(source, '.md'),
    url: frontmatter.url || '',
  };
}

/** ## 앞의 내용(개요)의 section 이름 */
const OVERVIEW_SECTION = '개요';

/**
 * 합친 묶음의 이름에 싣는, 합쳐진 소절 이름의 최대 수. 넘는 수는 ' 외 N개' 로 적는다.
 *
 * 합쳐진 소절의 제목 줄은 본문에도 그대로 있다. 이름을 모두 실으면 짧은 소절이 여럿 합쳐진 묶음의 제목이 길어지고,
 * 제목이 길어지는 만큼 본문에 쓸 수 있는 몫이 줄어든다.
 */
const MAX_MERGED_NAMES = 3;

/** 제목 경로의 한 마디: 제목 줄의 수준(2~6)과 문구 */
interface HeadingPart {
  level: number;
  text: string;
}

/**
 * 가이드 문서를 절로 나누고, 절마다 색인할 조각을 만든다.
 *
 * 절: ## 앞의 내용(개요)과 ## 제목마다의 내용. 본문이 50자 미만인 ## 절과 개요는 색인하지 않는다.
 * 임베딩 입력이 상한 안에 드는 절은 조각 하나다 (안에 있는 더 깊은 제목은 본문에 그대로 둔다).
 * 상한을 넘는 절은 그 안의 가장 얕은 제목에서 나누어 도입부와 소절을 각각 절로 만들고, 제목이 없으면
 * 문단, 줄, 줄 안의 순서로 조각을 낸다 (splitIntoPieces).
 *
 * 제목에서 나눈 결과는 버리지도 않고 짧은 청크로 남기지도 않는다. 짧은 것(minPieceChars 미만)은 이웃과 묶는다:
 * 짧은 소절은 제목 줄과 함께 앞의 것에 붙이고, 앞의 것이 짧으면 다음 소절을 끌어온다. 한 청크로 합칠 수 없으면
 * 짧은 것을 다음 소절 앞에(마지막이면 앞 묶음의 끝에) 붙이고, 붙인 묶음을 더 깊은 제목이나 조각으로 다시 나눈다.
 * 본문이 없는 제목 줄은 다음 소절과 묶어 제목 경로에 싣는다 (다음 소절의 제목 줄은 본문의 첫 줄로 남는다).
 *
 * 합친 묶음의 이름에는 합쳐진 소절의 이름을 함께 싣는다 ("설명 > Input / Output"). 합쳐진 소절을 제목 경로로도
 * 찾을 수 있게 하려는 것이다. 절의 도입부로 시작하는 묶음은 그 절의 첫 청크이므로 절의 이름만 쓴다.
 *
 * 돌려주는 절의 title 과 section 은 조각 번호를 붙이기 전의 값이다. 한 문서에서 제목 경로가 같은 절이 둘 이상
 * 조각으로 나뉘면 둘째부터 " [2]", " [3]" … 을 붙여, 조각 번호가 붙은 절의 section 이 문서 안에서 겹치지 않게 한다
 * (문서와 section, 조각 번호만으로 한 절의 이웃 조각을 가릴 수 있다).
 */
export function splitGuideSections(
  body: string,
  frontmatter: { title: string; url?: string },
  relativePath: string,
  options: GuideChunkOptions = {},
): GuideSection[] {
  const tokenBudget = options.tokenBudget ?? GUIDE_CHUNK_TOKEN_BUDGET;
  const minPieceChars = options.minPieceChars ?? GUIDE_PIECE_MIN_CHARS;
  const info = describeDocument(frontmatter, relativePath);
  const scanned = scanBody(body);
  const sections: GuideSection[] = [];

  /** ## 절의 제목 수준. 묶음을 만든 제목 수준(floor)이 이 값이면 ## 절이나 개요 전체다 */
  const SECTION_LEVEL = 2;
  /** 절 안의 제목 줄의 수준 (###~######). # 과 ## 는 절 안의 제목이 아니다 (0) */
  const innerLevel = (line: number) => (scanned.levels[line] > SECTION_LEVEL ? scanned.levels[line] : 0);

  // 제목 줄마다 그 제목을 품은 제목 줄 (## 절이나 개요 안에서 찾는다. 없으면 -1)
  const parents = new Int32Array(scanned.lines.length).fill(-1);
  const open: number[] = [];
  for (let i = 0; i < scanned.lines.length; i++) {
    const level = scanned.levels[i];
    if (level < 2) continue;
    while (open.length > 0 && scanned.levels[open[open.length - 1]] >= level) open.pop();
    parents[i] = open.length > 0 ? open[open.length - 1] : -1;
    open.push(i);
  }
  /** 제목 줄 head 까지의 제목 경로 (## 절의 제목부터. 개요 안의 제목은 개요 안에서만 따진다) */
  const pathOf = (head: number): HeadingPart[] => {
    const parts: HeadingPart[] = [];
    for (let line = head; line >= 0; line = parents[line]) {
      parts.unshift({ level: scanned.levels[line], text: scanned.headings[line] });
    }
    return parts;
  };

  const textOf = (span: { start: number; end: number }) => body.slice(span.start, span.end);
  /** lines[from..to) 의 글자 수 (앞뒤 공백 제외) */
  const charsOf = (from: number, to: number) => {
    const span = trimmedSpan(scanned, from, to);
    return span.end - span.start;
  };

  /** 짧다고 보는 글자 수: 긴 절을 나눈 결과로 생긴 도입부와 소절이 이보다 짧으면 이웃 묶음에 붙인다 */
  const shortChars = Math.max(minPieceChars, GUIDE_SECTION_MIN_CHARS);

  /**
   * 묶음 lines[from..to) 의 이름. startPath 는 묶음이 시작하는 자리의 제목 경로이고, floor 는 그 묶음을 만든 제목 수준이다
   * (## 절과 개요는 SECTION_LEVEL). 묶음 안에 있는 수준 floor 이하의 제목 줄이 그 묶음에 합쳐진 소절이다.
   *
   * 소절로 시작하는 묶음은 그 소절의 이름 뒤에 합쳐진 소절의 이름을 MAX_MERGED_NAMES 개까지 잇는다
   * (더 깊은 제목으로 내려가면 ' > ', 같은 수준이거나 얕은 제목으로 넘어가면 ' / '). 절의 도입부로 시작하는 묶음은
   * 절의 이름을 쓰고 그 절에 딸린 소절은 싣지 않는다 (그 절이 끝난 뒤에 합쳐진 소절은 싣는다). 다만 짧은 도입부를
   * 소절 앞에 붙였는데 한 청크에 들어가지 않는 묶음(whole 이 false)은 조각마다 그 소절의 내용이 이어지므로 딸린
   * 소절의 이름까지 싣는다. 개요 아래의 소절은 section 에만 '개요' 를 싣는다.
   *
   * @param whole 묶음이 한 청크에 들어갈 때의 이름인지 (다시 나눌 묶음이면 false)
   */
  const nameOf = (
    overview: boolean,
    startPath: HeadingPart[],
    from: number,
    to: number,
    floor: number,
    whole: boolean,
  ) => {
    const merged: HeadingPart[] = [];
    let firstMerged = to;
    for (let i = from; i < to; i++) {
      const level = innerLevel(i);
      if (level > 0 && level <= floor) {
        if (merged.length === 0) firstMerged = i;
        merged.push({ level, text: scanned.headings[i] });
      }
    }
    // 도입부로 시작하는 묶음: 시작하는 자리의 제목(절의 제목)보다 깊은 소절이 뒤따른다
    const startLevel = startPath.length > 0 ? startPath[startPath.length - 1].level : SECTION_LEVEL;
    const startsWithIntro = merged.length > 0 && merged[0].level > startLevel;
    const namesSection = startsWithIntro && (whole || charsOf(from, firstMerged) >= shortChars);
    // 절의 이름을 쓰는 묶음에서 그 절에 딸린 소절은 싣지 않는다. 그 절이 끝난 뒤의 소절(수준이 같거나 얕은 제목부터)은
    // 그 절의 내용이 아니므로 싣는다
    const firstOutside = merged.findIndex((part) => part.level <= startLevel);
    const candidates = namesSection ? (firstOutside < 0 ? [] : merged.slice(firstOutside)) : merged;
    const listed = candidates.slice(0, MAX_MERGED_NAMES);

    const parts = [...startPath, ...listed];
    let trail = '';
    parts.forEach((part, index) => {
      trail += index === 0 ? part.text : `${part.level > parts[index - 1].level ? ' > ' : ' / '}${part.text}`;
    });
    if (candidates.length > listed.length) {
      trail += ` 외 ${candidates.length - listed.length}개`;
    }
    if (overview) {
      return {
        title: trail ? `${info.docTitle}: ${trail}` : info.docTitle,
        section: trail ? `${OVERVIEW_SECTION} > ${trail}` : OVERVIEW_SECTION,
      };
    }
    return { title: `${info.docTitle}: ${trail}`, section: trail };
  };

  /**
   * 그 제목으로 색인할 때 본문에 쓸 수 있는 추정 토큰: 임베딩 입력의 상한에서 제목과 분류의 몫을 뺀 값.
   * 조각으로 나눌 때(numbered)는 제목에 붙을 조각 번호의 몫도 뺀다. 제목이 아주 길어도 상한의 4분의 1 은 본문 몫으로 남긴다.
   */
  const contentBudget = (title: string, numbered = false) => {
    const indexedTitle = numbered ? title + NUMBERING_ALLOWANCE : title;
    const overhead = estimateTokens(PASSAGE_PREFIX + guideSearchText(indexedTitle, '', info.layer, info.category));
    return Math.max(tokenBudget - overhead, tokenBudget / 4);
  };

  /**
   * lines[from..to) 를 색인한다. startPath 는 시작하는 자리의 제목 경로, floor 는 이 묶음을 만든 제목 수준이다 (nameOf 참고).
   * 길면 floor 보다 깊은 제목이나 조각으로 나눈다.
   */
  const addSection = (overview: boolean, startPath: HeadingPart[], from: number, to: number, floor: number): void => {
    const span = trimmedSpan(scanned, from, to);
    const text = textOf(span);
    // 50자 미만 규칙은 ## 절 전체와 개요 전체에만 적용한다. 나눈 결과로 생긴 묶음은 짧아도 버리지 않는다
    if (text.length === 0 || (floor === SECTION_LEVEL && text.length < GUIDE_SECTION_MIN_CHARS)) {
      return;
    }

    const toSection = (name: { title: string; section: string }, pieces: GuideSectionPiece[]): GuideSection => ({
      ...name,
      body: text,
      offset: span.start,
      pieces: pieces.map((piece) => ({ ...piece, start: piece.start - span.start, end: piece.end - span.start })),
    });

    const wholeName = nameOf(overview, startPath, from, to, floor, true);
    if (estimateTokens(text) <= contentBudget(wholeName.title)) {
      sections.push(toSection(wholeName, [{ content: text, start: span.start, end: span.end, lead: '', trail: '' }]));
      return;
    }

    // 이 묶음에 있는 가장 얕은 제목 수준 (floor 보다 깊은 것)
    let level = 0;
    for (let i = from; i < to; i++) {
      const candidate = innerLevel(i);
      if (candidate > floor && (level === 0 || candidate < level)) level = candidate;
    }
    if (level === 0) {
      const name = nameOf(overview, startPath, from, to, floor, false);
      sections.push(toSection(name, splitIntoPieces(scanned, from, to, contentBudget(name.title, true), minPieceChars)));
      return;
    }

    // 수준 level 이하의 제목 줄에서 도입부(첫 제목 앞의 글)와 소절로 나누고, 짧은 것은 이웃과 묶는다.
    // floor 이하의 제목 줄은 이 묶음에 붙여 둔 소절의 제목이다. 그 자리에서도 나누어 다시 묶는다
    const heads: number[] = [];
    for (let i = from; i < to; i++) {
      const candidate = innerLevel(i);
      if (candidate > 0 && candidate <= level) heads.push(i);
    }
    interface Group {
      startPath: HeadingPart[];
      from: number;
      to: number;
    }
    const groups: Group[] = [];
    /** group 을 lines[..upTo) 까지 늘려도 한 청크에 들어가는지. 늘린 묶음의 이름으로 잰다 (이름이 길어지는 만큼 본문 몫이 준다) */
    const fitsUpTo = (group: Group, upTo: number) =>
      estimateTokens(textOf(trimmedSpan(scanned, group.from, upTo))) <=
      contentBudget(nameOf(overview, group.startPath, group.from, upTo, level, true).title);

    // 도입부가 비어 있어도 첫 제목 줄이 이 묶음에 붙여 둔 소절의 제목이면 도입부 자리의 묶음을 둔다. 이 묶음의 이름에 실린
    // 제목(본문이 없는 제목 줄)이 그 소절의 조상이 아니어서, 여기서 이어받지 않으면 어느 청크의 이름에도 남지 않는다
    if (charsOf(from, heads[0]) > 0 || innerLevel(heads[0]) <= floor) {
      groups.push({ startPath, from, to: heads[0] });
    }
    heads.forEach((head, index) => {
      const childFrom = head + 1;
      const childTo = index + 1 < heads.length ? heads[index + 1] : to;
      const childChars = charsOf(childFrom, childTo);
      const previous = groups[groups.length - 1];
      if (previous) {
        const previousChars = charsOf(previous.from, previous.to);
        // 본문이 없는 제목 줄은 앞의 것 끝에 붙이지 않고 다음 소절과 묶는다 (앞의 것이 짧아서 이어 붙이는 중이면 함께 간다)
        const headingOnly = childChars === 0 && previousChars >= shortChars;
        if (!headingOnly && (childChars < shortChars || previousChars < shortChars) && fitsUpTo(previous, childTo)) {
          previous.to = childTo;
          return;
        }
        // 앞의 것이 짧은데 한 청크로 합칠 수 없다: 짧은 청크로 남기지 않고 이 소절 앞에 붙인다 (붙인 묶음은 다시 나뉜다)
        if (previousChars < shortChars) {
          previous.to = childTo;
          return;
        }
      }
      groups.push({ startPath: pathOf(head), from: childFrom, to: childTo });
    });
    // 마지막 묶음이 짧으면 붙일 다음 소절이 없다: 앞 묶음의 끝에 붙인다
    if (groups.length > 1) {
      const last = groups[groups.length - 1];
      if (charsOf(last.from, last.to) < shortChars) {
        groups.pop();
        groups[groups.length - 1].to = last.to;
      }
    }

    for (const group of groups) {
      addSection(overview, group.startPath, group.from, group.to, level);
    }
  };

  // 개요: 첫 ## 앞의 내용. 맨 앞의 # 제목 줄(문구가 없는 것 포함)은 뺀다
  const h2Lines: number[] = [];
  for (let i = 0; i < scanned.lines.length; i++) {
    if (scanned.levels[i] === 2) h2Lines.push(i);
  }
  const overviewEnd = h2Lines.length > 0 ? h2Lines[0] : scanned.lines.length;
  let overviewStart = 0;
  while (overviewStart < overviewEnd && scanned.lines[overviewStart].trim() === '') overviewStart += 1;
  if (
    overviewStart < overviewEnd &&
    scanned.kinds[overviewStart] === 'text' &&
    (scanned.levels[overviewStart] === 1 || /^#\s*$/.test(scanned.lines[overviewStart]))
  ) {
    overviewStart += 1;
  }
  addSection(true, [], overviewStart, overviewEnd, SECTION_LEVEL);

  // ## 절
  h2Lines.forEach((line, index) => {
    const end = index + 1 < h2Lines.length ? h2Lines[index + 1] : scanned.lines.length;
    addSection(false, pathOf(line), line + 1, end, SECTION_LEVEL);
  });

  // 조각 번호가 붙을 절의 section 이 문서 안에서 겹치지 않게 한다
  const numbered = new Set<string>();
  for (const section of sections) {
    if (section.pieces.length < 2) continue;
    let ordinal = 1;
    let candidate = section.section;
    while (numbered.has(candidate)) {
      ordinal += 1;
      candidate = `${section.section} [${ordinal}]`;
    }
    if (ordinal > 1) {
      section.title = `${section.title} [${ordinal}]`;
      section.section = candidate;
    }
    numbered.add(candidate);
  }

  return sections;
}

/**
 * 마크다운 문서를 색인할 청크로 나눈다 (splitGuideSections 의 절과 조각을 청크로 편 것).
 *
 * 조각이 하나뿐인 절의 title 은 "문서: 절", section 은 "절" 이고, 여러 조각으로 나뉜 절은 둘 다 끝에 " (k/n)" 이 붙는다.
 *
 * relativePath 는 가이드 디렉토리 기준 상대 경로다. 구분자를 POSIX(/)로 맞춘 뒤 layer 와
 * category 를 구하므로, Windows 의 역슬래시 경로가 와도 색인 내용(source, layer, category)이 같다.
 */
export function chunkMarkdown(
  body: string,
  frontmatter: { title: string; url?: string },
  relativePath: string,
  options: GuideChunkOptions = {},
): Omit<GuideChunk, 'id' | 'vector'>[] {
  const info = describeDocument(frontmatter, relativePath);
  const chunks: Omit<GuideChunk, 'id' | 'vector'>[] = [];

  for (const section of splitGuideSections(body, frontmatter, relativePath, options)) {
    const count = section.pieces.length;
    section.pieces.forEach((piece, index) => {
      const suffix = count > 1 ? ` (${index + 1}/${count})` : '';
      chunks.push({
        title: `${section.title}${suffix}`,
        content: piece.content,
        source: info.source,
        layer: info.layer,
        category: info.category,
        section: `${section.section}${suffix}`,
        docTitle: info.docTitle,
        url: info.url,
      });
    });
  }

  return chunks;
}
