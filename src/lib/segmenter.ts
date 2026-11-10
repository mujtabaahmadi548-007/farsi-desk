import { FA_LETTERS } from './chars';

/**
 * How text is cut into segments:
 * - `sentence`  : at sentence ends (. ! ? ؟ …) and at line breaks — the default for translation
 * - `clause`    : like `sentence`, and additionally after the Persian comma ، and semicolon ؛
 * - `paragraph` : at line breaks only
 */
export type SplitMode = 'sentence' | 'clause' | 'paragraph';

export interface RawSegment {
  text: string;
  /** Paragraph number. A gap of 2 between consecutive segments means a blank line in the original. */
  paragraph: number;
}

const TERMINATORS = '.!?؟…۔';
const CLOSERS = '»"”’\')]}›';
const OPENERS_RE = /^[«"“‘'([{‹]+/;

/** English abbreviations that end with a full stop but (almost) never end a sentence. */
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'vol', 'fig', 'figs', 'inc', 'ltd', 'corp',
  'dept', 'approx', 'gen', 'col', 'capt', 'lt', 'sgt', 'rev', 'hon', 'mt', 'eds', 'pp', 'cf', 'jan', 'feb',
  'apr', 'aug', 'sept', 'oct', 'nov', 'dec', 'tel', 'ext',
]);

const FA_LETTER_RE = new RegExp(`[${FA_LETTERS}]`);
const FA_LETTER_RE_G = new RegExp(`[${FA_LETTERS}]`, 'g');
// Latin, Persian (U+06F0–06F9) and Arabic-Indic (U+0660–0669) digits
const DIGIT_RE = /[0-9\u{06F0}-\u{06F9}\u{0660}-\u{0669}]/u;
const DIGITS_ONLY_RE = /^[0-9\u{06F0}-\u{06F9}\u{0660}-\u{0669}]+$/u;

function isFa(ch: string | undefined): boolean {
  return ch !== undefined && FA_LETTER_RE.test(ch);
}

function isSpace(ch: string | undefined): boolean {
  return ch !== undefined && /\s/.test(ch);
}

/**
 * Decides whether the terminator run `run` (starting at `i`, with closing quotes/brackets consumed up to `k`)
 * ends a sentence. `segStart` is where the current segment began.
 */
function isBoundary(s: string, i: number, run: string, k: number, segStart: number): boolean {
  if (k >= s.length) return true;
  const next = s[k];
  const nextIsSpace = isSpace(next);
  let n = k;
  while (n < s.length && isSpace(s[n])) n++;
  if (n >= s.length) return true;
  const after = s[n];

  // The Persian question mark and the Urdu full stop are never anything but sentence ends.
  if (run.includes('؟') || run.includes('۔')) return true;

  const hasBangOrQuestion = /[!?]/.test(run);
  const isEllipsis = run.includes('…') || /\.{2,}/.test(run);

  if (isEllipsis && !hasBangOrQuestion) {
    // "او رفت... و برنگشت" continues; only an upper-case Latin letter clearly starts a new sentence.
    return nextIsSpace && /\p{Lu}/u.test(after);
  }

  if (hasBangOrQuestion) {
    if (nextIsSpace) return !/\p{Ll}/u.test(after);
    // No space after: split for Persian ("سلام!خوبی") but not inside URLs such as /?q=1
    return isFa(next) || next === '«';
  }

  // ---- a single full stop ----
  let tokStart = i;
  while (tokStart > 0 && !isSpace(s[tokStart - 1])) tokStart--;
  const rawToken = s.slice(tokStart, i);
  const token = rawToken.replace(OPENERS_RE, '');

  if (!nextIsSpace) {
    // Missing space after a Persian full stop: "او رفت.سپس برگشت" — but not "ه.ش" or "example.com"
    const faCount = (token.match(FA_LETTER_RE_G) ?? []).length;
    return isFa(next) && isFa(s[i - 1]) && faCount >= 2 && !token.includes('.');
  }

  if (/\p{Ll}/u.test(after)) return false; // "approx. five", "etc. and so on"
  if (token === '') return true;

  // List numbering at the start of a paragraph or of a segment: "1. First", "۲. دوم"
  if (DIGITS_ONLY_RE.test(token)) {
    const leading = s.slice(Math.min(segStart, tokStart), tokStart).trim();
    if (leading === '') return false;
  }
  // Initials and one-letter abbreviations: "J. K. Rowling", "ص. ۲۳"
  if (/^\p{L}$/u.test(token)) return false;
  // Dotted abbreviations: "ه.ش.", "ق.م.", "U.S.", "e.g.", "a.m."
  if (/^(\p{L}{1,2}\.)+\p{L}{1,2}$/u.test(token)) return false;

  const lower = token.toLowerCase();
  if (ABBREVIATIONS.has(lower)) return false;
  if ((lower === 'no' || lower === 'nos') && DIGIT_RE.test(after)) return false; // "No. 5"

  return true;
}

/** Splits one paragraph (no line breaks) into sentences. Pieces are trimmed; nothing else is changed. */
export function splitSentences(text: string, mode: SplitMode = 'sentence'): string[] {
  const s = text;
  if (mode === 'paragraph') {
    const whole = s.trim();
    return whole === '' ? [] : [whole];
  }
  const out: string[] = [];
  let start = 0;
  let i = 0;
  const push = (end: number) => {
    const piece = s.slice(start, end).trim();
    if (piece !== '') out.push(piece);
    start = end;
  };
  while (i < s.length) {
    const ch = s[i];
    if (TERMINATORS.includes(ch)) {
      let j = i + 1;
      while (j < s.length && TERMINATORS.includes(s[j])) j++;
      const run = s.slice(i, j);
      let k = j;
      while (k < s.length && CLOSERS.includes(s[k])) k++;
      if (isBoundary(s, i, run, k, start)) push(k);
      i = k;
      continue;
    }
    if (mode === 'clause' && (ch === '،' || ch === '؛' || ch === ';')) {
      // "۱،۰۰۰" uses the Persian comma as a thousands separator — not a clause break.
      const betweenDigits = DIGIT_RE.test(s[i - 1] ?? '') && DIGIT_RE.test(s[i + 1] ?? '');
      if (!betweenDigits) {
        let k = i + 1;
        while (k < s.length && CLOSERS.includes(s[k])) k++;
        push(k);
        i = k;
        continue;
      }
    }
    i++;
  }
  push(s.length);
  return out;
}

/** Splits a whole text: every line is a paragraph, and paragraphs are split according to `mode`. */
export function segmentText(text: string, mode: SplitMode = 'sentence'): RawSegment[] {
  // BOM, Windows/Mac line ends, and the Unicode LINE / PARAGRAPH SEPARATOR characters
  const lines = text
    .replace(/^\u{FEFF}/u, '')
    .replace(/\r\n?|[\u{2028}\u{2029}]/gu, '\n')
    .split('\n');
  const out: RawSegment[] = [];
  let paragraph = 0;
  let pendingBlank = false;
  let seenText = false;
  for (const line of lines) {
    if (line.trim() === '') {
      if (seenText) pendingBlank = true;
      continue;
    }
    if (seenText) paragraph += pendingBlank ? 2 : 1;
    pendingBlank = false;
    seenText = true;
    for (const piece of splitSentences(line, mode)) out.push({ text: piece, paragraph });
  }
  return out;
}
