import { useEffect, useMemo, useState } from 'preact/hooks';
import { getSetting, listSegments, setSetting } from '../db';
import {
  buildBilingualBlocks,
  buildDocumentBlocks,
  buildPlainText,
  deliveryLang,
  formatInvoiceNumber,
  invoiceTotals,
  segmentsToCues,
  textPicker,
  type DeliveryContent,
} from '../lib/delivery';
import { buildDocx, DOCX_MIME } from '../lib/docx';
import { downloadBytes, downloadText, safeFileName } from '../lib/download';
import { formatSrt, formatVtt } from '../lib/srt';
import { formatDate, formatMinutes, formatMoney, formatPersianDate, projectStats } from '../lib/stats';
import {
  DEFAULT_BUSINESS,
  directionLabel,
  langName,
  sourceLang,
  targetLang,
  type BusinessSettings,
  type Project,
  type Segment,
} from '../types';
import { errorMessage, toast } from '../ui';

interface InvoiceDraft {
  /** '' = use the next automatic number */
  number: string;
  date: string;
  dueDate: string;
  clientDetails: string;
  /** '' = automatic description */
  description: string;
  basis: 'source' | 'target';
  /** '' = automatic quantity from the counts */
  quantity: string;
  taxPercent: string;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseNumber(text: string): number | null {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function Deliver({ project }: { project: Project }) {
  const [segments, setSegments] = useState<Segment[] | null>(null);
  const [business, setBusiness] = useState<BusinessSettings>(DEFAULT_BUSINESS);
  const [content, setContent] = useState<DeliveryContent>('target');
  const [fill, setFill] = useState(true);
  const [rtlMarks, setRtlMarks] = useState(false);
  const [draft, setDraft] = useState<InvoiceDraft | null>(null);

  const invoiceKey = `invoice:${project.id}`;

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      listSegments(project.id),
      getSetting<BusinessSettings>('business', DEFAULT_BUSINESS),
      getSetting<Partial<InvoiceDraft>>(invoiceKey, {}),
    ]).then(
      ([list, savedBusiness, savedDraft]) => {
        if (cancelled) return;
        setSegments(list);
        setBusiness({ ...DEFAULT_BUSINESS, ...savedBusiness });
        setDraft({
          number: '',
          date: todayIso(),
          dueDate: '',
          clientDetails: '',
          description: '',
          basis: 'source',
          quantity: '',
          taxPercent: '',
          ...savedDraft,
        });
        // A transcription-only job has nothing in the target column: deliver the transcript.
        if (list.length > 0 && list.every((s) => s.target.trim() === '')) setContent('source');
      },
      (error: unknown) => toast(`Could not load the project data: ${errorMessage(error)}`, 'error'),
    );
    return () => {
      cancelled = true;
    };
  }, [project.id, invoiceKey]);

  const stats = useMemo(() => (segments ? projectStats(project, segments) : null), [project, segments]);

  if (!segments || !stats || !draft) return <div class="card muted">Loading…</div>;

  const srcLang = sourceLang(project.direction);
  const tgtLang = targetLang(project.direction);
  const outLang = deliveryLang(project, content);
  const pick = textPicker(content, fill);
  const baseName = safeFileName(project.name, 'project');
  const hasTiming = segments.some((s) => s.start !== null);
  const untranslated = stats.empty;

  const updateDraft = (change: Partial<InvoiceDraft>) => {
    const next = { ...draft, ...change };
    setDraft(next);
    void setSetting(invoiceKey, next);
  };

  const guard = (action: () => void) => {
    if (segments.length === 0) {
      toast('There is nothing to export yet — this project has no segments.');
      return;
    }
    try {
      action();
    } catch (error) {
      toast(`Export failed: ${errorMessage(error)}`, 'error');
    }
  };

  const exportDocx = () =>
    guard(() => {
      const bytes = buildDocx(buildDocumentBlocks(segments, pick, outLang));
      downloadBytes(bytes, `${baseName} - ${langName(outLang)}.docx`, DOCX_MIME);
    });

  const exportBilingual = () =>
    guard(() => {
      const bytes = buildDocx(buildBilingualBlocks(segments, project));
      downloadBytes(bytes, `${baseName} - bilingual.docx`, DOCX_MIME);
    });

  const exportTxt = () =>
    guard(() => downloadText(buildPlainText(segments, pick), `${baseName} - ${langName(outLang)}.txt`));

  const exportSubtitles = (format: 'srt' | 'vtt') =>
    guard(() => {
      const cues = segmentsToCues(segments, pick);
      const options = { rtlMarks: rtlMarks && outLang === 'fa' };
      const text = format === 'srt' ? formatSrt(cues, options) : formatVtt(cues, options);
      if (text.trim() === '' || text.trim() === 'WEBVTT') {
        toast('No timed text to export. Subtitles need segments with timestamps and text.');
        return;
      }
      downloadText(text, `${baseName} - ${langName(outLang)}.${format}`, format === 'srt' ? 'application/x-subrip' : 'text/vtt');
    });

  // ----- invoice numbers -----
  const autoQuantity =
    project.rateUnit === 'word'
      ? draft.basis === 'source'
        ? stats.sourceWords
        : stats.targetWords
      : stats.minutes === null
        ? 0
        : Math.round(stats.minutes * 100) / 100;
  const quantity = parseNumber(draft.quantity) ?? autoQuantity;
  const taxPercent = parseNumber(draft.taxPercent) ?? 0;
  const totals = invoiceTotals(quantity, project.rate, taxPercent);
  const autoNumber = formatInvoiceNumber(business.nextInvoiceNumber);
  const invoiceNumber = draft.number.trim() === '' ? autoNumber : draft.number.trim();
  const autoDescription =
    `${project.rateUnit === 'word' ? 'Translation' : 'Transcription / subtitling'} ` +
    `(${directionLabel(project.direction)}) — ${project.name}`;
  const description = draft.description.trim() === '' ? autoDescription : draft.description;
  const unitLabel = project.rateUnit === 'word' ? 'word' : 'minute';

  const printInvoice = async () => {
    try {
      if (draft.number.trim() === '') {
        // Fix the automatic number on this invoice and move the counter on for the next one.
        updateDraft({ number: autoNumber });
        const nextBusiness = { ...business, nextInvoiceNumber: business.nextInvoiceNumber + 1 };
        await setSetting('business', nextBusiness);
        setBusiness(nextBusiness);
      }
    } catch (error) {
      toast(`Could not save the invoice number: ${errorMessage(error)}`, 'error');
    }
    // Let the number render before the print dialog freezes the page.
    window.setTimeout(() => window.print(), 50);
  };

  return (
    <div class="stack">
      <div class="card no-print">
        <div class="card-title">
          <h2>Counts</h2>
        </div>
        <div class="stats">
          <div class="stat">
            <div class="stat-value">{stats.sourceWords.toLocaleString('en-US')}</div>
            <div class="stat-label">Source words ({langName(srcLang)})</div>
          </div>
          <div class="stat">
            <div class="stat-value">{stats.targetWords.toLocaleString('en-US')}</div>
            <div class="stat-label">Target words ({langName(tgtLang)})</div>
          </div>
          <div class="stat">
            <div class="stat-value">{stats.minutes === null ? '—' : formatMinutes(stats.minutes)}</div>
            <div class="stat-label">
              Media length (min:sec)
              {stats.minutes !== null && ` = ${stats.minutes.toFixed(2)} minutes`}
            </div>
          </div>
          <div class="stat">
            <div class="stat-value">
              {stats.confirmed}/{stats.segments}
            </div>
            <div class="stat-label">
              Segments confirmed · {stats.draft} draft · {stats.empty} empty
            </div>
          </div>
        </div>
        <p class="muted small" style={{ marginTop: '10px' }}>
          Characters without spaces: {stats.sourceChars.toLocaleString('en-US')} source ·{' '}
          {stats.targetChars.toLocaleString('en-US')} target. Words are counted like a word processor does: a
          half-space (ZWNJ) does not split a word.
        </p>
      </div>

      <div class="card no-print">
        <div class="card-title">
          <h2>Export</h2>
        </div>
        <div class="form-grid">
          <div class="field">
            <label for="dl-content">Text to deliver</label>
            <select
              id="dl-content"
              class="select"
              value={content}
              onChange={(e) => setContent(e.currentTarget.value as DeliveryContent)}
            >
              <option value="target">Translation — {langName(tgtLang)} (target column)</option>
              <option value="source">Transcript / original — {langName(srcLang)} (source column)</option>
            </select>
          </div>
          <div class="field">
            <span class="label">Options</span>
            <label class="check">
              <input
                type="checkbox"
                checked={fill}
                disabled={content === 'source'}
                onChange={(e) => setFill(e.currentTarget.checked)}
              />
              <span>Use the source text where a segment is not translated yet</span>
            </label>
            {hasTiming && (
              <label class="check">
                <input type="checkbox" checked={rtlMarks} onChange={(e) => setRtlMarks(e.currentTarget.checked)} />
                <span>
                  Persian subtitles: add right-to-left marks
                  <span class="muted small"> — for players that put the full stop on the wrong side</span>
                </span>
              </label>
            )}
          </div>
        </div>

        {content === 'target' && untranslated > 0 && (
          <div class="notice warn" style={{ marginTop: '12px' }}>
            {untranslated} of {stats.segments} segments are not translated.{' '}
            {fill ? 'Their source text will appear in the export.' : 'They will be left out of the export.'}{' '}
            <a href={`#/project/${project.id}/qa`}>Open QA</a>
          </div>
        )}

        <div class="row" style={{ marginTop: '14px' }}>
          <button class="btn primary" onClick={exportDocx}>
            Word document (.docx)
          </button>
          <button class="btn" onClick={exportBilingual}>
            Bilingual two-column (.docx)
          </button>
          <button class="btn" onClick={exportTxt}>
            Plain text (.txt)
          </button>
          {hasTiming && (
            <>
              <button class="btn" onClick={() => exportSubtitles('srt')}>
                Subtitles (.srt)
              </button>
              <button class="btn" onClick={() => exportSubtitles('vtt')}>
                Subtitles (.vtt)
              </button>
            </>
          )}
        </div>
        <p class="muted small" style={{ marginTop: '10px' }}>
          Persian paragraphs are written as right-to-left paragraphs in the .docx, and English words inside them
          stay left-to-right. The bilingual file has the source on the left and the target on the right.
        </p>
      </div>

      <div class="card">
        <div class="card-title no-print">
          <h2>Invoice</h2>
          <span class="muted small">
            from the project rate: {formatMoney(project.rate, project.currency, 4)} per {unitLabel}
          </span>
          <button class="btn primary right" onClick={() => void printInvoice()}>
            Print / save as PDF
          </button>
        </div>

        {project.rate === 0 && (
          <div class="notice warn no-print" style={{ marginBottom: '12px' }}>
            This project has no rate yet. Set it in <a href={`#/project/${project.id}/settings`}>Project settings</a>.
          </div>
        )}
        {business.name.trim() === '' && (
          <div class="notice info no-print" style={{ marginBottom: '12px' }}>
            Add your name and address in <a href="#/settings">Settings &amp; backup</a> so they appear on the invoice.
          </div>
        )}

        <div class="form-grid no-print" style={{ marginBottom: '18px' }}>
          <div class="field">
            <label for="inv-number">Invoice number</label>
            <input
              id="inv-number"
              class="input"
              dir="auto"
              value={draft.number}
              placeholder={`${autoNumber} (automatic)`}
              onInput={(e) => updateDraft({ number: e.currentTarget.value })}
            />
          </div>
          <div class="field">
            <label for="inv-date">Invoice date</label>
            <input
              id="inv-date"
              class="input"
              type="date"
              value={draft.date}
              onInput={(e) => updateDraft({ date: e.currentTarget.value })}
            />
          </div>
          <div class="field">
            <label for="inv-due">Payment due (optional)</label>
            <input
              id="inv-due"
              class="input"
              type="date"
              value={draft.dueDate}
              onInput={(e) => updateDraft({ dueDate: e.currentTarget.value })}
            />
          </div>
          <div class="field">
            <label for="inv-tax">Tax / VAT % (optional)</label>
            <input
              id="inv-tax"
              class={`input ${draft.taxPercent.trim() !== '' && parseNumber(draft.taxPercent) === null ? 'invalid' : ''}`}
              inputMode="decimal"
              dir="ltr"
              value={draft.taxPercent}
              placeholder="0"
              onInput={(e) => updateDraft({ taxPercent: e.currentTarget.value })}
            />
          </div>
          <div class="field">
            <label for="inv-qty">
              Quantity ({unitLabel}s) — automatic: {autoQuantity.toLocaleString('en-US')}
            </label>
            <input
              id="inv-qty"
              class={`input ${draft.quantity.trim() !== '' && parseNumber(draft.quantity) === null ? 'invalid' : ''}`}
              inputMode="decimal"
              dir="ltr"
              value={draft.quantity}
              placeholder={String(autoQuantity)}
              onInput={(e) => updateDraft({ quantity: e.currentTarget.value })}
            />
            {project.rateUnit === 'minute' && stats.minutes === null && (
              <span class="hint">
                No media length known yet: load the audio/video in the Transcribe tab, or type the minutes here.
              </span>
            )}
          </div>
          {project.rateUnit === 'word' ? (
            <div class="field">
              <label for="inv-basis">Words are counted in</label>
              <select
                id="inv-basis"
                class="select"
                value={draft.basis}
                onChange={(e) => updateDraft({ basis: e.currentTarget.value as 'source' | 'target' })}
              >
                <option value="source">the source text ({stats.sourceWords.toLocaleString('en-US')} words)</option>
                <option value="target">the target text ({stats.targetWords.toLocaleString('en-US')} words)</option>
              </select>
            </div>
          ) : (
            <div class="field" />
          )}
          <div class="field">
            <label for="inv-desc">Description</label>
            <textarea
              id="inv-desc"
              class="textarea"
              dir="auto"
              value={draft.description}
              placeholder={autoDescription}
              onInput={(e) => updateDraft({ description: e.currentTarget.value })}
            />
          </div>
          <div class="field">
            <label for="inv-client">Client address and details</label>
            <textarea
              id="inv-client"
              class="textarea"
              dir="auto"
              value={draft.clientDetails}
              onInput={(e) => updateDraft({ clientDetails: e.currentTarget.value })}
            />
          </div>
        </div>

        <div class="invoice" id="invoice-preview">
          <div class="invoice-top">
            <div>
              <h2>INVOICE</h2>
              <div style={{ marginTop: '6px' }}>
                No. <strong dir="auto">{invoiceNumber}</strong>
              </div>
              <div>Date: {formatDate(draft.date) || '—'}</div>
              {draft.dueDate && <div>Payment due: {formatDate(draft.dueDate)}</div>}
            </div>
            <div style={{ textAlign: 'end', maxWidth: '50%' }}>
              <div class="label">From</div>
              <strong dir="auto" style={{ display: 'block' }}>
                {business.name || 'Your name (add it in Settings)'}
              </strong>
              <div class="pre-wrap" dir="auto">
                {business.details}
              </div>
            </div>
          </div>

          <div class="invoice-parties">
            <div>
              <div class="label">Bill to</div>
              <strong dir="auto" style={{ display: 'block' }}>
                {project.client || 'Client name (add it in Project settings)'}
              </strong>
              <div class="pre-wrap" dir="auto">
                {draft.clientDetails}
              </div>
            </div>
            <div>
              <div class="label">Project</div>
              <div dir="auto">{project.name}</div>
              {project.deadline && (
                <div style={{ color: '#6b7280' }}>
                  Deadline: {formatDate(project.deadline)} ·{' '}
                  <span lang="fa" dir="rtl">
                    {formatPersianDate(project.deadline)}
                  </span>
                </div>
              )}
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Description</th>
                <th class="num">Quantity</th>
                <th class="num">Rate</th>
                <th class="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td class="pre-wrap" dir="auto">
                  {description}
                </td>
                <td class="num">
                  {quantity.toLocaleString('en-US', { maximumFractionDigits: 2 })} {unitLabel}
                  {quantity === 1 ? '' : 's'}
                </td>
                <td class="num">{formatMoney(project.rate, project.currency, 4)}</td>
                <td class="num">{formatMoney(totals.subtotal, project.currency)}</td>
              </tr>
            </tbody>
          </table>

          {taxPercent > 0 && (
            <>
              <div class="invoice-total" style={{ fontSize: '14px', fontWeight: 400, marginBottom: '4px' }}>
                <span>Subtotal</span>
                <span class="num">{formatMoney(totals.subtotal, project.currency)}</span>
              </div>
              <div class="invoice-total" style={{ fontSize: '14px', fontWeight: 400, marginBottom: '8px' }}>
                <span>Tax {taxPercent}%</span>
                <span class="num">{formatMoney(totals.tax, project.currency)}</span>
              </div>
            </>
          )}
          <div class="invoice-total">
            <span>Total</span>
            <span class="num">{formatMoney(totals.total, project.currency)}</span>
          </div>

          {business.paymentNotes.trim() !== '' && (
            <div>
              <div class="label">Payment</div>
              <div class="pre-wrap" dir="auto">
                {business.paymentNotes}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
