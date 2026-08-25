// PlanEOS · Issues / Ideas (IDS) — short/long term, rank, solve
import { mountApp, pageHead } from '../components/appShell.js';
import { h, icon, render } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { list, create, update, remove, rpc } from '../core/api.js';
import { supabase } from '../core/supabaseClient.js';
import { getOrgId, getUserId } from '../core/orgContext.js';
import { subscribeTable } from '../core/realtime.js';
import { toastErr } from '../core/toast.js';
import { openDrawer, confirmDialog } from '../components/modal.js';
import { handleDbError } from '../components/notice.js';
import { relatedPanel } from '../components/related.js';
import { toastOk } from '../core/toast.js';

let content, tab = 'short_term', members = [];

async function loadMembers() {
  const { data } = await supabase.from('org_members').select('profiles(id, full_name, email)').eq('org_id', getOrgId()).eq('status', 'active');
  members = (data || []).map(m => m.profiles).filter(Boolean);
}
function memberName(id) { const m = members.find(x => x.id === id); return m?.full_name || m?.email || '—'; }

function row(it, idx) {
  return h('div.list-row', { style: { cursor: 'pointer' }, onclick: (e) => { if (e.target.closest('button,input')) return; openIssue(it); } },
    h('span.list-row__meta.mono', { style: { width: '20px' } }, idx + 1),
    h('input.checkbox', { type: 'checkbox', title: t('rocks.complete'), onclick: async (e) => { e.stopPropagation(); try { await update('issues', it.id, { status: 'solved', solved_at: new Date().toISOString() }); } catch (err) { toastErr(err); } } }),
    h('span.list-row__title', it.title),
    h('button.btn.btn--ghost.btn--icon.btn--sm', { title: t('common.convert_to_task'), onclick: async (e) => { e.stopPropagation(); try { await rpc('convert_entity', { p_from_type: 'issue', p_from_id: it.id }); toastOk(t('common.convert_to_task')); } catch (err) { toastErr(err); } } }, icon('check-square')),
    h('span.avatar.avatar--sm', { title: memberName(it.owner_id) }, (memberName(it.owner_id)[0] || '?').toUpperCase()),
  );
}

function openIssue(it) {
  const desc = h('textarea.textarea', { value: it.description || '', placeholder: '…' });
  desc.addEventListener('change', () => update('issues', it.id, { description: desc.value }).catch(toastErr));
  const owner = h('select.select', ...members.map(m => h('option', { value: m.id, selected: m.id === it.owner_id }, m.full_name || m.email)));
  owner.onchange = () => update('issues', it.id, { owner_id: owner.value }).catch(toastErr);
  openDrawer({ title: it.title, body: h('div.stack.gap-4',
    h('div.field', h('label.field__label', t('common.owner')), owner),
    h('div.field', h('label.field__label', 'Notas / Notes'), desc),
    h('button.btn.btn--secondary.btn--sm', { onclick: async () => { try { await rpc('convert_entity', { p_from_type: 'issue', p_from_id: it.id }); toastOk(t('common.convert_to_task')); } catch (e) { toastErr(e); } } }, icon('check-square'), t('common.convert_to_task')),
    relatedPanel('issue', it.id),
    h('div.row.gap-2', { style: { marginTop: '8px' } },
      h('button.btn.btn--primary.btn--sm', { onclick: async () => { await update('issues', it.id, { status: 'solved', solved_at: new Date().toISOString() }); document.querySelector('.drawer-overlay')?.click(); } }, icon('check'), t('rocks.complete')),
      h('button.btn.btn--danger.btn--sm', { onclick: () => confirmDialog(it.title, { onConfirm: async () => { await remove('issues', it.id); document.querySelector('.drawer-overlay')?.click(); } }) }, icon('trash'))),
  )});
}

function quickAdd() {
  const input = h('input.input', { placeholder: t('issues.placeholder') || 'Describe el tema / idea…', style: { flex: '1' } });
  return h('form.toolbar', { onsubmit: async (e) => { e.preventDefault(); if (!input.value.trim()) return;
    try { await create('issues', { title: input.value.trim(), owner_id: getUserId(), list: tab, status: 'open' }); input.value = ''; } catch (err) { toastErr(err); } } },
    input, h('button.btn.btn--primary', icon('plus'), t('common.add')));
}

async function refresh() {
  try {
    const items = await list('issues', { filters: { list: tab, status: 'open' }, order: 'rank' });
    render(document.getElementById('issues-body'),
      items.length ? h('div.list', ...items.map(row)) :
        h('div.empty', icon('flag'), h('div.empty__title', 'Sin temas'), h('div.empty__desc', 'Agrega un tema o idea para resolver en equipo.')));
  } catch (e) { handleDbError(e, document.getElementById('issues-body'), '0002_eos.sql'); }
}

function viewFor() {
  render(content,
    pageHead(t('nav.issues'), 'Identifica, discute y resuelve (IDS).'),
    h('div.tabs',
      h('button.tab', { 'aria-selected': tab === 'short_term', onclick: () => { tab = 'short_term'; viewFor(); } }, 'Short-Term'),
      h('button.tab', { 'aria-selected': tab === 'long_term', onclick: () => { tab = 'long_term'; viewFor(); } }, 'Long-Term')),
    quickAdd(),
    h('div.card', { style: { padding: '0' } }, h('div', { id: 'issues-body' })));
  refresh();
}

(async () => {
  const m = await mountApp({ active: 'nav.issues' });
  if (!m) return; content = m.content;
  await loadMembers(); viewFor();
  subscribeTable('issues', { filter: `org_id=eq.${getOrgId()}`, onChange: () => refresh() });
})();
