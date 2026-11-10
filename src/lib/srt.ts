import { toLatinDigits } from './chars';

export interface Cue {
  /** Seconds */
  start: number;
  /** Seconds */
  end: number;
  text: string;
}

const TIME_PART = '(?:\\d+:)?\\d{1,2}:\\d{1,2}(?:[,.]\\d{1,3})?';
const TIME_LINE = new RegExp(`^\\s*(${TIME_PART})\\s*-->\\s*(${TIME_PART})`);

/**
 * Parses "01:02:03,456", "02:03.456", "83.5", "1:23" … into seconds.
 * Accepts Persian digits and either , or . before the milliseconds. Returns null when it is not a time.
 */
export function parseTimestamp(input: string): number | null {
  const text = toLatinDigits(input.trim()).replace(',', '.');
  if (text === '') return null;
  const parts = text.split(':');
  if (parts.length > 3) return null;
  const last = parts[parts.length - 1];
  if (!/^\d+(\.\d+)?$/.test(last)) return null;
  for (const part of parts.slice(0, -1)) {
    if (!/^\d+$/.test(part)) return null;
  }
  let seconds = 0;
  for (const part of parts) seconds = seconds * 60 + Number(part);
  return Number.isFinite(seconds) ? seconds : null;
}

function splitMs(seconds: number): { h: number; m: number; s: number; ms: number } {
  const total = Math.max(0, Math.round(seconds * 1000));
  return {
    h: Math.floor(total / 3_600_000),
    m: Math.floor((total % 3_600_000) / 60_000),
    s: Math.floor((total % 60_000) / 1000),
    ms: total % 1000,
  };
}

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

/** "HH:MM:SS,mmm" (SRT) or, with separator ".", "HH:MM:SS.mmm" (WebVTT). */
export function formatTimestamp(seconds: number, separator: ',' | '.' = ','): string {
  const { h, m, s, ms } = splitMs(seconds);
  return `${pad(h)}:${pad(m)}:${pad(s)}${separator}${pad(ms, 3)}`;
}

/** Compact clock for the UI: "1:05.250", or "1:02:05.250" from one hour up. */
export function formatClock(seconds: number, withMs = true): string {
  const { h, m, s, ms } = splitMs(seconds);
  const tail = withMs ? `.${pad(ms, 3)}` : '';
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}${tail}` : `${m}:${pad(s)}${tail}`;
}

/**
 * Tolerant parser for SubRip (.srt) and WebVTT (.vtt): handles a BOM, CRLF line ends, "," or "."
 * before milliseconds, missing cue numbers, cue settings after the timestamps and multi-line cues.
 */
export function parseSubtitles(input: string): Cue[] {
  const lines = input
    .replace(/^\u{FEFF}/u, '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const cues: Cue[] = [];
  let i = 0;
  while (i < lines.length) {
    const match = TIME_LINE.exec(lines[i]);
    if (!match) {
      i++;
      continue;
    }
    const start = parseTimestamp(match[1]);
    const end = parseTimestamp(match[2]);
    i++;
    const textLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== '') {
      // A cue number directly followed by a timestamp line starts the next cue (missing blank line).
      if (/^\s*\d+\s*$/.test(lines[i]) && i + 1 < lines.length && TIME_LINE.test(lines[i + 1])) break;
      if (TIME_LINE.test(lines[i])) break;
      textLines.push(lines[i].trim());
      i++;
    }
    if (start !== null && end !== null) {
      cues.push({ start, end: Math.max(start, end), text: textLines.join('\n') });
    }
  }
  return cues;
}

function cleanCueText(text: string): string {
  // Blank lines would end the cue early in every player.
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join('\n');
}

export interface SubtitleExportOptions {
  /**
   * Wraps every line in RIGHT-TO-LEFT EMBEDDING … POP DIRECTIONAL FORMATTING so that players
   * without bidi support keep Persian punctuation on the correct side.
   */
  rtlMarks?: boolean;
}

function decorate(text: string, options: SubtitleExportOptions): string {
  const cleaned = cleanCueText(text);
  if (!options.rtlMarks) return cleaned;
  return cleaned
    .split('\n')
    .map((line) => `\u{202B}${line}\u{202C}`)
    .join('\n');
}

/** Cues with empty text are skipped; the remaining ones are numbered from 1. */
export function formatSrt(cues: Cue[], options: SubtitleExportOptions = {}): string {
  const blocks: string[] = [];
  let index = 1;
  for (const cue of cues) {
    const text = decorate(cue.text, options);
    if (text === '') continue;
    blocks.push(`${index}\n${formatTimestamp(cue.start, ',')} --> ${formatTimestamp(cue.end, ',')}\n${text}`);
    index++;
  }
  return blocks.length === 0 ? '' : blocks.join('\n\n') + '\n';
}

export function formatVtt(cues: Cue[], options: SubtitleExportOptions = {}): string {
  const blocks: string[] = ['WEBVTT'];
  for (const cue of cues) {
    // "-->" inside cue text is illegal in WebVTT.
    const text = decorate(cue.text, options).replace(/-->/g, '→');
    if (text === '') continue;
    blocks.push(`${formatTimestamp(cue.start, '.')} --> ${formatTimestamp(cue.end, '.')}\n${text}`);
  }
  return blocks.join('\n\n') + '\n';
}

/** Plain transcript: one cue per line, optionally prefixed with "[HH:MM:SS]". */
export function formatTranscript(cues: Cue[], withTimestamps: boolean): string {
  const lines: string[] = [];
  for (const cue of cues) {
    const text = cleanCueText(cue.text).replace(/\n/g, ' ');
    if (text === '') continue;
    lines.push(withTimestamps ? `[${formatTimestamp(cue.start, '.').slice(0, 8)}] ${text}` : text);
  }
  return lines.length === 0 ? '' : lines.join('\n') + '\n';
}
