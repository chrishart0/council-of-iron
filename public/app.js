const $ = id => document.getElementById(id);
import { AfterAction } from './review.js';
import { developmentForecast, allianceForecast } from './insights.js';
import { faction, insignia, icon, battleSignal } from './presentation.js';
import { Atlas } from './atlas.js';
import { escapeHTML as esc, setHTML, setText, setAttr, setHidden, patchList, operationId, confirmAction, clock as time, seatType } from './ui.js';
import { Herald, presentHeadline } from './feed.js';
import { viewerOf, turnedBackReason } from './feed-model.js';
import { Comms } from './comms.js';
import { LeaderboardPanel } from './leaderboard-panel.js';
import { ExpandableMap, fullscreenSupported } from './expand.js';
// Relations and alliance colours: the same DOM-free helpers the atlas and agent tools use.
import { relationsOf, allianceColors, atWar as warBetween, truceUntil } from './relations.js';
import { friendlyPath } from './movement.js';
import { combatForecast } from './combat.js';
import { SoundBoard } from './sound.js';
/* v0.9 — the War Room. One map, two nouns: a PROVINCE (troops) opens the order card; a COUNTRY (diplomacy)
 * opens the country card; your own standard opens your alliance card. Each card has one primary action.
 * Everything addressed to you arrives through Messages (comms.js): one button, one toast lane, one panel. */
let identity;try{identity=JSON.parse(localStorage.getItem('coi.identity'));}catch{identity=null;}
let map, matchId=null, state=null, cursor=0, history=[], polling=false, toastTimer;
let review, signalCursor=null;
let atlas, generation=0, pendingCommand=false, pollController=null, previewKey='', previewVersion=0;
let spectating=false, mapReadyFor=null;
let messageCatchupComplete=false;
const pastSides=new Set(); // coalitions this seat belonged to ("your alliance dissolved" still affects you)
let comms, herald, standings, expander;
// Selection: one or more of your provinces (sources) and a target province; or a moving army.
let sources=[], target=null, armyId=null;
/** Select mode (the map's Select toggle; phones): taps on your provinces add or remove them as sources. */
let selectMode=false;
/** Rally pick mode: the next tapped province of yours becomes `rallyFrom`'s rally point. */
let rallyFrom=null;
// The one context card: { kind: 'province' | 'army' | 'country' | 'alliance', id }.
let card=null, cardSize='peek', cardOpener=null, proposing=false;
let fraction=.5;try{const f=Number(localStorage.getItem('coi.fraction'));if(f>0 && f<=1)fraction=f;}catch{}
const rallyPaused=new Map(); // rally source → pause reason already announced
const turnedBack=new Map(); // army id → its "turned back" notice key, withdrawn once the troops are home or moving again
const compact=matchMedia('(max-width:1023px), (max-height:499px)');
const country = id => map.countries.find(c=>c.id===id);
const place = id => map.provinces.find(p=>p.id===id);
const prov = id => state?.provinces.find(p=>p.id===id);
const sideName = id => state?.sides.find(s=>s.id===id)?.name || id;
const namedSide = id => country(sideName(id))?.name || sideName(id);
const myPlayer = () => state?.players.find(p=>p.id===state.you);
const playerOf = id => state?.players.find(p=>p.id===id);
const sameSide = (a,b) => Boolean(a && b && playerOf(a)?.side===playerOf(b)?.side);
const mayEnter = (a,b) => !b || sameSide(a,b) || warBetween(state,a,b);
const seated = () => Boolean(state?.you) && !spectating;
const active = () => seated() && state.status==='running' && myPlayer()?.eliminatedAt===null;
const neighbours = id => place(id)?.neighbors || [];
/** Your own or an ally's province: a move there may cross friendly land; anything else is an attack. */
const friendlyLand=id=>{const o=prov(id)?.owner;return Boolean(o && state?.you && sameSide(o,state.you));};
/** An attack needs a border of your own: one of your provinces (not merely an ally's) next to `id`. */
const ownBorder=id=>neighbours(id).some(n=>prov(n)?.owner===state?.you);
/** How your troops in `from` reach `to`: a neighbour directly (faster when both ends are yours or allied), else the
 * quickest route through your own and allied land — the same route and times the server charges. Land that is not
 * yours or an ally's can be attacked only if it borders a province of yours. Null: unreachable. */
function routeOf(from,to){
  if(!state || !from || !to || from===to || !state.you || prov(from)?.owner!==state.you)return null;
  if(!friendlyLand(to) && !ownBorder(to))return null;
  if(neighbours(from).includes(to)){
    const internal=sameSide(prov(from).owner,state.you) && sameSide(prov(to)?.owner,state.you);
    return {path:[to],travel:(internal?state.internalTravelTimes:state.travelTimes)[from][to]};
  }
  return friendlyPath(state,state.you,from,to);
}
/** Why a province is not a destination for the current selection (the map tooltip), or null. */
function unreachableWhy(id){
  if(!active() || target || !sources.length || sources.includes(id))return null;
  const n=sources.filter(s=>canReach(s,id)).length;
  if(n===sources.length)return null;
  if(n)return `Only ${n} of the ${sources.length} selected provinces can reach it`;
  if(!friendlyLand(id) && !ownBorder(id))return 'You cannot attack it: none of your provinces borders it';
  return sources.length>1?'No way there from the selected provinces':'No way there through your or allied land';
}
/** Your provinces bordering `id` with free troops: where an attack on it can come from. */
const bordering=id=>state.provinces.filter(q=>q.owner===state.you && q.id!==id && neighbours(q.id).includes(id) && freeTroops(q.id)>0).map(q=>q.id);
const canReach=(from,to)=>Boolean(routeOf(from,to));
/** Every province your troops in `from` can be sent to (neighbours first). */
let reachCache={key:'',lists:new Map()};
const reachable=from=>{
  const key=`${state?.tick}|${state?.provinces.map(p=>p.owner).join()}|${state?.players.map(p=>p.side).join()}`;
  if(reachCache.key!==key)reachCache={key,lists:new Map()};
  if(!reachCache.lists.has(from))reachCache.lists.set(from,[...neighbours(from),...map.provinces.map(p=>p.id).filter(id=>!neighbours(from).includes(id) && canReach(from,id))]);
  return reachCache.lists.get(from);
};
/** Lit destinations of a multi-province selection: friendly land any source can reach, attacks every source can
 * reach ('attack') or only some of them ('partial': the others are left out of the order). */
function selectionReach(){
  const lit=new Map(),sets=sources.map(s=>new Set(reachable(s)));
  for(const p of map.provinces){
    if(sources.includes(p.id))continue;
    const n=sets.filter(r=>r.has(p.id)).length;
    if(!n)continue;
    lit.set(p.id,friendlyLand(p.id)?'friendly':n===sources.length?'attack':'partial');
  }
  return lit;
}
/** Recall for one of your marching armies: it turns at its current position and goes home. Mirrors the engine
 * (a column measures from its first departure, never longer than it has been out). Null when there is nothing to offer. */
function recallOption(a){
  if(!a || a.country!==state?.you || a.returning || !active())return null;
  const at=state.tick+1,home=a.path?a.origin:a.from;
  const back=at+Math.max(1,a.path?at-a.originDepartedAt:Math.min(a.arrivesAt-a.departedAt,at-a.departedAt));
  const queued=state.orders.some(o=>['recall','turn_around'].includes(o.type) && [a.id,a.groupId].includes(o.target));
  return {to:home,arrivesAt:back,queued,label:`Recall → ${place(home).name} (arrives ${time(back)})`,
    preview:`${a.amount} troops turn where they are and are back in ${place(home).name} at ${time(back)}.`};
}
const timesWord=n=>n===1?'once':n===2?'twice':`${n} times`;
/** March again for one of your returning armies (recalled or turned back): it heads for the target it had been
 * going to, from where it is. The label's arrival mirrors the engine; the server's /plan preview (turnPlan) adds
 * its checks and warnings. Null when there is nothing to offer. */
function resumeOption(a){
  if(!a || a.country!==state?.you || !a.returning || a.engaged || !a.resume || !active())return null;
  const limit=state.rules.maxTurnArounds,spent=(a.turnArounds || 0)>=limit,at=state.tick+1,{to,target}=a.resume;
  const onward=target===to?null:friendlyPath(state,state.you,to,target);
  const arrivesAt=at+a.resume.remaining+(at-a.resume.turnedAt)+(onward?.travel ?? 0);
  const queued=state.orders.some(o=>['recall','turn_around'].includes(o.type) && o.target===a.id);
  const plan=turnPlan.key===`${a.id}|${state.tick}`?turnPlan:null;
  return {to:target,arrivesAt:plan?.result?.arrivesAt ?? arrivesAt,queued,spent,limit,plan,
    label:`March again → ${place(target).name} (arrives ${time(plan?.result?.arrivesAt ?? arrivesAt)})`,
    why:spent?`Already sent back ${timesWord(limit)}`:plan?.error || ''};
}
/** The server's read-only turn-around check for the army card (one request per army and game second). */
let turnPlan={key:''};
async function loadTurnPlan(a){
  const key=`${a.id}|${state.tick}`;if(turnPlan.key===key)return;
  turnPlan={key};const epoch=generation;
  let next;
  try{next={key,result:await request(`/api/games/${matchId}/plan`,'POST',{type:'turn_around',armyId:a.id})};}
  catch(e){next={key,error:e.message};}
  if(epoch!==generation || turnPlan.key!==key)return;
  turnPlan=next;if(card?.kind==='army' && card.id===a.id)renderCard();
}
/** One line under the primary: where the returning army goes, and a warning when another side is fighting there. */
function resumePreview(a,option){
  const r=option.plan?.result,lines=[`${a.amount} troops march from where they are to ${place(option.to).name}${r?.via && r.via!==r.to?` via ${place(r.via).name}`:''} and arrive at ${time(option.arrivesAt)}.`];
  if(r?.battleInProgress && !r.battleInProgress.joins)lines.push('Another side’s battle is under way there; your troops may be turned back again.');
  return lines.join(' ');
}
/** Centre the map on one of your armies and open its card. */
function showArmy(id){
  const a=state?.armies.find(a=>a.id===id);
  if(!a){toast('Those troops have already arrived.');return;}
  const past=(state.tick-a.departedAt)/Math.max(1,a.arrivesAt-a.departedAt);
  atlas.focus(past<.5?a.from:a.to,view());armyId=id;sources=[];target=null;openCard('army',id);paintMap();
}
/** ONE toast region: in a match the comms lane (a decision always wins the slot); elsewhere #toast. */
function toast(message,error=false){
  if(matchId && comms?.state && document.body.dataset.screen==='match' && !$('game').querySelector('#lobby:not([hidden])')){$('toast').hidden=true;comms.flash(message,{error});return;}
  $('toast').textContent=message;$('toast').className=`toast${error?' error':''}`;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,6500);
}
/** DOM helper: player text (alliance names, chat) only ever reaches textContent. */
function el(tag,className,text){const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e;}
function button(label,data={},className=''){const b=el('button',className,label);b.type='button';for(const [k,v] of Object.entries(data))b.dataset[k]=v;return b;}
const flag=id=>{const s=el('span','flag');s.innerHTML=insignia(id);return s;}; // authored SVG only
const feedNames={
  country:id=>country(id)?.name || id || 'Nobody',
  short:id=>faction(id).short,
  province:id=>place(id)?.name || id,
  // Alliance names are player text; callers render them with textContent only.
  side:id=>history.find(e=>e.type==='alliance_activated' && e.side===id)?.name || namedSide(id),
  time,
};
/** Live headlines only (never catch-up): queue banners and ask the atlas for a brief effect. */
function announce(events){
  for(const e of events){
    if(!e.headline)continue;
    // Big banners only for what directly affects this seat (spectators: none); the rail always shows it.
    const {banner,effects}=presentHeadline(e,feedNames,viewerOf(state,pastSides));
    if(banner)herald.push(banner);
    for(const [kind,data] of effects){try{atlas?.effect?.(kind,data);}catch(error){console.error(error);}}
  }
}
function renderLeaderboard(){
  const box=$('leaderboard');box.hidden=!state || state.status==='lobby';
  if(!box.hidden)standings.update(state,8); // v0.8: every power (≤8 seats) is one click from its country card
}

/* ── Read state: per item (a set of row keys per match and seat), never a single cursor. ── */
const readKey=()=>`coi.comms.${matchId}.${state?.you || 'spectator'}`;
function loadRead(){try{return new Set(JSON.parse(localStorage.getItem(readKey()) || '[]').map(String));}catch{return new Set();}}
function saveRead(keys){try{localStorage.setItem(readKey(),JSON.stringify([...keys].slice(-1200)));}catch{}}
/** Messages: the inbox, threads and toasts for this seat (spectators: the World thread, read-only). */
function renderComms(live){
  if(!state || state.status==='lobby'){comms.panel.hidden=true;comms.button.hidden=true;return;}
  const room=`${matchId}:${state.you}`;
  if(comms.room!==room){comms.reset();comms.room=room;comms.read=loadRead();}
  const before=comms.box;
  comms.update(state,history,{live,readOnly:!seated() || state.status!=='running'});
  // Your army turned back by itself: a sticky notice that says why, with March again (unless it needs a new
  // declaration of war first: peace, or the land changed hands to someone you are not at war with) and Show army.
  if(live && before && seated())for(const r of comms.box.rows.filter(r=>r.item.system==='turned_back' && !before.rows.some(b=>b.key===r.key))){
    const item=r.item,why=turnedBackReason(item,feedNames);
    const army=state.armies.find(a=>a.id===item.armyId),again=resumeOption(army);
    const buttons=army?[...(again && !again.spent && !['peace','no_war'].includes(item.reason)?[{label:'March again',act:'turn',arg:army.id,primary:true}]:[]),{label:'Show army',act:'show-army',arg:army.id}]:[];
    turnedBack.set(item.armyId,`n-${r.key}`);
    comms.notify({key:`n-${r.key}`,standard:state.you,sticky:true,title:`Your ${item.amount} troops turned back${item.province?` from ${place(item.province).name}`:''}`,detail:`${why[0].toUpperCase()}${why.slice(1)}.`,buttons});
  }
  for(const [army,key] of turnedBack)if(!state.armies.some(a=>a.id===army && a.returning)){comms.withdraw(key);turnedBack.delete(army);}
  // A rally point of yours that pauses (rally province lost, no path) is a PERSONAL notice (owner-only data).
  const rallies=new Map((state.rallies || []).map(r=>[r.from,r]));
  if(live && seated())for(const [from,r] of rallies)if(r.status==='paused' && rallyPaused.get(from)!==r.reason)
    comms.notify({key:`rally-${from}-${r.reason}-${state.tick}`,standard:state.you,title:`Rally from ${place(from).name} paused`,detail:`${(RALLY_PAUSE[r.reason] || 'paused').replace(/^paused(: |\s)/,'')}.`.replace(/^./,c=>c.toUpperCase()),view:{province:from}});
  rallyPaused.clear();for(const [from,r] of rallies)if(r.status==='paused')rallyPaused.set(from,r.reason);
  battleNotices(); // after the inbox update, so a battle result is not replaced by the headline of the same battle
}
/** Completed battles of this seat (Secured, Lost, Line held): a PERSONAL notice, never replayed on reconnect. */
function battleNotices(){
  const signal=signalCursor===null?null:battleSignal(state,history.filter(e=>e.id>signalCursor));
  signalCursor=cursor;
  if(signal && seated())comms.notify({key:`battle-${signal.tick}-${signal.province}`,standard:signal.tone==='lost'?null:state.you,title:`${signal.title} · ${place(signal.province).name}`,
    detail:`${signal.troops} troops remain · ${time(signal.tick)}`,view:{province:signal.province}});
}

/* ── Transport ── */
async function request(path,method='GET',data,token=identity?.token){
  const response=await fetch(path,{method,headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});
  const value=await response.json();if(!response.ok){const error=new Error(value.error || `Request failed (${response.status}).`);error.status=response.status;throw error;}return value;
}
async function ensureIdentity(name, force=false){
  name=name.trim();if(!force && identity?.name===name)return;
  const profile=await request('/api/players','POST',{name},null);
  leaveRoom();identity=profile;localStorage.setItem('coi.identity',JSON.stringify(identity));showIdentity();
}
function startingSummary(c){
  if(!c)return 'All countries are taken. You can still observe.';
  const troops=c.start.reduce((n,id)=>n+(c.garrisons?.[id] ?? c.startTroops ?? 10),0);
  const production=c.start.reduce((n,id)=>n+(c.development?.[id] ?? 1),0)*3;
  return `${c.start.length} holdings · ${troops} troops · ${production} recruits a minute · ${c.colonies?.length || 0} colonies. ${c.start.map(id=>place(id).name).join(', ')}.`;
}
function setConnection(text){setText($('connection'),text);setText($('hud-connection'),text);}
function showIdentity(){ $('identity').textContent=identity?.name || 'Observer';$('hud-identity').textContent=identity?.name || 'Observer';$('display-name').value=identity?.name || '';$('join-name').value=identity?.name || ''; }
async function rooms(){
  const data=await request('/api/games');
  const sections=[['running','In progress','Watch'],['lobby','Open rooms','Enter'],['finished','Concluded','Review']];
  const seats=g=>`${g.players.length}/8 seats · ${g.speed===1?'30 min':'5 min'}`;
  $('rooms').innerHTML=data.games.length?sections.map(([status,title,label])=>{
    const found=data.games.filter(g=>g.status===status);
    return found.length?`<section class="room-group"><h3>${title} <small>${found.length}</small></h3>${found.map(g=>`<div class="room-card${status==='running'?' live':''}"><div><p>${esc(g.name)}</p><small>${seats(g)}${status==='running'?` · ${time(g.tick)} played`:''}</small></div><div class="room-entry-actions">${status==='running' && g.you?`<button class="btn btn-primary" data-room="${esc(g.id)}" data-resume="true">Resume</button>`:''}<button class="btn${status==='lobby'?' btn-primary':''}" data-room="${esc(g.id)}" data-spectate="${status==='running'}">${label}</button></div></div>`).join('')}</section>`:'';
  }).join(''):'<p class="empty-note">No rooms yet. Open the first council.</p>';
  const record=(await request('/api/standings')).standings;
  $('standings').innerHTML=record.length?record.map(p=>`<div class="standing-row"><span>${esc(p.name)} <small class="muted">${p.matches} ${p.matches===1?'match':'matches'}</small></span><b>${p.wins}–${p.draws}–${p.losses}</b></div>`).join('')+'<p class="empty-note">Wins–draws–losses in finished matches.</p>':'<p class="empty-note">No results yet. Finish a match to start your record.</p>';
}
function clearSelection(){sources=[];target=null;armyId=null;proposing=false;rallyFrom=null;setSelectMode(false);}
function setSelectMode(on){
  selectMode=on;const b=$('select-mode');if(!b)return;
  b.setAttribute('aria-pressed',String(on));b.classList.toggle('on',on);
}
const rallyOf=id=>(state?.rallies || []).find(r=>r.from===id);
const RALLY_PAUSE={destination_lost:'paused: the rally province is not yours',no_path:'paused: no path through your or allied land'};
function rallyText(r){return `Rally → ${place(r.to).name}${r.status==='paused'?` · ${RALLY_PAUSE[r.reason] || 'paused'}`:''}`;}
async function openRoom(id,watch=false){
  leaveRoom();document.body.classList.remove('reviewing');closeCard();closeMenu();
  spectating=watch;matchId=id;mapReadyFor=null;state=null;clearSelection();previewKey='';
  document.body.classList.add('in-game');document.body.dataset.screen='match';atlas.world();
  $('home').hidden=true;$('game').hidden=false;$('result').hidden=true;
  const url=new URL(location);url.searchParams.set('match',id);if(watch)url.searchParams.set('spectate','1');else url.searchParams.delete('spectate');url.hash='';window.history.replaceState({},'',url);
  const epoch=generation,loaded=await request(`/api/games/${id}/map`,'GET',undefined,watch?null:identity?.token);
  if(epoch!==generation || matchId!==id)return;
  map=loaded;initMap();mapReadyFor=id;
  await poll();syncInsets();atlas.world();
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
      const me=next.players?.find(p=>p.id===next.you);if(me?.side && !me.side.startsWith('solo:'))pastSides.add(me.side);
      if(!next.hasMore)break;
    }
    if(!state.hasMore)messageCatchupComplete=true;
    announce(liveDeclarations);sounds.update(state,liveDeclarations,live);
    setConnection(state.status==='finished'?'Review':'Live');render();renderComms(live);renderCard();coach();syncInsets();
  }catch(e){if(e.name!=='AbortError' && epoch===generation){setConnection('Reconnecting');toast(e.message,true);}}
  finally{if(polling===epoch)polling=false;}
}
async function command(action){
  if(!matchId || pendingCommand || spectating || !state?.you)return null;
  pendingCommand=true;const epoch=generation,room=matchId;
  const payload={opId:operationId(),action};
  if(state)renderCard();
  try {
    let result;
    // A transport failure can be retried with exactly the same operation ID.
    // A rules error is never retried, and changing identities invalidates this request.
    try{result=await request(`/api/games/${room}/actions`,'POST',payload);}
    catch(error){if(error.status || epoch!==generation)throw error;result=await request(`/api/games/${room}/actions`,'POST',payload);}
    if(epoch!==generation)return null;
    sounds.order(action);await poll();return result;
  }finally{pendingCommand=false;if(epoch===generation && state)renderCard();}
}
const safely=fn=>async event=>{if(event?.type==='submit')event.preventDefault();try{await fn(event);}catch(e){toast(e.message,true);}};
/** A second press while the first request is still out is ignored (a double tap on Create made two rooms). */
const once=fn=>{let busy=false;return async event=>{if(busy)return;busy=true;try{await fn(event);}finally{busy=false;}};};

/* ── Map ── */
function initMap(){
  $('faction-choices').innerHTML=map.countries.map(c=>`<button type="button" data-country-seat="${c.id}" aria-pressed="false">${insignia(c.id)}<b>${esc(faction(c.id).short)}</b><small>${c.start.length} holdings</small></button>`).join('');
  atlas?.destroy();
  const previous=$('map'),replacement=previous.cloneNode(false);previous.replaceWith(replacement);
  // The map key (legend + Political/Diplomacy toggle) lives in the ☰ menu.
  atlas=new Atlas(replacement,map,selectProvince,{legend:{placement:'bottom-left',container:$('map-key'),collapsed:false},
    // Gesture separation on touch: a one-finger drag marches only from the counter of a province you have already
    // selected (tap it first); every other drag pans. A mouse may drag from any of your counters.
    drag:{start:(id,{counter,touch})=>active() && prov(id)?.owner===state.you && (touch?counter && sources.includes(id):counter || sources.includes(id)) && freeTroops(id)>0,
      // Dragging from one province of a multi-selection sends the whole selection there.
      begin:from=>{if(!(sources.length>1 && sources.includes(from)))sources=[from];target=null;armyId=null;proposing=false;paintMap();},
      label:(from,to)=>`${amountFor(from)} · ${routeOf(from,to)?.travel ?? '?'}s`,
      targets:from=>reachable(from),
      path:(from,to)=>routeOf(from,to)?.path,
      end:(from,to)=>{if(!(sources.length>1 && sources.includes(from)))sources=[from];target=to;armyId=null;openCard('province',to || from);paintMap();revealUnderCard(to || from);}},
    lasso:ids=>lassoSelect(ids),longPress:true,why:id=>unreachableWhy(id),
    emptyTap:(x,y,{touch})=>{const id=touch?snapTarget(null,{x,y}):null;if(id)selectProvince(id);},
    onArmy:id=>{const a=state?.armies.find(a=>a.id===id);if(!a)return false;armyId=id;sources=[];target=null;openCard('army',id);paintMap();return true;}});
  $('landing-map').innerHTML=map.provinces.map(p=>`<path d="${p.path}"/>`).join('');
}
/** Screen insets (px) covered by the HUD frame and open panels, so a camera move centres the target in the
 * map area that is actually visible (the atlas's optional trailing argument). */
function view(){
  const stage=$('stage').getBoundingClientRect(),vis=sel=>{const e=document.querySelector(sel);return e?.checkVisibility()?e.getBoundingClientRect():null;};
  const hud=vis('#hud'),strip=vis('.strip'),panel=vis('#card'),dock=vis('.dock');
  const side=[vis('#leaderboard'),vis('#comms'),vis('#hud-menu'),vis('#war-journal')].filter(r=>r && r.height>stage.height*.3);
  const sheet=panel && panel.width>stage.width*.7,sideDock=dock && dock.height>dock.width;
  const top=Math.max(0,...[hud,strip].filter(Boolean).map(r=>r.bottom-stage.top));
  const right=Math.max(sideDock?stage.right-dock.left:0,...side.filter(r=>r.left>stage.left+stage.width/2).map(r=>stage.right-r.left));
  const left=Math.max(panel && !sheet?panel.right-stage.left:0,...side.filter(r=>r.right<stage.left+stage.width/2).map(r=>r.right-stage.left));
  const bottom=Math.max(sheet?stage.bottom-panel.top:0,dock && !sideDock?stage.bottom-dock.top:0);
  return {insets:{top,right,left,bottom}};
}
/** Panels that stay beside the map (the right column, the phone bars): world view and zoom-out use the rest. */
function syncInsets(){
  if(!atlas)return;const {insets}=view();
  atlas.setInsets({left:0,right:insets.right,top:insets.top});
}
function focusCountry(){if(state?.you)atlas.home(state.you,{...view(),width:compact.matches?Math.max(120,$('stage').clientWidth/2.8):undefined});}
/** Phones: if the bottom sheet now covers the chosen province, pan (no zoom) so it sits above the sheet. */
function revealUnderCard(id){
  requestAnimationFrame(()=>{
    const marker=document.querySelector(`#marker-${CSS.escape(id)} .counter-body`),box=$('card');if(!marker || box.hidden)return;
    const m=marker.getBoundingClientRect(),c=box.getBoundingClientRect();
    if(m.bottom>c.top-8 && m.left<c.right && m.right>c.left)atlas.inset(place(id),view().insets);
  });
}
function paintMap(){
  if(!state)return;
  setHidden($('select-mode'),!active());
  const many=sources.length>1;
  atlas.update(state,many?null:sources[0] || null,target,many?{selected:sources,reach:target?null:selectionReach()}:{});
  paintDraft();
}
/** The order arrow of the open province card (sources → target), or none. */
function paintDraft(){const plan=card?.kind==='province' && target && sources.length?orderPlan():null;atlas.setDraft(plan?{sources,to:target,label:plan.arrowLabel}:null);}
function freeTroops(id) {
  const p=prov(id);
  const reserved=state.orders.filter(o=>o.from===id && ['march','develop'].includes(o.type)).reduce((n,o)=>n+o.amount,0);
  return Math.max(0,(p?.troops || 0)-reserved-1);
}
const amountFor=id=>{const free=freeTroops(id);return free>0?Math.max(1,Math.floor(free*fraction)):0;};

/** Fingers are wide: with your troops chosen (and no target yet), a tap that lands on a province they cannot go to, or on
 * open sea, snaps to the nearest legal destination whose counter lies within a finger's radius of the tap. */
const SNAP_RADIUS=34;
function snapTarget(id,point){
  if(!active() || !sources.length || target || rallyFrom || selectMode)return id;
  const legal=sources.length>1?selectionReach():new Map(reachable(sources[0]).map(v=>[v,true]));
  if(id && (legal.has(id) || prov(id)?.owner===state.you))return id;
  let best=null,bestDistance=SNAP_RADIUS;
  for(const v of legal.keys()){
    const r=document.querySelector(`#marker-${CSS.escape(v)} .counter-body`)?.getBoundingClientRect();if(!r || !r.width)continue;
    const d=Math.hypot(Math.max(r.left-point.x,0,point.x-r.right),Math.max(r.top-point.y,0,point.y-r.bottom));
    if(d<bestDistance){best=v;bestDistance=d;}
  }
  return best || id;
}
/** Tap/click/Enter on a province. Tap-tap fallback of the drag: your province, then a target.
 * Several sources: Shift/Ctrl-click, long-press or Select mode toggles your provinces in and out of the selection
 * (a Shift-drag rectangle adds every province of yours inside it); then one tap on the target. With a target chosen,
 * tapping more of your provinces able to send there adds (or removes) them as sources. */
function selectProvince(id,modifiers={}){
  if(!state)return;
  if(modifiers.touch && modifiers.point && !modifiers.toggle)id=snapTarget(id,modifiers.point);
  const p=prov(id),mine=active() && p.owner===state.you;
  if(rallyFrom){ // second tap of "Rally troops to…": the rally province
    const from=rallyFrom;rallyFrom=null;
    if(id===from || !mine){toast(id===from?'Rally cancelled.':'Choose one of your own provinces as the rally point.',id!==from);renderCard();paintMap();return;}
    command({type:'rally',from,to:id}).then(r=>{if(r)toast(`Rally set: new troops in ${place(from).name} march to ${place(id).name} (${r.sources[0].travel}s).`);}).catch(e=>toast(e.message,true));
    return;
  }
  armyId=null;proposing=false;
  const toggle=mine && (modifiers.toggle || selectMode && !modifiers.keyboard);
  if(toggle){
    sources=sources.includes(id)?sources.filter(s=>s!==id):[...sources,id];
    if(target===id)target=null;
    if(!sources.length && !target){closeCard({restoreFocus:false});return;}
  }
  else if(target===id || (!target && sources.length===1 && sources[0]===id)){closeCard({restoreFocus:false});return;}
  else if(target && mine && canReach(id,target)){
    sources=sources.includes(id)?sources.filter(s=>s!==id):[...sources,id];
    if(!sources.length)sources=[id];
  }
  else if(!target && sources.length>1 && sources.includes(id)){sources=sources.filter(s=>s!==id);}
  else if(!target && (sources.length>1 || sources.length===1 && canReach(sources[0],id)))target=id;
  else if(mine){sources=[id];target=null;}
  else{
    // Target first: your best-placed province is proposed as the source (neighbours first).
    const donors=active()?state.provinces.filter(q=>q.owner===state.you && freeTroops(q.id)>0 && canReach(q.id,id))
      .sort((a,b)=>Number(neighbours(b.id).includes(id))-Number(neighbours(a.id).includes(id)) || freeTroops(b.id)-freeTroops(a.id)):[];
    sources=donors.length?[donors[0].id]:[];target=id;
  }
  const focus=target || (sources.length>1?sources.at(-1):sources[0]) || id;
  openCard('province',target || sources[0] || id);paintMap();revealUnderCard(focus);
  if(modifiers.keyboard && target && !$('primary')?.disabled)$('primary')?.focus();
}
/** Shift-drag rectangle: add every province of yours inside it to the selection. */
function lassoSelect(ids){
  if(!active())return;
  const mine=ids.filter(id=>prov(id)?.owner===state.you && !sources.includes(id));
  if(!mine.length){toast('No province of yours inside the rectangle.');return;}
  armyId=null;proposing=false;sources=[...sources,...mine];
  openCard('province',target || sources[0]);paintMap();
}
/** "Select all bordering X": every province of yours next to the target with free troops. */
function selectBordering(id){
  const list=bordering(id);if(!list.length)return;
  sources=list;target=id;armyId=null;proposing=false;openCard('province',id);paintMap();
}

/* ── Orders ── */
/** Attacking `owner` needs a declaration first: who ends up at war (both whole sides). Null when a march is allowed. */
function warPlan(owner){
  const me=myPlayer();if(!owner || !me || mayEnter(state.you,owner))return null;
  return {allies:state.players.filter(p=>p.side===me.side && p.id!==state.you).map(p=>p.id),
    enemies:state.players.filter(p=>p.side===playerOf(owner)?.side).map(p=>p.id)};
}
/** Everything the order card shows for the current sources → target, and its one primary action. */
function orderPlan(){
  const tp=prov(target),owner=tp?.owner || null,name=place(target).name,who=owner?faction(owner).short:null;
  // Only sources able to send there take part: an attack needs a bordering province; the rest are left out (and say so).
  const eligible=sources.filter(from=>canReach(from,target)),left=sources.filter(from=>!eligible.includes(from));
  const parts=eligible.map(from=>{const route=routeOf(from,target);return {from,free:freeTroops(from),amount:amountFor(from),travel:route?.travel ?? 0};});
  const total=parts.reduce((n,s)=>n+s.amount,0),travel=Math.max(0,...parts.map(s=>s.travel)),war=warPlan(owner);
  const relation=!owner?'unclaimed':owner===state.you?'own':sameSide(state.you,owner)?'ally':war?'neutral':'enemy';
  const words={unclaimed:['UNCLAIMED','No declaration needed.'],own:['YOUR PROVINCE','Move troops within your land.'],ally:['ALLIED',`Troops you send become ${who}’s.`],
    enemy:['AT WAR','You can attack.'],
    neutral:['NOT AT WAR',`Sending troops declares war on ${who}${war?.enemies.length>1?' and its allies':''}${war?.allies.length?'; your allies join in':''}.`]}[relation];
  const sent=parts.filter(s=>s.amount>0),many=sent.length>1,from=many?` from ${sent.length} provinces`:'';
  let label,danger=false,disabled=!active() || pendingCommand;
  const truce=war?truceUntil(state,state.you,owner):null;
  if(relation==='own' || relation==='ally')label=`Reinforce ${name} with ${total}${many?` from ${sent.length}`:''}`;
  else if(truce!==null){label=`Truce until ${time(truce)}`;disabled=true;words[1]=`Peace was made: no war with ${who} before ${time(truce)}.`;}
  else if(war){label=`Declare war on ${who} & send ${total}${from}`;danger=true;}
  else if(owner)label=many?`Attack ${name} from ${sent.length} provinces · ${total}`:`Attack ${name} with ${total}`;
  else label=`Send ${total} → ${name}${from}`;
  const hostile=relation!=='own' && relation!=='ally',names=ids=>ids.map(v=>place(v).name).join(', ');
  let why='';
  if(!parts.length){disabled=true;why=hostile && !ownBorder(target)?`You have no province bordering ${name}. Take or hold a province next to it first.`:`None of ${sources.length?'the selected':'your'} provinces can reach ${name}.`;}
  else if(!total){disabled=true;why='No free troops: one must stay home.';}
  if(pendingCommand)label='Sending order…';
  // One line: where the troops go, the way (the server's route once /plan answers) and when they arrive.
  const planned=marchPlan.key===JSON.stringify(actionFor(parts))?marchPlan.result:null;
  const way=sent.length===1?(planned?.sources?.[0]?.path || routeOf(sent[0].from,target)?.path || []).slice(0,-1):[];
  const arrives=planned?.arrivesAt ?? state.tick+travel+1,here=`${tp.troops} ${hostile?'defenders':'there now'}`;
  const preview=!sent.length?'':many?`${hostile?'Attack':'Reinforce'} ${name}${from} · ${total} troops · all arrive together at ${time(arrives)} · ${here}`
    :`Send ${total} → ${name}${way.length?` via ${names(way)}`:''} (arrives ${time(arrives)}) · ${here}`;
  const note=left.length && parts.length?`${names(left)} ${left.length>1?'have':'has'} no way to ${name}: left out.`:'';
  const chips=sources.map(from=>({from,free:freeTroops(from),amount:eligible.includes(from)?amountFor(from):0,off:!eligible.includes(from)}));
  return {parts,left,chips,total,travel,war,relation,words,label,danger,disabled,why,preview,note,owner,arrowLabel:`${total} · ${travel+1}s`};
}
/** "Declare war on X?" with the real consequences: both whole sides go to war. */
function confirmWar(owner,amount,plan){
  const list=(label,ids)=>{const row=el('div','war-confirm-row');row.append(el('b','',label),...ids.map(id=>{const s=el('span','war-confirm-country');s.innerHTML=insignia(id);s.append(el('span','',country(id).name));return s;}));return row;}; // authored SVG + text
  const extra=el('div','war-confirm');extra.append(list('You will be at war with',plan.enemies));
  if(plan.allies.length)extra.append(list('Your allies join you',plan.allies));
  extra.append(el('p','small',amount?'The declaration and the march are one order: if the troops cannot be sent, no war is declared.':'Both sides may attack each other from now on.'));
  return confirmAction({title:`Declare war on ${country(owner).name}?`,message:amount?`Send ${amount} troops to ${place(target)?.name} and declare war.`:'The whole of both alliances goes to war.',accept:amount?`Declare war & send ${amount}`:'Declare war',extra});
}
async function sendOrder(){
  const plan=orderPlan();if(plan.disabled)return;
  if(plan.war && !await confirmWar(plan.owner,plan.total,plan.war))return;
  if(!target)return; // the card closed while the confirmation was open (the match ended)
  // One order, one opId: declare war and march together, or neither (the engine validates both). The amounts are read
  // again after the confirmation: polling may have changed the free troops meanwhile.
  const action=marchAction(plan.war),to=place(target).name,total=action.amount ?? action.sources.reduce((n,s)=>n+s.amount,0);
  const r=await command(action);if(!r)return;
  const n=r.sources?.length || 1;
  toast(`${plan.war?'War declared. ':''}Sent ${total} → ${to}${n>1?` from ${n} provinces`:''}. ${n>1?'All arrive':'Arrives'} ${time(r.arrivesAt)}.`);
  closeCard();
}
/** The one march order for the current selection (several sources arrive together). */
function marchAction(declare=false){return actionFor(orderPlan().parts,declare);}
function actionFor(all,declare=false){
  const parts=all.filter(s=>s.amount>0);
  return {type:'march',to:target,...(parts.length===1?{from:parts[0].from,amount:parts[0].amount}:{sources:parts.map(s=>({from:s.from,amount:s.amount}))}),...(declare?{declareWar:true}:{})};
}
/** The server's latest forecast for the selected march ({key: the action as JSON, result}). */
let marchPlan={key:'',result:null};
function planDetails(result){
  const via=result.sources.length===1 && result.sources[0].path.length>1?`Via ${result.sources[0].path.slice(0,-1).map(v=>esc(place(v).name)).join(' → ')} · `:'';
  const odds=result.combatAtArrival?` <b class="odds">${Math.round(100*result.combatAtArrival.attackerWinChance)}% to take it against ${result.defenseAtArrival.total} expected defenders.</b>`:'';
  const when=result.sources.length>1?`All ${result.sources.length} columns arrive together at ${time(result.arrivesAt)}`:`arrives ${time(result.arrivesAt)}`;
  return `${esc(result.summary)}${odds}<small>${via}${when}${result.defenseAtArrival?` · ${result.defenseAtArrival.current} there now, +${result.defenseAtArrival.recruits} recruits, +${result.defenseAtArrival.incoming} arriving`:''}. New orders and battles can change this.</small>`;
}
/** The server's forecast of this march (routes, arrival, odds), shown under the expanded card. */
async function updatePreview(){
  if(!sources.length || !target || !active()){previewKey='';if($('order-details'))$('order-details').textContent='';return;}
  const action=marchAction(),key=JSON.stringify([matchId,state.tick,action]);
  if(key===previewKey || !orderPlan().total)return;previewKey=key;const version=++previewVersion,epoch=generation;
  try{
    const result=await request(`/api/games/${matchId}/plan`,'POST',action);
    if(key!==previewKey || version!==previewVersion || epoch!==generation)return;
    const fresh=marchPlan.key!==JSON.stringify(action) || marchPlan.result?.arrivesAt!==result.arrivesAt;
    marchPlan={key:JSON.stringify(action),result};
    if($('order-details'))$('order-details').innerHTML=planDetails(result);
    if(fresh)renderCard();
  }catch(e){if(key===previewKey && version===previewVersion && epoch===generation && $('order-details'))$('order-details').textContent=e.message;}
}

/* ── The context card ── */
function openCard(kind,id=null,{size,focus=false}={}){
  const box=$('card'),same=card?.kind===kind && card?.id===id;
  if(focus && !box.contains(document.activeElement))cardOpener=document.activeElement;
  if(kind!=='province' && kind!=='army'){sources=[];target=null;armyId=kind==='army'?id:null;}
  if(kind!=='country' || !same)proposing=false;
  card={kind,id};box.hidden=false;
  // Learning by doing: a tip that has just been acted on moves on by itself.
  if(coachStep===0 && kind==='province' || coachStep===1 && kind==='country'){coachStep++;showCoach();}
  const allied=myPlayer() && !myPlayer().side.startsWith('solo:');
  cardSize=size || (same?cardSize:kind==='country' || kind==='alliance' && allied?'full':'peek');
  if(compact.matches){setSheet(null);if(comms.view!=='closed')comms.close();} // phones: one sheet at a time
  renderCard();
  if(kind==='country' || kind==='alliance')atlas?.setRelationFocus?.(kind==='country'?id:state?.you || null);
  if(focus)$('card-title').focus({preventScroll:true});
}
function closeCard({restoreFocus=false}={}){
  const box=$('card'),inside=box.contains(document.activeElement);
  if(!card){clearSelection();if(state)paintMap();return;}
  card=null;box.hidden=true;clearSelection();atlas?.setRelationFocus?.(null);
  if(state)paintMap();
  if((restoreFocus || inside) && cardOpener?.isConnected && cardOpener.checkVisibility())cardOpener.focus();
  cardOpener=null;
}
function setCardSize(size){cardSize=size;renderCard();}
/** Build the card's parts. Each part re-renders only when its content key changes, so focus, the
 * slider and a half-typed message survive polling. */
function part(id,key,build){const e=$(id);if(e.dataset.key===key)return e;e.dataset.key=key;e.replaceChildren(...[build()].flat().filter(Boolean));return e;}
function relationOf(id){
  if(!state.you || spectating)return playerOf(id)?.eliminatedAt!=null?'fallen':'watch';
  if(id===state.you)return 'you';
  const p=playerOf(id);if(!p)return 'unclaimed';if(p.eliminatedAt!=null)return 'fallen';
  if(sameSide(state.you,id))return 'ally';
  if(relationsOf(state,state.you).enemies.includes(id))return 'war';
  const both=q=>q.roster.includes(state.you) && q.roster.includes(id);
  if((state.proposals || []).some(q=>q.status==='pending' && both(q)))return 'forming';
  return (state.proposals || []).some(q=>q.status==='open' && both(q))?'offer':'neutral';
}
const RELATION_WORDS={you:'YOU',forming:'ALLIANCE FORMING',ally:'ALLIED',war:'AT WAR',neutral:'NEUTRAL',offer:'ALLIANCE OFFER PENDING',fallen:'FALLEN',watch:'',unclaimed:'UNCLAIMED'};
function ownerButton(id){
  if(!id)return el('span','card-owner','No owner');
  const b=button('',{openCountry:id},'card-owner');b.append(flag(id),el('span','',country(id).name));
  const rel=relationOf(id);if(RELATION_WORDS[rel] && rel!=='you')b.append(el('b',`rel rel-${rel}`,RELATION_WORDS[rel]));
  b.append(el('span','card-owner-go','›'));b.setAttribute('aria-label',`${country(id).name}${rel!=='you' && RELATION_WORDS[rel]?`, ${RELATION_WORDS[rel].toLowerCase()}`:''}: open diplomacy`);
  return b;
}
function renderCard(){
  const box=$('card');
  if(!card || !state || state.status==='lobby'){if(card && state?.status==='lobby')closeCard();return;}
  if(card.kind==='army' && !state.armies.some(a=>a.id===card.id)){closeCard();return;}
  // Polling re-renders the open card every second: write only what changed.
  setAttr(box,'data-kind',card.kind);setAttr(box,'data-size',cardSize);
  setAttr($('card-size'),'aria-expanded',cardSize==='full');setAttr($('card-size'),'aria-label',cardSize==='full'?'Show less':'Show more');
  const view={province:provinceCard,army:armyCard,country:countryCard,alliance:allianceCard}[card.kind]();
  const kind=card.kind==='province'?(view.order?'Orders':'Province'):{army:'Army',country:'Country',alliance:'Your alliance'}[card.kind];
  if($('card-kind').textContent!==kind){$('card-kind').textContent=kind;$('card-kind-icon').innerHTML=icon({province:view.order?'march':'land',army:'march',country:'seal',alliance:'ally'}[card.kind]);}
  part('card-flag',JSON.stringify(view.flag),()=>view.flag?flag(view.flag):null);
  setText($('card-title'),view.title);
  part('card-sub',JSON.stringify(view.subKey ?? view.sub),()=>view.sub);
  part('card-status',JSON.stringify(view.statusKey ?? view.status),()=>view.status);
  setAttr(box,'data-relation',view.relation || '');
  setHidden($('card-size'),!view.more);
  setHidden($('card-body'),cardSize!=='full' || !view.more);
  if(!$('card-body').hidden)view.more();
  // Dock: sources and amount (orders), a message box (diplomacy), then the actions.
  const order=view.order;
  // The selection bar: every selected source with the troops it sends (of its free troops), × removes it.
  const chips=order?.chips || [],showChips=chips.length>1 || selectMode && chips.length>0;
  setHidden($('sources'),!order || !showChips && !order.hint && !order.note);
  if(order)part('sources',JSON.stringify([showChips && chips,order.hint,order.note]),()=>[...(showChips?chips.map(c=>{
    const b=button('',{removeSource:c.from},`source-chip${c.off?' off':''}`);
    b.append(el('b','',c.off?'–':String(c.amount)),el('span','',place(c.from).name),el('small','',c.off?'out':`/${c.free}`),el('i','','×'));
    b.setAttribute('aria-label',`Remove ${place(c.from).name} (${c.off?'cannot send there':`${c.amount} of ${c.free} free troops`})`);return b;}):[]),
    ...(order.note?[el('small','sources-hint sources-off',order.note)]:[]),...(order.hint?[el('small','sources-hint',order.hint)]:[])]);
  setHidden($('amount-control'),!order || !order.parts.length);
  if(order){
    const pct=Math.round(fraction*100);if(document.activeElement!==$('amount-slider') && $('amount-slider').value!==String(pct))$('amount-slider').value=String(pct);
    setText($('amount-out'),`${order.total} troops · ${pct}%`);
    for(const b of document.querySelectorAll('[data-fraction]'))setAttr(b,'aria-pressed',Math.abs(Number(b.dataset.fraction)-fraction)<.001);
  }
  setHidden($('order-preview'),!order || !(order.preview || order.why));
  if(order)setText($('order-preview'),order.why || order.preview);
  part('card-actions',JSON.stringify(view.actions.map(a=>[a.label,a.act,a.arg,a.primary,a.danger,a.disabled,a.id])),()=>view.actions.map(a=>{
    const b=button(a.label,{act:a.act,...(a.arg!==undefined?{arg:a.arg}:{})},`${a.primary?'primary':''}${a.danger?' danger':''}`);
    if(a.id)b.id=a.id;b.disabled=Boolean(a.disabled);return b;}));
  setHidden($('card-dock'),$('sources').hidden && $('amount-control').hidden && $('order-preview').hidden && !view.actions.length);
  if(order && $('amount-slider').style.getPropertyValue('--fill')!==`${Math.round(fraction*100)}%`)$('amount-slider').style.setProperty('--fill',`${Math.round(fraction*100)}%`);
  if(card.kind==='province'){paintDraft();if(order && order.parts.length)updatePreview();}
}
function provinceCard(){
  const id=target || sources[0] || card.id,p=prov(id);
  if(!p){return {title:'',actions:[]};}
  const owner=p.owner,mine=owner===state.you && state.you;
  const base={flag:owner,title:place(id).name};
  if(!target && active() && (sources.length>1 || selectMode && sources.length)){ // several sources chosen, no target yet
    const free=sources.reduce((n,s)=>n+freeTroops(s),0),chips=sources.map(from=>({from,free:freeTroops(from),amount:amountFor(from),off:false}));
    const status=el('div','card-relation');status.append(el('span','card-hint',selectMode?'Tap your provinces to add or remove them, then tap a target.':'Tap a target: they all march there and arrive together. You can attack land that borders yours.'));
    return {flag:state.you,title:sources.length>1?`${sources.length} provinces selected`:place(sources[0]).name,
      sub:[el('span','card-meta',`${free} free troops · ${chips.reduce((n,c)=>n+c.amount,0)} to send`)],subKey:[sources,free,fraction],
      status,statusKey:[selectMode],relation:'own',
      order:{parts:chips,chips,total:chips.reduce((n,c)=>n+c.amount,0),hint:'',note:'',preview:'',why:''},
      actions:[{label:'Clear selection',act:'clear-selection',id:'clear-selection'}]};
  }
  if(target && active() && (sources.length || !mine)){ // spectators and fallen players get the information card
    const plan=orderPlan(),near=bordering(target),waiting=near.filter(q=>!sources.includes(q)).map(q=>place(q).name);
    const hint=!active() || !sources.length || waiting.length!==1?'':`Tap ${waiting[0]} to send from there too.`;
    const all=near.length>1 && waiting.length?{label:`Select all bordering (${near.length})`,act:'select-bordering',arg:target,id:'select-bordering',disabled:pendingCommand}:null;
    const status=el('div','card-relation');status.append(el('b',`rel rel-${plan.relation}`,plan.words[0]),el('span','',plan.words[1]));
    return {...base,title:place(target).name,
      sub:[owner?ownerButton(owner):el('span','card-meta','Unclaimed'),el('span','card-meta',`${p.troops} troops${sources.length?` · from ${sources.length===1?place(sources[0]).name:`${sources.length} provinces`}`:''}`)],subKey:[owner,relationOf(owner),p.troops,sources],
      status,statusKey:[plan.relation,plan.words],relation:plan.relation,
      order:active()?{...plan,hint}:null,
      actions:active()?[{label:plan.label,act:'send',primary:true,danger:plan.danger,disabled:plan.disabled,id:'primary'},...(all?[all]:[])]:[],
      more:()=>moreProvince(target,true)};
  }
  const battle=state.battles?.find(b=>b.province===id);
  const status=el('div','card-relation');
  if(battle){
    const attackers=state.armies.filter(a=>a.engaged && a.to===id).reduce((n,a)=>n+a.amount,0),odds=combatForecast(attackers,p.troops,p.development);
    status.append(el('b','rel rel-war','BATTLE'),el('span','',`${attackers} attackers against ${p.troops} defenders · attackers take it ${Math.round(100*odds.attackerWinChance)}% of the time${odds.defenseBonus?` · industry adds ${odds.defenseBonus} to the top defender die`:''}.`));
  }
  else if(mine && active() && compact.matches && freeTroops(id)>0 && rallyFrom!==id)status.append(...sendList(id));
  else if(mine && active())status.append(el('span','card-hint',rallyFrom===id?'Tap one of your provinces to rally new troops there.':freeTroops(id)>0?'Drag to any target — or tap it — to send troops.':'Only one troop here: it must stay home.'));
  else if(!mine && !spectating && state.you)status.append(el('span','card-hint',friendlyLand(id) || ownBorder(id)?`None of your provinces can reach ${place(id).name}.`:`You have no province bordering ${place(id).name}. Take or hold a province next to it first.`));
  const actions=[];
  if(mine && active() && p.development<state.rules.maxDevelopment){
    const cost=state.rules.developmentCosts[p.development],queued=state.orders.some(o=>o.type==='develop' && o.from===id);
    const free=freeTroops(id),short=!p.developing && !queued && free<cost;
    actions.push({label:p.developing?`Building level ${p.developing.level} · ${Math.max(0,p.developing.completesAt-state.tick)}s`:queued?'Construction queued':short?`Needs ${cost} · you have ${free}`:`Develop · ${cost} troops`,act:'develop',arg:id,disabled:Boolean(p.developing) || queued || freeTroops(id)<cost || pendingCommand,id:'develop-province'});
  }
  if(mine && active()){
    const rally=rallyOf(id);
    actions.push({label:rallyFrom===id?'Tap your rally province…':rally?`${rallyText(rally)} · change`:'Rally troops to…',act:'rally-pick',arg:id,id:'rally-province',disabled:pendingCommand});
    if(rally)actions.push({label:'Clear rally',act:'rally-clear',arg:id,id:'rally-clear',disabled:pendingCommand});
    // Troops that left (or are about to leave) this province: recall them from here too.
    const outgoing=[...state.orders.filter(o=>o.type==='march' && o.from===id).map(o=>({id:o.id,amount:o.amount,to:o.to,queued:true})),
      ...state.armies.filter(a=>a.country===state.you && (a.path?a.origin:a.from)===id && !a.returning && !recallOption(a)?.queued).map(a=>({id:a.id,amount:a.amount,to:a.path?.at(-1) || a.to}))];
    // Troops coming home here (recalled or turned back): send them back toward their target.
    const homing=state.armies.filter(a=>a.to===id && resumeOption(a) && !resumeOption(a).queued).map(a=>({id:a.id,amount:a.amount,to:a.resume.target,turn:true,spent:resumeOption(a).spent}));
    for(const o of [...homing,...outgoing].slice(0,2))actions.push(o.turn?{label:`March again ${o.amount} → ${place(o.to).name}`,act:'turn',arg:o.id,disabled:pendingCommand || o.spent}
      :{label:`${o.queued?'Cancel':'Recall'} ${o.amount} → ${place(o.to).name}`,act:'recall',arg:o.id,disabled:pendingCommand});
  }
  return {...base,sub:[owner && !mine?ownerButton(owner):el('span','card-meta',mine?'Your province':'Unclaimed'),el('span','card-meta',`${p.troops} troops${owner?` · industry ${'ⅠⅡⅢⅣⅤ'[p.development-1] || p.development}`:''}`)],subKey:[owner,relationOf(owner),p.troops,p.development,mine],
    status,statusKey:[battle && [battle.province,p.troops,state.armies.filter(a=>a.engaged && a.to===id).reduce((n,a)=>n+a.amount,0)],mine,freeTroops(id)>0,state.armies.filter(a=>a.engaged && a.to===id).length,rallyFrom===id,mine && active() && compact.matches?sendChoices(id).map(c=>[c.id,c.line]):null],relation:mine?'own':'',actions,more:()=>moreProvince(id,false)};
}
/** Phones: where this province's troops can go, most relevant first (attacks on enemies at war with you or on unclaimed
 * land, by capture chance; your provinces under attack or on the front line), as big rows. A row is the same as tapping
 * that province on the map: a finger never has to hit a small counter. Neutral countries (a declaration) stay on the map. */
function sendChoices(from){
  const enemies=relationsOf(state,state.you).enemies,amount=amountFor(from),rows=[];
  const frontLine=id=>neighbours(id).some(n=>enemies.includes(prov(n)?.owner));
  for(const id of reachable(from)){
    const p=prov(id),route=routeOf(from,id);if(!p || !route)continue;
    if(friendlyLand(id)){
      const attacked=state.armies.some(a=>(a.path?.at(-1) || a.to)===id && !a.returning && !sameSide(a.country,state.you));
      if(!attacked && !frontLine(id))continue;
      rows.push({id,score:attacked?.95:.6,travel:route.travel,verb:'Reinforce',line:`${attacked?'under attack':'front line'} · ${route.travel+1}s`});
    }else if(!p.owner || enemies.includes(p.owner)){
      const odds=Math.round(100*combatForecast(amount,p.troops,p.development).attackerWinChance);
      rows.push({id,score:odds/100,travel:route.travel,verb:p.owner?'Attack':'Take',line:`${p.troops} defenders · ${odds}% with ${amount}`});
    }
  }
  // Best chances first (a province under attack counts as .95, the front line as .6), then the nearest.
  return rows.sort((a,b)=>b.score-a.score || a.travel-b.travel).slice(0,innerHeight<800?2:innerHeight<820?3:4);  // shorter phones and landscape: fewer rows, so the map, its camera and the card's own actions (cancel, recall) keep their room
}
function sendList(from){
  const rows=sendChoices(from),list=el('div','send-list');list.setAttribute('role','group');list.setAttribute('aria-label','Send troops to');
  for(const r of rows){
    const b=button('',{pickTarget:r.id},`send-row${r.verb==='Reinforce'?'':' attack'}`),owner=prov(r.id).owner;
    b.append(owner?flag(owner):el('span','flag'));
    const words=el('span','send-words');words.append(el('b','',`${r.verb} ${place(r.id).name}`),el('small','',r.line));b.append(words,el('span','send-go','›'));
    list.append(b);
  }
  return [...(rows.length?[list]:[]),el('span','card-hint',rows.length?'Or tap any target on the map (or drag from this counter).':'Tap a target on the map (or drag from this counter).')];
}
/** "More": the advanced details under the expanded card. */
function moreProvince(id,order){
  const p=prov(id),mine=p.owner===state.you && state.you;
  const waves=state.armies.filter(a=>(a.path?.at(-1) || a.to)===id).sort((a,b)=>a.arrivesAt-b.arrivesAt);
  const lastBattle=history.filter(e=>e.type==='battle' && e.province===id).at(-1);
  const key=JSON.stringify([id,order,sources,state.tick,fraction,state.orders,mine && p.troops]);
  const body=$('card-body');if(body.dataset.key===key)return;body.dataset.key=key;
  // Keyed parts (one element each): a tick replaces only the parts whose text changed, so an open destination list,
  // focus and a button under the finger survive polling.
  const parts=[],add=(k,html)=>parts.push({key:k,html});
  if(order){
    const known=marchPlan.key===JSON.stringify(marchAction())?planDetails(marchPlan.result):null;
    const previous=known ?? ($('order-details')?.dataset.for===`${sources.join()}>${id}`?$('order-details').innerHTML:null); // server text, escaped when written
    add('order',`<p id="order-details" class="order-details" data-for="${esc(`${sources.join()}>${id}`)}">${previous ?? 'Checking the route and the garrison…'}</p>`);
  }else if(mine){
    const reserved=state.orders.filter(o=>o.from===id && ['march','develop'].includes(o.type)).reduce((n,o)=>n+o.amount,0);
    add('readout',`<div class="province-readout"><div><span>FREE</span><strong>${freeTroops(id)}</strong></div><div><span>GARRISON</span><strong>${p.troops}</strong></div><div><span>RECRUIT IN</span><strong>${p.nextRecruit===null?'—':Math.max(0,p.nextRecruit-state.tick)+'s'}</strong></div></div>`);
    if(reserved)add('reserved',`<p class="small muted">${reserved} troops reserved for queued orders.</p>`);
    const rally=rallyOf(id);
    add('rally',`<p class="small" id="rally-status">${rally?esc(rallyText(rally)):'No rally point. “Rally troops to…”, then tap one of your provinces: new troops from here march there at each recruitment.'}</p>`);
    const f=developmentForecast(state,id);
    if(f)add('payback',`<p id="development-payback" class="development-payback">${f.alreadyInvested?'Investment already spent. ':''}Develop to level ${f.level} for ${f.cost} troops. Earliest payback ${time(f.paybackAt)} game time; up to ${f.additionalRecruits} extra recruits by ${time(state.rules.duration)} (net ${f.netBeforeDeadline>=0?'+':''}${f.netBeforeDeadline}). ${f.paysBackBeforeDeadline?'':'This will not repay before the deadline. '}${esc(f.assumption)}</p>`);
  }
  const fight=state.battles?.find(b=>b.province===id);
  if(fight?.rounds?.length){
    add('rounds-title',`<h3>${esc(place(id).name)} · battle rounds</h3>`);
    add('rounds',`<div class="battle-rolls">${fight.rounds.slice(-6).reverse().map(r=>`<p class="small"><time>${time(r.tick)}</time> attack ${r.attackDice.join(' ')} · defence ${r.defendDice.join(' ')} — attackers −${r.attackerLoss}, defenders −${r.defenderLoss}</p>`).join('')}</div>`);
  }
  add('incoming-title',`<h3>${esc(place(id).name)} · incoming</h3>`);
  if(!waves.length)add('incoming-none','<p class="small muted">No armies on the way.</p>');
  for(const a of waves.slice(0,4))add(`incoming:${a.id}`,`<p class="small">${a.amount} ${esc(country(a.country).name)} · ${a.returning?'returning':'marching'} · arrives ${time(a.arrivesAt)} (${Math.max(0,a.arrivesAt-state.tick)}s)</p>`);
  if(waves.length>4)add('incoming-more',`<p class="small">Plus ${waves.length-4} later armies.</p>`);
  if(lastBattle)add('last-battle',`<p class="small muted">Last battle ${time(lastBattle.tick)}: ${lastBattle.troops} survivors; ${esc(country(lastBattle.owner)?.name || 'neutral')} held afterward.</p>`);
  const orders=active()?marchRows():[];
  if(orders.length){add('orders-title',`<h3>Your orders <span class="count">${orders.filter(r=>!r.key.startsWith('group:')).length}</span></h3>`);add('orders','<div class="march-list"></div>');}
  if(active() && order===false && mine){
    const open=document.activeElement?.id==='destination' && body.contains(document.activeElement)?document.activeElement.parentElement.__html:null;
    add('destination',open ?? `<label class="keyboard-select">Keyboard: send to<select id="destination"><option value="">Choose a destination…</option>${reachable(id).map(n=>`<option value="${esc(n)}">${esc(place(n).name)} · ${prov(n).troops} · ${esc(country(prov(n).owner)?.name || 'Unclaimed')}</option>`).join('')}</select></label>`);
  }
  if(body.firstElementChild && body.firstElementChild.__key===undefined)body.replaceChildren(); // the alliance-offer form was here
  const scroll=body.scrollTop;patchList(body,parts);if(orders.length)patchList(body.querySelector('.march-list'),orders);body.scrollTop=scroll;
  if(order)updatePreview();
}
/** "Your orders" under the expanded card: queued orders and moving armies, one keyed row each. */
function marchRows(){
  const moving=state.armies.filter(a=>a.country===state.you).sort((a,b)=>a.arrivesAt-b.arrivesAt),queued=state.orders;
  const can=!pendingCommand;
  const recall=(id,label)=>`<button type="button" data-recall="${esc(id)}" ${can?'':'disabled'}>${label}</button>`;
  const again=a=>{const o=resumeOption(a);return !o || o.queued?'':`<button type="button" data-turn="${esc(a.id)}" ${can && !o.spent?'':'disabled'} title="${o.spent?esc(o.why):''}">March again</button>`;};
  const groups=[...new Set([...moving,...queued].filter(a=>a.groupId && !a.returning).map(a=>a.groupId))].filter(id=>[...moving,...queued].filter(a=>a.groupId===id && !a.returning).length>1);
  const where=a=>a.path?.at(-1) || a.to;
  return [...groups.map(id=>{const cols=[...moving,...queued].filter(a=>a.groupId===id && !a.returning);return {key:`group:${id}`,html:`<div class="march-row"><span>Marching together<small>${cols.length} columns → ${esc(place(where(cols[0])).name)}</small></span>${recall(id,'Recall group')}</div>`};}),
    ...queued.map(o=>({key:`order:${o.id}`,html:`<div class="march-row"><span>${o.type==='recall'?'Recall queued':o.type==='turn_around'?'March again queued':o.type==='develop'?'Construction queued':o.type==='rally'?'Rally order queued':`${o.amount} · ${esc(place(o.from).name)} → ${esc(place(o.to).name)}`}<small>${Math.max(0,o.executeAt-state.tick)}s until ${o.type==='march'?'departure':'it takes effect'}</small></span>${o.type==='march'?recall(o.id,'Cancel'):''}</div>`})),
    ...moving.map(a=>({key:`army:${a.id}`,html:`<div class="march-row ${a.returning?'returning':''}"><button class="march-focus" data-feed-province="${esc(where(a))}"><b>${a.amount}</b> ${a.returning?'↶':'→'} ${esc(place(where(a)).name)}<small>${a.returning?'Returning · ':''}arrives ${time(a.arrivesAt)} · ${Math.max(0,a.arrivesAt-state.tick)}s</small></button>${a.returning?again(a):recallOption(a)?.queued?'':recall(a.id,'Recall')}</div>`}))];
}
function armyCard(){
  const a=state.armies.find(a=>a.id===card.id),option=recallOption(a),again=resumeOption(a),dest=a.path?.at(-1) || a.to;
  const status=el('div','card-relation');status.append(el('b',`rel ${a.returning?'rel-ally':'rel-war'}`,a.returning?'RETURNING':a.engaged?'IN BATTLE':'MARCHING'),el('span','',`${place(a.from).name} → ${place(dest).name} · ${a.path && !a.returning?'next stop':'arrives'} in ${Math.max(0,a.arrivesAt-state.tick)}s (${time(a.arrivesAt)})`));
  const group=a.groupId && state.armies.filter(x=>x.groupId===a.groupId && !x.returning).length>1;
  let actions=[];
  if(option?.queued || again?.queued)status.append(el('span','card-hint',again?'Marching again: they turn at the next game second.':'Recall queued: they turn at the next game second.'));
  else if(option){
    actions=[{label:option.label,act:'recall',arg:a.id,primary:true,disabled:pendingCommand,id:'primary'},...(group?[{label:'Recall the whole march',act:'recall',arg:a.groupId}]:[])];
    status.append(el('span','card-hint',option.preview));
  }else if(again){
    if(!again.spent)loadTurnPlan(a);
    actions=[{label:again.label,act:'turn',arg:a.id,primary:true,disabled:pendingCommand || again.spent || Boolean(again.plan?.error),id:'primary'}];
    status.append(el('span','card-hint',again.why || resumePreview(a,again)));
  }
  return {flag:a.country,title:`${a.amount} ${faction(a.country).short} troops`,sub:[ownerButton(a.country)],subKey:[a.country,relationOf(a.country)],status,
    statusKey:[a.returning,a.engaged,a.arrivesAt,state.tick,option?.label,option?.queued,again?.label,again?.queued,again?.why,again?.plan?.result?.battleInProgress],relation:'',actions};
}
function countryCard(){
  const id=card.id,p=playerOf(id),c=country(id),rel=relationOf(id),me=myPlayer();
  const land=state.provinces.filter(v=>v.owner===id),troops=land.reduce((n,v)=>n+v.troops,0)+state.armies.filter(a=>a.country===id).reduce((n,a)=>n+a.amount,0);
  const side=p && !p.side.startsWith('solo:')?state.sides.find(s=>s.id===p.side):null;
  const status=el('div','card-relation big');status.append(el('b',`rel rel-${rel}`,RELATION_WORDS[rel] || c.name));
  const strength=el('span','card-strength',`${troops} troops · ${land.length} provinces (${(100*land.length/state.provinces.length).toFixed(1)}%)`);
  status.append(strength);
  if(side){const s=el('span','card-bloc');const dot=el('i','alliance-dot');dot.style.setProperty('--band',allianceColors(state)[side.id]);s.append(dot,el('span','',`${side.name}: ${side.members.map(m=>country(m).name).join(', ')}`));status.append(s);}
  const enemies=p?relationsOf(state,id).enemies:[];
  if(enemies.length)status.append(el('span','card-wars',`At war with ${enemies.map(e=>e===state.you?'you':country(e).name).join(', ')}`));
  const truce=state.you && id!==state.you?truceUntil(state,state.you,id):null;
  if(truce!==null)status.append(el('span','card-truce',`Truce until ${time(truce)}`));
  const actions=[],can=active() && p && p.eliminatedAt===null && id!==state.you;
  const offer=(state.proposals || []).find(q=>q.status==='open' && state.you && q.roster.includes(state.you) && q.roster.includes(id));
  const peaceFrom=state.peaceOffers?.find(o=>o.toRoster.includes(state.you) && o.fromRoster.includes(id));
  const peaceTo=state.peaceOffers?.find(o=>o.fromRoster.includes(state.you) && o.toRoster.includes(id));
  let note='';
  if(can){
    if(offer){
      const f=allianceForecast(state,offer.roster);
      note=`${offer.name}: ${offer.roster.map(r=>country(r).name).join(' + ')} · ${offer.accepted.length}/${offer.roster.length} accepted · ${Math.max(0,offer.expiresAt-state.tick)}s left. Together: ${f.economy}/${f.threshold} industry to win.`;
      if(offer.accepted.includes(state.you))actions.push({label:offer.creator===state.you?'Withdraw offer':'Withdraw approval',act:'decline',arg:offer.id});
      else actions.push({label:'Accept alliance',act:'accept',arg:offer.id,primary:true,disabled:pendingCommand,id:'primary'},{label:'Decline',act:'decline',arg:offer.id,disabled:pendingCommand});
    }else if(peaceFrom)actions.push({label:'Accept peace',act:'accept-peace',arg:peaceFrom.id,primary:true,disabled:pendingCommand,id:'primary'});
    else if(peaceTo){note=`Peace offered: they have until ${time(peaceTo.expiresAt)} to accept.`;actions.push({label:'Message',act:'compose',primary:true,id:'primary'});}
    else if(rel==='war')actions.push({label:'Offer peace',act:'peace',arg:id,primary:true,disabled:pendingCommand,id:'primary'});
    else if(rel==='forming'){const q=state.proposals.find(q=>q.status==='pending' && q.roster.includes(id) && q.roster.includes(state.you));note=`${q.name} starts at ${time(q.activateAt)}.`;actions.push({label:'Message',act:'compose',primary:true,id:'primary'});}
    else if(rel==='ally'){actions.push({label:'Message',act:'compose',primary:true,id:'primary'},{label:'Leave alliance',act:'leave',danger:true,disabled:pendingCommand || state.departures?.some(d=>d.country===state.you)});}
    else if(rel==='neutral'){
      const size=state.players.filter(x=>x.side===me.side).length+1,full=size>state.maxAlliance;
      const canPropose=p.side.startsWith('solo:') && !(state.proposals || []).some(q=>q.status==='pending' && (q.roster.includes(id) || q.roster.includes(state.you)));
      if(canPropose)actions.push({label:proposing?'Send alliance offer':'Propose alliance',act:proposing?'send-offer':'propose',primary:!full,disabled:pendingCommand || full,id:full?undefined:'primary'});
      if(canPropose && full)note=state.maxAlliance<2?'Alliances need at least four countries in the match.':`An alliance holds at most ${state.maxAlliance} countries.`;
      else if(!canPropose)note=side?`${c.name} is in ${side.name}. Ask a member to invite you, or talk first.`:'A membership change is already pending.';
      actions.push(truce!==null?{label:`Truce until ${time(truce)}`,act:'declare',arg:id,disabled:true}:{label:'Declare war',act:'declare',arg:id,danger:true,disabled:pendingCommand});
      if(!actions.some(a=>a.primary))actions.unshift({label:'Message',act:'compose',primary:true,id:'primary'});
    }
  }
  if(note)status.append(el('small','card-note',note));
  const sub=[el('span','card-meta',p?`${seatType(p)} · ${p.displayName || p.name}`:'Unclaimed')];
  // Talking lives in Messages: a secondary "Message" opens the thread with this country.
  if(can && !actions.some(a=>a.act==='compose'))actions.push({label:'Message',act:'compose'});
  return {flag:id,title:c.name,sub,subKey:[p?.displayName,p?.name,seatType(p)],status,statusKey:[rel,troops,land.length,side?.id,side?.name,side?.members,enemies,note,truce],relation:rel,
    more:proposing && can?()=>renderProposal(id):null,actions};
}
function proposalForm(id){
  const me=myPlayer(),joining=me.side.startsWith('solo:');
  const f=allianceForecast(state,[...state.players.filter(p=>p.side===me.side).map(p=>p.id),id]);
  const box=el('div','proposal');
  if(joining){
    const label=el('label','', 'Alliance name');const input=el('input');input.id='coalition-name';input.maxLength=40;input.value=$('coalition-name')?.value || `${faction(state.you).short}–${faction(id).short} Pact`;label.append(input);box.append(label);
  }else box.append(el('p','small',`${country(id).name} would join ${namedSide(me.side)}; every member must accept.`));
  box.append(el('p','small muted',`Together: ${f.economy}/${f.threshold} industry to win, and every member wins. Sending is your approval; the alliance starts ${state.rules.notice} game seconds after everyone accepts.`));
  return box;
}
function allianceCard(){
  const me=myPlayer();
  if(!me || spectating){return {title:'Spectating',status:el('div','card-relation',''),actions:[]};}
  const side=!me.side.startsWith('solo:')?state.sides.find(s=>s.id===me.side):null,forming=(state.proposals || []).find(q=>q.status==='pending' && q.roster.includes(state.you));
  const team=state.sides.find(s=>s.id===me.side),enemies=relationsOf(state,state.you).enemies;
  const status=el('div','card-relation big');
  status.append(el('b',`rel ${side?'rel-ally':'rel-neutral'}`,side?'ALLIANCE':forming?'FORMING':'INDEPENDENT'));
  status.append(el('span','card-strength',`${team?.economy ?? 0}/${state.economyThreshold} industry to win`));
  if(forming)status.append(el('small','card-note',`${forming.name} starts at ${time(forming.activateAt)}.`));
  const wars=el('div','card-wars');
  wars.append(el('span','',enemies.length?'At war with ':'At peace with everyone.'),...enemies.map(e=>{const b=button(country(e).name,{openCountry:e},'link');return b;}));
  status.append(wars);
  const members=side?side.members:[];
  const list=el('div','card-members');
  if(!side)status.append(el('small','card-note','You are independent. Select a country — a standard on the leaderboard or a province’s owner — to propose an alliance.'));
  for(const m of members){const b=button('',{openCountry:m},'member');b.append(flag(m),el('span','',country(m).name));if(m===state.you)b.disabled=true;list.append(b);}
  status.append(list);
  const actions=side && active()?[{label:'Alliance chat',act:'compose',primary:true,id:'primary'},{label:'Leave alliance',act:'leave',danger:true,disabled:pendingCommand || state.departures?.some(d=>d.country===state.you)}]:[];
  return {flag:state.you,title:side?side.name:country(state.you).name,sub:[el('span','card-meta',side?`${side.members.length} members · your alliance`:'Your country · no alliance')],subKey:[side?.id,side?.members.length],
    status,statusKey:[side?.id,side?.name,members,team?.economy,state.economyThreshold,forming?.id,enemies],relation:side?'ally':'',more:null,actions};
}
/** The alliance-offer form (name + terms) in the expanded country card. */
function renderProposal(id){
  const body=$('card-body'),key=`proposal:${id}`;if(body.dataset.key===key)return;
  body.dataset.key=key;body.replaceChildren(proposalForm(id));
}

/* ── HUD ── */
function renderHud(){
  const me=myPlayer(),team=state.sides.find(s=>s.id===me?.side);
  const land=state.provinces.filter(p=>p.owner===state.you && state.you);
  const troops=land.reduce((n,p)=>n+p.troops,0)+state.armies.filter(a=>a.country===state.you).reduce((n,a)=>n+a.amount,0);
  const enemies=me?relationsOf(state,state.you).enemies.length:0;
  setText($('commander-title'),state.you?(compact.matches?faction(state.you).short:country(state.you).name):(state.status==='running'?'Spectating':'Observer'));
  setHTML($('commander-insignia'),insignia(state.you));
  setText($('commander-side'),me?(me.eliminatedAt!==null?'Fallen':`${me.side.startsWith('solo:')?'Independent':namedSide(me.side)}${enemies?` · at war with ${enemies}`:''}`):'Watching');
  if($('hud-standard').disabled!==(!me || spectating))$('hud-standard').disabled=!me || spectating;
  setAttr($('hud-standard'),'aria-label',me && !spectating?`${country(state.you).name}: your alliance and diplomacy`:'Spectating');
  const economy=team?.economy ?? 0,threshold=state.economyThreshold || 1;
  const stat=(name,label,value,title,extra='')=>`<span class="stat" title="${esc(title)}">${icon(name)}<span><b>${value}</b><small>${esc(label)}</small></span>${extra}</span>`;
  const holdings=state.you?land.length:state.provinces.filter(p=>p.owner).length,forces=state.you?troops:state.provinces.reduce((n,p)=>n+p.troops,0);
  setHTML($('operations'),stat('troops',state.you?'troops':'troops on the map',forces,state.you?'Your troops: garrisons and armies':'All garrisoned troops')+
    stat('land','provinces',`${holdings}<small>/${state.provinces.length}</small>`,`${state.you?'Your provinces':'Provinces held'}: ${holdings} of ${state.provinces.length}`)+
    (me?stat('industry','industry to win',`${economy}<small>/${threshold}</small>`,`Your side's industry: ${economy} of the ${threshold} needed`,`<i class="gauge"><i style="width:${Math.min(100,Math.round(100*economy/threshold))}%"></i></i>`):''));
  const dominant=Object.entries(state.dominance)[0];
  document.querySelector('.clock-plaque').classList.toggle('victory-warning',Boolean(dominant) && state.status==='running');
  const leader=[...state.sides].sort((a,b)=>b.economy-a.economy)[0];
  setText($('victory-status'),dominant && state.status==='running'?`${namedSide(dominant[0])} wins in ${state.rules.hold-(state.tick-dominant[1])}s unless stopped`:
    leader?`Win: ${threshold} industry for ${state.rules.hold}s · ${namedSide(leader.id)} leads with ${leader.economy}`:`${threshold} industry held ${state.rules.hold}s wins`);
}

/* ── Rendering ── */
function describe(e){
  const c=id=>country(id)?.name || id;
  switch(e.type){
    case 'joined':return`${e.name} takes ${c(e.country)}.`;
    case 'seat_claimed':return`${e.name} takes command of ${c(e.country)} from a bot.`;
    case 'started':return'The match begins. Armies may move.';
    case 'army_departed':return`${c(e.country)} commits ${e.amount} troops: ${place(e.from).name} → ${place(e.to).name}.`;
    case 'development_started':return`${c(e.country)} invests ${e.cost} manpower in ${place(e.province).name}; level ${e.level} completes at ${time(e.completesAt)}.`;
    case 'development_completed':return`${place(e.province).name} reaches industrial level ${e.level}.`;
    case 'army_recalled':return`${c(e.country)} ${e.reason?'turns back':'recalls'} ${e.amount} troops${e.province?` from ${place(e.province).name}`:''}; return to ${place(e.to).name} at ${time(e.arrivesAt)}.`;
    case 'army_turned_around':return`${c(e.country)} sends ${e.amount} troops back toward ${place(e.to).name}; they arrive at ${time(e.arrivesAt)}.`;
    case 'army_interned':return`${e.amount} troops from ${c(e.country)} cannot return through ${place(e.province).name}.`;
    case 'battle':return`${place(e.province).name}: ${e.owner!==e.previousOwner?`${c(e.owner)} captures it`:'defenders retain ownership'}; ${e.troops} troops remain.`;
    case 'alliance_notice':return`${e.name}: coalition change confirmed; activates at ${time(e.activateAt)}.`;
    case 'alliance_activated':return`${e.name} is active: ${e.roster.map(c).join(', ')}.`;
    case 'coalition_dissolved':return'An alliance has dissolved.';
    case 'war_declared':return`${c(e.country)} declares war: ${e.fromRoster.map(c).join(' + ')} against ${e.toRoster.map(c).join(' + ')}.`;
    case 'peace_accepted':return`${e.fromRoster.map(c).join(' + ')} and ${e.toRoster.map(c).join(' + ')} agree to peace; attacking troops return${e.truceUntil?`; truce until ${time(e.truceUntil)}`:''}.`;
    case 'peace_offered':return`${c(e.by)} offers peace: ${e.fromRoster.map(c).join(' + ')} to ${e.toRoster.map(c).join(' + ')}, open until ${time(e.expiresAt)}.`;
    case 'peace_expired':return`A peace offer closed: ${e.reason}`;
    case 'departure_notice':return`${c(e.country)} announces a departure at ${time(e.activateAt)}.`;
    case 'departed':return`${c(e.country)} is now independent.`;
    case 'eliminated':return`${c(e.country)} is eliminated.`;
    case 'order_failed':return`Order failed: ${e.reason}`;
    case 'proposal_cancelled':return`Alliance offer cancelled: ${e.reason}`;
    case 'dominance':return`${namedSide(e.side)} begins the victory countdown.`;
    case 'finished':return e.draw?'The match ends in a draw.':`${namedSide(e.winningSide)} wins.`;
    default:return null;
  }
}
function renderResult(){
  if(!state.outcome){$('result').hidden=true;return;}
  $('result').hidden=false;document.body.classList.add('reviewing');placeSound();closeCard();
  if(!review || review.id!==state.id){review?.destroy();review=new AfterAction($('result'),state,map);}
}
/** Forget the room on screen (another room, home, a new identity): stop polling; drop its review, events, banners,
 * messages and notices. */
function leaveRoom(){
  generation++;pollController?.abort();review?.destroy();review=null;
  signalCursor=null;clearTimeout(toastTimer);$('toast').hidden=true;toggleJournal(false);
  herald.reset();comms.reset();comms.room=null;messageCatchupComplete=false;cursor=0;history=[];pastSides.clear();turnedBack.clear();
}
/** The lobby: a dossier and a rack of standards. */
function renderLobby(){
  const chosen=$('country-choice').value;
  // The host of a room full of practice bots may take one of those seats (before the start).
  const claimable=p=>state.isHost && !state.you && p?.kind==='bot';
  for(const b of $('faction-choices').querySelectorAll('button')){
    const id=b.dataset.countrySeat,occupant=state.players.find(p=>p.id===id);
    b.disabled=Boolean(occupant) && !claimable(occupant);b.setAttribute('aria-pressed',String(chosen===id || occupant?.id===state.you && Boolean(state.you)));
    const who=occupant?`${seatType(occupant)} · ${occupant.displayName || occupant.name}`:'';
    const text=occupant?(claimable(occupant)?`${who} · take over`:who):`${country(id).start.length} holdings`;
    b.title=occupant?text:startingSummary(country(id));b.querySelector('small').textContent=text;
  }
  $('lobby').hidden=state.status!=='lobby';$('join-form').hidden=Boolean(state.you);
  if(chosen && state.players.some(p=>p.id===chosen && !claimable(p)))$('country-choice').value='';
  $('host-controls').hidden=!state.isHost;$('fill-bots').disabled=state.players.length===8 || !state.you && !$('country-choice').value;$('start-match').disabled=state.players.length<2;$('start-match').textContent=state.you?'Start match':'Start and watch';
  $('fill-bots').textContent=state.you?'Fill empty seats with bots':'Take this seat and fill the rest with bots';
  const selected=country(state.you || $('country-choice').value);
  const head=selected?`${insignia(selected.id)}<div><h3>${esc(selected.name)}</h3><p>${state.you?'Your country':'Open seat'}</p></div>`:`${insignia(null)}<div><h3>Pick a standard</h3><p>Choose an open country from the rack.</p></div>`;
  if($('dossier-head').dataset.key!==head){$('dossier-head').dataset.key=head;setHTML($('dossier-head'),head);} // country names are authored map data
  $('starting-holdings').textContent=selected?startingSummary(selected):'Industrial homelands, colonial footholds. Unequal strengths, the same rules.';
  $('join-form').querySelector('button').disabled=!country($('country-choice').value);
  $('lobby-note').textContent=state.you?`You command ${country(state.you).name}. ${state.isHost?'Invite players, attach agents or add bots, then start.':'Waiting for the host to start.'}`:state.isHost && state.players.length===8 && state.players.some(p=>p.kind==='bot')?'Bots fill every seat. Choose one to take command, then start.':`${state.players.length}/8 seats taken. ${state.isHost?'Choose an open country to join, or start and watch.':'Choose an open country to join.'}`;
}
/** How to play (☰ menu): the whole rulebook on one screen, with this room's numbers. */
function renderRules(){
  const r=state.rules,box=$('how-to-play'),key=JSON.stringify(r);if(box.dataset.key===key)return;box.dataset.key=key;
  const span=t=>t%60?`${t} s`:`${t/60} min`;
  box.replaceChildren(...[
    ['Goal',`Hold ${Math.round(r.economyShare*100)}% of the world's industry with your alliance for ${r.hold} s. If nobody does by ${time(r.duration)}, the side with the most industry wins; a tie is a draw. You must own a province at the finish to share a win or draw.`],
    ['Troops',`Each province makes troops every ${r.recruit} s: 1, 2 or 3 by its industry level.`],
    ['March','Drag from your province to any target, or tap one, then the other. Tap more of your provinces to attack together: they arrive at the same moment. Troops travel through your and your allies’ land, twice as fast inside it. Always leave one troop at home.'],
    ['Battle',`Arriving attackers fight dice rounds until one side is gone. Defenders win ties, and a factory (industry II or III) gives them +1. Send help, recall an army to bring it home, or send a returning army back to its target (march again, ${timesWord(r.maxTurnArounds)} per army).`],
    ['Rally','Pick a province and a rally point: its new troops march there by themselves.'],
    ['Build',`Spend troops to raise a province’s industry: I→II costs ${r.developmentCosts[1]} (${span(r.developmentTicks[1])}), II→III costs ${r.developmentCosts[2]} (${span(r.developmentTicks[2])}). Capture takes the factory; unfinished work is lost.`],
    ['War and peace',`Declare war before attacking another country: the whole of both alliances goes to war. Anyone can offer peace; anyone on the other side can accept within ${r.peaceLife} s. Peace brings a ${r.truce} s truce: neither side can declare war on the other until it ends.`],
    ['Alliances',`Propose to a country; the alliance starts ${r.notice} s after everyone accepts. Leaving also takes ${r.notice} s. An alliance holds at most three countries, and never more than half the match. Promises in chat are not orders.`],
  ].map(([title,text])=>{const li=el('li');li.append(el('b','',`${title}. `),text);return li;}));
}
/** One sound control: in the ☰ menu during a live room, in the masthead on the home page and in review. */
function placeSound(){
  const slot=matchId && !document.body.classList.contains('reviewing')?$('hud-sound-slot'):$('masthead-sound-slot');
  if($('sound-control').parentElement!==slot)slot.append($('sound-control'));
}
function render(){
  if(!state)return;
  document.body.classList.toggle('spectating',state.status==='running' && (!state.you || spectating));
  setAttr(document.body,'data-status',state.status);
  if(state.status!=='running' && card)closeCard();
  setText(document.querySelector('.scenario-note'),map.notice);
  setText($('game-name'),state.name);setText($('lobby-room'),state.name);setText($('room-label'),`${state.players.length}/8 seats`);
  setHidden($('lobby'),state.status!=='lobby');if(state.status==='lobby')renderLobby();
  setText($('phase'),state.status==='lobby'?'Assembling':state.status==='finished'?'Concluded':seated()?'In session':'Watching');
  setText($('clock'),time(state.tick));setText($('clock-total'),`/ ${time(state.rules.duration)}`);
  renderRules();setText($('pace-badge'),state.speed===1?'Standard pace':`Quick · ${state.speed}×`);
  placeSound();
  paintMap();renderHud();renderResult();renderLeaderboard();renderJournal();
}
/** The war log (☰ → War log): drawn only while it is open. */
function renderJournal(){
  if($('war-journal').hidden)return;
  setHTML($('events'),history.map(e=>({e,description:describe(e)})).filter(x=>x.description).slice(-30).reverse().map(({e,description})=>`<div class="event"><time>${time(e.tick)}</time>${esc(description)}</div>`).join(''));
}
async function home(){leaveRoom();sounds.leave();closeCard();closeMenu();setSheet(null);expander.set(false,{fromBrowser:true});document.body.classList.remove('reviewing','spectating','in-game');document.body.dataset.screen='home';delete document.body.dataset.status;matchId=null;state=null;spectating=false;$('home').hidden=false;$('game').hidden=true;window.history.replaceState({},'','/');placeSound();await rooms();}

/* ── First-match coach marks: three tips, dismissible, stored per browser. ── */
const COACH=[['card-anchor','Tap your province, then any target — or drag from it to the target. Tap more of your provinces to attack together.'],
  ['leaderboard','Tap a country — a standard on the Powers list or a province’s owner — to talk, ally, declare war or make peace.'],
  ['hud-standard','The Messages button counts what needs you: red for decisions, brass for unread. Press C to open it.']];
let coachStep=-1;
function coachDone(){try{return localStorage.getItem('coi.coach')==='done';}catch{return true;}}
function coach(){
  if(coachStep>=0 || coachDone() || !state || state.status!=='running' || !active() || !messageCatchupComplete)return;
  coachStep=0;showCoach();
}
function showCoach(){
  const box=$('coach');if(coachStep<0 || coachStep>=COACH.length){box.hidden=true;return;}
  const [anchor,text]=COACH[coachStep];box.hidden=false;box.dataset.anchor=anchor;
  $('coach-step').textContent=`Tip ${coachStep+1} of ${COACH.length}`;$('coach-text').textContent=text;$('coach-next').textContent=coachStep===COACH.length-1?'Got it':'Next';
}
function endCoach(){coachStep=COACH.length;$('coach').hidden=true;try{localStorage.setItem('coi.coach','done');}catch{}}
$('coach-next').addEventListener('click',()=>{coachStep++;if(coachStep>=COACH.length)endCoach();else showCoach();});
$('coach-skip').addEventListener('click',endCoach);
$('coach-replay').addEventListener('click',()=>{closeMenu();try{localStorage.removeItem('coi.coach');}catch{}coachStep=-1;coach();});

/* ── Card actions ── */
async function perform(act,arg){
  switch(act){
    case 'send':return sendOrder();
    case 'select-bordering':return selectBordering(arg);
    case 'clear-selection':closeCard({restoreFocus:true});return;
    case 'develop':{
      const p=prov(arg),cost=state.rules.developmentCosts[p.development],f=developmentForecast(state,arg);
      if(!await confirmAction({title:`Develop ${place(arg).name}?`,message:`Spend ${cost} troops from this garrison. ${f?`Earliest payback ${time(f.paybackAt)}; ${f.paysBackBeforeDeadline?'it repays before the deadline':'it will not repay before the deadline'}.`:''} Unfinished construction is lost on capture; completed industry can be captured.`,accept:`Invest ${cost} troops`}))return;
      const r=await command({type:'develop',from:arg});if(r)toast(`Investment committed. Completion at ${time(r.completesAt)}.`);return;
    }
    case 'recall':{const r=await command({type:'recall',id:arg});if(r){toast('Recall queued. The troops turn where they are and head home.');if(card?.kind==='army')closeCard();}return;}
    case 'turn':{const r=await command({type:'turn_around',armyId:arg});if(r){toast(r.mode==='resume'?`Marching again → ${place(r.to).name}. Arrives ${time(r.arrivesAt)}.`:'Recall queued. The troops turn where they are and head home.');if(card?.kind==='army')closeCard();}return;}
    case 'rally-pick':{
      if(rallyFrom===arg){rallyFrom=null;renderCard();return;}
      rallyFrom=arg;toast(`Tap one of your provinces: new troops in ${place(arg).name} will march there.`);renderCard();paintMap();return;
    }
    case 'rally-clear':{const r=await command({type:'rally',from:arg,to:null});if(r)toast('Rally point cleared next tick.');return;}
    case 'compose':openMessages(card?.kind==='country'?`dm:${card.id}`:'alliance');return;
    case 'propose':proposing=true;setCardSize('full');$('card-body').dataset.key='';renderCard();$('coalition-name')?.focus();$('coalition-name')?.select();return;
    case 'send-offer':{
      const id=card.id,name=$('coalition-name')?.value || `${faction(state.you).short}–${faction(id).short} Pact`;
      const r=await command({type:'propose',country:id,name});if(r){proposing=false;$('card-body').dataset.key='';toast(`Offer sent to ${country(id).name}. You have approved it; the alliance starts after they accept and the notice passes.`);renderCard();}return;
    }
    case 'accept':{const r=await command({type:'accept',proposalId:arg});if(r)toast(r.status==='pending'?`Alliance agreed: it starts at ${time(r.activateAt)}.`:'Terms accepted; waiting for the other members.');return;}
    case 'decline':{const r=await command({type:'decline',proposalId:arg});if(r)toast('Offer closed.');return;}
    case 'declare':{
      const plan=warPlan(arg);if(!plan)return;
      if(!await confirmWar(arg,0,plan))return;
      const r=await command({type:'declare_war',country:arg});if(r)toast(`War declared on ${country(arg).name}.`);return;
    }
    case 'peace':{const r=await command({type:'offer_peace',country:arg});if(r)toast(`Peace offered: they have until ${time(r.expiresAt)} to accept.`);return;}
    case 'accept-peace':{const r=await command({type:'accept_peace',offerId:arg});if(r)toast('Peace agreed; attacking troops are returning.');return;}
    case 'leave':{if(!await confirmAction({title:'Leave your alliance?',message:`You become independent after ${state.rules.notice} game seconds. Armies use the allegiance in force when they arrive.`,accept:'Announce departure'}))return;const r=await command({type:'leave'});if(r)toast(`Departure announced: you are independent at ${time(r.activateAt)}.`);return;}
    default:return;
  }
}

/* ── Wiring ── */
// Phones: a tap on the map opens a sheet right under the finger, and the browser then fires its synthetic click for that
// same tap at the same point, on whatever is there *now*: the new sheet (it used to open the owner's country card or
// press a button). That one click is swallowed; the map itself already handled the tap through pointer events.
let mapTap=null;
document.addEventListener('pointerup',event=>{if(event.pointerType!=='mouse' && event.target.closest?.('#map'))mapTap={t:performance.now(),x:event.clientX,y:event.clientY};},true);
document.addEventListener('click',event=>{
  if(!mapTap)return;const tap=mapTap;mapTap=null;
  if(performance.now()-tap.t<750 && Math.hypot(event.clientX-tap.x,event.clientY-tap.y)<30 && !event.target.closest?.('#map')){event.preventDefault();event.stopImmediatePropagation();}
},true);
$('create-form').addEventListener('submit',safely(once(async()=>{await ensureIdentity($('display-name').value);const g=await request('/api/games','POST',{name:$('room-name').value,preset:$('preset').value});await openRoom(g.id);})));
$('join-form').addEventListener('submit',safely(once(async()=>{await ensureIdentity($('join-name').value);await request(`/api/games/${matchId}/join`,'POST',{country:$('country-choice').value,kind:'human'});await poll();toast('Your seat is reserved.');})));
$('fill-bots').addEventListener('click',safely(once(async()=>{await request(`/api/games/${matchId}/bots`,'POST',state?.you?{}:{country:$('country-choice').value});await poll();})));
$('start-match').addEventListener('click',safely(once(async()=>{await request(`/api/games/${matchId}/start`,'POST',{});await poll();toast('The match has begun.');})));
/** The share of free troops to send (slider or 25/50/75/100%), remembered per browser. */
function setFraction(f){fraction=Math.max(.01,Math.min(1,f));try{localStorage.setItem('coi.fraction',String(fraction));}catch{}if(state)renderCard();}
$('amount-slider').addEventListener('input',()=>setFraction(Number($('amount-slider').value)/100));
$('lb-toggle').addEventListener('click',()=>{
  const open=!standings.open;standings.setOpen(open);
  try{localStorage.setItem('coi.leaderboard',open?'open':'collapsed');}catch{}
});
for(const b of document.querySelectorAll('[data-lb-mode]'))b.addEventListener('click',()=>{standings.setMode(b.dataset.lbMode);if(state)renderLeaderboard();});
$('back').addEventListener('click',safely(home));$('refresh-rooms').addEventListener('click',safely(rooms));
for(const b of document.querySelectorAll('[data-share]'))b.addEventListener('click',safely(async()=>{closeMenu();try{await navigator.clipboard.writeText(location.href);toast('Room link copied.');}catch{prompt('Copy this room link:',location.href);}}));
const changeIdentity=safely(async()=>{closeMenu();const name=prompt('Play under a new name? Your results stay with the old one. New display name:');if(name?.trim()){await ensureIdentity(name,true);if(matchId)await poll();}});
$('account-button').addEventListener('click',changeIdentity);$('menu-identity').addEventListener('click',changeIdentity);
$('zoom-in').onclick=()=>atlas.zoom(.7);$('zoom-out').onclick=()=>atlas.zoom(1.4);
$('world-view').onclick=()=>{closeMenu();atlas.world();};$('europe-view').onclick=()=>{closeMenu();atlas.europe();};$('home-view').onclick=focusCountry;$('world-button').onclick=()=>atlas.world();
// Expand map: real fullscreen where available, a CSS pseudo-fullscreen otherwise (iPhone Safari).
expander=new ExpandableMap($('stage'),$('map-expand'),{label:'map',target:document.documentElement,escape:false,iconOnly:true,onChange:on=>{
  if(on && !fullscreenSupported() && !installed()){let told=false;try{told=localStorage.getItem('coi.install-tip')==='shown';localStorage.setItem('coi.install-tip','shown');}catch{}
    if(!told)toast(iOS()?'Safari keeps its bars on screen. For true full screen: Share → Add to Home Screen.':'For true full screen, add Council to your home screen (browser menu).');}
  $('fullscreen-toggle').setAttribute('aria-pressed',String(on));$('fullscreen-toggle').textContent=on?'Exit expanded map':'Expand map';
  requestAnimationFrame(()=>{atlas?.layout();syncInsets();});
}});
$('fullscreen-toggle').addEventListener('click',()=>{closeMenu();expander.toggle();});
/** Install on your phone (☰ → Map): the web app manifest opens the game full screen without browser bars. It is the only
 * real full screen on an iPhone, where Safari cannot hide its bars for a page (Expand then only gives the map more room). */
const installed=()=>matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || navigator.standalone===true;
const iOS=()=>/iP(hone|od|ad)/.test(navigator.userAgent) || navigator.platform==='MacIntel' && navigator.maxTouchPoints>1;
function installHint(){
  $('install-hint').textContent=installed()?'Running as an app: full screen, no browser bars.'
    :iOS()?'Full screen on iPhone: Share → Add to Home Screen, then open Council from the Home Screen.'
    :'Full screen without browser bars: browser menu ⋮ → Add to Home screen (Install app).';
}
installHint();
/* Menu, war log and the phones' Powers sheet share one place (the right column / the sheet): one at a time. */
function closeMenu(focus=false){
  if($('hud-menu').hidden)return;
  $('hud-menu').hidden=true;$('menu-button').setAttribute('aria-expanded','false');syncDock();if(focus)$('menu-button').focus();
  requestAnimationFrame(syncInsets);
}
function openMenu(){setSheet(null);if(compact.matches && comms.view!=='closed')comms.close();$('hud-menu').hidden=false;$('menu-button').setAttribute('aria-expanded','true');syncDock();$('hud-menu').querySelector('button').focus();}
function toggleJournal(open){
  $('war-journal').hidden=!open;$('journal-toggle').setAttribute('aria-expanded',String(open));if(open && state)renderJournal();
  if(open)$('journal-close').focus();requestAnimationFrame(syncInsets);
}
/** Phones: the Powers list is a sheet opened from the dock (null closes it). */
function setSheet(which){
  $('leaderboard').classList.toggle('sheet',which==='powers');
  if(which==='powers')standings.setOpen(true);
  syncDock();requestAnimationFrame(syncInsets);
}
function syncDock(){
  const sheet=$('leaderboard').classList.contains('sheet')?'powers':!$('hud-menu').hidden?'menu':'map';
  for(const b of document.querySelectorAll('[data-dock]'))b.setAttribute('aria-pressed',String(b.dataset.dock===sheet));
}
/** Open Messages on one conversation (a country card's "Message", your alliance chat). */
function openMessages(key){if(compact.matches){closeCard();setSheet(null);closeMenu();}comms.openThread(key,{focusComposer:true});}
$('menu-button').addEventListener('click',()=>{if($('hud-menu').hidden)openMenu();else closeMenu(true);});
$('menu-close').addEventListener('click',()=>closeMenu(true));
$('card-close').addEventListener('click',()=>closeCard({restoreFocus:true}));
$('card-size').addEventListener('click',()=>setCardSize(cardSize==='full'?'peek':'full'));
$('hud-standard').addEventListener('click',()=>{if(card?.kind==='alliance')closeCard({restoreFocus:true});else openCard('alliance',null,{focus:true});});
for(const b of document.querySelectorAll('[data-dock]'))b.addEventListener('click',()=>{
  const which=b.dataset.dock;closeCard();if(comms.view!=='closed')comms.close();
  if(which==='menu'){if($('hud-menu').hidden)openMenu();else closeMenu();return;}
  closeMenu();setSheet(which==='powers' && !$('leaderboard').classList.contains('sheet')?'powers':null);
});
// Phones: drag the sheet's head down to close it, up to expand it.
let sheetDrag=null;
$('card').querySelector('.card-plaque').addEventListener('pointerdown',event=>{if(!compact.matches || event.target.closest('button'))return;sheetDrag={y:event.clientY};});
$('card').querySelector('.card-plaque').addEventListener('pointerup',event=>{if(!sheetDrag)return;const dy=event.clientY-sheetDrag.y;sheetDrag=null;if(dy>40){if(cardSize==='full')setCardSize('peek');else closeCard();}else if(dy<-40)setCardSize('full');});
document.addEventListener('keydown',event=>{
  if(!state || document.body.classList.contains('reviewing') || event.ctrlKey || event.metaKey || event.altKey || $('confirm-dialog').open)return;
  const typing=event.target.closest('input,select,textarea,dialog');
  // Escape closes the top-most layer: coach tip, banner, menu, war log, Messages thread/panel, card, Powers sheet, expanded map.
  if(event.key==='Escape' && (!typing || event.target.closest('#card'))){
    if(event.target.closest('.cx-toast'))return; // the toast handles its own Escape (dismiss)
    if(!$('coach').hidden)endCoach();
    else if(herald.dismiss()){}
    else if(!$('hud-menu').hidden)closeMenu(true);
    else if(!$('war-journal').hidden){toggleJournal(false);$('menu-button').focus();}
    else if(comms.view==='thread' || comms.view==='list' && !comms.docked()){comms.key(event);}
    else if(card)closeCard({restoreFocus:true});
    else if($('leaderboard').classList.contains('sheet'))setSheet(null);
    else if(expander.on)expander.set(false);
    else{clearSelection();paintMap();}
    return;
  }
  if(typing)return;
  const key=event.key.toLowerCase();
  if(['c','j','k'].includes(key) && !event.shiftKey){if(key!=='c' && comms.view==='closed')return;if(comms.key(event))event.preventDefault();return;}
  if(key==='l'){toggleJournal($('war-journal').hidden);return;}
  if(key==='h')focusCountry();
  if(event.key==='m')atlas.setMapMode(atlas.mode==='diplomacy'?'political':'diplomacy');  // Shift+M is the sound mute
  if(key==='q')atlas.zoom(1.25);
  if(key==='e')atlas.zoom(.8);
});
document.addEventListener('pointerdown',event=>{
  if(!$('hud-menu').hidden && !compact.matches && !event.target.closest('#hud-menu,#menu-button,.sound-control'))closeMenu();
});
document.addEventListener('change',event=>{
  if(event.target.id==='destination' && event.target.value){selectProvince(event.target.value,{keyboard:true});}
});
document.addEventListener('click',safely(async event=>{
  const b=event.target.closest('button');if(!b)return;
  if(b.id==='journal-toggle'){closeMenu();toggleJournal($('war-journal').hidden);}
  if(b.id==='journal-close'){toggleJournal(false);$('menu-button').focus();}
  if(b.dataset.homeTab){for(const t of document.querySelectorAll('[data-home-tab]'))t.setAttribute('aria-selected',String(t===b));$('rooms').hidden=b.dataset.homeTab!=='rooms';$('standings').hidden=b.dataset.homeTab!=='standings';}
  if(b.dataset.preset){$('preset').value=b.dataset.preset;for(const t of document.querySelectorAll('[data-preset]'))t.setAttribute('aria-checked',String(t===b));}
  if(b.dataset.countrySeat){$('country-choice').value=b.dataset.countrySeat;if(state)renderLobby();atlas.home(b.dataset.countrySeat);}
  if(b.dataset.room)await openRoom(b.dataset.room,b.dataset.spectate==='true');
  if(b.dataset.home)await home();
  if(b.dataset.fraction)setFraction(Number(b.dataset.fraction));
  if(b.dataset.removeSource){sources=sources.filter(s=>s!==b.dataset.removeSource);if(!sources.length && !target)closeCard();else{if(!target)openCard('province',sources[0]);else renderCard();paintMap();}}
  if(b.id==='select-mode' && active()){
    const on=!selectMode;
    if(on){target=null;if(card && (card.kind!=='province' || !sources.length))closeCard();}
    setSelectMode(on);
    if(on)toast('Select: tap your provinces to add or remove them, then tap a target.');
    if(card?.kind==='province')openCard('province',target || sources[0] || card.id);
    paintMap();
  }
  if(b.dataset.pickTarget && state && active())selectProvince(b.dataset.pickTarget);
  if(b.dataset.feedProvince && state)showProvince(b.dataset.feedProvince);
  if(b.dataset.openCountry && state)openCard('country',b.dataset.openCountry,{focus:!b.closest('#card')});
  if(b.dataset.recall)await perform('recall',b.dataset.recall);
  if(b.dataset.turn)await perform('turn',b.dataset.turn);
  if(b.dataset.act)await perform(b.dataset.act,b.dataset.arg);
}));
/** A province from Messages, a notice or the orders list: frame it and open its card. */
function showProvince(id){
  if(!state || !place(id))return;
  if(compact.matches && comms.view!=='closed')comms.close();
  atlas.focus(id,view());
  if(state.status==='running'){armyId=null;proposing=false;const mine=active() && prov(id)?.owner===state.you;sources=mine?[id]:[];target=mine?null:id;if(!mine)selectProvince(id);else{openCard('province',id);paintMap();}}
}
for(const element of document.querySelectorAll('[data-icon]'))element.innerHTML=icon(element.dataset.icon);
comms=new Comms({button:$('comms-button'),toasts:$('toasts'),panel:$('comms'),names:feedNames,docked:()=>!compact.matches,
  onRead:keys=>saveRead(keys),
  onOpen:view=>{if(compact.matches && view!=='closed'){closeCard();setSheet(null);closeMenu();}requestAnimationFrame(syncInsets);},
  onView:({province,country:id})=>{if(province)showProvince(province);else if(id)openCard('country',id,{focus:true});},
  // A refused decision or message (an offer that just expired, a lost connection) says why in the toast lane.
  onAct:async(action)=>{try{const r=await command(action);if(r)toast(action.type==='accept'?(r.status==='pending'?`Alliance agreed: it starts at ${time(r.activateAt)}.`:'Terms accepted; waiting for the others.'):action.type==='decline'?'Offer declined.':'Peace agreed; attacking troops are returning.');return r;}catch(e){toast(e.message,true);return null;}},
  onSend:async(channel,to,text)=>{try{return Boolean(await command({type:'chat',channel,...(channel==='dm'?{to}:{}),text}));}catch(e){toast(e.message,true);return false;}},
  onPropose:id=>{if(!id){comms.openThread('alliance');return;}if(compact.matches)comms.close();openCard('country',id,{focus:true});if(active())perform('propose').catch(e=>toast(e.message,true));},
  onNotice:async(act,arg)=>{try{if(act==='show-army')showArmy(arg);else await perform(act,arg);}catch(e){toast(e.message,true);}}});
standings=new LeaderboardPanel({root:$('leaderboard'),rows:$('lb-rows'),toggle:$('lb-toggle'),summary:$('lb-summary'),modes:[...document.querySelectorAll('[data-lb-mode]')],fronts:$('lb-fronts'),frontCount:$('lb-front-count'),powers:$('lb-powers'),
  onFocus:id=>{if(card?.kind!=='country')atlas?.setRelationFocus?.(id);},
  onSelect:id=>{if(!state)return;if(compact.matches)setSheet(null);if(id===state.you && seated())openCard('alliance',null,{focus:true});else openCard('country',id,{focus:true});},
  onFront:([a,b])=>{if(compact.matches)setSheet(null);const ids=state.provinces.filter(p=>a.includes(p.owner) && place(p.id).neighbors.some(n=>b.includes(prov(n)?.owner)) || b.includes(p.owner) && place(p.id).neighbors.some(n=>a.includes(prov(n)?.owner))).map(p=>p.id);
    atlas.fit(ids.length?ids:[...a,...b].map(id=>state.provinces.find(p=>p.owner===id)?.id).filter(Boolean),view());}},feedNames);
{let saved=null;try{saved=localStorage.getItem('coi.leaderboard');}catch{}
  standings.setOpen(saved!=='collapsed');}
herald=new Herald({declaration:$('declaration'),alliance:$('alliance-seal'),fallen:$('fallen-seal')});
const sounds=new SoundBoard($('sound-control'));
compact.addEventListener('change',()=>{setSheet(null);if(state)comms.update(state,history);requestAnimationFrame(syncInsets);});
try{map=await request('/map.json','GET',undefined,null);initMap();showIdentity();const params=new URL(location).searchParams,initial=params.get('match');if(initial)await openRoom(initial,params.get('spectate')==='1');else await rooms();setConnection(state?.status==='finished'?'Review':'Live');}catch(e){toast(e.message,true);}
addEventListener('resize',()=>requestAnimationFrame(syncInsets));
/* Phones: the on-screen keyboard. iOS Safari (and Android without interactive-widget support) keeps the layout
 * viewport and slides the keyboard over it, hiding the composer. While the visual viewport is clearly shorter,
 * the War Room is sized to it, so the Messages composer and the latest messages stay above the keyboard. */
function syncViewport(){
  const vv=window.visualViewport;if(!vv)return;
  const open=innerHeight-vv.height>80,root=document.documentElement.style,key=open?`${Math.round(vv.offsetTop)}|${Math.round(vv.height)}`:'';
  if(key===viewportKey)return;viewportKey=key;
  if(open){root.setProperty('--vv-top',`${Math.round(vv.offsetTop)}px`);root.setProperty('--vv-h',`${Math.round(vv.height)}px`);}
  document.body.classList.toggle('keyboard-open',open);requestAnimationFrame(()=>{comms?.keepLatest();syncInsets();});
}
let viewportKey='';
window.visualViewport?.addEventListener('resize',syncViewport);window.visualViewport?.addEventListener('scroll',syncViewport);
// Poll the room; not while the page is hidden (a phone in a pocket), and a little less often on touch devices.
setInterval(()=>{if(matchId && !document.hidden)poll();},matchMedia('(pointer: coarse)').matches?1000:750);
document.addEventListener('visibilitychange',()=>{if(matchId && !document.hidden)poll();});
