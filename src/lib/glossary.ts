import type { GlossaryTerm, Lang } from '../types';
import { FA_LETTERS, FA_MARKS, foldChars, ZWNJ } from './chars';

export interface TermHit {
  /** Offsets in the ORIGINAL text (folding is length-preserving). */
  start: number;
  end: number;
  /** Every glossary entry whose term matched this span (several entries can share one source term). */
  terms: GlossaryTerm[];
}

const YE = '\u{06CC}';
const FA_WORD = FA_LETTERS + FA_MARKS;
/** Persian endings that may follow a term: plural ها / ان and the indefinite / ezafe ی, with or without half-space. */
const FA_SUFFIX = `(?:${ZWNJ}?(?:ها${YE}${YE}|ها${YE}|ها|ان|${YE}${YE}|ا${YE}|${YE}))?`;
const SEPARATORS = new RegExp(`[\\s${ZWNJ}]+`);

interface Matcher {
  regex: RegExp;
  /** First piece of the folded term: a cheap pre-check before running the regex. */
  probe: string;
}

const matcherCache = new Map<string, Matcher | null>();

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds a tolerant matcher for a glossary term:
 * - Persian: ي/ی and ك/ک are equal, a space, a half-space or nothing may separate the parts
 *   («نرم‌افزار» = «نرم افزار» = «نرمافزار»), and common endings may follow («دانش‌آموزان», «کتاب‌ها»).
 * - English: case-insensitive, whole words, optional plural -s / -es.
 */
function getMatcher(term: string, lang: Lang): Matcher | null {
  const key = `${lang}\u0000${term}`;
  const cached = matcherCache.get(key);
  if (cached !== undefined) return cached;

  const pieces = foldChars(term)
    .split(SEPARATORS)
    .filter((piece) => piece !== '');
  let matcher: Matcher | null = null;
  if (pieces.length > 0) {
    const escaped = pieces.map(escapeRegex);
    const regex =
      lang === 'fa'
        ? new RegExp(
            `(^|[^${FA_WORD}${ZWNJ}A-Za-z0-9])(${escaped.join(`[\\s${ZWNJ}]*`)}${FA_SUFFIX})(?![${FA_WORD}A-Za-z0-9])`,
            'g',
          )
        : new RegExp(`(^|[^A-Za-z0-9])(${escaped.join('\\s+')}(?:e?s)?)(?![A-Za-z0-9])`, 'g');
    matcher = { regex, probe: pieces[0] };
  }
  matcherCache.set(key, matcher);
  return matcher;
}

function termText(term: GlossaryTerm, lang: Lang): string {
  return lang === 'fa' ? term.fa : term.en;
}

/** Finds glossary terms of language `lang` in `text`. Overlaps are resolved in favour of the longer term. */
export function findTerms(text: string, terms: GlossaryTerm[], lang: Lang): TermHit[] {
  if (text === '' || terms.length === 0) return [];
  const folded = foldChars(text);
  const bySpan = new Map<string, TermHit>();
  for (const term of terms) {
    const matcher = getMatcher(termText(term, lang), lang);
    if (!matcher || !folded.includes(matcher.probe)) continue;
    matcher.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = matcher.regex.exec(folded)) !== null) {
      const start = match.index + match[1].length;
      const end = start + match[2].length;
      const key = `${start}:${end}`;
      const existing = bySpan.get(key);
      if (existing) {
        if (!existing.terms.includes(term)) existing.terms.push(term);
      } else {
        bySpan.set(key, { start, end, terms: [term] });
      }
      // Step back so the character after the term can be the "boundary" of the next match.
      matcher.regex.lastIndex = Math.max(end, match.index + 1);
    }
  }
  const candidates = [...bySpan.values()].sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const kept: TermHit[] = [];
  for (const hit of candidates) {
    if (!kept.some((other) => hit.start < other.end && other.start < hit.end)) kept.push(hit);
  }
  return kept.sort((a, b) => a.start - b.start);
}

/** True when `text` contains the term (same tolerant matching as `findTerms`). */
export function containsTerm(text: string, term: string, lang: Lang): boolean {
  const matcher = getMatcher(term, lang);
  if (!matcher) return false;
  const folded = foldChars(text);
  if (!folded.includes(matcher.probe)) return false;
  matcher.regex.lastIndex = 0;
  return matcher.regex.test(folded);
}
