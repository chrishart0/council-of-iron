/** Small shared UI helpers, kept free of game state and transport. */
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
/** Game clock mm:ss (never negative). */
export const clock = n => `${Math.floor(Math.max(0, n) / 60).toString().padStart(2, '0')}:${Math.floor(Math.max(0, n) % 60).toString().padStart(2, '0')}`;
/** Who sits in a seat, in two words or fewer. */
export const seatType = p => !p ? '' : p.kind === 'bot' ? 'Bot' : p.kind === 'agent' ? 'AI' : 'Human';
export function setHTML(element, html) {
  if(element.dataset.rendered!==html){element.innerHTML=html;element.dataset.rendered=html;}
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
