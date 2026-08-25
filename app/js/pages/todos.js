// PlanEOS · To-Dos = cross-board "my tasks" with List | Board views
import { mountApp, pageHead } from '../components/appShell.js';
import { h, icon, render } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { list, create, update, remove, rpc } from '../core/api.js';
import { getUserId, getOrgId } from '../core/orgContext.js';
import { supabase } from '../core/supabaseClient.js';
import { fmtDate } from '../core/format.js';
import { subscribeTable } from '../core/realtime.js';
import { toastErr } from '../core/toast.js';
import { confirmDialog } from '../components/modal.js';
import { handleDbError } from '../components/notice.js';
import { kanban } from '../components/kanban.js';
import { openTaskDrawer, priorityDot, PRIORITIES } from '../components/taskDrawer.js';
import { avatar } from '../components/avatar.js';

let scope = 'mine';      // mine | team
let view = 'list';       // list | board
let members = [], content;

async function loadMembers() {
  const { data } = await supabase.from('org_members').select('profiles(id, full_name, email, avatar_url)').eq('org_id', getOrgId()).eq('status', 'active');
  members = (data || []).map(m => m.profiles).filter(Boolean);
}
const memberOf = (id) => members.find(m => m.id === id);
function memberName(id) { const m = memberOf(id); return m?.full_name || m?.email || '—'; }

function filters() {
  return scope === 'mine' ? { owner_id: getUserId(), archived_at: null } : { archived_at: null };
}

// ---------- LIST ----------
function row(td) {
  const overdue = td.due_date && !td.done && new Date(td.due_date) < new Date(new Date().toDateString());
  const cb = h('input.checkbox', { type: 'checkbox', checked: td.done, onclick: (e) => e.stopPropagation(), onchange: async () => {
    try { await update('todos', td.id, { done: cb.checked }); } catch (e) { toastErr(e); } } });
  return h('div.list-row', { class: 'list-row' + (td.done ? ' list-row--done' : ''), style: { cursor: 'pointer' },
      onclick: (e) => { if (e.target.closest('input,button')) return; openTaskDrawer(td, { members, onChange: refresh }); } },
    cb, priorityDot(td.priority),
    h('span.list-row__title', td.title),
    h('span.avatar.avatar--sm', { title: memberName(td.owner_id) }, (memberName(td.owner_id)[0] || '?').toUpperCase()),
    h('span.list-row__meta', { style: overdue ? { color: 'var(--danger)' } : null }, td.due_date ? fmtDate(td.due_date) : ''),
    h('button.btn.btn--ghost.btn--icon.btn--sm', { onclick: (e) => { e.stopPropagation(); confirmDialog(td.title, { onConfirm: () => remove('todos', td.id) }); } }, icon('trash')));
}
function section(label, rows) { return rows.length ? h('div', h('div.list-section-label', label), h('div.list', ...rows.map(row))) : null; }

async function renderList() {
  try {
    const todos = await list('todos', { filters: filters(), order: 'due_date' });
    const today = new Date(new Date().toDateString());
    const overdue = todos.filter(x => !x.done && x.due_date && new Date(x.due_date) < today);
    const open = todos.filter(x => !x.done && !(x.due_date && new Date(x.due_date) < today));
    const done = todos.filter(x => x.done);
    render(document.getElementById('todo-body'),
      h('div.card', { style: { padding: '0' } },
        section(t('todos.overdue'), overdue), section(t('todos.this_week'), open), section(t('todos.completed'), done),
        (!todos.length) ? h('div.empty', icon('check-square'), h('div.empty__title', t('todos.empty')), h('div.empty__desc', t('todos.empty_desc'))) : null));
  } catch (e) { handleDbError(e, document.getElementById('todo-body'), '0009_boards.sql'); }
}

// ---------- BOARD (default task board) ----------
let columns = [], boardTasks = [], boardId;
async function renderBoard() {
  try {
    boardId = await rpc('ensure_default_task_board', { p_org: getOrgId() });
    const { data: cols } = await supabase.from('board_columns').select('*').eq('board_id', boardId).order('position');
    columns = cols || [];
    const f = { board_id: boardId, archived_at: null };
    if (scope === 'mine') f.owner_id = getUserId();
    boardTasks = await list('todos', { filters: f, order: 'position' });
    const node = kanban({
      columns, items: boardTasks,
      card: (tk) => h('div', h('div.kanban-card__title', tk.title),
        h('div.kanban-card__badges', priorityDot(tk.priority), tk.due_date ? h('span.list-row__meta', fmtDate(tk.due_date)) : null, h('span.spacer'), memberOf(tk.owner_id) ? avatar(memberOf(tk.owner_id), { size: 'sm' }) : null)),
      colHead: (c) => h('span.row.gap-2', h('span', c.name), c.is_done ? icon('check') : null),
      onAddCard: (colId) => quickAddTo(colId),
      onMove: async ({ id, toColumn, position }) => { const tk = boardTasks.find(x => x.id === id); if (tk) { tk.column_id = toColumn; tk.position = position; } try { await update('todos', id, { column_id: toColumn, position }); } catch (e) { toastErr(e); renderBoard(); } },
    });
    node.addEventListener('click', (e) => { const c = e.target.closest('.kanban-card'); if (!c) return; const tk = boardTasks.find(x => x.id === c.dataset.id); if (tk) openTaskDrawer(tk, { members, onChange: renderBoard }); });
    render(document.getElementById('todo-body'), node);
  } catch (e) { handleDbError(e, document.getElementById('todo-body'), '0009_boards.sql'); }
}
async function quickAddTo(colId) {
  try { await create('todos', { title: 'Nueva tarea', board_id: boardId, column_id: colId, owner_id: getUserId() }); renderBoard(); } catch (e) { toastErr(e); }
}

function refresh() { view === 'board' ? renderBoard() : renderList(); }

// ---------- quick add (list) ----------
function quickAdd() {
  const input = h('input.input', { placeholder: t('todos.placeholder'), style: { flex: '1' } });
  const owner = h('select.select', { style: { width: '150px' } }, ...members.map(m => h('option', { value: m.id, selected: m.id === getUserId() }, m.full_name || m.email)));
  const prio = h('select.select', { style: { width: '110px' } }, ...PRIORITIES.map(p => h('option', { value: p }, p)));
  const due = h('input.input', { type: 'date', style: { width: '150px' } });
  return h('form.toolbar', { onsubmit: async (e) => { e.preventDefault(); if (!input.value.trim()) return;
    try { await create('todos', { title: input.value.trim(), owner_id: owner.value, priority: prio.value, due_date: due.value || null }); input.value = ''; due.value = ''; }
    catch (err) { toastErr(err); } } },
    input, owner, prio, due, h('button.btn.btn--primary', icon('plus'), t('common.add')));
}

function shell() {
  const seg = h('div.segmented',
    h('button.segmented__item', { 'aria-selected': view === 'list', onclick: () => { view = 'list'; build(); } }, icon('check-square'), 'Lista'),
    h('button.segmented__item', { 'aria-selected': view === 'board', onclick: () => { view = 'board'; build(); } }, icon('grid'), 'Board'));
  const tabs = h('div.tabs',
    h('button.tab', { 'aria-selected': scope === 'mine', onclick: () => { scope = 'mine'; build(); } }, 'Mis tareas'),
    h('button.tab', { 'aria-selected': scope === 'team', onclick: () => { scope = 'team'; build(); } }, t('todos.team')));
  render(content, pageHead(t('todos.title'), t('todos.sub'), seg), tabs,
    view === 'list' ? quickAdd() : null, h('div', { id: 'todo-body' }));
  refresh();
}
function build() { shell(); }

(async () => {
  const m = await mountApp({ active: 'nav.todos', title: t('nav.todos') });
  if (!m) return; content = m.content;
  await loadMembers();
  build();
  subscribeTable('todos', { filter: `org_id=eq.${getOrgId()}`, onChange: () => refresh() });
})();
