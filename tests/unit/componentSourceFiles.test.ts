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

describe('collectComponentSourceFiles — ID 생성기 설정 귀속 (임시 소스 트리)', () => {
  let root: string;

  /** ID 생성기 빈 하나와 그 전략 빈을 정의하는 설정 XML */
  const idgnXml = (beanName: string, strategy: string) =>
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<beans xmlns="http://www.springframework.org/schema/beans">',
      `    <bean name="${beanName}" class="org.egovframe.rte.fdl.idgnr.impl.EgovTableIdGnrServiceImpl" destroy-method="destroy">`,
      '        <property name="dataSource" ref="egov.dataSource" />',
      `        <property name="strategy"   ref="${strategy}" />`,
      '    </bean>',
      `    <bean name="${strategy}" class="org.egovframe.rte.fdl.idgnr.impl.strategy.EgovIdGnrStrategyImpl"/>`,
      '</beans>',
      '',
    ].join('\n');

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'egov-src-idgn-'));
    const write = (relPath: string, content: string) => {
      const target = path.join(root, relPath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    };
    const javaDir = path.join('src', 'main', 'java', 'egovframework', 'com');

    write('pom.xml', '<project/>\n');

    // 게시판 템플릿(tpl): Java 가 egovTmplatIdGnrService 를 주입받는다
    write(
      path.join(javaDir, 'cop', 'tpl', 'service', 'impl', 'TemplateServiceImpl.java'),
      [
        'public class TemplateServiceImpl {',
        '    @Resource(name = "egovTmplatIdGnrService")',
        '    private EgovIdGnrService idgen;',
        '    @Resource(name="egovMessageSource")',
        '    private Object messages;',
        '}',
        '',
      ].join('\n'),
    );
    // 배치(sym.bat): Java 는 참조하지 않고 스케줄링 설정이 ID 생성기를 참조한다
    write(path.join(javaDir, 'sym', 'bat', 'service', 'BatchScheduler.java'), 'public class BatchScheduler {}\n');
    // 참조가 전혀 없는 컴포넌트
    write(path.join(javaDir, 'cop', 'smt', 'Plain.java'), 'public class Plain {}\n');

    write(path.join(SPRING_DIR, 'idgn', 'context-idgn-Tmplat.xml'), idgnXml('egovTmplatIdGnrService', 'tmplatStrategy'));
    // 파일 이름에 "tpl" 이 들어 있을 뿐인 약관 관리의 ID 생성기
    write(path.join(SPRING_DIR, 'idgn', 'context-idgn-StplatManage.xml'), idgnXml('egovStplatManageIdGnrService', 'stplatStrategy'));
    write(path.join(SPRING_DIR, 'idgn', 'context-idgn-BatchResult.xml'), idgnXml('egovBatchResultIdGnrService', 'batchResultStrategy'));
    write(
      path.join(SPRING_DIR, 'scheduling', 'context-scheduling-sym-bat.xml'),
      [
        '<beans xmlns="http://www.springframework.org/schema/beans">',
        '    <bean id="batchScheduler" class="egovframework.com.sym.bat.service.BatchScheduler">',
        '        <property name="idgenService" ref="egovBatchResultIdGnrService"/>',
        '    </bean>',
        '</beans>',
        '',
      ].join('\n'),
    );
    // 전역 설정: tpl 의 Java 가 참조하는 빈을 정의하지만 ID 생성기 설정이 아니다
    write(
      path.join(SPRING_DIR, 'context-common.xml'),
      '<beans><bean id="egovMessageSource" class="egovframework.com.cmm.EgovMessageSource"/></beans>\n',
    );
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('Java 소스가 @Resource 로 주입받는 빈을 정의한 ID 생성기 설정만 포함한다', () => {
    expect(configNames(root, 'egovframework.com.cop.tpl')).toEqual(['context-idgn-Tmplat.xml']);
  });

  it('컴포넌트의 스케줄링 설정이 ref 로 참조하는 ID 생성기 설정도 포함한다', () => {
    expect(configNames(root, 'egovframework.com.sym.bat')).toEqual([
      'context-idgn-BatchResult.xml',
      'context-scheduling-sym-bat.xml',
    ]);
  });

  it('참조하지 않는 컴포넌트에는 ID 생성기 설정을 붙이지 않는다', () => {
    expect(configNames(root, 'egovframework.com.cop.smt')).toEqual([]);
  });

  it('참조하는 빈을 정의했더라도 ID 생성기 디렉토리 밖의 전역 설정은 붙이지 않는다', () => {
    expect(configNames(root, 'egovframework.com.cop.tpl')).not.toContain('context-common.xml');
  });
});

describe('collectComponentSourceFiles — macOS AppleDouble 파일 제외', () => {
  let root: string;
  const PKG_DIR = path.join('egovframework', 'com', 'cop', 'bbs');
  const SUB_DIR = path.join('com', 'cop', 'bbs');

  /** AppleDouble 파일의 머리 부분 (매직 넘버 00 05 16 07 + "Mac OS X") */
  const appleDouble = Buffer.concat([Buffer.from([0x00, 0x05, 0x16, 0x07, 0x00, 0x02, 0x00, 0x00]), Buffer.from('Mac OS X        ')]);

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'egov-src-appledouble-'));
    /** 실제 파일과, macOS tar 가 확장 속성을 담아 그 옆에 만드는 "._이름" 파일을 함께 쓴다 */
    const writeWithTwin = (dir: string, name: string, content = 'x\n') => {
      fs.mkdirSync(path.join(root, dir), { recursive: true });
      fs.writeFileSync(path.join(root, dir, name), content);
      fs.writeFileSync(path.join(root, dir, `._${name}`), appleDouble);
    };

    fs.writeFileSync(path.join(root, 'pom.xml'), '<project/>\n');
    writeWithTwin(path.join('src', 'main', 'java', PKG_DIR, 'service'), 'Board.java', 'class Board {}\n');
    writeWithTwin(path.join('src', 'main', 'java', PKG_DIR, 'service'), '.Hidden.java', 'class Hidden {}\n');
    writeWithTwin(path.join('src', 'main', 'resources', 'egovframework', 'mapper', SUB_DIR), 'Board_SQL_mysql.xml');
    writeWithTwin(path.join('src', 'main', 'webapp', 'WEB-INF', 'jsp', 'egovframework', SUB_DIR), 'BoardList.jsp');
    writeWithTwin(path.join('src', 'main', 'webapp', 'css', 'egovframework', SUB_DIR), 'board.css');
    writeWithTwin(path.join('src', 'main', 'webapp', 'images', 'egovframework', SUB_DIR), 'icon.png');
    writeWithTwin(path.join('src', 'main', 'resources', 'egovframework', 'message', SUB_DIR), 'message_ko.properties');
    writeWithTwin(path.join(SPRING_DIR, 'scheduling'), 'context-scheduling-cop-bbs.xml', '<beans/>\n');
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('이름이 "._" 로 시작하는 파일은 어느 섹션에도 넣지 않는다', () => {
    const files = collectComponentSourceFiles(root, component('egovframework.com.cop.bbs'));
    const names = (list: string[]) => list.map((file) => path.basename(file)).sort();

    // 점 하나로 시작하는 파일은 AppleDouble 이 아니므로 그대로 둔다
    expect(names(files.java)).toEqual(['.Hidden.java', 'Board.java']);
    expect(names(files.mapperXml)).toEqual(['Board_SQL_mysql.xml']);
    expect(names(files.jsp)).toEqual(['BoardList.jsp']);
    expect(names(files.css)).toEqual(['board.css']);
    expect(names(files.images)).toEqual(['icon.png']);
    expect(names(files.message)).toEqual(['message_ko.properties']);
    expect(names(files.config)).toEqual(['context-scheduling-cop-bbs.xml']);
    expect(files.total).toBe(8);
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

  it('컴포넌트가 실제로 쓰는 ID 생성기 설정을 포함한다', () => {
    // 게시판(bbs): 이름이 우연히 맞던 파일, 게시판 템플릿(tpl): 이름으로는 찾지 못하던 파일
    expect(configNames(SRC_ROOT, 'egovframework.com.cop.bbs')).toEqual(['context-idgn-bbs.xml']);
    expect(configNames(SRC_ROOT, 'egovframework.com.cop.tpl')).toEqual(['context-idgn-Tmplat.xml']);
    // 배치(sym.bat): 스케줄링 설정이 참조하는 ID 생성기
    expect(configNames(SRC_ROOT, 'egovframework.com.sym.bat')).toEqual(
      expect.arrayContaining(['context-idgn-BatchResult.xml', 'context-scheduling-sym-bat.xml']),
    );
  });

  it('포함한 ID 생성기 설정은 모두 그 컴포넌트의 소스가 참조하는 빈을 정의한다', () => {
    const idgnDir = path.join(SRC_ROOT, SPRING_DIR, 'idgn');
    /** 설정 파일이 정의하는 빈 이름 (검증용으로 따로 읽는다) */
    const beansOf = (fileName: string) =>
      [...fs.readFileSync(path.join(idgnDir, fileName), 'utf-8').matchAll(/<bean\s+(?:name|id)="([^"]+)"/g)].map(
        (match) => match[1],
      );

    const unjustified: string[] = [];
    const attributedFiles = new Set<string>();
    for (const packageName of new Set(packages)) {
      const files = collectComponentSourceFiles(SRC_ROOT, component(packageName));
      const idgnFiles = files.config.filter((file) => path.basename(file).startsWith('context-idgn-'));
      if (idgnFiles.length === 0) continue;

      // 컴포넌트의 Java 소스와 스케줄링 설정을 통째로 이어 붙인 텍스트
      const referencing = [...files.java, ...files.config.filter((file) => !idgnFiles.includes(file))]
        .map((file) => fs.readFileSync(path.join(SRC_ROOT, file), 'utf-8'))
        .join('\n');
      for (const file of idgnFiles) {
        const name = path.basename(file);
        attributedFiles.add(name);
        if (!beansOf(name).some((bean) => referencing.includes(`"${bean}"`))) {
          unjustified.push(`${packageName}: ${name}`);
        }
      }
    }

    expect(unjustified).toEqual([]);
    // ID 생성기 설정 95개 가운데 어디서도 참조하지 않는 2개를 뺀 나머지가 귀속된다
    expect(fs.readdirSync(idgnDir)).toHaveLength(95);
    expect(attributedFiles.size).toBe(93);
  });
});
