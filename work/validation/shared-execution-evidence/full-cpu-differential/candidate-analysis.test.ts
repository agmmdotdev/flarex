import { it, expect } from 'vitest';
import { Effect, Exit } from 'effect';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { transformCandidate } from './candidate-transform.mjs';
import ts from '@typescript/typescript6';
import { partitionOperations, sampleOperationOwner, type OperationRoot } from './evidence';

it('attributes timestamp points without assigning sampling gaps or ambiguous boundaries',()=>{
  const at=(n:number)=>({time:n,cycles:String(n),user:n,system:0});
  const root:OperationRoot={ordinal:0,start:at(0),end:at(10),threadId:1,intervals:[
    {ordinal:0,name:'parent',parent:null,start:at(1),end:at(9)},
    {ordinal:1,name:'child',parent:0,start:at(3),end:at(5)}]};
  partitionOperations(root);
  expect(sampleOperationOwner(root.intervals,4,-0.1,0.1,['parent','child'])).toBe('child');
  expect(sampleOperationOwner(root.intervals,5,-0.1,0.1,['parent','child'])).toBe('focus-boundary');
  expect(sampleOperationOwner(root.intervals,6,-0.1,0.1,['parent','child'])).toBe('parent');
  expect(sampleOperationOwner(root.intervals,9.5,-0.1,0.1,['parent','child'])).toBe('outside-focus');
});

it('brackets synchronous calls without changing argument order or thrown identity',()=>{
  const events:string[]=[],failure={reason:'first'};
  const source='function lowerIndex(a,b){events.push("body");throw failure;} lowerIndex((events.push("a"),1),(events.push("b"),2));';
  const transformed=transformCandidate(source,'/packages/example/logicalDocuments/workingSet.ts');assert(transformed);
  const globals={__candidateCpu:{sources:[]},__operationCpu:{sync:(_name:string,run:()=>unknown)=>{try{return run();}finally{events.push('end');}}}};
  try{new Function('globalThis','events','failure',transformed)(globals,events,failure);assert.fail('Expected original throw');}
  catch(cause){expect(cause).toBe(failure);}
  expect(events).toEqual(['a','b','body','end']);
});

it('preserves lazy execution, failure cause and short circuit across wrapped Effect calls',async()=>{
  const events:string[]=[],failure={reason:'first'};
  const source='function readFiniteBase(){events.push("construct");return Effect.fail(failure);} return readFiniteBase().pipe(Effect.andThen(()=>Effect.sync(()=>events.push("later"))));';
  const transformed=transformCandidate(source,'/packages/example/logicalDocuments/workingSet.ts');assert(transformed);
  const globals={__candidateCpu:{sources:[]},__operationCpu:{effect:<A,E,R>(_name:string,work:Effect.Effect<A,E,R>)=>
    Effect.onExit(work,()=>Effect.sync(()=>events.push('end')))}};
  const work:Effect.Effect<void,typeof failure>=new Function('globalThis','events','failure','Effect',transformed)(globals,events,failure,Effect);
  expect(events).toEqual(['construct']);
  expect(await Effect.runPromiseExit(work)).toEqual(Exit.fail(failure));
  expect(events).toEqual(['construct','end']);
});

it('transforms all pinned candidate and physical command sites with valid syntax',async()=>{
  for(const [path,count] of [['storage/documents/logicalDocuments/workingSet.ts',27],['database/physicalSession/postgres.ts',24]] as const){
    const file='packages/persistence-postgres/src/'+path;
    const source=(await readFile(file,'utf8')).replaceAll('\r\n','\n');
    const transformed=transformCandidate(source,'/'+file);assert(transformed);
    expect(ts.transpileModule(transformed,{reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext}})
      .diagnostics?.filter(d=>d.category===ts.DiagnosticCategory.Error)??[]).toEqual([]);
    const first=transformed.split('\n')[0];assert(first);
    const sources:{sites:unknown[]}[]=[];
    new Function('globalThis',first)({__candidateCpu:{sources}});
    expect(sources).toHaveLength(1);expect(sources[0]?.sites).toHaveLength(count);
  }
});
