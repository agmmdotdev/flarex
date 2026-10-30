import { randomBytes } from "node:crypto";
import { Deferred, Effect, Fiber, Result } from "effect";
import { describe, expect, it, vi } from "vitest";
import { encodeDocumentId } from "flarex-protocol/document-id";
import * as workerWalks from "../../src/core/schemaWorkerWalks";
import { openCoreDatabase } from "../../src/core/database";
import type { CorePersistence } from "../../src/core/contracts";
import type { CorePersistenceFixture, CorePersistenceFixtureOptions } from "./fixture";
import { activateCoreSchema, CORE_SCHEMA_WORKER_TEST_OPTIONS } from "./schemaFixture";
import { loadBootstrapRegistry } from "../../src/core/bootstrap";
import { loadCoreRegistry } from "../../src/core/registry";
import type { CoreDatabase, CoreSchemaProposal } from "../../src/core/api";

const options={now:Effect.succeed(1_000_000_000n),newInternalId:Effect.sync(()=>randomBytes(16)),schemaWorker:CORE_SCHEMA_WORKER_TEST_OPTIONS};
const idle=Effect.fn("CoreSchemaWorkerFixture.idle")(function*(database:CoreDatabase){
  for(let step=0;step<512;step++)if(!(yield* database.advanceSchemaWork({pageSize:2,maxPages:2})).hasMore)return;
  return yield* Effect.die(new Error("Bounded schema maintenance did not reach idle"));
});
const registryFor=Effect.fn("CoreSchemaWorkerFixture.registry")(function*(persistence:CorePersistence,database:CoreDatabase){
  const snapshot=yield* persistence.readSnapshot(yield* database.publishedTimestamp);
  return yield* loadCoreRegistry(snapshot,yield* loadBootstrapRegistry(persistence,snapshot));
});

export function registerCoreSchemaWorkerScenarios(label:string,createFixture:(options?:CorePersistenceFixtureOptions)=>Promise<CorePersistenceFixture>):void {
  describe(label,()=>{
    it("reconstructs active staged index work after a cold reopen and enables only on explicit activation",async()=>{
      const fixture=await createFixture();
      try{await Effect.runPromise(Effect.scoped(Effect.gen(function*(){
        const database=yield* openCoreDatabase(fixture.persistence,options);
        const table={tableName:"items",documentType:{type:"any"},indexes:[],stagedDbIndexes:[]};
        yield* activateCoreSchema(database,{tables:[table],schemaValidation:true});
        const seed=yield* database.begin();
        for(let value=0;value<5;value++)yield* seed.insert("items",{value});
        yield* database.commit(yield* seed.finalize());
        const declaration={indexDescriptor:"by_background",fields:["value","_creationTime"]};
        const proposal=yield* database.prepareSchema({schema:{tables:[{...table,stagedDbIndexes:[declaration]}],schemaValidation:true}});
        yield* database.advanceSchema(proposal,{pageSize:1,maxPages:1});
        yield* database.activateSchema(proposal,{programs:[]});
        const before=yield* registryFor(fixture.persistence,database);
        const tablet=before.table("items")?.id;
        expect(tablet).toBeDefined();
        const pending=before.indexesForTablet(tablet??new Uint8Array()).find(index=>index.name==="by_background");
        expect(pending?.state).toMatchObject({type:"Backfilling"});
        yield* database.close();
        const persistence=yield* Effect.promise(()=>fixture.reopen());
        const reopened=yield* openCoreDatabase(persistence,options);
        yield* idle(reopened);
        const after=yield* registryFor(persistence,reopened);
        const built=after.indexesForTablet(tablet??new Uint8Array()).find(index=>index.name==="by_background");
        expect(built?.ref.id).toEqual(pending?.ref.id);
        expect(built?.state).toEqual({type:"Backfilled2",staged:true});
        const read=yield* reopened.begin();
        const unavailable=yield* Effect.result(read.startQuery({query:{source:{type:"IndexRange",indexName:"items.by_background",range:[],order:"asc"},operators:[]}}));
        expect(Result.isFailure(unavailable)&&unavailable.failure).toMatchObject({_tag:"CoreQueryInputError",cause:{reason:"indexUnavailable"}});
        yield* read.abort();
        yield* activateCoreSchema(reopened,{tables:[{...table,indexes:[declaration]}],schemaValidation:true});
        const enabled=yield* reopened.begin();
        expect(yield* enabled.scan("items","by_background")).toHaveLength(5);
        yield* enabled.abort();
      })));}finally{await fixture.close();}
    },60_000);

    it("finishes orphan pending index metadata after its schema proposal fails",async()=>{
      const fixture=await createFixture();
      try{await Effect.runPromise(Effect.scoped(Effect.gen(function*(){
        const database=yield* openCoreDatabase(fixture.persistence,options);
        const table={tableName:"items",documentType:{type:"any"},indexes:[],stagedDbIndexes:[]};
        yield* activateCoreSchema(database,{tables:[table],schemaValidation:true});
        const seed=yield* database.begin();yield* seed.insert("items",{value:"existing"});yield* database.commit(yield* seed.finalize());
        const proposal=yield* database.prepareSchema({schema:{tables:[{...table,documentType:{type:"object",value:{value:{fieldType:{type:"number"},optional:false}}},
          indexes:[{indexDescriptor:"by_orphan",fields:["value","_creationTime"]}]}],schemaValidation:true}});
        const write=yield* database.begin();yield* write.insert("items",{value:"violates proposed number"});yield* database.commit(yield* write.finalize());
        expect((yield* database.schemaStatus(proposal)).state).toBe("failed");
        yield* idle(database);
        const registry=yield* registryFor(fixture.persistence,database),tablet=registry.table("items")?.id;
        const orphan=registry.indexesForTablet(tablet??new Uint8Array()).find(index=>index.name==="by_orphan");
        expect(orphan?.state).toEqual({type:"Backfilled2",staged:false});
        const transaction=yield* database.begin();
        expect(yield* transaction.scan("items","by_id")).toHaveLength(2);
        const refusal=yield* Effect.result(transaction.startQuery({query:{source:{type:"IndexRange",indexName:"items.by_orphan",range:[],order:"asc"},operators:[]}}));
        expect(Result.isFailure(refusal)&&refusal.failure).toMatchObject({_tag:"CoreQueryInputError",cause:{reason:"indexUnavailable"}});
        yield* transaction.abort();
      })));}finally{await fixture.close();}
    },60_000);

    it("releases overwritten validation walks and preserves the cursor of the live attempt",async()=>{
      const fixture=await createFixture(),pruning=vi.spyOn(workerWalks,"pruneCoreSchemaWorkerWalks");
      try{await Effect.runPromise(Effect.scoped(Effect.gen(function*(){
        const database=yield* openCoreDatabase(fixture.persistence,options);
        const table={tableName:"items",documentType:{type:"any"},indexes:[],stagedDbIndexes:[]};
        yield* activateCoreSchema(database,{tables:[table],schemaValidation:true});
        const seed=yield* database.begin();
        for(let value=0;value<8;value++)yield* seed.insert("items",{value});
        yield* database.commit(yield* seed.finalize());
        let previous:CoreSchemaProposal|undefined;
        for(let replacement=0;replacement<3;replacement++){
          const proposal=yield* database.prepareSchema({schema:{tables:[{...table,documentType:{type:"object",value:{
            value:{fieldType:{type:"number"},optional:false},["optional"+replacement]:{fieldType:{type:"string"},optional:true},
          }}}],schemaValidation:true}});
          yield* database.advanceSchema(proposal,{pageSize:1,maxPages:1});
          if(previous!==undefined)expect((yield* database.schemaStatus(previous)).state).toBe("overwritten");
          const retained=pruning.mock.calls.at(-1)?.[0];
          expect(retained?.size).toBe(1);
          expect([...retained?.values()??[]].map(walk=>walk.schemaId)).toEqual([proposal.id]);
          previous=proposal;
        }
        const retained=pruning.mock.calls.at(-1)?.[0],walk=retained?.values().next().value;
        expect(walk).toBeDefined();
        if(previous===undefined)return yield* Effect.die(new Error("Expected a pending proposal"));
        yield* database.advanceSchema(previous,{pageSize:1,maxPages:1});
        expect(retained?.values().next().value).toBe(walk);
        // Returning to the existing active schema abandons the last pending attempt.
        yield* database.prepareSchema({schema:{tables:[table],schemaValidation:true}});
        yield* database.advanceSchemaWork({pageSize:1,maxPages:1});
        expect(pruning.mock.calls.at(-1)?.[0].size).toBe(0);
      })));}finally{pruning.mockRestore();await fixture.close();}
    },60_000);

    it("releases removed backfill groups across namespaces and preserves a live group's cursor",async()=>{
      const fixture=await createFixture(),pruning=vi.spyOn(workerWalks,"pruneCoreSchemaWorkerWalks");
      try{await Effect.runPromise(Effect.scoped(Effect.gen(function*(){
        const database=yield* openCoreDatabase(fixture.persistence,options);
        const table={tableName:"items",documentType:{type:"any"},indexes:[],stagedDbIndexes:[]};
        const schema={tables:[table],schemaValidation:true};
        const namespace={kind:"byComponent" as const,id:yield* Effect.fromResult(encodeDocumentId(10001,new Uint8Array(16)))};
        yield* activateCoreSchema(database,schema);
        yield* activateCoreSchema(database,schema,{namespace,programs:[]});
        for(const selectedNamespace of [null,namespace]){
          const seed=yield* database.begin({namespace:selectedNamespace});
          for(let value=0;value<8;value++)yield* seed.insert("items",{value});
          yield* database.commit(yield* seed.finalize());
        }
        const staged={tables:[{...table,stagedDbIndexes:[{indexDescriptor:"by_pending",fields:["value","_creationTime"]}]}],schemaValidation:true};
        const first=yield* database.prepareSchema({schema:staged});
        yield* database.advanceSchema(first,{pageSize:1,maxPages:1});
        yield* database.activateSchema(first,{programs:[]});
        const retained=pruning.mock.calls.at(-1)?.[1],firstKey=retained?.keys().next().value;
        expect(retained?.size).toBe(1);
        const removeFirst=yield* database.prepareSchema({schema});
        yield* database.advanceSchema(removeFirst,{pageSize:1,maxPages:1});
        yield* database.activateSchema(removeFirst,{programs:[]});
        const second=yield* database.prepareSchema({namespace,schema:staged});
        yield* database.advanceSchema(second,{pageSize:1,maxPages:1});
        yield* database.activateSchema(second,{namespace,programs:[]});
        expect(retained?.size).toBe(1);
        expect(firstKey===undefined?undefined:retained?.has(firstKey)).toBe(false);
        const secondWalk=retained?.values().next().value;
        yield* database.advanceSchemaWork({pageSize:1,maxPages:1});
        expect(retained?.values().next().value).toBe(secondWalk);
        const removeSecond=yield* database.prepareSchema({namespace,schema});
        yield* database.advanceSchema(removeSecond,{pageSize:1,maxPages:1});
        yield* database.activateSchema(removeSecond,{namespace,programs:[]});
        yield* database.advanceSchemaWork({pageSize:1,maxPages:1});
        expect(retained?.size).toBe(0);
      })));}finally{pruning.mockRestore();await fixture.close();}
    },60_000);

    it("drains bounded physical worker work before close returns and rejects later maintenance",async()=>{
      const fixture=await createFixture();
      try {await Effect.runPromise(Effect.scoped(Effect.gen(function*(){
        const started=yield* Deferred.make<void>(),release=yield* Deferred.make<void>(),closed=yield* Deferred.make<void>();
        let pause=false,physicalCalls=0;
        const persistence:CorePersistence={...fixture.persistence,writeIndexBackfill:(lease,indexes)=>Effect.gen(function*(){
          physicalCalls++;
          if(pause){yield* Deferred.succeed(started,undefined);yield* Deferred.await(release);}
          yield* fixture.persistence.writeIndexBackfill(lease,indexes);
        })};
        const database=yield* openCoreDatabase(persistence,{now:Effect.succeed(1_000_000_000n),newInternalId:Effect.sync(()=>randomBytes(16)),schemaWorker:CORE_SCHEMA_WORKER_TEST_OPTIONS});
        const table={tableName:"items",documentType:{type:"any"},indexes:[],stagedDbIndexes:[]};
        yield* activateCoreSchema(database,{tables:[table],schemaValidation:true});
        const seed=yield* database.begin();
        yield* seed.insert("items",{value:"one"});
        yield* database.commit(yield* seed.finalize());
        const proposal=yield* database.prepareSchema({schema:{tables:[{...table,indexes:[{indexDescriptor:"by_value",fields:["value","_creationTime"]}]}],schemaValidation:true}});
        pause=true;
        const advancing=yield* Effect.forkChild(database.advanceSchema(proposal,{pageSize:4,maxPages:4}));
        yield* Deferred.await(started);
        const closing=yield* Effect.forkChild(database.close().pipe(Effect.tap(()=>Deferred.succeed(closed,undefined))));
        yield* Effect.yieldNow;
        expect(yield* Deferred.isDone(closed)).toBe(false);
        yield* Deferred.succeed(release,undefined);
        yield* Fiber.join(closing);
        const interrupted=yield* Effect.result(Fiber.join(advancing));
        expect(Result.isFailure(interrupted)&&interrupted.failure).toMatchObject({reason:"closed"});
        expect(physicalCalls).toBe(1);
        const later=yield* Effect.result(database.advanceSchema(proposal,{pageSize:4,maxPages:4}));
        expect(Result.isFailure(later)&&later.failure).toMatchObject({reason:"closed"});
        expect(physicalCalls).toBe(1);
      })));}finally{await fixture.close();}
    },30_000);
  });
}
