import { describe, expect, it } from 'vitest';
import { SAMPLE_SEGMENTS, SAMPLE_TM } from '../sample';
import { foldChars } from './chars';
import { diffWords } from './diff';
import {
  charDistance,
  findMatches,
  matchTokens,
  normalizeForMatch,
  prepareCandidates,
  similarity,
  tokenSimilarity,
} from './fuzzy';

const ZWNJ = '\u{200C}';
const AR_YE = '\u{064A}';
const AR_KAF = '\u{0643}';
const z = (text: string) => text.replaceAll('~', ZWNJ);

describe('normalizeForMatch', () => {
  it('unifies Arabic and Persian letters, digit scripts, case and the half-space', () => {
    expect(normalizeForMatch(`${AR_KAF}تاب عرب${AR_YE} در سال ۱۴۰۲`)).toBe('کتاب عربی در سال 1402');
    expect(normalizeForMatch(z('می~روم  به   Farsi DESK'))).toBe('می روم به farsi desk');
  });

  it('drops diacritics and kashida', () => {
    expect(normalizeForMatch('کِتابِ مُـــقَدَّس')).toBe('کتاب مقدس');
  });

  it('tokenizes into words and punctuation marks', () => {
    expect(matchTokens(normalizeForMatch('سلام، دنیا! (v2.0)'))).toEqual(['سلام', '،', 'دنیا', '!', '(', 'v2', '.', '0', ')']);
  });
});

describe('charDistance', () => {
  it('is the Levenshtein distance', () => {
    expect(charDistance('کتاب', 'کتاب')).toBe(0);
    expect(charDistance('کتاب', 'کباب')).toBe(1);
    expect(charDistance('', 'سلام')).toBe(4);
    expect(charDistance('kitten', 'sitting')).toBe(3);
  });
});

describe('similarity', () => {
  it('is 100 for identical text and 99 when only ignorable details differ', () => {
    expect(similarity('او به خانه می‌رود.', 'او به خانه می‌رود.')).toBe(100);
    expect(similarity(z('او به خانه می~رود.'), 'او به خانه می رود.')).toBe(99);
    expect(similarity(`${AR_KAF}تاب در سال ۲۰۲۴`, 'کتاب در سال 2024')).toBe(99);
    expect(similarity('Hello World', 'hello world')).toBe(99);
  });

  it('never reports 100 for texts that really differ', () => {
    const long = 'یک دو سه چهار پنج شش هفت هشت نه ده یازده دوازده سیزده چهارده پانزده شانزده هفده هجده نوزده بیست';
    const punctuationOnly = similarity(long + ' بیست‌ویک.', long + ' بیست‌ویک!');
    expect(punctuationOnly).toBeGreaterThanOrEqual(95);
    expect(punctuationOnly).toBeLessThan(100);
    expect(similarity(long, long + ' و')).toBeLessThan(100);
  });

  it('scores one changed word out of five at 80%', () => {
    expect(similarity('او به خانه بزرگ رفت', 'او به خانه کوچک رفت')).toBe(80);
  });

  it('gives partial credit to a word that only changed its ending', () => {
    const inflected = similarity(z('آنها به خانه می~روند'), z('آنها به خانه می~رود'));
    const replaced = similarity(z('آنها به خانه می~روند'), z('آنها به خانه می~خورد'));
    expect(inflected).toBeGreaterThan(replaced);
    expect(inflected).toBeGreaterThanOrEqual(90);
  });

  it('treats punctuation differences as minor', () => {
    expect(similarity('سلام دنیا، خوش آمدید', 'سلام دنیا خوش آمدید')).toBeGreaterThanOrEqual(93);
  });

  it('is symmetric', () => {
    const a = 'این کتابخانه هر روز از ساعت ۸ تا ۲۰ باز است.';
    const b = 'این کتابخانه هر روز از ساعت ۹ تا ۱۷ باز است و تعطیل نیست.';
    expect(similarity(a, b)).toBe(similarity(b, a));
  });

  it('is low for unrelated sentences and 0 against empty text', () => {
    expect(similarity('او به خانه رفت.', 'قیمت نفت امروز افزایش یافت.')).toBeLessThan(30);
    expect(similarity('', 'سلام')).toBe(0);
    expect(similarity('', '')).toBe(100);
  });

  it('works for English and mixed text', () => {
    // 6 words + a full stop (weight 0.25); one word replaced: 1 − 1/6.25 = 84%
    expect(similarity('The library is open every day.', 'The library is closed every day.')).toBe(84);
    expect(similarity('نسخه 2.5 از Farsi Desk منتشر شد', 'نسخه 3.0 از Farsi Desk منتشر شد')).toBeGreaterThanOrEqual(70);
  });

  it('tokenSimilarity handles empty lists', () => {
    expect(tokenSimilarity([], [])).toBe(1);
    expect(tokenSimilarity(['سلام'], [])).toBe(0);
  });
});

describe('findMatches', () => {
  const memory = prepareCandidates(SAMPLE_TM.map((entry, index) => ({ item: index, source: entry.fa, target: entry.en })));

  it('finds the fuzzy match for the sample sentence despite Arabic letters, a joined verb and another number', () => {
    const query = SAMPLE_SEGMENTS[5].source; // «هر عضو ميتواند تا 5 كتاب امانت بگيرد.»
    const matches = findMatches(query, memory);
    expect(matches[0].target).toBe('Each member can borrow up to 3 books.');
    expect(matches[0].score).toBeGreaterThanOrEqual(70);
    expect(matches[0].score).toBeLessThan(99);
  });

  it('returns an exact match as 100 and a normalization-only match as 99', () => {
    expect(findMatches(SAMPLE_TM[2].fa, memory)[0].score).toBe(100);
    expect(findMatches('عضویت برای دانش آموزان رایگان است.', memory)[0].score).toBe(99);
  });

  it('sorts by score, respects the threshold and the limit', () => {
    const candidates = prepareCandidates([
      { item: 'a', source: 'او به خانه بزرگ رفت', target: 'A' },
      { item: 'b', source: 'او به خانه کوچک رفت', target: 'B' },
      { item: 'c', source: 'او به مدرسه کوچک آمد', target: 'C' },
      { item: 'd', source: 'هوا امروز خوب است', target: 'D' },
    ]);
    const matches = findMatches('او به خانه بزرگ رفت', candidates);
    expect(matches.map((m) => m.item)).toEqual(['a', 'b']);
    expect(matches.map((m) => m.score)).toEqual([100, 80]);
    expect(findMatches('او به خانه بزرگ رفت', candidates, { minScore: 30 }).map((m) => m.item)).toEqual(['a', 'b', 'c']);
    expect(findMatches('او به خانه بزرگ رفت', candidates, { limit: 1 })).toHaveLength(1);
  });

  it('shows a pair stored twice only once and skips entries without a translation', () => {
    const candidates = prepareCandidates([
      { item: 1, source: 'سلام دنیا', target: 'Hello world' },
      { item: 2, source: 'سلام دنیا', target: 'Hello world' },
      { item: 3, source: 'سلام دنیا', target: 'Hi, world' },
      { item: 4, source: 'سلام دنیا', target: '   ' },
    ]);
    expect(findMatches('سلام دنیا', candidates).map((m) => m.item)).toEqual([1, 3]);
  });

  it('returns nothing for an empty query or an empty memory', () => {
    expect(findMatches('   ', memory)).toEqual([]);
    expect(findMatches('سلام', [])).toEqual([]);
  });

  it('stays fast on a large memory', () => {
    const words = ['کتاب', 'خانه', 'مدرسه', 'شهر', 'کشور', 'دانشگاه', 'استاد', 'دانشجو', 'ترجمه', 'متن', 'زبان', 'فارسی'];
    const entries = Array.from({ length: 5000 }, (_, i) => ({
      item: i,
      source: Array.from({ length: 12 }, (_, j) => words[(i * 7 + j * 5 + ((i >> 3) % 11)) % words.length]).join(' ') + ` ${i}.`,
      target: `t${i}`,
    }));
    // One entry that really is close to the query, hidden in the middle.
    entries[2500] = { item: 2500, source: 'کتاب خانه مدرسه شهر کشور دانشگاه استاد دانشجو ترجمه متن زبان عربی 42.', target: 'needle' };
    const big = prepareCandidates(entries);
    const started = performance.now();
    const matches = findMatches('کتاب خانه مدرسه شهر کشور دانشگاه استاد دانشجو ترجمه متن زبان فارسی 42.', big);
    const elapsed = performance.now() - started;
    expect(matches[0].target).toBe('needle');
    expect(matches[0].score).toBeGreaterThanOrEqual(90);
    expect(elapsed).toBeLessThan(1500);
  });
});

describe('diff between a TM source and the current source', () => {
  it('highlights exactly the words that differ', () => {
    const parts = diffWords('هر عضو می‌تواند تا ۳ کتاب امانت بگیرد.', 'هر عضو می‌تواند تا ۵ کتاب امانت بگیرد.');
    expect(parts.filter((p) => p.type === 'del').map((p) => p.text)).toEqual(['۳']);
    expect(parts.filter((p) => p.type === 'ins').map((p) => p.text)).toEqual(['۵']);
  });

  it('with a folding key, ignores ي/ی, ك/ک and digit-script differences', () => {
    const memory = 'هر عضو می‌تواند تا ۳ کتاب امانت بگیرد.';
    const current = SAMPLE_SEGMENTS[5].source; // Arabic yeh/kaf, joined verb, Latin digit 5
    const parts = diffWords(memory, current, foldChars);
    expect(parts.filter((p) => p.type === 'del').map((p) => p.text)).toEqual(['می‌تواند', '۳']);
    expect(parts.filter((p) => p.type === 'ins').map((p) => p.text)).toEqual([`م${AR_YE}تواند`, '5']);
    // Unchanged words are shown as they are written in the memory.
    expect(parts.filter((p) => p.type !== 'ins').map((p) => p.text).join('')).toBe(memory);
  });
});
