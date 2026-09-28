import { SCREENS, esc } from '/concepts/kit/concept.js';
const directions = [['A', 'War Room', 'Anchored iron-and-brass HUD frame: top resource bar, outliner column, event letters.'],
  ['B', 'Field Telegraph', 'The shell is paperwork on a commander’s desk: telegram tape, dossier, wax seals.'],
  ['C', 'Modern', 'Minimal corner-anchored game HUD: bold icons, chunky buttons, notification icon stack.']];
document.getElementById('directions').innerHTML = directions.map(([id, name, text]) => `<section><h2>${id} · ${esc(name)}</h2><p>${esc(text)}</p><ul>${SCREENS.map(([s, label]) => `<li><a href="/concepts/${id}.html?s=${s}">${esc(label)}</a></li>`).join('')}</ul></section>`).join('');
