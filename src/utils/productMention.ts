/**
 * 호환 소프트웨어의 제품명을 글과 견주는 유틸.
 *
 * - nameWithoutParentheses: 제품명에서 괄호로 붙은 설명을 뺀, 글이 제품을 부르는 이름
 * - findProductMention: 글이 그 이름을 언급하는 자리
 */

/** 괄호(전각 포함)와 그 안의 내용. 안에 다른 괄호가 없는 가장 안쪽 것과 일치한다. */
const PARENTHESIZED = /[(\uFF08][^()\uFF08\uFF09]*[)\uFF09]/g;

/**
 * 제품명에서 괄호와 그 안의 내용을 뺀 이름. 지식 글이 제품을 부르는 이름과 견주는 데 쓴다.
 *
 * 제품명에는 설명이 괄호로 붙어 있는 것이 많다 ('Morpheus CMS(모피어스 CMS)', 'AI+(플러스) CMS',
 * 'ALPAS v1.0 (도서관리 시스템)'). 글은 제품을 'Morpheus CMS' 처럼 부르므로 전체 이름으로는 찾지 못한다.
 * 괄호를 빼고 남는 것이 없으면 제품명을 그대로 쓴다.
 */
export function nameWithoutParentheses(productName: string): string {
  let name = productName;
  let previous: string;
  // 겹친 괄호는 안쪽부터 차례로 뺀다
  do {
    previous = name;
    name = name.replace(PARENTHESIZED, ' ');
  } while (name !== previous);

  name = name.replace(/\s+/g, ' ').trim();
  return name === '' ? productName.trim() : name;
}

/**
 * ASCII 영문자만 소문자로 바꾼다 (SQLite 의 NOCASE·LIKE 와 같은 기준).
 * 글자 수가 바뀌지 않으므로, 바꾼 문자열에서 찾은 자리가 원래 문자열의 자리와 같다.
 */
export function lowerAscii(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

/** 글자 하나가 ASCII 영문자나 숫자인지. 글의 끝을 벗어난 자리(undefined)는 아니다. */
function isAsciiAlphanumeric(char: string | undefined): boolean {
  return char !== undefined && /^[A-Za-z0-9]$/.test(char);
}

/** 대소문자까지 같아야 일치로 보는 제품명의 최대 길이 (공백을 뺀 글자 수) */
const MAX_CASE_SENSITIVE_NAME_LENGTH = 4;

/**
 * 대소문자까지 같아야 일치로 보는 제품명인지: 공백을 뺀 길이가 4자 이하이고 ASCII 영문자와 숫자뿐인 이름.
 * 이런 이름(ICE, HMS, CESS)은 소문자로 쓰면 흔한 낱말이나 식별자와 겹친다 (ice, 프로젝트 이름 hms).
 */
function isCaseSensitiveName(name: string): boolean {
  const compact = name.replace(/\s+/g, '');
  return compact.length <= MAX_CASE_SENSITIVE_NAME_LENGTH && /^[A-Za-z0-9]+$/.test(compact);
}

/**
 * 글(text)이 제품명(name)을 언급하는 첫 자리를 돌려준다 (UTF-16 코드 단위 기준). 언급이 없으면 -1.
 *
 * 제품명이 글에 부분 문자열로 들어 있다고 그 제품을 언급하는 것은 아니다. 제품 'CESS' 는 access-denied-page 에,
 * 'xFRAME' 은 xframeoptions 에, 'HMS' 는 프로젝트 이름 hms 에 들어 있다. 그래서 다음 두 조건을 건다.
 * - 낱말 경계: 제품명의 첫 글자가 ASCII 영문자나 숫자이면 일치한 자리의 바로 앞 글자가, 끝 글자가 그러면 바로
 *   뒤 글자가 ASCII 영문자나 숫자가 아니어야 한다. 제품명의 끝이 한글이나 기호인 쪽에는 걸지 않는다
 *   (한글 뒤에는 조사가 붙는다).
 * - 대소문자: 공백을 뺀 길이가 4자 이하이고 ASCII 영문자와 숫자뿐인 제품명은 대소문자까지 같아야 한다.
 *   그 밖의 제품명은 ASCII 영문자의 대소문자를 가리지 않는다.
 *
 * 조건을 채우지 못한 자리는 건너뛰고 그 뒤의 자리를 이어서 찾는다. 빈 제품명은 어디에도 일치하지 않는다.
 */
export function findProductMention(text: string, name: string): number {
  if (name === '') {
    return -1;
  }
  const caseSensitive = isCaseSensitiveName(name);
  const haystack = caseSensitive ? text : lowerAscii(text);
  const needle = caseSensitive ? name : lowerAscii(name);
  const boundaryBefore = isAsciiAlphanumeric(name[0]);
  const boundaryAfter = isAsciiAlphanumeric(name[name.length - 1]);

  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    const before = at > 0 ? text[at - 1] : undefined;
    const after = text[at + needle.length];
    if ((!boundaryBefore || !isAsciiAlphanumeric(before)) && (!boundaryAfter || !isAsciiAlphanumeric(after))) {
      return at;
    }
  }
  return -1;
}
