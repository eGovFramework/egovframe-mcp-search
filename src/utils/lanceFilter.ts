/**
 * LanceDB 질의 인자(where 절·limit) 조립 도우미.
 *
 * LanceDB 의 where() 는 매개변수 바인딩이 없어 조건(DataFusion SQL)을 문자열로 만들어야 한다.
 * 호출자가 준 값을 그대로 이어 붙이면 작은따옴표 하나로 질의가 깨지거나 조건이 바뀌므로
 * (예: `x' OR '1'='1`), 문자열 값은 반드시 이 모듈을 거쳐 리터럴로 만든다.
 * 컬럼 이름은 코드에 고정된 식별자만 넘긴다 (호출자 입력을 컬럼 이름으로 쓰지 않는다).
 *
 * limit 도 호출자가 준 값을 그대로 넘기지 않고 clampSearchLimit 으로 정리한다.
 */

/** 벡터 검색·최근 목록 한 번이 돌려주는 최대 건수 */
export const MAX_VECTOR_SEARCH_LIMIT = 100;

/**
 * limit 을 LanceDB 에 넘겨도 되는 건수로 정리한다.
 *
 * 정수로 내림한 뒤 1 이상 MAX_VECTOR_SEARCH_LIMIT 이하로 자른다. 숫자가 아니거나 유한하지 않은
 * 값(NaN, ±Infinity)은 fallback 을 쓴다.
 *
 * 검색은 인덱스를 건너뛴 전수 검색이라, 정리하지 않으면 음수나 아주 큰 값 한 번에 테이블 전체가
 * 결과로 나가고 (LanceDB 는 음수 limit 을 "제한 없음"으로 받는다) 0·1 미만의 소수·NaN 은
 * "k must be positive" 오류가 된다.
 */
export function clampSearchLimit(limit: unknown, fallback: number): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) {
    return fallback;
  }
  return Math.min(Math.max(Math.floor(limit), 1), MAX_VECTOR_SEARCH_LIMIT);
}

/**
 * 문자열을 SQL 문자열 리터럴로 만든다.
 * 작은따옴표는 두 번 써서 이스케이프한다. 이 방언에서 역슬래시는 이스케이프 문자가 아니다.
 */
export function lanceString(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** `column = '값'` 조건. */
export function lanceEquals(column: string, value: string): string {
  return `${column} = ${lanceString(value)}`;
}

/**
 * `column IN ('a', 'b')` 조건. 값이 하나면 `column = 'a'` 로 만든다.
 * values 는 하나 이상이어야 한다.
 */
export function lanceIn(column: string, values: readonly string[]): string {
  if (values.length === 0) {
    throw new Error(`lanceIn: ${column} 에 비교할 값이 없습니다`);
  }
  if (values.length === 1) {
    return lanceEquals(column, values[0]);
  }
  return `${column} IN (${values.map(lanceString).join(', ')})`;
}

/**
 * `column NOT IN ('a', 'b')` 조건. values 는 하나 이상이어야 한다.
 */
export function lanceNotIn(column: string, values: readonly string[]): string {
  if (values.length === 0) {
    throw new Error(`lanceNotIn: ${column} 에 비교할 값이 없습니다`);
  }
  return `${column} NOT IN (${values.map(lanceString).join(', ')})`;
}

/**
 * 배열 컬럼이 values 가운데 하나라도 포함하면 참인 조건: `array_has_any(column, ['a', 'b'])`.
 * 값은 정확히 일치해야 한다 (대소문자 구분).
 */
export function lanceArrayHasAny(column: string, values: readonly string[]): string {
  return `array_has_any(${column}, [${values.map(lanceString).join(', ')}])`;
}

/**
 * 거부한 필터 값을 오류 문구에 넣을 수 있는 표기로 바꾼다.
 * 큰따옴표로 감싸고 제어 문자를 이스케이프하며, 긴 값은 앞부분만 보여 준다.
 */
export function quoteFilterValue(value: unknown): string {
  const MAX_LENGTH = 40;
  const text = String(value);
  return JSON.stringify(text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH)}…` : text);
}
