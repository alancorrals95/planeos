// PlanEOS · inline setup notice for missing DB migrations
import { h, icon, render } from '../core/dom.js';
import { isMissingSchema } from '../core/api.js';
import { toastErr } from '../core/toast.js';

// Renders a friendly "run this migration" card into `target` if the error is a
// missing table/function; otherwise shows a toast. Returns true if it was a schema error.
export function handleDbError(err, target, migration) {
  console.error(err);
  if (isMissingSchema(err)) {
    const card = h('div.card', { style: { maxWidth: '560px', margin: '0 auto', textAlign: 'center' } },
      h('div.empty',
        icon('credit-card'),
        h('div.empty__title', 'Falta aplicar una migración'),
        h('div.empty__desc', h('span', 'Este módulo necesita tablas que aún no existen en tu base de datos. Corre '),
          h('code', { style: { fontFamily: 'var(--font-mono)', color: 'var(--accent-text)' } }, migration || 'la migración correspondiente'),
          h('span', ' en el SQL Editor de Supabase y recarga.')),
      ));
    if (target) render(target, card);
    return true;
  }
  toastErr(err);
  return false;
}
