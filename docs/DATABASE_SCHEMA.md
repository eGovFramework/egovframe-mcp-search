# 📊 데이터베이스 스키마 가이드

eGovFrame MCP Companion의 SQLite + LanceDB 하이브리드 데이터베이스 스키마 상세 문서입니다.

## 📁 데이터베이스 위치

```
knowledge-base/
├── egovframe.db                # SQLite 메인 데이터베이스 (정형 데이터)
├── egovframe.db-shm            # WAL 공유 메모리 (임시)
├── egovframe.db-wal            # Write-Ahead Log (임시)
├── developer_knowledge.lance/  # LanceDB 벡터 데이터베이스 (지식베이스)
└── egovframe_guide.lance/      # LanceDB 벡터 데이터베이스 (가이드 문서)
```

> ⚠️ `knowledge-base/` 폴더는 `.gitignore`에 포함되어 있어 개인 로컬 데이터로 관리됩니다.

---

## 🗂️ 테이블 개요

### SQLite (정형 데이터)

| # | 테이블 | 설명 | 데이터 소스 | 레코드 수 |
|---|--------|------|-------------|-----------|
| 1 | `compatibility_software` | 호환성 소프트웨어 정보 | `templates/compatibility/compatibility-software.json` | ~481 |
| 2 | `standard_terms` | 표준 용어 (행안부) | `templates/standard_terms/mois_standard_terms.csv` | ~13,159 |
| 3 | `standard_words` | 표준 단어 (행안부) | `templates/standard_terms/mois_standard_words.csv` | ~3,280 |
| 4 | `standard_domains` | 표준 도메인 (행안부) | `templates/standard_terms/mois_standard_domains.csv` | ~126 |
| 4a | `custom_terms` | 기관 Custom 용어 (override 우선) | `templates/custom_terms/custom_standard_terms.csv` | 기관별 |
| 4b | `custom_words` | 기관 Custom 단어 | `templates/custom_terms/custom_standard_words.csv` | 기관별 |
| 4c | `custom_domains` | 기관 Custom 도메인 | `templates/custom_terms/custom_standard_domains.csv` | 기관별 |
| 5 | `component_categories` | 공통컴포넌트 카테고리 | `templates/common-components.json` | 37 |
| 6 | `common_components` | 공통컴포넌트 | `templates/common-components.json` | 147 |
| 7 | `component_dependencies` | 컴포넌트 의존성 | `templates/common-components.json` | ~1,400 |

### LanceDB (벡터 데이터, 384차원 임베딩)

| # | 테이블 | 설명 | 데이터 소스 | 레코드 수 |
|---|--------|------|-------------|-----------|
| 8 | `developer_knowledge` | 개발자 지식베이스 | `templates/developer_knowledge/`의 FAQ/Q&A/PDF → `npm run build-index` | 초기 구축 + 동적 |
| 9 | `egovframe_guide` | eGovFrame 공식 가이드 문서 | [egovframework/egovframe-docs](https://github.com/egovframework/egovframe-docs) Git 저장소 → `templates/egovframe_guide/` | ~1,867 청크 |

---

## 📋 테이블 스키마 상세

### 1. compatibility_software (호환성 소프트웨어)

eGovFrame 버전별 호환 소프트웨어 정보를 저장합니다.

```sql
CREATE TABLE compatibility_software (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_name TEXT NOT NULL,           -- 제품명
  product_version TEXT NOT NULL,        -- 제품 버전
  framework_version TEXT NOT NULL,      -- eGovFrame 버전 ('4.3', '4.2' 등)
  category TEXT NOT NULL,               -- 카테고리 ('CMS Solution', 'Portal Solution' 등)
  compatibility_level INTEGER NOT NULL, -- 호환 레벨 (1 또는 2)
  vendor TEXT NOT NULL,                 -- 벤더/제조사
  verified_date TEXT NOT NULL,          -- 검증일 (ISO 8601: YYYY-MM-DD)
  description TEXT,                     -- 설명
  url TEXT,                             -- 참조 URL
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(product_name, product_version, framework_version),
  CHECK(compatibility_level IN (1, 2))
);
```

**인덱스:**
```sql
CREATE INDEX idx_compat_framework ON compatibility_software(framework_version);
CREATE INDEX idx_compat_category ON compatibility_software(category);
CREATE INDEX idx_compat_level ON compatibility_software(compatibility_level);
CREATE INDEX idx_compat_verified_date ON compatibility_software(verified_date DESC);
```

**관련 공개 도구:** `egov_search_knowledge(scope: "compatibility")`

---

### 2. standard_terms (표준 용어)

행정안전부 공공데이터 공통표준용어 (data.go.kr/15156379, 8차 2025-11). 폐기 표기된 행은 적재 시 제외하여 약 13,159개 활성 용어만 보존.

```sql
CREATE TABLE standard_terms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  korean_name TEXT NOT NULL UNIQUE,     -- 공통표준용어명 (예: '게시판ID')
  english_name TEXT NOT NULL,           -- 공통표준용어영문약어명 (예: 'BBS_ID')
  description TEXT,                     -- 공통표준용어설명
  domain_name TEXT,                     -- 공통표준도메인명 (FK 성격, 비강제)
  allowed_values TEXT,                  -- 허용값
  storage_format TEXT,                  -- 저장 형식
  display_format TEXT,                  -- 표현 형식
  standard_code_name TEXT,              -- 행정표준코드명
  authority TEXT,                       -- 소관기관명
  synonyms TEXT,                        -- 용어 이음동의어 목록 (LLM DDL 보조의 핵심 신호)
  revision_round TEXT,                  -- 제정차수 (예: '8차(2025-11)')
  revision_type TEXT,                   -- 개정구분명 (변경/폐기)
  revision_item TEXT,                   -- 개정항목
  revision_reason TEXT                  -- 개정사유
);
```

**인덱스:**
```sql
CREATE INDEX idx_term_english ON standard_terms(english_name);
```

**데이터 소스:** `templates/standard_terms/mois_standard_terms.csv` (data.go.kr/data/15156379)

**적재 규칙:**
- `제정차수` 가 `(폐기)` 표기이고 `폐기후제정` 이 아닌 행은 제외 (deprecated 표준이 DDL 생성에 잡히지 않게).
- CSV 빈 셀과 `-` 는 NULL 로 정규화.

**관련 공개 도구:** `egov_search_knowledge(scope: "terms")`

---

### 3. standard_words (표준 단어)

행정안전부 공공데이터 공통표준단어 (data.go.kr/15156439, 8차 2025-11). 폐기 행 제외 후 약 3,280개 활성 단어. 단어는 표준 용어를 구성하는 최소 단위로, DDL 컬럼명 신규 조합 시 사용됨.

```sql
CREATE TABLE standard_words (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  korean_name TEXT NOT NULL UNIQUE,     -- 공통표준단어명 (예: '게시판')
  english_name TEXT NOT NULL,           -- 공통표준단어영문약어명 (예: 'BBS')
  english_full_name TEXT,               -- 공통표준단어 영문명 (예: 'Bulletin Board System')
  description TEXT,                     -- 공통표준단어 설명
  is_format_word INTEGER DEFAULT 0,     -- 형식단어여부 (0/1) — 도메인을 의미하는 단어
  domain_category TEXT,                 -- 공통표준도메인분류명 (형식단어인 경우)
  synonyms TEXT,                        -- 이음동의어 목록
  forbidden_words TEXT,                 -- 금칙어 목록
  revision_round TEXT,                  -- 제정차수
  revision_type TEXT,                   -- 개정구분명
  revision_item TEXT,                   -- 개정항목
  revision_reason TEXT                  -- 개정사유
);
```

**인덱스:**
```sql
CREATE INDEX idx_word_english ON standard_words(english_name);
```

**데이터 소스:** `templates/standard_terms/mois_standard_words.csv` (data.go.kr/data/15156439)

**적재 규칙:** `제정차수` 가 `(폐기)` 인 행은 제외. `형식단어여부` 는 `Y` → 1, 그 외 → 0.

---

### 4. standard_domains (표준 도메인)

행정안전부 공공데이터 공통표준도메인 (data.go.kr/15156442, 8차 2025-11). 폐기 행 제외 후 약 126개 활성 도메인. DDL 생성 시 도메인명 → SQL 데이터 타입/길이 매핑의 정답지 역할.

```sql
CREATE TABLE standard_domains (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain_name TEXT NOT NULL UNIQUE,     -- 공통표준도메인명 (예: '금액N15', '명V100')
  domain_group TEXT,                    -- 공통표준도메인그룹명 (예: '금액')
  domain_category TEXT,                 -- 공통표준도메인분류명 (예: '금액', '가격')
  description TEXT,                     -- 공통표준도메인설명
  data_type TEXT NOT NULL,              -- 데이터타입 (NUMERIC | VARCHAR | CHAR | DATETIME)
  data_length TEXT,                     -- 데이터길이 (예: '15')
  decimal_length TEXT,                  -- 데이터소수점길이
  storage_format TEXT,                  -- 저장형식 (예: '999999999999999')
  display_format TEXT,                  -- 표현형식
  unit TEXT,                            -- 단위 (예: '원', '건')
  allowed_values TEXT,                  -- 허용값
  standard_code_name TEXT,              -- (구) 행정표준 코드명 — 8차 CSV 에는 없음, 레거시 호환용
  revision_round TEXT,                  -- 제정차수
  revision_type TEXT,                   -- 개정구분명
  revision_item TEXT,                   -- 개정항목
  revision_reason TEXT                  -- 개정사유
);
```

**데이터 소스:** `templates/standard_terms/mois_standard_domains.csv` (data.go.kr/data/15156442)

**적재 규칙:** `제정차수` 가 `(폐기)` 인 행은 제외. CSV 빈 셀과 `-` 는 NULL 로 정규화.

---

### 4a-4c. custom_terms / custom_words / custom_domains (기관 Custom 사전)

행정안전부 공통표준용어를 기관별로 확장한 사전. **단일 기관 deployment** 기준. 스키마는 standard 짝과 완전히 동일하게 미러링 (직렬화/검증 코드 재사용).

```sql
-- custom_terms: standard_terms 와 동일한 컬럼 셋
-- custom_words: standard_words 와 동일한 컬럼 셋
-- custom_domains: standard_domains 와 동일한 컬럼 셋
```

**데이터 소스:** `templates/custom_terms/custom_standard_*.csv` (gitignored, 기관별 자산)

**우선순위 정책 — `egov_ddl_assist` lookup 시:**
1. custom 사전에서 먼저 검색
2. 매치되면 standard 동등 항목(같은 korean_name/domain_name)을 함께 조회해 `standardEquivalent` 로 노출
3. custom 미매치 시 standard 사전 검색
4. 양쪽 모두 미매치 시 동의어 fallback (custom 동의어 → standard 동의어 순)

**build-index 시 충돌 감지:** 같은 korean_name 이 양쪽에 존재하지만 english_name/domain_name 이 다르면 콘솔에 경고 표시 (의도된 override 인지 확인용).

**적재 규칙:** standard 사전과 동일. `(폐기)` 행 제외, CSV 빈 셀/`-` → NULL.

---

### 5. component_categories (컴포넌트 카테고리)

공통컴포넌트 카테고리 분류입니다.

```sql
CREATE TABLE component_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id TEXT NOT NULL UNIQUE,     -- 카테고리 ID (예: '게시판', '로그인')
  name TEXT NOT NULL,                   -- 카테고리명 (한글)
  name_en TEXT,                         -- 카테고리명 (영문)
  description TEXT,                     -- 설명 (한글)
  description_en TEXT                   -- 설명 (영문)
);
```

**현재 데이터:** 37개 카테고리

---

### 6. common_components (공통컴포넌트)

eGovFrame 공통컴포넌트 정보입니다.

```sql
CREATE TABLE common_components (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  component_id TEXT NOT NULL UNIQUE,    -- 컴포넌트 ID (예: 'bbs', 'uia')
  name TEXT NOT NULL,                   -- 컴포넌트명 (한글)
  name_en TEXT,                         -- 컴포넌트명 (영문)
  category_id TEXT NOT NULL,            -- FK: 카테고리 ID
  package_name TEXT UNIQUE,             -- 패키지명 (예: 'egovframework.com.cop.bbs')
  description TEXT,                     -- 설명 (한글)
  description_en TEXT,                  -- 설명 (영문)
  use_tables TEXT,                      -- 사용 테이블 (JSON array)
  version TEXT DEFAULT '4.3.1',         -- 버전
  has_web INTEGER DEFAULT 1,            -- 웹 배포 여부 (0/1)
  added_options TEXT,                   -- 추가 옵션
  
  FOREIGN KEY (category_id) REFERENCES component_categories(category_id)
);
```

**인덱스:**
```sql
CREATE INDEX idx_comp_category ON common_components(category_id);
CREATE INDEX idx_comp_package ON common_components(package_name);
```

**현재 데이터:** 147개 컴포넌트

**관련 공개 도구:** `egov_search_knowledge(scope: "components")`

---

### 7. component_dependencies (컴포넌트 의존성)

컴포넌트 간 의존성 관계입니다.

```sql
CREATE TABLE component_dependencies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  component_id TEXT NOT NULL,           -- 컴포넌트 ID
  depends_on_package TEXT NOT NULL,     -- 의존 대상 패키지명
  
  UNIQUE(component_id, depends_on_package),
  FOREIGN KEY (component_id) REFERENCES common_components(component_id)
);
```

**인덱스:**
```sql
CREATE INDEX idx_comp_dep_component ON component_dependencies(component_id);
CREATE INDEX idx_comp_dep_package ON component_dependencies(depends_on_package);
```

**현재 데이터:** ~1,400개 의존성 관계

**관련 도구:** `resolve_component_dependencies`

---

## 🔍 FTS5 전체 텍스트 검색

### compatibility_fts

호환성 소프트웨어 전체 텍스트 검색을 위한 가상 테이블입니다.

```sql
CREATE VIRTUAL TABLE compatibility_fts USING fts5(
  product_name,
  vendor,
  category,
  description,
  content=compatibility_software,
  content_rowid=id
);
```

**자동 동기화 트리거:**
```sql
-- INSERT 트리거
CREATE TRIGGER compatibility_ai AFTER INSERT ON compatibility_software BEGIN
  INSERT INTO compatibility_fts(rowid, product_name, vendor, category, description)
  VALUES (new.id, new.product_name, new.vendor, new.category, new.description);
END;

-- DELETE 트리거
CREATE TRIGGER compatibility_ad AFTER DELETE ON compatibility_software BEGIN
  DELETE FROM compatibility_fts WHERE rowid = old.id;
END;

-- UPDATE 트리거
CREATE TRIGGER compatibility_au AFTER UPDATE ON compatibility_software BEGIN
  DELETE FROM compatibility_fts WHERE rowid = old.id;
  INSERT INTO compatibility_fts(rowid, product_name, vendor, category, description)
  VALUES (new.id, new.product_name, new.vendor, new.category, new.description);
END;
```

### components_fts

공통컴포넌트 전체 텍스트 검색을 위한 가상 테이블입니다.

```sql
CREATE VIRTUAL TABLE components_fts USING fts5(
  name,
  name_en,
  description,
  description_en,
  package_name,
  content=common_components,
  content_rowid=id
);
```

---

## 📊 ER 다이어그램

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        eGovFrame MCP Database                           │
│                      (7 테이블 + 2 FTS 가상 테이블)                       │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────┐       ┌──────────────────────┐
│ compatibility_      │       │ standard_terms       │
│ software            │       ├──────────────────────┤
├─────────────────────┤       │ id (PK)              │
│ id (PK)             │       │ korean_name (UK)     │
│ product_name        │       │ english_name         │
│ product_version     │       │ description          │
│ framework_version   │       │ domain_name          │
│ category            │       │ ...                  │
│ compatibility_level │       └──────────────────────┘
│ vendor              │
│ verified_date       │       ┌──────────────────────┐
│ description         │       │ standard_words       │
│ url                 │       ├──────────────────────┤
│ created_at          │       │ id (PK)              │
└─────────────────────┘       │ korean_name (UK)     │
                              │ english_name         │
                              │ english_full_name    │
                              │ description          │
                              │ is_format_word       │
                              │ domain_category      │
                              │ synonyms             │
                              │ forbidden_words      │
                              └──────────────────────┘

                              ┌──────────────────────┐
                              │ standard_domains     │
                              ├──────────────────────┤
                              │ id (PK)              │
                              │ domain_name (UK)     │
                              │ domain_group         │
                              │ domain_category      │
                              │ description          │
                              │ data_type            │
                              │ data_length          │
                              │ decimal_length       │
                              │ storage_format       │
                              │ display_format       │
                              │ unit                 │
                              │ allowed_values       │
                              │ standard_code_name   │
                              └──────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                       공통컴포넌트 관계도                                 │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────┐       ┌─────────────────────┐
│ component_          │       │ common_components   │
│ categories          │       ├─────────────────────┤
├─────────────────────┤   1:N │ id (PK)             │
│ id (PK)             │◄──────│ component_id (UK)   │
│ category_id (UK)    │       │ name                │
│ name                │       │ name_en             │
│ name_en             │       │ category_id (FK)────┼───►
│ description         │       │ package_name (UK)   │
│ description_en      │       │ description         │
└─────────────────────┘       │ use_tables (JSON)   │
                              │ version             │
                              │ has_web             │
                              └──────────┬──────────┘
                                         │
                                         │ 1:N
                                         ▼
                              ┌─────────────────────┐
                              │ component_          │
                              │ dependencies        │
                              ├─────────────────────┤
                              │ id (PK)             │
                              │ component_id (FK)───┼───►
                              │ depends_on_package  │
                              └─────────────────────┘
```

---

## 📈 데이터 통계

### 현재 데이터 현황

**SQLite:**

| 테이블 | 레코드 수 | 임포트 방법 |
|--------|-----------|-------------|
| `compatibility_software` | ~481 | `npm run build-index` |
| `standard_terms` | 535 | `npm run build-index` |
| `standard_words` | 339 | `npm run build-index` |
| `standard_domains` | 62 | `npm run build-index` |
| `component_categories` | 37 | `npm run build-index` |
| `common_components` | 147 | `npm run build-index` |
| `component_dependencies` | ~1,400 | `npm run build-index` |

**LanceDB:**

| 테이블 | 레코드 수 | 임포트 방법 | 비고 |
|--------|-----------|-------------|------|
| `developer_knowledge` | FAQ/Q&A + PDF 청크 | `npm run build-index` | `templates/developer_knowledge/`를 읽어 `clearAll()` 후 재구축 |
| `egovframe_guide` | ~1,867 청크 | `npm run build-index` | `egovframe-docs` 저장소를 `templates/egovframe_guide/`에 자동 clone/pull 후 마크다운 청킹 → 벡터화 |

### 데이터 초기화

```bash
# 1. 프로젝트 빌드
npm run build

# 2. 전체 데이터 인덱싱 (SQLite: 호환성 SW, 표준 데이터, 공통컴포넌트 / LanceDB: developer_knowledge, egovframe_guide)
npm run build-index
```

> 📌 `build-index` 하나로 SQLite(호환성 SW, 표준 데이터, 공통컴포넌트)와 LanceDB(developer_knowledge, egovframe_guide) 데이터를 구축합니다.
> ⚠️ `developer_knowledge`는 `clearAll()` 후 `templates/developer_knowledge/`의 FAQ/Q&A/PDF로 다시 구축되므로, 기존 런타임 추가 지식도 초기화됩니다.
> 💡 호환성 SW Excel 원본이 업데이트되면 `python3 notebooks/convert-compatibility-xlsx-to-json.py --json`으로 JSON을 재생성한 후 `npm run build-index`를 실행하세요.

---

## 🔧 데이터베이스 관리

### 스키마 초기화

데이터베이스 테이블은 `SQLiteManager` 클래스 생성 시 자동으로 초기화됩니다:

```typescript
// src/database/sqliteManager.ts
constructor(dbPath?: string) {
  this.db = new Database(this.dbPath);
  this.db.pragma('journal_mode = WAL');
  this.initializeTables();  // 테이블 자동 생성
}
```

### WAL 모드

성능 향상을 위해 WAL(Write-Ahead Logging) 모드를 사용합니다:

```sql
PRAGMA journal_mode = WAL;
```

**장점:**
- 동시 읽기/쓰기 성능 향상
- 충돌 시 데이터 안전성 보장
- 빠른 트랜잭션 처리

### DB 재구축 (초기화)

```bash
# 기존 DB 삭제 후 재생성
rm -f knowledge-base/egovframe.db*
npm run build-index
```

---

## 📚 관련 문서

- [HYBRID_SYSTEM_GUIDE.md](./HYBRID_SYSTEM_GUIDE.md) - 하이브리드 시스템 개요
- [EGOV_SEARCH_KNOWLEDGE_TOOL.md](./EGOV_SEARCH_KNOWLEDGE_TOOL.md) - 통합 검색과 공통컴포넌트 조회
- [TESTING_GUIDE.md](./TESTING_GUIDE.md) - 테스트 가이드

---

## 🧠 LanceDB 벡터 테이블

### 8. developer_knowledge (개발자 지식베이스)

FAQ/Q&A/PDF 기반 초기 지식과 사용자가 추가한 개발 지식을 벡터로 저장합니다.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | string | UUID |
| `type` | string | 유형 (`tip`, `troubleshooting`, `best-practice`, `configuration`, `migration` 등) |
| `title` | string | 제목 |
| `content` | string | 본문 내용 |
| `context` | string | 컨텍스트 설명 |
| `tags` | list\<string\> | 태그 목록 |
| `importance` | int | 중요도 (1~5) |
| `verified` | boolean | 검증 여부 |
| `createdAt` | string | 생성일시 (ISO 8601) |
| `updatedAt` | string | 수정일시 (ISO 8601) |
| `vector` | list\<float\> (384차원) | 임베딩 벡터 (all-MiniLM-L6-v2) |

**데이터 소스:**
- 초기 구축: `templates/developer_knowledge/`의 FAQ/Q&A Excel 및 적용가이드 PDF를 `npm run build-index`로 적재
- 런타임 직접 변경 도구는 외부에 노출하지 않으며, 원천 데이터를 갱신한 뒤 인덱스를 재생성합니다.
- 주의: `build-index`는 이 테이블을 `clearAll()` 후 재구축합니다.

**관련 공개 도구:** `egov_search_knowledge(scope: "knowledge")`

---

### 9. egovframe_guide (eGovFrame 공식 가이드)

eGovFrame 공식 문서를 청크 단위로 벡터화하여 시맨틱 검색을 지원합니다.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | string | UUID |
| `title` | string | 청크 제목 (마크다운 헤더) |
| `content` | string | 청크 본문 |
| `docTitle` | string | 원본 문서 제목 (프론트매터 `title`) |
| `layer` | string | 레이어 (`실행환경`, `개발환경`, `공통컴포넌트` 등) |
| `category` | string | 카테고리 (`데이터처리`, `AOP`, `배치처리` 등) |
| `filePath` | string | 원본 마크다운 파일 경로 (상대 경로) |
| `vector` | list\<float\> (384차원) | 임베딩 벡터 (all-MiniLM-L6-v2) |

**데이터 소스:** [egovframework/egovframe-docs](https://github.com/egovframework/egovframe-docs) → `templates/egovframe_guide/`에 shallow clone 후 마크다운 파싱 → 프론트매터 메타데이터 추출 → 청킹 → 벡터화

**관련 도구:** `search_guide`

---

## 📝 타입 정의

TypeScript 타입 정의는 `src/types/database.ts`에서 관리됩니다:

```typescript
// 주요 인터페이스
interface CompatibilitySoftware { ... }  // 호환성 소프트웨어
interface StandardTerm { ... }           // 표준 용어
interface StandardWord { ... }           // 표준 단어 (8 필드)
interface StandardDomain { ... }         // 표준 도메인 (12 필드)
interface ComponentCategory { ... }      // 컴포넌트 카테고리
interface CommonComponent { ... }        // 공통컴포넌트
interface ComponentDependency { ... }    // 컴포넌트 의존성
```
