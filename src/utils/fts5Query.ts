/**
 * SQLite FTS5 키워드 검색용 질의 조립 유틸.
 *
 * 사용자 입력을 MATCH 에 그대로 넘기면 `.` `:` `?` 같은 문자가 FTS5 구문으로 해석되어
 * "fts5: syntax error near ..." 가 나므로, 검색어를 추출한 뒤 MATCH 식을 직접 조립한다.
 */

/** 한 번의 키워드 검색에 쓰는 검색어 수 상한. 긴 문장이 MATCH 식을 비대하게 만드는 것을 막는다. */
export const MAX_SEARCH_TERMS = 16;

/**
 * 키워드 추출에 쓰는 query 의 최대 길이 (String.length 기준, UTF-16 코드 단위).
 * 이보다 긴 query 는 앞부분만 읽는다. 검색어 하나의 길이와 추출에 드는 시간이 입력 크기와 무관하게 묶인다.
 */
export const MAX_KEYWORD_QUERY_LENGTH = 2000;

/**
 * 검색어로 쓰지 않는 영문 접속사 (소문자로 비교한다).
 * 검색 연산자처럼 적은 "JEUS OR Tibero", "JEUS and Tibero" 의 접속사를 검색어로 세면,
 * 그 낱말까지 일치하는 행을 찾느라 제품명이 일치하는 행을 놓친다.
 */
const CONNECTIVE_WORDS: ReadonlySet<string> = new Set(['and', 'or', 'not', 'near']);

/**
 * 키워드 질의에서 검색어를 추출한다.
 *
 * - query 의 앞 MAX_KEYWORD_QUERY_LENGTH 자만 읽는다 (경계에 걸친 낱말은 잘린 부분까지만 검색어가 된다).
 * - 유니코드 NFC 로 정규화한다 (자모가 분리된 한글 입력 대응).
 * - 전각 ASCII 는 반각으로, 전각 공백은 공백으로 바꾼다 (`ＣＭＳ` → `CMS`, `４．３` → `4.3`).
 * - 문자·숫자와 검색어 안쪽의 `.` `-` `_` 만 남기고, 그 밖의 문장부호와 공백은 구분자로 본다.
 *   (`4.3`, `egovframework.com.cop.bbs`, `spring-boot` 같은 식별자는 한 검색어로 유지된다.)
 * - 단독 낱말 AND, OR, NOT, NEAR 는 대소문자와 관계없이 검색어에서 뺀다 (`Android` 처럼 낱말의 일부인 것은 남긴다).
 * - 대소문자만 다른 중복은 처음 것만 남기고, 최대 maxTerms 개까지만 돌려준다.
 */
export function extractSearchTerms(raw: string, maxTerms: number = MAX_SEARCH_TERMS): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();

  // 정규화보다 먼저 자른다 (긴 입력 전체를 정규화하지 않는다)
  const text = toHalfWidth(raw.slice(0, MAX_KEYWORD_QUERY_LENGTH).normalize('NFC'));

  for (const candidate of text.split(/[^\p{L}\p{N}._-]+/u)) {
    const term = trimEdgeSeparators(candidate);
    if (!term || !/[\p{L}\p{N}]/u.test(term)) {
      continue;
    }
    const key = term.toLowerCase();
    if (CONNECTIVE_WORDS.has(key) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    terms.push(term);
    if (terms.length >= maxTerms) {
      break;
    }
  }

  return terms;
}

/** 전각 ASCII(U+FF01~U+FF5E)와 그에 대응하는 반각 문자(U+0021~U+007E)의 코드 차이 */
const FULLWIDTH_ASCII_OFFSET = 0xfee0;

/**
 * 전각 ASCII 를 반각으로, 전각 공백(U+3000)을 공백으로 바꾼다. 저장된 값은 반각이라 전각 입력은 어떤 행과도 일치하지 않는다.
 *
 * NFKC 전체를 적용하지 않고 이 범위만 바꾼다. NFKC 는 '㈜' 를 '(주)' 로 푸는 것처럼 다른 호환 문자까지 바꿔,
 * 저장된 값(업체명 '㈜티맥스티베로')에 없는 낱말을 만든다.
 */
function toHalfWidth(text: string): string {
  return text.replace(/[\uFF01-\uFF5E\u3000]/g, (char) =>
    char === '\u3000' ? ' ' : String.fromCharCode(char.charCodeAt(0) - FULLWIDTH_ASCII_OFFSET),
  );
}

/** 검색어 안쪽에서는 남기고 양끝에서는 떼는 문자: '.', '-', '_' */
function isEdgeSeparator(char: string): boolean {
  return char === '.' || char === '-' || char === '_';
}

/**
 * 양끝의 `.` `-` `_` 를 뗀다. 안쪽의 것은 그대로 둔다 (`..4.3-` → `4.3`).
 *
 * 앞뒤에서 한 번씩만 훑으므로 입력 길이에 비례하는 시간이 걸린다. 정규식 `/^[._-]+|[._-]+$/g` 로 떼면
 * 끝에 닿지 않는 구분 문자 줄의 자리마다 줄 끝까지 다시 훑어, 'a' 사이에 '.' 이 8만 개 든 입력에 약 3초가 걸린다.
 */
export function trimEdgeSeparators(candidate: string): string {
  let start = 0;
  let end = candidate.length;
  while (start < end && isEdgeSeparator(candidate[start])) {
    start += 1;
  }
  while (end > start && isEdgeSeparator(candidate[end - 1])) {
    end -= 1;
  }
  return candidate.slice(start, end);
}

/**
 * 검색어 목록으로 FTS5 MATCH 식을 만든다.
 *
 * 검색어마다 큰따옴표 구(phrase)로 감싸므로 AND/OR/NOT/NEAR 나 문장부호가 연산자로 해석되지 않고,
 * 끝에 `*` 를 붙여 접두 일치로 찾는다 ("권한" → "권한관리", "게시판" → "게시판에").
 * 검색어 사이는 공백(암묵적 AND)으로 결합한다. 검색어가 없으면 null.
 */
export function buildFts5MatchQuery(terms: string[]): string | null {
  if (terms.length === 0) {
    return null;
  }
  return terms.map((term) => `"${term.replaceAll('"', '')}"*`).join(' ');
}
