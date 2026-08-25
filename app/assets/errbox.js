// PlanEOS · classic (non-module) global error overlay — shows JS errors on screen
// so a blank page always explains itself.
(function () {
  function show(msg) {
    var d = document.getElementById('__errbox');
    if (!d) { d = document.createElement('div'); d.id = '__errbox'; }
    d.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:99999;background:#2a1517;color:#f07377;border:1px solid #512326;border-radius:8px;padding:12px 14px;font:12px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap;max-height:45vh;overflow:auto;box-shadow:0 8px 28px rgba(0,0,0,.4)';
    d.textContent = '⚠ ' + msg;
    (document.body || document.documentElement).appendChild(d);
  }
  window.addEventListener('error', function (e) {
    if (e && e.target && (e.target.tagName === 'SCRIPT' || e.target.tagName === 'LINK')) {
      show('Failed to load: ' + (e.target.src || e.target.href));
    } else if (e && e.error) {
      show((e.error.stack || e.error.message || e.message || '') + (e.filename ? '\n' + e.filename + ':' + e.lineno : ''));
    } else if (e && e.message) {
      show(e.message + (e.filename ? '\n' + e.filename + ':' + e.lineno : ''));
    }
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason; show('Promise rejection: ' + ((r && (r.stack || r.message)) || r || ''));
  });
})();
