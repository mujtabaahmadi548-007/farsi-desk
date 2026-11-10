import { FA_MARKS, foldChars, KASHIDA, ZWNJ } from './chars';

/**
 * Fuzzy matching for the translation memory.
 *
 * Texts are compared as sequences of tokens (words and punctuation marks) with a weighted
 * edit distance: a changed word costs 1, a slightly different word (می‌روم / می‌روند) costs only
 * its share of changed letters, and punctuation counts for a quarter of a word.
 */

// Kashida, Arabic marks, ZERO WIDTH JOINER, LEFT-TO-RIGHT MARK, RIGHT-TO-LEFT MARK
const IGNORED = new RegExp(`[${KASHIDA}${FA_MARKS}\u{200D}\u{200E}\u{200F}]`, 'g');
const ZWNJ_RE = new RegExp(ZWNJ, 'g');

/**
 * Canonical form used for comparison: Arabic/Persian letter variants and digit scripts are unified,
 * Latin is lower-cased, diacritics and kashida are dropped, and the half-space counts as a space
 * (so «می‌روم» and «می روم» are the same).
 */
export function normalizeForMatch(text: string): string {
  return foldChars(text).replace(IGNORED, '').replace(ZWNJ_RE, ' ').replace(/\s+/g, ' ').trim();
}

export function matchTokens(normalized: string): string[] {
  return normalized.match(/[\p{L}\p{M}\p{N}]+|[^\s\p{L}\p{M}\p{N}]/gu) ?? [];
}

const PUNCT_WEIGHT = 0.25;
const WORD_RE = /[\p{L}\p{N}]/u;

function isWord(token: string): boolean {
  return WORD_RE.test(token);
}

function weightOf(token: string): number {
  return isWord(token) ? 1 : PUNCT_WEIGHT;
}

function totalWeight(tokens: string[]): number {
  let sum = 0;
  for (const token of tokens) sum += weightOf(token);
  return sum;
}

/** Plain Levenshtein distance between two short strings. */
export function charDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previous = new Array<number>(b.length + 1);
  let current = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) previous[j] = j;
  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    [previous, current] = [current, previous];
  }
  return previous[b.length];
}

function substitutionCost(a: string, b: string, cache: Map<string, number>): number {
  if (a === b) return 0;
  const aWord = isWord(a);
  const bWord = isWord(b);
  if (!aWord && !bWord) return PUNCT_WEIGHT;
  if (aWord !== bWord) return 1 + PUNCT_WEIGHT; // same as deleting one and inserting the other
  const key = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const ratio = charDistance(a, b) / Math.max(a.length, b.length);
  // Words that share less than half of their letters are simply different words.
  const cost = ratio <= 0.5 ? ratio : 1;
  cache.set(key, cost);
  return cost;
}

/** Similarity of two token lists, from 0 (nothing in common) to 1 (identical). */
export function tokenSimilarity(a: string[], b: string[], cache: Map<string, number> = new Map()): number {
  const total = Math.max(totalWeight(a), totalWeight(b));
  if (total === 0) return a.join('') === b.join('') ? 1 : 0;
  const m = b.length;
  let previous = new Array<number>(m + 1);
  let current = new Array<number>(m + 1);
  previous[0] = 0;
  for (let j = 1; j <= m; j++) previous[j] = previous[j - 1] + weightOf(b[j - 1]);
  for (let i = 1; i <= a.length; i++) {
    const wa = weightOf(a[i - 1]);
    current[0] = previous[0] + wa;
    for (let j = 1; j <= m; j++) {
      current[j] = Math.min(
        previous[j] + wa,
        current[j - 1] + weightOf(b[j - 1]),
        previous[j - 1] + substitutionCost(a[i - 1], b[j - 1], cache),
      );
    }
    [previous, current] = [current, previous];
  }
  return Math.max(0, 1 - previous[m] / total);
}

/**
 * Match score in percent. 100 = the texts are identical; 99 = they differ only in things the
 * comparison ignores (digit script, ي/ی, half-space vs space, letter case, diacritics).
 */
export function similarity(a: string, b: string): number {
  const na = normalizeForMatch(a);
  const nb = normalizeForMatch(b);
  if (na === nb) return a.trim() === b.trim() ? 100 : 99;
  return Math.min(99, Math.floor(tokenSimilarity(matchTokens(na), matchTokens(nb)) * 100));
}

// ---------------------------------------------------------------------------
// Searching a whole translation memory
// ---------------------------------------------------------------------------

export interface Candidate<T> {
  item: T;
  source: string;
  target: string;
}

export interface PreparedCandidate<T> extends Candidate<T> {
  normalized: string;
  tokens: string[];
  weight: number;
  words: Set<string>;
}

export interface FuzzyMatch<T> {
  item: T;
  source: string;
  target: string;
  /** 0–100 */
  score: number;
}

/** Pre-computes the comparison form of every candidate once, so each lookup is fast. */
export function prepareCandidates<T>(candidates: Candidate<T>[]): PreparedCandidate<T>[] {
  const prepared: PreparedCandidate<T>[] = [];
  for (const candidate of candidates) {
    const normalized = normalizeForMatch(candidate.source);
    if (normalized === '' || candidate.target.trim() === '') continue;
    const tokens = matchTokens(normalized);
    prepared.push({
      ...candidate,
      normalized,
      tokens,
      weight: totalWeight(tokens),
      words: new Set(tokens.filter(isWord)),
    });
  }
  return prepared;
}

export interface FindOptions {
  /** Lowest score to report (default 50). */
  minScore?: number;
  /** Maximum number of matches (default 5). */
  limit?: number;
}

/** Best matches for `query`, highest score first. Candidates listed earlier win ties. */
export function findMatches<T>(
  query: string,
  prepared: PreparedCandidate<T>[],
  options: FindOptions = {},
): FuzzyMatch<T>[] {
  const minScore = options.minScore ?? 50;
  const limit = options.limit ?? 5;
  const normalized = normalizeForMatch(query);
  if (normalized === '') return [];
  const tokens = matchTokens(normalized);
  const weight = totalWeight(tokens);
  const words = tokens.filter(isWord);
  const cache = new Map<string, number>();
  const results: (FuzzyMatch<T> & { rank: number; key: string })[] = [];

  prepared.forEach((candidate, rank) => {
    let score: number;
    if (candidate.normalized === normalized) {
      score = candidate.source.trim() === query.trim() ? 100 : 99;
    } else {
      // Cheap bounds first: very different lengths, or no word in common, cannot reach the threshold.
      const heavier = Math.max(weight, candidate.weight);
      if (heavier === 0 || (1 - Math.abs(weight - candidate.weight) / heavier) * 100 < minScore) return;
      if (words.length >= 4 && candidate.words.size >= 4 && !words.some((word) => candidate.words.has(word))) return;
      score = Math.min(99, Math.floor(tokenSimilarity(tokens, candidate.tokens, cache) * 100));
    }
    if (score < minScore) return;
    const key = `${candidate.normalized}\u0000${candidate.target.trim()}`;
    results.push({ item: candidate.item, source: candidate.source, target: candidate.target, score, rank, key });
  });

  results.sort((a, b) => b.score - a.score || a.rank - b.rank);
  // The same pair stored twice (e.g. confirmed in two projects) is shown once, with its best score.
  const seen = new Set<string>();
  const matches: FuzzyMatch<T>[] = [];
  for (const result of results) {
    if (seen.has(result.key)) continue;
    seen.add(result.key);
    matches.push({ item: result.item, source: result.source, target: result.target, score: result.score });
    if (matches.length >= limit) break;
  }
  return matches;
}
