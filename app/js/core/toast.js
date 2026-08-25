// PlanEOS · toasts
import { h, icon } from './dom.js';

function region() {
  let r = document.querySelector('.toast-region');
  if (!r) { r = h('div.toast-region'); document.body.appendChild(r); }
  return r;
}

export function toast(message, type = 'default', ms = 4000) {
  const ic = type === 'success' ? 'check' : type === 'danger' ? 'x' : 'bell';
  const el = h('div.toast', { class: 'toast--' + type }, icon(ic), h('span', message));
  region().appendChild(el);
  const kill = () => { el.style.opacity = '0'; el.style.transform = 'translateY(8px)'; setTimeout(() => el.remove(), 200); };
  let t = setTimeout(kill, ms);
  el.addEventListener('mouseenter', () => clearTimeout(t));
  el.addEventListener('mouseleave', () => { t = setTimeout(kill, 1500); });
  el.addEventListener('click', kill);
  return el;
}
export const toastOk  = (m) => toast(m, 'success');
export const toastErr = (m) => toast(typeof m === 'string' ? m : (m?.message || 'Something went wrong'), 'danger');
