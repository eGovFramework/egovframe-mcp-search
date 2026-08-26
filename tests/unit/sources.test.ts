/**
 * 원격 소스 채널 정의(kb/sources) 단위 테스트 — 네트워크 미사용 (fetch 주입)
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  compareVersionTag,
  extractVersionTags,
  listRemoteVersionTags,
  getSnapshotBaseUrl,
  sourceTarballUrl,
  DOCS_REPO,
} from '../../src/kb/sources.js';

describe('compareVersionTag', () => {
  it('숫자부를 자리별로 비교한다', () => {
    expect(compareVersionTag('v5.0.2', 'v5.0.1')).toBeGreaterThan(0);
    expect(compareVersionTag('v5.10.0', 'v5.9.0')).toBeGreaterThan(0);
    expect(compareVersionTag('5.0.6', 'v5.0.5')).toBeGreaterThan(0); // v 유무 무관
  });

  it('숫자부가 같으면 접미사 없는 태그가 정식 릴리스로 우선한다', () => {
    expect(compareVersionTag('v5.0.0', 'v5.0.0-ready-2026-contribution')).toBeGreaterThan(0);
  });
});

describe('extractVersionTags', () => {
  it('API 응답에서 버전 태그만 내림차순으로 추출한다', () => {
    const api = [
      { name: 'v5.0.0-ready-2026-contribution' },
      { name: 'v5.0.1' },
      { name: 'latest' }, // 버전 형태 아님 → 제외
      { name: 'v4.9.0' },
    ];
    expect(extractVersionTags(api)).toEqual(['v5.0.1', 'v5.0.0-ready-2026-contribution', 'v4.9.0']);
  });

  it('배열이 아니면 거부한다', () => {
    expect(() => extractVersionTags({ message: 'rate limited' })).toThrow(/형식/);
  });
});

describe('listRemoteVersionTags', () => {
  it('주입된 fetcher 로 태그 API 를 1회 호출한다', async () => {
    const calls: string[] = [];
    const tags = await listRemoteVersionTags(DOCS_REPO, async (url) => {
      calls.push(url);
      return [{ name: 'v5.0.1' }, { name: 'v5.0.0' }];
    });
    expect(tags).toEqual(['v5.0.1', 'v5.0.0']);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('api.github.com/repos/egovframework/egovframe-docs/tags');
  });
});

describe('URL 조립', () => {
  afterEach(() => {
    delete process.env.EGOV_MCP_UPDATE_URL;
  });

  it('스냅샷 베이스 URL 은 releases/latest/download 리다이렉트 경로다', () => {
    expect(getSnapshotBaseUrl()).toBe(
      'https://github.com/eGovFramework/egovframe-mcp-search-upload-data/releases/latest/download',
    );
  });

  it('EGOV_MCP_UPDATE_URL 명시 시에만 override 된다 (후행 슬래시 정리)', () => {
    process.env.EGOV_MCP_UPDATE_URL = 'https://mirror.example.com/kb/';
    expect(getSnapshotBaseUrl()).toBe('https://mirror.example.com/kb');
  });

  it('소스 tarball URL 은 태그 자동 생성 경로다', () => {
    expect(sourceTarballUrl(DOCS_REPO, 'v5.0.1')).toBe(
      'https://github.com/egovframework/egovframe-docs/archive/refs/tags/v5.0.1.tar.gz',
    );
  });
});
