// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Project, Segment } from '../types';
import {
  buildBilingualBlocks,
  buildDocumentBlocks,
  buildPlainText,
  formatInvoiceNumber,
  invoiceTotals,
  paragraphIsRtl,
  segmentsToCues,
  textPicker,
} from './delivery';
import { buildDocumentXml, buildDocx, readDocxParagraphs } from './docx';
import { assembleParagraphs } from './segments';
import { countWords } from './chars';
import { formatSrt } from './srt';
import { projectStats, wordsConfirmedInMonth, deadlineInfo } from './stats';

const ZWNJ = '\u{200C}';

function seg(order: number, paragraph: number, source: string, target: string, extra: Partial<Segment> = {}): Segment {
  return {
    id: `s${order}`,
    projectId: 'p',
    order,
    paragraph,
    source,
    target,
    status: target.trim() === '' ? 'empty' : 'draft',
    start: null,
    end: null,
    confirmedAt: null,
    updatedAt: 0,
    ...extra,
  };
}

const PROJECT: Project = {
  id: 'p',
  name: 'گزارش سالانه 2026',
  client: 'Client',
  direction: 'fa-en',
  deadline: '',
  rateUnit: 'word',
  rate: 0.08,
  currency: 'USD',
  digitMode: 'persian',
  status: 'active',
  notes: '',
  mediaDuration: null,
  mediaName: '',
  isSample: false,
  createdAt: 0,
  updatedAt: 0,
};

const SEGMENTS: Segment[] = [
  seg(0, 0, 'عنوان سند', 'Document title'),
  seg(1, 1, `او می${ZWNJ}رود.`, 'He goes.'),
  seg(2, 1, 'سپس برمی‌گردد.', ''),
  seg(3, 3, 'پاراگراف آخر با Farsi Desk.', 'Last paragraph with Farsi Desk.'),
];

describe('paragraph assembly', () => {
  it('joins the segments of a paragraph and keeps blank lines', () => {
    expect(assembleParagraphs(SEGMENTS, (s) => s.source)).toEqual([
      'عنوان سند',
      `او می${ZWNJ}رود. سپس برمی‌گردد.`,
      '',
      'پاراگراف آخر با Farsi Desk.',
    ]);
  });

  it('falls back to the source for untranslated segments only when asked to', () => {
    expect(assembleParagraphs(SEGMENTS, textPicker('target', true))[1]).toBe('He goes. سپس برمی‌گردد.');
    expect(assembleParagraphs(SEGMENTS, textPicker('target', false))[1]).toBe('He goes.');
    expect(assembleParagraphs(SEGMENTS, textPicker('source', false))[1]).toBe(`او می${ZWNJ}رود. سپس برمی‌گردد.`);
  });

  it('builds plain text with one line per paragraph', () => {
    expect(buildPlainText(SEGMENTS, textPicker('target', false))).toBe(
      'Document title\nHe goes.\n\nLast paragraph with Farsi Desk.\n',
    );
    expect(buildPlainText([], textPicker('target', false))).toBe('');
  });
});

describe('paragraph direction on export', () => {
  it('Persian documents: right-to-left even when a paragraph starts with an English word', () => {
    expect(paragraphIsRtl('Windows 11 یک سیستم‌عامل است', 'fa')).toBe(true);
    expect(paragraphIsRtl('۱۴۰۲/۰۵/۱۲', 'fa')).toBe(true);
    expect(paragraphIsRtl('www.example.org', 'fa')).toBe(false);
  });

  it('English documents: left-to-right unless the paragraph is purely Persian', () => {
    expect(paragraphIsRtl('The word کتاب means book', 'en')).toBe(false);
    expect(paragraphIsRtl('کتاب', 'en')).toBe(true);
    expect(paragraphIsRtl('', 'en')).toBe(false);
  });
});

describe('docx export of a project', () => {
  it('keeps RTL paragraphs in the Persian document and round-trips the text', () => {
    const blocks = buildDocumentBlocks(SEGMENTS, textPicker('source', false), 'fa');
    const xml = buildDocumentXml(blocks);
    // Three text paragraphs and the blank line between them: all right-to-left in a Persian document.
    expect(xml.match(/<w:bidi\/>/g)).toHaveLength(4);
    expect(readDocxParagraphs(buildDocx(blocks))).toEqual(assembleParagraphs(SEGMENTS, (s) => s.source));
  });

  it('writes the English document left-to-right', () => {
    const xml = buildDocumentXml(buildDocumentBlocks(SEGMENTS, textPicker('target', false), 'en'));
    expect(xml).not.toContain('<w:bidi/>');
    expect(xml).not.toContain('<w:rtl/>');
  });

  it('builds the bilingual table: header + one row per segment, each cell in its own direction', () => {
    const blocks = buildBilingualBlocks(SEGMENTS, PROJECT);
    const table = blocks.find((block) => block.type === 'table');
    expect(table?.type === 'table' && table.rows).toHaveLength(SEGMENTS.length + 1);
    if (table?.type !== 'table') throw new Error('no table');
    expect(table.rows[2]).toEqual([
      { text: `او می${ZWNJ}رود.`, rtl: true },
      { text: 'He goes.', rtl: false },
    ]);
    const paragraphs = readDocxParagraphs(buildDocx(blocks));
    expect(paragraphs[0]).toBe(PROJECT.name);
    expect(paragraphs.slice(1, 5)).toEqual(['Source — Persian', 'Target — English', 'عنوان سند', 'Document title']);
  });
});

describe('subtitle cues from segments', () => {
  it('uses timed segments in time order and fills in missing end times', () => {
    const timed = [
      seg(0, 0, 'دو', 'two', { start: 5, end: null }),
      seg(1, 1, 'یک', 'one', { start: 1, end: 3 }),
      seg(2, 2, 'بدون زمان', 'untimed'),
      seg(3, 3, 'سه', 'three', { start: 9, end: 9 }),
    ];
    const cues = segmentsToCues(timed, (s) => s.target);
    expect(cues).toEqual([
      { start: 1, end: 3, text: 'one' },
      { start: 5, end: 9, text: 'two' },
      { start: 9, end: 14, text: 'three' },
    ]);
    expect(formatSrt(cues).split('\n')[1]).toBe('00:00:01,000 --> 00:00:03,000');
  });

  it('does not let the last open cue run past the end of the media', () => {
    const timed = [seg(0, 0, 'یک', '', { start: 1, end: null }), seg(1, 1, 'دو', '', { start: 9, end: null })];
    expect(segmentsToCues(timed, (s) => s.source, 11.5).map((c) => c.end)).toEqual([9, 11.5]);
    expect(segmentsToCues(timed, (s) => s.source, 60).map((c) => c.end)).toEqual([9, 14]);
  });
});

describe('counts and invoice', () => {
  it('counts words like a word processor: the half-space does not split a word', () => {
    expect(countWords(`او می${ZWNJ}رود و کتاب${ZWNJ}ها را می${ZWNJ}خواند.`)).toBe(6);
    expect(countWords('Farsi Desk v2.0 — 100% free!')).toBe(5);
    expect(countWords('  ')).toBe(0);
    expect(countWords('— … !')).toBe(0);
  });

  it('computes project statistics', () => {
    const confirmed = SEGMENTS.map((s, i) => (i < 2 ? { ...s, status: 'confirmed' as const } : s));
    const stats = projectStats(PROJECT, confirmed);
    expect(stats.segments).toBe(4);
    expect(stats.confirmed).toBe(2);
    expect(stats.draft).toBe(1);
    expect(stats.empty).toBe(1);
    expect(stats.sourceWords).toBe(2 + 2 + 2 + 5);
    expect(stats.confirmedWords).toBe(4);
    expect(stats.progress).toBe(50);
    expect(stats.minutes).toBeNull();
  });

  it('takes the media length from the project, else from the last timestamp', () => {
    const timed = [seg(0, 0, 'الف', '', { start: 0, end: 90 })];
    expect(projectStats(PROJECT, timed).minutes).toBe(1.5);
    expect(projectStats({ ...PROJECT, mediaDuration: 600 }, timed).minutes).toBe(10);
  });

  it('counts only words confirmed in the given month', () => {
    const now = new Date(2026, 10, 15);
    const inMonth = new Date(2026, 10, 2).getTime();
    const lastMonth = new Date(2026, 9, 30).getTime();
    const list = [
      seg(0, 0, 'یک دو سه', 'x', { status: 'confirmed', confirmedAt: inMonth }),
      seg(1, 1, 'چهار پنج', 'x', { status: 'confirmed', confirmedAt: lastMonth }),
      seg(2, 2, 'شش', 'x', { status: 'draft', confirmedAt: null }),
    ];
    expect(wordsConfirmedInMonth(list, now)).toBe(3);
  });

  it('describes deadlines relative to today', () => {
    const now = new Date(2026, 10, 10, 15, 0);
    expect(deadlineInfo('2026-11-10', now).label).toBe('Due today');
    expect(deadlineInfo('2026-11-11', now).label).toBe('Due tomorrow');
    expect(deadlineInfo('2026-11-17', now)).toMatchObject({ days: 7, tone: 'ok' });
    expect(deadlineInfo('2026-11-08', now)).toMatchObject({ days: -2, label: 'Overdue by 2 days', tone: 'err' });
    expect(deadlineInfo('', now).days).toBeNull();
  });

  it('computes invoice totals rounded to cents', () => {
    expect(invoiceTotals(94, 0.08, 0)).toEqual({ subtotal: 7.52, tax: 0, total: 7.52 });
    expect(invoiceTotals(1234, 0.085, 9)).toEqual({ subtotal: 104.89, tax: 9.44, total: 114.33 });
    expect(invoiceTotals(12.5, 4.5, 0).total).toBe(56.25);
  });

  it('formats invoice numbers with the year', () => {
    expect(formatInvoiceNumber(7, new Date(2026, 0, 1))).toBe('2026-007');
    expect(formatInvoiceNumber(1234, new Date(2027, 0, 1))).toBe('2027-1234');
  });
});
