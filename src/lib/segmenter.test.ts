import { describe, expect, it } from 'vitest';
import { SAMPLE_SEGMENTS, SAMPLE_SOURCE_TEXT } from '../sample';
import { segmentText, splitSentences } from './segmenter';

const ZWNJ = '\u{200C}';

describe('splitSentences — Persian', () => {
  it('splits at the full stop, the Persian question mark and the exclamation mark', () => {
    expect(splitSentences('سلام. حال شما چطور است؟ من خوبم!')).toEqual([
      'سلام.',
      'حال شما چطور است؟',
      'من خوبم!',
    ]);
  });

  it('keeps half-spaces (ZWNJ) inside words untouched', () => {
    const text = `او می${ZWNJ}رود. آن${ZWNJ}ها نمی${ZWNJ}آیند.`;
    const parts = splitSentences(text);
    expect(parts).toEqual([`او می${ZWNJ}رود.`, `آن${ZWNJ}ها نمی${ZWNJ}آیند.`]);
    expect(parts.join(' ')).toBe(text);
  });

  it('does not split at the Persian comma or semicolon in sentence mode', () => {
    expect(splitSentences('اول، دوم؛ و سوم.')).toEqual(['اول، دوم؛ و سوم.']);
  });

  it('splits after ؟ even when the space is missing', () => {
    expect(splitSentences('چطوری؟خوبم.')).toEqual(['چطوری؟', 'خوبم.']);
  });

  it('splits after a Persian full stop with a missing space, but not inside abbreviations', () => {
    expect(splitSentences('او رفت.سپس برگشت.')).toEqual(['او رفت.', 'سپس برگشت.']);
    expect(splitSentences('در سال ۱۳۵۷ ه.ش. انقلاب شد. سپس جنگ آغاز شد.')).toEqual([
      'در سال ۱۳۵۷ ه.ش. انقلاب شد.',
      'سپس جنگ آغاز شد.',
    ]);
  });

  it('keeps closing guillemets with the sentence they close', () => {
    expect(splitSentences(`او گفت: «فردا می${ZWNJ}آیم.» سپس رفت.`)).toEqual([
      `او گفت: «فردا می${ZWNJ}آیم.»`,
      'سپس رفت.',
    ]);
  });

  it('handles combined marks such as ؟! as one boundary', () => {
    expect(splitSentences('واقعاً؟! باورم نمی‌شود.')).toEqual(['واقعاً؟!', 'باورم نمی‌شود.']);
  });

  it('does not split at an ellipsis inside a Persian sentence', () => {
    expect(splitSentences('او رفت... و دیگر برنگشت.')).toEqual(['او رفت... و دیگر برنگشت.']);
  });

  it('does not split decimals, Persian or Latin', () => {
    expect(splitSentences('نرخ تورم ۳.۵ درصد بود. نرخ بیکاری 7.2 درصد است.')).toEqual([
      'نرخ تورم ۳.۵ درصد بود.',
      'نرخ بیکاری 7.2 درصد است.',
    ]);
  });

  it('keeps list numbers with their item', () => {
    expect(splitSentences('۱. مورد اول را بخوانید.')).toEqual(['۱. مورد اول را بخوانید.']);
    expect(splitSentences('1. First item. 2. Second item.')).toEqual(['1. First item.', '2. Second item.']);
  });

  it('still splits after a year at the end of a sentence', () => {
    expect(splitSentences('او در سال ۱۴۰۲ درگذشت. یادش گرامی.')).toEqual([
      'او در سال ۱۴۰۲ درگذشت.',
      'یادش گرامی.',
    ]);
    expect(splitSentences('این اتفاق در سال 1402. افتاد')).toEqual(['این اتفاق در سال 1402.', 'افتاد']);
  });
});

describe('splitSentences — mixed Persian and English', () => {
  it('handles English words, versions and product names inside Persian text', () => {
    const text = `این نرم${ZWNJ}افزار از API نسخهٔ 2.5 استفاده می${ZWNJ}کند. نام آن Farsi Desk است.`;
    expect(splitSentences(text)).toEqual([
      `این نرم${ZWNJ}افزار از API نسخهٔ 2.5 استفاده می${ZWNJ}کند.`,
      'نام آن Farsi Desk است.',
    ]);
  });

  it('does not split inside URLs', () => {
    expect(splitSentences('به وب‌سایت www.example.org مراجعه کنید. متشکرم.')).toEqual([
      'به وب‌سایت www.example.org مراجعه کنید.',
      'متشکرم.',
    ]);
    expect(splitSentences('نشانی https://example.org/?q=1 را باز کنید.')).toEqual([
      'نشانی https://example.org/?q=1 را باز کنید.',
    ]);
  });

  it('splits between an English sentence and a Persian one', () => {
    expect(splitSentences('He said hello. او جواب داد.')).toEqual(['He said hello.', 'او جواب داد.']);
  });
});

describe('splitSentences — English', () => {
  it('respects common abbreviations and initials', () => {
    expect(splitSentences('Dr. Smith arrived at 5 p.m. yesterday. He was late.')).toEqual([
      'Dr. Smith arrived at 5 p.m. yesterday.',
      'He was late.',
    ]);
    expect(splitSentences('J. K. Rowling wrote it. Everyone knows.')).toEqual([
      'J. K. Rowling wrote it.',
      'Everyone knows.',
    ]);
    expect(splitSentences('See No. 5 in the list. It is important.')).toEqual([
      'See No. 5 in the list.',
      'It is important.',
    ]);
  });

  it('keeps a quotation with its attribution', () => {
    expect(splitSentences('"Why?" she asked. "No reason."')).toEqual(['"Why?" she asked.', '"No reason."']);
  });

  it('splits at an ellipsis only before a capital letter', () => {
    expect(splitSentences('Well... maybe later. Fine.')).toEqual(['Well... maybe later.', 'Fine.']);
    expect(splitSentences('He stopped… Then he ran.')).toEqual(['He stopped…', 'Then he ran.']);
  });
});

describe('splitSentences — modes', () => {
  it('clause mode also splits at ، and ؛ but not inside numbers', () => {
    expect(splitSentences('اول، دوم؛ سوم.', 'clause')).toEqual(['اول،', 'دوم؛', 'سوم.']);
    expect(splitSentences('قیمت آن ۱،۰۰۰ تومان است، نه بیشتر.', 'clause')).toEqual([
      'قیمت آن ۱،۰۰۰ تومان است،',
      'نه بیشتر.',
    ]);
  });

  it('paragraph mode returns the paragraph unchanged', () => {
    expect(splitSentences('  سلام. خداحافظ.  ', 'paragraph')).toEqual(['سلام. خداحافظ.']);
    expect(splitSentences('   ', 'paragraph')).toEqual([]);
  });
});

describe('segmentText', () => {
  it('treats line breaks as paragraph boundaries and records blank lines as gaps', () => {
    const result = segmentText('خط اول. ادامهٔ خط اول.\nخط دوم\n\nخط سوم');
    expect(result).toEqual([
      { text: 'خط اول.', paragraph: 0 },
      { text: 'ادامهٔ خط اول.', paragraph: 0 },
      { text: 'خط دوم', paragraph: 1 },
      { text: 'خط سوم', paragraph: 3 },
    ]);
  });

  it('handles Windows line endings, a BOM and leading blank lines', () => {
    const result = segmentText('\u{FEFF}\r\n\r\nسلام.\r\nHello.\r\n');
    expect(result).toEqual([
      { text: 'سلام.', paragraph: 0 },
      { text: 'Hello.', paragraph: 1 },
    ]);
  });

  it('collapses several blank lines into one gap', () => {
    const result = segmentText('الف\n\n\n\nب');
    expect(result.map((s) => s.paragraph)).toEqual([0, 2]);
  });

  it('returns nothing for empty input', () => {
    expect(segmentText('')).toEqual([]);
    expect(segmentText(' \n\t\n')).toEqual([]);
  });

  it('splits the built-in sample exactly into the sample segments', () => {
    const result = segmentText(SAMPLE_SOURCE_TEXT);
    expect(result.map((s) => s.text)).toEqual(SAMPLE_SEGMENTS.map((s) => s.source));
    expect(result.map((s) => s.paragraph)).toEqual(SAMPLE_SEGMENTS.map((s) => s.paragraph));
  });
});
