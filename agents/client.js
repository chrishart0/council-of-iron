import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export class CouncilClient {
  constructor({ url = process.env.COUNCIL_URL || 'http://127.0.0.1:3107', token = process.env.COUNCIL_TOKEN || '',
    match = process.env.COUNCIL_MATCH || '', sessionPath = process.env.COUNCIL_SESSION || '.council.session.json' } = {}) {
    this.url=url.replace(/\/$/,'');this.sessionPath=resolve(sessionPath);this.session={};
    try { this.session=JSON.parse(readFileSync(this.sessionPath,'utf8')); }
    catch(e) { if(e.code!=='ENOENT')throw new Error(`Cannot read session file: ${e.message}`); }
    // Never send credentials from another server's session to this URL.
    if(this.session.url && this.session.url!==this.url)this.session={};
    this.explicitToken=token;this.match=match || this.session.match || '';
  }
  persist() {
    mkdirSync(dirname(this.sessionPath),{recursive:true,mode:0o700});
    const temporary=`${this.sessionPath}.${process.pid}.tmp`;
    writeFileSync(temporary,JSON.stringify({...this.session,url:this.url,match:this.match},null,2),{mode:0o600});
    renameSync(temporary,this.sessionPath);
  }
  get token() { return this.explicitToken || (this.session.match===this.match ? this.session.seatToken : '') || this.session.profileToken || ''; }
  async request(path,method='GET',data,token=this.token) {
    const options={method,headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined};
    const response=await fetch(`${this.url}${path}`,{...options,signal:AbortSignal.timeout(15000)});
    const result=await response.json();
    if(!response.ok){
      const {error:message,...details}=result,error=new Error(message || `HTTP ${response.status}`);error.status=response.status;
      if(Object.keys(details).length)error.details=details; // e.g. truceUntil, retryAt, free/cost
      throw error;
    }
    return result;
  }
  async register(name) {
    if(this.explicitToken)throw new Error('Unset COUNCIL_TOKEN before creating a new identity.');
    const profile=await this.request('/api/players','POST',{name},'');
    this.session={url:this.url,name,profileToken:profile.token};this.match='';this.persist();
    return {name:profile.name,sessionFile:this.sessionPath};
  }
  async create(name,preset='standard') {
    const result=await this.request('/api/games','POST',{name,preset},this.explicitToken || this.session.profileToken);
    this.match=result.id;this.session.match=result.id;
    delete this.session.seatToken;delete this.session.country;
    this.persist();return result;
  }
  async join(match,country,name='Agent',model='',persona='',visibility='private') {
    if(!this.session.profileToken && !this.explicitToken)await this.register(name);
    const result=await this.request(`/api/games/${match}/join`,'POST',{country,kind:'agent',model,persona,visibility},this.explicitToken || this.session.profileToken);
    this.match=match;this.session.match=match;this.session.country=country;this.session.seatToken=result.token;this.persist();
    // Room notices (e.g. alliance chat published in the post-match replay); never contain credentials.
    return {match,country,sessionFile:this.sessionPath,notices:result.notices || []};
  }
  gamePath(suffix='') {if(!this.match)throw new Error('Join a match or set COUNCIL_MATCH first.');return `/api/games/${this.match}${suffix}`;}
  /** `inbox: true` adds the seat's inbox (unread messages, pending decisions) without marking anything read. */
  observe(after=0,{inbox=false}={}) { return this.request(this.gamePath(`?after=${after}${inbox?'&inbox=1':''}`)); }
  /** Read your inbox and mark it read (oldest first, 20 per call; `more` means call again). */
  readInbox() { return this.request(this.gamePath('/inbox'),'POST',{}); }
  /** Mark messages read through event `through`, as seen by a reader that started after event `after`. */
  markRead(through,after) { return this.request(this.gamePath('/inbox'),'POST',{through,...(after!==undefined?{after}:{})}); }
  /** Public World feed (world chat + engine headlines), oldest first. Reply with chat on channel world. */
  feed(after=0,limit=100) { return this.request(this.gamePath(`/feed?${new URLSearchParams({after,limit})}`)); }
  review() {return this.request(this.gamePath('/review'));}
  replay(tick) {return this.request(this.gamePath(`/replay?tick=${encodeURIComponent(tick)}`));}
  /** Any action object is sent as-is; a march accepts optional declareWar:true (atomic declare-and-march).
   * A short anti-spam pause (a 429 whose retryAt is at most 3 ticks away) is waited out and the same operation
   * resent, so a second message or order in quick succession is delivered instead of refused. */
  async action(action,opId=randomUUID()) {
    for(let attempt=0;;attempt++){
      try { return await this.request(this.gamePath('/actions'),'POST',{action,opId}); }
      catch(error) {
        const {retryAt,tick}=error.details || {},ticks=error.status===429 && Number.isFinite(retryAt) && Number.isFinite(tick) ? retryAt-tick : 0;
        if(attempt>=2 || !(ticks>0 && ticks<=3))throw error;
        await new Promise(resolveWait=>setTimeout(resolveWait,ticks*1000));
      }
    }
  }
  /** Read-only forecast of a march ({to, from, amount|percent} or {to, sources}) or a rally ({type:'rally', from, to}). */
  plan(action) {return this.request(this.gamePath('/plan'),'POST',action);}
  /** Turn one of your armies or march groups around: a returning army marches again, anything else is recalled. */
  async turnAround(id,opId) {
    const o=await this.observe(Number.MAX_SAFE_INTEGER),army=o.armies.find(a=>a.id===id && a.country===o.you);
    return this.action(army?.returning?{type:'turn_around',armyId:id}:{type:'recall',id},opId);
  }
  list() {return this.request('/api/games','GET',undefined,'');}
  map() {return this.request(this.match ? this.gamePath('/map') : '/map.json','GET',undefined,'');}
  /** The map without its decorative SVG paths: IDs, adjacency, coordinates, connections, countries and the impassable
   * terrain (mountains and deserts drawn as unowned land; not provinces, never neighbours). */
  async mapData() {const map=await this.map();return {...map,provinces:map.provinces.map(({path,...province})=>province),terrain:map.terrain.map(({path,...area})=>area)};}
  start() {return this.request(this.gamePath('/start'),'POST',{});}
  bots() {return this.request(this.gamePath('/bots'),'POST',{});}
  standings() {return this.request('/api/standings','GET',undefined,'');}
}
