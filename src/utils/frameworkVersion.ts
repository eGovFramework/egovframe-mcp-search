/**
 * 프레임워크 버전 표기 정규화.
 *
 * 호환 소프트웨어의 frameworkVersion 필터(tools/compatibility)와 키워드 검색(database/sqliteManager)이
 * 함께 쓴다. 두 곳이 같은 표기를 같은 버전으로 읽어야 하므로 한 곳에 둔다.
 */

/**
 * 프레임워크 버전 표기를 데이터의 표기(major.minor)에 맞춘다.
 *
 * 앞의 v 또는 V 를 떼고, x.y.z 꼴은 x.y 로 줄인다 ('v4.3.0' → '4.3').
 * 숫자가 아니라 문자열로 다룬다 ('3.10' 과 '3.1' 은 다른 버전이다).
 */
export function normalizeFrameworkVersion(value: string): string {
  const version = value.trim().replace(/^[vV](?=\s*\d)/, '').trim();
  const patched = /^(\d+\.\d+)\.\d+$/.exec(version);
  return patched ? patched[1] : version;
}
