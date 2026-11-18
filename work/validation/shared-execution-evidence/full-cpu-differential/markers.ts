import { performance } from 'node:perf_hooks';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { beforeAll, afterAll, expect } from 'vitest';

// Reuse the earlier paired CPU diagnostic's two six-ms clock landmarks.
// They surround the SDK collector's business/counter window, never its body.
const markers: { name: 'clockMarkerA' | 'clockMarkerB'; start: number; end: number }[] = [];
function clockMarkerA() {
  const start=performance.now(), until=start+6;
  while(performance.now()<until) {}
  markers.push({name:'clockMarkerA',start,end:performance.now()});
}
function clockMarkerB() {
  const start=performance.now(), until=start+6;
  while(performance.now()<until) {}
  markers.push({name:'clockMarkerB',start,end:performance.now()});
}
declare global { var __fullCpuMarkers: { clockMarkerA: typeof clockMarkerA; clockMarkerB: typeof clockMarkerB }; }
const hashSources=()=>Promise.all(['markers.ts','profile.config.ts','run-campaign.ps1'].map(async file=>({file,
  sha256:createHash('sha256').update(await readFile(new URL(file,import.meta.url))).digest('hex')})));
let before: Awaited<ReturnType<typeof hashSources>>;
beforeAll(async()=>{before=await hashSources();globalThis.__fullCpuMarkers={clockMarkerA,clockMarkerB};});
afterAll(async()=>{
  const after=await hashSources();
  const output=process.env.FLAREX_MEASUREMENT_REPORT_DIRECTORY;
  if(output===undefined)throw Error('Missing diagnostic output directory');
  await mkdir(output,{recursive:true});
  await writeFile(resolve(output,'markers.json'),JSON.stringify({before,after,markers},null,2));
  expect(after).toEqual(before);
});
