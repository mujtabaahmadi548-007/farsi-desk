// @vitest-environment jsdom
import { strToU8, unzipSync, zipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildDocumentXml, buildDocx, escapeXml, readDocxParagraphs, splitBidiRuns, type DocxBlock } from './docx';

const ZWNJ = '\u{200C}';

function para(text: string, rtl: boolean): DocxBlock {
  return { type: 'paragraph', paragraph: { text, rtl } };
}

describe('splitBidiRuns', () => {
  it('keeps a pure Persian paragraph as one right-to-left run, digits and punctuation included', () => {
    const text = `کتاب${ZWNJ}ها در سال ۱۴۰۲ و 2024 منتشر شدند.`;
    expect(splitBidiRuns(text, true)).toEqual([{ text, rtl: true }]);
  });

  it('separates an English name inside Persian text', () => {
    expect(splitBidiRuns('با نرم‌افزار «Libby» کتاب بخوانید.', true)).toEqual([
      { text: 'با نرم‌افزار «', rtl: true },
      { text: 'Libby', rtl: false },
      { text: '» کتاب بخوانید.', rtl: true },
    ]);
  });

  it('keeps spaces inside a multi-word English phrase in the left-to-right run', () => {
    expect(splitBidiRuns('برنامهٔ Farsi Desk رایگان است', true)).toEqual([
      { text: 'برنامهٔ ', rtl: true },
      { text: 'Farsi Desk', rtl: false },
      { text: ' رایگان است', rtl: true },
    ]);
  });

  it('separates a Persian word inside an English paragraph', () => {
    expect(splitBidiRuns('The word کتاب means book.', false)).toEqual([
      { text: 'The word ', rtl: false },
      { text: 'کتاب', rtl: true },
      { text: ' means book.', rtl: false },
    ]);
  });

  it('returns no runs for empty text', () => {
    expect(splitBidiRuns('', true)).toEqual([]);
  });
});

describe('buildDocumentXml', () => {
  it('marks Persian paragraphs as bidi and their runs as rtl, and leaves English ones alone', () => {
    const xml = buildDocumentXml([para('سلام دنیا', true), para('Hello world', false)]);
    expect(xml).toContain('<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:rPr><w:rtl/></w:rPr>');
    expect(xml).toContain('<w:p><w:r><w:t xml:space="preserve">Hello world</w:t></w:r></w:p>');
  });

  it('is well-formed XML and escapes special characters', () => {
    const xml = buildDocumentXml([para('R&D <b> "quoted" و فارسی', false)]);
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(xml).toContain('R&amp;D &lt;b&gt; &quot;quoted&quot;');
  });

  it('drops control characters that are illegal in XML', () => {
    expect(escapeXml('a\u0001b\u000Bc')).toBe('abc');
    expect(escapeXml('tab\tnewline\n')).toBe('tab\tnewline\n');
  });

  it('turns line breaks inside a paragraph into <w:br/>', () => {
    const xml = buildDocumentXml([para('خط یک\nخط دو', true)]);
    expect(xml.match(/<w:br\/>/g)).toHaveLength(1);
  });

  it('builds a two-column table with a header row for bilingual export', () => {
    const xml = buildDocumentXml([
      {
        type: 'table',
        headerRow: true,
        rows: [
          [
            { text: 'Source (Persian)', rtl: false },
            { text: 'Target (English)', rtl: false },
          ],
          [
            { text: 'سلام', rtl: true },
            { text: 'Hello', rtl: false },
          ],
        ],
      },
    ]);
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(doc.getElementsByTagName('w:tr')).toHaveLength(2);
    expect(doc.getElementsByTagName('w:tc')).toHaveLength(4);
    expect(doc.getElementsByTagName('w:gridCol')).toHaveLength(2);
    expect(xml).toContain('<w:tblHeader/>');
  });
});

describe('buildDocx → readDocxParagraphs', () => {
  it('produces a zip package with the parts Word requires', () => {
    const files = unzipSync(buildDocx([para('سلام', true)]));
    expect(Object.keys(files).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'word/_rels/document.xml.rels',
      'word/document.xml',
      'word/styles.xml',
    ]);
    for (const name of Object.keys(files)) {
      const doc = new DOMParser().parseFromString(strFromU8(files[name]), 'application/xml');
      expect(doc.getElementsByTagName('parsererror'), name).toHaveLength(0);
    }
  });

  it('round-trips Persian text with ZWNJ and mixed English exactly', () => {
    const paragraphs = [
      `کاربران می${ZWNJ}توانند با نرم${ZWNJ}افزار «Libby» کتاب${ZWNJ}ها را بخوانند.`,
      '',
      'Version 2.5 of Farsi Desk — released in ۱۴۰۴.',
      'خط یک\nخط دو',
    ];
    const bytes = buildDocx(paragraphs.map((text) => para(text, /^\p{Script=Arabic}/u.test(text))));
    expect(readDocxParagraphs(bytes)).toEqual(paragraphs);
  });

  it('reads table cells as paragraphs, in order', () => {
    const bytes = buildDocx([
      {
        type: 'table',
        rows: [
          [
            { text: 'سلام', rtl: true },
            { text: 'Hello', rtl: false },
          ],
        ],
      },
    ]);
    expect(readDocxParagraphs(bytes).slice(0, 2)).toEqual(['سلام', 'Hello']);
  });
});

describe('readDocxParagraphs — documents written by Word', () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const MC = 'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"';

  function docx(bodyXml: string): Uint8Array {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><w:document ${W} ${MC}><w:body>${bodyXml}<w:sectPr/></w:body></w:document>`;
    return zipSync({ 'word/document.xml': strToU8(xml) });
  }

  it('joins text that Word split across several runs', () => {
    const bytes = docx(
      `<w:p><w:r><w:t xml:space="preserve">می</w:t></w:r><w:r><w:t>${ZWNJ}روم</w:t></w:r>` +
        '<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve"> به خانه</w:t></w:r></w:p>',
    );
    expect(readDocxParagraphs(bytes)).toEqual([`می${ZWNJ}روم به خانه`]);
  });

  it('handles tabs, soft line breaks and hyperlinks', () => {
    const bytes = docx(
      '<w:p><w:r><w:t>الف</w:t><w:tab/><w:t>ب</w:t><w:br/><w:t>ج</w:t></w:r>' +
        '<w:hyperlink><w:r><w:t xml:space="preserve"> example.org</w:t></w:r></w:hyperlink></w:p>',
    );
    expect(readDocxParagraphs(bytes)).toEqual(['الف\tب\nج example.org']);
  });

  it('ignores deleted tracked changes and field codes but keeps insertions', () => {
    const bytes = docx(
      '<w:p><w:r><w:t xml:space="preserve">متن </w:t></w:r>' +
        '<w:del><w:r><w:delText>حذف‌شده</w:delText></w:r></w:del>' +
        '<w:ins><w:r><w:t>تازه</w:t></w:r></w:ins>' +
        '<w:r><w:instrText> PAGE </w:instrText></w:r></w:p>',
    );
    expect(readDocxParagraphs(bytes)).toEqual(['متن تازه']);
  });

  it('does not read text-box content twice (mc:Fallback is skipped)', () => {
    const bytes = docx(
      '<w:p><w:r><w:t>بیرون</w:t></w:r><w:r><mc:AlternateContent>' +
        '<mc:Choice><w:txbxContent><w:p><w:r><w:t>درون کادر</w:t></w:r></w:p></w:txbxContent></mc:Choice>' +
        '<mc:Fallback><w:txbxContent><w:p><w:r><w:t>درون کادر</w:t></w:r></w:p></w:txbxContent></mc:Fallback>' +
        '</mc:AlternateContent></w:r></w:p>',
    );
    expect(readDocxParagraphs(bytes)).toEqual(['بیرون', 'درون کادر']);
  });

  it('gives a readable error for files that are not .docx', () => {
    expect(() => readDocxParagraphs(strToU8('just some text'))).toThrow(/not a valid \.docx/);
    expect(() => readDocxParagraphs(zipSync({ 'hello.txt': strToU8('hi') }))).toThrow(/no Word document/);
  });
});
