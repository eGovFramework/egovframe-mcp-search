/**
 * 공통컴포넌트 소스 파일 읽기(readSourceFileInRoot) 단위 테스트
 *
 * readSource 는 호출자가 준 경로의 파일을 읽으므로, 소스 루트 밖의 파일이 읽히면 안 된다.
 * 또 글꼴·문서 같은 바이너리를 텍스트로 돌려주거나 큰 파일을 통째로 돌려주면 응답이
 * 수 MB 가 되므로, 내용으로 바이너리를 판정하고 텍스트는 구간으로 나눠 읽는다.
 * 임시 디렉토리에 소스 루트와 그 바깥 파일을 만들어 실제 파일 시스템으로 검증한다
 * (저장소의 소스 트리는 읽기만 하고, 지식베이스 DB 는 열지 않는다).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SOURCE_READ_MAX_CHARS, readSourceFileInRoot } from '../../src/tools/commonComponents.js';

const REPO_ROOT = path.resolve(__dirname, '../..');
/** 저장소에 동봉된 공통컴포넌트 소스 트리 (읽기만 한다) */
const SRC_ROOT = path.join(REPO_ROOT, 'templates', 'common-components-src');
const hasComponentSources = fs.existsSync(path.join(SRC_ROOT, 'pom.xml'));

describe('readSourceFileInRoot — 소스 루트 밖의 파일을 읽지 않는다', () => {
  let tmpDir: string;
  /** 소스 루트. 이름이 형제 디렉토리(v-10)의 접두어다 */
  let root: string;
  /** 심볼릭 링크를 만들 수 있는 환경인지 (권한이 없는 Windows 등에서는 건너뛴다) */
  let canSymlink = true;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'egov-src-read-'));
    root = path.join(tmpDir, 'v-1');

    fs.mkdirSync(path.join(root, 'src', 'sub'), { recursive: true });
    fs.writeFileSync(path.join(root, 'pom.xml'), '<project/>\n');
    fs.writeFileSync(path.join(root, 'src', 'A.java'), 'class A {}\n');
    fs.writeFileSync(path.join(root, 'src', 'sub', 'B.txt'), 'B\n');
    fs.writeFileSync(path.join(root, '..hidden.txt'), 'DOT-DOT-NAME\n');

    // 루트 이름을 접두어로 가진 형제 디렉토리와, 무관한 바깥 디렉토리
    fs.mkdirSync(path.join(tmpDir, 'v-10'));
    fs.writeFileSync(path.join(tmpDir, 'v-10', 'outside.txt'), 'SIBLING-CONTENT\n');
    fs.mkdirSync(path.join(tmpDir, 'outside'));
    fs.writeFileSync(path.join(tmpDir, 'outside', 'secret.txt'), 'OUTSIDE-CONTENT\n');

    try {
      fs.symlinkSync(path.join(tmpDir, 'outside', 'secret.txt'), path.join(root, 'link-out.txt'));
      fs.symlinkSync(path.join(tmpDir, 'outside'), path.join(root, 'linkdir'));
      fs.symlinkSync(path.join(root, 'src', 'A.java'), path.join(root, 'link-in.java'));
      fs.symlinkSync(root, path.join(tmpDir, 'root-link'));
    } catch {
      canSymlink = false;
    }
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('루트 안의 파일은 상대 경로로 읽는다', () => {
    const result = readSourceFileInRoot(root, 'src/A.java');

    expect(result).not.toBeNull();
    expect(result!.filePath).toBe(path.join('src', 'A.java'));
    expect(result!.content).toBe('class A {}\n');
    expect(result!.language).toBe('java');
  });

  it('루트 안에 머무는 ".." 경로는 정규화해서 읽는다', () => {
    const result = readSourceFileInRoot(root, 'src/sub/../A.java');

    expect(result?.filePath).toBe(path.join('src', 'A.java'));
    expect(result?.content).toBe('class A {}\n');
  });

  it('이름이 ".." 으로 시작할 뿐인 루트 안의 파일은 거부하지 않는다', () => {
    expect(readSourceFileInRoot(root, '..hidden.txt')?.content).toBe('DOT-DOT-NAME\n');
  });

  it('루트 이름을 접두어로 가진 형제 디렉토리의 파일을 거부한다', () => {
    expect(readSourceFileInRoot(root, '../v-10/outside.txt')).toBeNull();
  });

  it('".." 으로 루트를 벗어나는 경로를 거부한다', () => {
    expect(readSourceFileInRoot(root, '../outside/secret.txt')).toBeNull();
    expect(readSourceFileInRoot(root, 'src/../../outside/secret.txt')).toBeNull();
    expect(readSourceFileInRoot(root, '..')).toBeNull();
  });

  it('절대 경로 입력은 루트 안을 가리켜도 거부한다', () => {
    expect(readSourceFileInRoot(root, path.join(root, 'src', 'A.java'))).toBeNull();
    expect(readSourceFileInRoot(root, path.join(tmpDir, 'outside', 'secret.txt'))).toBeNull();
    expect(readSourceFileInRoot(root, '/etc/hosts')).toBeNull();
  });

  it('루트 밖을 가리키는 심볼릭 링크를 따라가지 않는다', () => {
    if (!canSymlink) return;
    expect(readSourceFileInRoot(root, 'link-out.txt')).toBeNull();
    expect(readSourceFileInRoot(root, 'linkdir/secret.txt')).toBeNull();
  });

  it('루트 안을 가리키는 심볼릭 링크는 실제 파일의 상대 경로로 읽는다', () => {
    if (!canSymlink) return;
    const result = readSourceFileInRoot(root, 'link-in.java');

    expect(result?.filePath).toBe(path.join('src', 'A.java'));
    expect(result?.content).toBe('class A {}\n');
  });

  it('루트 자체가 심볼릭 링크 뒤에 있어도 루트 안의 파일을 읽는다', () => {
    if (!canSymlink) return;
    const viaLink = path.join(tmpDir, 'root-link');

    expect(readSourceFileInRoot(viaLink, 'src/A.java')?.content).toBe('class A {}\n');
    expect(readSourceFileInRoot(viaLink, '../v-10/outside.txt')).toBeNull();
    expect(readSourceFileInRoot(viaLink, 'link-out.txt')).toBeNull();
  });

  it('존재하지 않는 경로, 디렉토리, 루트 자신은 찾을 수 없음(null)으로 처리한다', () => {
    expect(readSourceFileInRoot(root, 'src/Nope.java')).toBeNull();
    expect(readSourceFileInRoot(root, 'src/A.java/child')).toBeNull();
    expect(readSourceFileInRoot(root, 'src')).toBeNull();
    expect(readSourceFileInRoot(root, '.')).toBeNull();
    expect(readSourceFileInRoot(root, '')).toBeNull();
    expect(readSourceFileInRoot(path.join(tmpDir, 'no-such-root'), 'src/A.java')).toBeNull();
  });

  it('NUL 문자가 든 경로는 예외 없이 거부한다', () => {
    expect(readSourceFileInRoot(root, 'src/A.java\0.txt')).toBeNull();
  });
});

describe('readSourceFileInRoot — 파일 크기', () => {
  let root: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'egov-src-size-'));
    fs.writeFileSync(path.join(root, 'Korean.java'), '// 게시판 서비스\nclass Korean {}\n');
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('size 는 문자 수가 아니라 파일의 바이트 수다', () => {
    const result = readSourceFileInRoot(root, 'Korean.java');
    const bytes = fs.statSync(path.join(root, 'Korean.java')).size;

    expect(result).not.toBeNull();
    // 한글은 UTF-8 에서 글자당 3바이트라 문자 수와 바이트 수가 다르다
    expect(bytes).toBeGreaterThan(result!.content.length);
    expect(result!.size).toBe(bytes);
  });
});

describe('readSourceFileInRoot — 바이너리 판정과 큰 파일 나눠 읽기', () => {
  let root: string;
  /** 154,999자짜리 텍스트 (31자 × 5,000줄 − 마지막 줄바꿈) — 한 번에 돌려주는 상한의 약 2.6배 */
  const bigText = Array.from({ length: 5000 }, (_, i) => `INSERT INTO T VALUES (${String(i).padStart(6, '0')});`).join('\n');

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'egov-src-binary-'));
    const write = (name: string, data: string | Buffer) => fs.writeFileSync(path.join(root, name), data);

    // 확장자 목록에 없던 바이너리: NUL 바이트가 들어 있다
    write('NanumGothic.ttf', Buffer.concat([Buffer.from([0x00, 0x01, 0x00, 0x00, 0x00, 0x12]), Buffer.alloc(5000, 0xab)]));
    write('photo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]));
    // UTF-16LE 로 저장한 ASCII 텍스트: 글자마다 NUL 바이트가 끼어 있지만 UTF-8 로는 유효한 바이트열이다
    write('utf16.txt', Buffer.from('hello world\n', 'utf16le'));
    // NUL 은 없지만 UTF-8 로 디코딩되지 않는 바이트열 (EUC-KR 로 쓴 "한글")
    write('legacy.jsp', Buffer.from([0x3c, 0x25, 0x2d, 0x2d, 0x20, 0xc7, 0xd1, 0xb1, 0xdb, 0x20, 0x2d, 0x2d, 0x25, 0x3e, 0x0a]));
    write('icon.svg', '<svg xmlns="http://www.w3.org/2000/svg"><!-- 아이콘 --></svg>\n');
    write('small.java', 'class Small {}\n');
    write('empty.txt', '');
    write('bom.xml', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('<beans/>\n')]));
    write('big.sql', bigText);
    // 상한 위치에 서로게이트 쌍(이모지)이 걸치는 텍스트
    write('emoji.txt', `${'a'.repeat(SOURCE_READ_MAX_CHARS - 1)}😀tail`);
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('한 번에 돌려주는 상한은 60,000자다', () => {
    expect(SOURCE_READ_MAX_CHARS).toBe(60_000);
    expect(bigText.length).toBe(154_999);
  });

  it.each(['NanumGothic.ttf', 'photo.png'])('NUL 바이트가 있는 %s 는 내용 없이 메타데이터만 돌려준다', (name) => {
    const result = readSourceFileInRoot(root, name);
    const bytes = fs.statSync(path.join(root, name)).size;

    expect(result).not.toBeNull();
    expect(result!.language).toBe('binary');
    expect(result!.size).toBe(bytes);
    expect(result!.filePath).toBe(name);
    // 파일 내용은 싣지 않고 짧은 안내 문구만 둔다
    expect(result!.content).toContain('바이너리');
    expect(result!.content.length).toBeLessThan(200);
    expect(result!.truncated).toBe(false);
    expect(result!.totalChars).toBe(0);
    expect(result!.nextOffset).toBeNull();
  });

  it('UTF-8 로는 유효해도 NUL 바이트가 있으면 바이너리로 판정한다', () => {
    // NUL(U+0000)도 유효한 UTF-8 이라 디코딩 성공 여부만으로는 걸러지지 않는다
    const result = readSourceFileInRoot(root, 'utf16.txt');

    expect(result).not.toBeNull();
    expect(result!.language).toBe('binary');
    expect(result!.totalChars).toBe(0);
    expect(result!.size).toBe(24);
    expect(result!.content).not.toContain('\0');
    expect(result!.truncated).toBe(false);
    expect(result!.nextOffset).toBeNull();
  });

  it('UTF-8 로 유효하게 디코딩되지 않는 파일도 바이너리로 판정한다', () => {
    const result = readSourceFileInRoot(root, 'legacy.jsp');

    expect(result?.language).toBe('binary');
    expect(result?.content).not.toContain('�');
    expect(result?.totalChars).toBe(0);
  });

  it('확장자가 아니라 내용으로 판정하므로 텍스트인 svg 는 그대로 읽는다', () => {
    const result = readSourceFileInRoot(root, 'icon.svg');

    expect(result?.language).not.toBe('binary');
    expect(result?.content).toContain('<!-- 아이콘 -->');
  });

  it('상한보다 작은 텍스트는 전부 돌려주고 남은 내용이 없다고 알린다', () => {
    const result = readSourceFileInRoot(root, 'small.java');

    expect(result).toMatchObject({
      content: 'class Small {}\n',
      language: 'java',
      truncated: false,
      totalChars: 15,
      offset: 0,
      nextOffset: null,
    });
  });

  it('빈 파일은 빈 텍스트로 돌려준다', () => {
    expect(readSourceFileInRoot(root, 'empty.txt')).toMatchObject({
      content: '',
      size: 0,
      truncated: false,
      totalChars: 0,
      nextOffset: null,
    });
  });

  it('BOM 은 내용과 문자 수에서 빼고, size 에는 포함한다', () => {
    const result = readSourceFileInRoot(root, 'bom.xml');

    expect(result?.content).toBe('<beans/>\n');
    expect(result?.totalChars).toBe(9);
    expect(result?.size).toBe(12);
  });

  it('큰 텍스트는 60,000자까지만 돌려주고 이어 읽을 위치를 알려 준다', () => {
    const first = readSourceFileInRoot(root, 'big.sql');

    expect(first).not.toBeNull();
    expect(first!.content).toBe(bigText.slice(0, SOURCE_READ_MAX_CHARS));
    expect(first!.truncated).toBe(true);
    expect(first!.totalChars).toBe(bigText.length);
    expect(first!.offset).toBe(0);
    expect(first!.nextOffset).toBe(SOURCE_READ_MAX_CHARS);
    expect(first!.language).toBe('sql');
    expect(first!.size).toBe(Buffer.byteLength(bigText));
  });

  it('nextOffset 을 offset 으로 넘겨 이어 읽으면 파일 전체를 빠짐없이 얻는다', () => {
    const chunks: string[] = [];
    let offset: number | null = 0;
    let calls = 0;
    while (offset !== null) {
      const part = readSourceFileInRoot(root, 'big.sql', { offset });
      expect(part).not.toBeNull();
      expect(part!.offset).toBe(offset);
      expect(part!.content.length).toBeLessThanOrEqual(SOURCE_READ_MAX_CHARS);
      chunks.push(part!.content);
      offset = part!.nextOffset;
      calls += 1;
      expect(calls).toBeLessThan(10);
    }

    expect(calls).toBe(3);
    expect(chunks.join('')).toBe(bigText);
  });

  it('마지막 구간에서는 truncated 가 false 이고 nextOffset 이 null 이다', () => {
    const last = readSourceFileInRoot(root, 'big.sql', { offset: 120_000 });

    expect(last?.content).toBe(bigText.slice(120_000));
    expect(last?.truncated).toBe(false);
    expect(last?.nextOffset).toBeNull();
  });

  it('범위를 벗어난 offset 은 오류 대신 가까운 유효한 값으로 맞춘다', () => {
    expect(readSourceFileInRoot(root, 'small.java', { offset: -5 })?.offset).toBe(0);
    expect(readSourceFileInRoot(root, 'small.java', { offset: Number.NaN })?.offset).toBe(0);
    expect(readSourceFileInRoot(root, 'small.java', { offset: 6.9 })?.content).toBe('Small {}\n');

    const beyond = readSourceFileInRoot(root, 'small.java', { offset: 9999 });
    expect(beyond).toMatchObject({ content: '', offset: 15, truncated: false, nextOffset: null, totalChars: 15 });
  });

  it('서로게이트 쌍의 한가운데에서 자르지 않는다', () => {
    const first = readSourceFileInRoot(root, 'emoji.txt');
    const second = readSourceFileInRoot(root, 'emoji.txt', { offset: first!.nextOffset! });

    expect(first!.content).toBe('a'.repeat(SOURCE_READ_MAX_CHARS - 1));
    expect(first!.nextOffset).toBe(SOURCE_READ_MAX_CHARS - 1);
    expect(second!.content).toBe('😀tail');
  });
});

describe.skipIf(!hasComponentSources)('readSourceFileInRoot — 동봉 소스 트리', () => {
  /** 소스 버전이 바뀌어 예시 파일이 없어지면 그 테스트만 건너뛴다 */
  const missing = (relative: string) => !fs.existsSync(path.join(SRC_ROOT, relative));
  const FONT_FILE = 'src/main/webapp/font/NanumGothic.ttf';
  const BIG_SCRIPT = 'script/dml/mysql/com_DML_mysql.sql';
  const JAVA_FILE = 'src/main/java/egovframework/com/cop/bbs/service/Board.java';

  it.skipIf(missing(FONT_FILE))('글꼴 파일은 수 MB 의 내용 대신 메타데이터만 돌려준다', () => {
    const result = readSourceFileInRoot(SRC_ROOT, FONT_FILE);

    expect(result?.language).toBe('binary');
    expect(result?.size).toBeGreaterThan(1_000_000);
    expect(result?.content.length).toBeLessThan(200);
  });

  it.skipIf(missing(BIG_SCRIPT))('큰 스크립트는 60,000자에서 끊고 이어 읽을 위치를 준다', () => {
    const result = readSourceFileInRoot(SRC_ROOT, BIG_SCRIPT);

    expect(result?.content.length).toBe(SOURCE_READ_MAX_CHARS);
    expect(result?.truncated).toBe(true);
    expect(result?.totalChars).toBeGreaterThan(SOURCE_READ_MAX_CHARS);
    expect(result?.nextOffset).toBe(SOURCE_READ_MAX_CHARS);
  });

  it.skipIf(missing(JAVA_FILE))('보통 크기의 Java 소스는 한 번에 전부 돌려준다', () => {
    const relative = JAVA_FILE;
    const result = readSourceFileInRoot(SRC_ROOT, relative);

    expect(result?.language).toBe('java');
    expect(result?.truncated).toBe(false);
    expect(result?.nextOffset).toBeNull();
    expect(result?.size).toBe(fs.statSync(path.join(SRC_ROOT, relative)).size);
    expect(result?.content).toContain('class Board');
  });
});
