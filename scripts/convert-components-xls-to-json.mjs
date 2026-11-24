/**
 * 공통컴포넌트 목록 엑셀(components.xls)을 templates/common-components.json 으로 변환한다.
 *
 * - 엑셀은 저장소에 들어 있지 않다. 받은 파일을 references/components.xls 에 두고 실행한다
 *   (references/ 는 git 이 추적하지 않는다).
 * - 변환 규칙은 기존 JSON 에서 거꾸로 찾아냈다. 5.1.0-beta 엑셀로 변환하면 그 전 JSON 에 있던 153개 항목의
 *   이름·설명·사용 테이블이 그대로 나온다.
 *   - 첫 시트(Sheet1)의 1행은 한글 머리글, 2행은 영문 키, 3행부터가 데이터다. A 열은 비어 있다.
 *   - 컴포넌트 id 는 패키지명의 마지막 마디다 (겹치는 id 는 적재할 때 src/kb/componentIds.ts 가 고유하게 만든다).
 *   - 카테고리 id 는 카테고리 이름의 '/' 를 '-' 로 바꾸고 소문자로 만든 값이다. 카테고리의 영문명·설명은
 *     그 카테고리가 처음 나온 행의 값을 쓴다.
 *   - 의존 패키지는 쉼표로 나누고, 자기 패키지는 뺀다.
 *   - 사용 테이블은 줄바꿈으로 나누고, 'N/A'(테이블 없음 표시)는 뺀다.
 *   - hasWeb 은 webexist 열이 'Y' 인지다. 컴포넌트가 프로젝트에 web.xml 을 가져오는지를 나타내며,
 *     JSP 화면이 있는지와는 다르다.
 *   - addedOptions 열은 모든 행이 자리 채움 값('addedOptions')이라 빈 문자열로 둔다.
 * - 엑셀에는 컴포넌트별 버전 열이 없어서, --version 으로 받은 값을 파일 머리와 모든 컴포넌트의 version 에 쓴다.
 * - 변환한 뒤에는 npm run build-index 로 동봉 DB 에 적재해야 도구에 반영된다.
 *
 * 사용법:
 *   node scripts/convert-components-xls-to-json.mjs --version=5.1.0
 *   node scripts/convert-components-xls-to-json.mjs --version=5.1.0 --input=<xls 경로> --output=<json 경로>
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_INPUT = path.join(PROJECT_ROOT, 'references', 'components.xls');
const DEFAULT_OUTPUT = path.join(PROJECT_ROOT, 'templates', 'common-components.json');

/** 2행(영문 키)의 B 열부터 N 열까지 — 열 순서가 바뀌면 변환하지 않는다 */
const EXPECTED_KEYS = [
  'catName', 'catDescription', 'name', 'packageName', 'dependencyPackage', 'description',
  'useTable', 'webexist', 'addedOptions', 'catName', 'catDescription', 'name', 'description',
];

/** 데이터 행의 열 위치 (A 열이 0) */
const COL = {
  catName: 1,
  catDescription: 2,
  name: 3,
  packageName: 4,
  dependencies: 5,
  description: 6,
  useTables: 7,
  webexist: 8,
  addedOptions: 9,
  catNameEn: 10,
  catDescriptionEn: 11,
  nameEn: 12,
  descriptionEn: 13,
};

function parseArgs(argv) {
  const options = { input: DEFAULT_INPUT, output: DEFAULT_OUTPUT, version: null };
  for (const arg of argv) {
    const [key, ...rest] = arg.split('=');
    const value = rest.join('=');
    if (key === '--input' && value) options.input = path.resolve(value);
    else if (key === '--output' && value) options.output = path.resolve(value);
    else if (key === '--version' && value) options.version = value;
    else throw new Error(`알 수 없는 인자입니다: ${arg}`);
  }
  if (!options.version) {
    throw new Error('--version=<버전> 이 필요합니다 (예: --version=5.1.0). 엑셀에 버전 열이 없어서 직접 받습니다.');
  }
  return options;
}

/** 프로젝트 안의 경로는 상대 경로로, 밖의 경로는 그대로 보여 준다 */
function displayPath(filePath) {
  const relative = path.relative(PROJECT_ROOT, filePath);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : filePath;
}

const text = (value) => (value == null ? '' : String(value)).trim();
const oneLine = (value) => text(value).replace(/\s+/g, ' ');
const splitList = (value, separator) =>
  text(value)
    .split(separator)
    .map((item) => item.trim())
    .filter(Boolean);

function convert(rows, version) {
  const header = rows[1] ?? [];
  const keys = header.slice(1, 1 + EXPECTED_KEYS.length).map(text);
  if (keys.join(',') !== EXPECTED_KEYS.join(',')) {
    throw new Error(
      `2행의 영문 키가 예상과 다릅니다 — 엑셀 형식이 바뀌었으면 이 스크립트의 열 위치를 먼저 고치세요.\n` +
        `  예상: ${EXPECTED_KEYS.join(', ')}\n  실제: ${keys.join(', ')}`,
    );
  }

  const categories = [];
  const categoryById = new Map();
  const components = [];

  rows.slice(2).forEach((row, index) => {
    const packageName = text(row[COL.packageName]);
    const categoryName = text(row[COL.catName]);
    const name = text(row[COL.name]);
    if (!packageName && !categoryName && !name) {
      return; // 빈 행
    }
    if (!packageName || !categoryName || !name) {
      throw new Error(`${index + 3}행에 카테고리 명·컴포넌트 명·패키지명 가운데 빈 값이 있습니다.`);
    }

    const id = packageName.split('.').pop();
    const categoryId = categoryName.replace(/\//g, '-').toLowerCase();
    if (!categoryById.has(categoryId)) {
      const category = {
        id: categoryId,
        name: categoryName,
        nameEn: oneLine(row[COL.catNameEn]),
        description: text(row[COL.catDescription]),
        descriptionEn: text(row[COL.catDescriptionEn]),
        components: [],
      };
      categoryById.set(categoryId, category);
      categories.push(category);
    }
    categoryById.get(categoryId).components.push(id);

    const addedOptions = text(row[COL.addedOptions]);
    components.push({
      id,
      name,
      nameEn: oneLine(row[COL.nameEn]),
      categoryId,
      categoryName,
      packageName,
      description: text(row[COL.description]),
      descriptionEn: text(row[COL.descriptionEn]),
      dependencies: splitList(row[COL.dependencies], ',').filter((dependency) => dependency !== packageName),
      useTables: splitList(row[COL.useTables], /\r?\n/).filter((table) => table !== 'N/A'),
      version,
      hasWeb: text(row[COL.webexist]).toUpperCase() === 'Y',
      addedOptions: addedOptions === 'addedOptions' ? '' : addedOptions,
    });
  });

  return {
    version,
    generatedFrom: 'components.xls',
    totalCategories: categories.length,
    totalComponents: components.length,
    categories,
    components,
  };
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(options.input)) {
    throw new Error(`엑셀 파일이 없습니다: ${displayPath(options.input)}`);
  }
  const workbook = XLSX.readFile(options.input);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: false });
  const meta = convert(rows, options.version);

  // 기존 파일과 같은 모양(2칸 들여쓰기, 끝 줄바꿈 없음)으로 쓴다
  fs.writeFileSync(options.output, JSON.stringify(meta, null, 2));
  const knownPackages = new Set(meta.components.map((component) => component.packageName));
  const missing = [
    ...new Set(meta.components.flatMap((component) => component.dependencies).filter((dep) => !knownPackages.has(dep))),
  ];
  console.error(
    `✓ ${displayPath(options.output)}: 카테고리 ${meta.totalCategories}개, 컴포넌트 ${meta.totalComponents}개 (version ${meta.version})`,
  );
  if (missing.length > 0) {
    console.error(`⚠️ 어느 컴포넌트의 패키지와도 맞지 않는 의존 패키지 ${missing.length}개: ${missing.join(', ')}`);
  }
  console.error('  다음 단계: npm run build-index 로 동봉 DB 에 적재합니다.');
} catch (error) {
  console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
