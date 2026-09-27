import { DIFFICULTIES, PERSONALITIES, botLabel } from './bot-profiles.js';
const $ = id => document.getElementById(id);
import { AfterAction } from './review.js';
import { developmentForecast, coalitionForecast } from './insights.js';
import { faction, insignia, icon, battleSignal } from './presentation.js';
import { Atlas } from './atlas.js';
import { escapeHTML as esc, syncOptions, setHTML, operationId, confirmAction } from './ui.js';
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
let messageCatchupComplete=false, messageBubbles=[];
const country = id => map.countries.find(c=>c.id===id);
const place = id => map.provinces.find(p=>p.id===id);
const sideName = id => state?.sides.find(s=>s.id===id)?.name || id;
const namedSide = id => country(sideName(id))?.name || sideName(id);
const myPlayer = () => state?.players.find(p=>p.id===state.you);
function toast(message,error=false){$('toast').textContent=message;$('toast').className=error?'error':'';$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,6500);}
async function request(path,method='GET',data,token=identity?.token){
  const response=await fetch(path,{method,headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});
  const value=await response.json();if(!response.ok){const error=new Error(value.error || `Request failed (${response.status}).`);error.status=response.status;throw error;}return value;
}
async function ensureIdentity(name, force=false){
  name=name.trim();if(!force && identity?.name===name)return;
  const profile=await request('/api/players','POST',{name},null);
  generation++;pollController?.abort();review?.destroy();review=null;resetPresentation();identity=profile;cursor=0;history=[];readMessageId=0;localStorage.setItem('coi.identity',JSON.stringify(identity));showIdentity();
}
function startingSummary(c){
  if(!c)return 'All countries are taken. You can still observe.';
  const troops=c.start.reduce((n,id)=>n+(c.garrisons?.[id] ?? c.startTroops ?? 10),0);
  const production=c.start.reduce((n,id)=>n+(c.development?.[id] ?? 1),0)*3;
  return `${c.start.length} holdings · ${troops} troops · ${production} recruits/min · ${c.colonies?.length || 0} colonial footholds. ${c.start.map(id=>place(id).name).join(' · ')}`;
}
function showIdentity(){ $('identity').textContent=identity?.name || 'Observer';$('display-name').value=identity?.name || '';$('join-name').value=identity?.name || ''; }
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
  setMapFullscreen(false);spectating=watch;messageCatchupComplete=false;messageBubbles=[];
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
    const liveMessages=[];
    for(let page=0;page<10;page++) {
      const response=await fetch(`/api/games/${room}?after=${cursor}`,{headers:!spectating && identity?.token?{Authorization:`Bearer ${identity.token}`}:{},signal:controller.signal});
      const next=await response.json();
      if(epoch!==generation || room!==matchId)return;
      if(!response.ok)throw new Error(next.error || 'Unable to observe this room.');
      if(messageCatchupComplete)liveMessages.push(...next.events.filter(e=>e.type==='message' && e.channel==='world'));
      state=next;cursor=next.cursor;history.push(...next.events);
      if(!next.hasMore)break;
    }
    if(!state.hasMore)messageCatchupComplete=true;
    if(state.status==='running' && !state.you)pushMessageBubbles(liveMessages,epoch);
    $('connection').textContent=state.status==='finished'?'Review':'Live';render();
  }catch(e){if(e.name!=='AbortError' && epoch===generation){$('connection').textContent='Reconnecting';toast(e.message,true);}}
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
    await poll();return result;
  }finally{pendingCommand=false;if(epoch===generation && state)renderOrders();}
}
const safely=fn=>async event=>{if(event?.type==='submit')event.preventDefault();try{await fn(event);}catch(e){toast(e.message,true);}};
function initMap(){
  $('faction-parade').innerHTML=map.countries.map(c=>`<span>${insignia(c.id)}<b>${esc(faction(c.id).short)}</b></span>`).join('');
  $('faction-choices').innerHTML=map.countries.map(c=>`<button type="button" data-country-seat="${c.id}" aria-pressed="false">${insignia(c.id)}<b>${esc(faction(c.id).short)}</b><small>${c.start.length} holdings</small></button>`).join('');
  $('scoreboard').innerHTML=map.countries.map(c=>`<button type="button" class="country-card" data-country-focus="${c.id}" style="--country:${c.color}"></button>`).join('');
  atlas?.destroy();
  const previous=$('map'),replacement=previous.cloneNode(false);previous.replaceWith(replacement);
  atlas=new Atlas(replacement,map,selectProvince);
  $('landing-map').innerHTML=map.provinces.map(p=>`<path d="${p.path}"/>`).join('');
}
function focusCountry(){if(state?.you)atlas.home(state.you);}
function selectProvince(id,modifiers={}){
  if(!state)return;
  const p=state.provinces.find(p=>p.id===id);inspected=id;
  const own=p.owner===state.you && state.you;
  if(own && (modifiers.shiftKey || !source || source===id)){
    source=source===id && !modifiers.shiftKey?null:id;destination=null;
    if(source)$('amount').value=Math.max(1,Math.floor(availableTroops()/2));
  }else if(source && place(source).neighbors.includes(id))destination=id;
  else if(own){source=id;destination=null;$('amount').value=Math.max(1,Math.floor(availableTroops()/2));}
  if(source || own)showTab('orders');
  renderOrders();paintMap();$('orders-tab').scrollTop=0;
}
function availableTroops(){
  const p=state?.provinces.find(p=>p.id===source);
  const reserved=state?.commandBudget?.reserved.filter(o=>['move','develop'].includes(o.type) && o.from===source).reduce((n,o)=>n+o.amount,0) || 0;
  return Math.max(0,(p?.troops || 0)-reserved-1);
}
function paintMap(){
  if(!state)return;atlas.update(state,source,destination);
  $('selection-label').textContent=!state.you?`${state.name} · ${time(state.tick)} · LIVE`:source?`${place(source).name}${destination?' → '+place(destination).name:' · Choose a connected destination'}`:'Select a province to begin';
}
function setMapFullscreen(on){
  document.body.classList.toggle('spectator-map-fullscreen',on);
  const button=$('spectator-fullscreen');button.setAttribute('aria-pressed',String(on));button.textContent=on?'Exit full screen':'Full screen';
  if(atlas)requestAnimationFrame(()=>atlas.layout());
}
function renderMessageBubbles(){
  const box=$('spectator-bubbles');
  box.hidden=!state || state.status!=='running' || Boolean(state.you) || !messageBubbles.length;
  if(box.hidden){box.replaceChildren();return;}
  box.innerHTML=messageBubbles.map(e=>`<article class="spectator-bubble"><header>${esc(country(e.from)?.name || e.from)} · ${time(e.tick)}</header><p>${esc(e.text)}</p></article>`).join('');
}
function pushMessageBubbles(events,epoch){
  for(const e of events){
    messageBubbles.push(e);messageBubbles=messageBubbles.slice(-3);
    setTimeout(()=>{if(generation!==epoch)return;messageBubbles=messageBubbles.filter(m=>m.id!==e.id);renderMessageBubbles();},12000);
  }
  if(events.length)renderMessageBubbles();
}
function renderOrders(){
  const scroll=$('orders-tab').scrollTop;
  const mode=state.rules.distanceMovement?orderMode:'march';
  $('orders-tab').dataset.orderMode=mode;
  $('order-modes').hidden=!state.rules.distanceMovement;
  for(const button of document.querySelectorAll('[data-order-mode]'))button.setAttribute('aria-pressed',String(button.dataset.orderMode===mode));
  const owned=state.provinces.filter(p=>p.owner===state.you && state.you);
  if(source && !owned.some(p=>p.id===source)){source=null;destination=null;}
  options('source',[{value:'',label:owned.length?'Choose your province…':'No controlled provinces'},...owned.map(p=>({value:p.id,label:`${place(p.id).name} · ${p.troops} troops`}))],source || '');
  const neighbors=source?place(source).neighbors:[];
  if(destination && !neighbors.includes(destination))destination=null;
  options('destination',[{value:'',label:'Choose a connected destination…'},...neighbors.map(id=>{const p=state.provinces.find(p=>p.id===id);return{value:id,label:`${place(id).name} · ${p.troops} · ${country(p.owner)?.name || 'Neutral'}`};})],destination || '');
  $('commander-title').textContent=country(state.you)?.name || 'Observer';
  setHTML($('commander-insignia'),insignia(state.you));
  $('province-title').textContent=place(source || inspected)?.name || 'Select a province';
  const active=state.status==='running' && myPlayer()?.eliminatedAt===null;
  const available=availableTroops(),amount=Number($('amount').value),valid=Number.isSafeInteger(amount) && amount>0 && amount<=available;
  const recovery=state.commandBudget?.nextRecoveryAt;
  $('budget').textContent=state.commandBudget?`${state.commandBudget.remaining}/3 commands available${recovery!==null && recovery!==undefined?` · next in ${Math.max(0,recovery-state.tick)}s`:''}`:'Join a country in the lobby to play.';
  const canCommand=active && source && !pendingCommand && state.commandBudget?.remaining>0;
  $('send-army').disabled=!canCommand || !destination || !valid;
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
  if(inspectedId)setHTML($('incoming-waves'),`<h3>${esc(place(inspectedId).name)} · incoming waves</h3>${waves.length?waves.slice(0,4).map(a=>`<p>${a.amount} ${esc(country(a.country).name)} · ${a.returning?'returning':'marching'} · arrives ${time(a.arrivesAt)} (${a.arrivesAt-state.tick}s)</p>`).join(''):'<p>No armies committed to this destination.</p>'}${waves.length>4?`<p>Plus ${waves.length-4} later armies.</p>`:''}${previousBattle?`<p>Last battle ${time(previousBattle.tick)}: ${previousBattle.troops} survivors; ${esc(country(previousBattle.owner)?.name || 'neutral')} held afterward.</p>`:''}`);
  const inspectedProvince=state.provinces.find(p=>p.id===(inspected || source));
  setHTML($('province-readout'),p?`<div><span>AVAILABLE</span><strong>${available}</strong></div><div><span>GARRISON</span><strong>${p.troops}</strong></div><div><span>RECRUIT IN</span><strong>${p.nextRecruit===null?'—':Math.max(0,p.nextRecruit-state.tick)+'s'}</strong></div>`:inspectedProvince?`<p><b>${esc(place(inspectedProvince.id).name)}</b><br>${esc(country(inspectedProvince.owner)?.name || 'Uncontrolled')} · ${inspectedProvince.troops} troops</p>`:'<p><b>Your next decision starts on the map.</b><br>Select a province you own, then a neighboring target. Nothing moves until you commit.</p>');
  renderDevelopment(p,canCommand);
  renderCoordination(owned,active);
  renderMarches(active);
  renderCommandFooter();
  if(mode==='march')updatePreview();
  $('orders-tab').scrollTop=scroll;
}
function freeTroops(id) {
  const p=state.provinces.find(p=>p.id===id);
  const reserved=(state.commandBudget?.reserved || []).filter(o=>o.from===id && ['move','develop'].includes(o.type)).reduce((n,o)=>n+o.amount,0);
  return Math.max(0,(p?.troops || 0)-reserved-1);
}
function renderDevelopment(p,canCommand) {
  const panel=$('development-panel');panel.hidden=!state.rules.distanceMovement || orderMode!=='develop' || !p;
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
  const panel=$('coordination-panel');panel.hidden=!state.rules.distanceMovement || orderMode!=='coordinate';
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
  $('attack-summary').textContent=selected.length?`${selected.length} sources · ${total} troops · earliest arrival ${time(earliest)}. Nearby sources wait before dispatch. Waiting troops remain vulnerable at home.`:'Choose the provinces that will take part.';
  const valid=selected.every(([id,value])=>{const amount=value.amount ?? Math.floor(freeTroops(id)*value.percent/100);return Number.isSafeInteger(amount)&&amount>0&&amount<=freeTroops(id);});
  if(selected.length && !valid)$('attack-summary').textContent='Each selected source needs a positive, available troop amount. Adjust the draft or uncheck that source.';
  $('coordinate-commit').disabled=!active || !selected.length || !valid || pendingCommand || !state.commandBudget?.remaining;
  $('coordinate-preview').disabled=!active || !selected.length || pendingCommand;
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
  const canRecall=active && state.rules.distanceMovement && !pendingCommand && state.commandBudget?.remaining;
  const moving=state.armies.filter(a=>a.country===state.you).sort((a,b)=>a.arrivesAt-b.arrivesAt);
  const reserved=state.commandBudget?.reserved || [];
  const recallButton=(id,label)=>`<button type="button" data-recall="${id}" ${canRecall?'':'disabled'}>${label}</button>`;
  const queued=reserved.map(o=>`<div class="march-row"><span>${o.type==='recall'?'Recall queued':o.type==='develop'?'Construction queued':`${o.amount || ''} · ${esc(place(o.from)?.name || '')}`}<small>${o.executeAt-state.tick}s until ${o.type==='move'?'departure':'execution'}</small></span>${o.type==='move'&&state.rules.distanceMovement?recallButton(o.id,'Cancel'):''}</div>`).join('');
  const groups=[...new Set([...moving,...reserved].filter(a=>a.groupId&&!a.returning).map(a=>a.groupId))];
  const groupControls=state.rules.distanceMovement?groups.filter(id=>[...moving,...reserved].filter(a=>a.groupId===id&&!a.returning).length>1).map(id=>`<div class="march-row"><span>Coordinated attack<small>${esc(id)}</small></span>${recallButton(id,'Recall group')}</div>`).join(''):'';
  const marches=moving.map(a=>`<div class="march-row ${a.returning?'returning':''}"><button class="march-focus" data-focus="${a.to}"><b>${a.amount}</b> ${a.returning?'↶':'→'} ${esc(place(a.to).name)}<small>${a.returning?'Returning · ':''}arrives ${time(a.arrivesAt)} · ${Math.max(0,a.arrivesAt-state.tick)}s</small></button>${!a.returning&&state.rules.distanceMovement?recallButton(a.id,'Recall'):''}</div>`).join('');
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
  return `<div class="coalition-forecast"><strong>${f.land}/${f.threshold} provinces after admission</strong><br>${f.wouldDraw?'Every starting player: negotiated draw, not a win.':f.wouldStartHold?`Already above the threshold. Activation would start a fresh ${state.rules.hold}s victory hold.`:`${f.remaining} more provinces needed to start the victory hold.`}<table><caption class="sr-only">Each member’s new prize share</caption><tbody>${f.members.map(p=>`<tr><td>${esc(country(p.country).name)}<br>${p.keepsMaturity?'Keeps earned tenure':'Maturity resets'}</td><td>${p.maximumShare.toFixed(1)} maximum points<br>${signed(p.fullMaturityPrestige)} Prestige at full maturity</td></tr>`).join('')}</tbody></table><small>${esc(f.assumption)}</small></div>`;
}
function renderBotSetup(){
  const seats=map.countries.filter(c=>!state.players.some(p=>p.id===c.id && p.kind!=='bot'));
  options('bot-seat',[{value:'',label:'All empty seats'},...seats.map(c=>({value:c.id,label:c.name+(state.players.some(p=>p.id===c.id)?' · configure bot':' · open')}))],$('bot-seat').value);
  const updating=state.players.some(p=>p.id===$('bot-seat').value && p.kind==='bot');
  $('fill-bots').disabled=!$('bot-seat').value && state.players.length===map.countries.length;
  $('fill-bots').textContent=updating?'Update commander':$('bot-seat').value?'Add commander':'Fill empty seats with bots';
  const skill=DIFFICULTIES[$('bot-difficulty').value],style=PERSONALITIES[$('bot-personality').value];
  $('bot-description').textContent=skill.description+' '+(style?.description || 'A mix of distinct, persistent play styles.');
  setHTML($('bot-roster'),state.players.filter(p=>p.kind==='bot').map(p=>`<span><b>${esc(country(p.id).name)}</b> ${esc(botLabel(p.bot))}</span>`).join(''));
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
  $('offer-count').textContent=state.proposals.filter(q=>q.status==='open' && q.roster.includes(state.you) && !q.accepted.includes(state.you)).length || '';
  const offerHTML=state.proposals.filter(q=>q.roster.includes(state.you) || q.status==='pending').map(q=>{
    const voters=q.roster.filter(id=>state.players.find(p=>p.id===id).eliminatedAt===null);
    const slice=100*state.players.length/q.roster.length;
    return `<div class="offer"><strong>${esc(q.name)}</strong><p>${q.roster.map(id=>esc(country(id).name)).join(' + ')}</p><p class="offer-terms">${q.roster.length===state.players.length?'All players joining means a draw, not a win.':`Maximum slice: ${slice.toFixed(1)} points each. New membership starts at 0% earned.`}</p>${forecastHTML(coalitionForecast(state,q.roster,q.coalition,q.activateAt ?? state.tick+state.rules.notice))}<small>${q.status==='pending'?`Active in ${q.activateAt-state.tick}s`:`${q.accepted.length}/${voters.length} approvals · expires in ${q.expiresAt-state.tick}s`}</small>${q.status==='open' && q.roster.includes(state.you)?`<div class="button-row">${!q.accepted.includes(state.you)?`<button class="primary" data-accept="${esc(q.id)}">Accept terms</button>`:''}<button data-decline="${esc(q.id)}">${q.creator===state.you?'Withdraw':'Decline'}</button></div>`:''}</div>`;
  }).join('')+state.departures.map(d=>`<p class="notice">${esc(country(d.country).name)} leaves in ${d.activateAt-state.tick}s.</p>`).join('');
  setHTML($('offers'),offerHTML);
}
function renderChat(){
  const box=$('messages'),atBottom=box.scrollHeight-box.scrollTop-box.clientHeight<40;
  const messages=history.filter(e=>e.type==='message');
  if(tab==='dispatches' && messages.length)readMessageId=Math.max(readMessageId,messages.at(-1).id);
  const signature=`${matchId}:${state.you}:`+messages.map(e=>e.id).join(',');
  if(box.dataset.signature!==signature){box.dataset.signature=signature;box.innerHTML=messages.length?messages.map(m=>`<article class="message"><header><b>${esc(country(m.from)?.name)}</b> · ${time(m.tick)} · ${m.channel==='dm'?`PRIVATE → ${esc(country(m.to)?.name)}`:esc(m.channel.toUpperCase())}</header><p>${esc(m.text)}</p></article>`).join(''):'<p class="muted small">The diplomatic wire is open. Make the first approach.</p>';if(atBottom)box.scrollTop=box.scrollHeight;}
  options('recipient',state.players.filter(p=>p.id!==state.you).map(p=>({value:p.id,label:country(p.id).name})),$('recipient').value);
  const recipient=state.players.find(p=>p.id===$('recipient').value);
  $('bot-chat-controls').hidden=$('channel').value!=='dm' || !recipient?.bot;
  $('bot-chat-hint').textContent=`${botLabel(recipient?.bot)}. Traditional bot: /help or /status. Allies may request /attack PROVINCE_ID or /defend PROVINCE_ID. One request per 45 game seconds. Use Council for alliances; free-form promises are not interpreted.`;
  const target=state.provinces.find(p=>p.id===destination),isAlly=recipient && recipient.side===myPlayer()?.side;
  const targetAlly=state.players.find(p=>p.id===target?.owner)?.side===myPlayer()?.side;
  const tactical=$('bot-tactical-draft');tactical.hidden=!isAlly || !target;
  tactical.textContent=target?`Request ${targetAlly?'defense':'attack'}: ${place(target.id).name}`:'';
  tactical.dataset.botDraft=target?`/${targetAlly?'defend':'attack'} ${target.id}`:'';
  const delay=Math.max(0,(state.commandBudget?.chatReadyAt || 0)-state.tick),button=$('chat-form').querySelector('button[type=submit]');
  button.disabled=!state.you || state.status!=='running' || delay>0;button.textContent=delay?`Send in ${delay} game seconds`:'Send dispatch';
  const unread=messages.filter(m=>m.id>readMessageId).length;
  $('unread').textContent=unread?String(unread):'';
}
function renderScoreboard(){
  for(const c of map.countries){
    const p=state.players.find(p=>p.id===c.id),land=state.provinces.filter(v=>v.owner===c.id),projection=state.projections.find(v=>v.country===c.id);
    const troops=land.reduce((n,v)=>n+v.troops,0)+state.armies.filter(a=>a.country===c.id).reduce((n,a)=>n+a.amount,0);
    const button=$('scoreboard').querySelector(`[data-country-focus="${c.id}"]`);
    button.classList.toggle('mine',c.id===state.you);
    button.title=`${c.name} · ${p?.name || 'Unclaimed'}${p?.bot?' · '+botLabel(p.bot):''} · ${p?namedSide(p.side):'Neutral'} · ${land.length} provinces · ${troops} troops${projection?` · ${signed(projection.projectedPrestige)} Prestige if victorious`:''}`;
    button.setAttribute('aria-label',`Inspect ${button.title}`);
    setHTML(button,`${insignia(c.id)}<span class="country-summary"><b>${esc(faction(c.id).short)}</b><span class="country-metrics">${icon('land')}${land.length} ${icon('troops')}${troops}</span><small>${p?esc(p.eliminatedAt!==null?'Eliminated':p.side.startsWith('solo:')?'Independent':namedSide(p.side)):'Unclaimed'}</small></span>`);
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
    case 'battle':return`${place(e.province).name}: ${e.owner!==e.previousOwner?`${c(e.owner)} captures it`:'defenders retain ownership'}; ${e.troops} troops remain.`;
    case 'alliance_notice':return`${e.name}: coalition change confirmed; activates at ${time(e.activateAt)}.`;
    case 'alliance_activated':return`${e.name} is active: ${e.roster.map(c).join(', ')}.`;
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
  $('result').hidden=false;document.body.classList.add('reviewing');
  if(!review || review.id!==state.id){review?.destroy();review=new AfterAction($('result'),state,map);}
}
function renderOperations(){
  const me=myPlayer(),team=state.sides.find(s=>s.id===me?.side),projection=state.projections.find(p=>p.country===state.you);
  const land=state.provinces.filter(p=>p.owner===state.you && state.you),leader=[...state.sides].sort((a,b)=>b.provinces-a.provinces)[0];
  const troops=land.reduce((n,p)=>n+p.troops,0)+state.armies.filter(a=>a.country===state.you).reduce((n,a)=>n+a.amount,0);
  setHTML($('operations'),`<div class="operation operation-faction">${insignia(state.you)}<div><span>${state.you?'YOUR COMMAND':'SPECTATOR'}</span><strong>${esc(faction(state.you).short)}</strong></div></div><div class="operation">${icon('land')}<div><span>HOLDINGS</span><strong>${state.you?land.length:state.provinces.filter(p=>p.owner).length}<small> / ${state.provinces.length}</small></strong></div></div><div class="operation">${icon('troops')}<div><span>FORCES</span><strong>${state.you?troops:state.provinces.reduce((n,p)=>n+p.troops,0)}</strong></div></div><div class="operation operation-wide"><div><span>${team?'YOUR ALLEGIANCE':'TERRITORIAL LEAD'}</span><strong>${esc(namedSide(team?.id || leader?.id) || 'No allegiance')}<small> · ${team?.provinces || leader?.provinces || 0}/${state.rules.threshold}</small></strong><div class="land-progress"><i style="width:${Math.min(100,100*(team?.provinces || leader?.provinces || 0)/state.rules.threshold)}%"></i></div></div></div><div class="operation">${icon('prestige')}<div><span>PRESTIGE ON WIN</span><strong>${projection?signed(projection.projectedPrestige):'—'}<small>${projection?` · ${Math.round(projection.maturity*100)}% earned`:''}</small></strong></div></div>`);
  const stopped=state.dominanceBreaks?.at(-1);
  $('countdown-break').hidden=!stopped || state.tick-stopped.tick>60 || state.status!=='running';
  if(stopped)$('countdown-break').textContent=`${time(stopped.tick)} · ${namedSide(stopped.side)}’s victory countdown stopped. ${stopped.reason} ${stopped.provinces}/${state.rules.threshold} provinces afterward.`;
  const hostile=state.armies.filter(a=>me && state.players.find(p=>p.id===a.country)?.side!==me.side && land.some(p=>p.id===a.to)).sort((a,b)=>a.arrivesAt-b.arrivesAt);
  $('threats').hidden=!hostile.length || state.status!=='running';
  if(hostile.length)setHTML($('threats'),`<span>↘ ${hostile.length} incoming ${hostile.length===1?'army':'armies'}</span>${hostile.slice(0,2).map(a=>`<button data-focus="${a.to}">${a.amount} → ${esc(place(a.to).name)} <b>${a.arrivesAt-state.tick}s</b></button>`).join('')}`);
}
function resetPresentation(){
  signalCursor=null;clearTimeout(signalTimer);clearTimeout(toastTimer);$('toast').hidden=true;$('battle-signal').hidden=true;
  toggleJournal(false);document.body.classList.remove('playing');
}
function toggleJournal(open){
  $('war-journal').hidden=!open;$('journal-toggle').setAttribute('aria-expanded',String(open));
}
function renderPresentation(){
  document.body.classList.toggle('playing',state.status==='running');
  const dominant=Object.entries(state.dominance)[0];
  document.querySelector('.campaign-bar').classList.toggle('victory-warning',Boolean(dominant) && state.status==='running');
  $('victory-status').setAttribute('role','timer');$('victory-status').setAttribute('aria-live','off');
  for(const button of $('faction-choices').querySelectorAll('button')){
    const id=button.dataset.countrySeat,occupied=state.players.some(p=>p.id===id);
    button.disabled=occupied;button.setAttribute('aria-pressed',String($('country-choice').value===id));
    button.title=occupied?'Seat occupied':startingSummary(country(id));
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
  const mode=state.rules.distanceMovement?orderMode:'march';
  $('command-footer').hidden=tab!=='orders' || state.status!=='running' || !state.you;
  $('send-army').hidden=mode!=='march';$('coordinate-commit').hidden=mode!=='coordinate';
  const p=state.provinces.find(p=>p.id===source);
  $('develop-province').hidden=mode!=='develop' || !p || p.development===state.rules.maxDevelopment;
  $('commit-context').textContent=source?`${place(source).name}${destination && mode!=='develop'?' → '+place(destination).name:''}`:'Select a province on the map';
}
function showTab(name){
  if(tab!==name)$(`${name}-tab`).scrollTop=0;
  tab=name;
  for(const current of ['orders','council','dispatches']){
    $(`${current}-tab`).hidden=current!==name;
    const button=document.querySelector(`[data-tab="${current}"]`);button.classList.toggle('active',current===name);
    button.setAttribute('aria-selected',String(current===name));button.tabIndex=current===name?0:-1;
  }
  if(state){renderChat();renderCommandFooter();}
}
function render(){
  if(!state)return;
  document.body.classList.toggle('spectating',state.status==='running' && !state.you);
  $('spectator-note').hidden=state.status!=='running' || Boolean(state.you);
  $('spectator-fullscreen').hidden=state.status!=='running' || Boolean(state.you);
  if(state.status!=='running')setMapFullscreen(false);
  renderPresentation();
  document.querySelector('.scenario-note').textContent=map.notice;
  $('game-name').textContent=state.name;$('room-label').textContent=`COUNCIL ${state.id.toUpperCase()} · ${state.eligible?'LEAGUE':'EXPERIMENTAL'} · ${state.players.length}/8 SEATS`;
  $('lobby').hidden=state.status!=='lobby';$('join-form').hidden=Boolean(state.you);
  options('country-choice',map.countries.filter(c=>!state.players.some(p=>p.id===c.id)).map(c=>({value:c.id,label:c.name})),$('country-choice').value);
  $('host-controls').hidden=!state.isHost;renderBotSetup();$('start-match').disabled=state.players.length<2 || !state.you;
  const selectedCountry=country($('country-choice').value);
  $('starting-holdings').textContent=state.you?'':startingSummary(selectedCountry);
  $('join-form').querySelector('button').disabled=!selectedCountry;
  $('lobby-note').textContent=state.you?`You command ${country(state.you).name}. ${state.isHost?'Invite players, attach agents, or add practice bots. You control when play begins.':'Waiting for the host to start.'}`:'You are observing. Choose an open country above to join.';
  $('phase').textContent=state.status==='lobby'?'ASSEMBLING':state.status==='finished'?'CONCLUDED':state.you?'IN SESSION':'SPECTATING';
  $('clock').textContent=`${time(state.tick)} / 30:00`;$('pace-badge').textContent=state.speed===1?'STANDARD · 1×':`QUICK · ${state.speed}×`;
  const dominant=Object.entries(state.dominance)[0];
  $('victory-status').textContent=dominant && state.status==='running'?`${namedSide(dominant[0])} wins in ${state.rules.hold-(state.tick-dominant[1])}s unless stopped`:`${state.rules.threshold} provinces · hold ${state.rules.hold} game seconds`;
  renderOrders();paintMap();renderCouncil();renderChat();renderScoreboard();renderResult();renderOperations();
  renderMessageBubbles();
  $('events').innerHTML=history.map(e=>({e,description:describe(e)})).filter(x=>x.description).slice(-30).reverse().map(({e,description})=>`<div class="event"><time>${time(e.tick)}</time>${esc(description)}</div>`).join('');
}
async function home(){resetPresentation();review?.destroy();review=null;setMapFullscreen(false);document.body.classList.remove('reviewing','spectating');generation++;pollController?.abort();document.body.classList.remove('in-game');matchId=null;state=null;spectating=false;messageBubbles=[];messageCatchupComplete=false;$('home').hidden=false;$('game').hidden=true;window.history.replaceState({},'','/');await rooms();}
$('create-form').addEventListener('submit',safely(async()=>{await ensureIdentity($('display-name').value);const g=await request('/api/games','POST',{name:$('room-name').value,preset:$('preset').value});await openRoom(g.id);}));
$('join-form').addEventListener('submit',safely(async()=>{await ensureIdentity($('join-name').value);await request(`/api/games/${matchId}/join`,'POST',{country:$('country-choice').value,kind:'human'});await poll();toast('Your seat is reserved.');}));
$('fill-bots').addEventListener('click',safely(async()=>{await request(`/api/games/${matchId}/bots`,'POST',{difficulty:$('bot-difficulty').value,personality:$('bot-personality').value,...($('bot-seat').value?{country:$('bot-seat').value}:{})});await poll();}));
$('bot-seat').addEventListener('change',()=>{
  const config=state.players.find(p=>p.id===$('bot-seat').value)?.bot;
  if(config){$('bot-difficulty').value=config.difficulty;$('bot-personality').value=config.personality;}
  renderBotSetup();
});
for(const id of ['bot-difficulty','bot-personality'])$(id).addEventListener('change',renderBotSetup);
$('recipient').addEventListener('change',()=>{if(state)renderChat();});
$('channel').addEventListener('change',()=>{if(state)renderChat();});
$('start-match').addEventListener('click',safely(async()=>{await request(`/api/games/${matchId}/start`,'POST',{});await poll();toast('The council is in session.');}));
$('move-form').addEventListener('submit',safely(async()=>{const r=await command({type:'move',from:source,to:destination,amount:Number($('amount').value)});if(!r)return;toast(`Army committed. Departure ${time(r.executeAt)}; arrival ${time(r.arrivesAt ?? r.executeAt+state.rules.travel)}.`);}));
$('source').addEventListener('change',()=>{source=$('source').value || null;destination=null;inspected=source;$('amount').value=Math.max(1,Math.floor(availableTroops()/2));renderOrders();paintMap();});
$('destination').addEventListener('change',()=>{destination=$('destination').value || null;renderOrders();paintMap();});
$('amount').addEventListener('input',()=>{if(state)renderOrders();});
$('amount-slider').addEventListener('input',()=>{$('amount').value=$('amount-slider').value;if(state)renderOrders();});
$('country-choice').addEventListener('change',()=>{const c=country($('country-choice').value);$('starting-holdings').textContent=startingSummary(c);if(state)renderPresentation();});
$('set-route').addEventListener('click',safely(async()=>{await command({type:'route',from:source,to:destination});toast('Recruitment arrow queued.');}));
$('clear-route').addEventListener('click',safely(async()=>{await command({type:'route',from:source,to:null});toast('Arrow removal queued.');}));
$('ally-choice').addEventListener('change',()=>{if(state)renderCouncil();});
$('alliance-form').addEventListener('submit',safely(async()=>{await command({type:'propose',country:$('ally-choice').value,name:$('coalition-name').value});toast('Offer delivered. Membership changes only after unanimous consent and notice.');}));
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
$('back').addEventListener('click',safely(home));$('refresh-rooms').addEventListener('click',safely(rooms));
$('share').addEventListener('click',safely(async()=>{try{await navigator.clipboard.writeText(location.href);toast('Room link copied. It contains no credentials.');}catch{prompt('Copy this room link. It contains no credentials:',location.href);}}));
$('account-button').addEventListener('click',safely(async()=>{const name=prompt('Create a separate local player identity. Existing results stay with the old identity. Enter a new display name:');if(name?.trim()){await ensureIdentity(name,true);if(matchId)await poll();}}));
$('zoom-in').onclick=()=>atlas.zoom(.7);$('zoom-out').onclick=()=>atlas.zoom(1.4);
$('world-view').onclick=()=>atlas.world();$('europe-view').onclick=()=>atlas.europe();$('home-view').onclick=focusCountry;
$('spectator-fullscreen').onclick=()=>setMapFullscreen(!document.body.classList.contains('spectator-map-fullscreen'));
document.querySelector('.tabs').addEventListener('keydown',event=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  event.preventDefault();const names=['orders','council','dispatches'],index=names.indexOf(tab);
  const next=event.key==='Home'?0:event.key==='End'?2:(index+(event.key==='ArrowRight'?1:2))%3;
  showTab(names[next]);document.querySelector(`[data-tab="${names[next]}"]`).focus();
});
document.addEventListener('keydown',event=>{
  if(!state || document.body.classList.contains('reviewing') || event.ctrlKey || event.metaKey || event.altKey || event.target.closest('input,select,textarea,dialog') || $('confirm-dialog').open)return;
  if(event.key==='Escape' && document.body.classList.contains('spectator-map-fullscreen')){setMapFullscreen(false);return;}
  if(event.key==='Escape' && !$('war-journal').hidden){toggleJournal(false);$('journal-toggle').focus();return;}
  if(event.key.toLowerCase()==='j'){toggleJournal($('war-journal').hidden);return;}
  if(event.key==='Escape'){source=null;destination=null;inspected=null;renderOrders();paintMap();}
  if(event.key.toLowerCase()==='c')focusCountry();
  if(event.key.toLowerCase()==='q')atlas.zoom(1.25);
  if(event.key.toLowerCase()==='e')atlas.zoom(.8);
});
document.addEventListener('click',safely(async event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.id==='journal-toggle')toggleJournal($('war-journal').hidden);
  if(button.id==='journal-close'){toggleJournal(false);$('journal-toggle').focus();}
  if(button.dataset.botDraft){$('chat-text').value=button.dataset.botDraft;$('chat-text').focus();}
  if(button.hasAttribute('data-dismiss-signal')){$('battle-signal').hidden=true;$('orders-label').focus();}
  if(button.dataset.countrySeat){$('country-choice').value=button.dataset.countrySeat;$('country-choice').dispatchEvent(new Event('change'));atlas.home(button.dataset.countrySeat);}
  if(button.dataset.countryFocus){const id=button.dataset.countryFocus;const focus=state.provinces.filter(p=>p.owner===id).sort((a,b)=>b.troops-a.troops)[0]?.id || country(id).start[0];atlas.focus(focus);inspected=focus;source=null;destination=null;orderMode='march';showTab('orders');renderOrders();paintMap();$('orders-tab').scrollTop=0;}
  if(button.dataset.reserveFrom){source=button.dataset.reserveFrom;destination=button.dataset.reserveTo;inspected=source;orderMode='march';$('amount').value=freeTroops(source);showTab('orders');renderOrders();paintMap();toast('Transfer drafted; review the garrison before committing.');}
  if(button.dataset.orderMode){orderMode=button.dataset.orderMode;renderOrders();$('orders-tab').scrollTop=0;}
  if(button.dataset.room)await openRoom(button.dataset.room,button.dataset.spectate==='true');
  if(button.dataset.home)await home();
  if(button.dataset.fraction){$('amount').value=Math.max(1,Math.floor(availableTroops()*Number(button.dataset.fraction)));renderOrders();}
  if(button.dataset.focus){atlas.focus(button.dataset.focus);inspected=button.dataset.focus;renderOrders();}
  if(button.dataset.decline){await command({type:'decline',proposalId:button.dataset.decline});toast('Offer declined.');}
  if(button.dataset.recall){const result=await command({type:'recall',id:button.dataset.recall});if(result)toast('Recall queued. Marching troops return from their actual position.');}
  if(button.dataset.accept){
    const offer=state.proposals.find(q=>q.id===button.dataset.accept);if(!offer)return;
    const f=coalitionForecast(state,offer.roster,offer.coalition),mine=f.members.find(p=>p.country===state.you);
    if(!await confirmAction({title:`Join ${offer.name}?`,message:`${f.land}/${f.threshold} provinces combined. ${f.wouldDraw?'This would end in a negotiated draw.':f.wouldStartHold?'This would start a fresh victory hold after activation.':`${f.remaining} more provinces needed for a victory hold.`} Your maximum slice becomes ${mine.maximumShare.toFixed(1)} points (${signed(mine.fullMaturityPrestige)} Prestige at full maturity). ${mine.keepsMaturity?'Your existing tenure remains.':'Your maturity restarts at zero.'} Territory may change before approval and the 30-second notice complete.`,accept:'Accept these terms'}))return;
    await command({type:'accept',proposalId:offer.id});toast('Terms accepted.');
  }
  if(button.dataset.tab)showTab(button.dataset.tab);
}));
for(const element of document.querySelectorAll('[data-icon]'))element.innerHTML=icon(element.dataset.icon);
try{map=await request('/map.json','GET',undefined,null);initMap();showIdentity();const params=new URL(location).searchParams,initial=params.get('match');if(initial)await openRoom(initial,params.get('spectate')==='1');else await rooms();$('connection').textContent=state?.status==='finished'?'Review':'Live';}catch(e){toast(e.message,true);}
setInterval(()=>{if(matchId)poll();},750);
