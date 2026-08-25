// PlanEOS · generic "coming soon" placeholder for not-yet-built modules
import { mountApp, pageHead } from '../components/appShell.js';
import { h, icon, render } from '../core/dom.js';
import { t } from '../core/i18n.js';

const key = new URLSearchParams(location.search).get('m') || 'app.name';
(async () => {
  const active = key;
  const mm = await mountApp({ active, title: t(key) });
  if (!mm) return;
  render(mm.content,
    pageHead(t(key), ''),
    h('div.empty',
      icon('clock'),
      h('div.empty__title', t(key)),
      h('div.empty__desc', 'Este módulo llega en la siguiente fase / This module ships in the next phase.'),
    ));
})();
