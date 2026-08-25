// PlanEOS · reusable kanban board with drag-and-drop + fractional ordering
import { h, icon, render } from '../core/dom.js';

// Compute a new fractional position to drop an item BEFORE `beforeItem`
// within an ordered array `items` (excluding the dragged item). Returns a number.
export function positionFor(items, index) {
  const P = (x) => (x == null ? null : Number(x.position));
  const prev = index > 0 ? P(items[index - 1]) : null;
  const next = index < items.length ? P(items[index]) : null;
  if (prev == null && next == null) return 1024;
  if (prev == null) return next - 512;
  if (next == null) return prev + 1024;
  return (prev + next) / 2;
}

// Detect when two neighbours are too close and the column needs rebalancing.
export function needsRebalance(a, b) { return a != null && b != null && Math.abs(a - b) < 1e-6; }

/*
 kanban({
   columns: [{id,name,color,count?}],
   items:   [{id, column_id, position, ...}],
   card:    (item) => Node,                       // card renderer
   colHead: (col, items) => Node | string,        // optional custom header content
   onMove:  async ({id, toColumn, position}) => {},
   onAddCard: (columnId) => void,                  // optional "+"
   colActions: (col) => Node,                      // optional header actions
 }) -> Node
*/
export function kanban({ columns, items, card, colHead, onMove, onAddCard, colActions }) {
  const byCol = (colId) => items
    .filter(i => i.column_id === colId)
    .sort((a, b) => (a.position - b.position) || (new Date(a.created_at||0) - new Date(b.created_at||0)) || String(a.id).localeCompare(b.id));

  function columnEl(col) {
    const colItems = byCol(col.id);
    const cards = h('div.kanban__cards');
    colItems.forEach(it => cards.append(cardEl(it)));

    const head = h('div.kanban__col-head',
      colHead ? colHead(col, colItems) : h('span', col.name),
      h('span.kanban__count', colItems.length),
      h('span.spacer'),
      colActions ? colActions(col) : null,
    );
    const wrap = h('div.kanban__col', { dataset: { colId: col.id } },
      head, cards,
      onAddCard ? h('button.btn.btn--ghost.btn--sm', { onclick: () => onAddCard(col.id) }, icon('plus')) : null);

    wrap.addEventListener('dragover', (e) => { e.preventDefault(); wrap.classList.add('kanban__col--over'); });
    wrap.addEventListener('dragleave', (e) => { if (!wrap.contains(e.relatedTarget)) wrap.classList.remove('kanban__col--over'); });
    wrap.addEventListener('drop', async (e) => {
      e.preventDefault(); wrap.classList.remove('kanban__col--over');
      const id = e.dataTransfer.getData('text/plain'); if (!id) return;
      // compute drop index within this column by pointer Y
      const siblings = [...cards.querySelectorAll('.kanban-card')].filter(c => c.dataset.id !== id);
      let index = siblings.length;
      for (let k = 0; k < siblings.length; k++) {
        const r = siblings[k].getBoundingClientRect();
        if (e.clientY < r.top + r.height / 2) { index = k; break; }
      }
      const ordered = siblings.map(c => items.find(i => i.id === c.dataset.id)).filter(Boolean);
      const pos = positionFor(ordered, index);
      try { await onMove({ id, toColumn: col.id, position: pos }); } catch (_) {}
    });
    return wrap;
  }

  function cardEl(it) {
    const el = card(it);
    el.classList.add('kanban-card');
    el.setAttribute('draggable', 'true');
    el.dataset.id = it.id;
    el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', it.id); e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    return el;
  }

  return h('div.kanban', ...columns.map(columnEl));
}

// Optimistic local move helper: mutate the items array in place.
export function applyMove(items, { id, toColumn, position }) {
  const it = items.find(i => i.id === id);
  if (it) { it.column_id = toColumn; it.position = position; }
  return items;
}
