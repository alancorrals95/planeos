// PlanEOS · app shell — auth gate + org + i18n + plan, then render frame
import '../core/theme.js';
import { requireAuth, onAuthChange } from '../core/auth.js';
import { loadOrgContext } from '../core/orgContext.js';
import { loadI18n, t } from '../core/i18n.js';
import { loadPlan } from '../core/plan.js';
import { h, icon } from '../core/dom.js';
import { buildSidebar, buildBottomTabs } from './sidebar.js';
import { timerChip } from './timerChip.js';

// mountApp({ active, title }) -> { content } (the element to render your page into)
export async function mountApp({ active, title } = {}) {
  await loadI18n();
  const user = await requireAuth();
  if (!user) return null;
  const ctx = await loadOrgContext();
  if (!ctx) return null; // redirected to onboarding
  await loadPlan();

  onAuthChange((session) => { if (!session) location.reload(); });

  const collapsed = localStorage.getItem('planeos.collapsed') === 'true';
  const sidebar = buildSidebar(active);
  const scrim = h('div.scrim', { onclick: closeDrawer });

  const content = h('div.app-content', h('div.content-inner', { id: 'content-inner' }));
  const topbar = h('header.topbar',
    h('button.btn.btn--ghost.btn--icon.hamburger', { title: t('nav.more'), onclick: openDrawer }, icon('menu')),
    h('button.btn.btn--ghost.btn--icon.collapse-btn', { title: 'Collapse', onclick: toggleCollapse }, icon('chevrons')),
    h('span.topbar__title', t(title || active || 'app.name')),
    h('div.topbar__search', { onclick: () => {} }, icon('search'), h('span', t('common.search')), h('kbd', '⌘K')),
    h('div.topbar__actions', timerChip(), h('button.btn.btn--ghost.btn--icon', { title: 'Notifications' }, icon('bell'))),
  );

  const main = h('main.app-main', topbar, content);
  const shell = h('div.app-shell', { id: 'app-shell', dataset: { collapsed: String(collapsed) } }, sidebar, main);

  const app = document.getElementById('app') || document.body;
  app.replaceChildren(shell, scrim, buildBottomTabs(active));

  function toggleCollapse() {
    const el = document.getElementById('app-shell');
    const now = el.dataset.collapsed !== 'true';
    el.dataset.collapsed = String(now);
    localStorage.setItem('planeos.collapsed', String(now));
  }
  function openDrawer() {
    const open = sidebar.getAttribute('data-open') === 'true';
    if (open) return closeDrawer();
    sidebar.setAttribute('data-open', 'true'); scrim.setAttribute('data-open', 'true');
  }
  function closeDrawer() { sidebar.removeAttribute('data-open'); scrim.removeAttribute('data-open'); }
  // close the mobile drawer whenever a nav link is tapped
  sidebar.addEventListener('click', (e) => { if (e.target.closest('a.nav-item')) closeDrawer(); });

  return { content: document.getElementById('content-inner'), ctx };
}

// convenience header block
export function pageHead(title, sub, actions) {
  return h('div.page-head',
    h('div', h('h1', title), sub ? h('p', sub) : null),
    actions ? h('div.row.gap-2', ...(Array.isArray(actions) ? actions : [actions])) : null);
}
