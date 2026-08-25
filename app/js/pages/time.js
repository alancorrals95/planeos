// PlanEOS · Time Tracking (Toggl-style) — timer bar + entries + weekly total
import { mountApp, pageHead } from '../components/appShell.js';
import { h, icon, render } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { list, create } from '../core/api.js';
import { supabase } from '../core/supabaseClient.js';
import { getOrgId, getUserId } from '../core/orgContext.js';
import { fmtDuration, fmtDate, weekStart } from '../core/format.js';
import { startTimer, stopTimer, getRunning, onTimer, refreshRunning, elapsedSeconds } from '../core/timer.js';
import { toastErr } from '../core/toast.js';
import { openModal } from '../components/modal.js';
import { handleDbError } from '../components/notice.js';

let content, projects = [];

async function loadProjects() { projects = await list('projects', { filters: { status: 'active' }, order: 'name' }); }
function projName(id) { return projects.find(p => p.id === id)?.name || '—'; }
function projColor(id) { return projects.find(p => p.id === id)?.color || 'var(--text-tertiary)'; }

function timerBar() {
  const desc = h('input.input', { placeholder: '¿En qué trabajas? / What are you working on?', style: { flex: '1' } });
  const proj = h('select.select', { style: { width: '180px' } }, h('option', { value: '' }, '— Proyecto —'), ...projects.map(p => h('option', { value: p.id }, p.name)));
  const time = h('span.timer-widget__time', { style: { fontSize: 'var(--text-lg)', minWidth: '90px', textAlign: 'right' } }, '0:00:00');
  const btn = h('button.btn.btn--primary', icon('play'), 'Start');
  let tick;
  function paint(r) {
    clearInterval(tick);
    if (r) {
      desc.value = r.description || ''; proj.value = r.project_id || '';
      btn.replaceChildren(icon('square'), document.createTextNode('Stop')); btn.classList.remove('btn--primary'); btn.classList.add('btn--danger');
      time.textContent = fmtDuration(elapsedSeconds(r));
      tick = setInterval(() => time.textContent = fmtDuration(elapsedSeconds(r)), 1000);
    } else {
      btn.replaceChildren(icon('play'), document.createTextNode('Start')); btn.classList.add('btn--primary'); btn.classList.remove('btn--danger');
      time.textContent = '0:00:00';
    }
  }
  btn.addEventListener('click', async () => {
    try {
      if (getRunning()) { await stopTimer(); loadEntries(); }
      else await startTimer({ description: desc.value.trim(), project_id: proj.value || null });
    } catch (e) { toastErr(e); }
  });
  onTimer(paint); paint(getRunning());
  return h('div.card.row.gap-3', { style: { alignItems: 'center' } }, desc, proj, time, btn);
}

async function loadEntries() {
  const from = weekStart(); from.setHours(0,0,0,0);
  const { data, error } = await supabase.from('time_entries').select('*')
    .eq('org_id', getOrgId()).eq('profile_id', getUserId())
    .gte('started_at', from.toISOString()).not('ended_at', 'is', null).order('started_at', { ascending: false });
  if (error) { handleDbError(error, document.getElementById('entries'), '0006_time.sql'); return; }
  const entries = data || [];
  const weekTotal = entries.reduce((s, e) => s + elapsedSeconds(e), 0);
  document.getElementById('week-total').textContent = fmtDuration(weekTotal);

  // group by day
  const byDay = {};
  for (const e of entries) { const k = new Date(e.started_at).toDateString(); (byDay[k] ||= []).push(e); }
  const wrap = h('div');
  for (const [day, list_] of Object.entries(byDay)) {
    const dayTotal = list_.reduce((s, e) => s + elapsedSeconds(e), 0);
    wrap.append(h('div.list-section-label', { style: { display: 'flex', justifyContent: 'space-between' } }, h('span', fmtDate(day, { weekday: 'long', month: 'short', day: 'numeric' })), h('span.mono', fmtDuration(dayTotal))));
    wrap.append(h('div.card', { style: { padding: '0', marginBottom: '12px' } }, ...list_.map(e => h('div.list-row',
      h('span', { style: { width: '8px', height: '8px', borderRadius: '50%', background: projColor(e.project_id) } }),
      h('span.list-row__title', e.description || '(sin descripción)'),
      h('span.badge.badge--neutral', projName(e.project_id)),
      h('span.list-row__meta.mono', fmtDuration(elapsedSeconds(e))),
    ))));
  }
  render(document.getElementById('entries'), entries.length ? wrap : h('div.empty', icon('clock'), h('div.empty__title', 'Sin registros esta semana'), h('div.empty__desc', 'Inicia el cronómetro para registrar tiempo.')));
}

function newProjectModal() {
  const name = h('input.input', { required: true });
  const client = h('input.input');
  const rate = h('input.input', { type: 'number', step: 'any', placeholder: '0' });
  const save = h('button.btn.btn--primary', { type: 'submit', form: 'proj-form' }, t('common.create'));
  const cancel = h('button.btn.btn--secondary', t('common.cancel'));
  const body = h('form', { id: 'proj-form', onsubmit: async (e) => { e.preventDefault();
    try { await create('projects', { name: name.value.trim(), client_name: client.value.trim() || null, hourly_rate: rate.value ? Number(rate.value) : null }); m.close(); await loadProjects(); render(content, ...page()); } catch (err) { toastErr(err); } } },
    h('div.field', h('label.field__label', 'Proyecto'), name),
    h('div.field', h('label.field__label', 'Cliente'), client),
    h('div.field', h('label.field__label', 'Tarifa/hora ($)'), rate));
  const m = openModal({ title: 'Nuevo proyecto', body, footer: [cancel, save] });
  cancel.onclick = m.close;
}

function page() {
  return [
    pageHead(t('nav.time'), 'Registra tiempo por proyecto, estilo Toggl.', h('button.btn.btn--secondary', { onclick: newProjectModal }, icon('plus'), 'Proyecto')),
    timerBar(),
    h('div.toolbar', { style: { marginTop: '16px' } }, h('strong', 'Esta semana'), h('span.spacer'), h('span.mono', { id: 'week-total', style: { fontSize: 'var(--text-lg)' } }, '0:00:00')),
    h('div', { id: 'entries' }, h('div.skeleton', { style: { height: '100px' } })),
  ];
}

(async () => {
  const m = await mountApp({ active: 'nav.time' });
  if (!m) return; content = m.content;
  try { await loadProjects(); } catch (e) {
    render(content, pageHead(t('nav.time'), 'Registra tiempo por proyecto, estilo Toggl.'), h('div', { id: 'entries' }));
    handleDbError(e, document.getElementById('entries'), '0006_time.sql'); return;
  }
  await refreshRunning();
  render(content, ...page());
  loadEntries();
})();
