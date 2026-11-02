import { Effect, Option, Result, Schema } from "effect";
import { decodeCoreApplicationDeployment, type CoreApplicationDeploymentRecord } from "./applicationDeploymentTypes";
import { readActiveCoreApplicationRegistration, readCoreApplicationDeploymentEvidence, trackCoreApplicationPrograms } from "./applicationRegistration";
import { CorePersistenceError } from "./contracts";
import { PROGRAMS, SCHEMAS } from "./registry";
import { CoreSchemaModel } from "./schemaModel";
import { CoreSchemaMetadataSchema } from "./schemaTypes";
import type { CoreTransactionInternals } from "./transaction";

// This decoder exists only for the atomic, one-way startup handoff.
const LegacyApplicationSchema = Schema.Struct({ ...CoreSchemaMetadataSchema.fields,
  applicationRegistration: Schema.optionalKey(Schema.String), applicationCandidate: Schema.optionalKey(Schema.String),
  applicationCandidateUpdatedAt: Schema.optionalKey(Schema.Finite), applicationCandidateAbandoned: Schema.optionalKey(Schema.Boolean) });
const decodeLegacy = Schema.decodeUnknownResult(LegacyApplicationSchema);
const corrupt = (cause?: unknown) => new CorePersistenceError({ reason: "corruptData", ...(cause === undefined ? {} : { cause }) });

/** Runs before serving; both metadata owners and the active pointer settle together. */
export const migrateCoreApplicationDeployments = Effect.fn("CoreApplicationDeployment.migrate")(function* (context: CoreTransactionInternals) {
  yield* Effect.fromResult(trackCoreApplicationPrograms(context));
  const rows = yield* context.querySystem(SCHEMAS, "by_creation_time", []);
  let changed = false;
  for (const row of rows) {
    const legacy = yield* Effect.fromResult(decodeLegacy(row.value).pipe(Result.mapError(corrupt)));
    if (legacy.applicationRegistration === undefined) {
      if (legacy.applicationCandidate !== undefined || legacy.applicationCandidateUpdatedAt !== undefined || legacy.applicationCandidateAbandoned !== undefined)
        return yield* corrupt();
      continue;
    }
    if (legacy.native !== undefined || context.registry.applicationDeployments.has(row.id)) return yield* corrupt();
    const schema = yield* new CoreSchemaModel(context).get(row.id);
    if (Option.isNone(schema)) return yield* corrupt();
    const activated = legacy.state.state === "active", updatedAt = legacy.applicationCandidateUpdatedAt ?? row.creationTime;
    const value = yield* Effect.fromResult(decodeCoreApplicationDeployment({ kind: "applicationDeployment" as const, candidateId: row.id, schemaId: row.id,
      proof: legacy.applicationRegistration, ...(legacy.applicationCandidate === undefined ? {} : { metadata: legacy.applicationCandidate }),
      createdAt: row.creationTime, updatedAt, exclusiveFresh: true,
      state: legacy.applicationCandidateAbandoned ? "abandoned" as const : activated ? "activated" as const : "prepared" as const,
      ...(activated ? { activatedAt: updatedAt } : {}) }).pipe(Result.mapError(corrupt)));
    const record: CoreApplicationDeploymentRecord = { value, id: context.idGenerator.nextInternalId(), ts: null };
    yield* readCoreApplicationDeploymentEvidence(record, schema.value);
    yield* context.insertPrivate(PROGRAMS, record.id, value);
    context.setRegistryAfter(context.registry.withApplicationDeployment(record));
    if (activated) {
      if (context.registry.activeApplication !== undefined) return yield* corrupt();
      const pointer = { id: context.idGenerator.nextInternalId(), candidateId: row.id, ts: null };
      yield* context.insertPrivate(PROGRAMS, pointer.id, { kind: "activeApplication", candidateId: row.id });
      context.setRegistryAfter(context.registry.withActiveApplication(pointer));
    }
    const metadata = { state: legacy.state, schema: legacy.schema, ...(legacy.native === undefined ? {} : { native: legacy.native }) };
    yield* context.replaceSystem(SCHEMAS, row.id, metadata);
    changed = true;
  }
  if (changed) yield* readActiveCoreApplicationRegistration(context, new WeakMap());
  return changed;
});
