import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
for(const dir of ['src','agents','agents/playtest','public','scripts','scripts/sound','tests'])for(const file of readdirSync(dir).filter(f=>f.endsWith('.js'))){
  const result=spawnSync(process.execPath,['--check',`${dir}/${file}`],{stdio:'inherit'});
  if(result.status)process.exit(result.status);
}
console.log('All JavaScript files parse.');
