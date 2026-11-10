import { useEffect, useMemo, useState } from 'preact/hooks';
import { DiffText } from '../components/DiffText';
import { getSetting, listSegments, putSegments, saveProject, setSetting } from '../db';
import { diffWords, type DiffPart } from '../lib/diff';
import {
  CHANGE_LABELS,
  defaultNormalizeOptions,
  normalizePersian,
  type ChangeKind,
  type NormalizeOptions,
} from '../lib/persian';
import { refreshTMForSegments } from '../lib/tmStore';
import type { DigitMode, Project, Segment } from '../types';
import { errorMessage, toast } from '../ui';

type Toggles = Omit<NormalizeOptions, 'digits'>;

interface PreviewItem {
  segment: Segment;
  before: string;
  after: string;
  parts: DiffPart[];
  changes: Record<ChangeKind, number>;
}

const KINDS: ChangeKind[] = ['letters', 'digits', 'zwnj', 'kashida', 'spaces'];
const DISPLAY_LIMIT = 300;

const TOGGLE_INFO: { key: keyof Toggles; title: string; example: string }[] = [
  { key: 'arabicLetters', title: 'Arabic ي / ك → Persian ی / ک', example: 'also fixes letters copied from PDFs' },
  { key: 'zwnj', title: 'Half-space (ZWNJ) around می، نمی، ها، تر، ترین، ای', example: 'می روم → می‌روم · کتاب ها → کتاب‌ها' },
  { key: 'joinedVerbs', title: 'Split verbs typed without a space', example: 'میروم → می‌روم (known verbs only)' },
  { key: 'kashida', title: 'Remove kashida', example: 'بـــرای → برای' },
  { key: 'spaces', title: 'Stray spaces', example: 'double spaces, space before ، . ؟ and inside ( )' },
];

export function NormalizePanel({ project }: { project: Project }) {
  const side: 'source' | 'target' = project.direction === 'fa-en' ? 'source' : 'target';
  const [segments, setSegments] = useState<Segment[] | null>(null);
  const [toggles, setToggles] = useState<Toggles>(() => {
    const { digits: _digits, ...rest } = defaultNormalizeOptions(project.digitMode);
    return rest;
  });
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listSegments(project.id), getSetting<Partial<Toggles>>('normalizeToggles', {})]).then(
      ([list, saved]) => {
        if (cancelled) return;
        setSegments(list);
        setToggles((current) => ({ ...current, ...saved }));
      },
      (error: unknown) => toast(`Could not load the segments: ${errorMessage(error)}`, 'error'),
    );
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  const options: NormalizeOptions = useMemo(
    () => ({ ...toggles, digits: project.digitMode }),
    [toggles, project.digitMode],
  );

  const items = useMemo<PreviewItem[]>(() => {
    if (!segments) return [];
    const result: PreviewItem[] = [];
    for (const segment of segments) {
      const before = segment[side];
      if (before === '') continue;
      const normalized = normalizePersian(before, options);
      if (normalized.text === before) continue;
      result.push({
        segment,
        before,
        after: normalized.text,
        parts: diffWords(before, normalized.text),
        changes: normalized.changes,
      });
    }
    return result;
  }, [segments, options, side]);

  const included = items.filter((item) => !excluded.has(item.segment.id));
  const totals = useMemo(() => {
    const sum: Record<ChangeKind, number> = { letters: 0, digits: 0, zwnj: 0, kashida: 0, spaces: 0 };
    for (const item of included) for (const kind of KINDS) sum[kind] += item.changes[kind];
    return sum;
  }, [included]);

  const setToggle = (key: keyof Toggles, value: boolean) => {
    const next = { ...toggles, [key]: value };
    setToggles(next);
    void setSetting('normalizeToggles', next);
  };

  const setDigitMode = async (mode: DigitMode) => {
    try {
      await saveProject({ ...project, digitMode: mode });
    } catch (error) {
      toast(`Could not save the digit setting: ${errorMessage(error)}`, 'error');
    }
  };

  const toggleItem = (id: string) => {
    const next = new Set(excluded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExcluded(next);
  };

  const apply = async () => {
    if (included.length === 0) return;
    setBusy(true);
    try {
      const now = Date.now();
      const updated: Segment[] = included.map((item) => {
        const next: Segment = { ...item.segment, [side]: item.after, updatedAt: now };
        if (side === 'target' && next.target.trim() === '') {
          next.status = 'empty';
          next.confirmedAt = null;
        }
        return next;
      });
      await putSegments(updated);
      // Confirmed segments live in the translation memory too: keep those entries in step.
      await refreshTMForSegments(project, updated);
      setSegments(await listSegments(project.id));
      setExcluded(new Set());
      toast(`Normalized ${updated.length} segment${updated.length === 1 ? '' : 's'}.`, 'success');
    } catch (error) {
      toast(`Could not apply the changes: ${errorMessage(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (segments === null) return <div class="card muted">Loading…</div>;

  return (
    <div class="stack">
      <div class="card">
        <div class="card-title">
          <h2>Persian text normalizer</h2>
          <span class="badge accent">Persian {side} text</span>
        </div>
        <p class="muted">
          Works on the Persian {side} text of this project. Nothing is changed until you press “Apply” — the
          list below shows exactly what would change, and you can untick any segment.
        </p>
        <div class="form-grid">
          {TOGGLE_INFO.map((info) => (
            <label key={info.key} class="check">
              <input
                type="checkbox"
                checked={toggles[info.key]}
                disabled={info.key === 'joinedVerbs' && !toggles.zwnj}
                onChange={(e) => setToggle(info.key, e.currentTarget.checked)}
              />
              <span>
                {info.title}
                <br />
                <span class="muted small">{info.example}</span>
              </span>
            </label>
          ))}
          <div class="field">
            <label for="norm-digits">Digits (saved with this project)</label>
            <select
              id="norm-digits"
              class="select"
              value={project.digitMode}
              onChange={(e) => void setDigitMode(e.currentTarget.value as DigitMode)}
            >
              <option value="persian">Persian digits — ۱۲۳</option>
              <option value="latin">Latin digits — 123</option>
              <option value="keep">Keep as typed (only Arabic ٤٥٦ → ۴۵۶)</option>
            </select>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">
          <h2>Preview</h2>
          <span class="muted">
            {items.length === 0
              ? `${segments.length} segment${segments.length === 1 ? '' : 's'} checked`
              : `${items.length} of ${segments.length} segments would change`}
          </span>
          {items.length > 0 && (
            <div class="row right">
              <button class="btn small" onClick={() => setExcluded(new Set())}>
                Select all
              </button>
              <button class="btn small" onClick={() => setExcluded(new Set(items.map((item) => item.segment.id)))}>
                Select none
              </button>
              <button class="btn primary" disabled={busy || included.length === 0} onClick={apply}>
                Apply to {included.length} segment{included.length === 1 ? '' : 's'}
              </button>
            </div>
          )}
        </div>

        {segments.length === 0 && (
          <div class="empty-state">This project has no segments yet. Import some text in the Editor tab first.</div>
        )}

        {segments.length > 0 && items.length === 0 && (
          <div class="notice ok">Nothing to normalize — the Persian text is already clean with these settings.</div>
        )}

        {items.length > 0 && (
          <>
            <div class="chips" style={{ marginBottom: '12px' }}>
              {KINDS.filter((kind) => totals[kind] > 0).map((kind) => (
                <span key={kind} class="badge info">
                  {CHANGE_LABELS[kind]}: {totals[kind]}
                </span>
              ))}
            </div>
            {items.slice(0, DISPLAY_LIMIT).map((item) => (
              <div key={item.segment.id} class="norm-item">
                <input
                  type="checkbox"
                  checked={!excluded.has(item.segment.id)}
                  aria-label={`Include segment ${item.segment.order + 1}`}
                  onChange={() => toggleItem(item.segment.id)}
                  style={{ marginTop: '9px' }}
                />
                <div style={{ minWidth: 0 }}>
                  <div class="norm-tag">
                    Segment {item.segment.order + 1} ·{' '}
                    {KINDS.filter((kind) => item.changes[kind] > 0)
                      .map((kind) => CHANGE_LABELS[kind])
                      .join(' · ')}
                  </div>
                  <div class="norm-line" dir="rtl" lang="fa">
                    <DiffText parts={item.parts} side="before" />
                  </div>
                  <div class="norm-line" dir="rtl" lang="fa">
                    <DiffText parts={item.parts} side="after" />
                  </div>
                </div>
              </div>
            ))}
            {items.length > DISPLAY_LIMIT && (
              <p class="muted small" style={{ marginTop: '10px' }}>
                Showing the first {DISPLAY_LIMIT} of {items.length} changes. “Apply” covers all of them.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
