import { describe, expect, it } from "vitest";
import { Effect, Deferred, Fiber, Result, Exit, Cause } from "effect";
import { eq, sql } from "drizzle-orm";
import {
  postgresUrl,
  withTemporaryPostgresPersistencePair,
} from "./postgresHelpers";
import { createApplicationNativeMutationPostgresFixture } from "./fixtures/applicationNativeMutationTestFixture";
import { makePostgresFrameworkMigrationTargetEffect } from "../src/migrationCoordination/postgresTarget";
import { makeFrameworkSchemaArtifactControlSessionStarter } from "../src/frameworkSchema/artifact/controlSession";
import { makePostgresFrameworkSchemaArtifactControlSessionDriver } from "../src/frameworkSchema/artifact/postgresControlSession";
import { makeFrameworkSchemaArtifactRepository } from "../src/frameworkSchema/artifact/repository";
import { makePostgresRelationalSession } from "../src/relationalTransaction/session";
import {
  makeRelationalHost,
  defineRelationalCommand,
} from "../src/relationalTransaction/host";
import {
  prepareRelationalFixture,
  exerciseRelationalStore,
} from "./relationalTransactionTestSupport";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import { fxSystemScopeClocks } from "../src/schema";
import {
  ScopeIdSchema,
  ScopeEpochSchema,
} from "flarex-protocol/storage-authority";
import { insertInitialScopeClockInTransactionResult } from "../src/scopeClockInitialization";
import { lockScopeClockForUpdateInTransactionEffect } from "../src/scopeClock";
import {
  changeBindingAvailability,
  installationBindingReference,
} from "./frameworkDataBindingPhysicalTestSupport";

describe.skipIf(postgresUrl === null)(
  "native scalar relational transaction",
  { timeout: 180_000 },
  () => {
    it("proves ordinary-role locks, cancellation, rollback and uncertain read settlement", async () => {
      await withTemporaryPostgresPersistencePair(
        async (control, persistence) => {
          const result = await persistence.query<{ schema: string }>(
            "select current_schema() as schema",
          );
          const schemaName = result.rows[0]?.schema;
          if (schemaName === undefined) throw new Error("Missing schema");
          expect(
            (
              await persistence.query<{ superuser: boolean }>(
                "select rolsuper as superuser from pg_roles where rolname = current_user",
              )
            ).rows[0]?.superuser,
          ).toBe(false);
          const fixture = await createApplicationNativeMutationPostgresFixture(
            {
              runtimeHostIdentity: "flarex.test/scalar-store",
              compatibilityDate: "2026-09-06",
              physicalLocator: {
                kind: "database_per_scope",
                databaseKey: "application_native_mutation_target",
                schemaName,
              },
            },
            { control, target: persistence },
          );
          const target = await runEffect(
            makePostgresFrameworkMigrationTargetEffect({
              persistence,
              deploymentId: fixture.deploymentId,
              canonicalPhysicalDatabaseIdentity: "scalar-native",
              physicalLocator: fixture.active.basis.authority.physicalLocator,
            }),
          );
          const repository = Result.getOrThrow(
            makeFrameworkSchemaArtifactRepository({
              controlDb: persistence.drizzle,
              controlSessionStarter:
                makeFrameworkSchemaArtifactControlSessionStarter({
                  controlDb: persistence.drizzle,
                  driver:
                    makePostgresFrameworkSchemaArtifactControlSessionDriver(
                      persistence.pool,
                    ),
                }),
              readTimeoutMilliseconds: 10_000,
              attemptTimeoutMilliseconds: 10_000,
              recoveryTimeoutMilliseconds: 10_000,
              lockTimeoutMilliseconds: 2_000,
            }),
          );
          const prepared = await prepareRelationalFixture(
            fixture,
            target,
            repository,
          );
          const session = makePostgresRelationalSession(persistence);
          const tested = await exerciseRelationalStore(prepared, session);
          const scopeId = fixture.active.basis.authority.scopeId;
          const waitBlocked = async (queryFragment: string) => {
            const deadline = performance.now() + 5_000;
            while (performance.now() < deadline) {
              const blocked = await persistence.query<{ blocked: boolean }>(
                "select exists(select 1 from pg_stat_activity where application_name = $1 and position($2 in query) > 0 and cardinality(pg_blocking_pids(pid)) > 0) as blocked",
                [persistence.pool.options.application_name, queryFragment],
              );
              if (blocked.rows[0]?.blocked) return;
              await new Promise((resolve) => setTimeout(resolve, 10));
            }
            throw new Error("Expected actual PostgreSQL lock barrier");
          };
          const acquired = await runEffect(Deferred.make<void>());
          const release = await runEffect(Deferred.make<void>());
          const held = persistence.drizzle.transaction(async (tx) => {
            await runEffect(
              lockScopeClockForUpdateInTransactionEffect(tx, scopeId),
            );
            await runEffect(Deferred.succeed(acquired, undefined));
            await runEffect(Deferred.await(release));
          });
          await runEffect(Deferred.await(acquired));
          const waiting = Effect.runFork(
            tested.host.run(tested.reference, tested.read, null),
          );
          try {
            await waitBlocked("fx_system_scope_clock");
            await runEffect(Fiber.interrupt(waiting));
          } finally {
            await runEffect(Deferred.succeed(release, undefined));
            await held;
          }
          await runEffect(tested.host.run(tested.reference, tested.read, null));

          // A held admitted command blocks scope changes and availability movement.
          const entered = await runEffect(Deferred.make<void>());
          const finish = await runEffect(Deferred.make<void>());
          const hold = defineRelationalCommand(
            (_context, _input: null) => Effect.void,
          );
          const holdingHost = await runEffect(
            makeRelationalHost(
              {
                database: persistence.drizzle,
                session,
                target,
                deploymentId: fixture.deploymentId,
                authority: fixture.authorityPorts,
                commands: [hold],
              },
              {
                beforeAdmission: (owner, seal) =>
                  Effect.gen(function* () {
                    expect(yield* owner.inspect(seal)).toEqual([]);
                    yield* Deferred.succeed(entered, undefined);
                    yield* Deferred.await(finish);
                  }),
              },
            ),
          );
          const holding = runEffect(
            holdingHost.run(tested.reference, hold, null),
          );
          await runEffect(Deferred.await(entered));
          const otherScope = ScopeIdSchema.make(
            "scope_34000000-0000-4000-8000-000000009999",
          );
          await persistence.drizzle.transaction(async (tx) => {
            Result.getOrThrow(
              await insertInitialScopeClockInTransactionResult(tx, {
                scopeId: otherScope,
                initialEpoch: ScopeEpochSchema.make(
                  "epoch_34000000-0000-4000-8000-000000009999",
                ),
              }),
            );
            expect(
              (
                await runEffect(
                  lockScopeClockForUpdateInTransactionEffect(tx, otherScope),
                )
              ).scopeId,
            ).toBe(otherScope);
          });
          const withdrawing = changeBindingAvailability(
            fixture,
            tested.restored,
            "withdrawn",
          );
          const fencing = persistence.drizzle
            .update(fxSystemScopeClocks)
            .set({
              storageGenerationFence: sql`${fxSystemScopeClocks.storageGenerationFence} + 1`,
            })
            .where(eq(fxSystemScopeClocks.scopeId, scopeId))
            .execute();
          try {
            await waitBlocked("fx_system_framework_schema_availability_head");
            await waitBlocked("fx_system_scope_clock");
          } finally {
            await runEffect(Deferred.succeed(finish, undefined));
            await holding;
          }
          const withdrawn = await withdrawing;
          await fencing;
          expect(
            await runEffectFailure(
              tested.host.run(tested.reference, tested.read, null),
            ),
          ).toBeDefined();
          await persistence.drizzle
            .update(fxSystemScopeClocks)
            .set({
              storageGenerationFence:
                fixture.active.basis.authority.storageGenerationFence,
            })
            .where(eq(fxSystemScopeClocks.scopeId, scopeId));
          const ready = await changeBindingAvailability(
            fixture,
            withdrawn,
            "ready",
          );
          const reference = installationBindingReference(ready);

          let commits = 0;
          const uncertainSession = makePostgresRelationalSession(persistence, {
            lifecycleFault: (event) => {
              if (event.phase === "commit" && event.edge === "after") {
                commits += 1;
                throw new Error("Actual read-only COMMIT acknowledgement lost");
              }
            },
          });
          const uncertainHost = await runEffect(
            makeRelationalHost({
              database: persistence.drizzle,
              session: uncertainSession,
              target,
              deploymentId: fixture.deploymentId,
              authority: fixture.authorityPorts,
              commands: [tested.read],
            }),
          );
          expect(
            await runEffectFailure(
              uncertainHost.run(reference, tested.read, null),
            ),
          ).toMatchObject({ reason: "decisionUncertain" });
          expect(commits).toBe(1);
          await runEffect(tested.host.run(reference, tested.read, null));
          const rejected = defineRelationalCommand((_context, _input: null) =>
            Effect.fail("intentional-callback-failure"),
          );
          let quarantines = 0;
          const cleanupHost = await runEffect(
            makeRelationalHost({
              database: persistence.drizzle,
              target,
              deploymentId: fixture.deploymentId,
              authority: fixture.authorityPorts,
              commands: [rejected],
              session: makePostgresRelationalSession(persistence, {
                lifecycleFault: (event) => {
                  if (event.phase === "rollback" && event.edge === "before")
                    throw new Error("Rollback transport failed");
                  if (event.phase === "quarantine" && event.edge === "after")
                    quarantines++;
                },
              }),
            }),
          );
          const cleanup = await runEffect(
            Effect.exit(cleanupHost.run(reference, rejected, null)),
          );
          expect(Exit.isFailure(cleanup)).toBe(true);
          if (Exit.isFailure(cleanup)) {
            const failures = cleanup.cause.reasons
              .filter(Cause.isFailReason)
              .map((reason) => reason.error);
            expect(failures).toContain("intentional-callback-failure");
            expect(failures).toContainEqual(
              expect.objectContaining({ reason: "cleanupFailure" }),
            );
          }
          expect(quarantines).toBe(1);
          await runEffect(tested.host.run(reference, tested.read, null));
          expect(
            await runEffectFailure(
              tested.host.run(reference, tested.timeout, null),
            ),
          ).toBeDefined();
          await runEffect(tested.host.run(reference, tested.read, null));
        },
      );
    });
  },
);
