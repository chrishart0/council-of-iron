/** Small shared UI helpers, kept free of game state and transport. */
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
/** Game clock mm:ss (never negative). */
export const clock = n => `${Math.floor(Math.max(0, n) / 60).toString().padStart(2, '0')}:${Math.floor(Math.max(0, n) % 60).toString().padStart(2, '0')}`;
/** Who sits in a seat, in two words or fewer. */
export const seatType = p => !p ? '' : p.kind === 'bot' ? 'Bot' : p.kind === 'agent' ? 'AI' : 'Human';
/* Write only what changed: polling repaints the same UI, and an unchanged write still costs a mutation and a style
 * invalidation (inside the map's world layers, also a rebuild of both <use> copies). */
export const setText = (element, value) => { value = String(value); if (element.textContent !== value) element.textContent = value; };
export const setAttr = (element, name, value) => { value = String(value); if (element.getAttribute(name) !== value) element.setAttribute(name, value); };
export function setHTML(element, html) {
  if(element.__html!==html){element.innerHTML=html;element.__html=html;}
}
export function operationId() {
  return crypto.randomUUID?.() ?? [...crypto.getRandomValues(new Uint8Array(16))].map(n=>n.toString(16).padStart(2,'0')).join('');
}
/** Mouse, keyboard, Escape and touch share the native dialog/focus implementation. */
/** `extra` is an optional DOM node (built by the caller with textContent and authored SVG only). */
export function confirmAction({ title, message, accept='Confirm', extra=null }) {
  const dialog=document.getElementById('confirm-dialog'),previous=document.activeElement;
  dialog.querySelector('h2').textContent=title;dialog.querySelector('.confirmation-text').textContent=message;
  dialog.querySelector('.confirmation-extra').replaceChildren(...(extra?[extra]:[]));
  dialog.querySelector('[value="confirm"]').textContent=accept;
  dialog.returnValue='cancel';dialog.showModal();
  return new Promise(resolve=>dialog.addEventListener('close',()=>{previous?.focus();resolve(dialog.returnValue==='confirm');},{once:true}));
}
/** Keyed list update. `items`: [{ key, html }] (authored or escaped HTML, one root element each). An item whose HTML
 * did not change keeps its node, so polling never re-creates it, restarts its animation or drops its focus; changed
 * items are replaced, new ones inserted, the order follows `items`, and anything else is removed. */
export function patchList(list, items) {
  const old = new Map();
  for (const e of list.children) if (e.__key !== undefined) old.set(e.__key, e);
  const template = document.createElement('template');
  let prev = null;
  for (const { key, html } of items) {
    let e = old.get(key);
    if (!e || e.__html !== html) {
      template.innerHTML = html;
      const fresh = template.content.firstElementChild; fresh.__key = key; fresh.__html = html;
      if (e) e.replaceWith(fresh);
      e = fresh;
    }
    old.delete(key);
    const next = prev ? prev.nextSibling : list.firstChild;
    if (next !== e) list.insertBefore(e, next);
    prev = e;
  }
  for (let rest = prev ? prev.nextSibling : list.firstChild; rest;) { const n = rest.nextSibling; rest.remove(); rest = n; }
}
