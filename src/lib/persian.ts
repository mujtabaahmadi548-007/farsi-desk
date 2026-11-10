import type { DigitMode } from '../types';
import { FA_LETTERS, FA_MARKS, KASHIDA, ZWNJ } from './chars';

/**
 * Persian text normalizer.
 *
 * Every rule is deliberately conservative: when a change could be wrong for a real word,
 * the rule leaves the text alone. The UI always shows a diff before anything is applied.
 */

export interface NormalizeOptions {
  /** Arabic yeh / kaf (and PDF presentation forms) → Persian yeh / kaf */
  arabicLetters: boolean;
  /** How to unify digits */
  digits: DigitMode;
  /** Half-space (ZWNJ) fixes around می، نمی، ها، تر، ترین، ای … */
  zwnj: boolean;
  /** Also split verbs typed without any space: میروم → می‌روم (lexicon based) */
  joinedVerbs: boolean;
  /** Remove kashida (tatweel) inside words */
  kashida: boolean;
  /** Collapse double spaces, fix spaces around punctuation, trim */
  spaces: boolean;
}

export type ChangeKind = 'letters' | 'digits' | 'zwnj' | 'kashida' | 'spaces';

export interface NormalizeResult {
  text: string;
  /** Number of edits made by each group of rules. */
  changes: Record<ChangeKind, number>;
}

export const CHANGE_LABELS: Record<ChangeKind, string> = {
  letters: 'Arabic → Persian letters',
  digits: 'Digits',
  zwnj: 'Half-space (ZWNJ)',
  kashida: 'Kashida',
  spaces: 'Spaces',
};

export function defaultNormalizeOptions(digits: DigitMode): NormalizeOptions {
  return { arabicLetters: true, digits, zwnj: true, joinedVerbs: true, kashida: true, spaces: true };
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

const YE = '\u{06CC}'; // Persian yeh
const AR_YE = '\u{064A}'; // Arabic yeh
const AR_ALEF_MAKSURA = '\u{0649}';
const KAF = '\u{06A9}'; // Persian kaf (keheh)
const AR_KAF = '\u{0643}';

/** Either yeh — so ZWNJ rules also work when the letter fix is switched off. */
const ANY_YE = `[${YE}${AR_YE}]`;
/** Letters and their combining marks, for use inside a character class. */
const L = FA_LETTERS + FA_MARKS;
/** Start of a word: line start or anything that is not a Persian letter / ZWNJ. Captured as group 1. */
const WORD_START = `(^|[^${L}${ZWNJ}])`;
/** End of a word. */
const WORD_END = `(?![${L}])`;
/** What separates a word from its affix when the half-space is missing or doubled up. */
const SEP = `[ ${ZWNJ}]+`;

type Counted = [text: string, count: number];

/** String.replace that counts how many matches actually changed something. */
function replaceCounting(
  text: string,
  pattern: RegExp,
  replacer: (match: string, ...groups: string[]) => string,
): Counted {
  let count = 0;
  const out = text.replace(pattern, (match: string, ...rest: unknown[]) => {
    const groups = rest.filter((item): item is string => typeof item === 'string' || item === undefined) as string[];
    const replaced = replacer(match, ...groups);
    if (replaced !== match) count++;
    return replaced;
  });
  return [out, count];
}

function toPersianKaf(text: string): string {
  return text.replaceAll(AR_YE, YE).replaceAll(AR_ALEF_MAKSURA, YE).replaceAll(AR_KAF, KAF);
}

// ---------------------------------------------------------------------------
// 1. Letters
// ---------------------------------------------------------------------------

// Arabic presentation forms (what PDFs often contain instead of real letters)
const PRESENTATION_FORMS = /[\u{FB50}-\u{FDCF}\u{FE80}-\u{FEFC}]/gu;
const ARABIC_YEH_KAF = new RegExp(`[${AR_YE}${AR_ALEF_MAKSURA}${AR_KAF}]`, 'g');

function fixLetters(text: string): Counted {
  const [a, n1] = replaceCounting(text, PRESENTATION_FORMS, (ch) => ch.normalize('NFKC'));
  const [b, n2] = replaceCounting(a, ARABIC_YEH_KAF, (ch) => (ch === AR_KAF ? KAF : YE));
  return [b, n1 + n2];
}

// ---------------------------------------------------------------------------
// 2. Kashida
// ---------------------------------------------------------------------------

// Only inside or attached to words; a free-standing ـ used as a dash is left alone.
const KASHIDA_AFTER_LETTER = new RegExp(`([${L}])${KASHIDA}+`, 'g');
const KASHIDA_BEFORE_LETTER = new RegExp(`${KASHIDA}+(?=[${L}])`, 'g');

function removeKashida(text: string): Counted {
  const [a, n1] = replaceCounting(text, KASHIDA_AFTER_LETTER, (_m, letter) => letter);
  const [b, n2] = replaceCounting(a, KASHIDA_BEFORE_LETTER, () => '');
  return [b, n1 + n2];
}

// ---------------------------------------------------------------------------
// 3. Digits
// ---------------------------------------------------------------------------

const LATIN = /[A-Za-z]/;
const STRONG_LETTER = /\p{L}/u;

/**
 * True when a run of Latin digits belongs to Latin text and should stay Latin:
 * it is glued to Latin letters (COVID-19, MP3, example.org/2024) or the nearest letter
 * before it on the line is Latin (Windows 11, iPhone 15 Pro).
 */
function digitsBelongToLatin(text: string, offset: number, length: number): boolean {
  let start = offset;
  while (start > 0 && !/\s/.test(text[start - 1])) start--;
  let end = offset + length;
  while (end < text.length && !/\s/.test(text[end])) end++;
  if (LATIN.test(text.slice(start, end))) return true;

  for (let i = offset - 1; i >= 0 && text[i] !== '\n'; i--) {
    if (STRONG_LETTER.test(text[i])) return LATIN.test(text[i]);
  }
  for (let i = offset + length; i < text.length && text[i] !== '\n'; i++) {
    if (STRONG_LETTER.test(text[i])) return LATIN.test(text[i]);
  }
  return false;
}

function toPersianDigitChar(code: number): string {
  return String.fromCharCode(0x06f0 + code);
}

function fixDigits(text: string, mode: DigitMode): Counted {
  let count = 0;
  if (mode === 'latin') {
    let out = text.replace(/[\u{06F0}-\u{06F9}\u{0660}-\u{0669}]/gu, (ch) => {
      count++;
      const code = ch.charCodeAt(0);
      return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
    });
    // Persian decimal separator (U+066B) and thousands separator (U+066C) between digits
    out = out.replace(/(\d)\u{066B}(?=\d)/gu, '$1.').replace(/(\d)\u{066C}(?=\d)/gu, '$1,');
    return [out, count];
  }
  // Arabic-Indic digits are the Arabic shapes of ۴ ۵ ۶: always converted, like Arabic yeh and kaf.
  let out = text.replace(/[\u{0660}-\u{0669}]/gu, (ch) => {
    count++;
    return toPersianDigitChar(ch.charCodeAt(0) - 0x0660);
  });
  if (mode === 'persian') {
    const before = out;
    out = before.replace(/[0-9]+/g, (run: string, offset: number) => {
      if (digitsBelongToLatin(before, offset, run.length)) return run;
      count += run.length;
      return Array.from(run, (d) => toPersianDigitChar(Number(d))).join('');
    });
  }
  return [out, count];
}

// ---------------------------------------------------------------------------
// 4. Spaces
// ---------------------------------------------------------------------------

function fixSpaces(text: string): Counted {
  let total = 0;
  let out = text;
  const apply = (pattern: RegExp, replacer: (match: string, ...groups: string[]) => string) => {
    const [next, n] = replaceCounting(out, pattern, replacer);
    out = next;
    total += n;
  };
  // No-break space, en/em/thin spaces, narrow no-break space, ideographic space → ordinary space
  apply(/[\u{00A0}\u{2000}-\u{200A}\u{202F}\u{205F}\u{3000}]/gu, () => ' ');
  apply(/ {2,}/g, () => ' ');
  apply(/^[ \t]+|[ \t]+$/gm, () => '');
  // Space before punctuation that ends a phrase ("است ، اما" → "است، اما"); never before ".NET" or "..."
  apply(/ +([،؛؟.!:])(?=\s|$|[»"”)\]}])/gm, (_m, mark) => mark);
  // Space just inside brackets and guillemets
  apply(/([([{«]) +/g, (_m, open) => open);
  apply(/ +([)\]}»])/g, (_m, close) => close);
  // Missing space after Persian punctuation ("سلام،خوبی" → "سلام، خوبی")
  apply(new RegExp(`([،؛؟])(?=[${FA_LETTERS}])`, 'g'), (_m, mark) => `${mark} `);
  return [out, total];
}

// ---------------------------------------------------------------------------
// 5. Half-space (ZWNJ)
// ---------------------------------------------------------------------------

/** Words that may follow the noun «می» (wine) or otherwise show that «می» is not a verb prefix. */
const NOT_AFTER_MI = new Set(
  ['و', 'از', 'به', 'در', 'را', 'که', 'با', 'تا', 'هم', 'یا', 'بر', 'است', 'بود', 'نیست', 'این', 'آن', 'ناب'].map(
    toPersianKaf,
  ),
);

const PRESENT_STEMS = [
  'کن', 'شو', 'رو', 'گوی', 'آی', 'ده', 'دان', 'توان', 'خواه', 'گیر', 'بین', 'زن', 'خور', 'مان', 'نویس',
  'خوان', 'بر', 'آور', 'گذار', 'گذر', 'رس', 'فهم', 'ساز', 'کش', 'افت', 'پرس', 'بخش', 'خر', 'فروش', 'پذیر',
  'نشین', 'ایست', 'شناس', 'شنو', 'ترس', 'خند', 'پوش', 'ریز', 'بار', 'گرد', 'باش', 'یاب', 'دار', 'آموز',
  'فرست', 'پرداز', 'انداز', 'کوش', 'جوی', 'نمای', 'فرمای', 'بند', 'پز', 'چرخ', 'خواب', 'سوز', 'شکن', 'شمار',
  'لرز', 'نگر', 'ورز', 'بای', 'رسان', 'کشان', 'گذران', 'گردان', 'فهمان', 'پوشان', 'ترسان',
];

const PAST_STEMS = [
  'کرد', 'شد', 'رفت', 'گفت', 'آمد', 'داد', 'دانست', 'توانست', 'خواست', 'گرفت', 'دید', 'زد', 'خورد', 'ماند',
  'نوشت', 'خواند', 'برد', 'آورد', 'گذاشت', 'گذشت', 'رسید', 'فهمید', 'ساخت', 'کشید', 'کشت', 'افتاد', 'پرسید',
  'بخشید', 'خرید', 'فروخت', 'دوید', 'پذیرفت', 'نشست', 'ایستاد', 'شناخت', 'شنید', 'ترسید', 'خندید', 'پوشید',
  'ریخت', 'بارید', 'گشت', 'بود', 'یافت', 'داشت', 'آموخت', 'فرستاد', 'پرداخت', 'انداخت', 'کوشید', 'بست', 'پخت',
  'پرید', 'چرخید', 'خوابید', 'سوخت', 'شکست', 'شمرد', 'لرزید', 'نگریست', 'ورزید', 'نمود', 'فرمود', 'بایست',
  'مرد', 'نامید', 'کاشت', 'برید', 'چید', 'شست', 'زیست', 'خاست', 'گریست', 'جست', 'افزود', 'آزمود', 'پیوست',
  'رساند', 'کشاند', 'گذراند', 'گرداند', 'فهماند', 'پوشاند', 'ترساند',
];

const PERSON_ENDINGS = ['م', 'ی', 'د', 'یم', 'ید', 'ند'];

/**
 * Every verb form that can follow می / نمی, e.g. «روم», «کنند», «خواست», «دانستیم».
 * Present stems need a personal ending; past stems also stand alone (third person singular).
 */
const VERB_FORMS: Set<string> = (() => {
  const forms = new Set<string>();
  for (const stem of PRESENT_STEMS) {
    for (const ending of PERSON_ENDINGS) forms.add(toPersianKaf(stem + ending));
  }
  for (const stem of PAST_STEMS) {
    forms.add(toPersianKaf(stem));
    for (const ending of PERSON_ENDINGS) {
      if (ending !== 'د') forms.add(toPersianKaf(stem + ending));
    }
  }
  forms.add(toPersianKaf('توان')); // impersonal «می‌توان گفت»
  return forms;
})();

/** «میدانی» is "you know" but far more often the adjective "field-" (تحقیقات میدانی): never split it. */
const AMBIGUOUS_AFTER_MI = new Set([toPersianKaf('دانی')]);

const MI = `ن?م${ANY_YE}`;
const MI_SPACED = new RegExp(`${WORD_START}(${MI})${SEP}(?=([${FA_LETTERS}]{2,}))`, 'gm');
const MI_JOINED = new RegExp(`${WORD_START}(${MI})([${FA_LETTERS}]{2,})${WORD_END}`, 'gm');

// ها، های، هایی، هایم، هایت، هایش، هایمان، هایتان، هایشان
const HA_FORMS = `ها(?:${ANY_YE}(?:${ANY_YE}|مان|تان|شان|م|ت|ش)?)?`;
// تر، تری، ترین
const TAR_FORMS = `تر(?:${ANY_YE}ن|${ANY_YE})?`;
// The suffix sits in a lookahead so it is not consumed: in «مهم ترین ها» it can then be the word
// that the next suffix attaches to.
const SUFFIX_SPACED = new RegExp(`([${L}]+)${SEP}(?=(${HA_FORMS}|${TAR_FORMS})${WORD_END})`, 'g');
/** After these words a free-standing «تر» is the adjective "wet" («از تر و خشک»), not a comparative ending. */
const NOT_BEFORE_TAR = new Set(
  ['از', 'به', 'با', 'در', 'بر', 'تا', 'و', 'که', 'را', 'هم', 'یا', 'هر', 'یک', 'این', 'آن'].map(toPersianKaf),
);

/**
 * After a word ending in silent «ه» (خانه، نامه، رفته …): ای، ی، ام، ات، اش، ایم، اید، اند.
 * The word must have three letters or more and the letter before «ه» may not be ا / و,
 * which rules out «راه»، «ماه»، «کوه»، «گروه» where the ه is pronounced.
 */
const HEH_WORD = `[${FA_LETTERS}](?![اآو])[${FA_LETTERS}]ه`;
const HEH_SUFFIXES = `ا${ANY_YE}م|ا${ANY_YE}د|اند|ام|ات|اش|ا${ANY_YE}|${ANY_YE}`;
// Group 3 (inside a lookahead) is set when «کاش» follows: «… ای کاش» is the idiom "if only".
const HEH_SUFFIX_SPACED = new RegExp(
  `([${FA_LETTERS}]*${HEH_WORD})${SEP}(${HEH_SUFFIXES})${WORD_END}(?=( +کاش${WORD_END})?)`,
  'g',
);
/** After these words a following «ای» is the vocative particle or part of «ای کاش», not a suffix. */
const NOT_BEFORE_EY = new Set(
  ['که', 'اینکه', 'آنکه', 'چنانکه', 'بلکه', 'همه', 'البته', 'گرچه', 'اگرچه', 'آنچه', 'هرچه', 'چنانچه'].map(
    toPersianKaf,
  ),
);

const ZWNJ_RUN = new RegExp(`${ZWNJ}{2,}`, 'g');
const ZWNJ_BY_SPACE = new RegExp(`[ \\t]*${ZWNJ}[ \\t]+|[ \\t]+${ZWNJ}[ \\t]*`, 'g');
const ZWNJ_AFTER_NON_WORD = new RegExp(`(^|[^\\p{L}\\p{M}\\p{N}])${ZWNJ}+`, 'gmu');
const ZWNJ_BEFORE_NON_WORD = new RegExp(`${ZWNJ}+(?![\\p{L}\\p{M}\\p{N}])`, 'gu');
/** Letters that never connect to the next letter: a half-space after them changes nothing. */
const ZWNJ_AFTER_NON_JOINER = new RegExp(`([اآأإؤدذرزژوءة])${ZWNJ}`, 'g');

function fixZwnj(text: string, joinedVerbs: boolean): Counted {
  let total = 0;
  let out = text;
  const apply = (pattern: RegExp, replacer: (match: string, ...groups: string[]) => string) => {
    const [next, n] = replaceCounting(out, pattern, replacer);
    out = next;
    total += n;
  };

  // می روم → می‌روم ، نمی خواهم → نمی‌خواهم
  apply(MI_SPACED, (match, pre, mi, nextWord) => {
    const word = toPersianKaf(nextWord);
    if (NOT_AFTER_MI.has(word)) return match;
    if (/[دت]ن$/.test(word) && !word.endsWith('ند')) return match; // «می خوردن»: an infinitive, so «می» is the noun
    return `${pre}${mi}${ZWNJ}`;
  });

  // میروم → می‌روم (only for known verb forms)
  if (joinedVerbs) {
    apply(MI_JOINED, (match, pre, mi, rest) => {
      const form = toPersianKaf(rest);
      if (!VERB_FORMS.has(form)) return match;
      if (mi.length === 2 && AMBIGUOUS_AFTER_MI.has(form)) return match;
      return `${pre}${mi}${ZWNJ}${rest}`;
    });
  }

  // کتاب ها → کتاب‌ها ، بزرگ تر → بزرگ‌تر ، بزرگ ترین → بزرگ‌ترین
  apply(SUFFIX_SPACED, (match, word, suffix) => {
    if (suffix.startsWith('تر') && NOT_BEFORE_TAR.has(toPersianKaf(word))) return match;
    return `${word}${ZWNJ}`;
  });

  // خانه ای → خانه‌ای ، رفته ام → رفته‌ام ، خانه ی من → خانه‌ی من
  apply(HEH_SUFFIX_SPACED, (match, word, suffix, kash) => {
    const isEy = toPersianKaf(suffix) === `ا${YE}`;
    if (isEy && (kash !== undefined || NOT_BEFORE_EY.has(toPersianKaf(word)))) return match;
    return `${word}${ZWNJ}${suffix}`;
  });

  // Tidy up half-spaces that do nothing or are in the wrong place
  apply(ZWNJ_RUN, () => ZWNJ);
  apply(ZWNJ_BY_SPACE, () => ' ');
  apply(ZWNJ_AFTER_NON_WORD, (_m, pre) => pre);
  apply(ZWNJ_BEFORE_NON_WORD, () => '');
  apply(ZWNJ_AFTER_NON_JOINER, (_m, letter) => letter);

  return [out, total];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function normalizePersian(text: string, options: NormalizeOptions): NormalizeResult {
  const changes: Record<ChangeKind, number> = { letters: 0, digits: 0, zwnj: 0, kashida: 0, spaces: 0 };
  let out = text;
  if (options.arabicLetters) {
    [out, changes.letters] = fixLetters(out);
  }
  if (options.kashida) {
    [out, changes.kashida] = removeKashida(out);
  }
  [out, changes.digits] = fixDigits(out, options.digits);
  if (options.spaces) {
    [out, changes.spaces] = fixSpaces(out);
  }
  if (options.zwnj) {
    [out, changes.zwnj] = fixZwnj(out, options.joinedVerbs);
  }
  return { text: out, changes };
}

/** Convenience wrapper when only the text is needed. */
export function normalizeText(text: string, options: NormalizeOptions): string {
  return normalizePersian(text, options).text;
}
