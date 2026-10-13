import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';

// Retain lossless copies, leaving original campaign files untouched. This is
// post-capture packaging, never executed during a measured campaign.
const directory=dirname(fileURLToPath(import.meta.url));
const operationMode=process.env.FLAREX_PROFILE_OPERATION_CORRELATION==='on';
const readMode=process.env.FLAREX_PROFILE_READ_CORRELATION==='on';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const paths=readMode?['read-costs.json']:operationMode?['operation-summary.json','operation-costs.json']:['summary.json','summary-tolerance-2.json'];
for(const label of readMode?['read-final-b','read-final-c']:operationMode?['operation-profile-a','operation-profile-b','operation-counters']:['profile-a','control','profile-b']){
  const names=(await readdir(resolve(directory,label))).filter(f=>/^[a-f0-9-]{36}\.json$/.test(f));
  assert.equal(names.length,1);
  paths.push(`${label}/${names[0]}`);
  if(operationMode)paths.push(`${label}/operations.json`,`${label}/markers.json`);
  if(readMode)paths.push(`${label}/operations.json`,`${label}/read-facts.json`);
}
const manifest=[];
for(const path of paths){
  const original=await readFile(resolve(directory,path));
  const packed=gzipSync(original,{level:9});
  assert.deepEqual(gunzipSync(packed),original);
  await writeFile(resolve(directory,path+'.gz'),packed);
  assert.deepEqual(gunzipSync(await readFile(resolve(directory,path+'.gz'))),original);
  manifest.push({path,bytes:original.length,sha256:hash(original),gzipBytes:packed.length,gzipSha256:hash(packed)});
}
await writeFile(resolve(directory,readMode?'read-artifacts.json':operationMode?'operation-artifacts.json':'artifacts.json'),JSON.stringify(manifest,null,2)+'\n');
