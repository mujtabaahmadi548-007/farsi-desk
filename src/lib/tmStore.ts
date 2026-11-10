import { getTMEntryForSegment, listTM, putTMEntries } from '../db';
import { newId, type Project, type Segment, type TMEntry } from '../types';
import type { TmxPair } from './tmx';

function entryFor(project: Project, segment: Segment, existing: TMEntry | undefined, now: number): TMEntry {
  const sourceIsPersian = project.direction === 'fa-en';
  return {
    id: existing?.id ?? newId(),
    fa: (sourceIsPersian ? segment.source : segment.target).trim(),
    en: (sourceIsPersian ? segment.target : segment.source).trim(),
    direction: project.direction,
    projectId: project.id,
    segmentId: segment.id,
    origin: project.name,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

/**
 * Stores a confirmed segment in the translation memory. Each segment owns one entry:
 * confirming it again after an edit updates that entry instead of adding a duplicate.
 */
export async function saveSegmentToTM(project: Project, segment: Segment): Promise<TMEntry | null> {
  if (segment.source.trim() === '' || segment.target.trim() === '') return null;
  const existing = await getTMEntryForSegment(segment.id);
  const entry = entryFor(project, segment, existing, Date.now());
  await putTMEntries([entry]);
  return entry;
}

/**
 * After a bulk change (the normalizer), brings the TM entries of confirmed segments in line with
 * their new text. Segments without an entry, or that are no longer confirmed, are left alone.
 */
export async function refreshTMForSegments(project: Project, segments: Segment[]): Promise<number> {
  const now = Date.now();
  const updates: TMEntry[] = [];
  for (const segment of segments) {
    if (segment.status !== 'confirmed' || segment.source.trim() === '' || segment.target.trim() === '') continue;
    const existing = await getTMEntryForSegment(segment.id);
    if (!existing) continue;
    const entry = entryFor(project, segment, existing, now);
    if (entry.fa !== existing.fa || entry.en !== existing.en) updates.push(entry);
  }
  await putTMEntries(updates);
  return updates.length;
}

/** Adds imported TMX pairs, skipping pairs the memory already contains. Returns how many were added. */
export async function addTmxPairs(pairs: TmxPair[], fileName: string): Promise<number> {
  const existing = await listTM();
  const have = new Set(existing.map((entry) => `${entry.fa}\u0000${entry.en}`));
  const now = Date.now();
  const fresh: TMEntry[] = [];
  for (const pair of pairs) {
    const key = `${pair.fa}\u0000${pair.en}`;
    if (have.has(key)) continue;
    have.add(key);
    fresh.push({
      id: newId(),
      fa: pair.fa,
      en: pair.en,
      direction: pair.direction,
      projectId: null,
      segmentId: null,
      origin: pair.origin !== '' ? pair.origin : fileName,
      createdAt: pair.createdAt ?? now,
      updatedAt: pair.updatedAt ?? pair.createdAt ?? now,
    });
  }
  await putTMEntries(fresh);
  return fresh.length;
}
