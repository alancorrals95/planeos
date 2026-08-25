// PlanEOS · organization context — active org, role, memberships
import { supabase } from './supabaseClient.js';
import { getUser } from './auth.js';
import { go } from './paths.js';

const KEY = 'planeos.activeOrg';
let state = { user: null, profile: null, memberships: [], org: null, role: null };

export function getOrgId() { return state.org?.id || null; }
export function getOrg() { return state.org; }
export function getRole() { return state.role; }
export function getProfile() { return state.profile; }
export function getUserId() { return state.user?.id || null; }
export function getMemberships() { return state.memberships; }

const RANK = { owner: 4, admin: 3, manager: 2, member: 1 };
export function hasMinRole(min) { return (RANK[state.role] || 0) >= (RANK[min] || 0); }

// Load context; if no org, redirect to onboarding (unless skipRedirect).
export async function loadOrgContext({ skipRedirect = false } = {}) {
  state.user = await getUser();
  if (!state.user) return null;

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', state.user.id).single();
  state.profile = profile;

  const { data: memberships, error } = await supabase
    .from('org_members')
    .select('role, status, organizations(id, name, slug, logo_url, settings)')
    .eq('profile_id', state.user.id)
    .eq('status', 'active');
  if (error) console.warn('membership load', error);
  state.memberships = (memberships || []).filter(m => m.organizations);

  if (!state.memberships.length) {
    if (!skipRedirect) go('pages/auth/onboarding.html');
    return null;
  }

  const saved = localStorage.getItem(KEY);
  let m = state.memberships.find(x => x.organizations.id === saved) || state.memberships[0];
  state.org = m.organizations;
  state.role = m.role;
  localStorage.setItem(KEY, state.org.id);
  return state;
}

export function switchOrg(orgId) {
  localStorage.setItem(KEY, orgId);
  go('pages/dashboard/index.html');
}
