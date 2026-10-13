import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { promiseHooks } from 'node:v8';
import { afterAll } from 'vitest';
import { Schema } from 'effect';
import { createContinuationObserver, type Snapshot } from './continuation-observer';
import type { createLaunchObserver } from './launch-observer';
const require=createRequire(import.meta.url);
const native=Schema.decodeUnknownSync(Schema.Struct({enable:Schema.Unknown,disable:Schema.Unknown,snapshot:Schema.Unknown}))(
  require(resolve(import.meta.dirname,'continuation-native/gc-cycles.node')));
const enable=native.enable,disable=native.disable,read=native.snapshot;
if(typeof enable!=='function'||typeof disable!=='function'||typeof read!=='function')throw Error('Missing native GC observer');
const startNative=enable,stopNative=disable;
const buffer=new BigUint64Array(4);
const snapshot=():Snapshot=>{
  read(buffer);const [raw,gc,collections,faults]=buffer;
  if(raw===undefined||gc===undefined||collections===undefined||faults!==0n)throw Error('Invalid native GC snapshot');
  return {raw,gc,collections};
};
export function createLaunchObserverWithContinuations(input:Parameters<typeof createLaunchObserver>[0]){
  startNative();
  const observer=createContinuationObserver({snapshot,threadId:input.cycles.threadId,current:input.current,
    reverse:input.reverse,plain:process.env.FLAREX_CONTINUATION_MODE==='plain'});
  const reactions=new WeakMap<object,ReturnType<typeof observer.enter>>();
  const origins=new WeakMap<object,string>();
  const stop=process.env.FLAREX_CONTINUATION_MODE==='plain'?()=>{}:promiseHooks.createHook({
    init(promise){observer.bookkeeping(()=>{
      const owner=observer.owner();if(owner!==undefined)origins.set(promise,owner.startsWith('VM.')?'reaction-created':owner);
    });},
    before(promise){observer.bookkeeping(()=>{
      if(reactions.has(promise))observer.faults.push('overlapping-reaction');
      const frame=observer.enter('VM.promiseReaction:'+ (origins.get(promise)??'uncaptured'));if(frame!==undefined)reactions.set(promise,frame);
    });},
    after(promise){observer.bookkeeping(()=>{const frame=reactions.get(promise);reactions.delete(promise);observer.leave(frame);});},
  });
  afterAll(()=>{stop();stopNative();});
  return observer;
}
