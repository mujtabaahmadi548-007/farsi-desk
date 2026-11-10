// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { TMEntry } from '../types';
import { exportTmx, parseTmx } from './tmx';

const ZWNJ = '\u{200C}';

function entry(fa: string, en: string, extra: Partial<TMEntry> = {}): TMEntry {
  return {
    id: `${fa}|${en}`,
    fa,
    en,
    direction: 'fa-en',
    projectId: null,
    segmentId: null,
    origin: 'Test project',
    createdAt: Date.UTC(2026, 10, 10, 14, 25, 30),
    updatedAt: Date.UTC(2026, 10, 11, 8, 0, 0),
    ...extra,
  };
}

describe('exportTmx', () => {
  it('writes a TMX 1.4 file that is valid XML', () => {
    const xml = exportTmx([entry(`او می${ZWNJ}رود.`, 'He goes.')]);
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(doc.documentElement.getAttribute('version')).toBe('1.4');
    expect(xml).toContain('creationdate="20261110T142530Z"');
    expect(xml).toContain('changedate="20261111T080000Z"');
    expect(xml).toContain(`<tuv xml:lang="fa"><seg>او می${ZWNJ}رود.</seg></tuv>`);
  });

  it('puts the source language first and records it on the unit', () => {
    const xml = exportTmx([entry('سلام', 'Hello', { direction: 'en-fa' })]);
    expect(xml).toContain('<tu srclang="en"');
    expect(xml.indexOf('xml:lang="en"')).toBeLessThan(xml.indexOf('xml:lang="fa"'));
  });

  it('escapes markup characters', () => {
    const xml = exportTmx([entry('الف < ب & ج', 'A < B & "C"', { origin: 'R&D' })]);
    expect(xml).toContain('<seg>الف &lt; ب &amp; ج</seg>');
    expect(xml).toContain('<prop type="x-origin">R&amp;D</prop>');
    expect(new DOMParser().parseFromString(xml, 'application/xml').getElementsByTagName('parsererror')).toHaveLength(0);
  });

  it('writes an empty but valid file for an empty memory', () => {
    expect(parseTmx(exportTmx([]))).toEqual({ pairs: [], skipped: 0 });
  });
});

describe('parseTmx', () => {
  it('round-trips entries exactly, including half-spaces, mixed English and dates', () => {
    const entries = [
      entry(`کاربران می${ZWNJ}توانند با نرم${ZWNJ}افزار «Libby» کتاب بخوانند.`, 'Users can read books with the “Libby” software.'),
      entry('نسخهٔ 2.5 — ۱۰۰٪ رایگان', 'Version 2.5 — 100% free', { direction: 'en-fa', origin: '' }),
    ];
    const result = parseTmx(exportTmx(entries));
    expect(result.skipped).toBe(0);
    expect(result.pairs).toEqual(
      entries.map((e) => ({
        fa: e.fa,
        en: e.en,
        direction: e.direction,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
        origin: e.origin,
      })),
    );
  });

  it('reads files from other tools: regional codes, inline tags, header srclang, a BOM', () => {
    const xml =
      '\u{FEFF}<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<tmx version="1.4"><header srclang="en-US" datatype="xml" segtype="sentence" adminlang="en" o-tmf="x" creationtool="OtherTool" creationtoolversion="9"/>' +
      '<body>' +
      '<tu><tuv xml:lang="en-US"><seg>Click <bpt i="1">&lt;b&gt;</bpt>Save<ept i="1">&lt;/b&gt;</ept> now.</seg></tuv>' +
      '<tuv xml:lang="fa-IR"><seg>اکنون روی ذخیره کلیک کنید.</seg></tuv></tu>' +
      '<tu srclang="fa"><tuv xml:lang="FA"><seg>سلام</seg></tuv><tuv xml:lang="EN-GB"><seg>Hello</seg></tuv></tu>' +
      '</body></tmx>';
    const result = parseTmx(xml);
    expect(result.skipped).toBe(0);
    expect(result.pairs[0]).toMatchObject({
      en: 'Click <b>Save</b> now.',
      fa: 'اکنون روی ذخیره کلیک کنید.',
      direction: 'en-fa',
      createdAt: null,
    });
    expect(result.pairs[1]).toMatchObject({ fa: 'سلام', en: 'Hello', direction: 'fa-en' });
  });

  it('uses the order of the languages when no source language is declared', () => {
    const xml =
      '<tmx version="1.4"><header srclang="*all*"/><body>' +
      '<tu><tuv xml:lang="en"><seg>One</seg></tuv><tuv xml:lang="fa"><seg>یک</seg></tuv></tu>' +
      '<tu><tuv xml:lang="fa"><seg>دو</seg></tuv><tuv xml:lang="en"><seg>Two</seg></tuv></tu>' +
      '</body></tmx>';
    expect(parseTmx(xml).pairs.map((p) => p.direction)).toEqual(['en-fa', 'fa-en']);
  });

  it('skips units without a Persian–English pair and counts them', () => {
    const xml =
      '<tmx version="1.4"><header srclang="en"/><body>' +
      '<tu><tuv xml:lang="en"><seg>Hello</seg></tuv><tuv xml:lang="de"><seg>Hallo</seg></tuv></tu>' +
      '<tu><tuv xml:lang="en"><seg>Empty</seg></tuv><tuv xml:lang="fa"><seg>  </seg></tuv></tu>' +
      '<tu><tuv xml:lang="en"><seg>Yes</seg></tuv><tuv xml:lang="fa"><seg>بله</seg></tuv></tu>' +
      '</body></tmx>';
    const result = parseTmx(xml);
    expect(result.pairs).toHaveLength(1);
    expect(result.skipped).toBe(2);
  });

  it('rejects files that are not TMX', () => {
    expect(() => parseTmx('this is not xml')).toThrow(/not a valid TMX/);
    expect(() => parseTmx('<html><body/></html>')).toThrow(/not a valid TMX/);
    expect(() => parseTmx('<tmx version="1.4"><body><tu></body></tmx>')).toThrow(/not a valid TMX/);
  });
});
