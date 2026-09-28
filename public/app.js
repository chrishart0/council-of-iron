const $ = id => document.getElementById(id);
import { AfterAction } from './review.js';
import { developmentForecast, coalitionForecast } from './insights.js';
import { faction, insignia, icon, battleSignal } from './presentation.js';
import { Atlas } from './atlas.js';
import { escapeHTML as esc, syncOptions, setHTML, operationId, confirmAction } from './ui.js';
import { WorldFeed, Herald, Notifier, presentHeadline } from './feed.js';
import { viewerOf, commsItems, systemCopy, threadOf, countryThread, allianceThread, decisionsFor, attentionFor, turnedBackReason } from './feed-model.js';
import { LeaderboardPanel } from './leaderboard-panel.js';
import { ExpandableMap } from './expand.js';
// Relations and alliance colours: the same DOM-free helpers the atlas and agent tools use.
import { relationsOf, allianceColors, threatening } from './relations.js';
import { turnAroundArrival } from './movement.js';
import { SoundBoard } from './sound.js';
/* v0.8 — one map, two nouns. A PROVINCE (troops) opens the order card; a COUNTRY (diplomacy) opens the
 * country card; your own standard opens your alliance card. Each card has one primary action. */
const time = n => `${Math.floor(Math.max(0,n)/60).toString().padStart(2,'0')}:${Math.floor(Math.max(0,n)%60).toString().padStart(2,'0')}`;
const signed = n => `${n>=0?'+':''}${n.toFixed(1)}`;
let identity;try{identity=JSON.parse(localStorage.getItem('coi.identity'));}catch{identity=null;}
let map, matchId=null, state=null, cursor=0, history=[], polling=false, toastTimer;
let review, signalCursor=null;
let atlas, generation=0, pendingCommand=false, pollController=null, previewKey='', previewVersion=0;
let spectating=false, mapReadyFor=null;
let messageCatchupComplete=false;
const pastSides=new Set(); // coalitions this seat belonged to ("your alliance dissolved" still affects you)
let worldFeed, herald, standings, expander, notifier;
// Selection: one or more of your provinces (sources) and a target province; or a moving army.
let sources=[], target=null, armyId=null;
// The one context card: { kind: 'province' | 'army' | 'country' | 'alliance', id }.
let card=null, cardSize='peek', cardOpener=null, proposing=false, railItems=[];
let fraction=.5;try{const f=Number(localStorage.getItem('coi.fraction'));if(f>0 && f<=1)fraction=f;}catch{}
const seenThreats=new Set();
const turnedBack=new Map(); // army id → its "turned back" notice key, withdrawn once the troops are home or moving again
const compact=matchMedia('(max-width:1023px), (max-height:499px)');
const country = id => map.countries.find(c=>c.id===id);
const place = id => map.provinces.find(p=>p.id===id);
const prov = id => state?.provinces.find(p=>p.id===id);
const sideName = id => state?.sides.find(s=>s.id===id)?.name || id;
const namedSide = id => country(sideName(id))?.name || sideName(id);
const myPlayer = () => state?.players.find(p=>p.id===state.you);
const playerOf = id => state?.players.find(p=>p.id===id);
const seatType = p => !p ? 'Unclaimed' : p.kind==='bot' || p.model?.startsWith('heuristic-') ? 'BOT' : p.kind==='agent' ? 'AI' : 'HUMAN';
const atWar = (a,b) => Boolean(a && b && a!==b && (state?.wars || []).includes([a,b].sort().join(':')));
const sameSide = (a,b) => Boolean(a && b && playerOf(a)?.side===playerOf(b)?.side);
const mayEnter = (a,b) => !b || sameSide(a,b) || !state.rules.warRequired || atWar(a,b);
const seated = () => Boolean(state?.you) && !spectating;
const active = () => seated() && state.status==='running' && myPlayer()?.eliminatedAt===null;
const neighbours = id => place(id)?.neighbors || [];
/** "Turn around" for one of your moving armies: advancing = recall home; returning = resume toward the
 * province it had been heading for, from where it is now. Mirrors the engine's turnAroundPlan (which
 * re-checks everything when the order executes next tick). Null when there is nothing to offer. */
function turnOption(a){
  if(!a || a.country!==state?.you || a.engaged || !active())return null;
  const at=state.tick+1,queued=(state.commandBudget?.reserved || []).some(o=>['recall','turn_around'].includes(o.type) && [a.id,a.groupId].includes(o.target));
  if(!a.returning){
    const home=a.transit?a.origin:a.from;
    const back=a.transit?at+Math.max(1,at-a.originDepartedAt):a.turnArounds?turnAroundArrival(a,state.travelTimes,at):at+Math.max(1,Math.min(a.arrivesAt-a.departedAt,at-a.departedAt));
    return {mode:'recall',act:'recall',to:home,arrivesAt:back,queued,label:`Recall → ${place(home).name}`,
      preview:`${a.amount} troops turn at their current position and are back in ${place(home).name} at ${time(back)}.`};
  }
  if(state.turnAroundLimit===undefined)return null; // a server without the turn-around order
  const dest=a.from,owner=prov(dest)?.owner,arrivesAt=turnAroundArrival(a,state.travelTimes,at),limit=state.turnAroundLimit;
  const why=a.transit?'A transit column cannot turn around; it must reach home first.':
    (a.turnArounds || 0)>=limit?`These troops have already turned back toward ${place(dest).name} ${limit===1?'once':`${limit} times`}.`:
    !mayEnter(state.you,owner)?`Declare war on ${country(owner).name} before turning back toward ${place(dest).name}.`:
    arrivesAt===null?'This army cannot turn around.':null;
  const battle=state.battles?.find(b=>b.province===dest),friendly=owner && sameSide(owner,state.you);
  const preview=battle && !friendly && battle.attackerSide!==myPlayer()?.side?`${feedNames.side(battle.attackerSide)}’s battle is still under way at ${place(dest).name}; if it has not ended when you arrive, your troops turn back again.`
    :friendly?`${a.amount} troops reinforce ${place(dest).name}.`:`${a.amount} troops attack ${place(dest).name} (${prov(dest).troops} defenders now).`;
  return {mode:'resume',act:'turn-around',to:dest,arrivesAt,queued,why,label:`Turn around → ${place(dest).name} (arrives ${time(arrivesAt)})`,
    preview:`${preview} Uses one command; checked again when it executes.`};
}
/** Centre the map on one of your armies and open its card. */
function showArmy(id){
  const a=state?.armies.find(a=>a.id===id);
  if(!a){toast('Those troops have already arrived.');return;}
  const past=(state.tick-a.departedAt)/Math.max(1,a.arrivesAt-a.departedAt);
  atlas.focus(past<.5?a.from:a.to,view());armyId=id;sources=[];target=null;openCard('army',id);paintMap();
}
function toast(message,error=false){$('toast').textContent=message;$('toast').className=error?'error':'';$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,6500);}
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
  sideColor:id=>state && allianceColors(state)[id],
  time:n=>time(n),
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

/* ── Read state: per item (a set of seqs per match and seat), never a single cursor. ── */
const readKey=()=>`coi.read.${matchId}.${state?.you}`;
function loadRead(){try{return new Set(JSON.parse(localStorage.getItem(readKey()) || '[]').filter(Number.isSafeInteger));}catch{return new Set();}}
function saveRead(){try{localStorage.setItem(readKey(),JSON.stringify([...worldFeed.read].slice(-800)));}catch{}}
const attention=()=>seated() && state.status!=='lobby'?attentionFor(state,railItems,worldFeed.read):[];

/* ── History rail ── */
function threatItems(){
  const me=myPlayer();if(!me || spectating || state.status!=='running')return [];
  return state.armies.filter(a=>threatening(state,a,state.you))
    .map(a=>({id:`t-${a.id}`,seq:cursor,tick:a.departedAt ?? state.tick,type:'threat',country:a.country,to:a.to,amount:a.amount,arrivesAt:a.arrivesAt,threads:['mine'],army:a.id}));
}
function renderFeed(live){
  const box=$('world-feed');box.hidden=!state || state.status==='lobby';
  if(box.hidden)return;
  if(worldFeed.room!==`${matchId}:${state.you}`){worldFeed.room=`${matchId}:${state.you}`;worldFeed.read=loadRead();}
  railItems=commsItems(history,state.dominanceBreaks||[],{you:state.you});
  const threats=threatItems(),fresh=worldFeed.update([...railItems,...threats.filter(t=>!worldFeed.keys.has(`e${t.id}`))],{live,you:state.you});
  if(live)for(const item of fresh)noticeFor(item);
  // A threat that turned back, was destroyed or arrived is withdrawn: no stale toast or "Incoming" row.
  const current=new Set(threats.map(t=>t.army));
  for(const army of seenThreats)if(!current.has(army)){notifier.withdraw(`et-${army}`);worldFeed.withdraw(`et-${army}`);seenThreats.delete(army);}
  for(const t of threats)seenThreats.add(t.army);
  if(live)for(const item of fresh)if(item.system==='turned_back')turnedBack.set(item.armyId,`e${item.id}`);
  for(const [army,key] of turnedBack)if(!state.armies.some(a=>a.id===army && a.returning)){notifier.withdraw(key);turnedBack.delete(army);}
  renderReply();renderAttention();
  // Collapsed rail = a one-line ticker of the latest row (text only; chat is player text).
  const last=[...$('feed-list').children].reverse().find(li=>!li.classList.contains('feed-empty'));
  const words=last?.querySelector('.feed-words b,.feed-chat b');
  $('feed-ticker').textContent=words?`${words.textContent}: ${last.querySelector('.feed-detail,.feed-text')?.textContent || ''}`:'Headlines · chat · diplomacy';
}
function renderReply(){
  const canSend=seated() && state.status==='running';
  $('feed-form').hidden=!canSend;
  const delay=Math.max(0,(state.commandBudget?.chatReadyAt || 0)-state.tick);
  $('feed-send').disabled=!canSend || delay>0 || pendingCommand;
  $('feed-cooldown').textContent=canSend && delay?`Chat ready in ${delay} game s (shared across channels)`:'';
}
/** The single HUD badge: decisions waiting plus unread private messages. */
function renderAttention(){
  const items=attention(),b=$('attention');b.hidden=!items.length;
  $('attention-count').textContent=items.length?String(items.length):'';
  const first=items[0];
  b.setAttribute('aria-label',items.length?`${items.length} ${items.length===1?'thing needs':'things need'} you: open ${first.kind==='message'?`the message from ${first.card.kind==='alliance'?'your alliance':country(first.item.from).name}`:first.kind==='offer'?`the alliance offer from ${country(first.country).name}`:first.kind==='peace_offer'?'the peace offer':'the vote'}`:'Nothing needs you');
  $('hud-standard').dataset.attention=String(items.length);
}
function openAttention(){
  const first=attention()[0];
  if(!first){openCard('alliance',null,{focus:true});return;}
  if(first.card.kind==='country')openCard('country',first.card.id,{size:'full',focus:true,compose:first.kind==='message'});
  else openCard('alliance',null,{size:'full',focus:true,compose:first.kind==='message'});
}
/** A compact notice for something addressed to this seat (never for catch-up items). */
function noticeFor(item){
  if(!seated())return;
  if(item.type==='threat'){
    if(item.arrivesAt-state.tick<=20)notifier.push({key:`e${item.id}`,kind:'decision',standard:item.country,title:`Incoming: ${item.amount} troops → ${place(item.to).name}`,
      detail:`${country(item.country).name} arrives in ${Math.max(0,item.arrivesAt-state.tick)}s.`,buttons:[{label:'View',data:{feedProvince:item.to}}]});
    return;
  }
  if(item.type==='message' && item.channel!=='world' && item.from!==state.you){
    notifier.push({key:`e${item.id}`,kind:item.channel,standard:item.from,title:`${country(item.from).name}${item.channel==='alliance'?' · alliance':''}`,detail:String(item.text).split('\n')[0],
      buttons:[item.channel==='dm'?{label:'Reply',data:{openCountry:item.from,compose:'1'},primary:true}:{label:'Open',data:{openAlliance:'1',compose:'1'},primary:true}]});
    return;
  }
  if(item.system==='turned_back'){
    const option=turnOption(state.armies.find(a=>a.id===item.armyId));
    const buttons=[...(option?.mode==='resume' && !option.why && !option.queued?[{label:`Turn around (arrives ${time(option.arrivesAt)})`,data:{act:'turn-around',arg:item.armyId},primary:true}]:[]),
      ...(state.armies.some(a=>a.id===item.armyId)?[{label:'Show army',data:{showArmy:item.armyId}}]:[])];
    const why=turnedBackReason(item,feedNames);
    // The notice leads with the cause (the full sentence stays in the history row).
    notifier.push({key:`e${item.id}`,kind:'decision',sticky:true,standard:state.you,title:`Your ${item.amount} troops turned back${item.province?` from ${place(item.province).name}`:''}`,
      detail:`${why[0].toUpperCase()}${why.slice(1)}.`,buttons});
    return;
  }
  if(!item.system || item.from===state.you)return;
  const decision=decisionsFor(state).find(d=>d.id===(item.proposalId || item.motionId));
  if(!decision)return;
  const copy=systemCopy(item,{...feedNames,players:state.players.length});
  const buttons=decision.kind==='offer'?[{label:'Accept',data:{act:'accept',arg:decision.id},primary:true},{label:'Decline',data:{act:'decline',arg:decision.id}},{label:'View',data:{openCountry:decision.country}}]
    :decision.kind==='peace_offer'?[{label:'Accept peace',data:{act:'vote-peace',arg:decision.id},primary:true},{label:'View',data:{openCountry:decision.country}}]
    :[{label:decision.kind==='war_vote'?'Approve war':'Approve peace',data:{act:decision.kind==='war_vote'?'vote-war':'vote-peace',arg:decision.id},primary:true},{label:'View',data:{openAlliance:'1'}}];
  notifier.push({key:`e${item.id}`,kind:'decision',sticky:true,standard:item.from || item.fromRoster?.[0],title:decision.kind==='offer'?`Alliance offer from ${country(decision.country).name}: ${decision.proposal.name}`:copy.title,detail:copy.detail,buttons});
}
function openRail(){ // phones: the history is a sheet; it takes over from the card
  if(compact.matches && card)closeCard();
  if(!worldFeed.open)worldFeed.setOpen(true);
}

/* ── Transport ── */
async function request(path,method='GET',data,token=identity?.token){
  const response=await fetch(path,{method,headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});
  const value=await response.json();if(!response.ok){const error=new Error(value.error || `Request failed (${response.status}).`);error.status=response.status;throw error;}return value;
}
async function ensureIdentity(name, force=false){
  name=name.trim();if(!force && identity?.name===name)return;
  const profile=await request('/api/players','POST',{name},null);
  generation++;pollController?.abort();review?.destroy();review=null;resetPresentation();identity=profile;cursor=0;history=[];worldFeed.reset();notifier.reset();messageCatchupComplete=false;localStorage.setItem('coi.identity',JSON.stringify(identity));showIdentity();
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
  const standingsData=await request('/api/standings');
  $('standings').innerHTML=standingsData.standings.length?standingsData.standings.map(p=>`<div class="standing-row"><span>${esc(p.name)} <small class="muted">${p.matches} ${p.matches===1?'match':'matches'}</small></span><b>${signed(p.prestige)}</b></div>`).join(''):'<p class="muted small">No decisive matches recorded yet. Results persist on this server.</p>';
}
function clearSelection(){sources=[];target=null;armyId=null;proposing=false;}
async function openRoom(id,watch=false){
  generation++;pollController?.abort();review?.destroy();review=null;document.body.classList.remove('reviewing');
  closeCard();closeMenu();pastSides.clear();seenThreats.clear();turnedBack.clear();spectating=watch;messageCatchupComplete=false;herald.reset();worldFeed.reset();
  resetPresentation();matchId=id;mapReadyFor=null;state=null;cursor=0;history=[];clearSelection();previewKey='';notifier.reset();
  document.body.classList.add('in-game');atlas.world();
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
    setConnection(state.status==='finished'?'Review':'Live');render();renderFeed(live);renderCard();coach();syncInsets();
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

/* ── Map ── */
function initMap(){
  $('faction-parade').innerHTML=map.countries.map(c=>`<span>${insignia(c.id)}<b>${esc(faction(c.id).short)}</b></span>`).join('');
  $('faction-choices').innerHTML=map.countries.map(c=>`<button type="button" data-country-seat="${c.id}" aria-pressed="false">${insignia(c.id)}<b>${esc(faction(c.id).short)}</b><small>${c.start.length} holdings</small></button>`).join('');
  atlas?.destroy();
  const previous=$('map'),replacement=previous.cloneNode(false);previous.replaceWith(replacement);
  // The map key (legend + Political/Diplomacy toggle) lives in the ☰ menu.
  atlas=new Atlas(replacement,map,selectProvince,{legend:{placement:'bottom-left',container:$('map-key'),collapsed:false},
    drag:{start:(id,{counter})=>active() && prov(id)?.owner===state.you && (counter || sources.includes(id)) && freeTroops(id)>0,
      begin:from=>{sources=[from];target=null;armyId=null;proposing=false;paintMap();},
      label:(from,to)=>`${amountFor(from)} · ${state.travelTimes?.[from]?.[to] ?? '?'}s`,
      end:(from,to)=>{sources=[from];target=to;armyId=null;openCard('province',to || from);paintMap();revealUnderCard(to || from);}},
    onArmy:id=>{const a=state?.armies.find(a=>a.id===id);if(!a)return false;armyId=id;sources=[];target=null;openCard('army',id);paintMap();return true;}});
  $('landing-map').innerHTML=map.provinces.map(p=>`<path d="${p.path}"/>`).join('');
}
/** Screen insets (px) covered by the HUD, rail and open card, so a camera move centres the target in the
 * map area that is actually visible (passed as the atlas's optional trailing argument). */
function view(){
  const stage=$('stage').getBoundingClientRect(),box=sel=>{const e=document.querySelector(sel);return e?.checkVisibility()?e.getBoundingClientRect():null;};
  const hud=box('.hud-bar'),board=box('#leaderboard'),rail=compact.matches?null:box('.right-rail'),panel=box('#card'),ticker=box('#world-feed');
  const sheet=panel && panel.width>stage.width*.8;
  const top=Math.max(hud?hud.bottom-stage.top:0,compact.matches && board?board.bottom-stage.top:0);
  const bottom=Math.max(sheet?stage.bottom-panel.top:0,compact.matches && ticker && ticker.top>stage.height/2?stage.bottom-ticker.top:0);
  return {insets:{top,right:rail && rail.left>stage.width/2?stage.right-rail.left:0,left:panel && !sheet?panel.right-stage.left:0,bottom}};
}
/** Home: your country, close enough on phones to drag from a province counter. */
/** Panels that stay over the map on wide screens (the right column): the atlas keeps the map beside them. */
function syncInsets(){
  if(!atlas)return;const stage=$('stage').getBoundingClientRect(),rail=document.querySelector('.right-rail');
  const box=!compact.matches && rail?.checkVisibility()?[...rail.children].filter(e=>e.checkVisibility()).map(e=>e.getBoundingClientRect()):[];
  const left=box.length?Math.min(...box.map(r=>r.left)):stage.right;
  atlas.setInsets({left:0,right:box.length?Math.max(0,stage.right-left):0});
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
  atlas.update(state,sources[0] || null,target);
  const plan=card?.kind==='province' && target && sources.length?orderPlan():null;
  atlas.setDraft(plan?{sources,to:target,label:plan.arrowLabel}:null);
}
function freeTroops(id) {
  const p=prov(id);
  const reserved=(state.commandBudget?.reserved || []).filter(o=>o.from===id && ['move','transit','develop'].includes(o.type)).reduce((n,o)=>n+o.amount,0);
  return Math.max(0,(p?.troops || 0)-reserved-1);
}
const amountFor=id=>{const free=freeTroops(id);return free>0?Math.max(1,Math.floor(free*fraction)):0;};

/** Tap/click/Enter on a province. Tap-tap fallback of the drag: your province, then a neighbour.
 * With a target chosen, tapping more of your provinces beside it adds (or removes) them as sources. */
function selectProvince(id,modifiers={}){
  if(!state)return;
  const p=prov(id),mine=active() && p.owner===state.you;
  armyId=null;proposing=false;
  if(modifiers.shiftKey && mine){sources=[id];target=null;}
  else if(target===id || (!target && sources.length===1 && sources[0]===id)){closeCard({restoreFocus:false});return;}
  else if(target && mine && neighbours(id).includes(target)){
    sources=sources.includes(id)?sources.filter(s=>s!==id):[...sources,id];
    if(!sources.length)sources=[id];
  }
  else if(sources.length===1 && !target && neighbours(sources[0]).includes(id))target=id;
  else if(mine){sources=[id];target=null;}
  else{
    // Target first: the best-placed of your neighbouring provinces is proposed as the source.
    const donors=active()?state.provinces.filter(q=>q.owner===state.you && neighbours(q.id).includes(id) && freeTroops(q.id)>0).sort((a,b)=>freeTroops(b.id)-freeTroops(a.id)):[];
    sources=donors.length?[donors[0].id]:[];target=id;
  }
  openCard('province',target || sources[0] || id);paintMap();revealUnderCard(target || sources[0] || id);
  if(modifiers.keyboard && target && !$('primary')?.disabled)$('primary')?.focus();
}

/* ── Orders ── */
/** How attacking `owner` works for this seat: null when a normal march is allowed. */
function warPlan(owner){
  const me=myPlayer();if(!owner || !me || mayEnter(state.you,owner))return null;
  const team=state.players.filter(p=>p.side===me.side),motion=(state.diplomacy || []).find(m=>m.kind==='war' && m.status==='voting' && m.fromRoster.includes(state.you) && m.toRoster.includes(owner));
  const need=Math.floor(team.filter(p=>p.eliminatedAt===null).length/2)+1;
  return {mode:team.length===1?'declare':motion?'voting':'vote',motion,need,team:team.map(p=>p.id),
    enemies:state.players.filter(p=>p.side===playerOf(owner)?.side).map(p=>p.id)};
}
/** Everything the order card shows for the current sources → target, and its one primary action. */
function orderPlan(){
  const tp=prov(target),owner=tp?.owner || null,name=place(target).name,who=owner?faction(owner).short:null;
  const parts=sources.map(from=>({from,free:freeTroops(from),amount:amountFor(from),travel:state.travelTimes?.[from]?.[target] ?? 0}));
  const total=parts.reduce((n,s)=>n+s.amount,0),travel=Math.max(0,...parts.map(s=>s.travel)),war=warPlan(owner);
  const relation=!owner?'unclaimed':owner===state.you?'own':sameSide(state.you,owner)?'ally':war?'neutral':state.rules.warRequired?'enemy':'open';
  const words={unclaimed:['UNCLAIMED','No declaration needed.'],own:['YOUR PROVINCE','Move troops within your land.'],ally:['ALLIED',`Troops you send become ${who}’s.`],
    enemy:['AT WAR','You can attack.'],open:['HOSTILE','This room needs no declaration: you can attack.'],
    neutral:['NOT AT WAR',war?.mode==='declare'?`Sending troops declares war on ${who}${war.enemies.length>1?' and its allies':''}.`:war?.mode==='voting'?`War vote open: ${war.motion.fromYes.length}/${war.need} approvals, ${Math.max(0,war.motion.expiresAt-state.tick)}s left.`:'Your alliance must vote for war before anyone attacks.']}[relation];
  const budget=state.commandBudget?.remaining ?? 0,recovery=state.commandBudget?.nextRecoveryAt;
  let label,kind='send',danger=false,disabled=!active() || pendingCommand;
  if(relation==='own' || relation==='ally')label=`Reinforce ${name} with ${total}`;
  else if(war?.mode==='declare'){label=`Declare war on ${who} & send ${total}`;kind='declare';danger=true;}
  else if(war?.mode==='vote'){label=`Call war vote on ${who}`;kind='vote';danger=true;}
  else if(war?.mode==='voting'){label=`War vote open · ${war.motion.fromYes.length}/${war.need} approvals`;kind='voting';disabled=true;}
  else if(owner)label=`Attack ${name} with ${total}`;
  else label=`Send ${total} → ${name}`;
  let why='';
  if(kind!=='vote' && kind!=='voting'){
    if(!sources.length){disabled=true;why=`None of your provinces borders ${name}.`;}
    else if(!total){disabled=true;why='No free troops: one must stay home.';}
    else if(budget<=0){disabled=true;why=`Command limit reached${recovery!=null?`: next order in ${Math.max(0,recovery-state.tick)}s`:''}.`;}
  }
  if(pendingCommand)label='Sending order…';
  const preview=sources.length && kind!=='vote' && kind!=='voting'?`${total} vs ${tp.troops} ${relation==='own' || relation==='ally'?'there now':'defenders'} · arrives in ${travel+1}s (${time(state.tick+travel+1)})`:'';
  return {parts,total,travel,war,relation,words,label,kind,danger,disabled,why,preview,owner,arrowLabel:`${total} · ${travel+1}s`};
}
/** "Declare war on X?" with the real consequences: the whole target side, and who votes for a coalition. */
function confirmWar(owner,amount,plan){
  const list=(label,ids)=>{const row=el('div','war-confirm-row');row.append(el('b','',label),...ids.map(id=>{const s=el('span','war-confirm-country');s.innerHTML=insignia(id);s.append(el('span','',country(id).name));return s;}));return row;}; // authored SVG + text
  const extra=el('div','war-confirm');extra.append(list(plan.mode==='declare'?'You will be at war with':'Your coalition would be at war with',plan.enemies));
  if(plan.enemies.length>1)extra.append(el('p','small',`${country(owner).name}’s allies join the war against you.`));
  if(plan.mode==='declare'){
    extra.append(el('p','small','You are independent: the declaration takes effect at once and the troops are sent in the same order. If they cannot be sent, no war is declared.'));
    return confirmAction({title:`Declare war on ${country(owner).name}?`,message:amount?`Send ${amount} troops to ${place(target)?.name} and declare war.`:'Both sides may attack each other from now on.',accept:amount?`Declare war & send ${amount}`:'Declare war',extra});
  }
  extra.append(list('Your coalition votes',plan.team));
  extra.append(el('p','small',`A majority (${plan.need} of ${plan.team.length}) must approve within ${state.rules.diplomacyLife ?? 60} game seconds. No troops march now; once war is approved, sending works normally. Your allies are drawn in.`));
  return confirmAction({title:`Call a war vote on ${country(owner).name}?`,message:'Your coalition decides together.',accept:'Call war vote',extra});
}
async function sendOrder(){
  const plan=orderPlan();if(plan.disabled)return;
  if(plan.kind==='vote'){if(!await confirmWar(plan.owner,0,plan.war))return;const r=await command({type:'declare_war',country:plan.owner});if(r)toast(r.status==='enacted'?'War declared.':'War vote opened for your coalition.');return;}
  if(plan.kind==='declare' && !await confirmWar(plan.owner,plan.total,plan.war))return;
  const declare=plan.kind==='declare'?{declareWar:true}:{};
  // One order, one opId: declare war and march together, or neither (the engine validates both).
  const parts=plan.parts.filter(s=>s.amount>0),to=target;
  // Optional shared arrival (game clock MM:SS) for an attack from several provinces.
  const requested=parts.length>1?$('shared-arrival')?.value.trim():'';let arriveAt;
  if(requested){if(!/^\d{1,2}:\d{2}$/.test(requested))throw new Error('Use game-clock MM:SS for a shared arrival, or leave it blank.');const [m,sec]=requested.split(':').map(Number);if(sec>59)throw new Error('Seconds must be 00–59.');arriveAt=m*60+sec;}
  const action=parts.length===1?{type:'move',from:parts[0].from,to,amount:parts[0].amount,...declare}:{type:'attack',to,sources:parts.map(s=>({from:s.from,amount:s.amount})),...(arriveAt!==undefined?{arriveAt}:{}),...declare};
  const r=await command(action);if(!r)return;
  toast(`${plan.kind==='declare'?'War declared. ':''}Sent ${plan.total} → ${place(to).name}. Arrives ${time(r.arrivesAt ?? r.executeAt+plan.travel)}.`);
  closeCard();
}
async function updatePreview(){
  const box=$('order-details');if(!box)return;
  if(sources.length!==1 || !target){previewKey='';box.textContent=sources.length>1?'Several sources: they wait at home and arrive together.':'';return;}
  const amount=amountFor(sources[0]),key=[matchId,state.tick,sources[0],target,amount].join('|');
  if(key===previewKey || !amount)return;previewKey=key;const version=++previewVersion,epoch=generation;
  try{
    const result=await request(`/api/games/${matchId}/preview?from=${sources[0]}&to=${target}&amount=${amount}`);
    if(key!==previewKey || version!==previewVersion || epoch!==generation)return;
    $('order-details').innerHTML=`${esc(result.summary)}<small>${result.remaining} uncommitted troops stay home · ${result.travelTicks}s travel · arrives ${time(result.arrivesAt)}${result.reserved?` · ${result.reserved} already reserved`:''}. ${result.incoming.length} known incoming armies. Future orders and recruitment can change the result.</small>`;
  }catch(e){if(key===previewKey && version===previewVersion && epoch===generation)$('order-details').textContent=e.message;}
}

/* ── The context card ── */
function openCard(kind,id=null,{size,focus=false,compose=false}={}){
  const box=$('card'),same=card?.kind===kind && card?.id===id;
  if(focus && !box.contains(document.activeElement))cardOpener=document.activeElement;
  if(kind!=='province' && kind!=='army'){sources=[];target=null;armyId=kind==='army'?id:null;}
  if(kind!=='country' || !same)proposing=false;
  card={kind,id};box.hidden=false;
  // Learning by doing: a tip that has just been acted on moves on by itself.
  if(coachStep===0 && kind==='province' || coachStep===1 && kind==='country'){coachStep++;showCoach();}
  const allied=myPlayer() && !myPlayer().side.startsWith('solo:');
  cardSize=size || (same?cardSize:kind==='country' || kind==='alliance' && allied?'full':'peek');
  if(compact.matches && worldFeed.open)worldFeed.setOpen(false); // phones: one sheet at a time
  renderCard();
  if(kind==='country' || kind==='alliance')atlas?.setRelationFocus?.(kind==='country'?id:state?.you || null);
  if(compose && !$('composer').hidden)$('composer-text').focus({preventScroll:true});
  else if(focus)$('card-title').focus({preventScroll:true});
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
  if(relationsOf(state,state.you).enemies.includes(id))return state.rules.warRequired?'war':'open';
  const both=q=>q.roster.includes(state.you) && q.roster.includes(id);
  if((state.proposals || []).some(q=>q.status==='pending' && both(q)))return 'forming';
  return (state.proposals || []).some(q=>q.status==='open' && both(q))?'offer':'neutral';
}
const RELATION_WORDS={you:'YOU',forming:'ALLIANCE FORMING',ally:'ALLIED',war:'AT WAR',open:'HOSTILE',neutral:'NEUTRAL',offer:'ALLIANCE OFFER PENDING',fallen:'FALLEN',watch:'',unclaimed:'UNCLAIMED'};
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
  box.dataset.kind=card.kind;box.dataset.size=cardSize;box.dataset.relation='';
  $('card-size').setAttribute('aria-expanded',String(cardSize==='full'));$('card-size').setAttribute('aria-label',cardSize==='full'?'Show less':'Show more');
  const view={province:provinceCard,army:armyCard,country:countryCard,alliance:allianceCard}[card.kind]();
  part('card-flag',JSON.stringify(view.flag),()=>view.flag?flag(view.flag):null);
  $('card-title').textContent=view.title;
  part('card-sub',JSON.stringify(view.subKey ?? view.sub),()=>view.sub);
  part('card-status',JSON.stringify(view.statusKey ?? view.status),()=>view.status);
  box.dataset.relation=view.relation || '';
  $('card-size').hidden=!view.more;
  $('card-body').hidden=cardSize!=='full' || !view.more;
  if(!$('card-body').hidden)view.more();
  // Dock: sources and amount (orders), a message box (diplomacy), then the actions.
  const order=view.order;
  $('sources').hidden=!order || order.parts.length<2 && !order.hint;
  if(order)part('sources',JSON.stringify([order.parts.map(s=>[s.from,s.amount]),order.hint]),()=>[...(order.parts.length>1?order.parts.map(s=>{const b=button('',{removeSource:s.from},'source-chip');b.append(el('b','',String(s.amount)),el('span','',place(s.from).name),el('i','','×'));b.setAttribute('aria-label',`Remove ${place(s.from).name} (${s.amount} troops)`);return b;}):[]),...(order.hint?[el('small','sources-hint',order.hint)]:[])]);
  $('amount-control').hidden=!order || order.kind==='vote' || order.kind==='voting' || !order.parts.length;
  if(order){
    const pct=Math.round(fraction*100);if(document.activeElement!==$('amount-slider'))$('amount-slider').value=String(pct);
    $('amount-out').textContent=`${order.total} troops · ${pct}%`;
    for(const b of document.querySelectorAll('[data-fraction]'))b.setAttribute('aria-pressed',String(Math.abs(Number(b.dataset.fraction)-fraction)<.001));
  }
  $('order-preview').hidden=!order || !(order.preview || order.why);
  if(order)$('order-preview').textContent=order.why || order.preview;
  const composer=view.composer;
  $('composer').hidden=!composer || cardSize!=='full';
  if(composer){
    $('composer').dataset.channel=composer.channel;$('composer').dataset.to=composer.to || '';
    $('composer-text').placeholder=composer.placeholder;$('composer-label').textContent=composer.placeholder;
    const delay=Math.max(0,(state.commandBudget?.chatReadyAt || 0)-state.tick);
    $('composer-send').disabled=delay>0 || pendingCommand;$('composer-note').textContent=delay?`Chat ready in ${delay} game s`:composer.note || '';
  }
  part('card-actions',JSON.stringify(view.actions.map(a=>[a.label,a.act,a.arg,a.primary,a.danger,a.disabled,a.id])),()=>view.actions.map(a=>{
    const b=button(a.label,{act:a.act,...(a.arg!==undefined?{arg:a.arg}:{})},`${a.primary?'primary':''}${a.danger?' danger':''}`);
    if(a.id)b.id=a.id;b.disabled=Boolean(a.disabled);return b;}));
  $('card-dock').hidden=$('sources').hidden && $('amount-control').hidden && $('order-preview').hidden && $('composer').hidden && !view.actions.length;
  if(card.kind==='province')paintMapDraftOnly();
}
function paintMapDraftOnly(){const plan=target && sources.length?orderPlan():null;atlas.setDraft(plan?{sources,to:target,label:plan.arrowLabel}:null);}
function detailsHTML(html){const d=el('div','card-more');d.innerHTML=html;return d;} // callers escape every name
function provinceCard(){
  const id=target || sources[0] || card.id,p=prov(id);
  if(!p){return {title:'',actions:[]};}
  const owner=p.owner,mine=owner===state.you && state.you;
  const base={flag:owner,title:place(id).name};
  if(target && active() && (sources.length || !mine)){ // spectators and fallen players get the information card
    const plan=orderPlan(),waiting=[...new Set(state.provinces.filter(q=>q.owner===state.you && !sources.includes(q.id) && neighbours(q.id).includes(target) && freeTroops(q.id)>0).map(q=>place(q.id).name))];
    const hint=!active() || !sources.length || plan.kind==='vote' || plan.kind==='voting'?'':waiting.length?`Tap ${waiting.slice(0,2).join(' or ')}${waiting.length>2?' …':''} to send from there too.`:'';
    const status=el('div','card-relation');status.append(el('b',`rel rel-${plan.relation}`,plan.words[0]),el('span','',plan.words[1]));
    return {...base,title:place(target).name,
      sub:[owner?ownerButton(owner):el('span','card-meta','Unclaimed'),el('span','card-meta',`${p.troops} troops${sources.length?` · from ${sources.length===1?place(sources[0]).name:`${sources.length} provinces`}`:''}`)],subKey:[owner,relationOf(owner),p.troops,sources],
      status,statusKey:[plan.relation,plan.words],relation:plan.relation,
      order:active()?{...plan,hint}:null,
      actions:active()?[{label:plan.label,act:'send',primary:true,danger:plan.danger,disabled:plan.disabled,id:'primary'}]:[],
      more:()=>moreProvince(target,true)};
  }
  const battle=state.battles?.find(b=>b.province===id);
  const status=el('div','card-relation');
  if(battle)status.append(el('b','rel rel-war','BATTLE'),el('span','',`${state.armies.filter(a=>a.engaged && a.to===id).reduce((n,a)=>n+a.amount,0)} attackers against ${p.troops} defenders.`));
  else if(mine && active())status.append(el('span','card-hint',freeTroops(id)>0?'Drag to a neighbour — or tap one — to send troops.':'Only one troop here: it must stay home.'));
  else if(!mine && !spectating && state.you)status.append(el('span','card-hint',`None of your provinces borders ${place(id).name}.`));
  const actions=[];
  if(mine && active() && p.development<state.rules.maxDevelopment){
    const cost=state.rules.developmentCosts[p.development],queued=state.commandBudget?.reserved.some(o=>o.type==='develop' && o.from===id);
    actions.push({label:p.developing?`Building level ${p.developing.level} · ${Math.max(0,p.developing.completesAt-state.tick)}s`:queued?'Construction queued':`Develop · ${cost} troops`,act:'develop',arg:id,disabled:Boolean(p.developing) || queued || freeTroops(id)<cost || pendingCommand || !state.commandBudget?.remaining,id:'develop-province'});
  }
  if(mine && active()){
    // Troops that left (or are about to leave) this province: recall them from here too.
    const outgoing=[...(state.commandBudget?.reserved || []).filter(o=>o.type==='move' && o.from===id).map(o=>({id:o.id,amount:o.amount,to:o.to,queued:true})),
      ...state.armies.filter(a=>a.country===state.you && a.from===id && !a.returning && !(state.commandBudget?.reserved || []).some(o=>o.type==='recall' && [a.id,a.groupId].includes(o.target))).map(a=>({id:a.id,amount:a.amount,to:a.to}))];
    for(const o of outgoing.slice(0,2))actions.push({label:`${o.queued?'Cancel':'Recall'} ${o.amount} → ${place(o.to).name}`,act:'recall',arg:o.id,disabled:pendingCommand || !state.commandBudget?.remaining});
    // Troops on their way home here that could head back out: turn them around from here too.
    for(const a of state.armies.filter(a=>a.country===state.you && a.returning && a.to===id).slice(0,Math.max(0,2-outgoing.length))){
      const option=turnOption(a);
      if(option && !option.queued && !option.why)actions.push({label:`Turn around ${a.amount} → ${place(option.to).name}`,act:'turn-around',arg:a.id,disabled:pendingCommand || !state.commandBudget?.remaining});
    }
  }
  return {...base,sub:[owner && !mine?ownerButton(owner):el('span','card-meta',mine?'Your province':'Unclaimed'),el('span','card-meta',`${p.troops} troops${owner?` · industry ${'ⅠⅡⅢⅣⅤ'[p.development-1] || p.development}`:''}`)],subKey:[owner,relationOf(owner),p.troops,p.development,mine],
    status,statusKey:[battle && [battle.province,p.troops],mine,freeTroops(id)>0,state.armies.filter(a=>a.engaged && a.to===id).length],relation:mine?'own':'',actions,more:()=>moreProvince(id,false)};
}
/** "More": the advanced details under the expanded card. */
function moreProvince(id,order){
  const p=prov(id),mine=p.owner===state.you && state.you,src=sources[0];
  const waves=state.armies.filter(a=>a.to===id).sort((a,b)=>a.arrivesAt-b.arrivesAt);
  const lastBattle=history.filter(e=>e.type==='battle' && e.province===id).at(-1);
  const key=JSON.stringify([id,order,src,sources,state.tick,fraction,state.commandBudget,mine && p.troops]);
  const body=$('card-body');if(body.dataset.key===key)return;body.dataset.key=key;
  const scroll=body.scrollTop,openDetails=[...body.querySelectorAll('details[open]')].map(d=>d.dataset.part);
  let html='';
  if(order){
    const previous=$('order-details')?.dataset.for===`${sources[0]}>${id}`?$('order-details').innerHTML:null; // server text, escaped when written
    html+=`<p id="order-details" class="order-details" data-for="${esc(`${sources[0]}>${id}`)}">${sources.length>1?'Several sources: nearer ones wait at home so everyone arrives together.':previous ?? 'Checking the current garrison…'}</p>`;
    if(sources.length>1)html+=`<label class="arrive-label">Shared arrival, game clock (optional)<input id="shared-arrival" placeholder="Earliest · or MM:SS" inputmode="numeric" maxlength="5"></label>`;
    const friend=p.owner && sameSide(p.owner,state.you),srcP=prov(src);
    if(active() && src && sources.length===1 && friend)html+=`<details data-part="route"><summary>Recruitment arrow ${srcP?.route?'· set':''}</summary><p class="small muted">New recruits in ${esc(place(src).name)} walk to ${esc(place(id).name)} automatically. Existing troops stay.</p><div class="button-row"><button id="set-route" data-act="route" data-arg="${esc(id)}" ${srcP?.route===id || !state.commandBudget?.remaining?'disabled':''}>Set arrow → ${esc(place(id).name)}</button><button id="clear-route" class="quiet" data-act="route" data-arg="" ${srcP?.route?'':'disabled'}>Clear</button></div><p id="route-status" class="small">${srcP?.route?`New recruits → ${esc(place(srcP.route).name)}.`:'No recruitment arrow set.'}</p></details>`;
    const vias=active() && src && sources.length===1 && myPlayer()?.side?neighbours(src).filter(v=>{const o=prov(v)?.owner;return o && o!==state.you && sameSide(o,state.you) && neighbours(v).includes(id);}):[];
    if(vias.length && !mayEnter(state.you,p.owner)===false && p.owner!==state.you)html+=`<p class="small muted">Tip: to pass through an ally, send to their province first; transit orders stay available to agents.</p>`;
  }else if(mine){
    const reserved=(state.commandBudget?.reserved || []).filter(o=>o.from===id).reduce((n,o)=>n+o.amount,0);
    html+=`<div class="province-readout"><div><span>FREE</span><strong>${freeTroops(id)}</strong></div><div><span>GARRISON</span><strong>${p.troops}</strong></div><div><span>RECRUIT IN</span><strong>${p.nextRecruit===null?'—':Math.max(0,p.nextRecruit-state.tick)+'s'}</strong></div></div>${reserved?`<p class="small muted">${reserved} troops reserved for queued orders.</p>`:''}`;
    if(p.route)html+=`<p class="small">Recruitment arrow: new recruits → ${esc(place(p.route).name)}. <button data-act="route-clear" data-arg="${esc(id)}" class="quiet">Clear</button></p>`;
    const f=developmentForecast(state,id);
    if(f)html+=`<p id="development-payback" class="development-payback">${f.alreadyInvested?'Investment already spent. ':''}Develop to level ${f.level} for ${f.cost} troops. Earliest payback ${time(f.paybackAt)} game time; up to ${f.additionalRecruits} extra recruits by 30:00 (net ${signed(f.netBeforeDeadline)}). ${f.paysBackBeforeDeadline?'':'This will not repay before the deadline. '}${esc(f.assumption)}</p>`;
    const reserves=(state.insights?.routeReserves || []).filter(v=>v.province===id && v.available>=10);
    for(const v of reserves)html+=`<p class="small">${v.available} free troops wait here; recruits walk to ${esc(place(v.to).name)}. <button data-act="draft" data-arg="${esc(v.province)}" data-to="${esc(v.to)}">Draft transfer →</button></p>`;
  }
  html+=`<h3>${esc(place(id).name)} · incoming</h3>${waves.length?waves.slice(0,4).map(a=>`<p class="small">${a.amount} ${esc(country(a.country).name)} · ${a.returning?'returning':'marching'} · arrives ${time(a.arrivesAt)} (${Math.max(0,a.arrivesAt-state.tick)}s)</p>`).join(''):'<p class="small muted">No armies on the way.</p>'}${waves.length>4?`<p class="small">Plus ${waves.length-4} later armies.</p>`:''}${lastBattle?`<p class="small muted">Last battle ${time(lastBattle.tick)}: ${lastBattle.troops} survivors; ${esc(country(lastBattle.owner)?.name || 'neutral')} held afterward.</p>`:''}`;
  if(active())html+=marchesHTML();
  html+=`<details class="rules-details" data-part="rules"><summary>Rules of engagement</summary><p>Leave one troop behind. Travel time follows distance. Recall turns an army around at its actual position. Attack an occupied enemy only after war is declared. Battles take several dice rounds; ties favour defenders. Troops sent to an ally become theirs. Three commands per ten game seconds; an attack from several provinces counts as one.</p></details>`;
  if(active() && order===false && mine)html+=`<label class="keyboard-select">Keyboard: send to<select id="destination"><option value="">Choose a neighbour…</option>${neighbours(id).map(n=>`<option value="${esc(n)}">${esc(place(n).name)} · ${prov(n).troops} · ${esc(country(prov(n).owner)?.name || 'Unclaimed')}</option>`).join('')}</select></label>`;
  // Rebuilt every tick: keep what the player typed or chose, and where focus was.
  const kept=Object.fromEntries([...body.querySelectorAll('input[id],select[id]')].map(e=>[e.id,e.value])),focused=body.contains(document.activeElement)?document.activeElement.id:null;
  body.innerHTML=html;body.scrollTop=scroll;
  for(const [key,value] of Object.entries(kept)){const e=body.querySelector(`#${CSS.escape(key)}`);if(e && value)e.value=value;}
  if(focused)body.querySelector(`#${CSS.escape(focused)}`)?.focus({preventScroll:true});
  for(const d of body.querySelectorAll('details'))if(openDetails.includes(d.dataset.part))d.open=true;
  if(order)updatePreview();
}
function marchesHTML(){
  const turnButton=a=>{const o=turnOption(a);return o && !o.queued && !o.why?`<button type="button" data-act="turn-around" data-arg="${esc(a.id)}" ${!pendingCommand && state.commandBudget?.remaining?'':'disabled'}>Turn around</button>`:'';};
  const moving=state.armies.filter(a=>a.country===state.you).sort((a,b)=>a.arrivesAt-b.arrivesAt),reserved=state.commandBudget?.reserved || [];
  if(!moving.length && !reserved.length)return '';
  const can=!pendingCommand && state.commandBudget?.remaining;
  const recall=(id,label)=>`<button type="button" data-recall="${esc(id)}" ${can?'':'disabled'}>${label}</button>`;
  const groups=[...new Set([...moving,...reserved].filter(a=>a.groupId && !a.returning).map(a=>a.groupId))].filter(id=>[...moving,...reserved].filter(a=>a.groupId===id && !a.returning).length>1);
  return `<h3>Your orders <span class="count">${moving.length+reserved.length}</span></h3><div class="march-list">${groups.map(id=>`<div class="march-row"><span>Attack together<small>${esc(id)}</small></span>${recall(id,'Recall group')}</div>`).join('')}${reserved.map(o=>`<div class="march-row"><span>${o.type==='recall'?'Recall queued':o.type==='develop'?'Construction queued':`${o.amount || ''} · ${esc(place(o.from)?.name || '')} → ${esc(place(o.to)?.name || '')}`}<small>${Math.max(0,o.executeAt-state.tick)}s until ${o.type==='move'?'departure':'execution'}</small></span>${o.type==='move'?recall(o.id,'Cancel'):''}</div>`).join('')}${moving.map(a=>`<div class="march-row ${a.returning?'returning':''}"><button class="march-focus" data-feed-province="${esc(a.to)}"><b>${a.amount}</b> ${a.returning?'↶':'→'} ${esc(place(a.to).name)}<small>${a.returning?'Returning · ':''}arrives ${time(a.arrivesAt)} · ${Math.max(0,a.arrivesAt-state.tick)}s</small></button>${a.returning?turnButton(a):recall(a.id,'Recall')}</div>`).join('')}</div>`;
}
function armyCard(){
  const a=state.armies.find(a=>a.id===card.id),mine=a.country===state.you && active();
  const status=el('div','card-relation');status.append(el('b',`rel ${a.returning?'rel-ally':'rel-war'}`,a.returning?'RETURNING':a.engaged?'IN BATTLE':'MARCHING'),el('span','',`${place(a.from).name} → ${place(a.to).name} · arrives in ${Math.max(0,a.arrivesAt-state.tick)}s (${time(a.arrivesAt)})`));
  const group=a.groupId && state.armies.filter(x=>x.groupId===a.groupId && !x.returning).length>1;
  const option=mine?turnOption(a):null,budget=!pendingCommand && state.commandBudget?.remaining;
  const recallQueued=(state.commandBudget?.reserved || []).some(o=>o.type==='recall' && [a.id,a.groupId].includes(o.target));
  let actions=[];
  // Fighting troops withdraw with a plain recall; moving ones get the one "turn around" primary action.
  if(mine && a.engaged && !recallQueued)actions=[{label:'Recall',act:'recall',arg:a.id,primary:true,disabled:!budget,id:'primary'}];
  else if(option?.queued)status.append(el('span','card-hint','Order queued: it turns at the next game second.'));
  else if(option){
    actions=[{label:option.label,act:option.act,arg:a.id,primary:true,disabled:!budget || Boolean(option.why),id:'primary'},...(option.mode==='recall' && group?[{label:'Recall whole attack',act:'recall',arg:a.groupId}]:[])];
    status.append(el('span','card-hint',option.why || option.preview));
  }
  return {flag:a.country,title:`${a.amount} ${faction(a.country).short} troops`,sub:[ownerButton(a.country)],subKey:[a.country,relationOf(a.country)],status,
    statusKey:[a.returning,a.engaged,a.arrivesAt,state.tick,option?.label,option?.why,option?.queued],relation:'',actions};
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
  const actions=[],can=active() && p && p.eliminatedAt===null && id!==state.you;
  const offer=(state.proposals || []).find(q=>q.status==='open' && state.you && q.roster.includes(state.you) && q.roster.includes(id));
  const peaceOffer=(state.diplomacy || []).find(m=>m.kind==='peace' && m.status==='offered' && m.toRoster.includes(state.you) && m.fromRoster.includes(id));
  const war=warPlan(id);
  let note='';
  if(can){
    if(offer){
      const forecast=coalitionForecast(state,offer.roster,offer.coalition),mine=forecast.members.find(m=>m.country===state.you);
      note=`${offer.name}: ${offer.roster.map(r=>country(r).name).join(' + ')} · ${offer.accepted.length}/${offer.roster.length} approvals · ${Math.max(0,offer.expiresAt-state.tick)}s left. ${offer.accepted.includes(state.you)?'':`Your maximum share: ${mine.maximumShare.toFixed(1)} points; ${mine.keepsMaturity?'you keep your earned tenure':'your maturity restarts at zero'}. ${forecast.economy}/${forecast.threshold} industry together.`}`;
      if(offer.accepted.includes(state.you))actions.push({label:offer.creator===state.you?'Withdraw offer':'Withdraw approval',act:'decline',arg:offer.id});
      else actions.push({label:'Accept alliance',act:'accept',arg:offer.id,primary:true,disabled:pendingCommand,id:'primary'},{label:'Decline',act:'decline',arg:offer.id,disabled:pendingCommand});
    }else if(peaceOffer)actions.push({label:'Accept peace',act:'vote-peace',arg:peaceOffer.id,primary:true,disabled:pendingCommand,id:'primary'});
    else if(rel==='war')actions.push({label:(state.players.filter(x=>x.side===me.side).length>1?'Call peace vote':'Offer peace'),act:'peace',arg:id,primary:true,disabled:pendingCommand,id:'primary'});
    else if(rel==='forming'){const q=state.proposals.find(q=>q.status==='pending' && q.roster.includes(id) && q.roster.includes(state.you));note=`${q.name} starts at ${time(q.activateAt)}.`;actions.push({label:'Message',act:'compose',primary:true,id:'primary'});}
    else if(rel==='ally'){actions.push({label:'Message',act:'compose',primary:true,id:'primary'},{label:'Leave alliance',act:'leave',danger:true,disabled:pendingCommand || state.departures?.some(d=>d.country===state.you)});}
    else if(rel==='neutral' || rel==='open'){
      const canPropose=p.side.startsWith('solo:') && !(state.proposals || []).some(q=>q.status==='pending' && (q.roster.includes(id) || q.roster.includes(state.you)));
      if(canPropose)actions.push({label:proposing?'Send alliance offer':'Propose alliance',act:proposing?'send-offer':'propose',primary:true,disabled:pendingCommand,id:'primary'});
      else note=side?`${c.name} is in ${side.name}. Ask a member to invite you, or talk first.`:'A membership change is already pending.';
      if(rel==='neutral' && war?.mode!=='voting')actions.push({label:war?.mode==='vote'?`Call war vote`:'Declare war',act:'declare',arg:id,danger:true,disabled:pendingCommand});
      if(war?.mode==='voting')note=`War vote open: ${war.motion.fromYes.length}/${war.need} approvals.`;
      if(!canPropose)actions.unshift({label:'Message',act:'compose',primary:!actions.some(a=>a.primary),id:actions.some(a=>a.primary)?undefined:'primary'});
    }
  }
  if(note)status.append(el('small','card-note',note));
  const sub=[el('span','card-meta',p?`${seatType(p)} · ${p.displayName || p.name}`:'Unclaimed')];
  return {flag:id,title:c.name,sub,subKey:[p?.displayName,p?.name,seatType(p)],status,statusKey:[rel,troops,land.length,side?.id,side?.name,side?.members,enemies,note],relation:rel,
    composer:can?{channel:'dm',to:id,placeholder:`Message ${c.name}…`,note:'Only you and they can read this.'}:null,
    more:seated() && id!==state.you?()=>renderThread(countryThread(railItems,id),`No messages with ${c.name} yet.${can?' Say hello below.':''}`,proposing?proposalForm(id):null):null,actions};
}
function proposalForm(id){
  const me=myPlayer(),joining=me.side.startsWith('solo:');
  const f=coalitionForecast(state,[...state.players.filter(p=>p.side===me.side).map(p=>p.id),id],joining?null:me.side);
  const box=el('div','proposal');
  if(joining){
    const label=el('label','', 'Alliance name');const input=el('input');input.id='coalition-name';input.maxLength=40;input.value=$('coalition-name')?.value || `${faction(state.you).short}–${faction(id).short} Pact`;label.append(input);box.append(label);
  }else box.append(el('p','small',`${country(id).name} would join ${namedSide(me.side)}; every member must accept.`));
  box.append(el('p','small muted',`Together: ${f.economy}/${f.threshold} industry to win. Each member’s maximum share: ${f.members[0].maximumShare.toFixed(1)} points. Sending is your approval; the alliance starts ${state.rules.notice} game seconds after everyone accepts.`));
  return box;
}
function allianceCard(){
  const me=myPlayer();
  if(!me || spectating){return {title:'Spectating',status:el('div','card-relation',''),actions:[]};}
  const side=!me.side.startsWith('solo:')?state.sides.find(s=>s.id===me.side):null,forming=(state.proposals || []).find(q=>q.status==='pending' && q.roster.includes(state.you));
  const team=state.sides.find(s=>s.id===me.side),projection=state.projections.find(p=>p.country===state.you),enemies=relationsOf(state,state.you).enemies;
  const status=el('div','card-relation big');
  status.append(el('b',`rel ${side?'rel-ally':'rel-neutral'}`,side?'ALLIANCE':forming?'FORMING':'INDEPENDENT'));
  status.append(el('span','card-strength',`${team?.economy ?? 0}/${state.economyThreshold} industry to win${projection?` · ${signed(projection.projectedPrestige)} Prestige if you win`:''}`));
  if(forming)status.append(el('small','card-note',`${forming.name} starts at ${time(forming.activateAt)}.`));
  const wars=el('div','card-wars');
  wars.append(el('span','',enemies.length?'At war with ':'At peace with everyone.'),...enemies.map(e=>{const b=button(country(e).name,{openCountry:e},'link');return b;}));
  status.append(wars);
  const members=side?side.members:[];
  const list=el('div','card-members');
  if(!side)status.append(el('small','card-note','You are independent. Select a country — a standard on the leaderboard or a province’s owner — to propose an alliance.'));
  for(const m of members){const b=button('',{openCountry:m},'member');b.append(flag(m),el('span','',country(m).name));const pr=state.projections.find(p=>p.country===m);if(pr)b.append(el('small','',`${Math.round(pr.maturity*100)}% earned`));if(m===state.you)b.disabled=true;list.append(b);}
  status.append(list);
  const votes=decisionsFor(state).filter(d=>d.kind.endsWith('_vote'));
  const actions=votes.map((d,i)=>({label:`${d.kind==='war_vote'?'Approve war on':'Approve peace with'} ${d.motion.toRoster.map(id=>country(id).name).join(' + ')}`,act:d.kind==='war_vote'?'vote-war':'vote-peace',arg:d.id,primary:i===0,id:i===0?'primary':undefined,danger:d.kind==='war_vote',disabled:pendingCommand}));
  if(side && active())actions.push({label:'Leave alliance',act:'leave',danger:true,disabled:pendingCommand || state.departures?.some(d=>d.country===state.you)});
  const empty=side?'No alliance messages yet.':'You are independent. Select a country — on the leaderboard or a province’s owner — to propose an alliance.';
  return {flag:state.you,title:side?side.name:country(state.you).name,sub:[el('span','card-meta',side?`${side.members.length} members · your alliance`:'Your country · no alliance')],subKey:[side?.id,side?.members.length],
    status,statusKey:[side?.id,side?.name,members,team?.economy,state.economyThreshold,projection?.projectedPrestige,forming?.id,enemies,state.projections.map(p=>p.maturity)],relation:side?'ally':'',
    composer:side && active()?{channel:'alliance',placeholder:'Message your alliance…',note:state.rules.revealAllianceChatAfterMatch?'Alliance chat becomes public in the replay after the match ends.':'Only members can read this.'}:null,
    more:side?()=>renderThread(allianceThread(railItems,side.id),empty):null,actions};
}
/** A conversation inside a card: chat and diplomatic rows (text only). Shown rows count as read. */
function renderThread(items,empty,extra=null){
  const body=$('card-body'),key=JSON.stringify([items.map(i=>i.seq),empty,Boolean(extra),card?.id]);
  if(body.dataset.key!==key){
    body.dataset.key=key;
    const list=el('ol','thread');
    for(const item of items.slice(-40)){
      const li=el('li',`thread-row${item.from===state.you?' mine':''}`);li.dataset.seq=String(item.seq);
      if(item.type==='message'){const head=el('header');head.append(flag(item.from),el('b','',item.from===state.you?'You':country(item.from).name),el('time','',time(item.tick)));li.append(head,el('p','thread-text',item.text));}
      else{const copy=systemCopy(item,{...feedNames,players:state.players.length});li.classList.add('thread-system');li.append(el('b','',copy.title),el('span','',` · ${time(item.tick)} · ${copy.detail}`));}
      list.append(li);
    }
    body.replaceChildren(...(extra?[extra]:[]),...(items.length?[list]:[el('p','thread-empty',empty)]));
    list.scrollTop=list.scrollHeight;
  }
  // Seen in an open, expanded card = read (per item).
  const fresh=worldFeed.markRead(items.filter(i=>i.from!==state.you).map(i=>i.seq));
  if(fresh.length){renderAttention();if(fresh.some(seq=>notifier.current?.key===`e${seq}`))notifier.dismiss();}
}

/* ── HUD ── */
function renderHud(){
  const me=myPlayer(),team=state.sides.find(s=>s.id===me?.side);
  const land=state.provinces.filter(p=>p.owner===state.you && state.you);
  const troops=land.reduce((n,p)=>n+p.troops,0)+state.armies.filter(a=>a.country===state.you).reduce((n,a)=>n+a.amount,0);
  $('commander-title').textContent=country(state.you)?.name || (state.status==='running'?'Spectating':'Observer');
  setHTML($('commander-insignia'),insignia(state.you));
  $('commander-side').textContent=me?(me.eliminatedAt!==null?'Eliminated':me.side.startsWith('solo:')?'Independent':namedSide(me.side)):'';
  $('hud-standard').disabled=!me || spectating;
  $('hud-standard').setAttribute('aria-label',me && !spectating?`${country(state.you).name}: your alliance and diplomacy`:'Spectating');
  const stat=(name,label,value,title)=>`<span class="stat" title="${esc(title)}">${icon(name)}<span class="sr-only">${esc(label)} </span><b>${value}</b></span>`;
  const holdings=state.you?land.length:state.provinces.filter(p=>p.owner).length,forces=state.you?troops:state.provinces.reduce((n,p)=>n+p.troops,0);
  setHTML($('operations'),stat('military',state.you?'Forces':'Troops on the map',forces,state.you?'Your troops: garrisons and armies':'All garrisoned troops')+
    stat('land',state.you?'Holdings':'Provinces held',`${holdings}<small>/${state.provinces.length}</small>`,`${state.you?'Your holdings':'Provinces held by all powers'}: ${holdings} of ${state.provinces.length}`));
  const dominant=Object.entries(state.dominance)[0];
  document.querySelector('.campaign-bar').classList.toggle('victory-warning',Boolean(dominant) && state.status==='running');
  $('victory-status').setAttribute('role','timer');$('victory-status').setAttribute('aria-live','off');
  const economy=team?.economy ?? 0;
  $('victory-status').textContent=dominant && state.status==='running'?`${namedSide(dominant[0])} wins in ${state.rules.hold-(state.tick-dominant[1])}s unless stopped`:
    me?`Industry ${economy}/${state.economyThreshold} · hold ${state.rules.hold}s to win`:`${state.economyThreshold} industry held ${state.rules.hold}s wins`;
}

/* ── Rendering ── */
function describe(e){
  const c=id=>country(id)?.name || id;
  switch(e.type){
    case 'joined':return`${e.name} takes ${c(e.country)}.`;
    case 'started':return'The council is in session. Armies may move.';
    case 'army_departed':return`${c(e.country)} commits ${e.amount} troops: ${place(e.from).name} → ${place(e.to).name}.`;
    case 'development_started':return`${c(e.country)} invests ${e.cost} manpower in ${place(e.province).name}; level ${e.level} completes at ${time(e.completesAt)}.`;
    case 'development_completed':return`${place(e.province).name} reaches industrial level ${e.level}.`;
    case 'army_recalled':return`${c(e.country)} ${e.reason?'turns back':'recalls'} ${e.amount} troops${e.province?` from ${place(e.province).name}`:''}; return to ${place(e.to).name} at ${time(e.arrivesAt)}.`;
    case 'army_turned_around':return`${c(e.country)} turns ${e.amount} troops back toward ${place(e.to).name}; arrival ${time(e.arrivesAt)}.`;
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
  $('result').hidden=false;document.body.classList.add('reviewing');placeSound();closeCard();
  if(!review || review.id!==state.id){review?.destroy();review=new AfterAction($('result'),state,map);}
}
function resetPresentation(){
  signalCursor=null;clearTimeout(toastTimer);$('toast').hidden=true;
  toggleJournal(false);
}
function toggleJournal(open){
  $('war-journal').hidden=!open;$('journal-toggle').setAttribute('aria-expanded',String(open));
}
/** Fresh completed battles of this seat (Secured, Lost, Line held): a compact toast, never replayed. */
function battleNotices(){
  const signal=signalCursor===null?null:battleSignal(state,history.filter(e=>e.id>signalCursor));
  signalCursor=cursor;
  if(signal && seated())notifier.push({key:`battle-${signal.tick}-${signal.province}`,kind:signal.tone==='lost'?'decision':'battle',title:`${signal.title} · ${place(signal.province).name}`,
    detail:`${signal.troops} troops remain after the battle · ${time(signal.tick)}`,buttons:[{label:'View',data:{feedProvince:signal.province}}]});
}
function renderLobby(){
  for(const b of $('faction-choices').querySelectorAll('button')){
    const id=b.dataset.countrySeat,occupant=state.players.find(p=>p.id===id);
    b.disabled=Boolean(occupant);b.setAttribute('aria-pressed',String($('country-choice').value===id));
    b.title=occupant?`${seatType(occupant)} · ${occupant.displayName || occupant.name}`:startingSummary(country(id));
    b.querySelector('small').textContent=occupant?`${seatType(occupant)} · ${occupant.displayName || occupant.name}`:`${country(id).start.length} holdings`;
  }
  $('lobby').hidden=state.status!=='lobby';$('join-form').hidden=Boolean(state.you);
  options('country-choice',map.countries.filter(c=>!state.players.some(p=>p.id===c.id)).map(c=>({value:c.id,label:c.name})),$('country-choice').value);
  $('host-controls').hidden=!state.isHost;$('fill-bots').disabled=state.players.length===8;$('start-match').disabled=state.players.length<2 || !state.you;
  const selected=country($('country-choice').value);
  $('starting-holdings').textContent=state.you?'':startingSummary(selected);
  $('join-form').querySelector('button').disabled=!selected;
  $('lobby-note').textContent=state.you?`You command ${country(state.you).name}. ${state.isHost?'Invite players, attach agents, or add bots. You control when play begins.':'Waiting for the host to start.'}`:'You are observing. Choose an open country above to join.';
}
/** One sound control: in the ☰ menu during a live room, in the masthead on the home page and in review. */
function placeSound(){
  const slot=matchId && !document.body.classList.contains('reviewing')?$('hud-sound-slot'):$('masthead-sound-slot');
  if($('sound-control').parentElement!==slot)slot.append($('sound-control'));
}
function render(){
  if(!state)return;
  document.body.classList.toggle('spectating',state.status==='running' && (!state.you || spectating));
  document.body.dataset.status=state.status;
  if(state.status!=='running' && card)closeCard();
  document.querySelector('.scenario-note').textContent=map.notice;
  $('game-name').textContent=state.name;$('lobby-room').textContent=state.name;$('room-label').textContent=`COUNCIL ${state.id.toUpperCase()} · ${state.eligible?'LEAGUE · ':''}${state.players.length}/8 SEATS`;
  renderLobby();
  $('phase').textContent=state.status==='lobby'?'ASSEMBLING':state.status==='finished'?'CONCLUDED':seated()?'IN SESSION':'SPECTATING';
  $('clock').textContent=`${time(state.tick)} / 30:00`;$('pace-badge').textContent=state.speed===1?'STANDARD · 1×':`QUICK · ${state.speed}×`;
  placeSound();battleNotices();
  paintMap();renderHud();renderResult();renderLeaderboard();
  $('events').innerHTML=history.map(e=>({e,description:describe(e)})).filter(x=>x.description).slice(-30).reverse().map(({e,description})=>`<div class="event"><time>${time(e.tick)}</time>${esc(description)}</div>`).join('');
}
async function home(){resetPresentation();sounds.leave();review?.destroy();review=null;closeCard();closeMenu();expander.set(false,{fromBrowser:true});document.body.classList.remove('reviewing','spectating');generation++;pollController?.abort();document.body.classList.remove('in-game');matchId=null;state=null;spectating=false;herald.reset();worldFeed.reset();notifier.reset();messageCatchupComplete=false;$('home').hidden=false;$('game').hidden=true;window.history.replaceState({},'','/');placeSound();await rooms();}

/* ── First-match coach marks: three tips, dismissible, stored per browser. ── */
const COACH=[['card-anchor','Drag from your province to a neighbour to attack — or tap your province, then the target. One button sends.'],
  ['leaderboard','Tap a country — a standard here, a leaderboard row or a province’s owner — to talk, ally or declare war.'],
  ['hud-standard','Your standard opens your alliance. The ⚑ beside it counts what needs you: tap it to answer.']];
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
async function perform(act,arg,b){
  switch(act){
    case 'send':return sendOrder();
    case 'develop':{
      const p=prov(arg),cost=state.rules.developmentCosts[p.development],f=developmentForecast(state,arg);
      if(!await confirmAction({title:`Develop ${place(arg).name}?`,message:`Spend ${cost} troops from this garrison. ${f?`Earliest payback ${time(f.paybackAt)}; ${f.paysBackBeforeDeadline?'it repays before the deadline':'it will not repay before the deadline'}.`:''} Unfinished construction is lost on capture; completed industry can be captured.`,accept:`Invest ${cost} troops`}))return;
      const r=await command({type:'develop',from:arg});if(r)toast(`Investment committed. Completion at ${time(r.completesAt)}.`);return;
    }
    case 'recall':{const r=await command({type:'recall',id:arg});if(r){toast('Recall queued. The troops turn around at their actual position.');if(card?.kind==='army')closeCard();}return;}
    case 'turn-around':{const a=state.armies.find(a=>a.id===arg),r=await command({type:'turn_around',armyId:arg});
      if(r)toast(r.mode==='recall'?'Recall queued. The troops turn around at their actual position.':`Turning around: ${a?.amount ?? ''} troops head back to ${place(r.to).name}, arriving ${time(r.arrivesAt)}.`.replace('  ',' '));return;}
    case 'route':{const r=await command({type:'route',from:sources[0],to:arg || null});if(r)toast(arg?'Recruitment arrow queued.':'Arrow removal queued.');return;}
    case 'route-clear':{const r=await command({type:'route',from:arg,to:null});if(r)toast('Arrow removal queued.');return;}
    case 'draft':{sources=[arg];target=b.dataset.to;fraction=1;openCard('province',target);paintMap();toast('Transfer drafted; review the garrison before sending.');return;}
    case 'compose':setCardSize('full');$('composer-text').focus();return;
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
      const r=await command({type:'declare_war',country:arg});if(r)toast(r.status==='enacted'?`War declared on ${country(arg).name}.`:'War vote opened for 60 game seconds.');return;
    }
    case 'peace':{const r=await command({type:'offer_peace',country:arg});if(r)toast(r.status==='offered'?'Peace treaty sent.':'Coalition vote to send peace opened.');return;}
    case 'vote-war':{const r=await command({type:'vote_war',motionId:arg});if(r)toast(r.status==='enacted'?'War declared.':'War vote recorded.');return;}
    case 'vote-peace':{const r=await command({type:'vote_peace',motionId:arg});if(r)toast(r.status==='enacted'?'Peace agreed; attacking troops are returning.':'Peace vote recorded.');return;}
    case 'leave':{if(!await confirmAction({title:'Leave your alliance?',message:'Departure takes effect after 30 game seconds. Your earned share resets to zero in your new allegiance. Armies use the allegiance in force when they arrive. Recall takes time; it does not restore troops instantly.',accept:'Announce departure'}))return;const r=await command({type:'leave'});if(r)toast('Departure announced. Your independent maturity clock restarts on departure.');return;}
    default:return;
  }
}

/* ── Wiring ── */
$('create-form').addEventListener('submit',safely(async()=>{await ensureIdentity($('display-name').value);const g=await request('/api/games','POST',{name:$('room-name').value,preset:$('preset').value});await openRoom(g.id);}));
$('join-form').addEventListener('submit',safely(async()=>{await ensureIdentity($('join-name').value);await request(`/api/games/${matchId}/join`,'POST',{country:$('country-choice').value,kind:'human'});await poll();toast('Your seat is reserved.');}));
$('fill-bots').addEventListener('click',safely(async()=>{await request(`/api/games/${matchId}/bots`,'POST',{});await poll();}));
$('start-match').addEventListener('click',safely(async()=>{await request(`/api/games/${matchId}/start`,'POST',{});await poll();toast('The council is in session.');}));
$('country-choice').addEventListener('change',()=>{const c=country($('country-choice').value);$('starting-holdings').textContent=startingSummary(c);if(state)renderLobby();});
$('amount-slider').addEventListener('input',()=>{fraction=Math.max(.01,Math.min(1,Number($('amount-slider').value)/100));try{localStorage.setItem('coi.fraction',String(fraction));}catch{}if(state){renderCard();paintMapDraftOnly();}});
$('feed-form').addEventListener('submit',safely(async()=>{
  const text=$('feed-text').value;if(!text.trim())return;
  const r=await command({type:'chat',channel:'world',text});if(r)$('feed-text').value='';
}));
$('composer').addEventListener('submit',safely(async()=>{
  const text=$('composer-text').value,channel=$('composer').dataset.channel;if(!text.trim() || !channel)return;
  const r=await command({type:'chat',channel,...(channel==='dm'?{to:$('composer').dataset.to}:{}),text});if(r)$('composer-text').value='';
}));
$('feed-toggle').addEventListener('click',()=>{
  const open=!worldFeed.open;if(open)openRail();else worldFeed.setOpen(false);
  try{localStorage.setItem('coi.feed',open?'open':'collapsed');}catch{}
});
$('lb-toggle').addEventListener('click',()=>{
  const open=!standings.open;standings.setOpen(open);
  try{localStorage.setItem('coi.leaderboard',open?'open':'collapsed');}catch{}
});
for(const b of document.querySelectorAll('[data-lb-mode]'))b.addEventListener('click',()=>{standings.setMode(b.dataset.lbMode);if(state)renderLeaderboard();});
$('back').addEventListener('click',safely(home));$('refresh-rooms').addEventListener('click',safely(rooms));
for(const b of document.querySelectorAll('[data-share]'))b.addEventListener('click',safely(async()=>{closeMenu();try{await navigator.clipboard.writeText(location.href);toast('Room link copied. It contains no credentials.');}catch{prompt('Copy this room link. It contains no credentials:',location.href);}}));
const changeIdentity=safely(async()=>{closeMenu();const name=prompt('Create a separate local player identity. Existing results stay with the old identity. Enter a new display name:');if(name?.trim()){await ensureIdentity(name,true);if(matchId)await poll();}});
$('account-button').addEventListener('click',changeIdentity);$('menu-identity').addEventListener('click',changeIdentity);
$('zoom-in').onclick=()=>atlas.zoom(.7);$('zoom-out').onclick=()=>atlas.zoom(1.4);
$('world-view').onclick=()=>{closeMenu();atlas.world();};$('europe-view').onclick=()=>{closeMenu();atlas.europe();};$('home-view').onclick=focusCountry;
// Expand map: real fullscreen where available, a CSS pseudo-fullscreen otherwise (iPhone Safari).
expander=new ExpandableMap($('stage'),$('map-expand'),{label:'map',target:document.documentElement,escape:false,iconOnly:true,onChange:on=>{
  $('fullscreen-toggle').setAttribute('aria-pressed',String(on));$('fullscreen-toggle').textContent=on?'Exit expanded map':'Expand map (full screen)';
  requestAnimationFrame(()=>atlas?.layout());
}});
$('fullscreen-toggle').addEventListener('click',()=>{closeMenu();expander.toggle();});
function closeMenu(focus=false){
  if($('hud-menu').hidden)return;
  $('hud-menu').hidden=true;$('menu-button').setAttribute('aria-expanded','false');if(focus)$('menu-button').focus();
}
function openMenu(){$('hud-menu').hidden=false;$('menu-button').setAttribute('aria-expanded','true');$('hud-menu').querySelector('button').focus();}
$('menu-button').addEventListener('click',()=>{if($('hud-menu').hidden)openMenu();else closeMenu(true);});
$('card-close').addEventListener('click',()=>closeCard({restoreFocus:true}));
$('card-size').addEventListener('click',()=>setCardSize(cardSize==='full'?'peek':'full'));
$('hud-standard').addEventListener('click',()=>{if(card?.kind==='alliance')closeCard({restoreFocus:true});else openCard('alliance',null,{focus:true});});
$('attention').addEventListener('click',openAttention);
// Phones: drag the sheet's head down to close it, up to expand it.
let sheetDrag=null;
$('card').querySelector('.card-head').addEventListener('pointerdown',event=>{if(!compact.matches || event.target.closest('button'))return;sheetDrag={y:event.clientY};});
$('card').querySelector('.card-head').addEventListener('pointerup',event=>{if(!sheetDrag)return;const dy=event.clientY-sheetDrag.y;sheetDrag=null;if(dy>40){if(cardSize==='full')setCardSize('peek');else closeCard();}else if(dy<-40)setCardSize('full');});
document.addEventListener('keydown',event=>{
  if(!state || document.body.classList.contains('reviewing') || event.ctrlKey || event.metaKey || event.altKey || $('confirm-dialog').open)return;
  const typing=event.target.closest('input,select,textarea,dialog');
  // Escape closes the top-most layer: coach tip, banner, menu, war log, card (and its selection), expanded map.
  if(event.key==='Escape' && (!typing || event.target.closest('#card'))){
    if(!$('coach').hidden)endCoach();
    else if(herald.dismiss()){}
    else if(!$('hud-menu').hidden)closeMenu(true);
    else if(!$('war-journal').hidden){toggleJournal(false);$('menu-button').focus();}
    else if(card)closeCard({restoreFocus:true});
    else if(expander.on)expander.set(false);
    else{clearSelection();paintMap();}
    return;
  }
  if(typing)return;
  if(event.key.toLowerCase()==='j'){toggleJournal($('war-journal').hidden);return;}
  if(event.key.toLowerCase()==='c')focusCountry();
  if(event.key==='m')atlas.setMapMode(atlas.mode==='diplomacy'?'political':'diplomacy');  // Shift+M is the sound mute
  if(event.key.toLowerCase()==='q')atlas.zoom(1.25);
  if(event.key.toLowerCase()==='e')atlas.zoom(.8);
});
document.addEventListener('pointerdown',event=>{
  if(!$('hud-menu').hidden && !event.target.closest('#hud-menu,#menu-button'))closeMenu();
});
document.addEventListener('change',event=>{
  if(event.target.id==='destination' && event.target.value){selectProvince(event.target.value,{keyboard:true});}
});
document.addEventListener('click',safely(async event=>{
  const b=event.target.closest('button');if(!b)return;
  if(b.id==='journal-toggle'){closeMenu();toggleJournal($('war-journal').hidden);}
  if(b.id==='journal-close'){toggleJournal(false);$('menu-button').focus();}
  if(b.dataset.countrySeat){$('country-choice').value=b.dataset.countrySeat;$('country-choice').dispatchEvent(new Event('change'));atlas.home(b.dataset.countrySeat);}
  if(b.dataset.room)await openRoom(b.dataset.room,b.dataset.spectate==='true');
  if(b.dataset.home)await home();
  if(b.dataset.fraction){fraction=Number(b.dataset.fraction);try{localStorage.setItem('coi.fraction',String(fraction));}catch{}renderCard();paintMapDraftOnly();}
  if(b.dataset.removeSource){sources=sources.filter(s=>s!==b.dataset.removeSource);renderCard();paintMap();}
  if(b.dataset.feedProvince && state){const id=b.dataset.feedProvince;atlas.focus(id,view());if(state.status==='running'){armyId=null;proposing=false;const mine=active() && prov(id)?.owner===state.you;sources=mine?[id]:[];target=mine?null:id;if(!mine)selectProvince(id);else{openCard('province',id);paintMap();}}}
  if(b.dataset.feedCountry && state)openCard('country',b.dataset.feedCountry);
  if(b.dataset.openCountry && state){openCard('country',b.dataset.openCountry,{focus:!b.closest('#card'),compose:b.dataset.compose==='1',size:b.dataset.compose==='1'?'full':undefined});}
  if(b.dataset.openAlliance && state)openCard('alliance',null,{focus:true,compose:b.dataset.compose==='1',size:'full'});
  if(b.dataset.recall)await perform('recall',b.dataset.recall,b);
  if(b.dataset.showArmy && state)showArmy(b.dataset.showArmy);
  if(b.dataset.act)await perform(b.dataset.act,b.dataset.arg,b);
  if(b.dataset.feedFilter){worldFeed.setFilter(b.dataset.feedFilter);for(const chip of document.querySelectorAll('[data-feed-filter]'))chip.setAttribute('aria-pressed',String(chip===b));}
}));
for(const element of document.querySelectorAll('[data-icon]'))element.innerHTML=icon(element.dataset.icon);
worldFeed=new WorldFeed({list:$('feed-list'),unread:$('feed-unread'),toggle:$('feed-toggle'),body:$('feed-body'),jump:$('feed-jump')},feedNames);
// Private rows link to the card that answers them.
worldFeed.link=item=>{
  if(!state?.you || spectating)return null;
  if(item.system==='turned_back')return state.armies.some(a=>a.id===item.armyId)?{key:'showArmy',value:item.armyId,label:'Show army ›',aria:`Show your ${item.amount} returning troops`}:null;
  const thread=threadOf(item);if(!thread)return null;
  if(thread.kind==='country')return {key:'openCountry',value:thread.id,label:'Open ›',aria:`Open ${country(thread.id)?.name || 'country'}`};
  return {key:'openAlliance',value:'1',label:'Open ›',aria:'Open your alliance'};
};
worldFeed.onRead=()=>{saveRead();if(state)renderAttention();};
standings=new LeaderboardPanel({root:$('leaderboard'),rows:$('lb-rows'),toggle:$('lb-toggle'),summary:$('lb-summary'),modes:[...document.querySelectorAll('[data-lb-mode]')],fronts:$('lb-fronts'),powers:$('lb-powers'),
  onFocus:id=>{if(card?.kind!=='country')atlas?.setRelationFocus?.(id);},
  onSelect:id=>{if(!state)return;if(id===state.you && seated())openCard('alliance',null,{focus:true});else openCard('country',id,{focus:true});if(compact.matches)standings.setOpen(false);},
  onFront:([a,b])=>{const ids=state.provinces.filter(p=>a.includes(p.owner) && place(p.id).neighbors.some(n=>b.includes(prov(n)?.owner)) || b.includes(p.owner) && place(p.id).neighbors.some(n=>a.includes(prov(n)?.owner))).map(p=>p.id);
    atlas.fit(ids.length?ids:[...a,...b].map(id=>state.provinces.find(p=>p.owner===id)?.id).filter(Boolean),view());}},feedNames);
{let saved=null;try{saved=localStorage.getItem('coi.leaderboard');}catch{}
  standings.setOpen(saved?saved==='open':!compact.matches);}
herald=new Herald({declaration:$('declaration'),alliance:$('alliance-seal'),fallen:$('fallen-seal')});
notifier=new Notifier($('notice'));
{const push=notifier.push.bind(notifier);notifier.push=n=>{$('toast').hidden=true;push(n);};} // a notice about something new replaces an older toast
const sounds=new SoundBoard($('sound-control'));
{let saved=null;try{saved=localStorage.getItem('coi.feed');}catch{}
  worldFeed.setOpen(saved?saved==='open':!compact.matches);}
compact.addEventListener('change',event=>{
  if(event.matches){standings.setOpen(false);if(card)worldFeed.setOpen(false);return;}
  // Back to a wide screen: the rail returns (the leaderboard and history are side panels again).
  let saved=null;try{saved=localStorage.getItem('coi.leaderboard');}catch{}standings.setOpen(saved!=='collapsed');
});
try{map=await request('/map.json','GET',undefined,null);initMap();showIdentity();const params=new URL(location).searchParams,initial=params.get('match');if(initial)await openRoom(initial,params.get('spectate')==='1');else await rooms();setConnection(state?.status==='finished'?'Review':'Live');}catch(e){toast(e.message,true);}
addEventListener('resize',()=>requestAnimationFrame(syncInsets));
setInterval(()=>{if(matchId)poll();},750);
