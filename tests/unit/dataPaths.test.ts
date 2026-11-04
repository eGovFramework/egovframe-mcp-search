/**
 * 리소스 단위 오버레이 경로 해석 (dataPaths) 단위 테스트
 *
 * EGOV_MCP_DATA_DIR 로 오버레이 루트를 임시 디렉토리로 돌려놓고,
 * 오버레이 유효성 판정(스키마/임베딩 모델/마커)과 번들 폴백을 검증한다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import {
  SCHEMA_VERSION,
  EMBEDDING_MODEL_ID,
  getOverlayRoot,
  resolveResource,
  resolveDeveloperKnowledgeDbDir,
  resolveGuideDbDir,
  resolveComponentsSrcRoot,
  resolveSQLiteDbPath,
  isOverlaySqliteValid,
  getOverlaySqliteDbPath,
  writeOverlaySqliteBase,
  writeOverlayStateAtomic,
  readOverlayState,
  type StateFile,
} from '../../src/utils/dataPaths.js';
import { getKnowledgeBasePath } from '../../src/utils/projectPath.js';

const REPO_ROOT = path.resolve(__dirname, '../..');

describe('dataPaths overlay resolution', () => {
  let tmpDir: string;
  let savedEnv: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'egov-overlay-'));
    savedEnv = process.env.EGOV_MCP_DATA_DIR;
    process.env.EGOV_MCP_DATA_DIR = tmpDir;
  });

  afterEach(async () => {
    if (savedEnv === undefined) {
      delete process.env.EGOV_MCP_DATA_DIR;
    } else {
      process.env.EGOV_MCP_DATA_DIR = savedEnv;
    }
    await fs.remove(tmpDir);
  });

  /** 오버레이에 리소스 디렉토리 + 마커를 만들고 state.json 을 기록한다 */
  async function seedOverlay(
    resource: 'developer_knowledge' | 'guide' | 'common_components',
    marker: string,
    entryOverride: Record<string, unknown> = {},
    stateOverride: Partial<StateFile> = {},
  ): Promise<string> {
    const dir = `resources/${resource}/v-test`;
    const markerPath = path.join(tmpDir, dir, marker);
    await fs.ensureDir(path.dirname(markerPath));
    // lance 마커는 디렉토리, pom.xml 은 파일 — 존재 여부만 검사하므로 둘 다 파일로 충분
    await fs.writeFile(markerPath, '');

    const state: StateFile = {
      schema_version: SCHEMA_VERSION,
      resources: {
        [resource]: {
          version: 'v-test',
          dir,
          embedding_model: EMBEDDING_MODEL_ID,
          ...entryOverride,
        },
      },
      ...stateOverride,
    };
    writeOverlayStateAtomic(state);
    return path.join(tmpDir, dir);
  }

  it('EGOV_MCP_DATA_DIR 이 오버레이 루트를 결정한다', () => {
    expect(getOverlayRoot()).toBe(path.resolve(tmpDir));
  });

  it('오버레이가 없으면 번들 경로로 폴백한다', () => {
    expect(resolveDeveloperKnowledgeDbDir(REPO_ROOT)).toBe(getKnowledgeBasePath(REPO_ROOT));
    expect(resolveGuideDbDir(REPO_ROOT)).toBe(getKnowledgeBasePath(REPO_ROOT));
    expect(resolveComponentsSrcRoot(REPO_ROOT)).toBe(
      path.join(REPO_ROOT, 'templates', 'common-components-src'),
    );
  });

  it('유효한 오버레이 항목은 오버레이 디렉토리로 해석된다', async () => {
    const dkDir = await seedOverlay('developer_knowledge', 'developer_knowledge.lance');
    expect(resolveDeveloperKnowledgeDbDir(REPO_ROOT)).toBe(dkDir);

    const effective = resolveResource('developer_knowledge', REPO_ROOT);
    expect(effective.source).toBe('overlay');
    expect(effective.state?.version).toBe('v-test');
  });

  it('임베딩 모델 불일치 시 벡터 리소스는 번들로 폴백한다', async () => {
    await seedOverlay('guide', 'egovframe_guide.lance', { embedding_model: 'other/model' });
    expect(resolveGuideDbDir(REPO_ROOT)).toBe(getKnowledgeBasePath(REPO_ROOT));
  });

  it('schema_version 불일치 시 번들로 폴백한다', async () => {
    await seedOverlay('developer_knowledge', 'developer_knowledge.lance', {}, {
      schema_version: SCHEMA_VERSION + 1,
    });
    expect(resolveDeveloperKnowledgeDbDir(REPO_ROOT)).toBe(getKnowledgeBasePath(REPO_ROOT));
  });

  it('마커 파일이 없으면 번들로 폴백한다', async () => {
    const dir = await seedOverlay('guide', 'egovframe_guide.lance');
    await fs.remove(path.join(dir, 'egovframe_guide.lance'));
    expect(resolveGuideDbDir(REPO_ROOT)).toBe(getKnowledgeBasePath(REPO_ROOT));
  });

  it('common_components 는 임베딩 모델과 무관하게 유효하다', async () => {
    const dir = await seedOverlay('common_components', 'pom.xml', {
      embedding_model: undefined,
      source_version: 'v5.0.2',
    });
    expect(resolveComponentsSrcRoot(REPO_ROOT)).toBe(dir);
  });

  it('writeOverlayStateAtomic 은 원자 교체로 상태를 갱신한다', () => {
    const state: StateFile = {
      schema_version: SCHEMA_VERSION,
      resources: { guide: { version: 'v1' } },
    };
    writeOverlayStateAtomic(state);
    expect(readOverlayState()?.resources.guide?.version).toBe('v1');

    writeOverlayStateAtomic({
      ...state,
      resources: { guide: { version: 'v2' } },
    });
    expect(readOverlayState()?.resources.guide?.version).toBe('v2');
    // temp 파일이 남지 않는다
    const leftovers = fs.readdirSync(tmpDir).filter((f) => f.includes('.tmp-'));
    expect(leftovers).toHaveLength(0);
  });

  it('손상된 state.json 은 무시되고 번들로 폴백한다', async () => {
    await fs.writeFile(path.join(tmpDir, 'state.json'), '{ 깨진 JSON');
    expect(readOverlayState()).toBeNull();
    expect(resolveDeveloperKnowledgeDbDir(REPO_ROOT)).toBe(getKnowledgeBasePath(REPO_ROOT));
  });
});

describe('SQLite 오버레이 해석 (번들이 이기는 규칙)', () => {
  let tmpDir: string;
  let fakeRoot: string;
  let savedEnv: string | undefined;

  /** 번들 state.json 을 가진 가짜 패키지 루트 */
  async function seedFakePackage(generatedAt: string | null): Promise<void> {
    await fs.outputJSON(path.join(fakeRoot, 'package.json'), { name: 'fake' });
    const statePath = path.join(fakeRoot, 'knowledge-base', 'state.json');
    if (generatedAt === null) {
      await fs.remove(statePath);
      await fs.ensureDir(path.dirname(statePath));
    } else {
      await fs.outputJSON(statePath, {
        schema_version: SCHEMA_VERSION,
        generated_at: generatedAt,
        resources: {},
      });
    }
  }

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'egov-sqlite-ov-'));
    fakeRoot = path.join(tmpDir, 'pkg');
    savedEnv = process.env.EGOV_MCP_DATA_DIR;
    process.env.EGOV_MCP_DATA_DIR = path.join(tmpDir, 'overlay');
  });

  afterEach(async () => {
    if (savedEnv === undefined) delete process.env.EGOV_MCP_DATA_DIR;
    else process.env.EGOV_MCP_DATA_DIR = savedEnv;
    await fs.remove(tmpDir);
  });

  it('오버레이 사본이 없으면 번들 DB 경로다', async () => {
    await seedFakePackage('G1');
    expect(resolveSQLiteDbPath(fakeRoot)).toBe(
      path.join(fakeRoot, 'knowledge-base', 'egovframe.db'),
    );
  });

  it('base 가 번들 generated_at 과 일치하면 오버레이 DB 를 사용한다', async () => {
    await seedFakePackage('G1');
    await fs.outputFile(getOverlaySqliteDbPath(), 'db');
    writeOverlaySqliteBase({ bundled_generated_at: 'G1' });
    expect(isOverlaySqliteValid(fakeRoot)).toBe(true);
    expect(resolveSQLiteDbPath(fakeRoot)).toBe(getOverlaySqliteDbPath());
  });

  it('번들이 갱신되면(base 불일치) 오버레이는 무효 — 번들 폴백', async () => {
    await seedFakePackage('G2-신규번들');
    await fs.outputFile(getOverlaySqliteDbPath(), 'db');
    writeOverlaySqliteBase({ bundled_generated_at: 'G1' });
    expect(isOverlaySqliteValid(fakeRoot)).toBe(false);
    expect(resolveSQLiteDbPath(fakeRoot)).toBe(
      path.join(fakeRoot, 'knowledge-base', 'egovframe.db'),
    );
  });

  it('번들 state.json 이 없으면(구버전 패키지) 오버레이를 신뢰하지 않는다', async () => {
    await seedFakePackage(null);
    await fs.outputFile(getOverlaySqliteDbPath(), 'db');
    writeOverlaySqliteBase({ bundled_generated_at: 'G1' });
    expect(isOverlaySqliteValid(fakeRoot)).toBe(false);
  });

  it('compatibility 의 번들 원본 위치는 templates 하위다', async () => {
    await seedFakePackage('G1');
    expect(resolveResource('compatibility', fakeRoot).dir).toBe(
      path.join(fakeRoot, 'templates', 'compatibility'),
    );
  });
});
