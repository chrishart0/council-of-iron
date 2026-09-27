/** Small shared UI helpers, kept free of game state and transport. */
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function syncOptions(select, values, current) {
  const previous=select.value;
  const key=JSON.stringify(values);
  if(select.dataset.options!==key) {
    // Update existing nodes where possible instead of replacing a focused dropdown.
    while(select.options.length>values.length)select.remove(select.options.length-1);
    for(let i=0;i<values.length;i++) {
      const value=values[i];let option=select.options[i];
      if(!option){option=document.createElement('option');select.add(option);}
      if(option.value!==value.value)option.value=value.value;
      if(option.textContent!==value.label)option.textContent=value.label;
    }
    select.dataset.options=key;
  }
  select.value=values.some(v=>v.value===current)?current:values.some(v=>v.value===previous)?previous:values[0]?.value || '';
}
export function setHTML(element, html) {
  if(element.dataset.rendered!==html){element.innerHTML=html;element.dataset.rendered=html;}
}
export function operationId() {
  return crypto.randomUUID?.() ?? [...crypto.getRandomValues(new Uint8Array(16))].map(n=>n.toString(16).padStart(2,'0')).join('');
}
/** Mouse, keyboard, Escape and touch share the native dialog/focus implementation. */
export function confirmAction({ title, message, accept='Confirm' }) {
  const dialog=document.getElementById('confirm-dialog'),previous=document.activeElement;
  dialog.querySelector('h2').textContent=title;dialog.querySelector('.confirmation-text').textContent=message;
  dialog.querySelector('[value="confirm"]').textContent=accept;
  dialog.returnValue='cancel';dialog.showModal();
  return new Promise(resolve=>dialog.addEventListener('close',()=>{previous?.focus();resolve(dialog.returnValue==='confirm');},{once:true}));
}
