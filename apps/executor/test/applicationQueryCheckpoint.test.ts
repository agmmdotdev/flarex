import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Deferred, Effect, Fiber, Result, Schema, Scope } from "effect";
import { describe, expect, it } from "vitest";
import type { CoreApplicationRegistration, CoreDatabase, CoreDatabaseOptions } from "@flarex/persistence-postgres/internal/core";
import { createCorePGliteFixture, createCorePostgresFixture, type CorePersistenceFixture } from "@flarex/persistence-postgres/internal/system-test/core-persistence-fixture";
import { openCoreDatabase } from "../../../packages/persistence-postgres/src/core/database";
import { activateApplication } from "../../../packages/persistence-postgres/test/core/applicationDeploymentFixture";
import { CORE_SCHEMA_WORKER_TEST_OPTIONS } from "../../../packages/persistence-postgres/test/core/schemaFixture";
import type { CoreQueryCheckpointRequest } from "flarex-protocol/internal/core-query-checkpoint";
import { readExecutorApplicationCheckpoint } from "../src/applicationQueryCheckpoint";
import { executorApplicationSha256 } from "../src/applicationComposition";
import { resolveExecutorApplicationProfile } from "../src/applicationConfiguration";
import { executorApplicationProfileFixture } from "./support/executorApplicationConfiguration";

const endpointPath = process.env.FLAREX_CORE_POSTGRES_ENDPOINTS_FILE;
const endpoints = endpointPath === undefined ? undefined : Schema.decodeUnknownSync(Schema.Struct({
  connectionString: Schema.NonEmptyString, provisioningConnectionString: Schema.NonEmptyString,
}))(JSON.parse(await readFile(endpointPath, "utf8")));
const schema = { schemaValidation: true, tables: [{ tableName: "items", documentType: { type: "any" }, indexes: [], stagedDbIndexes: [] }] };
const base = executorApplicationProfileFixture();
const profile = Result.getOrThrow(resolveExecutorApplicationProfile({
  FLAREX_APPLICATION_PROFILES: JSON.stringify({ version: 1, profiles: [base] }),
}, base.deploymentId));
const frame: CoreApplicationRegistration = {
  deploymentId: profile.deploymentId, scopeUuid: profile.scopeUuid, epochUuid: profile.epochUuid,
  sourceArtifactRootSha256: "a".repeat(64), sourcePackageHash: "b".repeat(64),
  analyzerIdentity: profile.analyzerIdentity, analyzerPolicyIdentity: profile.analyzerPolicyIdentity,
  compatibilityDate: profile.compatibilityDate, generation: profile.generation,
  programs: [{ identity: { functionPath: "items:read", programHash: "c".repeat(64), schemaHash: "d".repeat(64) }, metadata: { purpose: "query" } }],
};
const input: CoreQueryCheckpointRequest = { format: "flarex.core-query-checkpoint.request", version: 1,
  route: { deploymentId: profile.deploymentId, scopeUuid: profile.scopeUuid, epochUuid: profile.epochUuid },
  sourceId: null, after: null, maximumElapsedMilliseconds: 10_000 };
interface SourceFixture {
  readonly physical: CorePersistenceFixture;
  readonly database: CoreDatabase;
  readonly options: CoreDatabaseOptions;
  readonly advanceClock: () => void;
}
async function withSource<A, Failure>(create: () => Promise<CorePersistenceFixture>,
  use: (fixture: SourceFixture) => Effect.Effect<A, Failure, Scope.Scope>): Promise<A> {
  const physical = await create();
  try {
    return await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      let now = 1_000_000_000n;
      const options: CoreDatabaseOptions = { schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS,
        now: Effect.sync(() => now), randomBytes: length => Effect.sync(() => randomBytes(length)) };
      const database = yield* openCoreDatabase(physical.persistence, options);
      yield* activateApplication(database, schema, { programs: frame.programs, applicationRegistration: frame });
      return yield* use({ physical, database, options, advanceClock: () => { now += 100_000_000n; } });
    })));
  } finally { await physical.close(); }
}
const write = Effect.fn("ApplicationCheckpointTest.write")(function* (database: CoreDatabase) {
  const transaction = yield* database.begin();
  yield* transaction.insert("items", { value: "source data" });
  return yield* database.commit(yield* transaction.finalize());
});
const resume = (sourceId: string, after: string): CoreQueryCheckpointRequest => ({ ...input, sourceId, after });

for (const driver of ["pglite", "postgres"] as const) describe.runIf(driver === "pglite" || endpoints !== undefined)(
  `Application checkpoint source on ${driver}`, () => {
    const create = () => driver === "pglite" ? createCorePGliteFixture()
      : endpoints === undefined ? Promise.reject(new Error("Ordinary PostgreSQL endpoints are required")) : createCorePostgresFixture(endpoints);
    it("certifies sparse saved positions and rejects a checkpoint beyond the fixed target", async () => {
      await withSource(create, ({ database, advanceClock }) => Effect.gen(function* () {
        const first = yield* readExecutorApplicationCheckpoint(database, profile, input, executorApplicationSha256);
        expect(first.kind).toBe("certified");
        advanceClock();
        yield* write(database);
        const second = yield* readExecutorApplicationCheckpoint(database, profile, resume(first.sourceId, first.through), executorApplicationSha256);
        expect(second.kind).toBe("certified");
        expect(second.sourceId).toBe(first.sourceId);
        expect(BigInt(second.through) - BigInt(first.through)).toBeGreaterThan(1n);
        const invalid = yield* readExecutorApplicationCheckpoint(database, profile,
          resume(first.sourceId, String(BigInt(second.through) + 1n)), executorApplicationSha256).pipe(Effect.flip);
        expect(invalid).toMatchObject({ _tag: "ExecutorApplicationCheckpointError", reason: "invalidCheckpoint" });
      }));
    }, 60_000);
    it("keeps one target while ordinary data advances during source hashing", async () => {
      await withSource(create, ({ database, advanceClock }) => Effect.gen(function* () {
        const captured = yield* database.publishedTimestamp;
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const sha256 = (bytes: Uint8Array) => Deferred.succeed(entered, undefined).pipe(
          Effect.andThen(Deferred.await(release)), Effect.andThen(executorApplicationSha256(bytes)));
        const fiber = yield* Effect.forkChild(readExecutorApplicationCheckpoint(database, profile, input, sha256));
        yield* Deferred.await(entered);
        advanceClock();
        yield* write(database);
        yield* Deferred.succeed(release, undefined);
        const certificate = yield* Fiber.join(fiber);
        expect(certificate.kind).toBe("certified");
        expect(BigInt(certificate.through)).toBe(captured);
        expect(yield* database.publishedTimestamp).toBeGreaterThan(captured);
      }));
    }, 60_000);
    it("refuses disclosure when publication metadata changes during hashing", async () => {
      await withSource(create, ({ database }) => Effect.gen(function* () {
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const sha256 = (bytes: Uint8Array) => Deferred.succeed(entered, undefined).pipe(
          Effect.andThen(Deferred.await(release)), Effect.andThen(executorApplicationSha256(bytes)));
        const fiber = yield* Effect.forkChild(readExecutorApplicationCheckpoint(database, profile, input, sha256));
        yield* Deferred.await(entered);
        const replacement = { ...frame, sourceArtifactRootSha256: "e".repeat(64),
          programs: frame.programs.map(program => ({ ...program, identity: { ...program.identity, programHash: "f".repeat(64) } })) };
        yield* activateApplication(database, schema, { programs: replacement.programs, applicationRegistration: replacement });
        yield* Deferred.succeed(release, undefined);
        expect(yield* Fiber.join(fiber).pipe(Effect.flip)).toMatchObject({ reason: "authorityRevoked" });
      }));
    }, 60_000);
    it("reports source and epoch replacement without inheriting an old checkpoint", async () => {
      await withSource(create, ({ database }) => Effect.gen(function* () {
        const first = yield* readExecutorApplicationCheckpoint(database, profile, input, executorApplicationSha256);
        const replacement = { ...frame, sourceArtifactRootSha256: "e".repeat(64),
          programs: frame.programs.map(program => ({ ...program, identity: { ...program.identity, programHash: "f".repeat(64) } })) };
        yield* activateApplication(database, schema, { programs: replacement.programs, applicationRegistration: replacement });
        const replaced = yield* readExecutorApplicationCheckpoint(database, profile, resume(first.sourceId, first.through), executorApplicationSha256);
        expect(replaced.kind).toBe("sourceReplaced");
        expect(replaced.sourceId).not.toBe(first.sourceId);
        const epoch = yield* readExecutorApplicationCheckpoint(database, profile, { ...input,
          route: { ...input.route, epochUuid: "45000000-0000-4000-8000-000000000099" } }, executorApplicationSha256);
        expect(epoch.kind).toBe("sourceReplaced");
        expect(epoch.route).toEqual(input.route);
      }));
    }, 60_000);
    it("distinguishes cold Core history loss from a fresh authentic source checkpoint", async () => {
      await withSource(create, ({ database, physical, options, advanceClock }) => Effect.gen(function* () {
        const first = yield* readExecutorApplicationCheckpoint(database, profile, input, executorApplicationSha256);
        advanceClock();
        yield* write(database);
        yield* database.close();
        const reopened = yield* openCoreDatabase(yield* Effect.promise(() => physical.reopen()), options);
        const lost = yield* readExecutorApplicationCheckpoint(reopened, profile, resume(first.sourceId, first.through), executorApplicationSha256);
        expect(lost.kind).toBe("historyUnavailable");
        expect(lost.sourceId).toBe(first.sourceId);
        const fresh = yield* readExecutorApplicationCheckpoint(reopened, profile, input, executorApplicationSha256);
        expect(fresh.kind).toBe("certified");
        expect(fresh.through).toBe(lost.through);
      }));
    }, 60_000);
  },
);
