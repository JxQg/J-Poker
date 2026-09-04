import { useEffect, useState } from 'react';

const currentMatch = (query: string): boolean => (
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches
    : false
);

export const useMediaQuery = (query: string): boolean => {
  const [matches, setMatches] = useState(() => currentMatch(query));

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);
    const update = () => setMatches(mediaQuery.matches);
    update();
    mediaQuery.addEventListener('change', update);
    return () => mediaQuery.removeEventListener('change', update);
  }, [query]);

  return matches;
};
