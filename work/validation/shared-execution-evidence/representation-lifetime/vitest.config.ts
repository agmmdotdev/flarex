import { defineConfig } from 'vitest/config';
import base from '../vitest.config.ts';
import { transformRepresentation } from './transform.mjs';
function replace(source: string, before: string, after: string) {
  if(source.split(before).length!==2)throw Error('Representation harness marker moved');
  return source.replace(before,after);
}
export default defineConfig({...base,plugins:[{name:'representation-lifetime',enforce:'pre',transform(source,id){
  source=source.replaceAll('\r\n','\n');id=id.replaceAll('\\','/');
  if(id.endsWith('/measurement/run.ts')) {
    source=replace(source,'completed = await (cpu !== undefined ? cpu.capture(timed)\n        : collector !== undefined && mode === "server" && server !== undefined ? server.capture(timed) : timed());',
      'completed = await globalThis.__representation.request({id,index,kind,lane:"flarex"}, () => (cpu !== undefined ? cpu.capture(timed)\n        : collector !== undefined && mode === "server" && server !== undefined ? server.capture(timed) : timed()));');
    return replace(source,'try { await (cpu === undefined ? timed() : cpu.capture(timed)); }',
      'try { await globalThis.__representation.request({id:runId+":native:"+index,index,kind:"diagnostic",lane:"native"}, () => (cpu === undefined ? timed() : cpu.capture(timed))); }');
  }
  if(id.endsWith('/support/mixedMutationProductFixture.ts'))return replace(source,
    'if (publicationObservation === undefined) return invoke();',
    'if (publicationObservation === undefined) return globalThis.__representation.phase(name,invoke);');
  return transformRepresentation(source,id);
}}],test:{...base.test,include:['work/validation/shared-execution-evidence/representation-lifetime/campaign.test.ts'],testTimeout:600000}});
