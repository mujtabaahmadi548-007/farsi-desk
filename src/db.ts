import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { GlossaryTerm, MediaRecord, Project, Segment, TMEntry } from './types';

export type StoreName = 'projects' | 'segments' | 'tm' | 'glossary' | 'settings' | 'media';

interface SettingRecord {
  key: string;
  value: unknown;
}

interface FarsiDeskDB extends DBSchema {
  projects: { key: string; value: Project };
  segments: { key: string; value: Segment; indexes: { byProject: string } };
  tm: { key: string; value: TMEntry; indexes: { bySegment: string } };
  glossary: { key: string; value: GlossaryTerm };
  settings: { key: string; value: SettingRecord };
  media: { key: string; value: MediaRecord };
}

const DB_NAME = 'farsi-desk';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<FarsiDeskDB>> | null = null;

function db(): Promise<IDBPDatabase<FarsiDeskDB>> {
  if (!dbPromise) {
    dbPromise = openDB<FarsiDeskDB>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        database.createObjectStore('projects', { keyPath: 'id' });
        const segments = database.createObjectStore('segments', { keyPath: 'id' });
        segments.createIndex('byProject', 'projectId');
        const tm = database.createObjectStore('tm', { keyPath: 'id' });
        tm.createIndex('bySegment', 'segmentId');
        database.createObjectStore('glossary', { keyPath: 'id' });
        database.createObjectStore('settings', { keyPath: 'key' });
        database.createObjectStore('media', { keyPath: 'projectId' });
      },
    });
  }
  return dbPromise;
}

// ---------------------------------------------------------------------------
// Change notifications (so views can refresh after writes made elsewhere)
// ---------------------------------------------------------------------------

type Listener = (stores: StoreName[]) => void;
const listeners = new Set<Listener>();

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(...stores: StoreName[]): void {
  for (const listener of [...listeners]) listener(stores);
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export async function listProjects(): Promise<Project[]> {
  const all = await (await db()).getAll('projects');
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProject(id: string): Promise<Project | undefined> {
  return (await db()).get('projects', id);
}

export async function saveProject(project: Project): Promise<void> {
  await (await db()).put('projects', { ...project, updatedAt: Date.now() });
  notify('projects');
}

export async function deleteProject(id: string): Promise<void> {
  const database = await db();
  const tx = database.transaction(['projects', 'segments', 'media'], 'readwrite');
  await tx.objectStore('projects').delete(id);
  const keys = await tx.objectStore('segments').index('byProject').getAllKeys(id);
  for (const key of keys) await tx.objectStore('segments').delete(key);
  await tx.objectStore('media').delete(id);
  await tx.done;
  notify('projects', 'segments', 'media');
}

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

export async function listSegments(projectId: string): Promise<Segment[]> {
  const all = await (await db()).getAllFromIndex('segments', 'byProject', projectId);
  return all.sort((a, b) => a.order - b.order);
}

export async function listAllSegments(): Promise<Segment[]> {
  return (await db()).getAll('segments');
}

export async function putSegment(segment: Segment): Promise<void> {
  await (await db()).put('segments', segment);
  notify('segments');
}

export async function putSegments(segments: Segment[]): Promise<void> {
  if (segments.length === 0) return;
  const tx = (await db()).transaction('segments', 'readwrite');
  for (const segment of segments) await tx.store.put(segment);
  await tx.done;
  notify('segments');
}

export async function deleteSegments(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const tx = (await db()).transaction('segments', 'readwrite');
  for (const id of ids) await tx.store.delete(id);
  await tx.done;
  notify('segments');
}

/** Replaces every segment of a project in one transaction. */
export async function replaceProjectSegments(projectId: string, segments: Segment[]): Promise<void> {
  const tx = (await db()).transaction('segments', 'readwrite');
  const keys = await tx.store.index('byProject').getAllKeys(projectId);
  for (const key of keys) await tx.store.delete(key);
  for (const segment of segments) await tx.store.put(segment);
  await tx.done;
  notify('segments');
}

// ---------------------------------------------------------------------------
// Translation memory
// ---------------------------------------------------------------------------

export async function listTM(): Promise<TMEntry[]> {
  const all = await (await db()).getAll('tm');
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getTMEntryForSegment(segmentId: string): Promise<TMEntry | undefined> {
  return (await db()).getFromIndex('tm', 'bySegment', segmentId);
}

export async function putTMEntries(entries: TMEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const tx = (await db()).transaction('tm', 'readwrite');
  for (const entry of entries) await tx.store.put(entry);
  await tx.done;
  notify('tm');
}

export async function deleteTMEntries(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const tx = (await db()).transaction('tm', 'readwrite');
  for (const id of ids) await tx.store.delete(id);
  await tx.done;
  notify('tm');
}

export async function clearTM(): Promise<void> {
  await (await db()).clear('tm');
  notify('tm');
}

// ---------------------------------------------------------------------------
// Glossary
// ---------------------------------------------------------------------------

export async function listGlossary(): Promise<GlossaryTerm[]> {
  const all = await (await db()).getAll('glossary');
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function putTerms(terms: GlossaryTerm[]): Promise<void> {
  if (terms.length === 0) return;
  const tx = (await db()).transaction('glossary', 'readwrite');
  for (const term of terms) await tx.store.put(term);
  await tx.done;
  notify('glossary');
}

export async function deleteTerm(id: string): Promise<void> {
  await (await db()).delete('glossary', id);
  notify('glossary');
}

export async function clearGlossary(): Promise<void> {
  await (await db()).clear('glossary');
  notify('glossary');
}

// ---------------------------------------------------------------------------
// Settings (small key/value records)
// ---------------------------------------------------------------------------

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const record = await (await db()).get('settings', key);
  return record === undefined ? fallback : (record.value as T);
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  await (await db()).put('settings', { key, value });
  notify('settings');
}

// ---------------------------------------------------------------------------
// Media (audio / video blobs, one per project)
// ---------------------------------------------------------------------------

export async function getMedia(projectId: string): Promise<MediaRecord | undefined> {
  return (await db()).get('media', projectId);
}

export async function putMedia(record: MediaRecord): Promise<void> {
  await (await db()).put('media', record);
  notify('media');
}

export async function deleteMedia(projectId: string): Promise<void> {
  await (await db()).delete('media', projectId);
  notify('media');
}

// ---------------------------------------------------------------------------
// Backup: everything in one JSON file
// ---------------------------------------------------------------------------

export interface BackupMedia {
  projectId: string;
  name: string;
  type: string;
  dataBase64: string;
}

export interface BackupFile {
  app: 'farsi-desk';
  formatVersion: 1;
  exportedAt: string;
  projects: Project[];
  segments: Segment[];
  tm: TMEntry[];
  glossary: GlossaryTerm[];
  settings: SettingRecord[];
  media: BackupMedia[];
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Could not read media file'));
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64: string, type: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

export async function exportBackup(includeMedia: boolean): Promise<BackupFile> {
  const database = await db();
  const [projects, segments, tm, glossary, settings] = await Promise.all([
    database.getAll('projects'),
    database.getAll('segments'),
    database.getAll('tm'),
    database.getAll('glossary'),
    database.getAll('settings'),
  ]);
  const media: BackupMedia[] = [];
  if (includeMedia) {
    for (const record of await database.getAll('media')) {
      media.push({
        projectId: record.projectId,
        name: record.name,
        type: record.type,
        dataBase64: await blobToBase64(record.blob),
      });
    }
  }
  return {
    app: 'farsi-desk',
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    projects,
    segments,
    tm,
    glossary,
    settings,
    media,
  };
}

function isRecordArray(value: unknown, requiredKeys: string[]): value is Record<string, unknown>[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === 'object' && item !== null && requiredKeys.every((key) => key in (item as object)),
    )
  );
}

/** Validates the shape of a parsed backup file. Throws a readable error when it is not usable. */
export function parseBackup(raw: unknown): BackupFile {
  if (typeof raw !== 'object' || raw === null) throw new Error('This file is not a Farsi Desk backup.');
  const file = raw as Record<string, unknown>;
  if (file.app !== 'farsi-desk') throw new Error('This file is not a Farsi Desk backup.');
  if (file.formatVersion !== 1) {
    throw new Error(`Unsupported backup version (${String(file.formatVersion)}).`);
  }
  if (!isRecordArray(file.projects, ['id', 'name', 'direction'])) throw new Error('Backup is damaged: projects.');
  if (!isRecordArray(file.segments, ['id', 'projectId', 'source', 'target'])) {
    throw new Error('Backup is damaged: segments.');
  }
  if (!isRecordArray(file.tm, ['id', 'fa', 'en'])) throw new Error('Backup is damaged: translation memory.');
  if (!isRecordArray(file.glossary, ['id', 'fa', 'en'])) throw new Error('Backup is damaged: glossary.');
  if (!isRecordArray(file.settings, ['key'])) throw new Error('Backup is damaged: settings.');
  const media = file.media === undefined ? [] : file.media;
  if (!isRecordArray(media, ['projectId', 'dataBase64'])) throw new Error('Backup is damaged: media.');
  return { ...(file as unknown as BackupFile), media: media as unknown as BackupMedia[] };
}

export async function importBackup(file: BackupFile, mode: 'replace' | 'merge'): Promise<void> {
  const database = await db();
  const stores: StoreName[] = ['projects', 'segments', 'tm', 'glossary', 'settings', 'media'];
  // Decode media before opening the transaction: a transaction auto-closes
  // when control returns to the event loop with nothing pending on it.
  const mediaRecords: MediaRecord[] = file.media.map((item) => ({
    projectId: item.projectId,
    name: item.name,
    type: item.type,
    blob: base64ToBlob(item.dataBase64, item.type),
  }));
  const tx = database.transaction(stores, 'readwrite');
  if (mode === 'replace') {
    for (const store of stores) await tx.objectStore(store).clear();
  }
  for (const item of file.projects) await tx.objectStore('projects').put(item);
  for (const item of file.segments) await tx.objectStore('segments').put(item);
  for (const item of file.tm) await tx.objectStore('tm').put(item);
  for (const item of file.glossary) await tx.objectStore('glossary').put(item);
  for (const item of file.settings) await tx.objectStore('settings').put(item);
  for (const item of mediaRecords) await tx.objectStore('media').put(item);
  await tx.done;
  notify(...stores);
}

export async function wipeAllData(): Promise<void> {
  const database = await db();
  const stores: StoreName[] = ['projects', 'segments', 'tm', 'glossary', 'settings', 'media'];
  const tx = database.transaction(stores, 'readwrite');
  for (const store of stores) await tx.objectStore(store).clear();
  await tx.done;
  notify(...stores);
}
