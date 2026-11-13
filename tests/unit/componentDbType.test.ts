/**
 * 공통컴포넌트 ddl/dml 의 dbType 검증 단위 테스트
 *
 * dbType 은 호출자가 정하는 값이다. 일반 객체 리터럴로 별칭을 조회하면 'constructor',
 * '__proto__' 같은 Object.prototype 속성 이름이 지원 타입처럼 통과하므로, 지원 목록에
 * 실제로 있는 값만 받아들이는지 확인한다. 지원하지 않는 dbType 은 "컴포넌트 없음"(null)과
 * 구분되도록 지원 목록을 담은 UserFacingError 로 알려야 한다.
 *
 * dbType 검증은 DB 조회보다 먼저 일어나므로 이 테스트는 지식베이스 DB 를 열지 않는다.
 */
import { describe, it, expect } from 'vitest';
import {
  SUPPORTED_DB_TYPES,
  getComponentDDL,
  getComponentDML,
  normalizeDbType,
} from '../../src/tools/commonComponents.js';
import { UserFacingError } from '../../src/utils/errors.js';

/** 호출이 던진 오류를 돌려준다 (던지지 않으면 undefined) */
function catchError(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('normalizeDbType', () => {
  it('지원 타입 8개는 그대로 돌려준다', () => {
    expect([...SUPPORTED_DB_TYPES]).toEqual([
      'mysql',
      'maria',
      'oracle',
      'postgres',
      'tibero',
      'cubrid',
      'altibase',
      'goldilocks',
    ]);
    for (const dbType of SUPPORTED_DB_TYPES) {
      expect(normalizeDbType(dbType)).toBe(dbType);
    }
  });

  it('별칭, 대소문자, 앞뒤 공백을 정규화한다', () => {
    expect(normalizeDbType('mariadb')).toBe('maria');
    expect(normalizeDbType('MariaDB')).toBe('maria');
    expect(normalizeDbType('postgresql')).toBe('postgres');
    expect(normalizeDbType('pgsql')).toBe('postgres');
    expect(normalizeDbType('  Oracle  ')).toBe('oracle');
  });

  it('지원하지 않는 값은 null 이다', () => {
    for (const dbType of ['h2', 'mssql', 'PG', 'hsql', '']) {
      expect(normalizeDbType(dbType), `dbType=${JSON.stringify(dbType)}`).toBeNull();
    }
  });

  it('Object.prototype 의 속성 이름을 DB 타입으로 받아들이지 않는다', () => {
    for (const dbType of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
      expect(normalizeDbType(dbType), `dbType=${dbType}`).toBeNull();
    }
  });
});

describe('지원하지 않는 dbType 으로 ddl/dml 을 요청하면', () => {
  const lookups = [
    ['getComponentDDL', (dbType: string) => getComponentDDL('bbs', dbType)],
    ['getComponentDML', (dbType: string) => getComponentDML('bbs', dbType)],
  ] as const;

  it.each(lookups)('%s 는 지원 목록과 별칭을 담은 UserFacingError 를 던진다', (_name, lookup) => {
    const error = catchError(() => lookup('h2'));

    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as Error).message).toBe(
      '지원하지 않는 DB 타입입니다: h2 ' +
        '(지원: mysql, maria, oracle, postgres, tibero, cubrid, altibase, goldilocks. ' +
        '별칭: mariadb, postgresql, pgsql)',
    );
  });

  it.each(lookups)('%s 는 Object.prototype 속성 이름도 같은 오류로 거부한다', (_name, lookup) => {
    for (const dbType of ['constructor', '__proto__']) {
      const error = catchError(() => lookup(dbType));

      expect(error, `dbType=${dbType}`).toBeInstanceOf(UserFacingError);
      expect((error as Error).message).toContain(`지원하지 않는 DB 타입입니다: ${dbType}`);
    }
  });

  it('오류 문구에 싣는 입력값은 길이를 제한한다', () => {
    const error = catchError(() => getComponentDDL('bbs', 'x'.repeat(500)));

    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as Error).message.length).toBeLessThan(250);
  });

  it('오류 문구에 싣는 입력값의 줄바꿈은 공백으로 바꿔 한 줄로 유지한다', () => {
    const error = catchError(() => getComponentDML('bbs', 'my\nsql\n\n# 제목'));

    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as Error).message).toContain('지원하지 않는 DB 타입입니다: my sql # 제목 (지원:');
    expect((error as Error).message).not.toContain('\n');
  });
});
