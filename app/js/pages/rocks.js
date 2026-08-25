// PlanEOS · Rocks (quarterly goals) with milestones + status
import { mountApp, pageHead } from '../components/appShell.js';
import { h, icon, render } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { list, create, update, remove, rpc } from '../core/api.js';
import { supabase } from '../core/supabaseClient.js';
import { getOrgId, getUserId } from '../core/orgContext.js';
import { fmtDate, currentQuarter } from '../core/format.js';
import { subscribeTable } from '../core/realtime.js';
import { toastErr, toastOk } from '../core/toast.js';
import { openModal, confirmDialog, openDrawer } from '../components/modal.js';
import { relatedPanel } from '../components/related.js';

let content, members = [];

async function loadMembers() {
  const { data } = await supabase.from('org_members').select('profiles(id, full_name, email)').eq('org_id', getOrgId()).eq('status', 'active');
  members = (data || []).map(m => m.profiles).filter(Boolean);
}
function memberName(id) { const m = members.find(x => x.id === id); return m?.full_name || m?.email || '—'; }

const STATUS = {
  on_track:  { label: () => t('rocks.on_track'), cls: 'badge--success' },
  off_track: { label: () => t('rocks.off_track'), cls: 'badge--danger' },
  complete:  { label: () => t('rocks.complete'), cls: 'badge--accent' },
  incomplete:{ label: () => '—', cls: 'badge--neutral' },
};

function statusBadge(s) { const c = STATUS[s] || STATUS.incomplete; return h('span', { class: 'badge badge--dot ' + c.cls }, c.label()); }

function rockRow(r) {
  const cls = r.status === 'off_track' ? 'progress--danger' : r.status === 'complete' ? 'progress--success' : '';
  return h('div.list-row', { style: { cursor: 'pointer' }, onclick: (e) => { if (e.target.closest('button')) return; openRock(r); } },
    statusBadge(r.status),
    h('span.list-row__title', r.title),
    h('div.progress', { class: 'progress ' + cls, style: { maxWidth: '120px' } }, h('div.progress__fill', { style: { width: (r.progress || 0) + '%' } })),
    h('span.list-row__meta.mono', (r.progress || 0) + '%'),
    h('span.avatar.avatar--sm', { title: memberName(r.owner_id) }, (memberName(r.owner_id)[0] || '?').toUpperCase()),
    h('span.list-row__meta', r.due_date ? fmtDate(r.due_date) : ''),
  );
}

async function openRock(r) {
  const { data: milestones } = await supabase.from('milestones').select('*').eq('rock_id', r.id).order('position');
  const msWrap = h('div.list');
  const renderMs = (arr) => render(msWrap, ...arr.map(ms => h('div.list-row',
    h('input.checkbox', { type: 'checkbox', checked: ms.done, onchange: async (e) => { try { await update('milestones', ms.id, { done: e.target.checked, done_at: e.target.checked ? new Date().toISOString() : null }); ms.done = e.target.checked; } catch (err) { toastErr(err); } } }),
    h('span', { class: 'list-row__title', style: ms.done ? { textDecoration: 'line-through', color: 'var(--text-tertiary)' } : null }, ms.title),
    h('button.btn.btn--ghost.btn--icon.btn--sm', { title: t('common.convert_to_task'), onclick: async () => { try { await rpc('convert_entity', { p_from_type: 'milestone', p_from_id: ms.id }); toastOk(t('common.convert_to_task')); } catch (err) { toastErr(err); } } }, icon('check-square')),
    h('span.list-row__meta', ms.due_date ? fmtDate(ms.due_date) : ''),
  )));
  let ms = milestones || [];
  renderMs(ms);
  // Rock progress/status is recomputed by the DB trigger on milestone changes.
  const newMs = h('input.input', { placeholder: t('rocks.milestones') + '…' });
  const addForm = h('form.toolbar', { onsubmit: async (e) => { e.preventDefault(); if (!newMs.value.trim()) return;
    const row = await create('milestones', { rock_id: r.id, title: newMs.value.trim(), position: ms.length }); ms.push(row); renderMs(ms); newMs.value = ''; } },
    newMs, h('button.btn.btn--secondary', icon('plus')));

  const statusSel = h('select.select', ...Object.keys(STATUS).map(s => h('option', { value: s, selected: s === r.status }, STATUS[s].label())));
  statusSel.onchange = () => update('rocks', r.id, { status: statusSel.value });

  openDrawer({ title: r.title, body: h('div.stack.gap-4',
    h('div.field', h('label.field__label', t('common.status')), statusSel),
    h('div.field', h('label.field__label', t('common.owner')), h('div', memberName(r.owner_id))),
    h('div.field', h('label.field__label', t('common.due')), h('div', r.due_date ? fmtDate(r.due_date) : '—')),
    h('h3', { style: { marginTop: '8px' } }, t('rocks.milestones')),
    msWrap, addForm,
    relatedPanel('rock', r.id),
    h('button.btn.btn--danger.btn--sm', { style: { marginTop: '16px' }, onclick: () => confirmDialog(r.title, { onConfirm: async () => { await remove('rocks', r.id); document.querySelector('.drawer-overlay')?.click(); } }) }, icon('trash'), t('common.delete')),
  )});
}

function newRockModal() {
  const title = h('input.input', { required: true, placeholder: t('rocks.new') });
  const owner = h('select.select', ...members.map(m => h('option', { value: m.id, selected: m.id === getUserId() }, m.full_name || m.email)));
  const due = h('input.input', { type: 'date' });
  const save = h('button.btn.btn--primary', t('common.create'));
  const cancel = h('button.btn.btn--secondary', t('common.cancel'));
  const body = h('form', { id: 'rock-form', onsubmit: async (e) => { e.preventDefault();
    try { await create('rocks', { title: title.value.trim(), owner_id: owner.value, due_date: due.value || null, quarter: currentQuarter(), status: 'on_track', progress: 0 }); m.close(); }
    catch (err) { toastErr(err); } } },
    h('div.field', h('label.field__label', t('common.title')), title),
    h('div.field', h('label.field__label', t('common.owner')), owner),
    h('div.field', h('label.field__label', t('common.due')), due),
  );
  save.setAttribute('form', 'rock-form'); save.type = 'submit';
  const m = openModal({ title: t('rocks.new'), body, footer: [cancel, save] });
  cancel.onclick = m.close;
}

async function refresh() {
  try {
    const rocks = await list('rocks', { order: 'created_at', ascending: false });
    const company = rocks.filter(r => r.is_company_rock);
    const dept = rocks.filter(r => !r.is_company_rock);
    render(document.getElementById('rocks-body'),
      dept.length || company.length ? h('div',
        company.length ? h('div', h('div.list-section-label', t('rocks.company')), h('div.list', ...company.map(rockRow))) : null,
        h('div.list', ...dept.map(rockRow)),
      ) : h('div.empty', icon('mountain'), h('div.empty__title', t('rocks.empty')), h('div.empty__desc', t('rocks.empty_desc'))),
    );
  } catch (e) { toastErr(e); }
}

(async () => {
  const mm = await mountApp({ active: 'nav.rocks', title: t('nav.rocks') });
  if (!mm) return; content = mm.content;
  await loadMembers();
  render(content,
    pageHead(t('rocks.title'), t('rocks.sub'), h('button.btn.btn--primary', { onclick: newRockModal }, icon('plus'), t('rocks.new'))),
    h('div.card', { style: { padding: '0' } }, h('div', { id: 'rocks-body' })),
  );
  refresh();
  subscribeTable('rocks', { filter: `org_id=eq.${getOrgId()}`, onChange: () => refresh() });
})();
