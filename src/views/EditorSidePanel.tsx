import { useMemo } from 'preact/hooks';
import { DiffText } from '../components/DiffText';
import { foldChars } from '../lib/chars';
import { diffWords } from '../lib/diff';
import type { FuzzyMatch } from '../lib/fuzzy';
import type { TermHit } from '../lib/glossary';
import { langDir, type Lang, type TMEntry } from '../types';

interface Props {
  srcLang: Lang;
  tgtLang: Lang;
  /** Source text of the active segment, or null when no segment is active. */
  activeSource: string | null;
  matches: FuzzyMatch<TMEntry>[];
  tmSize: number;
  hits: TermHit[];
  glossarySize: number;
  onApplyMatch: (index: number) => void;
  onInsertTerm: (text: string) => void;
}

function scoreTone(score: number): string {
  if (score >= 95) return 'ok';
  if (score >= 75) return 'warn';
  return '';
}

export function EditorSidePanel(props: Props) {
  const { srcLang, tgtLang, activeSource, matches, tmSize, hits, glossarySize, onApplyMatch, onInsertTerm } = props;

  // The TM source compared with the current source: what is struck through is only in the memory,
  // what is highlighted is only in the segment being translated. Words that differ only in
  // ي/ی, ك/ک, digit script or letter case are not marked — they are not real differences.
  const diffs = useMemo(
    () => matches.map((match) => (activeSource === null ? [] : diffWords(match.source, activeSource, foldChars))),
    [matches, activeSource],
  );

  return (
    <aside class="side-panel">
      <div class="side-card">
        <h3>
          Translation memory <span class="badge">{tmSize.toLocaleString('en-US')}</span>
        </h3>
        {activeSource === null ? (
          <div class="muted small">Select a segment to see matches.</div>
        ) : matches.length === 0 ? (
          <div class="muted small">
            {tmSize === 0
              ? 'The memory is empty. Every segment you confirm is saved here and offered again in all projects.'
              : 'No match of 50% or more for this segment.'}
          </div>
        ) : (
          <>
            <div class="muted small">Click a match (or press the shortcut) to use its translation.</div>
            {matches.map((match, index) => (
              <button key={match.item.id} class="match" onClick={() => onApplyMatch(index)}>
                <span class="match-head">
                  <span class={`badge ${scoreTone(match.score)}`}>{match.score}%</span>
                  <span class="muted small" dir="auto" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {match.item.origin}
                  </span>
                  {index < 5 && (
                    <span class="nowrap">
                      <kbd>Alt</kbd>+<kbd>{index + 1}</kbd>
                    </span>
                  )}
                </span>
                <span class="match-src pre-wrap" dir={langDir(srcLang)} lang={srcLang} style={{ display: 'block' }}>
                  {match.score >= 99 ? match.source : <DiffText parts={diffs[index]} side="both" />}
                </span>
                <span class="match-tgt pre-wrap" dir={langDir(tgtLang)} lang={tgtLang} style={{ display: 'block' }}>
                  {match.target}
                </span>
              </button>
            ))}
          </>
        )}
      </div>

      <div class="side-card">
        <h3>
          Glossary <span class="badge">{glossarySize.toLocaleString('en-US')}</span>
        </h3>
        {activeSource === null ? (
          <div class="muted small">Select a segment to see its terms.</div>
        ) : hits.length === 0 ? (
          <div class="muted small">
            {glossarySize === 0 ? (
              <>
                The glossary is empty. <a href="#/glossary">Add terms</a>
              </>
            ) : (
              'No glossary terms in this segment.'
            )}
          </div>
        ) : (
          <>
            <div class="muted small">Click a translation to insert it at the cursor.</div>
            {hits.map((hit) => (
              <div key={`${hit.start}-${hit.end}`} class="term-row">
                <span class="term-src" dir={langDir(srcLang)} lang={srcLang}>
                  <span class="term-hit" style={{ cursor: 'default' }}>
                    {activeSource.slice(hit.start, hit.end)}
                  </span>
                </span>
                <span class="row" style={{ gap: '4px', justifyContent: 'flex-end' }}>
                  {hit.terms.map((term) => {
                    const translation = tgtLang === 'fa' ? term.fa : term.en;
                    return (
                      <button
                        key={term.id}
                        class="btn small"
                        dir={langDir(tgtLang)}
                        lang={tgtLang}
                        title={term.note || 'Insert into the translation'}
                        onClick={() => onInsertTerm(translation)}
                      >
                        {translation}
                      </button>
                    );
                  })}
                </span>
              </div>
            ))}
          </>
        )}
      </div>

      <div class="side-card">
        <h3>Keyboard</h3>
        <div class="small" style={{ display: 'grid', gap: '6px' }}>
          <div>
            <kbd>Ctrl</kbd>+<kbd>Enter</kbd> confirm and go to the next segment
          </div>
          <div>
            <kbd>Alt</kbd>+<kbd>↓</kbd> / <kbd>Alt</kbd>+<kbd>↑</kbd> next / previous segment
          </div>
          <div>
            <kbd>Alt</kbd>+<kbd>S</kbd> copy the source into the target
          </div>
          <div>
            <kbd>Alt</kbd>+<kbd>1</kbd>…<kbd>5</kbd> use a translation memory match
          </div>
          <div class="muted">Changes are saved automatically. Confirmed segments go to the memory.</div>
        </div>
      </div>
    </aside>
  );
}
