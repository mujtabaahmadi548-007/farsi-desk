import { describe, expect, it } from 'vitest';
import {
  formatClock,
  formatSrt,
  formatTimestamp,
  formatTranscript,
  formatVtt,
  parseSubtitles,
  parseTimestamp,
  type Cue,
} from './srt';

const ZWNJ = '\u{200C}';
const RLE = '\u{202B}'; // RIGHT-TO-LEFT EMBEDDING
const PDF = '\u{202C}'; // POP DIRECTIONAL FORMATTING

const PERSIAN_SRT = [
  '1',
  '00:00:01,000 --> 00:00:03,500',
  `سلام، من امروز دربارهٔ ترجمه صحبت می${ZWNJ}کنم.`,
  '',
  '2',
  '00:00:04,000 --> 00:00:07,250',
  'این برنامه Farsi Desk نام دارد',
  `و کاملاً در مرورگر اجرا می${ZWNJ}شود.`,
  '',
  '3',
  '01:02:03,004 --> 01:02:05,000',
  'نسخهٔ 2.0 — ۱۰۰٪ رایگان!',
  '',
].join('\n');

describe('parseTimestamp / formatTimestamp', () => {
  it('parses SRT, VTT and short forms', () => {
    expect(parseTimestamp('00:00:01,000')).toBe(1);
    expect(parseTimestamp('01:02:03,004')).toBeCloseTo(3723.004, 6);
    expect(parseTimestamp('02:03.5')).toBe(123.5);
    expect(parseTimestamp('1:23')).toBe(83);
    expect(parseTimestamp('7.25')).toBe(7.25);
  });

  it('accepts Persian digits', () => {
    expect(parseTimestamp('۰۱:۰۵')).toBe(65);
  });

  it('rejects things that are not times', () => {
    expect(parseTimestamp('')).toBeNull();
    expect(parseTimestamp('abc')).toBeNull();
    expect(parseTimestamp('1:2:3:4')).toBeNull();
    expect(parseTimestamp('1:x')).toBeNull();
  });

  it('formats with comma for SRT and dot for VTT', () => {
    expect(formatTimestamp(3723.004)).toBe('01:02:03,004');
    expect(formatTimestamp(3723.004, '.')).toBe('01:02:03.004');
    expect(formatTimestamp(0)).toBe('00:00:00,000');
  });

  it('carries rounding into seconds and minutes instead of printing 1000 ms', () => {
    expect(formatTimestamp(59.9996)).toBe('00:01:00,000');
    expect(formatTimestamp(3599.9999)).toBe('01:00:00,000');
  });

  it('never prints negative times', () => {
    expect(formatTimestamp(-2)).toBe('00:00:00,000');
  });

  it('formats a compact clock for the UI', () => {
    expect(formatClock(65.25)).toBe('1:05.250');
    expect(formatClock(3725, false)).toBe('1:02:05');
  });
});

describe('parseSubtitles', () => {
  it('parses Persian cues with ZWNJ, mixed English and multi-line text', () => {
    const cues = parseSubtitles(PERSIAN_SRT);
    expect(cues).toHaveLength(3);
    expect(cues[0]).toEqual({
      start: 1,
      end: 3.5,
      text: `سلام، من امروز دربارهٔ ترجمه صحبت می${ZWNJ}کنم.`,
    });
    expect(cues[1].text).toBe(`این برنامه Farsi Desk نام دارد\nو کاملاً در مرورگر اجرا می${ZWNJ}شود.`);
    expect(cues[2].start).toBeCloseTo(3723.004, 6);
    expect(cues[2].text).toBe('نسخهٔ 2.0 — ۱۰۰٪ رایگان!');
  });

  it('handles a BOM, CRLF line endings and trailing spaces', () => {
    const input = '\u{FEFF}' + PERSIAN_SRT.replace(/\n/g, '\r\n').replace('سلام،', 'سلام،  ');
    const cues = parseSubtitles(input);
    expect(cues).toHaveLength(3);
    expect(cues[0].text.startsWith('سلام،')).toBe(true);
  });

  it('copes with missing cue numbers and a missing blank line between cues', () => {
    const input = [
      '00:00:01,000 --> 00:00:02,000',
      'یک',
      '2',
      '00:00:03,000 --> 00:00:04,000',
      'دو',
    ].join('\n');
    expect(parseSubtitles(input)).toEqual([
      { start: 1, end: 2, text: 'یک' },
      { start: 3, end: 4, text: 'دو' },
    ]);
  });

  it('keeps a line that is only a number when it is cue text', () => {
    const input = ['1', '00:00:01,000 --> 00:00:02,000', '1402', '', '2', '00:00:03,000 --> 00:00:04,000', 'بعدی'].join(
      '\n',
    );
    const cues = parseSubtitles(input);
    expect(cues.map((c) => c.text)).toEqual(['1402', 'بعدی']);
  });

  it('parses WebVTT with short timestamps and cue settings', () => {
    const input = [
      'WEBVTT',
      '',
      'NOTE made for a test',
      '',
      'intro',
      '00:01.000 --> 00:02.500 line:90% align:center',
      'Hello and سلام',
      '',
      '00:00:03.000 --> 00:00:04.000',
      'Second cue',
    ].join('\n');
    expect(parseSubtitles(input)).toEqual([
      { start: 1, end: 2.5, text: 'Hello and سلام' },
      { start: 3, end: 4, text: 'Second cue' },
    ]);
  });

  it('returns no cues for text without timestamps', () => {
    expect(parseSubtitles('فقط یک متن ساده')).toEqual([]);
  });
});

describe('formatSrt / formatVtt / formatTranscript', () => {
  it('round-trips Persian subtitles without changing a character', () => {
    const cues = parseSubtitles(PERSIAN_SRT);
    const exported = formatSrt(cues);
    expect(exported).toBe(PERSIAN_SRT);
    expect(parseSubtitles(exported)).toEqual(cues);
  });

  it('skips empty cues and renumbers the rest', () => {
    const cues: Cue[] = [
      { start: 0, end: 1, text: 'اول' },
      { start: 1, end: 2, text: '   ' },
      { start: 2, end: 3, text: 'سوم' },
    ];
    expect(formatSrt(cues)).toBe(
      '1\n00:00:00,000 --> 00:00:01,000\nاول\n\n2\n00:00:02,000 --> 00:00:03,000\nسوم\n',
    );
  });

  it('removes blank lines inside a cue, which would otherwise cut it in two', () => {
    const out = formatSrt([{ start: 0, end: 1, text: 'خط یک\n\nخط دو' }]);
    expect(out).toBe('1\n00:00:00,000 --> 00:00:01,000\nخط یک\nخط دو\n');
  });

  it('can wrap lines in RTL embedding marks for players without bidi support', () => {
    const out = formatSrt([{ start: 0, end: 1, text: 'سلام دنیا!\nخط دوم.' }], { rtlMarks: true });
    expect(out).toContain(`${RLE}سلام دنیا!${PDF}\n${RLE}خط دوم.${PDF}`);
    // The marks do not get in the way of reading the file back.
    expect(parseSubtitles(out)[0].text.replaceAll(RLE, '').replaceAll(PDF, '')).toBe('سلام دنیا!\nخط دوم.');
  });

  it('writes WebVTT with a header and dots', () => {
    const out = formatVtt([{ start: 61.5, end: 63, text: 'این --> یک آزمون است' }]);
    expect(out).toBe('WEBVTT\n\n00:01:01.500 --> 00:01:03.000\nاین → یک آزمون است\n');
    expect(parseSubtitles(out)).toHaveLength(1);
  });

  it('writes a plain transcript with or without timestamps', () => {
    const cues = parseSubtitles(PERSIAN_SRT);
    const plain = formatTranscript(cues, false);
    expect(plain.split('\n')[1]).toBe(`این برنامه Farsi Desk نام دارد و کاملاً در مرورگر اجرا می${ZWNJ}شود.`);
    const stamped = formatTranscript(cues, true);
    expect(stamped.split('\n')[2]).toBe('[01:02:03] نسخهٔ 2.0 — ۱۰۰٪ رایگان!');
  });

  it('returns an empty string when there is nothing to export', () => {
    expect(formatSrt([])).toBe('');
    expect(formatTranscript([], true)).toBe('');
  });
});
