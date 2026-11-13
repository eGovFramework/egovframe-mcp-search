/**
 * 문자열 유틸
 */

/**
 * 문자열을 앞에서부터 최대 maxLength 글자(UTF-16 코드 단위)까지만 남긴다.
 *
 * 자르는 위치가 서로게이트 쌍(이모지 등)의 가운데에 걸리면 한 단위 덜 잘라,
 * 짝 없는 서로게이트가 남지 않게 한다.
 */
export function sliceHead(text: string, maxLength: number): string {
  const limit = Math.max(0, Math.floor(maxLength));
  if (text.length <= limit) {
    return text;
  }
  const lastKept = text.charCodeAt(limit - 1);
  const splitsSurrogatePair = lastKept >= 0xd800 && lastKept <= 0xdbff;
  return text.slice(0, splitsSurrogatePair ? limit - 1 : limit);
}
