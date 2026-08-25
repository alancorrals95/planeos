// PlanEOS · Data / Scorecard — editable weekly KPI grid with heat cells
import { mountApp, pageHead } from '../components/appShell.js';
import { h, icon, render } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { list, create, upsert } from '../core/api.js';
import { supabase } from '../core/supabaseClient.js';
import { getOrgId, getUserId } from '../core/orgContext.js';
import { weekStart, isoDate, fmtDate } from '../core/format.js';
import { toastErr } from '../core/toast.js';
import { openModal } from '../components/modal.js';

let content, members = [];
const N_WEEKS = 8;

function weekCols() {
  const base = weekStart();
  return Array.from({ length: N_WEEKS }, (_, i) => {
    const d = new Date(base); d.setDate(d.getDate() - 7 * i); return d;
  }).reverse();
}

async function loadMembers() {
  const { data } = await supabase.from('org_members').select('profiles(id, full_name, email)').eq('org_id', getOrgId()).eq('status', 'active');
  members = (data || []).map(m => m.profiles).filter(Boolean);
}

function meetsGoal(kpi, val) {
  if (val == null || val === '' || kpi.goal == null) return null;
  const v = Number(val), g = Number(kpi.goal);
  switch (kpi.goal_operator) {
    case 'lte': return v <= g;
    case 'eq': return v === g;
    case 'between': return v >= g && v <= Number(kpi.goal_max);
    default: return v >= g;
  }
}

function goalText(kpi) {
  const op = { gte: '≥', lte: '≤', eq: '=', between: '↔' }[kpi.goal_operator] || '≥';
  return `${op} ${kpi.goal ?? ''}${kpi.unit ? ' ' + kpi.unit : ''}`;
}

async function build() {
  const cols = weekCols();
  const [kpis, allScores] = await Promise.all([
    list('kpis', { filters: { archived_at: null }, order: 'position' }),
    list('kpi_scores', {}),
  ]);
  const scoreMap = {};
  for (const s of allScores) scoreMap[`${s.kpi_id}|${s.period_start}`] = s.value;

  if (!kpis.length) {
    render(document.getElementById('sc-body'),
      h('div.empty', icon('chart'), h('div.empty__title', t('scorecard.empty')), h('div.empty__desc', t('scorecard.empty_desc'))));
    return;
  }

  const thead = h('thead', h('tr',
    h('th.metric', t('common.title')),
    h('th', t('scorecard.goal')),
    h('th', t('common.owner')),
    ...cols.map(c => h('th.cell-num', fmtDate(c, { month: 'numeric', day: 'numeric' }))),
  ));

  const tbody = h('tbody');
  for (const kpi of kpis) {
    const owner = members.find(m => m.id === kpi.owner_id);
    const tr = h('tr',
      h('td.metric', kpi.name),
      h('td.mono', { style: { color: 'var(--text-tertiary)' } }, goalText(kpi)),
      h('td', h('span.avatar.avatar--sm', { title: owner?.full_name || '' }, (owner?.full_name?.[0] || owner?.email?.[0] || '?').toUpperCase())),
      ...cols.map(c => {
        const key = `${kpi.id}|${isoDate(c)}`;
        const val = scoreMap[key];
        const input = h('input.cell-input', { type: 'number', step: 'any', value: val ?? '', 'data-key': key });
        input.addEventListener('change', async () => {
          try { await upsert('kpi_scores', { kpi_id: kpi.id, period_start: isoDate(c), value: input.value === '' ? null : Number(input.value) }, 'kpi_id,period_start'); paint(input, kpi); }
          catch (e) { toastErr(e); }
        });
        const td = h('td.cell', input);
        paintCell(td, kpi, val);
        return td;
      }),
    );
    tbody.append(tr);
  }
  render(document.getElementById('sc-body'), h('div.table-wrap.scorecard', h('table.table', thead, tbody)));
}

function paintCell(td, kpi, val) {
  const ok = meetsGoal(kpi, val);
  td.classList.remove('cell--good', 'cell--bad');
  if (ok === true) td.classList.add('cell--good');
  else if (ok === false) td.classList.add('cell--bad');
}
function paint(input, kpi) { paintCell(input.closest('td'), kpi, input.value); }

function newKpiModal() {
  const name = h('input.input', { required: true });
  const unit = h('input.input', { placeholder: '$, %, #' });
  const op = h('select.select', h('option', { value: 'gte' }, '≥'), h('option', { value: 'lte' }, '≤'), h('option', { value: 'eq' }, '='));
  const goal = h('input.input', { type: 'number', step: 'any' });
  const owner = h('select.select', ...members.map(m => h('option', { value: m.id, selected: m.id === getUserId() }, m.full_name || m.email)));
  const save = h('button.btn.btn--primary', { type: 'submit', form: 'kpi-form' }, t('common.create'));
  const cancel = h('button.btn.btn--secondary', t('common.cancel'));
  const body = h('form', { id: 'kpi-form', onsubmit: async (e) => { e.preventDefault();
    try { await create('kpis', { name: name.value.trim(), unit: unit.value.trim() || null, goal_operator: op.value, goal: goal.value === '' ? null : Number(goal.value), owner_id: owner.value, period: 'weekly' }); m.close(); build(); }
    catch (err) { toastErr(err); } } },
    h('div.field', h('label.field__label', t('common.title')), name),
    h('div.row.gap-3', h('div.field', { style: { flex: '1' } }, h('label.field__label', 'Op'), op), h('div.field', { style: { flex: '1' } }, h('label.field__label', t('scorecard.goal')), goal), h('div.field', { style: { flex: '1' } }, h('label.field__label', 'Unit'), unit)),
    h('div.field', h('label.field__label', t('common.owner')), owner),
  );
  const m = openModal({ title: t('scorecard.new_kpi'), body, footer: [cancel, save] });
  cancel.onclick = m.close;
}

(async () => {
  const mm = await mountApp({ active: 'nav.data', title: t('nav.data') });
  if (!mm) return; content = mm.content;
  await loadMembers();
  render(content,
    pageHead(t('scorecard.title'), t('scorecard.sub'), h('button.btn.btn--primary', { onclick: newKpiModal }, icon('plus'), t('scorecard.new_kpi'))),
    h('div', { id: 'sc-body' }, h('div.skeleton', { style: { height: '200px' } })),
  );
  build().catch(toastErr);
})();
