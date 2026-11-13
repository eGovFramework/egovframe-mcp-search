/**
 * 공통컴포넌트 소스 파일 목록(collectComponentSourceFiles) 단위 테스트
 *
 * Spring 설정 섹션은 파일 이름에 패키지 마지막 마디(세 글자 코드)가 부분 문자열로 들어
 * 있기만 하면 그 컴포넌트의 파일로 취급했다. 그래서 tpl(게시판 템플릿)에 약관 관리의
 * context-idgn-StplatManage.xml 이, ust(사용자통계)에 설문 컴포넌트의 Qustnr 파일들이
 * 딸려 나왔다. 확실하게 귀속시킬 수 있는 파일만 포함하는지 임시 소스 트리와 저장소에
 * 동봉된 소스 트리로 확인한다 (DB 는 열지 않는다).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectComponentSourceFiles } from '../../src/tools/commonComponents.js';

const REPO_ROOT = path.resolve(__dirname, '../..');
/** 저장소에 동봉된 공통컴포넌트 소스 트리 (읽기만 한다) */
const SRC_ROOT = path.join(REPO_ROOT, 'templates', 'common-components-src');
const hasComponentSources = fs.existsSync(path.join(SRC_ROOT, 'pom.xml'));

const SPRING_DIR = path.join('src', 'main', 'resources', 'egovframework', 'spring', 'com');

/** 패키지 이름만으로 컴포넌트 메타데이터를 만든다 */
function component(packageName: string) {
  const id = packageName.split('.').pop() ?? packageName;
  return { component_id: id, name: id, package_name: packageName };
}

/** 설정 파일 목록을 파일 이름만 남겨 정렬한다 */
function configNames(srcRoot: string, packageName: string): string[] {
  return collectComponentSourceFiles(srcRoot, component(packageName))
    .config.map((file) => path.basename(file))
    .sort();
}

describe('collectComponentSourceFiles — Spring 설정 귀속 (임시 소스 트리)', () => {
  let root: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'egov-src-config-'));
    const write = (relPath: string, content = '<beans/>\n') => {
      const target = path.join(root, relPath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    };

    write('pom.xml', '<project/>\n');
    write(path.join('src', 'main', 'java', 'egovframework', 'com', 'sym', 'bat', 'service', 'BatchService.java'), 'class BatchService {}\n');

    // 전역 설정: 이름에 "bat" 이 들어 있어도 특정 컴포넌트의 파일이 아니다
    write(path.join(SPRING_DIR, 'context-common.xml'));
    write(path.join(SPRING_DIR, 'context-batch.xml'));
    write(path.join(SPRING_DIR, 'context-bat.xml'));
    // 스케줄링 설정
    write(path.join(SPRING_DIR, 'scheduling', 'context-scheduling-sym-bat.xml'));
    write(path.join(SPRING_DIR, 'scheduling', 'context-scheduling-sym-sym-bat.xml'));
    write(path.join(SPRING_DIR, 'scheduling', 'context-scheduling-sym-bat-old.xml'));
    write(path.join(SPRING_DIR, 'scheduling', 'context-scheduling-utl-sys-bat.xml'));
    write(path.join(SPRING_DIR, 'scheduling', 'context-scheduling-sym-log-wlg.xml'));
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('스케줄링 설정은 패키지 마디를 "-" 로 이은 이름과 정확히 일치할 때만 포함한다', () => {
    expect(configNames(root, 'egovframework.com.sym.bat')).toEqual(['context-scheduling-sym-bat.xml']);
    expect(configNames(root, 'egovframework.com.sym.sym.bat')).toEqual(['context-scheduling-sym-sym-bat.xml']);
    expect(configNames(root, 'egovframework.com.sym.log.wlg')).toEqual(['context-scheduling-sym-log-wlg.xml']);
  });

  it('파일 이름에 패키지 마지막 마디가 들어 있을 뿐인 설정은 포함하지 않는다', () => {
    // 마지막 마디가 같은 "bat" 이지만 스케줄링 파일이 없는 패키지
    expect(configNames(root, 'egovframework.com.cop.bat')).toEqual([]);
    // "log" 는 context-scheduling-sym-log-wlg.xml 의 부분 문자열일 뿐이다
    expect(configNames(root, 'egovframework.com.sym.log')).toEqual([]);
    expect(configNames(root, 'egovframework.com.cmm.com')).toEqual([]);
  });

  it('egovframework.com 아래가 아닌 패키지에는 스케줄링 설정을 붙이지 않는다', () => {
    expect(configNames(root, 'sym.bat')).toEqual([]);
    expect(configNames(root, 'org.example.sym.bat')).toEqual([]);
    expect(configNames(root, 'egovframework.com')).toEqual([]);
  });

  it('설정 파일 경로는 소스 루트 기준 상대 경로이고 total 에 포함된다', () => {
    const files = collectComponentSourceFiles(root, component('egovframework.com.sym.bat'));

    expect(files.config).toEqual([path.join(SPRING_DIR, 'scheduling', 'context-scheduling-sym-bat.xml')]);
    expect(files.java).toHaveLength(1);
    expect(files.total).toBe(2);
  });
});

describe.skipIf(!hasComponentSources)('collectComponentSourceFiles — Spring 설정 귀속 (동봉 소스 트리)', () => {
  /** 컴포넌트 메타데이터 (DB 를 열지 않도록 원본 JSON 을 읽는다) */
  const packages: string[] = hasComponentSources
    ? JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'templates', 'common-components.json'), 'utf-8')).components.map(
        (c: { packageName: string }) => c.packageName,
      )
    : [];

  it('무관한 컴포넌트의 설정 파일이 딸려 나오지 않는다', () => {
    // 게시판 템플릿(tpl)에 약관 관리(Stplat)가, 사용자통계(ust)에 설문(Qustnr)이 섞이던 사례
    expect(configNames(SRC_ROOT, 'egovframework.com.cop.tpl')).not.toContain('context-idgn-StplatManage.xml');
    expect(configNames(SRC_ROOT, 'egovframework.com.sts.ust').filter((name) => name.includes('Qustnr'))).toEqual([]);
    expect(configNames(SRC_ROOT, 'egovframework.com.sts.sst')).not.toContain('context-idgn-RssTagManage.xml');
  });

  it('자신의 스케줄링 설정은 포함한다', () => {
    expect(configNames(SRC_ROOT, 'egovframework.com.sts.ust')).toContain('context-scheduling-sts-ust.xml');
    expect(configNames(SRC_ROOT, 'egovframework.com.sym.log.wlg')).toContain('context-scheduling-sym-log-wlg.xml');
  });

  it('전역 설정 파일(spring/com 바로 아래)은 어느 컴포넌트에도 붙이지 않는다', () => {
    const globalNames = new Set(
      fs.readdirSync(path.join(SRC_ROOT, SPRING_DIR)).filter((name) => name.endsWith('.xml')),
    );
    expect(globalNames.size).toBeGreaterThan(10);

    const attributed = new Set<string>();
    for (const packageName of new Set(packages)) {
      for (const name of configNames(SRC_ROOT, packageName)) {
        if (globalNames.has(name)) attributed.add(`${packageName}: ${name}`);
      }
    }
    expect([...attributed]).toEqual([]);
  });

  it('스케줄링 설정 18개는 각각 정확히 한 컴포넌트에 귀속된다', () => {
    const owners = new Map<string, string[]>();
    for (const packageName of new Set(packages)) {
      for (const name of configNames(SRC_ROOT, packageName)) {
        if (!name.startsWith('context-scheduling-')) continue;
        owners.set(name, [...(owners.get(name) ?? []), packageName]);
      }
    }
    const schedulingFiles = fs.readdirSync(path.join(SRC_ROOT, SPRING_DIR, 'scheduling')).sort();

    expect(schedulingFiles).toHaveLength(18);
    expect([...owners.keys()].sort()).toEqual(schedulingFiles);
    expect([...owners.values()].filter((list) => list.length !== 1)).toEqual([]);
  });
});
