/**
 * SQLite LIKE 패턴에서 사용자 입력을 리터럴로 취급하기 위한 이스케이프.
 *
 * LIKE 는 `%`(임의 길이) 와 `_`(한 글자) 를 와일드카드로 해석하므로,
 * 사용자 키워드를 그대로 `%${keyword}%` 에 끼워 넣으면 `test_1` 같은 입력이
 * 의도치 않은 행을 매칭한다. 이 함수로 이스케이프한 값은 반드시
 * `LIKE ? ESCAPE '\'` 형태의 절과 함께 사용해야 한다.
 */
export function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
