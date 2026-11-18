import { expect, it } from 'vitest';
import ts from '@typescript/typescript6';
import { createRepresentationProbe } from './probe';
import { transformRepresentation } from './transform.mjs';
const request={id:'test',index:5,kind:'diagnostic',lane:'flarex'};
const make=()=>{let cycles=0n;return createRepresentationProbe({read:()=>cycles+=11n,threadId:()=>1});};
it('observes identity without reading foreign objects and forwards exact receiver, arguments and result',async()=>{
  const probe=make();let touched=0;
  const foreign=new Proxy({}, {get(){touched++;throw Error('foreign getter');},ownKeys(){touched++;throw Error('foreign enumeration');}});
  const receiver={marker:1};
  const fn=probe.wrap('forward',function(this: typeof receiver, input: unknown, second: number){expect(this).toBe(receiver);expect(second).toBe(2);return input;});
  await probe.request(request,async()=>{expect(fn.call(receiver,foreign,2)===foreign).toBe(true);});
  expect(touched).toBe(0);
  expect(probe.requests[0]?.edges[0]?.inputs[0]).toEqual(probe.requests[0]?.edges[0]?.output);
  expect(probe.requests[0]?.cycles?.complete).toBe(true);
});
it('retains the original business defect when observation fails',async()=>{
  const probe=createRepresentationProbe({read:()=>{throw Error('counter fault');},threadId:()=>1});
  const original=new Error('business defect');const fn=probe.wrap('failure',()=>{throw original;});
  await expect(probe.request(request,async()=>fn())).rejects.toBe(original);
  expect(probe.requests[0]?.cycles?.complete).toBe(false);
});
it('preserves primitive distinctions in the serialized ledger',async()=>{
  const probe=make(), symbol=Symbol('same-description');
  await probe.request(request,async()=>{
    const token=probe.begin('primitives',[undefined,0,-0,NaN,Infinity,-Infinity,null,1n,symbol,Symbol('same-description'),symbol]);
    probe.end(token);
  });
  const inputs=JSON.parse(JSON.stringify(probe.requests[0]?.edges[0]?.inputs));
  expect(new Set(inputs.slice(0,10).map((x:unknown)=>JSON.stringify(x))).size).toBe(10);
  expect(inputs[8]).toEqual(inputs[10]);
});
it('restores caller labels after a throw without changing argument evaluation order',async()=>{
  const probe=make(), order: string[]=[];
  const fn=probe.wrap('encode',(a:unknown,b:unknown)=>{order.push('body');return [a,b];});
  const fail=new Error('first');
  await probe.request(request,async()=>{
    probe.atCall('call-a',()=>fn((order.push('arg-a'),1),(order.push('arg-b'),2)));
    expect(()=>probe.atCall('call-b',()=>{throw fail;})).toThrow(fail);
    fn(3,4);
  });
  expect(order).toEqual(['arg-a','arg-b','body','body']);
  expect(probe.requests[0]?.edges.map(e=>e.caller)).toEqual(['call-a',undefined]);
});
it('treats recursive encoding as one walk and keeps transfer semantics',async()=>{
  const probe=make();let calls=0;
  const recursive=probe.wrap('recursive',(depth:number):number=>{calls++;return depth===0?0:recursive(depth-1)+1;});
  const bytes=new Uint8Array([7,8]);
  await probe.request(request,async()=>{
    expect(recursive(3)).toBe(3);
    const cloned=probe.clone('test',bytes,{transfer:[bytes.buffer]});
    expect(cloned).toEqual(new Uint8Array([7,8]));expect(bytes.byteLength).toBe(0);
  });
  expect(calls).toBe(4);expect(probe.requests[0]?.edges.filter(e=>e.site==='recursive')).toHaveLength(1);
  expect(probe.requests[0]?.cycles?.buckets.reduce((n,b)=>n+b.cycles,0)).toBe(probe.requests[0]?.cycles?.totalCycles);
});
it('transforms a real-shape synchronous owner without changing nested returns or defect identity',async()=>{
  const probe=make();
  const source='export function encodeCanonicalJson(value: unknown, fail: (x: unknown)=>never): unknown { const nested=()=>value; if(value===null)return fail(value); return nested(); }';
  const transformed=transformRepresentation(source,'/packages/flarex-protocol/src/json.ts');
  expect(transformed).toBeDefined();
  const js=ts.transpileModule(transformed??'',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const exports: {encodeCanonicalJson?:(value:unknown,fail:(value:unknown)=>never)=>unknown}={};
  new Function('globalThis','exports',js)({__representation:probe},exports);
  const encode=exports.encodeCanonicalJson;if(encode===undefined)throw Error('Missing transformed fixture');
  const object={test:true}, original=new Error('original refusal');
  await probe.request(request,async()=>{expect(encode(object,()=>{throw original;})).toBe(object);expect(()=>encode(null,()=>{throw original;})).toThrow(original);});
  expect(probe.requests[0]?.edges).toHaveLength(2);
  expect(probe.requests[0]?.edges[1]?.threw).toBe(true);
});
