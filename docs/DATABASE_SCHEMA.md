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
| 2 | `component_categories` | 공통컴포넌트 카테고리 | `templates/common-components.json` | 37 |
| 3 | `common_components` | 공통컴포넌트 | `templates/common-components.json` | 147 |
| 4 | `component_dependencies` | 컴포넌트 의존성 | `templates/common-components.json` | ~1,400 |

### LanceDB (벡터 데이터, 384차원 임베딩)

| # | 테이블 | 설명 | 데이터 소스 | 레코드 수 |
|---|--------|------|-------------|-----------|
| 5 | `developer_knowledge` | 개발자 지식베이스 | `templates/developer_knowledge/`의 FAQ/Q&A/PDF → `npm run build-index` | 초기 구축 + 동적 |
| 6 | `egovframe_guide` | eGovFrame 공식 가이드 문서 | [egovframework/egovframe-docs](https://github.com/egovframework/egovframe-docs) Git 저장소 → `templates/egovframe_guide/` | ~1,867 청크 |

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

### 2. component_categories (컴포넌트 카테고리)

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

### 3. common_components (공통컴포넌트)

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

### 4. component_dependencies (컴포넌트 의존성)

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
│                      (4 테이블 + 2 FTS 가상 테이블)                       │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────┐
│ compatibility_      │
│ software            │
├─────────────────────┤
│ id (PK)             │
│ product_name        │
│ product_version     │
│ framework_version   │
│ category            │
│ compatibility_level │
│ vendor              │
│ verified_date       │
│ description         │
│ url                 │
│ created_at          │
└─────────────────────┘

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

# 2. 전체 데이터 인덱싱 (SQLite: 호환성 SW, 공통컴포넌트 / LanceDB: developer_knowledge, egovframe_guide)
npm run build-index
```

> 📌 `build-index` 하나로 SQLite(호환성 SW, 공통컴포넌트)와 LanceDB(developer_knowledge, egovframe_guide) 데이터를 구축합니다.
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

### 5. developer_knowledge (개발자 지식베이스)

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

### 6. egovframe_guide (eGovFrame 공식 가이드)

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
interface ComponentCategory { ... }      // 컴포넌트 카테고리
interface CommonComponent { ... }        // 공통컴포넌트
interface ComponentDependency { ... }    // 컴포넌트 의존성
```
