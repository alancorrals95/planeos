// PlanEOS · Knowledge Base — docs list + simple editor
import { mountApp, pageHead } from '../components/appShell.js';
import { h, icon, render } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { list, create, update, remove } from '../core/api.js';
import { getUserId } from '../core/orgContext.js';
import { toastErr, toastOk } from '../core/toast.js';
import { openDrawer, confirmDialog } from '../components/modal.js';
import { handleDbError } from '../components/notice.js';

let content;
function editor(doc) {
  const title = h('input.input', { value: doc?.title || '', placeholder: t('common.title') });
  const body = h('textarea.textarea', { style: { minHeight: '300px' }, value: doc?.body || '' });
  const save = h('button.btn.btn--primary', { onclick: async () => {
    try { if (doc?.id) await update('knowledge_docs', doc.id, { title: title.value, body: body.value });
      else await create('knowledge_docs', { title: title.value.trim() || 'Sin título', body: body.value, author_id: getUserId() });
      toastOk(t('settings.saved')); d.close(); refresh(); } catch (e) { toastErr(e); } }, }, icon('check'), t('common.save'));
  const d = openDrawer({ title: doc?.id ? t('common.edit') : t('common.create'), body: h('div.stack.gap-3', title, body,
    h('div.row.gap-2', save, doc?.id ? h('button.btn.btn--danger.btn--sm', { onclick: () => confirmDialog(doc.title, { onConfirm: async () => { await remove('knowledge_docs', doc.id); d.close(); refresh(); } }) }, icon('trash')) : null)) });
}
async function refresh() {
  try {
    const rows = await list('knowledge_docs', { order: 'updated_at', ascending: false });
    render(document.getElementById('kb'), rows.length ? h('div.grid-auto', ...rows.map(x => h('div.card.card--interactive', { onclick: () => editor(x) },
      h('div.card__title', h(icon('book')), x.title),
      h('p', { style: { color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)', marginTop: '8px', maxHeight: '60px', overflow: 'hidden' } }, (x.body || '').slice(0, 140))))) :
      h('div.empty', icon('book'), h('div.empty__title', 'Sin documentos'), h('div.empty__desc', 'Crea tu primer documento de conocimiento.')));
  } catch (e) { handleDbError(e, document.getElementById('kb'), '0008_misc.sql'); }
}
(async () => {
  const m = await mountApp({ active: 'nav.knowledge' });
  if (!m) return; content = m.content;
  render(content, pageHead(t('nav.knowledge'), 'Documentación de tu empresa.', h('button.btn.btn--primary', { onclick: () => editor(null) }, icon('plus'), t('common.create'))), h('div', { id: 'kb' }));
  refresh();
})();
