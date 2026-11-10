import { useEffect, useState } from 'preact/hooks';

export interface Route {
  /** Path segments, e.g. ['project', '<id>', 'editor'] */
  path: string[];
  query: URLSearchParams;
}

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '');
  const queryAt = raw.indexOf('?');
  const pathPart = queryAt === -1 ? raw : raw.slice(0, queryAt);
  const queryPart = queryAt === -1 ? '' : raw.slice(queryAt + 1);
  return {
    path: pathPart
      .split('/')
      .filter((part) => part.length > 0)
      .map((part) => decodeURIComponent(part)),
    query: new URLSearchParams(queryPart),
  };
}

export function navigate(to: string): void {
  const target = to.startsWith('#') ? to : '#' + to;
  if (location.hash === target) {
    // Same hash: still let listeners re-read it (e.g. clicking the same QA issue twice).
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    location.hash = target;
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
