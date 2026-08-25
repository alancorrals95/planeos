// PlanEOS · Live meeting — collaborative agenda (realtime) + presence + inline to-dos
import { mountApp } from '../components/appShell.js';
import { h, icon, render } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { supabase } from '../core/supabaseClient.js';
import { getOrgId, getUserId, getProfile } from '../core/orgContext.js';
import { create, update } from '../core/api.js';
import { go } from '../core/paths.js';
import { fmtDuration } from '../core/format.js';
import { subscribeTable, joinPresence } from '../core/realtime.js';
import { avatar } from '../components/avatar.js';
import { toastErr, toastOk } from '../core/toast.js';

let content, meeting, agendas = [], presence;
const id = new URLSearchParams(location.search).get('id');

function timerHeader() {
  const time = h('span.meeting-timer', '0:00');
  setInterval(() => { if (meeting?.started_at) time.textContent = fmtDuration((Date.now() - new Date(meeting.started_at)) / 1000); }, 1000);
  return time;
}

function agendaRail() {
  return h('div.card', { style: { padding: '12px' } },
    h('div.list-section-label', 'Agenda'),
    ...agendas.map(a => h('div.agenda-item', { 'aria-current': String(!!a.is_active), onclick: () => setActive(a) },
      a.is_active ? icon('play') : h('span', { style: { width: '16px' } }),
      h('span', a.title), h('span.agenda-item__time', a.allotted_minutes + 'm'))),
    h('div', { id: 'presence', style: { marginTop: '12px' } }));
}

async function setActive(a) {
  try {
    await Promise.all(agendas.map(x => update('meeting_agendas', x.id, { is_active: x.id === a.id })));
  } catch (e) { toastErr(e); }
}

function activePanel() {
  const active = agendas.find(a => a.is_active) || agendas[0];
  const note = h('textarea.textarea', { style: { minHeight: '160px' }, placeholder: 'Notas de la reunión…' });
  const todoIn = h('input.input', { placeholder: 'Crear to-do…', style: { flex: '1' } });
  const issueIn = h('input.input', { placeholder: 'Crear tema (issue)…', style: { flex: '1' } });
  return h('div.card',
    h('h2', active?.title || '—'),
    h('div', { style: { height: '12px' } }),
    h('form.toolbar', { onsubmit: async (e) => { e.preventDefault(); if (!todoIn.value.trim()) return; try { await create('todos', { title: todoIn.value.trim(), owner_id: getUserId(), meeting_id: id }); todoIn.value = ''; toastOk('To-do creado'); } catch (err) { toastErr(err); } } }, todoIn, h('button.btn.btn--secondary', icon('check-square'))),
    h('form.toolbar', { onsubmit: async (e) => { e.preventDefault(); if (!issueIn.value.trim()) return; try { await create('issues', { title: issueIn.value.trim(), owner_id: getUserId(), list: 'short_term', status: 'open' }); issueIn.value = ''; toastOk('Issue creado'); } catch (err) { toastErr(err); } } }, issueIn, h('button.btn.btn--secondary', icon('flag'))),
    h('div.field', { style: { marginTop: '8px' } }, h('label.field__label', 'Notas'), note),
    h('button.btn.btn--secondary.btn--sm', { onclick: async () => { if (!note.value.trim()) return; try { await create('meeting_notes', { meeting_id: id, author_id: getUserId(), body: note.value.trim() }); note.value=''; toastOk('Nota guardada'); } catch (e) { toastErr(e); } } }, 'Guardar nota'));
}

function draw() {
  render(content, h('div',
    h('div.card.row', { style: { justifyContent: 'space-between', marginBottom: '16px' } },
      h('div.row.gap-3', h('strong', meeting.title), h('span.badge.badge--danger.badge--dot', 'LIVE')),
      h('div.row.gap-3', timerHeader(),
        h('button.btn.btn--danger.btn--sm', { onclick: endMeeting }, icon('square'), 'Terminar'))),
    h('div.meeting-live', agendaRail(), activePanel())));
  paintPresence();
}

function paintPresence() {
  if (!presence) return;
  const state = presence.channel.presenceState();
  const people = Object.values(state).flat();
  const el = document.getElementById('presence');
  if (el) render(el, h('div.list-section-label', 'Presentes (' + people.length + ')'),
    h('div.avatar-stack', ...people.slice(0, 8).map(p => avatar({ full_name: p.name }, { size: 'sm' }))));
}

async function endMeeting() {
  try { await update('meetings', id, { status: 'ended', ended_at: new Date().toISOString() }); go('pages/meetings/index.html'); } catch (e) { toastErr(e); }
}

async function loadAgendas() {
  const { data } = await supabase.from('meeting_agendas').select('*').eq('meeting_id', id).order('position');
  agendas = data || [];
}

(async () => {
  const m = await mountApp({ active: 'nav.meetings', title: 'nav.meetings' });
  if (!m) return; content = m.content;
  if (!id) return go('pages/meetings/index.html');
  const { data } = await supabase.from('meetings').select('*').eq('id', id).single();
  if (!data) return go('pages/meetings/index.html');
  meeting = data;
  await loadAgendas();
  draw();
  presence = joinPresence('meeting:' + id, { key: getUserId(), name: getProfile()?.full_name || 'User' }, () => paintPresence());
  subscribeTable('meeting_agendas', { filter: `meeting_id=eq.${id}`, onChange: async () => { await loadAgendas(); draw(); } });
  subscribeTable('meetings', { filter: `org_id=eq.${getOrgId()}`, onChange: (p) => { if (p.new?.id === id && p.new.status === 'ended') go('pages/meetings/index.html'); } });
})();
