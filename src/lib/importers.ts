import { readDocxParagraphs } from './docx';
import { decodeText } from './download';
import { segmentText, type SplitMode } from './segmenter';
import { parseSubtitles, type Cue } from './srt';

/** What a file or pasted text was read into, before it is cut into segments. */
export type ImportSource =
  | { kind: 'text'; label: string; text: string }
  | { kind: 'subtitles'; label: string; cues: Cue[] };

export interface ImportedSegment {
  text: string;
  paragraph: number;
  start: number | null;
  end: number | null;
}

function extension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

/** Reads a .txt, .docx, .srt or .vtt file. Throws an Error with a user-readable message on failure. */
export async function readImportFile(file: File): Promise<ImportSource> {
  const ext = extension(file.name);
  const buffer = await file.arrayBuffer();
  if (ext === 'docx') {
    return { kind: 'text', label: file.name, text: readDocxParagraphs(buffer).join('\n') };
  }
  if (ext === 'doc') {
    throw new Error('Old .doc files are not supported. Open the file in Word and save it as .docx.');
  }
  if (ext === 'srt' || ext === 'vtt') {
    const cues = parseSubtitles(decodeText(buffer));
    if (cues.length === 0) throw new Error('No subtitle cues were found in this file.');
    return { kind: 'subtitles', label: file.name, cues };
  }
  if (ext === 'txt' || ext === '' || file.type.startsWith('text/')) {
    return { kind: 'text', label: file.name, text: decodeText(buffer) };
  }
  throw new Error(`“.${ext}” files are not supported. Use .txt, .docx or .srt.`);
}

/** Cuts an import source into segments. Subtitle cues are kept one-to-one with their timing. */
export function toImportedSegments(source: ImportSource, mode: SplitMode): ImportedSegment[] {
  if (source.kind === 'subtitles') {
    return source.cues
      .filter((cue) => cue.text.trim() !== '')
      .map((cue, index) => ({ text: cue.text, paragraph: index, start: cue.start, end: cue.end }));
  }
  return segmentText(source.text, mode).map((segment) => ({
    text: segment.text,
    paragraph: segment.paragraph,
    start: null,
    end: null,
  }));
}
