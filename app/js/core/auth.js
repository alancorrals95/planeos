// PlanEOS · auth helpers
import { supabase } from './supabaseClient.js';
import { to, go } from './paths.js';

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}
export async function getUser() {
  const { data } = await supabase.auth.getUser();
  return data.user;
}

// Guard for protected pages. Returns the user or redirects to login.
export async function requireAuth() {
  const session = await getSession();
  if (!session) {
    const next = encodeURIComponent(location.pathname + location.search);
    location.href = to('pages/auth/login.html') + '?next=' + next;
    return null;
  }
  return session.user;
}

// Inverse guard for auth pages
export async function redirectIfAuthed() {
  const session = await getSession();
  if (session) go('pages/dashboard/index.html');
}

export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}
export async function signUp(email, password, full_name) {
  const { error } = await supabase.auth.signUp({
    email, password, options: { data: { full_name } },
  });
  if (error) throw error;
}
export async function signOut() {
  await supabase.auth.signOut();
  go('pages/auth/login.html');
}
export async function resetPassword(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin + to('pages/auth/reset.html') });
  if (error) throw error;
}
export function onAuthChange(cb) { return supabase.auth.onAuthStateChange((_e, s) => cb(s)); }
