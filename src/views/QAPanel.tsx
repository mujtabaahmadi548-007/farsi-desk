import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { listGlossary, listSegments } from '../db';
import { defaultScope, QA_LABELS, runQA, type QACheck, type QAIssue, type QAScope, type QASeverity } from '../lib/qa';
import { navigate } from '../router';
import { langDir, sourceLang, targetLang, type GlossaryTerm, type Project, type Segment } from '../types';
import { errorMessage, toast } from '../ui';

const SEVERITY_TONE: Record<QASeverity, string> = { error: 'err', warning: 'warn', info: 'info' };
const SEVERITY_LABEL: Record<QASeverity, string> = { error: 'Error', warning: 'Warning', info: 'Info' };
const CHECK_ORDER: QACheck[] = ['empty', 'numbers', 'glossary', 'copied', 'brackets', 'spaces', 'timing', 'unconfirmed'];

export function QAPanel({ project }: { project: Project }) {
  const [segments, setSegments] = useState<Segment[] | null>(null);
  const [terms, setTerms] = useState<GlossaryTerm[]>([]);
  const [scope, setScope] = useState<QAScope | null>(null);
  const [hidden, setHidden] = useState<Set<QACheck>>(new Set());

  const load = useCallback(async () => {
    try {
      const [list, glossary] = await Promise.all([listSegments(project.id), listGlossary()]);
      setSegments(list);
      setTerms(glossary);
      setScope((current) => current ?? defaultScope(list));
    } catch (error) {
      toast(`Could not run the checks: ${errorMessage(error)}`, 'error');
    }
  }, [project.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const issues = useMemo<QAIssue[]>(() => {
    if (!segments || !scope) return [];
    return runQA(segments, { direction: project.direction, terms, scope });
  }, [segments, terms, scope, project.direction]);

  const byId = useMemo(() => new Map((segments ?? []).map((s) => [s.id, s])), [segments]);

  const counts = useMemo(() => {
    const perCheck = new Map<QACheck, number>();
    const perSeverity: Record<QASeverity, number> = { error: 0, warning: 0, info: 0 };
    for (const issue of issues) {
      perCheck.set(issue.check, (perCheck.get(issue.check) ?? 0) + 1);
      perSeverity[issue.severity]++;
    }
    return { perCheck, perSeverity };
  }, [issues]);

  if (segments === null || scope === null) return <div class="card muted">Running checks…</div>;

  const visible = issues.filter((issue) => !hidden.has(issue.check));
  const toggle = (check: QACheck) => {
    const next = new Set(hidden);
    if (next.has(check)) next.delete(check);
    else next.add(check);
    setHidden(next);
  };
  const shownLang = scope === 'transcript' ? sourceLang(project.direction) : targetLang(project.direction);

  return (
    <div class="stack">
      <div class="card">
        <div class="card-title">
          <h2>Quality checks</h2>
          <span class="badge err">{counts.perSeverity.error} errors</span>
          <span class="badge warn">{counts.perSeverity.warning} warnings</span>
          <span class="badge info">{counts.perSeverity.info} notes</span>
          <div class="row right">
            <select
              class="select"
              style={{ width: 'auto' }}
              aria-label="What to check"
              value={scope}
              onChange={(e) => setScope(e.currentTarget.value as QAScope)}
            >
              <option value="translation">Check the translation (target against source)</option>
              <option value="transcript">Check the transcript only (source text)</option>
            </select>
            <button class="btn" onClick={() => void load()}>
              Run again
            </button>
          </div>
        </div>

        {segments.length === 0 ? (
          <div class="empty-state">This project has no segments yet.</div>
        ) : issues.length === 0 ? (
          <div class="notice ok">
            No issues found in {segments.length} segment{segments.length === 1 ? '' : 's'}.
          </div>
        ) : (
          <>
            <div class="chips" style={{ marginBottom: '12px' }} role="group" aria-label="Show or hide checks">
              {CHECK_ORDER.filter((check) => counts.perCheck.has(check)).map((check) => (
                <button
                  key={check}
                  class={`chip ${hidden.has(check) ? '' : 'active'}`}
                  aria-pressed={!hidden.has(check)}
                  onClick={() => toggle(check)}
                >
                  {QA_LABELS[check]} <span class="n">{counts.perCheck.get(check)}</span>
                </button>
              ))}
            </div>
            <p class="muted small">Click an issue to open its segment in the editor.</p>
            <div style={{ border: '1px solid var(--border)', borderRadius: '6px' }}>
              {visible.length === 0 && <div class="empty-state">All checks are hidden. Click a chip above.</div>}
              {visible.map((issue, index) => {
                const segment = byId.get(issue.segmentId);
                // Show the checked text; for an empty target show the source so the segment is recognisable.
                const useTarget = scope === 'translation' && segment !== undefined && segment.target.trim() !== '';
                const snippet = segment ? (useTarget ? segment.target : segment.source) : '';
                const snippetLang = useTarget ? shownLang : sourceLang(project.direction);
                return (
                  <button
                    key={`${issue.segmentId}-${issue.check}-${index}`}
                    class="qa-item"
                    onClick={() => navigate(`/project/${project.id}/editor?seg=${issue.segmentId}`)}
                  >
                    <span class="mono muted">#{issue.order + 1}</span>
                    <span>
                      <span class={`badge ${SEVERITY_TONE[issue.severity]}`} title={SEVERITY_LABEL[issue.severity]}>
                        {QA_LABELS[issue.check]}
                      </span>
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span dir="auto" style={{ display: 'block' }}>
                        {issue.message}
                      </span>
                      {snippet.trim() !== '' && (
                        <span class="qa-snippet" dir={langDir(snippetLang)} lang={snippetLang} style={{ display: 'block' }}>
                          {snippet}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
