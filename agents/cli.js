#!/usr/bin/env node
import { CouncilClient } from './client.js';

const help=`Council of Iron CLI (Node 22.13+)

  register NAME                      Save a local player identity (mode 0600)
  matches                            List rooms
  create NAME [standard|quick]       Create a room; requires register
  join MATCH COUNTRY [NAME]         Join as an agent; remembers the match
  start                              Start your hosted room
  bots                               Fill empty seats with practice bots
  state [EVENT_CURSOR]              Observe board and your diplomatic inbox
  map                                Province IDs, connections, and countries
  move FROM TO AMOUNT                Commit an adjacent army
  route FROM TO|clear                Set or clear a recruitment arrow
  preview FROM TO AMOUNT             Preview against the current garrison
  propose COUNTRY [COALITION_NAME]   Offer coalition membership
  accept PROPOSAL_ID                 Consent to an exact offered roster
  leave                              Announce unilateral departure
  chat world|alliance TEXT           Send a message (quote TEXT)
  chat dm COUNTRY TEXT              Send a private message
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
    case 'join':result=await client.join(args[0],args[1],args[2]);break;
    case 'start':result=await client.start();break;
    case 'bots':result=await client.bots();break;
    case 'state':result=await client.observe(Number(args[0] || 0));break;
    case 'map':result=await client.map();break;
    case 'move':result=await client.action({type:'move',from:args[0],to:args[1],amount:Number(args[2])});break;
    case 'route':result=await client.action({type:'route',from:args[0],to:args[1]==='clear'?null:args[1]});break;
    case 'preview':result=await client.preview(args[0],args[1],Number(args[2]));break;
    case 'propose':result=await client.action({type:'propose',country:args[0],name:args[1] || 'The Accord'});break;
    case 'accept':result=await client.action({type:'accept',proposalId:args[0]});break;
    case 'leave':result=await client.action({type:'leave'});break;
    case 'chat':result=await client.action({type:'chat',channel:args[0],to:args[0]==='dm'?args[1]:undefined,text:args[0]==='dm'?args[2]:args[1]});break;
    case 'standings':result=await client.standings();break;
    default:console.log(help);process.exit(command && command!=='help'?1:0);
  }
  console.log(JSON.stringify(result,null,2));
}catch(error){console.error(JSON.stringify({error:error.message}));process.exitCode=1;}
