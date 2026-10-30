import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { encodeDocumentId } from "flarex-protocol/document-id";
import type { CoreTableDefinition } from "../../src/core/api";
import { initialRegistry } from "../../src/core/registry";
import { CoreFinalizationVault, createCoreTransaction } from "../../src/core/transaction";

const id=(value:number)=>{const bytes=new Uint8Array(16);new DataView(bytes.buffer).setUint32(12,value);return bytes;};

describe("source user table namespace limit",()=>{
  it("counts active user tables across namespaces and refuses before creation as a developer error",async()=>{
    const component=Result.getOrThrow(encodeDocumentId(700,id(700)));
    const definitions:CoreTableDefinition[]=[
      {name:"_tables",number:513,tabletId:id(1),namespace:null,state:"active",indexes:[{name:"by_id",ref:{id:id(3)},fields:[]}]},
      {name:"_index",number:514,tabletId:id(2),namespace:null,state:"active",indexes:[{name:"by_id",ref:{id:id(4)},fields:[]}]},
    ];
    for(let offset=0;offset<10000;offset++)definitions.push({name:`table${offset}`,number:10001+offset,tabletId:id(100+offset),
      namespace:offset===9999?{kind:"byComponent",id:component}:null,state:"active",indexes:[
        {name:"by_id",ref:{id:id(20000+offset)},fields:[]},
        {name:"by_creation_time",ref:{id:id(40000+offset)},fields:["_creationTime"]},
      ]});
    const registry=Result.getOrThrow(initialRegistry(definitions));
    await Effect.runPromise(Effect.gen(function*(){
      const transaction=createCoreTransaction({registry,now:1_000_000_000n,vault:new CoreFinalizationVault(),
        newInternalId:Effect.die(new Error("Table cap must refuse before allocating an identity")),
        snapshot:{timestamp:0n,get:()=>Effect.die(new Error("Table cap must use captured metadata")),scan:()=>Effect.die(new Error("Table cap must use captured metadata"))}});
      const result=yield* Effect.result(transaction.transaction.insert("overflow",{}));
      expect(Result.isFailure(result)&&result.failure).toMatchObject({reason:"tooManyTables",cause:{limit:10000}});
      expect((yield* transaction.transaction.tableMappings)).toHaveLength(9999);
      expect((yield* transaction.transaction.usage).system.documentsWritten).toBe(0);
      expect((yield* transaction.transaction.usage).user.documentsWritten).toBe(0);
      yield* transaction.transaction.abort();
    }));
  });
});
