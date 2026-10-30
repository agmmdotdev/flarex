import {
  canonicalizeApplicationManifestV1,
  type ApplicationManifestV1,
} from "@flarex/analysis/application-analysis";
import {
  applicationFunctionCatalogPublicationFrameV1,
  applicationFunctionEntryPublicationFrameV1,
  applicationPublicationCommitmentFrameV1,
  applicationSchemaPublicationFrameV1,
} from "@flarex/analysis/internal/application-publication-v1";
import { copyBytesToArrayBuffer, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { Clock, Effect, Exit, Result, Schema, Scope } from "effect";
import { decodeDocumentId, InternalDocumentIdSchema } from "flarex-protocol/document-id";
import { decodeDocumentValue, type DocumentValue } from "flarex-protocol/document-value";
import { canonicalizeApplicationMutationExecutionAuthorityV1 } from "flarex-protocol/internal/application-mutation-authority-v1";
import { canonicalizeApplicationRuntimeTargetV1 } from "flarex-protocol/internal/application-runtime-target-v1";

import { openCoreDatabase } from "../../src/core/database";
import { captureCoreObject } from "../../src/core/document";
import { installCoreApplicationSchema } from "../../src/application/coreSchema";
import type { CoreDatabase, CoreProgramDefinition } from "../../src/core/api";
import { CorePersistenceError, type CorePersistence, type CorePersistenceLease, type CoreWriteBatch } from "../../src/core/contracts";
import type { CorePersistenceFixture } from "../core/fixture";
import {
  createApplicationNativeMutationSourceBundle,
  type ApplicationNativeMutationSourceBundle,
} from "./applicationNativeMutationTestFixture";

const SCOPE_UUID = "45000000-0000-4000-8000-000000000001";
const EPOCH_UUID = "45000000-0000-4000-8000-000000000002";
export const CORE_APPLICATION_COMPATIBILITY_DATE = "2026-06-14";

export interface ApplicationCoreMutationFixture {
  readonly database: CoreDatabase;
  readonly physical: CorePersistenceFixture;
  readonly deploymentId: string;
  readonly source: ApplicationNativeMutationSourceBundle;
  readonly manifest: ApplicationManifestV1;
  readonly programs: readonly CoreProgramDefinition[];
  readonly documentId: string;
  readonly initialTimestamp: bigint;
  readonly reopen: () => Promise<CoreDatabase>;
  readonly history: () => Promise<readonly Readonly<{ timestamp: bigint; deleted: boolean; value: DocumentValue | null }>[]>;
  readonly storageTables: () => Promise<readonly string[]>;
  readonly advanceProgramHead: () => Promise<void>;
  readonly loseNextWriteAcknowledgement: () => void;
  /** Trusted allocator control, armed immediately before the observed insert syscall. */
  readonly useNextInternalId: (id: Uint8Array) => void;
}

/** A fresh installation and explicit owner lifetime; no old migrator or seed SQL. */
export async function withApplicationCoreMutationFixture<A>(
  physical: CorePersistenceFixture,
  work: (fixture: ApplicationCoreMutationFixture) => Promise<A>,
): Promise<A> {
  let scope = await Effect.runPromise(Scope.make());
  const run = <Value, Failure>(effect: Effect.Effect<Value, Failure, Scope.Scope>) =>
    Effect.runPromise(effect.pipe(Scope.provide(scope)));
  let nextInternalId: Uint8Array | undefined;
  const options = {
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
    const source = await createApplicationNativeMutationSourceBundle(false, 0, 0, true, false, false, true);
    const manifest = Result.getOrThrow(canonicalizeApplicationManifestV1({
      format: "flarex.application-manifest", version: 1, sourceArtifact: source.sourceArtifact,
      schema: { version: 1, tables: [{ tableId: 1, name: "users", placement: { kind: "global" },
        validator: { type: "object", value: {
          name: { fieldType: { type: "string" }, optional: false },
          padding: { fieldType: { type: "string" }, optional: true },
        } } }], indexes: [{ indexId: 1, tableId: 1, name: "by_name", fields: ["name"] }] },
      functions: [
        { path: "users:create", moduleName: "users", exportName: "create", kind: "mutation", visibility: "public",
          args: { type: "any" }, returns: null, partition: null },
        { path: "users:createInternal", moduleName: "users", exportName: "createInternal", kind: "mutation", visibility: "internal",
          args: { type: "any" }, returns: null, partition: null },
        { path: "users:get", moduleName: "users", exportName: "get", kind: "query", visibility: "public",
          args: { type: "any" }, returns: { type: "any" }, partition: null },
        { path: "users:getInternal", moduleName: "users", exportName: "getInternal", kind: "query", visibility: "internal",
          args: { type: "any" }, returns: { type: "any" }, partition: null },
        { path: "users:deleteThroughInternal", moduleName: "users", exportName: "deleteThroughInternal", kind: "mutation", visibility: "public",
          args: { type: "any" }, returns: { type: "any" }, partition: null },
        { path: "users:deleteInternal", moduleName: "users", exportName: "deleteInternal", kind: "mutation", visibility: "internal",
          args: { type: "any" }, returns: { type: "any" }, partition: null },
        { path: "users:patchThroughInternal", moduleName: "users", exportName: "patchThroughInternal", kind: "mutation", visibility: "public",
          args: nestedPatchArguments(), returns: { type: "any" }, partition: null },
        { path: "users:patchInternal", moduleName: "users", exportName: "patchInternal", kind: "mutation", visibility: "internal",
          args: nestedPatchArguments(), returns: { type: "any" }, partition: null },
        { path: "users:validationRecovery", moduleName: "users", exportName: "validationRecovery", kind: "mutation", visibility: "public",
          args: { type: "any" }, returns: { type: "any" }, partition: null },
      ].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0),
    })).manifest;
    const programs = await corePrograms(manifest);
    const users = manifest.schema.tables.find(table => table.name === "users");
    if (users === undefined) throw new Error("Core users fixture schema is missing.");
    await run(installCoreApplicationSchema(database, { authorityEpoch: 1n,
      tables: [{ name: "users", number: 10000, tabletId: bytes(0x11), validator: users.validator,
        intrinsicIndexes: { byId: { id: bytes(0x21) }, byCreationTime: { id: bytes(0x22) } },
        indexes: manifest.schema.indexes.map(index => ({
          name: index.name, ref: { id: bytes(0x23) }, fields: index.fields, enabled: true,
        })),
      }], programs }));
    const seed = await run(database.begin());
    const documentId = await run(seed.insert("users", { name: "Ada" }));
    const initialTimestamp = await run(database.commit(await run(seed.finalize())));
    return await work(Object.freeze({ database, physical, deploymentId: "deployment_application_core_mutation",
      source, manifest, programs, documentId, initialTimestamp,
      reopen: async () => {
        await Effect.runPromise(Scope.close(scope, Exit.void));
        scope = await Effect.runPromise(Scope.make());
        currentDatabase = await run(openCoreDatabase(observedPersistence(await physical.reopen()), options));
        return currentDatabase;
      },
      history: async () => {
        const id = Result.getOrThrow(decodeDocumentId(documentId));
        const rows = await physical.query(`SELECT ts::text AS timestamp, deleted, json_value AS value
          FROM "${physical.namespace.replaceAll('"', '""')}".documents
          WHERE instance_name=$1 AND table_id=$2 AND id=$3 ORDER BY ts`, [physical.instanceName, bytes(0x11), id.internalId]);
        return Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ timestamp: Schema.String,
          deleted: Schema.Boolean, value: Schema.Uint8Array })))(rows).map(row => Object.freeze({
            timestamp: BigInt(row.timestamp), deleted: row.deleted,
            value: row.deleted ? null : Result.getOrThrow(decodeDocumentValue(row.value)),
          }));
      },
      storageTables: async () => Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ name: Schema.String })))(
        await physical.query(`SELECT table_name AS name FROM information_schema.tables WHERE table_schema=$1 ORDER BY table_name`,
          [physical.namespace])).map(row => row.name),
      advanceProgramHead: async () => { await run(currentDatabase.install({ tables: [], programs: await corePrograms(manifest, 2) })); },
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

function nestedPatchArguments() {
  return { type: "object", value: {
    id: { fieldType: { type: "id", tableName: "users" }, optional: false },
    fail: { fieldType: { type: "boolean" }, optional: false },
  } } as const;
}

async function corePrograms(manifest: ApplicationManifestV1, generation = 1): Promise<readonly CoreProgramDefinition[]> {
  const canonical = Result.getOrThrow(canonicalizeApplicationManifestV1(manifest));
  const manifestSha256 = await sha256(canonical.canonicalBytes);
  const schemaSha256 = await sha256(Result.getOrThrow(applicationSchemaPublicationFrameV1(manifest)));
  const functionCatalogSha256 = await sha256(Result.getOrThrow(applicationFunctionCatalogPublicationFrameV1(manifest)));
  const frame = { scopeId: `scope_${SCOPE_UUID}`, revisionId: `core_revision_${manifestSha256}`,
    candidateId: `core_candidate_${manifestSha256}`, analysisId: `core_analysis_${manifestSha256}`,
    sourceArtifactRootSha256: manifest.sourceArtifact.rootSha256, manifestSha256, schemaSha256, functionCatalogSha256 };
  const publicationSha256 = await sha256(Result.getOrThrow(applicationPublicationCommitmentFrameV1(frame)));
  const activeHeadSha256 = generation === 1 ? publicationSha256
    : await sha256(new TextEncoder().encode(`head:${generation}:${publicationSha256}`));
  const definitions: CoreProgramDefinition[] = [];
  for (const fn of manifest.functions) {
    if (fn.kind !== "mutation" || fn.visibility !== "public") continue;
    const target = Result.getOrThrow(canonicalizeApplicationRuntimeTargetV1({
      format: "flarex.application-runtime-target", version: 1, ...frame, publicationSha256,
      executionModulePath: manifest.sourceArtifact.executionModulePath,
      function: { ...fn, entrySha256: await sha256(Result.getOrThrow(applicationFunctionEntryPublicationFrameV1(fn))) },
    }));
    const executionAuthority = await Effect.runPromise(canonicalizeApplicationMutationExecutionAuthorityV1({
      format: "flarex.application-mutation-execution-authority", version: 1,
      runtimeTarget: target.target, runtimeTargetSha256: await sha256(target.canonicalBytes),
      activationSequence: generation.toString(), activeHeadSha256, schemaVersionId: `core_schema_${schemaSha256}`,
    }));
    definitions.push(Object.freeze({ identity: { functionPath: fn.path,
      programHash: encodeBytesToLowercaseHex(executionAuthority.sha256), schemaHash: schemaSha256 },
      metadata: Result.getOrThrow(captureCoreObject({ executionAuthority: executionAuthority.authority,
        manifest, compatibilityDate: CORE_APPLICATION_COMPATIBILITY_DATE, scopeUuid: SCOPE_UUID,
        epochUuid: EPOCH_UUID }, true)).value,
    }));
  }
  return Object.freeze(definitions);
}

function bytes(value: number): Uint8Array { return new Uint8Array(16).fill(value); }
async function sha256(value: Uint8Array): Promise<string> {
  return encodeBytesToLowercaseHex(new Uint8Array(await crypto.subtle.digest("SHA-256", copyBytesToArrayBuffer(value))));
}
