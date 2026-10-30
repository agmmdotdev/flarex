import { randomBytes } from "node:crypto";
import { Cause, Effect, Exit } from "effect";
import { expect, it } from "vitest";
import { openCoreDatabase } from "../../src/core/database";
import { CorePersistenceError, type CorePersistence } from "../../src/core/contracts";
import { createCorePGliteFixture } from "./fixture";
import { CORE_SCHEMA_WORKER_TEST_OPTIONS } from "./schemaFixture";

it("preserves every cause reason when a request claim's save fails",async()=>{
  const fixture=await createCorePGliteFixture();
  try{await Effect.runPromise(Effect.scoped(Effect.gen(function*(){
    let failSave=false;
    const unavailable=new CorePersistenceError({reason:"unavailable"}),defect=new Error("claim save defect");
    const failure=Cause.fromReasons([Cause.makeFailReason(unavailable),Cause.makeDieReason(defect),Cause.makeInterruptReason(42)]);
    const persistence:CorePersistence={...fixture.persistence,write:(lease,batch)=>failSave?Effect.failCause(failure):fixture.persistence.write(lease,batch)};
    const database=yield* openCoreDatabase(persistence,{now:Effect.succeed(1_000_000_000n),newInternalId:Effect.sync(()=>randomBytes(16)),
      schemaWorker:CORE_SCHEMA_WORKER_TEST_OPTIONS});
    const program={functionPath:"items:claim",programHash:"claim-program",schemaHash:"claim-schema"};
    yield* database.publishPrograms({programs:[{identity:program,metadata:{}}]});
    failSave=true;
    const claimed=yield* Effect.exit(database.claimRequest({key:"failed-claim",requestHash:"request-hash",program}));
    expect(Exit.isFailure(claimed)).toBe(true);
    if(Exit.isFailure(claimed)){
      const reasons=claimed.cause.reasons;
      expect(reasons).toHaveLength(3);
      expect(reasons.map(reason=>reason._tag)).toEqual(["Fail","Die","Interrupt"]);
      const [failed,died,interrupted]=reasons;
      expect(failed!==undefined&&Cause.isFailReason(failed)&&failed.error).toBe(unavailable);
      expect(died!==undefined&&Cause.isDieReason(died)&&died.defect).toBe(defect);
      expect(interrupted!==undefined&&Cause.isInterruptReason(interrupted)&&interrupted.fiberId).toBe(42);
    }
  })));}finally{await fixture.close();}
},30_000);
