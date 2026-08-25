// PlanEOS · time tracker core — one running entry per user
import { supabase } from './supabaseClient.js';
import { getOrgId, getUserId } from './orgContext.js';

let running = null;               // the active time_entry row or null
const listeners = new Set();
export function onTimer(cb) { listeners.add(cb); return () => listeners.delete(cb); }
function emit() { listeners.forEach(cb => cb(running)); }
export function getRunning() { return running; }

export async function refreshRunning() {
  const { data } = await supabase.from('time_entries').select('*')
    .eq('org_id', getOrgId()).eq('profile_id', getUserId()).is('ended_at', null).maybeSingle();
  running = data || null; emit(); return running;
}

export async function startTimer({ description = '', project_id = null, is_billable = true } = {}) {
  if (running) await stopTimer();
  const { data, error } = await supabase.from('time_entries').insert({
    org_id: getOrgId(), profile_id: getUserId(), description, project_id, is_billable,
    started_at: new Date().toISOString(), created_by: getUserId(),
  }).select().single();
  if (error) throw error;
  running = data; emit(); return data;
}

export async function stopTimer() {
  if (!running) return null;
  const { data, error } = await supabase.from('time_entries')
    .update({ ended_at: new Date().toISOString() }).eq('id', running.id).select().single();
  if (error) throw error;
  running = null; emit(); return data;
}

export function elapsedSeconds(entry = running) {
  if (!entry) return 0;
  const end = entry.ended_at ? new Date(entry.ended_at) : new Date();
  return Math.max(0, (end - new Date(entry.started_at)) / 1000);
}
