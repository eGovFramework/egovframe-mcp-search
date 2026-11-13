/**
 * 업체명 비교용 정규화.
 *
 * 호환 소프트웨어 데이터에는 같은 업체가 '㈜아이액츠', '(주)아이액츠', '주식회사 아이액츠' 처럼 여러 표기로
 * 들어 있다. 업체명으로 거를 때는 법인 표기와 공백의 차이를 없앤 값끼리 견준다.
 */

/**
 * 업체명을 견줄 때 떼는 문자열. 적힌 순서대로 하나씩, 나오는 곳마다 뗀다.
 *
 * - 공백류(공백, 탭, 줄 바꿈 없는 공백, 전각 공백)를 법인 표기보다 먼저 뗀다. '( 주 )' 나 '주 식 회 사' 처럼
 *   띄어 쓴 표기도 그 뒤에 법인 표기로 떼어진다.
 * - 법인 표기: ㈜, (주), 전각 괄호의 （주）, 주식회사.
 *
 * SQL 쪽(database/sqliteManager)이 컬럼 값에 같은 목록을 같은 순서로 적용하므로, 목록을 바꾸면 양쪽이 함께 바뀐다.
 */
export const VENDOR_IGNORED_SEQUENCES: readonly string[] = [
  ' ',
  '\t',
  '\u00a0', // 줄 바꿈 없는 공백
  '\u3000', // 전각 공백
  '㈜',
  '(주)',
  '\uFF08주\uFF09', // 전각 괄호의 （주）
  '주식회사',
];

/**
 * 업체명에서 법인 표기와 공백을 뗀다 ('주식회사 아이액츠' → '아이액츠', '세원IT ㈜' → '세원IT').
 * 법인 표기와 공백뿐인 값은 빈 문자열이 된다. 영문자의 대소문자는 바꾸지 않는다.
 */
export function stripVendorDesignation(value: string): string {
  return VENDOR_IGNORED_SEQUENCES.reduce((text, sequence) => text.split(sequence).join(''), value);
}
