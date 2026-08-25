// PlanEOS · plan / feature gating (reads subscription; falls back to free)
import { supabase } from './supabaseClient.js';
import { getOrgId } from './orgContext.js';

const LIMITS = {
  free: { members: 5, pipelines: 1, liveMeetings: false, timeReports: false, historyDays: 30, label: 'Free' },
  pro:  { members: Infinity, pipelines: Infinity, liveMeetings: true, timeReports: true, historyDays: Infinity, label: 'Pro' },
};

let current = { plan: 'free', status: 'active' };

export async function loadPlan() {
  try {
    const { data } = await supabase.from('subscriptions').select('plan, status, seats')
      .eq('org_id', getOrgId()).maybeSingle();
    if (data) current = data;
  } catch { /* table may not exist yet → free */ }
  return current;
}

export function plan() { return current.plan || 'free'; }
export function limits() { return LIMITS[plan()] || LIMITS.free; }
export function can(feature) { return !!limits()[feature]; }
export function isPro() { return plan() === 'pro'; }
