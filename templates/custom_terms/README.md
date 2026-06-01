# 기관 Custom 사전 (Agency-specific dictionary)

행정안전부 공통표준용어를 **확장**하는 기관 자체 사전 영역입니다. 기관 고유의 용어/단어/도메인을 등록하여 `egov_ddl_assist` 가 DDL 작성 시 사용하도록 합니다.

## 우선순위 정책

**Custom > Standard (transparent override)**

- 같은 한글명이 양쪽 모두에 있으면 **custom 이 우선**으로 반환됩니다.
- 단, 응답에는 항상 `standardEquivalent` 가 함께 포함되어 가려진 행안부 표준 정의가 무엇인지 노출됩니다 — silent override 가 아닌 transparent override.
- `build-index` 실행 시 충돌(같은 한글명/도메인명이지만 영문명·타입이 다름)이 감지되면 콘솔에 경고로 표시됩니다.

## 파일 구성

| 파일 | 내용 | gitignore? |
|------|------|-----------|
| `custom_standard_terms.csv` | 기관 고유 용어 | ✅ (기관 자료) |
| `custom_standard_words.csv` | 기관 고유 단어 | ✅ |
| `custom_standard_domains.csv` | 기관 고유 도메인 | ✅ |
| `*.csv.example` | 헤더 + 샘플 행 (포맷 가이드) | ❌ (공유 OK) |
| `README.md` | 이 파일 | ❌ |

기관 자체 자산이므로 `*.csv` 는 `.gitignore` 에 등록되어 있습니다. `.csv.example` 파일을 복사해 시작하세요:

```bash
cp templates/custom_terms/custom_standard_terms.csv.example \
   templates/custom_terms/custom_standard_terms.csv
# 단어/도메인도 동일
npm run build-index:custom
```

### example 내용 안내 (국세청 가상 시나리오)

`.csv.example` 3종에는 **국세청** 시나리오로 작성된 실전 예시가 들어 있습니다 — 다른 기관도 그대로 참조해 자기 사전을 짤 수 있게:

| 파일 | 행 수 | 구성 |
|------|------|------|
| `custom_standard_terms.csv.example` | 25 | NTS-unique 용어 20개 + **의도된 override 5건** (납세자명/사업자명/상호의 길이 변경, 사업자등록번호/대표자명의 영문약어 변경) |
| `custom_standard_words.csv.example` | 14 | NTS-unique 단어 (세무조사·양도소득·영세율·매입세·면세사업자 등) |
| `custom_standard_domains.csv.example` | 3 | NTS-unique 도메인 (세무서코드C8, 세무조사번호V20, 연도C4) |

example 을 그대로 적재하면 build-index 결과에 정확히 5건의 override 만 잡힙니다:

```
⚠️ Custom override 감지: 용어 5건 / 단어 0건 / 도메인 0건
   [용어] '납세자명': custom=TXPR_NM/명V100 ⇄ standard=TXPR_NM/명V200
   [용어] '사업자명': custom=BZMN_NM/명V100 ⇄ standard=BZMN_NM/명V200
   [용어] '상호': custom=CONM/명V100 ⇄ standard=CONM/명V200
   [용어] '사업자등록번호': custom=TXPR_BRNO/사업자등록번호C10 ⇄ standard=BRNO/사업자등록번호C10
   [용어] '대표자명': custom=REPR_NM/명V100 ⇄ standard=RPRSV_NM/명V100
```

이 5건이 **transparent override** 패턴을 학습하기 좋은 케이스입니다.

## CSV 포맷

행안부 표준 CSV (`templates/standard_terms/mois_*.csv`) 와 **헤더가 완전히 동일**합니다. 행안부 사전에서 행을 그대로 복사·붙여넣기 가능하며, 같은 파서가 처리합니다.

### 용어 (`custom_standard_terms.csv`)

```csv
공통표준용어명,공통표준용어설명,공통표준용어영문약어명,공통표준도메인명,허용값,저장 형식,표현 형식,행정표준코드명,소관기관명,용어 이음동의어 목록,제정차수,개정구분명(폐기 또는 변경),개정항목,개정사유
```

### 단어 (`custom_standard_words.csv`)

```csv
공통표준단어명,공통표준단어영문약어명,공통표준단어 영문명,공통표준단어 설명,형식단어여부,공통표준도메인분류명,이음동의어 목록,금칙어 목록,제정차수,개정구분명(폐기 또는 변경),개정항목,개정사유
```

### 도메인 (`custom_standard_domains.csv`)

```csv
공통표준도메인그룹명,공통표준도메인분류명,공통표준도메인명,공통표준도메인설명,데이터타입,데이터길이,데이터소수점길이,저장형식,표현형식,단위,허용값,제정차수,개정구분명(폐기 또는 변경),개정항목,개정사유
```

## 버전 관리 (제정차수)

표준 CSV 와 같이 `제정차수`/`개정구분명`/`개정항목`/`개정사유` 컬럼으로 사전 자체의 변경 이력을 기록합니다.

- 처음 등록할 때: `제정차수` 에 `1차(YYYY-MM)` 같은 형태로 입력
- 폐기할 때: `개정구분명(폐기 또는 변경)` 에 `폐기` 또는 `(폐기)` 를 포함하면 build-index 가 자동으로 제외합니다
- `폐기후제정` 표기는 표준과 동일하게 처리됩니다

## 적용 (재인덱싱)

CSV 수정 후 재적재 방법은 두 가지입니다:

### ✅ 권장: Custom 만 빠른 재적재 (1~2초)

```bash
npm run build-index:custom
```

- 기관 custom CSV 3개만 다시 읽어 `custom_terms`/`custom_words`/`custom_domains` 테이블에 재적재
- 행안부 표준 CSV, 공통컴포넌트, LanceDB 벡터 인덱스는 손대지 않음
- MCP 서버를 재시작할 필요 없이 즉시 반영
- 단계 출력에 `5/11`~`8/11` 표시는 전체 build-index 의 단계 번호를 그대로 쓰는 것 (무시 가능)

### 전체 인덱싱 (5~15분)

```bash
npm run build-index -- --yes
```

행안부 표준 CSV, LanceDB 벡터, 가이드 문서까지 모두 재구축. **행안부 표준이 새 차수로 업데이트되었을 때**나 LanceDB 가 손상되었을 때만 필요.

### 어느 쪽을 써야 하나

| 상황 | 명령 |
|---|---|
| 기관 custom 사전에 용어/단어/도메인 추가·수정 | `npm run build-index:custom` |
| 행안부 표준 CSV 갱신 (예: 9차 출시) | `npm run build-index -- --yes` |
| 공통컴포넌트 / 가이드 문서 / 개발자 지식 변경 | `npm run build-index -- --yes` |
| DB 초기 구축 (처음 설치) | `npm run build-index -- --yes` |

## 충돌 보고

build-index 가 다음과 같은 메시지를 출력하면 custom override 가 적용된 것입니다:

```
⚠️ Custom override 감지: 용어 3건 / 단어 0건 / 도메인 1건
   [용어] '사용자명': custom=USR_NM/명V50 ⇄ standard=USER_NM/명V100
   ...
```

의도된 override 라면 그대로 두고, 의도가 아니라면 custom CSV 에서 해당 행을 제거하세요.

## 도구 응답에서의 표기

`egov_ddl_assist` 모든 action 응답은 `source: "custom" | "standard"` 필드로 출처를 표시합니다:

```json
{
  "matchType": "custom_exact",
  "term": { "source": "custom", "englishName": "USR_NM", ... },
  "standardEquivalent": { "source": "standard", "englishName": "USER_NM", ... },
  "note": "기관 custom 사전이 행안부 표준 용어 '사용자명/USER_NM' 를 오버라이드합니다."
}
```
