/**
 * Shared character classes and helpers for Persian / mixed-script text.
 *
 * Invisible and right-to-left characters are always written as \u{…} escapes in this code base,
 * never as raw characters, so the source stays readable in any editor.
 */

/** ZERO WIDTH NON-JOINER — the Persian "half-space" (نیم‌فاصله). */
export const ZWNJ = '\u{200C}';
/** ARABIC TATWEEL — the kashida used to stretch words. */
export const KASHIDA = '\u{0640}';

/** Arabic-script letters used in Persian — for use INSIDE a regex character class. */
export const FA_LETTERS =
  '\u{0621}-\u{063A}\u{0641}-\u{064A}\u{067E}\u{0686}\u{0698}\u{06A9}\u{06AF}\u{06C0}\u{06CC}';
/** Arabic combining marks (fatha, kasra, tashdid, hamza above, …) — for use inside a character class. */
export const FA_MARKS = '\u{064B}-\u{0652}\u{0654}\u{0655}\u{0670}';

const ARABIC_LETTER = /[\u{0621}-\u{064A}\u{066E}-\u{06D3}\u{06D5}\u{FB50}-\u{FDFF}\u{FE70}-\u{FEFC}]/u;
const HEBREW_LETTER = /[\u{0590}-\u{05FF}]/u;
const LATIN_LETTER = /[A-Za-z\u{00C0}-\u{024F}]/u;

export function hasPersian(text: string): boolean {
  return ARABIC_LETTER.test(text);
}

export function hasLatin(text: string): boolean {
  return LATIN_LETTER.test(text);
}

/** Direction of the first strong character; `fallback` when the text has none. */
export function detectDir(text: string, fallback: 'rtl' | 'ltr' = 'ltr'): 'rtl' | 'ltr' {
  for (const ch of text) {
    if (ARABIC_LETTER.test(ch) || HEBREW_LETTER.test(ch)) return 'rtl';
    if (/\p{L}/u.test(ch)) return 'ltr';
  }
  return fallback;
}

/** Persian (U+06F0–06F9) and Arabic-Indic (U+0660–0669) digits → Latin digits. Length-preserving. */
export function toLatinDigits(text: string): string {
  return text
    .replace(/[\u{06F0}-\u{06F9}]/gu, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u{0660}-\u{0669}]/gu, (d) => String(d.charCodeAt(0) - 0x0660));
}

/**
 * Length-preserving fold used for matching: Arabic yeh / alef maksura / kaf → Persian yeh / kaf,
 * all digits → Latin, Latin letters → lower case. Because every character maps
 * to exactly one character, match offsets are valid in the original string.
 */
export function foldChars(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x064a || code === 0x0649) out += '\u{06CC}';
    else if (code === 0x0643) out += '\u{06A9}';
    else if (code >= 0x06f0 && code <= 0x06f9) out += String(code - 0x06f0);
    else if (code >= 0x0660 && code <= 0x0669) out += String(code - 0x0660);
    else if (code >= 0x41 && code <= 0x5a) out += String.fromCharCode(code + 32);
    else if (code >= 0xc0 && code <= 0x24f) {
      const lower = text[i].toLowerCase();
      out += lower.length === 1 ? lower : text[i];
    } else out += text[i];
  }
  return out;
}

// ZWNJ, kashida, Arabic marks, ZWJ, LRM, RLM
const SEARCH_STRIP = new RegExp(`[${ZWNJ}${KASHIDA}${FA_MARKS}\u{200D}\u{200E}\u{200F}]`, 'g');

/**
 * Aggressive fold for search boxes: on top of `foldChars`, drops ZWNJ, kashida,
 * diacritics and directional marks, and collapses whitespace. NOT length-preserving.
 */
export function foldForSearch(text: string): string {
  return foldChars(text).replace(SEARCH_STRIP, '').replace(/\s+/g, ' ').trim();
}

/** Word count the way word processors do it: whitespace-separated tokens (ZWNJ does not split a word). */
export function countWords(text: string): number {
  let count = 0;
  for (const token of text.split(/\s+/)) {
    if (/[\p{L}\p{N}]/u.test(token)) count++;
  }
  return count;
}
