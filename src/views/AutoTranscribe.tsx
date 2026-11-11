import { useEffect, useRef, useState } from 'preact/hooks';
import type { DecodedAudio } from '../lib/audio';
import { formatClock } from '../lib/srt';
import {
  detectCapability,
  fetchDownloadSize,
  transcribeAudio,
  WHISPER_MODELS,
  type Capability,
  type TimedText,
  type TranscribeJob,
  type WhisperDevice,
  type WhisperModel,
} from '../lib/whisper';
import { langName, type Lang } from '../types';
import { confirmDialog, errorMessage, ProgressBar, toast } from '../ui';

interface Props {
  /** Decoded 16 kHz audio of the loaded media, or null when it is not (yet) available. */
  audio: DecodedAudio | null;
  /** Why there is no decoded audio: tells the user what to do. */
  audioState: 'none' | 'decoding' | 'ready' | 'failed' | 'skipped';
  defaultLanguage: Lang;
  existingCount: number;
  /** Removes all timestamped segments (used by "replace"). */
  onClear: () => Promise<void>;
  /** Adds recognised segments to the transcript. */
  onSegments: (segments: TimedText[]) => Promise<void>;
}

type Phase = 'idle' | 'loading' | 'running';

const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0);

const VERDICT_TONE: Record<Capability['verdict'], string> = {
  good: 'ok',
  slow: 'info',
  weak: 'warn',
  unsupported: 'err',
};

export function AutoTranscribe({ audio, audioState, defaultLanguage, existingCount, onClear, onSegments }: Props) {
  const [capability, setCapability] = useState<Capability | null>(null);
  const [language, setLanguage] = useState<Lang>(defaultLanguage);
  const [modelId, setModelId] = useState<WhisperModel['id']>('base');
  const [device, setDevice] = useState<WhisperDevice>('wasm');
  const [exactBytes, setExactBytes] = useState<number | null>(null);
  const [mode, setMode] = useState<'replace' | 'append'>('replace');
  const [phase, setPhase] = useState<Phase>('idle');
  const [download, setDownload] = useState<{ loaded: number; total: number } | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [produced, setProduced] = useState(0);
  const [usedDevice, setUsedDevice] = useState<WhisperDevice | null>(null);
  const [failure, setFailure] = useState('');
  const [fallbackNote, setFallbackNote] = useState('');
  const job = useRef<TranscribeJob | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    void detectCapability().then((result) => {
      if (cancelled) return;
      setCapability(result);
      if (result.device) setDevice(result.device);
      // Sensible starting point: the smallest model on weak devices, a bigger one for Persian on WebGPU.
      if (result.verdict === 'weak') setModelId('tiny');
      else if (result.verdict === 'good' && defaultLanguage === 'fa') setModelId('small');
    });
    return () => {
      cancelled = true;
      job.current?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const model = WHISPER_MODELS.find((item) => item.id === modelId) ?? WHISPER_MODELS[0];

  // Look up the exact download size for the chosen model and device.
  useEffect(() => {
    let cancelled = false;
    setExactBytes(null);
    void fetchDownloadSize(model, device).then((bytes) => {
      if (!cancelled) setExactBytes(bytes);
    });
    return () => {
      cancelled = true;
    };
  }, [model, device]);

  const start = async () => {
    if (!audio || !capability || capability.verdict === 'unsupported') return;
    if (existingCount > 0 && mode === 'replace') {
      const ok = await confirmDialog({
        title: 'Replace the current transcript?',
        message: `The ${existingCount} timestamped segment${existingCount === 1 ? '' : 's'} of this project (and their translations) will be deleted and replaced by the automatic transcript.`,
        confirmLabel: 'Replace transcript',
        danger: true,
      });
      if (!ok) return;
    }
    setFailure('');
    setFallbackNote('');
    setDownload(null);
    setProgress(null);
    setProduced(0);
    setUsedDevice(null);
    setPhase('loading');
    const startedAt = performance.now();
    try {
      if (existingCount > 0 && mode === 'replace') await onClear();
      queue.current = Promise.resolve();
      const running = transcribeAudio(audio, model, device, language, {
        onDownload: (loaded, total) => setDownload({ loaded, total }),
        onReady: (actual, fallbackReason) => {
          setUsedDevice(actual);
          setPhase('running');
          if (fallbackReason) {
            setFallbackNote(`WebGPU could not be used (${fallbackReason}); continuing on the processor.`);
          }
        },
        onProgress: (done, total) => setProgress({ done, total }),
        onSegments: (segments) => {
          setProduced((count) => count + segments.length);
          // Save one batch after the other so segments keep their order.
          queue.current = queue.current.then(() => onSegments(segments));
        },
      });
      job.current = running;
      const count = await running.done;
      await queue.current;
      if (job.current === running) {
        const seconds = Math.round((performance.now() - startedAt) / 1000);
        toast(
          count === 0
            ? 'Transcription finished, but no speech was recognised.'
            : `Transcription finished: ${count} segment${count === 1 ? '' : 's'} in ${seconds} s. Check and correct the text.`,
          count === 0 ? 'info' : 'success',
        );
      }
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      job.current = null;
      setPhase('idle');
    }
  };

  const cancel = () => {
    const running = job.current;
    job.current = null;
    running?.cancel();
    toast('Automatic transcription cancelled. The segments recognised so far are kept.');
  };

  const busy = phase !== 'idle';
  const sizeText =
    exactBytes !== null ? `${mb(exactBytes)} MB` : `about ${model.approxMB[device]} MB`;
  const audioHint: Record<Props['audioState'], string> = {
    none: 'Load an audio or video file first.',
    decoding: 'The audio is still being read…',
    ready: '',
    failed: 'The audio of this file could not be decoded, so it cannot be transcribed automatically.',
    skipped: 'This file is large: press “Draw the waveform anyway” above to decode its audio first.',
  };

  return (
    <div class="card">
      <div class="card-title">
        <h2>Automatic transcription</h2>
        <span class="muted small">Whisper, running entirely on this computer — no audio leaves it</span>
      </div>

      {capability === null ? (
        <p class="muted">Checking what this device can do…</p>
      ) : (
        <div class={`notice ${VERDICT_TONE[capability.verdict]}`} style={{ marginBottom: '12px' }}>
          {capability.message}
        </div>
      )}

      {capability !== null && capability.verdict !== 'unsupported' && (
        <>
          <div class="form-grid">
            <div class="field">
              <label for="at-lang">Spoken language</label>
              <select
                id="at-lang"
                class="select"
                value={language}
                disabled={busy}
                onChange={(e) => setLanguage(e.currentTarget.value as Lang)}
              >
                <option value="fa">{langName('fa')} (فارسی)</option>
                <option value="en">{langName('en')}</option>
              </select>
            </div>
            <div class="field">
              <label for="at-model">Model</label>
              <select
                id="at-model"
                class="select"
                value={modelId}
                disabled={busy}
                onChange={(e) => setModelId(e.currentTarget.value as WhisperModel['id'])}
              >
                {WHISPER_MODELS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label} — about {item.approxMB[device]} MB — {item.note}
                  </option>
                ))}
              </select>
            </div>
            <div class="field">
              <label for="at-device">Runs on</label>
              <select
                id="at-device"
                class="select"
                value={device}
                disabled={busy || !capability.webgpu}
                onChange={(e) => setDevice(e.currentTarget.value as WhisperDevice)}
              >
                {capability.webgpu && <option value="webgpu">Graphics card (WebGPU) — fast</option>}
                <option value="wasm">Processor (WebAssembly) — works everywhere, slower</option>
              </select>
            </div>
            {existingCount > 0 && (
              <div class="field">
                <span class="label">The transcript already has {existingCount} segments</span>
                <label class="check">
                  <input type="radio" name="at-mode" checked={mode === 'replace'} disabled={busy} onChange={() => setMode('replace')} />
                  <span>Replace them</span>
                </label>
                <label class="check">
                  <input type="radio" name="at-mode" checked={mode === 'append'} disabled={busy} onChange={() => setMode('append')} />
                  <span>Keep them and add the new segments</span>
                </label>
              </div>
            )}
          </div>

          <p class="muted small" style={{ marginTop: '10px' }}>
            Download size: <strong>{sizeText}</strong> for the {model.label} model, plus about 27 MB for the
            recognition engine. Both are downloaded once (from huggingface.co and cdn.jsdelivr.net) and then kept in
            the browser cache, so later runs start without downloading.
            {language === 'fa' && modelId !== 'small' && ' For Persian, the Small model is noticeably more accurate.'}
          </p>

          <div class="row" style={{ marginTop: '6px' }}>
            {busy ? (
              <button class="btn danger" onClick={cancel}>
                Cancel
              </button>
            ) : (
              <button class="btn primary" disabled={!audio} onClick={() => void start()}>
                Transcribe automatically
              </button>
            )}
            {!audio && <span class="muted small">{audioHint[audioState]}</span>}
          </div>

          {busy && (
            <div style={{ marginTop: '14px' }}>
              {phase === 'loading' && (
                <>
                  <div class="row small">
                    <strong>Step 1 of 2 — getting the model ready</strong>
                    <span class="muted">
                      {download && download.total > 0
                        ? `${mb(download.loaded)} of ${mb(download.total)} MB downloaded`
                        : 'starting (already-downloaded files load from the cache)…'}
                    </span>
                  </div>
                  <ProgressBar value={download && download.total > 0 ? (download.loaded / download.total) * 100 : 0} />
                </>
              )}
              {phase === 'running' && (
                <>
                  <div class="row small">
                    <strong>Step 2 of 2 — transcribing</strong>
                    <span class="muted">
                      {progress
                        ? `${formatClock(progress.done, false)} of ${formatClock(progress.total, false)} processed`
                        : 'starting…'}{' '}
                      · {produced} segment{produced === 1 ? '' : 's'} so far · on the{' '}
                      {usedDevice === 'webgpu' ? 'graphics card' : 'processor'}
                    </span>
                  </div>
                  <ProgressBar value={progress && progress.total > 0 ? (progress.done / progress.total) * 100 : 0} />
                </>
              )}
            </div>
          )}

          {fallbackNote && (
            <div class="notice info" style={{ marginTop: '12px' }}>
              {fallbackNote}
            </div>
          )}

          {failure && (
            <div class="notice err" style={{ marginTop: '12px' }}>
              <strong>Automatic transcription did not work on this device.</strong> {failure}
              <br />
              This usually means the device ran out of memory or the model could not be downloaded. Try a smaller
              model, close other tabs, or check the internet connection. Manual transcription below is not affected
              and works fully.
            </div>
          )}
        </>
      )}
    </div>
  );
}
