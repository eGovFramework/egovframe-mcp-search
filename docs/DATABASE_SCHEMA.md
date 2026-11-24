# 📊 데이터베이스 스키마 가이드

eGovFrame MCP Search(`egovframe-mcp-search`)의 지식베이스 저장 구조를 설명합니다. 정형 데이터(호환 소프트웨어, 공통컴포넌트)는 SQLite 에, 의미 검색에 쓰는 벡터 데이터(공식 가이드, 개발자 지식)는 LanceDB 에 저장합니다. 이 문서에 적힌 행 수와 값은 저장소에 동봉된 지식베이스를 기준으로 합니다.

## 📁 데이터베이스 위치

```
knowledge-base/
├── egovframe.db                # SQLite 데이터베이스 (호환 소프트웨어, 공통컴포넌트)
├── developer_knowledge.lance/  # LanceDB 테이블 (개발자 지식)
├── egovframe_guide.lance/      # LanceDB 테이블 (공식 가이드)
├── state.json                  # 리소스별 적용 버전
├── manifest.json               # 묻고답하기·FAQ 스냅샷의 버전과 행 수
└── snapshot.jsonl.gz           # 묻고답하기·FAQ 스냅샷
```

- `knowledge-base/` 는 git 이 추적하는 디렉토리입니다. `package.json` 의 `files` 에도 들어 있어 배포 tgz 에 그대로 동봉되므로, 저장소를 클론하거나 tgz 를 설치한 뒤에 인덱스를 따로 구축할 필요가 없습니다. 전체 크기는 약 143MB 입니다.
- 동봉된 지식베이스는 현재 색인 코드로 다시 구축한 것이어서, 이 문서에 적힌 색인 규칙이 동봉 인덱스에 그대로 반영되어 있습니다.
- MCP 서버는 이 디렉토리를 조회만 합니다. DB 파일이나 LanceDB 테이블이 없으면 새로 만들지 않고 `npm run build-index` 를 안내하는 오류로 응답합니다.
- 서버는 `egovframe.db` 를 읽기 전용으로 열고, 동봉된 DB 는 DELETE 저널 모드입니다. 그래서 조회하는 동안 `egovframe.db-wal`, `egovframe.db-shm` 파일이 생기지 않고 DB 파일도 바뀌지 않습니다.
- 두 LanceDB 테이블의 디렉토리에는 `data/`, `_versions/`, `_transactions/` 만 있습니다. 벡터 인덱스를 만들지 않으므로 인덱스 파일을 담는 `_indices/` 디렉토리가 없습니다.

### 버전 기록과 스냅샷

`state.json`, `manifest.json`, `snapshot.jsonl.gz` 는 `npm run build-index` 가 기록하는 파일입니다. 갱신 CLI(`egovframe-mcp-search update`)는 이 가운데 `state.json` 과 `snapshot.jsonl.gz` 를 읽습니다.

`state.json` 에는 리소스마다 어떤 버전의 원본으로 구축했는지가 적혀 있습니다. 갱신 CLI 는 갱신분을 적용한 적이 없는 리소스의 현재 버전을 이 값으로 보고 새 버전이 있는지 판단합니다. 동봉된 파일의 내용은 다음과 같습니다.

| `resources` 의 키 | 기록된 값 | 값의 출처 |
|-------------------|-----------|-----------|
| `developer_knowledge` | `version` 이 `2026-08-11.0`, `row_count` 가 17941 | 스냅샷의 `dataset_version`. Excel 에서 만든 스냅샷은 Excel 파일 가운데 가장 늦은 수정 시각의 날짜(UTC 기준)에 `.0` 을 붙인 값 |
| `guide` | `version` 이 `v5.0.0-ready-2026-contribution`, `chunk_count` 가 4610 | 가이드 원문 서브모듈의 git 태그 (체크아웃이 태그와 일치하지 않으면 `git describe` 의 결과) |
| `common_components` | `source_version` 이 `v5.0.1`, `metadata_version` 이 `5.1.0` | 소스 서브모듈의 git 태그와 `templates/common-components.json` 의 최상위 `version` |
| `compatibility` | `version` 이 `2026-07-20.0`, `row_count` 가 481 | 원본 JSON 파일을 수정한 시각의 날짜(UTC 기준)에 `.0` 을 붙인 값 |

- 최상위에는 `schema_version`(1), `embedding_model.id`(`Xenova/multilingual-e5-small`), `generated_at`(구축 시각)이 있습니다. 리소스 항목에는 `origin`(동봉 파일은 모두 `bundled`)과 `applied_at` 이 함께 있고, 벡터를 가진 두 리소스에는 `embedding_model` 도 있습니다.
- `developer_knowledge` 의 `row_count` 17,941 은 스냅샷(묻고답하기와 FAQ)의 행 수입니다. 테이블의 행 수 18,195 는 여기에 적용가이드 청크 254건을 더한 값입니다.
- 원본 디렉토리가 git 체크아웃이 아니면 git 태그를 알 수 없으므로, `guide` 의 `version` 은 `unknown` 이 되고 `common_components` 의 `source_version` 은 기록되지 않습니다.

`manifest.json` 과 `snapshot.jsonl.gz` 는 `developer_knowledge` 를 구축할 때 쓴 묻고답하기·FAQ 스냅샷입니다. Excel 에서 구축했으면 Excel 을 바꿔 만든 스냅샷이 들어갑니다. 적용가이드 PDF 는 들어 있지 않습니다.

| 파일 | 내용 |
|------|------|
| `manifest.json` | `schema_version`, `dataset_version`, `generated_at`, `embedding_model.id`, `row_count`. 동봉 파일은 `dataset_version` 이 `2026-08-11.0`, `row_count` 가 17941 |
| `snapshot.jsonl.gz` | 한 줄에 게시글 하나를 JSON 으로 적고 gzip 으로 압축한 파일. 필드는 `id`(`qa:` 또는 `faq:` 뒤에 포털 게시글 ID), `kind`(`qa`, `faq`), `title`, `question`, `answer`, `category`, `language` 이고, 값이 없는 `category` 와 `language` 는 생략됨. `id` 순으로 정렬되어 있음. 동봉 파일은 17,941행(묻고답하기 17,845행, FAQ 96행) |

갱신 CLI 는 개발자 지식을 처음 갱신할 때 `snapshot.jsonl.gz` 를 새 스냅샷과 견줘 바뀐 게시글만 다시 임베딩합니다. `manifest.json` 은 스냅샷의 버전과 행 수를 적어 둔 파일이고, 서버와 갱신 CLI 는 이 파일을 읽지 않습니다.

### 갱신분의 저장 위치

갱신 CLI 가 받은 갱신분은 `knowledge-base/` 가 아니라 사용자 데이터 디렉토리에 저장됩니다. 기본 위치는 아래와 같고, 환경 변수 `EGOV_MCP_DATA_DIR` 로 바꿀 수 있습니다.

| 운영체제 | 기본 위치 |
|----------|-----------|
| macOS | `~/Library/Application Support/egovframe-mcp-search` |
| Linux | `$XDG_DATA_HOME/egovframe-mcp-search` (변수가 없으면 `~/.local/share/egovframe-mcp-search`) |
| Windows | `%LOCALAPPDATA%\egovframe-mcp-search` |

```
<사용자 데이터 디렉토리>/
├── state.json                           # 리소스별 적용 버전과 사용 중인 디렉토리
└── resources/
    ├── developer_knowledge/v-<버전>/
    │   ├── developer_knowledge.lance/
    │   └── snapshot.applied.jsonl.gz    # 다음 갱신에서 바뀐 행을 찾는 기준
    └── guide/v-<버전>/
        └── egovframe_guide.lance/
```

서버는 LanceDB 테이블마다 이 디렉토리를 먼저 확인합니다. `state.json` 에 해당 리소스의 항목이 있고, `schema_version` 과 임베딩 모델이 현재 패키지와 같고, 항목이 가리키는 디렉토리에 테이블이 있으면 그 테이블을 읽습니다. 조건에 맞지 않으면 `knowledge-base/` 의 테이블을 읽습니다. 서버는 테이블을 처음 열 때 위치를 정하므로, 실행 중인 서버에는 다시 시작한 뒤에 갱신분이 반영됩니다. 갱신분의 테이블을 읽다가 실패하면 서버는 그 리소스를 `knowledge-base/` 의 테이블에서 다시 읽고, 다시 시작할 때까지 동봉 테이블을 씁니다.

호환 소프트웨어 갱신은 비활성화되어 있어서 갱신 CLI 가 `egovframe.db` 의 사본을 만들지 않으며, 서버는 `knowledge-base/egovframe.db` 를 읽습니다. 다만 서버가 DB 위치를 정하는 코드에는 사본을 읽는 분기가 남아 있습니다. 사용자 데이터 디렉토리에 `sqlite/egovframe.db` 가 있고 `sqlite/base.json` 의 `bundled_generated_at` 이 동봉 `state.json` 의 `generated_at` 과 같으면 서버는 그 사본을 읽습니다. 공통컴포넌트 소스 트리의 갱신분은 `resources/common_components/` 아래에 저장되지만 데이터베이스가 아니므로 이 문서에서 다루지 않습니다.

---

## 🗂️ 테이블 개요

### SQLite (정형 데이터)

| # | 테이블 | 설명 | 데이터 소스 | 행 수 |
|---|--------|------|-------------|-------|
| 1 | `compatibility_software` | 호환 소프트웨어 | `templates/compatibility/compatibility-software.json` | 481 |
| 2 | `component_categories` | 공통컴포넌트 카테고리 | `templates/common-components.json` | 37 |
| 3 | `common_components` | 공통컴포넌트 | `templates/common-components.json` | 155 |
| 4 | `component_dependencies` | 공통컴포넌트 의존성 | `templates/common-components.json` | 1,613 |

이 밖에 FTS5 가상 테이블 `compatibility_fts`, `components_fts` 가 있습니다. 두 테이블은 스키마에 남아 있지만 검색에는 쓰이지 않습니다(아래 "키워드 검색과 FTS5 테이블" 참고). `sqlite_master` 에는 SQLite 가 자동으로 만드는 내부 객체도 함께 보입니다. FTS5 가 쓰는 `*_fts_data`, `*_fts_idx`, `*_fts_docsize`, `*_fts_config` 테이블, `AUTOINCREMENT` 용 `sqlite_sequence` 테이블, UNIQUE 제약용 `sqlite_autoindex_*` 인덱스가 그것입니다. 표준용어사전 관련 테이블은 기능과 함께 제거되어 남아 있지 않습니다.

### LanceDB (벡터 데이터, 384차원 임베딩)

| # | 테이블 | 설명 | 데이터 소스 | 행 수 |
|---|--------|------|-------------|-------|
| 5 | `developer_knowledge` | 개발자 지식 (포털의 묻고답하기·FAQ·적용가이드) | `templates/developer_knowledge/` 의 묻고답하기·FAQ Excel 과 적용가이드 PDF | 18,195 |
| 6 | `egovframe_guide` | 공식 가이드 | git 서브모듈 `templates/egovframe_guide/` ([eGovFramework/egovframe-docs](https://github.com/eGovFramework/egovframe-docs)) | 4,610 |

---

## 📋 테이블 스키마 상세

### 1. compatibility_software (호환 소프트웨어)

표준프레임워크 버전별 호환 소프트웨어 목록입니다. 한 행은 제품 버전 하나와 표준프레임워크 버전 하나의 조합입니다.

```sql
CREATE TABLE compatibility_software (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_name TEXT NOT NULL,           -- 제품명
  product_version TEXT NOT NULL,        -- 제품 버전 표기 (예: 'Tibero v7')
  framework_version TEXT NOT NULL,      -- 표준프레임워크 버전 ('4.3', '3.10' 등)
  category TEXT NOT NULL,               -- 분류 ('CMS Solution', 'DBMS', 'WAS' 등)
  compatibility_level INTEGER CHECK(compatibility_level IN (1, 2)) NOT NULL,  -- 호환성 레벨 (1 또는 2)
  vendor TEXT NOT NULL,                 -- 업체명
  verified_date TEXT NOT NULL,          -- 호환성 확인일자 (YYYY-MM-DD)
  description TEXT,                     -- 설명
  url TEXT,                             -- 포털의 제품 상세 주소
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,  -- 적재 시각 (UTC)
  UNIQUE(product_name, product_version, framework_version)
);
```

**인덱스:**
```sql
CREATE INDEX idx_compat_framework ON compatibility_software(framework_version);
CREATE INDEX idx_compat_category ON compatibility_software(category);
CREATE INDEX idx_compat_level ON compatibility_software(compatibility_level);
CREATE INDEX idx_compat_verified_date ON compatibility_software(verified_date DESC);
```

- `id` 와 `created_at` 은 내부용 컬럼이라 조회 결과에 포함되지 않습니다. `id` 는 다시 적재할 때마다 새 값이 부여됩니다.
- `verified_date` 는 `YYYY-MM-DD` 형식의 문자열입니다. 다만 동봉 데이터에는 이 컬럼에 날짜가 아닌 값(업체명, URL)이 든 행이 3건 있습니다. `query` 없이 조회하면 확인일자가 최근인 순으로 정렬하고 이런 행은 맨 뒤에 둡니다. 확인일자가 `1970-01-01` 인 행도 1건 있는데, 이 값은 변환 스크립트가 원본에 확인일자가 없는 항목에 채우는 값입니다.

**관련 조회:** `egov_search_knowledge` 를 `{"scope": "compatibility"}` 로 호출합니다.

---

### 2. component_categories (공통컴포넌트 카테고리)

공통컴포넌트의 분류입니다.

```sql
CREATE TABLE component_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id TEXT NOT NULL UNIQUE,     -- 카테고리 ID (예: '게시판', '역할-권한관리')
  name TEXT NOT NULL,                   -- 카테고리 이름 (예: '게시판', '역할/권한관리')
  name_en TEXT,                         -- 영문 이름 (예: 'BBS')
  description TEXT,                     -- 설명
  description_en TEXT                   -- 영문 설명
);
```

**관련 조회:** `{"scope": "components"}` 는 카테고리 목록과 카테고리별 컴포넌트 수를 돌려줍니다.

---

### 3. common_components (공통컴포넌트)

공통컴포넌트의 메타데이터입니다.

```sql
CREATE TABLE common_components (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  component_id TEXT NOT NULL UNIQUE,    -- 컴포넌트 ID (예: 'bbs', 'uia', 'blog-management')
  name TEXT NOT NULL,                   -- 컴포넌트 이름 (예: '게시판')
  name_en TEXT,                         -- 영문 이름
  category_id TEXT NOT NULL,            -- 카테고리 ID
  package_name TEXT,                    -- 패키지명 (예: 'egovframework.com.cop.bbs'), 고유하지 않음
  description TEXT,                     -- 설명
  description_en TEXT,                  -- 영문 설명
  use_tables TEXT,                      -- 사용하는 테이블과 뷰 이름의 JSON 배열
  version TEXT DEFAULT '5.1.0',         -- 컴포넌트 메타의 버전
  has_web INTEGER DEFAULT 1,            -- 웹 배포 여부 (0 또는 1, 원본 목록의 webexist)
  added_options TEXT,                   -- 추가 옵션
  FOREIGN KEY (category_id) REFERENCES component_categories(category_id)
);
```

**인덱스:**
```sql
CREATE INDEX idx_comp_category ON common_components(category_id);
CREATE INDEX idx_comp_package ON common_components(package_name);
```

- `component_id` 는 고유하고 `package_name` 은 고유하지 않습니다. 게시판(`bbs`)과 블로그관리(`blog-management`)가 `egovframework.com.cop.bbs` 패키지를 함께 씁니다. 패키지명으로 컴포넌트를 찾을 때는 먼저 적재된 컴포넌트(게시판)를 고릅니다.
- `use_tables` 는 메타의 `useTables` 를 그대로 쓰지 않고, 적재할 때 공통컴포넌트 소스 트리(`templates/common-components-src`)에서 도출합니다(`src/kb/componentTables.ts`). 컴포넌트 패키지의 설치 스크립트가 만드는 테이블과 뷰에, 그 컴포넌트의 매퍼 XML 이 참조하는 테이블을 더한 목록입니다. 설치 스크립트는 소스 트리의 `src/script/ddl/mysql/` 에 있는 `cop.bbs_create_mysql.sql` 같은 파일이고, 자기 패키지의 스크립트가 없으면 가장 가까운 상위 패키지의 스크립트를 씁니다. 스크립트가 없는 컴포넌트는 모든 스크립트에 공통인 기반 테이블에 매퍼가 참조하는 테이블을 더합니다. 스크립트도 매퍼도 없는 컴포넌트는 메타의 목록을 쓰되, 그 목록이 메타에서 바로 앞 항목의 목록과 같으면 기반 테이블만 씁니다. 동봉 데이터에서는 설치 스크립트에서 나온 컴포넌트가 126개, 기반 테이블과 매퍼에서 나온 컴포넌트가 19개, 기반 테이블만 쓰는 컴포넌트가 7개, 메타의 목록을 쓰는 컴포넌트가 3개입니다. 소스 트리가 없는 상태에서 적재하면 155개 모두 메타의 값이 그대로 들어갑니다.
- 동봉 데이터는 155행 모두 `version` 이 `5.1.0` 이고 `added_options` 는 NULL 입니다. `version` 은 메타에 컴포넌트마다 적힌 값이고, `state.json` 의 `metadata_version`(`5.1.0`)은 메타 파일의 최상위 `version` 입니다.
- `has_web` 은 메타의 `hasWeb` 이고, 메타를 만든 원본 엑셀(`components.xls`)의 `webexist`(web 배포여부) 열에서 옵니다. 컴포넌트가 프로젝트에 `web.xml` 을 가져오는지를 나타내며, 공통컴포넌트를 프로젝트에 넣을 때 JSP 와 XML 설정 파일을 처리하는 데만 쓰이는 값입니다. 동봉 데이터에서는 5행(`cmm`, `uap`, `ram`, `ipm`, `fiter`)만 1 입니다. JSP 화면이 있는지와는 다른 값이어서, JSP 가 있는 컴포넌트도 대부분 0 입니다.

#### 컴포넌트 ID 부여 규칙

공통컴포넌트 메타(`templates/common-components.json`)의 `id` 는 패키지명의 마지막 마디라서 서로 다른 컴포넌트가 같은 값을 가질 수 있습니다. 155개 항목에 고유한 `id` 는 149개입니다. 적재할 때 `src/kb/componentIds.ts` 가 메타에 적힌 순서대로 아래 규칙을 적용해 고유한 ID 를 정합니다. 고유한지는 대소문자를 구분하지 않고 판정합니다.

1. 처음 나온 항목은 메타의 `id` 를 그대로 씁니다.
2. 같은 `id` 가 이미 쓰였으면 패키지명의 상위 마디를 고유해질 때까지 앞에 붙입니다. 예를 들어 `egovframework.com.uss.cmt` 는 `uss-cmt` 가 됩니다.
3. 같은 `id` 를 먼저 쓴 항목과 패키지명까지 같으면 영문 이름을 소문자와 하이픈으로 바꿔 씁니다. 예를 들어 `Blog Management` 는 `blog-management` 가 됩니다.
4. 그래도 고유해지지 않으면 `bbs-2`, `bbs-3` 처럼 번호를 붙입니다.

동봉 데이터에서 새 ID 를 받은 컴포넌트는 6개입니다.

| 메타의 `id` | `id` 를 그대로 쓰는 컴포넌트 | 새 ID 를 받은 컴포넌트 |
|-------------|------------------------------|------------------------|
| `bbs` | 게시판 | 블로그관리 `blog-management` |
| `cmt` | 댓글관리 | 출퇴근관리 `uss-cmt` |
| `com` | 협업공통 | 통계공통 `sts-com` |
| `prm` | 프로그램관리 | 프로세스 모니터링 `sys-prm` |
| `sim` | 일정관리 | 시스템연계관리 `syi-sim`, 시스템정보확인 `utl-sim` |

**관련 조회:** `{"scope": "components", "filters": {"componentId": "bbs"}}` 는 컴포넌트 한 건의 상세 정보를 돌려줍니다.

---

### 4. component_dependencies (공통컴포넌트 의존성)

컴포넌트가 의존하는 패키지의 목록입니다.

```sql
CREATE TABLE component_dependencies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  component_id TEXT NOT NULL,           -- 의존하는 컴포넌트의 ID
  depends_on_package TEXT NOT NULL,     -- 의존 대상의 패키지명
  UNIQUE(component_id, depends_on_package),
  FOREIGN KEY (component_id) REFERENCES common_components(component_id)
);
```

**인덱스:**
```sql
CREATE INDEX idx_comp_dep_component ON component_dependencies(component_id);
CREATE INDEX idx_comp_dep_package ON component_dependencies(depends_on_package);
```

`depends_on_package` 에는 외래키 제약이 없습니다. 의존성을 해석할 때 이 값을 `common_components.package_name` 과 대조해 대상 컴포넌트를 찾습니다. 일치하는 컴포넌트가 없는 패키지는 의존성 해석 결과에 "컴포넌트 정보가 없는 의존 패키지" 로 따로 나오고, 컴포넌트 상세 정보의 의존성 표에는 컴포넌트명이 `-` 로 나옵니다. 동봉 데이터에는 여기에 해당하는 행이 없습니다.

**관련 조회:** `{"scope": "components", "action": "dependencies", "filters": {"componentIds": ["bbs"]}}` 는 간접 의존성까지 모두 해석해 필요한 컴포넌트와 패키지를 돌려줍니다.

---

## 🔍 키워드 검색과 FTS5 테이블

`components` 와 `compatibility` 조회에 `query` 를 주면 실행되는 키워드 검색은 FTS5 를 쓰지 않습니다. 검색어를 원본 테이블의 컬럼에 `LIKE` 로 견주는 부분 문자열 비교입니다. FTS5 의 낱말 단위 일치로는 한국어 복합어의 가운데나 뒤쪽에 든 낱말(`공통코드` 의 `코드`)을 찾지 못하고, 두 테이블 모두 수백 행이라 전체를 훑어도 느리지 않기 때문입니다. FTS5 가상 테이블과 동기화 트리거는 스키마에 남아 있고 `build-index` 가 계속 채우지만, 서버의 어떤 조회도 이 테이블을 읽지 않습니다.

두 FTS5 테이블 모두 본문을 따로 저장하지 않고 원본 테이블의 행을 `rowid` 로 참조하는 외부 콘텐츠(external content) 테이블입니다. `tokenize` 옵션을 지정하지 않았으므로 기본 토크나이저(`unicode61`)를 씁니다.

### 키워드 검색이 견주는 컬럼

| 테이블 | 부분 문자열로 견주는 컬럼 | 이름 컬럼 | 다른 규칙으로 견주는 컬럼 |
|--------|---------------------------|-----------|---------------------------|
| `compatibility_software` | `product_name`, `product_version`, `vendor`, `category`, `description` | `product_name`, `product_version` | `framework_version` 은 검색어가 값과 같을 때, `verified_date` 는 값이 `YYYY`, `YYYY-MM`, `YYYY-MM-DD` 꼴의 검색어로 시작할 때 일치 |
| `common_components` | `component_id`, `name`, `name_en`, `description`, `description_en`, `package_name` | `component_id`, `name`, `name_en` | 없음 |

- ASCII 영문자의 대소문자는 가리지 않습니다. 이름 컬럼은 결과를 정렬하는 기준에 쓰입니다.
- FTS5 테이블에는 `product_version` 과 `component_id` 컬럼이 없습니다. 이 두 컬럼은 키워드 검색이 원본 테이블에서 직접 견줍니다.
- 검색어를 고르는 규칙, 정렬 기준, 응답에 실리는 정보는 [EGOV_SEARCH_KNOWLEDGE_TOOL.md](./EGOV_SEARCH_KNOWLEDGE_TOOL.md) 에 있습니다.

### compatibility_fts

```sql
CREATE VIRTUAL TABLE compatibility_fts USING fts5(
  product_name, vendor, category, description,
  content=compatibility_software,
  content_rowid=id
);
```

### components_fts

```sql
CREATE VIRTUAL TABLE components_fts USING fts5(
  name, name_en, description, description_en, package_name,
  content=common_components,
  content_rowid=id
);
```

### 동기화 트리거

원본 테이블의 변경을 FTS 인덱스에 반영하는 트리거가 테이블마다 세 개씩, 모두 여섯 개 있습니다. 아래는 `compatibility_software` 의 트리거입니다.

```sql
CREATE TRIGGER compatibility_ai AFTER INSERT ON compatibility_software BEGIN
  INSERT INTO compatibility_fts(rowid, product_name, vendor, category, description)
  VALUES (new.id, new.product_name, new.vendor, new.category, new.description);
END;

CREATE TRIGGER compatibility_ad AFTER DELETE ON compatibility_software BEGIN
  INSERT INTO compatibility_fts(compatibility_fts, rowid, product_name, vendor, category, description)
  VALUES ('delete', old.id, old.product_name, old.vendor, old.category, old.description);
END;

CREATE TRIGGER compatibility_au AFTER UPDATE ON compatibility_software BEGIN
  INSERT INTO compatibility_fts(compatibility_fts, rowid, product_name, vendor, category, description)
  VALUES ('delete', old.id, old.product_name, old.vendor, old.category, old.description);
  INSERT INTO compatibility_fts(rowid, product_name, vendor, category, description)
  VALUES (new.id, new.product_name, new.vendor, new.category, new.description);
END;
```

- `common_components` 의 트리거 `components_ai`, `components_ad`, `components_au` 는 같은 형태이며 `components_fts` 의 컬럼(`name`, `name_en`, `description`, `description_en`, `package_name`)을 다룹니다.
- 외부 콘텐츠 테이블에서는 원본 행이 지워진 뒤에 인덱스 항목을 일반 `DELETE` 문으로 지울 수 없습니다. 그래서 삭제와 수정 트리거는 이전 값을 함께 넘기는 `'delete'` 명령을 씁니다.
- `build-index` 는 DB 를 쓰기 모드로 열 때 트리거 여섯 개를 지우고 다시 만들며, `INSERT OR REPLACE` 가 내부에서 수행하는 삭제에도 트리거가 실행되도록 `PRAGMA recursive_triggers = ON` 을 설정합니다. 적재를 마치면 `'rebuild'` 명령으로 두 FTS 인덱스를 원본 테이블 기준으로 다시 만듭니다.
- 동봉 DB 에서 두 FTS 인덱스의 문서 수는 원본 테이블의 행 수와 같습니다 (`compatibility_fts` 481, `components_fts` 155).

---

## 📊 ER 다이어그램

SQLite 의 테이블 네 개와 그 관계입니다. PK 는 기본 키, UK 는 UNIQUE 제약, FK 는 외래키입니다.

```
┌────────────────────────┐
│ compatibility_software │
├────────────────────────┤
│ id (PK)                │
│ product_name           │
│ product_version        │
│ framework_version      │
│ category               │
│ compatibility_level    │
│ vendor                 │
│ verified_date          │
│ description            │
│ url                    │
│ created_at             │
└────────────────────────┘

                                    ┌────────────────────────┐
                                    │ common_components      │
                                    ├────────────────────────┤
┌────────────────────────┐          │ id (PK)                │
│ component_categories   │          │ component_id (UK)      │
├────────────────────────┤          │ name                   │
│ id (PK)                │          │ name_en                │
│ category_id (UK)       │◄── N:1 ──│ category_id (FK)       │
│ name                   │          │ package_name           │
│ name_en                │          │ description            │
│ description            │          │ description_en         │
│ description_en         │          │ use_tables (JSON)      │
└────────────────────────┘          │ version                │
                                    │ has_web                │
                                    │ added_options          │
                                    └───────────▲────────────┘
                                                │ N:1
                                    ┌───────────┴────────────┐
                                    │ component_dependencies │
                                    ├────────────────────────┤
                                    │ id (PK)                │
                                    │ component_id (FK)      │
                                    │ depends_on_package     │
                                    └────────────────────────┘
```

- `compatibility_software` 는 다른 테이블과 관계가 없고, `(product_name, product_version, framework_version)` 조합이 고유합니다.
- `component_dependencies` 는 `(component_id, depends_on_package)` 조합이 고유합니다. `depends_on_package` 는 외래키가 아니며 조회할 때 `common_components.package_name` 과 대조합니다.
- `compatibility_fts` 와 `components_fts` 는 각각 `compatibility_software.id`, `common_components.id` 를 `rowid` 로 참조합니다.
- 외래키와 CHECK 제약은 적재할 때 검사됩니다. 이 프로젝트가 쓰는 better-sqlite3 는 연결마다 `foreign_keys` 를 켜 둡니다.

---

## 🧠 LanceDB 벡터 테이블

두 테이블에 공통인 사항은 다음과 같습니다. 컬럼 타입은 Apache Arrow 타입 이름으로 적었습니다.

- 임베딩 모델은 `Xenova/multilingual-e5-small`(384차원)이고 `models/` 의 로컬 파일만 사용합니다. 색인할 때는 `passage: `, 검색할 때는 `query: ` 접두어를 붙여 임베딩합니다.
- 벡터 인덱스는 만들지 않습니다. `build-index` 와 갱신 CLI 는 행을 넣은 뒤 테이블을 최적화할 뿐이고, 검색은 조건에 맞는 모든 행과의 코사인 거리를 계산하는 전수 검색입니다. 스칼라 컬럼에도 인덱스가 없습니다. 이전 버전으로 구축해 IVF_PQ 인덱스가 남아 있는 테이블을 읽을 때에도 검색은 인덱스를 건너뜁니다.
- 임베딩 모델은 입력의 앞 512 토큰만 읽습니다. 공식 가이드와 적용가이드 PDF 는 임베딩 입력이 이 한도 안에 들도록 나누어 저장하므로, 동봉 인덱스에는 한도를 넘는 청크가 없습니다(가장 긴 입력이 공식 가이드 492 토큰, 적용가이드 419 토큰). 묻고답하기와 FAQ 는 게시글 하나가 한 행이라 나누지 않습니다. 동봉 인덱스에서는 묻고답하기 17,845행 가운데 2,545행과 FAQ 96행 가운데 9행의 임베딩 입력이 512 토큰을 넘고, 넘는 뒷부분은 벡터에 반영되지 않습니다.
- MCP 서버는 두 테이블을 조회만 합니다. 내용은 `build-index` 와 갱신 CLI 로만 바뀝니다.

### 5. developer_knowledge (개발자 지식)

전자정부 표준프레임워크 포털의 묻고답하기 게시글, FAQ, 적용가이드 PDF 를 저장합니다. 한 행은 게시글 하나 또는 PDF 청크 하나입니다.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | `Utf8` | 행 ID (UUID). 색인할 때 새로 만드는 값이며, 포털 게시글 ID 는 `metadata.originalId` 에 있음 |
| `type` | `Utf8` | 유형. 묻고답하기·FAQ 는 `solution`, 적용가이드는 `best-practice` |
| `title` | `Utf8` | 제목. 적용가이드 청크는 확장자를 뺀 파일 이름에 `(순번/전체 청크 수)` 를 붙인 값 (예: `[가이드]표준프레임워크_적용가이드_v5.0 (1/254)`) |
| `content` | `Utf8` | 본문. 묻고답하기·FAQ 는 `질문:` 단락과 `답변:` 단락, 적용가이드는 청크 본문 |
| `context` | `Utf8` | 출처 구분 (`표준프레임워크 묻고답하기`, `표준프레임워크 FAQ`, `표준프레임워크 적용가이드 PDF`) |
| `tags` | `List<Utf8>` | 태그. `egovframe`, `developer_knowledge` 와 출처 태그(`qa`, `faq`, 적용가이드는 `guide` 와 `pdf`) |
| `relatedTo` | `List<Utf8>` | 관련 주제 키워드. 동봉 데이터에서는 출처마다 고정된 값이며, 묻고답하기·FAQ 행은 `faq`, `qa`, `egovframe`, 적용가이드 청크는 `egovframe`, `application-guide` 임 |
| `importance` | `Float64` | 중요도. 묻고답하기 3, FAQ 4, 적용가이드 5 |
| `verified` | `Bool` | 검증 여부. 모든 행이 `true` |
| `createdAt` | `Utf8` | 색인 시각 (ISO 8601). 게시글 작성일이 아님 |
| `updatedAt` | `Utf8` | 수정 시각 (ISO 8601). 적재 직후에는 `createdAt` 과 같음 |
| `metadata` | `Struct` | 부가 정보 (아래 표) |
| `vector` | `FixedSizeList[384]<Float32>` | 임베딩 벡터 |

`type` 의 타입 정의(`KnowledgeType`)에는 `solution`, `tip`, `pattern`, `error-fix`, `best-practice`, `gotcha` 여섯 값이 있지만, 동봉 데이터에는 `solution` 과 `best-practice` 만 있습니다.

`metadata` 의 필드는 다음과 같습니다.

| 필드 | 타입 | 설명 |
|------|------|------|
| `sourceType` | `Utf8` | 출처. `qa`(묻고답하기), `faq`, `pdf`(적용가이드) |
| `originalId` | `Utf8` | 포털 게시글 ID (예: `FAQ_0000000000000149`). 적용가이드 청크는 빈 문자열 |
| `category` | `Utf8` | 포털의 분류 코드 (예: `S02`). 값이 없으면 빈 문자열 |
| `language` | `Utf8` | 게시글 언어 (`KOR`, `ENG`). 적용가이드 청크는 빈 문자열 |
| `source`, `sourceFile` | `Utf8` | 적재 원본의 위치. `source` 는 모든 행이 `templates/developer_knowledge` 임. `sourceFile` 은 묻고답하기 행이 `snapshot:qa`, FAQ 행이 `snapshot:faq`, 적용가이드 청크가 저장소 기준 PDF 경로(`templates/developer_knowledge/[가이드]표준프레임워크_적용가이드_v5.0.pdf`)임 |
| `chunkIndex`, `chunkCount` | `Float64` | 적용가이드 청크의 순번(1 부터)과 전체 청크 수. 그 밖의 행은 0 |
| `author`, `version`, `environment`, `file`, `section` | `Utf8` | 동봉 데이터에서는 모두 빈 문자열 |
| `extra` | `Utf8` | 위 필드에 속하지 않는 값을 담는 JSON 문자열. 동봉 데이터에서는 모두 `{}` |

**데이터 소스:**
- 묻고답하기·FAQ: `templates/developer_knowledge/` 에 스냅샷(`manifest.json`, `snapshot.jsonl.gz`)이 있으면 그것을 읽고, 없으면 같은 디렉토리의 Excel(`*.xlsx`)을 같은 형식의 스냅샷으로 바꿔서 적재합니다. 저장소는 FAQ Excel 만 추적합니다. 묻고답하기 원본 Excel(`묻고답하기-LET_TN_QA_INFO.xlsx`)은 색인에 쓰지 않는 개인정보 컬럼이 들어 있어 git 이 추적하지 않으므로(`.gitignore`), 다시 구축하려면 같은 자리에 따로 두어야 합니다. 이 파일 없이 bundled 모드로 구축하면 개발자 지식이 FAQ 와 적용가이드 PDF 만으로 만들어집니다([KNOWN_ISSUES.md](KNOWN_ISSUES.md) 의 BI-13). `build-index` 를 `online` 방식으로 실행하면 릴리스 스냅샷을 먼저 내려받고, 받지 못했을 때 이 디렉토리를 씁니다.
- Excel 을 스냅샷으로 바꿀 때 답변이 없는 글은 넣지 않습니다. 동봉 원본에서는 묻고답하기 17,863건 가운데 18건이 여기에 해당합니다. 묻고답하기·FAQ 를 색인할 때 제목과 본문에 든 주민등록번호 형식의 값은 `******-*******` 로 가리며, 동봉 데이터에는 해당하는 값이 없습니다.
- 적용가이드: `templates/developer_knowledge/` 의 PDF 를 600자 이하의 청크로 나눠 적재합니다(`src/scripts/buildIndex.ts` 의 `chunkPdfText`). 문단, 줄, 문장, 낱말의 순서로 경계를 찾아 나누고, 둘째 청크부터는 앞 청크의 끝부분을 100자까지 앞에 다시 싣습니다. 겹친 부분도 600자에 포함됩니다. 동봉 PDF 는 청크 254건이 되었고, 청크의 길이는 485자에서 599자, 이웃한 청크가 겹치는 길이는 36자에서 99자입니다.
- `build-index` 는 테이블을 지우고 새로 만들어 모든 행을 다시 임베딩합니다. 묻고답하기·FAQ 원본을 찾지 못하면 이 테이블을 건너뛰고 기존 내용을 유지합니다.
- 갱신 CLI 는 직전에 적용한 스냅샷과 새 스냅샷을 게시글 ID 로 대조해 바뀐 행만 다시 임베딩합니다. 처음 갱신할 때의 기준은 `knowledge-base/snapshot.jsonl.gz` 이고, 그 뒤에는 갱신분과 함께 저장한 `snapshot.applied.jsonl.gz` 입니다. `metadata.sourceType` 이 `qa`, `faq` 인 행만 바꾸고 적용가이드 청크는 그대로 둡니다. 기준 스냅샷을 읽을 수 없으면 묻고답하기·FAQ 행 전체를 다시 임베딩합니다.

**관련 조회:** `{"scope": "knowledge", "query": "MyBatis 트랜잭션 오류"}` 로 의미 검색을 합니다. `filters.type`, `filters.tags`, `filters.minImportance`, `filters.verifiedOnly` 가 각각 `type`, `tags`, `importance`, `verified` 컬럼에 대응합니다. `filters.tags` 의 값은 소문자로 바꿔 견줍니다.

---

### 6. egovframe_guide (공식 가이드)

공식 가이드(egovframe-docs 저장소의 마크다운 문서)를 임베딩 모델의 입력 한도에 맞춘 청크로 나눠 저장합니다.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | `Utf8` | 청크 ID (UUID). 색인할 때 새로 만드는 값이라 지식베이스를 다시 구축하거나 갱신하면 바뀜 |
| `title` | `Utf8` | 청크 제목. `문서 제목: 제목 경로` 형식이며, 첫 `##` 제목 앞의 도입부 청크는 문서 제목만 씀 (도입부를 더 깊은 제목에서 나눈 청크는 `개요` 를 넣지 않은 `문서 제목: 소절`). 여러 조각으로 나뉜 절은 끝에 조각 번호 ` (k/n)` 이 붙음 (예: `MyBatis Configuration XML File: Configuration XML > Sample Configuration (2/8)`) |
| `content` | `Utf8` | 청크 본문 (마크다운) |
| `source` | `Utf8` | 원본 파일 경로. 가이드 원문 디렉토리 기준 상대 경로이고 구분자는 `/` (예: `egovframe-runtime/persistence-layer/dataaccess-configuration_xml.md`) |
| `layer` | `Utf8` | 경로의 첫째 마디 (예: `egovframe-runtime`). 최상위 문서는 파일 이름이 그대로 들어감 (`gettingstarted.md`) |
| `category` | `Utf8` | 경로가 세 마디 이상일 때의 둘째 마디 (예: `persistence-layer`). 그 밖에는 빈 문자열 |
| `section` | `Utf8` | 제목 경로. `##` 절은 절 제목, 더 깊은 제목에서 나눈 청크는 `절 > 소절`, 도입부 청크는 `개요`(도입부를 더 깊은 제목에서 나눈 청크는 `개요 > 소절`). 여러 조각으로 나뉜 절은 `title` 과 같은 조각 번호가 붙음 |
| `docTitle` | `Utf8` | 문서 제목. 프론트매터의 `title`, 없으면 `linkTitle`, 그것도 없으면 확장자 `.md` 를 뺀 파일 이름 |
| `url` | `Utf8` | 프론트매터의 `url` (예: `/egovframe-runtime/persistence-layer/dataaccess-mybatis/dataaccess-configuration_xml/`). 없으면 빈 문자열 |
| `vector` | `FixedSizeList[384]<Float32>` | 임베딩 벡터 |

**데이터 소스와 색인 규칙** (`src/kb/guideIndexer.ts`, `src/rag/guideChunking.ts`):
- `templates/egovframe_guide/` 아래의 `.md` 파일을 모읍니다. `.git`, `.github`, `images` 디렉토리와 `README.md`, `how-to-write-Frontmatter.md` 는 제외합니다. 가이드 저장소의 기여자용 문서인 최상위 `_index.md`(컨트리뷰션 안내 페이지)와 `docs/` 아래의 문서는 모으더라도 색인하지 않습니다 (하위 디렉토리의 `_index.md` 는 색인합니다).
- 프론트매터에 `draft: true` 가 있는 문서와 본문이 50자 미만인 문서는 색인하지 않습니다. 동봉 인덱스를 만든 원문에서는 663개 가운데 기여자용 문서 2개, 초안 4개, 본문이 짧은 문서 255개가 빠져 402개가 색인되었습니다.
- 문서를 `##` 제목에서 절로 나눕니다. 첫 `##` 제목 앞의 내용은 도입부이고, 맨 앞의 `#` 제목 줄은 뺍니다. 본문이 50자 미만인 절과 도입부는 색인하지 않습니다.
- 청크 하나의 임베딩 입력(`제목`, `내용`, `분류`, `카테고리` 줄을 이은 문자열)이 추정 토큰 400 이하가 되게 합니다. 토큰 수는 토크나이저 없이 글자 종류별 가중치로 어림합니다. 한도 안에 드는 절은 청크 하나이고, 절 안의 더 깊은 제목은 본문에 그대로 둡니다.
- 한도를 넘는 절은 그 안에 있는 가장 얕은 제목(`###` 이 있으면 `###`, 없으면 더 깊은 제목)에서 도입부와 소절로 나누고, 소절의 제목을 제목 경로에 올립니다(`절 > 소절`). 나눈 결과가 100자 미만이면 이웃과 한 청크에 합칠 수 있을 때 합칩니다. 합친 청크의 제목 경로에는 합쳐진 소절의 이름을 셋까지 이어 적고, 넘는 수는 ` 외 N개` 로 적습니다. 더 깊은 제목으로 내려가면 ` > ` 로, 그렇지 않으면 ` / ` 로 잇습니다(`설명 > Input / Output`).
- 더 깊은 제목이 없는데 한도를 넘는 글은 문단, 줄, 줄 안의 순서로 경계를 찾아 조각으로 나누고, `title` 과 `section` 끝에 조각 번호 ` (k/n)` 을 붙입니다. 코드 블록 중간에서 나뉜 조각은 펜스를 닫고 다음 조각에서 같은 펜스 줄로 다시 열며, 표 중간에서 나뉜 조각은 머리 행과 구분 행을 다시 넣습니다. 조각끼리 내용이 겹치지 않습니다.
- 한 문서에서 제목 경로가 같은 절이 둘 이상 조각으로 나뉘면 둘째부터 조각 번호 앞에 ` [2]`, ` [3]` 을 붙입니다(`iterate 연산 > Sample TestCase [2] (1/2)`).
- `build-index` 와 갱신 CLI 모두 테이블을 새로 만들어 모든 청크를 다시 임베딩합니다.

동봉 인덱스의 4,610행 가운데 조각 번호가 붙은 행은 1,932건(664개 절)이고, 본문이 50자 미만인 행은 없습니다. `url` 이 빈 행은 `egovframe-runtime/intro.md` 의 20건입니다. 이 문서는 프론트매터가 없어서 `docTitle` 이 확장자를 뺀 파일 이름(`intro`)입니다. 원문에 `## 개요` 절이 있는 문서도 그 절의 `section` 이 `개요` 이고, 이때 `title` 은 `문서 제목: 개요` 입니다. `section` 이 `개요` 인 349행 가운데 도입부 청크는 55건이고 나머지 294건이 `## 개요` 절의 청크입니다.

서버는 `source` 와 `section` 의 조각 번호로 같은 절의 이웃 조각을 찾아, 검색 결과와 청크 읽기 응답에 이전 조각과 다음 조각의 `id` 를 함께 싣습니다.

**관련 조회:** `{"scope": "guide", "query": "MyBatis 설정", "filters": {"layer": "egovframe-runtime", "category": "persistence-layer"}}` 로 의미 검색을 합니다. `filters.layer` 와 `filters.category` 는 대소문자와 앞뒤 공백을 무시하고 저장된 값에 대응시키며, 대응되는 값이 없으면 사용할 수 있는 값을 나열한 오류로 응답합니다. `{"scope": "guide", "filters": {"chunkId": "<id>"}}` 는 `id` 가 같은 청크 하나를 읽습니다.

---

## 📈 데이터 통계

### 현재 데이터 현황

| 저장소 | 테이블 | 행 수 | 구성 |
|--------|--------|-------|------|
| SQLite | `compatibility_software` | 481 | 표준프레임워크 버전 13종(2.7 부터 4.3 까지), 분류 17종, 호환성 레벨 1 이 34건, 레벨 2 가 447건 |
| SQLite | `component_categories` | 37 | 카테고리마다 컴포넌트 1개부터 32개 |
| SQLite | `common_components` | 155 | 적재할 때 새 ID 를 받은 컴포넌트 6개 포함 |
| SQLite | `component_dependencies` | 1,613 | 컴포넌트마다 6행부터 16행 |
| LanceDB | `developer_knowledge` | 18,195 | 묻고답하기 17,845건, FAQ 96건, 적용가이드 PDF 청크 254건 |
| LanceDB | `egovframe_guide` | 4,610 | 문서 402개. `egovframe-runtime` 2,840건, `egovframe-development` 1,236건, `common-component` 516건, `gettingstarted.md` 18건 |

`npm run build-index` 는 실행할 때마다 `compatibility_software` 를 비우고, 공통컴포넌트 테이블 세 개와 `components_fts` 를 지운 뒤 현재 정의로 다시 만듭니다. 그다음 원본 JSON 전체를 다시 적재하고 두 FTS 인덱스를 다시 만듭니다. 그래서 원본에서 지운 행이 남지 않고, 공통컴포넌트 테이블의 `id` 는 1 부터 다시 매겨집니다. LanceDB 테이블은 원본이 있을 때만 새로 만들고, 원본을 찾지 못한 테이블은 건너뛰어 기존 내용을 유지합니다.

### 데이터 초기화

지식베이스는 저장소와 배포 tgz 에 동봉되어 있으므로, 아래 명령은 원본 데이터나 색인 코드를 바꾼 뒤 다시 구축할 때만 실행합니다. 저장소를 클론한 작업 디렉토리에서 실행하며 Node.js 22, 서브모듈(`git submodule update --init`), 임베딩 모델(`npm run fetch-model`)이 필요합니다. 서브모듈은 가이드 원문(`templates/egovframe_guide`)과 공통컴포넌트 소스(`templates/common-components-src`) 두 개입니다.

```bash
# 1. 프로젝트 빌드
npm run build

# 2. 전체 재구축 (SQLite: 호환 소프트웨어, 공통컴포넌트 / LanceDB: developer_knowledge, egovframe_guide)
npm run build-index -- --yes
```

- `--yes` 를 주면 질문 없이 현재 체크아웃의 원본만 사용하고 네트워크에 접근하지 않습니다. `--yes` 없이 터미널에서 실행하면 원본을 받을 방식(`online`, `local`, `bundled`)을 묻고, 구축 계획을 보여 준 뒤 `yes` 입력을 받습니다.
- 모든 행을 다시 임베딩하므로 시간이 걸립니다. `build-index` 가 안내하는 예상 소요 시간은 수십 분입니다.
- `--yes` 로 실행할 때 가이드 원문 서브모듈이 없으면 `egovframe_guide` 를 건너뜁니다. 공통컴포넌트 소스 서브모듈이 없으면 `use_tables` 에 메타의 값을 그대로 적재하고 경고를 출력합니다. 임베딩 모델이 없으면 구축이 실패하고 기존 지식베이스는 그대로 남습니다.
- 배포 tgz 로 설치한 환경에는 TypeScript 소스와 원본 데이터가 없으므로 이 명령을 실행하지 않습니다. 설치 환경의 갱신은 갱신 CLI 로 합니다.

호환 소프트웨어 원본은 저장소에 들어 있지 않습니다. 포털 DB 의 `LET_TN_COMPATSW` 테이블을 JSON 으로 내보낸 파일을 `references/호환성확인SW-LET_TN_COMPATSW.json` 으로 저장하고 `node scripts/convert-compatibility-to-json.mjs` 를 실행하면 `templates/compatibility/compatibility-software.json` 이 다시 만들어집니다. 원본 JSON 은 최상위 객체의 `LET_TN_COMPATSW` 배열에 행마다 원본 열 15개를 담습니다. 적재는 `npm run build-index` 로 합니다. 변환 규칙은 예전의 `notebooks/convert-compatibility-xlsx-to-json.py --json` 과 같습니다. 그 스크립트가 읽던 엑셀은 CSV 를 거치면서 `PROD_DESC` 의 쉼표에서 칸이 나뉘어 설명이 첫 쉼표에서 잘렸지만, JSON 원본에는 그런 문제가 없습니다. 파이썬 스크립트에는 `pandas` 와 `openpyxl` 이 필요하고, `--json` 을 빼면 `knowledge-base/egovframe.db` 에 직접 씁니다.

공통컴포넌트 메타(`templates/common-components.json`)는 공통컴포넌트 목록 엑셀(`components.xls`)에서 만듭니다. 엑셀도 저장소에 들어 있지 않으므로, 받은 파일을 `references/components.xls` 로 저장하고(`references/` 는 git 이 추적하지 않습니다) `node scripts/convert-components-xls-to-json.mjs --version=5.1.0` 을 실행합니다. 엑셀에는 컴포넌트별 버전 열이 없어서 `--version` 의 값이 파일 머리와 모든 컴포넌트의 `version` 에 들어갑니다. 변환 규칙은 스크립트 머리의 주석에 있고, 적재는 `npm run build-index` 로 합니다.

묻고답하기 원본(`templates/developer_knowledge/묻고답하기-LET_TN_QA_INFO.xlsx`)은 포털에서 내려받은 전체 목록을 그대로 쓰지 않습니다. 내려받은 파일을 `references/묻고답하기-LET_TN_QA_INFO.xlsx` 로 저장하고 `node scripts/filter-qa-xlsx.mjs` 를 실행하면, 삭제글(`DELETE_YN` 이 `Y`)과 작성일(`WRITNG_DE`)이 2016-01-01 이전인 글을 뺀 파일이 `templates/developer_knowledge/` 에 만들어집니다. 이 조건은 스냅샷을 발행하는 쪽의 조회 조건과 같고, 기준일은 `--since=YYYYMMDD` 로 바꿀 수 있습니다. 두 파일 모두 개인정보 컬럼이 들어 있어 git 이 추적하지 않습니다.

---

## 🔧 데이터베이스 관리

### 스키마 초기화

`SQLiteManager`(`src/database/sqliteManager.ts`)는 DB 를 두 가지 방식으로 엽니다.

| 방식 | 쓰는 곳 | 동작 |
|------|---------|------|
| 읽기 전용 (`{ readonly: true }`) | MCP 서버 | 파일이 없으면 만들지 않고 오류를 던집니다. 테이블과 트리거를 만들지 않고 저널 모드도 바꾸지 않습니다. |
| 쓰기 (기본값) | `build-index` | 디렉토리와 파일이 없으면 만듭니다. `journal_mode = WAL` 과 `recursive_triggers = ON` 을 설정한 뒤, `initializeTables()` 가 테이블, 인덱스, FTS 테이블을 `IF NOT EXISTS` 로 만들고 트리거 여섯 개를 다시 만듭니다. |

서버는 SQLite 가 필요한 조회를 처음 받을 때 DB 를 엽니다.

### 저널 모드

동봉된 DB 는 DELETE 저널 모드입니다. `build-index` 는 DB 를 WAL 모드로 열어 적재한 뒤, 닫기 직전에 `finalizeForDistribution()` 으로 WAL 을 체크포인트하고(`PRAGMA wal_checkpoint(TRUNCATE)`) 저널 모드를 DELETE 로 되돌립니다(`PRAGMA journal_mode = DELETE`). WAL 모드로 남은 DB 는 읽기 전용 연결도 `-wal`, `-shm` 파일을 만들어야 하므로, 쓰기 권한이 없는 설치 위치에서는 연결은 열려도 조회가 SQLite 의 `attempt to write a readonly database` 오류로 실패합니다. DELETE 모드의 DB 는 그런 위치에서도 읽기 전용으로 조회됩니다.

스키마와 저널 모드는 아래 명령으로 확인합니다. 두 번째 명령은 `delete` 를 출력합니다.

```bash
sqlite3 -readonly knowledge-base/egovframe.db .schema
sqlite3 -readonly knowledge-base/egovframe.db "PRAGMA journal_mode;"
```

### DB 재구축 (초기화)

`npm run build-index` 는 기존 지식베이스를 `knowledge-base.staging/` 에 복사해 그 안에서 다시 구축하고, 구축이 끝나면 `knowledge-base/` 와 바꿉니다. 바꾸기 전의 지식베이스는 `knowledge-base.prev/` 에 한 벌 남고, 도중에 실패하면 `knowledge-base/` 는 바뀌지 않습니다. 두 작업 디렉토리는 `.gitignore` 대상입니다.

따라서 다시 구축하기 전에 `egovframe.db` 를 지울 필요가 없습니다. DB 파일이 없으면 서버는 `components` 와 `compatibility` 조회에 오류로 응답합니다. `guide` 와 `knowledge` 검색은 SQLite 를 쓰지 않으므로 그대로 동작하고, 호환 소프트웨어를 함께 조회하는 `knowledge` 검색(`filters.knowledgeScope` 가 `all`)만 오류가 됩니다. 파일을 지웠다면 `npm run build-index` 를 끝까지 실행하거나 `git restore knowledge-base/egovframe.db` 로 되돌립니다.

---

## 📝 타입 정의

| 대상 | 파일 | 타입 |
|------|------|------|
| SQLite 테이블의 행 | `src/types/database.ts` | `CompatibilitySoftware`, `ComponentCategory`, `CommonComponent`, `ComponentDependency` |
| `developer_knowledge` 의 행 | `src/types/knowledge.ts` | `DeveloperKnowledge`, `KnowledgeType` |
| `egovframe_guide` 의 행 | `src/rag/guideManager.ts` | `GuideChunk` |
| `state.json` | `src/utils/dataPaths.ts` | `StateFile`, `ResourceState` |
| `manifest.json`, `snapshot.jsonl.gz` | `src/kb/snapshot.ts` | `SnapshotManifest`, `SnapshotRow` |

---

## 📚 관련 문서

- [HYBRID_SYSTEM_GUIDE.md](./HYBRID_SYSTEM_GUIDE.md): 하이브리드 시스템 개요
- [EGOV_SEARCH_KNOWLEDGE_TOOL.md](./EGOV_SEARCH_KNOWLEDGE_TOOL.md): `egov_search_knowledge` 의 파라미터와 응답
- [TESTING_GUIDE.md](./TESTING_GUIDE.md): 테스트 가이드
- [README.md](../README.md): 설치, `build-index` 옵션, 갱신 CLI
