// PlanEOS · sidebar nav definition + render
import { h, icon } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { to } from '../core/paths.js';
import { getOrg, getProfile, getMemberships, switchOrg } from '../core/orgContext.js';
import { avatar } from './avatar.js';
import { signOut } from '../core/auth.js';
import { toggleTheme, currentTheme } from '../core/theme.js';
import { setLocale, getLocale } from '../core/i18n.js';

// key, icon, path (relative to /app/), built?
export const NAV = [
  { section: 'nav.workspace' },
  { key: 'nav.dashboard', icon: 'home',          path: 'pages/dashboard/index.html', built: true },
  { key: 'nav.data',      icon: 'chart',         path: 'pages/scorecard/index.html', built: true },
  { key: 'nav.rocks',     icon: 'mountain',      path: 'pages/rocks/index.html',     built: true },
  { key: 'nav.todos',     icon: 'check-square',  path: 'pages/todos/index.html',     built: true },
  { key: 'nav.boards',    icon: 'columns',       path: 'pages/boards/index.html',    built: true },
  { key: 'nav.issues',    icon: 'flag',          path: 'pages/issues/index.html',    built: true },
  { key: 'nav.meetings',  icon: 'video',         path: 'pages/meetings/index.html',  built: true },
  { key: 'nav.headlines', icon: 'megaphone',     path: 'pages/headlines/index.html', built: true },
  { section: 'nav.team' },
  { key: 'nav.chat',      icon: 'message',       path: 'pages/chat/index.html',      built: true },
  { key: 'nav.crm',       icon: 'grid',          path: 'pages/crm/contacts.html',    built: true },
  { key: 'nav.time',      icon: 'clock',         path: 'pages/time/index.html',      built: true },
  { section: 'nav.company' },
  { key: 'nav.directory', icon: 'users',         path: 'pages/directory/index.html', built: true },
  { key: 'nav.vision',    icon: 'eye',           path: 'pages/vision/index.html',    built: true },
  { key: 'nav.knowledge', icon: 'book',          path: 'pages/knowledge/index.html', built: true },
];

// primary destinations for mobile bottom bar
const MOBILE = ['nav.dashboard', 'nav.data', 'nav.todos', 'nav.chat'];

function resolve(item) { return to(item.built ? item.path : 'pages/soon.html?m=' + item.key); }

export function buildSidebar(active) {
  const org = getOrg();
  const orgSwitch = h('div.sidebar__org', { onclick: openOrgMenu },
    h('span.avatar.avatar--sm', (org?.name || 'O')[0].toUpperCase()),
    h('span.sidebar__org-name.truncate', org?.name || 'PlanEOS'),
    icon('chevron-down'),
  );

  const nav = h('nav.sidebar__nav');
  for (const item of NAV) {
    if (item.section) { nav.append(h('div.nav-section-label', t(item.section))); continue; }
    const a = h('a.nav-item', { href: resolve(item) }, icon(item.icon), h('span.nav-item__label', t(item.key)));
    if (item.key === active) a.setAttribute('aria-current', 'page');
    nav.append(a);
  }

  const profile = getProfile();
  const userRow = h('div.sidebar__user',
    avatar(profile, { size: 'sm' }),
    h('span.sidebar__user-name.truncate', profile?.full_name || profile?.email || ''),
    h('span.spacer'),
    h('a.btn.btn--ghost.btn--icon.btn--sm', { href: to('pages/settings/index.html'), title: t('settings.title') }, icon('settings')),
    h('button.btn.btn--ghost.btn--icon.btn--sm', { title: 'Theme', onclick: (e) => { toggleTheme(); e.currentTarget.replaceChildren(icon(currentTheme() === 'dark' ? 'sun' : 'moon')); } }, icon(currentTheme() === 'dark' ? 'sun' : 'moon')),
    h('button.btn.btn--ghost.btn--icon.btn--sm', { title: t('common.signout'), onclick: () => signOut() }, icon('logout')),
  );

  const aside = h('aside.sidebar', { id: 'sidebar' }, orgSwitch, nav, userRow);
  return aside;
}

export function buildBottomTabs(active) {
  const bar = h('nav.bottom-tabs');
  for (const key of MOBILE) {
    const item = NAV.find(n => n.key === key);
    const a = h('a.bottom-tab', { href: resolve(item) }, icon(item.icon), h('span', t(item.key)));
    if (key === active) a.setAttribute('aria-current', 'page');
    bar.append(a);
  }
  const more = h('a.bottom-tab', { href: '#', onclick: (e) => { e.preventDefault(); document.getElementById('sidebar')?.setAttribute('data-open', 'true'); document.querySelector('.scrim')?.setAttribute('data-open', 'true'); } }, icon('menu'), h('span', t('nav.more')));
  bar.append(more);
  return bar;
}

function openOrgMenu(e) {
  const existing = document.querySelector('.menu[data-org-menu]'); if (existing) { existing.remove(); return; }
  const rect = e.currentTarget.getBoundingClientRect();
  const menu = h('div.menu', { dataset: { orgMenu: '1' }, style: { top: rect.bottom + 4 + 'px', left: rect.left + 'px' } });
  getMemberships().forEach(m => {
    menu.append(h('button.menu__item', { onclick: () => switchOrg(m.organizations.id) },
      h('span.avatar.avatar--sm', (m.organizations.name || 'O')[0].toUpperCase()),
      h('span.truncate', m.organizations.name)));
  });
  menu.append(h('div.menu__sep'));
  menu.append(h('button.menu__item', { onclick: () => setLocale(getLocale() === 'es' ? 'en' : 'es') }, icon('eye'), (getLocale() === 'es' ? 'English' : 'Español')));
  document.body.append(menu);
  setTimeout(() => document.addEventListener('mousedown', function close(ev) { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', close); } }), 0);
}
