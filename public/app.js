const $ = id => document.getElementById(id);
import { Atlas } from './atlas.js';
import { escapeHTML as esc, syncOptions, setHTML, operationId, confirmAction } from './ui.js';
const time = n => `${Math.floor(Math.max(0,n)/60).toString().padStart(2,'0')}:${Math.floor(Math.max(0,n)%60).toString().padStart(2,'0')}`;
const signed = n => `${n>=0?'+':''}${n.toFixed(1)}`;
let identity;try{identity=JSON.parse(localStorage.getItem('coi.identity'));}catch{identity=null;}
let map, matchId=null, state=null, cursor=0, history=[], polling=false, tab='orders', source=null, destination=null, toastTimer;
let atlas, previewKey='', generation=0, pendingCommand=false, readMessageId=0, previewVersion=0;
let pollController=null, inspected=null;
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
  generation++;pollController?.abort();identity=profile;cursor=0;history=[];readMessageId=0;localStorage.setItem('coi.identity',JSON.stringify(identity));showIdentity();
}
function showIdentity(){ $('identity').textContent=identity?.name || 'Observer';$('display-name').value=identity?.name || '';$('join-name').value=identity?.name || ''; }
function options(id,values,current){syncOptions($(id),values,current);}
async function rooms(){
  const data=await request('/api/games');
  $('rooms').innerHTML=data.games.length?data.games.map(g=>`<div class="room-card"><div><p>${esc(g.name)}</p><small>${esc(g.status.toUpperCase())} · ${g.players.length}/8 SEATS · ${g.speed===1?'30 MIN':'5 MIN'} · ${esc(g.id)}</small></div><button data-room="${esc(g.id)}">${g.status==='lobby'?'Enter':'Watch'} →</button></div>`).join(''):'<p class="muted">The chamber is empty. Open the first council.</p>';
  const standings=await request('/api/standings');
  $('standings').innerHTML=standings.standings.length?standings.standings.map(p=>`<div class="standing-row"><span>${esc(p.name)} <small class="muted">${p.provisional?'PROVISIONAL':''} · ${p.matches} matches</small></span><b>${signed(p.prestige)}</b></div>`).join(''):'<p class="muted small">No decisive matches recorded yet. Results persist on this server.</p>';
}
async function openRoom(id){
  generation++;pollController?.abort();
  matchId=id;state=null;cursor=0;history=[];source=null;destination=null;inspected=null;previewKey='';readMessageId=0;
  document.body.classList.add('in-game');atlas.world();
  $('home').hidden=true;$('game').hidden=false;$('result').hidden=true;
  const url=new URL(location);url.searchParams.set('match',id);url.hash='';window.history.replaceState({},'',url);
  await poll();
}
async function poll(){
  if(!matchId)return;
  const epoch=generation,room=matchId;
  if(polling===epoch)return;
  polling=epoch;const controller=new AbortController();pollController=controller;
  try {
    for(let page=0;page<10;page++) {
      const response=await fetch(`/api/games/${room}?after=${cursor}`,{headers:identity?.token?{Authorization:`Bearer ${identity.token}`}:{},signal:controller.signal});
      const next=await response.json();
      if(epoch!==generation || room!==matchId)return;
      if(!response.ok)throw new Error(next.error || 'Unable to observe this room.');
      state=next;cursor=next.cursor;history.push(...next.events);
      if(!next.hasMore)break;
    }
    $('connection').textContent='Live';render();
  }catch(e){if(e.name!=='AbortError' && epoch===generation){$('connection').textContent='Reconnecting';toast(e.message,true);}}
  finally{if(polling===epoch)polling=false;}
}
async function command(action){
  if(!matchId || pendingCommand)return null;
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
  atlas=new Atlas($('map'),map,selectProvince);
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
  renderOrders();paintMap();
}
function availableTroops(){
  const p=state?.provinces.find(p=>p.id===source);
  const reserved=state?.commandBudget?.reserved.filter(o=>o.type==='move' && o.from===source).reduce((n,o)=>n+o.amount,0) || 0;
  return Math.max(0,(p?.troops || 0)-reserved-1);
}
function paintMap(){
  if(!state)return;atlas.update(state,source,destination);
  $('selection-label').textContent=source?`${place(source).name}${destination?' → '+place(destination).name:' · Choose a connected destination'}`:'Select a province to begin';
}
function renderOrders(){
  const owned=state.provinces.filter(p=>p.owner===state.you && state.you);
  if(source && !owned.some(p=>p.id===source)){source=null;destination=null;}
  options('source',[{value:'',label:owned.length?'Choose your province…':'No controlled provinces'},...owned.map(p=>({value:p.id,label:`${place(p.id).name} · ${p.troops} troops`}))],source || '');
  const neighbors=source?place(source).neighbors:[];
  if(destination && !neighbors.includes(destination))destination=null;
  options('destination',[{value:'',label:'Choose a connected destination…'},...neighbors.map(id=>{const p=state.provinces.find(p=>p.id===id);return{value:id,label:`${place(id).name} · ${p.troops} · ${country(p.owner)?.name || 'Neutral'}`};})],destination || '');
  $('commander-title').textContent=country(state.you)?.name || 'Observer';
  const active=state.status==='running' && myPlayer()?.eliminatedAt===null;
  const available=availableTroops(),amount=Number($('amount').value),valid=Number.isSafeInteger(amount) && amount>0 && amount<=available;
  const recovery=state.commandBudget?.nextRecoveryAt;
  $('budget').textContent=state.commandBudget?`${state.commandBudget.remaining}/3 commands available${recovery!==null && recovery!==undefined?` · next in ${Math.max(0,recovery-state.tick)}s`:''}`:'Join a country in the lobby to play.';
  const canCommand=active && source && !pendingCommand && state.commandBudget?.remaining>0;
  $('send-army').disabled=!canCommand || !destination || !valid;
  $('send-army').textContent=pendingCommand?'Sending order…':'Commit army →';
  $('amount').max=available;$('amount-slider').max=Math.max(1,available);$('amount-slider').value=Math.min(amount,Math.max(1,available));
  $('amount-slider').disabled=!source || available===0;
  for(const button of document.querySelectorAll('[data-fraction]'))button.disabled=!source || available===0;
  const p=state.provinces.find(p=>p.id===source),target=state.provinces.find(p=>p.id===destination);
  const friend=target?.owner && state.players.find(x=>x.id===target.owner)?.side===myPlayer()?.side;
  $('set-route').disabled=!canCommand || !friend || p?.route===destination;
  $('clear-route').disabled=!canCommand || !p?.route;
  $('route-status').textContent=p?.route?`New recruits → ${place(p.route).name}`:'No reinforcement route set.';
  const inspectedProvince=state.provinces.find(p=>p.id===(inspected || source));
  setHTML($('province-readout'),p?`<div><span>AVAILABLE</span><strong>${available}</strong></div><div><span>GARRISON</span><strong>${p.troops}</strong></div><div><span>RECRUIT IN</span><strong>${p.nextRecruit===null?'—':Math.max(0,p.nextRecruit-state.tick)+'s'}</strong></div>`:inspectedProvince?`<p><b>${esc(place(inspectedProvince.id).name)}</b><br>${esc(country(inspectedProvince.owner)?.name || 'Uncontrolled')} · ${inspectedProvince.troops} troops</p>`:'<p><b>Your next decision starts on the map.</b><br>Select a province you own, then a neighboring target. Nothing moves until you commit.</p>');
  const moving=state.armies.filter(a=>a.country===state.you).sort((a,b)=>a.arrivesAt-b.arrivesAt);
  const reserved=state.commandBudget?.reserved || [];
  setHTML($('march-list'),moving.length || reserved.length?`<h3>Committed orders <span>${moving.length+reserved.length}</span></h3>${reserved.map(o=>`<div class="march queued"><span>Queued · ${esc(place(o.from).name)}</span><b>next tick</b></div>`).join('')}${moving.slice(0,4).map(a=>`<button class="march" data-focus="${a.to}"><span><b>${a.amount}</b> → ${esc(place(a.to).name)}</span><time>${Math.max(0,a.arrivesAt-state.tick)}s</time></button>`).join('')}${moving.length>4?`<p class="small muted">${moving.length-4} more armies in transit. All are visible on the map.</p>`:''}`:'');
  updatePreview();
}
async function updatePreview(){
  if(!source || !destination || !state){previewKey='';previewVersion++;$('preview').textContent='Select a source and destination to see the current-garrison result.';return;}
  const amount=Number($('amount').value),key=[matchId,state.tick,source,destination,amount].join('|');
  if(key===previewKey)return;previewKey=key;const version=++previewVersion,epoch=generation;
  try{
    const result=await request(`/api/games/${matchId}/preview?from=${source}&to=${destination}&amount=${amount}`);
    if(key!==previewKey || version!==previewVersion || epoch!==generation)return;
    $('preview').innerHTML=`${esc(result.summary)}<small>${result.remaining} uncommitted troops stay home · 45s travel${result.reserved?` · ${result.reserved} already reserved`:''}. ${result.incoming.length} known incoming armies. Future orders and recruitment can change the result.</small>`;
  }catch(e){if(key===previewKey && version===previewVersion && epoch===generation)$('preview').textContent=e.message;}
}
function renderCouncil(){
  const me=myPlayer(),team=state.sides.find(s=>s.id===me?.side),projection=state.projections.find(p=>p.country===state.you);
  $('coalition-info').innerHTML=me?`<p><b>${esc(namedSide(me.side))}</b></p>${team.members.map(id=>{const p=state.projections.find(p=>p.country===id);return`<div class="coalition-member"><span>${esc(country(id).name)}</span><span>${Math.round(p.maturity*100)}% earned<br><small>${signed(p.projectedPrestige)} if victorious</small></span></div>`;}).join('')}<p class="small muted">Maximum slice: ${projection.maximumShare.toFixed(1)} points. Unearned points disappear; they are not redistributed.</p>`:'<p class="muted">Observers cannot negotiate formal membership.</p>';
  const independent=state.players.filter(p=>p.id!==state.you && p.eliminatedAt===null && p.side.startsWith('solo:'));
  options('ally-choice',independent.map(p=>({value:p.id,label:`${country(p.id).name} · ${p.name}`})),$('ally-choice').value);
  $('alliance-form').hidden=!me || me.eliminatedAt!==null || !independent.length;
  $('admission-cost').textContent=me?`New maximum slice: ${(100*state.players.length/(team.members.length+1)).toFixed(1)} points. ${me.side.startsWith('solo:')?'Founding a coalition resets both founders to 0% maturity.':'Your earned percentage stays; the newcomer starts at 0%.'}`:'';
  $('leave-alliance').hidden=!me || me.side.startsWith('solo:') || me.eliminatedAt!==null;
  $('offer-count').textContent=state.proposals.filter(q=>q.status==='open' && q.roster.includes(state.you) && !q.accepted.includes(state.you)).length || '';
  const offerHTML=state.proposals.filter(q=>q.roster.includes(state.you) || q.status==='pending').map(q=>{
    const voters=q.roster.filter(id=>state.players.find(p=>p.id===id).eliminatedAt===null);
    const slice=100*state.players.length/q.roster.length;
    return `<div class="offer"><strong>${esc(q.name)}</strong><p>${q.roster.map(id=>esc(country(id).name)).join(' + ')}</p><p class="offer-terms">${q.roster.length===state.players.length?'All players joining means a draw, not a win.':`Maximum slice: ${slice.toFixed(1)} points each. New membership starts at 0% earned.`}</p><small>${q.status==='pending'?`Active in ${q.activateAt-state.tick}s`:`${q.accepted.length}/${voters.length} approvals · expires in ${q.expiresAt-state.tick}s`}</small>${q.status==='open' && q.roster.includes(state.you)?`<div class="button-row">${!q.accepted.includes(state.you)?`<button class="primary" data-accept="${esc(q.id)}">Accept terms</button>`:''}<button data-decline="${esc(q.id)}">${q.creator===state.you?'Withdraw':'Decline'}</button></div>`:''}</div>`;
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
  const delay=Math.max(0,(state.commandBudget?.chatReadyAt || 0)-state.tick),button=$('chat-form').querySelector('button');
  button.disabled=!state.you || state.status!=='running' || delay>0;button.textContent=delay?`Send in ${delay} game seconds`:'Send dispatch';
  const unread=messages.filter(m=>m.id>readMessageId).length;
  $('unread').textContent=unread?String(unread):'';
}
function renderScoreboard(){
  $('scoreboard').innerHTML=map.countries.map(c=>{
    const p=state.players.find(p=>p.id===c.id),land=state.provinces.filter(v=>v.owner===c.id),s=state.projections.find(s=>s.country===c.id);
    const troops=land.reduce((n,v)=>n+v.troops,0)+state.armies.filter(a=>a.country===c.id).reduce((n,a)=>n+a.amount,0);
    return `<div class="country-card ${c.id===state.you?'mine':''}" style="--country:${c.color}"><div class="country">${esc(c.name)}</div><div class="player">${p?`${esc(p.name)} · ${p.kind==='bot'?'PRACTICE BOT':esc(p.kind.toUpperCase())}`:'UNCLAIMED'}</div><div class="metrics">${land.length}<small> LAND</small> &nbsp;${troops}<small> TROOPS</small></div><div class="team">${p?esc(p.eliminatedAt!==null?'ELIMINATED':p.side.startsWith('solo:')?'Independent':namedSide(p.side)):'—'}</div><div class="share">${s?`${Math.round(s.maturity*100)}% earned · ${signed(s.projectedPrestige)} on win`:'—'}</div></div>`;
  }).join('');
}
function describe(e){
  const c=id=>country(id)?.name || id;
  switch(e.type){
    case 'joined':return`${e.name} takes ${c(e.country)}.`;
    case 'started':return'The council is in session. Armies may move.';
    case 'army_departed':return`${c(e.country)} commits ${e.amount} troops: ${place(e.from).name} → ${place(e.to).name}.`;
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
  $('result').hidden=false;const o=state.outcome;
  $('result').innerHTML=`<div class="outcome-header"><div><p class="eyebrow">THE FINAL COUNCIL · ${time(o.tick)}</p><h2>${o.draw?'The council ends in a draw.':`${esc(namedSide(o.winningSide))} prevails.`}</h2><p class="muted small">${o.reason==='domination'?'Held 39 or more provinces for 90 seconds.':o.reason==='negotiated_draw'?'Every starting country joined the same coalition.':'The deadline has been reached.'} ${state.eligible?'League result recorded.':'Experimental result recorded; not a competitive rating.'}</p></div><button data-home="true">Open another council →</button></div><table><thead><tr><th>COUNTRY / PLAYER</th><th>EARNED</th><th>PAYOUT</th><th>PRESTIGE</th></tr></thead><tbody>${o.scores.map(s=>`<tr><td>${esc(country(s.country).name)} <span class="muted">/ ${esc(state.players.find(p=>p.id===s.country).name)}</span></td><td>${Math.round(s.maturity*100)}%</td><td>${s.payout.toFixed(1)}</td><td><b>${signed(s.prestige)}</b></td></tr>`).join('')}</tbody></table>`;
}
function renderOperations(){
  const me=myPlayer(),team=state.sides.find(s=>s.id===me?.side),projection=state.projections.find(p=>p.country===state.you);
  const land=state.provinces.filter(p=>p.owner===state.you && state.you),leader=[...state.sides].sort((a,b)=>b.provinces-a.provinces)[0];
  const troops=land.reduce((n,p)=>n+p.troops,0)+state.armies.filter(a=>a.country===state.you).reduce((n,a)=>n+a.amount,0);
  setHTML($('operations'),`<div class="operation"><span>${state.you?'YOUR HOLDINGS':'PROVINCES'}</span><strong>${state.you?land.length:state.provinces.filter(p=>p.owner).length}<small> / 64</small></strong></div><div class="operation"><span>${state.you?'YOUR FORCES':'LEADING SIDE'}</span><strong>${state.you?troops:leader?.provinces || 0}<small> ${state.you?'troops':'provinces'}</small></strong></div><div class="operation operation-wide"><span>${team?'YOUR ALLEGIANCE':'TERRITORIAL LEAD'}</span><strong>${esc(namedSide(team?.id || leader?.id) || 'No allegiance')}<small>${team?` · ${team.provinces}/39 provinces`:''}</small></strong><div class="land-progress"><i style="width:${Math.min(100,100*(team?.provinces || leader?.provinces || 0)/39)}%"></i></div></div><div class="operation"><span>${projection?'PRESTIGE IF VICTORIOUS':'MATCH FORMAT'}</span><strong>${projection?signed(projection.projectedPrestige):'Open diplomacy'}</strong><small>${projection?`${Math.round(projection.maturity*100)}% of your share earned`:'Humans & agents · same rules'}</small></div>`);
  const hostile=state.armies.filter(a=>me && state.players.find(p=>p.id===a.country)?.side!==me.side && land.some(p=>p.id===a.to)).sort((a,b)=>a.arrivesAt-b.arrivesAt);
  $('threats').hidden=!hostile.length || state.status!=='running';
  if(hostile.length)setHTML($('threats'),`<span>↘ ${hostile.length} incoming ${hostile.length===1?'army':'armies'}</span>${hostile.slice(0,2).map(a=>`<button data-focus="${a.to}">${a.amount} → ${esc(place(a.to).name)} <b>${a.arrivesAt-state.tick}s</b></button>`).join('')}`);
}
function showTab(name){
  if(tab!==name)$(`${name}-tab`).scrollTop=0;
  tab=name;
  for(const current of ['orders','council','dispatches']){
    $(`${current}-tab`).hidden=current!==name;
    const button=document.querySelector(`[data-tab="${current}"]`);button.classList.toggle('active',current===name);
    button.setAttribute('aria-selected',String(current===name));button.tabIndex=current===name?0:-1;
  }
  if(state)renderChat();
}
function render(){
  if(!state)return;
  $('game-name').textContent=state.name;$('room-label').textContent=`COUNCIL ${state.id.toUpperCase()} · ${state.eligible?'LEAGUE':'EXPERIMENTAL'} · ${state.players.length}/8 SEATS`;
  $('lobby').hidden=state.status!=='lobby';$('join-form').hidden=Boolean(state.you);
  options('country-choice',map.countries.filter(c=>!state.players.some(p=>p.id===c.id)).map(c=>({value:c.id,label:c.name})),$('country-choice').value);
  $('host-controls').hidden=!state.isHost;$('fill-bots').disabled=state.players.length===8;$('start-match').disabled=state.players.length<2 || !state.you;
  const selectedCountry=country($('country-choice').value);
  $('starting-holdings').textContent=state.you?'':selectedCountry?`Starting holdings: ${selectedCountry.start.map(id=>place(id).name).join(' · ')}`:'All countries are taken. You can still observe.';
  $('join-form').querySelector('button').disabled=!selectedCountry;
  $('lobby-note').textContent=state.you?`You command ${country(state.you).name}. ${state.isHost?'Invite players, attach agents, or add practice bots. You control when play begins.':'Waiting for the host to start.'}`:'You are observing. Choose an open country above to join.';
  $('phase').textContent=state.status==='lobby'?'ASSEMBLING':state.status==='finished'?'CONCLUDED':state.you?'IN SESSION':'SPECTATING';
  $('clock').textContent=`${time(state.tick)} / 30:00`;$('pace-badge').textContent=state.speed===1?'STANDARD · 1×':`QUICK · ${state.speed}×`;
  const dominant=Object.entries(state.dominance)[0];
  $('victory-status').textContent=dominant && state.status==='running'?`${namedSide(dominant[0])} wins in ${state.rules.hold-(state.tick-dominant[1])}s unless stopped`:'39 provinces · hold 90 game seconds';
  renderOrders();paintMap();renderCouncil();renderChat();renderScoreboard();renderResult();renderOperations();
  $('events').innerHTML=history.map(e=>({e,description:describe(e)})).filter(x=>x.description).slice(-30).reverse().map(({e,description})=>`<div class="event"><time>${time(e.tick)}</time>${esc(description)}</div>`).join('');
}
async function home(){generation++;pollController?.abort();document.body.classList.remove('in-game');matchId=null;state=null;$('home').hidden=false;$('game').hidden=true;window.history.replaceState({},'','/');await rooms();}
$('create-form').addEventListener('submit',safely(async()=>{await ensureIdentity($('display-name').value);const g=await request('/api/games','POST',{name:$('room-name').value,preset:$('preset').value});await openRoom(g.id);}));
$('join-form').addEventListener('submit',safely(async()=>{await ensureIdentity($('join-name').value);await request(`/api/games/${matchId}/join`,'POST',{country:$('country-choice').value,kind:'human'});await poll();toast('Your seat is reserved.');}));
$('fill-bots').addEventListener('click',safely(async()=>{await request(`/api/games/${matchId}/bots`,'POST',{});await poll();}));
$('start-match').addEventListener('click',safely(async()=>{await request(`/api/games/${matchId}/start`,'POST',{});await poll();toast('The council is in session.');}));
$('move-form').addEventListener('submit',safely(async()=>{const r=await command({type:'move',from:source,to:destination,amount:Number($('amount').value)});if(!r)return;toast(`Army committed. Executes at ${time(r.executeAt)}; arrival 45 game seconds later.`);}));
$('source').addEventListener('change',()=>{source=$('source').value || null;destination=null;inspected=source;$('amount').value=Math.max(1,Math.floor(availableTroops()/2));renderOrders();paintMap();});
$('destination').addEventListener('change',()=>{destination=$('destination').value || null;renderOrders();paintMap();});
$('amount').addEventListener('input',()=>{if(state)renderOrders();});
$('amount-slider').addEventListener('input',()=>{$('amount').value=$('amount-slider').value;if(state)renderOrders();});
$('country-choice').addEventListener('change',()=>{const c=country($('country-choice').value);$('starting-holdings').textContent=c?`Starting holdings: ${c.start.map(id=>place(id).name).join(' · ')}`:'';});
$('set-route').addEventListener('click',safely(async()=>{await command({type:'route',from:source,to:destination});toast('Recruitment arrow queued.');}));
$('clear-route').addEventListener('click',safely(async()=>{await command({type:'route',from:source,to:null});toast('Arrow removal queued.');}));
$('alliance-form').addEventListener('submit',safely(async()=>{await command({type:'propose',country:$('ally-choice').value,name:$('coalition-name').value});toast('Offer delivered. Membership changes only after unanimous consent and notice.');}));
$('leave-alliance').addEventListener('click',safely(async()=>{if(!await confirmAction({title:'Leave your coalition?',message:'Departure takes effect after 30 game seconds. Your earned share resets to zero in your new allegiance. Committed armies cannot be recalled.',accept:'Announce departure'}))return;await command({type:'leave'});toast('Departure announced. Your independent maturity clock restarts on departure.');}));
$('channel').addEventListener('change',()=>{$('recipient-label').hidden=$('channel').value!=='dm';});
$('chat-form').addEventListener('submit',safely(async()=>{await command({type:'chat',channel:$('channel').value,to:$('recipient').value,text:$('chat-text').value});$('chat-text').value='';}));
$('back').addEventListener('click',safely(home));$('refresh-rooms').addEventListener('click',safely(rooms));
$('share').addEventListener('click',safely(async()=>{try{await navigator.clipboard.writeText(location.href);toast('Room link copied. It contains no credentials.');}catch{prompt('Copy this room link. It contains no credentials:',location.href);}}));
$('account-button').addEventListener('click',safely(async()=>{const name=prompt('Create a separate local player identity. Existing results stay with the old identity. Enter a new display name:');if(name?.trim()){await ensureIdentity(name,true);if(matchId)await poll();}}));
$('zoom-in').onclick=()=>atlas.zoom(.7);$('zoom-out').onclick=()=>atlas.zoom(1.4);
$('world-view').onclick=()=>atlas.world();$('europe-view').onclick=()=>atlas.europe();$('home-view').onclick=focusCountry;
document.querySelector('.tabs').addEventListener('keydown',event=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  event.preventDefault();const names=['orders','council','dispatches'],index=names.indexOf(tab);
  const next=event.key==='Home'?0:event.key==='End'?2:(index+(event.key==='ArrowRight'?1:2))%3;
  showTab(names[next]);document.querySelector(`[data-tab="${names[next]}"]`).focus();
});
document.addEventListener('keydown',event=>{
  if(!state || event.ctrlKey || event.metaKey || event.altKey || event.target.closest('input,select,textarea,dialog') || $('confirm-dialog').open)return;
  if(event.key==='Escape'){source=null;destination=null;inspected=null;renderOrders();paintMap();}
  if(event.key.toLowerCase()==='c')focusCountry();
  if(event.key.toLowerCase()==='q')atlas.zoom(1.25);
  if(event.key.toLowerCase()==='e')atlas.zoom(.8);
});
document.addEventListener('click',safely(async event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.dataset.room)await openRoom(button.dataset.room);
  if(button.dataset.home)await home();
  if(button.dataset.fraction){$('amount').value=Math.max(1,Math.floor(availableTroops()*Number(button.dataset.fraction)));renderOrders();}
  if(button.dataset.focus){atlas.focus(button.dataset.focus);inspected=button.dataset.focus;renderOrders();}
  if(button.dataset.decline){await command({type:'decline',proposalId:button.dataset.decline});toast('Offer declined.');}
  if(button.dataset.accept){await command({type:'accept',proposalId:button.dataset.accept});toast('Terms accepted.');}
  if(button.dataset.tab)showTab(button.dataset.tab);
}));
try{map=await request('/map.json','GET',undefined,null);initMap();showIdentity();const initial=new URL(location).searchParams.get('match');if(initial)await openRoom(initial);else await rooms();$('connection').textContent='Live';}catch(e){toast(e.message,true);}
setInterval(()=>{if(matchId)poll();},750);
