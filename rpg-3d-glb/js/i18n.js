// Language: ?lang=en|ja, else the choice saved from the title menu, else Japanese when Japanese is
// anywhere in the browser's language list or the clock is set to Japan (many Japanese setups
// list en-US first), otherwise English.
// Game text is written inline as L(japanese, english).
const KEY = 'astria-lang';

function detect() {
  const q = new URLSearchParams(location.search).get('lang');
  if (q === 'en' || q === 'ja') return q;
  try { const s = localStorage.getItem(KEY); if (s === 'en' || s === 'ja') return s; } catch { /* no storage */ }
  const langs = [...(navigator.languages || []), navigator.language || ''];
  if (langs.some((l) => l.toLowerCase().startsWith('ja'))) return 'ja';
  try { if (Intl.DateTimeFormat().resolvedOptions().timeZone === 'Asia/Tokyo') return 'ja'; } catch { /* no Intl */ }
  return 'en';
}

export const LANG = detect();
export const L = (ja, en) => (LANG === 'en' ? en : ja);

// switch language: remember it and reload (all text is picked when the modules load)
export function setLang(lang) {
  try { localStorage.setItem(KEY, lang); } catch { /* no storage */ }
  const u = new URL(location.href);
  u.searchParams.delete('lang');
  location.href = u.toString();
}
