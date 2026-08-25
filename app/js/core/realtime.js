// PlanEOS · realtime helpers — postgres changes + presence, with cleanup
import { supabase } from './supabaseClient.js';

const channels = new Set();

// Subscribe to row changes on a table, optional filter e.g. `channel_id=eq.<id>`
export function subscribeTable(table, { filter, event = '*', onChange } = {}) {
  const name = `db:${table}:${filter || 'all'}:${Math.floor(performance.now())}`;
  const ch = supabase.channel(name)
    .on('postgres_changes', { event, schema: 'public', table, ...(filter ? { filter } : {}) }, (payload) => {
      onChange && onChange(payload);
    })
    .subscribe();
  channels.add(ch);
  return () => { supabase.removeChannel(ch); channels.delete(ch); };
}

// Presence channel; returns { channel, leave() }
export function joinPresence(name, meta = {}, onSync) {
  const ch = supabase.channel(name, { config: { presence: { key: meta.key || undefined } } });
  ch.on('presence', { event: 'sync' }, () => onSync && onSync(ch.presenceState()));
  ch.subscribe(async (status) => { if (status === 'SUBSCRIBED') await ch.track(meta); });
  channels.add(ch);
  return { channel: ch, leave: () => { supabase.removeChannel(ch); channels.delete(ch); } };
}

export function cleanupAll() {
  channels.forEach(ch => supabase.removeChannel(ch));
  channels.clear();
}
window.addEventListener('beforeunload', cleanupAll);
