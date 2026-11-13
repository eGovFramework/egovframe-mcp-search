/**
 * 키워드 검색어 추출 유틸.
 *
 * 공통컴포넌트·호환 소프트웨어의 키워드 검색(database/sqliteManager 의 keywordSearch)은 query 에서
 * 검색어를 추출해 LIKE 부분 문자열 일치로 찾는다. 파일 이름은 검색어로 FTS5 MATCH 식을 조립하던 때의
 * 것이고, 지금은 MATCH 식을 만들지 않는다.
 *
 * - 검색어 추출: extractSearchTerms, joinedTermKeys, hasOrOperator, parseKeywordQuery
 * - 검색어로 쓰지 않는 낱말의 목록과 판정: ENGLISH_FUNCTION_WORDS, COMPATIBILITY_GENERIC_WORDS,
 *   COMPONENT_GENERIC_WORDS, isGenericTerm, dropGenericTerms
 * - 조사가 붙은 검색어를 조사 없는 꼴로 바꿔 보는 후보: particleStrippedForms
 * - 기호로 이은 검색어를 저장된 표기와 구분 기호가 달라도 견주는 패턴 (유연한 꼴): flexibleForm
 * - 영문 검색어가 낱말의 처음에서 일치했는지를 가리는 패턴: isEnglishTerm, wordStartGlobPattern
 */

/** 한 번의 키워드 검색에 쓰는 검색어 수 상한. 긴 문장이 조회 문을 비대하게 만드는 것을 막는다. */
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
 * 이 가운데 OR 만 검색 방식을 바꾼다 (hasOrOperator). 나머지는 검색어에서 빠질 뿐이다.
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
 *   OR 가 있었는지는 hasOrOperator 가 따로 알려 준다.
 * - 대소문자만 다른 중복은 처음 것만 남기고, 최대 maxTerms 개까지만 돌려준다.
 */
export function extractSearchTerms(raw: string, maxTerms: number = MAX_SEARCH_TERMS): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();

  for (const word of queryWords(raw)) {
    const key = word.text.toLowerCase();
    if (CONNECTIVE_WORDS.has(key) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    terms.push(word.text);
    if (terms.length >= maxTerms) {
      break;
    }
  }

  return terms;
}

/**
 * query 에서 다른 낱말과 공백 없이 기호로 이어 적힌 낱말을 소문자로 돌려준다
 * ('Q&A' 의 'q' 와 'a', 'on/off' 의 'on' 과 'off').
 *
 * extractSearchTerms 는 '&', '/' 같은 기호에서 낱말을 나누므로, 추출된 검색어만으로는 그 낱말이 따로 적힌
 * 것인지 다른 낱말에 붙여 적힌 것인지 알 수 없다. 영어 기능어를 가리는 isGenericTerm 이 이 구분을 쓴다.
 * 읽는 범위와 정규화는 extractSearchTerms 와 같다. 한 번이라도 이어 적힌 낱말은 이어 적힌 낱말로 본다.
 */
export function joinedTermKeys(raw: string): Set<string> {
  const keys = new Set<string>();
  for (const word of queryWords(raw)) {
    if (word.joined) {
      keys.add(word.text.toLowerCase());
    }
  }
  return keys;
}

/**
 * query 에 단독 낱말 OR 가 있는지 (대소문자를 가리지 않는다).
 *
 * extractSearchTerms 는 접속사를 검색어에서 빼기만 하므로, 추출된 검색어만으로는 'A OR B' 와 'A B' 를 가릴 수 없다.
 * 키워드 검색은 OR 가 있으면 모든 검색어가 일치하는 행을 먼저 찾지 않고, 검색어 가운데 하나 이상이 일치하는 행을
 * 찾는다 (database/sqliteManager 의 keywordSearch). AND, NOT, NEAR 는 검색어에서 빼기만 하고 따로 알리지 않는다:
 * 부정 검색과 근접 검색은 하지 않는다.
 *
 * 읽는 범위와 정규화는 extractSearchTerms 와 같다 (앞 MAX_KEYWORD_QUERY_LENGTH 자, 전각 'ＯＲ' 도 같다).
 * 'Oracle', 'and-or' 처럼 다른 낱말의 일부인 것은 해당하지 않는다. OR 의 앞이나 뒤에 검색어가 없어도 적혀 있으면 true 다.
 */
export function hasOrOperator(raw: string): boolean {
  return queryWords(raw).some((word) => word.text.toLowerCase() === 'or');
}

/** query 에서 읽어 낸 키워드 검색의 입력 */
export interface KeywordQuery {
  /** 검색어 (extractSearchTerms 의 결과) */
  terms: string[];
  /** 다른 낱말과 공백 없이 기호로 이어 적힌 낱말, 소문자 (joinedTermKeys 의 결과) */
  joinedTerms: ReadonlySet<string>;
  /** query 에 단독 낱말 OR 가 있는지 (hasOrOperator 의 결과) */
  orQuery: boolean;
}

/** query 에서 키워드 검색(database/sqliteManager 의 keywordSearch)에 필요한 것을 한 번에 읽어 낸다. */
export function parseKeywordQuery(raw: string): KeywordQuery {
  return { terms: extractSearchTerms(raw), joinedTerms: joinedTermKeys(raw), orQuery: hasOrOperator(raw) };
}

/** query 에서 읽어 낸 낱말 하나 */
interface QueryWord {
  /** 양끝의 '.', '-', '_' 를 뗀 낱말 */
  text: string;
  /** 앞이나 뒤의 낱말과 공백 없이 기호로 이어 적혔는지 */
  joined: boolean;
}

/**
 * query 를 낱말로 나눈다 (extractSearchTerms 의 주석에 적은 규칙: 앞 MAX_KEYWORD_QUERY_LENGTH 자, NFC, 반각 변환,
 * 문자·숫자와 `.` `-` `_` 가 이어진 것이 낱말). 접속사와 중복은 거르지 않고 적힌 순서대로 돌려준다.
 * 입력 길이에 비례하는 시간이 걸린다.
 */
function queryWords(raw: string): QueryWord[] {
  // 정규화보다 먼저 자른다 (긴 입력 전체를 정규화하지 않는다)
  const text = toHalfWidth(raw.slice(0, MAX_KEYWORD_QUERY_LENGTH).normalize('NFC'));

  const words: QueryWord[] = [];
  // 바로 앞 낱말이 끝난 자리. 그 자리부터 이번 낱말 앞까지가 두 낱말 사이의 글자들이다
  let previousEnd = -1;
  for (const match of text.matchAll(/[\p{L}\p{N}._-]+/gu)) {
    const word = trimEdgeSeparators(match[0]);
    if (!word || !/[\p{L}\p{N}]/u.test(word)) {
      continue;
    }
    const start = match.index ?? 0;
    // 두 낱말 사이에 공백이 하나도 없으면 기호로 이어 적은 것이다
    const joined = previousEnd !== -1 && !/\s/u.test(text.slice(previousEnd, start));
    if (joined) {
      words[words.length - 1].joined = true;
    }
    words.push({ text: word, joined });
    previousEnd = start + match[0].length;
  }
  return words;
}

/**
 * 검색어로 쓰지 않는 영어 기능어 (소문자로 비교한다). 어느 검색 대상에나 적용한다.
 *
 * 영어 문장으로 물을 때 섞이는 낱말이다. 부분 문자열로 견주면 제품명의 일부와 우연히 일치해
 * ('is' 는 'aXis'·'WISE' 와, 'with' 는 'WITHCMS' 와), 일부 검색어만 일치해도 되는 대체 검색에서
 * 찾는 제품과 무관한 행을 앞에 세운다. AND, OR, NOT, NEAR 는 CONNECTIVE_WORDS 가 따로 다룬다.
 *
 * 'was' 는 넣지 않는다. 호환 소프트웨어의 분류 'WAS' 와 같은 낱말이라, 넣으면 "국산 WAS", "WAS 추천" 에서
 * 분류 이름이 검색어에서 빠진다.
 */
export const ENGLISH_FUNCTION_WORDS: ReadonlySet<string> = new Set([
  ...['a', 'an', 'the'],
  ...['is', 'are', 'were', 'be', 'do', 'does', 'did', 'can', 'could', 'will', 'would', 'should'],
  ...['with', 'for', 'in', 'on', 'of', 'to', 'from', 'by', 'at', 'as'],
  ...['it', 'this', 'that', 'what', 'which', 'how'],
]);

/**
 * 프레임워크 자체를 가리키는 낱말 (소문자로 비교한다).
 * 호환 소프트웨어 목록과 공통컴포넌트 목록의 모든 항목이 이 프레임워크에 관한 것이라, 이 낱말로는 행을 가려낼
 * 수 없다. 'framework', '프레임워크', 'solution' 은 넣지 않는다 ('Framework Solution' 은 호환 소프트웨어의 분류다).
 */
const FRAMEWORK_WORDS: readonly string[] = [
  'egovframe',
  'egovframework',
  'egov',
  '전자정부',
  '표준프레임워크',
  '전자정부프레임워크',
  '전자정부표준프레임워크',
];

/** 공통컴포넌트 목록의 모든 항목에 해당하는 낱말 (소문자로 비교한다). 목록의 항목이 모두 컴포넌트다. */
const COMPONENT_WORDS: readonly string[] = ['컴포넌트', '공통컴포넌트', 'component', 'components'];

/** 호환 소프트웨어 검색에서, 목록의 모든 항목에 해당해 행을 가려 주지 못하는 낱말 */
export const COMPATIBILITY_GENERIC_WORDS: ReadonlySet<string> = new Set(FRAMEWORK_WORDS);

/** 공통컴포넌트 검색에서, 목록의 모든 항목에 해당해 행을 가려 주지 못하는 낱말 */
export const COMPONENT_GENERIC_WORDS: ReadonlySet<string> = new Set([...FRAMEWORK_WORDS, ...COMPONENT_WORDS]);

/** 이어 적힌 낱말이 없는 경우 (isGenericTerm, dropGenericTerms 의 기본값) */
const NO_JOINED_TERMS: ReadonlySet<string> = new Set();

/**
 * 낱말이 행을 가려 주지 못하는 낱말인지: 영어 기능어(ENGLISH_FUNCTION_WORDS)이거나, 검색 대상의 모든 항목에
 * 해당하는 낱말(targetWords)이다. 영문자의 대소문자는 가리지 않고, 낱말 전체가 목록의 낱말과 같아야 한다
 * ('within', 'egovframework.com.cop.bbs' 는 아니다).
 *
 * 대상의 모든 항목에 해당하는 낱말은 조사를 뗀 꼴(particleStrippedForms)이 목록에 있어도 같다
 * ('eGovFrame에서', '컴포넌트를'). 조사가 붙은 꼴은 그대로 쓰면 설명 문장에 우연히 든 행하고만 일치하고,
 * 떼어 쓰면 목록의 낱말 그대로일 때와 같은 문제를 일으킨다.
 * 영어 기능어에는 이 규칙을 적용하지 않는다. 영어 기능어 뒤에 한글이 붙은 꼴은 다른 낱말일 수 있다
 * ('IT서비스', 'AS센터').
 *
 * 영어 기능어는 query 에 따로 적힌 낱말일 때만 기능어로 본다. 다른 낱말과 기호로 이어 적힌 낱말(joinedTerms,
 * joinedTermKeys 의 결과)은 기능어가 아니다: 'Q&A' 의 'A' 는 관사가 아니고 'on/off' 의 'on' 은 전치사가 아니다.
 * 대상의 모든 항목에 해당하는 낱말은 이어 적혀 있어도 같은 것을 가리키므로 이 구분을 두지 않는다.
 */
export function isGenericTerm(
  term: string,
  targetWords: ReadonlySet<string>,
  joinedTerms: ReadonlySet<string> = NO_JOINED_TERMS,
): boolean {
  const key = term.toLowerCase();
  if (targetWords.has(key) || (ENGLISH_FUNCTION_WORDS.has(key) && !joinedTerms.has(key))) {
    return true;
  }
  return particleStrippedForms(term).some((form) => targetWords.has(form.toLowerCase()));
}

/**
 * 검색어에서 행을 가려 주지 못하는 낱말(isGenericTerm)을 뺀다.
 *
 * 다른 검색어가 남을 때만 뺀다. 빼고 나서 남는 검색어가 없으면 받은 검색어를 그대로 돌려준다:
 * 제품명에 'eGovframe' 이 든 제품을 그 낱말만으로 찾을 수 있어야 한다.
 * joinedTerms 는 query 에서 다른 낱말과 기호로 이어 적힌 낱말이다 (joinedTermKeys). 주지 않으면 모든 검색어를
 * 따로 적힌 낱말로 본다.
 */
export function dropGenericTerms(
  terms: string[],
  targetWords: ReadonlySet<string>,
  joinedTerms: ReadonlySet<string> = NO_JOINED_TERMS,
): string[] {
  const kept = terms.filter((term) => !isGenericTerm(term, targetWords, joinedTerms));
  return kept.length > 0 ? kept : terms;
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
 * 영문 검색어인지: ASCII 영문자와 숫자로만 되어 있고 영문자가 하나 이상 든 검색어 ('ECM', 'K2Web', 'R6').
 * 한글이나 기호(검색어 안쪽의 `.` `-` `_` 포함)가 든 검색어, 숫자뿐인 검색어('7', '2025'), 빈 문자열은 아니다.
 *
 * 키워드 검색은 이런 검색어에만 "낱말의 처음에서 일치했는가" 를 정렬 기준으로 쓴다 (wordStartGlobPattern).
 * 두세 글자 영문 검색어는 다른 낱말 속에서도 일치하지만('TimeCMS' 의 'ECM'), 한국어 복합어의 가운데에 든
 * 낱말('공통코드' 의 '코드')은 정상적인 일치라 한글이 든 검색어에는 그 기준을 쓰지 않는다.
 * 숫자뿐인 검색어에도 쓰지 않는다. 버전 숫자는 'v7', 'R6' 처럼 영문자 바로 뒤에 적는 일이 많은데, 그 자리는
 * 낱말의 처음이 아니다. 숫자에 이 기준을 쓰면 "Tibero 7" 에서 제품 버전 표기가 'Tibero v7' 인 행이, 설명에 날짜
 * '2017. 7. 14' 가 적혔을 뿐인 행보다 뒤로 밀린다.
 */
export function isEnglishTerm(term: string): boolean {
  return /^[A-Za-z0-9]+$/.test(term) && /[A-Za-z]/.test(term);
}

/** SQLite 의 GLOB 패턴에서 글자 하나를 글자 그대로(ASCII 영문자는 대소문자를 가리지 않고) 견주는 조각 */
function globLiteral(char: string): string {
  if (/^[A-Za-z]$/.test(char)) {
    return `[${char.toUpperCase()}${char.toLowerCase()}]`;
  }
  // GLOB 에서 뜻이 있는 문자는 문자 집합에 넣어 글자 그대로 견준다. ']' 는 집합의 첫 글자로 적으면 글자 그대로다
  if (char === '*' || char === '?' || char === '[' || char === ']') {
    return `[${char}]`;
  }
  return char;
}

/**
 * 값 안에서 검색어가 낱말의 처음에 나오는지를 가리는 SQLite GLOB 패턴을 만든다.
 * 낱말의 처음은 값의 맨 앞이거나, 바로 앞 글자가 ASCII 영문자가 아닌 자리다 (앞 글자가 숫자, 공백, 기호,
 * 한글이면 낱말의 처음이다. 'MC@CMS' 의 'CMS', '리포트ERS' 의 'ERS').
 *
 * 패턴은 값 앞에 공백 한 칸을 붙인 문자열과 견준다: `(' ' || 컬럼) GLOB ?`. 붙인 공백이 값의 맨 앞을
 * "앞 글자가 영문자가 아닌 자리" 로 만들어, 패턴 하나로 두 경우를 함께 가린다.
 * - LIKE 로는 "앞 글자가 영문자가 아님" 을 적을 수 없어 문자 집합(`[^A-Za-z]`)이 있는 GLOB 을 쓴다.
 * - GLOB 은 대소문자를 가리므로 검색어의 ASCII 영문자마다 두 꼴을 문자 집합으로 적는다 ('ecm' → `[Ee][Cc][Mm]`).
 *   LIKE 와 같이 ASCII 영문자만 대소문자를 가리지 않는다.
 * - GLOB 에서 뜻이 있는 문자(`*`, `?`, `[`, `]`)는 글자 그대로 견주도록 바꾼다. 키워드 검색은 영문자와
 *   숫자뿐인 영문 검색어(isEnglishTerm)만 넘기지만, 어떤 검색어를 받아도 와일드카드로 읽히지 않는다.
 *
 * 패턴은 조회 문에 끼워 넣지 않고 바인딩 값으로 넘긴다. 검색어는 길어야 MAX_KEYWORD_QUERY_LENGTH 자이고
 * 글자마다 4바이트 이하라, 패턴은 SQLite 의 패턴 길이 한도(50,000바이트)를 넘지 않는다.
 */
export function wordStartGlobPattern(term: string): string {
  return `*[^A-Za-z]${Array.from(term, globLiteral).join('')}*`;
}

/** ASCII 숫자 한 글자인지 (문자열의 범위를 벗어난 자리의 undefined 는 아니다) */
function isAsciiDigit(char: string | undefined): boolean {
  return char !== undefined && char >= '0' && char <= '9';
}

/**
 * 검색어를 유연한 자리에서 나눈 부분을 차례대로 돌려준다 ('K2Web-Wizard' → 'K2Web', 'Wizard').
 *
 * 유연한 자리는 검색어 안쪽의 `.` `-` `_` 가 이어진 묶음 가운데, 양옆 글자가 모두 ASCII 숫자인 것을 뺀 나머지다.
 * 숫자 사이의 묶음은 버전이나 날짜의 일부라 부분 안에 글자 그대로 둔다 ('JEUS-8.5' → 'JEUS', '8.5').
 * 유연한 자리가 없으면 검색어 전체가 부분 하나다. term 은 양끝에 구분 문자가 없어야 한다.
 */
function flexibleParts(term: string): string[] {
  const parts: string[] = [];
  let current = '';
  let index = 0;
  while (index < term.length) {
    if (!isEdgeSeparator(term[index])) {
      current += term[index];
      index += 1;
      continue;
    }
    let end = index;
    while (end < term.length && isEdgeSeparator(term[end])) {
      end += 1;
    }
    if (isAsciiDigit(term[index - 1]) && isAsciiDigit(term[end])) {
      current += term.slice(index, end);
    } else {
      parts.push(current);
      current = '';
    }
    index = end;
  }
  parts.push(current);
  return parts;
}

/** 유연한 자리에 올 수 있는 글자 하나를 견주는 GLOB 조각: ASCII 영문자도 숫자도 한글 음절도 아닌 글자 (공백이나 기호) */
const FLEXIBLE_SEPARATOR_GLOB = '[^0-9A-Za-z가-힣]';

/** 기호로 이은 검색어의 유연한 꼴 (flexibleForm 의 결과) */
export interface FlexibleForm {
  /**
   * 검색어를 유연한 자리에서 나눈 부분 (둘 이상, 빈 문자열 없음). 유연한 꼴과 일치하는 값에는 이 부분들이 이 순서로
   * 들어 있다 (부분과 부분 사이에는 글자가 하나 있거나 없다). 호출부가 패턴을 견주기 전에 값을 미리 거르는 데 쓴다
   */
  parts: string[];
  /** 유연한 꼴을 견주는 GLOB 패턴: [모든 유연한 자리에 글자 하나가 온 꼴, 모든 유연한 자리가 붙은 꼴] */
  patterns: [string, string];
}

/**
 * 기호로 이은 검색어의 "유연한 꼴" 을 만든다: 견줄 SQLite GLOB 패턴 두 개와, 검색어를 유연한 자리에서 나눈 부분.
 * 유연한 자리가 없는 검색어는 null 이다.
 *
 * extractSearchTerms 는 식별자('4.3', 'spring-boot')를 한 검색어로 지키려고 `.` `-` `_` 를 검색어 안에 남긴다.
 * 그 검색어가 저장된 표기와 구분 기호만 달라도 부분 문자열로는 일치하지 않는다 ('K2Web-Wizard' 와 'K2Web Wizard',
 * 'sts_com' 과 'sts-com', 'Web-Square' 와 'WebSquare'). 유연한 꼴은 그 자리를 너그럽게 견준다.
 *
 * 1) 유연한 자리는 검색어 안쪽의 `.` `-` `_` 묶음 가운데 양옆 글자가 모두 ASCII 숫자인 것을 뺀 나머지다
 *    (flexibleParts). '8.5', '03-21' 의 구분 문자는 글자 그대로 견준다. 유연한 자리가 없으면 유연한 꼴도 없다
 *    ('4.3', '10.1', 'JEUS').
 * 2) 검색어를 유연한 자리에서 나눈 부분들이 순서대로 이어져 나오는 값과 일치한다. 유연한 자리에는
 *    (가) ASCII 영문자도 숫자도 한글 음절도 아닌 글자 하나가 오거나 (나) 아무 글자도 오지 않는다.
 *    모든 자리에 (가)를 적용한 패턴과 모든 자리에 (나)를 적용한 패턴, 두 가지만 만든다 (자리마다 섞지 않는다).
 *    부분을 따로 찾지 않으므로, 부분 하나만 든 값과는 일치하지 않는다.
 * 3) 검색어의 첫 글자가 ASCII 영문자이면 일치한 자리의 바로 앞 글자가, 마지막 글자가 ASCII 영문자이면 바로 뒤
 *    글자가 ASCII 영문자가 아니어야 한다. 'S_CMS' 가 'TransCMS' 의 일부나 'S-CMSuite' 와 일치하지 않게 한다.
 *    첫 글자나 마지막 글자가 숫자나 한글이면 그쪽에는 조건을 두지 않는다 ('JEUS-8' 은 'JEUS 8.5' 와 일치한다).
 * 4) ASCII 영문자의 대소문자는 가리지 않는다 (wordStartGlobPattern 과 같은 방법).
 *
 * 패턴은 값의 앞뒤에 공백 한 칸씩을 붙인 문자열과 견준다: `(' ' || 컬럼 || ' ') GLOB ?`. 붙인 공백이 값의 맨 앞과
 * 맨 끝을 "영문자가 아닌 글자" 로 만들어, 3)의 조건을 패턴 하나로 가린다. 두 패턴 가운데 하나라도 일치하면 일치다.
 *
 * 패턴은 조회 문에 끼워 넣지 않고 바인딩 값으로 넘긴다. GLOB 에서 뜻이 있는 문자는 글자 그대로 견준다 (globLiteral).
 * 검색어는 길어야 MAX_KEYWORD_QUERY_LENGTH 자다. 패턴이 가장 길어지는 것은 영문자와 구분 문자가 번갈아 나올 때이고
 * (두 글자마다 23바이트), 그때도 약 23,000바이트라 SQLite 의 패턴 길이 한도(50,000바이트)를 넘지 않는다.
 * 양끝의 구분 문자는 없는 것으로 본다 (extractSearchTerms 가 추출한 검색어에는 없다).
 */
export function flexibleForm(term: string): FlexibleForm | null {
  const trimmed = trimEdgeSeparators(term);
  const parts = flexibleParts(trimmed);
  if (parts.length < 2) {
    return null;
  }
  const head = /^[A-Za-z]/.test(trimmed) ? '*[^A-Za-z]' : '*';
  const tail = /[A-Za-z]$/.test(trimmed) ? '[^A-Za-z]*' : '*';
  const literals = parts.map((part) => Array.from(part, globLiteral).join(''));
  return {
    parts,
    patterns: [`${head}${literals.join(FLEXIBLE_SEPARATOR_GLOB)}${tail}`, `${head}${literals.join('')}${tail}`],
  };
}

/** 영문·숫자·`.`·`-`·`_` 로만 된 앞부분 뒤에 한글 음절 1~3자가 붙은 꼴 ('JEUS는', '4.3에서') */
const ASCII_HEAD_WITH_HANGUL_TAIL = /^([A-Za-z0-9._-]+)[가-힣]{1,3}$/;

/** 낱말 끝에서 떼어 보는 조사. 긴 것부터 견준다 ('으로' 로 끝나는 낱말에서 '로' 만 떼지 않게 한다). */
const TRAILING_PARTICLES = [
  '으로',
  '에서',
  '에게',
  '부터',
  '까지',
  '은',
  '는',
  '이',
  '가',
  '을',
  '를',
  '와',
  '과',
  '의',
  '에',
  '도',
  '로',
];

/** 문자열의 글자 수 (코드 포인트 기준. String.length 는 UTF-16 단위라 한 글자가 2 로 나올 수 있다) */
export function codePointLength(value: string): number {
  return Array.from(value).length;
}

/**
 * 조사가 붙은 검색어('JEUS는', '티맥스는')를 조사 없는 꼴로 바꿔 볼 후보를, 먼저 견줄 것부터 돌려준다.
 * 키워드 검색은 검색어 그대로는 어떤 행과도 일치하지 않을 때만 이 후보를 견준다.
 *
 * 1) 영문·숫자·`.`·`-`·`_` 뒤에 한글 1~3자가 붙은 꼴이면 한글을 뗀 앞부분 ('JEUS는' → 'JEUS', '4.3에서' → '4.3').
 *    제품명과 버전은 영문·숫자라, 붙은 한글이 조사 목록에 없어도 뗀다 ('JEUS입니다' → 'JEUS').
 * 2) 조사로 끝나면 조사를 뗀 나머지 ('티맥스는' → '티맥스'). 맞는 조사 가운데 가장 긴 것 하나만 뗀다.
 *
 * 후보는 검색어와 같은 꼴을 지킨다: 양끝의 `.` `-` `_` 를 떼고, 두 글자 이상인 것만 돌려준다
 * (한 글자는 부분 문자열로 너무 많은 행과 일치한다). 맞는 규칙이 없으면 빈 배열이다.
 */
export function particleStrippedForms(term: string): string[] {
  const forms: string[] = [];
  const add = (stripped: string) => {
    const form = trimEdgeSeparators(stripped);
    if (codePointLength(form) >= 2 && !forms.includes(form)) {
      forms.push(form);
    }
  };

  const asciiHead = ASCII_HEAD_WITH_HANGUL_TAIL.exec(term);
  if (asciiHead) {
    add(asciiHead[1]);
  }

  const particle = TRAILING_PARTICLES.find((candidate) => term.endsWith(candidate));
  if (particle) {
    add(term.slice(0, -particle.length));
  }

  return forms;
}
