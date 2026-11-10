import { useEffect, useState } from 'preact/hooks';
import {
  exportBackup,
  getSetting,
  importBackup,
  parseBackup,
  setSetting,
  wipeAllData,
  type BackupFile,
} from '../db';
import { decodeText, downloadText } from '../lib/download';
import { navigate } from '../router';
import { loadSampleProject } from '../sample';
import { DEFAULT_BUSINESS, type BusinessSettings } from '../types';
import { confirmDialog, errorMessage, FileButton, Modal, toast } from '../ui';

function todayStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function Settings() {
  const [business, setBusiness] = useState<BusinessSettings | null>(null);
  const [includeMedia, setIncludeMedia] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ file: BackupFile; name: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSetting<BusinessSettings>('business', DEFAULT_BUSINESS).then((value) => {
      if (!cancelled) setBusiness({ ...DEFAULT_BUSINESS, ...value });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const saveBusiness = async (event: Event) => {
    event.preventDefault();
    if (!business) return;
    try {
      await setSetting('business', business);
      toast('Business details saved.', 'success');
    } catch (error) {
      toast(`Could not save: ${errorMessage(error)}`, 'error');
    }
  };

  const download = async () => {
    setBusy(true);
    try {
      const backup = await exportBackup(includeMedia);
      downloadText(JSON.stringify(backup), `farsi-desk-backup-${todayStamp()}.json`, 'application/json');
      toast(
        `Backup saved: ${backup.projects.length} projects, ${backup.segments.length} segments, ` +
          `${backup.tm.length} TM entries, ${backup.glossary.length} glossary terms.`,
        'success',
      );
    } catch (error) {
      toast(`Backup failed: ${errorMessage(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const openBackup = async (file: File) => {
    try {
      const text = decodeText(await file.arrayBuffer());
      const parsed = parseBackup(JSON.parse(text) as unknown);
      setPending({ file: parsed, name: file.name });
    } catch (error) {
      const reason = error instanceof SyntaxError ? 'The file is not valid JSON.' : errorMessage(error);
      toast(`Could not read the backup: ${reason}`, 'error');
    }
  };

  const restore = async (mode: 'replace' | 'merge') => {
    if (!pending) return;
    setBusy(true);
    try {
      await importBackup(pending.file, mode);
      setPending(null);
      const saved = await getSetting<BusinessSettings>('business', DEFAULT_BUSINESS);
      setBusiness({ ...DEFAULT_BUSINESS, ...saved });
      toast(mode === 'replace' ? 'Backup restored.' : 'Backup merged into your data.', 'success');
    } catch (error) {
      toast(`Restore failed: ${errorMessage(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const addSample = async () => {
    try {
      const id = await loadSampleProject();
      toast('Sample project added.', 'success');
      navigate(`/project/${id}/editor`);
    } catch (error) {
      toast(`Could not create the sample project: ${errorMessage(error)}`, 'error');
    }
  };

  const wipe = async () => {
    const ok = await confirmDialog({
      title: 'Delete ALL data?',
      message:
        'Every project, segment, translation memory entry, glossary term, media file and setting stored by ' +
        'Farsi Desk in this browser will be deleted. Download a backup first if you might need any of it.',
      confirmLabel: 'Delete everything',
      danger: true,
    });
    if (!ok) return;
    try {
      await wipeAllData();
      // Keep the "first run" flag set so the sample is not re-created behind the user's back.
      await setSetting('sampleSeeded', true);
      setBusiness({ ...DEFAULT_BUSINESS });
      toast('All data deleted.', 'success');
    } catch (error) {
      toast(`Could not delete the data: ${errorMessage(error)}`, 'error');
    }
  };

  return (
    <div>
      <div class="page-header">
        <div>
          <h1>Settings &amp; backup</h1>
          <div class="page-sub">Everything is stored in this browser only. Back it up regularly.</div>
        </div>
      </div>

      <div class="stack">
        <div class="card">
          <div class="card-title">
            <h2>Backup</h2>
          </div>
          <p class="muted">
            One JSON file with all projects, segments, translation memory, glossary and settings. Restoring it on
            another computer or browser gives you the same workspace.
          </p>
          <label class="check" style={{ marginBottom: '12px' }}>
            <input
              type="checkbox"
              checked={includeMedia}
              onChange={(e) => setIncludeMedia(e.currentTarget.checked)}
            />
            <span>
              Include audio/video files
              <span class="muted small"> — stored as base64 inside the JSON; the file can become very large</span>
            </span>
          </label>
          <div class="row">
            <button class="btn primary" onClick={download} disabled={busy}>
              Download backup (.json)
            </button>
            <FileButton label="Restore from backup…" accept=".json,application/json" onFile={openBackup} disabled={busy} />
          </div>
        </div>

        <div class="card">
          <div class="card-title">
            <h2>Your business details</h2>
            <span class="muted small">printed on invoices</span>
          </div>
          {business && (
            <form onSubmit={saveBusiness}>
              <div class="form-grid">
                <div class="field">
                  <label for="st-name">Your name or business name</label>
                  <input
                    id="st-name"
                    class="input"
                    dir="auto"
                    value={business.name}
                    onInput={(e) => setBusiness({ ...business, name: e.currentTarget.value })}
                  />
                </div>
                <div class="field">
                  <label for="st-next">Next invoice number</label>
                  <input
                    id="st-next"
                    class="input"
                    type="number"
                    min={1}
                    step={1}
                    value={business.nextInvoiceNumber}
                    onInput={(e) => {
                      const value = Math.max(1, Math.floor(Number(e.currentTarget.value) || 1));
                      setBusiness({ ...business, nextInvoiceNumber: value });
                    }}
                  />
                </div>
                <div class="field">
                  <label for="st-details">Address, e-mail, phone, tax number</label>
                  <textarea
                    id="st-details"
                    class="textarea"
                    dir="auto"
                    value={business.details}
                    onInput={(e) => setBusiness({ ...business, details: e.currentTarget.value })}
                  />
                </div>
                <div class="field">
                  <label for="st-pay">Payment instructions</label>
                  <textarea
                    id="st-pay"
                    class="textarea"
                    dir="auto"
                    value={business.paymentNotes}
                    onInput={(e) => setBusiness({ ...business, paymentNotes: e.currentTarget.value })}
                    placeholder="e.g. bank transfer details, payment due within 30 days"
                  />
                </div>
              </div>
              <div class="row" style={{ marginTop: '14px' }}>
                <button class="btn primary" type="submit">
                  Save business details
                </button>
              </div>
            </form>
          )}
        </div>

        <div class="card">
          <div class="card-title">
            <h2>Sample project</h2>
          </div>
          <p class="muted">
            Adds a fresh copy of the built-in sample: a short Persian notice with a glossary and a few translation
            memory entries, so you can try every feature.
          </p>
          <button class="btn" onClick={addSample}>
            Add sample project
          </button>
        </div>

        <div class="card">
          <div class="card-title">
            <h2>Danger zone</h2>
          </div>
          <p class="muted">Deletes everything Farsi Desk has stored in this browser.</p>
          <button class="btn danger" onClick={wipe}>
            Delete all data…
          </button>
        </div>
      </div>

      {pending && (
        <Modal title="Restore backup" onClose={() => setPending(null)}>
          <div class="modal-body">
            <p>
              <strong dir="auto">{pending.name}</strong>
              <span class="muted"> — saved {new Date(pending.file.exportedAt).toLocaleString('en-GB')}</span>
            </p>
            <table class="table">
              <tbody>
                <tr>
                  <td>Projects</td>
                  <td class="num">{pending.file.projects.length}</td>
                </tr>
                <tr>
                  <td>Segments</td>
                  <td class="num">{pending.file.segments.length}</td>
                </tr>
                <tr>
                  <td>Translation memory entries</td>
                  <td class="num">{pending.file.tm.length}</td>
                </tr>
                <tr>
                  <td>Glossary terms</td>
                  <td class="num">{pending.file.glossary.length}</td>
                </tr>
                <tr>
                  <td>Media files</td>
                  <td class="num">{pending.file.media.length}</td>
                </tr>
              </tbody>
            </table>
            <p class="muted small" style={{ marginTop: '10px' }}>
              <strong>Replace</strong> deletes what is in this browser now and loads the backup.{' '}
              <strong>Merge</strong> keeps your current data and adds the backup to it (items with the same ID are
              overwritten by the backup).
            </p>
          </div>
          <div class="modal-foot">
            <button class="btn" onClick={() => setPending(null)}>
              Cancel
            </button>
            <button class="btn" onClick={() => restore('merge')} disabled={busy}>
              Merge
            </button>
            <button class="btn danger" onClick={() => restore('replace')} disabled={busy}>
              Replace everything
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
