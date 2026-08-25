// PlanEOS · Dashboard "My 90"
import { mountApp } from '../components/appShell.js';
import { h, icon, render } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { list } from '../core/api.js';
import { getProfile, getUserId } from '../core/orgContext.js';
import { fmtDate, currentQuarter } from '../core/format.js';
import { to } from '../core/paths.js';
import { toastErr } from '../core/toast.js';

function greeting() {
  const hr = new Date().getHours();
  const key = hr < 12 ? 'greeting_morning' : hr < 19 ? 'greeting_afternoon' : 'greeting_evening';
  const name = (getProfile()?.full_name || '').split(' ')[0] || '';
  return `${t('dashboard.' + key)}${name ? ', ' + name : ''}`;
}

function widget(title, count, bodyNode, href) {
  return h('div.card',
    h('div.card__header',
      h('div.card__title', title, count != null ? h('span.card__count', count) : null),
      href ? h('a.btn.btn--ghost.btn--sm', { href: to(href) }, icon('chevron-right')) : null),
    bodyNode);
}

function todoRow(td) {
  return h('div.list-row',
    h('span.checkbox', { style: { pointerEvents: 'none' } }),
    h('span.list-row__title', td.title),
    h('span.list-row__meta', td.due_date ? fmtDate(td.due_date) : ''));
}
function rockRow(r) {
  const cls = r.status === 'off_track' ? 'progress--danger' : r.status === 'complete' ? 'progress--success' : '';
  return h('div.list-row',
    h('span.list-row__title', r.title),
    h('div.progress', { class: 'progress ' + cls, style: { width: '80px' } }, h('div.progress__fill', { style: { width: (r.progress || 0) + '%' } })));
}

async function load(content) {
  const uid = getUserId();
  const skeleton = h('div.grid-3', ...[0,1,2].map(() => h('div.card', h('div.skeleton', { style: { height: '120px' } }))));
  render(content, h('div', h('h1.dash-greeting', greeting()), h('div', { style: { height: '20px' } }), skeleton));

  try {
    const [rocks, myTodos, teamTodos, kpis] = await Promise.all([
      list('rocks', { filters: { owner_id: uid }, order: 'due_date' }),
      list('todos', { filters: { owner_id: uid, done: false, archived_at: null }, order: 'due_date', limit: 8 }),
      list('todos', { filters: { done: false, is_private: false, archived_at: null }, order: 'due_date', limit: 8 }),
      list('kpis', { filters: { archived_at: null }, order: 'position', limit: 6 }),
    ]);

    const rocksBody = rocks.length ? h('div.list', ...rocks.slice(0,6).map(rockRow))
      : h('div.empty', h('p.empty__desc', t('rocks.empty')));
    const myTodosBody = myTodos.length ? h('div.list', ...myTodos.map(todoRow))
      : h('div.empty', h('p.empty__desc', t('todos.empty')));
    const teamTodosBody = teamTodos.length ? h('div.list', ...teamTodos.map(todoRow))
      : h('div.empty', h('p.empty__desc', t('todos.empty')));
    const kpiBody = kpis.length ? h('div.list', ...kpis.map(k => h('div.list-row',
        h('span.list-row__title', k.name),
        h('span.list-row__meta.mono', (k.goal_operator === 'lte' ? '≤ ' : '≥ ') + (k.goal ?? '')))))
      : h('div.empty', h('p.empty__desc', t('scorecard.empty')));

    render(content,
      h('div',
        h('div.page-head', h('h1.dash-greeting', greeting()),
          h('span.badge.badge--neutral', currentQuarter())),
        h('div.grid-3',
          widget(t('dashboard.my_rocks'), rocks.length, rocksBody, 'pages/rocks/index.html'),
          widget(t('dashboard.my_todos'), myTodos.length, myTodosBody, 'pages/todos/index.html'),
          widget(t('dashboard.scorecard'), kpis.length, kpiBody, 'pages/scorecard/index.html'),
        ),
        h('div', { style: { height: '16px' } }),
        h('div.grid-2',
          widget(t('dashboard.team_todos'), teamTodos.length, teamTodosBody, 'pages/todos/index.html'),
          widget(t('dashboard.headlines'), 0, h('div.empty', h('p.empty__desc', '—')), null),
        ),
      ));
  } catch (e) { toastErr(e); }
}

(async () => {
  const m = await mountApp({ active: 'nav.dashboard', title: t('nav.dashboard') });
  if (m) load(m.content);
})();
