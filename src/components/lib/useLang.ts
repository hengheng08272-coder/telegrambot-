import { useState } from 'react';

export type Lang = 'en' | 'km';

export const LANG_STORAGE_KEY = 'nint-anime-lang';

export function useLang() {
  const [lang, setLangState] = useState<Lang>(() => {
    if (typeof window === 'undefined') return 'km';
    const saved = window.localStorage.getItem(LANG_STORAGE_KEY);
    return saved === 'km' || saved === 'en' ? saved : 'km';
  });

  const setLang = (next: Lang) => {
    setLangState(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LANG_STORAGE_KEY, next);
    }
  };

  return { lang, setLang, isKm: lang === 'km' };
}
