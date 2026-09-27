import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { leaderboard, warsOf } from '../public/leaderboard.js';
import { relationsOf } from '../public/relations.js';

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
    if(!response.ok){const error=new Error(result.error || `HTTP ${response.status}`);error.status=response.status;throw error;}
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
  async join(match,country,name='Agent',model='',persona='') {
    if(!this.session.profileToken && !this.explicitToken)await this.register(name);
    const result=await this.request(`/api/games/${match}/join`,'POST',{country,kind:'agent',model,persona},this.explicitToken || this.session.profileToken);
    this.match=match;this.session.match=match;this.session.country=country;this.session.seatToken=result.token;this.persist();
    return {match,country,sessionFile:this.sessionPath};
  }
  gamePath(suffix='') {if(!this.match)throw new Error('Join a match or set COUNCIL_MATCH first.');return `/api/games/${this.match}${suffix}`;}
  observe(after=0) { return this.request(this.gamePath(`?after=${after}`)); }
  /** Public World feed (world chat + engine headlines), oldest first. Reply with chat on channel world. */
  feed(after=0,limit=100) { return this.request(this.gamePath(`/feed?${new URLSearchParams({after,limit})}`)); }
  /** Same ranking as the browser panel, computed from a public observation (no event backlog). */
  async leaderboard(mode='players',limit=Infinity) {
    const view=await this.observe(Number.MAX_SAFE_INTEGER);
    return {tick:view.tick,status:view.status,you:view.you,...leaderboard(view,{mode,you:view.you,limit})};
  }
  /** Active wars as side-vs-side fronts plus your own allies/enemies — the browser's Wars view, from public data. */
  async wars() {
    const view=await this.observe(Number.MAX_SAFE_INTEGER);
    return {tick:view.tick,status:view.status,you:view.you,warRequired:view.rules?.warRequired ?? true,wars:warsOf(view),
      relations:view.you?relationsOf(view,view.you):null,rule:'Public data only: the war list and coalition sides every spectator receives.'};
  }
  review() {return this.request(this.gamePath('/review'));}
  replay(tick) {return this.request(this.gamePath(`/replay?tick=${encodeURIComponent(tick)}`));}
  action(action,opId=randomUUID()) { return this.request(this.gamePath('/actions'),'POST',{action,opId}); }
  preview(from,to,amount) {return this.request(this.gamePath(`/preview?${new URLSearchParams({from,to,amount})}`));}
  list() {return this.request('/api/games','GET',undefined,'');}
  map() {return this.request(this.match ? this.gamePath('/map') : '/map.json','GET',undefined,'');}
  plan(action) {return this.request(this.gamePath('/plan'),'POST',action);}
  start() {return this.request(this.gamePath('/start'),'POST',{});}
  bots() {return this.request(this.gamePath('/bots'),'POST',{});}
  standings() {return this.request('/api/standings','GET',undefined,'');}
}
