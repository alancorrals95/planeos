// PlanEOS · Chat — channels, DMs, realtime messages
import { mountApp } from '../components/appShell.js';
import { h, icon, render } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { supabase } from '../core/supabaseClient.js';
import { getOrgId, getUserId } from '../core/orgContext.js';
import { create, rpc } from '../core/api.js';
import { timeHM } from '../core/format.js';
import { avatar } from '../components/avatar.js';
import { subscribeTable } from '../core/realtime.js';
import { toastErr } from '../core/toast.js';
import { openModal } from '../components/modal.js';

let content, members = [], channels = [], current = null, unsub = null;

async function loadMembers() {
  const { data } = await supabase.from('org_members').select('profiles(id, full_name, email, avatar_url)').eq('org_id', getOrgId()).eq('status', 'active');
  members = (data || []).map(m => m.profiles).filter(Boolean);
}
function profileOf(id) { return members.find(m => m.id === id) || { full_name: '…' }; }

async function loadChannels() {
  const { data, error } = await supabase.from('channels').select('*').eq('org_id', getOrgId()).is('archived_at', null).order('created_at');
  if (error) { toastErr(error); return; }
  channels = data || [];
  if (!channels.find(c => c.kind === 'public')) {
    const ch = await create('channels', { name: 'general', kind: 'public', topic: 'General' });
    channels.push(ch);
  }
}

function channelLabel(c) {
  if (c.kind === 'dm') {
    const otherId = (c.dm_key || '').split(':').find(x => x !== getUserId());
    return profileOf(otherId).full_name || profileOf(otherId).email || 'DM';
  }
  return c.name || 'channel';
}

function renderChannelList() {
  const pub = channels.filter(c => c.kind === 'public' || c.kind === 'private');
  const dms = channels.filter(c => c.kind === 'dm' || c.kind === 'group_dm');
  const item = (c) => {
    const el = h('button.channel', { 'aria-current': current?.id === c.id ? 'page' : null, onclick: () => selectChannel(c) },
      c.kind === 'dm' ? avatar(profileOf((c.dm_key||'').split(':').find(x=>x!==getUserId())), { size: 'sm' }) : h('span.channel__hash', '#'),
      h('span.truncate', channelLabel(c)));
    return el;
  };
  return h('div',
    h('div.row', { style: { justifyContent: 'space-between', padding: '4px 12px' } },
      h('div.nav-section-label', { style: { padding: '0' } }, t('chat.channels')),
      h('button.btn.btn--ghost.btn--icon.btn--sm', { onclick: newChannelModal, title: t('chat.new_channel') }, icon('plus'))),
    ...pub.map(item),
    h('div.row', { style: { justifyContent: 'space-between', padding: '12px 12px 4px' } },
      h('div.nav-section-label', { style: { padding: '0' } }, t('chat.dms')),
      h('button.btn.btn--ghost.btn--icon.btn--sm', { onclick: newDmModal, title: t('chat.dms') }, icon('plus'))),
    ...dms.map(item),
  );
}

async function ensureMember(c) {
  await supabase.from('channel_members').upsert({ org_id: getOrgId(), channel_id: c.id, profile_id: getUserId() }, { onConflict: 'channel_id,profile_id', ignoreDuplicates: true });
}

async function selectChannel(c) {
  current = c;
  document.querySelector('.chat')?.setAttribute('data-view', 'conversation');
  await ensureMember(c);
  render(document.getElementById('chat-sidebar'), renderChannelList());
  const head = document.getElementById('chat-head');
  render(head,
    h('button.btn.btn--ghost.btn--icon.hamburger', { onclick: () => document.querySelector('.chat')?.setAttribute('data-view','list') }, icon('arrow-left')),
    h('span.channel__hash', c.kind === 'dm' ? '' : '#'),
    h('span.chat__head-title', channelLabel(c)));
  await loadMessages();
  if (unsub) unsub();
  unsub = subscribeTable('messages', { filter: `channel_id=eq.${c.id}`, event: 'INSERT', onChange: (p) => appendMessage(p.new) });
}

let lastAuthor = null;
function messageEl(m, grouped) {
  const p = profileOf(m.author_id);
  return h('div.msg', { class: 'msg' + (grouped ? ' msg--grouped' : '') },
    h('div.msg__avatar', grouped ? '' : avatar(p, { size: '' })),
    h('div',
      grouped ? null : h('div.msg__author-row', h('span.msg__author', p.full_name || p.email), h('span.msg__time', timeHM(m.created_at))),
      h('div.msg__body', m.body || '')));
}

function appendMessage(m) {
  const wrap = document.getElementById('chat-messages');
  if (!wrap || wrap.querySelector(`[data-mid="${m.id}"]`)) return;
  const grouped = lastAuthor === m.author_id;
  const el = messageEl(m, grouped); el.dataset.mid = m.id;
  wrap.append(el); lastAuthor = m.author_id;
  wrap.scrollTop = wrap.scrollHeight;
}

async function loadMessages() {
  const wrap = document.getElementById('chat-messages');
  render(wrap, h('div.skeleton', { style: { height: '60px', margin: '8px 16px' } }));
  const { data, error } = await supabase.from('messages').select('*').eq('channel_id', current.id).is('deleted_at', null).order('created_at').limit(200);
  if (error) { toastErr(error); return; }
  lastAuthor = null; render(wrap);
  (data || []).forEach(m => { const grouped = lastAuthor === m.author_id; const el = messageEl(m, grouped); el.dataset.mid = m.id; wrap.append(el); lastAuthor = m.author_id; });
  wrap.scrollTop = wrap.scrollHeight;
}

async function send(body) {
  if (!body.trim() || !current) return;
  try { await supabase.from('messages').insert({ org_id: getOrgId(), channel_id: current.id, author_id: getUserId(), body: body.trim() }); }
  catch (e) { toastErr(e); }
}

function newChannelModal() {
  const name = h('input.input', { required: true, placeholder: 'marketing' });
  const save = h('button.btn.btn--primary', { type: 'submit', form: 'ch-form' }, t('common.create'));
  const cancel = h('button.btn.btn--secondary', t('common.cancel'));
  const body = h('form', { id: 'ch-form', onsubmit: async (e) => { e.preventDefault();
    try { const ch = await create('channels', { name: name.value.trim().toLowerCase().replace(/\s+/g,'-'), kind: 'public' }); channels.push(ch); m.close(); selectChannel(ch); }
    catch (err) { toastErr(err); } } },
    h('div.field', h('label.field__label', t('chat.channel_name')), name));
  const m = openModal({ title: t('chat.new_channel'), body, footer: [cancel, save] });
  cancel.onclick = m.close;
}

function newDmModal() {
  const body = h('div.list');
  members.filter(x => x.id !== getUserId()).forEach(p => body.append(
    h('button.menu__item', { onclick: async () => {
      try { const id = await rpc('get_or_create_dm', { p_org: getOrgId(), p_other: p.id });
        await loadChannels(); const ch = channels.find(c => c.id === id) || { id, kind: 'dm', dm_key: [getUserId(), p.id].sort().join(':') };
        if (!channels.find(c=>c.id===id)) channels.push(ch); m.close(); selectChannel(ch);
      } catch (e) { toastErr(e); } } },
      avatar(p, { size: 'sm' }), h('span', p.full_name || p.email))));
  const m = openModal({ title: t('chat.dms'), body });
}

(async () => {
  const mm = await mountApp({ active: 'nav.chat', title: t('nav.chat') });
  if (!mm) return; content = mm.content;
  // full-bleed chat: clear the content padding
  const inner = content; inner.style.maxWidth = 'none';
  content.closest('.app-content').style.padding = '0';
  await loadMembers();
  await loadChannels();

  const composer = h('textarea.textarea', { rows: 1, placeholder: t('chat.message'), style: { resize: 'none' } });
  composer.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const v = composer.value; composer.value=''; send(v); } });

  render(content, h('div.chat', { 'data-view': 'list' },
    h('div.chat__sidebar', { id: 'chat-sidebar' }),
    h('div.chat__main',
      h('div.chat__head', { id: 'chat-head' }, h('span.muted', t('chat.no_channel'))),
      h('div.chat__messages', { id: 'chat-messages' }, h('div.empty', h('div.empty__desc', t('chat.no_channel_desc')))),
      h('div.chat__composer', h('div.input-wrap', composer, h('button.btn.btn--primary.btn--icon', { onclick: () => { const v = composer.value; composer.value=''; send(v); } }, icon('send')))),
    )));
  render(document.getElementById('chat-sidebar'), renderChannelList());
  const first = channels.find(c => c.kind === 'public');
  if (first) selectChannel(first);
})();
