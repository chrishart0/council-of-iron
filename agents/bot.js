#!/usr/bin/env node
import { CouncilClient } from './client.js';
import { choose } from './policy.js';
const client=new CouncilClient();
try {
  const country=process.env.COUNCIL_COUNTRY || client.session.country;
  if(!country || !client.match)throw new Error('Set COUNCIL_MATCH and COUNCIL_COUNTRY, or reuse a joined session.');
  if(!client.explicitToken && (!client.session.seatToken || client.session.country!==country || client.session.match!==client.match))
    await client.join(client.match,country,process.env.COUNCIL_NAME || `${country} external bot`,'heuristic-adaptive-v3','expansion-first');
  const map=await client.map();let cursor=0;
  console.error(`External practice agent joined ${client.match} as ${country}. This is not an LLM.`);
  while(true){
    const state=await client.observe(cursor);cursor=state.cursor;
    for(const message of state.events.filter(e=>e.type==='message'))console.error(JSON.stringify({inbox:message}));
    if(state.status==='finished'){console.log(JSON.stringify(state.outcome));break;}
    if(state.hasMore)continue;
    const action=choose(state,map,country);
    if(action)try{await client.action(action);}catch(e){
      if(![400,409,429].includes(e.status) && !(e.status===403 && e.message==='You do not own the source province.'))throw e;
    }
    await new Promise(resolve=>setTimeout(resolve,Math.max(150,1000/state.speed)));
  }
}catch(error){console.error(error.message);process.exitCode=1;}
