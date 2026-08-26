#!/usr/bin/env node

/**
 * Initial Data Indexing Script
 * 초기 데이터베이스 인덱싱 (호환성 SW, 표준 용어/단어/도메인, 공통컴포넌트, 개발자 지식, eGovFrame 가이드)
 * 
 * 사용법:
 *   npm run build-index
 *   npm run build-index -- --yes
 */

import { SQLiteManager } from '../database/sqliteManager.js';
import { GuideSearchManager, parseFrontMatter, chunkMarkdown, GuideIndexStats } from '../rag/guideManager.js';
import { DeveloperKnowledgeManager } from '../rag/knowledgeManager.js';
import { getEmbedder } from '../rag/embedder.js';
import { type AddKnowledgeInput } from '../types/knowledge.js';
import {
  ensureEgovframeDocs,
  ensureCommonComponentsSrc,
  runTagSelectionPrompt,
  TagSelectionAbortedError,
  EGOVDOCS_DIR,
  type TagSelector,
} from './templateSources.js';
import fs from 'fs-extra';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import XLSX from 'xlsx';
import { PDFParse } from 'pdf-parse';
import { parse as parseCsvSync } from 'csv-parse/sync';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 프로젝트 루트 경로 (build/scripts/buildIndex.js -> project root)
const PROJECT_ROOT = path.resolve(__dirname, '../..');
export const TEMPLATES_DIR = path.join(PROJECT_ROOT, 'templates');
const DEVELOPER_KNOWLEDGE_DIR = path.join(TEMPLATES_DIR, 'developer_knowledge');

interface BuildIndexOptions {
  yes: boolean;
}

/**
 * data.go.kr 표준 데이터셋 CSV 파일을 행 단위 객체 배열로 읽는다.
 * BOM 처리, 따옴표 안 콤마/줄바꿈, 행별 컬럼 수 가변 모두 csv-parse 가 처리.
 */
export async function readCsvRows(filePath: string): Promise<Record<string, string>[]> {
  const buffer = await fs.readFile(filePath);
  return parseCsvSync(buffer, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
    relax_column_count: true,
  }) as Record<string, string>[];
}

/**
 * 행안부 표준 CSV 의 "-" 또는 빈 문자열을 null 로 정규화.
 */
export function normalizeCell(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (s === '' || s === '-') return null;
  return s;
}

/**
 * `제정차수` 컬럼에 (폐기) 만 표기되고 폐기후제정 이 아닌 행은 deprecated 로 간주.
 * DDL 보조 시 LLM 이 폐기된 옛 표준을 잡지 않도록 적재 단계에서 거른다.
 */
export function isDeprecatedRevision(revisionRound: string | null | undefined): boolean {
  if (!revisionRound) return false;
  return revisionRound.includes('(폐기)') && !revisionRound.includes('폐기후제정');
}

function parseArgs(argv: string[]): BuildIndexOptions {
  return {
    yes: argv.includes('--yes') || argv.includes('-y') || argv.includes('--force'),
  };
}

async function confirmDestructiveReindex(options: BuildIndexOptions): Promise<void> {
  if (options.yes) {
    console.error('⚠️  --yes 옵션이 지정되어 확인 절차를 건너뜁니다.');
    return;
  }

  console.error('⚠️  build-index는 기존 인덱스를 재구축합니다.');
  console.error('   - LanceDB developer_knowledge 테이블을 전체 삭제 후 재생성합니다.');
  console.error('   - LanceDB egovframe_guide 테이블을 전체 삭제 후 재생성합니다.');
  console.error('   - SQLite 기준 데이터는 템플릿 파일 기준으로 INSERT OR REPLACE 됩니다.');
  console.error('');

  if (!input.isTTY) {
    throw new Error('비대화형 환경에서는 확인을 받을 수 없습니다. 계속하려면 `npm run build-index -- --yes`를 사용하세요.');
  }

  // output 은 stderr — 나머지 안내 출력과 스트림을 통일하고, stdout 리다이렉트 시에도
  // readline 이 터미널 모드를 유지하게 한다 (질문이 로그 파일로 사라지는 문제 방지)
  const rl = createInterface({ input, output: process.stderr });
  try {
    const answer = await askQuestion(rl, '계속하려면 "yes"를 입력하세요: ');
    if (answer.trim().toLowerCase() !== 'yes') {
      throw new Error('사용자 확인이 없어 인덱싱을 중단했습니다.');
    }
  } finally {
    rl.close();
  }
}

/**
 * EOF 에 안전한 질문 헬퍼.
 *
 * non-terminal 모드(stdin/stderr 모두 리다이렉트)에서 stdin EOF 가 오면 rl.question
 * 프라미스가 영원히 settle 되지 않아 프로세스가 unsettled top-level await 로 조용히
 * 죽는다. 이를 방지하기 위해 사용자 입력 외에 close 이벤트와 race 해 빈 문자열 ''을 반환한다.
 * - rl.question(question)으로 사용자 입력을 기다리고
 * - rl.once('close', ...)으로 stdin이 EOF로 닫히면(close) 빈 문자열 ''을 반환하는데
 * - Promise.race(...)로 위 두가지 경우를 감싸서
 *   사용자 입력과 close 이벤트 중 먼저 발생한 결과를 사용한다.
 * - catch(...)로 사용자의 Ctrl+C 등으로 인한 예기치 않은 오류가 발생하더라도
 *   빈 문자열 ''을 반환한다.
 */
async function askQuestion(
  rl: ReturnType<typeof createInterface>,
  question: string,
): Promise<string> {
  return Promise.race([
    rl.question(question),
    new Promise<string>(resolve => rl.once('close', () => resolve(''))),
  ]).catch(() => '');
}

/**
 * 터미널 인터랙티브 태그 선택 프롬프트.
 *
 * 저장소 차례가 되면 최신 버전 태그(최대 10개)와 현재 적용 태그를 보여주고
 * 태그명을 입력받는다. 엔터(빈 입력) 또는 현재 태그명 입력 = 현재 소스 유지,
 * 다른 태그명 입력 = 그 태그의 소스로 전환. 없는 태그명은 재입력을 요청한다.
 */
export function createInteractiveTagSelector(): TagSelector {
  return async (ctx) => {
    console.error('');
    console.error(`  🔖 ${ctx.label} 버전 태그 선택`);
    if (ctx.fetchFailed) {
      console.error('     (원격 태그 fetch 실패 — 로컬에 저장된 태그 기준)');
    }
    console.error(`     현재 적용: ${ctx.currentTag ?? `${ctx.currentDescription} (정확히 태그 위가 아님)`}`);
    console.error(`     최신 태그 ${ctx.latestTags.length}개:`);
    for (const tag of ctx.latestTags) {
      const marker = tag === ctx.currentTag ? '→' : '-';
      console.error(`      ${marker} ${tag}`);
    }

    // readline의 output(질문)도 "stdout이 아니라 stderr로 처리"하여
    // 태그 목록과 같은 스트림에 질문을 표시하고,
    // stdout 리다이렉트 시에도 readline이 터미널 모드를 유지하게 한다
    // (질문이 로그 파일로 사라지는 문제 방지)
    const rl = createInterface({ input, output: process.stderr });
    // Ctrl+C: readline 이 raw mode 로 SIGINT 를 가로채므로 직접 감지해
    // '태그 적용 실패' 로 뭉개지지 않는 전용 에러로 build-index 전체를 중단시킨다.
    // (Ctrl+D/EOF 는 askQuestion 이 '' 로 정규화 → 현재 체크아웃 유지)
    let userInterrupted = false;
    rl.on('SIGINT', () => {
      userInterrupted = true;
      rl.close();
    });

    const ask = async (question: string): Promise<string> => {
      const answer = await askQuestion(rl, question);
      if (userInterrupted) {
        throw new TagSelectionAbortedError();
      }
      return answer;
    };

    try {
      return await runTagSelectionPrompt(ctx, ask);
    } finally {
      rl.close();
    }
  };
}

async function buildIndex(options: BuildIndexOptions) {
  console.error('🚀 eGovFrame Companion - 초기 데이터 인덱싱 시작\n');

  try {
    await confirmDestructiveReindex(options);

    // 태그 선택은 대화형 터미널에서만 — --yes 또는 비 TTY 환경에서는 현재 체크아웃 유지
    const selectTag = !options.yes && input.isTTY ? createInteractiveTagSelector() : undefined;

    // 1. SQLite 데이터베이스 초기화
    console.error('📊 SQLite 데이터베이스 초기화 중...');
    const sqlite = new SQLiteManager();

    // 2. 호환성 SW 로드
    const compatCount = await loadCompatibilitySoftware(sqlite);

    // 표준 용어/단어/도메인은 CSV 기준 deterministic 재빌드 (옛 차수 잔존 방지)
    sqlite.clearStandardReferenceData();

    // 3. 표준 용어 로드
    await loadStandardTerms(sqlite);

    // 4. 표준 단어 로드
    await loadStandardWords(sqlite);

    // 5. 표준 도메인 로드
    await loadStandardDomains(sqlite);

    // 6-8. Custom 사전 로드 (기관별 확장, 표준 다음에 우선순위 부여)
    sqlite.clearCustomReferenceData();
    await loadCustomTerms(sqlite);
    await loadCustomWords(sqlite);
    await loadCustomDomains(sqlite);

    // 9. 충돌 감지: custom 이 standard 를 가리는 항목 출력
    reportShadowingConflicts(sqlite);

    // 10. 공통컴포넌트 로드
    await loadCommonComponents(sqlite, selectTag);

    // 11. 개발자 지식 벡터화 (LanceDB)
    const knowledgeStats = await indexDeveloperKnowledge();

    // 12. eGovFrame 가이드 벡터화 (LanceDB)
    const guideStats = await indexEgovframeDocs(selectTag);

    // 13. 통계 출력
    console.error('\n📊 인덱싱 완료 통계:');
    const stats = sqlite.getOverallStats();
    console.error(`  ✓ 호환성 SW: ${compatCount}개`);
    console.error(`  ✓ 표준 용어: ${stats.terms.count}개`);
    console.error(`  ✓ 표준 단어: ${stats.words.count}개`);
    console.error(`  ✓ 표준 도메인: ${stats.domains.count}개`);
    console.error(`  ✓ Custom 용어: ${stats.customTerms.count}개`);
    console.error(`  ✓ Custom 단어: ${stats.customWords.count}개`);
    console.error(`  ✓ Custom 도메인: ${stats.customDomains.count}개`);
    console.error(`  ✓ 컴포넌트 카테고리: ${stats.componentCategories.count}개`);
    console.error(`  ✓ 공통컴포넌트: ${stats.commonComponents.count}개`);
    if (knowledgeStats) {
      console.error(`  ✓ 개발자 지식: ${knowledgeStats.totalItems}개`);
      console.error(`    - FAQ/Q&A: ${knowledgeStats.excelItems}개`);
      console.error(`    - PDF 청크: ${knowledgeStats.pdfChunks}개`);
    }
    if (guideStats) {
      console.error(`  ✓ 가이드 문서: ${guideStats.totalFiles}개 파일 → ${guideStats.totalChunks}개 청크`);
      for (const [layer, count] of Object.entries(guideStats.byLayer)) {
        console.error(`    - ${layer}: ${count}개`);
      }
    }

    sqlite.close();

    console.error('\n✅ 초기 데이터 인덱싱 완료!');
    console.error('\n💡 다음 단계:');
    console.error('  1. npm run build - 프로젝트 빌드');
    console.error('  2. npm run inspector - MCP Inspector로 테스트');
    console.error('  3. Claude Desktop에 MCP 서버 등록');

  } catch (error) {
    if (error instanceof TagSelectionAbortedError) {
      console.error(`\n🛑 ${error.message}`);
      process.exit(130);
    }
    console.error('\n❌ 인덱싱 중 오류 발생:', error);
    process.exit(1);
  }
}

/**
 * 호환성 소프트웨어 로드 (JSON)
 */
async function loadCompatibilitySoftware(sqlite: SQLiteManager): Promise<number> {
  console.error('\n📚 1/11 호환성 소프트웨어 인덱싱...');

  const compatFile = path.join(TEMPLATES_DIR, 'compatibility', 'compatibility-software.json');

  if (!await fs.pathExists(compatFile)) {
    console.warn(`  ⚠️ 파일을 찾을 수 없습니다: ${compatFile}`);
    console.warn('  💡 python3 notebooks/convert-compatibility-xlsx-to-json.py --json 을 먼저 실행하세요.');
    return 0;
  }

  const data: Array<{
    product_name: string;
    product_version: string;
    framework_version: string;
    category: string;
    compatibility_level: number;
    vendor: string;
    verified_date: string;
    description: string | null;
    url: string;
  }> = await fs.readJSON(compatFile);

  sqlite.addCompatibilitySoftwareBatch(data.map(d => ({
    ...d,
    compatibility_level: d.compatibility_level === 1 ? 1 : 2,
    description: d.description ?? undefined,
  })));
  console.error(`  ✓ ${data.length}개의 호환성 소프트웨어 추가 완료`);
  return data.length;
}

/**
 * 표준 용어 로드 (data.go.kr CSV 직접 적재)
 *
 * 입력: templates/standard_terms/mois_standard_terms.csv
 * 헤더: 공통표준용어명, 공통표준용어설명, 공통표준용어영문약어명, 공통표준도메인명,
 *      허용값, 저장 형식, 표현 형식, 행정표준코드명, 소관기관명,
 *      용어 이음동의어 목록, 제정차수, 개정구분명(폐기 또는 변경), 개정항목, 개정사유
 */
async function loadStandardTerms(sqlite: SQLiteManager) {
  console.error('\n📚 2/11 표준 용어 인덱싱...');

  const termsFile = path.join(TEMPLATES_DIR, 'standard_terms', 'mois_standard_terms.csv');

  if (!await fs.pathExists(termsFile)) {
    console.warn(`  ⚠️ 파일을 찾을 수 없습니다: ${termsFile}`);
    console.warn('  💡 data.go.kr/data/15156379 에서 받아 위 경로에 두세요.');
    return;
  }

  const rows = await readCsvRows(termsFile);

  let droppedDeprecated = 0;
  const terms = rows
    .filter((r) => {
      if (!r['공통표준용어명'] || !r['공통표준용어영문약어명']) return false;
      if (isDeprecatedRevision(r['제정차수'])) {
        droppedDeprecated++;
        return false;
      }
      return true;
    })
    .map((r) => ({
      korean_name: r['공통표준용어명'].trim(),
      english_name: r['공통표준용어영문약어명'].trim(),
      description: normalizeCell(r['공통표준용어설명']) ?? undefined,
      domain_name: normalizeCell(r['공통표준도메인명']) ?? undefined,
      allowed_values: normalizeCell(r['허용값']) ?? undefined,
      storage_format: normalizeCell(r['저장 형식']) ?? undefined,
      display_format: normalizeCell(r['표현 형식']) ?? undefined,
      standard_code_name: normalizeCell(r['행정표준코드명']) ?? undefined,
      authority: normalizeCell(r['소관기관명']) ?? undefined,
      synonyms: normalizeCell(r['용어 이음동의어 목록']) ?? undefined,
      revision_round: normalizeCell(r['제정차수']) ?? undefined,
      revision_type: normalizeCell(r['개정구분명(폐기 또는 변경)']) ?? undefined,
      revision_item: normalizeCell(r['개정항목']) ?? undefined,
      revision_reason: normalizeCell(r['개정사유']) ?? undefined,
    }));

  sqlite.addStandardTermsBatch(terms);
  console.error(`  ✓ ${terms.length}개의 표준 용어 추가 완료 (CSV: ${rows.length}행, 폐기 제외: ${droppedDeprecated}건)`);
}

/**
 * 표준 단어 로드 (data.go.kr CSV 직접 적재)
 *
 * 입력: templates/standard_terms/mois_standard_words.csv
 * 헤더: 공통표준단어명, 공통표준단어영문약어명, 공통표준단어 영문명, 공통표준단어 설명,
 *      형식단어여부, 공통표준도메인분류명, 이음동의어 목록, 금칙어 목록,
 *      제정차수, 개정구분명(폐기 또는 변경), 개정항목, 개정사유
 */
async function loadStandardWords(sqlite: SQLiteManager) {
  console.error('\n📚 3/11 표준 단어 인덱싱...');

  const wordsFile = path.join(TEMPLATES_DIR, 'standard_terms', 'mois_standard_words.csv');

  if (!await fs.pathExists(wordsFile)) {
    console.warn(`  ⚠️ 파일을 찾을 수 없습니다: ${wordsFile}`);
    console.warn('  💡 data.go.kr/data/15156439 에서 받아 위 경로에 두세요.');
    return;
  }

  const rows = await readCsvRows(wordsFile);

  let droppedDeprecated = 0;
  const words = rows
    .filter((r) => {
      if (!r['공통표준단어명'] || !r['공통표준단어영문약어명']) return false;
      if (isDeprecatedRevision(r['제정차수'])) {
        droppedDeprecated++;
        return false;
      }
      return true;
    })
    .map((r) => ({
      korean_name: r['공통표준단어명'].trim(),
      english_name: r['공통표준단어영문약어명'].trim(),
      english_full_name: normalizeCell(r['공통표준단어 영문명']) ?? undefined,
      description: normalizeCell(r['공통표준단어 설명']) ?? undefined,
      is_format_word: normalizeCell(r['형식단어여부']) === 'Y',
      domain_category: normalizeCell(r['공통표준도메인분류명']) ?? undefined,
      synonyms: normalizeCell(r['이음동의어 목록']) ?? undefined,
      forbidden_words: normalizeCell(r['금칙어 목록']) ?? undefined,
      revision_round: normalizeCell(r['제정차수']) ?? undefined,
      revision_type: normalizeCell(r['개정구분명(폐기 또는 변경)']) ?? undefined,
      revision_item: normalizeCell(r['개정항목']) ?? undefined,
      revision_reason: normalizeCell(r['개정사유']) ?? undefined,
    }));

  sqlite.addStandardWordsBatch(words);
  console.error(`  ✓ ${words.length}개의 표준 단어 추가 완료 (CSV: ${rows.length}행, 폐기 제외: ${droppedDeprecated}건)`);
}

/**
 * 표준 도메인 로드 (data.go.kr CSV 직접 적재)
 *
 * 입력: templates/standard_terms/mois_standard_domains.csv
 * 헤더: 공통표준도메인그룹명, 공통표준도메인분류명, 공통표준도메인명, 공통표준도메인설명,
 *      데이터타입, 데이터길이, 데이터소수점길이, 저장형식, 표현형식, 단위, 허용값,
 *      제정차수, 개정구분명(폐기 또는 변경), 개정항목, 개정사유
 */
async function loadStandardDomains(sqlite: SQLiteManager) {
  console.error('\n📚 4/11 표준 도메인 인덱싱...');

  const domainsFile = path.join(TEMPLATES_DIR, 'standard_terms', 'mois_standard_domains.csv');

  if (!await fs.pathExists(domainsFile)) {
    console.warn(`  ⚠️ 파일을 찾을 수 없습니다: ${domainsFile}`);
    console.warn('  💡 data.go.kr/data/15156442 에서 받아 위 경로에 두세요.');
    return;
  }

  const rows = await readCsvRows(domainsFile);

  let droppedDeprecated = 0;
  const domains = rows
    .filter((r) => {
      if (!r['공통표준도메인명'] || !r['데이터타입']) return false;
      if (isDeprecatedRevision(r['제정차수'])) {
        droppedDeprecated++;
        return false;
      }
      return true;
    })
    .map((r) => ({
      domain_name: r['공통표준도메인명'].trim(),
      data_type: r['데이터타입'].trim(),
      domain_group: normalizeCell(r['공통표준도메인그룹명']) ?? undefined,
      domain_category: normalizeCell(r['공통표준도메인분류명']) ?? undefined,
      description: normalizeCell(r['공통표준도메인설명']) ?? undefined,
      data_length: normalizeCell(r['데이터길이']) ?? undefined,
      decimal_length: normalizeCell(r['데이터소수점길이']) ?? undefined,
      storage_format: normalizeCell(r['저장형식']) ?? undefined,
      display_format: normalizeCell(r['표현형식']) ?? undefined,
      unit: normalizeCell(r['단위']) ?? undefined,
      allowed_values: normalizeCell(r['허용값']) ?? undefined,
      revision_round: normalizeCell(r['제정차수']) ?? undefined,
      revision_type: normalizeCell(r['개정구분명(폐기 또는 변경)']) ?? undefined,
      revision_item: normalizeCell(r['개정항목']) ?? undefined,
      revision_reason: normalizeCell(r['개정사유']) ?? undefined,
    }));

  sqlite.addStandardDomainsBatch(domains);
  console.error(`  ✓ ${domains.length}개의 표준 도메인 추가 완료 (CSV: ${rows.length}행, 폐기 제외: ${droppedDeprecated}건)`);
}

// ==================== Custom 사전 로더 (기관별, 단일 기관) ====================
//
// CSV 포맷은 행안부 표준 CSV 와 동일하게 둔다 (행에서 행으로 복붙 가능, 파서 재사용).
// 파일이 없으면 조용히 건너뛴다 (기관에서 아직 등록 안 한 상태도 정상).

export const CUSTOM_TERMS_DIR = path.join(TEMPLATES_DIR, 'custom_terms');

export async function loadCustomTerms(sqlite: SQLiteManager) {
  console.error('\n📚 5/11 Custom 용어 인덱싱...');
  const file = path.join(CUSTOM_TERMS_DIR, 'custom_standard_terms.csv');
  if (!await fs.pathExists(file)) {
    console.warn(`  ⚠️ Custom 용어 CSV 가 없습니다: ${file} — 건너뜀.`);
    return;
  }

  const rows = await readCsvRows(file);
  let dropped = 0;
  const terms = rows
    .filter((r) => {
      if (!r['공통표준용어명'] || !r['공통표준용어영문약어명']) return false;
      if (isDeprecatedRevision(r['제정차수'])) {
        dropped++;
        return false;
      }
      return true;
    })
    .map((r) => ({
      korean_name: r['공통표준용어명'].trim(),
      english_name: r['공통표준용어영문약어명'].trim(),
      description: normalizeCell(r['공통표준용어설명']) ?? undefined,
      domain_name: normalizeCell(r['공통표준도메인명']) ?? undefined,
      allowed_values: normalizeCell(r['허용값']) ?? undefined,
      storage_format: normalizeCell(r['저장 형식']) ?? undefined,
      display_format: normalizeCell(r['표현 형식']) ?? undefined,
      standard_code_name: normalizeCell(r['행정표준코드명']) ?? undefined,
      authority: normalizeCell(r['소관기관명']) ?? undefined,
      synonyms: normalizeCell(r['용어 이음동의어 목록']) ?? undefined,
      revision_round: normalizeCell(r['제정차수']) ?? undefined,
      revision_type: normalizeCell(r['개정구분명(폐기 또는 변경)']) ?? undefined,
      revision_item: normalizeCell(r['개정항목']) ?? undefined,
      revision_reason: normalizeCell(r['개정사유']) ?? undefined,
    }));

  if (terms.length === 0) {
    console.error(`  ⚠️ 활성 Custom 용어가 없습니다 (CSV: ${rows.length}행, 폐기 제외: ${dropped}건)`);
    return;
  }
  sqlite.addCustomTermsBatch(terms);
  console.error(`  ✓ ${terms.length}개의 Custom 용어 추가 완료 (CSV: ${rows.length}행, 폐기 제외: ${dropped}건)`);
}

export async function loadCustomWords(sqlite: SQLiteManager) {
  console.error('\n📚 6/11 Custom 단어 인덱싱...');
  const file = path.join(CUSTOM_TERMS_DIR, 'custom_standard_words.csv');
  if (!await fs.pathExists(file)) {
    console.warn(`  ⚠️ Custom 단어 CSV 가 없습니다: ${file} — 건너뜀.`);
    return;
  }

  const rows = await readCsvRows(file);
  let dropped = 0;
  const words = rows
    .filter((r) => {
      if (!r['공통표준단어명'] || !r['공통표준단어영문약어명']) return false;
      if (isDeprecatedRevision(r['제정차수'])) {
        dropped++;
        return false;
      }
      return true;
    })
    .map((r) => ({
      korean_name: r['공통표준단어명'].trim(),
      english_name: r['공통표준단어영문약어명'].trim(),
      english_full_name: normalizeCell(r['공통표준단어 영문명']) ?? undefined,
      description: normalizeCell(r['공통표준단어 설명']) ?? undefined,
      is_format_word: normalizeCell(r['형식단어여부']) === 'Y',
      domain_category: normalizeCell(r['공통표준도메인분류명']) ?? undefined,
      synonyms: normalizeCell(r['이음동의어 목록']) ?? undefined,
      forbidden_words: normalizeCell(r['금칙어 목록']) ?? undefined,
      revision_round: normalizeCell(r['제정차수']) ?? undefined,
      revision_type: normalizeCell(r['개정구분명(폐기 또는 변경)']) ?? undefined,
      revision_item: normalizeCell(r['개정항목']) ?? undefined,
      revision_reason: normalizeCell(r['개정사유']) ?? undefined,
    }));

  if (words.length === 0) {
    console.error(`  ⚠️ 활성 Custom 단어가 없습니다 (CSV: ${rows.length}행, 폐기 제외: ${dropped}건)`);
    return;
  }
  sqlite.addCustomWordsBatch(words);
  console.error(`  ✓ ${words.length}개의 Custom 단어 추가 완료 (CSV: ${rows.length}행, 폐기 제외: ${dropped}건)`);
}

export async function loadCustomDomains(sqlite: SQLiteManager) {
  console.error('\n📚 7/11 Custom 도메인 인덱싱...');
  const file = path.join(CUSTOM_TERMS_DIR, 'custom_standard_domains.csv');
  if (!await fs.pathExists(file)) {
    console.warn(`  ⚠️ Custom 도메인 CSV 가 없습니다: ${file} — 건너뜀.`);
    return;
  }

  const rows = await readCsvRows(file);
  let dropped = 0;
  const domains = rows
    .filter((r) => {
      if (!r['공통표준도메인명'] || !r['데이터타입']) return false;
      if (isDeprecatedRevision(r['제정차수'])) {
        dropped++;
        return false;
      }
      return true;
    })
    .map((r) => ({
      domain_name: r['공통표준도메인명'].trim(),
      data_type: r['데이터타입'].trim(),
      domain_group: normalizeCell(r['공통표준도메인그룹명']) ?? undefined,
      domain_category: normalizeCell(r['공통표준도메인분류명']) ?? undefined,
      description: normalizeCell(r['공통표준도메인설명']) ?? undefined,
      data_length: normalizeCell(r['데이터길이']) ?? undefined,
      decimal_length: normalizeCell(r['데이터소수점길이']) ?? undefined,
      storage_format: normalizeCell(r['저장형식']) ?? undefined,
      display_format: normalizeCell(r['표현형식']) ?? undefined,
      unit: normalizeCell(r['단위']) ?? undefined,
      allowed_values: normalizeCell(r['허용값']) ?? undefined,
      revision_round: normalizeCell(r['제정차수']) ?? undefined,
      revision_type: normalizeCell(r['개정구분명(폐기 또는 변경)']) ?? undefined,
      revision_item: normalizeCell(r['개정항목']) ?? undefined,
      revision_reason: normalizeCell(r['개정사유']) ?? undefined,
    }));

  if (domains.length === 0) {
    console.error(`  ⚠️ 활성 Custom 도메인이 없습니다 (CSV: ${rows.length}행, 폐기 제외: ${dropped}건)`);
    return;
  }
  sqlite.addCustomDomainsBatch(domains);
  console.error(`  ✓ ${domains.length}개의 Custom 도메인 추가 완료 (CSV: ${rows.length}행, 폐기 제외: ${dropped}건)`);
}

/**
 * Custom 사전이 standard 사전의 항목을 가리는 경우(같은 한글명/도메인명이지만 영문명/타입이 다름)를
 * 콘솔에 경고로 출력. 빌드를 막진 않는다 (의도된 override 일 수도 있음).
 */
export function reportShadowingConflicts(sqlite: SQLiteManager) {
  console.error('\n📚 8/11 Custom ↔ Standard 충돌 검사...');
  const db = (sqlite as any).db; // 내부 better-sqlite3 인스턴스 접근
  const termConflicts = db.prepare(`
    SELECT ct.korean_name,
           ct.english_name AS custom_eng, st.english_name AS std_eng,
           ct.domain_name AS custom_domain, st.domain_name AS std_domain
    FROM custom_terms ct
    JOIN standard_terms st ON ct.korean_name = st.korean_name
    WHERE ct.english_name != st.english_name OR IFNULL(ct.domain_name,'') != IFNULL(st.domain_name,'')
  `).all() as Array<{ korean_name: string; custom_eng: string; std_eng: string; custom_domain: string | null; std_domain: string | null }>;

  const domainConflicts = db.prepare(`
    SELECT cd.domain_name,
           cd.data_type AS custom_type, sd.data_type AS std_type,
           cd.data_length AS custom_len, sd.data_length AS std_len
    FROM custom_domains cd
    JOIN standard_domains sd ON cd.domain_name = sd.domain_name
    WHERE cd.data_type != sd.data_type OR IFNULL(cd.data_length,'') != IFNULL(sd.data_length,'')
  `).all() as Array<{ domain_name: string; custom_type: string; std_type: string; custom_len: string | null; std_len: string | null }>;

  const wordConflicts = db.prepare(`
    SELECT cw.korean_name,
           cw.english_name AS custom_eng, sw.english_name AS std_eng
    FROM custom_words cw
    JOIN standard_words sw ON cw.korean_name = sw.korean_name
    WHERE cw.english_name != sw.english_name
  `).all() as Array<{ korean_name: string; custom_eng: string; std_eng: string }>;

  const total = termConflicts.length + domainConflicts.length + wordConflicts.length;
  if (total === 0) {
    console.error('  ✓ Custom 이 standard 를 가리는 항목 없음.');
    return;
  }

  console.error(`  ⚠️ Custom override 감지: 용어 ${termConflicts.length}건 / 단어 ${wordConflicts.length}건 / 도메인 ${domainConflicts.length}건`);
  for (const c of termConflicts.slice(0, 20)) {
    console.error(`     [용어] '${c.korean_name}': custom=${c.custom_eng}/${c.custom_domain ?? '-'} ⇄ standard=${c.std_eng}/${c.std_domain ?? '-'}`);
  }
  for (const c of wordConflicts.slice(0, 20)) {
    console.error(`     [단어] '${c.korean_name}': custom=${c.custom_eng} ⇄ standard=${c.std_eng}`);
  }
  for (const c of domainConflicts.slice(0, 20)) {
    console.error(`     [도메인] '${c.domain_name}': custom=${c.custom_type}(${c.custom_len ?? '-'}) ⇄ standard=${c.std_type}(${c.std_len ?? '-'})`);
  }
  if (total > 60) {
    console.error(`     … (총 ${total}건 중 최대 60건만 표시)`);
  }
  console.error('  ℹ️ Override 는 의도된 동작입니다 — lookup 시 custom 이 우선되고, 응답에 standard 동등 항목이 함께 노출됩니다.');
}

/**
 * 공통컴포넌트 데이터 로드
 */
interface ComponentJSON {
  version: string;
  totalCategories: number;
  totalComponents: number;
  categories: Array<{
    id: string;
    name: string;
    nameEn: string;
    description: string;
    descriptionEn: string;
    components: string[];
  }>;
  components: Array<{
    id: string;
    name: string;
    nameEn: string;
    categoryId: string;
    categoryName: string;
    packageName: string;
    description: string;
    descriptionEn: string;
    dependencies: string[];
    useTables: string[];
    version: string;
    hasWeb: boolean;
    addedOptions: string;
  }>;
}

async function loadCommonComponents(sqlite: SQLiteManager, selectTag?: TagSelector) {
  console.error('\n📚 9/11 공통컴포넌트 인덱싱...');

  // 소스 서브모듈 태그 선택/확보 — 검색 도구가 런타임에 이 체크아웃을 직접 탐색하므로
  // build-index 시점에 사용할 버전 태그를 확정한다 (실패해도 인덱싱은 계속).
  const srcReady = await ensureCommonComponentsSrc({ selectTag });
  if (!srcReady) {
    console.warn('  ⚠️ 공통컴포넌트 소스 확보 실패 — 소스 탐색 기능이 빈 결과를 반환할 수 있습니다.');
  }

  const componentsFile = path.join(TEMPLATES_DIR, 'common-components.json');
  
  if (!await fs.pathExists(componentsFile)) {
    console.warn(`  ⚠️ 파일을 찾을 수 없습니다: ${componentsFile}`);
    return;
  }

  const jsonData: ComponentJSON = await fs.readJSON(componentsFile);
  console.error(`  📄 JSON 로드: ${jsonData.totalCategories}개 카테고리, ${jsonData.totalComponents}개 컴포넌트`);

  // 1. 카테고리 임포트
  const categories = jsonData.categories.map(cat => ({
    category_id: cat.id,
    name: cat.name,
    name_en: cat.nameEn,
    description: cat.description,
    description_en: cat.descriptionEn,
  }));
  sqlite.addComponentCategoriesBatch(categories);

  // 2. 컴포넌트 임포트
  const components = jsonData.components.map(comp => ({
    component_id: comp.id,
    name: comp.name,
    name_en: comp.nameEn,
    category_id: comp.categoryId,
    package_name: comp.packageName,
    description: comp.description,
    description_en: comp.descriptionEn,
    use_tables: JSON.stringify(comp.useTables),
    version: comp.version,
    has_web: comp.hasWeb,
    added_options: comp.addedOptions,
  }));
  sqlite.addCommonComponentsBatch(components);

  // 3. 의존성 임포트
  const dependencies: Array<{ component_id: string; depends_on_package: string }> = [];
  for (const comp of jsonData.components) {
    for (const dep of comp.dependencies) {
      dependencies.push({
        component_id: comp.id,
        depends_on_package: dep,
      });
    }
  }
  sqlite.addComponentDependenciesBatch(dependencies);

  // 과거 연결(recursive_triggers OFF)에서 REPLACE 가 남긴 FTS 드리프트 치유
  sqlite.rebuildComponentsFts();

  const summary = sqlite.getComponentSummary();
  console.error(`  ✓ ${categories.length}개 카테고리, ${summary.totalComponents}개 컴포넌트, ${dependencies.length}개 의존성 추가 완료`);
}

interface DeveloperKnowledgeIndexStats {
  totalItems: number;
  excelItems: number;
  pdfChunks: number;
}

function cleanText(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  const text = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint'
    ? value.toString()
    : '';

  return text
    .replaceAll('<br />', '\n')
    .replaceAll('<br/>', '\n')
    .replaceAll('<br>', '\n')
    .replaceAll(/<[^>]+>/g, ' ')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll(/\r\n?/g, '\n')
    .replaceAll(/[ \t]+/g, ' ')
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim();
}

function inferKnowledgeKind(filePath: string): 'faq' | 'qa' {
  const baseName = path.basename(filePath).toLowerCase();
  return baseName.includes('faq') || baseName.includes('자주묻') ? 'faq' : 'qa';
}

function readKnowledgeExcel(filePath: string): AddKnowledgeInput[] {
  const workbook = XLSX.readFile(filePath);
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '' });
  const kind = inferKnowledgeKind(filePath);
  const sourceFile = path.relative(PROJECT_ROOT, filePath);

  return rows.flatMap((row, idx) => {
    const title = cleanText(row.QESTN_SJ) || `${kind.toUpperCase()} ${idx + 1}`;
    const question = cleanText(row.QESTN_CN);
    const answer = cleanText(row.ANSWER_CN);

    if (!question && !answer) {
      return [];
    }

    return [
      {
        type: 'solution',
        title,
        content: [`질문:\n${question}`, `답변:\n${answer}`].filter(Boolean).join('\n\n'),
        context: kind === 'faq' ? '표준프레임워크 FAQ' : '표준프레임워크 묻고답하기',
        tags: ['egovframe', 'developer_knowledge', kind],
        relatedTo: ['faq', 'qa', 'egovframe'],
        importance: kind === 'faq' ? 4 : 3,
        verified: true,
        metadata: {
          source: 'templates/developer_knowledge',
          sourceFile,
          sourceType: kind,
          originalId: cleanText(kind === 'faq' ? row.FAQ_ID : row.QA_ID),
          category: cleanText(row.QESTN_CT || row.QESTN_ST),
          language: cleanText(row.FAQ_NATION || row.QA_LANG_CD || row.NATIONALITY),
        },
      } satisfies AddKnowledgeInput,
    ];
  });
}

function chunkPdfText(text: string, maxChars = 1800): string[] {
  const paragraphs = cleanText(text).split(/\n{2,}/).filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > maxChars) {
      chunks.push(current);
      current = '';
    }

    if (paragraph.length > maxChars) {
      for (let i = 0; i < paragraph.length; i += maxChars) {
        chunks.push(paragraph.slice(i, i + maxChars));
      }
      continue;
    }

    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

async function readPdfKnowledge(filePath: string): Promise<AddKnowledgeInput[]> {
  const data = await fs.readFile(filePath);
  const parser = new PDFParse({ data });

  try {
    const result = await parser.getText();
    const chunks = chunkPdfText(result.text);
    const sourceFile = path.relative(PROJECT_ROOT, filePath);
    const baseTitle = path.basename(filePath, path.extname(filePath));

    return chunks.map((content, idx) => ({
      type: 'best-practice',
      title: `${baseTitle} (${idx + 1}/${chunks.length})`,
      content,
      context: '표준프레임워크 적용가이드 PDF',
      tags: ['egovframe', 'developer_knowledge', 'guide', 'pdf'],
      relatedTo: ['egovframe', 'application-guide'],
      importance: 5,
      verified: true,
      metadata: {
        source: 'templates/developer_knowledge',
        sourceFile,
        sourceType: 'pdf',
        chunkIndex: idx + 1,
        chunkCount: chunks.length,
      },
    }));
  } finally {
    await parser.destroy();
  }
}

async function indexDeveloperKnowledge(): Promise<DeveloperKnowledgeIndexStats | null> {
  console.error('\n📚 10/11 개발자 지식 벡터화 (LanceDB)...');

  if (!await fs.pathExists(DEVELOPER_KNOWLEDGE_DIR)) {
    console.warn(`  ⚠️ 개발자 지식 템플릿 디렉터리를 찾을 수 없습니다: ${DEVELOPER_KNOWLEDGE_DIR}`);
    return null;
  }

  const knowledgeManager = new DeveloperKnowledgeManager();
  await knowledgeManager.initialize();
  await knowledgeManager.clearAll();

  const entries = await fs.readdir(DEVELOPER_KNOWLEDGE_DIR, { withFileTypes: true });
  const knowledgeItems: AddKnowledgeInput[] = [];
  let excelItems = 0;
  let pdfChunks = 0;

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const filePath = path.join(DEVELOPER_KNOWLEDGE_DIR, entry.name);
    const lowerName = entry.name.toLowerCase();

    if (lowerName.endsWith('.xlsx')) {
      const items = readKnowledgeExcel(filePath);
      knowledgeItems.push(...items);
      excelItems += items.length;
      console.error(`  ✓ Excel 로드: ${entry.name} (${items.length}개)`);
    } else if (lowerName.endsWith('.pdf')) {
      const items = await readPdfKnowledge(filePath);
      knowledgeItems.push(...items);
      pdfChunks += items.length;
      console.error(`  ✓ PDF 로드: ${entry.name} (${items.length}개 청크)`);
    }
  }

  const BATCH_SIZE = 100;
  let totalIndexed = 0;

  for (let i = 0; i < knowledgeItems.length; i += BATCH_SIZE) {
    const batch = knowledgeItems.slice(i, Math.min(i + BATCH_SIZE, knowledgeItems.length));
    await knowledgeManager.addKnowledgeBatch(batch);
    totalIndexed += batch.length;
    console.error(`  진행률: ${totalIndexed}/${knowledgeItems.length} (${Math.round((totalIndexed / knowledgeItems.length) * 100)}%)`);
  }

  await knowledgeManager.createIndex();
  await knowledgeManager.optimize();

  console.error(`  ✓ 개발자 지식 벡터화 완료: ${knowledgeItems.length}개`);
  return {
    totalItems: knowledgeItems.length,
    excelItems,
    pdfChunks,
  };
}

/**
 * 마크다운 파일 재귀 수집 (이미지/git/github 제외)
 */
async function collectMarkdownFiles(dir: string, basePath: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    // 무시할 디렉토리
    if (entry.isDirectory()) {
      if (entry.name === '.git' || entry.name === '.github' || entry.name === 'images') {
        continue;
      }
      const subResults = await collectMarkdownFiles(fullPath, basePath);
      results.push(...subResults);
    } else if (entry.name.endsWith('.md')) {
      // 무시할 파일
      if (entry.name === 'README.md' || entry.name === 'how-to-write-Frontmatter.md') {
        continue;
      }
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * egovframe-docs 벡터화 (LanceDB)
 */
async function indexEgovframeDocs(selectTag?: TagSelector): Promise<GuideIndexStats | null> {
  console.error('\n📚 11/11 eGovFrame 가이드 벡터화 (LanceDB)...');

  // 1. egovframe-docs 확인/클론 + 버전 태그 선택
  const docsReady = await ensureEgovframeDocs({ selectTag });
  if (!docsReady) {
    console.error('  ⚠️ egovframe-docs를 찾을 수 없어 가이드 인덱싱을 건너뜁니다.');
    return null;
  }

  // 2. GuideSearchManager 초기화
  const guideManager = new GuideSearchManager();
  await guideManager.initialize();

  // 기존 데이터 삭제 후 재인덱싱
  await guideManager.clearAll();

  const embedder = getEmbedder();
  await embedder.initialize();

  // 3. 마크다운 파일 수집
  const mdFiles = await collectMarkdownFiles(EGOVDOCS_DIR, EGOVDOCS_DIR);
  console.error(`  📄 발견된 마크다운 파일: ${mdFiles.length}개`);

  // 4. 파일별 청킹
  const allChunks: Omit<import('../rag/guideManager.js').GuideChunk, 'id' | 'vector'>[] = [];
  let skippedFiles = 0;

  for (const filePath of mdFiles) {
    const relativePath = path.relative(EGOVDOCS_DIR, filePath);
    const content = await fs.readFile(filePath, 'utf-8');

    // 프론트매터 파싱
    const { frontmatter, body } = parseFrontMatter(content);

    // 본문이 너무 짧은 파일 건너뛰기 (인덱스 파일 등)
    const cleanBody = body.replace(/^#\s+.*\n?/, '').trim();
    if (cleanBody.length < 50) {
      skippedFiles++;
      continue;
    }

    // 청킹
    const chunks = chunkMarkdown(body, frontmatter, relativePath);
    allChunks.push(...chunks);
  }

  console.error(`  📊 총 ${allChunks.length}개 청크 생성 (${skippedFiles}개 파일 건너뜀)`);

  // 5. 배치 인덱싱 (100개씩)
  const BATCH_SIZE = 100;
  let totalIndexed = 0;

  for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
    const batch = allChunks.slice(i, Math.min(i + BATCH_SIZE, allChunks.length));
    await guideManager.addGuideBatch(batch);
    totalIndexed += batch.length;
    console.error(`  진행률: ${totalIndexed}/${allChunks.length} (${Math.round((totalIndexed / allChunks.length) * 100)}%)`);
  }

  // 6. 인덱스 최적화
  console.error('\n  🔨 가이드 벡터 인덱스 생성 중...');
  await guideManager.createIndex();
  await guideManager.optimize();

  // 7. 통계 생성
  const byLayer: Record<string, number> = {};
  for (const chunk of allChunks) {
    byLayer[chunk.layer] = (byLayer[chunk.layer] || 0) + 1;
  }

  const stats: GuideIndexStats = {
    totalFiles: mdFiles.length - skippedFiles,
    totalChunks: allChunks.length,
    skippedFiles,
    byLayer,
  };

  console.error(`  ✓ egovframe-docs 벡터화 완료: ${stats.totalFiles}개 파일 → ${stats.totalChunks}개 청크`);

  return stats;
}

// 스크립트 실행 — 이 파일이 직접 실행될 때만 (다른 스크립트가 import 할 때는 실행 안 됨)
if (process.argv[1] && process.argv[1] === __filename) {
  try {
    await buildIndex(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error('❌ 치명적 오류:', error);
    process.exit(1);
  }
}


