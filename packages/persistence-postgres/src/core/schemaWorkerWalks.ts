/** Volatile walk lifetimes owned by CoreSchemaWorker; durable metadata owns readiness. */
import type { ValidatorJsonV1 } from "flarex-protocol/validator-json";
import type { CoreTableNamespace } from "./namespace";
import type { createCoreLatestTableIterator, CoreTableIterator } from "./tableIterator";

export interface CoreSchemaValidationWalk {
  readonly namespace:CoreTableNamespace;
  readonly schemaId:string;
  readonly iterator:ReturnType<typeof createCoreLatestTableIterator>;
  readonly validator:ValidatorJsonV1;
  readonly tableName:string;
  readonly hash:string|undefined;
}
export interface CoreSchemaBackfillWalk {
  readonly tableId:Uint8Array;
  readonly ids:string;
  readonly iterator:CoreTableIterator;
}

/** Release abandoned iterator bodies while preserving the cursor of every live walk. */
export function pruneCoreSchemaWorkerWalks(validationWalks:Map<string,CoreSchemaValidationWalk>,backfillWalks:Map<string,CoreSchemaBackfillWalk>,
  liveAttempts:ReadonlySet<string>,liveIndexGroups:ReadonlyMap<string,string>):void {
  for(const id of validationWalks.keys())if(!liveAttempts.has(id))validationWalks.delete(id);
  for(const [tablet,walk]of backfillWalks)if(liveIndexGroups.get(tablet)!==walk.ids)backfillWalks.delete(tablet);
}
