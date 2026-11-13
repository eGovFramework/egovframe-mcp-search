/**
 * 공통컴포넌트 파일 기능의 파일 시스템 오류 처리 단위 테스트
 *
 * Node 의 fs 오류 메시지에는 절대 경로가 들어 있다 ("EACCES: permission denied, open
 * '/Users/...'"). 도구 응답에는 절대 경로가 나가면 안 되므로, 호출자에게 알릴 수 있는
 * 실패(권한 거부)는 소스 루트 기준 상대 경로만 담은 UserFacingError 로 바꾸고, 대상이 없는
 * 경우(없는 경로, 디렉토리를 파일로 읽으려는 경우 등)는 "찾을 수 없음"으로 처리한다.
 *
 * 임시 디렉토리에 만든 소스 트리의 권한을 실제로 막아 검증한다.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  collectComponentSourceFiles,
  readDbScript,
  readSourceFileInRoot,
} from '../../src/tools/commonComponents.js';
import { UserFacingError } from '../../src/utils/errors.js';

/** chmod 로 읽기를 막을 수 있는 환경인지 (Windows 와 root 계정에서는 권한 비트가 통하지 않는다) */
const canRestrict = process.platform !== 'win32' && process.getuid?.() !== 0;

const COMPONENT = {
  component_id: 'bar',
  name: '테스트 컴포넌트',
  package_name: 'egovframework.com.foo.bar',
};

const JAVA_DIR = path.join('src', 'main', 'java', 'egovframework', 'com', 'foo', 'bar');

/** 호출이 던진 오류를 돌려준다 (던지지 않으면 undefined) */
function catchError(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe.skipIf(!canRestrict)('읽기 권한이 없는 파일·디렉토리', () => {
  let root: string;
  /** 테스트가 끝난 뒤 지울 수 있도록 권한을 되돌릴 경로 */
  const restricted: string[] = [];

  const restrict = (relPath: string) => {
    const target = path.join(root, relPath);
    fs.chmodSync(target, 0o000);
    restricted.push(target);
  };

  beforeAll(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'egov-src-eacces-')));
    fs.writeFileSync(path.join(root, 'pom.xml'), '<project/>\n');

    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'noperm.txt'), 'secret\n');

    fs.mkdirSync(path.join(root, JAVA_DIR, 'locked'), { recursive: true });
    fs.writeFileSync(path.join(root, JAVA_DIR, 'Ok.java'), 'class Ok {}\n');
    fs.writeFileSync(path.join(root, JAVA_DIR, 'locked', 'Hidden.java'), 'class Hidden {}\n');

    fs.mkdirSync(path.join(root, 'script', 'ddl', 'mysql'), { recursive: true });
    fs.writeFileSync(path.join(root, 'script', 'ddl', 'mysql', 'com_DDL_mysql.sql'), 'CREATE TABLE T (ID INT);\n');

    restrict(path.join('src', 'noperm.txt'));
    restrict(path.join(JAVA_DIR, 'locked'));
    restrict(path.join('script', 'ddl', 'mysql', 'com_DDL_mysql.sql'));
  });

  afterAll(() => {
    for (const target of restricted) {
      fs.chmodSync(target, 0o700);
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('readSource: 상대 경로만 담은 UserFacingError 로 알린다', () => {
    const error = catchError(() => readSourceFileInRoot(root, 'src/noperm.txt'));

    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as Error).message).toBe(`파일을 읽을 수 없습니다: ${path.join('src', 'noperm.txt')} (권한 거부)`);
    expect((error as Error).message).not.toContain(root);
  });

  it('sourceFiles: 읽을 수 없는 하위 디렉토리를 상대 경로로 알린다', () => {
    const error = catchError(() => collectComponentSourceFiles(root, COMPONENT));

    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as Error).message).toBe(
      `디렉토리를 읽을 수 없습니다: ${path.join(JAVA_DIR, 'locked')} (권한 거부)`,
    );
    expect((error as Error).message).not.toContain(root);
  });

  it('ddl/dml 스크립트: 상대 경로만 담은 UserFacingError 로 알린다', () => {
    const error = catchError(() => readDbScript(root, 'ddl', 'mysql'));

    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as Error).message).toBe(
      `파일을 읽을 수 없습니다: ${path.join('script', 'ddl', 'mysql', 'com_DDL_mysql.sql')} (권한 거부)`,
    );
    expect((error as Error).message).not.toContain(root);
  });
});

describe.skipIf(!canRestrict)('읽기 권한이 없는 Spring 설정', () => {
  let root: string;
  const SPRING_DIR = path.join('src', 'main', 'resources', 'egovframework', 'spring', 'com');
  /** 내용(빈 정의)을 봐야 어느 컴포넌트의 것인지 알 수 있는 설정 */
  const SHARED_CONFIG = path.join(SPRING_DIR, 'context-shared.xml');

  beforeAll(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'egov-src-eacces-config-')));
    fs.writeFileSync(path.join(root, 'pom.xml'), '<project/>\n');
    fs.mkdirSync(path.join(root, SPRING_DIR), { recursive: true });
    fs.writeFileSync(path.join(root, SHARED_CONFIG), '<beans/>\n');
    fs.chmodSync(path.join(root, SHARED_CONFIG), 0o000);
  });

  afterAll(() => {
    fs.chmodSync(path.join(root, SHARED_CONFIG), 0o700);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('sourceFiles: 빈 정의를 확인해야 하는 설정을 읽을 수 없으면 상대 경로로 알린다', () => {
    const error = catchError(() => collectComponentSourceFiles(root, COMPONENT));

    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as Error).message).toBe(`파일을 읽을 수 없습니다: ${SHARED_CONFIG} (권한 거부)`);
    expect((error as Error).message).not.toContain(root);
  });
});

describe('대상이 없는 경우는 오류가 아니라 "찾을 수 없음"이다', () => {
  let root: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'egov-src-missing-'));
    fs.writeFileSync(path.join(root, 'pom.xml'), '<project/>\n');

    // 스크립트 자리에 디렉토리가 있는 경우 (파일로 읽으면 EISDIR)
    fs.mkdirSync(path.join(root, 'script', 'ddl', 'oracle', 'com_DDL_oracle.sql'), { recursive: true });
    fs.mkdirSync(path.join(root, 'script', 'dml', 'mysql'), { recursive: true });
    fs.writeFileSync(path.join(root, 'script', 'dml', 'mysql', 'com_DML_mysql.sql'), "INSERT INTO T VALUES ('1');\n");

    // 패키지 디렉토리 자리에 파일이 있는 경우 (디렉토리로 읽으면 ENOTDIR)
    fs.mkdirSync(path.join(root, 'src', 'main', 'java', 'egovframework', 'com', 'foo'), { recursive: true });
    fs.writeFileSync(path.join(root, JAVA_DIR), 'not a directory\n');
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('ddl/dml 스크립트가 없거나 그 자리가 디렉토리면 null 을 돌려준다', () => {
    expect(readDbScript(root, 'ddl', 'mysql')).toBeNull();
    expect(readDbScript(root, 'ddl', 'oracle')).toBeNull();
    expect(readDbScript(root, 'dml', 'mysql')).toBe("INSERT INTO T VALUES ('1');\n");
  });

  it('sourceFiles: 컴포넌트의 디렉토리가 없거나 그 자리가 파일이면 빈 목록을 돌려준다', () => {
    const files = collectComponentSourceFiles(root, COMPONENT);

    expect(files).toMatchObject({
      componentId: 'bar',
      componentName: '테스트 컴포넌트',
      packageName: 'egovframework.com.foo.bar',
      java: [],
      mapperXml: [],
      jsp: [],
      css: [],
      images: [],
      config: [],
      message: [],
      total: 0,
    });
  });

  it('readSource: 디렉토리와 없는 경로는 null 을 돌려준다', () => {
    expect(readSourceFileInRoot(root, 'script')).toBeNull();
    expect(readSourceFileInRoot(root, 'script/ddl/mysql/com_DDL_mysql.sql')).toBeNull();
  });
});
