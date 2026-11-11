/**
 * Web Worker that runs Whisper with transformers.js (ONNX Runtime Web).
 * The model is downloaded from the Hugging Face Hub the first time and cached by the browser.
 * Running in a worker keeps the page responsive while the model loads and transcribes.
 */
import { env, pipeline } from '@huggingface/transformers';

export type WhisperDevice = 'webgpu' | 'wasm';

export type WorkerRequest =
  | { type: 'load'; model: string; device: WhisperDevice }
  | { type: 'transcribe'; id: number; audio: Float32Array; language: string };

export interface WorkerChunk {
  start: number;
  end: number | null;
  text: string;
}

export type WorkerResponse =
  | { type: 'progress'; file: string; loaded: number; total: number }
  | { type: 'fallback'; reason: string }
  | { type: 'loaded'; device: WhisperDevice }
  | { type: 'result'; id: number; chunks: WorkerChunk[]; text: string }
  | { type: 'error'; stage: 'load' | 'transcribe'; id?: number; message: string };

interface AsrOutput {
  text: string;
  chunks?: { timestamp: [number, number | null]; text: string }[];
}
type Transcriber = (audio: Float32Array, options: Record<string, unknown>) => Promise<AsrOutput>;
type LoosePipeline = (task: string, model: string, options: Record<string, unknown>) => Promise<unknown>;

interface WorkerScope {
  postMessage: (message: WorkerResponse) => void;
  addEventListener: (type: 'message', listener: (event: MessageEvent<WorkerRequest>) => void) => void;
}
const scope = self as unknown as WorkerScope;

// Models always come from the Hub; there is no local model folder in this app.
env.allowLocalModels = false;

let transcriber: Transcriber | null = null;

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  // ONNX Runtime sometimes rejects with a bare number (a WebAssembly error code) when memory runs out.
  if (typeof error === 'number') return `the recognition engine stopped (code ${error}); this usually means out of memory`;
  return String(error);
}

async function build(model: string, device: WhisperDevice): Promise<Transcriber> {
  const options: Record<string, unknown> = {
    device,
    // WebGPU: full-precision encoder + 4-bit decoder (the combination recommended for Whisper on WebGPU).
    // WebAssembly: 8-bit quantized weights, which are the smallest and the fastest on a CPU.
    dtype: device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8',
    progress_callback: (info: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (info.status === 'progress' && info.file && typeof info.loaded === 'number' && typeof info.total === 'number') {
        scope.postMessage({ type: 'progress', file: info.file, loaded: info.loaded, total: info.total });
      }
    },
  };
  // The declared type of `pipeline` is a very large union; a loose signature keeps type-checking fast.
  const created = await (pipeline as unknown as LoosePipeline)('automatic-speech-recognition', model, options);
  return created as Transcriber;
}

async function load(model: string, device: WhisperDevice): Promise<void> {
  transcriber = null;
  let used = device;
  try {
    transcriber = await build(model, device);
  } catch (error) {
    if (device !== 'webgpu') throw error;
    // The graphics driver refused the model: fall back to the CPU.
    scope.postMessage({ type: 'fallback', reason: describe(error) });
    used = 'wasm';
    transcriber = await build(model, 'wasm');
  }
  scope.postMessage({ type: 'loaded', device: used });
}

async function transcribe(id: number, audio: Float32Array, language: string): Promise<void> {
  if (!transcriber) throw new Error('The speech model is not loaded.');
  const output = await transcriber(audio, {
    language,
    task: 'transcribe',
    return_timestamps: true,
  });
  const chunks: WorkerChunk[] = (output.chunks ?? [])
    .map((chunk) => ({ start: chunk.timestamp[0], end: chunk.timestamp[1], text: chunk.text.trim() }))
    .filter((chunk) => chunk.text !== '' && Number.isFinite(chunk.start));
  scope.postMessage({ type: 'result', id, chunks, text: output.text.trim() });
}

scope.addEventListener('message', (event) => {
  const request = event.data;
  if (request.type === 'load') {
    load(request.model, request.device).catch((error: unknown) => {
      scope.postMessage({ type: 'error', stage: 'load', message: describe(error) });
    });
  } else {
    transcribe(request.id, request.audio, request.language).catch((error: unknown) => {
      scope.postMessage({ type: 'error', stage: 'transcribe', id: request.id, message: describe(error) });
    });
  }
});
