import { newId, type Segment } from '../types';

export function createSegment(
  projectId: string,
  order: number,
  init: Partial<Omit<Segment, 'id' | 'projectId' | 'order'>> = {},
): Segment {
  const target = init.target ?? '';
  const status = init.status ?? (target.trim() === '' ? 'empty' : 'draft');
  return {
    id: newId(),
    projectId,
    order,
    paragraph: init.paragraph ?? order,
    source: init.source ?? '',
    target,
    status,
    start: init.start ?? null,
    end: init.end ?? null,
    confirmedAt: status === 'confirmed' ? (init.confirmedAt ?? Date.now()) : null,
    updatedAt: init.updatedAt ?? Date.now(),
  };
}

/** Gives segments gap-free `order` values following their array position. Returns only the ones that changed. */
export function renumber(segments: Segment[]): Segment[] {
  const changed: Segment[] = [];
  segments.forEach((segment, index) => {
    if (segment.order !== index) {
      segment.order = index;
      changed.push(segment);
    }
  });
  return changed;
}

/**
 * Rebuilds paragraphs from segments: segments that share a paragraph number are joined with a space,
 * and gaps in the numbering become blank paragraphs (so blank lines of the original survive export).
 */
export function assembleParagraphs(segments: Segment[], pick: (segment: Segment) => string): string[] {
  const paragraphs: string[] = [];
  let currentNumber: number | null = null;
  let parts: string[] = [];
  const flush = () => {
    if (currentNumber !== null) paragraphs.push(parts.filter((part) => part.length > 0).join(' '));
    parts = [];
  };
  for (const segment of segments) {
    if (currentNumber === null || segment.paragraph !== currentNumber) {
      flush();
      if (currentNumber !== null && segment.paragraph > currentNumber + 1) {
        // One blank paragraph for a gap, however large (multiple blank lines are collapsed on import).
        paragraphs.push('');
      }
      currentNumber = segment.paragraph;
    }
    parts.push(pick(segment).trim());
  }
  flush();
  return paragraphs;
}
