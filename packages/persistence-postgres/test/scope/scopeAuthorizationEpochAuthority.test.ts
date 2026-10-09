import { setTimeout as delay } from "node:timers/promises";

import { Cause, Effect, Exit, Fiber, Result } from "effect";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import {
  TransactionGrantDeploymentIdV1Schema,
} from "flarex-protocol/transaction-grant";
import {
  TransactionAuthorizationRevocationEpochSchema,
} from "flarex-protocol/transaction-session";
import { describe, expect, expectTypeOf, it } from "vitest";

// @ts-expect-error The internal located authority result must stay off the package root.
import type { LocatedTrustedScopeAuthority as RootLocatedTrustedScopeAuthority } from "../../src";
// @ts-expect-error The raw epoch target capability must stay off the package root.
import type { LocatedScopeAuthorizationEpochTarget as RootLocatedScopeAuthorizationEpochTarget } from "../../src";
// @ts-expect-error The raw epoch target resolver must stay off the package root.
import type { ScopeAuthorizationEpochTargetResolver as RootScopeAuthorizationEpochTargetResolver } from "../../src";

import {
  CurrentScopeAuthorizationEpochResolutionError,
  CurrentScopeAuthorizationEpochPortError,
  ScopeClockCorruptionError,
  TrustedScopeAuthorityResolutionError,
  resolveCurrentScopeAuthorizationEpochEffect,
  type CurrentScopeAuthorizationEpoch,
  type CurrentScopeAuthorizationEpochResolutionPorts,
} from "../../src";
import {
  createPGliteLocatedScopeAuthorizationEpochTarget,
  createPGlitePersistence,
  createPGliteSharedScopeAuthorityProvisioner,
  type PGliteFlarexPersistence,
} from "../../src/database/pglite";
import {
  createLocatedScopeAuthorizationEpochTarget,
} from "../../src/scope/scopeAuthorizationEpochAuthority";
import type { FlarexMetadataTransaction } from "../../src/database/metadataTransaction";
import {
  advanceScopeAuthorizationRevocationEpochInTransactionEffect,
  ScopeClockNotFoundError,
} from "../../src/scope/scopeClock";
import type {
  SharedDatabaseScopePhysicalLocator,
} from "../../src/scope/scopeMetadataTypes";
import { runEffect, runEffectFailure } from "../support/effectTestRuntime";
import { fxSystemScopeExecutionAuthorities } from "../../src/database/schema";

const sharedLocator = Object.freeze({
  kind: "shared_database",
  databaseKey: "scope-epoch-primary",
  schemaName: "public",
}) satisfies SharedDatabaseScopePhysicalLocator;

type PublicLocatedAuthorityFunction = Extract<
  keyof typeof import("../../src"),
  "resolveLocatedTrustedScopeAuthority"
>;
type PublicPromiseEpochFunction = Extract<
  keyof typeof import("../../src"),
  "resolveCurrentScopeAuthorizationEpoch"
>;

describe("located scope authorization epoch authority", () => {
  it("keeps located target capabilities behind the high-level package API", () => {
    expectTypeOf<PublicLocatedAuthorityFunction>().toEqualTypeOf<never>();
    expectTypeOf<PublicPromiseEpochFunction>().toEqualTypeOf<never>();
  });

  it("reads the exact target epoch and observes a completed private test bump", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
      "deployment_epoch_authority",
    );
    const provisioned = await createPGliteSharedScopeAuthorityProvisioner(
      persistence,
      {
        physicalLocator: sharedLocator,
        randomUuid: uuidSequence(
          "40000000-0000-4000-8000-000000000001",
          "40000000-0000-4000-8000-000000000002",
        ),
      },
    ).ensure({ deploymentId, projectId: "project_epoch_authority" });
    const ports = resolutionPorts(persistence);

    await expect(
      resolveCurrentScopeAuthorizationEpoch(deploymentId, ports),
    ).resolves.toEqual({
      deploymentId,
      scopeId: provisioned.scope.scopeId,
      authorizationRevocationEpoch: 0n,
    });

    await persistence.drizzle.transaction((tx) =>
      runEffect(
        advanceScopeAuthorizationRevocationEpochInTransactionEffect(
          tx,
          provisioned.scope.scopeId,
        ),
      ),
    );
    await expect(
      resolveCurrentScopeAuthorizationEpoch(deploymentId, ports),
    ).resolves.toEqual({
      deploymentId,
      scopeId: provisioned.scope.scopeId,
      authorizationRevocationEpoch: 1n,
    });
  });

  it("keeps scope epochs isolated and fails closed on missing authority", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    const provisioner = createPGliteSharedScopeAuthorityProvisioner(
      persistence,
      {
        physicalLocator: sharedLocator,
        randomUuid: uuidSequence(
          "40000000-0000-4000-8000-000000000011",
          "40000000-0000-4000-8000-000000000012",
          "40000000-0000-4000-8000-000000000013",
          "40000000-0000-4000-8000-000000000014",
        ),
      },
    );
    const deploymentA = TransactionGrantDeploymentIdV1Schema.make(
      "deployment_epoch_a",
    );
    const deploymentB = TransactionGrantDeploymentIdV1Schema.make(
      "deployment_epoch_b",
    );
    const scopeA = await provisioner.ensure({
      deploymentId: deploymentA,
      projectId: "project_epoch_a",
    });
    const scopeB = await provisioner.ensure({
      deploymentId: deploymentB,
      projectId: "project_epoch_b",
    });
    await persistence.drizzle.transaction((tx) =>
      runEffect(
        advanceScopeAuthorizationRevocationEpochInTransactionEffect(
          tx,
          scopeA.scope.scopeId,
        ),
      ),
    );
    const ports = resolutionPorts(persistence);

    await expect(resolveCurrentScopeAuthorizationEpoch(deploymentA, ports))
      .resolves.toMatchObject({ authorizationRevocationEpoch: 1n });
    await expect(resolveCurrentScopeAuthorizationEpoch(deploymentB, ports))
      .resolves.toEqual({
        deploymentId: deploymentB,
        scopeId: scopeB.scope.scopeId,
        authorizationRevocationEpoch: 0n,
      });

    const missingDeployment = TransactionGrantDeploymentIdV1Schema.make(
      "deployment_epoch_missing",
    );
    await expect(
      resolveCurrentScopeAuthorizationEpoch(missingDeployment, ports),
    ).rejects.toMatchObject({
      failure: {
        reason: "scopeMetadataMissing",
        deploymentId: missingDeployment,
      },
    } satisfies Partial<TrustedScopeAuthorityResolutionError>);

    await persistence.query(
      `with removed_authority as (
         delete from fx_system_scope_execution_authority where scope_id = $1 returning scope_id
       )
       delete from fx_system_scope_clock c using removed_authority a where c.scope_id = a.scope_id`,
      [scopeB.scope.scopeId],
    );
    await expect(resolveCurrentScopeAuthorizationEpoch(deploymentB, ports))
      .rejects.toMatchObject({
        failure: {
          reason: "scopeClockMissing",
          scopeId: scopeB.scope.scopeId,
          physicalLocator: sharedLocator,
        },
      } satisfies Partial<TrustedScopeAuthorityResolutionError>);
  });

  it("propagates typed corruption from the private epoch read", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
      "deployment_epoch_corrupt",
    );
    const provisioned = await createPGliteSharedScopeAuthorityProvisioner(
      persistence,
      {
        physicalLocator: sharedLocator,
        randomUuid: uuidSequence(
          "40000000-0000-4000-8000-000000000021",
          "40000000-0000-4000-8000-000000000022",
        ),
      },
    ).ensure({ deploymentId, projectId: "project_epoch_corrupt" });
    await persistence.exec(`
      alter table fx_system_scope_execution_authority
        drop constraint fx_scope_execution_authority_revocation_check
    `);
    await persistence.query(
      `
        update fx_system_scope_execution_authority
        set authorization_revocation_epoch = $1
        where scope_id = $2
      `,
      [-1n, provisioned.scope.scopeId],
    );

    await expect(
      resolveCurrentScopeAuthorizationEpoch(
        deploymentId,
        resolutionPorts(persistence),
      ),
    ).rejects.toBeInstanceOf(ScopeClockCorruptionError);
  });

  it("preserves corruption from the preliminary located-clock read", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
      "deployment_epoch_located_clock_corrupt",
    );
    const provisioned = await createPGliteSharedScopeAuthorityProvisioner(
      persistence,
      {
        physicalLocator: sharedLocator,
        randomUuid: uuidSequence(
          "40000000-0000-4000-8000-000000000071",
          "40000000-0000-4000-8000-000000000072",
        ),
      },
    ).ensure({
      deploymentId,
      projectId: "project_epoch_located_clock_corrupt",
    });
    await persistence.exec(`
      -- Deliberately corrupt the installed constraints to exercise the stored scalar decoder.
      drop trigger fx_scope_authority_pair_integrity on fx_system_scope_clock;
      drop trigger fx_scope_authority_pair_integrity on fx_system_scope_execution_authority;
      alter table fx_system_scope_clock
        drop constraint fx_system_scope_clock_last_commit_seq_non_negative_check
    `);
    await persistence.query(
      `
        update fx_system_scope_clock
        set last_commit_seq = $1
        where scope_id = $2
      `,
      [-1n, provisioned.scope.scopeId],
    );

    await expect(
      resolveCurrentScopeAuthorizationEpoch(
        deploymentId,
        resolutionPorts(persistence),
      ),
    ).rejects.toBeInstanceOf(ScopeClockCorruptionError);
  });

  it("rejects malformed richer target capabilities through a typed boundary", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
      "deployment_epoch_invalid_target",
    );
    const provisioned = await createPGliteSharedScopeAuthorityProvisioner(
      persistence,
      {
        physicalLocator: sharedLocator,
        randomUuid: uuidSequence(
          "40000000-0000-4000-8000-000000000041",
          "40000000-0000-4000-8000-000000000042",
        ),
      },
    ).ensure({
      deploymentId,
      projectId: "project_epoch_invalid_target",
    });

    for (const invalidMethod of ["missing", "notFunction"] as const) {
      const malformedTarget = {
        ...createPGliteLocatedScopeAuthorizationEpochTarget(
          persistence,
          sharedLocator,
        ),
      };
      if (invalidMethod === "missing") {
        Reflect.deleteProperty(
          malformedTarget,
          "requireCurrentAuthorizationRevocationEpochEffect",
        );
      } else {
        Reflect.set(
          malformedTarget,
          "requireCurrentAuthorizationRevocationEpochEffect",
          "not-a-function",
        );
      }
      const ports = {
        ...resolutionPorts(persistence),
        scopeEpochTargets: { resolve: async () => malformedTarget },
      } satisfies CurrentScopeAuthorizationEpochResolutionPorts;

      await expect(
        resolveCurrentScopeAuthorizationEpoch(deploymentId, ports),
      ).rejects.toMatchObject({
        failure: {
          reason: "scopeAuthorizationEpochTargetInvalid",
          scopeId: provisioned.scope.scopeId,
          physicalLocator: sharedLocator,
          invalidReason:
            "requireCurrentAuthorizationRevocationEpochMissing",
        },
      } satisfies Partial<CurrentScopeAuthorizationEpochResolutionError>);
    }
  });

  it("maps a clock removed between located and epoch reads to typed absence", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
      "deployment_epoch_removed_during_read",
    );
    const provisioned = await createPGliteSharedScopeAuthorityProvisioner(
      persistence,
      {
        physicalLocator: sharedLocator,
        randomUuid: uuidSequence(
          "40000000-0000-4000-8000-000000000051",
          "40000000-0000-4000-8000-000000000052",
        ),
      },
    ).ensure({
      deploymentId,
      projectId: "project_epoch_removed_during_read",
    });
    const target = createLocatedScopeAuthorizationEpochTarget(
      persistence.drizzle,
      sharedLocator,
    );
    const ports = {
      ...resolutionPorts(persistence),
      scopeEpochTargets: {
        resolve: async () => ({
          physicalLocator: target.physicalLocator,
          getCurrentClock: async (scopeId: typeof provisioned.scope.scopeId) => {
            const clock = await target.getCurrentClock(scopeId);
            await persistence.query(
              `with removed_authority as (
                delete from fx_system_scope_execution_authority where scope_id = $1 returning scope_id
              )
              delete from fx_system_scope_clock c using removed_authority a where c.scope_id = a.scope_id`,
              [scopeId],
            );
            return clock;
          },
          requireCurrentAuthorizationRevocationEpochEffect:
            target.requireCurrentAuthorizationRevocationEpochEffect,
        }),
      },
    } satisfies CurrentScopeAuthorizationEpochResolutionPorts;

    await expect(
      resolveCurrentScopeAuthorizationEpoch(deploymentId, ports),
    ).rejects.toMatchObject({
      failure: {
        reason: "scopeAuthorizationEpochMissing",
        scopeId: provisioned.scope.scopeId,
        physicalLocator: sharedLocator,
      },
    } satisfies Partial<CurrentScopeAuthorizationEpochResolutionError>);
  });

  it("preserves an unexpected target defect outside the typed port channel", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
      "deployment_epoch_port_failure",
    );
    await createPGliteSharedScopeAuthorityProvisioner(
      persistence,
      {
        physicalLocator: sharedLocator,
        randomUuid: uuidSequence(
          "40000000-0000-4000-8000-000000000061",
          "40000000-0000-4000-8000-000000000062",
        ),
      },
    ).ensure({
      deploymentId,
      projectId: "project_epoch_port_failure",
    });
    const cause = new Error("epoch reader unavailable");
    const ports = {
      ...resolutionPorts(persistence),
      scopeEpochTargets: {
        resolve: async () => ({
          ...createPGliteLocatedScopeAuthorizationEpochTarget(
            persistence,
            sharedLocator,
          ),
          requireCurrentAuthorizationRevocationEpochEffect: () =>
            Effect.die(cause),
        }),
      },
    } satisfies CurrentScopeAuthorizationEpochResolutionPorts;

    const exit = await Effect.runPromiseExit(
      resolveCurrentScopeAuthorizationEpochEffect(deploymentId, ports),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasDies(exit.cause)).toBe(true);
      expect(Cause.hasFails(exit.cause)).toBe(false);
      expect(exit.cause.toString()).toContain(cause.message);
    }
  });

  it("maps a concrete target transaction rejection once at its foreign edge", async () => {
    const persistence = await createPGlitePersistence();
    const cause = new Error("epoch transaction unavailable");
    const rejectingDb = new Proxy(persistence.drizzle, {
      get(target, property, receiver) {
        if (property === "transaction") {
          return async () => {
            throw cause;
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const target = createLocatedScopeAuthorizationEpochTarget(
      rejectingDb,
      sharedLocator,
    );

    const failure = await runEffectFailure(
      target.requireCurrentAuthorizationRevocationEpochEffect(
        ScopeIdSchema.make("scope_epoch_transaction_failure"),
      ),
    );
    expect(failure).toBeInstanceOf(CurrentScopeAuthorizationEpochPortError);
    expect(failure).toMatchObject({
      operation: "authorizationEpochRead",
      cause,
    });
  });

  it("translates a concrete target query rejection once at its port edge", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    const cause = new Error("epoch query unavailable");
    const rejectingDb = new Proxy(persistence.drizzle, {
      get(target, property, receiver) {
        if (property === "transaction") {
          return (
            run: (tx: FlarexMetadataTransaction) => Promise<unknown>,
          ) => persistence.drizzle.transaction(tx => run(scopeEpochReadTransaction(tx, () => Promise.reject(cause))));
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const target = createLocatedScopeAuthorizationEpochTarget(
      rejectingDb,
      sharedLocator,
    );

    const failure = await runEffectFailure(
      target.requireCurrentAuthorizationRevocationEpochEffect(
        ScopeIdSchema.make("scope_epoch_query_failure"),
      ),
    );
    expect(failure).toBeInstanceOf(CurrentScopeAuthorizationEpochPortError);
    expect(failure).toMatchObject({
      operation: "authorizationEpochRead",
      cause,
    });
  });

  it("refuses failed installation admission before reading the epoch and retains its typed cause", async () => {
    const persistence = await createPGlitePersistence();
    let epochReads = 0;
    let rolledBack = false;
    const interceptedDb = new Proxy(persistence.drizzle, {
      get(target, property, receiver) {
        if (property === "transaction") return async (run: (tx: FlarexMetadataTransaction) => Promise<unknown>) => {
          try {
            return await persistence.drizzle.transaction(tx => run(scopeEpochReadTransaction(tx, () => {
              epochReads++;
              return Promise.resolve([]);
            })));
          } catch (cause) {
            rolledBack = true;
            throw cause;
          }
        };
        return Reflect.get(target, property, receiver);
      },
    });
    const target = createLocatedScopeAuthorizationEpochTarget(interceptedDb, sharedLocator);
    const failure = await runEffectFailure(target.requireCurrentAuthorizationRevocationEpochEffect(
      ScopeIdSchema.make("scope_epoch_installation_failure"),
    ));
    expect(failure).toBeInstanceOf(CurrentScopeAuthorizationEpochPortError);
    expect(failure).toMatchObject({ operation: "authorizationEpochRead",
      cause: { _tag: "InstallationLifecycleError", reason: "resourceFailure" } });
    expect(epochReads).toBe(0);
    expect(rolledBack).toBe(true);
  });

  it.each([false, true])("preserves a target callback defect when rollback failure is %s", async rollbackFails => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    const defect = new Error("epoch query construction defect");
    const rollbackFailure = new Error("epoch defect rollback failed");
    let rolledBack = false;
    const interceptedDb = new Proxy(persistence.drizzle, {
      get(target, property, receiver) {
        if (property === "transaction") return async (run: (tx: FlarexMetadataTransaction) => Promise<unknown>) => {
          try {
            return await persistence.drizzle.transaction(tx => run(scopeEpochReadTransaction(tx,
              () => Promise.resolve([]), () => { throw defect; })));
          } catch (cause) {
            rolledBack = true;
            throw rollbackFails ? rollbackFailure : cause;
          }
        };
        return Reflect.get(target, property, receiver);
      },
    });
    const target = createLocatedScopeAuthorizationEpochTarget(interceptedDb, sharedLocator);
    const exit = await Effect.runPromiseExit(target.requireCurrentAuthorizationRevocationEpochEffect(
      ScopeIdSchema.make("scope_epoch_callback_defect"),
    ));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasDies(exit.cause)).toBe(true);
      expect(Cause.hasFails(exit.cause)).toBe(false);
      expect(exit.cause.toString()).toContain(defect.message);
      if (rollbackFails) expect(exit.cause.toString()).toContain(rollbackFailure.message);
    }
    expect(rolledBack).toBe(true);
  });

  it("rolls back and rehydrates a typed target read failure", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    let committed = false;
    let rolledBack = false;
    const interceptedDb = new Proxy(persistence.drizzle, {
      get(target, property, receiver) {
        if (property === "transaction") {
          return async (
            run: (tx: FlarexMetadataTransaction) => Promise<unknown>,
          ) => {
            try {
              const value = await persistence.drizzle.transaction(tx => run(scopeEpochReadTransaction(tx, () => Promise.resolve([]))));
              committed = true;
              return value;
            } catch (cause) {
              rolledBack = true;
              throw cause;
            }
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const target = createLocatedScopeAuthorizationEpochTarget(
      interceptedDb,
      sharedLocator,
    );

    const failure = await runEffectFailure(
      target.requireCurrentAuthorizationRevocationEpochEffect(
        ScopeIdSchema.make("scope_epoch_missing_rollback"),
      ),
    );
    expect(failure).toBeInstanceOf(ScopeClockNotFoundError);
    expect(committed).toBe(false);
    expect(rolledBack).toBe(true);
  });

  it("retains a typed target failure when rollback also fails", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    const rollbackFailure = new Error("scope epoch rollback failed");
    const interceptedDb = new Proxy(persistence.drizzle, {
      get(target, property, receiver) {
        if (property === "transaction") {
          return async (
            run: (tx: FlarexMetadataTransaction) => Promise<unknown>,
          ) => {
            try {
              return await persistence.drizzle.transaction(tx => run(scopeEpochReadTransaction(tx, () => Promise.resolve([]))));
            } catch {
              throw rollbackFailure;
            }
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const target = createLocatedScopeAuthorizationEpochTarget(
      interceptedDb,
      sharedLocator,
    );

    const failure = await runEffectFailure(
      target.requireCurrentAuthorizationRevocationEpochEffect(
        ScopeIdSchema.make("scope_epoch_missing_rollback_failure"),
      ),
    );
    expect(failure).toBeInstanceOf(CurrentScopeAuthorizationEpochPortError);
    expect(failure).toMatchObject({ cause: rollbackFailure });
    if (failure instanceof CurrentScopeAuthorizationEpochPortError) {
      const callbackCause = failure.callbackCause;
      if (callbackCause === undefined) {
        throw new Error("Expected the transaction error to retain callback Cause.");
      }
      expect(Cause.hasFails(callbackCause)).toBe(true);
      expect(callbackCause.toString()).toContain(
        "Scope clock does not exist: scope_epoch_missing_rollback_failure",
      );
    }
  });

  it("waits for the epoch transaction Promise to settle after interruption", async () => {
    const persistence = await createPGlitePersistence();
    const entered = deferred<void>();
    const release = deferred<void>();
    const interceptedDb = new Proxy(persistence.drizzle, {
      get(target, property, receiver) {
        if (property === "transaction") {
          return async () => {
            entered.resolve();
            await release.promise;
            return Result.succeed(
              TransactionAuthorizationRevocationEpochSchema.make(0n),
            );
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const target = createLocatedScopeAuthorizationEpochTarget(
      interceptedDb,
      sharedLocator,
    );
    const fiber = Effect.runFork(
      target.requireCurrentAuthorizationRevocationEpochEffect(
        ScopeIdSchema.make("scope_epoch_interruption"),
      ),
    );
    await entered.promise;

    let interruptionSettled = false;
    const interruption = runEffect(Fiber.interrupt(fiber)).then((exit) => {
      interruptionSettled = true;
      return exit;
    });
    await delay(25);
    expect(interruptionSettled).toBe(false);
    release.resolve();
    await interruption;
    expect(interruptionSettled).toBe(true);
  });

  it("preserves the exact signed-bigint epoch value", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
      "deployment_epoch_bigint",
    );
    const provisioned = await createPGliteSharedScopeAuthorityProvisioner(
      persistence,
      {
        physicalLocator: sharedLocator,
        randomUuid: uuidSequence(
          "40000000-0000-4000-8000-000000000031",
          "40000000-0000-4000-8000-000000000032",
        ),
      },
    ).ensure({ deploymentId, projectId: "project_epoch_bigint" });
    const exactEpoch = TransactionAuthorizationRevocationEpochSchema.make(
      9_007_199_254_740_993n,
    );
    await persistence.query(
      `
        update fx_system_scope_execution_authority
        set authorization_revocation_epoch = $1
        where scope_id = $2
      `,
      [exactEpoch, provisioned.scope.scopeId],
    );

    await expect(
      resolveCurrentScopeAuthorizationEpoch(
        deploymentId,
        resolutionPorts(persistence),
      ),
    ).resolves.toMatchObject({ authorizationRevocationEpoch: exactEpoch });
  });
});

function resolutionPorts(
  persistence: PGliteFlarexPersistence,
): CurrentScopeAuthorizationEpochResolutionPorts {
  return {
    scopeMetadata: persistence,
    provisioningReceipts: {
      getScopeAuthorityProvisioningReceipt: async () => {
        throw new Error("Shared scope resolution must not read receipts.");
      },
    },
    scopeEpochTargets: {
      resolve: async (physicalLocator) =>
        createPGliteLocatedScopeAuthorizationEpochTarget(
          persistence,
          physicalLocator,
        ),
    },
  } satisfies CurrentScopeAuthorizationEpochResolutionPorts;
}

function resolveCurrentScopeAuthorizationEpoch(
  deploymentId: Parameters<
    typeof resolveCurrentScopeAuthorizationEpochEffect
  >[0],
  ports: CurrentScopeAuthorizationEpochResolutionPorts,
): Promise<CurrentScopeAuthorizationEpoch> {
  return runEffect(
    resolveCurrentScopeAuthorizationEpochEffect(deploymentId, ports),
  );
}

function uuidSequence(...values: readonly string[]): () => string {
  let index = 0;
  return () => {
    const value = values[index];
    index += 1;
    if (value === undefined) {
      throw new Error("UUID test sequence exhausted.");
    }
    return value;
  };
}

interface RejectingScopeEpochQuery
  extends PromiseLike<ReadonlyArray<unknown>> {
  from(): RejectingScopeEpochQuery;
  innerJoin(): RejectingScopeEpochQuery;
  where(): RejectingScopeEpochQuery;
  limit(): RejectingScopeEpochQuery;
  for(): RejectingScopeEpochQuery;
}

function scopeEpochReadTransaction(
  transaction: FlarexMetadataTransaction,
  run: () => Promise<ReadonlyArray<unknown>>,
  onEpochRead?: () => void,
): FlarexMetadataTransaction {
  return new Proxy(transaction, {
    get(target, property, receiver) {
      if (property !== "select") return Reflect.get(target, property, receiver);
      return (selection: Parameters<FlarexMetadataTransaction["select"]>[0]) => {
        const query: RejectingScopeEpochQuery = {
          from: () => query,
          innerJoin: () => query,
          where: () => query,
          limit: () => query,
          for: () => query,
          then: (onFulfilled, onRejected) => run().then(onFulfilled, onRejected),
        };
        const actualQuery = target.select(selection);
        return new Proxy(actualQuery, {
          get(builder, step, stepReceiver) {
            if (step === "from") return (table: unknown) => {
              if (table !== fxSystemScopeExecutionAuthorities) return Reflect.apply(builder.from, builder, [table]);
              onEpochRead?.();
              return query;
            };
            return Reflect.get(builder, step, stepReceiver);
          },
        });
      };
    },
  });
}

function deferred<Value>(): Readonly<{
  promise: Promise<Value>;
  resolve: (value: Value) => void;
}> {
  let resolvePromise: ((value: Value) => void) | undefined;
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value) => resolvePromise?.(value),
  };
}
