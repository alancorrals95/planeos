// PlanEOS · tiny hyperscript DOM helper — h() + render() + helpers

// h('div.class#id', {attrs}, ...children)
export function h(tag, props, ...children) {
  let el;
  if (tag instanceof Node) return tag;
  // parse tag.class#id shorthand
  const m = tag.match(/^([a-z0-9]+)?([.#][^\s]*)?$/i);
  let name = 'div', classes = [], id = null;
  if (m) {
    name = m[1] || 'div';
    const rest = (m[2] || '') + (tag.includes('.') || tag.includes('#') ? '' : '');
    // fully parse .a.b#id from the whole tag
  }
  // robust parse
  const parts = tag.split(/(?=[.#])/);
  name = parts[0] && !/[.#]/.test(parts[0]) ? parts[0] : 'div';
  parts.forEach(p => { if (p[0] === '.') classes.push(p.slice(1)); if (p[0] === '#') id = p.slice(1); });
  el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (id) el.id = id;

  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props); props = null;
  }
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = (el.className ? el.className + ' ' : '') + v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k in el && k !== 'list') { try { el[k] = v; } catch { el.setAttribute(k, v); } }
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  appendChildren(el, children);
  return el;
}

function appendChildren(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === true) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function icon(id, cls = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon ' + cls);
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', spriteBase() + '#i-' + id);
  svg.appendChild(use);
  return svg;
}
// resolve sprite path relative to /app
function spriteBase() {
  const p = location.pathname;
  const idx = p.indexOf('/app/');
  const root = idx >= 0 ? p.slice(0, idx + 5) : '/';
  return root + 'assets/icons/sprite.svg';
}

export function render(container, ...nodes) {
  const el = typeof container === 'string' ? document.querySelector(container) : container;
  el.replaceChildren(...nodes.flat(Infinity).filter(Boolean).map(n => n instanceof Node ? n : document.createTextNode(String(n))));
  return el;
}
export function clear(el) { el.replaceChildren(); return el; }
export function frag(...nodes) { const f = document.createDocumentFragment(); appendChildren(f, nodes); return f; }
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
