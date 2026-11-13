/**
 * eGovFrame Guide Search Manager (LanceDB)
 * 전자정부 표준프레임워크 공식 문서 검색 시스템
 * 
 * egovframe-docs 마크다운 파일을 벡터화하여 의미 기반 검색 제공
 */

import * as lancedb from '@lancedb/lancedb';
import { getEmbedder } from './embedder.js';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { resolveGuideDbDir } from '../utils/dataPaths.js';
import { UserFacingError } from '../utils/errors.js';
import { lanceEquals, clampSearchLimit, lanceIn, quoteFilterValue } from '../utils/lanceFilter.js';

// ─── 타입 정의 ────────────────────────────────────────────

/** 가이드 문서 청크 */
export interface GuideChunk {
  id: string;
  title: string;       // 문서제목: 섹션제목 (예: "MyBatis 적용 가이드: Step 3. DAO 작성")
  content: string;     // 섹션 본문 (마크다운)
  source: string;      // 상대 파일 경로 (예: "egovframe-runtime/persistence-layer/dataaccess-mybatis-guide.md")
  layer: string;       // 최상위 카테고리 (예: "egovframe-runtime")
  category: string;    // 하위 카테고리 (예: "persistence-layer")
  section: string;     // 섹션 제목 (예: "Step 3. DAO 작성")
  docTitle: string;    // 문서 제목 (예: "MyBatis 적용 가이드")
  url: string;         // Hugo URL (예: "/egovframe-runtime/persistence-layer/dataaccess-mybatis-guide/")
  vector: number[];    // 384차원 임베딩 벡터
}

/** 가이드 검색 결과 */
export interface GuideSearchResult {
  id: string;
  title: string;
  content: string;
  source: string;
  layer: string;
  category: string;
  section: string;
  docTitle: string;
  url: string;
  score: number;       // 코사인 거리 (낮을수록 유사, 1 - score 가 코사인 유사도)
}

/** 가이드 검색에서 limit 을 주지 않았을 때 돌려주는 건수 */
const DEFAULT_GUIDE_SEARCH_LIMIT = 5;

/**
 * 가이드 검색 옵션
 *
 * limit 은 정수로 내림해 1 이상 MAX_VECTOR_SEARCH_LIMIT 이하로 맞춘다 (utils/lanceFilter 의
 * clampSearchLimit). 숫자가 아니거나 유한하지 않으면 기본 5건이다.
 *
 * layer / category 는 테이블에 저장된 값에 대소문자 구분 없이 대응시킨다.
 * 대응되는 값이 없으면 유효한 값을 나열한 UserFacingError 를 던진다 (유효한 값: getFacets()).
 */
export interface GuideSearchOptions {
  limit?: number;
  layer?: string;      // 특정 레이어만 검색 (예: "egovframe-runtime")
  category?: string;   // 특정 카테고리만 검색 (예: "persistence-layer")
}

/** 가이드 필터에 쓸 수 있는 값 하나와 그 값을 가진 청크 수 */
export interface GuideFacetValue {
  value: string;
  count: number;
}

/** 가이드 필터(layer / category)에 쓸 수 있는 고유 값 목록 — 테이블에 저장된 값 그대로 */
export interface GuideFacets {
  /** layer 고유 값 (청크 수 내림차순) */
  layers: GuideFacetValue[];
  /** category 고유 값 — 모든 layer 를 합쳐 센다 (청크 수 내림차순). 빈 category 는 넣지 않는다 */
  categories: GuideFacetValue[];
  /** layer 별 category 고유 값 (청크 수 내림차순). category 가 없는 layer 는 빈 배열 */
  categoriesByLayer: Record<string, GuideFacetValue[]>;
}

/** 가이드 인덱싱 통계 */
export interface GuideIndexStats {
  totalFiles: number;
  totalChunks: number;
  skippedFiles: number;
  byLayer: Record<string, number>;
}

/** Hugo 프론트매터 파싱 결과 */
interface FrontMatter {
  title: string;
  linkTitle?: string;
  description?: string;
  url?: string;
  /** Hugo 의 draft: true — 사이트에 게시되지 않는 문서 (프론트매터가 없으면 undefined) */
  draft?: boolean;
}

// ─── 프론트매터 파싱 ──────────────────────────────────────

/** 값 양끝의 큰따옴표를 벗긴다 (한쪽만 있어도 벗긴다 — 원문에 닫는 따옴표만 남은 값이 있다). */
function unquoteYamlValue(raw: string): string {
  return raw.trim().replace(/^"/, '').replace(/"$/, '').trim();
}

/**
 * YAML 블록에서 최상위 `key: value` 만 읽는다.
 *
 * - 블록 전체를 들여쓴 문서가 있어, 공통 들여쓰기를 걷어 낸 뒤 0열에서 시작하는 키만 본다.
 *   그래야 중첩된 menu 하위 키(name, weight …)가 최상위 키로 읽히지 않는다.
 * - `url : /path/` 처럼 콜론 앞에 공백이 있는 키도 유효한 YAML 이다.
 * - 같은 키가 여러 번 나오면 처음 것을 쓴다.
 */
function parseTopLevelYaml(yaml: string): Map<string, string> {
  const lines = yaml.split('\n');
  const indents = lines
    .filter((line) => line.trim() !== '')
    .map((line) => line.length - line.trimStart().length);
  const commonIndent = indents.length > 0 ? Math.min(...indents) : 0;

  const values = new Map<string, string>();
  for (const line of lines) {
    const match = line.slice(commonIndent).match(/^(\w+)[ \t]*:(.*)$/);
    if (match && !values.has(match[1])) {
      values.set(match[1], unquoteYamlValue(match[2]));
    }
  }
  return values;
}

/**
 * Hugo YAML 프론트매터 파싱 (경량 구현, 외부 의존성 없음)
 *
 * 줄 끝은 LF 로 맞춘다 (Windows 체크아웃의 CRLF 문서도 같은 결과가 나오도록). 돌려주는 body 도 LF 다.
 */
export function parseFrontMatter(content: string): { frontmatter: FrontMatter; body: string } {
  const normalized = content.replace(/\r\n?/g, '\n');
  const fmMatch = normalized.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)([\s\S]*)$/);

  if (!fmMatch) {
    return {
      frontmatter: { title: '' },
      body: normalized,
    };
  }

  const fm = parseTopLevelYaml(fmMatch[1]);
  const body = fmMatch[2];

  return {
    frontmatter: {
      title: fm.get('title') || fm.get('linkTitle') || '',
      linkTitle: fm.get('linkTitle'),
      description: fm.get('description'),
      url: fm.get('url'),
      draft: (fm.get('draft') ?? '').toLowerCase() === 'true',
    },
    body,
  };
}

// ─── 마크다운 청킹 ───────────────────────────────────────

/**
 * 마크다운 파일을 ## 헤더 기준으로 섹션 분할
 * 긴 섹션(>2000자)은 ### 헤더로 추가 분할
 *
 * relativePath 는 가이드 디렉토리 기준 상대 경로다. 구분자를 POSIX(/)로 맞춘 뒤 layer 와
 * category 를 구하므로, Windows 의 역슬래시 경로가 와도 색인 내용(source, layer, category)이 같다.
 */
export function chunkMarkdown(
  body: string,
  frontmatter: FrontMatter,
  relativePath: string,
): Omit<GuideChunk, 'id' | 'vector'>[] {
  const filePath = relativePath.replace(/\\/g, '/');
  const pathParts = filePath.split('/');
  const layer = pathParts[0] || 'unknown';
  const category = pathParts.length > 2 ? pathParts[1] : '';
  const docTitle = frontmatter.title || path.posix.basename(filePath, '.md');
  const url = frontmatter.url || '';

  const chunks: Omit<GuideChunk, 'id' | 'vector'>[] = [];

  // ## 기준 분할
  const h2Sections = body.split(/^##\s+/gm);
  
  for (let i = 0; i < h2Sections.length; i++) {
    const raw = h2Sections[i].trim();
    if (!raw) continue;

    if (i === 0) {
      // 첫 번째 청크: ## 이전 내용 (개요/소개)
      // H1 제거
      const cleanedContent = raw.replace(/^#\s+.*\n?/, '').trim();
      if (cleanedContent.length >= 50) {
        chunks.push({
          title: docTitle,
          content: cleanedContent,
          source: filePath,
          layer,
          category,
          section: '개요',
          docTitle,
          url,
        });
      }
      continue;
    }

    // ## 섹션
    const lines = raw.split('\n');
    const sectionHeading = lines[0].trim();
    const sectionContent = lines.slice(1).join('\n').trim();

    if (sectionContent.length < 50) continue;

    // 긴 섹션은 ### 기준으로 추가 분할
    if (sectionContent.length > 2000) {
      const h3Sections = sectionContent.split(/^###\s+/gm);

      if (h3Sections.length > 1) {
        // ### 이전 내용
        const preH3 = h3Sections[0].trim();
        if (preH3.length >= 50) {
          chunks.push({
            title: `${docTitle}: ${sectionHeading}`,
            content: preH3,
            source: filePath,
            layer,
            category,
            section: sectionHeading,
            docTitle,
            url,
          });
        }

        // 각 ### 섹션
        for (let j = 1; j < h3Sections.length; j++) {
          const h3Lines = h3Sections[j].split('\n');
          const h3Heading = h3Lines[0].trim();
          const h3Content = h3Lines.slice(1).join('\n').trim();

          if (h3Content.length < 50) continue;

          chunks.push({
            title: `${docTitle}: ${sectionHeading} > ${h3Heading}`,
            content: h3Content,
            source: filePath,
            layer,
            category,
            section: `${sectionHeading} > ${h3Heading}`,
            docTitle,
            url,
          });
        }
        continue;
      }
    }

    // 일반 크기 섹션 - 그대로 추가
    chunks.push({
      title: `${docTitle}: ${sectionHeading}`,
      content: sectionContent,
      source: filePath,
      layer,
      category,
      section: sectionHeading,
      docTitle,
      url,
    });
  }

  return chunks;
}

// ─── 필터 값 해석 ─────────────────────────────────────────

/** 고유 값별 개수를 청크 수 내림차순(같으면 값 오름차순) 목록으로 바꾼다. */
function toFacetValues(counts: Map<string, number>): GuideFacetValue[] {
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
}

/**
 * 청크의 layer / category 값에서 필터에 쓸 수 있는 고유 값 목록을 만든다.
 */
export function buildGuideFacets(rows: Iterable<{ layer?: unknown; category?: unknown }>): GuideFacets {
  const layerCounts = new Map<string, number>();
  const categoryCounts = new Map<string, number>();
  const categoryCountsByLayer = new Map<string, Map<string, number>>();
  const increment = (counts: Map<string, number>, value: string) => counts.set(value, (counts.get(value) ?? 0) + 1);

  for (const row of rows) {
    const layer = String(row.layer ?? '');
    const category = String(row.category ?? '');
    if (!layer) continue;

    increment(layerCounts, layer);
    let inLayer = categoryCountsByLayer.get(layer);
    if (!inLayer) {
      inLayer = new Map();
      categoryCountsByLayer.set(layer, inLayer);
    }

    // 빈 category (layer 바로 아래 문서) 는 필터로 지정할 수 없는 값이라 목록에 넣지 않는다
    if (category) {
      increment(categoryCounts, category);
      increment(inLayer, category);
    }
  }

  const layers = toFacetValues(layerCounts);
  return {
    layers,
    categories: toFacetValues(categoryCounts),
    categoriesByLayer: Object.fromEntries(
      layers.map(({ value }) => [value, toFacetValues(categoryCountsByLayer.get(value) ?? new Map())]),
    ),
  };
}

/** 필터 입력을 비교할 수 있는 문자열로 바꾼다 (앞뒤 공백 제거, 비어 있으면 필터 없음). */
function normalizeFilterInput(value: unknown): string {
  return value === undefined || value === null ? '' : String(value).trim();
}

/**
 * 입력 값에 대응하는 저장 값을 찾는다.
 * 정확히 같은 값이 있으면 그 값만, 없으면 대소문자만 다른 값을 모두 돌려준다.
 */
function matchStoredValues(input: string, stored: string[]): string[] {
  if (stored.includes(input)) {
    return [input];
  }
  const lowered = input.toLowerCase();
  return stored.filter((value) => value.toLowerCase() === lowered);
}

/** 오류 문구에 나열하는 '사용할 수 있는 값'의 최대 개수 */
const MAX_LISTED_FILTER_VALUES = 30;

/**
 * 오류 문구에 넣을 값 목록. 앞에서 30개까지만 나열하고 나머지는 '외 N개' 로 줄인다.
 *
 * 고유 값이 많은 테이블(예: 경로 전체가 layer 로 색인된 옛 인덱스)에서 오류 한 건이 수만 자가
 * 되지 않게 한다. 목록은 청크 수 내림차순이라 앞쪽이 주요 값이다.
 */
function listValues(values: string[]): string {
  if (values.length === 0) {
    return '(없음)';
  }
  if (values.length <= MAX_LISTED_FILTER_VALUES) {
    return values.join(', ');
  }
  const omitted = values.length - MAX_LISTED_FILTER_VALUES;
  return `${values.slice(0, MAX_LISTED_FILTER_VALUES).join(', ')} 외 ${omitted}개`;
}

/**
 * 입력한 layer / category 를 테이블에 저장된 값에 대응시킨다.
 *
 * 필터는 저장된 값과 정확히 일치해야 걸리는데 호출자는 저장된 값을 알 방법이 없다.
 * 대소문자와 앞뒤 공백 차이는 흡수하고, 대응되는 값이 없으면 "결과 없음" 대신 유효한 값을
 * 나열한 UserFacingError 를 던진다. layer 는 전체를, category 는 layer 가 주어졌으면 그 layer 의
 * category 만 나열한다 (같은 이름의 category 가 여러 layer 에 있다). 나열은 청크가 많은 값부터
 * 30개까지이고 나머지는 '외 N개' 로 줄인다 (listValues).
 *
 * @returns where 절에 넣을 저장 값 (필터가 없으면 빈 배열)
 */
export function resolveGuideFilter(
  facets: GuideFacets,
  layer?: string,
  category?: string,
): { layers: string[]; categories: string[] } {
  const wantedLayer = normalizeFilterInput(layer);
  const wantedCategory = normalizeFilterInput(category);

  let layers: string[] = [];
  if (wantedLayer) {
    const known = facets.layers.map((facet) => facet.value);
    layers = matchStoredValues(wantedLayer, known);
    if (layers.length === 0) {
      throw new UserFacingError(
        `알 수 없는 layer 값입니다: ${quoteFilterValue(wantedLayer)}. 사용할 수 있는 값: ${listValues(known)}`,
      );
    }
  }

  let categories: string[] = [];
  if (wantedCategory) {
    const known =
      layers.length > 0
        ? [
            ...new Set(
              layers.flatMap((value) =>
                Object.hasOwn(facets.categoriesByLayer, value)
                  ? facets.categoriesByLayer[value].map((facet) => facet.value)
                  : [],
              ),
            ),
          ]
        : facets.categories.map((facet) => facet.value);
    categories = matchStoredValues(wantedCategory, known);
    if (categories.length === 0) {
      const scope = layers.length > 0 ? ` (layer ${layers.join(', ')})` : '';
      throw new UserFacingError(
        `알 수 없는 category 값입니다: ${quoteFilterValue(wantedCategory)}${scope}. 사용할 수 있는 값: ${listValues(known)}`,
      );
    }
  }

  return { layers, categories };
}

// ─── GuideSearchManager 클래스 ───────────────────────────

export class GuideSearchManager {
  private db!: lancedb.Connection;
  private table!: any;
  private dbPath: string;
  private tableName = 'egovframe_guide';

  constructor(dbPath?: string) {
    const currentFile = fileURLToPath(import.meta.url);
    // 오버레이(사용자 update 적용분) 우선, 없으면 번들 knowledge-base
    this.dbPath = dbPath || resolveGuideDbDir(currentFile);
  }

  /**
   * 데이터베이스 초기화
   *
   * createIfMissing (기본 true): 테이블이 없으면 새로 만든다. 인덱스 구축과 update CLI 가 쓴다.
   * 검색 서버는 false 로 호출한다. 이때는 테이블을 만들지 않고, 인덱스가 설치되지 않았다는
   * 안내 오류를 던진다 (빈 테이블을 만들어 "결과 0건"으로 보이게 하지 않는다).
   */
  async initialize(options: { createIfMissing?: boolean } = {}): Promise<void> {
    const createIfMissing = options.createIfMissing ?? true;

    if (!createIfMissing && !fs.existsSync(path.join(this.dbPath, `${this.tableName}.lance`))) {
      throw new UserFacingError(
        `공식 가이드 인덱스(knowledge-base/${this.tableName}.lance)를 찾을 수 없습니다. 설치한 패키지에 ` +
          'knowledge-base 디렉토리가 포함되어 있는지 확인하세요. 저장소를 클론해 쓰는 경우에는 ' +
          'npm run build-index 로 인덱스를 구축할 수 있습니다.',
      );
    }

    try {
      this.db = await lancedb.connect(this.dbPath);

      try {
        this.table = await this.db.openTable(this.tableName);
        console.error(`✅ eGovFrame 가이드 검색 테이블 로드 완료 (${this.tableName})`);
      } catch (error) {
        if (!createIfMissing) {
          throw error;
        }
        console.error(`📝 eGovFrame 가이드 테이블을 새로 생성합니다...`);
        await this.createTable();
      }
    } catch (error) {
      console.error('❌ LanceDB 초기화 실패:', error);
      throw error;
    }
  }

  /**
   * 테이블 생성 (스키마 추론용 더미 데이터)
   */
  private async createTable(): Promise<void> {
    const dummyData = {
      id: '__placeholder__',
      title: 'Placeholder',
      content: 'This is a placeholder entry.',
      source: 'placeholder.md',
      layer: 'placeholder',
      category: 'placeholder',
      section: 'placeholder',
      docTitle: 'Placeholder',
      url: '/placeholder/',
      vector: new Array(384).fill(0),
    };

    this.table = await this.db.createTable(this.tableName, [dummyData]);
    await this.table.delete(`id = '__placeholder__'`);
    console.error(`✅ 테이블 '${this.tableName}' 생성 완료`);
  }

  /**
   * 기존 데이터 전체 삭제 (재인덱싱 시)
   */
  async clearAll(): Promise<void> {
    try {
      await this.db.dropTable(this.tableName);
      await this.createTable();
      console.error('🗑️ 기존 가이드 데이터 전체 삭제 완료');
    } catch {
      // 테이블이 없는 경우 무시
    }
  }

  /**
   * 배치 가이드 청크 추가
   */
  async addGuideBatch(chunks: Omit<GuideChunk, 'id' | 'vector'>[]): Promise<number> {
    if (chunks.length === 0) return 0;

    const embedder = getEmbedder();

    console.error(`📦 ${chunks.length}개 가이드 청크 처리 중...`);

    // 검색 텍스트 생성
    const searchTexts = chunks.map(chunk =>
      this.createSearchText(chunk.title, chunk.content, chunk.layer, chunk.category)
    );

    // 배치 임베딩 생성 (인덱싱용: passage prefix)
    const vectors = await embedder.embedBatch(searchTexts, {
      purpose: 'passage',
      onProgress: (current, total) => {
        if (current % 100 === 0 || current === total) {
          console.error(`  임베딩 진행률: ${current}/${total}`);
        }
      },
    });

    const guideChunks: GuideChunk[] = chunks.map((chunk, idx) => ({
      ...chunk,
      id: randomUUID(),
      vector: Array.from(vectors[idx]),
    }));

    await this.table.add(guideChunks);

    console.error(`✅ ${chunks.length}개 가이드 청크 추가 완료`);
    return chunks.length;
  }

  /**
   * 가이드 검색 (의미 기반)
   */
  async searchGuide(
    query: string,
    options: GuideSearchOptions = {}
  ): Promise<GuideSearchResult[]> {
    const { layer, category } = options;
    // 전수 검색이라 limit 을 그대로 넘기면 음수·초대형 값 한 번에 테이블 전체가 결과로 나간다
    const limit = clampSearchLimit(options.limit, DEFAULT_GUIDE_SEARCH_LIMIT);

    // 필터 조건 생성 — 입력 오류는 임베딩 모델을 불러오기 전에 알린다
    const filter = await this.buildFilter(layer, category);

    const embedder = getEmbedder();
    const queryVector = await embedder.embed(query, 'query');

    // 벡터 검색 — 인덱스를 건너뛰고 전수 검색한다.
    // 동봉 테이블의 IVF_PQ 인덱스는 기본 설정으로 일부 파티션만 훑어, 필터(where)에 맞는 청크가
    // 있어도 빠뜨리고 손상된 인덱스 항목 때문에 엉뚱한 문서를 돌려준다. 수천 행 규모에서는
    // 전수 검색이 인덱스 검색과 지연 시간이 같다. where 는 사전 필터라 조건에 맞는 청크 안에서 limit 건을 채운다.
    // 거리는 코사인 거리로 계산한다 (기본값 l2 는 제곱 유클리드 거리라 1 - 거리가 유사도가 되지 않는다).
    // distanceType 은 전수 검색일 때만 유효하다 — 인덱스(l2 로 학습됨)를 타면 무시된다.
    let searchQuery = this.table
      .vectorSearch(Array.from(queryVector))
      .bypassVectorIndex()
      .distanceType('cosine')
      .limit(limit);

    if (filter) {
      searchQuery = searchQuery.where(filter);
    }

    const results = await searchQuery.toArray();

    return results.map((r: any) => ({
      id: r.id,
      title: r.title,
      content: r.content,
      source: r.source,
      layer: r.layer,
      category: r.category,
      section: r.section,
      docTitle: r.docTitle,
      url: r.url,
      score: r._distance,
    }));
  }

  /**
   * id 로 청크 하나를 찾는다. 없으면 null.
   * 검색 결과에서 잘린 본문을 이어 읽을 때 쓴다 (id 는 인덱스를 다시 구축하면 바뀐다).
   */
  async getChunkById(id: string): Promise<Omit<GuideSearchResult, 'score'> | null> {
    const rows = await this.table
      .query()
      .where(lanceEquals('id', id))
      .select(['id', 'title', 'content', 'source', 'layer', 'category', 'section', 'docTitle', 'url'])
      .limit(1)
      .toArray();
    const row = rows[0] as Record<string, string> | undefined;
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      source: row.source,
      layer: row.layer,
      category: row.category,
      section: row.section,
      docTitle: row.docTitle,
      url: row.url,
    };
  }

  /** layer / category 고유 값 캐시 — 테이블 핸들과 버전이 그대로일 때만 유효하다 */
  private facetsCache: { table: unknown; version: number; facets: GuideFacets } | null = null;

  /**
   * 필터(layer / category)에 쓸 수 있는 고유 값 목록.
   *
   * 테이블에서 한 번 읽어 캐시하고, 테이블이 다시 열리거나 내용이 바뀌면 다시 읽는다.
   * 돌려주는 객체는 복사본이라 호출자가 바꿔도 캐시에 영향이 없다.
   */
  async getFacets(): Promise<GuideFacets> {
    return structuredClone(await this.loadFacets());
  }

  /** 캐시된 고유 값 목록 (없거나 테이블이 바뀌었으면 layer / category 두 컬럼만 읽어 다시 만든다). */
  private async loadFacets(): Promise<GuideFacets> {
    const version: number = await this.table.version();
    const cached = this.facetsCache;
    if (cached && cached.table === this.table && cached.version === version) {
      return cached.facets;
    }

    const rows = await this.table.query().select(['layer', 'category']).toArray();
    const facets = buildGuideFacets(rows);
    this.facetsCache = { table: this.table, version, facets };
    return facets;
  }

  /**
   * layer / category 입력을 저장된 값에 대응시켜 where 절을 만든다. 필터가 없으면 undefined.
   * 대응되는 값이 없으면 UserFacingError (resolveGuideFilter 참고).
   */
  private async buildFilter(layer?: string, category?: string): Promise<string | undefined> {
    if (!normalizeFilterInput(layer) && !normalizeFilterInput(category)) {
      return undefined;
    }

    const { layers, categories } = resolveGuideFilter(await this.loadFacets(), layer, category);
    const filters: string[] = [];
    if (layers.length > 0) {
      filters.push(lanceIn('layer', layers));
    }
    if (categories.length > 0) {
      filters.push(lanceIn('category', categories));
    }
    return filters.length > 0 ? filters.join(' AND ') : undefined;
  }

  /**
   * 인덱스 통계 조회
   */
  async getStats(): Promise<{ total: number; byLayer: Record<string, number> }> {
    const all = await this.table.query().toArray();

    const byLayer: Record<string, number> = {};
    for (const row of all) {
      const layer = row.layer;
      byLayer[layer] = (byLayer[layer] || 0) + 1;
    }

    return { total: all.length, byLayer };
  }

  /**
   * 벡터 인덱스 생성 (성능 향상)
   */
  async createIndex(): Promise<void> {
    console.error('🔨 가이드 벡터 인덱스 생성 중...');

    try {
      await this.table.createIndex('vector', {
        config: lancedb.Index.ivfPq({
          numPartitions: 256,
          numSubVectors: 96,
        }),
      });
      console.error('✅ 가이드 벡터 인덱스 생성 완료');
    } catch (error) {
      console.warn('⚠️ 인덱스 생성 실패 (데이터가 부족할 수 있음):', error);
    }
  }

  /**
   * 테이블 최적화
   */
  async optimize(): Promise<void> {
    console.error('⚡ 가이드 테이블 최적화 중...');
    await this.table.optimize();
    console.error('✅ 최적화 완료');
  }

  /**
   * 검색 텍스트 생성 (임베딩용)
   */
  private createSearchText(
    title: string,
    content: string,
    layer: string,
    category: string,
  ): string {
    const parts = [
      `제목: ${title}`,
      `내용: ${content}`,
    ];

    if (layer) {
      parts.push(`분류: ${layer}`);
    }

    if (category) {
      parts.push(`카테고리: ${category}`);
    }

    return parts.join('\n');
  }
}

// ─── 싱글톤 인스턴스 ─────────────────────────────────────

let guideManagerInstance: GuideSearchManager | null = null;

/**
 * 싱글톤 GuideSearchManager 인스턴스 가져오기
 */
export function getGuideManager(): GuideSearchManager {
  if (!guideManagerInstance) {
    guideManagerInstance = new GuideSearchManager();
  }
  return guideManagerInstance;
}

let guideManagerReady: Promise<GuideSearchManager> | null = null;

/**
 * 열어 둔 가이드 인덱스 연결을 버린다. 다음 호출에서 경로를 다시 해석해 새로 연다.
 * 실행 중에 인덱스가 교체되어 읽기에 실패했을 때 쓴다.
 */
export function resetGuideManager(): void {
  guideManagerInstance = null;
  guideManagerReady = null;
}

/**
 * 초기화된 GuideSearchManager 인스턴스 반환 (검색 서버용)
 *
 * 테이블은 한 번만 열어 재사용하고, 없는 테이블을 새로 만들지 않는다.
 * 초기화에 실패하면 다음 호출에서 다시 시도한다.
 */
export async function getInitializedGuideManager(): Promise<GuideSearchManager> {
  if (!guideManagerReady) {
    const manager = getGuideManager();
    guideManagerReady = manager.initialize({ createIfMissing: false }).then(
      () => manager,
      (error: unknown) => {
        guideManagerReady = null;
        throw error;
      },
    );
  }
  return guideManagerReady;
}
