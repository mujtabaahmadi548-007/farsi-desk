import type { Direction, TMEntry } from '../types';
import { escapeXml } from './docx';

/** TMX 1.4 date: 20261110T142530Z */
function tmxDate(timestamp: number): string {
  return new Date(timestamp)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
}

function parseTmxDate(value: string | null): number | null {
  if (!value) return null;
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const time = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  return Number.isNaN(time) ? null : time;
}

/** Serialises translation memory entries as a TMX 1.4 file that other CAT tools can import. */
export function exportTmx(entries: TMEntry[]): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<tmx version="1.4">',
    '  <header creationtool="Farsi Desk" creationtoolversion="1.0" segtype="sentence" o-tmf="FarsiDesk" ' +
      'adminlang="en" srclang="*all*" datatype="plaintext"/>',
    '  <body>',
  ];
  for (const entry of entries) {
    const srcLang = entry.direction === 'fa-en' ? 'fa' : 'en';
    const tuvs: [string, string][] =
      srcLang === 'fa'
        ? [
            ['fa', entry.fa],
            ['en', entry.en],
          ]
        : [
            ['en', entry.en],
            ['fa', entry.fa],
          ];
    lines.push(
      `    <tu srclang="${srcLang}" creationdate="${tmxDate(entry.createdAt)}" changedate="${tmxDate(entry.updatedAt)}">`,
    );
    if (entry.origin.trim() !== '') lines.push(`      <prop type="x-origin">${escapeXml(entry.origin)}</prop>`);
    for (const [lang, text] of tuvs) {
      lines.push(`      <tuv xml:lang="${lang}"><seg>${escapeXml(text)}</seg></tuv>`);
    }
    lines.push('    </tu>');
  }
  lines.push('  </body>', '</tmx>', '');
  return lines.join('\n');
}

export interface TmxPair {
  fa: string;
  en: string;
  direction: Direction;
  createdAt: number | null;
  updatedAt: number | null;
  origin: string;
}

export interface TmxImportResult {
  pairs: TmxPair[];
  /** Translation units that had no Persian + English pair (other languages, empty segments). */
  skipped: number;
}

function langOf(tuv: Element): 'fa' | 'en' | null {
  const raw = (
    tuv.getAttribute('xml:lang') ??
    tuv.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'lang') ??
    tuv.getAttribute('lang') ??
    ''
  )
    .trim()
    .toLowerCase();
  if (raw === 'fa' || raw.startsWith('fa-') || raw.startsWith('fa_') || raw === 'per' || raw === 'fas' || raw === 'pes') {
    return 'fa';
  }
  if (raw === 'en' || raw.startsWith('en-') || raw.startsWith('en_') || raw === 'eng') return 'en';
  return null;
}

function childrenNamed(parent: Element, name: string): Element[] {
  return Array.from(parent.children).filter((child) => child.localName === name);
}

/**
 * Reads a TMX file and keeps the Persian–English pairs. Inline formatting tags inside <seg>
 * (bpt, ept, ph …) are dropped and only their text is kept. Throws when the file is not TMX.
 */
export function parseTmx(xml: string): TmxImportResult {
  const doc = new DOMParser().parseFromString(xml.replace(/^\u{FEFF}/u, ''), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0 || doc.documentElement.localName !== 'tmx') {
    throw new Error('This is not a valid TMX file.');
  }
  const header = childrenNamed(doc.documentElement, 'header')[0];
  const headerSrc = (header?.getAttribute('srclang') ?? '').toLowerCase();
  const body = childrenNamed(doc.documentElement, 'body')[0];
  const pairs: TmxPair[] = [];
  let skipped = 0;
  if (!body) return { pairs, skipped };

  for (const tu of childrenNamed(body, 'tu')) {
    let fa = '';
    let en = '';
    let first: 'fa' | 'en' | null = null;
    for (const tuv of childrenNamed(tu, 'tuv')) {
      const lang = langOf(tuv);
      if (!lang) continue;
      const seg = childrenNamed(tuv, 'seg')[0];
      const text = (seg?.textContent ?? '').trim();
      if (text === '') continue;
      if (lang === 'fa' && fa === '') fa = text;
      if (lang === 'en' && en === '') en = text;
      first ??= lang;
    }
    if (fa === '' || en === '') {
      skipped++;
      continue;
    }
    const declared = (tu.getAttribute('srclang') ?? headerSrc).toLowerCase();
    let direction: Direction;
    if (declared.startsWith('en')) direction = 'en-fa';
    else if (declared.startsWith('fa') || declared.startsWith('per') || declared.startsWith('fas')) direction = 'fa-en';
    else direction = first === 'en' ? 'en-fa' : 'fa-en';
    const origin = childrenNamed(tu, 'prop').find((prop) => prop.getAttribute('type') === 'x-origin');
    pairs.push({
      fa,
      en,
      direction,
      createdAt: parseTmxDate(tu.getAttribute('creationdate')),
      updatedAt: parseTmxDate(tu.getAttribute('changedate')),
      origin: (origin?.textContent ?? '').trim(),
    });
  }
  return { pairs, skipped };
}
