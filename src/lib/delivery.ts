import { langName, sourceLang, targetLang, type Lang, type Project, type Segment } from '../types';
import { hasLatin, hasPersian } from './chars';
import type { DocxBlock, DocxParagraph } from './docx';
import { assembleParagraphs } from './segments';
import type { Cue } from './srt';

/** Which text of the segments is delivered. */
export type DeliveryContent = 'target' | 'source';

/**
 * Returns the function that picks the delivered text of a segment.
 * With `fillWithSource`, untranslated segments fall back to their source text (what CAT tools do),
 * so a partly translated document is still complete.
 */
export function textPicker(content: DeliveryContent, fillWithSource: boolean): (segment: Segment) => string {
  if (content === 'source') return (segment) => segment.source;
  return (segment) => (segment.target.trim() === '' && fillWithSource ? segment.source : segment.target);
}

export function deliveryLang(project: Project, content: DeliveryContent): Lang {
  return content === 'source' ? sourceLang(project.direction) : targetLang(project.direction);
}

/**
 * Paragraph direction for export. A paragraph of a Persian document is right-to-left even when it
 * starts with an English word; a paragraph without any Persian (a URL, a product name) is left-to-right.
 */
export function paragraphIsRtl(text: string, lang: Lang): boolean {
  if (lang === 'fa') return hasPersian(text) || !hasLatin(text);
  return hasPersian(text) && !hasLatin(text);
}

function toParagraph(text: string, lang: Lang): DocxParagraph {
  return { text, rtl: paragraphIsRtl(text, lang) };
}

/** The delivered document: segments joined back into their original paragraphs. */
export function buildDocumentBlocks(segments: Segment[], pick: (segment: Segment) => string, lang: Lang): DocxBlock[] {
  return assembleParagraphs(segments, pick).map((text) => ({ type: 'paragraph', paragraph: toParagraph(text, lang) }));
}

/** Bilingual review document: one table row per segment, source on the left, target on the right. */
export function buildBilingualBlocks(segments: Segment[], project: Project): DocxBlock[] {
  const srcLang = sourceLang(project.direction);
  const tgtLang = targetLang(project.direction);
  const rows: DocxParagraph[][] = [
    [
      { text: `Source — ${langName(srcLang)}`, rtl: false },
      { text: `Target — ${langName(tgtLang)}`, rtl: false },
    ],
  ];
  for (const segment of segments) {
    rows.push([toParagraph(segment.source, srcLang), toParagraph(segment.target, tgtLang)]);
  }
  return [
    { type: 'paragraph', paragraph: { text: project.name, rtl: paragraphIsRtl(project.name, 'en'), bold: true } },
    { type: 'table', rows, headerRow: true },
  ];
}

export function buildPlainText(segments: Segment[], pick: (segment: Segment) => string): string {
  const paragraphs = assembleParagraphs(segments, pick);
  return paragraphs.length === 0 ? '' : paragraphs.join('\n') + '\n';
}

/** How long an open-ended last cue stays on screen when nothing better is known. */
const OPEN_CUE_SECONDS = 5;

/**
 * Timed segments → subtitle cues, in time order. A missing end time is taken from the start of the
 * next cue; the last cue runs for 5 s, but never past the end of the media when its length is known.
 * Every cue is at least 0.2 s long.
 */
export function segmentsToCues(
  segments: Segment[],
  pick: (segment: Segment) => string,
  mediaDuration: number | null = null,
): Cue[] {
  const timed = segments
    .filter((segment): segment is Segment & { start: number } => segment.start !== null)
    .sort((a, b) => a.start - b.start);
  return timed.map((segment, index) => {
    const next = timed[index + 1];
    let fallbackEnd = next ? next.start : segment.start + OPEN_CUE_SECONDS;
    if (!next && mediaDuration !== null && mediaDuration > segment.start) {
      fallbackEnd = Math.min(fallbackEnd, mediaDuration);
    }
    const end = segment.end !== null && segment.end > segment.start ? segment.end : fallbackEnd;
    return { start: segment.start, end: Math.max(end, segment.start + 0.2), text: pick(segment) };
  });
}

// ---------------------------------------------------------------------------
// Invoice
// ---------------------------------------------------------------------------

export interface InvoiceTotals {
  subtotal: number;
  tax: number;
  total: number;
}

/** Amounts are rounded to cents at each step, the way they are printed. */
export function invoiceTotals(quantity: number, rate: number, taxPercent: number): InvoiceTotals {
  const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
  const subtotal = round(quantity * rate);
  const tax = round((subtotal * taxPercent) / 100);
  return { subtotal, tax, total: round(subtotal + tax) };
}

export function formatInvoiceNumber(sequence: number, date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(sequence).padStart(3, '0')}`;
}
