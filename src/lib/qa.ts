import { sourceLang, targetLang, type Direction, type GlossaryTerm, type Segment } from '../types';
import { hasLatin, hasPersian, toLatinDigits } from './chars';
import { normalizeForMatch } from './fuzzy';
import { containsTerm, findTerms } from './glossary';

export type QACheck = 'empty' | 'numbers' | 'glossary' | 'spaces' | 'brackets' | 'copied' | 'timing' | 'unconfirmed';
export type QASeverity = 'error' | 'warning' | 'info';
/** `translation` compares target with source; `transcript` checks the source text alone. */
export type QAScope = 'translation' | 'transcript';

export interface QAIssue {
  segmentId: string;
  order: number;
  check: QACheck;
  severity: QASeverity;
  message: string;
}

export interface QAContext {
  direction: Direction;
  terms: GlossaryTerm[];
  scope: QAScope;
}

export const QA_LABELS: Record<QACheck, string> = {
  empty: 'Empty / untranslated',
  numbers: 'Numbers',
  glossary: 'Glossary',
  spaces: 'Spaces',
  brackets: 'Brackets & quotes',
  copied: 'Source copied',
  timing: 'Timing',
  unconfirmed: 'Not confirmed',
};

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/**
 * Extracts the numbers of a text in a canonical form so that the same value compares equal whatever
 * the script or formatting: «۱۲٬۵۰۰», «12,500» and «۱۲۵۰۰» all give ["12500"]; «۳٫۵», «3.5» and «۳/۵»
 * (the slash is a common Persian decimal mark) all give ["3", "5"].
 */
export function extractNumbers(text: string): string[] {
  let t = toLatinDigits(text)
    .replace(/\u{066B}/gu, '.') // ARABIC DECIMAL SEPARATOR
    .replace(/\u{066C}/gu, ','); // ARABIC THOUSANDS SEPARATOR
  // Join thousands groups: 12,500 · 1,234,567 · ۱۲،۵۰۰ (Persian comma used as a separator)
  t = t.replace(/(^|[^\d,،])(\d{1,3}(?:[,،]\d{3})+)(?!\d)/g, (_match, pre: string, grouped: string) => {
    return pre + grouped.replace(/[,،]/g, '');
  });
  return t.match(/\d+/g) ?? [];
}

export interface NumberDiff {
  /** In the source but not in the target. */
  missing: string[];
  /** In the target but not in the source. */
  extra: string[];
}

export function compareNumbers(source: string, target: string): NumberDiff {
  const remaining = new Map<string, number>();
  for (const number of extractNumbers(source)) remaining.set(number, (remaining.get(number) ?? 0) + 1);
  const extra: string[] = [];
  for (const number of extractNumbers(target)) {
    const left = remaining.get(number) ?? 0;
    if (left > 0) remaining.set(number, left - 1);
    else extra.push(number);
  }
  const missing: string[] = [];
  for (const [number, count] of remaining) for (let i = 0; i < count; i++) missing.push(number);
  return { missing, extra };
}

// ---------------------------------------------------------------------------
// Brackets and quotation marks
// ---------------------------------------------------------------------------

const CLOSER_TO_OPENER: Record<string, string> = { ')': '(', ']': '[', '}': '{', '»': '«' };
const OPENERS = new Set(Object.values(CLOSER_TO_OPENER));

/** Returns one message per bracket / quote problem found in `text` (empty when everything is balanced). */
export function checkBrackets(text: string): string[] {
  const problems: string[] = [];
  const stack: string[] = [];
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const previous = chars[i - 1];
    if ((ch === ')' || ch === '(') && (previous === ':' || previous === ';')) continue; // :) ;( emoticons
    if (OPENERS.has(ch)) {
      stack.push(ch);
    } else if (ch in CLOSER_TO_OPENER) {
      if (stack[stack.length - 1] === CLOSER_TO_OPENER[ch]) {
        stack.pop();
      } else if (ch === ')' && /(^|\s)[\p{L}\p{N}]{1,3}$/u.test(chars.slice(0, i).join(''))) {
        // List markers such as "1)", "a)" or «الف)» are not unbalanced brackets.
      } else {
        problems.push(`Closing “${ch}” has no matching “${CLOSER_TO_OPENER[ch]}”.`);
      }
    }
  }
  for (const opener of stack) problems.push(`Opening “${opener}” is never closed.`);

  const count = (needle: string) => chars.filter((ch) => ch === needle).length;
  if (count('“') !== count('”')) problems.push('Curly quotation marks “ ” are not balanced.');
  if (count('"') % 2 === 1) problems.push('Odd number of straight quotation marks (").');
  return problems;
}

function countPairs(text: string, opener: string): number {
  return Array.from(text).filter((ch) => ch === opener).length;
}

// ---------------------------------------------------------------------------
// Per-segment checks
// ---------------------------------------------------------------------------

function spaceIssues(text: string, what: string): { severity: QASeverity; message: string }[] {
  const issues: { severity: QASeverity; message: string }[] = [];
  // Two or more spaces (ordinary or no-break) in a row, anywhere inside the text
  if (/[ \u{00A0}]{2,}/u.test(text.trim())) {
    issues.push({ severity: 'warning', message: `Double space in the ${what}.` });
  }
  if (text !== text.trim()) {
    issues.push({ severity: 'info', message: `The ${what} starts or ends with a space.` });
  }
  return issues;
}

function timingIssues(segment: Segment, previous: Segment | null): string[] {
  const problems: string[] = [];
  if (segment.start === null) return problems;
  if (segment.end !== null && segment.end <= segment.start) problems.push('End time is not after the start time.');
  if (previous && previous.end !== null && segment.start < previous.end - 0.05) {
    problems.push(`Overlaps segment ${previous.order + 1} in time.`);
  }
  return problems;
}

/** Checks one segment. `previousTimed` is the closest earlier segment that has timestamps. */
export function checkSegment(segment: Segment, context: QAContext, previousTimed: Segment | null = null): QAIssue[] {
  const issues: QAIssue[] = [];
  const add = (check: QACheck, severity: QASeverity, message: string) => {
    issues.push({ segmentId: segment.id, order: segment.order, check, severity, message });
  };
  const source = segment.source;
  const target = segment.target;

  for (const problem of timingIssues(segment, previousTimed)) add('timing', 'warning', problem);

  if (context.scope === 'transcript') {
    if (source.trim() === '') {
      add('empty', 'error', 'Empty segment: there is no transcript text.');
      return issues;
    }
    for (const issue of spaceIssues(source, 'text')) add('spaces', issue.severity, issue.message);
    for (const problem of checkBrackets(source)) add('brackets', 'warning', problem);
    return issues;
  }

  if (source.trim() === '' && target.trim() === '') return issues;
  if (target.trim() === '') {
    add('empty', 'error', 'Not translated: the target is empty.');
    return issues;
  }

  const srcLang = sourceLang(context.direction);
  const tgtLang = targetLang(context.direction);

  // Source copied unchanged — only meaningful when the source contains text in the source language.
  // Compared in folded form, so a copy is still recognised after one side was normalized (ي→ی, ۱→1 …).
  const sourceHasWords = srcLang === 'fa' ? hasPersian(source) : hasLatin(source);
  if (sourceHasWords && normalizeForMatch(target) === normalizeForMatch(source)) {
    add('copied', 'warning', 'The target is identical to the source (copied, not translated).');
  }

  const numbers = compareNumbers(source, target);
  if (numbers.missing.length > 0 || numbers.extra.length > 0) {
    const parts: string[] = [];
    if (numbers.missing.length > 0) parts.push(`missing in target: ${numbers.missing.join(', ')}`);
    if (numbers.extra.length > 0) parts.push(`not in source: ${numbers.extra.join(', ')}`);
    add('numbers', 'warning', `Numbers differ — ${parts.join('; ')}.`);
  }

  const reported = new Set<string>();
  for (const hit of findTerms(source, context.terms, srcLang)) {
    const sourceTerm = srcLang === 'fa' ? hit.terms[0].fa : hit.terms[0].en;
    if (reported.has(sourceTerm)) continue;
    reported.add(sourceTerm);
    const accepted = hit.terms.map((term) => (tgtLang === 'fa' ? term.fa : term.en)).filter((t) => t.trim() !== '');
    if (accepted.length === 0) continue;
    if (!accepted.some((translation) => containsTerm(target, translation, tgtLang))) {
      add('glossary', 'warning', `Glossary term not used: «${sourceTerm}» → “${accepted.join('” or “')}”.`);
    }
  }

  for (const issue of spaceIssues(target, 'target')) add('spaces', issue.severity, issue.message);

  const bracketProblems = checkBrackets(target);
  for (const problem of bracketProblems) add('brackets', 'warning', problem);
  if (bracketProblems.length === 0 && checkBrackets(source).length === 0) {
    for (const [opener, closer] of [
      ['(', ')'],
      ['[', ']'],
    ]) {
      const inSource = countPairs(source, opener);
      const inTarget = countPairs(target, opener);
      if (inSource !== inTarget) {
        add('brackets', 'info', `The source has ${inSource} “${opener} ${closer}” pair(s), the target has ${inTarget}.`);
      }
    }
  }

  if (segment.status !== 'confirmed') add('unconfirmed', 'info', 'Translated but not confirmed yet.');
  return issues;
}

/** Runs every check on every segment, in document order. */
export function runQA(segments: Segment[], context: QAContext): QAIssue[] {
  const issues: QAIssue[] = [];
  let previousTimed: Segment | null = null;
  for (const segment of [...segments].sort((a, b) => a.order - b.order)) {
    issues.push(...checkSegment(segment, context, previousTimed));
    if (segment.start !== null) previousTimed = segment;
  }
  return issues;
}

/** Transcription-only jobs (timed segments, nothing translated yet) are checked as a transcript by default. */
export function defaultScope(segments: Segment[]): QAScope {
  const anyTimed = segments.some((segment) => segment.start !== null);
  const anyTranslated = segments.some((segment) => segment.target.trim() !== '');
  return anyTimed && !anyTranslated ? 'transcript' : 'translation';
}
