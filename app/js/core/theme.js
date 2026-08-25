// PlanEOS · theme toggle (persisted)
const KEY = 'planeos.theme';
export function initTheme() {
  const saved = localStorage.getItem(KEY);
  const t = saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = t;
}
export function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem(KEY, next);
  return next;
}
export function currentTheme() { return document.documentElement.dataset.theme || 'light'; }
// apply immediately on import to avoid flash
initTheme();
