/**
 * 포털 DB 의 호환성 확인 SW 테이블(LET_TN_COMPATSW)을 JSON 으로 내보낸 파일을
 * templates/compatibility/compatibility-software.json 으로 변환한다.
 *
 * - 입력은 references/호환성확인SW-LET_TN_COMPATSW.json 이다 (references/ 는 git 이 추적하지 않는다).
 *   최상위 객체의 LET_TN_COMPATSW 배열에 행마다 원본 열 15개가 들어 있고, 파일 앞의 BOM 은 무시한다.
 *   예전에 쓰던 엑셀(CSV 를 엑셀로 바꾼 파일)은 PROD_DESC 의 쉼표에서 칸이 나뉘어 열이 밀린 행이 있었지만,
 *   JSON 은 문자열 안의 쉼표와 쌍따옴표(\" 로 이스케이프)를 그대로 담으므로 그런 복원이 필요 없다.
 * - 변환 규칙은 notebooks/convert-compatibility-xlsx-to-json.py 의 --json 동작과 같다. 그 스크립트는 pandas 가
 *   필요하고 --json 을 빼면 동봉 DB 에 직접 쓰므로, 이 스크립트는 JSON 만 만든다. 적재는 npm run build-index 가 한다.
 *   - USE_YN 이 'Y' 인 행만 쓴다.
 *   - PROD_SUMMRY 의 <li>키 : 값</li> 에서 제품명, 버전, 표준프레임워크 버전(없으면 프레임워크 버전),
 *     호환성확인 레벨, 업체명, 호환성확인 일자를 읽는다. 제품명이 없거나 프레임워크 버전이 숫자로 시작하지 않으면 뺀다.
 *   - 분류는 CATE_CD 를 CATE_CD_MAP 으로 바꾼 값이다 (없는 코드는 '기타').
 *   - 설명은 PROD_DESC 의 HTML 엔티티를 글자로 바꾸고 태그와 줄바꿈을 공백으로 바꾼 뒤 앞 500자를 쓴다.
 *   - 제품명 + 버전 + 프레임워크 버전이 같은 행은 처음 것만 남긴다.
 *
 * 사용법:
 *   node scripts/convert-compatibility-to-json.mjs
 *   node scripts/convert-compatibility-to-json.mjs --input=<원본 json 경로> --output=<결과 json 경로>
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_INPUT = path.join(PROJECT_ROOT, 'references', '호환성확인SW-LET_TN_COMPATSW.json');
const TABLE_KEY = 'LET_TN_COMPATSW';
const DEFAULT_OUTPUT = path.join(PROJECT_ROOT, 'templates', 'compatibility', 'compatibility-software.json');

/** 원본 테이블의 열 (행에 이 가운데 빠진 열이 있으면 변환하지 않는다) */
const COLUMNS = [
  'COMPAT_SW_ID', 'CATE_CD', 'PROD_NM', 'PROD_SUMMRY', 'PROD_DESC',
  'ATCH_IMG_FILE_ID', 'ATCH_FILE_ID', 'SORT_NO', 'VIEW_CNT', 'OPEN_YN', 'USE_YN',
  'FRST_REGISTER_PNTTM', 'FRST_REGISTER_ID', 'LAST_UPDUSR_PNTTM', 'LAST_UPDUSR_ID',
];

const CATE_CD_MAP = {
  1: 'DBMS',
  2: 'WAS',
  3: 'Portal Solution',
  4: 'CMS Solution',
  5: 'CRM Solution',
  6: 'UX Solution',
  7: 'Security Solution',
  8: 'Framework Solution',
  9: 'Development Tool',
  10: 'Mobile Solution',
  11: 'ECM Solution',
  12: 'EDMS Solution',
  13: 'Integrated Solution',
  14: 'PMS Solution',
  15: 'HR Solution',
  16: 'GIS Solution',
  17: 'Report Solution',
  18: '기타',
};

/** 원본에 나오는 이름 있는 HTML 엔티티 (모르는 이름은 파이썬의 html.unescape 처럼 그대로 둔다) */
const NAMED_ENTITIES = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  reg: '®', copy: '©', trade: '™', middot: '·', bull: '•', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—',
  laquo: '«', raquo: '»', times: '×', sup1: '¹', sup2: '²', sup3: '³', deg: '°',
};

/** 파이썬 str 의 공백(str.isspace, 정규식 \s)과 같은 글자 */
const PY_WS = '\\t\\n\\v\\f\\r \\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const PY_WS_RUN = new RegExp(`[${PY_WS}]+`, 'g');
const PY_WS_EDGE = new RegExp(`^[${PY_WS}]+|[${PY_WS}]+$`, 'g');
const pyStrip = (value) => value.replace(PY_WS_EDGE, '');

function parseArgs(argv) {
  const options = { input: DEFAULT_INPUT, output: DEFAULT_OUTPUT };
  for (const arg of argv) {
    const [key, ...rest] = arg.split('=');
    const value = rest.join('=');
    if (key === '--input' && value) options.input = path.resolve(value);
    else if (key === '--output' && value) options.output = path.resolve(value);
    else throw new Error(`알 수 없는 인자입니다: ${arg}`);
  }
  return options;
}

/** 프로젝트 안의 경로는 상대 경로로, 밖의 경로는 그대로 보여 준다 */
function displayPath(filePath) {
  const relative = path.relative(PROJECT_ROOT, filePath);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : filePath;
}

const unknownEntities = new Map();

function unescapeHtml(text) {
  return text.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g, (whole, name) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    if (Object.hasOwn(NAMED_ENTITIES, name)) return NAMED_ENTITIES[name];
    unknownEntities.set(whole, (unknownEntities.get(whole) ?? 0) + 1);
    return whole;
  });
}

const isBlank = (value) => value === null || value === undefined || value === '';

/** HTML 태그와 엔티티를 지우고 평문으로 바꾼다 (파이썬 strip_html) */
function stripHtml(value) {
  if (isBlank(value)) return '';
  let text = unescapeHtml(String(value));
  text = text.replace(/<[^>]+>/g, ' ');
  text = text.replace(/\\r\\n|\\r|\\n|\r\n|\r|\n/g, ' ');
  text = text.replace(PY_WS_RUN, ' ');
  return pyStrip(text);
}

/** PROD_SUMMRY 의 <li> 항목에서 키·값을 뽑는다 (파이썬 parse_summary) */
function parseSummary(html) {
  if (isBlank(html)) return {};
  const result = {};
  for (const match of String(html).matchAll(/<li>([\s\S]*?)<\/li>/g)) {
    const item = pyStrip(unescapeHtml(match[1]));
    const separator = item.search(/[:：]/);
    if (separator < 0) continue;
    const key = pyStrip(pyStrip(item.slice(0, separator)).replaceAll(' ', ''));
    const val = pyStrip(pyStrip(item.slice(separator + 1)).replaceAll(' ', ''));
    result[key] = val;
  }
  return result;
}

function normalizeLevel(raw) {
  const value = pyStrip(String(raw)).replaceAll('`', '');
  if (value === '1' || value === '레벨1') return 1;
  if (value === '2' || value === '레벨2') return 2;
  const match = value.match(/^(\d)/);
  if (match && (match[1] === '1' || match[1] === '2')) return Number(match[1]);
  return 2; // 읽지 못하면 기본값
}

function normalizeDate(raw) {
  const value = pyStrip(String(raw)).replaceAll(' ', '');
  const match = value.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  return match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : value;
}

function normalizeFrameworkVersion(raw) {
  const value = pyStrip(String(raw));
  const match = value.match(/^(\d+\.\d+)/);
  return match ? match[1] : value;
}

/** 앞에서부터 code point 기준으로 자른다 (파이썬 문자열 슬라이스와 같게) */
const truncate = (text, length) => Array.from(text).slice(0, length).join('');

/** 원본 JSON 을 읽어 행 배열을 돌려준다 */
function readRows(filePath) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Error(`원본을 JSON 으로 읽을 수 없습니다: ${error instanceof Error ? error.message : String(error)}`);
  }
  const rows = data?.[TABLE_KEY];
  if (!Array.isArray(rows)) {
    throw new Error(`원본 JSON 의 최상위에 ${TABLE_KEY} 배열이 없습니다.`);
  }
  rows.forEach((row, index) => {
    const missing = COLUMNS.filter((name) => !Object.hasOwn(row ?? {}, name));
    if (missing.length > 0) {
      throw new Error(`${index + 1}번째 행에 열이 없습니다: ${missing.join(', ')}`);
    }
  });
  return rows;
}

function toRecords(rows) {
  const records = [];
  const skipped = [];
  for (const row of rows.filter((candidate) => candidate.USE_YN === 'Y')) {
    const parsed = parseSummary(row.PROD_SUMMRY);
    const productName = pyStrip(parsed['제품명'] ?? '');
    const productVersion = pyStrip(parsed['버전'] ?? '');
    const frameworkVersion = pyStrip(parsed['표준프레임워크 버전'] ?? parsed['프레임워크 버전'] ?? '');
    const levelRaw = pyStrip(parsed['호환성확인 레벨'] ?? '2');
    const vendor = pyStrip(parsed['업체명'] ?? '');
    const verifiedDateRaw = pyStrip(parsed['호환성확인 일자'] ?? '');
    const category = CATE_CD_MAP[Number(row.CATE_CD)] ?? '기타';

    if (!productName) {
      skipped.push([row.COMPAT_SW_ID, '제품명 없음']);
      continue;
    }
    if (!frameworkVersion || !/^\d/.test(frameworkVersion)) {
      skipped.push([row.COMPAT_SW_ID, `프레임워크 버전 불명: ${frameworkVersion}`]);
      continue;
    }

    const descText = stripHtml(row.PROD_DESC);
    records.push({
      product_name: productName,
      product_version: productVersion || productName,
      framework_version: normalizeFrameworkVersion(frameworkVersion),
      category,
      compatibility_level: normalizeLevel(levelRaw),
      vendor: vendor || 'Unknown',
      verified_date: verifiedDateRaw ? normalizeDate(verifiedDateRaw) : '1970-01-01',
      description: descText ? truncate(descText, 500) : null,
      url: `https://www.egovframe.go.kr/home/compatsw/compatswRead.do?compatSwId=${row.COMPAT_SW_ID}`,
    });
  }

  // 제품명 + 버전 + 프레임워크 버전이 같은 행은 처음 것만 남긴다
  const seen = new Set();
  const unique = records.filter((record) => {
    const key = JSON.stringify([record.product_name, record.product_version, record.framework_version]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { records: unique, skipped, duplicates: records.length - unique.length };
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(options.input)) {
    throw new Error(`원본 JSON 이 없습니다: ${displayPath(options.input)}`);
  }
  const rows = readRows(options.input);
  const { records, skipped, duplicates } = toRecords(rows);

  // 파이썬 json.dump(indent=2, ensure_ascii=False)와 같은 모양 (끝 줄바꿈 없음)
  fs.writeFileSync(options.output, JSON.stringify(records, null, 2));

  const useY = rows.filter((row) => row.USE_YN === 'Y').length;
  console.error(`✓ ${displayPath(options.output)}: ${records.length}건`);
  console.error(`  - 원본 ${rows.length}행, USE_YN=Y ${useY}행`);
  if (skipped.length > 0) {
    console.error(`  - 제외 ${skipped.length}건: ${skipped.slice(0, 5).map(([id, reason]) => `ID=${id} ${reason}`).join(' / ')}${skipped.length > 5 ? ' …' : ''}`);
  }
  if (duplicates > 0) console.error(`  - 중복 제거 ${duplicates}건`);
  if (unknownEntities.size > 0) {
    console.error(`⚠️ 바꾸지 못한 HTML 엔티티: ${[...unknownEntities].map(([name, count]) => `${name}(${count})`).join(', ')}`);
  }
  console.error('  다음 단계: npm run build-index 로 동봉 DB 에 적재합니다.');
} catch (error) {
  console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
