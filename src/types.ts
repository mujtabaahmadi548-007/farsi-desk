export type Lang = 'fa' | 'en';
export type Direction = 'fa-en' | 'en-fa';
export type RateUnit = 'word' | 'minute';
export type DigitMode = 'persian' | 'latin' | 'keep';
export type ProjectStatus = 'active' | 'delivered';
export type SegmentStatus = 'empty' | 'draft' | 'confirmed';

export interface Project {
  id: string;
  name: string;
  client: string;
  direction: Direction;
  /** ISO date (yyyy-mm-dd) or '' when there is no deadline. */
  deadline: string;
  rateUnit: RateUnit;
  rate: number;
  currency: string;
  /** How digits are unified in the Persian text of this project. */
  digitMode: DigitMode;
  status: ProjectStatus;
  notes: string;
  /** Duration in seconds of the loaded media, when there is one. */
  mediaDuration: number | null;
  mediaName: string;
  isSample: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Segment {
  id: string;
  projectId: string;
  /** Position inside the project (0-based, gap-free after every structural change). */
  order: number;
  /** Paragraph number, used to rebuild paragraphs on export. Gaps mean blank lines. */
  paragraph: number;
  source: string;
  target: string;
  status: SegmentStatus;
  /** Timing in seconds for subtitles / transcription, or null for plain text. */
  start: number | null;
  end: number | null;
  confirmedAt: number | null;
  updatedAt: number;
}

export interface TMEntry {
  id: string;
  fa: string;
  en: string;
  /** Direction in which this pair was translated. */
  direction: Direction;
  projectId: string | null;
  segmentId: string | null;
  /** Human readable origin: project name or imported file name. */
  origin: string;
  createdAt: number;
  updatedAt: number;
}

export interface GlossaryTerm {
  id: string;
  fa: string;
  en: string;
  note: string;
  createdAt: number;
}

export interface MediaRecord {
  projectId: string;
  name: string;
  type: string;
  blob: Blob;
}

export interface BusinessSettings {
  name: string;
  details: string;
  paymentNotes: string;
  nextInvoiceNumber: number;
}

export const DEFAULT_BUSINESS: BusinessSettings = {
  name: '',
  details: '',
  paymentNotes: '',
  nextInvoiceNumber: 1,
};

export function sourceLang(direction: Direction): Lang {
  return direction === 'fa-en' ? 'fa' : 'en';
}

export function targetLang(direction: Direction): Lang {
  return direction === 'fa-en' ? 'en' : 'fa';
}

export function langDir(lang: Lang): 'rtl' | 'ltr' {
  return lang === 'fa' ? 'rtl' : 'ltr';
}

export function langName(lang: Lang): string {
  return lang === 'fa' ? 'Persian' : 'English';
}

export function directionLabel(direction: Direction): string {
  return direction === 'fa-en' ? 'FA → EN' : 'EN → FA';
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for non-secure contexts (e.g. plain http on a LAN address).
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
}
