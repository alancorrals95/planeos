// PlanEOS · Directory — org members
import { mountApp, pageHead } from '../components/appShell.js';
import { h, icon, render } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { supabase } from '../core/supabaseClient.js';
import { getOrgId } from '../core/orgContext.js';
import { avatar } from '../components/avatar.js';
import { toastErr } from '../core/toast.js';

(async () => {
  const mm = await mountApp({ active: 'nav.directory', title: t('nav.directory') });
  if (!mm) return;
  render(mm.content, pageHead(t('nav.directory'), ''), h('div', { id: 'dir' }, h('div.skeleton', { style: { height: '120px' } })));
  try {
    const { data } = await supabase.from('org_members')
      .select('role, profiles(id, full_name, email, title, avatar_url)')
      .eq('org_id', getOrgId()).eq('status', 'active');
    const cards = (data || []).map(m => h('div.card.card--pad-sm.row.gap-3',
      avatar(m.profiles, { size: 'lg' }),
      h('div',
        h('div', { style: { fontWeight: 'var(--fw-semibold)' } }, m.profiles?.full_name || m.profiles?.email),
        h('div.muted', { style: { fontSize: 'var(--text-xs)' } }, m.profiles?.title || m.role),
      )));
    render(document.getElementById('dir'), h('div.grid-auto', ...cards));
  } catch (e) { toastErr(e); }
})();
