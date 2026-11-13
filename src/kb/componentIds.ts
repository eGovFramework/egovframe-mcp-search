/**
 * 공통컴포넌트 메타의 id 를 고유하게 만든다.
 *
 * templates/common-components.json 의 id 는 패키지명의 마지막 마디라서 서로 다른 컴포넌트가
 * 같은 id 를 가질 수 있다 (cop.smt.sim, ssi.syi.sim, utl.sim 이 모두 'sim').
 * common_components.component_id 는 고유해야 하므로, 겹친 채로 적재하면 뒤 항목이 앞 항목을
 * 덮어써 컴포넌트가 사라지고 의존성이 한 컴포넌트로 합쳐진다.
 *
 * 규칙 (메타에 적힌 순서대로 처리한다):
 * 1. 처음 나온 항목은 id 를 그대로 쓴다.
 * 2. 뒤에 나온 항목은 패키지명의 상위 마디를 고유해질 때까지 앞에 붙인다
 *    (egovframework.com.uss.cmt → uss-cmt).
 * 3. 같은 id 를 먼저 쓴 항목과 패키지명까지 같으면 패키지로는 구분할 수 없으므로,
 *    영문명을 소문자와 하이픈으로 바꾼 값을 쓴다 (Blog Management → blog-management).
 * 4. 그래도 고유해지지 않으면 번호를 붙인다 (bbs-2, bbs-3 …).
 *
 * 고유 여부는 대소문자를 구분하지 않고 판정한다 (조회가 대소문자를 구분하지 않는다).
 */

/** id 를 정하는 데 쓰는 메타 항목의 필드 */
export interface ComponentIdSource {
  id: string;
  packageName: string;
  nameEn?: string | null;
}

/** id 가 바뀐 항목 */
export interface RenamedComponentId {
  /** 입력 배열에서의 위치 */
  index: number;
  /** 메타에 적힌 id */
  from: string;
  /** 새로 정한 id */
  to: string;
}

export interface UniqueComponentIds {
  /** 입력과 같은 순서의 고유한 id */
  ids: string[];
  /** id 가 바뀐 항목 (입력 순서) */
  renamed: RenamedComponentId[];
}

/** 영문명을 id 로 쓸 수 있는 소문자·하이픈 표기로 바꾼다. 쓸 글자가 없으면 빈 문자열. */
function slugify(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** 패키지명의 상위 마디를 하나씩 더 붙인 후보 (가까운 마디부터). */
function packageQualifiedCandidates(id: string, packageName: string): string[] {
  const segments = packageName.split('.').filter(Boolean);
  // id 가 마지막 마디와 같으면 그 마디는 이미 id 에 들어 있다
  const parents = segments.length > 0 && segments[segments.length - 1].toLowerCase() === id.toLowerCase()
    ? segments.slice(0, -1)
    : segments;

  const candidates: string[] = [];
  for (let count = 1; count <= parents.length; count += 1) {
    candidates.push([...parents.slice(-count), id].join('-'));
  }
  return candidates;
}

export function assignUniqueComponentIds(components: readonly ComponentIdSource[]): UniqueComponentIds {
  const used = new Set<string>();
  /** 메타의 id(소문자) → 그 id 를 가진 항목들의 패키지명 */
  const packagesByBaseId = new Map<string, Set<string>>();
  const ids: string[] = [];
  const renamed: RenamedComponentId[] = [];

  const isFree = (candidate: string) => candidate !== '' && !used.has(candidate.toLowerCase());

  components.forEach((component, index) => {
    const baseId = component.id;
    const baseKey = baseId.toLowerCase();
    const seenPackages = packagesByBaseId.get(baseKey) ?? new Set<string>();

    let assigned = baseId;
    if (!isFree(baseId)) {
      const samePackageSeen = seenPackages.has(component.packageName);
      const candidates = samePackageSeen
        ? [slugify(component.nameEn)]
        : packageQualifiedCandidates(baseId, component.packageName);

      assigned = candidates.find(isFree) ?? '';
      for (let suffix = 2; assigned === ''; suffix += 1) {
        const numbered = `${baseId}-${suffix}`;
        if (isFree(numbered)) {
          assigned = numbered;
        }
      }
      renamed.push({ index, from: baseId, to: assigned });
    }

    used.add(assigned.toLowerCase());
    seenPackages.add(component.packageName);
    packagesByBaseId.set(baseKey, seenPackages);
    ids.push(assigned);
  });

  return { ids, renamed };
}
