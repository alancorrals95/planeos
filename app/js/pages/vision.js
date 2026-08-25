// PlanEOS · Vision / VTO — single upsert per org
import { mountApp, pageHead } from '../components/appShell.js';
import { h, render } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { supabase } from '../core/supabaseClient.js';
import { getOrgId, getUserId } from '../core/orgContext.js';
import { toastErr, toastOk } from '../core/toast.js';
import { handleDbError } from '../components/notice.js';

let content;
function field(label, el) { return h('div.field', h('label.field__label', label), el); }

(async () => {
  const m = await mountApp({ active: 'nav.vision' });
  if (!m) return; content = m.content;
  const { data, error } = await supabase.from('vision').select('*').eq('org_id', getOrgId()).is('team_id', null).maybeSingle();
  if (error) { render(content, h('div', { id: 'v-body' })); return handleDbError(error, document.getElementById('v-body'), '0008_misc.sql'); }
  const v = data || {};
  const values = h('textarea.textarea', { value: (v.core_values || []).join?.('\n') || '', placeholder: 'Un valor por línea' });
  const purpose = h('input.input', { value: v.core_focus?.purpose || '' });
  const niche = h('input.input', { value: v.core_focus?.niche || '' });
  const ten = h('input.input', { value: v.ten_year_target || '' });
  const three = h('textarea.textarea', { value: v.three_year_picture || '' });
  const one = h('textarea.textarea', { value: v.one_year_plan || '' });
  const save = h('button.btn.btn--primary', { onclick: async () => {
    try { await supabase.from('vision').upsert({ org_id: getOrgId(), team_id: null,
      core_values: values.value.split('\n').map(s => s.trim()).filter(Boolean),
      core_focus: { purpose: purpose.value, niche: niche.value },
      ten_year_target: ten.value, three_year_picture: three.value, one_year_plan: one.value,
      updated_by: getUserId(), updated_at: new Date().toISOString() }, { onConflict: 'org_id,team_id' });
      toastOk(t('settings.saved')); } catch (e) { toastErr(e); } } }, t('common.save'));

  render(content, pageHead(t('nav.vision'), 'Vision/Traction Organizer (VTO)'),
    h('div.grid-2',
      h('div.card', h('h3', { style: { marginBottom: '12px' } }, 'Core'), field('Valores fundamentales', values), field('Propósito / Causa', purpose), field('Nicho', niche)),
      h('div.card', h('h3', { style: { marginBottom: '12px' } }, 'Traction'), field('Meta a 10 años', ten), field('Imagen a 3 años', three), field('Plan a 1 año', one))),
    h('div', { style: { marginTop: '16px' } }, save));
})();
