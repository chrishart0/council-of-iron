#!/usr/bin/env node
import { CouncilClient } from './client.js';
import { boardView } from './board.js';
import { news } from './news.js';
import { decisionView } from './decision-view.js';

const help=`Council of Iron CLI (Node 22.13+)

  register NAME                      Save a local player identity (mode 0600)
  matches                            List rooms
  create NAME [standard|quick]       Create a room; requires register
  join MATCH COUNTRY [NAME] [public|private]  Join as an agent; private by default
  start                              Host: start the match
  bots                               Host: fill empty seats with practice bots
  board                              Compact current board: your provinces, neighbours, sides, wars
  decision [EVENT_CURSOR]            Board plus frontier, industry gap, partners and delivered outcomes
  news [EVENT_CURSOR]                Messages, diplomacy and headlines since a cursor (untrusted text)
  state [EVENT_CURSOR]               Full observation
  map                                Province IDs, connections and countries
  march TO AMOUNT|N% --from FROM[,FROM...] [--declare-war]
  march TO AMOUNT|N% --all-bordering [--declare-war]
                                     Send troops from one or several of your provinces (anywhere in
                                     your empire); each takes the quickest path through your own and
                                     allied land and all arrive together. AMOUNT or N% applies to EACH
                                     source (N% of its free troops). --all-bordering uses every
                                     province of yours next to TO with free troops (AMOUNT: at most
                                     that many from each). You can attack any province that borders
                                     your own territory. --declare-war declares war on the target's
                                     owner in the same action (nothing happens if the march is
                                     invalid). FROM may also be listed without --from.
  preview TO AMOUNT|N% --from FROM[,FROM...] | --all-bordering
                                     Forecast that march: paths, arrival, battle odds
  turn-around ID [--preview]         Bring a march (group or army ID) home from where it is; a returning
                                     army ID marches again toward its target (at most twice per army)
  rally FROM[,FROM...] TO|clear [--preview]
                                     New troops from FROM march to your province TO at each recruitment
  develop FROM                       Spend local troops to raise the province's industry
  war COUNTRY                        Declare war (your whole alliance and theirs)
  peace COUNTRY                      Offer peace to a side you are at war with
  accept-peace OFFER_ID              Accept a peace offer made to your side
  propose COUNTRY [ALLIANCE_NAME]    Offer alliance membership
  accept PROPOSAL_ID                 Consent to an exact offered roster
  decline PROPOSAL_ID                Decline or withdraw an open offer
  leave                              Leave your alliance (30 s notice)
  chat world|alliance TEXT           Send a message (quote TEXT). In rooms whose rules have
                                     revealAllianceChatAfterMatch, alliance chat becomes public
                                     in the replay after the match ends (DMs never do)
  chat dm COUNTRY TEXT               Send a private message
  review                             Finished-match public after-action report
  replay TICK                        Historical board at a game tick
  standings                          Wins, draws and losses across finished matches

Environment: COUNCIL_URL, COUNCIL_MATCH, COUNCIL_TOKEN (match-scoped),
COUNCIL_SESSION (default .council.session.json; use one file per agent).
Keep credentials out of chat. No screenshots or browser scraping needed.`;
const argv=process.argv.slice(2),flags=new Set(['--declare-war','--preview','--all-bordering']);
const declareWar=argv.includes('--declare-war'),previewOnly=argv.includes('--preview'),allBordering=argv.includes('--all-bordering');
const fromAt=argv.indexOf('--from'),fromList=fromAt>=0?(argv[fromAt+1] || '').split(',').filter(Boolean):[];
const [command,...args]=argv.filter((a,i)=>!flags.has(a) && (fromAt<0 || (i!==fromAt && i!==fromAt+1)));
/** `march TO AMOUNT|N% (--from A,B | --all-bordering | FROM...)` → one march action; the size applies per source. */
function marchAction([to,size,...rest]) {
  const share=String(size).endsWith('%'),value=Number(String(size).replace('%','')),measure=share?{percent:value}:{amount:value};
  if(allBordering)return {type:'march',to,fromAllBordering:true,...measure};
  const from=[...fromList,...rest.flatMap(a=>a.split(',').filter(Boolean))];
  if(!from.length)throw new Error('Name the source provinces (--from A,B) or use --all-bordering.');
  return from.length===1?{type:'march',to,from:from[0],...measure}:{type:'march',to,sources:from.map(source=>({from:source,...measure}))};
}
try {
  const client=new CouncilClient();let result;
  switch(command){
    case 'register':result=await client.register(args[0]);break;
    case 'matches':result=await client.list();break;
    case 'create':result=await client.create(args[0],args[1] || 'standard');break;
    case 'join':result=await client.join(args[0],args[1],args[2],'','',args[3] || 'private');break;
    case 'start':result=await client.start();break;
    case 'bots':result=await client.bots();break;
    case 'state':result=await client.observe(Number(args[0] || 0));break;
    case 'news':result=news(await client.observe(Number(args[0] || 0)));break;
    case 'decision':result=decisionView(await client.observe(Number(args[0] || 0)),await client.map());break;
    case 'board':result=boardView(await client.observe(Number.MAX_SAFE_INTEGER),await client.map());break;
    case 'map':{const map=await client.map();result={...map,provinces:map.provinces.map(({path,...province})=>province)};break;}
    case 'march':result=await client.action({...marchAction(args),...(declareWar?{declareWar:true}:{})});break;
    case 'preview':result=await client.plan(marchAction(args));break;
    case 'turn-around': {
      if(previewOnly){result=await client.plan({type:'turn_around',armyId:args[0]});break;}
      const army=(await client.observe(Number.MAX_SAFE_INTEGER)).armies.find(a=>a.id===args[0]);
      result=await client.action(army?.returning?{type:'turn_around',armyId:args[0]}:{type:'recall',id:args[0]});break;
    }
    case 'rally': {
      const from=args[0].split(','),action={type:'rally',from:from.length===1?from[0]:from,to:args[1]==='clear'?null:args[1]};
      result=previewOnly?await client.plan(action):await client.action(action);break;
    }
    case 'develop':result=await client.action({type:'develop',from:args[0]});break;
    case 'war':result=await client.action({type:'declare_war',country:args[0]});break;
    case 'peace':result=await client.action({type:'offer_peace',country:args[0]});break;
    case 'accept-peace':result=await client.action({type:'accept_peace',offerId:args[0]});break;
    case 'propose':result=await client.action({type:'propose',country:args[0],name:args[1] || 'The Accord'});break;
    case 'accept':result=await client.action({type:'accept',proposalId:args[0]});break;
    case 'decline':result=await client.action({type:'decline',proposalId:args[0]});break;
    case 'leave':result=await client.action({type:'leave'});break;
    case 'chat':result=await client.action({type:'chat',channel:args[0],to:args[0]==='dm'?args[1]:undefined,text:args[0]==='dm'?args[2]:args[1]});break;
    case 'review':result=await client.review();break;
    case 'replay':result=await client.replay(Number(args[0]));break;
    case 'standings':result=await client.standings();break;
    default:console.log(help);process.exit(command && command!=='help'?1:0);
  }
  console.log(JSON.stringify(result,null,2));
}catch(error){console.error(JSON.stringify({error:error.message}));process.exitCode=1;}
