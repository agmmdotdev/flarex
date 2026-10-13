import { it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { decodeRaw, validateCampaign } from './evidence';
it('accounts for complete Flarex and native profiles',async()=>{await import('./analyze.mjs');});
it('rejects workload substitutions, mismatched pair joins and altered counters',async()=>{
  const raw=decodeRaw(JSON.parse(gunzipSync(await readFile(new URL('./profile-a/5016fd2f-30b6-4687-9b83-e659e39b3346.json.gz',import.meta.url))).toString('utf8')));
  expect(()=>validateCampaign(raw,'profile-a')).not.toThrow();
  expect(()=>decodeRaw({...raw,sampling:{...raw.sampling,scenario:'other-workload'}})).toThrow();
  const first=raw.cpuPairs[0],fourth=raw.cpuPairs[4];
  if(first===undefined||fourth===undefined||first.thread===null)throw Error('Missing test witness');
  expect(()=>validateCampaign({...raw,cpuPairs:raw.cpuPairs.map((p,i)=>i===0?{...p,nativeRequestId:fourth.nativeRequestId}:i===4?{...p,nativeRequestId:first.nativeRequestId}:p)},'profile-a')).toThrow();
  const changed={...first,thread:{...first.thread,addedTotalMicroseconds:first.thread.addedTotalMicroseconds+1}};
  expect(()=>validateCampaign({...raw,cpuPairs:[changed,...raw.cpuPairs.slice(1)]},'profile-a')).toThrow();
});
