/** Convex database_index_workers/mod.rs and bootstrap_model/schema at db914cf06.
 * Bounded worker coordination uses the existing trusted committer.
 * Copyright 2026 Convex, Inc., FSL-1.1-Apache-2.0 (convex-backend/LICENSE.md).
 */
import { Effect, Exit, Option, Result, Schema, Semaphore } from "effect";
import { bytesEqual, compareBytesLexicographically, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { decodeDocumentId } from "flarex-protocol/document-id";
import { validateValidatorValueV1, type ValidatorIdPolicyV1 } from "flarex-protocol/validator-engine";
import type { ValidatorJsonV1 } from "flarex-protocol/validator-json";
import { CoreTransactionError, CoreSchemaWorkBudgetSchema, type CoreDatabaseOptions, type CoreError, type CoreSchemaProposal, type CoreSchemaWorkBudget } from "./api";
import { CorePersistenceError, type CorePersistence, type CorePersistenceLease, type CoreRetentionValidator } from "./contracts";
import { CoreSchemaModel, coreSchemaValidationOutcomes } from "./schemaModel";
import { coreSchemaTable, CoreSchemaError, SCHEMA_VALIDATIONS } from "./schemaTypes";
import { CoreSchemaValidations } from "./schemaValidations";
import type { CoreTransactionInternals } from "./transaction";
import { coreNamespaceKey, type CoreTableNamespace } from "./namespace";
import { INDEXES, INDEX_BACKFILLS, publicDocumentId, readDocumentObject, SCHEMAS, type CoreRegistry } from "./registry";
import { coreIndexMetadataValue, type CoreIndexRecord } from "./indexState";
import { pruneCoreSchemaWorkerWalks, type CoreSchemaBackfillWalk, type CoreSchemaValidationWalk } from "./schemaWorkerWalks";
import { decodeCoreIndexBackfillMetadata, advanceCoreIndexBackfillProgress, writeCoreIndexBackfillChunks } from "./indexBackfill";
import { createCoreLatestTableIterator, createCoreMultiTableIterator, coreTableIteratorCursor } from "./tableIterator";

type Admin = <A>(namespace:CoreTableNamespace,body:(context:CoreTransactionInternals)=>Effect.Effect<A,CoreError>)=>Effect.Effect<A,CoreError>;
const corrupt = (cause?:unknown)=>new CorePersistenceError({reason:"corruptData",...(cause===undefined?{}:{cause})});
const body = (document:import("flarex-protocol/document-value").DocumentObject) => {
  const {_id,_creationTime,...value}=document;return value;
};
const indexGroupIdentity=(indexes:readonly CoreIndexRecord[])=>indexes.map(index=>encodeBytesToLowercaseHex(index.ref.id)).toSorted().join(":");

const policy=(context:CoreTransactionInternals):ValidatorIdPolicyV1=>({mode:"tableAware",check:(name,id)=>{
    const table=context.registry.table(name,context.namespace);
    if(table===undefined)return "unavailable";
    return Result.match(decodeDocumentId(id),{onFailure:()=>"invalid",onSuccess:decoded=>decoded.tableNumber===table.definition.number?"valid":"invalid"});
  }});

const captureWork=(work:CoreSchemaWorkBudget)=>Schema.decodeUnknownEffect(CoreSchemaWorkBudgetSchema)(work)
    .pipe(Effect.mapError(cause=>new CoreTransactionError({reason:"invalidValue",cause})));

export function makeCoreSchemaWorker(input:Readonly<{
  persistence:CorePersistence;lease:CorePersistenceLease;retention:CoreRetentionValidator;options:CoreDatabaseOptions;
  publishedTimestamp:Effect.Effect<bigint>;
  assertOwnerOpen:Effect.Effect<void,CoreError>;
  currentRegistry:()=>CoreRegistry;
  countsPending:()=>boolean;
  admin:Admin;settle:(context:CoreTransactionInternals)=>Effect.Effect<bigint,CoreError>;
  warmCounts:(work:Readonly<{pageSize:number;maxPages:number}>)=>Effect.Effect<void,CoreError>;
}>) {
  const worker=Semaphore.makeUnsafe(1);
  let closed=false;
  const validationWalks=new Map<string,CoreSchemaValidationWalk>();
  const backfillWalks=new Map<string,CoreSchemaBackfillWalk>();
  const reconcileWalks=Effect.fn("CoreSchemaWorker.reconcileWalks")(function*(){
    const namespaces=new Map<string,{namespace:CoreTableNamespace;walks:[string,CoreSchemaValidationWalk][]}>();
    for(const entry of validationWalks){
      const namespace=entry[1].namespace,key=coreNamespaceKey(namespace),group=namespaces.get(key);
      if(group===undefined)namespaces.set(key,{namespace,walks:[entry]});else group.walks.push(entry);
    }
    const liveAttempts=new Set<string>();
    for(const {namespace,walks}of namespaces.values())yield* input.admin(namespace,context=>context.runSystem(Effect.gen(function*(){
      const model=new CoreSchemaModel(context);
      for(const [id,walk]of walks){
        const schema=yield* model.get(walk.schemaId);
        if(Option.isNone(schema)||["failed","overwritten"].includes(schema.value.metadata.state.state))continue;
        const attempt=yield* model.validations.validationMetadataForTable(walk.schemaId,walk.tableName);
        if(Option.isSome(attempt)&&attempt.value.document.id===id&&attempt.value.metadata.state.state==="pending"
          &&attempt.value.metadata.validatorHash===walk.hash)liveAttempts.add(id);
      }
    })));
    const registry=input.currentRegistry(),liveIndexGroups=new Map<string,string>();
    for(const [tablet,walk]of backfillWalks){
      const table=registry.tableByTablet(walk.tableId);
      if(table===undefined)continue;
      const pending=registry.indexesForTablet(table.id).filter(index=>index.state.type==="Backfilling"&&!index.state.backfillState.retentionStarted);
      if(pending.length>0)liveIndexGroups.set(tablet,indexGroupIdentity(pending));
    }
    pruneCoreSchemaWorkerWalks(validationWalks,backfillWalks,liveAttempts,liveIndexGroups);
  });
  const validationStep=Effect.fn("CoreSchemaWorker.validationStep")(function*(proposal:CoreSchemaProposal,pageSize:number){
    const captured=yield* input.admin(proposal.namespace,context=>Effect.gen(function*(){
      const selected=yield* context.runSystem(Effect.gen(function*(){
        const model=new CoreSchemaModel(context),schema=yield* model.get(proposal.id);
        if(Option.isNone(schema))return yield* new CoreSchemaError({reason:"schemaNotFound",message:"Schema proposal does not exist"});
        if(schema.value.metadata.state.state==="failed"||schema.value.metadata.state.state==="overwritten")return undefined;
        const validations=new CoreSchemaValidations(context);
        if(schema.value.metadata.state.state==="pending"){
          const active=yield* model.active();
          const staged=Option.isNone(active)?new Map<string,ValidatorJsonV1>():yield* validations.validStagedValidators(active.value.id,active.value.schema);
          const outcomes=coreSchemaValidationOutcomes(schema.value.schema,Option.getOrUndefined(Option.map(active,value=>value.schema)),staged,context.tableExists);
          let pending=false;
          for(const table of schema.value.schema.tables)if(outcomes.get(table.tableName)==="mustWalk"){
            const attempt=yield* validations.validationMetadataForTable(proposal.id,table.tableName);
            if(Option.isNone(attempt)){
              const mapping=context.registry.table(table.tableName,context.namespace);
              const count=mapping===undefined?Option.some(0n):yield* context.count(mapping.id);
              yield* validations.startTableValidation(proposal.id,table.tableName,undefined,Option.getOrNull(count));pending=true;
            }else if(attempt.value.metadata.validatorHash===undefined&&attempt.value.metadata.state.state==="pending")pending=true;
            else if(attempt.value.metadata.validatorHash===undefined&&attempt.value.metadata.state.state==="failed"){
              yield* model.markFailed(proposal.id,attempt.value.metadata.state.error,table.tableName);return undefined;
            }
          }
          if(!pending)yield* model.markValidated(proposal.id);
        }
        const attempts=yield* validations.validationsForSchema(proposal.id);
        const attempt=attempts.find(value=>value.metadata.state.state==="pending");
        if(attempt===undefined)return undefined;
        const declaration=coreSchemaTable(schema.value.schema,attempt.metadata.tableName);
        const validator=attempt.metadata.validatorHash===undefined?declaration?.documentType:declaration?.stagedDocumentType;
        if(validator===undefined)return yield* corrupt("Validation attempt has no matching validator");
        const table=context.registry.table(attempt.metadata.tableName,context.namespace)?.definition;
        const index=table?.indexes.find(candidate=>candidate.name==="by_id");
        if(table===undefined||index===undefined)return yield* corrupt();
        if(!validationWalks.has(attempt.document.id)){
          yield* validations.updateAttempt(attempt.document.id,{kind:"startWalk",totalDocs:Option.getOrNull(yield* context.count(table.tabletId))});
          validationWalks.set(attempt.document.id,{namespace:proposal.namespace,schemaId:proposal.id,tableName:table.name,hash:attempt.metadata.validatorHash,validator,
            iterator:createCoreLatestTableIterator({persistence:input.persistence,minimumTs:context.timestamp,table,index,recentTimestamp:input.publishedTimestamp,pageSize,budget:input.options.schemaWorker})});
        }
        return {attemptId:attempt.document.id,table,idPolicy:policy(context)};
      }));
      yield* input.settle(context);return selected;
    }));
    if(captured===undefined)return false;
    const walk=validationWalks.get(captured.attemptId);
    if(walk===undefined)return yield* Effect.die(new Error("Validation walk disappeared"));
    const page=yield* walk.iterator.nextPage();
    let error:string|undefined;
    for(const entry of page.entries){
      const document=yield* Effect.fromResult(readDocumentObject(entry.document,captured.table));
      const verdict=validateValidatorValueV1(walk.validator,body(document),{idPolicy:captured.idPolicy});
      if(Result.isFailure(verdict)){error=`Document in ${walk.tableName} violates its validator (${verdict.failure.issue.reason} at ${verdict.failure.issue.path})`;break;}
    }
    yield* input.admin(proposal.namespace,context=>Effect.gen(function*(){
      yield* context.runSystem(Effect.gen(function*(){
        const model=new CoreSchemaModel(context),current=yield* model.get(proposal.id);
        if(Option.isNone(current)||["failed","overwritten"].includes(current.value.metadata.state.state))return;
        const validations=new CoreSchemaValidations(context),attempt=yield* context.getSystem(SCHEMA_VALIDATIONS,captured.attemptId);
        if(Option.isNone(attempt))return;
        const matched=yield* validations.validationMetadataForTable(proposal.id,walk.tableName);
        if(Option.isNone(matched)||matched.value.document.id!==captured.attemptId||matched.value.metadata.validatorHash!==walk.hash)return;
        if(error!==undefined){
          if(walk.hash===undefined)yield* model.markFailed(proposal.id,error,walk.tableName);
          else yield* validations.updateAttempt(captured.attemptId,{kind:"markFailed",error});
        }else{
          yield* validations.updateAttempt(captured.attemptId,{kind:"recordProgress",additionalDocsValidated:BigInt(page.entries.length),totalDocs:Option.getOrNull(yield* context.count(captured.table.tabletId))});
          if(page.cursor.kind==="end")yield* validations.updateAttempt(captured.attemptId,{kind:"markValid"});
        }
      }));yield* input.settle(context);
    }));
    if(error!==undefined||page.cursor.kind==="end")validationWalks.delete(captured.attemptId);
    return true;
  });

  const backfillStep=Effect.fn("CoreSchemaWorker.backfillStep")(function*(namespace:CoreTableNamespace,pageSize:number){
    const captured=yield* input.admin(namespace,context=>Effect.gen(function*(){
      const result=yield* context.runSystem(Effect.gen(function*(){
        const pending=[...context.registry.tables.values()].filter(record=>record.definition.namespace?.id===namespace?.id)
          .flatMap(record=>context.registry.indexesForTablet(record.id)).filter(index=>index.state.type==="Backfilling");
        const first=pending[0];if(first===undefined)return undefined;
        const table=context.registry.tableByTablet(first.tableId)?.definition;
        const byId=table?.indexes.find(candidate=>candidate.name==="by_id");
        if(table===undefined||byId===undefined)return yield* corrupt();
        const retained=pending.filter(index=>bytesEqual(index.tableId,table.tabletId)&&index.state.type==="Backfilling"&&index.state.backfillState.retentionStarted);
        if(retained.length>0){
          for(const index of retained){
            if(index.state.type!=="Backfilling")continue;
            yield* input.retention.validateIndex(index.state.backfillState.indexCreatedLowerBound+1n);
            const indexId=yield* Effect.fromResult(publicDocumentId(context.registry.table(INDEXES)!.definition,index.ref.id));
            yield* context.replaceSystem(INDEXES,indexId,coreIndexMetadataValue({...index,state:{type:"Backfilled2",staged:index.state.backfillState.staged}}));
          }
          return undefined;
        }
        const total=yield* context.count(table.tabletId);
        const records=[];
        for(const index of pending.filter(candidate=>bytesEqual(candidate.tableId,table.tabletId))){
          const indexId=yield* Effect.fromResult(publicDocumentId(context.registry.table(INDEXES)!.definition,index.ref.id));
          const rows=yield* context.querySystem(INDEX_BACKFILLS,"by_index_id",[indexId]);
          if(rows.length>1)return yield* corrupt();
          let row:import("./transaction").CoreSystemDocument|undefined=rows[0];
          if(row===undefined){const id=yield* context.insertSystem(INDEX_BACKFILLS,{indexId,numDocsIndexed:0n,totalDocs:Option.getOrNull(total),cursor:{snapshotTs:context.timestamp,cursor:null}});
            row=Option.getOrUndefined(yield* context.getSystem(INDEX_BACKFILLS,id));}
          if(row===undefined)return yield* corrupt();
          const metadata=yield* Effect.fromResult(Result.mapError(decodeCoreIndexBackfillMetadata(row.value),corrupt));
          records.push({index,row,metadata});
        }
        const key=encodeBytesToLowercaseHex(table.tabletId),ids=indexGroupIdentity(records.map(record=>record.index));
        let walk=backfillWalks.get(key);
        if(walk===undefined||walk.ids!==ids){
          let after:Uint8Array|undefined;
          if(records.every(record=>record.metadata.cursor?.cursor!==null&&record.metadata.cursor?.cursor!==undefined)){
            const keys=[];for(const record of records)keys.push(yield* Effect.fromResult(Result.mapError(coreTableIteratorCursor(record.metadata.cursor!.cursor!),corrupt)));
            keys.sort(compareBytesLexicographically);after=keys[0];
          }
          for(const record of records){
            record.metadata=after===undefined?{...record.metadata,numDocsIndexed:0n,totalDocs:Option.getOrNull(total),cursor:{snapshotTs:context.timestamp,cursor:null}}
              :{...record.metadata,cursor:record.metadata.cursor===null?null:{...record.metadata.cursor,snapshotTs:context.timestamp}};
            yield* context.replaceSystem(INDEX_BACKFILLS,record.row.id,record.metadata);
          }
          const multi=createCoreMultiTableIterator({persistence:input.persistence,snapshotTs:context.timestamp,tables:[table],retention:input.retention,
            budget:{...input.options.schemaWorker,pageSize}});
          walk={tableId:table.tabletId,ids,iterator:multi.table(table,byId,after)};backfillWalks.set(key,walk);
        }
        return {table,records,total:Option.getOrNull(total),key,iterator:walk.iterator};
      }));yield* input.settle(context);return result;
    }));
    if(captured===undefined)return false;
    const page=yield* captured.iterator.nextPage().pipe(Effect.onExit(exit=>Effect.sync(()=>{if(exit._tag==="Failure")backfillWalks.delete(captured.key);})));if(!page.progressed)return true;
    const completed=new Map<string,bigint>();
    const groups=new Map<string,typeof captured.records>();
    for(const record of captured.records){
      const key=record.metadata.cursor?.cursor??"";
      const group=groups.get(key)??[];group.push(record);groups.set(key,group);
    }
    for(const [previous,group]of groups){
      const documents=[];
      for(const entry of page.entries){
        const id=yield* Effect.fromResult(publicDocumentId(captured.table,entry.document.id));
        if(previous===""||id>previous)documents.push(entry.document);
      }
      yield* writeCoreIndexBackfillChunks({persistence:input.persistence,lease:input.lease,table:captured.table,indexes:group.map(record=>record.index),documents,
        chunkDocuments:input.options.schemaWorker.physicalChunkSize,concurrency:input.options.schemaWorker.physicalConcurrency,checkpoint:()=>Effect.void});
      for(const record of group)completed.set(record.metadata.indexId,BigInt(documents.length));
    }
    if(page.done)for(const record of captured.records)yield* input.persistence.reconcileIndexBackfill(input.lease,record.index.ref);
    yield* input.admin(namespace,context=>Effect.gen(function*(){
      yield* context.runSystem(Effect.gen(function*(){
        for(const record of captured.records){
          const live=context.registry.indexById(record.index.ref.id)?.index;
          if(live===undefined||live.state.type!=="Backfilling")continue;
          const rows=yield* context.querySystem(INDEX_BACKFILLS,"by_index_id",[record.metadata.indexId]);
          const row=rows[0];if(row===undefined||row.id!==record.row.id)continue;
          const current=yield* Effect.fromResult(Result.mapError(decodeCoreIndexBackfillMetadata(row.value),corrupt));
          const last=page.entries.at(-1)?.document;
          const cursorText=last===undefined?current.cursor?.cursor??null:yield* Effect.fromResult(publicDocumentId(captured.table,last.id));
          const cursor=cursorText===null?null:(yield* Effect.fromResult(Result.mapError(decodeDocumentId(cursorText),corrupt))).id;
          const monotonicCursor=current.cursor?.cursor===null||current.cursor?.cursor===undefined||cursor===null||cursor>current.cursor.cursor?cursor:current.cursor.cursor;
          const progress=yield* Effect.fromResult(advanceCoreIndexBackfillProgress(current,completed.get(record.metadata.indexId)??0n,monotonicCursor,captured.total));
          yield* context.replaceSystem(INDEX_BACKFILLS,row.id,progress);
          if(page.done){
            yield* context.replaceSystem(INDEXES,record.metadata.indexId,coreIndexMetadataValue({...live,state:{type:"Backfilling",backfillState:{...live.state.backfillState,retentionStarted:true}}}));
          }
        }
      }));yield* input.settle(context);
    }));
    if(page.done)backfillWalks.delete(captured.key);
    return true;
  });
  let lastNamespace:string|undefined;
  const findWork=Effect.fn("CoreSchemaWorker.findWork")(function*(){
    const registry=input.currentRegistry(),namespaces=new Map<string,CoreTableNamespace>();
    for(const table of registry.tables.values())if(table.definition.name===SCHEMAS||registry.indexesForTablet(table.id).some(index=>index.state.type==="Backfilling"))
      namespaces.set(coreNamespaceKey(table.definition.namespace),table.definition.namespace);
    if(namespaces.size>input.options.schemaWorker.maxMetadataEntries)return yield* new CoreTransactionError({reason:"capacity",cause:"Schema worker namespace metadata capacity"});
    const keys=[...namespaces.keys()].toSorted();
    const previousNamespace=lastNamespace;
    const after=previousNamespace===undefined?-1:keys.findIndex(key=>key>previousNamespace);
    const ordered=after<0?keys:[...keys.slice(after),...keys.slice(0,after)];
    for(const key of ordered){
      const namespace=namespaces.get(key);
      if(namespace===undefined)continue;
      const candidate=yield* input.admin(namespace,context=>context.runSystem(Effect.gen(function*(){
        const indexes=[...context.registry.tables.values()].some(table=>coreNamespaceKey(table.definition.namespace)===key
          &&context.registry.indexesForTablet(table.id).some(index=>index.state.type==="Backfilling"));
        const model=new CoreSchemaModel(context),pending=yield* model.pending();
        if(Option.isSome(pending))return {namespace,proposal:{namespace,id:pending.value.id},indexes};
        for(const state of ["validated","active"] as const){
          const selected=yield* model.getByState(state);
          if(Option.isNone(selected)||!selected.value.schema.tables.some(table=>table.stagedDocumentType!==undefined))continue;
          const attempts=yield* model.validations.validationsForSchema(selected.value.id);
          if(attempts.some(attempt=>attempt.metadata.state.state==="pending"))return {namespace,proposal:{namespace,id:selected.value.id},indexes};
        }
        return indexes?{namespace,indexes}:undefined;
      })));
      if(candidate!==undefined)return {key,...candidate};
    }
    return undefined;
  });
  const operation=<A>(effect:Effect.Effect<A,CoreError>)=>worker.withPermits(1)(Effect.gen(function*(){
    if(closed)return yield* new CoreTransactionError({reason:"closed"});
    yield* input.assertOwnerOpen;
    return yield* effect;
  }).pipe(Effect.onExit(exit=>Effect.sync(()=>{if(Exit.isFailure(exit)){validationWalks.clear();backfillWalks.clear();}}))));
  return {
    close:Effect.andThen(Effect.sync(()=>{closed=true;}),worker.withPermits(1)(Effect.sync(()=>{validationWalks.clear();backfillWalks.clear();}))),
    advance:Effect.fn("CoreSchemaWorker.advance")((proposal:CoreSchemaProposal,requested:CoreSchemaWorkBudget)=>operation(Effect.gen(function*(){
      const work=yield* captureWork(requested);
      yield* input.warmCounts({pageSize:work.pageSize,maxPages:1});
      yield* reconcileWalks();
      for(let step=0;step<work.maxPages;step++){
        const validated=yield* validationStep(proposal,work.pageSize);
        const indexed=yield* backfillStep(proposal.namespace,work.pageSize);
        yield* reconcileWalks();
        if(!validated&&!indexed)break;
      }
    }))),
    advanceWork:Effect.fn("CoreSchemaWorker.advanceWork")((requested:CoreSchemaWorkBudget)=>operation(Effect.gen(function*(){
      const work=yield* captureWork(requested);
      yield* input.warmCounts({pageSize:work.pageSize,maxPages:1});
      yield* reconcileWalks();
      for(let step=0;step<work.maxPages;step++){
        const target=yield* findWork();
        if(target===undefined)break;
        if("proposal"in target)yield* validationStep(target.proposal,work.pageSize);
        if(target.indexes)yield* backfillStep(target.namespace,work.pageSize);
        yield* reconcileWalks();
        lastNamespace=target.key;
      }
      return {hasMore:input.countsPending()||(yield* findWork())!==undefined};
    }))),
  };
}
