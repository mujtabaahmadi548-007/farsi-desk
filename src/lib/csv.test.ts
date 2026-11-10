import { describe, expect, it } from 'vitest';
import { SAMPLE_GLOSSARY } from '../sample';
import { detectDelimiter, glossaryToCsv, parseCsv, parseGlossaryCsv, toCsv } from './csv';

const ZWNJ = '\u{200C}';
const BOM = '\u{FEFF}';

describe('parseCsv', () => {
  it('parses simple rows and trims unquoted cells', () => {
    expect(parseCsv('a, b ,c\n1,2,3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('handles quotes, doubled quotes, commas and line breaks inside quotes', () => {
    const csv = 'term,"note with, comma","say ""hi"""\r\n"multi\nline",x,y\r\n';
    expect(parseCsv(csv)).toEqual([
      ['term', 'note with, comma', 'say "hi"'],
      ['multi\nline', 'x', 'y'],
    ]);
  });

  it('keeps spaces inside quoted cells and empty cells in the middle', () => {
    expect(parseCsv('" padded ",,z')).toEqual([[' padded ', '', 'z']]);
  });

  it('skips blank lines and ignores a BOM', () => {
    expect(parseCsv(`${BOM}a,b\n\n\nc,d`)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('detects semicolon and tab delimiters', () => {
    expect(detectDelimiter('fa;en;note\n')).toBe(';');
    expect(detectDelimiter('fa\ten\tnote\n')).toBe('\t');
    expect(detectDelimiter('"a;b",c\n')).toBe(',');
    expect(parseCsv('کتاب;book\nخانه;house')).toEqual([
      ['کتاب', 'book'],
      ['خانه', 'house'],
    ]);
  });

  it('returns nothing for empty input', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('\n\n')).toEqual([]);
  });
});

describe('toCsv', () => {
  it('quotes only what needs quoting and round-trips', () => {
    const rows = [
      ['نرم‌افزار', 'software', 'plain'],
      ['a, b', 'say "x"', 'two\nlines'],
    ];
    const csv = toCsv(rows);
    expect(csv).toBe('نرم‌افزار,software,plain\r\n"a, b","say ""x""","two\nlines"\r\n');
    expect(parseCsv(csv)).toEqual(rows);
  });
});

describe('glossary CSV', () => {
  it('round-trips the sample glossary, half-spaces included', () => {
    const csv = glossaryToCsv(SAMPLE_GLOSSARY);
    expect(csv.startsWith(BOM + 'fa,en,note\r\n')).toBe(true);
    const result = parseGlossaryCsv(csv);
    expect(result.skipped).toBe(0);
    expect(result.terms).toEqual(SAMPLE_GLOSSARY);
    expect(result.terms.find((t) => t.en === 'software')?.fa).toBe(`نرم${ZWNJ}افزار`);
  });

  it('accepts header names in any order and language', () => {
    const result = parseGlossaryCsv('English,Note,Persian\nbook,noun,کتاب\n');
    expect(result.terms).toEqual([{ fa: 'کتاب', en: 'book', note: 'noun' }]);
    expect(parseGlossaryCsv('فارسی,انگلیسی\nکتاب,book').terms).toEqual([{ fa: 'کتاب', en: 'book', note: '' }]);
  });

  it('without a header, works out which column is Persian row by row', () => {
    const result = parseGlossaryCsv('book,کتاب,noun\nخانه,house\n');
    expect(result.terms).toEqual([
      { fa: 'کتاب', en: 'book', note: 'noun' },
      { fa: 'خانه', en: 'house', note: '' },
    ]);
  });

  it('reads Excel-style semicolon files with mixed English inside Persian terms', () => {
    const result = parseGlossaryCsv('fa;en;note\nحافظهٔ ترجمه (TM);translation memory;"CAT; tools"\n');
    expect(result.terms).toEqual([{ fa: 'حافظهٔ ترجمه (TM)', en: 'translation memory', note: 'CAT; tools' }]);
  });

  it('skips incomplete rows and counts them', () => {
    const result = parseGlossaryCsv('fa,en\nکتاب,\n,house\nخانه,house\n');
    expect(result.terms).toEqual([{ fa: 'خانه', en: 'house', note: '' }]);
    expect(result.skipped).toBe(2);
    expect(parseGlossaryCsv('one,two\nسه,چهار\n')).toEqual({ terms: [], skipped: 2 });
  });

  it('returns nothing for an empty file', () => {
    expect(parseGlossaryCsv('')).toEqual({ terms: [], skipped: 0 });
  });
});
