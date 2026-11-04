/**
 * HTTPS 다운로드 유틸 (update CLI / build-index 공용)
 *
 * 무결성 서명·해시 검증은 두지 않는다 (채널 신뢰 전제) — 대신 파서 안전장치는
 * 항상 적용한다: 타임아웃, 응답 크기 상한, 리다이렉트는 fetch 기본 동작에 위임.
 * 다운로드 URL 은 호출부에서 코드 상수로만 조립한다 (사용자/LLM 입력 배제).
 */

import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface FetchOptions {
  /** 요청 타임아웃 (ms). 기본 30초 */
  timeoutMs?: number;
  /** 응답 본문 크기 상한 (bytes). 초과 시 중단 */
  maxBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/** 도달성 프로브 — 실제 사용할 URL 에 HEAD (405 등이면 GET 폴백) */
export async function probeReachable(url: string, timeoutMs = 3_000): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
    if (res.ok) return true;
    if (res.status === 405 || res.status === 403) {
      const res2 = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
      // 본문은 버린다
      try { await res2.body?.cancel(); } catch { /* ignore */ }
      return res2.ok;
    }
    return false;
  } catch {
    return false;
  }
}

/** JSON 응답 다운로드 (크기 상한 적용) */
export async function httpGetJson(url: string, opts: FetchOptions = {}): Promise<unknown> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = 10 * 1024 * 1024 } = opts;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow',
    headers: { accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} — ${describeUrl(url)}`);
  }

  const contentLength = Number(res.headers.get('content-length') ?? '0');
  if (contentLength > maxBytes) {
    throw new Error(`응답 크기(${contentLength}B)가 상한(${maxBytes}B)을 초과합니다 — ${describeUrl(url)}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) {
    throw new Error(`응답 크기(${buf.byteLength}B)가 상한(${maxBytes}B)을 초과합니다 — ${describeUrl(url)}`);
  }
  return JSON.parse(buf.toString('utf-8'));
}

/**
 * URL 을 파일로 다운로드 (스트리밍 + 누적 크기 상한).
 * 임시 파일에 받은 뒤 rename — 부분 다운로드가 목적 파일로 남지 않는다.
 */
export async function downloadToFile(
  url: string,
  destPath: string,
  opts: FetchOptions = {},
): Promise<{ bytes: number }> {
  const { timeoutMs = 120_000, maxBytes = 500 * 1024 * 1024 } = opts;

  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status} — ${describeUrl(url)}`);
  }

  const contentLength = Number(res.headers.get('content-length') ?? '0');
  if (contentLength > maxBytes) {
    throw new Error(`다운로드 크기(${contentLength}B)가 상한(${maxBytes}B)을 초과합니다 — ${describeUrl(url)}`);
  }

  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const tmpPath = `${destPath}.download-${process.pid}`;

  let bytes = 0;
  const body = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream);
  const guard = async function* (source: AsyncIterable<Buffer>) {
    for await (const chunk of source) {
      bytes += chunk.byteLength;
      if (bytes > maxBytes) {
        throw new Error(`다운로드 크기가 상한(${maxBytes}B)을 초과했습니다 — ${describeUrl(url)}`);
      }
      yield chunk;
    }
  };

  try {
    await pipeline(body, guard, fs.createWriteStream(tmpPath));
    fs.renameSync(tmpPath, destPath);
    return { bytes };
  } catch (error) {
    try { fs.rmSync(tmpPath, { force: true }); } catch { /* ignore */ }
    throw error;
  }
}

/** 에러 메시지용 URL 표기 — 호스트+경로만 (쿼리 등 배제) */
function describeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return '(URL)';
  }
}
