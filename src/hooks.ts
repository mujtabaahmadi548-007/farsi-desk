import { useEffect, useRef, useState } from 'preact/hooks';
import { subscribe, type StoreName } from './db';

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
