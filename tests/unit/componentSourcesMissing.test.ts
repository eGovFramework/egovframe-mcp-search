/**
 * 공통컴포넌트 소스 트리가 설치되지 않았을 때의 동작 단위 테스트
 *
 * templates/common-components-src 는 git 서브모듈이라 저장소만 클론하면 비어 있다.
 * 그 상태에서 sourceFiles/readSource/ddl/dml 이 평범한 "없음" 응답(파일 0개, 찾을 수 없는
 * 파일, DDL 0개)을 돌려주면 호출자는 원인을 알 수 없다. 소스 루트에 pom.xml 이 없으면
 * 네 기능 모두 설치 방법을 담은 UserFacingError 로 알려야 한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertComponentSourcesInstalled } from '../../src/tools/commonComponents.js';
import { UserFacingError } from '../../src/utils/errors.js';

const MISSING_MESSAGE =
  '공통컴포넌트 소스가 설치되어 있지 않습니다. 저장소를 클론해 쓰는 경우 ' +
  'git submodule update --init templates/common-components-src 를 실행하세요.';

/** 호출이 던진 오류를 돌려준다 (던지지 않으면 undefined) */
function catchError(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('assertComponentSourcesInstalled', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'egov-src-missing-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('루트에 pom.xml 이 있으면 통과한다', () => {
    fs.writeFileSync(path.join(tmpDir, 'pom.xml'), '<project/>\n');

    expect(() => assertComponentSourcesInstalled(tmpDir)).not.toThrow();
  });

  it('서브모듈을 초기화하지 않은 빈 디렉토리면 설치 방법을 담은 오류를 던진다', () => {
    const error = catchError(() => assertComponentSourcesInstalled(tmpDir));

    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as Error).message).toBe(MISSING_MESSAGE);
    // 안내 문구에 설치 디렉토리의 절대 경로를 넣지 않는다
    expect((error as Error).message).not.toContain(tmpDir);
  });

  it('루트 디렉토리가 아예 없어도 같은 오류를 던진다', () => {
    const error = catchError(() => assertComponentSourcesInstalled(path.join(tmpDir, 'no-such-dir')));

    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as Error).message).toBe(MISSING_MESSAGE);
  });
});

describe('소스 트리가 없으면 sourceFiles/readSource/ddl/dml 이 모두 원인을 알린다', () => {
  let tmpDir: string;
  let dbPath: string;

  /**
   * 소스 루트는 dataPaths 가 정한다 (오버레이가 없으면 저장소의 templates/common-components-src).
   * 저장소의 소스 트리를 지우지 않고 "서브모듈 미초기화" 상태를 만들 방법이 없어 경로 해석만
   * 바꿔치기한다. DB 경로도 임시 디렉토리로 돌려, 검사 순서가 바뀌더라도 저장소의 지식베이스
   * DB 가 열리지 않게 한다.
   */
  async function importWithEmptySourceRoot() {
    const emptyRoot = path.join(tmpDir, 'common-components-src');
    fs.mkdirSync(emptyRoot);
    vi.doMock('../../src/utils/dataPaths.js', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../../src/utils/dataPaths.js')>()),
      resolveComponentsSrcRoot: () => emptyRoot,
      resolveSQLiteDbPath: () => dbPath,
    }));
    return import('../../src/tools/commonComponents.js');
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'egov-src-uninit-'));
    dbPath = path.join(tmpDir, 'egovframe.db');
    vi.resetModules();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.doUnmock('../../src/utils/dataPaths.js');
    vi.resetModules();
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('네 기능 모두 설치 방법을 담은 UserFacingError 를 던진다', async () => {
    const tools = await importWithEmptySourceRoot();
    const calls: Array<[string, () => unknown]> = [
      ['getComponentSourceFiles', () => tools.getComponentSourceFiles('bbs')],
      ['readComponentSource', () => tools.readComponentSource('pom.xml')],
      ['getComponentDDL', () => tools.getComponentDDL('bbs', 'mysql')],
      ['getComponentDML', () => tools.getComponentDML('bbs', 'mysql')],
    ];

    for (const [name, call] of calls) {
      const error = catchError(call);

      // 모듈을 새로 불러왔으므로 클래스 동일성 대신 이름으로 확인한다
      expect((error as Error | undefined)?.name, name).toBe('UserFacingError');
      expect((error as Error).message, name).toBe(MISSING_MESSAGE);
    }
  });

  it('컴포넌트를 조회하기 전에 알리므로 DB 를 열지 않는다', async () => {
    const tools = await importWithEmptySourceRoot();

    catchError(() => tools.getComponentSourceFiles('bbs'));
    catchError(() => tools.getComponentDDL('bbs', 'mysql'));
    catchError(() => tools.getComponentDML('bbs', 'mysql'));

    expect(fs.existsSync(dbPath)).toBe(false);
  });
});
