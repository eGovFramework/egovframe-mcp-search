/**
 * 포털에서 내려받은 묻고답하기 원본 엑셀(LET_TN_QA_INFO)에서 색인할 행만 남겨
 * templates/developer_knowledge/묻고답하기-LET_TN_QA_INFO.xlsx 로 쓴다.
 *
 * - 남기는 조건은 스냅샷 발행 프로젝트(egovframe-mcp-search-upload-data)의 QA_SQL 과 같다:
 *   삭제글 제외(DELETE_YN <> 'Y') + 2016년 이후(WRITNG_DE >= '20160101').
 *   SQL 의 DELETE_YN <> 'Y' 는 값이 비어 있는(NULL) 행도 빼므로, 여기서도 DELETE_YN 이 'Y' 가 아니고
 *   비어 있지 않은 행만 남긴다.
 * - 원본과 결과 모두 git 이 추적하지 않는다 (개인정보 컬럼이 들어 있다). 원본은 references/ 에 둔다.
 * - 시트 이름, 열 순서, 셀 값과 표시 형식은 그대로 두고 행만 뺀다. 남긴 행의 순서도 원본과 같다.
 * - 결과를 색인에 반영하려면 npm run build-index 를 실행한다.
 *
 * 사용법:
 *   node scripts/filter-qa-xlsx.mjs
 *   node scripts/filter-qa-xlsx.mjs --since=20160101 --input=<원본 xlsx> --output=<결과 xlsx>
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const FILE_NAME = '묻고답하기-LET_TN_QA_INFO.xlsx';
const DEFAULT_INPUT = path.join(PROJECT_ROOT, 'references', FILE_NAME);
const DEFAULT_OUTPUT = path.join(PROJECT_ROOT, 'templates', 'developer_knowledge', FILE_NAME);
const DEFAULT_SINCE = '20160101';

/** 조건에 쓰는 열 — 없으면 형식이 바뀐 것으로 보고 멈춘다 */
const REQUIRED_COLUMNS = ['QA_ID', 'WRITNG_DE', 'DELETE_YN'];

function parseArgs(argv) {
  const options = { input: DEFAULT_INPUT, output: DEFAULT_OUTPUT, since: DEFAULT_SINCE };
  for (const arg of argv) {
    const [key, ...rest] = arg.split('=');
    const value = rest.join('=');
    if (key === '--input' && value) options.input = path.resolve(value);
    else if (key === '--output' && value) options.output = path.resolve(value);
    else if (key === '--since' && value) options.since = value;
    else throw new Error(`알 수 없는 인자입니다: ${arg}`);
  }
  if (!/^\d{8}$/.test(options.since)) {
    throw new Error(`--since 는 YYYYMMDD 형식이어야 합니다: ${options.since}`);
  }
  if (path.resolve(options.input) === path.resolve(options.output)) {
    throw new Error('--input 과 --output 이 같은 파일입니다. 원본을 덮어쓰지 않도록 다른 경로를 주세요.');
  }
  return options;
}

/** 프로젝트 안의 경로는 상대 경로로, 밖의 경로는 그대로 보여 준다 */
function displayPath(filePath) {
  const relative = path.relative(PROJECT_ROOT, filePath);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : filePath;
}

const cellText = (cell) => (cell == null || cell.v == null ? '' : String(cell.v).trim());

function filterSheet(sheet, since) {
  const range = XLSX.utils.decode_range(sheet['!ref']);
  const cellAt = (r, c) => sheet[XLSX.utils.encode_cell({ r, c })];

  const columnOf = {};
  for (let c = range.s.c; c <= range.e.c; c++) {
    const name = cellText(cellAt(range.s.r, c));
    if (name) columnOf[name] = c;
  }
  const missing = REQUIRED_COLUMNS.filter((name) => columnOf[name] === undefined);
  if (missing.length > 0) {
    throw new Error(`머리글에 필요한 열이 없습니다: ${missing.join(', ')}`);
  }

  const result = {};
  let outRow = 0;
  const copyRow = (r) => {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = cellAt(r, c);
      if (cell) {
        // 값(t, v)과 표시 형식(z)만 옮긴다. 서식 문자열(w)·리치 텍스트는 다시 쓸 때 만들어진다.
        result[XLSX.utils.encode_cell({ r: outRow, c })] = { t: cell.t, v: cell.v, ...(cell.z && { z: cell.z }) };
      }
    }
    outRow++;
  };

  copyRow(range.s.r); // 머리글
  const stats = { total: 0, kept: 0, deleted: 0, before: 0 };
  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    if (!cellText(cellAt(r, columnOf.QA_ID))) continue; // 빈 행
    stats.total++;
    const deleteYn = cellText(cellAt(r, columnOf.DELETE_YN));
    const writtenDate = cellText(cellAt(r, columnOf.WRITNG_DE));
    if (deleteYn === 'Y' || deleteYn === '') {
      stats.deleted++;
    } else if (writtenDate < since) {
      stats.before++;
    } else {
      stats.kept++;
      copyRow(r);
    }
  }
  result['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: range.s.c }, e: { r: outRow - 1, c: range.e.c } });
  return { sheet: result, stats };
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(options.input)) {
    throw new Error(`원본 엑셀이 없습니다: ${displayPath(options.input)}`);
  }
  const workbook = XLSX.readFile(options.input, { cellNF: true });
  const sheetName = workbook.SheetNames[0];
  const { sheet, stats } = filterSheet(workbook.Sheets[sheetName], options.since);

  const output = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(output, sheet, sheetName);
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  XLSX.writeFile(output, options.output, { bookType: 'xlsx', compression: true, bookSST: true });

  console.error(`✓ ${displayPath(options.output)}: ${stats.total}행 중 ${stats.kept}행을 남겼습니다.`);
  console.error(`  - 삭제글(DELETE_YN 이 Y 이거나 빈 값): ${stats.deleted}행 제외`);
  console.error(`  - 작성일(WRITNG_DE)이 ${options.since} 이전: ${stats.before}행 제외`);
  console.error('  다음 단계: npm run build-index 로 색인에 반영합니다.');
} catch (error) {
  console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
