/**
 * tar.gz 안전 해제 유틸 (외부 의존성 없음)
 *
 * GitHub 소스 tarball / 반입 아카이브를 오버레이 디렉토리에 푸는 용도.
 * 신뢰 채널 전제이지만 파서 안전장치는 항상 적용한다:
 *  - 절대 경로·`..` 탈출 엔트리 거부 (path traversal)
 *  - 심볼릭/하드 링크 엔트리 건너뜀 (링크 타깃 검증 복잡성 회피)
 *  - gzip 폭탄 가드 (zlib maxOutputLength) + 엔트리 수 상한
 *  - 해제 결과가 destDir 하위인지 resolve 재검증
 *
 * 지원 포맷: ustar(name+prefix), GNU 'L' longname, pax 'x' 확장 헤더(path).
 * 헤더 체크섬은 검증하지 않는다 (관용 파서 — 손상 아카이브는 크기/경로
 * 가드에서 걸리거나 이후 검증 프로브에서 드러난다).
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export interface ExtractOptions {
  /** 선두 경로 세그먼트 제거 수 (GitHub tarball 의 `<repo>-<ref>/` 제거용). 기본 0 */
  stripComponents?: number;
  /** true 반환 엔트리만 해제 (상대 경로 기준, strip 적용 후) */
  filter?: (relPath: string) => boolean;
  /** 압축 해제 총량 상한 (bytes). 기본 1GiB */
  maxTotalBytes?: number;
  /** 엔트리 수 상한. 기본 50,000 */
  maxEntries?: number;
}

export interface ExtractStats {
  files: number;
  dirs: number;
  /** 필터 제외·링크·strip 미달로 건너뛴 엔트리 수 */
  skipped: number;
  totalBytes: number;
}

const BLOCK = 512;

/** tar.gz 파일을 destDir 에 안전 해제 */
export function extractTarGz(
  tarGzPath: string,
  destDir: string,
  opts: ExtractOptions = {},
): ExtractStats {
  const {
    stripComponents = 0,
    filter,
    maxTotalBytes = 1024 * 1024 * 1024,
    maxEntries = 50_000,
  } = opts;

  const compressed = fs.readFileSync(tarGzPath);
  let tarBuf: Buffer;
  try {
    tarBuf = zlib.gunzipSync(compressed, { maxOutputLength: maxTotalBytes });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') {
      throw new Error(`압축 해제 결과가 상한(${maxTotalBytes}B)을 초과합니다 (gzip 폭탄 가드)`);
    }
    throw new Error('gzip 해제에 실패했습니다 — 아카이브가 손상되었을 수 있습니다');
  }

  const destResolved = path.resolve(destDir);
  fs.mkdirSync(destResolved, { recursive: true });

  const stats: ExtractStats = { files: 0, dirs: 0, skipped: 0, totalBytes: 0 };
  let offset = 0;
  let entryCount = 0;
  /** GNU 'L' / pax 'x' 가 지정한 다음 엔트리의 경로 override */
  let pendingLongName: string | null = null;

  while (offset + BLOCK <= tarBuf.length) {
    const header = tarBuf.subarray(offset, offset + BLOCK);
    if (isZeroBlock(header)) break; // 아카이브 끝

    if (++entryCount > maxEntries) {
      throw new Error(`엔트리 수가 상한(${maxEntries})을 초과합니다`);
    }

    const typeflag = String.fromCharCode(header[156]);
    const size = parseOctal(header, 124, 12);
    const dataStart = offset + BLOCK;
    const dataEnd = dataStart + size;
    if (dataEnd > tarBuf.length) {
      throw new Error('아카이브가 중간에서 잘렸습니다');
    }
    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK;

    // 메타 엔트리: 다음 실제 엔트리의 경로를 결정
    if (typeflag === 'L') {
      pendingLongName = tarBuf.subarray(dataStart, dataEnd).toString('utf-8').replace(/\0+$/, '');
      continue;
    }
    if (typeflag === 'x') {
      const paxPath = parsePaxPath(tarBuf.subarray(dataStart, dataEnd).toString('utf-8'));
      if (paxPath !== null) pendingLongName = paxPath;
      continue;
    }
    if (typeflag === 'g') continue; // 전역 pax — 적용하지 않음

    const rawName = pendingLongName ?? readUstarName(header);
    pendingLongName = null;

    // ── 경로 안전 검사 ──
    const normalized = normalizeEntryPath(rawName);
    if (normalized === null) {
      throw new Error(`위험한 경로 엔트리를 거부합니다: ${rawName.slice(0, 120)}`);
    }

    // strip components
    const segments = normalized.split('/');
    if (segments.length <= stripComponents) {
      stats.skipped++;
      continue;
    }
    const relPath = segments.slice(stripComponents).join('/');
    if (relPath === '') {
      stats.skipped++;
      continue;
    }

    if (filter && !filter(relPath)) {
      stats.skipped++;
      continue;
    }

    // 링크류는 해제하지 않는다
    if (typeflag === '1' || typeflag === '2') {
      stats.skipped++;
      continue;
    }

    const outPath = path.resolve(destResolved, relPath);
    if (outPath !== destResolved && !outPath.startsWith(destResolved + path.sep)) {
      throw new Error(`해제 경로가 대상 디렉토리를 벗어납니다: ${relPath.slice(0, 120)}`);
    }

    if (typeflag === '5') {
      fs.mkdirSync(outPath, { recursive: true });
      stats.dirs++;
      continue;
    }

    if (typeflag === '0' || typeflag === '\0' || typeflag === '7') {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, tarBuf.subarray(dataStart, dataEnd));
      stats.files++;
      stats.totalBytes += size;
      continue;
    }

    // 그 외 타입(fifo, char/block device 등)은 건너뜀
    stats.skipped++;
  }

  return stats;
}

// ─── 내부 헬퍼 ───────────────────────────────────────────

function isZeroBlock(block: Buffer): boolean {
  for (let i = 0; i < block.length; i++) {
    if (block[i] !== 0) return false;
  }
  return true;
}

function parseOctal(buf: Buffer, start: number, len: number): number {
  const field = buf.subarray(start, start + len);
  // base-256 (GNU 대용량) 은 지원하지 않는다 — 상한 가드가 어차피 차단할 크기
  if (field[0] & 0x80) {
    throw new Error('base-256 크기 필드는 지원하지 않습니다');
  }
  const text = field.toString('ascii').replace(/\0/g, ' ').trim();
  if (text === '') return 0;
  const value = parseInt(text, 8);
  if (Number.isNaN(value) || value < 0) {
    throw new Error('tar 헤더의 크기 필드가 손상되었습니다');
  }
  return value;
}

function readUstarName(header: Buffer): string {
  const name = header.subarray(0, 100).toString('utf-8').replace(/\0+$/, '');
  const magic = header.subarray(257, 262).toString('ascii');
  if (magic === 'ustar') {
    const prefix = header.subarray(345, 500).toString('utf-8').replace(/\0+$/, '');
    if (prefix !== '') return `${prefix}/${name}`;
  }
  return name;
}

/** pax 확장 헤더 레코드("len key=value\n")에서 path 를 추출 */
function parsePaxPath(data: string): string | null {
  let pos = 0;
  while (pos < data.length) {
    const spaceIdx = data.indexOf(' ', pos);
    if (spaceIdx < 0) break;
    const recordLen = parseInt(data.slice(pos, spaceIdx), 10);
    if (!Number.isFinite(recordLen) || recordLen <= 0) break;
    const record = data.slice(spaceIdx + 1, pos + recordLen);
    const eqIdx = record.indexOf('=');
    if (eqIdx > 0) {
      const key = record.slice(0, eqIdx);
      const value = record.slice(eqIdx + 1).replace(/\n$/, '');
      if (key === 'path') return value;
    }
    pos += recordLen;
  }
  return null;
}

/**
 * 엔트리 경로 정규화 + 위험 판정.
 * @returns 정규화된 상대 경로(posix 구분자), 위험하면 null
 */
function normalizeEntryPath(rawName: string): string | null {
  if (rawName.includes('\0')) return null;
  const posix = rawName.replace(/\\/g, '/');
  if (posix.startsWith('/') || /^[A-Za-z]:/.test(posix)) return null; // 절대 경로
  const segments: string[] = [];
  for (const seg of posix.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') return null; // 상위 탈출
    segments.push(seg);
  }
  if (segments.length === 0) return null;
  return segments.join('/');
}
