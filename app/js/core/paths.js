// PlanEOS · path helpers (resolve /app root regardless of deploy folder)
export function appRoot() {
  const p = location.pathname; const idx = p.indexOf('/app/');
  return idx >= 0 ? p.slice(0, idx + 5) : '/';
}
export function to(path) { return appRoot() + path.replace(/^\//, ''); }
export function go(path) { location.href = to(path); }
