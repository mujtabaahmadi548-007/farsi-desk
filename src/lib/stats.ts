import type { Project, Segment } from '../types';
import { countWords } from './chars';

export interface ProjectStats {
  segments: number;
  confirmed: number;
  draft: number;
  empty: number;
  sourceWords: number;
  targetWords: number;
  /** Source words of confirmed segments. */
  confirmedWords: number;
  sourceChars: number;
  targetChars: number;
  /** Media length in minutes (from the loaded media, else from the last timestamp), or null. */
  minutes: number | null;
  /** 0–100 */
  progress: number;
}

export function projectStats(project: Project, segments: Segment[]): ProjectStats {
  let confirmed = 0;
  let draft = 0;
  let empty = 0;
  let sourceWords = 0;
  let targetWords = 0;
  let confirmedWords = 0;
  let sourceChars = 0;
  let targetChars = 0;
  let lastEnd = 0;
  for (const segment of segments) {
    const words = countWords(segment.source);
    sourceWords += words;
    targetWords += countWords(segment.target);
    sourceChars += segment.source.replace(/\s/g, '').length;
    targetChars += segment.target.replace(/\s/g, '').length;
    if (segment.status === 'confirmed') {
      confirmed++;
      confirmedWords += words;
    } else if (segment.target.trim().length > 0) draft++;
    else empty++;
    if (segment.end !== null && segment.end > lastEnd) lastEnd = segment.end;
  }
  const seconds = project.mediaDuration ?? (lastEnd > 0 ? lastEnd : null);
  return {
    segments: segments.length,
    confirmed,
    draft,
    empty,
    sourceWords,
    targetWords,
    confirmedWords,
    sourceChars,
    targetChars,
    minutes: seconds === null ? null : seconds / 60,
    progress: segments.length === 0 ? 0 : (confirmed / segments.length) * 100,
  };
}

/** Source words of every segment confirmed in the calendar month of `now`. */
export function wordsConfirmedInMonth(segments: Segment[], now: Date = new Date()): number {
  const from = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
  let total = 0;
  for (const segment of segments) {
    if (
      segment.status === 'confirmed' &&
      segment.confirmedAt !== null &&
      segment.confirmedAt >= from &&
      segment.confirmedAt < to
    ) {
      total += countWords(segment.source);
    }
  }
  return total;
}

export interface DeadlineInfo {
  /** Whole days from today (negative = overdue), or null when there is no deadline. */
  days: number | null;
  label: string;
  tone: 'none' | 'ok' | 'warn' | 'err';
}

export function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function deadlineInfo(deadline: string, now: Date = new Date()): DeadlineInfo {
  const date = parseIsoDate(deadline);
  if (!date) return { days: null, label: 'No deadline', tone: 'none' };
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((date.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) {
    return { days, label: `Overdue by ${-days} day${days === -1 ? '' : 's'}`, tone: 'err' };
  }
  if (days === 0) return { days, label: 'Due today', tone: 'err' };
  if (days === 1) return { days, label: 'Due tomorrow', tone: 'warn' };
  if (days <= 3) return { days, label: `Due in ${days} days`, tone: 'warn' };
  return { days, label: `Due in ${days} days`, tone: 'ok' };
}

export function formatDate(value: string | number | Date): string {
  const date = typeof value === 'string' ? parseIsoDate(value) : new Date(value);
  if (!date) return '';
  return date.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
}

/** The same date in the Persian (Solar Hijri) calendar, e.g. «۲۱ آبان ۱۴۰۵». */
export function formatPersianDate(value: string | number | Date): string {
  const date = typeof value === 'string' ? parseIsoDate(value) : new Date(value);
  if (!date) return '';
  try {
    return new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(date);
  } catch {
    return '';
  }
}

export function formatMoney(amount: number, currency: string, maxFractionDigits = 2): string {
  const code = currency.trim();
  const number = amount.toLocaleString('en-US', {
    minimumFractionDigits: Math.min(2, maxFractionDigits),
    maximumFractionDigits: maxFractionDigits,
  });
  return code.length > 0 ? `${number} ${code}` : number;
}

export function formatMinutes(minutes: number): string {
  const totalSeconds = Math.round(minutes * 60);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
