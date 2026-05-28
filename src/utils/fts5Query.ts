/**
 * Sanitize natural-language input for SQLite FTS5 MATCH.
 * Characters like '.' and ':' are interpreted as FTS5 syntax (column filters, etc.)
 * and commonly trigger "fts5: syntax error near ..." for user queries.
 */

export function sanitizeFts5MatchQuery(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  let s = trimmed;
  s = s.replaceAll(/["*^()[\]{}|]/g, ' ');
  s = s.replaceAll(':', ' ');
  s = s.replaceAll('.', ' ');
  s = s.replaceAll('-', ' ');
  s = s.replaceAll(/\s+/g, ' ').trim();

  return s.length > 0 ? s : null;
}
