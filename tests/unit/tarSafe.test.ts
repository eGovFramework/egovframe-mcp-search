/**
 * tarSafe 단위 테스트 — JS 로 tar 엔트리를 직접 조립해 파서 가드를 검증한다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { extractTarGz } from '../../src/utils/tarSafe.js';

interface FixtureEntry {
  name: string;
  content?: string;
  typeflag?: string; // 기본 '0' (파일), '5' 디렉토리, '2' 심링크, 'L' GNU longname, 'x' pax
}

/** 최소 유효 tar 헤더 조립 (파서는 체크섬을 검증하지 않는다) */
function makeHeader(name: string, size: number, typeflag: string): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf-8');
  header.write(size.toString(8).padStart(11, '0') + ' ', 124, 12, 'ascii');
  header.write(typeflag, 156, 1, 'ascii');
  header.write('ustar', 257, 'ascii');
  return header;
}

function makeTarGz(entries: FixtureEntry[]): Buffer {
  const parts: Buffer[] = [];
  for (const e of entries) {
    const data = Buffer.from(e.content ?? '', 'utf-8');
    parts.push(makeHeader(e.name, data.length, e.typeflag ?? '0'));
    if (data.length > 0) {
      const padded = Buffer.alloc(Math.ceil(data.length / 512) * 512);
      data.copy(padded);
      parts.push(padded);
    }
  }
  parts.push(Buffer.alloc(1024)); // 종료 제로 블록 2개
  return zlib.gzipSync(Buffer.concat(parts));
}

describe('extractTarGz', () => {
  let tmpDir: string;
  let destDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'egov-tar-'));
    destDir = path.join(tmpDir, 'out');
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  async function writeFixture(entries: FixtureEntry[]): Promise<string> {
    const p = path.join(tmpDir, 'fixture.tar.gz');
    await fs.writeFile(p, makeTarGz(entries));
    return p;
  }

  it('파일과 디렉토리를 해제한다', async () => {
    const tar = await writeFixture([
      { name: 'repo-abc/', typeflag: '5' },
      { name: 'repo-abc/a.md', content: '# hello' },
      { name: 'repo-abc/sub/b.txt', content: 'world' },
    ]);
    const stats = extractTarGz(tar, destDir, { stripComponents: 1 });

    expect(stats.files).toBe(2);
    expect(await fs.readFile(path.join(destDir, 'a.md'), 'utf-8')).toBe('# hello');
    expect(await fs.readFile(path.join(destDir, 'sub', 'b.txt'), 'utf-8')).toBe('world');
  });

  it('stripComponents 미달 엔트리와 필터 제외 엔트리는 건너뛴다', async () => {
    const tar = await writeFixture([
      { name: 'root-only.txt', content: 'x' }, // strip 1 → 미달
      { name: 'repo/keep.md', content: 'k' },
      { name: 'repo/drop.jpg', content: 'd' },
    ]);
    const stats = extractTarGz(tar, destDir, {
      stripComponents: 1,
      filter: (rel) => rel.endsWith('.md'),
    });

    expect(stats.files).toBe(1);
    expect(stats.skipped).toBe(2);
    expect(await fs.pathExists(path.join(destDir, 'keep.md'))).toBe(true);
    expect(await fs.pathExists(path.join(destDir, 'drop.jpg'))).toBe(false);
  });

  it('`..` 탈출 엔트리를 거부한다', async () => {
    const tar = await writeFixture([{ name: '../evil.txt', content: 'x' }]);
    expect(() => extractTarGz(tar, destDir)).toThrow(/위험한 경로/);
    expect(await fs.pathExists(path.join(tmpDir, 'evil.txt'))).toBe(false);
  });

  it('절대 경로 엔트리를 거부한다', async () => {
    const tar = await writeFixture([{ name: '/tmp/evil.txt', content: 'x' }]);
    expect(() => extractTarGz(tar, destDir)).toThrow(/위험한 경로/);
  });

  it('심볼릭 링크 엔트리는 해제하지 않는다', async () => {
    const tar = await writeFixture([
      { name: 'link', typeflag: '2' },
      { name: 'ok.txt', content: 'ok' },
    ]);
    const stats = extractTarGz(tar, destDir);
    expect(stats.files).toBe(1);
    expect(stats.skipped).toBe(1);
    expect(await fs.pathExists(path.join(destDir, 'link'))).toBe(false);
  });

  it('GNU longname(L) 엔트리가 다음 엔트리의 경로를 결정한다', async () => {
    const longName = 'repo/' + 'deep/'.repeat(30) + 'file.md';
    const tar = await writeFixture([
      { name: '././@LongLink', typeflag: 'L', content: longName },
      { name: 'repo/truncated', content: 'long-content' },
    ]);
    const stats = extractTarGz(tar, destDir, { stripComponents: 1 });
    expect(stats.files).toBe(1);
    expect(
      await fs.readFile(path.join(destDir, ...'deep/'.repeat(30).split('/').filter(Boolean), 'file.md'), 'utf-8'),
    ).toBe('long-content');
  });

  it('pax(x) 확장 헤더의 path 레코드를 적용한다', async () => {
    const paxPath = 'repo/pax-name.md';
    const record = `path=${paxPath}\n`;
    const recordLen = record.length + String(record.length + 3).length + 1;
    const paxData = `${recordLen} ${record}`;
    const tar = await writeFixture([
      { name: 'repo/PaxHeader', typeflag: 'x', content: paxData },
      { name: 'repo/ignored-name', content: 'pax-content' },
    ]);
    const stats = extractTarGz(tar, destDir, { stripComponents: 1 });
    expect(stats.files).toBe(1);
    expect(await fs.readFile(path.join(destDir, 'pax-name.md'), 'utf-8')).toBe('pax-content');
  });

  it('압축 해제 총량 상한을 넘으면 중단한다 (gzip 폭탄 가드)', async () => {
    const tar = await writeFixture([{ name: 'big.bin', content: 'A'.repeat(100_000) }]);
    expect(() => extractTarGz(tar, destDir, { maxTotalBytes: 10_000 })).toThrow(/상한|폭탄/);
  });

  it('엔트리 수 상한을 넘으면 중단한다', async () => {
    const entries = Array.from({ length: 20 }, (_, i) => ({ name: `f${i}.txt`, content: 'x' }));
    const tar = await writeFixture(entries);
    expect(() => extractTarGz(tar, destDir, { maxEntries: 5 })).toThrow(/엔트리 수/);
  });

  it('잘린 아카이브를 감지한다', async () => {
    const full = makeTarGz([{ name: 'a.txt', content: 'A'.repeat(600) }]);
    const raw = zlib.gunzipSync(full);
    const truncated = zlib.gzipSync(raw.subarray(0, 700)); // 데이터 블록 중간에서 절단
    const p = path.join(tmpDir, 'trunc.tar.gz');
    await fs.writeFile(p, truncated);
    expect(() => extractTarGz(p, destDir)).toThrow(/잘렸|손상/);
  });
});
