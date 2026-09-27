const $ = id => document.getElementById(id);
import { AfterAction } from './review.js';
import { developmentForecast, coalitionForecast } from './insights.js';
import { faction, insignia, icon, battleSignal } from './presentation.js';
import { Atlas } from './atlas.js';
import { escapeHTML as esc, syncOptions, setHTML, operationId, confirmAction } from './ui.js';
import { WorldFeed, Herald, presentHeadline } from './feed.js';
import { LeaderboardPanel } from './leaderboard-panel.js';
import { ExpandableMap } from './expand.js';
// Relations and alliance colours: the same DOM-free helpers the atlas and agent tools use.
import { relationsOf, allianceColors } from './relations.js';
import { warsOf } from './leaderboard.js';
import { SoundBoard } from './sound.js';
const time = n => `${Math.floor(Math.max(0,n)/60).toString().padStart(2,'0')}:${Math.floor(Math.max(0,n)%60).toString().padStart(2,'0')}`;
const signed = n => `${n>=0?'+':''}${n.toFixed(1)}`;
let identity;try{identity=JSON.parse(localStorage.getItem('coi.identity'));}catch{identity=null;}
let map, matchId=null, state=null, cursor=0, history=[], polling=false, tab='orders', source=null, destination=null, toastTimer;
let review, signalCursor=null, signalTimer;
let atlas, previewKey='', generation=0, pendingCommand=false, readMessageId=0, previewVersion=0;
let pollController=null, inspected=null;
const attackSelections = new Map();
let plannedDestination=null, mapReadyFor=null, orderMode='march';
let spectating=false;
// One command panel: `tab` picks its content; nothing is open until a province or HUD button asks.
let panelOpen=false, panelOpener=null;
const narrow=matchMedia('(max-width:759px)');
// Phones (either orientation): the atlas key starts collapsed, and collapses again when the screen shrinks.
const compactScreen=matchMedia('(max-width:759px), (max-height:499px)');
compactScreen.addEventListener('change',event=>{if(event.matches)atlas?.setLegendCollapsed(true);});
let messageCatchupComplete=false;
let worldFeed, herald, standings, expander;
const country = id => map.countries.find(c=>c.id===id);
const place = id => map.provinces.find(p=>p.id===id);
const sideName = id => state?.sides.find(s=>s.id===id)?.name || id;
const namedSide = id => country(sideName(id))?.name || sideName(id);
const myPlayer = () => state?.players.find(p=>p.id===state.you);
const seatType = p => !p ? 'Unclaimed' : p.kind==='bot' || p.model?.startsWith('heuristic-') ? 'BOT' : p.kind==='agent' ? 'AI' : 'HUMAN';
const atWar = (a,b) => Boolean(a && b && a!==b && (state?.wars || []).includes([a,b].sort().join(':')));
const mayEnter = (a,b) => !b || state.players.find(p=>p.id===a)?.side===state.players.find(p=>p.id===b)?.side || !state.rules.warRequired || atWar(a,b);
function toast(message,error=false){$('toast').textContent=message;$('toast').className=error?'error':'';$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,6500);}
const feedNames={
  country:id=>country(id)?.name || id || 'Nobody',
  short:id=>faction(id).short,
  province:id=>place(id)?.name || id,
  // Alliance names are player text; callers render them with textContent only.
  side:id=>history.find(e=>e.type==='alliance_activated' && e.side===id)?.name || namedSide(id),
  sideColor:id=>state && allianceColors(state)[id],
  time:n=>time(n),
};
/** Live headlines only (never catch-up): queue banners and ask the atlas for a brief effect. */
function announce(events){
  for(const e of events){
    if(!e.headline)continue;
    const {banner,effects}=presentHeadline(e,feedNames,state?.you);
    if(banner)herald.push(banner);
    for(const [kind,data] of effects){try{atlas?.effect?.(kind,data);}catch(error){console.error(error);}}
  }
}
function renderLeaderboard(){
  const box=$('leaderboard');box.hidden=!state || state.status==='lobby';
  if(!box.hidden)standings.update(state,5);
}
function renderFeed(live){
  const box=$('world-feed');box.hidden=!state || state.status==='lobby';
  if(box.hidden)return;
  worldFeed.update(history,state.dominanceBreaks||[],{live,you:state.you});
  const canSend=Boolean(state.you) && !spectating && state.status==='running';
  $('feed-form').hidden=!canSend;
  const delay=Math.max(0,(state.commandBudget?.chatReadyAt || 0)-state.tick);
  $('feed-send').disabled=!canSend || delay>0 || pendingCommand;
  $('feed-cooldown').textContent=canSend && delay?`Chat ready in ${delay} game s (shared across channels)`:'';
  // Collapsed feed = a one-line ticker of the latest item (text only; chat is player text).
  const last=$('feed-list').lastElementChild,words=last?.querySelector('.feed-words b,.feed-chat b');
  $('feed-ticker').textContent=words?`${words.textContent}: ${last.querySelector('.feed-detail,.feed-text')?.textContent || ''}`:'Headlines · public chat';
}
async function request(path,method='GET',data,token=identity?.token){
  const response=await fetch(path,{method,headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});
  const value=await response.json();if(!response.ok){const error=new Error(value.error || `Request failed (${response.status}).`);error.status=response.status;throw error;}return value;
}
async function ensureIdentity(name, force=false){
  name=name.trim();if(!force && identity?.name===name)return;
  const profile=await request('/api/players','POST',{name},null);
  generation++;pollController?.abort();review?.destroy();review=null;resetPresentation();identity=profile;cursor=0;history=[];readMessageId=0;worldFeed.reset();messageCatchupComplete=false;localStorage.setItem('coi.identity',JSON.stringify(identity));showIdentity();
}
function startingSummary(c){
  if(!c)return 'All countries are taken. You can still observe.';
  const troops=c.start.reduce((n,id)=>n+(c.garrisons?.[id] ?? c.startTroops ?? 10),0);
  const production=c.start.reduce((n,id)=>n+(c.development?.[id] ?? 1),0)*3;
  return `${c.start.length} holdings · ${troops} troops · ${production} recruits/min · ${c.colonies?.length || 0} colonial footholds. ${c.start.map(id=>place(id).name).join(' · ')}`;
}
function setConnection(text){$('connection').textContent=text;$('hud-connection').textContent=text;}
function showIdentity(){ $('identity').textContent=identity?.name || 'Observer';$('hud-identity').textContent=identity?.name || 'Observer';$('display-name').value=identity?.name || '';$('join-name').value=identity?.name || ''; }
function options(id,values,current){syncOptions($(id),values,current);}
async function rooms(){
  const data=await request('/api/games');
  const sections=[['running','Games in progress','Spectate'],['lobby','Open rooms','Enter'],['finished','Completed games','Review']];
  $('rooms').innerHTML=data.games.length?sections.map(([status,title,label])=>{
    const found=data.games.filter(g=>g.status===status);
    return found.length?`<section class="room-group"><h3>${title} <small>${found.length}</small></h3>${found.map(g=>`<div class="room-card"><div><p>${esc(g.name)}</p><small>${g.players.length}/8 SEATS · ${g.speed===1?'30 MIN':'5 MIN'} · ${status==='running'?`${time(g.tick)} elapsed · `:''}${esc(g.id)}</small></div><div class="room-entry-actions">${status==='running' && g.you?`<button data-room="${esc(g.id)}" data-resume="true">Resume</button>`:''}<button data-room="${esc(g.id)}" data-spectate="${status==='running'}">${label} →</button></div></div>`).join('')}</section>`:'';
  }).join(''):'<p class="muted">The chamber is empty. Open the first council.</p>';
  const standings=await request('/api/standings');
  $('standings').innerHTML=standings.standings.length?standings.standings.map(p=>`<div class="standing-row"><span>${esc(p.name)} <small class="muted">${p.provisional?'PROVISIONAL':''} · ${p.matches} matches</small></span><b>${signed(p.prestige)}</b></div>`).join(''):'<p class="muted small">No decisive matches recorded yet. Results persist on this server.</p>';
}
async function openRoom(id,watch=false){
  generation++;pollController?.abort();review?.destroy();review=null;document.body.classList.remove('reviewing');
  closePanel();closeMenu();spectating=watch;messageCatchupComplete=false;herald.reset();worldFeed.reset();
  resetPresentation();orderMode='march';matchId=id;mapReadyFor=null;state=null;cursor=0;history=[];source=null;destination=null;inspected=null;previewKey='';readMessageId=0;
  document.body.classList.add('in-game');atlas.world();
  $('home').hidden=true;$('game').hidden=false;$('result').hidden=true;
  const url=new URL(location);url.searchParams.set('match',id);if(watch)url.searchParams.set('spectate','1');else url.searchParams.delete('spectate');url.hash='';window.history.replaceState({},'',url);
  const epoch=generation,loaded=await request(`/api/games/${id}/map`,'GET',undefined,watch?null:identity?.token);
  if(epoch!==generation || matchId!==id)return;
  map=loaded;initMap();attackSelections.clear();plannedDestination=null;mapReadyFor=id;
  await poll();
}
async function poll(){
  if(!matchId || mapReadyFor!==matchId || state?.status==='finished' && review?.id===matchId)return;
  const epoch=generation,room=matchId;
  if(polling===epoch)return;
  polling=epoch;const controller=new AbortController();pollController=controller;
  try {
    const liveDeclarations=[],live=messageCatchupComplete;
    for(let page=0;page<10;page++) {
      const response=await fetch(`/api/games/${room}?after=${cursor}`,{headers:!spectating && identity?.token?{Authorization:`Bearer ${identity.token}`}:{},signal:controller.signal});
      const next=await response.json();
      if(epoch!==generation || room!==matchId)return;
      if(!response.ok)throw new Error(next.error || 'Unable to observe this room.');
      if(messageCatchupComplete)liveDeclarations.push(...next.events);
      state=next;cursor=next.cursor;history.push(...next.events);
      if(!next.hasMore)break;
    }
    if(!state.hasMore)messageCatchupComplete=true;
    announce(liveDeclarations);sounds.update(state,liveDeclarations,live);
    setConnection(state.status==='finished'?'Review':'Live');render();renderFeed(live);
  }catch(e){if(e.name!=='AbortError' && epoch===generation){setConnection('Reconnecting');toast(e.message,true);}}
  finally{if(polling===epoch)polling=false;}
}
async function command(action){
  if(!matchId || pendingCommand || spectating || !state?.you)return null;
  pendingCommand=true;const epoch=generation,room=matchId;
  const payload={opId:operationId(),action};
  if(state)renderOrders();
  try {
    let result;
    // A transport failure can be retried with exactly the same operation ID.
    // A rules error is never retried, and changing identities invalidates this request.
    try{result=await request(`/api/games/${room}/actions`,'POST',payload);}
    catch(error){if(error.status || epoch!==generation)throw error;result=await request(`/api/games/${room}/actions`,'POST',payload);}
    if(epoch!==generation)return null;
    sounds.order(action);await poll();return result;
  }finally{pendingCommand=false;if(epoch===generation && state)renderOrders();}
}
const safely=fn=>async event=>{if(event?.type==='submit')event.preventDefault();try{await fn(event);}catch(e){toast(e.message,true);}};
function initMap(){
  $('faction-parade').innerHTML=map.countries.map(c=>`<span>${insignia(c.id)}<b>${esc(faction(c.id).short)}</b></span>`).join('');
  $('faction-choices').innerHTML=map.countries.map(c=>`<button type="button" data-country-seat="${c.id}" aria-pressed="false">${insignia(c.id)}<b>${esc(faction(c.id).short)}</b><small>${c.start.length} holdings</small></button>`).join('');
  $('scoreboard').innerHTML=map.countries.map(c=>`<button type="button" class="country-card" data-country-focus="${c.id}" style="--country:${c.color}"></button>`).join('');
  atlas?.destroy();
  const previous=$('map'),replacement=previous.cloneNode(false);previous.replaceWith(replacement);
  // The atlas key (legend + Political/Diplomacy toggle) mounts in the camera cluster, beside the buttons.
  atlas=new Atlas(replacement,map,selectProvince,{legend:{placement:'bottom-left',container:$('map-key'),collapsed:compactScreen.matches}});
  $('landing-map').innerHTML=map.provinces.map(p=>`<path d="${p.path}"/>`).join('');
}
/** Screen insets (px) covered by the HUD, rail and open panel, so a camera move can centre the target in the
 * map area that is actually visible. Passed as an optional trailing argument; the atlas may ignore it. */
function view(){
  const stage=$('stage').getBoundingClientRect(),box=sel=>{const e=document.querySelector(sel);return e?.checkVisibility()?e.getBoundingClientRect():null;};
  const hud=box('.hud-bar'),rail=box('.right-rail') || box('#world-feed:not(.collapsed)'),panel=box('#command-panel'),nav=box('#hud-rail');
  const bottom=Math.max(nav && nav.top>stage.height/2?stage.bottom-nav.top:0,panel && panel.width>stage.width*.8?stage.bottom-panel.top:0);
  return {insets:{top:hud?hud.bottom-stage.top:0,right:rail && rail.left>stage.width/2?stage.right-rail.left:0,
    left:panel && panel.width<=stage.width*.8?panel.right-stage.left:0,bottom}};
}
function focusCountry(){if(state?.you)atlas.home(state.you,view());}
function selectProvince(id,modifiers={}){
  if(!state)return;
  const p=state.provinces.find(p=>p.id===id);inspected=id;
  const own=p.owner===state.you && state.you;
  if(own && (modifiers.shiftKey || !source || source===id)){
    source=source===id && !modifiers.shiftKey?null:id;destination=null;
    if(source)$('amount').value=Math.max(1,Math.floor(availableTroops()/2));
  }else if(source && place(source).neighbors.includes(id))destination=id;
  else if(own){source=id;destination=null;$('amount').value=Math.max(1,Math.floor(availableTroops()/2));}
  // The map is the selector: a province click opens its context panel (never in the lobby).
  if(state.status==='running')openPanel('orders');
  renderOrders();paintMap();$('orders-tab').scrollTop=0;
}
function availableTroops(){
  const p=state?.provinces.find(p=>p.id===source);
  const reserved=state?.commandBudget?.reserved.filter(o=>['move','develop'].includes(o.type) && o.from===source).reduce((n,o)=>n+o.amount,0) || 0;
  return Math.max(0,(p?.troops || 0)-reserved-1);
}
function paintMap(){
  if(!state)return;atlas.update(state,source,destination);
}
function closeMenu(focus=false){
  if($('hud-menu').hidden)return;
  $('hud-menu').hidden=true;$('menu-button').setAttribute('aria-expanded','false');if(focus)$('menu-button').focus();
}
function openMenu(){$('hud-menu').hidden=false;$('menu-button').setAttribute('aria-expanded','true');$('hud-menu').querySelector('button').focus();}
const SHEETS=['peek','half','full'];
function setSheet(size){
  const panel=$('command-panel');panel.dataset.sheet=size;panel.style.height='';
  const next=SHEETS[(SHEETS.indexOf(size)+1)%SHEETS.length];
  $('sheet-handle').setAttribute('aria-label',`Panel size: ${size}. Press to ${next==='peek'?'collapse':'expand'}; arrow keys resize.`);
}
function syncPanelButtons(){
  for(const button of document.querySelectorAll('#hud-rail [data-tab]'))button.setAttribute('aria-expanded',String(panelOpen && tab===button.dataset.tab));
}
/** Open the command panel on `name`. `focus` moves focus into it (HUD buttons); map clicks never steal focus. */
function openPanel(name,{focus=false,size}={}){
  const panel=$('command-panel'),wasOpen=panelOpen;
  if(focus && !panel.contains(document.activeElement))panelOpener=document.activeElement;
  if(tab!==name)$(`${name}-tab`).scrollTop=0;
  tab=name;panelOpen=true;panel.hidden=false;panel.dataset.tab=name;
  for(const current of ['orders','council','dispatches'])$(`${current}-tab`).hidden=current!==name;
  // Diplomacy reads best tall; a map selection starts as a peek so the map stays visible.
  setSheet(size || (name==='orders'?(wasOpen?panel.dataset.sheet:state?.you?'peek':'half'):'full'));
  syncPanelButtons();
  if(state){renderPanelTitle();renderChat();renderCommandFooter();}
  if(focus)$('panel-title').focus();
}
function closePanel({restoreFocus=false}={}){
  const panel=$('command-panel'),inside=panel.contains(document.activeElement);
  if(!panelOpen)return;
  panelOpen=false;panel.hidden=true;syncPanelButtons();
  if(tab==='orders'){source=null;destination=null;inspected=null;if(state){renderOrders();paintMap();}}
  if((restoreFocus || inside) && panelOpener?.isConnected && panelOpener.checkVisibility())panelOpener.focus();
  panelOpener=null;
}
function togglePanel(name){if(panelOpen && tab===name)closePanel({restoreFocus:true});else openPanel(name,{focus:true,size:name==='orders'?'half':undefined});}
function renderPanelTitle(){
  $('panel-title').textContent=tab==='council'?'Council':tab==='dispatches'?'Dispatches':place(source || inspected)?.name || 'Orders';
}
function renderOrders(){
  const scroll=$('orders-tab').scrollTop;
  const mode=orderMode;
  $('command-panel').dataset.orderMode=mode;
  $('order-modes').hidden=false;
  for(const button of document.querySelectorAll('[data-order-mode]'))button.setAttribute('aria-pressed',String(button.dataset.orderMode===mode));
  const owned=state.provinces.filter(p=>p.owner===state.you && state.you);
  if(source && !owned.some(p=>p.id===source)){source=null;destination=null;}
  options('source',[{value:'',label:owned.length?'Choose your province…':'No controlled provinces'},...owned.map(p=>({value:p.id,label:`${place(p.id).name} · ${p.troops} troops`}))],source || '');
  const neighbors=source?place(source).neighbors:[];
  if(destination && !neighbors.includes(destination))destination=null;
  options('destination',[{value:'',label:'Choose a connected destination…'},...neighbors.map(id=>{const p=state.provinces.find(p=>p.id===id);return{value:id,label:`${place(id).name} · ${p.troops} · ${country(p.owner)?.name || 'Neutral'}`};})],destination || '');
  $('commander-title').textContent=country(state.you)?.name || 'Observer';
  setHTML($('commander-insignia'),insignia(state.you));
  renderPanelTitle();
  const active=state.status==='running' && myPlayer()?.eliminatedAt===null;
  const available=availableTroops(),amount=Number($('amount').value),valid=Number.isSafeInteger(amount) && amount>0 && amount<=available;
  const recovery=state.commandBudget?.nextRecoveryAt;
  $('budget').textContent=state.commandBudget?`${state.commandBudget.remaining}/3 commands available${recovery!==null && recovery!==undefined?` · next in ${Math.max(0,recovery-state.tick)}s`:''}`:'Join a country in the lobby to play.';
  const canCommand=active && source && !pendingCommand && state.commandBudget?.remaining>0;
  const destinationOwner=state.provinces.find(p=>p.id===destination)?.owner;
  $('send-army').disabled=!canCommand || !destination || !valid || !mayEnter(state.you,destinationOwner);
  $('send-army').textContent=pendingCommand?'Sending order…':valid && destination?`Commit ${amount} troops →`:'Commit army →';
  $('amount').max=available;$('amount-slider').max=Math.max(1,available);$('amount-slider').value=Math.min(amount,Math.max(1,available));
  $('amount-slider').disabled=!source || available===0;
  for(const button of document.querySelectorAll('[data-fraction]'))button.disabled=!source || available===0;
  const p=state.provinces.find(p=>p.id===source),target=state.provinces.find(p=>p.id===destination);
  const friend=target?.owner && state.players.find(x=>x.id===target.owner)?.side===myPlayer()?.side;
  $('set-route').disabled=!canCommand || !friend || p?.route===destination;
  $('clear-route').disabled=!canCommand || !p?.route;
  $('route-status').textContent=p?.route?`New recruits → ${place(p.route).name}. ${available} uncommitted troops remain here.`:'No local recruitment arrow set.';
  const reserves=(state.insights?.routeReserves || []).filter(v=>v.available>=10).sort((a,b)=>b.available-a.available).slice(0,3);
  setHTML($('route-reserves'), reserves.length?`<div class="route-reserve-note"><b>Reserves staying at arrow sources</b>${reserves.map(v=>`<p>${esc(place(v.province).name)}: ${v.available} available, not automatically forwarded.<br><button data-reserve-from="${v.province}" data-reserve-to="${v.to}">Draft transfer → ${esc(place(v.to).name)}</button></p>`).join('')}<small>A draft does not issue an order. Leave enough troops to defend.</small></div>`:'');
  const inspectedId=destination || inspected || source, waves=state.armies.filter(a=>a.to===inspectedId).sort((a,b)=>a.arrivesAt-b.arrivesAt);
  const previousBattle=history.filter(e=>e.type==='battle' && e.province===inspectedId).at(-1);
  $('incoming-waves').hidden=!inspectedId;
  if(inspectedId){const battle=state.battles?.find(b=>b.province===inspectedId);
    setHTML($('incoming-waves'),`<h3>${esc(place(inspectedId).name)} · incoming waves</h3>${battle?`<p><b>Battle in progress</b> · ${state.armies.filter(a=>a.engaged && a.to===inspectedId).reduce((n,a)=>n+a.amount,0)} attackers against ${state.provinces.find(p=>p.id===inspectedId)?.troops || 0} defenders. Reinforcements and recalls can still change the fight.</p>`:''}${waves.length?waves.slice(0,4).map(a=>`<p>${a.amount} ${esc(country(a.country).name)} · ${a.returning?'returning':'marching'} · arrives ${time(a.arrivesAt)} (${a.arrivesAt-state.tick}s)</p>`).join(''):'<p>No armies committed to this destination.</p>'}${waves.length>4?`<p>Plus ${waves.length-4} later armies.</p>`:''}${previousBattle?`<p>Last battle ${time(previousBattle.tick)}: ${previousBattle.troops} survivors; ${esc(country(previousBattle.owner)?.name || 'neutral')} held afterward.</p>`:''}`);}
  const inspectedProvince=state.provinces.find(p=>p.id===(inspected || source));
  setHTML($('province-readout'),p?`<div><span>AVAILABLE</span><strong>${available}</strong></div><div><span>GARRISON</span><strong>${p.troops}</strong></div><div><span>RECRUIT IN</span><strong>${p.nextRecruit===null?'—':Math.max(0,p.nextRecruit-state.tick)+'s'}</strong></div>`:inspectedProvince?`<p><b>${esc(place(inspectedProvince.id).name)}</b><br>${esc(country(inspectedProvince.owner)?.name || 'Uncontrolled')} · ${inspectedProvince.troops} troops</p>`:'<p><b>Your next decision starts on the map.</b><br>Select a province you own, then a neighboring target. Nothing moves until you commit.</p>');
  renderRelationBanner();
  renderDevelopment(p,canCommand);
  renderCoordination(owned,active);
  renderTransit(active);
  renderMarches(active);
  renderCommandFooter();
  if(mode==='march')updatePreview();
  $('orders-tab').scrollTop=scroll;
}
function freeTroops(id) {
  const p=state.provinces.find(p=>p.id===id);
  const reserved=(state.commandBudget?.reserved || []).filter(o=>o.from===id && ['move','transit','develop'].includes(o.type)).reduce((n,o)=>n+o.amount,0);
  return Math.max(0,(p?.troops || 0)-reserved-1);
}
function renderTransit(active){
  const sourceProvince=state.provinces.find(p=>p.id===source);
  const vias=sourceProvince && myPlayer()?.side ? map.provinces.find(p=>p.id===source)?.neighbors.filter(id=>{
    const owner=state.provinces.find(p=>p.id===id)?.owner;
    return owner && owner!==state.you && state.players.find(p=>p.id===owner)?.side===myPlayer().side;
  }) || [] : [];
  $('transit-panel').hidden=orderMode!=='march' || !vias.length || !active;
  if($('transit-panel').hidden)return;
  options('transit-via',vias.map(id=>({value:id,label:place(id).name})),$('transit-via').value);
  const via=$('transit-via').value;
  const destinations=(map.provinces.find(p=>p.id===via)?.neighbors || []).filter(id=>id!==source && mayEnter(state.you,state.provinces.find(p=>p.id===id)?.owner));
  options('transit-to',destinations.map(id=>({value:id,label:`${place(id).name} · ${country(state.provinces.find(p=>p.id===id)?.owner)?.name || 'Neutral'}`})),$('transit-to').value);
  const amount=Number($('transit-amount').value);
  $('transit-send').disabled=!destinations.length || pendingCommand || !state.commandBudget?.remaining || !Number.isSafeInteger(amount) || amount<1 || amount>freeTroops(source);
}
function renderDevelopment(p,canCommand) {
  const panel=$('development-panel');panel.hidden=orderMode!=='develop' || !p;
  if(panel.hidden)return;
  const level=p.development,cost=state.rules.developmentCosts[level],duration=state.rules.developmentTicks[level];
  $('industry-level').textContent=`Industry ${'ⅠⅡⅢ'[level-1]} · ${level*60/state.rules.recruit} recruits / min`;
  const queued=state.commandBudget?.reserved.some(o=>o.type==='develop' && o.from===p.id);
  $('development-status').textContent=p.developing?`Level ${p.developing.level} completes in ${Math.max(0,p.developing.completesAt-state.tick)} game seconds. Capture destroys unfinished work.`:
    queued?'Investment reserved; construction starts next tick.':level===state.rules.maxDevelopment?'Fully developed. Completed industry passes to whoever captures this province.':
    `Invest ${cost} local manpower; build for ${duration}s. Gain +1 recruit every ${state.rules.recruit}s. No second currency.`;
  const forecast=developmentForecast(state,p.id);
  $('development-payback').hidden=!forecast;
  if(forecast)$('development-payback').textContent=`${forecast.alreadyInvested?'Investment already spent. ':''}Earliest manpower payback: ${time(forecast.paybackAt)} game time (${time(forecast.secondsToPayback)} from now). Up to ${forecast.additionalRecruits} extra recruits by 30:00; net ${signed(forecast.netBeforeDeadline)} after this upgrade’s cost. ${forecast.paysBackBeforeDeadline?'':'This will not repay before the deadline. '}${forecast.assumption}`;
  $('develop-province').hidden=level===state.rules.maxDevelopment;
  $('develop-province').disabled=!canCommand || queued || Boolean(p.developing) || freeTroops(p.id)<cost;
  $('develop-province').textContent=`Develop · ${cost ?? 0} manpower`;
}
function renderCoordination(owned,active) {
  const panel=$('coordination-panel');panel.hidden=orderMode!=='coordinate';
  if(panel.hidden)return;
  if(plannedDestination!==destination){$('attack-plan').textContent='';attackSelections.clear();plannedDestination=destination;if(source)attackSelections.set(source,{percent:Number($('group-percent').value)});}
  const donors=destination?owned.filter(p=>place(p.id).neighbors.includes(destination)):[];
  for(const id of attackSelections.keys())if(!donors.some(p=>p.id===id))attackSelections.delete(id);
  $('coordinate-target').textContent=destination?`Target: ${place(destination).name}`:'Choose a target in the Orders controls first.';
  const editing=document.activeElement?.closest('#attack-sources');
  if(!editing)setHTML($('attack-sources'),donors.map(p=>{
    const selection=attackSelections.get(p.id),available=freeTroops(p.id),amount=selection?.amount ?? Math.floor(available*(selection?.percent ?? Number($('group-percent').value))/100);
    return `<div class="attack-source"><label><input type="checkbox" data-attack-source="${p.id}" ${selection?'checked':''}><span>${esc(place(p.id).name)}<small>${available} available · ${state.travelTimes[p.id][destination]}s travel</small></span></label><input type="number" data-attack-amount="${p.id}" value="${amount}" min="1" max="${available}" aria-label="Troops from ${esc(place(p.id).name)}" ${selection?'':'disabled'}></div>`;
  }).join('') || '<p class="small muted">No connected source provinces selected.</p>');
  const selected=[...attackSelections].filter(([id])=>donors.some(p=>p.id===id));
  const maxTravel=selected.length?Math.max(...selected.map(([id])=>state.travelTimes[id][destination])):0;
  const earliest=state.tick+1+maxTravel;
  const total=selected.reduce((n,[id,value])=>n+(value.amount ?? Math.floor(freeTroops(id)*value.percent/100)),0);
  const warBlocked=destination && !mayEnter(state.you,state.provinces.find(p=>p.id===destination)?.owner);
  $('attack-summary').textContent=warBlocked?'Declare war in the Council before attacking this country.':selected.length?`${selected.length} sources · ${total} troops · earliest arrival ${time(earliest)}. Nearby sources wait before dispatch. Waiting troops remain vulnerable at home.`:'Choose the provinces that will take part.';
  const valid=selected.every(([id,value])=>{const amount=value.amount ?? Math.floor(freeTroops(id)*value.percent/100);return Number.isSafeInteger(amount)&&amount>0&&amount<=freeTroops(id);});
  if(selected.length && !valid)$('attack-summary').textContent='Each selected source needs a positive, available troop amount. Adjust the draft or uncheck that source.';
  $('coordinate-commit').disabled=!active || !selected.length || !valid || warBlocked || pendingCommand || !state.commandBudget?.remaining;
  $('coordinate-preview').disabled=!active || !selected.length || warBlocked || pendingCommand;
}
function attackAction() {
  const sources=[...attackSelections].map(([from,amount])=>({from,...amount}));
  const requested=$('shared-arrival').value.trim();let arriveAt;
  if(requested){
    if(!/^\d{1,2}:\d{2}$/.test(requested))throw new Error('Use game-clock MM:SS for a shared arrival, or leave it blank.');
    const [minutes,seconds]=requested.split(':').map(Number);if(seconds>59)throw new Error('Seconds must be 00–59.');
    arriveAt=minutes*60+seconds;
  }
  return {type:'attack',to:destination,sources,...(arriveAt!==undefined?{arriveAt}:{})};
}
function renderMarches(active) {
  const canRecall=active && !pendingCommand && state.commandBudget?.remaining;
  const moving=state.armies.filter(a=>a.country===state.you).sort((a,b)=>a.arrivesAt-b.arrivesAt);
  const reserved=state.commandBudget?.reserved || [];
  const recallButton=(id,label)=>`<button type="button" data-recall="${id}" ${canRecall?'':'disabled'}>${label}</button>`;
  const queued=reserved.map(o=>`<div class="march-row"><span>${o.type==='recall'?'Recall queued':o.type==='develop'?'Construction queued':`${o.amount || ''} · ${esc(place(o.from)?.name || '')}`}<small>${o.executeAt-state.tick}s until ${o.type==='move'?'departure':'execution'}</small></span>${o.type==='move'?recallButton(o.id,'Cancel'):''}</div>`).join('');
  const groups=[...new Set([...moving,...reserved].filter(a=>a.groupId&&!a.returning).map(a=>a.groupId))];
  const groupControls=groups.filter(id=>[...moving,...reserved].filter(a=>a.groupId===id&&!a.returning).length>1).map(id=>`<div class="march-row"><span>Coordinated attack<small>${esc(id)}</small></span>${recallButton(id,'Recall group')}</div>`).join('');
  const marches=moving.map(a=>`<div class="march-row ${a.returning?'returning':''}"><button class="march-focus" data-focus="${a.to}"><b>${a.amount}</b> ${a.returning?'↶':'→'} ${esc(place(a.to).name)}<small>${a.returning?'Returning · ':''}arrives ${time(a.arrivesAt)} · ${Math.max(0,a.arrivesAt-state.tick)}s</small></button>${!a.returning?recallButton(a.id,'Recall'):''}</div>`).join('');
  setHTML($('march-list'),queued || marches?`<h3>Committed orders <span>${moving.length+reserved.length}</span></h3><div class="march-scroll">${groupControls}${queued}${marches}</div><p class="small muted">Recall turns an army around next tick. The return trip is not instant; a captured home must be retaken.</p>`:'');
}
async function updatePreview(){
  if(!source || !destination || !state){previewKey='';previewVersion++;$('preview').textContent='Select a source and destination to see the current-garrison result.';return;}
  const amount=Number($('amount').value),key=[matchId,state.tick,source,destination,amount].join('|');
  if(key===previewKey)return;previewKey=key;const version=++previewVersion,epoch=generation;
  try{
    const result=await request(`/api/games/${matchId}/preview?from=${source}&to=${destination}&amount=${amount}`);
    if(key!==previewKey || version!==previewVersion || epoch!==generation)return;
    $('preview').innerHTML=`${esc(result.summary)}<small>${result.remaining} uncommitted troops stay home · ${result.travelTicks}s travel · arrives ${time(result.arrivesAt)}${result.reserved?` · ${result.reserved} already reserved`:''}. ${result.incoming.length} known incoming armies. Future orders and recruitment can change the result.</small>`;
  }catch(e){if(key===previewKey && version===previewVersion && epoch===generation)$('preview').textContent=e.message;}
}
function forecastHTML(f) {
  return `<div class="coalition-forecast"><strong>${f.economy}/${f.totalEconomy} industry (${f.threshold} for victory) after admission</strong><br>${f.wouldDraw?'Every starting player: negotiated draw, not a win.':f.wouldStartHold?`Already above the threshold. Activation would start a fresh ${state.rules.hold}s victory hold.`:`${f.remaining} more industry needed to start the victory hold.`}<table><caption class="sr-only">Each member’s new prize share</caption><tbody>${f.members.map(p=>`<tr><td>${esc(country(p.country).name)}<br>${p.keepsMaturity?'Keeps earned tenure':'Maturity resets'}</td><td>${p.maximumShare.toFixed(1)} maximum points<br>${signed(p.fullMaturityPrestige)} Prestige at full maturity</td></tr>`).join('')}</tbody></table><small>${esc(f.assumption)}</small></div>`;
}
function renderCouncil(){
  const me=myPlayer(),team=state.sides.find(s=>s.id===me?.side),projection=state.projections.find(p=>p.country===state.you);
  $('coalition-info').innerHTML=me?`<p><b>${esc(namedSide(me.side))}</b></p>${team.members.map(id=>{const p=state.projections.find(p=>p.country===id);return`<div class="coalition-member"><span>${esc(country(id).name)}</span><span>${Math.round(p.maturity*100)}% earned<br><small>${signed(p.projectedPrestige)} if victorious</small></span></div>`;}).join('')}<p class="small muted">Maximum slice: ${projection.maximumShare.toFixed(1)} points. Unearned points disappear; they are not redistributed.</p>`:'<p class="muted">Observers cannot negotiate formal membership.</p>';
  const independent=state.players.filter(p=>p.id!==state.you && p.eliminatedAt===null && p.side.startsWith('solo:'));
  options('ally-choice',independent.map(p=>({value:p.id,label:`${country(p.id).name} · ${p.name}`})),$('ally-choice').value);
  $('alliance-form').hidden=!me || me.eliminatedAt!==null || !independent.length;
  const candidate=$('ally-choice').value;
  setHTML($('admission-cost'),me && candidate?forecastHTML(coalitionForecast(state,[...team.members,candidate],me.side.startsWith('solo:')?null:me.side)):'');
  $('leave-alliance').hidden=!me || me.side.startsWith('solo:') || me.eliminatedAt!==null;
  const awaiting=(state.diplomacy || []).filter(m=>m.status==='voting' && m.fromRoster.includes(state.you) && !m.fromYes.includes(state.you) ||
    m.status==='offered' && m.toRoster.includes(state.you) && !m.toYes.includes(state.you)).length;
  const matters=state.proposals.filter(q=>q.status==='open' && q.roster.includes(state.you) && !q.accepted.includes(state.you)).length+awaiting;
  $('offer-count').textContent=matters || '';
  // CK3-style alert: pending proposals and war/peace motions wait for this player's vote.
  const alert=$('council-alert');alert.hidden=!matters || state.status!=='running' || panelOpen && tab==='council';
  if(!alert.hidden)setHTML(alert,`${icon('council')}<span>${matters} council ${matters===1?'matter awaits':'matters await'} your vote</span>`);
  const offerHTML=state.proposals.filter(q=>q.roster.includes(state.you) || q.status==='pending').map(q=>{
    const voters=q.roster.filter(id=>state.players.find(p=>p.id===id).eliminatedAt===null);
    const slice=100*state.players.length/q.roster.length;
    return `<div class="offer"><strong>${esc(q.name)}</strong><p>${q.roster.map(id=>esc(country(id).name)).join(' + ')}</p><p class="offer-terms">${q.roster.length===state.players.length?'All players joining means a draw, not a win.':`Maximum slice: ${slice.toFixed(1)} points each. New membership starts at 0% earned.`}</p>${forecastHTML(coalitionForecast(state,q.roster,q.coalition,q.activateAt ?? state.tick+state.rules.notice))}<small>${q.status==='pending'?`Active in ${q.activateAt-state.tick}s`:`${q.accepted.length}/${voters.length} approvals · expires in ${q.expiresAt-state.tick}s`}</small>${q.status==='open' && q.roster.includes(state.you)?`<div class="button-row">${!q.accepted.includes(state.you)?`<button class="primary" data-accept="${esc(q.id)}">Accept terms</button>`:''}<button data-decline="${esc(q.id)}">${q.creator===state.you?'Withdraw':'Decline'}</button></div>`:''}</div>`;
  }).join('')+state.departures.map(d=>`<p class="notice">${esc(country(d.country).name)} leaves in ${d.activateAt-state.tick}s.</p>`).join('');
  setHTML($('offers'),offerHTML);
  const opponents=state.players.filter(p=>p.id!==state.you && p.eliminatedAt===null && p.side!==me?.side);
  options('diplomacy-target',opponents.map(p=>({value:p.id,label:country(p.id).name})),$('diplomacy-target').value);
  const opponent=$('diplomacy-target').value,war=atWar(state.you,opponent);
  $('declare-war').disabled=!me || me.eliminatedAt!==null || state.status!=='running' || !opponent || war || pendingCommand;
  $('offer-peace').disabled=!me || me.eliminatedAt!==null || state.status!=='running' || !opponent || !war || pendingCommand;
  $('war-status').innerHTML=me?`<p class="small">${opponents.filter(p=>atWar(state.you,p.id)).length?`At war with ${opponents.filter(p=>atWar(state.you,p.id)).map(p=>esc(country(p.id).name)).join(', ')}.`:'Your side is at peace.'}</p>`:'<p class="small muted">Join a country to negotiate war and peace.</p>';
  const motions=(state.diplomacy || []).map(m=>{
    const from=m.fromRoster.map(id=>country(id)?.name||id).join(' + '),to=m.toRoster.map(id=>country(id)?.name||id).join(' + ');
    const source=m.status==='voting' && m.fromRoster.includes(state.you),target=m.status==='offered' && m.toRoster.includes(state.you);
    const roster=source?m.fromRoster:m.toRoster,yes=source?m.fromYes:m.toYes;
    const need=Math.floor(roster.filter(id=>state.players.find(p=>p.id===id)?.eliminatedAt===null).length/2)+1;
    const label=m.kind==='war'?'War declaration':'Peace treaty';
    return `<article class="diplomacy-motion"><strong>${label}</strong><p>${esc(from)} → ${esc(to)}</p><small>${m.status==='voting'?'Coalition vote':'Awaiting treaty acceptance'} · ${yes.length}/${need} approvals · ${Math.max(0,m.expiresAt-state.tick)}s left</small>${(source||target)&&!yes.includes(state.you)?`<button class="primary" data-vote-${m.kind}="${esc(m.id)}">${m.kind==='war'?'Approve declaration':'Accept peace'}</button>`:''}</article>`;
  }).join('');
  setHTML($('diplomacy-motions'),motions);
}
/** DOM helper for new relation UI: player text (alliance names) only ever reaches textContent. */
function el(tag,className,text){const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e;}
function standards(ids){const span=el('span','chip-flags');span.innerHTML=ids.slice(0,3).map(insignia).join('');if(ids.length>3)span.append(el('small','',`+${ids.length-3}`));return span;} // authored SVG only
const allianceOf=id=>{const side=state.players.find(p=>p.id===id)?.side;return side && !side.startsWith('solo:')?state.sides.find(s=>s.id===side):null;};
const formingOf=id=>(state.proposals || []).find(q=>q.status==='pending' && q.roster.includes(id));
/** HUD: who is with you (alliance colour) and who you are at war with, visible without opening anything. */
function renderRelations(){
  const me=myPlayer(),ally=$('ally-chip'),war=$('war-chip'),running=state.status==='running';
  ally.hidden=!me || !running;war.hidden=!running;
  const key=JSON.stringify([state.you,state.sides,state.wars,(state.proposals || []).filter(q=>q.status==='pending').map(q=>[q.id,q.roster,q.name,q.activateAt]),state.rules.warRequired]);
  if(war.dataset.key===key)return;war.dataset.key=key;
  if(me){
    const alliance=allianceOf(me.id),forming=!alliance && formingOf(me.id);
    const members=(alliance?alliance.members:forming?forming.roster:[]).filter(id=>id!==me.id);
    const colors=allianceColors(state),color=alliance?colors[alliance.id]:forming?colors[forming.id]:null;
    ally.dataset.state=alliance?'active':forming?'forming':'independent';ally.dataset.allies=members.join(',');
    if(color)ally.style.setProperty('--band',color);else ally.style.removeProperty('--band');
    ally.replaceChildren(el('span','chip-label',alliance?'Allied':forming?'Forming':'Independent'),...(members.length?[standards(members)]:[]),...(alliance || forming?[el('small','chip-name',(alliance || forming).name)]:[]));
    ally.setAttribute('aria-label',alliance?`Allied in ${alliance.name} with ${members.map(id=>country(id).name).join(', ')}. Open the Council.`:forming?`Forming ${forming.name} with ${members.map(id=>country(id).name).join(', ')}; active in ${Math.max(0,forming.activateAt-state.tick)} game seconds. Open the Council.`:'Independent: no allies. Open the Council.');
  }
  const enemies=me?relationsOf(state,me.id).enemies:[],fronts=warsOf(state);
  war.dataset.state=me?(enemies.length?'war':'peace'):(fronts.length?'war':'peace');war.dataset.enemies=enemies.join(',');
  // Legacy rooms have no declarations: every non-ally is hostile (relations.js, like the engine).
  const openRoom=!state.rules.warRequired;
  const label=me?(enemies.length?(openRoom?'Open war':'At war'):'At peace'):openRoom?'Open war':fronts.length?`${fronts.length} ${fronts.length===1?'war':'wars'}`:'No wars';
  war.replaceChildren(el('span','chip-swords',enemies.length || !me && (fronts.length || openRoom)?'⚔':'☮'),el('span','chip-label',label),...(enemies.length?[standards(enemies)]:[]));
  war.setAttribute('aria-label',`${me && enemies.length?`At war with ${enemies.map(id=>country(id).name).join(', ')}`:label}${openRoom?' (this room needs no declaration to attack)':''}. Open the list of wars.`);
}
/** Council → Wars: every active war as side ⚔ side, with its start and your involvement. */
function renderWars(){
  const fronts=warsOf(state),list=$('war-list');
  const key=JSON.stringify([fronts,state.you,history.length && history.filter(e=>e.type==='war_declared').length]);
  if(list.dataset.key===key)return;list.dataset.key=key;
  const declared=history.filter(e=>e.type==='war_declared');
  const sideText=s=>s.name || s.countries.map(id=>country(id)?.name || id).join(' + ');
  list.replaceChildren(...fronts.map(f=>{
    const [a,b]=f.sides,li=el('li','war-front'),button=el('button','war-front-button');button.type='button';
    button.dataset.frontA=a.countries.join(',');button.dataset.frontB=b.countries.join(',');button.dataset.pairs=f.pairs.map(pair=>pair.join(':')).join(' ');
    const since=f.pairs.map(([x,y])=>declared.filter(e=>e.fromRoster.includes(x) && e.toRoster.includes(y) || e.fromRoster.includes(y) && e.toRoster.includes(x)).at(-1)?.tick).filter(t=>t!==undefined);
    const involved=state.you && [...a.countries,...b.countries].includes(state.you);
    const side=s=>{const span=el('span','war-side');span.append(standards(s.countries),el('span','war-names',sideText(s)));return span;};
    button.append(side(a),el('b','war-swords','⚔'),side(b));
    const meta=el('small','war-meta',since.length?`since ${time(Math.min(...since))}`:'at war');
    if(involved)meta.append(el('strong','war-you',' · you are involved'));
    button.append(meta);button.title='Show this front on the map';li.append(button);
    if(involved)li.classList.add('involved');return li;
  }));
  if(!fronts.length)list.append(el('li','war-empty',state.rules.warRequired?'No wars: every country is at peace.':'This room needs no declaration: any non-ally may attack.'));
}
/** The selected province's owner relation, in the context card (visible even when peeking). */
function renderRelationBanner(){
  const banner=$('relation-banner'),id=destination || (inspected && inspected!==source?inspected:null) || (!state.you?inspected:null);
  const p=state.provinces.find(v=>v.id===id),owner=p?.owner || null;
  if(!p || owner && owner===state.you){banner.hidden=true;banner.dataset.key='';return;}
  const me=myPlayer(),alliance=owner?allianceOf(owner):null,enemies=me?relationsOf(state,me.id).enemies:[];
  const kind=!me?'watch':!owner?'unclaimed':state.players.find(x=>x.id===owner)?.side===me.side?'ally':enemies.includes(owner)?(state.rules.warRequired?'enemy':'open'):'neutral';
  const [title,detail]={watch:[owner?'OWNER':'UNCLAIMED',''],unclaimed:['UNCLAIMED','No declaration needed to march in.'],ally:['ALLIED','Reinforce or pass through; troops you send become theirs.'],
    enemy:['AT WAR','You can attack.'],neutral:['NEUTRAL','Declare war in the Council before attacking.'],open:['HOSTILE','This room needs no declaration: you can attack.']}[kind];
  const key=JSON.stringify([id,owner,kind,alliance?.id,alliance?.name]);banner.hidden=false;
  if(banner.dataset.key===key)return;banner.dataset.key=key;banner.dataset.relation=kind;
  const dot=el('i','alliance-dot');if(alliance)dot.style.setProperty('--band',allianceColors(state)[alliance.id]);
  const who=el('span','relation-owner',`${place(id).name} · ${owner?country(owner).name:'no owner'}`);
  if(alliance)who.append(' · ',dot,el('span','',alliance.name));
  banner.replaceChildren(el('b','relation-kind',title),...(detail?[el('span','relation-detail',detail)]:[]),who);
  if(kind==='neutral'){const b=el('button','relation-action','War council →');b.type='button';b.dataset.warCouncil=owner;banner.append(b);}
}
function frontProvinces(a,b){
  const left=new Set(a),right=new Set(b),ids=[];
  for(const p of state.provinces){
    if(!left.has(p.owner) && !right.has(p.owner))continue;
    const other=left.has(p.owner)?right:left;
    if(place(p.id).neighbors.some(n=>other.has(state.provinces.find(q=>q.id===n)?.owner)))ids.push(p.id);
  }
  return ids.length?ids:[...a,...b].map(id=>state.provinces.find(p=>p.owner===id)?.id || country(id)?.start[0]).filter(Boolean);
}
function renderChat(){
  const box=$('messages'),atBottom=box.scrollHeight-box.scrollTop-box.clientHeight<40;
  const messages=history.filter(e=>e.type==='message');
  if(panelOpen && tab==='dispatches' && messages.length)readMessageId=Math.max(readMessageId,messages.at(-1).id);
  const signature=`${matchId}:${state.you}:`+messages.map(e=>e.id).join(',');
  if(box.dataset.signature!==signature){box.dataset.signature=signature;box.innerHTML=messages.length?messages.map(m=>`<article class="message"><header><b>${esc(country(m.from)?.name)}</b> · ${time(m.tick)} · ${m.channel==='dm'?`PRIVATE → ${esc(country(m.to)?.name)}`:esc(m.channel.toUpperCase())}</header><p>${esc(m.text)}</p></article>`).join(''):'<p class="muted small">The diplomatic wire is open. Make the first approach.</p>';if(atBottom)box.scrollTop=box.scrollHeight;}
  options('recipient',state.players.filter(p=>p.id!==state.you).map(p=>({value:p.id,label:country(p.id).name})),$('recipient').value);
  const delay=Math.max(0,(state.commandBudget?.chatReadyAt || 0)-state.tick),button=$('chat-form').querySelector('button');
  button.disabled=!state.you || state.status!=='running' || delay>0;button.textContent=delay?`Send in ${delay} game seconds`:'Send dispatch';
  // World speech is counted by the World feed; this badge covers coalition and private wire.
  const unread=messages.filter(m=>m.id>readMessageId && m.channel!=='world').length;
  $('unread').textContent=unread?String(unread):'';
}
function renderScoreboard(){
  for(const c of map.countries){
    const p=state.players.find(p=>p.id===c.id),land=state.provinces.filter(v=>v.owner===c.id),projection=state.projections.find(v=>v.country===c.id);
    const troops=land.reduce((n,v)=>n+v.troops,0)+state.armies.filter(a=>a.country===c.id).reduce((n,a)=>n+a.amount,0);
    const button=$('scoreboard').querySelector(`[data-country-focus="${c.id}"]`);
    button.classList.toggle('mine',c.id===state.you);
    const alliance=p?allianceOf(c.id):null;button.dataset.band=alliance?'active':'';if(alliance)button.style.setProperty('--band',allianceColors(state)[alliance.id]);else button.style.removeProperty('--band');
    button.title=`${c.name} · ${seatType(p)} · ${p?.displayName || p?.name || 'Unclaimed'} · ${p?namedSide(p.side):'Neutral'} · ${land.length} provinces · ${troops} troops${projection?` · ${signed(projection.projectedPrestige)} Prestige if victorious`:''}`;
    button.setAttribute('aria-label',`Inspect ${button.title}`);
    setHTML(button,`${insignia(c.id)}<span class="country-summary"><b>${esc(faction(c.id).short)}</b><span class="country-metrics">${icon('land')}${land.length} ${icon('troops')}${troops}</span><small>${p?`${seatType(p)} · ${esc(p.eliminatedAt!==null?'Eliminated':p.side.startsWith('solo:')?'Independent':namedSide(p.side))}`:'Unclaimed'}</small></span>`);
  }
}
function describe(e){
  const c=id=>country(id)?.name || id;
  switch(e.type){
    case 'joined':return`${e.name} takes ${c(e.country)}.`;
    case 'started':return'The council is in session. Armies may move.';
    case 'army_departed':return`${c(e.country)} commits ${e.amount} troops: ${place(e.from).name} → ${place(e.to).name}.`;
    case 'development_started':return`${c(e.country)} invests ${e.cost} manpower in ${place(e.province).name}; level ${e.level} completes at ${time(e.completesAt)}.`;
    case 'development_completed':return`${place(e.province).name} reaches industrial level ${e.level}.`;
    case 'army_recalled':return`${c(e.country)} recalls ${e.amount} troops; return to ${place(e.to).name} at ${time(e.arrivesAt)}.`;
    case 'army_interned':return`${e.amount} troops from ${c(e.country)} cannot return through ${place(e.province).name}.`;
    case 'battle':return`${place(e.province).name}: ${e.owner!==e.previousOwner?`${c(e.owner)} captures it`:'defenders retain ownership'}; ${e.troops} troops remain.`;
    case 'alliance_notice':return`${e.name}: coalition change confirmed; activates at ${time(e.activateAt)}.`;
    case 'alliance_activated':return`${e.name} is active: ${e.roster.map(c).join(', ')}.`;
    case 'coalition_dissolved':return'An alliance has dissolved.';
    case 'war_declared':return`${e.fromRoster.map(c).join(' + ')} declares war on ${e.toRoster.map(c).join(' + ')}.`;
    case 'peace_accepted':return`${e.fromRoster.map(c).join(' + ')} and ${e.toRoster.map(c).join(' + ')} agree to peace; attacking troops return.`;
    case 'war_vote':return`Your coalition is voting on a war declaration. ${Math.max(0,e.expiresAt-state.tick)}s remain.`;
    case 'peace_vote':return`Your coalition is voting to offer peace. ${Math.max(0,e.expiresAt-state.tick)}s remain.`;
    case 'peace_offered':return`A peace treaty has been offered. ${Math.max(0,e.expiresAt-state.tick)}s remain.`;
    case 'diplomacy_expired':return`A ${e.kind} vote or offer expired.`;
    case 'departure_notice':return`${c(e.country)} announces a departure at ${time(e.activateAt)}.`;
    case 'departed':return`${c(e.country)} is now independent.`;
    case 'eliminated':return`${c(e.country)} is eliminated. Its earned share is frozen.`;
    case 'order_failed':return`Order failed: ${e.reason}`;
    case 'proposal_cancelled':return`Alliance offer cancelled: ${e.reason}`;
    case 'dominance':return`${namedSide(e.side)} begins the victory countdown.`;
    case 'finished':return e.draw?'The match ends in a draw.':`${namedSide(e.winningSide)} wins.`;
    default:return null;
  }
}
function renderResult(){
  if(!state.outcome){$('result').hidden=true;return;}
  $('result').hidden=false;document.body.classList.add('reviewing');placeSound();
  if(!review || review.id!==state.id){review?.destroy();review=new AfterAction($('result'),state,map);}
}
function renderOperations(){
  const me=myPlayer(),team=state.sides.find(s=>s.id===me?.side),projection=state.projections.find(p=>p.country===state.you);
  const land=state.provinces.filter(p=>p.owner===state.you && state.you),leader=[...state.sides].sort((a,b)=>b.economy-a.economy)[0];
  const troops=land.reduce((n,p)=>n+p.troops,0)+state.armies.filter(a=>a.country===state.you).reduce((n,a)=>n+a.amount,0);
  // CK3-style resource bar: icon + value; the label is for assistive technology and the tooltip.
  const stat=(name,label,value,title,extra='',kind='')=>`<span class="stat ${kind}" title="${esc(title)}">${icon(name)}<span class="sr-only">${esc(label)} </span><b>${value}</b>${extra}</span>`;
  const economy=team?.economy || leader?.economy || 0,sideLabel=namedSide(team?.id || leader?.id) || 'No allegiance';
  const holdings=state.you?land.length:state.provinces.filter(p=>p.owner).length,forces=state.you?troops:state.provinces.reduce((n,p)=>n+p.troops,0);
  setHTML($('operations'),stat('land',state.you?'Holdings':'Provinces held',`${holdings}<small>/${state.provinces.length}</small>`,`${state.you?'Your holdings':'Provinces held by all powers'}: ${holdings} of ${state.provinces.length}`)+
    stat('troops',state.you?'Forces':'Troops on the map',forces,state.you?'Your troops: garrisons and armies':'All garrisoned troops')+
    stat('economy',`Industry, ${sideLabel}`,`${economy}<small>/${state.economyThreshold}</small>`,`${team?'Your allegiance':'Economic lead'} ${sideLabel}: ${economy} of ${state.economyThreshold} industry needed to start the victory hold`,`<i class="stat-bar"><i style="width:${Math.min(100,100*economy/Math.max(1,state.economyThreshold))}%"></i></i>`)+
    (projection?stat('prestige','Prestige on win',signed(projection.projectedPrestige),`Prestige if your side wins · ${Math.round(projection.maturity*100)}% earned`,'','prestige'):''));
  $('commander-side').textContent=me?(me.eliminatedAt!==null?'Eliminated':namedSide(me.side)):state.status==='running'?'Watching live':'';
  const stopped=state.dominanceBreaks?.at(-1);
  $('countdown-break').hidden=!stopped || state.tick-stopped.tick>60 || state.status!=='running';
  if(stopped)$('countdown-break').textContent=`${time(stopped.tick)} · ${namedSide(stopped.side)}’s victory countdown stopped. ${stopped.reason} ${stopped.economy}/${stopped.threshold} industry afterward.`;
  const hostile=state.armies.filter(a=>me && state.players.find(p=>p.id===a.country)?.side!==me.side && land.some(p=>p.id===a.to)).sort((a,b)=>a.arrivesAt-b.arrivesAt);
  $('threats').hidden=!hostile.length || state.status!=='running';
  if(hostile.length)setHTML($('threats'),`<span>↘ ${hostile.length} incoming ${hostile.length===1?'army':'armies'}</span>${hostile.slice(0,2).map(a=>`<button data-focus="${a.to}">${a.amount} → ${esc(place(a.to).name)} <b>${a.arrivesAt-state.tick}s</b></button>`).join('')}`);
}
function resetPresentation(){
  signalCursor=null;clearTimeout(signalTimer);clearTimeout(toastTimer);$('toast').hidden=true;$('battle-signal').hidden=true;
  toggleJournal(false);
}
function toggleJournal(open){
  $('war-journal').hidden=!open;$('journal-toggle').setAttribute('aria-expanded',String(open));
}
function renderPresentation(){
  const dominant=Object.entries(state.dominance)[0];
  document.querySelector('.campaign-bar').classList.toggle('victory-warning',Boolean(dominant) && state.status==='running');
  $('victory-status').setAttribute('role','timer');$('victory-status').setAttribute('aria-live','off');
  for(const button of $('faction-choices').querySelectorAll('button')){
    const id=button.dataset.countrySeat,occupied=state.players.some(p=>p.id===id);
    button.disabled=occupied;button.setAttribute('aria-pressed',String($('country-choice').value===id));
    const occupant=state.players.find(p=>p.id===id);button.title=occupant?`${seatType(occupant)} · ${occupant.displayName || occupant.name}`:startingSummary(country(id));
    button.querySelector('small').textContent=occupant?`${seatType(occupant)} · ${occupant.displayName || occupant.name}`:`${country(id).start.length} holdings`;
  }
  const signal=signalCursor===null?null:battleSignal(state,history.filter(e=>e.id>signalCursor));
  signalCursor=cursor;
  if(signal){
    const banner=$('battle-signal');banner.dataset.tone=signal.tone;
    setHTML(banner,`${icon('military')}<div><span>${esc(signal.title)} · ${time(signal.tick)}</span><strong>${esc(place(signal.province).name)}</strong><small>${signal.troops} troops remain after the battle</small></div><button data-focus="${signal.province}">View</button><button data-dismiss-signal aria-label="Dismiss battle notice">×</button>`);
    banner.hidden=false;clearTimeout(signalTimer);signalTimer=setTimeout(()=>{banner.hidden=true;},6000);
  }
}
function renderCommandFooter(){
  const mode=orderMode;
  $('command-footer').hidden=!panelOpen || tab!=='orders' || state.status!=='running' || !state.you;
  $('send-army').hidden=mode!=='march';$('coordinate-commit').hidden=mode!=='coordinate';
  const p=state.provinces.find(p=>p.id===source);
  $('develop-province').hidden=mode!=='develop' || !p || p.development===state.rules.maxDevelopment;
  $('commit-context').textContent=source?`${place(source).name}${destination && mode!=='develop'?' → '+place(destination).name:''}`:'Select a province on the map';
}
/** One sound control: in the HUD during a live room, in the masthead on the home page and in review. */
function placeSound(){
  const slot=matchId && !document.body.classList.contains('reviewing')?$('hud-sound-slot'):$('masthead-sound-slot');
  if($('sound-control').parentElement!==slot)slot.append($('sound-control'));
}
function render(){
  if(!state)return;
  document.body.classList.toggle('spectating',state.status==='running' && !state.you);
  $('spectator-note').hidden=state.status!=='running' || Boolean(state.you);
  document.body.dataset.status=state.status;
  $('orders-label').hidden=state.status!=='running' || !state.you;
  if(state.status!=='running')closePanel();
  renderPresentation();
  document.querySelector('.scenario-note').textContent=map.notice;
  $('game-name').textContent=state.name;$('lobby-room').textContent=state.name;$('room-label').textContent=`COUNCIL ${state.id.toUpperCase()} · ${state.eligible?'LEAGUE':'EXPERIMENTAL'} · ${state.players.length}/8 SEATS`;
  $('lobby').hidden=state.status!=='lobby';$('join-form').hidden=Boolean(state.you);
  options('country-choice',map.countries.filter(c=>!state.players.some(p=>p.id===c.id)).map(c=>({value:c.id,label:c.name})),$('country-choice').value);
  $('host-controls').hidden=!state.isHost;$('fill-bots').disabled=state.players.length===8;$('start-match').disabled=state.players.length<2 || !state.you;
  const selectedCountry=country($('country-choice').value);
  $('starting-holdings').textContent=state.you?'':startingSummary(selectedCountry);
  $('join-form').querySelector('button').disabled=!selectedCountry;
  $('lobby-note').textContent=state.you?`You command ${country(state.you).name}. ${state.isHost?'Invite players, attach agents, or add practice bots. You control when play begins.':'Waiting for the host to start.'}`:'You are observing. Choose an open country above to join.';
  $('phase').textContent=state.status==='lobby'?'ASSEMBLING':state.status==='finished'?'CONCLUDED':state.you?'IN SESSION':'SPECTATING';
  $('clock').textContent=`${time(state.tick)} / 30:00`;$('pace-badge').textContent=state.speed===1?'STANDARD · 1×':`QUICK · ${state.speed}×`;
  const dominant=Object.entries(state.dominance)[0];
  $('victory-status').textContent=dominant && state.status==='running'?`${namedSide(dominant[0])} wins in ${state.rules.hold-(state.tick-dominant[1])}s unless stopped`:`60% of active industry (${state.economyThreshold}) · hold ${state.rules.hold} game seconds`;
  placeSound();
  renderOrders();paintMap();renderCouncil();renderWars();renderRelations();renderChat();renderScoreboard();renderResult();renderOperations();renderLeaderboard();
  $('events').innerHTML=history.map(e=>({e,description:describe(e)})).filter(x=>x.description).slice(-30).reverse().map(({e,description})=>`<div class="event"><time>${time(e.tick)}</time>${esc(description)}</div>`).join('');
}
async function home(){resetPresentation();sounds.leave();review?.destroy();review=null;closePanel();closeMenu();expander.set(false,{fromBrowser:true});document.body.classList.remove('reviewing','spectating');generation++;pollController?.abort();document.body.classList.remove('in-game');matchId=null;state=null;spectating=false;herald.reset();worldFeed.reset();messageCatchupComplete=false;$('home').hidden=false;$('game').hidden=true;window.history.replaceState({},'','/');placeSound();await rooms();}
$('create-form').addEventListener('submit',safely(async()=>{await ensureIdentity($('display-name').value);const g=await request('/api/games','POST',{name:$('room-name').value,preset:$('preset').value});await openRoom(g.id);}));
$('join-form').addEventListener('submit',safely(async()=>{await ensureIdentity($('join-name').value);await request(`/api/games/${matchId}/join`,'POST',{country:$('country-choice').value,kind:'human'});await poll();toast('Your seat is reserved.');}));
$('fill-bots').addEventListener('click',safely(async()=>{await request(`/api/games/${matchId}/bots`,'POST',{});await poll();}));
$('start-match').addEventListener('click',safely(async()=>{await request(`/api/games/${matchId}/start`,'POST',{});await poll();toast('The council is in session.');}));
$('move-form').addEventListener('submit',safely(async()=>{const r=await command({type:'move',from:source,to:destination,amount:Number($('amount').value)});if(!r)return;toast(`Army committed. Departure ${time(r.executeAt)}; arrival ${time(r.arrivesAt ?? r.executeAt+state.rules.travel)}.`);}));
$('source').addEventListener('change',()=>{source=$('source').value || null;destination=null;inspected=source;$('amount').value=Math.max(1,Math.floor(availableTroops()/2));renderOrders();paintMap();});
$('destination').addEventListener('change',()=>{destination=$('destination').value || null;renderOrders();paintMap();});
$('amount').addEventListener('input',()=>{if(state)renderOrders();});
$('amount-slider').addEventListener('input',()=>{$('amount').value=$('amount-slider').value;if(state)renderOrders();});
$('transit-via').addEventListener('change',()=>{if(state)renderTransit(true);});
$('transit-amount').addEventListener('input',()=>{if(state)renderTransit(true);});
$('transit-send').addEventListener('click',safely(async()=>{
  const result=await command({type:'transit',from:source,path:[$('transit-via').value,$('transit-to').value],amount:Number($('transit-amount').value)});
  if(result)toast(`Transit committed. Final arrival ${time(result.arrivesAt)}.`);
}));
$('country-choice').addEventListener('change',()=>{const c=country($('country-choice').value);$('starting-holdings').textContent=startingSummary(c);if(state)renderPresentation();});
$('set-route').addEventListener('click',safely(async()=>{await command({type:'route',from:source,to:destination});toast('Recruitment arrow queued.');}));
$('clear-route').addEventListener('click',safely(async()=>{await command({type:'route',from:source,to:null});toast('Arrow removal queued.');}));
$('ally-choice').addEventListener('change',()=>{if(state)renderCouncil();});
$('alliance-form').querySelector('button').textContent='Offer & approve alliance';
$('alliance-form').addEventListener('submit',safely(async()=>{
  const target=$('ally-choice').value,name=$('coalition-name').value;if(!target)return;
  const candidate=country(target).name,joining=myPlayer()?.side.startsWith('solo:');
  const message=joining?`Sending this offer is your approval to join ${candidate} in ${name}. If they accept, the alliance activates after ${state.rules.notice} game seconds; you will not receive a second approval prompt.`:`Sending this offer is your approval for ${candidate} to join your coalition. Other members and the candidate must also accept. Membership activates after ${state.rules.notice} game seconds; you will not receive a second approval prompt.`;
  if(!await confirmAction({title:`Approve alliance offer to ${candidate}?`,message,accept:'Approve & send offer'}))return;
  await command({type:'propose',country:target,name});toast('Offer delivered. You have approved it; membership changes after all parties accept and the notice expires.');
}));
$('diplomacy-target').addEventListener('change',renderCouncil);
$('declare-war').addEventListener('click',safely(async()=>{
  const target=$('diplomacy-target').value;if(!target)return;
  if(!await confirmAction({title:`Declare war on ${country(target).name}?`,message:'This makes both sides hostile. Coalition members must approve a majority vote within 60 game seconds before the declaration takes effect.',accept:'Declare war'}))return;
  const result=await command({type:'declare_war',country:target});if(result)toast(result.status==='enacted'?'War declared.':'War vote opened for 60 game seconds.');
}));
$('offer-peace').addEventListener('click',safely(async()=>{
  const target=$('diplomacy-target').value;if(!target)return;
  const result=await command({type:'offer_peace',country:target});if(result)toast(result.status==='offered'?'Peace treaty sent.':'Coalition vote to send peace opened.');
}));
$('leave-alliance').addEventListener('click',safely(async()=>{if(!await confirmAction({title:'Leave your coalition?',message:'Departure takes effect after 30 game seconds. Your earned share resets to zero in your new allegiance. Armies use the allegiance in force when they arrive. Recall takes time; it does not restore troops instantly.',accept:'Announce departure'}))return;await command({type:'leave'});toast('Departure announced. Your independent maturity clock restarts on departure.');}));
$('develop-province').addEventListener('click',safely(async()=>{
  const p=state.provinces.find(p=>p.id===source),cost=state.rules.developmentCosts[p.development];
  if(!await confirmAction({title:`Develop ${place(source).name}?`,message:`Spend ${cost} troops from this garrison. ${$('development-payback').textContent} Unfinished construction is lost on capture; completed industry can be captured.`,accept:'Invest manpower'}))return;
  const result=await command({type:'develop',from:source});if(result)toast(`Investment committed. Completion at ${time(result.completesAt)}.`);
}));
$('group-percent').addEventListener('change',()=>{for(const id of attackSelections.keys())attackSelections.set(id,{percent:Number($('group-percent').value)});renderOrders();});
$('attack-sources').addEventListener('change',event=>{
  const id=event.target.dataset.attackSource;
  if(id){if(event.target.checked)attackSelections.set(id,{percent:Number($('group-percent').value)});else attackSelections.delete(id);event.target.blur();renderOrders();}
});
$('attack-sources').addEventListener('input',event=>{const id=event.target.dataset.attackAmount;if(id)attackSelections.set(id,{amount:Number(event.target.value)});});
$('coordinate-preview').addEventListener('click',safely(async()=>{
  const plan=await request(`/api/games/${matchId}/plan`,'POST',attackAction());
  $('attack-plan').textContent=`Shared arrival ${time(plan.arrivesAt)}. `+plan.sources.map(s=>`${place(s.from).name}: ${s.amount} depart ${time(s.executeAt)}`).join(' · ');
}));
$('coordinate-commit').addEventListener('click',safely(async()=>{
  const result=await command(attackAction());if(result){$('attack-plan').textContent=`Accepted ${result.groupId}: all sources arrive ${time(result.arrivesAt)}.`;toast(`Coordinated attack committed for ${time(result.arrivesAt)}.`);}
}));
$('channel').addEventListener('change',()=>{$('recipient-label').hidden=$('channel').value!=='dm';});
$('chat-form').addEventListener('submit',safely(async()=>{await command({type:'chat',channel:$('channel').value,to:$('recipient').value,text:$('chat-text').value});$('chat-text').value='';}));
$('feed-form').addEventListener('submit',safely(async()=>{
  const text=$('feed-text').value;if(!text.trim())return;
  const result=await command({type:'chat',channel:'world',text});if(result)$('feed-text').value='';
}));
$('feed-toggle').addEventListener('click',()=>{
  const open=!worldFeed.open;worldFeed.setOpen(open);
  try{localStorage.setItem('coi.feed',open?'open':'collapsed');}catch{}
});
$('lb-toggle').addEventListener('click',()=>{
  const open=!standings.open;standings.setOpen(open);
  try{localStorage.setItem('coi.leaderboard',open?'open':'collapsed');}catch{}
});
for(const button of document.querySelectorAll('[data-lb-mode]'))button.addEventListener('click',()=>{standings.setMode(button.dataset.lbMode);if(state)renderLeaderboard();});
$('back').addEventListener('click',safely(home));$('refresh-rooms').addEventListener('click',safely(rooms));
for(const button of document.querySelectorAll('[data-share]'))button.addEventListener('click',safely(async()=>{closeMenu();try{await navigator.clipboard.writeText(location.href);toast('Room link copied. It contains no credentials.');}catch{prompt('Copy this room link. It contains no credentials:',location.href);}}));
const changeIdentity=safely(async()=>{closeMenu();const name=prompt('Create a separate local player identity. Existing results stay with the old identity. Enter a new display name:');if(name?.trim()){await ensureIdentity(name,true);if(matchId)await poll();}});
$('account-button').addEventListener('click',changeIdentity);$('menu-identity').addEventListener('click',changeIdentity);
$('zoom-in').onclick=()=>atlas.zoom(.7);$('zoom-out').onclick=()=>atlas.zoom(1.4);
$('world-view').onclick=()=>atlas.world();$('europe-view').onclick=()=>atlas.europe();$('home-view').onclick=focusCountry;
// Expand map: an immersive live map (HUD strip and nav hidden) that also works where the Fullscreen API does
// not (iPhone Safari); real fullscreen of the whole page is requested where available.
expander=new ExpandableMap($('stage'),$('map-expand'),{label:'map',target:document.documentElement,escape:false,onChange:on=>{
  $('fullscreen-toggle').setAttribute('aria-pressed',String(on));$('fullscreen-toggle').textContent=on?'Exit expanded map':'Expand map (full screen)';
  requestAnimationFrame(()=>{atlas?.layout();measureStack();});
}});
$('fullscreen-toggle').addEventListener('click',()=>{closeMenu();expander.toggle();});
$('menu-button').addEventListener('click',()=>{if($('hud-menu').hidden)openMenu();else closeMenu(true);});
$('panel-close').addEventListener('click',()=>closePanel({restoreFocus:true}));
// Bottom sheet (narrow screens): the handle cycles peek → half → full; arrows resize; drag snaps.
$('sheet-handle').addEventListener('click',()=>{if(sheetDrag?.moved)return;const i=SHEETS.indexOf($('command-panel').dataset.sheet);setSheet(SHEETS[(i+1)%SHEETS.length]);});
$('sheet-handle').addEventListener('keydown',event=>{
  const i=SHEETS.indexOf($('command-panel').dataset.sheet);
  if(event.key==='ArrowUp'){event.preventDefault();setSheet(SHEETS[Math.min(2,i+1)]);}
  if(event.key==='ArrowDown'){event.preventDefault();setSheet(SHEETS[Math.max(0,i-1)]);}
});
let sheetDrag=null;
$('command-panel').querySelector('.sheet-head').addEventListener('pointerdown',event=>{
  if(!narrow.matches || event.target.closest('#panel-close,#order-modes'))return;
  const panel=$('command-panel');sheetDrag={y:event.clientY,height:panel.getBoundingClientRect().height,moved:false};
});
$('command-panel').querySelector('.sheet-head').addEventListener('pointermove',event=>{
  if(!sheetDrag)return;const dy=event.clientY-sheetDrag.y;
  // Capture only once it is a drag, so a plain tap still clicks the handle or close button.
  if(!sheetDrag.moved && Math.abs(dy)>6){sheetDrag.moved=true;event.currentTarget.setPointerCapture(event.pointerId);}
  if(sheetDrag.moved)$('command-panel').style.height=`${Math.max(60,sheetDrag.height-dy)}px`;
});
$('command-panel').querySelector('.sheet-head').addEventListener('pointerup',()=>{
  if(!sheetDrag)return;const drag=sheetDrag,panel=$('command-panel');
  if(drag.moved){
    const height=panel.getBoundingClientRect().height,max=parseFloat(getComputedStyle(panel).maxHeight)||innerHeight;
    const peek=panel.querySelector('.sheet-head').offsetHeight+($('command-footer').hidden?0:$('command-footer').offsetHeight);
    if(height<peek*.6)closePanel();
    else setSheet([['peek',peek],['half',max*.5],['full',max]].sort((a,b)=>Math.abs(a[1]-height)-Math.abs(b[1]-height))[0][0]);
  }
  setTimeout(()=>{sheetDrag=null;});
});
$('command-panel').querySelector('.sheet-head').addEventListener('pointercancel',()=>{sheetDrag=null;$('command-panel').style.height='';});
document.addEventListener('keydown',event=>{
  if(!state || document.body.classList.contains('reviewing') || event.ctrlKey || event.metaKey || event.altKey || event.target.closest('input,select,textarea,dialog') || $('confirm-dialog').open)return;
  // Escape closes the top-most overlay: menu, then war log, then the command panel (and its selection).
  if(event.key==='Escape'){
    if(!$('hud-menu').hidden)closeMenu(true);
    else if(!$('war-journal').hidden){toggleJournal(false);$('journal-toggle').focus();}
    else if(panelOpen)closePanel({restoreFocus:true});
    else if(expander.on)expander.set(false);
    else{source=null;destination=null;inspected=null;renderOrders();paintMap();}
    return;
  }
  if(event.key.toLowerCase()==='j'){toggleJournal($('war-journal').hidden);return;}
  if(event.key.toLowerCase()==='c')focusCountry();
  if(event.key==='m')atlas.setMapMode(atlas.mode==='diplomacy'?'political':'diplomacy');  // Shift+M is the sound mute
  if(event.key.toLowerCase()==='q')atlas.zoom(1.25);
  if(event.key.toLowerCase()==='e')atlas.zoom(.8);
});
document.addEventListener('pointerdown',event=>{
  if(!$('hud-menu').hidden && !event.target.closest('#hud-menu,#menu-button'))closeMenu();
});
document.addEventListener('click',safely(async event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.id==='journal-toggle')toggleJournal($('war-journal').hidden);
  if(button.id==='journal-close'){toggleJournal(false);$('journal-toggle').focus();}
  if(button.hasAttribute('data-dismiss-signal')){$('battle-signal').hidden=true;$('orders-label').focus();}
  if(button.dataset.countrySeat){$('country-choice').value=button.dataset.countrySeat;$('country-choice').dispatchEvent(new Event('change'));atlas.home(button.dataset.countrySeat);}
  if(button.dataset.countryFocus){const id=button.dataset.countryFocus;const focus=state.provinces.filter(p=>p.owner===id).sort((a,b)=>b.troops-a.troops)[0]?.id || country(id).start[0];atlas.focus(focus,view());inspected=focus;source=null;destination=null;orderMode='march';openPanel('orders');renderOrders();paintMap();$('orders-tab').scrollTop=0;}
  if(button.dataset.reserveFrom){source=button.dataset.reserveFrom;destination=button.dataset.reserveTo;inspected=source;orderMode='march';$('amount').value=freeTroops(source);openPanel('orders');renderOrders();paintMap();toast('Transfer drafted; review the garrison before committing.');}
  if(button.dataset.orderMode){orderMode=button.dataset.orderMode;if(orderMode!=='march' && $('command-panel').dataset.sheet==='peek')setSheet('half');renderOrders();$('orders-tab').scrollTop=0;}
  if(button.dataset.room)await openRoom(button.dataset.room,button.dataset.spectate==='true');
  if(button.dataset.home)await home();
  if(button.dataset.fraction){$('amount').value=Math.max(1,Math.floor(availableTroops()*Number(button.dataset.fraction)));renderOrders();}
  if(button.dataset.focus){atlas.focus(button.dataset.focus,view());inspected=button.dataset.focus;if(state.status==='running')openPanel('orders');renderOrders();}
  if(button.dataset.feedProvince){atlas.focus(button.dataset.feedProvince,view());inspected=button.dataset.feedProvince;renderOrders();paintMap();}
  if(button.dataset.feedCountry)atlas.home(button.dataset.feedCountry,view());
  if(button.dataset.decline){await command({type:'decline',proposalId:button.dataset.decline});toast('Offer declined.');}
  if(button.dataset.voteWar){const result=await command({type:'vote_war',motionId:button.dataset.voteWar});if(result)toast(result.status==='enacted'?'War declared.':'War vote recorded.');}
  if(button.dataset.votePeace){const result=await command({type:'vote_peace',motionId:button.dataset.votePeace});if(result)toast(result.status==='enacted'?'Peace agreed; attacking troops are returning.':'Peace vote recorded.');}
  if(button.dataset.recall){const result=await command({type:'recall',id:button.dataset.recall});if(result)toast('Recall queued. Marching troops return from their actual position.');}
  if(button.dataset.accept){
    const offer=state.proposals.find(q=>q.id===button.dataset.accept);if(!offer)return;
    const f=coalitionForecast(state,offer.roster,offer.coalition),mine=f.members.find(p=>p.country===state.you);
    if(!await confirmAction({title:`Join ${offer.name}?`,message:`${f.economy}/${f.totalEconomy} industry combined; ${f.threshold} needed. ${f.wouldDraw?'This would end in a negotiated draw.':f.wouldStartHold?'This would start a fresh victory hold after activation.':`${f.remaining} more industry needed for a victory hold.`} Your maximum slice becomes ${mine.maximumShare.toFixed(1)} points (${signed(mine.fullMaturityPrestige)} Prestige at full maturity). ${mine.keepsMaturity?'Your existing tenure remains.':'Your maturity restarts at zero.'} Industry and ownership may change before approval and the 30-second notice complete.`,accept:'Accept these terms'}))return;
    await command({type:'accept',proposalId:offer.id});toast('Terms accepted.');
  }
  if(button.dataset.tab && button.closest('#hud-rail'))togglePanel(button.dataset.tab);
  if(button.dataset.openPanel)openPanel(button.dataset.openPanel,{focus:true});
  if(button.hasAttribute('data-open-wars')){openPanel('council',{focus:true});$('council-tab').scrollTop=0;}
  if(button.dataset.frontA){atlas.fit(frontProvinces(button.dataset.frontA.split(','),button.dataset.frontB.split(',')),view());}
  if(button.dataset.warCouncil){
    const target=button.dataset.warCouncil;openPanel('council',{focus:true});
    if([...$('diplomacy-target').options].some(o=>o.value===target)){$('diplomacy-target').value=target;renderCouncil();}
    $('council-tab').scrollTop=document.querySelector('.war-council').offsetTop-$('council-tab').offsetTop; // never scrollIntoView: it would scroll the clipped stage too
    if(!$('declare-war').disabled)$('declare-war').focus();
  }

}));
for(const element of document.querySelectorAll('[data-icon]'))element.innerHTML=icon(element.dataset.icon);
worldFeed=new WorldFeed({list:$('feed-list'),unread:$('feed-unread'),toggle:$('feed-toggle'),body:$('feed-body'),jump:$('feed-jump')},feedNames);
standings=new LeaderboardPanel({root:$('leaderboard'),rows:$('lb-rows'),toggle:$('lb-toggle'),summary:$('lb-summary'),modes:[...document.querySelectorAll('[data-lb-mode]')],fronts:$('lb-fronts'),
  onFocus:id=>atlas?.setRelationFocus?.(id)},feedNames);
{let saved=null;try{saved=localStorage.getItem('coi.leaderboard');}catch{}
  standings.setOpen(saved?saved==='open':!matchMedia('(max-width:759px), (max-height:499px)').matches);}
herald=new Herald({declaration:$('declaration'),alliance:$('alliance-seal'),fallen:$('fallen-seal')});
const sounds=new SoundBoard($('sound-control'));
{let saved=null;try{saved=localStorage.getItem('coi.feed');}catch{}
  worldFeed.setOpen(saved?saved==='open':!narrow.matches);}
try{map=await request('/map.json','GET',undefined,null);initMap();showIdentity();const params=new URL(location).searchParams,initial=params.get('match');if(initial)await openRoom(initial,params.get('spectate')==='1');else await rooms();setConnection(state?.status==='finished'?'Review':'Live');}catch(e){toast(e.message,true);}
// Overlays size themselves around the leaderboard and the top alert stack (e.g. the order card's max height).
// Overlays size themselves around the alert stack and leaderboard (e.g. the order card's max height).
function measureStack(){
  const stage=$('stage');
  stage.style.setProperty('--lb-h',`${Math.round($('leaderboard').getBoundingClientRect().height)}px`);
  const alerts=$('alerts').getBoundingClientRect(),board=$('leaderboard').getBoundingClientRect(); // read after --lb-h moved the alerts
  stage.style.setProperty('--alerts-bottom',`${Math.round(alerts.bottom)}px`);
  stage.style.setProperty('--stack-bottom',`${Math.round(Math.max(alerts.bottom,board.bottom))}px`);
}
const stackObserver=new ResizeObserver(measureStack);
for(const element of [$('alerts'),$('leaderboard')])stackObserver.observe(element);
addEventListener('resize',measureStack);
setInterval(()=>{if(matchId)poll();},750);
