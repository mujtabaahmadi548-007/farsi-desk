/** Audio helpers for the transcription mode: decoding, waveform peaks and chunk planning for Whisper. */

/** Whisper expects 16 kHz mono; the waveform is drawn from the same data. */
export const TARGET_SAMPLE_RATE = 16_000;

export interface DecodedAudio {
  /** Mono samples in the range −1 … 1 */
  samples: Float32Array;
  sampleRate: number;
  /** Seconds */
  duration: number;
}

type AudioContextCtor = new (options?: AudioContextOptions) => AudioContext;

function audioContextCtor(): AudioContextCtor {
  const scope = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  const ctor = scope.AudioContext ?? scope.webkitAudioContext;
  if (!ctor) throw new Error('This browser cannot decode audio (no Web Audio support).');
  return ctor;
}

function mixToMono(buffer: AudioBuffer): Float32Array {
  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i++) mono[i] += data[i];
  }
  if (buffer.numberOfChannels > 1) {
    for (let i = 0; i < mono.length; i++) mono[i] /= buffer.numberOfChannels;
  }
  return mono;
}

/**
 * Decodes an audio or video file to 16 kHz mono. Works for every container/codec the browser itself
 * can play. Throws when the file has no decodable audio track or is too large for the device's memory.
 */
export async function decodeToMono16k(blob: Blob): Promise<DecodedAudio> {
  const Ctor = audioContextCtor();
  const bytes = await blob.arrayBuffer();
  let context: AudioContext;
  try {
    // Asking for a 16 kHz context makes the browser resample while decoding, which keeps memory low.
    context = new Ctor({ sampleRate: TARGET_SAMPLE_RATE });
  } catch {
    context = new Ctor();
  }
  try {
    const decoded = await context.decodeAudioData(bytes);
    if (decoded.sampleRate === TARGET_SAMPLE_RATE) {
      return { samples: mixToMono(decoded), sampleRate: TARGET_SAMPLE_RATE, duration: decoded.duration };
    }
    // The browser ignored the requested rate: resample explicitly.
    const frames = Math.max(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE));
    const offline = new OfflineAudioContext(1, frames, TARGET_SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return { samples: rendered.getChannelData(0).slice(), sampleRate: TARGET_SAMPLE_RATE, duration: decoded.duration };
  } finally {
    void context.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Waveform peaks
// ---------------------------------------------------------------------------

export interface Peaks {
  /** Number of min/max pairs per second of audio */
  perSecond: number;
  min: Float32Array;
  max: Float32Array;
}

/** Reduces the samples to one min/max pair per bucket, which is all a waveform drawing needs. */
export function computePeaks(samples: Float32Array, sampleRate: number, perSecond = 100): Peaks {
  const bucket = Math.max(1, Math.round(sampleRate / perSecond));
  const count = Math.ceil(samples.length / bucket);
  const min = new Float32Array(count);
  const max = new Float32Array(count);
  for (let b = 0; b < count; b++) {
    let lo = Infinity;
    let hi = -Infinity;
    const end = Math.min(samples.length, (b + 1) * bucket);
    for (let i = b * bucket; i < end; i++) {
      const value = samples[i];
      if (value < lo) lo = value;
      if (value > hi) hi = value;
    }
    min[b] = lo === Infinity ? 0 : lo;
    max[b] = hi === -Infinity ? 0 : hi;
  }
  return { perSecond: sampleRate / bucket, min, max };
}

// ---------------------------------------------------------------------------
// Chunk planning for speech recognition
// ---------------------------------------------------------------------------

export interface AudioWindow {
  /** Sample offsets: [start, end) */
  start: number;
  end: number;
}

function rms(samples: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i] * samples[i];
  return to > from ? Math.sqrt(sum / (to - from)) : 0;
}

/**
 * Splits long audio into windows of at most `maxSeconds` (Whisper handles 30 s at a time).
 * Each cut is placed at the quietest 20 ms within the last `searchSeconds` of the window,
 * so that words are not cut in half.
 */
export function planWindows(
  samples: Float32Array,
  sampleRate: number,
  maxSeconds = 28,
  searchSeconds = 6,
): AudioWindow[] {
  const windows: AudioWindow[] = [];
  const maxLength = Math.floor(maxSeconds * sampleRate);
  const searchLength = Math.floor(searchSeconds * sampleRate);
  const frame = Math.max(1, Math.floor(0.02 * sampleRate));
  let start = 0;
  while (start < samples.length) {
    if (samples.length - start <= maxLength) {
      windows.push({ start, end: samples.length });
      break;
    }
    const hardEnd = start + maxLength;
    let bestCut = hardEnd;
    let bestEnergy = Infinity;
    for (let position = hardEnd - searchLength; position + frame <= hardEnd; position += frame) {
      const energy = rms(samples, position, position + frame);
      // "<=" prefers the latest of equally quiet frames: longer windows, fewer of them.
      if (energy <= bestEnergy) {
        bestEnergy = energy;
        bestCut = position + Math.floor(frame / 2);
      }
    }
    windows.push({ start, end: bestCut });
    start = bestCut;
  }
  return windows;
}

/** True when a stretch of audio is practically silent (speech recognisers invent text for silence). */
export function isSilent(samples: Float32Array, start: number, end: number, threshold = 0.004): boolean {
  let peak = 0;
  for (let i = start; i < end; i++) {
    const value = Math.abs(samples[i]);
    if (value > peak) {
      peak = value;
      if (peak > threshold) return false;
    }
  }
  return true;
}
