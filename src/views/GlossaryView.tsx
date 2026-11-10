import { useMemo, useState } from 'preact/hooks';
import { clearGlossary, deleteTerm, listGlossary, putTerms } from '../db';
import { useLive } from '../hooks';
import { foldForSearch } from '../lib/chars';
import { glossaryToCsv, parseGlossaryCsv } from '../lib/csv';
import { decodeText, downloadText } from '../lib/download';
import { newId, type GlossaryTerm } from '../types';
import { confirmDialog, errorMessage, FileButton, toast } from '../ui';

function stamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface Draft {
  fa: string;
  en: string;
  note: string;
}

const EMPTY: Draft = { fa: '', en: '', note: '' };

export function GlossaryView() {
  const terms = useLive(listGlossary, ['glossary'], []);
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState<Draft>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    if (!terms) return [];
    const query = foldForSearch(search);
    if (query === '') return terms;
    return terms.filter(
      (term) =>
        foldForSearch(term.fa).includes(query) ||
        foldForSearch(term.en).includes(query) ||
        foldForSearch(term.note).includes(query),
    );
  }, [terms, search]);

  const isDuplicate = (fa: string, en: string, exceptId: string | null) =>
    (terms ?? []).some((term) => term.id !== exceptId && term.fa === fa && term.en === en);

  const add = async (event: Event) => {
    event.preventDefault();
    const fa = adding.fa.trim();
    const en = adding.en.trim();
    if (fa === '' || en === '') {
      toast('Enter both the Persian and the English term.');
      return;
    }
    if (isDuplicate(fa, en, null)) {
      toast('This pair is already in the glossary.');
      return;
    }
    try {
      await putTerms([{ id: newId(), fa, en, note: adding.note.trim(), createdAt: Date.now() }]);
      setAdding(EMPTY);
      document.getElementById('gl-fa')?.focus();
    } catch (error) {
      toast(`Could not add the term: ${errorMessage(error)}`, 'error');
    }
  };

  const startEdit = (term: GlossaryTerm) => {
    setEditingId(term.id);
    setEditing({ fa: term.fa, en: term.en, note: term.note });
  };

  const saveEdit = async (term: GlossaryTerm) => {
    const fa = editing.fa.trim();
    const en = editing.en.trim();
    if (fa === '' || en === '') {
      toast('A term needs both a Persian and an English side.');
      return;
    }
    try {
      await putTerms([{ ...term, fa, en, note: editing.note.trim() }]);
      setEditingId(null);
    } catch (error) {
      toast(`Could not save the term: ${errorMessage(error)}`, 'error');
    }
  };

  const remove = async (term: GlossaryTerm) => {
    try {
      await deleteTerm(term.id);
    } catch (error) {
      toast(`Could not delete the term: ${errorMessage(error)}`, 'error');
    }
  };

  const importCsv = async (file: File) => {
    setBusy(true);
    try {
      const result = parseGlossaryCsv(decodeText(await file.arrayBuffer()));
      const have = new Set((terms ?? []).map((term) => `${term.fa}\u0000${term.en}`));
      const now = Date.now();
      const fresh: GlossaryTerm[] = [];
      for (const row of result.terms) {
        const key = `${row.fa}\u0000${row.en}`;
        if (have.has(key)) continue;
        have.add(key);
        fresh.push({ id: newId(), fa: row.fa, en: row.en, note: row.note, createdAt: now + fresh.length });
      }
      await putTerms(fresh);
      const duplicates = result.terms.length - fresh.length;
      toast(
        `Imported ${fresh.length} term${fresh.length === 1 ? '' : 's'} from ${file.name}` +
          (duplicates > 0 ? ` · ${duplicates} already in the glossary` : '') +
          (result.skipped > 0 ? ` · ${result.skipped} row${result.skipped === 1 ? '' : 's'} skipped (need one Persian and one English term)` : ''),
        fresh.length > 0 ? 'success' : 'info',
      );
    } catch (error) {
      toast(`Could not import the CSV file: ${errorMessage(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = () => {
    if (!terms || terms.length === 0) {
      toast('The glossary is empty — there is nothing to export.');
      return;
    }
    downloadText(glossaryToCsv(terms), `farsi-desk-glossary-${stamp()}.csv`, 'text/csv');
    toast(`Exported ${terms.length} terms as CSV.`, 'success');
  };

  const clearAll = async () => {
    const ok = await confirmDialog({
      title: 'Delete the whole glossary?',
      message: `All ${terms?.length ?? 0} terms will be deleted. Export a CSV file first if you want to keep them.`,
      confirmLabel: 'Delete all terms',
      danger: true,
    });
    if (!ok) return;
    try {
      await clearGlossary();
      toast('Glossary cleared.', 'success');
    } catch (error) {
      toast(`Could not clear the glossary: ${errorMessage(error)}`, 'error');
    }
  };

  return (
    <div>
      <div class="page-header">
        <div>
          <h1>Glossary</h1>
          <div class="page-sub">
            Shared by all projects. Terms are highlighted in the segment you are translating and checked by QA.
          </div>
        </div>
        <div class="actions">
          <FileButton label="Import CSV…" accept=".csv,.tsv,.txt,text/csv" onFile={importCsv} disabled={busy} />
          <button class="btn" onClick={exportCsv}>
            Export CSV
          </button>
        </div>
      </div>

      <div class="card">
        <form onSubmit={add} class="row" style={{ alignItems: 'flex-end', marginBottom: '14px' }}>
          <div class="field" style={{ flex: '1 1 180px' }}>
            <label for="gl-fa">Persian term</label>
            <input
              id="gl-fa"
              class="input"
              dir="rtl"
              lang="fa"
              value={adding.fa}
              onInput={(e) => setAdding({ ...adding, fa: e.currentTarget.value })}
            />
          </div>
          <div class="field" style={{ flex: '1 1 180px' }}>
            <label for="gl-en">English term</label>
            <input
              id="gl-en"
              class="input"
              dir="ltr"
              lang="en"
              value={adding.en}
              onInput={(e) => setAdding({ ...adding, en: e.currentTarget.value })}
            />
          </div>
          <div class="field" style={{ flex: '1 1 180px' }}>
            <label for="gl-note">Note (optional)</label>
            <input
              id="gl-note"
              class="input"
              dir="auto"
              value={adding.note}
              onInput={(e) => setAdding({ ...adding, note: e.currentTarget.value })}
            />
          </div>
          <button class="btn primary" type="submit">
            Add term
          </button>
        </form>

        <div class="toolbar">
          <input
            class="input"
            type="search"
            dir="auto"
            placeholder="Search terms…"
            aria-label="Search the glossary"
            value={search}
            onInput={(e) => setSearch(e.currentTarget.value)}
            style={{ minWidth: '260px' }}
          />
          <span class="muted">
            {terms === undefined
              ? 'Loading…'
              : `${filtered.length.toLocaleString('en-US')} of ${terms.length.toLocaleString('en-US')} terms`}
          </span>
          {terms !== undefined && terms.length > 0 && (
            <button class="btn danger small right" onClick={() => void clearAll()}>
              Delete all…
            </button>
          )}
        </div>

        {terms !== undefined && terms.length === 0 && (
          <div class="empty-state">
            <h3>The glossary is empty</h3>
            <div>
              Add a term above, or import a CSV file with the columns <span class="mono">fa, en, note</span>.
            </div>
          </div>
        )}

        {terms !== undefined && terms.length > 0 && filtered.length === 0 && (
          <div class="empty-state">No terms match your search.</div>
        )}

        {filtered.length > 0 && (
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th style={{ width: '30%' }}>Persian</th>
                  <th style={{ width: '30%' }}>English</th>
                  <th>Note</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((term) =>
                  term.id === editingId ? (
                    <tr key={term.id}>
                      <td>
                        <input
                          class="input"
                          dir="rtl"
                          lang="fa"
                          aria-label="Persian term"
                          value={editing.fa}
                          onInput={(e) => setEditing({ ...editing, fa: e.currentTarget.value })}
                        />
                      </td>
                      <td>
                        <input
                          class="input"
                          dir="ltr"
                          lang="en"
                          aria-label="English term"
                          value={editing.en}
                          onInput={(e) => setEditing({ ...editing, en: e.currentTarget.value })}
                        />
                      </td>
                      <td>
                        <input
                          class="input"
                          dir="auto"
                          aria-label="Note"
                          value={editing.note}
                          onInput={(e) => setEditing({ ...editing, note: e.currentTarget.value })}
                        />
                      </td>
                      <td class="nowrap">
                        <button class="btn small primary" onClick={() => void saveEdit(term)}>
                          Save
                        </button>{' '}
                        <button class="btn small" onClick={() => setEditingId(null)}>
                          Cancel
                        </button>
                      </td>
                    </tr>
                  ) : (
                    <tr key={term.id}>
                      <td dir="rtl" lang="fa">
                        {term.fa}
                      </td>
                      <td dir="ltr" lang="en">
                        {term.en}
                      </td>
                      <td class="muted" dir="auto">
                        {term.note}
                      </td>
                      <td class="nowrap">
                        <button class="btn small ghost" onClick={() => startEdit(term)}>
                          Edit
                        </button>
                        <button class="btn small ghost" onClick={() => void remove(term)}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
