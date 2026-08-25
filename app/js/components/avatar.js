// PlanEOS · avatar + stack
import { h } from '../core/dom.js';
import { initials } from '../core/format.js';

export function avatar(profile, { size = '', online = false } = {}) {
  const name = profile?.full_name || profile?.email || '';
  const cls = 'avatar' + (size ? ' avatar--' + size : '') + (online ? ' avatar--online' : '');
  if (profile?.avatar_url) return h('span', { class: cls }, h('img', { src: profile.avatar_url, alt: name, width: '100%', height: '100%', style: { objectFit: 'cover' } }));
  return h('span', { class: cls, title: name }, initials(name));
}

export function avatarStack(profiles = [], max = 4) {
  const shown = profiles.slice(0, max);
  const extra = profiles.length - shown.length;
  const wrap = h('div.avatar-stack');
  shown.forEach(p => wrap.append(avatar(p, { size: 'sm' })));
  if (extra > 0) wrap.append(h('span.avatar.avatar--sm', '+' + extra));
  return wrap;
}
