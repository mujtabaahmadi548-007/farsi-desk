import { describe, expect, it } from 'vitest';
import { judgeCapability, placeChunks, WHISPER_MODELS } from './whisper';

describe('judgeCapability', () => {
  it('prefers WebGPU when the browser has it', () => {
    const result = judgeCapability({ webgpu: true, wasm: true, memoryGB: 8, cores: 8 });
    expect(result.verdict).toBe('good');
    expect(result.device).toBe('webgpu');
  });

  it('uses the processor on a capable machine without WebGPU and says it will be slow', () => {
    const result = judgeCapability({ webgpu: false, wasm: true, memoryGB: 8, cores: 8 });
    expect(result.verdict).toBe('slow');
    expect(result.device).toBe('wasm');
    expect(result.message).toMatch(/No WebGPU/);
  });

  it('says clearly when the device is too weak, and points to manual mode', () => {
    for (const specs of [
      { memoryGB: 2, cores: 8 },
      { memoryGB: 8, cores: 2 },
    ]) {
      const result = judgeCapability({ webgpu: false, wasm: true, ...specs });
      expect(result.verdict).toBe('weak');
      expect(result.message).toMatch(/too weak/);
      expect(result.message).toMatch(/Manual transcription below works fully/);
    }
  });

  it('does not call a device weak only because its memory is unknown (Firefox, Safari)', () => {
    expect(judgeCapability({ webgpu: false, wasm: true, memoryGB: null, cores: 8 }).verdict).toBe('slow');
  });

  it('reports browsers without WebAssembly as unsupported', () => {
    const result = judgeCapability({ webgpu: false, wasm: false, memoryGB: 8, cores: 8 });
    expect(result.verdict).toBe('unsupported');
    expect(result.device).toBeNull();
    expect(result.message).toMatch(/Manual transcription below works fully/);
  });
});

describe('placeChunks', () => {
  it('moves the chunks of a window onto the timeline of the whole recording', () => {
    const placed = placeChunks(
      [
        { start: 0.5, end: 3.2, text: ' سلام، خوش آمدید.' },
        { start: 3.2, end: 7, text: 'This is Farsi Desk. ' },
      ],
      28,
      56,
      0,
    );
    expect(placed).toEqual([
      { start: 28.5, end: 31.2, text: 'سلام، خوش آمدید.' },
      { start: 31.2, end: 35, text: 'This is Farsi Desk.' },
    ]);
  });

  it('closes an open last chunk at the end of the window and drops empty text', () => {
    const placed = placeChunks(
      [
        { start: 1, end: null, text: 'ناتمام' },
        { start: 5, end: 6, text: '   ' },
      ],
      10,
      20,
      0,
    );
    expect(placed).toEqual([{ start: 11, end: 20, text: 'ناتمام' }]);
  });

  it('never lets segments overlap the previous window or run past their own', () => {
    const placed = placeChunks([{ start: 0, end: 40, text: 'long' }], 28, 56, 29.5);
    expect(placed).toEqual([{ start: 29.5, end: 56, text: 'long' }]);
  });

  it('repairs timestamps that go backwards', () => {
    const placed = placeChunks(
      [
        { start: 2, end: 5, text: 'a' },
        { start: 4, end: 4.5, text: 'b' },
      ],
      0,
      30,
      0,
    );
    expect(placed[0]).toEqual({ start: 2, end: 5, text: 'a' });
    expect(placed[1].start).toBeGreaterThanOrEqual(5);
    expect(placed[1].end).toBeGreaterThan(placed[1].start);
  });
});

describe('model list', () => {
  it('offers three sizes, each with a download size for both devices', () => {
    expect(WHISPER_MODELS.map((model) => model.id)).toEqual(['tiny', 'base', 'small']);
    for (const model of WHISPER_MODELS) {
      expect(model.repo).toMatch(/^onnx-community\/whisper-/);
      expect(model.approxMB.wasm).toBeGreaterThan(0);
      expect(model.approxMB.webgpu).toBeGreaterThan(model.approxMB.wasm);
    }
  });
});
