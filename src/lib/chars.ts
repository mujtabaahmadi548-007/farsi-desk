/** Shared character classes and helpers for Persian / mixed-script text. */

export const ZWNJ = '‌';
export const KASHIDA = 'ـ';

/** Arabic-script letters used in Persian — for use INSIDE a regex character class. */
export const FA_LETTERS = 'ء-غف-يپچژکگۀی';
/** Arabic combining marks (fatha, kasra, tashdid, hamza above, …) — for use inside a character class. */
export const FA_MARKS = 'ً-ْٰٕٔ';

const ARABIC_SCRIPT = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-ﻼ]/;
const ARABIC_LETTER = /[ء-يٮ-ۓەﭐ-﷿ﹰ-ﻼ]/;
const LATIN_LETTER = /[A-Za-zÀ-ɏ]/;

export function hasPersian(text: string): boolean {
  return ARABIC_LETTER.test(text);
}

export function hasLatin(text: string): boolean {
  return LATIN_LETTER.test(text);
}

export function isArabicScriptChar(ch: string): boolean {
  return ARABIC_SCRIPT.test(ch);
}

/** Direction of the first strong character; `fallback` when the text has none. */
export function detectDir(text: string, fallback: 'rtl' | 'ltr' = 'ltr'): 'rtl' | 'ltr' {
  for (const ch of text) {
    if (ARABIC_LETTER.test(ch) || /[֐-׿]/.test(ch)) return 'rtl';
    if (/\p{L}/u.test(ch)) return 'ltr';
  }
  return fallback;
}

/** Persian (۰-۹) and Arabic-Indic (٠-٩) digits → Latin digits. Length-preserving. */
export function toLatinDigits(text: string): string {
  return text
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

/**
 * Length-preserving fold used for matching: Arabic ي/ى/ك → Persian ی/ک,
 * all digits → Latin, Latin letters → lower case. Because every character maps
 * to exactly one character, match offsets are valid in the original string.
 */
export function foldChars(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x064a || code === 0x0649) out += 'ی';
    else if (code === 0x0643) out += 'ک';
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

const SEARCH_STRIP = new RegExp(`[${ZWNJ}${KASHIDA}${FA_MARKS}‍‎‏]`, 'g');

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

export function countChars(text: string): number {
  return text.replace(/\s/g, '').length;
}
