/**
 * download 유틸 단위 테스트 — 로컬 HTTP 서버로 크기 상한·부분 파일 정리를 검증.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import { downloadToFile, httpGetJson, probeReachable } from '../../src/utils/download.js';

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/small.json') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
    } else if (req.url === '/big.bin') {
      // content-length 없이 100KB 스트리밍 (러닝 사이즈 가드 검증)
      res.write(Buffer.alloc(50_000));
      res.end(Buffer.alloc(50_000));
    } else if (req.url === '/declared-big.bin') {
      res.setHeader('content-length', '1000000');
      res.end(Buffer.alloc(1_000_000));
    } else {
      res.statusCode = 404;
      res.end('not found');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as import('node:net').AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
});

describe('download utils', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'egov-dl-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('httpGetJson 이 JSON 을 파싱한다', async () => {
    const result = await httpGetJson(`${baseUrl}/small.json`);
    expect(result).toEqual({ ok: true });
  });

  it('httpGetJson 이 404 를 사용자 친화 에러로 변환한다', async () => {
    await expect(httpGetJson(`${baseUrl}/missing.json`)).rejects.toThrow(/HTTP 404/);
  });

  it('downloadToFile 이 파일을 받고 크기를 보고한다', async () => {
    const dest = path.join(tmpDir, 'out.bin');
    const { bytes } = await downloadToFile(`${baseUrl}/big.bin`, dest);
    expect(bytes).toBe(100_000);
    expect((await fs.stat(dest)).size).toBe(100_000);
  });

  it('선언된 content-length 가 상한을 넘으면 즉시 거부한다', async () => {
    const dest = path.join(tmpDir, 'out.bin');
    await expect(
      downloadToFile(`${baseUrl}/declared-big.bin`, dest, { maxBytes: 10_000 }),
    ).rejects.toThrow(/상한/);
  });

  it('스트리밍 중 상한 초과 시 중단하고 부분 파일을 남기지 않는다', async () => {
    const dest = path.join(tmpDir, 'out.bin');
    await expect(
      downloadToFile(`${baseUrl}/big.bin`, dest, { maxBytes: 60_000 }),
    ).rejects.toThrow(/상한/);
    expect(await fs.pathExists(dest)).toBe(false);
    const leftovers = (await fs.readdir(tmpDir)).filter((f) => f.includes('.download-'));
    expect(leftovers).toHaveLength(0);
  });

  it('probeReachable — 도달 가능/불가 판정', async () => {
    expect(await probeReachable(`${baseUrl}/small.json`)).toBe(true);
    expect(await probeReachable('http://127.0.0.1:1/none', 500)).toBe(false);
  });
});
