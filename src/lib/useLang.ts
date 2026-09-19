import { useEffect, useState } from 'react';

export type Lang = 'en' | 'km';

export const LANG_STORAGE_KEY = 'nint-anime-lang';

export function useLang() {
  const [lang, setLangState] = useState<Lang>(() => {
    if (typeof window === 'undefined') return 'km';
    const saved = window.localStorage.getItem(LANG_STORAGE_KEY);
    return saved === 'km' || saved === 'en' ? saved : 'km';
  });

  // Tell the document which language it is in, so CSS can stop doing
  // Latin things to Khmer. `:lang(km)` is what turns off letter-spacing
  // and uppercase on the small labels — Khmer has no case, and spacing
  // its glyphs apart pulls a vowel sign or a coeng off the consonant it
  // belongs to, so "គម្រោង" comes apart into "គ ម្រោ ង".
  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = lang;
  }, [lang]);

  const setLang = (next: Lang) => {
    setLangState(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LANG_STORAGE_KEY, next);
    }
  };

  return { lang, setLang, isKm: lang === 'km' };
}
