import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { putSegments, subscribe, type StoreName } from './db';
import type { Segment } from './types';

/**
 * Debounced saving of edited segments: `queue` collects changes and writes them 400 ms later,
 * `flush` writes immediately. Pending changes are also written when the page is hidden or the
 * component unmounts, so nothing typed is lost.
 */
export function useSegmentSaver(onError: (error: unknown) => void): {
  queue: (segment: Segment) => void;
  flush: () => Promise<void>;
} {
  const pending = useRef(new Map<string, Segment>());
  const timer = useRef<number | null>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const flush = useCallback(async () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (pending.current.size === 0) return;
    const batch = [...pending.current.values()];
    pending.current.clear();
    try {
      await putSegments(batch);
    } catch (error) {
      onErrorRef.current(error);
    }
  }, []);

  const queue = useCallback(
    (segment: Segment) => {
      pending.current.set(segment.id, segment);
      if (timer.current === null) {
        timer.current = window.setTimeout(() => {
          timer.current = null;
          void flush();
        }, 400);
      }
    },
    [flush],
  );

  useEffect(() => {
    const onHide = () => void flush();
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onHide);
      void flush();
    };
  }, [flush]);

  return { queue, flush };
}

/**
 * Loads data from IndexedDB and reloads it whenever one of `stores` changes.
 * Returns `undefined` until the first load finishes.
 */
export function useLive<T>(load: () => Promise<T>, stores: StoreName[], deps: unknown[]): T | undefined {
  const [value, setValue] = useState<T | undefined>(undefined);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let cancelled = false;
    let running = 0;
    const run = () => {
      const ticket = ++running;
      loadRef.current().then(
        (result) => {
          if (!cancelled && ticket === running) setValue(result);
        },
        (error: unknown) => {
          console.error('Farsi Desk: failed to load data', error);
        },
      );
    };
    run();
    const unsubscribe = subscribe((changed) => {
      if (changed.some((store) => stores.includes(store))) run();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return value;
}
