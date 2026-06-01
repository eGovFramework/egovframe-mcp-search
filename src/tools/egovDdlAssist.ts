/**
 * egov_ddl_assist
 *
 * 행정안전부 공통표준용어 사전 + 기관 Custom 사전을 활용해 LLM 의 DDL 작성을 보조하는 oracle.
 * 자체적으로 DDL 을 생성하지 않고 사전 lookup 결과만 반환 — CREATE TABLE 조립은 호출자(LLM) 책임.
 *
 * 우선순위 정책: **custom > standard** (transparent override).
 * - 같은 한글명이 양쪽 모두에 있으면 custom 결과를 1차로 반환하고, standard 동등 항목을 `standardEquivalent` 로 함께 노출.
 * - 도메인 해석도 동일 — custom_domains 에 같은 이름이 있으면 그게 SQL 타입에 우선.
 *
 * Actions:
 *   - lookup_term      한글 용어 → 영문약어 + 도메인 + SQL 타입 (정확/동의어 매칭)
 *   - decompose_phrase 한글 구문 → 단어 토큰 분해 + 영문 컬럼명 조합 제안
 *   - resolve_domain   도메인명 → SQL 타입/길이 (예: 명V100 → VARCHAR(100))
 *   - propose_column   엔드투엔드: 한글 → 컬럼 DDL fragment (lookup 우선, 실패 시 분해 폴백)
 *   - validate_column  영문 컬럼명/타입을 표준 + custom 사전과 대조 검증
 *   - suggest_table_columns 한글 테이블 개념 → 관련 용어 ranked 후보
 */

import { getInitializedHybridManager } from '../database/hybridManager.js';
import type { SQLiteManager } from '../database/sqliteManager.js';
import type {
  StandardTerm,
  StandardWord,
  StandardDomain,
  CustomTerm,
  CustomWord,
  CustomDomain,
} from '../types/database.js';

type TermSource = 'standard' | 'custom';

export type DdlAssistAction =
  | 'lookup_term'
  | 'decompose_phrase'
  | 'resolve_domain'
  | 'propose_column'
  | 'validate_column'
  | 'suggest_table_columns';

export interface DdlAssistArgs {
  action: DdlAssistAction;
  input: string;
  domainHint?: string;
  /** validate_column 전용: 실제 사용된 SQL 타입 (예: "VARCHAR(100)", "NUMERIC(15,4)"). */
  sqlType?: string;
  /** suggest_table_columns 전용: 반환 후보 수 상한 (기본 30, 최대 100). */
  limit?: number;
}

interface SerializedTerm {
  source: TermSource;
  koreanName: string;
  englishName: string;
  description: string | null;
  domainName: string | null;
  synonyms: string | null;
  storageFormat: string | null;
  displayFormat: string | null;
  allowedValues: string | null;
  authority: string | null;
  revisionRound: string | null;
  resolvedDomain: SerializedDomain | null;
}

interface SerializedDomain {
  source: TermSource;
  domainName: string;
  domainGroup: string | null;
  domainCategory: string | null;
  description: string | null;
  dataType: string;
  dataLength: string | null;
  decimalLength: string | null;
  storageFormat: string | null;
  displayFormat: string | null;
  unit: string | null;
  allowedValues: string | null;
  ddlFragment: string;
}

interface SerializedToken {
  source: TermSource | null; // null when unmatched
  korean: string;
  matched: boolean;
  english: string | null;
  englishFullName: string | null;
  description: string | null;
  isFormatWord: boolean | null;
  domainCategory: string | null;
  synonyms: string | null;
  forbiddenWords: string | null;
}

export async function egovDdlAssist(args: DdlAssistArgs): Promise<string> {
  if (!args?.action) {
    return jsonResult({ success: false, message: '`action` 파라미터가 필요합니다.' });
  }
  if (!args.input || typeof args.input !== 'string' || args.input.trim() === '') {
    return jsonResult({ success: false, action: args.action, message: '`input` 파라미터가 비어 있습니다.' });
  }

  const manager = await getInitializedHybridManager();
  const sqlite = manager.getSQLite();

  const input = args.input.trim();

  switch (args.action) {
    case 'lookup_term':
      return jsonResult(lookupTerm(sqlite, input));
    case 'decompose_phrase':
      return jsonResult(decomposePhrase(sqlite, input));
    case 'resolve_domain':
      return jsonResult(resolveDomain(sqlite, input));
    case 'propose_column':
      return jsonResult(proposeColumn(sqlite, input, args.domainHint?.trim()));
    case 'validate_column':
      return jsonResult(validateColumn(sqlite, input, args.sqlType?.trim()));
    case 'suggest_table_columns':
      return jsonResult(suggestTableColumns(sqlite, input, args.limit));
    default:
      return jsonResult({
        success: false,
        message: `알 수 없는 action: ${args.action}. 지원 action: lookup_term, decompose_phrase, resolve_domain, propose_column, validate_column, suggest_table_columns`,
      });
  }
}

// ==================== Action: lookup_term ====================

function lookupTerm(sqlite: SQLiteManager, korean: string) {
  // 1. Custom exact (최우선)
  const customExact = sqlite.getCustomTermByName(korean);
  if (customExact) {
    const stdEquivalent = sqlite.getStandardTermByName(korean);
    return {
      success: true,
      action: 'lookup_term',
      input: korean,
      matchType: 'custom_exact' as const,
      term: serializeTerm(sqlite, customExact, 'custom'),
      standardEquivalent: stdEquivalent ? serializeTerm(sqlite, stdEquivalent, 'standard') : null,
      note: stdEquivalent
        ? `기관 custom 사전이 행안부 표준 용어 '${stdEquivalent.korean_name}/${stdEquivalent.english_name}' 를 오버라이드합니다. 의도된 동작이라면 그대로 사용하고, 아니라면 표준명 사용을 권장합니다.`
        : '기관 custom 사전에서 매칭되었습니다 (표준에는 없음).',
    };
  }

  // 2. Standard exact
  const stdExact = sqlite.getStandardTermByName(korean);
  if (stdExact) {
    return {
      success: true,
      action: 'lookup_term',
      input: korean,
      matchType: 'exact' as const,
      term: serializeTerm(sqlite, stdExact, 'standard'),
    };
  }

  // 3. Custom synonym
  const customSyns = sqlite.lookupCustomTermsBySynonym(korean);
  if (customSyns.length > 0) {
    return {
      success: true,
      action: 'lookup_term',
      input: korean,
      matchType: 'custom_synonym' as const,
      note: `'${korean}' 은 표준 용어가 아니지만 기관 custom 사전의 동의어로 매칭되었습니다. 표준명 사용을 권장합니다.`,
      candidates: customSyns.map((t) => serializeTerm(sqlite, t, 'custom')),
    };
  }

  // 4. Standard synonym
  const synMatches = sqlite.lookupTermsBySynonym(korean);
  if (synMatches.length > 0) {
    return {
      success: true,
      action: 'lookup_term',
      input: korean,
      matchType: 'synonym' as const,
      note: `'${korean}' 은(는) 표준 용어가 아니지만 동의어로 매칭되었습니다. 표준명을 사용하세요.`,
      candidates: synMatches.map((t) => serializeTerm(sqlite, t, 'standard')),
    };
  }

  return {
    success: false,
    action: 'lookup_term',
    input: korean,
    matchType: 'none' as const,
    message: `'${korean}' 또는 그 동의어가 표준/custom 사전 어디에도 없습니다. decompose_phrase 로 분해를 시도해보세요.`,
  };
}

// ==================== Action: decompose_phrase ====================

function decomposePhrase(sqlite: SQLiteManager, phrase: string) {
  const normalized = phrase.replace(/\s+/g, '');
  const tokens: SerializedToken[] = [];
  const unmatchedSegments: string[] = [];

  let remaining = normalized;
  while (remaining.length > 0) {
    let matched = false;
    for (let len = remaining.length; len > 0; len--) {
      const prefix = remaining.slice(0, len);
      // Custom 단어 우선 매칭, 없으면 표준 단어
      const customWord = sqlite.getCustomWordByName(prefix);
      if (customWord) {
        tokens.push(serializeWord(prefix, customWord, 'custom'));
        remaining = remaining.slice(len);
        matched = true;
        break;
      }
      const word = sqlite.getStandardWordByName(prefix);
      if (word) {
        tokens.push(serializeWord(prefix, word, 'standard'));
        remaining = remaining.slice(len);
        matched = true;
        break;
      }
    }
    if (!matched) {
      const ch = remaining[0];
      tokens.push({
        source: null,
        korean: ch,
        matched: false,
        english: null,
        englishFullName: null,
        description: null,
        isFormatWord: null,
        domainCategory: null,
        synonyms: null,
        forbiddenWords: null,
      });
      unmatchedSegments.push(ch);
      remaining = remaining.slice(1);
    }
  }

  const matchedTokens = tokens.filter((t) => t.matched);
  const suggestedColumnName =
    matchedTokens.length > 0 ? matchedTokens.map((t) => t.english).join('_') : null;

  return {
    success: matchedTokens.length > 0,
    action: 'decompose_phrase',
    input: phrase,
    normalizedInput: normalized,
    tokens,
    suggestedColumnName,
    unmatchedSegments,
    note:
      unmatchedSegments.length > 0
        ? `매칭되지 않은 음절: ${unmatchedSegments.join(', ')}. 해당 부분은 표준 단어 사전에 없습니다.`
        : null,
  };
}

// ==================== Action: resolve_domain ====================

function resolveDomain(sqlite: SQLiteManager, domainName: string) {
  // Custom 우선
  const customDomain = sqlite.getCustomDomainByName(domainName);
  if (customDomain) {
    const stdDomain = sqlite.getStandardDomainByName(domainName);
    return {
      success: true,
      action: 'resolve_domain',
      input: domainName,
      domain: serializeDomain(customDomain, 'custom'),
      standardEquivalent: stdDomain ? serializeDomain(stdDomain, 'standard') : null,
      note: stdDomain
        ? '기관 custom 도메인이 행안부 표준 도메인을 오버라이드합니다.'
        : '기관 custom 도메인에서 매칭되었습니다 (표준에는 없음).',
    };
  }

  const domain = sqlite.getStandardDomainByName(domainName);
  if (!domain) {
    return {
      success: false,
      action: 'resolve_domain',
      input: domainName,
      message: `도메인 '${domainName}' 을 표준/custom 사전 어디에서도 찾을 수 없습니다. 정확한 도메인명(예: 명V100, 금액N15)을 사용하세요.`,
    };
  }

  return {
    success: true,
    action: 'resolve_domain',
    input: domainName,
    domain: serializeDomain(domain, 'standard'),
  };
}

// ==================== Action: propose_column ====================

function proposeColumn(sqlite: SQLiteManager, phrase: string, domainHint?: string) {
  // 1차: Custom exact (최우선)
  const customExact = sqlite.getCustomTermByName(phrase);
  if (customExact) {
    const term = serializeTerm(sqlite, customExact, 'custom');
    const stdEquivalent = sqlite.getStandardTermByName(phrase);
    return {
      success: true,
      action: 'propose_column',
      input: phrase,
      method: 'custom_exact' as const,
      columnName: term.englishName,
      ddlFragment: composeDdlFragment(term.englishName, term.resolvedDomain),
      sourceTerm: term,
      standardEquivalent: stdEquivalent ? serializeTerm(sqlite, stdEquivalent, 'standard') : null,
      note: stdEquivalent
        ? `기관 custom 사전이 표준 용어 '${stdEquivalent.korean_name}/${stdEquivalent.english_name}' 를 오버라이드합니다.`
        : '기관 custom 사전에서 매칭되었습니다.',
      confidence: 1.0,
    };
  }

  // 2차: Standard exact
  const exact = sqlite.getStandardTermByName(phrase);
  if (exact) {
    const term = serializeTerm(sqlite, exact, 'standard');
    return {
      success: true,
      action: 'propose_column',
      input: phrase,
      method: 'exact' as const,
      columnName: term.englishName,
      ddlFragment: composeDdlFragment(term.englishName, term.resolvedDomain),
      sourceTerm: term,
      confidence: 1.0,
    };
  }

  // 3차: Custom synonym
  const customSyns = sqlite.lookupCustomTermsBySynonym(phrase);
  if (customSyns.length > 0) {
    const top = serializeTerm(sqlite, customSyns[0], 'custom');
    return {
      success: true,
      action: 'propose_column',
      input: phrase,
      method: 'custom_synonym' as const,
      columnName: top.englishName,
      ddlFragment: composeDdlFragment(top.englishName, top.resolvedDomain),
      sourceTerm: top,
      candidates:
        customSyns.length > 1
          ? customSyns.map((t) => serializeTerm(sqlite, t, 'custom'))
          : undefined,
      note: `'${phrase}' 은 기관 custom 사전의 동의어로 매칭되었습니다. 표준명 '${top.koreanName}' 사용을 권장합니다.`,
      confidence: 0.85,
    };
  }

  // 4차: Standard synonym
  const synMatches = sqlite.lookupTermsBySynonym(phrase);
  if (synMatches.length > 0) {
    const top = serializeTerm(sqlite, synMatches[0], 'standard');
    return {
      success: true,
      action: 'propose_column',
      input: phrase,
      method: 'synonym' as const,
      columnName: top.englishName,
      ddlFragment: composeDdlFragment(top.englishName, top.resolvedDomain),
      sourceTerm: top,
      candidates:
        synMatches.length > 1
          ? synMatches.map((t) => serializeTerm(sqlite, t, 'standard'))
          : undefined,
      note: `'${phrase}' 은 표준 용어가 아니지만 동의어로 매칭되었습니다. 가능하면 표준명 '${top.koreanName}' 사용을 권장합니다.`,
      confidence: 0.85,
    };
  }

  // 5차: 분해 폴백 (custom_words / standard_words 우선순위 적용됨)
  const decomposed = decomposePhrase(sqlite, phrase);
  if (!decomposed.suggestedColumnName) {
    return {
      success: false,
      action: 'propose_column',
      input: phrase,
      method: 'none' as const,
      message: '표준/custom 용어·단어 사전에서 매칭되는 항목이 없습니다.',
      confidence: 0,
    };
  }

  const domain: SerializedDomain | null = domainHint
    ? resolveDomainWithPriority(sqlite, domainHint)
    : null;

  // confidence: 모두 매칭 + 형식단어 포함 + 도메인 힌트 결합 시 가산
  const allMatched = decomposed.unmatchedSegments.length === 0;
  const hasFormatWord = decomposed.tokens.some((t) => t.isFormatWord);
  let confidence = 0.5;
  if (allMatched) confidence += 0.15;
  if (hasFormatWord) confidence += 0.1;
  if (domain) confidence += 0.1;
  confidence = Math.min(confidence, 0.85);

  let note: string | null = null;
  if (domainHint && !domain) {
    note = `domainHint '${domainHint}' 가 표준/custom 도메인 사전 어디에도 없습니다. resolve_domain 으로 정확한 도메인명(예: 명V100, 연월일C8)을 먼저 확인하세요.`;
  } else if (!domainHint && hasFormatWord) {
    note = '형식단어가 포함되어 있습니다. 정확한 SQL 타입/길이를 얻으려면 domainHint (예: 명V100, 연월일C8) 를 같이 전달하세요.';
  }

  return {
    success: true,
    action: 'propose_column',
    input: phrase,
    method: 'composed' as const,
    columnName: decomposed.suggestedColumnName,
    ddlFragment: composeDdlFragment(decomposed.suggestedColumnName, domain),
    tokens: decomposed.tokens,
    unmatchedSegments: decomposed.unmatchedSegments,
    domainHintUsed: domainHint || null,
    inferredDomain: domain,
    note,
    confidence,
  };
}

// ==================== Action: validate_column ====================

interface Finding {
  level: 'info' | 'warning' | 'error';
  code: string;
  message: string;
}

function validateColumn(sqlite: SQLiteManager, englishName: string, sqlType?: string) {
  const customMatches = sqlite.getCustomTermsByEnglishName(englishName);
  const standardMatches = sqlite.getStandardTermsByEnglishName(englishName);
  const findings: Finding[] = [];

  // 1. 영문약어 매칭 여부 (custom + standard 둘 다 확인)
  if (customMatches.length === 0 && standardMatches.length === 0) {
    findings.push({
      level: 'error',
      code: 'NON_STANDARD_NAME',
      message: `'${englishName}' 은 행정안전부 공통표준용어 + 기관 custom 사전 어디에도 등재된 영문약어가 아닙니다. propose_column 으로 표준 영문명을 찾으세요.`,
    });

    return {
      success: false,
      action: 'validate_column',
      input: englishName,
      sqlType: sqlType ?? null,
      status: 'non_standard' as const,
      findings,
      matches: [],
    };
  }

  // Custom 우선 — 1차 매칭 대상으로 custom 있으면 custom, 아니면 standard
  const primarySource: TermSource = customMatches.length > 0 ? 'custom' : 'standard';
  const primaryRaw = customMatches.length > 0 ? customMatches : standardMatches;

  if (primarySource === 'custom' && standardMatches.length > 0) {
    findings.push({
      level: 'info',
      code: 'CUSTOM_OVERRIDES_STANDARD',
      message: `'${englishName}' 은 기관 custom 사전에서 ${customMatches.length}건 매칭되었고, 동일 영문약어가 행안부 표준에도 ${standardMatches.length}건 존재합니다. custom 이 우선됩니다 — 타입 검증도 custom 기준으로 진행.`,
    });
  } else if (primarySource === 'custom') {
    findings.push({
      level: 'info',
      code: 'CUSTOM_MATCH',
      message: `'${englishName}' 은 기관 custom 사전의 ${customMatches.length}건 용어와 매칭됩니다 (표준 미등재).`,
    });
  } else {
    findings.push({
      level: 'info',
      code: primaryRaw.length === 1 ? 'EXACT_MATCH' : 'MULTIPLE_MATCHES',
      message:
        primaryRaw.length === 1
          ? `'${englishName}' 은 표준 용어 '${primaryRaw[0].korean_name}' 에 대응합니다.`
          : `'${englishName}' 에 대응하는 표준 용어가 ${primaryRaw.length}건 있습니다 (한글 명 다중 매핑). 컨텍스트에 맞는 용어를 골라 사용하세요.`,
    });
  }

  // 2. SQL 타입 검증 (입력이 있을 때) — primary 매칭들의 도메인과 비교
  const serializedMatches = primaryRaw.map((t) => serializeTerm(sqlite, t, primarySource));
  const standardEquivalentMatches =
    primarySource === 'custom' && standardMatches.length > 0
      ? standardMatches.map((t) => serializeTerm(sqlite, t, 'standard'))
      : undefined;
  let parsedSqlType: ParsedSqlType | null = null;
  let typeStatus: 'ok' | 'mismatch' | 'unknown' | 'skipped' = 'skipped';

  if (sqlType) {
    parsedSqlType = parseSqlType(sqlType);
    if (!parsedSqlType) {
      findings.push({
        level: 'warning',
        code: 'UNPARSEABLE_SQL_TYPE',
        message: `sqlType '${sqlType}' 을 파싱할 수 없습니다. VARCHAR(100), NUMERIC(15,4), CHAR(8), DATETIME 같은 표준 형식으로 입력하세요.`,
      });
      typeStatus = 'unknown';
    } else {
      // 매칭된 용어들의 도메인과 비교
      const domainChecks = serializedMatches
        .filter((t) => t.resolvedDomain)
        .map((t) => ({
          term: t,
          domain: t.resolvedDomain!,
          mismatch: detectTypeMismatch(parsedSqlType!, t.resolvedDomain!),
        }));

      const anyOk = domainChecks.some((c) => !c.mismatch);
      if (anyOk) {
        typeStatus = 'ok';
        const sourceLabel = primarySource === 'custom' ? '기관 custom' : '표준';
        findings.push({
          level: 'info',
          code: 'TYPE_OK',
          message: `SQL 타입 '${sqlType}' 이 ${sourceLabel} 도메인 정의와 일치합니다.`,
        });
      } else if (domainChecks.length > 0) {
        typeStatus = 'mismatch';
        const sourceLabel = primarySource === 'custom' ? '기관 custom' : '표준';
        for (const c of domainChecks) {
          findings.push({
            level: 'error',
            code: 'TYPE_MISMATCH',
            message: `SQL 타입 '${sqlType}' 이 ${sourceLabel} 용어 '${c.term.koreanName}' 의 도메인 '${c.domain.domainName}' (${c.domain.ddlFragment}) 과 다릅니다: ${c.mismatch}`,
          });
        }
      } else {
        typeStatus = 'unknown';
        findings.push({
          level: 'warning',
          code: 'DOMAIN_UNRESOLVED',
          message: `매칭된 용어의 도메인을 해석할 수 없어 SQL 타입을 검증하지 못했습니다.`,
        });
      }
    }
  }

  const overallStatus =
    typeStatus === 'mismatch'
      ? ('type_mismatch' as const)
      : primaryRaw.length > 1
        ? ('ambiguous' as const)
        : primarySource === 'custom'
          ? ('custom' as const)
          : ('standard' as const);

  return {
    success: typeStatus !== 'mismatch',
    action: 'validate_column',
    input: englishName,
    sqlType: sqlType ?? null,
    parsedSqlType,
    status: overallStatus,
    typeStatus,
    matchSource: primarySource,
    findings,
    matches: serializedMatches,
    standardEquivalentMatches: standardEquivalentMatches ?? null,
  };
}

// ==================== Action: suggest_table_columns ====================

function suggestTableColumns(sqlite: SQLiteManager, keyword: string, limit?: number) {
  const clamped = Math.min(Math.max(limit ?? 30, 1), 100);
  // Custom 과 standard 양쪽에서 후보 수집. Custom 결과를 먼저 (같은 matchRank 면 custom 우선).
  const customRaw = sqlite.suggestCustomTermsForConcept(keyword, clamped);
  const standardRaw = sqlite.suggestTermsForConcept(keyword, clamped);

  if (customRaw.length === 0 && standardRaw.length === 0) {
    return {
      success: false,
      action: 'suggest_table_columns',
      input: keyword,
      message: `'${keyword}' 관련 용어를 표준/custom 사전 어디에서도 찾지 못했습니다. 더 짧은 키워드 (예: '회원' 대신 '회') 또는 다른 표현으로 시도하세요.`,
      suggestions: [],
      total: 0,
      customCount: 0,
      standardCount: 0,
    };
  }

  const labelByRank: Record<number, string> = {
    1: 'exact',
    2: 'prefix',
    3: 'contains',
    4: 'description',
  };

  // Custom 매칭된 한글명 set — standard 결과에서 중복 제거에 사용 (custom 이 같은 한글명을 override 한 경우)
  const customKoreanNames = new Set(customRaw.map((t) => t.korean_name));

  const customSuggestions = customRaw.map((t) => {
    const serialized = serializeTerm(sqlite, t, 'custom');
    return {
      ...serialized,
      matchType: labelByRank[t.matchRank] ?? 'other',
      ddlFragment: composeDdlFragment(serialized.englishName, serialized.resolvedDomain),
    };
  });

  const standardSuggestions = standardRaw
    .filter((t) => !customKoreanNames.has(t.korean_name)) // custom override 된 항목은 standard 쪽에서 숨김
    .map((t) => {
      const serialized = serializeTerm(sqlite, t, 'standard');
      return {
        ...serialized,
        matchType: labelByRank[t.matchRank] ?? 'other',
        ddlFragment: composeDdlFragment(serialized.englishName, serialized.resolvedDomain),
      };
    });

  // Merge: custom 먼저, 그 다음 standard. Limit 적용.
  const suggestions = [...customSuggestions, ...standardSuggestions].slice(0, clamped);

  return {
    success: true,
    action: 'suggest_table_columns',
    input: keyword,
    customCount: customSuggestions.length,
    standardCount: standardSuggestions.length,
    total: suggestions.length,
    limitApplied: clamped,
    note: suggestions.length === clamped
      ? `상위 ${clamped}건만 반환했습니다. limit 파라미터를 늘리거나 키워드를 구체화하세요.`
      : null,
    suggestions,
  };
}

// ==================== SQL Type Parser ====================

interface ParsedSqlType {
  dataType: string;
  dataLength: string | null;
  decimalLength: string | null;
}

function parseSqlType(raw: string): ParsedSqlType | null {
  const cleaned = raw.trim().toUpperCase();
  const m = cleaned.match(/^([A-Z][A-Z0-9_]*)(?:\s*\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?\))?$/);
  if (!m) return null;
  return {
    dataType: m[1],
    dataLength: m[2] ?? null,
    decimalLength: m[3] ?? null,
  };
}

/**
 * 파싱된 SQL 타입과 표준 도메인 정의를 비교.
 * 일치하면 null, 불일치 사유 문자열 반환.
 */
function detectTypeMismatch(
  parsed: ParsedSqlType,
  domain: SerializedDomain,
): string | null {
  const expectedType = domain.dataType.toUpperCase();
  // VARCHAR vs CHAR 는 다른 타입으로 본다 (저장 의미가 다름).
  // NUMERIC 과 DECIMAL 은 호환으로 본다.
  const numericFamily = new Set(['NUMERIC', 'DECIMAL']);
  const typeMatch =
    parsed.dataType === expectedType ||
    (numericFamily.has(parsed.dataType) && numericFamily.has(expectedType));

  if (!typeMatch) {
    return `데이터 타입 불일치 (입력 ${parsed.dataType}, 표준 ${expectedType})`;
  }
  if (domain.dataLength && parsed.dataLength !== domain.dataLength) {
    return `길이 불일치 (입력 ${parsed.dataLength ?? '없음'}, 표준 ${domain.dataLength})`;
  }
  if (domain.decimalLength && parsed.decimalLength !== domain.decimalLength) {
    return `소수점 길이 불일치 (입력 ${parsed.decimalLength ?? '없음'}, 표준 ${domain.decimalLength})`;
  }
  return null;
}

// ==================== Helpers ====================

function serializeTerm(
  sqlite: SQLiteManager,
  t: StandardTerm | CustomTerm,
  source: TermSource,
): SerializedTerm {
  // 도메인 해석도 custom > standard 우선순위 적용 — term 이 custom 이든 standard 든 동일.
  const resolved = t.domain_name ? resolveDomainWithPriority(sqlite, t.domain_name) : null;
  return {
    source,
    koreanName: t.korean_name,
    englishName: t.english_name,
    description: t.description ?? null,
    domainName: t.domain_name ?? null,
    synonyms: t.synonyms ?? null,
    storageFormat: t.storage_format ?? null,
    displayFormat: t.display_format ?? null,
    allowedValues: t.allowed_values ?? null,
    authority: t.authority ?? null,
    revisionRound: t.revision_round ?? null,
    resolvedDomain: resolved,
  };
}

function serializeDomain(d: StandardDomain | CustomDomain, source: TermSource): SerializedDomain {
  return {
    source,
    domainName: d.domain_name,
    domainGroup: d.domain_group ?? null,
    domainCategory: d.domain_category ?? null,
    description: d.description ?? null,
    dataType: d.data_type,
    dataLength: d.data_length ?? null,
    decimalLength: d.decimal_length ?? null,
    storageFormat: d.storage_format ?? null,
    displayFormat: d.display_format ?? null,
    unit: d.unit ?? null,
    allowedValues: d.allowed_values ?? null,
    ddlFragment: buildDomainDdl(d),
  };
}

function serializeWord(korean: string, w: StandardWord | CustomWord, source: TermSource): SerializedToken {
  return {
    source,
    korean,
    matched: true,
    english: w.english_name,
    englishFullName: w.english_full_name ?? null,
    description: w.description ?? null,
    isFormatWord: Boolean(w.is_format_word),
    domainCategory: w.domain_category ?? null,
    synonyms: w.synonyms ?? null,
    forbiddenWords: w.forbidden_words ?? null,
  };
}

/**
 * 도메인 이름 → SerializedDomain 변환을 custom > standard 우선순위로 해석.
 * 두 곳 모두에 있으면 custom 이 사용되고, source 필드로 출처가 드러난다.
 */
function resolveDomainWithPriority(
  sqlite: SQLiteManager,
  domainName: string,
): SerializedDomain | null {
  const custom = sqlite.getCustomDomainByName(domainName);
  if (custom) return serializeDomain(custom, 'custom');
  const std = sqlite.getStandardDomainByName(domainName);
  if (std) return serializeDomain(std, 'standard');
  return null;
}

function buildDomainDdl(d: StandardDomain): string {
  const t = d.data_type.toUpperCase();
  if ((t === 'NUMERIC' || t === 'DECIMAL') && d.data_length) {
    return d.decimal_length ? `${t}(${d.data_length}, ${d.decimal_length})` : `${t}(${d.data_length})`;
  }
  if ((t === 'VARCHAR' || t === 'CHAR') && d.data_length) {
    return `${t}(${d.data_length})`;
  }
  return t;
}

function composeDdlFragment(columnName: string, domain: SerializedDomain | null): string {
  return domain ? `${columnName} ${domain.ddlFragment}` : columnName;
}

function jsonResult(obj: unknown): string {
  return JSON.stringify(obj, null, 2);
}
