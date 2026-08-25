// PlanEOS · Headlines (Announcements)
import { mountApp, pageHead } from '../components/appShell.js';
import { h, icon, render } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { list, create, remove } from '../core/api.js';
import { getUserId } from '../core/orgContext.js';
import { relTime } from '../core/format.js';
import { toastErr } from '../core/toast.js';
import { openModal, confirmDialog } from '../components/modal.js';
import { handleDbError } from '../components/notice.js';

let content;
function addModal() {
  const title = h('input.input', { required: true });
  const body_ = h('textarea.textarea');
  const save = h('button.btn.btn--primary', { type: 'submit', form: 'hl' }, t('common.create'));
  const cancel = h('button.btn.btn--secondary', t('common.cancel'));
  const body = h('form', { id: 'hl', onsubmit: async (e) => { e.preventDefault();
    try { await create('headlines', { title: title.value.trim(), body: body_.value.trim() || null, author_id: getUserId() }); m.close(); refresh(); } catch (err) { toastErr(err); } } },
    h('div.field', h('label.field__label', t('common.title')), title),
    h('div.field', h('label.field__label', 'Mensaje'), body_));
  const m = openModal({ title: t('nav.headlines'), body, footer: [cancel, save] });
  cancel.onclick = m.close;
}
async function refresh() {
  try {
    const rows = await list('headlines', { filters: { archived_at: null }, order: 'created_at', ascending: false });
    render(document.getElementById('hl-body'), rows.length ? h('div.stack.gap-3', ...rows.map(x => h('div.card',
      h('div.card__header', h('div.card__title', x.title), h('button.btn.btn--ghost.btn--icon.btn--sm', { onclick: () => confirmDialog(x.title, { onConfirm: async () => { await remove('headlines', x.id); refresh(); } }) }, icon('trash'))),
      x.body ? h('p', { style: { color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' } }, x.body) : null,
      h('div.list-row__meta', { style: { marginTop: '8px' } }, relTime(x.created_at))))) :
      h('div.empty', icon('megaphone'), h('div.empty__title', 'Sin anuncios'), h('div.empty__desc', 'Comparte novedades con tu equipo.')));
  } catch (e) { handleDbError(e, document.getElementById('hl-body'), '0008_misc.sql'); }
}
(async () => {
  const m = await mountApp({ active: 'nav.headlines' });
  if (!m) return; content = m.content;
  render(content, pageHead(t('nav.headlines'), 'Comparte anuncios con tu equipo.', h('button.btn.btn--primary', { onclick: addModal }, icon('plus'), t('common.add'))), h('div', { id: 'hl-body' }));
  refresh();
})();
