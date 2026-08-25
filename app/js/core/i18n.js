// PlanEOS · i18n — loads es/en, t(key), toggle persisted
let dict = {};
let locale = localStorage.getItem('planeos.locale') || (navigator.language || 'es').slice(0, 2);
if (!['es', 'en'].includes(locale)) locale = 'es';

function base() {
  const p = location.pathname; const idx = p.indexOf('/app/');
  return (idx >= 0 ? p.slice(0, idx + 5) : '/') + 'js/i18n/';
}

export async function loadI18n(loc = locale) {
  locale = ['es', 'en'].includes(loc) ? loc : 'es';
  try {
    const res = await fetch(base() + locale + '.json');
    dict = await res.json();
  } catch { dict = {}; }
  document.documentElement.lang = locale;
  hydrate();
  return dict;
}

export function t(key, vars) {
  let s = key.split('.').reduce((o, k) => (o == null ? o : o[k]), dict);
  if (s == null) s = key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}

export function getLocale() { return locale; }

export async function setLocale(loc) {
  localStorage.setItem('planeos.locale', loc);
  await loadI18n(loc);
  window.dispatchEvent(new CustomEvent('locale-changed', { detail: loc }));
}

// hydrate any element with data-i18n / data-i18n-ph
export function hydrate(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-ph]').forEach(el => { el.setAttribute('placeholder', t(el.dataset.i18nPh)); });
}
