import type { Lang } from '../types';
import { isSilent, planWindows, type DecodedAudio } from './audio';
import type { WhisperDevice, WorkerRequest, WorkerResponse } from './whisper.worker';

export type { WhisperDevice } from './whisper.worker';

export interface WhisperModel {
  id: 'tiny' | 'base' | 'small';
  /** Repository on the Hugging Face Hub */
  repo: string;
  label: string;
  note: string;
  /** Download size in MB, measured on the Hub in November 2026 (used when the live lookup fails). */
  approxMB: Record<WhisperDevice, number>;
}

export const WHISPER_MODELS: WhisperModel[] = [
  {
    id: 'tiny',
    repo: 'onnx-community/whisper-tiny',
    label: 'Tiny',
    note: 'fastest; fine for clear English, weak for Persian',
    approxMB: { wasm: 39, webgpu: 114 },
  },
  {
    id: 'base',
    repo: 'onnx-community/whisper-base',
    label: 'Base',
    note: 'good for English; a rough draft for Persian',
    approxMB: { wasm: 73, webgpu: 197 },
  },
  {
    id: 'small',
    repo: 'onnx-community/whisper-small',
    label: 'Small',
    note: 'best for Persian; needs a strong computer (ideally WebGPU)',
    approxMB: { wasm: 238, webgpu: 559 },
  },
];

/** Weight files that are downloaded for each device (see the dtype choice in the worker). */
const MODEL_FILES: Record<WhisperDevice, string[]> = {
  wasm: ['onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx'],
  webgpu: ['onnx/encoder_model.onnx', 'onnx/decoder_model_merged_q4.onnx'],
};

/** Exact download size in bytes, read from the Hub; null when the lookup is not possible (e.g. offline). */
export async function fetchDownloadSize(model: WhisperModel, device: WhisperDevice): Promise<number | null> {
  try {
    const response = await fetch(`https://huggingface.co/api/models/${model.repo}/tree/main/onnx`);
    if (!response.ok) return null;
    const files = (await response.json()) as { path: string; size: number }[];
    let total = 0;
    for (const wanted of MODEL_FILES[device]) {
      const file = files.find((item) => item.path === wanted);
      if (!file || typeof file.size !== 'number') return null;
      total += file.size;
    }
    return total;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Can this device do it?
// ---------------------------------------------------------------------------

export interface Capability {
  webgpu: boolean;
  wasm: boolean;
  memoryGB: number | null;
  cores: number;
  /**
   * good: WebGPU · slow: CPU only but a capable machine · weak: too little memory / too few cores ·
   * unsupported: the browser cannot run the engine at all
   */
  verdict: 'good' | 'slow' | 'weak' | 'unsupported';
  /** Device used by default, or null when unsupported. */
  device: WhisperDevice | null;
  message: string;
}

export function judgeCapability(input: { webgpu: boolean; wasm: boolean; memoryGB: number | null; cores: number }): Capability {
  const { webgpu, wasm, memoryGB, cores } = input;
  const specs = `${memoryGB === null ? 'unknown' : `${memoryGB} GB`} memory, ${cores} processor core${cores === 1 ? '' : 's'}`;
  if (!wasm) {
    return {
      ...input,
      verdict: 'unsupported',
      device: null,
      message:
        'This browser cannot run automatic transcription (WebAssembly is not available). ' +
        'Manual transcription below works fully.',
    };
  }
  if (webgpu) {
    return {
      ...input,
      verdict: 'good',
      device: 'webgpu',
      message: `WebGPU is available, so recognition runs on the graphics card (${specs}).`,
    };
  }
  if ((memoryGB !== null && memoryGB < 4) || cores < 4) {
    return {
      ...input,
      verdict: 'weak',
      device: 'wasm',
      message:
        `This device is too weak for automatic transcription (${specs}, no WebGPU): it would be extremely slow ` +
        'or run out of memory. Manual transcription below works fully. You can still try the Tiny model.',
    };
  }
  return {
    ...input,
    verdict: 'slow',
    device: 'wasm',
    message:
      `No WebGPU in this browser, so recognition runs on the processor (${specs}). Expect roughly the length of ` +
      'the recording or longer. Chrome or Edge on a computer with a recent graphics card is much faster.',
  };
}

export async function detectCapability(): Promise<Capability> {
  const nav = navigator as Navigator & {
    gpu?: { requestAdapter: () => Promise<unknown> };
    deviceMemory?: number;
  };
  let webgpu = false;
  try {
    webgpu = nav.gpu !== undefined && (await nav.gpu.requestAdapter()) !== null;
  } catch {
    webgpu = false;
  }
  const wasm = typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function';
  return judgeCapability({
    webgpu,
    wasm,
    memoryGB: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
    cores: navigator.hardwareConcurrency || 1,
  });
}

// ---------------------------------------------------------------------------
// Running a transcription
// ---------------------------------------------------------------------------

export interface TimedText {
  start: number;
  end: number;
  text: string;
}

export interface TranscribeCallbacks {
  /** Bytes downloaded so far across all model files. */
  onDownload: (loaded: number, total: number) => void;
  /** The model is loaded; `device` is what is actually used (WebGPU can fall back to the CPU). */
  onReady: (device: WhisperDevice, fallbackReason: string | null) => void;
  /** Seconds of audio processed so far. */
  onProgress: (doneSeconds: number, totalSeconds: number) => void;
  /** Newly recognised segments, in order, as soon as each stretch of audio is finished. */
  onSegments: (segments: TimedText[]) => void;
}

export interface TranscribeJob {
  /** Resolves with the number of segments produced; rejects on failure. Resolves early when cancelled. */
  done: Promise<number>;
  cancel: () => void;
}

const LANGUAGE_NAME: Record<Lang, string> = { fa: 'persian', en: 'english' };

/**
 * Turns the raw chunks of one audio window into clean, ordered segments on the global timeline.
 * Exported for tests.
 */
export function placeChunks(
  chunks: { start: number; end: number | null; text: string }[],
  windowStart: number,
  windowEnd: number,
  notBefore: number,
): TimedText[] {
  const placed: TimedText[] = [];
  let floor = Math.max(notBefore, windowStart);
  for (const chunk of chunks) {
    const text = chunk.text.trim();
    if (text === '') continue;
    let start = Math.min(Math.max(windowStart + chunk.start, floor), windowEnd);
    let end = chunk.end === null ? windowEnd : Math.min(windowStart + chunk.end, windowEnd);
    if (end <= start) end = Math.min(windowEnd, start + 0.2);
    if (end <= start) start = Math.max(windowStart, end - 0.2);
    placed.push({ start: Math.round(start * 1000) / 1000, end: Math.round(end * 1000) / 1000, text });
    floor = end;
  }
  return placed;
}

/** Starts transcribing decoded audio in a worker. Call `cancel()` to stop; nothing is left running. */
export function transcribeAudio(
  audio: DecodedAudio,
  model: WhisperModel,
  device: WhisperDevice,
  language: Lang,
  callbacks: TranscribeCallbacks,
): TranscribeJob {
  const worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
  let cancelled = false;
  let settle: ((value: WorkerResponse) => void) | null = null;
  let fail: ((reason: Error) => void) | null = null;
  let fallbackReason: string | null = null;
  const files = new Map<string, { loaded: number; total: number }>();

  const send = (request: WorkerRequest, transfer: Transferable[] = []) => worker.postMessage(request, transfer);

  /** Waits for the next 'loaded' / 'result' / 'error' message. */
  const next = () =>
    new Promise<WorkerResponse>((resolve, reject) => {
      settle = resolve;
      fail = reject;
    });

  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    if (message.type === 'progress') {
      files.set(message.file, { loaded: message.loaded, total: message.total });
      let loaded = 0;
      let total = 0;
      for (const file of files.values()) {
        loaded += file.loaded;
        total += file.total;
      }
      callbacks.onDownload(loaded, total);
    } else if (message.type === 'fallback') {
      fallbackReason = message.reason;
    } else if (settle) {
      const resolve = settle;
      settle = null;
      fail = null;
      resolve(message);
    }
  };
  worker.onerror = (event) => {
    const reject = fail;
    settle = null;
    fail = null;
    reject?.(new Error(event.message || 'The speech recognition worker crashed (probably out of memory).'));
  };

  const run = async (): Promise<number> => {
    send({ type: 'load', model: model.repo, device });
    const loaded = await next();
    if (cancelled) return 0;
    if (loaded.type === 'error') throw new Error(loaded.message);
    if (loaded.type !== 'loaded') throw new Error('Unexpected answer from the speech recognition worker.');
    callbacks.onReady(loaded.device, fallbackReason);

    const { samples, sampleRate } = audio;
    const totalSeconds = samples.length / sampleRate;
    const windows = planWindows(samples, sampleRate);
    let produced = 0;
    let lastEnd = 0;
    callbacks.onProgress(0, totalSeconds);
    for (let index = 0; index < windows.length; index++) {
      if (cancelled) break;
      const window = windows[index];
      // Whisper invents text for silence, so silent stretches are skipped entirely.
      if (!isSilent(samples, window.start, window.end)) {
        const piece = samples.slice(window.start, window.end);
        send({ type: 'transcribe', id: index, audio: piece, language: LANGUAGE_NAME[language] }, [piece.buffer]);
        const answer = await next();
        if (cancelled) break;
        if (answer.type === 'error') throw new Error(answer.message);
        if (answer.type !== 'result') throw new Error('Unexpected answer from the speech recognition worker.');
        const placed = placeChunks(answer.chunks, window.start / sampleRate, window.end / sampleRate, lastEnd);
        if (placed.length > 0) {
          lastEnd = placed[placed.length - 1].end;
          produced += placed.length;
          callbacks.onSegments(placed);
        }
      }
      callbacks.onProgress(window.end / sampleRate, totalSeconds);
    }
    return produced;
  };

  const done = run().finally(() => worker.terminate());

  return {
    done,
    cancel: () => {
      cancelled = true;
      worker.terminate();
      // Unblock a pending wait so `done` settles.
      const resolve = settle;
      settle = null;
      fail = null;
      resolve?.({ type: 'error', stage: 'transcribe', message: 'cancelled' });
    },
  };
}
