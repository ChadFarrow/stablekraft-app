/**
 * Search Utilities
 * 
 * Provides utilities for parsing search queries and building PostgreSQL full-text search queries
 */

export interface ParsedQuery {
  terms: string[];
  exactPhrases: string[];
  fieldFilters: Record<string, string[]>;
  operators: {
    mustInclude: string[];
    mustExclude: string[];
  };
}

/**
 * Parse a search query into components
 */
export function parseSearchQuery(query: string): ParsedQuery {
  const result: ParsedQuery = {
    terms: [],
    exactPhrases: [],
    fieldFilters: {},
    operators: {
      mustInclude: [],
      mustExclude: []
    }
  };

  // Extract quoted phrases
  const quotedPhraseRegex = /"([^"]+)"/g;
  let match;
  const remainingQuery = query.replace(quotedPhraseRegex, (match, phrase) => {
    result.exactPhrases.push(phrase.trim());
    return '';
  }).trim();

  // Extract field-specific filters (e.g., artist:doerfels, album:test)
  const fieldFilterRegex = /(\w+):([^\s"]+)/g;
  let fieldMatch;
  const queryWithoutFields = remainingQuery.replace(fieldFilterRegex, (match, field, value) => {
    if (!result.fieldFilters[field]) {
      result.fieldFilters[field] = [];
    }
    result.fieldFilters[field].push(value.trim());
    return '';
  }).trim();

  // Extract operators (+, -)
  const words = queryWithoutFields.split(/\s+/).filter(w => w.length > 0);
  words.forEach(word => {
    if (word.startsWith('+')) {
      result.operators.mustInclude.push(word.substring(1).toLowerCase());
    } else if (word.startsWith('-')) {
      result.operators.mustExclude.push(word.substring(1).toLowerCase());
    } else {
      result.terms.push(word.toLowerCase());
    }
  });

  return result;
}

/**
 * Build PostgreSQL tsquery from parsed query
 * Converts search terms into PostgreSQL full-text search query format
 */
export function buildTsQuery(query: ParsedQuery): string {
  const parts: string[] = [];

  // Add exact phrases
  query.exactPhrases.forEach(phrase => {
    // Replace spaces with <-> for phrase search
    const phraseQuery = phrase.split(/\s+/).map(term => escapeTsQueryTerm(term)).join(' <-> ');
    parts.push(`(${phraseQuery})`);
  });

  // Add required terms (with +)
  query.operators.mustInclude.forEach(term => {
    parts.push(`${escapeTsQueryTerm(term)}:*`);
  });

  // Add regular terms (AND logic - all must match)
  if (query.terms.length > 0) {
    const termsQuery = query.terms.map(term => escapeTsQueryTerm(term)).join(' & ');
    parts.push(`(${termsQuery})`);
  }

  // Exclude terms (with -)
  query.operators.mustExclude.forEach(term => {
    parts.push(`!${escapeTsQueryTerm(term)}:*`);
  });

  if (parts.length === 0) {
    return '*:*'; // Match all
  }

  return parts.join(' & ');
}

/**
 * Escape special characters for tsquery
 */
function escapeTsQueryTerm(term: string): string {
  // Escape special tsquery characters: & | ! ( ) : * '
  return term.replace(/[&|!:*'()]/g, '\\$&');
}

/**
 * Build search vector content from track fields
 * Creates a combined searchable string from all track metadata
 */
export function buildSearchVectorContent(track: {
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  subtitle?: string | null;
  description?: string | null;
  itunesKeywords?: string[] | null;
  itunesCategories?: string[] | null;
}): string {
  const parts: string[] = [];

  // Add fields with appropriate weighting markers
  // Weight markers: A=high, B=medium, C=low
  if (track.title) parts.push(`A:${track.title}`);
  if (track.artist) parts.push(`B:${track.artist}`);
  if (track.album) parts.push(`B:${track.album}`);
  if (track.subtitle) parts.push(`C:${track.subtitle}`);
  if (track.description) parts.push(`C:${track.description}`);

  // Add keywords and categories
  if (track.itunesKeywords?.length) {
    track.itunesKeywords.forEach(kw => parts.push(`C:${kw}`));
  }
  if (track.itunesCategories?.length) {
    track.itunesCategories.forEach(cat => parts.push(`C:${cat}`));
  }

  return parts.join(' ');
}

/**
 * Normalize search query
 * Removes extra whitespace and normalizes the query
 */
export function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ');
}

/**
 * Build field-specific WHERE conditions from parsed query
 */
export function buildFieldFilters(query: ParsedQuery): Record<string, any> {
  const filters: Record<string, any> = {};

  Object.entries(query.fieldFilters).forEach(([field, values]) => {
    if (values.length === 1) {
      filters[field] = { contains: values[0], mode: 'insensitive' as const };
    } else {
      filters[field] = {
        OR: values.map(v => ({ contains: v, mode: 'insensitive' as const }))
      };
    }
  });

  return filters;
}
