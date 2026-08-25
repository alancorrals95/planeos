// PlanEOS · CRM Contacts
import { mountApp, pageHead } from '../components/appShell.js';
import { h, icon, render } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { list, create, remove } from '../core/api.js';
import { to } from '../core/paths.js';
import { fmtDate } from '../core/format.js';
import { toastErr } from '../core/toast.js';
import { openModal, confirmDialog } from '../components/modal.js';
import { handleDbError } from '../components/notice.js';

let content;

function crmTabs(active) {
  return h('div.tabs',
    h('a.tab', { href: to('pages/crm/contacts.html'), 'aria-selected': active === 'contacts' }, 'Contactos'),
    h('a.tab', { href: to('pages/crm/deals.html'), 'aria-selected': active === 'deals' }, 'Deals'));
}

function addModal() {
  const fn = h('input.input'), ln = h('input.input'), em = h('input.input', { type: 'email' }), ph = h('input.input'), ti = h('input.input');
  const save = h('button.btn.btn--primary', { type: 'submit', form: 'c-form' }, t('common.create'));
  const cancel = h('button.btn.btn--secondary', t('common.cancel'));
  const body = h('form', { id: 'c-form', onsubmit: async (e) => { e.preventDefault();
    try { await create('crm_contacts', { first_name: fn.value.trim(), last_name: ln.value.trim(), email: em.value.trim() || null, phone: ph.value.trim() || null, title: ti.value.trim() || null }); m.close(); refresh(); } catch (err) { toastErr(err); } } },
    h('div.row.gap-3', h('div.field', { style: { flex: '1' } }, h('label.field__label', 'Nombre'), fn), h('div.field', { style: { flex: '1' } }, h('label.field__label', 'Apellido'), ln)),
    h('div.field', h('label.field__label', 'Email'), em),
    h('div.row.gap-3', h('div.field', { style: { flex: '1' } }, h('label.field__label', 'Teléfono'), ph), h('div.field', { style: { flex: '1' } }, h('label.field__label', 'Cargo'), ti)));
  const m = openModal({ title: 'Nuevo contacto', body, footer: [cancel, save] });
  cancel.onclick = m.close;
}

async function refresh() {
  try {
    const rows = await list('crm_contacts', { order: 'created_at', ascending: false });
    const body = rows.length ? h('div.table-wrap', h('table.table',
      h('thead', h('tr', h('th', 'Nombre'), h('th', 'Email'), h('th', 'Teléfono'), h('th', 'Cargo'), h('th', ''))),
      h('tbody', ...rows.map(c => h('tr',
        h('td', h('div.row.gap-2', h('span.avatar.avatar--sm', ((c.first_name||'?')[0]).toUpperCase()), h('span', `${c.first_name||''} ${c.last_name||''}`))),
        h('td', c.email || '—'), h('td', c.phone || '—'), h('td', c.title || '—'),
        h('td', h('button.btn.btn--ghost.btn--icon.btn--sm', { onclick: () => confirmDialog(`${c.first_name} ${c.last_name}`, { onConfirm: async () => { await remove('crm_contacts', c.id); refresh(); } }) }, icon('trash'))),
      ))))) : h('div.empty', icon('users'), h('div.empty__title', 'Sin contactos'), h('div.empty__desc', 'Agrega tu primer contacto.'));
    render(document.getElementById('crm-body'), body);
  } catch (e) { handleDbError(e, document.getElementById('crm-body'), '0004_crm.sql'); }
}

(async () => {
  const m = await mountApp({ active: 'nav.crm', title: 'nav.crm' });
  if (!m) return; content = m.content;
  render(content, pageHead('CRM', 'Contactos, empresas y pipeline.', h('button.btn.btn--primary', { onclick: addModal }, icon('plus'), 'Contacto')),
    crmTabs('contacts'), h('div', { id: 'crm-body' }, h('div.skeleton', { style: { height: '120px' } })));
  refresh();
})();
