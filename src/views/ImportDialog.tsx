import { useMemo, useState } from 'preact/hooks';
import { readImportFile, toImportedSegments, type ImportedSegment, type ImportSource } from '../lib/importers';
import type { SplitMode } from '../lib/segmenter';
import { formatClock } from '../lib/srt';
import { langDir, langName, type Lang } from '../types';
import { errorMessage, FileButton, Modal } from '../ui';

export type ImportMode = 'append' | 'replace';

interface Props {
  existingCount: number;
  srcLang: Lang;
  /** Number of entries in the translation memory (the pre-translate option is hidden when it is empty). */
  tmSize: number;
  onImport: (items: ImportedSegment[], mode: ImportMode, pretranslate: boolean) => Promise<void>;
  onClose: () => void;
}

export function ImportDialog({ existingCount, srcLang, tmSize, onImport, onClose }: Props) {
  const [pretranslate, setPretranslate] = useState(true);
  const [tab, setTab] = useState<'file' | 'paste'>('file');
  const [fileSource, setFileSource] = useState<ImportSource | null>(null);
  const [pasted, setPasted] = useState('');
  const [splitMode, setSplitMode] = useState<SplitMode>('sentence');
  const [mode, setMode] = useState<ImportMode>('append');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const source: ImportSource | null =
    tab === 'file' ? fileSource : pasted.trim() === '' ? null : { kind: 'text', label: 'Pasted text', text: pasted };

  const items = useMemo(() => (source ? toImportedSegments(source, splitMode) : []), [source, splitMode]);
  const paragraphs = useMemo(() => new Set(items.map((item) => item.paragraph)).size, [items]);

  const pickFile = async (file: File) => {
    setError('');
    setBusy(true);
    try {
      setFileSource(await readImportFile(file));
    } catch (e) {
      setFileSource(null);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (items.length === 0) return;
    setBusy(true);
    setError('');
    try {
      await onImport(items, existingCount === 0 ? 'replace' : mode, pretranslate && tmSize > 0);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const isSubtitles = source?.kind === 'subtitles';

  return (
    <Modal title="Import source text" onClose={onClose} wide>
      <div class="modal-body">
        <div class="tabs" style={{ marginBottom: '14px' }}>
          <button class={`tab ${tab === 'file' ? 'active' : ''}`} onClick={() => setTab('file')}>
            Upload a file
          </button>
          <button class={`tab ${tab === 'paste' ? 'active' : ''}`} onClick={() => setTab('paste')}>
            Paste text
          </button>
        </div>

        {tab === 'file' ? (
          <div class="row">
            <FileButton
              label={fileSource ? 'Choose another file…' : 'Choose file…'}
              accept=".txt,.docx,.srt,.vtt,text/plain"
              onFile={pickFile}
              class="primary"
              disabled={busy}
            />
            <span class="muted">
              {fileSource ? (
                <span dir="auto">{fileSource.label}</span>
              ) : (
                '.txt, .docx or .srt (subtitles keep their timestamps)'
              )}
            </span>
          </div>
        ) : (
          <div class="field">
            <label for="imp-paste">{langName(srcLang)} source text</label>
            <textarea
              id="imp-paste"
              class="textarea"
              style={{ minHeight: '160px' }}
              dir={langDir(srcLang)}
              lang={srcLang}
              value={pasted}
              onInput={(e) => setPasted(e.currentTarget.value)}
              data-autofocus
            />
          </div>
        )}

        <div class="form-grid" style={{ marginTop: '14px' }}>
          <div class="field">
            <label for="imp-split">Split into segments</label>
            <select
              id="imp-split"
              class="select"
              value={splitMode}
              disabled={isSubtitles}
              onChange={(e) => setSplitMode(e.currentTarget.value as SplitMode)}
            >
              <option value="sentence">By sentence — at . ! ? ؟ and line breaks</option>
              <option value="clause">By clause — also at ، and ؛</option>
              <option value="paragraph">By paragraph — at line breaks only</option>
            </select>
            {isSubtitles && <span class="hint">Subtitle files are imported cue by cue.</span>}
          </div>
          {existingCount > 0 && (
            <div class="field">
              <span class="label">This project already has {existingCount} segments</span>
              <label class="check">
                <input type="radio" name="imp-mode" checked={mode === 'append'} onChange={() => setMode('append')} />
                <span>Add the new segments after them</span>
              </label>
              <label class="check">
                <input type="radio" name="imp-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />
                <span>Replace them (their translations are deleted)</span>
              </label>
            </div>
          )}
        </div>

        {tmSize > 0 && (
          <label class="check" style={{ marginTop: '12px' }}>
            <input type="checkbox" checked={pretranslate} onChange={(e) => setPretranslate(e.currentTarget.checked)} />
            <span>
              Pre-translate from the translation memory
              <span class="muted small"> — exact matches are filled in as drafts for you to confirm</span>
            </span>
          </label>
        )}

        {error && (
          <div class="notice err" style={{ marginTop: '14px' }}>
            {error}
          </div>
        )}

        {source && (
          <div style={{ marginTop: '14px' }}>
            <div class="row" style={{ marginBottom: '6px' }}>
              <strong>
                {items.length} segment{items.length === 1 ? '' : 's'}
              </strong>
              <span class="muted">
                in {paragraphs} {isSubtitles ? 'cue' : 'paragraph'}
                {paragraphs === 1 ? '' : 's'}
              </span>
            </div>
            {items.slice(0, 6).map((item, index) => (
              <div
                key={index}
                class="row"
                style={{ alignItems: 'baseline', padding: '4px 0', borderTop: '1px solid var(--border)', flexWrap: 'nowrap' }}
              >
                <span class="muted small mono" style={{ minWidth: item.start === null ? '22px' : '64px' }}>
                  {item.start === null ? index + 1 : formatClock(item.start, false)}
                </span>
                <span class="pre-wrap" dir={langDir(srcLang)} lang={srcLang} style={{ flex: 1 }}>
                  {item.text}
                </span>
              </div>
            ))}
            {items.length > 6 && <div class="muted small">… and {items.length - 6} more</div>}
          </div>
        )}
      </div>
      <div class="modal-foot">
        <button class="btn" onClick={onClose}>
          Cancel
        </button>
        <button class={`btn ${mode === 'replace' && existingCount > 0 ? 'danger' : 'primary'}`} disabled={busy || items.length === 0} onClick={run}>
          {mode === 'replace' && existingCount > 0
            ? `Replace with ${items.length} segments`
            : `Import ${items.length} segment${items.length === 1 ? '' : 's'}`}
        </button>
      </div>
    </Modal>
  );
}
