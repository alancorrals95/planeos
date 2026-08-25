// PlanEOS · thin CRUD helpers over supabase — auto org_id + created_by, errors thrown
import { supabase } from './supabaseClient.js';
import { getOrgId, getUserId } from './orgContext.js';

// SELECT list with optional filters/order
export async function list(table, { select = '*', filters = {}, order, ascending = true, limit } = {}) {
  let q = supabase.from(table).select(select).eq('org_id', getOrgId());
  for (const [k, v] of Object.entries(filters)) {
    if (v === null) q = q.is(k, null);
    else if (Array.isArray(v)) q = q.in(k, v);
    else q = q.eq(k, v);
  }
  if (order) q = q.order(order, { ascending });
  if (limit) q = q.limit(limit);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function create(table, values, { stampUser = true } = {}) {
  const row = { org_id: getOrgId(), ...values };
  if (stampUser && !('created_by' in row)) row.created_by = getUserId();
  const { data, error } = await supabase.from(table).insert(row).select().single();
  if (error) throw error;
  return data;
}

export async function update(table, id, patch) {
  const { data, error } = await supabase.from(table).update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function remove(table, id) {
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) throw error;
}

export async function upsert(table, values, onConflict) {
  const row = { org_id: getOrgId(), ...values };
  const { data, error } = await supabase.from(table).upsert(row, { onConflict }).select().single();
  if (error) throw error;
  return data;
}

export async function rpc(fn, args) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data;
}

// True when an error means "table/function not created yet" (missing migration)
export function isMissingSchema(err) {
  const code = err?.code || '';
  const msg = (err?.message || '') + ' ' + (err?.hint || '') + ' ' + (err?.details || '');
  return code === '42P01' || code === '42883' || code === 'PGRST202' || code === 'PGRST205'
    || /does not exist|schema cache|Could not find the (table|function)/i.test(msg);
}
