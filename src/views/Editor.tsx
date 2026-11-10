import type { ComponentChildren } from 'preact';
import { memo } from 'preact/compat';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { deleteSegments, listGlossary, listSegments, listTM, putSegments, replaceProjectSegments } from '../db';
import { countWords, foldForSearch } from '../lib/chars';
import { findMatches, normalizeForMatch, prepareCandidates, type FuzzyMatch } from '../lib/fuzzy';
import { findTerms } from '../lib/glossary';
import type { ImportedSegment } from '../lib/importers';
import { createSegment, renumber } from '../lib/segments';
import { formatClock } from '../lib/srt';
import { saveSegmentToTM } from '../lib/tmStore';
import {
  langDir,
  langName,
  sourceLang,
  targetLang,
  type GlossaryTerm,
  type Lang,
  type Project,
  type Segment,
  type TMEntry,
} from '../types';
import { confirmDialog, errorMessage, ProgressBar, toast } from '../ui';
import { EditorSidePanel } from './EditorSidePanel';
import { ImportDialog, type ImportMode } from './ImportDialog';

type Filter = 'all' | 'empty' | 'draft' | 'confirmed';

export interface RowActions {
  activate: (id: string) => void;
  changeTarget: (id: string, text: string) => void;
  changeSource: (id: string, text: string) => void;
  confirm: (id: string) => void;
  toggleConfirm: (id: string) => void;
  move: (id: string, delta: 1 | -1) => void;
  copySource: (id: string) => void;
  mergeNext: (id: string) => void;
  remove: (id: string) => void;
  shortcut: (id: string, event: KeyboardEvent) => void;
}

/** Returns an object whose methods never change identity but always call the latest implementation. */
function useStableActions(latest: RowActions): RowActions {
  const ref = useRef(latest);
  ref.current = latest;
  return useMemo<RowActions>(
    () => ({
      activate: (id) => ref.current.activate(id),
      changeTarget: (id, text) => ref.current.changeTarget(id, text),
      changeSource: (id, text) => ref.current.changeSource(id, text),
      confirm: (id) => ref.current.confirm(id),
      toggleConfirm: (id) => ref.current.toggleConfirm(id),
      move: (id, delta) => ref.current.move(id, delta),
      copySource: (id) => ref.current.copySource(id),
      mergeNext: (id) => ref.current.mergeNext(id),
      remove: (id) => ref.current.remove(id),
      shortcut: (id, event) => ref.current.shortcut(id, event),
    }),
    [],
  );
}

function autosize(el: HTMLTextAreaElement | null): void {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight + 2}px`;
}

const STATUS_LABEL: Record<Segment['status'], string> = {
  empty: 'Empty',
  draft: 'Draft',
  confirmed: 'Confirmed ✓',
};
const STATUS_TONE: Record<Segment['status'], string> = { empty: '', draft: 'warn', confirmed: 'ok' };

interface RowProps {
  seg: Segment;
  number: number;
  active: boolean;
  paraStart: boolean;
  srcLang: Lang;
  tgtLang: Lang;
  editSource: boolean;
  actions: RowActions;
  /** Source text with glossary terms highlighted; only supplied for the active row. */
  sourceView?: ComponentChildren;
}

const Row = memo(function Row(props: RowProps) {
  const { seg, number, active, paraStart, srcLang, tgtLang, editSource, actions, sourceView } = props;
  const rowRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLTextAreaElement>(null);
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const focusWanted = useRef<'target' | 'source'>('target');

  useLayoutEffect(() => {
    if (active) {
      autosize(targetRef.current);
      autosize(sourceRef.current);
    }
  }, [active, seg.target, seg.source, editSource]);

  // Layout effect (not a normal effect): focus must move before the next key press is handled,
  // otherwise fast typing right after Ctrl+Enter would be lost.
  useLayoutEffect(() => {
    if (!active) return;
    const el = focusWanted.current === 'source' && sourceRef.current ? sourceRef.current : targetRef.current;
    focusWanted.current = 'target';
    if (el && document.activeElement !== el) {
      el.focus({ preventScroll: true });
      const end = el.value.length;
      el.setSelectionRange(end, end);
    }
    rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onTargetKey = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      actions.confirm(seg.id);
    } else if (event.altKey && event.key === 'ArrowDown') {
      event.preventDefault();
      actions.move(seg.id, 1);
    } else if (event.altKey && event.key === 'ArrowUp') {
      event.preventDefault();
      actions.move(seg.id, -1);
    } else if (event.altKey && event.code === 'KeyS') {
      // event.code, not event.key: the shortcut must also work on a Persian keyboard layout.
      event.preventDefault();
      actions.copySource(seg.id);
    } else {
      actions.shortcut(seg.id, event);
    }
  };

  return (
    <div
      ref={rowRef}
      class={`seg-row ${active ? 'active' : ''} ${paraStart ? 'para-start' : ''}`}
      data-seg={seg.id}
    >
      <div class="seg-num" onClick={() => actions.activate(seg.id)}>
        {number}
        {seg.start !== null && <span class="seg-time">{formatClock(seg.start, false)}</span>}
      </div>

      {active && editSource ? (
        <div class="seg-cell">
          <textarea
            ref={sourceRef}
            class="seg-source-input"
            dir={langDir(srcLang)}
            lang={srcLang}
            value={seg.source}
            rows={1}
            aria-label={`Source text of segment ${number}`}
            onInput={(e) => actions.changeSource(seg.id, e.currentTarget.value)}
          />
        </div>
      ) : (
        <div
          class={`seg-cell ${seg.source === '' ? 'placeholder' : ''}`}
          dir={langDir(srcLang)}
          lang={srcLang}
          onClick={() => {
            focusWanted.current = editSource ? 'source' : 'target';
            actions.activate(seg.id);
          }}
        >
          {seg.source === '' ? '(empty source)' : active && sourceView !== undefined ? sourceView : seg.source}
        </div>
      )}

      {active ? (
        <div class="seg-cell">
          <textarea
            ref={targetRef}
            class="seg-target-input"
            dir={langDir(tgtLang)}
            lang={tgtLang}
            value={seg.target}
            rows={1}
            spellcheck
            aria-label={`Translation of segment ${number}`}
            onInput={(e) => actions.changeTarget(seg.id, e.currentTarget.value)}
            onKeyDown={onTargetKey}
          />
        </div>
      ) : (
        <div
          class={`seg-cell ${seg.target === '' ? 'placeholder' : ''}`}
          dir={langDir(tgtLang)}
          lang={seg.target === '' ? undefined : tgtLang}
          onClick={() => actions.activate(seg.id)}
        >
          {seg.target === '' ? 'Click to translate' : seg.target}
        </div>
      )}

      <div class="seg-status">
        <button
          class="status-btn"
          title={seg.status === 'confirmed' ? 'Click to unconfirm' : 'Click to confirm'}
          onClick={() => actions.toggleConfirm(seg.id)}
        >
          <span class={`badge ${STATUS_TONE[seg.status]}`}>{STATUS_LABEL[seg.status]}</span>
        </button>
        {active && (
          <div class="seg-actions">
            <button class="btn small ghost" title="Copy source into target (Alt+S)" onClick={() => actions.copySource(seg.id)}>
              Copy src
            </button>
            <button class="btn small ghost" title="Merge with the next segment" onClick={() => actions.mergeNext(seg.id)}>
              Merge ↓
            </button>
            <button class="btn small ghost" title="Delete this segment" onClick={() => actions.remove(seg.id)}>
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

interface EditorProps {
  project: Project;
  /** Segment to jump to (from a QA issue link). */
  focusSegmentId: string | null;
}

export function Editor({ project, focusSegmentId }: EditorProps) {
  const srcLang = sourceLang(project.direction);
  const tgtLang = targetLang(project.direction);

  const [segments, setSegmentsState] = useState<Segment[] | null>(null);
  const segmentsRef = useRef<Segment[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [structure, setStructure] = useState(0);
  const [editSource, setEditSource] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [tm, setTm] = useState<TMEntry[]>([]);
  const [terms, setTerms] = useState<GlossaryTerm[]>([]);
  const [matches, setMatches] = useState<FuzzyMatch<TMEntry>[]>([]);

  const pending = useRef(new Map<string, Segment>());
  const timer = useRef<number | null>(null);

  const commit = (next: Segment[]) => {
    segmentsRef.current = next;
    setSegmentsState(next);
  };

  const flush = useCallback(async () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (pending.current.size === 0) return;
    const batch = [...pending.current.values()];
    pending.current.clear();
    try {
      await putSegments(batch);
    } catch (error) {
      toast(`Could not save your changes: ${errorMessage(error)}`, 'error');
    }
  }, []);

  const queueSave = (segment: Segment) => {
    pending.current.set(segment.id, segment);
    if (timer.current === null) {
      timer.current = window.setTimeout(() => {
        timer.current = null;
        void flush();
      }, 400);
    }
  };

  // Load once per project; save anything pending when leaving.
  useEffect(() => {
    let cancelled = false;
    listSegments(project.id).then(
      (list) => {
        if (cancelled) return;
        commit(list);
        setStructure((v) => v + 1);
        setActiveId((current) => {
          if (current && list.some((s) => s.id === current)) return current;
          if (focusSegmentId && list.some((s) => s.id === focusSegmentId)) return focusSegmentId;
          const firstOpen = list.find((s) => s.status !== 'confirmed');
          return (firstOpen ?? list[0])?.id ?? null;
        });
      },
      (error: unknown) => toast(`Could not load the segments: ${errorMessage(error)}`, 'error'),
    );
    const onHide = () => void flush();
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      cancelled = true;
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onHide);
      void flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  // The translation memory and the glossary are shared by all projects; load them once.
  useEffect(() => {
    let cancelled = false;
    Promise.all([listTM(), listGlossary()]).then(
      ([entries, glossary]) => {
        if (cancelled) return;
        setTm(entries);
        setTerms(glossary);
      },
      (error: unknown) => toast(`Could not load the translation memory: ${errorMessage(error)}`, 'error'),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // Jump to a segment requested through the URL (QA issue links).
  useEffect(() => {
    if (!focusSegmentId || !segmentsRef.current.some((s) => s.id === focusSegmentId)) return;
    setFilter('all');
    setSearch('');
    setActiveId(focusSegmentId);
  }, [focusSegmentId, structure]);

  const find = (id: string) => segmentsRef.current.find((s) => s.id === id);

  /** Applies a change to one segment, updates the screen and schedules a save. Returns the new segment. */
  const patch = (id: string, change: Partial<Segment>): Segment | undefined => {
    let updated: Segment | undefined;
    const next = segmentsRef.current.map((s) => {
      if (s.id !== id) return s;
      updated = { ...s, ...change, updatedAt: Date.now() };
      return updated;
    });
    if (!updated) return undefined;
    commit(next);
    queueSave(updated);
    return updated;
  };

  // The list of visible rows is recomputed only when the filter, the search or the structure changes —
  // not on every keystroke — so a segment does not vanish from an "Empty" filter while you type in it.
  const visibleIds = useMemo(() => {
    const query = foldForSearch(search);
    return segmentsRef.current
      .filter((s) => filter === 'all' || s.status === filter)
      .filter((s) => query === '' || foldForSearch(s.source).includes(query) || foldForSearch(s.target).includes(query))
      .map((s) => s.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, search, structure]);

  const moveFrom = (id: string, delta: 1 | -1) => {
    const index = visibleIds.indexOf(id);
    if (index === -1) return;
    const nextId = visibleIds[index + delta];
    if (nextId) setActiveId(nextId);
  };

  const confirmSegment = (id: string, advance: boolean) => {
    const segment = find(id);
    if (!segment) return;
    if (segment.target.trim() === '') {
      toast('Type a translation before confirming the segment.');
      return;
    }
    const confirmed = patch(id, { status: 'confirmed', confirmedAt: Date.now() });
    void flush();
    if (confirmed) {
      saveSegmentToTM(project, confirmed).then(
        (entry) => {
          if (entry) setTm((current) => [entry, ...current.filter((e) => e.id !== entry.id)]);
        },
        (error: unknown) => toast(`Could not save to the translation memory: ${errorMessage(error)}`, 'error'),
      );
    }
    if (advance) moveFrom(id, 1);
  };

  // ----- translation memory lookup for the active segment -----
  const prepared = useMemo(
    () =>
      prepareCandidates(
        tm.map((entry) => ({
          item: entry,
          source: srcLang === 'fa' ? entry.fa : entry.en,
          target: tgtLang === 'fa' ? entry.fa : entry.en,
        })),
      ),
    [tm, srcLang, tgtLang],
  );

  const activeSegment = activeId ? (segments ?? []).find((s) => s.id === activeId) : undefined;
  const activeSource = activeSegment?.source ?? null;

  useEffect(() => {
    if (activeSource === null || activeId === null) {
      setMatches([]);
      return;
    }
    // A short delay keeps typing in "Edit source" mode and fast navigation smooth.
    const handle = window.setTimeout(() => {
      const own = prepared.filter((candidate) => candidate.item.segmentId !== activeId);
      setMatches(findMatches(activeSource, own, { minScore: 50, limit: 5 }));
    }, 60);
    return () => window.clearTimeout(handle);
  }, [activeSource, activeId, prepared]);

  const hits = useMemo(
    () => (activeSource === null ? [] : findTerms(activeSource, terms, srcLang)),
    [activeSource, terms, srcLang],
  );

  const applyMatch = (index: number) => {
    const match = matches[index];
    if (!match || !activeId) return;
    patch(activeId, { target: match.target, status: 'draft', confirmedAt: null });
    focusActiveTarget(match.target.length);
  };

  /** Puts the cursor back into the active translation box (after a click in the side panel). */
  const focusActiveTarget = (caret: number) => {
    window.requestAnimationFrame(() => {
      const box = document.querySelector<HTMLTextAreaElement>('.seg-row.active .seg-target-input');
      if (!box) return;
      box.focus();
      box.setSelectionRange(caret, caret);
    });
  };

  /** Inserts a glossary translation at the cursor, adding a space where two words would touch. */
  const insertTerm = (text: string) => {
    if (!activeId) return;
    const segment = find(activeId);
    if (!segment) return;
    const box = document.querySelector<HTMLTextAreaElement>('.seg-row.active .seg-target-input');
    const value = segment.target;
    const from = box ? box.selectionStart : value.length;
    const to = box ? box.selectionEnd : value.length;
    const before = value.slice(0, from);
    const after = value.slice(to);
    const needsSpaceBefore = before !== '' && !/[\s(\[{«“"'\u{200C}-]$/u.test(before);
    const needsSpaceAfter = after !== '' && /^[\p{L}\p{N}]/u.test(after);
    const inserted = `${needsSpaceBefore ? ' ' : ''}${text}${needsSpaceAfter ? ' ' : ''}`;
    patch(activeId, { target: before + inserted + after, status: 'draft', confirmedAt: null });
    focusActiveTarget(before.length + inserted.length);
  };

  const actions = useStableActions({
    activate: (id) => setActiveId(id),
    changeTarget: (id, text) => {
      patch(id, { target: text, status: text.trim() === '' ? 'empty' : 'draft', confirmedAt: null });
    },
    changeSource: (id, text) => {
      patch(id, { source: text });
    },
    confirm: (id) => confirmSegment(id, true),
    toggleConfirm: (id) => {
      const segment = find(id);
      if (!segment) return;
      if (segment.status === 'confirmed') patch(id, { status: 'draft', confirmedAt: null });
      else confirmSegment(id, false);
    },
    move: moveFrom,
    copySource: (id) => {
      const segment = find(id);
      if (!segment) return;
      patch(id, {
        target: segment.source,
        status: segment.source.trim() === '' ? 'empty' : 'draft',
        confirmedAt: null,
      });
    },
    mergeNext: (id) => {
      void (async () => {
        const list = segmentsRef.current;
        const index = list.findIndex((s) => s.id === id);
        const current = list[index];
        const following = list[index + 1];
        if (!current || !following) {
          toast('This is the last segment — there is nothing to merge it with.');
          return;
        }
        await flush();
        const join = (a: string, b: string) => [a.trim(), b.trim()].filter((part) => part !== '').join(' ');
        const target = join(current.target, following.target);
        const merged: Segment = {
          ...current,
          source: join(current.source, following.source),
          target,
          status: target === '' ? 'empty' : 'draft',
          confirmedAt: null,
          end: following.end ?? current.end,
          updatedAt: Date.now(),
        };
        const next = list.filter((s) => s.id !== following.id).map((s) => (s.id === id ? merged : { ...s }));
        const changed = renumber(next);
        try {
          await deleteSegments([following.id]);
          await putSegments([merged, ...changed.filter((s) => s.id !== merged.id)]);
          commit(next);
          setStructure((v) => v + 1);
        } catch (error) {
          toast(`Could not merge the segments: ${errorMessage(error)}`, 'error');
        }
      })();
    },
    remove: (id) => {
      void (async () => {
        const list = segmentsRef.current;
        const index = list.findIndex((s) => s.id === id);
        if (index === -1) return;
        const ok = await confirmDialog({
          title: `Delete segment ${index + 1}?`,
          message: 'Its source text and translation are removed from this project. This cannot be undone.',
          confirmLabel: 'Delete segment',
          danger: true,
        });
        if (!ok) return;
        await flush();
        const next = list.filter((s) => s.id !== id).map((s) => ({ ...s }));
        const changed = renumber(next);
        try {
          await deleteSegments([id]);
          await putSegments(changed);
          commit(next);
          setStructure((v) => v + 1);
          setActiveId((next[index] ?? next[index - 1])?.id ?? null);
        } catch (error) {
          toast(`Could not delete the segment: ${errorMessage(error)}`, 'error');
        }
      })();
    },
    shortcut: (_id, event) => {
      // Alt+1 … Alt+5: use a translation memory match (event.code works on any keyboard layout)
      const digit = /^Digit([1-5])$/.exec(event.code);
      if (event.altKey && !event.ctrlKey && !event.metaKey && digit) {
        event.preventDefault();
        applyMatch(Number(digit[1]) - 1);
      }
    },
  });

  const handleImport = async (items: ImportedSegment[], mode: ImportMode, pretranslate: boolean) => {
    await flush();
    const existing = mode === 'append' ? segmentsRef.current : [];
    const lastParagraph = existing.reduce((max, s) => Math.max(max, s.paragraph), -2);
    const paragraphBase = lastParagraph + 2; // leaves a blank paragraph between the old and the new text
    // Exact matches (100% / 99%) from the memory can be filled in as drafts straight away.
    const exact = new Map<string, string>();
    if (pretranslate) {
      for (const candidate of prepared) {
        if (!exact.has(candidate.normalized)) exact.set(candidate.normalized, candidate.target);
      }
    }
    let prefilled = 0;
    const created = items.map((item, index) => {
      const fromMemory = exact.get(normalizeForMatch(item.text)) ?? '';
      if (fromMemory !== '') prefilled++;
      return createSegment(project.id, existing.length + index, {
        paragraph: paragraphBase + item.paragraph,
        source: item.text,
        target: fromMemory,
        start: item.start,
        end: item.end,
      });
    });
    if (mode === 'replace') await replaceProjectSegments(project.id, created);
    else await putSegments(created);
    commit([...existing, ...created]);
    setStructure((v) => v + 1);
    setFilter('all');
    setSearch('');
    setActiveId(created[0]?.id ?? null);
    toast(
      `Imported ${created.length} segment${created.length === 1 ? '' : 's'}` +
        (prefilled > 0 ? `; ${prefilled} pre-translated from the translation memory (as drafts).` : '.'),
      'success',
    );
  };

  /** The active source text with its glossary terms highlighted; clicking a term inserts its translation. */
  const sourceView = useMemo(() => {
    if (activeSource === null || hits.length === 0) return undefined;
    const pieces: ComponentChildren[] = [];
    let cursor = 0;
    for (const hit of hits) {
      if (hit.start > cursor) pieces.push(activeSource.slice(cursor, hit.start));
      const translations = hit.terms.map((term) => (tgtLang === 'fa' ? term.fa : term.en));
      pieces.push(
        <mark
          key={`${hit.start}-${hit.end}`}
          class="term-hit"
          title={`Glossary: ${translations.join(' / ')} — click to insert`}
          onClick={(event) => {
            event.stopPropagation();
            insertTerm(translations[0]);
          }}
        >
          {activeSource.slice(hit.start, hit.end)}
        </mark>,
      );
      cursor = hit.end;
    }
    if (cursor < activeSource.length) pieces.push(activeSource.slice(cursor));
    return pieces;
    // activeId is a dependency so that the click handler never points at a previously active segment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSource, activeId, hits, tgtLang]);

  const counts = useMemo(() => {
    const result = { all: 0, empty: 0, draft: 0, confirmed: 0, words: 0 };
    for (const segment of segments ?? []) {
      result.all++;
      result[segment.status]++;
      result.words += countWords(segment.source);
    }
    return result;
  }, [segments]);

  const byId = useMemo(() => new Map((segments ?? []).map((s) => [s.id, s])), [segments]);

  if (segments === null) return <div class="card muted">Loading segments…</div>;

  const importDialog = importOpen && (
    <ImportDialog
      existingCount={segments.length}
      srcLang={srcLang}
      tmSize={tm.length}
      onImport={handleImport}
      onClose={() => setImportOpen(false)}
    />
  );

  if (segments.length === 0) {
    return (
      <div class="card empty-state">
        <h3>No text yet</h3>
        <div>
          Import a .txt, .docx or .srt file, or paste the {langName(srcLang)} source text. It is split into
          sentences automatically.
        </div>
        <div class="row">
          <button class="btn primary" onClick={() => setImportOpen(true)}>
            Import or paste text…
          </button>
          <a class="btn" href={`#/project/${project.id}/transcribe`}>
            Transcribe audio/video instead
          </a>
        </div>
        {importDialog}
      </div>
    );
  }

  const FILTERS: { id: Filter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'empty', label: 'Empty' },
    { id: 'draft', label: 'Draft' },
    { id: 'confirmed', label: 'Confirmed' },
  ];
  const progress = counts.all === 0 ? 0 : (counts.confirmed / counts.all) * 100;
  let previousParagraph: number | null = null;

  return (
    <div>
      <div class="toolbar">
        <button class="btn" onClick={() => setImportOpen(true)}>
          Import…
        </button>
        <div class="chips" role="group" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <button key={f.id} class={`chip ${filter === f.id ? 'active' : ''}`} onClick={() => setFilter(f.id)}>
              {f.label} <span class="n">{counts[f.id]}</span>
            </button>
          ))}
        </div>
        <input
          class="input"
          type="search"
          dir="auto"
          placeholder="Search source and target…"
          aria-label="Search segments"
          value={search}
          onInput={(e) => setSearch(e.currentTarget.value)}
          style={{ minWidth: '210px' }}
        />
        <label class="check small">
          <input type="checkbox" checked={editSource} onChange={(e) => setEditSource(e.currentTarget.checked)} />
          <span>Edit source</span>
        </label>
        <div class="right row small muted">
          <span style={{ width: '110px' }}>
            <ProgressBar value={progress} />
          </span>
          <span>
            {counts.confirmed}/{counts.all} confirmed · {counts.words.toLocaleString('en-US')} words
          </span>
        </div>
      </div>

      <div class="editor-layout">
        <div class="seg-list">
          <div class="seg-head">
            <div>#</div>
            <div>Source · {langName(srcLang)}</div>
            <div>Target · {langName(tgtLang)}</div>
            <div>Status</div>
          </div>
          {visibleIds.length === 0 && <div class="empty-state">No segments match this filter.</div>}
          {visibleIds.map((id) => {
            const seg = byId.get(id);
            if (!seg) return null;
            const paraStart = previousParagraph !== null && seg.paragraph !== previousParagraph;
            previousParagraph = seg.paragraph;
            return (
              <Row
                key={seg.id}
                seg={seg}
                number={seg.order + 1}
                active={seg.id === activeId}
                paraStart={paraStart}
                srcLang={srcLang}
                tgtLang={tgtLang}
                editSource={editSource}
                actions={actions}
                sourceView={seg.id === activeId ? sourceView : undefined}
              />
            );
          })}
        </div>

        <EditorSidePanel
          srcLang={srcLang}
          tgtLang={tgtLang}
          activeSource={activeSource}
          matches={matches}
          tmSize={tm.length}
          hits={hits}
          glossarySize={terms.length}
          onApplyMatch={applyMatch}
          onInsertTerm={insertTerm}
        />
      </div>
      {importDialog}
    </div>
  );
}
