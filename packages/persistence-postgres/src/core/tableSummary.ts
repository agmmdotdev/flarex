/** Convex database/src/table_summary.rs at db914cf06.
 * Bounded summary bootstrap, checkpoint and exact revision replay.
 * Copyright 2026 Convex, Inc., FSL-1.1-Apache-2.0 (convex-backend/LICENSE.md).
 */
import { Effect, Option, Result, Schema } from "effect";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { decodeDocumentValue } from "flarex-protocol/document-value";
import { CorePersistenceError, CoreTimestampSchema, type CoreDocumentLogCursor, type CorePersistence,
  type CorePersistenceLease, type CoreRetentionValidator } from "./contracts";
import type { CoreDatabaseOptions, CoreError } from "./api";
import { CORE_SCHEMA_CUTOVER_GLOBAL, loadBootstrapRegistry } from "./bootstrap";
import { LEGACY_CORE_REGISTRY_DECODERS } from "./legacySchema";
import { loadCoreRegistry, readDocumentObject, type CoreRegistry } from "./registry";
import { createCoreMultiTableIterator, coreRepeatableRecentTimestamp, type CoreTableIterator } from "./tableIterator";
import { CoreTableCounts, CORE_COUNT_MAX, type CoreTableCount } from "./tableCounts";
import type { CoreDocumentChange } from "./transaction";
import { captureCoreDocument } from "./document";

const Counter = Schema.BigInt.check(Schema.makeFilter(value => value >= 0n && value <= CORE_COUNT_MAX ? undefined : "Expected u64"));
const DecimalCounter = Schema.String.check(Schema.makeFilter(value => /^(0|[1-9][0-9]*)$/.test(value)
  && BigInt(value) <= CORE_COUNT_MAX ? undefined : "Expected a canonical u64 decimal string"));
const Summary = Schema.Struct({ tables: Schema.Record(Schema.String, Schema.Struct({ totalSize: DecimalCounter,
  inferredTypeWithOptionalFields: Schema.Struct({ numValues: Counter, variant: Schema.Struct({ kind: Schema.Literal("Unknown") }) }) })),
  ts: Schema.String.check(Schema.makeFilter(value => /^(0|[1-9][0-9]*)$/.test(value) ? undefined : "Expected a decimal timestamp")) });
const corrupt = (cause?: unknown) => new CorePersistenceError({ reason: "corruptData", ...(cause === undefined ? {} : { cause }) });
const utf8 = new TextEncoder();
const summaryRevisionKey=(tableId:Uint8Array,id:Uint8Array,ts:bigint):string=>`${encodeBytesToLowercaseHex(tableId)}:${encodeBytesToLowercaseHex(id)}:${ts}`;
const parseWithSource: (text:string,reviver:(key:string,value:unknown,context?:Readonly<{source?:string}>)=>unknown)=>unknown = JSON.parse;

/** Numeric u64 lexemes never pass through a rounded JS number. Node and workerd are witnessed. */
export function parseCoreTableSummary(bytes:Uint8Array):Result.Result<Readonly<{timestamp:bigint;counts:CoreTableCounts}>,CorePersistenceError> {
  return Result.gen(function*(){
    const parsed=yield* Result.try({try:()=>parseWithSource(new TextDecoder("utf-8",{fatal:true}).decode(bytes),(key,value,context)=>{
      if(key!=="numValues")return value;
      const source=context?.source;
      return typeof source==="string"&&/^(0|[1-9][0-9]*)$/.test(source)?BigInt(source):value;
    }),catch:(cause:unknown)=>{if(cause instanceof SyntaxError||cause instanceof TypeError)return corrupt(cause);throw cause;}});
    const decoded=yield* Result.mapError(Schema.decodeUnknownResult(Summary)(parsed),corrupt);
    const timestamp=yield* Result.mapError(Schema.decodeUnknownResult(CoreTimestampSchema)(BigInt(decoded.ts)),corrupt);
    return {timestamp,counts:CoreTableCounts.fromEntries(Object.entries(decoded.tables).map(([id,value])=>[id,
      {numValues:value.inferredTypeWithOptionalFields.numValues,totalSize:BigInt(value.totalSize)}]))};
  });
}
export function serializeCoreTableSummary(timestamp:bigint,counts:CoreTableCounts):Uint8Array {
  const tables=[...counts.tables.entries()].toSorted(([a],[b])=>a<b?-1:a>b?1:0).map(([id,count])=>
    `${JSON.stringify(id)}:{"totalSize":${JSON.stringify(String(count.totalSize))},"inferredTypeWithOptionalFields":{"numValues":${count.numValues},"variant":{"kind":"Unknown"}}}`);
  return utf8.encode(`{"tables":{${tables.join(",")}},"ts":${JSON.stringify(String(timestamp))}}`);
}

export const makeCoreTableSummaryWorker=Effect.fn("CoreTableSummary.make")(function*(input:Readonly<{
  persistence:CorePersistence;lease:CorePersistenceLease;retention:CoreRetentionValidator;options:CoreDatabaseOptions;
  publishedTimestamp:Effect.Effect<bigint>;publishCounts:(at:bigint,counts:CoreTableCounts)=>Effect.Effect<boolean,CoreError>;
}>){
  const marker=yield* input.persistence.getGlobal(CORE_SCHEMA_CUTOVER_GLOBAL);
  if(Option.isNone(marker))return yield* corrupt("Missing proven logical cutover boundary");
  const cutoverValue=yield* Effect.fromResult(Result.mapError(decodeDocumentValue(marker.value),corrupt));
  const cutover=yield* Schema.decodeUnknownEffect(CoreTimestampSchema)(cutoverValue).pipe(Effect.mapError(corrupt));
  if(cutover>(yield* input.publishedTimestamp))return yield* corrupt("Logical cutover boundary is ahead of committed publication");
  const checkpoint=yield* input.persistence.getGlobal("table_summary_v2");
  let at:bigint,counts:CoreTableCounts|undefined;
  if(Option.isSome(checkpoint)){
    const parsed=yield* Effect.fromResult(parseCoreTableSummary(checkpoint.value));at=parsed.timestamp;counts=parsed.counts;
  }else at=yield* coreRepeatableRecentTimestamp(input.persistence);
  let registry:CoreRegistry|undefined;
  let tables:readonly import("./api").CoreTableDefinition[]=[];
  let tableOffset=0,iterator:CoreTableIterator|undefined;
  let multi:ReturnType<typeof createCoreMultiTableIterator>|undefined;
  let totals=new Map<string,CoreTableCount>();
  let targetRegistry:CoreRegistry|undefined;
  let target:bigint|undefined,logAfter:CoreDocumentLogCursor|undefined;
  let complete=false;
  const registryAt=Effect.fn("CoreTableSummary.registryAt")(function*(timestamp:bigint){
    const snapshot=yield* input.persistence.readSnapshot(timestamp,input.retention);
    return yield* loadCoreRegistry(snapshot,yield* loadBootstrapRegistry(input.persistence,snapshot,timestamp<cutover),undefined,
      timestamp<cutover?LEGACY_CORE_REGISTRY_DECODERS:undefined);
  });
  const advance=Effect.fn("CoreTableSummary.advance")(function*(work:Readonly<{pageSize:number;maxPages:number}>){
    if(complete)return;
    if(registry===undefined){registry=yield* registryAt(at);tables=[...registry.tables.values()].map(record=>record.definition);}
    for(let step=0;step<work.maxPages;step++){
      if(counts===undefined){
        const table=tables[tableOffset];
        if(table!==undefined){
          const index=table.indexes.find(candidate=>candidate.name==="by_id");
          if(index===undefined)return yield* corrupt();
          multi??=createCoreMultiTableIterator({persistence:input.persistence,snapshotTs:at,tables,retention:input.retention,
            budget:{...input.options.schemaWorker,pageSize:work.pageSize}});
          iterator??=multi.table(table,index);
          const page=yield* iterator.nextPage();
          const key=encodeBytesToLowercaseHex(table.tabletId),old=totals.get(key)??{numValues:0n,totalSize:0n};
          let size=old.totalSize;
          for(const entry of page.entries){const document=yield* Effect.fromResult(readDocumentObject(entry.document,table));
            size+=BigInt((yield* Effect.fromResult(Result.mapError(captureCoreDocument(document,true),corrupt))).semanticSizeBytes);}
          totals.set(key,{numValues:old.numValues+BigInt(page.entries.length),totalSize:size});
          if(page.done){multi.unregisterTable(table.tabletId);tableOffset++;iterator=undefined;}
          continue;
        }
        counts=CoreTableCounts.fromEntries(totals.entries());totals=new Map();
      }
      target??=yield* input.publishedTimestamp;
      if(at>target)return yield* corrupt("Summary checkpoint is ahead of committed publication");
      if(at<target){
        const page=yield* input.persistence.loadDocuments({start:at+1n,end:target,order:"asc",maxResults:Math.min(work.pageSize,input.options.schemaWorker.logPageSize),...(logAfter===undefined?{}:{after:logAfter})},input.retention);
        const changes:CoreDocumentChange[]=[];
        targetRegistry??=yield* registryAt(target);
        const currentRegistry=targetRegistry;
        const previousQueries=page.documents.flatMap(revision=>revision.prevTs===null?[]:[{tableId:revision.tableId,id:revision.id,ts:revision.ts,prevTs:revision.prevTs}]);
        const previousRows=previousQueries.length===0?[]:yield* input.persistence.previousRevisionsOfDocuments(previousQueries,input.retention);
        const predecessors=new Map<string,import("./contracts").CoreDocumentLogEntry>();
        for(const previous of previousRows){
          const key=summaryRevisionKey(previous.query.tableId,previous.query.id,previous.query.prevTs);
          if(predecessors.has(key))return yield* corrupt("Duplicate exact predecessor in summary replay");
          predecessors.set(key,previous.document);
        }
        for(const revision of page.documents){
          const table=currentRegistry.tableByTablet(revision.tableId)?.definition??registry.tableByTablet(revision.tableId)?.definition;
          if(table===undefined)return yield* corrupt("Summary replay cannot resolve table identity");
          const previous=revision.prevTs===null?undefined:predecessors.get(summaryRevisionKey(revision.tableId,revision.id,revision.prevTs));
          if(revision.prevTs!==null&&previous===undefined)return yield* corrupt("Summary replay lost exact predecessor");
          const old=previous===undefined||previous.deleted?null:yield* Effect.fromResult(readDocumentObject(previous,table));
          const next=revision.deleted?null:yield* Effect.fromResult(readDocumentObject(revision,table));
          changes.push({table,id:revision.id,original:previous,originalDocument:old,finalDocument:next});
        }
        counts=yield* Effect.fromResult(counts.apply(currentRegistry,changes));
        if(!page.done){logAfter=page.cursor??undefined;continue;}
        at=target;registry=currentRegistry;logAfter=undefined;
      }
      // Durable checkpoint precedes live publication and contains only a complete S.
      yield* input.persistence.putGlobal(input.lease,"table_summary_v2",serializeCoreTableSummary(at,counts));
      complete=yield* input.publishCounts(at,counts);
      if(complete)return;
      target=undefined;targetRegistry=undefined;
    }
  });
  return {advance,hasMore:()=>!complete};
});
