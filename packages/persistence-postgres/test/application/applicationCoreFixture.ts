import type { ApplicationManifestV1 } from "@flarex/analysis/application-analysis";
import { copyBytesToArrayBuffer } from "@flarex/utils/bytes";
import { Clock, Effect, Exit, Result, Schema, Scope } from "effect";
import { decodeDocumentId, InternalDocumentIdSchema } from "flarex-protocol/document-id";
import { decodeDocumentValue, type DocumentValue } from "flarex-protocol/document-value";
import { createQueryCursorBroker, type QueryCursorBroker } from "flarex-protocol/query-cursor";

import { openCoreDatabase } from "../../src/core/database";
import { compileCoreApplicationSchema } from "../../src/application/coreSchema";
import { makeCoreApplicationPrograms } from "../../src/application/coreProgram";
import type { CoreDatabase, CoreProgramDefinition } from "../../src/core/api";
import { CorePersistenceError, type CorePersistence, type CorePersistenceLease, type CoreWriteBatch } from "../../src/core/contracts";
import type { CorePersistenceFixture } from "../core/fixture";
import { CORE_SCHEMA_WORKER_TEST_OPTIONS } from "../core/schemaFixture";
import type { ApplicationNativeMutationSourceBundle } from "./applicationNativeMutationTestFixture";

export const CORE_APPLICATION_SCOPE_UUID = "45000000-0000-4000-8000-000000000001";
export const CORE_APPLICATION_EPOCH_UUID = "45000000-0000-4000-8000-000000000002";
export const CORE_APPLICATION_COMPATIBILITY_DATE = "2026-06-14";

/** Relation-free V1 output of the actual cold Analysis host, supplied by the consumer. */
export interface ApplicationCoreDefinition {
  readonly source: ApplicationNativeMutationSourceBundle;
  readonly manifest: ApplicationManifestV1;
  readonly coldAnalysisLoads: number;
}

export interface ApplicationCoreFixture {
  readonly database: CoreDatabase;
  /** Trusted test resource acquisition, tied to the current owner lifetime. */
  readonly runInOwnerScope: <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) => Promise<A>;
  readonly physical: CorePersistenceFixture;
  readonly deploymentId: string;
  readonly source: ApplicationNativeMutationSourceBundle;
  readonly manifest: ApplicationManifestV1;
  readonly coldAnalysisLoads: number;
  readonly queryCursor: Readonly<{ scopeUuid: string; broker: QueryCursorBroker }>;
  readonly programs: readonly CoreProgramDefinition[];
  readonly documentId: string;
  readonly initialTimestamp: bigint;
  readonly reopen: () => Promise<CoreDatabase>;
  /** Host maintenance barrier; leaves the owned physical target intact. */
  readonly closeOwner: () => Promise<void>;
  /** Historical persistence remains testable below normal retained-snapshot admission. */
  readonly initialPhysicalState: () => Promise<Readonly<{ document: DocumentValue | null; indexed: readonly DocumentValue[] }>>;
  readonly history: () => Promise<readonly Readonly<{ timestamp: bigint; deleted: boolean; value: DocumentValue | null }>[]>;
  readonly storageTables: () => Promise<readonly string[]>;
  readonly durableState: () => Promise<readonly Readonly<{ table: string; count: string }>[]>;
  readonly advanceProgramHead: () => Promise<void>;
  readonly loseNextWriteAcknowledgement: () => void;
  /** Trusted allocator control, armed immediately before the observed insert syscall. */
  readonly useNextInternalId: (id: Uint8Array) => void;
}

/** A fresh installation and explicit owner lifetime; no old migrator or seed SQL. */
export async function withApplicationCoreFixture<A>(
  physical: CorePersistenceFixture,
  definition: ApplicationCoreDefinition,
  work: (fixture: ApplicationCoreFixture) => Promise<A>,
): Promise<A> {
  let scope = await Effect.runPromise(Scope.make());
  const run = <Value, Failure>(effect: Effect.Effect<Value, Failure, Scope.Scope>) =>
    Effect.runPromise(effect.pipe(Scope.provide(scope)));
  let nextInternalId: Uint8Array | undefined;
  const options = {
    schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS,
    now: Clock.currentTimeMillis.pipe(Effect.map(value => BigInt(Math.floor(value)) * 1_000_000n)),
    newInternalId: Effect.sync(() => {
      const selected = nextInternalId;
      nextInternalId = undefined;
      return selected ?? crypto.getRandomValues(new Uint8Array(16));
    }),
    maxConcurrentSaves: 1,
  } as const;
  let failure: unknown;
  let failed = false;
  let loseNextAcknowledgement = false;
  const observedPersistence = (persistence: CorePersistence): CorePersistence => Object.freeze({ ...persistence,
    write: (lease: CorePersistenceLease, batch: CoreWriteBatch) => persistence.write(lease, batch).pipe(Effect.andThen(() => {
      if (!loseNextAcknowledgement) return Effect.void;
      loseNextAcknowledgement = false;
      // Transport-only fault: the actual atomic write completed, but its
      // caller cannot establish that outcome from the acknowledgement.
      return Effect.fail(new CorePersistenceError({ reason: "uncertainWrite" }));
    })),
  });
  try {
    const database = await run(openCoreDatabase(observedPersistence(physical.persistence), options));
    let currentDatabase = database;
    const { source, manifest } = definition;
    // Explicit stable fixture-only secret: reuse the broker through cold reopen.
    // The broker and secret are never part of source, manifest, grants or arguments.
    const queryCursor = Object.freeze({ scopeUuid: CORE_APPLICATION_SCOPE_UUID,
      broker: Result.getOrThrow(createQueryCursorBroker({ instanceName: CORE_APPLICATION_SCOPE_UUID,
        deploymentSecret: Uint8Array.from({ length: 32 }, (_, index) => index + 1) })),
    });
    const producePrograms = (generation = 1) => run(makeCoreApplicationPrograms({ manifest,
      scopeUuid: CORE_APPLICATION_SCOPE_UUID, epochUuid: CORE_APPLICATION_EPOCH_UUID,
      compatibilityDate: CORE_APPLICATION_COMPATIBILITY_DATE, generation,
      sha256: value => Effect.promise(async () => new Uint8Array(await crypto.subtle.digest("SHA-256", copyBytesToArrayBuffer(value)))),
    }));
    const programs = await producePrograms();
    const users = manifest.schema.tables.find(table => table.name === "users");
    if (users === undefined) throw new Error("Core users fixture schema is missing.");
    const schema = Result.getOrThrow(compileCoreApplicationSchema(manifest));
    const proposal = await run(database.prepareSchema({ schema }));
    let status = await run(database.schemaStatus(proposal));
    while (status.state === "pending" || !status.indexesReady) {
      if (status.state === "failed" || status.state === "overwritten") throw new Error("Application fixture schema failed: " + status.error);
      status = await run(database.advanceSchema(proposal, { pageSize: 128, maxPages: 8 }));
    }
    const activated = await run(database.activateSchema(proposal, { programs, authorityEpoch: 1n }));
    const userTable = activated.tables.find(table => table.name === "users");
    const nameIndex = userTable?.indexes.find(index => index.name === "by_name");
    if (userTable === undefined || nameIndex === undefined) throw new Error("Application fixture activation is missing user bindings.");
    const seed = await run(database.begin());
    const documentId = await run(seed.insert("users", { name: "Ada" }));
    const initialTimestamp = await run(database.commit(await run(seed.finalize())));
    return await work(Object.freeze({ database, runInOwnerScope: run, physical, deploymentId: "deployment_application_core_mutation",
      source, manifest, programs, documentId, initialTimestamp, queryCursor, coldAnalysisLoads: definition.coldAnalysisLoads,
      reopen: async () => {
        await Effect.runPromise(Scope.close(scope, Exit.void));
        scope = await Effect.runPromise(Scope.make());
        currentDatabase = await run(openCoreDatabase(observedPersistence(await physical.reopen()), options));
        return currentDatabase;
      },
      closeOwner: () => Effect.runPromise(Scope.close(scope, Exit.void)),
      initialPhysicalState: async () => {
        const selected = await run(physical.persistence.readSnapshot(initialTimestamp));
        const internalId = Result.getOrThrow(decodeDocumentId(documentId)).internalId;
        const point = await run(selected.get(userTable.tabletId, internalId));
        const indexed = await run(selected.scan({ index: nameIndex.ref, tableId: userTable.tabletId,
          interval: { start: null, end: null }, order: "asc", maxResults: 128 }));
        const document = point._tag === "Some" && !point.value.deleted
          ? Result.getOrThrow(decodeDocumentValue(point.value.jsonValue)) : null;
        return { document, indexed: indexed.entries.map(entry => Result.getOrThrow(decodeDocumentValue(entry.document.jsonValue))) };
      },
      history: async () => {
        const id = Result.getOrThrow(decodeDocumentId(documentId));
        const rows = await physical.query(`SELECT ts::text AS timestamp, deleted, json_value AS value
          FROM "${physical.namespace.replaceAll('"', '""')}".documents
          WHERE instance_name=$1 AND table_id=$2 AND id=$3 ORDER BY ts`, [physical.instanceName, userTable.tabletId, id.internalId]);
        return Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ timestamp: Schema.String,
          deleted: Schema.Boolean, value: Schema.Uint8Array })))(rows).map(row => Object.freeze({
            timestamp: BigInt(row.timestamp), deleted: row.deleted,
            value: row.deleted ? null : Result.getOrThrow(decodeDocumentValue(row.value)),
          }));
      },
      storageTables: async () => Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ name: Schema.String })))(
        await physical.query(`SELECT table_name AS name FROM information_schema.tables WHERE table_schema=$1 ORDER BY table_name`,
          [physical.namespace])).map(row => row.name),
      durableState: async () => {
        const rows = [];
        for (const table of ["documents", "indexes", "persistence_globals"]) {
          const result = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ count: Schema.String })))(
            await physical.query(`SELECT count(*)::text AS count FROM "${physical.namespace.replaceAll('"', '""')}".${table}`));
          const count = result[0]?.count;
          if (count === undefined) throw new Error("Core durable observation is missing a count.");
          rows.push(Object.freeze({ table, count }));
        }
        return Object.freeze(rows);
      },
      advanceProgramHead: async () => { await run(currentDatabase.publishPrograms({ programs: await producePrograms(2) })); },
      loseNextWriteAcknowledgement: () => { loseNextAcknowledgement = true; },
      useNextInternalId: (id: Uint8Array) => {
        if (nextInternalId !== undefined) throw new Error("Fixture internal ID is already armed.");
        nextInternalId = Schema.decodeUnknownSync(InternalDocumentIdSchema)(id).slice();
      },
    }));
  } catch (cause) {
    failed = true;
    failure = cause;
    throw cause;
  } finally {
    const cleanup = await Promise.allSettled([
      Effect.runPromise(Scope.close(scope, Exit.void)),
    ]);
    // Close the actual SQL resources only after all engine fibers have joined.
    cleanup.push(...await Promise.allSettled([physical.close()]));
    const errors = cleanup.flatMap(result => result.status === "rejected" ? [result.reason] : []);
    if (errors.length > 0) throw new AggregateError(failed ? [failure, ...errors] : errors,
      "Application core fixture owner cleanup failed");
  }
}
