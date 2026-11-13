/**
 * 호환 소프트웨어 조회 테스트가 함께 쓰는 고정 데이터.
 *
 * 여러 테스트가 행 수와 낱말 분포에 기대므로 값을 바꿀 때는 아래 성질을 지켜야 한다.
 * - 전체 6행.
 * - 모든 행의 설명에 "표준프레임워크"·"호환"·"확인" 이 들어 있다 (변별력 없는 낱말).
 * - "티맥스" 는 정확히 3행(절반)의 벤더명에 들어 있다.
 * - "오라클" 은 '한국오라클' 한 토큰의 뒷부분이라 접두 일치로는 찾을 수 없다.
 */
export interface SoftwareSeed {
  product_name: string;
  product_version: string;
  framework_version: string;
  category: string;
  compatibility_level: 1 | 2;
  vendor: string;
  verified_date: string;
  description: string;
  url?: string;
}

export const CATALOGUE: SoftwareSeed[] = [
  {
    product_name: "JEUS",
    product_version: "JEUS 8.5",
    framework_version: "4.0",
    category: "WAS",
    compatibility_level: 2,
    vendor: "(주)티맥스소프트",
    verified_date: "2022-11-02",
    description: "표준프레임워크 4.0 호환 확인 JEUS 8.5",
  },
  {
    product_name: "JEUS",
    product_version: "JEUS 21",
    framework_version: "4.3",
    category: "WAS",
    compatibility_level: 2,
    vendor: "(주)티맥스소프트",
    verified_date: "2025-08-21",
    description: "표준프레임워크 4.3 호환 확인",
  },
  {
    product_name: "Tibero",
    product_version: "Tibero 7",
    framework_version: "4.0",
    category: "DBMS",
    compatibility_level: 2,
    vendor: "(주)티맥스티베로",
    verified_date: "2022-12-12",
    description: "표준프레임워크 4.0 호환 확인",
  },
  {
    product_name: "WebLogic",
    product_version: "WebLogic 12c",
    framework_version: "3.6",
    category: "WAS",
    compatibility_level: 2,
    vendor: "한국오라클",
    verified_date: "2017-01-01",
    description: "표준프레임워크 3.6 호환 확인",
  },
  {
    product_name: "SampleCMS",
    product_version: "SampleCMS 1.0",
    framework_version: "4.3",
    category: "CMS Solution",
    compatibility_level: 1,
    vendor: "샘플벤더",
    verified_date: "2024-05-05",
    description: "표준프레임워크 4.3 호환 확인",
  },
  {
    product_name: "OtherCMS",
    product_version: "OtherCMS 2.0",
    framework_version: "4.2",
    category: "CMS Solution",
    compatibility_level: 2,
    vendor: "다른벤더",
    verified_date: "2023-03-03",
    description: "표준프레임워크 4.2 호환 확인",
  },
];

/**
 * 확인일자 정렬을 확인하는 행. CATALOGUE 에 넣지 않고, 필요한 테스트가 따로 적재한다
 * (CATALOGUE 의 행 수와 낱말 분포에 기대는 테스트가 많다).
 *
 * - 적재 순서(id 순)가 확인일자 순서와 다르다.
 * - 두 행은 verified_date 에 날짜가 아닌 값이 들어 있다 (원본 데이터에서 필드가 밀린 행을 본뜬 것).
 *   문자열로 내림차순 정렬하면 이 값들이 어떤 날짜보다도 앞에 온다 ('㈜…' > 'https…' > '2025…').
 * - 컬럼마다 낱말 수가 같아, "Dated" 로 찾으면 네 행의 검색 순위(rank)가 같다.
 * - "ated" 는 'Dated' 의 중간이라 접두 일치로는 찾을 수 없고, 이 네 행에만 들어 있다.
 */
const dated = (suffix: string, verified_date: string): SoftwareSeed => ({
  product_name: `Dated ${suffix}`,
  product_version: `Dated ${suffix} 1.0`,
  framework_version: "4.1",
  category: "Date Check",
  compatibility_level: 2,
  vendor: "정렬벤더",
  verified_date,
  description: "확인일자 정렬용",
});

export const DATED: SoftwareSeed[] = [
  dated("Old", "2021-01-01"),
  dated("Vendor", "㈜어떤회사"),
  dated("New", "2025-12-31"),
  dated("Url", "https://vendor.example"),
];

/** 행을 구분하기 쉬운 값(product_version)만 뽑는다. */
export const versionsOf = (rows: Array<{ product_version: string }>): string[] =>
  rows.map((row) => row.product_version);
