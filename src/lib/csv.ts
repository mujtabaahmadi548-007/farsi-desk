import { hasPersian } from './chars';

export type Delimiter = ',' | ';' | '\t';

/** Picks the delimiter that occurs most often (outside quotes) in the first non-empty line. */
export function detectDelimiter(text: string): Delimiter {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim() !== '') ?? '';
  const counts: Record<Delimiter, number> = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (const ch of firstLine) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === ',' || ch === ';' || ch === '\t')) counts[ch]++;
  }
  if (counts['\t'] > counts[','] && counts['\t'] >= counts[';']) return '\t';
  if (counts[';'] > counts[',']) return ';';
  return ',';
}

/**
 * RFC 4180 parser: quoted fields, doubled quotes, line breaks inside quotes, CRLF or LF.
 * Rows that are completely empty are dropped. A leading BOM is ignored.
 */
export function parseCsv(input: string, delimiter: Delimiter = detectDelimiter(input)): string[][] {
  const text = input.replace(/^\u{FEFF}/u, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let fieldWasQuoted = false;

  const endField = () => {
    row.push(fieldWasQuoted ? field : field.trim());
    field = '';
    fieldWasQuoted = false;
  };
  const endRow = () => {
    endField();
    if (row.some((cell) => cell !== '')) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"' && field.trim() === '') {
      quoted = true;
      fieldWasQuoted = true;
      field = '';
    } else if (ch === delimiter) {
      endField();
    } else if (ch === '\n') {
      endRow();
    } else if (ch === '\r') {
      if (text[i + 1] !== '\n') endRow();
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) || value !== value.trim() ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Serialises rows as CSV with CRLF line ends. */
export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// Glossary CSV
// ---------------------------------------------------------------------------

export interface GlossaryRow {
  fa: string;
  en: string;
  note: string;
}

export interface GlossaryCsvResult {
  terms: GlossaryRow[];
  /** Rows that did not contain one Persian and one English term. */
  skipped: number;
}

const FA_HEADER = /^(fa|fa-ir|persian|farsi|فارسی)$/i;
const EN_HEADER = /^(en|en-us|en-gb|english|انگلیسی)$/i;
const NOTE_HEADER = /^(note|notes|comment|comments|description|توضیح|توضیحات|یادداشت)$/i;

/**
 * Reads a glossary from CSV. With a header row (fa / en / note, or Persian / English …) the columns
 * may be in any order. Without one, each row is read by script: the cell with Persian letters is the
 * Persian term, the other one the English term, and a third cell is the note.
 */
export function parseGlossaryCsv(text: string): GlossaryCsvResult {
  const rows = parseCsv(text);
  const terms: GlossaryRow[] = [];
  let skipped = 0;
  if (rows.length === 0) return { terms, skipped };

  const header = rows[0].map((cell) => cell.trim());
  const faColumn = header.findIndex((cell) => FA_HEADER.test(cell));
  const enColumn = header.findIndex((cell) => EN_HEADER.test(cell));
  const hasHeader = faColumn !== -1 && enColumn !== -1;
  const noteColumn = hasHeader ? header.findIndex((cell) => NOTE_HEADER.test(cell)) : -1;

  for (const row of hasHeader ? rows.slice(1) : rows) {
    let fa: string;
    let en: string;
    let note: string;
    if (hasHeader) {
      fa = (row[faColumn] ?? '').trim();
      en = (row[enColumn] ?? '').trim();
      note = noteColumn === -1 ? '' : (row[noteColumn] ?? '').trim();
    } else {
      const cells = row.map((cell) => cell.trim());
      const faIndex = cells.findIndex((cell, index) => index < 2 && hasPersian(cell));
      const enIndex = cells.findIndex((cell, index) => index < 2 && cell !== '' && !hasPersian(cell));
      fa = faIndex === -1 ? '' : cells[faIndex];
      en = enIndex === -1 ? '' : cells[enIndex];
      note = cells[2] ?? '';
    }
    if (fa === '' || en === '') {
      skipped++;
      continue;
    }
    terms.push({ fa, en, note });
  }
  return { terms, skipped };
}

/** Glossary → CSV with a header row and a BOM, so Excel opens the Persian text correctly. */
export function glossaryToCsv(terms: GlossaryRow[]): string {
  return '\u{FEFF}' + toCsv([['fa', 'en', 'note'], ...terms.map((term) => [term.fa, term.en, term.note])]);
}
