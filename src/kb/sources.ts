/**
 * 지식베이스 원격 소스 채널 정의
 *
 * update CLI / build-index 가 접근하는 원격 끝점은 전부 이 모듈의 코드
 * 상수로만 조립한다 — 사용자/LLM 입력으로 URL 이 바뀌는 경로를 차단한다
 * (피드 위장·SSRF 방지). override 는 환경변수 명시 시에만 허용.
 *
 * 가이드·공통컴포넌트는 별도 발행물 없이 GitHub 이 태그마다 자동 생성하는
 * 소스 tarball 을 그대로 사용한다 — 저장소 쪽 추가 관리 작업이 없다.
 */

import { httpGetJson } from '../utils/download.js';
import { filterVersionTags } from '../scripts/templateSources.js';
import { MANIFEST_FILENAME, SNAPSHOT_FILENAME } from './snapshot.js';

// ─── 저장소 좌표 ─────────────────────────────────────────

export interface RepoRef {
  owner: string;
  repo: string;
}

/** eGovFrame 가이드 문서 (templateSources 의 클론 URL 과 동일 저장소) */
export const DOCS_REPO: RepoRef = { owner: 'egovframework', repo: 'egovframe-docs' };

/**
 * 공식 가이드가 게시되는 사이트(GitHub Pages)의 기준 주소.
 * 가이드 청크의 url(Hugo permalink, 예: /egovframe-runtime/...)을 이 뒤에 붙이면 문서 주소가 된다.
 */
export const GUIDE_SITE_BASE_URL = 'https://egovframework.github.io/egovframe-docs';

/** 공통컴포넌트 소스 */
export const COMPONENTS_REPO: RepoRef = { owner: 'eGovFramework', repo: 'egovframe-common-components' };

/** 지식베이스 릴리스 저장소 — 개발자 지식 스냅샷과 호환성 SW JSON 자산을 게시 */
export const SNAPSHOT_REPO: RepoRef = { owner: 'eGovFramework', repo: 'egovframe-mcp-search-upload-data' };

// ─── URL 조립 ────────────────────────────────────────────

/**
 * 개발자 지식 스냅샷 릴리스 다운로드 베이스 URL.
 * EGOV_MCP_UPDATE_URL 환경변수를 명시한 경우에만 override 된다.
 */
export function getSnapshotBaseUrl(): string {
  const override = process.env.EGOV_MCP_UPDATE_URL;
  if (override && override.trim() !== '') {
    return override.replace(/\/+$/, '');
  }
  // releases/latest/download 리다이렉트 경로 — 익명, api.github.com 미경유
  return `https://github.com/${SNAPSHOT_REPO.owner}/${SNAPSHOT_REPO.repo}/releases/latest/download`;
}

export function snapshotManifestUrl(): string {
  return `${getSnapshotBaseUrl()}/${MANIFEST_FILENAME}`;
}

export function snapshotFileUrl(): string {
  return `${getSnapshotBaseUrl()}/${SNAPSHOT_FILENAME}`;
}

/** GitHub 이 태그마다 자동 생성하는 소스 tarball */
export function sourceTarballUrl(ref: RepoRef, tag: string): string {
  return `https://github.com/${ref.owner}/${ref.repo}/archive/refs/tags/${encodeURIComponent(tag)}.tar.gz`;
}

/**
 * 호환성 SW JSON 릴리스 자산 URL 후보 (순서대로 시도).
 * 스냅샷과 동일한 릴리스 저장소에서 받는다. 운영 계획상의 경로 형식
 * (compatibility/ 접두)을 우선 시도하고, GitHub 릴리스 자산명이 슬래시를
 * 허용하지 않는 제약에 대비해 평탄화된 자산명 형식을 폴백으로 둔다.
 */
export function compatibilityJsonUrls(tag: string): string[] {
  const base = `https://github.com/${SNAPSHOT_REPO.owner}/${SNAPSHOT_REPO.repo}/releases/download/${encodeURIComponent(tag)}`;
  return [
    `${base}/compatibility/compatibility-software.json`,
    `${base}/compatibility-software.json`,
  ];
}

export function tagsApiUrl(ref: RepoRef): string {
  return `https://api.github.com/repos/${ref.owner}/${ref.repo}/tags?per_page=100`;
}

// ─── 버전 태그 비교/조회 ─────────────────────────────────

/**
 * 버전 태그 비교 (내림차순 정렬용으로는 (a,b)=>compareVersionTag(b,a)).
 * 숫자부를 자리별 비교하고, 숫자부가 같으면 접미사 없는 태그가 우선.
 */
export function compareVersionTag(a: string, b: string): number {
  const parse = (t: string) => {
    const m = t.trim().match(/^v?(\d+(?:\.\d+)*)(.*)$/);
    if (!m) return null;
    return { nums: m[1].split('.').map(Number), suffix: m[2] };
  };
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return a.localeCompare(b, 'en');

  const len = Math.max(pa.nums.length, pb.nums.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa.nums[i] ?? 0) - (pb.nums[i] ?? 0);
    if (diff !== 0) return diff;
  }
  // 숫자부 동일 — 접미사 없는 쪽이 "정식 릴리스" 로 더 크다
  if (pa.suffix === '' && pb.suffix !== '') return 1;
  if (pa.suffix !== '' && pb.suffix === '') return -1;
  return pa.suffix.localeCompare(pb.suffix, 'en');
}

/** GitHub tags API 응답에서 버전 태그만 내림차순으로 추출 */
export function extractVersionTags(apiResponse: unknown): string[] {
  if (!Array.isArray(apiResponse)) {
    throw new Error('태그 목록 응답 형식이 올바르지 않습니다');
  }
  const names = apiResponse
    .map((entry) => (typeof entry === 'object' && entry !== null ? (entry as { name?: unknown }).name : undefined))
    .filter((name): name is string => typeof name === 'string');

  const sorted = [...names].sort((a, b) => compareVersionTag(b, a));
  return filterVersionTags(sorted);
}

/**
 * 원격 버전 태그 목록 조회 (내림차순, 버전 형태만).
 * 익명 API 시간당 60회 제한이 있으나 호출은 리소스당 1회뿐이다.
 */
export async function listRemoteVersionTags(
  ref: RepoRef,
  fetchJson: (url: string) => Promise<unknown> = (url) => httpGetJson(url, { maxBytes: 2 * 1024 * 1024 }),
): Promise<string[]> {
  return extractVersionTags(await fetchJson(tagsApiUrl(ref)));
}
