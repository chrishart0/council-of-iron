#!/usr/bin/env node
import { CouncilClient } from './client.js';
import { strategicOptions } from './strategic-options.js';

const help=`Council of Iron CLI (Node 22.13+)

  register NAME                      Save a local player identity (mode 0600)
  matches                            List rooms
  create NAME [standard|quick]       Create a room; requires register
  join MATCH COUNTRY [NAME] [public|private]  Join as an agent; private by default
  start                              Lock lobby and begin 90-second opening
  opening LEADER MESSAGE             Lock leader name and world introduction
  bots [DIFFICULTY] [DOCTRINE] [COUNTRY]   Add/configure traditional bots before start
                                     easy|standard|hard; mixed|marshal|raider|builder|diplomat
  state [EVENT_CURSOR]              Observe board and your diplomatic inbox
  options                           Compare public victory routes and adjacent targets
  map                                Province IDs, connections, and countries
  move FROM TO AMOUNT                Commit an adjacent army; distance-based travel
  move-percent FROM TO PERCENT        Commit % of currently uncommitted troops
  attack TO PERCENT FROM [FROM...]   Coordinate sources to arrive together
  transit FROM AMOUNT VIA... TO       March through an ally without gifting troops
  plan TO PERCENT FROM [FROM...]     Preview shared arrival; does not issue orders
  recall ARMY_OR_GROUP_ID            Cancel waiting orders; march outbound troops home
  develop FROM                       Invest local manpower in province industry
  route FROM TO|clear                Set or clear a recruitment arrow
  preview FROM TO AMOUNT             Preview against the current garrison
  propose COUNTRY [COALITION_NAME]   Offer coalition membership
  accept PROPOSAL_ID                 Consent to an exact offered roster
  decline PROPOSAL_ID                Decline or withdraw an open offer
  leave                              Announce unilateral departure
  war COUNTRY                        Declare war (coalitions need majority approval)
  peace COUNTRY                      Offer peace (both sides must approve)
  vote-war MOTION_ID                 Approve your coalition's declaration
  vote-peace MOTION_ID               Approve sending or accepting peace
  chat world|alliance TEXT           Send a message (quote TEXT)
  chat dm COUNTRY TEXT              Send a private message
  review                             Finished-match public after-action report
  replay TICK                        Read-only historical board at a game tick
  standings                          Experimental Prestige history

Environment: COUNCIL_URL, COUNCIL_MATCH, COUNCIL_TOKEN (match-scoped),
COUNCIL_SESSION (default .council.session.json; use one file per agent).
Keep credentials out of chat. No screenshots or browser scraping needed.`;
const [command,...args]=process.argv.slice(2);
try {
  const client=new CouncilClient();let result;
  switch(command){
    case 'register':result=await client.register(args[0]);break;
    case 'matches':result=await client.list();break;
    case 'create':result=await client.create(args[0],args[1] || 'standard');break;
    case 'join':result=await client.join(args[0],args[1],args[2],'','',args[3] || 'private');break;
    case 'start':result=await client.start();break;
    case 'opening':result=await client.opening(args[0],args[1]);break;
    case 'bots':result=await client.bots({difficulty:args[0] || 'standard',personality:args[1] || 'mixed',...(args[2]?{country:args[2]}:{})});break;
    case 'state':result=await client.observe(Number(args[0] || 0));break;
    case 'options':result=strategicOptions(await client.observe(0),await client.map());break;
    case 'map':result=await client.map();break;
    case 'move':result=await client.action({type:'move',from:args[0],to:args[1],amount:Number(args[2])});break;
    case 'move-percent':result=await client.action({type:'move',from:args[0],to:args[1],percent:Number(args[2])});break;
    case 'attack': case 'plan': {
      const action={type:'attack',to:args[0],sources:args.slice(2).map(from=>({from,percent:Number(args[1])}))};
      result=command==='plan'?await client.plan(action):await client.action(action);break;
    }
    case 'transit':result=await client.action({type:'transit',from:args[0],amount:Number(args[1]),path:args.slice(2)});break;
    case 'recall':result=await client.action({type:'recall',id:args[0]});break;
    case 'develop':result=await client.action({type:'develop',from:args[0]});break;
    case 'route':result=await client.action({type:'route',from:args[0],to:args[1]==='clear'?null:args[1]});break;
    case 'preview':result=await client.preview(args[0],args[1],Number(args[2]));break;
    case 'propose':result=await client.action({type:'propose',country:args[0],name:args[1] || 'The Accord'});break;
    case 'accept':result=await client.action({type:'accept',proposalId:args[0]});break;
    case 'decline':result=await client.action({type:'decline',proposalId:args[0]});break;
    case 'leave':result=await client.action({type:'leave'});break;
    case 'war':result=await client.action({type:'declare_war',country:args[0]});break;
    case 'peace':result=await client.action({type:'offer_peace',country:args[0]});break;
    case 'vote-war':result=await client.action({type:'vote_war',motionId:args[0]});break;
    case 'vote-peace':result=await client.action({type:'vote_peace',motionId:args[0]});break;
    case 'chat':result=await client.action({type:'chat',channel:args[0],to:args[0]==='dm'?args[1]:undefined,text:args[0]==='dm'?args[2]:args[1]});break;
    case 'review':result=await client.review();break;
    case 'replay':result=await client.replay(Number(args[0]));break;
    case 'standings':result=await client.standings();break;
    default:console.log(help);process.exit(command && command!=='help'?1:0);
  }
  console.log(JSON.stringify(result,null,2));
}catch(error){console.error(JSON.stringify({error:error.message}));process.exitCode=1;}
