// PlanEOS · auth page controllers
import { h, icon, render } from '../core/dom.js';
import { loadI18n, t } from '../core/i18n.js';
import { signIn, signUp, resetPassword, redirectIfAuthed, getSession } from '../core/auth.js';
import { supabase } from '../core/supabaseClient.js';
import { rpc } from '../core/api.js';
import { toastErr, toastOk } from '../core/toast.js';
import { go, to } from '../core/paths.js';
import '../core/theme.js';

function brand() {
  return h('div.auth-brand', h('span.auth-brand__mark', 'P'), h('span', 'PlanEOS'));
}
function field(label, input) { return h('div.field', h('label.field__label', label), input); }
function mount(node) { const root = document.getElementById('auth'); render(root, node); }

export async function initLogin() {
  await loadI18n(); await redirectIfAuthed();
  const email = h('input.input', { type: 'email', required: true, autocomplete: 'email' });
  const pass = h('input.input', { type: 'password', required: true, autocomplete: 'current-password' });
  const btn = h('button.btn.btn--primary.btn--block', { type: 'submit' }, t('auth.login'));
  const form = h('form.stack', { onsubmit: async (e) => {
      e.preventDefault(); btn.disabled = true;
      try { await signIn(email.value.trim(), pass.value); go('pages/dashboard/index.html'); }
      catch (err) { toastErr(err); btn.disabled = false; }
    } },
    field(t('auth.email'), email),
    field(t('auth.password'), pass),
    h('div', { style: { textAlign: 'right', marginTop: '-8px', marginBottom: '12px' } }, h('a', { href: to('pages/auth/forgot.html'), style: { fontSize: 'var(--text-xs)' } }, t('auth.forgot'))),
    btn,
  );
  mount(h('div.auth-card', brand(),
    h('h1.auth-title', t('auth.welcome')), h('p.auth-sub', t('auth.welcome_sub')),
    form,
    h('p.auth-foot', t('auth.no_account') + ' ', h('a', { href: to('pages/auth/signup.html') }, t('auth.signup'))),
  ));
}

export async function initSignup() {
  await loadI18n(); await redirectIfAuthed();
  const name = h('input.input', { type: 'text', required: true, autocomplete: 'name' });
  const email = h('input.input', { type: 'email', required: true, autocomplete: 'email' });
  const pass = h('input.input', { type: 'password', required: true, minlength: 6, autocomplete: 'new-password' });
  const btn = h('button.btn.btn--primary.btn--block', { type: 'submit' }, t('auth.signup'));
  const form = h('form.stack', { onsubmit: async (e) => {
      e.preventDefault(); btn.disabled = true;
      try {
        await signUp(email.value.trim(), pass.value, name.value.trim());
        const s = await getSession();
        if (s) go('pages/auth/onboarding.html');       // email confirmation off
        else { toastOk(t('auth.check_email')); btn.disabled = false; }
      } catch (err) { toastErr(err); btn.disabled = false; }
    } },
    field(t('auth.name'), name), field(t('auth.email'), email), field(t('auth.password'), pass), btn,
  );
  mount(h('div.auth-card', brand(),
    h('h1.auth-title', t('auth.create_account')), h('p.auth-sub', t('auth.create_sub')),
    form,
    h('p.auth-foot', t('auth.have_account') + ' ', h('a', { href: to('pages/auth/login.html') }, t('auth.login'))),
  ));
}

export async function initOnboarding() {
  await loadI18n();
  const s = await getSession(); if (!s) return go('pages/auth/login.html');
  // if already has org, go to dashboard
  const { data: mem } = await supabase.from('org_members').select('org_id').eq('profile_id', s.user.id).eq('status', 'active').limit(1);
  const params = new URLSearchParams(location.search);
  const inviteToken = params.get('token');
  if (inviteToken) {
    try { await rpc('accept_invite', { p_token: inviteToken }); toastOk('Joined!'); return go('pages/dashboard/index.html'); }
    catch (e) { toastErr(e); }
  }
  if (mem && mem.length) return go('pages/dashboard/index.html');

  const orgName = h('input.input', { type: 'text', required: true, placeholder: 'Acme Inc.' });
  const btn = h('button.btn.btn--primary.btn--block', { type: 'submit' }, t('auth.continue'));
  const form = h('form.stack', { onsubmit: async (e) => {
      e.preventDefault(); btn.disabled = true;
      try { await rpc('create_organization', { p_name: orgName.value.trim() }); go('pages/dashboard/index.html'); }
      catch (err) { toastErr(err); btn.disabled = false; }
    } },
    field(t('auth.org_name'), orgName), btn);
  mount(h('div.auth-card', brand(),
    h('h1.auth-title', t('auth.create_org')), h('p.auth-sub', t('auth.org_sub')), form));
}

export async function initForgot() {
  await loadI18n();
  const email = h('input.input', { type: 'email', required: true });
  const btn = h('button.btn.btn--primary.btn--block', { type: 'submit' }, t('auth.reset'));
  const form = h('form.stack', { onsubmit: async (e) => {
      e.preventDefault(); btn.disabled = true;
      try { await resetPassword(email.value.trim()); toastOk(t('auth.check_email')); }
      catch (err) { toastErr(err); } finally { btn.disabled = false; }
    } }, field(t('auth.email'), email), btn);
  mount(h('div.auth-card', brand(), h('h1.auth-title', t('auth.reset')), h('p.auth-sub', ''), form,
    h('p.auth-foot', h('a', { href: to('pages/auth/login.html') }, t('common.back')))));
}

export async function initReset() {
  await loadI18n();
  const pass = h('input.input', { type: 'password', required: true, minlength: 6 });
  const btn = h('button.btn.btn--primary.btn--block', { type: 'submit' }, t('auth.reset'));
  const form = h('form.stack', { onsubmit: async (e) => {
      e.preventDefault(); btn.disabled = true;
      const { error } = await supabase.auth.updateUser({ password: pass.value });
      if (error) { toastErr(error); btn.disabled = false; } else { toastOk('OK'); go('pages/dashboard/index.html'); }
    } }, field(t('auth.password'), pass), btn);
  mount(h('div.auth-card', brand(), h('h1.auth-title', t('auth.reset')), form));
}
