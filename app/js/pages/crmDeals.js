// PlanEOS · CRM Deals — kanban by stage (uses shared kanban component)
import { mountApp, pageHead } from '../components/appShell.js';
import { h, icon, render } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { list, create, update, rpc } from '../core/api.js';
import { supabase } from '../core/supabaseClient.js';
import { getOrgId } from '../core/orgContext.js';
import { to } from '../core/paths.js';
import { fmtMoney } from '../core/format.js';
import { toastErr } from '../core/toast.js';
import { openModal } from '../components/modal.js';
import { handleDbError } from '../components/notice.js';
import { kanban } from '../components/kanban.js';

let content, pipelineId, stages = [], deals = [];

function crmTabs(active) {
  return h('div.tabs',
    h('a.tab', { href: to('pages/crm/contacts.html'), 'aria-selected': active === 'contacts' }, 'Contactos'),
    h('a.tab', { href: to('pages/crm/deals.html'), 'aria-selected': active === 'deals' }, 'Deals'));
}

async function ensurePipeline() {
  pipelineId = await rpc('ensure_default_pipeline', { p_org: getOrgId() });
  const { data } = await supabase.from('crm_stages').select('*').eq('pipeline_id', pipelineId).order('position');
  stages = (data || []).map(s => ({ ...s, column_id: s.id }));
}

function dealCard(d) {
  return h('div',
    h('div.kanban-card__title', d.name),
    h('div.kanban-card__meta', h('span.mono', fmtMoney(d.amount, d.currency)), h('span', d.close_date || '')));
}

function board() {
  // deals carry column_id == stage_id for the shared kanban
  const items = deals.map(d => ({ ...d, column_id: d.stage_id }));
  const node = kanban({
    columns: stages,
    items,
    card: dealCard,
    colHead: (col) => h('span', col.name),
    colActions: (col) => {
      const total = items.filter(i => i.column_id === col.id).reduce((s, d) => s + Number(d.amount || 0), 0);
      return h('span.kanban__count.mono', fmtMoney(total));
    },
    onAddCard: (colId) => addDeal(colId),
    onMove: async ({ id, toColumn, position }) => {
      const deal = deals.find(x => x.id === id); if (!deal) return;
      const stage = stages.find(s => s.id === toColumn);
      deal.stage_id = toColumn; deal.position = position;
      try { await update('crm_deals', id, { stage_id: toColumn, position, status: stage?.probability === 100 ? 'won' : 'open' }); board(); }
      catch (e) { toastErr(e); }
    },
  });
  render(document.getElementById('crm-body'), node);
}

function addDeal(stageId) {
  const name = h('input.input', { required: true });
  const amount = h('input.input', { type: 'number', step: 'any', value: '0' });
  const save = h('button.btn.btn--primary', { type: 'submit', form: 'd-form' }, t('common.create'));
  const cancel = h('button.btn.btn--secondary', t('common.cancel'));
  const body = h('form', { id: 'd-form', onsubmit: async (e) => { e.preventDefault();
    try { const d = await create('crm_deals', { name: name.value.trim(), amount: Number(amount.value || 0), pipeline_id: pipelineId, stage_id: stageId, status: 'open' }); deals.push(d); m.close(); board(); } catch (err) { toastErr(err); } } },
    h('div.field', h('label.field__label', 'Nombre del deal'), name),
    h('div.field', h('label.field__label', 'Monto ($)'), amount));
  const m = openModal({ title: 'Nuevo deal', body, footer: [cancel, save] });
  cancel.onclick = m.close;
}

(async () => {
  const m = await mountApp({ active: 'nav.crm', title: 'nav.crm' });
  if (!m) return; content = m.content;
  render(content, pageHead('CRM', 'Pipeline de ventas.', null), crmTabs('deals'), h('div', { id: 'crm-body' }, h('div.skeleton', { style: { height: '200px' } })));
  try { await ensurePipeline(); deals = await list('crm_deals', { order: 'position' }); board(); } catch (e) { handleDbError(e, document.getElementById('crm-body'), '0004_crm.sql'); }
})();
