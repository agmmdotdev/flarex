import { defineConfig } from 'vitest/config';
import base from './operation-profile.config.ts';
import { transformCandidate } from './candidate-transform.mjs';
const named = ['LogicalDocuments.compileRelationalRead','LogicalDocuments.withCandidateSelection',
  'LogicalDocuments.consumeAccessMetadata','LogicalDocuments.locateUnique','LogicalDocuments.locate',
  'PostgresPhysicalSession.implicitCommand'];
export default defineConfig({...base,plugins:[...base.plugins??[],{
  name:'candidate-and-command-costs',enforce:'pre',transform(source,id) {
    source=source.replaceAll('\r\n','\n');
    if(id.replaceAll('\\','/').endsWith('/execution/diagnostics/operation.ts')) {
      const marker='globalThis.__operationCpu.effect(name, work, true)';
      if(source.split(marker).length!==2)throw Error('Candidate operation marker changed');
      return source.replace(marker,`globalThis.__operationCpu.effect(name, work, !${JSON.stringify(named)}.includes(name))`);
    }
    return transformCandidate(source,id);
  },
}],test:{...base.test,setupFiles:[...base.test?.setupFiles??[],
  'work/validation/shared-execution-evidence/full-cpu-differential/candidate-probe.ts']}});
