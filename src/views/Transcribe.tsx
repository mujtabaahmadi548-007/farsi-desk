import { memo } from 'preact/compat';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Waveform } from '../components/Waveform';
import { deleteMedia, deleteSegments, getMedia, listSegments, putMedia, putSegments, saveProject } from '../db';
import { useSegmentSaver } from '../hooks';
import { computePeaks, decodeToMono16k, type DecodedAudio } from '../lib/audio';
import { segmentsToCues } from '../lib/delivery';
import { downloadText, safeFileName } from '../lib/download';
import { createSegment } from '../lib/segments';
import { formatClock, formatSrt, formatTranscript, formatVtt, parseTimestamp } from '../lib/srt';
import { langDir, langName, sourceLang, type Lang, type Project, type Segment } from '../types';
import { confirmDialog, errorMessage, FileButton, toast } from '../ui';

/** Files above this size are not decoded automatically: decoding needs several times the file size in memory. */
const AUTO_DECODE_LIMIT = 300 * 1024 * 1024;
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

interface MediaState {
  url: string;
  name: string;
  isVideo: boolean;
  blob: Blob;
}

type DecodeState = 'idle' | 'decoding' | 'ready' | 'failed' | 'skipped';

interface RowActions {
  changeText: (id: string, text: string) => void;
  setTime: (id: string, field: 'start' | 'end', value: number | null) => void;
  setToNow: (id: string, field: 'start' | 'end') => void;
  play: (id: string) => void;
  remove: (id: string) => void;
  focus: (id: string) => void;
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

function TimeInput(props: { label: string; value: number | null; onCommit: (value: number | null) => void }) {
  const { label, value, onCommit } = props;
  const [text, setText] = useState(value === null ? '' : formatClock(value));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setText(value === null ? '' : formatClock(value));
  }, [value, editing]);

  const commit = () => {
    setEditing(false);
    const trimmed = text.trim();
    if (trimmed === '') {
      if (label === 'Start') {
        toast('A segment needs a start time.');
        setText(value === null ? '' : formatClock(value));
      } else {
        onCommit(null);
      }
      return;
    }
    const parsed = parseTimestamp(trimmed);
    if (parsed === null) {
      toast(`“${trimmed}” is not a time. Use minutes:seconds, for example 1:23.5`);
      setText(value === null ? '' : formatClock(value));
      return;
    }
    onCommit(round3(parsed));
  };

  return (
    <input
      class="input"
      dir="ltr"
      aria-label={`${label} time`}
      placeholder={label === 'End' ? 'open' : ''}
      value={text}
      onFocus={() => setEditing(true)}
      onInput={(e) => setText(e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}

interface RowProps {
  seg: Segment;
  number: number;
  current: boolean;
  lang: Lang;
  hasMedia: boolean;
  actions: RowActions;
}

const TsRow = memo(function TsRow({ seg, number, current, lang, hasMedia, actions }: RowProps) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(56, el.scrollHeight + 2)}px`;
  }, [seg.source]);

  return (
    <div class={`ts-row ${current ? 'current' : ''}`} data-ts={seg.id}>
      <div class="muted mono" style={{ paddingTop: '6px' }}>
        {number}
      </div>
      <div class="ts-times">
        <div class="ts-time">
          <TimeInput label="Start" value={seg.start} onCommit={(value) => actions.setTime(seg.id, 'start', value)} />
          <button
            class="btn small"
            disabled={!hasMedia}
            title="Set the start to the playhead position"
            onClick={() => actions.setToNow(seg.id, 'start')}
          >
            ⇤ now
          </button>
        </div>
        <div class="ts-time">
          <TimeInput label="End" value={seg.end} onCommit={(value) => actions.setTime(seg.id, 'end', value)} />
          <button
            class="btn small"
            disabled={!hasMedia}
            title="Set the end to the playhead position"
            onClick={() => actions.setToNow(seg.id, 'end')}
          >
            now ⇥
          </button>
        </div>
      </div>
      <textarea
        ref={textRef}
        class="textarea ts-text"
        dir={langDir(lang)}
        lang={lang}
        value={seg.source}
        placeholder="Type what you hear…"
        aria-label={`Transcript of segment ${number}`}
        onFocus={() => actions.focus(seg.id)}
        onInput={(e) => actions.changeText(seg.id, e.currentTarget.value)}
      />
      <div class="row" style={{ gap: '4px' }}>
        <button
          class="btn small"
          disabled={!hasMedia}
          title="Play this segment"
          aria-label={`Play segment ${number}`}
          onClick={() => actions.play(seg.id)}
        >
          ▶ Play
        </button>
        <button
          class="btn small ghost"
          title="Delete this segment"
          aria-label={`Delete segment ${number}`}
          onClick={() => actions.remove(seg.id)}
        >
          Delete
        </button>
      </div>
    </div>
  );
});

export function Transcribe({ project }: { project: Project }) {
  const lang = sourceLang(project.direction);
  const [segments, setSegmentsState] = useState<Segment[] | null>(null);
  const segmentsRef = useRef<Segment[]>([]);
  const [media, setMedia] = useState<MediaState | null>(null);
  const [mediaEl, setMediaEl] = useState<HTMLMediaElement | null>(null);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [decoded, setDecoded] = useState<DecodedAudio | null>(null);
  const [decodeState, setDecodeState] = useState<DecodeState>('idle');
  const [decodeError, setDecodeError] = useState('');
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [withStamps, setWithStamps] = useState(true);
  const [loadingSample, setLoadingSample] = useState(false);
  const [noPicture, setNoPicture] = useState(false);

  const stopAt = useRef<number | null>(null);
  const wantFocus = useRef<string | null>(null);
  const projectRef = useRef(project);
  projectRef.current = project;
  const mediaUrl = useRef<string | null>(null);

  const saver = useSegmentSaver((error) => toast(`Could not save your changes: ${errorMessage(error)}`, 'error'));

  const commit = (next: Segment[]) => {
    segmentsRef.current = next;
    setSegmentsState(next);
  };

  // ----- loading -----------------------------------------------------------

  const startDecoding = (blob: Blob) => {
    setDecoded(null);
    setDecodeError('');
    setDecodeState('decoding');
    decodeToMono16k(blob).then(
      (audio) => {
        setDecoded(audio);
        setDecodeState('ready');
        // Some containers (e.g. recorded WebM) do not report a duration to the player.
        setDuration((current) => (Number.isFinite(current) && current > 0 ? current : audio.duration));
      },
      (error: unknown) => {
        setDecodeError(errorMessage(error));
        setDecodeState('failed');
      },
    );
  };

  const attachMedia = (blob: Blob, name: string) => {
    if (mediaUrl.current) URL.revokeObjectURL(mediaUrl.current);
    const url = URL.createObjectURL(blob);
    mediaUrl.current = url;
    stopAt.current = null;
    setTime(0);
    setDuration(0);
    setPlaying(false);
    setNoPicture(false);
    // Some systems report no MIME type for .mkv / .mov files: fall back to the file extension.
    const isVideo =
      blob.type.startsWith('video/') || (!blob.type.startsWith('audio/') && /\.(mp4|m4v|mov|webm|mkv|avi|ogv)$/i.test(name));
    setMedia({ url, name, isVideo, blob });
    if (blob.size > AUTO_DECODE_LIMIT) {
      setDecoded(null);
      setDecodeState('skipped');
    } else {
      startDecoding(blob);
    }
  };

  useEffect(() => {
    let cancelled = false;
    Promise.all([listSegments(project.id), getMedia(project.id)]).then(
      ([list, stored]) => {
        if (cancelled) return;
        commit(list);
        if (stored) attachMedia(stored.blob, stored.name);
      },
      (error: unknown) => toast(`Could not load the project data: ${errorMessage(error)}`, 'error'),
    );
    return () => {
      cancelled = true;
      if (mediaUrl.current) URL.revokeObjectURL(mediaUrl.current);
      mediaUrl.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const loadFile = async (file: Blob, name: string) => {
    if (!file.type.startsWith('audio/') && !file.type.startsWith('video/') && file.type !== '') {
      toast('Choose an audio or video file (for example .mp3, .wav, .m4a, .mp4 or .webm).', 'error');
      return;
    }
    attachMedia(file, name);
    try {
      await putMedia({ projectId: project.id, name, type: file.type, blob: file });
    } catch (error) {
      toast(
        `The file plays, but the browser could not store it (${errorMessage(error)}). ` +
          'You will have to choose it again next time.',
        'error',
      );
    }
    try {
      await saveProject({ ...projectRef.current, mediaName: name, mediaDuration: null });
    } catch (error) {
      toast(`Could not update the project: ${errorMessage(error)}`, 'error');
    }
  };

  const loadSample = async () => {
    setLoadingSample(true);
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}sample-audio.wav`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      await loadFile(new Blob([blob], { type: 'audio/wav' }), 'sample-audio.wav');
    } catch (error) {
      toast(`Could not load the sample recording: ${errorMessage(error)}`, 'error');
    } finally {
      setLoadingSample(false);
    }
  };

  const removeMedia = async () => {
    const ok = await confirmDialog({
      title: 'Remove the media file?',
      message: 'The audio/video is removed from this project. Your transcript segments and their timestamps stay.',
      confirmLabel: 'Remove media',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteMedia(project.id);
      await saveProject({ ...projectRef.current, mediaName: '', mediaDuration: null });
      if (mediaUrl.current) URL.revokeObjectURL(mediaUrl.current);
      mediaUrl.current = null;
      setMedia(null);
      setDecoded(null);
      setDecodeState('idle');
      setDuration(0);
      setTime(0);
      setPlaying(false);
    } catch (error) {
      toast(`Could not remove the media: ${errorMessage(error)}`, 'error');
    }
  };

  // Remember the media length on the project (used for per-minute invoices and the dashboard).
  useEffect(() => {
    if (!media || !Number.isFinite(duration) || duration <= 0) return;
    const current = projectRef.current;
    if (current.mediaDuration !== null && Math.abs(current.mediaDuration - duration) < 0.01) return;
    void saveProject({ ...current, mediaDuration: round3(duration), mediaName: media.name }).catch((error: unknown) =>
      toast(`Could not save the media length: ${errorMessage(error)}`, 'error'),
    );
  }, [duration, media]);

  useEffect(() => {
    if (mediaEl) mediaEl.playbackRate = rate;
  }, [rate, mediaEl, media]);

  // Stop at the end of a segment that was started with "Play". Animation frames give a precise stop
  // while the tab is visible; the media's own "timeupdate" events (a few per second) cover the case
  // where the tab is in the background and animation frames are paused.
  useEffect(() => {
    if (!mediaEl || !playing) return;
    let frame = 0;
    const stopIfDue = (): boolean => {
      if (stopAt.current === null || mediaEl.currentTime < stopAt.current) return false;
      mediaEl.pause();
      stopAt.current = null;
      return true;
    };
    const check = () => {
      if (!stopIfDue()) frame = window.requestAnimationFrame(check);
    };
    frame = window.requestAnimationFrame(check);
    mediaEl.addEventListener('timeupdate', stopIfDue);
    return () => {
      window.cancelAnimationFrame(frame);
      mediaEl.removeEventListener('timeupdate', stopIfDue);
    };
  }, [mediaEl, playing]);

  // ----- segments ----------------------------------------------------------

  const timed = useMemo(
    () =>
      (segments ?? [])
        .filter((s): s is Segment & { start: number } => s.start !== null)
        .sort((a, b) => a.start - b.start || a.order - b.order),
    [segments],
  );
  const untimedCount = (segments ?? []).length - timed.length;

  /**
   * Puts the list in its canonical order (plain text segments first, then timed segments by start
   * time), renumbers it, gives timed segments consecutive paragraph numbers, and saves what changed.
   */
  const restructure = async (list: Segment[], alsoSave: string[] = []) => {
    const untimed = list.filter((s) => s.start === null).sort((a, b) => a.order - b.order);
    const timedSorted = list
      .filter((s) => s.start !== null)
      .sort((a, b) => (a.start as number) - (b.start as number) || a.order - b.order);
    const paragraphBase = untimed.reduce((max, s) => Math.max(max, s.paragraph), -2) + 2;
    const changedIds = new Set(alsoSave);
    const ordered = [...untimed, ...timedSorted].map((segment, index) => {
      const paragraph = segment.start === null ? segment.paragraph : paragraphBase + (index - untimed.length);
      if (segment.order === index && segment.paragraph === paragraph) return segment;
      changedIds.add(segment.id);
      return { ...segment, order: index, paragraph };
    });
    commit(ordered);
    await putSegments(ordered.filter((segment) => changedIds.has(segment.id)));
  };

  const patch = (id: string, change: Partial<Segment>): Segment | undefined => {
    let updated: Segment | undefined;
    const next = segmentsRef.current.map((s) => {
      if (s.id !== id) return s;
      updated = { ...s, ...change, updatedAt: Date.now() };
      return updated;
    });
    if (updated) commit(next);
    return updated;
  };

  const now = () => (mediaEl ? round3(mediaEl.currentTime) : 0);

  /** "Insert timestamp": closes the segment being worked on at the playhead and starts a new one there. */
  const stamp = async () => {
    const t = now();
    const list = segmentsRef.current;
    const timedList = list
      .filter((s): s is Segment & { start: number } => s.start !== null)
      .sort((a, b) => a.start - b.start);
    const sameStart = timedList.find((s) => Math.abs(s.start - t) < 0.05);
    if (sameStart) {
      wantFocus.current = sameStart.id;
      setFocusedId(sameStart.id);
      focusWanted();
      return;
    }
    await saver.flush();
    const working = [...timedList].reverse().find((s) => s.start <= t);
    const changed: string[] = [];
    let next = list;
    let inheritedEnd: number | null = null;
    if (working && (working.end === null || working.end > t)) {
      // Splitting an existing segment: the new one takes over its old end.
      inheritedEnd = working.end;
      next = next.map((s) => (s.id === working.id ? { ...s, end: t, updatedAt: Date.now() } : s));
      changed.push(working.id);
    }
    const created = createSegment(project.id, list.length, { source: '', start: t, end: inheritedEnd });
    changed.push(created.id);
    wantFocus.current = created.id;
    setFocusedId(created.id);
    try {
      await restructure([...next, created], changed);
    } catch (error) {
      toast(`Could not add the segment: ${errorMessage(error)}`, 'error');
    }
  };

  const focusWanted = () => {
    const id = wantFocus.current;
    if (!id) return;
    const box = document.querySelector<HTMLTextAreaElement>(`[data-ts="${id}"] textarea`);
    if (box) {
      wantFocus.current = null;
      box.focus();
      box.scrollIntoView({ block: 'nearest' });
    }
  };
  useLayoutEffect(focusWanted);

  const togglePlay = () => {
    if (!mediaEl) return;
    stopAt.current = null;
    if (mediaEl.paused) void mediaEl.play().catch((error: unknown) => toast(`Cannot play: ${errorMessage(error)}`, 'error'));
    else mediaEl.pause();
  };

  const seekBy = (delta: number) => {
    if (!mediaEl) return;
    const limit = Number.isFinite(mediaEl.duration) ? mediaEl.duration : duration;
    mediaEl.currentTime = Math.max(0, Math.min(limit || Infinity, mediaEl.currentTime + delta));
  };

  const seekTo = (target: number) => {
    if (!mediaEl) return;
    stopAt.current = null;
    mediaEl.currentTime = target;
  };

  const toggleSlow = () => setRate((current) => (current === 0.75 ? 1 : 0.75));

  const actionsLatest = useRef<RowActions | null>(null);
  actionsLatest.current = {
    changeText: (id, text) => {
      const updated = patch(id, { source: text });
      if (updated) saver.queue(updated);
    },
    setTime: (id, field, value) => {
      const segment = segmentsRef.current.find((s) => s.id === id);
      if (!segment) return;
      if (field === 'end' && value !== null && segment.start !== null && value <= segment.start) {
        toast('The end time must be after the start time.');
        // Re-render so the input shows the stored value again.
        commit([...segmentsRef.current]);
        return;
      }
      const updated = patch(id, { [field]: value });
      if (!updated) return;
      void (async () => {
        try {
          await saver.flush();
          if (field === 'start') await restructure(segmentsRef.current, [id]);
          else await putSegments([updated]);
        } catch (error) {
          toast(`Could not save the time: ${errorMessage(error)}`, 'error');
        }
      })();
    },
    setToNow: (id, field) => actionsLatest.current?.setTime(id, field, now()),
    play: (id) => {
      const index = timed.findIndex((s) => s.id === id);
      const segment = timed[index];
      if (!segment || !mediaEl) return;
      const end = segment.end ?? timed[index + 1]?.start ?? null;
      mediaEl.currentTime = segment.start;
      stopAt.current = end !== null && end > segment.start ? end : null;
      void mediaEl.play().catch((error: unknown) => toast(`Cannot play: ${errorMessage(error)}`, 'error'));
    },
    remove: (id) => {
      void (async () => {
        const segment = segmentsRef.current.find((s) => s.id === id);
        if (!segment) return;
        if (segment.source.trim() !== '' || segment.target.trim() !== '') {
          const ok = await confirmDialog({
            title: 'Delete this segment?',
            message: 'Its text (and translation, if any) is removed. This cannot be undone.',
            confirmLabel: 'Delete segment',
            danger: true,
          });
          if (!ok) return;
        }
        try {
          await saver.flush();
          await deleteSegments([id]);
          await restructure(segmentsRef.current.filter((s) => s.id !== id));
        } catch (error) {
          toast(`Could not delete the segment: ${errorMessage(error)}`, 'error');
        }
      })();
    },
    focus: (id) => setFocusedId(id),
  };
  const actions = useMemo<RowActions>(
    () => ({
      changeText: (id, text) => actionsLatest.current?.changeText(id, text),
      setTime: (id, field, value) => actionsLatest.current?.setTime(id, field, value),
      setToNow: (id, field) => actionsLatest.current?.setToNow(id, field),
      play: (id) => actionsLatest.current?.play(id),
      remove: (id) => actionsLatest.current?.remove(id),
      focus: (id) => actionsLatest.current?.focus(id),
    }),
    [],
  );

  // ----- keyboard shortcuts ------------------------------------------------

  const shortcuts = useRef({ togglePlay, seekBy, toggleSlow, stamp });
  shortcuts.current = { togglePlay, seekBy, toggleSlow, stamp };
  const hasMedia = media !== null;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector('.modal')) return; // a dialog is open: leave the keys to it
      const alt = event.altKey && !event.ctrlKey && !event.metaKey;
      const ctrl = (event.ctrlKey || event.metaKey) && !event.altKey;
      // event.code is used for letters so the shortcuts also work on a Persian keyboard layout.
      let action: (() => void) | null = null;
      if (event.key === 'Escape' || (ctrl && event.code === 'Space') || (alt && event.code === 'KeyP')) {
        action = () => shortcuts.current.togglePlay();
      } else if (event.key === 'F1' || (alt && event.code === 'KeyB')) {
        action = () => shortcuts.current.seekBy(-3);
      } else if (event.key === 'F3' || (alt && event.code === 'KeyN')) {
        action = () => shortcuts.current.seekBy(3);
      } else if (event.key === 'F2' || (alt && event.code === 'KeyR')) {
        action = () => shortcuts.current.toggleSlow();
      } else if ((ctrl || alt) && event.code === 'KeyJ') {
        action = () => void shortcuts.current.stamp();
      }
      if (!action) return;
      event.preventDefault();
      if (hasMedia) action();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hasMedia]);

  // ----- export ------------------------------------------------------------

  const exportAs = (format: 'srt' | 'vtt' | 'txt') => {
    const cues = segmentsToCues(segmentsRef.current, (s) => s.source, duration > 0 ? duration : project.mediaDuration);
    const text =
      format === 'srt' ? formatSrt(cues) : format === 'vtt' ? formatVtt(cues) : formatTranscript(cues, withStamps);
    if (text.trim() === '' || text.trim() === 'WEBVTT') {
      toast('There is no transcript text to export yet.');
      return;
    }
    const mime = format === 'srt' ? 'application/x-subrip' : format === 'vtt' ? 'text/vtt' : 'text/plain';
    const base = safeFileName(project.name, 'transcript');
    downloadText(text, `${base} - transcript (${langName(lang)}).${format}`, mime);
  };

  // ----- render ------------------------------------------------------------

  const wavePeaks = useMemo(() => (decoded ? computePeaks(decoded.samples, decoded.sampleRate, 100) : null), [decoded]);
  // A stable callback ref: the element is reported once when it is created and once when it goes away.
  const mediaRef = useCallback((element: HTMLMediaElement | null) => setMediaEl(element), []);

  if (segments === null) return <div class="card muted">Loading…</div>;

  const currentSegment =
    [...timed].reverse().find((s) => s.start <= time + 0.001 && (s.end === null || time < s.end)) ?? null;
  const shownDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;

  return (
    <div class="stack">
      <div class="card media-box">
        <div class="card-title">
          <h2>Media</h2>
          {media && (
            <span class="muted" dir="auto">
              {media.name}
            </span>
          )}
          <div class="row right">
            <FileButton
              label={media ? 'Replace file…' : 'Choose audio or video…'}
              accept="audio/*,video/*,.mp3,.wav,.m4a,.aac,.ogg,.oga,.opus,.flac,.mp4,.m4v,.mov,.webm,.mkv"
              class={media ? '' : 'primary'}
              onFile={(file) => void loadFile(file, file.name)}
            />
            {!media && (
              <button class="btn" onClick={() => void loadSample()} disabled={loadingSample}>
                Load sample recording (English, 12 s)
              </button>
            )}
            {media && (
              <button class="btn" onClick={() => void removeMedia()}>
                Remove
              </button>
            )}
          </div>
        </div>

        {!media ? (
          <div class="empty-state">
            <h3>Load a recording to transcribe</h3>
            <div>
              Any audio or video file your browser can play works. The file stays on this computer; it is stored
              with the project so it is still here next time.
            </div>
          </div>
        ) : (
          <>
            {media.isVideo ? (
              <video
                key={media.url}
                ref={mediaRef}
                src={media.url}
                preload="metadata"
                playsInline
                // A "video" container that only holds sound (e.g. audio-only WebM) gets no black box.
                style={{ display: noPicture ? 'none' : undefined }}
                onClick={togglePlay}
                onLoadedMetadata={(e) => {
                  setDuration(e.currentTarget.duration);
                  setNoPicture(e.currentTarget.videoWidth === 0);
                }}
                onDurationChange={(e) => setDuration(e.currentTarget.duration)}
                onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
                onSeeked={(e) => setTime(e.currentTarget.currentTime)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
                onError={() => toast('Your browser cannot play this file. Try MP4/H.264, WebM, MP3, WAV or M4A.', 'error')}
              />
            ) : (
              <audio
                key={media.url}
                ref={mediaRef}
                src={media.url}
                preload="metadata"
                onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                onDurationChange={(e) => setDuration(e.currentTarget.duration)}
                onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
                onSeeked={(e) => setTime(e.currentTarget.currentTime)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
                onError={() => toast('Your browser cannot play this file. Try MP3, WAV, M4A or OGG.', 'error')}
              />
            )}

            <div class="transport">
              <button class="btn primary" onClick={togglePlay} style={{ minWidth: '92px', justifyContent: 'center' }}>
                {playing ? '❚❚ Pause' : '▶ Play'}
              </button>
              <button class="btn" onClick={() => seekBy(-3)} title="Rewind 3 seconds (F1)">
                −3 s
              </button>
              <button class="btn" onClick={() => seekBy(3)} title="Forward 3 seconds (F3)">
                +3 s
              </button>
              <span class="mono" aria-label="Playback position">
                {formatClock(time)} / {formatClock(shownDuration, false)}
              </span>
              <label class="row small" style={{ gap: '4px' }}>
                Speed
                <select
                  class="select"
                  style={{ width: 'auto', padding: '4px 6px' }}
                  value={String(rate)}
                  onChange={(e) => setRate(Number(e.currentTarget.value))}
                >
                  {SPEEDS.map((speed) => (
                    <option key={speed} value={String(speed)}>
                      {speed}×
                    </option>
                  ))}
                </select>
              </label>
              <button class={`btn ${rate === 0.75 ? 'primary' : ''}`} onClick={toggleSlow} title="Toggle 0.75× speed (F2)">
                0.75×
              </button>
            </div>

            <Waveform
              peaks={wavePeaks}
              duration={shownDuration}
              media={mediaEl}
              segments={timed}
              currentId={currentSegment?.id ?? null}
              onSeek={seekTo}
            />

            {decodeState === 'decoding' && <p class="muted small">Reading the audio to draw the waveform…</p>}
            {decodeState === 'failed' && (
              <div class="notice warn" style={{ marginTop: '8px' }}>
                The waveform could not be drawn for this file ({decodeError || 'the audio could not be decoded'}).
                Playback, timestamps and manual transcription work normally; automatic transcription needs a file
                the browser can decode.
              </div>
            )}
            {decodeState === 'skipped' && (
              <div class="notice info" style={{ marginTop: '8px' }}>
                This file is large ({Math.round(media.blob.size / 1024 / 1024)} MB), so the waveform is not drawn
                automatically — decoding needs a lot of memory.{' '}
                <button class="btn small" onClick={() => startDecoding(media.blob)}>
                  Draw the waveform anyway
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <div class="card">
        <div class="card-title">
          <h2>Transcript</h2>
          <span class="badge">{timed.length} segments</span>
          <div class="row right">
            <button class="btn primary" disabled={!media} onClick={() => void stamp()} title="Ctrl+J">
              + New segment at playhead
            </button>
            <button class="btn" onClick={() => exportAs('srt')}>
              Export SRT
            </button>
            <button class="btn" onClick={() => exportAs('vtt')}>
              Export VTT
            </button>
            <button class="btn" onClick={() => exportAs('txt')}>
              Export TXT
            </button>
            <label class="check small">
              <input type="checkbox" checked={withStamps} onChange={(e) => setWithStamps(e.currentTarget.checked)} />
              <span>timestamps in TXT</span>
            </label>
          </div>
        </div>

        {untimedCount > 0 && (
          <div class="notice info" style={{ marginBottom: '10px' }}>
            This project also has {untimedCount} text segment{untimedCount === 1 ? '' : 's'} without timestamps
            (from an imported document). They are edited in the <a href={`#/project/${project.id}/editor`}>Editor</a>{' '}
            and are not listed here.
          </div>
        )}

        {timed.length === 0 ? (
          <div class="empty-state">
            <h3>No timestamped segments yet</h3>
            <div>
              Press Play, then press <kbd>Ctrl</kbd>+<kbd>J</kbd> at the start of each sentence and type what you
              hear. Each press closes the previous segment and starts a new one at the playhead.
            </div>
          </div>
        ) : (
          <div style={{ border: '1px solid var(--border)', borderRadius: '6px' }}>
            {timed.map((seg, index) => (
              <TsRow
                key={seg.id}
                seg={seg}
                number={index + 1}
                current={seg.id === currentSegment?.id || (currentSegment === null && seg.id === focusedId && !playing)}
                lang={lang}
                hasMedia={hasMedia}
                actions={actions}
              />
            ))}
          </div>
        )}
        <p class="muted small" style={{ marginTop: '10px' }}>
          The transcript is the {langName(lang)} source text of this project: translate it in the Editor tab and
          export translated subtitles from the Deliver tab.
        </p>
      </div>

      <div class="card">
        <div class="card-title">
          <h2>Keyboard shortcuts</h2>
          <span class="muted small">they work while you type in a segment</span>
        </div>
        <div class="shortcut-list">
          <div>
            <kbd>Esc</kbd> or <kbd>Ctrl</kbd>+<kbd>Space</kbd> or <kbd>Alt</kbd>+<kbd>P</kbd> — play / pause
          </div>
          <div>
            <kbd>F1</kbd> or <kbd>Alt</kbd>+<kbd>B</kbd> — rewind 3 seconds
          </div>
          <div>
            <kbd>F3</kbd> or <kbd>Alt</kbd>+<kbd>N</kbd> — forward 3 seconds
          </div>
          <div>
            <kbd>F2</kbd> or <kbd>Alt</kbd>+<kbd>R</kbd> — 0.75× speed on / off
          </div>
          <div>
            <kbd>Ctrl</kbd>+<kbd>J</kbd> or <kbd>Alt</kbd>+<kbd>J</kbd> — insert timestamp (new segment at the
            playhead)
          </div>
        </div>
      </div>
    </div>
  );
}
