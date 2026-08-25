// PlanEOS · Boards — list of boards + single board kanban (ClickUp-style)
import { mountApp, pageHead } from '../components/appShell.js';
import { h, icon, render } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { list, create, update, remove, rpc } from '../core/api.js';
import { supabase } from '../core/supabaseClient.js';
import { getOrgId, getUserId } from '../core/orgContext.js';
import { to, go } from '../core/paths.js';
import { avatar } from '../components/avatar.js';
import { fmtDate } from '../core/format.js';
import { toastErr, toastOk } from '../core/toast.js';
import { openModal, confirmDialog } from '../components/modal.js';
import { handleDbError } from '../components/notice.js';
import { kanban } from '../components/kanban.js';
import { openTaskDrawer, priorityDot } from '../components/taskDrawer.js';
import { subscribeTable } from '../core/realtime.js';

let content, members = [];
const boardId = new URLSearchParams(location.search).get('id');

async function loadMembers() {
  const { data } = await supabase.from('org_members').select('profiles(id, full_name, email, avatar_url)').eq('org_id', getOrgId()).eq('status', 'active');
  members = (data || []).map(m => m.profiles).filter(Boolean);
}
const memberOf = (id) => members.find(m => m.id === id);

// ---------- LIST VIEW ----------
let teams = [];
async function loadTeams() {
  const { data } = await supabase.from('teams').select('id, name').eq('org_id', getOrgId()).order('name');
  teams = data || [];
}

async function newBoardModal() {
  if (!teams.length) await loadTeams();
  const name = h('input.input', { required: true, placeholder: 'Marketing' });
  const scope = h('select.select', h('option', { value: 'org' }, 'Organización'), h('option', { value: 'team' }, 'Equipo'), h('option', { value: 'private' }, 'Privado'));
  const teamSel = h('select.select', ...(teams.length
    ? teams.map(tm => h('option', { value: tm.id }, tm.name))
    : [h('option', { value: '' }, '— sin equipos —')]));
  const teamField = h('div.field', { style: { display: 'none' } }, h('label.field__label', t('nav.team')), teamSel);
  scope.onchange = () => { teamField.style.display = scope.value === 'team' ? '' : 'none'; };
  const save = h('button.btn.btn--primary', { type: 'submit', form: 'b-form' }, t('common.create'));
  const cancel = h('button.btn.btn--secondary', t('common.cancel'));
  const body = h('form', { id: 'b-form', onsubmit: async (e) => { e.preventDefault();
    try {
      const payload = { name: name.value.trim(), scope: scope.value };
      if (scope.value === 'private') payload.owner_id = getUserId();
      if (scope.value === 'team') {
        if (!teamSel.value) { toastErr('Crea un equipo antes de hacer un board de equipo.'); return; }
        payload.team_id = teamSel.value;
      }
      const b = await create('boards', payload);
      // seed default columns
      const cols = [['To Do', 1024, false, '#8A8A90'], ['In Progress', 2048, false, '#5A5AF0'], ['In Review', 3072, false, '#C77D0A'], ['Done', 4096, true, '#1F9E6E']];
      await supabase.from('board_columns').insert(cols.map(([n, p, d, c]) => ({ org_id: getOrgId(), board_id: b.id, name: n, position: p, is_done: d, color: c })));
      m.close(); go('pages/boards/index.html?id=' + b.id);
    } catch (err) { toastErr(err); } } },
    h('div.field', h('label.field__label', t('common.title')), name),
    h('div.field', h('label.field__label', 'Alcance / Scope'), scope),
    teamField);
  const m = openModal({ title: t('boards.new_board'), body, footer: [cancel, save] });
  cancel.onclick = m.close;
}

async function listView() {
  render(content, pageHead(t('nav.boards'), 'Tableros y pipelines de tu equipo.',
    h('button.btn.btn--primary', { onclick: newBoardModal }, icon('plus'), t('boards.new_board'))),
    h('div', { id: 'boards-body' }, h('div.skeleton', { style: { height: '120px' } })));
  try {
    const boards = await list('boards', { filters: { archived_at: null }, order: 'position' });
    const groups = { org: 'Organización', team: 'Equipo', private: 'Privado' };
    const body = h('div');
    for (const [scope, label] of Object.entries(groups)) {
      const bs = boards.filter(b => b.scope === scope);
      if (!bs.length) continue;
      body.append(h('div.list-section-label', label), h('div.grid-auto', ...bs.map(b =>
        h('a.card.card--interactive', { href: to('pages/boards/index.html?id=' + b.id) },
          h('div.card__title', h('span', { style: { width: '10px', height: '10px', borderRadius: '3px', background: b.color || 'var(--accent)' } }), b.name)))));
    }
    render(document.getElementById('boards-body'), boards.length ? body :
      h('div.empty', icon('grid'), h('div.empty__title', 'Sin tableros'), h('div.empty__desc', 'Crea tu primer board estilo ClickUp.')));
  } catch (e) { handleDbError(e, document.getElementById('boards-body'), '0009_boards.sql'); }
}

// ---------- BOARD VIEW ----------
let board = null, columns = [], tasks = [];

async function loadBoard() {
  const { data: b } = await supabase.from('boards').select('*').eq('id', boardId).maybeSingle();
  board = b;
  const { data: cols } = await supabase.from('board_columns').select('*').eq('board_id', boardId).order('position');
  columns = cols || [];
  tasks = await list('todos', { filters: { board_id: boardId, archived_at: null }, order: 'position' });
}

function taskCard(tk) {
  const owner = memberOf(tk.owner_id);
  return h('div',
    h('div.kanban-card__title', tk.title),
    h('div.kanban-card__badges',
      priorityDot(tk.priority),
      tk.due_date ? h('span.list-row__meta', fmtDate(tk.due_date)) : null,
      tk.source_type ? h('span.badge.badge--neutral', tk.source_type) : null,
      h('span.spacer'),
      owner ? avatar(owner, { size: 'sm' }) : null));
}

function addColumnModal() {
  const name = h('input.input', { required: true });
  const isDone = h('input.checkbox', { type: 'checkbox' });
  const save = h('button.btn.btn--primary', { type: 'submit', form: 'col-form' }, t('common.add'));
  const cancel = h('button.btn.btn--secondary', t('common.cancel'));
  const maxPos = Math.max(0, ...columns.map(c => c.position)) + 1024;
  const body = h('form', { id: 'col-form', onsubmit: async (e) => { e.preventDefault();
    try { await supabase.from('board_columns').insert({ org_id: getOrgId(), board_id: boardId, name: name.value.trim(), position: maxPos, is_done: isDone.checked }); m.close(); refreshBoard(); } catch (err) { toastErr(err); } } },
    h('div.field', h('label.field__label', t('boards.column_name')), name),
    h('label.row.gap-2', { style: { fontSize: 'var(--text-sm)' } }, isDone, h('span', t('boards.is_done'))));
  const m = openModal({ title: t('boards.add_column'), body, footer: [cancel, save] });
  cancel.onclick = m.close;
}

function colHeader(col) {
  const dot = h('span', { style: { width: '8px', height: '8px', borderRadius: '50%', background: col.color || 'var(--text-tertiary)' } });
  return h('span.row.gap-2', dot, h('span', col.name), col.is_done ? icon('check') : null);
}
function colMenu(col) {
  return h('button.btn.btn--ghost.btn--icon.btn--sm', { onclick: (e) => {
    e.stopPropagation();
    confirmDialog('¿Eliminar la columna "' + col.name + '"? Las tareas se moverán a otra columna.', { onConfirm: async () => {
      try { await remove('board_columns', col.id); refreshBoard(); } catch (err) { toastErr(err); } } });
  }, title: t('common.delete') }, icon('more'));
}

function addTask(columnId) {
  const title = h('input.input', { required: true, placeholder: t('todos.placeholder') });
  const save = h('button.btn.btn--primary', { type: 'submit', form: 'tk-form' }, t('common.add'));
  const cancel = h('button.btn.btn--secondary', t('common.cancel'));
  const body = h('form', { id: 'tk-form', onsubmit: async (e) => { e.preventDefault(); if (!title.value.trim()) return;
    try { await create('todos', { title: title.value.trim(), board_id: boardId, column_id: columnId, owner_id: getUserId() }); m.close(); refreshBoard(); } catch (err) { toastErr(err); } } },
    h('div.field', h('label.field__label', t('common.title')), title));
  const m = openModal({ title: t('todos.new'), body, footer: [cancel, save] });
  cancel.onclick = m.close;
}

function drawBoard() {
  const node = kanban({
    columns, items: tasks, card: taskCard,
    colHead: colHeader, colActions: colMenu, onAddCard: addTask,
    onMove: async ({ id, toColumn, position }) => {
      const tk = tasks.find(x => x.id === id); if (!tk) return;
      tk.column_id = toColumn; tk.position = position;
      try { await update('todos', id, { column_id: toColumn, position }); } catch (e) { toastErr(e); refreshBoard(); }
    },
  });
  // clicking a card (not dragging) opens the drawer
  node.addEventListener('click', (e) => {
    const cardEl = e.target.closest('.kanban-card'); if (!cardEl) return;
    const tk = tasks.find(x => x.id === cardEl.dataset.id);
    if (tk) openTaskDrawer(tk, { members, onChange: refreshBoard });
  });
  render(document.getElementById('board-body'), node);
}

async function refreshBoard() { try { await loadBoard(); drawBoard(); } catch (e) { toastErr(e); } }

async function boardView() {
  render(content,
    pageHead(h('span.row.gap-2', h('a.btn.btn--ghost.btn--icon.btn--sm', { href: to('pages/boards/index.html') }, icon('arrow-left')), h('span', { id: 'board-name' }, '…')), '',
      h('button.btn.btn--secondary', { onclick: addColumnModal }, icon('plus'), t('boards.add_column'))),
    h('div', { id: 'board-body' }, h('div.skeleton', { style: { height: '200px' } })));
  try {
    await loadBoard();
    if (!board) return go('pages/boards/index.html');
    document.getElementById('board-name').textContent = board.name;
    drawBoard();
    subscribeTable('todos', { filter: `org_id=eq.${getOrgId()}`, onChange: () => refreshBoard() });
  } catch (e) { handleDbError(e, document.getElementById('board-body'), '0009_boards.sql'); }
}

(async () => {
  const m = await mountApp({ active: 'nav.boards', title: t('nav.boards') });
  if (!m) return; content = m.content;
  await loadMembers();
  if (boardId) boardView(); else listView();
})();
