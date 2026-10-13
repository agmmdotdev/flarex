import { defineConfig } from 'vitest/config';
import ts from '@typescript/typescript6';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import base from '../vitest.config.ts';
const directory = resolve('work/validation/shared-execution-evidence/composition-snapshot-reduction');
const hash = source => createHash('sha256').update(source).digest('hex');
const stage = process.env.VALIDATION_STAGE;
if (!['composition','snapshot'].includes(stage)) throw Error('Unknown stage');
const owners = { 'journalContribution.ts': 'projectLogicalDocumentJournalContribution',
  'journalEvidence.ts': 'serializeLogicalParticipantDependencyEvidence', 'detachChanges.ts': 'detachLogicalDocumentRootChanges' };
const baseline = Object.fromEntries([...Object.keys(owners),'rootEvaluator.ts'].map(name => [name,
  readFileSync(resolve(directory, 'baseline-'+name),'utf8').replaceAll('\r\n','\n')]));
const candidate = Object.fromEntries([...Object.keys(owners),'rootEvaluator.ts'].map(name => [name,
  readFileSync(resolve(directory, 'candidate-'+name),'utf8').replaceAll('\r\n','\n')]));
function body(source,id,name) {
  const file=ts.createSourceFile(id,source,ts.ScriptTarget.Latest,true);let found;
  function visit(node) {
    if(ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text===name) {
      function callable(child) {
        if((ts.isFunctionExpression(child)||ts.isArrowFunction(child)) && ts.isBlock(child.body) && !found)found=child.body;
        if(!found)ts.forEachChild(child,callable);
      }
      callable(node.initializer);
    }
    ts.forEachChild(node,visit);
  }
  visit(file);if(!found)throw Error('Missing body '+name);return {file,found};
}
export default defineConfig({...base,plugins:[{name:'composition-snapshot-separate-ab',enforce:'pre',transform(source,id){
  id=id.replaceAll('\\','/');source=source.replaceAll('\r\n','\n');
  if(id.endsWith('/measurement/run.ts')) {
    const marker='completed = await (cpu !== undefined ? cpu.capture(timed)\n        : collector !== undefined && mode === "server" && server !== undefined ? server.capture(timed) : timed());';
    if(source.split(marker).length!==2)throw Error('Root capture marker moved');
    return source.replace(marker,'completed = await globalThis.__validationTrial.request({id,index,kind}, () => (cpu !== undefined ? cpu.capture(timed)\n        : collector !== undefined && mode === "server" && server !== undefined ? server.capture(timed) : timed()));');
  }
  const filename=id.split('/').at(-1);
  if(!id.includes('/logicalDocuments/')||!Object.hasOwn(baseline,filename))return;
  const checkoutHash=hash(source);
  source=candidate[filename];
  if(stage==='composition' && ['detachChanges.ts','rootEvaluator.ts'].includes(filename))
    return 'globalThis.__validationTrial.loaded.push('+JSON.stringify({id,stage,fixed:'before-snapshot',originalHash:hash(source),baselineHash:hash(baseline[filename]),transformedHash:hash(baseline[filename])})+');\n'+baseline[filename];
  if(stage==='snapshot' && filename!=='detachChanges.ts')return source;
  const name=owners[filename],before=baseline[filename],old=body(before,id,name),current=body(source,id,name);
  const start=current.found.getStart(current.file),end=current.found.end,older=old.found.getText(old.file),now=source.slice(start,end);
  const originalHash=hash(source);
  source=source.slice(0,start)+'{ if (!globalThis.__validationTrial.selected) '+older+'\n'+now.slice(1,-1)+'\n}'+source.slice(end);
  if(filename==='journalEvidence.ts')source+='\nconst encodeMetadataArrayEffect = Schema.encodeUnknownEffect(Schema.Array(LogicalMetadataReadDependencySchema));\n';
  return 'globalThis.__validationTrial.loaded.push('+JSON.stringify({id,stage,checkoutHash,originalHash,baselineHash:hash(before),transformedHash:hash(source),name})+');\n'+source;
}}],test:{...base.test,include:['work/validation/shared-execution-evidence/composition-snapshot-reduction/ab.test.ts'],testTimeout:600000}});
