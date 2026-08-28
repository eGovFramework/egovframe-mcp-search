/**
 * update CLI — SQLite 리소스(호환성 SW · Custom 사전) 통합 테스트
 *
 * 반입 파일(--from-file) 경로로 네트워크 없이 전체 흐름을 검증한다:
 * 오버레이 SQLite (재)베이스 → 적재 → 두 리소스의 공유 DB 공존 →
 * 패키지 갱신(번들 state 변경) 시 무효화 + 재적용 치유 → 롤백.
 *
 * 번들 측은 저장소의 실제 knowledge-base/egovframe.db 를 (읽기 전용 복사로)
 * 사용하고, 번들 state.json 은 없을 때만 임시로 만들었다가 정리한다.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runUpdate } from '../../src/cli/update.js';
import { SQLiteManager } from '../../src/database/sqliteManager.js';
import {
  SCHEMA_VERSION,
  readOverlayState,
  getOverlaySqliteDbPath,
  isOverlaySqliteValid,
} from '../../src/utils/dataPaths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const BUNDLED_STATE_PATH = path.join(REPO_ROOT, 'knowledge-base', 'state.json');
const BUNDLED_DB_PATH = path.join(REPO_ROOT, 'knowledge-base', 'egovframe.db');

const COMPAT_JSON = [
  {
    product_name: '반입WAS',
    product_version: '1.0',
    framework_version: '4.3',
    category: 'WAS',
    compatibility_level: 1,
    vendor: '반입벤더',
    verified_date: '2026-01-01',
    description: null,
    url: null,
  },
];

function countRows(dbPath: string, table: string): number {
  const sqlite = new SQLiteManager(dbPath);
  try {
    return ((sqlite as any).db.prepare(`SELECT count(*) AS c FROM ${table}`).get() as { c: number }).c;
  } finally {
    sqlite.close();
  }
}

/** 번들 state.json 의 generated_at 을 바꿔 "패키지 갱신" 을 흉내낸다 */
async function setBundledGeneratedAt(value: string): Promise<void> {
  await fs.outputJSON(
    BUNDLED_STATE_PATH,
    { schema_version: SCHEMA_VERSION, generated_at: value, resources: {} },
    { spaces: 2 },
  );
}

describe.skipIf(!fs.existsSync(BUNDLED_DB_PATH))('update CLI — SQLite 리소스 (from-file)', () => {
  let tmpRoot: string;
  let savedEnv: string | undefined;
  let createdBundledState = false;
  let bundledCompatCount: number;

  beforeAll(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'egov-sqlite-it-'));
    savedEnv = process.env.EGOV_MCP_DATA_DIR;
    process.env.EGOV_MCP_DATA_DIR = path.join(tmpRoot, 'overlay');

    // 번들 state.json 이 없으면(인덱스 재생성 전 체크아웃) 임시 생성
    if (!await fs.pathExists(BUNDLED_STATE_PATH)) {
      createdBundledState = true;
    }
    await setBundledGeneratedAt('it-base-1');

    bundledCompatCount = countRows(BUNDLED_DB_PATH, 'compatibility_software');

    // 반입 디렉토리: Custom CSV 3종 중 1종 + 호환성 JSON
    const importDir = path.join(tmpRoot, 'import');
    await fs.outputFile(
      path.join(importDir, 'custom_terms', 'custom_standard_terms.csv'),
      '공통표준용어명,공통표준용어영문약어명,공통표준도메인명\n반입기관용어,IMPORT_TERM,명V100\n',
    );
    await fs.outputJSON(path.join(importDir, 'compatibility', 'compatibility-software.json'), COMPAT_JSON);
  });

  afterAll(async () => {
    if (savedEnv === undefined) delete process.env.EGOV_MCP_DATA_DIR;
    else process.env.EGOV_MCP_DATA_DIR = savedEnv;
    if (createdBundledState) {
      await fs.remove(BUNDLED_STATE_PATH);
    }
    await fs.remove(tmpRoot);
  });

  it('Custom 사전 반입 적용 — 오버레이 SQLite 가 생성되고 적재된다', async () => {
    const code = await runUpdate([
      '--resource=custom_terms', '--from-file', path.join(tmpRoot, 'import'), '--yes',
    ]);
    expect(code).toBe(0);

    expect(await fs.pathExists(getOverlaySqliteDbPath())).toBe(true);
    expect(isOverlaySqliteValid(REPO_ROOT)).toBe(true);
    expect(countRows(getOverlaySqliteDbPath(), 'custom_terms')).toBe(1);

    const entry = readOverlayState()?.resources.custom_terms;
    expect(entry?.dir).toBeTruthy();
    expect(entry?.row_count).toBe(1);
    // 적용 원본이 보관된다 (재베이스 치유·롤백의 기반)
    expect(
      await fs.pathExists(
        path.join(process.env.EGOV_MCP_DATA_DIR!, entry!.dir!, 'custom_standard_terms.csv'),
      ),
    ).toBe(true);
  }, 60_000);

  it('호환성 SW 반입 적용 — 같은 오버레이 DB 에서 Custom 적용분과 공존한다', async () => {
    const code = await runUpdate([
      '--resource=compatibility', '--from-file', path.join(tmpRoot, 'import'), '--yes',
    ]);
    expect(code).toBe(0);

    // deterministic 재적재 — 번들 행은 사라지고 반입 1행만
    expect(countRows(getOverlaySqliteDbPath(), 'compatibility_software')).toBe(1);
    // 기존 Custom 적용분은 그대로 (재베이스가 아니므로)
    expect(countRows(getOverlaySqliteDbPath(), 'custom_terms')).toBe(1);

    expect(readOverlayState()?.resources.compatibility?.row_count).toBe(1);
  }, 60_000);

  it('패키지 갱신(번들 state 변경) 시 무효화되고, update 실행이 재적용으로 치유한다', async () => {
    await setBundledGeneratedAt('it-base-2-신규번들');
    expect(isOverlaySqliteValid(REPO_ROOT)).toBe(false); // 번들이 이긴다 — 폴백 상태

    // 원격 접근 없는 호출로 치유 경로만 태운다 (custom_terms 는 from-file 없이 스킵)
    const code = await runUpdate(['--resource=custom_terms', '--yes']);
    expect(code).toBe(0);

    expect(isOverlaySqliteValid(REPO_ROOT)).toBe(true); // 새 번들 위에 재베이스됨
    expect(countRows(getOverlaySqliteDbPath(), 'custom_terms')).toBe(1);
    expect(countRows(getOverlaySqliteDbPath(), 'compatibility_software')).toBe(1);
  }, 60_000);

  it('--rollback 으로 호환성 적용분만 제거하면 번들 행이 복원되고 Custom 은 유지된다', async () => {
    const code = await runUpdate(['--rollback=compatibility']);
    expect(code).toBe(0);

    expect(readOverlayState()?.resources.compatibility).toBeUndefined();
    // 재구성된 오버레이 DB: 호환성은 번들 원본대로, Custom 은 보관 원본 재적용
    expect(countRows(getOverlaySqliteDbPath(), 'compatibility_software')).toBe(bundledCompatCount);
    expect(countRows(getOverlaySqliteDbPath(), 'custom_terms')).toBe(1);
  }, 60_000);

  it('Custom 까지 롤백하면 오버레이 SQLite 자체가 제거된다 (순수 번들 복귀)', async () => {
    const code = await runUpdate(['--rollback=custom_terms']);
    expect(code).toBe(0);

    expect(readOverlayState()?.resources.custom_terms).toBeUndefined();
    expect(await fs.pathExists(getOverlaySqliteDbPath())).toBe(false);
  }, 60_000);
});
