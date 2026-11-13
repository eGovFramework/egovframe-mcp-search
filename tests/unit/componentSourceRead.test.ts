/**
 * 공통컴포넌트 소스 파일 읽기(readSourceFileInRoot) 단위 테스트
 *
 * readSource 는 호출자가 준 경로의 파일을 읽으므로, 소스 루트 밖의 파일이 읽히면 안 된다.
 * 임시 디렉토리에 소스 루트와 그 바깥 파일을 만들어 실제 파일 시스템으로 검증한다
 * (저장소의 소스 트리와 지식베이스 DB 는 건드리지 않는다).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSourceFileInRoot } from '../../src/tools/commonComponents.js';

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
