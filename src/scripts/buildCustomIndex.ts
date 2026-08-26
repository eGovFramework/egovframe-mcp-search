#!/usr/bin/env node

/**
 * Custom-only Reindex Script
 * 기관 Custom 사전 (templates/custom_terms/*.csv) 만 다시 적재한다.
 *
 * - 행안부 표준 CSV / 공통컴포넌트 / LanceDB 인덱스는 손대지 않음 → 1~2초 내 완료
 * - 기존 custom_terms / custom_words / custom_domains 테이블만 비우고 재적재
 * - 충돌 보고서도 함께 출력
 *
 * 사용법:
 *   npm run build-index:custom
 */

import { SQLiteManager } from '../database/sqliteManager.js';
import { CUSTOM_TERMS_DIR } from './buildIndex.js';
import {
  loadCustomTerms,
  loadCustomWords,
  loadCustomDomains,
  reportShadowingConflicts,
} from '../kb/sqliteLoaders.js';

async function buildCustomIndex() {
  console.error('🚀 Custom 사전만 재적재 시작\n');

  const sqlite = new SQLiteManager();
  const before = sqlite.getOverallStats();
  console.error(
    `📊 변경 전: custom 용어 ${before.customTerms.count}개 / 단어 ${before.customWords.count}개 / 도메인 ${before.customDomains.count}개\n`,
  );

  try {
    sqlite.clearCustomReferenceData();
    await loadCustomTerms(sqlite, CUSTOM_TERMS_DIR);
    await loadCustomWords(sqlite, CUSTOM_TERMS_DIR);
    await loadCustomDomains(sqlite, CUSTOM_TERMS_DIR);
    reportShadowingConflicts(sqlite);

    const after = sqlite.getOverallStats();
    console.error('\n📊 변경 후:');
    console.error(`  ✓ Custom 용어: ${after.customTerms.count}개`);
    console.error(`  ✓ Custom 단어: ${after.customWords.count}개`);
    console.error(`  ✓ Custom 도메인: ${after.customDomains.count}개`);
    console.error('\n✅ Custom 사전 재적재 완료. MCP 서버 재시작 없이 즉시 반영됩니다.');
  } finally {
    sqlite.close();
  }
}

try {
  await buildCustomIndex();
} catch (error) {
  console.error('\n❌ 치명적 오류:', error);
  process.exit(1);
}
