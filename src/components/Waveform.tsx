import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { Peaks } from '../lib/audio';
import { formatClock } from '../lib/srt';

export interface WaveSegment {
  id: string;
  start: number;
  end: number | null;
}

interface Props {
  /** Waveform data, or null while decoding / when the audio could not be decoded. */
  peaks: Peaks | null;
  /** Media length in seconds. */
  duration: number;
  media: HTMLMediaElement | null;
  segments: WaveSegment[];
  /** Segment to emphasise (the one under the playhead). */
  currentId: string | null;
  onSeek: (time: number) => void;
}

const HEIGHT = 110;
const TICK_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
const MAX_PX_PER_SECOND = 400;

function cssColor(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value === '' ? fallback : value;
}

/**
 * Scrollable, zoomable waveform with the transcript segments drawn as regions and a playhead.
 * Only the visible part is drawn (the canvas is as wide as the viewport and sticks to it),
 * so hours of audio stay cheap.
 */
export function Waveform({ peaks, duration, media, segments, currentId, onSeek }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** 0 = fit the whole recording into the visible width */
  const [zoom, setZoom] = useState(0);
  const [viewWidth, setViewWidth] = useState(0);

  const latest = useRef({ peaks, duration, media, segments, currentId, zoom });
  latest.current = { peaks, duration, media, segments, currentId, zoom };

  const pxPerSecond = useCallback((width: number): number => {
    const state = latest.current;
    if (state.duration <= 0) return 1;
    const fit = width / state.duration;
    return state.zoom === 0 ? fit : Math.max(fit, state.zoom);
  }, []);

  const draw = useCallback(() => {
    const box = scrollRef.current;
    const canvas = canvasRef.current;
    if (!box || !canvas) return;
    const state = latest.current;
    const width = box.clientWidth;
    if (width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(HEIGHT * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(HEIGHT * dpr);
      canvas.style.width = `${width}px`;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, HEIGHT);

    const pps = pxPerSecond(width);
    const t0 = box.scrollLeft / pps;
    const toX = (time: number) => (time - t0) * pps;
    const accent = cssColor('--accent', '#0f766e');
    const muted = cssColor('--muted', '#5d6b7c');
    const border = cssColor('--border-strong', '#c4cbd4');
    const danger = cssColor('--danger', '#b42318');
    const mid = HEIGHT / 2 + 6;

    // Segment regions
    state.segments.forEach((segment, index) => {
      const next = state.segments[index + 1];
      const end = segment.end ?? next?.start ?? Math.min(state.duration, segment.start + 2);
      const x0 = toX(segment.start);
      const x1 = toX(end);
      if (x1 < 0 || x0 > width) return;
      ctx.globalAlpha = segment.id === state.currentId ? 0.3 : index % 2 === 0 ? 0.13 : 0.07;
      ctx.fillStyle = accent;
      ctx.fillRect(x0, 14, Math.max(1, x1 - x0), HEIGHT - 14);
      ctx.globalAlpha = 0.8;
      ctx.fillRect(x0, 14, 1, HEIGHT - 14);
      ctx.globalAlpha = 1;
    });

    // Waveform (or a flat line when there is no decoded audio)
    ctx.strokeStyle = muted;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (state.peaks && state.peaks.max.length > 0) {
      const perSecond = state.peaks.perSecond;
      const scale = (HEIGHT - 26) / 2;
      for (let x = 0; x < width; x++) {
        const from = Math.floor((t0 + x / pps) * perSecond);
        const to = Math.max(from + 1, Math.floor((t0 + (x + 1) / pps) * perSecond));
        if (from >= state.peaks.max.length) break;
        let lo = 0;
        let hi = 0;
        for (let i = Math.max(0, from); i < to && i < state.peaks.max.length; i++) {
          if (state.peaks.min[i] < lo) lo = state.peaks.min[i];
          if (state.peaks.max[i] > hi) hi = state.peaks.max[i];
        }
        ctx.moveTo(x + 0.5, mid - hi * scale - 0.5);
        ctx.lineTo(x + 0.5, mid - lo * scale + 0.5);
      }
    } else {
      ctx.moveTo(0, mid);
      ctx.lineTo(Math.min(width, toX(state.duration)), mid);
    }
    ctx.stroke();

    // Time ruler
    const step = TICK_STEPS.find((candidate) => candidate * pps >= 70) ?? 3600;
    ctx.fillStyle = muted;
    ctx.font = '10px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.strokeStyle = border;
    ctx.beginPath();
    for (let tick = Math.floor(t0 / step) * step; tick <= t0 + width / pps && tick <= state.duration; tick += step) {
      if (tick < 0) continue;
      const x = Math.round(toX(tick)) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 12);
      ctx.fillText(formatClock(tick, step < 1), x + 3, 1);
    }
    ctx.stroke();

    // Playhead
    const now = state.media ? state.media.currentTime : 0;
    const px = toX(now);
    if (px >= 0 && px <= width) {
      ctx.strokeStyle = danger;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, HEIGHT);
      ctx.stroke();
    }
  }, [pxPerSecond]);

  // Redraw whenever anything the picture depends on changes.
  useEffect(() => {
    draw();
  });

  // Track the width of the scroll box.
  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    const update = () => {
      setViewWidth(box.clientWidth);
      draw();
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(box);
    return () => observer.disconnect();
  }, [draw]);

  // Follow the media: smooth playhead while playing, and keep it in view.
  useEffect(() => {
    if (!media) return;
    let frame = 0;
    const follow = () => {
      const box = scrollRef.current;
      if (box) {
        const pps = pxPerSecond(box.clientWidth);
        const x = media.currentTime * pps;
        if (x < box.scrollLeft || x > box.scrollLeft + box.clientWidth - 30) {
          box.scrollLeft = Math.max(0, x - box.clientWidth * 0.15);
        }
      }
      draw();
    };
    const loop = () => {
      follow();
      frame = window.requestAnimationFrame(loop);
    };
    const start = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(loop);
    };
    const stop = () => {
      window.cancelAnimationFrame(frame);
      follow();
    };
    media.addEventListener('play', start);
    media.addEventListener('pause', stop);
    media.addEventListener('ended', stop);
    media.addEventListener('seeked', follow);
    media.addEventListener('timeupdate', follow);
    if (!media.paused) start();
    return () => {
      window.cancelAnimationFrame(frame);
      media.removeEventListener('play', start);
      media.removeEventListener('pause', stop);
      media.removeEventListener('ended', stop);
      media.removeEventListener('seeked', follow);
      media.removeEventListener('timeupdate', follow);
    };
  }, [media, draw, pxPerSecond]);

  const seek = (event: MouseEvent) => {
    const box = scrollRef.current;
    const canvas = canvasRef.current;
    if (!box || !canvas || duration <= 0) return;
    const x = event.clientX - canvas.getBoundingClientRect().left;
    const time = (box.scrollLeft + x) / pxPerSecond(box.clientWidth);
    onSeek(Math.max(0, Math.min(duration, time)));
  };

  const changeZoom = (factor: number) => {
    const box = scrollRef.current;
    if (!box || duration <= 0) return;
    const fit = box.clientWidth / duration;
    const current = zoom === 0 ? fit : Math.max(fit, zoom);
    const next = Math.min(MAX_PX_PER_SECOND, current * factor);
    // Keep the playhead where it is on screen while zooming.
    const now = media ? media.currentTime : 0;
    const offset = now * current - box.scrollLeft;
    setZoom(next <= fit * 1.01 ? 0 : next);
    // After the re-render has made the scroll area wider (or narrower), restore the playhead position.
    window.setTimeout(() => {
      const applied = next <= fit * 1.01 ? fit : next;
      box.scrollLeft = Math.max(0, now * applied - offset);
      draw();
    }, 0);
  };

  const fitPps = viewWidth > 0 && duration > 0 ? viewWidth / duration : 0;
  const effective = zoom === 0 ? fitPps : Math.max(fitPps, zoom);
  const totalWidth = Math.max(viewWidth, Math.ceil(duration * effective));

  return (
    <div>
      <div class="wave-scroll" ref={scrollRef} onScroll={draw}>
        <canvas
          ref={canvasRef}
          height={HEIGHT}
          onClick={seek}
          role="img"
          aria-label="Waveform with transcript segments. Click to move the playhead."
        />
        <div class="wave-spacer" style={{ width: `${totalWidth}px` }} />
      </div>
      <div class="row small muted" style={{ marginTop: '6px' }}>
        <span>Zoom</span>
        <button class="btn small" onClick={() => changeZoom(0.5)} disabled={zoom === 0} aria-label="Zoom out">
          −
        </button>
        <button
          class="btn small"
          onClick={() => changeZoom(2)}
          disabled={effective >= MAX_PX_PER_SECOND || duration <= 0}
          aria-label="Zoom in"
        >
          +
        </button>
        <button class="btn small" onClick={() => setZoom(0)} disabled={zoom === 0}>
          Fit
        </button>
        <span>Click the waveform to jump to that point.</span>
      </div>
    </div>
  );
}
