// PlanEOS · "Related items" panel driven by entity_links
import { h, icon, render } from '../core/dom.js';
import { supabase } from '../core/supabaseClient.js';
import { getOrgId } from '../core/orgContext.js';
import { t } from '../core/i18n.js';
import { to } from '../core/paths.js';
import { toastErr } from '../core/toast.js';

const TABLE = { task: 'todos', issue: 'issues', milestone: 'milestones', rock: 'rocks' };
const LABEL = { task: 'Tarea', issue: 'Tema', milestone: 'Milestone', rock: 'Roca' };
const HREF = {
  task: () => to('pages/todos/index.html'),
  issue: () => to('pages/issues/index.html'),
  rock: () => to('pages/rocks/index.html'),
  milestone: () => to('pages/rocks/index.html'),
};

async function resolveTitle(type, id) {
  const tbl = TABLE[type]; if (!tbl) return id.slice(0, 8);
  const { data } = await supabase.from(tbl).select('title').eq('id', id).maybeSingle();
  return data?.title || id.slice(0, 8);
}

// relatedPanel(type, id) -> Node that lazy-loads links
export function relatedPanel(type, id) {
  const wrap = h('div');
  render(wrap, h('div.list-section-label', t('common.related')), h('div.skeleton', { style: { height: '40px' } }));
  (async () => {
    try {
      const { data, error } = await supabase.from('entity_links')
        .select('*').eq('org_id', getOrgId())
        .or(`and(from_type.eq.${type},from_id.eq.${id}),and(to_type.eq.${type},to_id.eq.${id})`);
      if (error) throw error;
      const links = data || [];
      if (!links.length) { render(wrap, h('div.list-section-label', t('common.related')), h('div.muted', { style: { fontSize: 'var(--text-xs)', padding: '0 4px' } }, '—')); return; }
      const rows = await Promise.all(links.map(async (lk) => {
        const other = (lk.from_type === type && lk.from_id === id) ? { ty: lk.to_type, oid: lk.to_id } : { ty: lk.from_type, oid: lk.from_id };
        const title = await resolveTitle(other.ty, other.oid);
        return h('a.list-row', { href: HREF[other.ty] ? HREF[other.ty]() : '#', style: { textDecoration: 'none' } },
          h('span.badge.badge--neutral', LABEL[other.ty] || other.ty),
          h('span.list-row__title', title),
          h('span.list-row__meta', lk.relation));
      }));
      render(wrap, h('div.list-section-label', t('common.related')), h('div.list', ...rows));
    } catch (e) { toastErr(e); render(wrap, h('div.list-section-label', t('common.related')), h('div.muted', '—')); }
  })();
  return wrap;
}
