// PlanEOS · shared Task detail drawer (fields + subtasks + related)
import { h, icon, render } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { list, create, update, remove } from '../core/api.js';
import { getUserId } from '../core/orgContext.js';
import { openDrawer, confirmDialog } from './modal.js';
import { relatedPanel } from './related.js';
import { toastErr } from '../core/toast.js';

export const PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'];
export function priorityDot(p) { return p && p !== 'none' ? h('span', { class: 'prio-dot prio-dot--' + p, title: 'priority: ' + p }) : null; }

function field(label, el) { return h('div.field', h('label.field__label', label), el); }

// openTaskDrawer(task, { members, onChange })
export function openTaskDrawer(task, { members = [], onChange } = {}) {
  const patch = async (p) => { try { Object.assign(task, p); await update('todos', task.id, p); onChange?.(); } catch (e) { toastErr(e); } };

  const title = h('input.input', { value: task.title || '' });
  title.addEventListener('change', () => patch({ title: title.value }));

  const assignee = h('select.select', ...members.map(m => h('option', { value: m.id, selected: m.id === task.owner_id }, m.full_name || m.email)));
  assignee.onchange = () => patch({ owner_id: assignee.value });

  const priority = h('select.select', ...PRIORITIES.map(p => h('option', { value: p, selected: p === (task.priority || 'none') }, p)));
  priority.onchange = () => patch({ priority: priority.value });

  const due = h('input.input', { type: 'date', value: task.due_date || '' });
  due.onchange = () => patch({ due_date: due.value || null });

  const desc = h('textarea.textarea', { value: task.notes || '' });
  desc.addEventListener('change', () => patch({ notes: desc.value }));

  // subtasks
  const subWrap = h('div.list');
  const renderSubs = (subs) => render(subWrap, ...subs.map(s => h('div.list-row',
    h('input.checkbox', { type: 'checkbox', checked: s.done, onchange: (e) => update('todos', s.id, { done: e.target.checked }).catch(toastErr) }),
    h('span', { class: 'list-row__title' + (s.done ? '' : ''), style: s.done ? { textDecoration: 'line-through', color: 'var(--text-tertiary)' } : null }, s.title),
    h('button.btn.btn--ghost.btn--icon.btn--sm', { onclick: async () => { await remove('todos', s.id); reloadSubs(); } }, icon('trash')))));
  async function reloadSubs() {
    try { const subs = await list('todos', { filters: { parent_id: task.id }, order: 'created_at' }); renderSubs(subs); } catch (_) {}
  }
  const newSub = h('input.input', { placeholder: t('common.subtasks') + '…' });
  const subForm = h('form.toolbar', { onsubmit: async (e) => { e.preventDefault(); if (!newSub.value.trim()) return;
    try { await create('todos', { title: newSub.value.trim(), parent_id: task.id, board_id: task.board_id, column_id: task.column_id, owner_id: getUserId() }); newSub.value = ''; reloadSubs(); } catch (err) { toastErr(err); } } },
    newSub, h('button.btn.btn--secondary', icon('plus')));

  const body = h('div.stack.gap-4',
    field(t('common.title'), title),
    h('div.row.gap-3', field(t('common.owner'), assignee), field('Priority', priority), field(t('common.due'), due)),
    field('Descripción', desc),
    task.source_type ? h('div', h('span.badge.badge--accent', 'Origen: ' + task.source_type)) : null,
    h('h3', { style: { marginTop: '8px' } }, t('common.subtasks')),
    subWrap, subForm,
    relatedPanel('task', task.id),
    h('button.btn.btn--danger.btn--sm', { style: { marginTop: '12px' }, onclick: () => confirmDialog(task.title, { onConfirm: async () => { await remove('todos', task.id); onChange?.(); document.querySelector('.drawer-overlay')?.click(); } }) }, icon('trash'), t('common.delete')),
  );
  openDrawer({ title: task.title || t('nav.todos'), body });
  reloadSubs();
}
