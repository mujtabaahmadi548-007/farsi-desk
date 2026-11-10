import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

// ===========================================================================
// Import: .docx → paragraphs of plain text
// ===========================================================================

function collectParagraph(node: Element, own: string[], nested: Element[]): void {
  for (const child of Array.from(node.children)) {
    switch (child.localName) {
      case 'p':
        // A paragraph inside this paragraph (text box): emitted separately, after this one.
        nested.push(child);
        break;
      case 't':
        own.push(child.textContent ?? '');
        break;
      case 'tab':
        own.push('\t');
        break;
      case 'br':
      case 'cr':
        own.push('\n');
        break;
      case 'noBreakHyphen':
        own.push('-');
        break;
      case 'softHyphen':
        break;
      // Deleted (tracked) text, field codes, and the legacy copy of modern drawings are not document text.
      case 'del':
      case 'delText':
      case 'instrText':
      case 'Fallback':
      case 'pPr':
      case 'rPr':
        break;
      default:
        collectParagraph(child, own, nested);
    }
  }
}

function emitParagraph(paragraph: Element, paragraphs: string[]): void {
  const own: string[] = [];
  const nested: Element[] = [];
  collectParagraph(paragraph, own, nested);
  paragraphs.push(own.join(''));
  for (const inner of nested) emitParagraph(inner, paragraphs);
}

function walkBody(node: Element, paragraphs: string[]): void {
  for (const child of Array.from(node.children)) {
    if (child.localName === 'p') emitParagraph(child, paragraphs);
    else if (child.localName !== 'sectPr') walkBody(child, paragraphs);
  }
}

/**
 * Reads the main document text of a .docx file. Every Word paragraph (including table cells and
 * text boxes) becomes one entry; empty paragraphs are kept as '' so blank lines survive.
 */
export function readDocxParagraphs(buffer: ArrayBuffer | Uint8Array): string[] {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (file) => file.name === 'word/document.xml' });
  } catch {
    throw new Error('This is not a valid .docx file (old .doc files must be saved as .docx in Word first).');
  }
  const documentXml = files['word/document.xml'];
  if (!documentXml) {
    throw new Error('This file has no Word document inside (word/document.xml is missing).');
  }
  const xml = new DOMParser().parseFromString(strFromU8(documentXml), 'application/xml');
  if (xml.getElementsByTagName('parsererror').length > 0) {
    throw new Error('The Word document could not be read (its XML is damaged).');
  }
  const body = Array.from(xml.documentElement.children).find((el) => el.localName === 'body');
  if (!body) throw new Error('The Word document has no body.');
  const paragraphs: string[] = [];
  walkBody(body, paragraphs);
  return paragraphs;
}

// ===========================================================================
// Export: paragraphs / tables → .docx
// ===========================================================================

export interface DocxParagraph {
  text: string;
  /** Paragraph direction. RTL paragraphs get <w:bidi/> so Word lays them out right-to-left. */
  rtl: boolean;
  bold?: boolean;
}

export type DocxBlock =
  | { type: 'paragraph'; paragraph: DocxParagraph }
  | { type: 'table'; rows: DocxParagraph[][]; headerRow?: boolean };

export interface BidiRun {
  text: string;
  rtl: boolean;
}

// Hebrew + Arabic blocks (letters, digits and punctuation) and the Arabic presentation forms
const RTL_CHAR = /[\u{0590}-\u{08FF}\u{FB1D}-\u{FDFF}\u{FE70}-\u{FEFC}]/u;

/**
 * Splits text into runs of one direction, the way Word needs them: Arabic-script stretches are
 * right-to-left runs (they get <w:rtl/> and the complex-script font), Latin stretches are left-to-right.
 * Neutral characters (spaces, digits, punctuation) join the surrounding run when both neighbours
 * agree, otherwise they follow the paragraph direction — the same idea as the Unicode bidi algorithm.
 */
export function splitBidiRuns(text: string, paragraphRtl: boolean): BidiRun[] {
  const chars = Array.from(text);
  const kinds: ('R' | 'L' | 'N')[] = chars.map((ch) => {
    if (RTL_CHAR.test(ch)) return 'R';
    if (/\p{L}/u.test(ch)) return 'L';
    return 'N';
  });
  const base = paragraphRtl ? 'R' : 'L';
  let i = 0;
  while (i < kinds.length) {
    if (kinds[i] !== 'N') {
      i++;
      continue;
    }
    let j = i;
    while (j < kinds.length && kinds[j] === 'N') j++;
    const before = i > 0 ? kinds[i - 1] : null;
    const after = j < kinds.length ? kinds[j] : null;
    const resolved = before !== null && before === after ? before : base;
    for (let k = i; k < j; k++) kinds[k] = resolved;
    i = j;
  }
  const runs: BidiRun[] = [];
  for (let k = 0; k < chars.length; k++) {
    const rtl = kinds[k] === 'R';
    const last = runs[runs.length - 1];
    if (last && last.rtl === rtl) last.text += chars[k];
    else runs.push({ text: chars[k], rtl });
  }
  return runs;
}

export function escapeXml(text: string): string {
  return text
    .replace(/[^\u0009\u000A\u000D\u{20}-\u{D7FF}\u{E000}-\u{FFFD}\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function runXml(run: BidiRun, bold: boolean): string {
  const props = `${bold ? '<w:b/><w:bCs/>' : ''}${run.rtl ? '<w:rtl/>' : ''}`;
  const rPr = props === '' ? '' : `<w:rPr>${props}</w:rPr>`;
  return `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(run.text)}</w:t></w:r>`;
}

function paragraphXml(paragraph: DocxParagraph): string {
  const bold = paragraph.bold === true;
  const pPr = paragraph.rtl ? '<w:pPr><w:bidi/></w:pPr>' : '';
  const lines = paragraph.text.replace(/\r\n?/g, '\n').split('\n');
  let runs = '';
  lines.forEach((line, index) => {
    if (index > 0) runs += '<w:r><w:br/></w:r>';
    for (const run of splitBidiRuns(line, paragraph.rtl)) runs += runXml(run, bold);
  });
  return `<w:p>${pPr}${runs}</w:p>`;
}

const PAGE_WIDTH = 11906; // A4, in twentieths of a point
const PAGE_HEIGHT = 16838;
const PAGE_MARGIN = 1134; // 2 cm

function tableXml(rows: DocxParagraph[][], headerRow: boolean): string {
  const columns = rows.reduce((max, row) => Math.max(max, row.length), 0);
  if (columns === 0) return '';
  const usable = PAGE_WIDTH - 2 * PAGE_MARGIN;
  const width = Math.floor(usable / columns);
  const border = (side: string) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="808080"/>`;
  const tblPr =
    `<w:tblPr><w:tblW w:w="${width * columns}" w:type="dxa"/>` +
    `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders>` +
    '<w:tblLayout w:type="fixed"/>' +
    '<w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:left w:w="115" w:type="dxa"/>' +
    '<w:bottom w:w="80" w:type="dxa"/><w:right w:w="115" w:type="dxa"/></w:tblCellMar></w:tblPr>';
  const grid = `<w:tblGrid>${`<w:gridCol w:w="${width}"/>`.repeat(columns)}</w:tblGrid>`;
  const body = rows
    .map((row, rowIndex) => {
      const isHeader = headerRow && rowIndex === 0;
      const trPr = isHeader ? '<w:trPr><w:tblHeader/></w:trPr>' : '';
      let cells = '';
      for (let c = 0; c < columns; c++) {
        const cell: DocxParagraph = row[c] ?? { text: '', rtl: false };
        const shade = isHeader ? '<w:shd w:val="clear" w:color="auto" w:fill="E7E6E6"/>' : '';
        cells +=
          `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${shade}</w:tcPr>` +
          paragraphXml(isHeader ? { ...cell, bold: true } : cell) +
          '</w:tc>';
      }
      return `<w:tr>${trPr}${cells}</w:tr>`;
    })
    .join('');
  return `<w:tbl>${tblPr}${grid}${body}</w:tbl>`;
}

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** Builds word/document.xml. Exported separately so tests can inspect the markup. */
export function buildDocumentXml(blocks: DocxBlock[]): string {
  let body = '';
  for (const block of blocks) {
    if (block.type === 'paragraph') body += paragraphXml(block.paragraph);
    else body += tableXml(block.rows, block.headerRow === true) + '<w:p/>'; // Word wants a paragraph after a table
  }
  if (body === '') body = '<w:p/>';
  const sectPr =
    `<w:sectPr><w:pgSz w:w="${PAGE_WIDTH}" w:h="${PAGE_HEIGHT}"/>` +
    `<w:pgMar w:top="${PAGE_MARGIN}" w:right="${PAGE_MARGIN}" w:bottom="${PAGE_MARGIN}" w:left="${PAGE_MARGIN}" ` +
    'w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>';
  return `${XML_HEADER}<w:document xmlns:w="${W_NS}"><w:body>${body}${sectPr}</w:body></w:document>`;
}

const STYLES_XML =
  `${XML_HEADER}<w:styles xmlns:w="${W_NS}">` +
  '<w:docDefaults><w:rPrDefault><w:rPr>' +
  '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Arial"/>' +
  '<w:sz w:val="22"/><w:szCs w:val="24"/>' +
  '<w:lang w:val="en-US" w:eastAsia="en-US" w:bidi="fa-IR"/>' +
  '</w:rPr></w:rPrDefault>' +
  '<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault>' +
  '</w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
  '</w:styles>';

const CONTENT_TYPES_XML =
  `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
  '</Types>';

const ROOT_RELS_XML =
  `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  '</Relationships>';

const DOCUMENT_RELS_XML =
  `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
  '</Relationships>';

/** Builds a complete .docx file (a zip package) from paragraphs and tables. */
export function buildDocx(blocks: DocxBlock[]): Uint8Array {
  return zipSync(
    {
      '[Content_Types].xml': strToU8(CONTENT_TYPES_XML),
      '_rels/.rels': strToU8(ROOT_RELS_XML),
      'word/document.xml': strToU8(buildDocumentXml(blocks)),
      'word/styles.xml': strToU8(STYLES_XML),
      'word/_rels/document.xml.rels': strToU8(DOCUMENT_RELS_XML),
    },
    { level: 6 },
  );
}

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
