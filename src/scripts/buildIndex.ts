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
import fs from 'fs-extra';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import XLSX from 'xlsx';
import { PDFParse } from 'pdf-parse';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 프로젝트 루트 경로 (build/scripts/buildIndex.js -> project root)
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const TEMPLATES_DIR = path.join(PROJECT_ROOT, 'templates');
const DEVELOPER_KNOWLEDGE_DIR = path.join(TEMPLATES_DIR, 'developer_knowledge');
const EGOVDOCS_DIR = path.join(TEMPLATES_DIR, 'egovframe_guide');
const EGOVDOCS_REPO = 'https://github.com/egovframework/egovframe-docs.git';

interface BuildIndexOptions {
  yes: boolean;
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

  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question('계속하려면 "yes"를 입력하세요: ');
    if (answer.trim().toLowerCase() !== 'yes') {
      throw new Error('사용자 확인이 없어 인덱싱을 중단했습니다.');
    }
  } finally {
    rl.close();
  }
}

async function buildIndex(options: BuildIndexOptions) {
  console.error('🚀 eGovFrame Companion - 초기 데이터 인덱싱 시작\n');

  try {
    await confirmDestructiveReindex(options);

    // 1. SQLite 데이터베이스 초기화
    console.error('📊 SQLite 데이터베이스 초기화 중...');
    const sqlite = new SQLiteManager();

    // 2. 호환성 SW 로드
    const compatCount = await loadCompatibilitySoftware(sqlite);

    // 3. 표준 용어 로드
    await loadStandardTerms(sqlite);

    // 4. 표준 단어 로드
    await loadStandardWords(sqlite);

    // 5. 표준 도메인 로드
    await loadStandardDomains(sqlite);

    // 6. 공통컴포넌트 로드
    await loadCommonComponents(sqlite);

    // 7. 개발자 지식 벡터화 (LanceDB)
    const knowledgeStats = await indexDeveloperKnowledge();

    // 8. eGovFrame 가이드 벡터화 (LanceDB)
    const guideStats = await indexEgovframeDocs();

    // 9. 통계 출력
    console.error('\n📊 인덱싱 완료 통계:');
    const stats = sqlite.getOverallStats();
    console.error(`  ✓ 호환성 SW: ${compatCount}개`);
    console.error(`  ✓ 표준 용어: ${stats.terms.count}개`);
    console.error(`  ✓ 표준 단어: ${stats.words.count}개`);
    console.error(`  ✓ 표준 도메인: ${stats.domains.count}개`);
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
    console.error('\n❌ 인덱싱 중 오류 발생:', error);
    process.exit(1);
  }
}

/**
 * 호환성 소프트웨어 로드 (JSON)
 */
async function loadCompatibilitySoftware(sqlite: SQLiteManager): Promise<number> {
  console.error('\n📚 1/7 호환성 소프트웨어 인덱싱...');

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
 * 표준 용어 로드
 */
async function loadStandardTerms(sqlite: SQLiteManager) {
  console.error('\n📚 2/7 표준 용어 인덱싱...');
  
  const termsFile = path.join(TEMPLATES_DIR, 'ddlguide', 'standard-terms.json');
  
  if (!await fs.pathExists(termsFile)) {
    console.warn(`  ⚠️ 파일을 찾을 수 없습니다: ${termsFile}`);
    return;
  }

  const termsData = await fs.readJSON(termsFile);
  
  const terms = termsData.map((term: any) => ({
    korean_name: term['공통표준 용어명'],
    english_name: term['공통표준용어 영문약어명'],
    description: term['공통표준용어 설명'],
    domain_name: term['공통표준 도메인명'],
    allowed_values: term['허용값'],
    storage_format: term['저장형식'],
    display_format: term['표현형식']?.toString(),
    standard_code_name: term['행정표준코드명'],
    authority: term['소관기관명'],
  }));

  sqlite.addStandardTermsBatch(terms);
  console.error(`  ✓ ${terms.length}개의 표준 용어 추가 완료`);
}

/**
 * 표준 단어 로드
 */
async function loadStandardWords(sqlite: SQLiteManager) {
  console.error('\n📚 3/7 표준 단어 인덱싱...');
  
  const wordsFile = path.join(TEMPLATES_DIR, 'ddlguide', 'standard-words.json');
  
  if (!await fs.pathExists(wordsFile)) {
    console.warn(`  ⚠️ 파일을 찾을 수 없습니다: ${wordsFile}`);
    return;
  }

  const wordsData = await fs.readJSON(wordsFile);
  
  const words = wordsData
    .filter((word: any) => word['공통표준 단어명'] && word['공통표준단어영문약어명']) // NULL 체크
    .map((word: any) => ({
      korean_name: word['공통표준 단어명'],
      english_name: word['공통표준단어영문약어명'],
      english_full_name: word['공통표준단어영문명'] || '',
      description: word['공통표준단어 설명'] || '',
      is_format_word: word['형식단어 여부'] === 'Y',
      domain_category: word['공통표준도메인 분류명'] !== '-' ? word['공통표준도메인 분류명'] : null,
      synonyms: word['이음동의어 목록'] !== '-' ? word['이음동의어 목록'] : null,
      forbidden_words: word['금칙어 목록'] !== '-' ? word['금칙어 목록'] : null,
    }));

  sqlite.addStandardWordsBatch(words);
  console.error(`  ✓ ${words.length}개의 표준 단어 추가 완료`);
}

/**
 * 표준 도메인 로드
 */
async function loadStandardDomains(sqlite: SQLiteManager) {
  console.error('\n📚 4/7 표준 도메인 인덱싱...');
  
  const domainsFile = path.join(TEMPLATES_DIR, 'ddlguide', 'standard-domains.json');
  
  if (!await fs.pathExists(domainsFile)) {
    console.warn(`  ⚠️ 파일을 찾을 수 없습니다: ${domainsFile}`);
    return;
  }

  const domainsData = await fs.readJSON(domainsFile);
  
  const domains = domainsData
    .filter((domain: any) => domain['공통표준도메인명'] && domain['데이터 타입']) // NULL 체크
    .map((domain: any) => ({
      domain_name: domain['공통표준도메인명'],
      domain_group: domain['공통표준도메인 그룹명'] || null,
      domain_category: domain['공통표준도메인 분류명'] || null,
      description: domain['공통표준도메인 설명'] || '',
      data_type: domain['데이터 타입'],
      data_length: domain['데이터 길이']?.toString() || null,
      decimal_length: domain['소수점길이'] !== '-' ? domain['소수점길이']?.toString() : null,
      storage_format: domain['저장형식'] !== '-' ? domain['저장형식']?.toString() : null,
      display_format: domain['표현형식'] !== '-' ? domain['표현형식']?.toString() : null,
      unit: domain['단위'] !== '-' ? domain['단위'] : null,
      allowed_values: domain['허용값'] !== '-' ? domain['허용값'] : null,
      standard_code_name: domain['행정표준 코드명'] !== '-' ? domain['행정표준 코드명'] : null,
    }));

  sqlite.addStandardDomainsBatch(domains);
  console.error(`  ✓ ${domains.length}개의 표준 도메인 추가 완료`);
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

async function loadCommonComponents(sqlite: SQLiteManager) {
  console.error('\n📚 5/7 공통컴포넌트 인덱싱...');
  
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
  console.error('\n📚 6/7 개발자 지식 벡터화 (LanceDB)...');

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
 * egovframe-docs 클론/업데이트
 */
async function ensureEgovframeDocs(): Promise<boolean> {
  if (await fs.pathExists(path.join(EGOVDOCS_DIR, '_index.md'))) {
    // 이미 클론되어 있으면 pull 시도
    console.error('  📂 기존 egovframe-docs 감지, git pull 중...');
    try {
      execSync('git pull --rebase', { cwd: EGOVDOCS_DIR, stdio: 'pipe' });
      console.error('  ✓ 최신 상태로 업데이트 완료');
    } catch {
      console.error('  ⚠️ git pull 실패 (오프라인 환경일 수 있음), 기존 파일 사용');
    }
    return true;
  }

  // 클론
  console.error(`  📥 egovframe-docs 클론 중: ${EGOVDOCS_REPO}`);
  try {
    execSync(`git clone --depth 1 ${EGOVDOCS_REPO} "${EGOVDOCS_DIR}"`, {
      stdio: 'pipe',
    });
    console.error('  ✓ 클론 완료');
    return true;
  } catch (error) {
    console.error('  ❌ egovframe-docs 클론 실패:', error);
    console.error('  💡 수동으로 클론하세요:');
    console.error(`     git clone --depth 1 ${EGOVDOCS_REPO} ${EGOVDOCS_DIR}`);
    return false;
  }
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
async function indexEgovframeDocs(): Promise<GuideIndexStats | null> {
  console.error('\n📚 7/7 eGovFrame 가이드 벡터화 (LanceDB)...');

  // 1. egovframe-docs 확인/클론
  const docsReady = await ensureEgovframeDocs();
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

// 스크립트 실행
try {
  await buildIndex(parseArgs(process.argv.slice(2)));
} catch (error) {
  console.error('❌ 치명적 오류:', error);
  process.exit(1);
}


