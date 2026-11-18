import { defineConfig } from 'vitest/config';
import base from '../../../../packages/executor/test/performance/measurement/attribution.vitest.config.ts';
const replace=(source:string,before:string,after:string)=>{
  if(source.split(before).length!==2)throw Error('Existing CPU collector landmark changed');
  return source.replace(before,after);
};
export default defineConfig({...base,plugins:[{name:'existing-cpu-clock-landmarks',enforce:'pre',transform(source,id){
  if(!id.replaceAll('\\','/').endsWith('/measurement/collectors/cpu.ts'))return;
  source=source.replaceAll('\r\n','\n');
  source=replace(source,'if (cpuAttempted) {','if (cpuAttempted) {\n globalThis.__fullCpuMarkers.clockMarkerB();');
  return replace(source,'      if (allocations) {','      globalThis.__fullCpuMarkers.clockMarkerA();\n      if (allocations) {');
}}],test:{...base.test,setupFiles:['work/validation/shared-execution-evidence/full-cpu-differential/markers.ts']}});
