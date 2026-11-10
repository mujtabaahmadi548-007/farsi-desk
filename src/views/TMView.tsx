import { useMemo, useState } from 'preact/hooks';
import { clearTM, deleteTMEntries, listTM, putTMEntries } from '../db';
import { useLive } from '../hooks';
import { foldForSearch } from '../lib/chars';
import { decodeText, downloadText } from '../lib/download';
import { formatDate } from '../lib/stats';
import { addTmxPairs } from '../lib/tmStore';
import { exportTmx, parseTmx } from '../lib/tmx';
import { directionLabel, newId, type Direction, type TMEntry } from '../types';
import { confirmDialog, errorMessage, FileButton, Modal, toast } from '../ui';

const PAGE = 200;

function stamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function blankEntry(): TMEntry {
  const now = Date.now();
  return {
    id: newId(),
    fa: '',
    en: '',
    direction: 'fa-en',
    projectId: null,
    segmentId: null,
    origin: 'Added by hand',
    createdAt: now,
    updatedAt: now,
  };
}

function EntryDialog({ entry, isNew, onClose }: { entry: TMEntry; isNew: boolean; onClose: () => void }) {
  const [fa, setFa] = useState(entry.fa);
  const [en, setEn] = useState(entry.en);
  const [direction, setDirection] = useState<Direction>(entry.direction);
  const valid = fa.trim() !== '' && en.trim() !== '';

  const save = async () => {
    if (!valid) return;
    try {
      await putTMEntries([{ ...entry, fa: fa.trim(), en: en.trim(), direction, updatedAt: Date.now() }]);
      toast(isNew ? 'Entry added to the translation memory.' : 'Entry updated.', 'success');
      onClose();
    } catch (error) {
      toast(`Could not save the entry: ${errorMessage(error)}`, 'error');
    }
  };

  return (
    <Modal title={isNew ? 'Add translation memory entry' : 'Edit translation memory entry'} onClose={onClose} wide>
      <div class="modal-body">
        <div class="form-grid">
          <div class="field">
            <label for="tm-fa">Persian</label>
            <textarea
              id="tm-fa"
              class="textarea"
              dir="rtl"
              lang="fa"
              value={fa}
              onInput={(e) => setFa(e.currentTarget.value)}
              data-autofocus
            />
          </div>
          <div class="field">
            <label for="tm-en">English</label>
            <textarea id="tm-en" class="textarea" dir="ltr" lang="en" value={en} onInput={(e) => setEn(e.currentTarget.value)} />
          </div>
          <div class="field">
            <label for="tm-dir">Translated</label>
            <select
              id="tm-dir"
              class="select"
              value={direction}
              onChange={(e) => setDirection(e.currentTarget.value as Direction)}
            >
              <option value="fa-en">from Persian into English</option>
              <option value="en-fa">from English into Persian</option>
            </select>
          </div>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn" onClick={onClose}>
          Cancel
        </button>
        <button class="btn primary" disabled={!valid} onClick={() => void save()}>
          Save
        </button>
      </div>
    </Modal>
  );
}

export function TMView() {
  const entries = useLive(listTM, ['tm'], []);
  const [search, setSearch] = useState('');
  const [direction, setDirection] = useState<'all' | Direction>('all');
  const [limit, setLimit] = useState(PAGE);
  const [dialog, setDialog] = useState<{ entry: TMEntry; isNew: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    if (!entries) return [];
    const query = foldForSearch(search);
    return entries.filter(
      (entry) =>
        (direction === 'all' || entry.direction === direction) &&
        (query === '' || foldForSearch(entry.fa).includes(query) || foldForSearch(entry.en).includes(query)),
    );
  }, [entries, search, direction]);

  const importTmx = async (file: File) => {
    setBusy(true);
    try {
      const result = parseTmx(decodeText(await file.arrayBuffer()));
      const added = await addTmxPairs(result.pairs, file.name);
      const duplicates = result.pairs.length - added;
      toast(
        `Imported ${added} entr${added === 1 ? 'y' : 'ies'} from ${file.name}` +
          (duplicates > 0 ? ` · ${duplicates} already in the memory` : '') +
          (result.skipped > 0 ? ` · ${result.skipped} skipped (no Persian–English pair)` : ''),
        added > 0 ? 'success' : 'info',
      );
    } catch (error) {
      toast(`Could not import the TMX file: ${errorMessage(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const exportAll = () => {
    if (!entries || entries.length === 0) {
      toast('The translation memory is empty — there is nothing to export.');
      return;
    }
    downloadText(exportTmx(entries), `farsi-desk-tm-${stamp()}.tmx`, 'application/xml');
    toast(`Exported ${entries.length} entries as TMX.`, 'success');
  };

  const remove = async (entry: TMEntry) => {
    try {
      await deleteTMEntries([entry.id]);
    } catch (error) {
      toast(`Could not delete the entry: ${errorMessage(error)}`, 'error');
    }
  };

  const clearAll = async () => {
    const ok = await confirmDialog({
      title: 'Delete the whole translation memory?',
      message: `All ${entries?.length ?? 0} entries will be deleted. Export a TMX file first if you want to keep them.`,
      confirmLabel: 'Delete all entries',
      danger: true,
    });
    if (!ok) return;
    try {
      await clearTM();
      toast('Translation memory cleared.', 'success');
    } catch (error) {
      toast(`Could not clear the memory: ${errorMessage(error)}`, 'error');
    }
  };

  return (
    <div>
      <div class="page-header">
        <div>
          <h1>Translation memory</h1>
          <div class="page-sub">
            Shared by all projects. Every segment you confirm is saved here and offered again as an exact or fuzzy
            match.
          </div>
        </div>
        <div class="actions">
          <button class="btn" onClick={() => setDialog({ entry: blankEntry(), isNew: true })}>
            + Add entry
          </button>
          <FileButton label="Import TMX…" accept=".tmx,.xml,application/xml,text/xml" onFile={importTmx} disabled={busy} />
          <button class="btn" onClick={exportAll}>
            Export TMX
          </button>
        </div>
      </div>

      <div class="card">
        <div class="toolbar">
          <input
            class="input"
            type="search"
            dir="auto"
            placeholder="Search Persian or English…"
            aria-label="Search the translation memory"
            value={search}
            onInput={(e) => {
              setSearch(e.currentTarget.value);
              setLimit(PAGE);
            }}
            style={{ minWidth: '260px' }}
          />
          <select
            class="select"
            aria-label="Filter by direction"
            value={direction}
            onChange={(e) => setDirection(e.currentTarget.value as 'all' | Direction)}
          >
            <option value="all">Both directions</option>
            <option value="fa-en">FA → EN</option>
            <option value="en-fa">EN → FA</option>
          </select>
          <span class="muted">
            {entries === undefined
              ? 'Loading…'
              : `${filtered.length.toLocaleString('en-US')} of ${entries.length.toLocaleString('en-US')} entries`}
          </span>
          {entries !== undefined && entries.length > 0 && (
            <button class="btn danger small right" onClick={() => void clearAll()}>
              Delete all…
            </button>
          )}
        </div>

        {entries !== undefined && entries.length === 0 && (
          <div class="empty-state">
            <h3>The translation memory is empty</h3>
            <div>Confirm segments in the editor (Ctrl+Enter), or import a TMX file from another CAT tool.</div>
          </div>
        )}

        {entries !== undefined && entries.length > 0 && filtered.length === 0 && (
          <div class="empty-state">No entries match your search.</div>
        )}

        {filtered.length > 0 && (
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th style={{ width: '38%' }}>Persian</th>
                  <th style={{ width: '38%' }}>English</th>
                  <th>Origin</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, limit).map((entry) => (
                  <tr key={entry.id}>
                    <td class="pre-wrap" dir="rtl" lang="fa">
                      {entry.fa}
                    </td>
                    <td class="pre-wrap" dir="ltr" lang="en">
                      {entry.en}
                    </td>
                    <td class="small">
                      <span class="badge accent">{directionLabel(entry.direction)}</span>
                      <div class="muted" dir="auto">
                        {entry.origin}
                      </div>
                      <div class="muted">{formatDate(entry.updatedAt)}</div>
                    </td>
                    <td class="nowrap">
                      <button class="btn small ghost" onClick={() => setDialog({ entry, isNew: false })}>
                        Edit
                      </button>
                      <button
                        class="btn small ghost"
                        aria-label="Delete entry"
                        title="Delete entry"
                        onClick={() => void remove(entry)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {filtered.length > limit && (
          <div class="row" style={{ justifyContent: 'center', marginTop: '12px' }}>
            <button class="btn" onClick={() => setLimit(limit + PAGE)}>
              Show {Math.min(PAGE, filtered.length - limit)} more
            </button>
          </div>
        )}
      </div>

      {dialog && <EntryDialog entry={dialog.entry} isNew={dialog.isNew} onClose={() => setDialog(null)} />}
    </div>
  );
}
