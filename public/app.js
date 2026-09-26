const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time = n => `${Math.floor(Math.max(0,n)/60).toString().padStart(2,'0')}:${Math.floor(Math.max(0,n)%60).toString().padStart(2,'0')}`;
const signed = n => `${n>=0?'+':''}${n.toFixed(1)}`;
// randomUUID is secure-context-only; getRandomValues also supports a plain-HTTP LAN.
const operationId = () => crypto.randomUUID?.() ?? [...crypto.getRandomValues(new Uint8Array(16))].map(n=>n.toString(16).padStart(2,'0')).join('');
let identity;try{identity=JSON.parse(localStorage.getItem('coi.identity'));}catch{identity=null;}
let map, matchId=null, state=null, cursor=0, history=[], polling=false, tab='orders', source=null, destination=null, toastTimer;
let view={x:0,y:0,w:1280,h:680}, drag=null, dragged=false, previewKey='';
const country = id => map.countries.find(c=>c.id===id);
const place = id => map.provinces.find(p=>p.id===id);
const sideName = id => state?.sides.find(s=>s.id===id)?.name || id;
const namedSide = id => country(sideName(id))?.name || sideName(id);
const myPlayer = () => state?.players.find(p=>p.id===state.you);
function toast(message,error=false){$('toast').textContent=message;$('toast').className=error?'error':'';$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,6500);}
async function request(path,method='GET',data,token=identity?.token){
  const response=await fetch(path,{method,headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});
  const value=await response.json();if(!response.ok)throw new Error(value.error || `Request failed (${response.status}).`);return value;
}
async function ensureIdentity(name){
  name=name.trim();if(identity?.name===name)return;
  identity=await request('/api/players','POST',{name},null);cursor=0;history=[];localStorage.setItem('coi.identity',JSON.stringify(identity));showIdentity();
}
function showIdentity(){ $('identity').textContent=identity?.name || 'Observer';$('display-name').value=identity?.name || '';$('join-name').value=identity?.name || ''; }
function options(id,values,current){
  const select=$(id);if(document.activeElement===select)return;
  select.innerHTML=values.map(v=>`<option value="${esc(v.value)}">${esc(v.label)}</option>`).join('');
  if(values.some(v=>v.value===current))select.value=current;
}
async function rooms(){
  const data=await request('/api/games');
  $('rooms').innerHTML=data.games.length?data.games.map(g=>`<div class="room-card"><div><p>${esc(g.name)}</p><small>${esc(g.status.toUpperCase())} · ${g.players.length}/8 SEATS · ${g.speed===1?'30 MIN':'5 MIN'} · ${esc(g.id)}</small></div><button data-room="${esc(g.id)}">${g.status==='lobby'?'Enter':'Watch'} →</button></div>`).join(''):'<p class="muted">The chamber is empty. Open the first council.</p>';
  const standings=await request('/api/standings');
  $('standings').innerHTML=standings.standings.length?standings.standings.map(p=>`<div class="standing-row"><span>${esc(p.name)} <small class="muted">${p.provisional?'PROVISIONAL':''} · ${p.matches} matches</small></span><b>${signed(p.prestige)}</b></div>`).join(''):'<p class="muted small">No decisive matches recorded yet. Results persist on this server.</p>';
}
async function openRoom(id){
  matchId=id;state=null;cursor=0;history=[];source=null;destination=null;previewKey='';
  $('home').hidden=true;$('game').hidden=false;$('result').hidden=true;
  const url=new URL(location);url.searchParams.set('match',id);window.history.replaceState({},'',url);
  await poll();
}
async function poll(){
  if(!matchId || polling)return;polling=true;const room=matchId;
  try{
    for(let page=0;page<10;page++){
      const next=await request(`/api/games/${room}?after=${cursor}`);
      if(room!==matchId)return;
      state=next;cursor=next.cursor;history.push(...next.events);history=history.slice(-1500);
      if(!next.hasMore)break;
    }
    $('connection').textContent='Connected';render();
  }catch(e){$('connection').textContent='Reconnecting';toast(e.message,true);}finally{polling=false;}
}
async function command(action){
  if(!matchId)return;
  const result=await request(`/api/games/${matchId}/actions`,'POST',{opId:operationId(),action});
  await poll();return result;
}
const safely=fn=>async event=>{if(event?.type==='submit')event.preventDefault();try{await fn(event);}catch(e){toast(e.message,true);}};
function svgNode(tag,attrs={}){const node=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const[k,v]of Object.entries(attrs))node.setAttribute(k,v);return node;}
function connectionPath(a,b){
  if(Math.abs(a.x-b.x)>640){const left=a.x<b.x?a:b,right=a.x<b.x?b:a;return `M${left.x},${left.y}L${right.x-1280},${right.y}M${right.x},${right.y}L${left.x+1280},${left.y}`;}
  return `M${a.x},${a.y}L${b.x},${b.y}`;
}
function initMap(){
  const svg=$('map');svg.replaceChildren();
  const grid=svgNode('g',{stroke:'#ffffff06','stroke-width':1});
  for(let x=0;x<1280;x+=100)grid.append(svgNode('path',{d:`M${x},0V680`}));
  for(let y=0;y<680;y+=80)grid.append(svgNode('path',{d:`M0,${y}H1280`}));svg.append(grid);
  const seas=svgNode('g');for(const e of map.edges.filter(e=>e.sea))seas.append(svgNode('path',{d:connectionPath(place(e.from),place(e.to)),class:'sea-route'}));svg.append(seas);
  const provinces=svgNode('g');for(const p of map.provinces){
    const path=svgNode('path',{d:p.path,class:'province',id:`province-${p.id}`,'data-province':p.id,fill:'#a29e8a'});
    const title=svgNode('title');title.textContent=p.name;path.append(title);provinces.append(path);
  }svg.append(provinces,svgNode('g',{id:'routes-layer'}),svgNode('g',{id:'armies-layer'}));
  const labels=svgNode('g');for(const p of map.provinces){
    const group=svgNode('g',{class:'marker',id:`marker-${p.id}`,'data-province':p.id,tabindex:0,role:'button','aria-label':p.name});
    group.append(svgNode('circle',{cx:p.x,cy:p.y,r:7.5,class:'troop-disc'}));
    const label=svgNode('text',{x:p.x,y:p.y,class:'troop-label',id:`troops-${p.id}`});label.textContent='2';group.append(label);labels.append(group);
  }svg.append(labels);applyView();
}
function applyView(){ $('map').setAttribute('viewBox',`${view.x} ${view.y} ${view.w} ${view.h}`); }
function zoom(factor){const w=Math.min(1600,Math.max(150,view.w*factor)),h=w*680/1280;view={x:view.x+(view.w-w)/2,y:view.y+(view.h-h)/2,w,h};applyView();}
function focusCountry(){
  const c=country(state?.you);if(!c)return;
  const points=c.start.map(place),xs=points.map(p=>p.x),ys=points.map(p=>p.y);
  const w=Math.max(230,(Math.max(...xs)-Math.min(...xs)+100)),h=w*680/1280;
  view={x:(Math.max(...xs)+Math.min(...xs)-w)/2,y:(Math.max(...ys)+Math.min(...ys)-h)/2,w,h};applyView();
}
function selectProvince(id){
  const p=state.provinces.find(p=>p.id===id);
  if(source && source!==id && place(source).neighbors.includes(id)){destination=id;}
  else if(p.owner===state.you && state.you){source=id;destination=place(id).neighbors[0];$('amount').value=Math.max(1,Math.floor((p.troops-1)/2));}
  else{toast(`${place(id).name}: ${p.troops} troops · ${country(p.owner)?.name || 'Uncontrolled'}. Select one of your provinces to issue an order.`);}
  renderOrders();paintMap();
}
function paintMap(){
  if(!state)return;
  const adjacent=source?place(source).neighbors:[];
  for(const p of state.provinces){
    const path=$(`province-${p.id}`);path.setAttribute('fill',country(p.owner)?.color || '#a5a18d');
    path.setAttribute('class',`province${p.id===source?' selected':''}${p.id===destination?' destination':''}${adjacent.includes(p.id)?' neighbor':''}`);
    $(`troops-${p.id}`).textContent=p.troops;
    $(`marker-${p.id}`).setAttribute('aria-label',`${place(p.id).name}, ${p.troops} troops, ${country(p.owner)?.name || 'uncontrolled'}`);
  }
  $('routes-layer').replaceChildren();
  for(const p of state.provinces.filter(p=>p.route))$('routes-layer').append(svgNode('path',{d:connectionPath(place(p.id),place(p.route)),class:'route-arrow'}));
  $('armies-layer').replaceChildren();
  for(const army of state.armies){
    const a=place(army.from),b=place(army.to),color=country(army.country).color;
    $('armies-layer').append(svgNode('path',{d:connectionPath(a,b),stroke:color,class:'army-path'}));
    let dx=b.x-a.x;if(dx>640)dx-=1280;if(dx< -640)dx+=1280;
    const progress=Math.max(0,Math.min(1,(state.tick-army.departedAt)/(army.arrivesAt-army.departedAt)));
    const dot=svgNode('circle',{cx:(a.x+dx*progress+1280)%1280,cy:a.y+(b.y-a.y)*progress,r:3.4,fill:color,stroke:'#fff1cc','stroke-width':.8});
    const title=svgNode('title');title.textContent=`${army.amount} ${army.country} troops → ${place(army.to).name}; ${army.arrivesAt-state.tick}s`;dot.append(title);$('armies-layer').append(dot);
  }
  $('selection-label').textContent=source?`${place(source).name.toUpperCase()}${destination?' → '+place(destination).name.toUpperCase():''}`:'THE WORLD, REIMAGINED';
}
function renderOrders(){
  const owned=state.provinces.filter(p=>p.owner===state.you && state.you);
  if(!owned.some(p=>p.id===source)){source=owned[0]?.id || null;destination=source?place(source).neighbors[0]:null;}
  options('source',owned.map(p=>({value:p.id,label:`${place(p.id).name} · ${p.troops} troops`})),source);
  const neighbors=source?place(source).neighbors:[];
  if(!neighbors.includes(destination))destination=neighbors[0] || null;
  options('destination',neighbors.map(id=>{const p=state.provinces.find(p=>p.id===id);return{value:id,label:`${place(id).name} · ${p.troops} · ${country(p.owner)?.name || 'Uncontrolled'}`};}),destination);
  $('commander-title').textContent=country(state.you)?.name || 'Observe the world';
  const active=state.status==='running' && myPlayer()?.eliminatedAt===null;
  $('budget').textContent=state.commandBudget?`${state.commandBudget.remaining}/3 military commands available · every 10 game seconds`:'Take a seat to issue orders.';
  $('send-army').disabled=!active || !source || !state.commandBudget?.remaining;
  $('set-route').disabled=!active || !source;$('clear-route').disabled=!active || !source;
  const p=state.provinces.find(p=>p.id===source);
  $('route-status').textContent=p?.route?`New recruits → ${place(p.route).name}`:'No recruitment arrow set.';
  updatePreview();
}
async function updatePreview(){
  if(!source || !destination || !state){$('preview').textContent='Select a source and destination.';return;}
  const amount=Number($('amount').value),key=[matchId,state.tick,source,destination,amount].join('|');
  if(key===previewKey)return;previewKey=key;
  try{
    const result=await request(`/api/games/${matchId}/preview?from=${source}&to=${destination}&amount=${amount}`);
    if(key!==previewKey)return;
    $('preview').innerHTML=`${esc(result.summary)}<small>Leave ${result.remaining} at home. Arrival in 45 game seconds. ${result.incoming.length} known incoming armies. Recruitment, new orders, and allegiance changes can change this result.</small>`;
  }catch(e){if(key===previewKey)$('preview').textContent=e.message;}
}
function renderCouncil(){
  const me=myPlayer(),team=state.sides.find(s=>s.id===me?.side),projection=state.projections.find(p=>p.country===state.you);
  $('coalition-info').innerHTML=me?`<p><b>${esc(namedSide(me.side))}</b></p>${team.members.map(id=>{const p=state.projections.find(p=>p.country===id);return`<div class="coalition-member"><span>${esc(country(id).name)}</span><span>${Math.round(p.maturity*100)}% earned<br><small>${signed(p.projectedPrestige)} if victorious</small></span></div>`;}).join('')}<p class="small muted">Maximum slice: ${projection.maximumShare.toFixed(1)} points. Unearned points disappear; they are not redistributed.</p>`:'<p class="muted">Observers cannot negotiate formal membership.</p>';
  const independent=state.players.filter(p=>p.id!==state.you && p.eliminatedAt===null && p.side.startsWith('solo:'));
  options('ally-choice',independent.map(p=>({value:p.id,label:`${country(p.id).name} · ${p.name}`})),$('ally-choice').value);
  $('alliance-form').hidden=!me || me.eliminatedAt!==null || !independent.length;
  $('admission-cost').textContent=me?`New maximum slice: ${(100*state.players.length/(team.members.length+1)).toFixed(1)} points. ${me.side.startsWith('solo:')?'Founding a coalition resets both founders to 0% maturity.':'Your earned percentage stays; the newcomer starts at 0%.'}`:'';
  $('leave-alliance').hidden=!me || me.side.startsWith('solo:') || me.eliminatedAt!==null;
  $('offers').innerHTML=state.proposals.filter(q=>q.roster.includes(state.you) || q.status==='pending').map(q=>`<div class="offer"><strong>${esc(q.name)}</strong>${q.roster.map(id=>esc(country(id).name)).join(' + ')}<br>${q.status==='pending'?`Activates in ${q.activateAt-state.tick} game seconds`:`${q.accepted.length}/${q.roster.filter(id=>state.players.find(p=>p.id===id).eliminatedAt===null).length} approvals · expires in ${q.expiresAt-state.tick}s`}${q.status==='open' && !q.accepted.includes(state.you)?`<button data-accept="${esc(q.id)}">Accept these terms</button>`:''}</div>`).join('')+state.departures.map(d=>`<p class="small">${esc(country(d.country).name)} leaves in ${d.activateAt-state.tick}s.</p>`).join('');
}
function renderChat(){
  const box=$('messages'),atBottom=box.scrollHeight-box.scrollTop-box.clientHeight<40;
  const messages=history.filter(e=>e.type==='message');
  const signature=`${matchId}:${state.you}:`+messages.map(e=>e.id).join(',');
  if(box.dataset.signature!==signature){box.dataset.signature=signature;box.innerHTML=messages.length?messages.map(m=>`<article class="message"><header><b>${esc(country(m.from)?.name)}</b> · ${time(m.tick)} · ${m.channel==='dm'?`PRIVATE → ${esc(country(m.to)?.name)}`:esc(m.channel.toUpperCase())}</header><p>${esc(m.text)}</p></article>`).join(''):'<p class="muted small">The diplomatic wire is open. Make the first approach.</p>';if(atBottom)box.scrollTop=box.scrollHeight;}
  options('recipient',state.players.filter(p=>p.id!==state.you).map(p=>({value:p.id,label:country(p.id).name})),$('recipient').value);
  const delay=Math.max(0,(state.commandBudget?.chatReadyAt || 0)-state.tick),button=$('chat-form').querySelector('button');
  button.disabled=!state.you || state.status!=='running' || delay>0;button.textContent=delay?`Send in ${delay} game seconds`:'Send dispatch';
  $('unread').textContent=tab!=='dispatches' && messages.length?`· ${messages.length}`:'';
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
function render(){
  if(!state)return;
  $('game-name').textContent=state.name;$('room-label').textContent=`COUNCIL ${state.id.toUpperCase()} · ${state.eligible?'LEAGUE':'EXPERIMENTAL'} · ${state.players.length}/8 SEATS`;
  $('lobby').hidden=state.status!=='lobby';$('join-form').hidden=Boolean(state.you);
  options('country-choice',map.countries.filter(c=>!state.players.some(p=>p.id===c.id)).map(c=>({value:c.id,label:c.name})),$('country-choice').value);
  $('host-controls').hidden=!state.isHost;$('fill-bots').disabled=state.players.length===8;$('start-match').disabled=state.players.length<2 || !state.you;
  $('lobby-note').textContent=state.you?`You command ${country(state.you).name}. ${state.isHost?'Invite players, attach agents, or add practice bots. You control when play begins.':'Waiting for the host to start.'}`:'You are observing. Choose an open country above to join.';
  $('phase').textContent=state.status==='lobby'?'ASSEMBLING':state.status==='finished'?'CONCLUDED':state.you?'IN SESSION':'SPECTATING';
  $('clock').textContent=`${time(state.tick)} / 30:00`;$('pace-badge').textContent=state.speed===1?'STANDARD · 1×':`QUICK · ${state.speed}×`;
  const dominant=Object.entries(state.dominance)[0];
  $('victory-status').textContent=dominant && state.status==='running'?`${namedSide(dominant[0])} wins in ${state.rules.hold-(state.tick-dominant[1])}s unless stopped`:'39 provinces · hold 90 game seconds';
  renderOrders();paintMap();renderCouncil();renderChat();renderScoreboard();renderResult();
  $('events').innerHTML=history.map(e=>({e,description:describe(e)})).filter(x=>x.description).slice(-30).reverse().map(({e,description})=>`<div class="event"><time>${time(e.tick)}</time>${esc(description)}</div>`).join('');
}
async function home(){matchId=null;state=null;$('home').hidden=false;$('game').hidden=true;window.history.replaceState({},'','/');await rooms();}
$('create-form').addEventListener('submit',safely(async()=>{await ensureIdentity($('display-name').value);const g=await request('/api/games','POST',{name:$('room-name').value,preset:$('preset').value});await openRoom(g.id);}));
$('join-form').addEventListener('submit',safely(async()=>{await ensureIdentity($('join-name').value);await request(`/api/games/${matchId}/join`,'POST',{country:$('country-choice').value,kind:'human'});await poll();toast('Your seat is reserved.');}));
$('fill-bots').addEventListener('click',safely(async()=>{await request(`/api/games/${matchId}/bots`,'POST',{});await poll();}));
$('start-match').addEventListener('click',safely(async()=>{await request(`/api/games/${matchId}/start`,'POST',{});await poll();toast('The council is in session.');}));
$('move-form').addEventListener('submit',safely(async()=>{const r=await command({type:'move',from:source,to:destination,amount:Number($('amount').value)});toast(`Army committed. Executes at ${time(r.executeAt)}; arrival 45 game seconds later.`);}));
$('source').addEventListener('change',()=>{source=$('source').value;destination=place(source).neighbors[0];renderOrders();paintMap();});
$('destination').addEventListener('change',()=>{destination=$('destination').value;paintMap();updatePreview();});
$('amount').addEventListener('input',updatePreview);
$('set-route').addEventListener('click',safely(async()=>{await command({type:'route',from:source,to:destination});toast('Recruitment arrow queued.');}));
$('clear-route').addEventListener('click',safely(async()=>{await command({type:'route',from:source,to:null});toast('Arrow removal queued.');}));
$('alliance-form').addEventListener('submit',safely(async()=>{await command({type:'propose',country:$('ally-choice').value,name:$('coalition-name').value});toast('Offer delivered. Membership changes only after unanimous consent and notice.');}));
$('leave-alliance').addEventListener('click',safely(async()=>{await command({type:'leave'});toast('Departure announced. Your independent maturity clock restarts on departure.');}));
$('channel').addEventListener('change',()=>{$('recipient-label').hidden=$('channel').value!=='dm';});
$('chat-form').addEventListener('submit',safely(async()=>{await command({type:'chat',channel:$('channel').value,to:$('recipient').value,text:$('chat-text').value});$('chat-text').value='';}));
$('back').addEventListener('click',safely(home));$('refresh-rooms').addEventListener('click',safely(rooms));
$('share').addEventListener('click',safely(async()=>{try{await navigator.clipboard.writeText(location.href);toast('Room link copied. It contains no credentials.');}catch{prompt('Copy this room link. It contains no credentials:',location.href);}}));
$('account-button').addEventListener('click',safely(async()=>{const name=prompt('Create a separate local player identity. Existing results stay with the old identity. Enter a new display name:');if(name?.trim()){await ensureIdentity(name);if(matchId)await poll();}}));
$('zoom-in').onclick=()=>zoom(.7);$('zoom-out').onclick=()=>zoom(1.4);$('world-view').onclick=()=>{view={x:0,y:0,w:1280,h:680};applyView();};
$('europe-view').onclick=()=>{view={x:575,y:63,w:240,h:127.5};applyView();};$('home-view').onclick=focusCountry;
$('map').addEventListener('wheel',event=>{event.preventDefault();zoom(event.deltaY>0?1.15:.87);},{passive:false});
$('map').addEventListener('pointerdown',event=>{drag={x:event.clientX,y:event.clientY,vx:view.x,vy:view.y};dragged=false;});
window.addEventListener('pointermove',event=>{if(!drag)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>5)dragged=true;if(dragged){const rect=$('map').getBoundingClientRect(),scale=Math.max(view.w/rect.width,view.h/rect.height);view.x=drag.vx-dx*scale;view.y=drag.vy-dy*scale;applyView();}});
window.addEventListener('pointerup',()=>{drag=null;});
$('map').addEventListener('click',event=>{if(dragged){dragged=false;return;}const id=event.target.closest('[data-province]')?.dataset.province;if(id && state)selectProvince(id);});
$('map').addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();const id=event.target.closest('[data-province]')?.dataset.province;if(id && state)selectProvince(id);}});
document.addEventListener('click',safely(async event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.dataset.room)await openRoom(button.dataset.room);
  if(button.dataset.home)await home();
  if(button.dataset.accept){await command({type:'accept',proposalId:button.dataset.accept});toast('Terms accepted.');}
  if(button.dataset.tab){tab=button.dataset.tab;for(const name of ['orders','council','dispatches']){$(`${name}-tab`).hidden=name!==tab;document.querySelector(`[data-tab="${name}"]`).classList.toggle('active',name===tab);}if(state)renderChat();}
}));
try{map=await request('/map.json','GET',undefined,null);initMap();showIdentity();const initial=new URL(location).searchParams.get('match');if(initial)await openRoom(initial);else await rooms();$('connection').textContent='Connected';}catch(e){toast(e.message,true);}
setInterval(()=>{if(matchId)poll();},750);
