import { useState } from 'preact/hooks';
import { saveProject } from '../db';
import { formatPersianDate } from '../lib/stats';
import { newId, type DigitMode, type Direction, type Project, type RateUnit } from '../types';
import { errorMessage, toast } from '../ui';

export function blankProject(): Project {
  const now = Date.now();
  return {
    id: newId(),
    name: '',
    client: '',
    direction: 'fa-en',
    deadline: '',
    rateUnit: 'word',
    rate: 0,
    currency: 'USD',
    digitMode: 'persian',
    status: 'active',
    notes: '',
    mediaDuration: null,
    mediaName: '',
    isSample: false,
    createdAt: now,
    updatedAt: now,
  };
}

interface Props {
  initial: Project;
  submitLabel: string;
  onSaved: (project: Project) => void;
  onCancel?: () => void;
}

export function ProjectForm({ initial, submitLabel, onSaved, onCancel }: Props) {
  const [draft, setDraft] = useState<Project>(initial);
  const [rateText, setRateText] = useState<string>(initial.rate === 0 ? '' : String(initial.rate));
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof Project>(key: K, value: Project[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const rate = rateText.trim() === '' ? 0 : Number(rateText.replace(',', '.'));
  const nameError = draft.name.trim() === '' ? 'Give the project a name.' : '';
  const rateError = !Number.isFinite(rate) || rate < 0 ? 'Enter a number such as 0.08 or 12.' : '';

  const submit = async (event: Event) => {
    event.preventDefault();
    setSubmitted(true);
    if (nameError || rateError) return;
    setSaving(true);
    try {
      const project: Project = {
        ...draft,
        name: draft.name.trim(),
        client: draft.client.trim(),
        currency: draft.currency.trim(),
        rate,
      };
      await saveProject(project);
      onSaved(project);
    } catch (error) {
      toast(`Could not save the project: ${errorMessage(error)}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <div class="form-grid">
        <div class="field span-2">
          <label for="pf-name">Project name</label>
          <input
            id="pf-name"
            class={`input ${submitted && nameError ? 'invalid' : ''}`}
            dir="auto"
            value={draft.name}
            onInput={(e) => set('name', e.currentTarget.value)}
            placeholder="e.g. Annual report 2026 / گزارش سالانه"
          />
          {submitted && nameError && <span class="hint" style={{ color: 'var(--danger)' }}>{nameError}</span>}
        </div>

        <div class="field">
          <label for="pf-client">Client name</label>
          <input
            id="pf-client"
            class="input"
            dir="auto"
            value={draft.client}
            onInput={(e) => set('client', e.currentTarget.value)}
          />
        </div>

        <div class="field">
          <label for="pf-direction">Direction</label>
          <select
            id="pf-direction"
            class="select"
            value={draft.direction}
            onChange={(e) => set('direction', e.currentTarget.value as Direction)}
          >
            <option value="fa-en">Persian → English (FA→EN)</option>
            <option value="en-fa">English → Persian (EN→FA)</option>
          </select>
        </div>

        <div class="field">
          <label for="pf-deadline">Deadline</label>
          <input
            id="pf-deadline"
            class="input"
            type="date"
            value={draft.deadline}
            onInput={(e) => set('deadline', e.currentTarget.value)}
          />
          {draft.deadline && (
            <span class="hint" lang="fa" dir="rtl">
              {formatPersianDate(draft.deadline)}
            </span>
          )}
        </div>

        <div class="field">
          <label for="pf-unit">Rate is charged</label>
          <select
            id="pf-unit"
            class="select"
            value={draft.rateUnit}
            onChange={(e) => set('rateUnit', e.currentTarget.value as RateUnit)}
          >
            <option value="word">per word (translation)</option>
            <option value="minute">per minute of audio/video</option>
          </select>
        </div>

        <div class="field">
          <label for="pf-rate">Rate per {draft.rateUnit}</label>
          <input
            id="pf-rate"
            class={`input ${submitted && rateError ? 'invalid' : ''}`}
            inputMode="decimal"
            dir="ltr"
            value={rateText}
            onInput={(e) => setRateText(e.currentTarget.value)}
            placeholder={draft.rateUnit === 'word' ? '0.08' : '4.50'}
          />
          {submitted && rateError && <span class="hint" style={{ color: 'var(--danger)' }}>{rateError}</span>}
        </div>

        <div class="field">
          <label for="pf-currency">Currency</label>
          <input
            id="pf-currency"
            class="input"
            list="pf-currencies"
            dir="auto"
            value={draft.currency}
            onInput={(e) => set('currency', e.currentTarget.value)}
          />
          <datalist id="pf-currencies">
            <option value="USD" />
            <option value="EUR" />
            <option value="GBP" />
            <option value="CAD" />
            <option value="AUD" />
            <option value="AED" />
            <option value="IRR" />
            <option value="Toman" />
          </datalist>
        </div>

        <div class="field span-2">
          <label for="pf-digits">Digits in the Persian text of this project</label>
          <select
            id="pf-digits"
            class="select"
            value={draft.digitMode}
            onChange={(e) => set('digitMode', e.currentTarget.value as DigitMode)}
          >
            <option value="persian">Persian digits — ۱۲۳ (Latin and Arabic digits are converted)</option>
            <option value="latin">Latin digits — 123 (Persian and Arabic digits are converted)</option>
            <option value="keep">Keep as typed (only Arabic ٤٥٦ → Persian ۴۵۶)</option>
          </select>
          <span class="hint">Used by the Persian normalizer. You always see a preview before anything changes.</span>
        </div>

        <div class="field span-2">
          <label for="pf-notes">Notes</label>
          <textarea
            id="pf-notes"
            class="textarea"
            dir="auto"
            value={draft.notes}
            onInput={(e) => set('notes', e.currentTarget.value)}
          />
        </div>
      </div>

      <div class="row" style={{ marginTop: '16px' }}>
        <button class="btn primary" type="submit" disabled={saving}>
          {submitLabel}
        </button>
        {onCancel && (
          <button class="btn" type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
