/**
 * 공식 가이드가 게시되는 사이트의 주소.
 *
 * 검색 서버와 인덱스 구축·갱신 코드가 함께 쓰는 상수라서, 다른 모듈을 import 하지 않는
 * 파일에 따로 둔다. (kb/sources 에 두면 검색 서버가 다운로드·git 실행·엑셀 파싱 모듈까지
 * 함께 불러오게 된다.)
 */

/**
 * 공식 가이드가 게시되는 사이트(GitHub Pages)의 기준 주소.
 * 가이드 청크의 url(Hugo permalink, 예: /egovframe-runtime/...)을 이 뒤에 붙이면 문서 주소가 된다.
 */
export const GUIDE_SITE_BASE_URL = 'https://egovframework.github.io/egovframe-docs';
