// PlanEOS · modal + confirm + drawer
import { h, icon } from '../core/dom.js';
import { t } from '../core/i18n.js';

export function openModal({ title, body, footer, width }) {
  const overlay = h('div.overlay');
  const modal = h('div.modal', width ? { style: { width } } : null);
  const closeBtn = h('button.btn.btn--ghost.btn--icon', { onclick: close }, icon('x'));
  const head = h('div.modal__head', h('h3', title || ''), closeBtn);
  const bodyEl = h('div.modal__body');
  if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.append(body);
  modal.append(head, bodyEl);
  if (footer) modal.append(h('div.modal__foot', ...(Array.isArray(footer) ? footer : [footer])));
  overlay.append(modal);
  overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(); });
  function onKey(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
  function close() { document.removeEventListener('keydown', onKey); overlay.remove(); }
  document.body.appendChild(overlay);
  const firstInput = bodyEl.querySelector('input,textarea,select'); firstInput?.focus();
  return { close, modal, bodyEl };
}

export function confirmDialog(message, { danger = true, onConfirm } = {}) {
  const yes = h('button', { class: 'btn ' + (danger ? 'btn--danger' : 'btn--primary') }, t('common.delete'));
  const no = h('button.btn.btn--secondary', t('common.cancel'));
  const m = openModal({ title: t('common.confirm_delete'), body: h('p', { style: { color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' } }, message || ''), footer: [no, yes] });
  no.onclick = m.close;
  yes.onclick = async () => { try { await onConfirm?.(); } finally { m.close(); } };
}

export function openDrawer({ title, body }) {
  const overlay = h('div.drawer-overlay');
  const drawer = h('div.drawer');
  const closeBtn = h('button.btn.btn--ghost.btn--icon', { onclick: close }, icon('x'));
  drawer.append(h('div.drawer__head', h('h3', title || ''), closeBtn));
  const bodyEl = h('div.drawer__body');
  if (body) bodyEl.append(body);
  drawer.append(bodyEl);
  overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(); });
  function onKey(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
  function close() { document.removeEventListener('keydown', onKey); overlay.remove(); drawer.remove(); }
  document.body.append(overlay, drawer);
  return { close, bodyEl };
}
