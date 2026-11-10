import { describe, expect, it } from 'vitest';
import { SAMPLE_GLOSSARY, SAMPLE_SEGMENTS } from '../sample';
import type { GlossaryTerm, Segment } from '../types';
import { containsTerm, findTerms } from './glossary';
import {
  checkBrackets,
  checkSegment,
  compareNumbers,
  defaultScope,
  extractNumbers,
  runQA,
  type QACheck,
  type QAContext,
} from './qa';

const ZWNJ = '\u{200C}';
const z = (text: string) => text.replaceAll('~', ZWNJ);

let seq = 0;
function seg(source: string, target: string, extra: Partial<Segment> = {}): Segment {
  const order = seq++;
  return {
    id: `s${order}`,
    projectId: 'p',
    order,
    paragraph: order,
    source,
    target,
    status: target.trim() === '' ? 'empty' : 'confirmed',
    start: null,
    end: null,
    confirmedAt: null,
    updatedAt: 0,
    ...extra,
  };
}

function term(fa: string, en: string): GlossaryTerm {
  return { id: `${fa}|${en}`, fa, en, note: '', createdAt: 0 };
}

const TERMS: GlossaryTerm[] = SAMPLE_GLOSSARY.map((item) => term(item.fa, item.en));
const FA_EN: QAContext = { direction: 'fa-en', terms: TERMS, scope: 'translation' };
const EN_FA: QAContext = { direction: 'en-fa', terms: TERMS, scope: 'translation' };
const checksOf = (segment: Segment, context: QAContext = FA_EN): QACheck[] =>
  checkSegment(segment, context).map((issue) => issue.check);

describe('extractNumbers', () => {
  it('treats Persian, Arabic-Indic and Latin digits as the same value', () => {
    expect(extractNumbers('در سال ۱۴۰۲')).toEqual(['1402']);
    expect(extractNumbers('في عام ١٤٠٢')).toEqual(['1402']);
    expect(extractNumbers('in 1402')).toEqual(['1402']);
  });

  it('joins thousands groups written with any separator', () => {
    expect(extractNumbers('12,500 members')).toEqual(['12500']);
    expect(extractNumbers('۱۲٬۵۰۰ عضو')).toEqual(['12500']);
    expect(extractNumbers('۱۲،۵۰۰ عضو')).toEqual(['12500']);
    expect(extractNumbers('۱۲۵۰۰ عضو')).toEqual(['12500']);
    expect(extractNumbers('1,234,567')).toEqual(['1234567']);
  });

  it('does not join lists of numbers', () => {
    expect(extractNumbers('سال‌های 2019،2020')).toEqual(['2019', '2020']);
    expect(extractNumbers('1, 2, 3')).toEqual(['1', '2', '3']);
  });

  it('splits decimals the same way whatever the decimal mark', () => {
    expect(extractNumbers('3.5 percent')).toEqual(['3', '5']);
    expect(extractNumbers('۳٫۵ درصد')).toEqual(['3', '5']);
    expect(extractNumbers('۳/۵ درصد')).toEqual(['3', '5']);
  });

  it('finds digits glued to letters and ignores text without digits', () => {
    expect(extractNumbers('COVID-19 و MP3')).toEqual(['19', '3']);
    expect(extractNumbers('بدون عدد')).toEqual([]);
  });
});

describe('compareNumbers', () => {
  it('accepts the same numbers in different scripts and order', () => {
    expect(compareNumbers('از ساعت ۸ تا ۲۰ برای ۳۰۰ نفر', 'for 300 people, from 8 to 20')).toEqual({
      missing: [],
      extra: [],
    });
    expect(compareNumbers('۱۲٬۵۰۰ عضو در سال ۱۴۰۲', '12,500 members in 1402')).toEqual({ missing: [], extra: [] });
  });

  it('reports missing and extra numbers', () => {
    expect(compareNumbers('از ساعت ۸ تا ۲۰', 'from 8 to 22')).toEqual({ missing: ['20'], extra: ['22'] });
  });

  it('counts repeated numbers', () => {
    expect(compareNumbers('۵ کتاب و ۵ دفتر', '5 books and notebooks')).toEqual({ missing: ['5'], extra: [] });
  });
});

describe('checkBrackets', () => {
  it('accepts balanced brackets, guillemets and quotes in Persian and English', () => {
    expect(checkBrackets('او گفت: «سلام (دوست من) [۱]»')).toEqual([]);
    expect(checkBrackets('She said “hello” (twice) and "bye".')).toEqual([]);
  });

  it('finds unclosed and unopened brackets', () => {
    expect(checkBrackets('متن (ناتمام')).toEqual(['Opening “(” is never closed.']);
    expect(checkBrackets('متن ناتمام)')).toEqual(['Closing “)” has no matching “(”.']);
    expect(checkBrackets('«نقل قول')).toEqual(['Opening “«” is never closed.']);
    expect(checkBrackets('wrong (order] here')).toHaveLength(2);
  });

  it('finds unbalanced quotation marks', () => {
    expect(checkBrackets('with the “Libby app.')).toEqual(['Curly quotation marks “ ” are not balanced.']);
    expect(checkBrackets('an "open quote')).toEqual(['Odd number of straight quotation marks (").']);
  });

  it('does not complain about list markers, emoticons or apostrophes', () => {
    expect(checkBrackets('1) first item')).toEqual([]);
    expect(checkBrackets('الف) مورد اول ب) مورد دوم')).toEqual([]);
    expect(checkBrackets('خوبه :)')).toEqual([]);
    expect(checkBrackets("the city's library doesn't close")).toEqual([]);
  });
});

describe('glossary matching', () => {
  it('finds terms despite Arabic letters and a missing half-space', () => {
    const text = 'كاربران با نرم افزار «Libby» كتاب مي‌خوانند';
    const hits = findTerms(text, TERMS, 'fa');
    expect(hits.map((hit) => text.slice(hit.start, hit.end))).toEqual(['نرم افزار']);
    expect(hits[0].terms[0].en).toBe('software');
  });

  it('accepts joined, spaced and half-spaced spellings of one term', () => {
    for (const spelling of ['نرم افزار', z('نرم~افزار'), 'نرمافزار']) {
      expect(containsTerm(`این ${spelling} خوب است`, z('نرم~افزار'), 'fa'), spelling).toBe(true);
    }
  });

  it('accepts plural and indefinite endings but not other words', () => {
    expect(containsTerm('برای دانش آموزان رایگان است', z('دانش~آموز'), 'fa')).toBe(true);
    expect(containsTerm(z('کتابخانه~ها و کتابخانه~ای'), 'کتابخانه', 'fa')).toBe(true);
    expect(containsTerm('عضویت رایگان است', 'عضو', 'fa')).toBe(false);
    expect(containsTerm('کتابخانه بزرگ', 'کتاب', 'fa')).toBe(false);
    expect(containsTerm(z('نرم~افزار'), 'افزار', 'fa')).toBe(false);
  });

  it('matches English terms case-insensitively, as whole words, with plural -s', () => {
    expect(containsTerm('Central Library Notice', 'library', 'en')).toBe(true);
    expect(containsTerm('on their mobile phones', 'mobile phone', 'en')).toBe(true);
    expect(containsTerm('memberships are free', 'member', 'en')).toBe(false);
    expect(containsTerm('the librarian', 'library', 'en')).toBe(false);
  });

  it('prefers the longer term when two overlap and reports offsets in the original text', () => {
    const terms = [term('تلفن', 'phone'), term('تلفن همراه', 'mobile phone')];
    const text = 'روي تلفن همراه خود';
    const hits = findTerms(text, terms, 'fa');
    expect(hits).toHaveLength(1);
    expect(text.slice(hits[0].start, hits[0].end)).toBe('تلفن همراه');
  });

  it('groups entries that share a source term', () => {
    const terms = [term('عضو', 'member'), term('عضو', 'organ')];
    const hits = findTerms('هر عضو', terms, 'fa');
    expect(hits).toHaveLength(1);
    expect(hits[0].terms.map((t) => t.en)).toEqual(['member', 'organ']);
  });
});

describe('checkSegment — translation', () => {
  it('passes a correct, confirmed translation', () => {
    expect(checksOf(seg('کتابخانه در سال ۱۴۰۲ بیش از ۱۲٬۵۰۰ عضو پذیرفت.', 'The library accepted more than 12,500 members in 1402.'))).toEqual([]);
  });

  it('flags empty targets and stops there', () => {
    expect(checksOf(seg('سلام دنیا', ''))).toEqual(['empty']);
    expect(checksOf(seg('سلام دنیا', '   '))).toEqual(['empty']);
  });

  it('ignores segments that are empty on both sides', () => {
    expect(checksOf(seg('', ''))).toEqual([]);
  });

  it('flags number mismatches but not Persian vs Latin digits of the same value', () => {
    expect(checksOf(seg('از ساعت ۸ تا ۲۰ باز است.', 'Open from 8 to 20.'))).toEqual([]);
    const issues = checkSegment(seg('از ساعت ۸ تا ۲۰ باز است.', 'Open from 8 to 22.'), FA_EN);
    expect(issues.map((i) => i.check)).toEqual(['numbers']);
    expect(issues[0].message).toBe('Numbers differ — missing in target: 20; not in source: 22.');
  });

  it('flags unused glossary terms and accepts any listed translation', () => {
    const issues = checkSegment(seg('این نرم افزار رایگان است.', 'This app is free.'), FA_EN);
    expect(issues.map((i) => i.check)).toEqual(['glossary']);
    expect(issues[0].message).toContain('software');
    expect(checksOf(seg('این نرم افزار رایگان است.', 'This software is free.'))).toEqual([]);

    const twoMeanings: QAContext = { ...FA_EN, terms: [term('عضو', 'member'), term('عضو', 'organ')] };
    expect(checksOf(seg('این عضو مهم است.', 'This organ is important.'), twoMeanings)).toEqual([]);
    expect(checksOf(seg('این عضو مهم است.', 'This part is important.'), twoMeanings)).toEqual(['glossary']);
  });

  it('checks glossary terms in the EN→FA direction too, tolerating half-space variants', () => {
    expect(checksOf(seg('The software is free.', 'این نرم افزار رایگان است.'), EN_FA)).toEqual([]);
    expect(checksOf(seg('The software is free.', z('این نرم~افزارها رایگان است.')), EN_FA)).toEqual([]);
    expect(checksOf(seg('The software is free.', 'این برنامه رایگان است.'), EN_FA)).toEqual(['glossary']);
  });

  it('flags double spaces and leading/trailing spaces', () => {
    expect(checksOf(seg('سلام دنیا', 'Hello  world'))).toEqual(['spaces']);
    const issues = checkSegment(seg('سلام دنیا', ' Hello world'), FA_EN);
    expect(issues.map((i) => [i.check, i.severity])).toEqual([['spaces', 'info']]);
  });

  it('flags mismatched brackets and quotes in the target', () => {
    expect(checksOf(seg('سلام (دنیا)', 'Hello (world'))).toEqual(['brackets']);
    expect(checksOf(seg('او گفت «سلام»', 'He said “hello'))).toEqual(['brackets']);
  });

  it('notes a different number of bracket pairs than the source as information', () => {
    const issues = checkSegment(seg('سلام (دنیا)', 'Hello world'), FA_EN);
    expect(issues.map((i) => [i.check, i.severity])).toEqual([['brackets', 'info']]);
  });

  it('flags a source copied unchanged, but not names or numbers that stay the same', () => {
    expect(checksOf(seg('سلام دنیا', 'سلام دنیا'))).toEqual(['copied']);
    expect(checksOf(seg('2024', '2024'))).toEqual([]);
    expect(checksOf(seg('Libby', 'Libby'))).toEqual([]);
    expect(checksOf(seg('Hello world', 'Hello world'), EN_FA)).toEqual(['copied']);
  });

  it('lists unconfirmed translations as information', () => {
    const issues = checkSegment(seg('سلام', 'Hello', { status: 'draft' }), FA_EN);
    expect(issues.map((i) => [i.check, i.severity])).toEqual([['unconfirmed', 'info']]);
  });
});

describe('checkSegment — transcript scope and timing', () => {
  const transcript: QAContext = { direction: 'fa-en', terms: TERMS, scope: 'transcript' };

  it('checks only the source text', () => {
    expect(checksOf(seg('سلام دنیا', ''), transcript)).toEqual([]);
    expect(checksOf(seg('', ''), transcript)).toEqual(['empty']);
    expect(checksOf(seg('سلام  دنیا (ناتمام', ''), transcript)).toEqual(['spaces', 'brackets']);
  });

  it('flags impossible and overlapping timestamps', () => {
    const first = seg('یک', '', { start: 0, end: 5 });
    const second = seg('دو', '', { start: 4, end: 4 });
    const issues = runQA([first, second], transcript);
    expect(issues.map((i) => i.check)).toEqual(['timing', 'timing']);
    expect(issues.every((i) => i.segmentId === second.id)).toBe(true);
  });

  it('chooses the transcript scope for timed segments without any translation', () => {
    expect(defaultScope([seg('یک', '', { start: 0, end: 1 })])).toBe('transcript');
    expect(defaultScope([seg('یک', 'one', { start: 0, end: 1 })])).toBe('translation');
    expect(defaultScope([seg('یک', '')])).toBe('translation');
  });
});

describe('runQA on the built-in sample', () => {
  const segments = SAMPLE_SEGMENTS.map((item, index) =>
    seg(item.source, item.target, { status: item.status, order: index, id: `sample${index}` }),
  );
  const issues = runQA(segments, FA_EN);
  const at = (index: number) => issues.filter((i) => i.segmentId === `sample${index}`).map((i) => i.check);

  it('finds every deliberate mistake, and nothing in the two good segments', () => {
    expect(at(0)).toEqual([]);
    expect(at(1)).toEqual([]);
    expect(at(2)).toEqual(['numbers', 'unconfirmed']);
    expect(at(3)).toEqual(['empty']);
    expect(at(4)).toEqual(['glossary', 'brackets', 'unconfirmed']);
    expect(at(5)).toEqual(['empty']);
    expect(at(6)).toEqual(['spaces', 'unconfirmed']);
    expect(at(7)).toEqual(['copied', 'glossary', 'unconfirmed']);
  });

  it('returns issues in document order', () => {
    const orders = issues.map((i) => i.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });
});
