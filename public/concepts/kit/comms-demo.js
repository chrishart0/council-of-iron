import { load, mountComms, screen } from '/concepts/kit/concept.js';
const m = await load();
await mountComms(m, { button: document.getElementById('cb'), toasts: document.getElementById('toasts'), panel: document.getElementById('panel') }, screen());
document.body.dataset.ready = '1';
