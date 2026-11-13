/**
 * LanceDB where 절(DataFusion SQL) 조립 도우미.
 *
 * LanceDB 의 where() 는 매개변수 바인딩이 없어 조건을 문자열로 만들어야 한다.
 * 호출자가 준 값을 그대로 이어 붙이면 작은따옴표 하나로 질의가 깨지거나 조건이 바뀌므로
 * (예: `x' OR '1'='1`), 문자열 값은 반드시 이 모듈을 거쳐 리터럴로 만든다.
 * 컬럼 이름은 코드에 고정된 식별자만 넘긴다 (호출자 입력을 컬럼 이름으로 쓰지 않는다).
 */

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
