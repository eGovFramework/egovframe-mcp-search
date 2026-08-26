/**
 * update CLI 인자 파서 단위 테스트
 */
import { describe, it, expect } from 'vitest';
import { parseUpdateArgs, sanitizeVersionDirName } from '../../src/cli/update.js';

describe('parseUpdateArgs', () => {
  it('기본값 — 전체 리소스 대상', () => {
    const o = parseUpdateArgs([]);
    expect(o.resources).toEqual(['developer_knowledge', 'guide', 'common_components']);
    expect(o.check).toBe(false);
    expect(o.rollback).toBe(false);
  });

  it('--resource 별칭과 중복 제거', () => {
    const o = parseUpdateArgs(['--resource=knowledge,components,components']);
    expect(o.resources).toEqual(['developer_knowledge', 'common_components']);
  });

  it('`--flag=값` 과 `--flag 값` 둘 다 허용', () => {
    const eq = parseUpdateArgs(['--guide-tag=v5.0.1', '--from-file=/tmp/kb']);
    expect(eq.guideTag).toBe('v5.0.1');
    expect(eq.fromFileDir).toBe('/tmp/kb');

    const sp = parseUpdateArgs(['--guide-tag', 'v5.0.1', '--from-file', '/tmp/kb']);
    expect(sp.guideTag).toBe('v5.0.1');
    expect(sp.fromFileDir).toBe('/tmp/kb');
  });

  it('--rollback=<리소스> 는 대상 한정 롤백', () => {
    const o = parseUpdateArgs(['--rollback=guide']);
    expect(o.rollback).toBe(true);
    expect(o.rollbackTargets).toEqual(['guide']);
  });

  it('알 수 없는 옵션/리소스는 거부', () => {
    expect(() => parseUpdateArgs(['--unknown'])).toThrow(/알 수 없는 옵션/);
    expect(() => parseUpdateArgs(['--resource=sqlite'])).toThrow(/알 수 없는 리소스/);
  });

  it('값이 필요한 옵션에 값이 없으면 거부', () => {
    expect(() => parseUpdateArgs(['--from-file'])).toThrow(/값이 필요/);
    expect(() => parseUpdateArgs(['--guide-tag', '--yes'])).toThrow(/값이 필요/);
  });
});

describe('sanitizeVersionDirName', () => {
  it('버전 문자열을 안전한 디렉토리명으로 변환한다', () => {
    expect(sanitizeVersionDirName('2026-08-24.1')).toBe('v-2026-08-24.1');
    expect(sanitizeVersionDirName('v5.0.0-ready-2026-contribution')).toBe('v-v5.0.0-ready-2026-contribution');
    expect(sanitizeVersionDirName('한글/../탈출')).toBe('v--..-');
  });
});
