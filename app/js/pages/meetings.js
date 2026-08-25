// PlanEOS · Meetings — list + create (with default L10 agenda)
import { mountApp, pageHead } from '../components/appShell.js';
import { h, icon, render } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { list, create } from '../core/api.js';
import { supabase } from '../core/supabaseClient.js';
import { getOrgId, getUserId } from '../core/orgContext.js';
import { go, to } from '../core/paths.js';
import { fmtDate, relTime } from '../core/format.js';
import { toastErr } from '../core/toast.js';
import { openModal } from '../components/modal.js';
import { handleDbError } from '../components/notice.js';

let content;
const L10 = [['Segue', 5], ['Scorecard', 5], ['Rock Review', 5], ['Headlines', 5], ['To-Do List', 5], ['IDS', 60], ['Conclude', 5]];

async function startMeeting(title) {
  const meeting = await create('meetings', { title: title || 'Level 10 Weekly', type: 'l10', status: 'live', started_at: new Date().toISOString(), facilitator_id: getUserId() });
  const rows = L10.map((s, i) => ({ org_id: getOrgId(), meeting_id: meeting.id, title: s[0], allotted_minutes: s[1], position: i, is_active: i === 0 }));
  await supabase.from('meeting_agendas').insert(rows);
  go('pages/meetings/live.html?id=' + meeting.id);
}

function createModal() {
  const title = h('input.input', { value: 'Level 10 Weekly' });
  const start = h('button.btn.btn--primary', { onclick: () => startMeeting(title.value.trim()) }, icon('play'), 'Iniciar ahora');
  const cancel = h('button.btn.btn--secondary', t('common.cancel'));
  const m = openModal({ title: 'Nueva reunión', body: h('div', h('div.field', h('label.field__label', t('common.title')), title), h('p.muted', { style: { fontSize: 'var(--text-xs)' } }, 'Se creará con la agenda Level 10 (L10).')), footer: [cancel, start] });
  cancel.onclick = m.close;
}

async function refresh() {
  try {
    const rows = await list('meetings', { order: 'created_at', ascending: false, limit: 50 });
    const live = rows.filter(r => r.status === 'live');
    const past = rows.filter(r => r.status === 'ended');
    const row = (mtg) => h('div.list-row', { style: { cursor: 'pointer' }, onclick: () => go('pages/meetings/live.html?id=' + mtg.id) },
      mtg.status === 'live' ? h('span.badge.badge--danger.badge--dot', 'LIVE') : h('span.badge.badge--neutral', 'Ended'),
      h('span.list-row__title', mtg.title),
      h('span.list-row__meta', mtg.started_at ? relTime(mtg.started_at) : ''));
    render(document.getElementById('mt-body'),
      h('div',
        live.length ? h('div', h('div.list-section-label', 'En curso'), h('div.card', { style: { padding: '0' } }, ...live.map(row))) : null,
        h('div.list-section-label', 'Pasadas'),
        past.length ? h('div.card', { style: { padding: '0' } }, ...past.map(row)) : h('div.empty', icon('video'), h('div.empty__desc', 'Aún no hay reuniones.'))));
  } catch (e) { handleDbError(e, document.getElementById('mt-body'), '0003_meetings.sql'); }
}

(async () => {
  const m = await mountApp({ active: 'nav.meetings' });
  if (!m) return; content = m.content;
  render(content, pageHead(t('nav.meetings'), 'Reuniones en vivo con agenda colaborativa.',
    h('button.btn.btn--primary', { onclick: createModal }, icon('play'), 'Iniciar reunión')), h('div', { id: 'mt-body' }));
  refresh();
})();
