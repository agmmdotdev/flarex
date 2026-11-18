import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import base from '../../../../packages/persistence-postgres/vitest.config.ts';
export default defineConfig({...base,plugins:[{name:'original-validation-witness',enforce:'pre',transform(source,id){
  const name=id.replaceAll('\\','/').split('/').at(-1);
  if(id.includes('logicalDocuments') && ['journalContribution.ts','journalEvidence.ts'].includes(name))
    return readFileSync(resolve('work/validation/shared-execution-evidence/composition-snapshot-reduction','baseline-'+name),'utf8');
}}],test:{...base.test,maxWorkers:1,fileParallelism:false,include:['packages/persistence-postgres/test/execution/logicalJournalProjection.test.ts']}});
