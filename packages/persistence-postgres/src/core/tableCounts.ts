/** Versioned exact table counts translated from Convex snapshot_manager.rs at db914cf06.
 * Copyright 2026 Convex, Inc., FSL-1.1-Apache-2.0 (convex-backend/LICENSE.md).
 */
import { BTreeEx as BTree } from "sorted-btree/extended/index.js";
import { Result } from "effect";
import { bytesEqual, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { CorePersistenceError } from "./contracts";
import { captureCoreDocument } from "./document";
import type { CoreDocumentChange } from "./transaction";
import type { CoreRegistry } from "./registry";

export interface CoreTableCount { readonly numValues: bigint; readonly totalSize: bigint }
export type CoreTableCountDelta=readonly Readonly<{key:string;numValues:bigint;totalSize:bigint;drop:boolean}>[];
export const CORE_COUNT_MAX = 0xffff_ffff_ffff_ffffn;
export class CoreTableCounts {
  private constructor(private readonly root:BTree<string,CoreTableCount>) {}
  get tables():Readonly<{size:number;get:(key:string)=>CoreTableCount|undefined;has:(key:string)=>boolean;entries:()=>IterableIterator<[string,CoreTableCount]>;values:()=>IterableIterator<CoreTableCount>}> {return this.root;}
  static fromEntries(entries:Iterable<readonly [string,CoreTableCount]>):CoreTableCounts {
    return new CoreTableCounts(new BTree([...entries].map(([key,count])=>[key,Object.freeze({...count})])));
  }
  count(tableId: Uint8Array): bigint { return this.tables.get(encodeBytesToLowercaseHex(tableId))?.numValues ?? 0n; }
  static changes(registry:CoreRegistry,changes:readonly CoreDocumentChange[]):Result.Result<CoreTableCountDelta,CorePersistenceError>{
    return Result.gen(function*(){
      const deltas=new Map<string,{numValues:bigint;totalSize:bigint;drop:boolean}>();
      const delta=(key:string)=>{let value=deltas.get(key);if(value===undefined){value={numValues:0n,totalSize:0n,drop:false};deltas.set(key,value);}return value;};
      for(const change of changes){
        const value=delta(encodeBytesToLowercaseHex(change.table.tabletId));
        if(change.originalDocument!==null){
          const original=yield* Result.mapError(captureCoreDocument(change.originalDocument,true),cause=>new CorePersistenceError({reason:"corruptData",cause}));
          value.numValues-=1n;value.totalSize-=BigInt(original.semanticSizeBytes);
        }
        if(change.finalDocument!==null){
          const final=yield* Result.mapError(captureCoreDocument(change.finalDocument,true),cause=>new CorePersistenceError({reason:"corruptData",cause}));
          value.numValues+=1n;value.totalSize+=BigInt(final.semanticSizeBytes);
        }
      }
      const catalog=registry.table("_tables")?.definition;
      for(const change of changes)if(catalog!==undefined&&bytesEqual(change.table.tabletId,catalog.tabletId))delta(encodeBytesToLowercaseHex(change.id)).drop=change.finalDocument===null;
      return Object.freeze([...deltas].map(([key,value])=>Object.freeze({key,...value})));
    });
  }
  applyDelta(delta:CoreTableCountDelta):Result.Result<CoreTableCounts,CorePersistenceError>{
    const tables=this.root.clone();
    for(const entry of delta){
      const old=tables.get(entry.key)??{numValues:0n,totalSize:0n};
      const numValues=old.numValues+entry.numValues,totalSize=old.totalSize+entry.totalSize;
      if(numValues<0n||totalSize<0n||numValues>CORE_COUNT_MAX||totalSize>CORE_COUNT_MAX)return Result.fail(new CorePersistenceError({reason:"corruptData",cause:"Table count overflow or underflow"}));
      if(entry.drop)tables.delete(entry.key);else tables.set(entry.key,Object.freeze({numValues,totalSize}));
    }
    return Result.succeed(new CoreTableCounts(tables));
  }
  apply(registry:CoreRegistry,changes:readonly CoreDocumentChange[]):Result.Result<CoreTableCounts,CorePersistenceError>{
    return Result.flatMap(CoreTableCounts.changes(registry,changes),delta=>this.applyDelta(delta));
  }

}
