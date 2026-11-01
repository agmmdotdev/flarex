import { Effect } from "effect";
import type { CoreDatabase, CoreProgramPublication } from "../../src/core/api";

/** Explicit fixture allocation; this is not a production DO capacity setting. */
export const CORE_SCHEMA_WORKER_TEST_OPTIONS = Object.freeze({
  documentBytes: 1024 * 1024,
  documentCount: 8,
  maxMetadataEntries: 4096,
  logPageSize: 16,
  maxLogPagesPerStep: 1,
  physicalChunkSize: 8,
  physicalConcurrency: 2,
});

/** Test composition over the real lifecycle; no fixture-owned build/readiness logic. */
export const activateCoreSchema = Effect.fn("CoreSchemaFixture.activate")(function* (
  database: CoreDatabase,
  schema: Parameters<CoreDatabase["prepareSchema"]>[0]["schema"],
  publication: CoreProgramPublication = { programs: [] },
) {
  const proposal = yield* database.prepareSchema({ schema,
    ...(publication.applicationRegistration === undefined ? {} : { applicationRegistration: publication.applicationRegistration }),
    ...(publication.namespace === undefined ? {} : { namespace: publication.namespace }) });
  for (let step = 0; step < 512; step++) {
    const status = yield* database.schemaStatus(proposal);
    if (status.state === "failed" || status.state === "overwritten"
      || ((status.state === "validated" || status.state === "active") && status.indexesReady))
      return yield* database.activateSchema(proposal, publication);
    yield* database.advanceSchema(proposal, { pageSize: 32, maxPages: 16 });
  }
  return yield* Effect.die(new Error("Schema fixture did not become ready within its bounded work allowance."));
});
