import { describe, expect, it } from 'vitest';
import { computePeaks, isSilent, planWindows } from './audio';

const RATE = 16_000;

/** A tone with silent gaps: `pattern` lists [seconds, amplitude] stretches. */
function synth(pattern: [number, number][]): Float32Array {
  const total = Math.round(pattern.reduce((sum, [seconds]) => sum + seconds, 0) * RATE);
  const samples = new Float32Array(total);
  let offset = 0;
  for (const [seconds, amplitude] of pattern) {
    const length = Math.round(seconds * RATE);
    for (let i = 0; i < length && offset + i < total; i++) {
      samples[offset + i] = amplitude * Math.sin((2 * Math.PI * 220 * i) / RATE);
    }
    offset += length;
  }
  return samples;
}

describe('computePeaks', () => {
  it('produces one min/max pair per bucket', () => {
    const samples = synth([[2, 0.5]]);
    const peaks = computePeaks(samples, RATE, 100);
    expect(peaks.perSecond).toBe(100);
    expect(peaks.min).toHaveLength(200);
    expect(peaks.max).toHaveLength(200);
    expect(Math.max(...peaks.max)).toBeCloseTo(0.5, 2);
    expect(Math.min(...peaks.min)).toBeCloseTo(-0.5, 2);
  });

  it('shows silence as zero and keeps loud parts where they are', () => {
    const peaks = computePeaks(synth([[1, 0], [1, 0.8], [1, 0]]), RATE, 10);
    expect(Array.from(peaks.max.slice(0, 10)).every((v) => v === 0)).toBe(true);
    expect(Array.from(peaks.max.slice(10, 20)).every((v) => v > 0.7)).toBe(true);
    expect(Array.from(peaks.min.slice(20, 30)).every((v) => v === 0)).toBe(true);
  });

  it('handles a last, incomplete bucket and empty input', () => {
    const peaks = computePeaks(new Float32Array([0.1, -0.2, 0.3]), 2, 1);
    expect(Array.from(peaks.max)).toEqual([new Float32Array([0.1])[0], new Float32Array([0.3])[0]]);
    expect(Array.from(peaks.min)).toEqual([new Float32Array([-0.2])[0], new Float32Array([0.3])[0]]);
    expect(computePeaks(new Float32Array(0), RATE).max).toHaveLength(0);
  });
});

describe('planWindows', () => {
  it('returns a single window for short audio', () => {
    const samples = synth([[12, 0.5]]);
    expect(planWindows(samples, RATE)).toEqual([{ start: 0, end: samples.length }]);
  });

  it('covers the whole recording without gaps or overlaps and never exceeds the maximum', () => {
    const samples = synth([[70, 0.4]]);
    const windows = planWindows(samples, RATE, 28, 6);
    expect(windows[0].start).toBe(0);
    expect(windows[windows.length - 1].end).toBe(samples.length);
    for (let i = 0; i < windows.length; i++) {
      expect(windows[i].end - windows[i].start).toBeLessThanOrEqual(28 * RATE);
      expect(windows[i].end).toBeGreaterThan(windows[i].start);
      if (i > 0) expect(windows[i].start).toBe(windows[i - 1].end);
    }
  });

  it('cuts in the pause between sentences rather than in the middle of speech', () => {
    // speech 0–25 s, pause 25–26 s, speech 26–50 s
    const samples = synth([[25, 0.5], [1, 0], [24, 0.5]]);
    const [first, second] = planWindows(samples, RATE, 28, 6);
    expect(first.end / RATE).toBeGreaterThanOrEqual(25);
    expect(first.end / RATE).toBeLessThanOrEqual(26);
    expect(second).toEqual({ start: first.end, end: samples.length });
  });

  it('returns nothing for empty audio', () => {
    expect(planWindows(new Float32Array(0), RATE)).toEqual([]);
  });
});

describe('isSilent', () => {
  it('tells silence and near-silence from speech', () => {
    const samples = synth([[1, 0], [1, 0.001], [1, 0.3]]);
    expect(isSilent(samples, 0, RATE)).toBe(true);
    expect(isSilent(samples, RATE, 2 * RATE)).toBe(true);
    expect(isSilent(samples, 2 * RATE, 3 * RATE)).toBe(false);
    expect(isSilent(samples, 0, samples.length)).toBe(false);
  });
});
