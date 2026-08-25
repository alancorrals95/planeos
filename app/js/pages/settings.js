// PlanEOS · Settings — Organization, Members (invites/roles), Profile, Billing
import { mountApp, pageHead } from '../components/appShell.js';
import { h, icon, render } from '../core/dom.js';
import { t, setLocale, getLocale } from '../core/i18n.js';
import { supabase } from '../core/supabaseClient.js';
import { getOrgId, getOrg, getRole, hasMinRole, getProfile } from '../core/orgContext.js';
import { create, update, remove } from '../core/api.js';
import { avatar } from '../components/avatar.js';
import { toastErr, toastOk } from '../core/toast.js';
import { toggleTheme, currentTheme } from '../core/theme.js';
import { to } from '../core/paths.js';
import { plan, limits } from '../core/plan.js';

let content, tab = new URLSearchParams(location.search).get('tab') || 'org';

function tabs() {
  const items = [['org', t('settings.org')], ['members', t('members.title')], ['profile', t('nav.profile')], ['billing', t('billing.title')]];
  return h('div.tabs', ...items.map(([k, label]) =>
    h('button.tab', { 'aria-selected': tab === k, onclick: () => { tab = k; render_(); } }, label)));
}

async function orgTab() {
  const org = getOrg();
  const name = h('input.input', { value: org.name, disabled: !hasMinRole('admin') });
  const save = h('button.btn.btn--primary', { onclick: async () => { try { await update('organizations', org.id, { name: name.value }); toastOk(t('settings.saved')); } catch (e) { toastErr(e); } } }, t('common.save'));
  return h('div.card', { style: { maxWidth: '520px' } },
    h('div.field', h('label.field__label', t('settings.org_name')), name),
    h('div.field', h('label.field__label', t('settings.theme')),
      h('button.btn.btn--secondary', { onclick: (e) => { toggleTheme(); e.currentTarget.replaceChildren(icon(currentTheme()==='dark'?'sun':'moon'), document.createTextNode(currentTheme())); } }, icon(currentTheme()==='dark'?'sun':'moon'), currentTheme())),
    h('div.field', h('label.field__label', t('settings.language')),
      h('div.segmented',
        h('button.segmented__item', { 'aria-selected': getLocale()==='es', onclick: () => setLocale('es') }, 'Español'),
        h('button.segmented__item', { 'aria-selected': getLocale()==='en', onclick: () => setLocale('en') }, 'English'))),
    hasMinRole('admin') ? save : null,
  );
}

async function membersTab() {
  const wrap = h('div');
  const isAdmin = hasMinRole('admin');
  // invite form
  if (isAdmin) {
    const email = h('input.input', { type: 'email', placeholder: 'name@company.com', style: { flex: '1' } });
    const role = h('select.select', { style: { width: '140px' } }, ...['member','manager','admin'].map(r => h('option', { value: r }, r)));
    const btn = h('button.btn.btn--primary', icon('plus'), t('members.invite'));
    wrap.append(h('form.toolbar', { onsubmit: async (e) => { e.preventDefault(); if (!email.value) return;
      try { const inv = await create('org_invites', { email: email.value.trim(), role: role.value, invited_by: getProfile().id }, { stampUser: false });
        const link = location.origin + to('pages/auth/onboarding.html') + '?token=' + inv.token;
        await navigator.clipboard.writeText(link).catch(()=>{});
        toastOk(t('members.invite_sent')); email.value=''; loadLists(); } catch (err) { toastErr(err); } } },
      email, role, btn));
  }
  const membersBox = h('div.card', { style: { padding: '0', marginBottom: '16px' } }, h('div', { id: 'mem-list' }));
  const invitesBox = h('div', { id: 'inv-list' });
  wrap.append(membersBox, invitesBox);

  async function loadLists() {
    const { data: mem } = await supabase.from('org_members').select('id, role, profile_id, profiles(id, full_name, email, avatar_url)').eq('org_id', getOrgId()).eq('status','active');
    render(document.getElementById('mem-list'), ...(mem||[]).map(m => h('div.list-row',
      avatar(m.profiles, { size: 'sm' }),
      h('span.list-row__title', m.profiles?.full_name || m.profiles?.email),
      isAdmin ? h('select.select', { style: { width: '130px' }, onchange: async (e) => { try { await update('org_members', m.id, { role: e.target.value }); } catch (err) { toastErr(err); e.target.value = m.role; } } },
        ...['member','manager','admin','owner'].map(r => h('option', { value: r, selected: r===m.role }, r)))
        : h('span.badge.badge--neutral', m.role),
    )));
    if (isAdmin) {
      const { data: inv } = await supabase.from('org_invites').select('*').eq('org_id', getOrgId()).is('accepted_at', null);
      const rows = (inv||[]).map(i => h('div.list-row',
        icon('bell'), h('span.list-row__title', i.email), h('span.badge.badge--neutral', i.role),
        h('button.btn.btn--ghost.btn--sm', { onclick: async () => { const link = location.origin + to('pages/auth/onboarding.html') + '?token=' + i.token; await navigator.clipboard.writeText(link); toastOk(t('members.copy_link')); } }, t('members.copy_link')),
        h('button.btn.btn--ghost.btn--icon.btn--sm', { onclick: async () => { await remove('org_invites', i.id); loadLists(); } }, icon('trash'))));
      render(document.getElementById('inv-list'), rows.length ? h('div', h('div.list-section-label', t('members.pending')), h('div.card', { style: { padding: '0' } }, ...rows)) : null);
    }
  }
  loadLists();
  return wrap;
}

function profileTab() {
  const p = getProfile();
  const name = h('input.input', { value: p?.full_name || '' });
  const title = h('input.input', { value: p?.title || '' });
  const save = h('button.btn.btn--primary', { onclick: async () => { try { await supabase.from('profiles').update({ full_name: name.value, title: title.value }).eq('id', p.id); toastOk(t('settings.saved')); } catch (e) { toastErr(e); } } }, t('common.save'));
  return h('div.card', { style: { maxWidth: '520px' } },
    h('div.row.gap-3', { style: { marginBottom: '16px' } }, avatar(p, { size: 'xl' }), h('div', h('div', { style: { fontWeight: 'var(--fw-semibold)' } }, p?.full_name), h('div.muted', p?.email))),
    h('div.field', h('label.field__label', t('auth.name')), name),
    h('div.field', h('label.field__label', t('common.title')), title),
    save);
}

function billingTab() {
  const l = limits();
  const cur = plan();
  return h('div.grid-2', { style: { maxWidth: '720px' } },
    h('div.card', { style: cur==='free'?{ borderColor:'var(--accent)' }:null },
      h('div.card__header', h('div.card__title', t('billing.free')), cur==='free'?h('span.badge.badge--accent', t('billing.current')):null),
      h('div.stat-num', '$0'),
      h('ul', { style: { marginTop: '12px', color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' } },
        h('li', '• ' + (l.members===Infinity?'∞':'≤5') + ' ' + t('nav.members')),
        h('li', '• Dashboard, To-Dos, Rocks'),
        h('li', '• Chat, Scorecard'))),
    h('div.card', { style: cur==='pro'?{ borderColor:'var(--accent)' }:null },
      h('div.card__header', h('div.card__title', t('billing.pro')), cur==='pro'?h('span.badge.badge--accent', t('billing.current')):null),
      h('div', h('span.stat-num', '$19'), h('span.muted', ' ' + t('billing.per_seat'))),
      h('ul', { style: { marginTop: '12px', color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' } },
        h('li', '• Todo ilimitado / Unlimited'),
        h('li', '• Live Meetings, CRM, Time Tracking'),
        h('li', '• Integraciones')),
      cur!=='pro'?h('button.btn.btn--primary.btn--block', { style: { marginTop: '16px' }, onclick: () => toastOk('Stripe Checkout — Phase 2') }, t('billing.upgrade')):h('button.btn.btn--secondary.btn--block', { style: { marginTop: '16px' }, onclick: () => toastOk('Customer Portal — Phase 2') }, t('billing.manage'))),
  );
}

async function render_() {
  const bodyEl = h('div', { id: 'settings-body' });
  render(content, pageHead(t('settings.title'), ''), tabs(), bodyEl);
  const node = tab === 'org' ? await orgTab() : tab === 'members' ? await membersTab() : tab === 'billing' ? billingTab() : profileTab();
  render(bodyEl, node);
}

(async () => {
  const mm = await mountApp({ active: 'nav.settings', title: t('settings.title') });
  if (!mm) return; content = mm.content;
  render_();
})();
