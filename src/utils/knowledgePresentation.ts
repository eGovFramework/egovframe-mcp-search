/**
 * 개발자 지식을 응답에 싣는 꼴로 다듬는 유틸.
 *
 * 지식 검색(tools/knowledge)과 호환 소프트웨어 조회의 관련 지식(tools/compatibility)이 제목을 같은 방식으로
 * 다듬어야 하므로 한 곳에 둔다.
 */

import { maskResidentNumbers } from './sensitiveText.js';
import { sliceHead } from './text.js';

/**
 * 응답에 싣는 제목을 다듬는다: NFC 로 정규화하고(macOS 파일 이름에서 온 제목이 NFD 로 색인되어 있다)
 * 주민등록번호 형식의 값을 가린다.
 */
export function presentTitle(title: unknown): string {
  return maskResidentNumbers(String(title ?? '').normalize('NFC'));
}

/** 줄바꿈과 연속 공백을 공백 하나로 바꾸고 앞뒤 공백을 뗀다. */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

const ELLIPSIS = '...';

/** UTF-16 코드 단위가 서로게이트 쌍의 앞쪽(high)인지 */
function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/** UTF-16 코드 단위가 서로게이트 쌍의 뒤쪽(low)인지 */
function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * 글에서 한 자리(at 부터 length 글자)를 가운데에 둔 발췌를 만든다. 길이는 UTF-16 코드 단위로 센다.
 *
 * - maxLength 는 생략 표시("...")를 포함한 전체 길이의 상한이다. 상한 이하인 글은 그대로 돌려준다.
 * - 앞을 잘랐으면 앞에, 뒤를 잘랐으면 뒤에 생략 표시를 붙인다. 한쪽에서 자를 글자가 생략 표시보다 길지 않으면
 *   그쪽은 자르지 않고 글의 끝까지 싣는다 (세 글자를 버리고 세 글자짜리 표시를 붙이지 않는다).
 * - 자른 자리의 공백은 싣지 않고, 서로게이트 쌍(이모지 등)의 가운데에서는 자르지 않는다.
 * - at 이 글의 범위를 벗어나면 가까운 끝으로 맞춘다. 생략 표시를 양쪽에 붙일 수 없을 만큼 작은 maxLength 에서는
 *   앞에서부터 자르기만 한다.
 *
 * 줄바꿈 정리나 가림 처리는 하지 않는다. 가려야 할 값이 있는 글은 가린 뒤에 넘긴다 (자른 뒤에 가리면 값의 일부가
 * 남는다).
 */
export function excerptAround(text: string, at: number, length: number, maxLength: number): string {
  const limit = Math.max(0, Math.floor(maxLength));
  if (text.length <= limit) {
    return text;
  }
  if (limit <= 2 * ELLIPSIS.length) {
    return sliceHead(text, limit);
  }

  const focus = Math.min(Math.max(0, at), text.length);
  const center = focus + Math.max(0, length) / 2;

  // 양쪽을 모두 자른다고 보고 창을 잡은 뒤, 한쪽 끝에 닿으면 그쪽의 생략 표시만큼 창을 넓힌다
  const inner = limit - 2 * ELLIPSIS.length;
  let start = Math.round(center - inner / 2);
  let end = start + inner;
  if (start <= ELLIPSIS.length) {
    start = 0;
    end = limit - ELLIPSIS.length;
  } else if (end >= text.length - ELLIPSIS.length) {
    end = text.length;
    start = text.length - (limit - ELLIPSIS.length);
  }

  if (start > 0 && isLowSurrogate(text.charCodeAt(start))) {
    start += 1;
  }
  if (end < text.length && isHighSurrogate(text.charCodeAt(end - 1))) {
    end -= 1;
  }

  const cutHead = start > 0;
  const cutTail = end < text.length;
  let body = text.slice(start, end);
  if (cutHead) {
    body = body.trimStart();
  }
  if (cutTail) {
    body = body.trimEnd();
  }
  return `${cutHead ? ELLIPSIS : ''}${body}${cutTail ? ELLIPSIS : ''}`;
}
