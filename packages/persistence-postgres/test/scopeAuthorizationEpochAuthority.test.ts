import { setTimeout as delay } from "node:timers/promises";

import { Effect, Fiber } from "effect";
import {
  TransactionGrantDeploymentIdV1Schema,
} from "flarex-protocol/transaction-grant";
import {
  TransactionAuthorizationRevocationEpochSchema,
} from "flarex-protocol/transaction-session";
import { describe, expect, expectTypeOf, it } from "vitest";

// @ts-expect-error The internal located authority result must stay off the package root.
import type { LocatedTrustedScopeAuthority as RootLocatedTrustedScopeAuthority } from "../src";
// @ts-expect-error The raw epoch target capability must stay off the package root.
import type { LocatedScopeAuthorizationEpochTarget as RootLocatedScopeAuthorizationEpochTarget } from "../src";
// @ts-expect-error The raw epoch target resolver must stay off the package root.
import type { ScopeAuthorizationEpochTargetResolver as RootScopeAuthorizationEpochTargetResolver } from "../src";

import {
  CurrentScopeAuthorizationEpochResolutionError,
  CurrentScopeAuthorizationEpochPortError,
  ScopeClockCorruptionError,
  TrustedScopeAuthorityResolutionError,
  resolveCurrentScopeAuthorizationEpochEffect,
  type CurrentScopeAuthorizationEpoch,
  type CurrentScopeAuthorizationEpochResolutionPorts,
} from "../src";
import {
  createPGliteLocatedScopeAuthorizationEpochTarget,
  createPGlitePersistence,
  createPGliteSharedScopeAuthorityProvisioner,
  type PGliteFlarexPersistence,
} from "../src/pglite";
import {
  createLocatedScopeAuthorizationEpochTarget,
} from "../src/scopeAuthorizationEpochAuthority";
import {
  advanceScopeAuthorizationRevocationEpochInTransaction,
} from "../src/scopeClock";
import type {
  SharedDatabaseScopePhysicalLocator,
} from "../src/scopeMetadataTypes";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

const sharedLocator = Object.freeze({
  kind: "shared_database",
  databaseKey: "scope-epoch-primary",
  schemaName: "public",
}) satisfies SharedDatabaseScopePhysicalLocator;

type PublicLocatedAuthorityFunction = Extract<
  keyof typeof import("../src"),
  "resolveLocatedTrustedScopeAuthority"
>;
type PublicPromiseEpochFunction = Extract<
  keyof typeof import("../src"),
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
      advanceScopeAuthorizationRevocationEpochInTransaction(
        tx,
        provisioned.scope.scopeId,
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
      advanceScopeAuthorizationRevocationEpochInTransaction(
        tx,
        scopeA.scope.scopeId,
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
      "delete from fx_system_scope_clock where scope_id = $1",
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
      alter table fx_system_scope_clock
        drop constraint fx_system_scope_clock_authorization_revocation_epoch_non_negative_check
    `);
    await persistence.query(
      `
        update fx_system_scope_clock
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
      alter table fx_system_scope_clock
        drop constraint fx_system_scope_clock_last_commit_seq_non_negative_check,
        drop constraint fx_system_scope_clock_oldest_available_commit_seq_check
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
          "requireCurrentAuthorizationRevocationEpoch",
        );
      } else {
        Reflect.set(
          malformedTarget,
          "requireCurrentAuthorizationRevocationEpoch",
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
              "delete from fx_system_scope_clock where scope_id = $1",
              [scopeId],
            );
            return clock;
          },
          requireCurrentAuthorizationRevocationEpoch:
            target.requireCurrentAuthorizationRevocationEpoch,
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

  it("keeps an unexpected epoch-reader rejection in the typed port channel", async () => {
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
          requireCurrentAuthorizationRevocationEpoch: async () => {
            throw cause;
          },
        }),
      },
    } satisfies CurrentScopeAuthorizationEpochResolutionPorts;

    const failure = await runEffectFailure(
      resolveCurrentScopeAuthorizationEpochEffect(deploymentId, ports),
    );
    expect(failure).toBeInstanceOf(CurrentScopeAuthorizationEpochPortError);
    expect(failure).toMatchObject({
      operation: "authorizationEpochRead",
      cause,
    });
  });

  it("waits for the epoch transaction Promise to settle after interruption", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
      "deployment_epoch_interruption",
    );
    await createPGliteSharedScopeAuthorityProvisioner(
      persistence,
      {
        physicalLocator: sharedLocator,
        randomUuid: uuidSequence(
          "40000000-0000-4000-8000-000000000081",
          "40000000-0000-4000-8000-000000000082",
        ),
      },
    ).ensure({
      deploymentId,
      projectId: "project_epoch_interruption",
    });
    const entered = deferred<void>();
    const release = deferred<
      ReturnType<typeof TransactionAuthorizationRevocationEpochSchema.make>
    >();
    const ports = {
      ...resolutionPorts(persistence),
      scopeEpochTargets: {
        resolve: async () => ({
          ...createPGliteLocatedScopeAuthorizationEpochTarget(
            persistence,
            sharedLocator,
          ),
          requireCurrentAuthorizationRevocationEpoch: async () => {
            entered.resolve();
            return release.promise;
          },
        }),
      },
    } satisfies CurrentScopeAuthorizationEpochResolutionPorts;
    const fiber = Effect.runFork(
      resolveCurrentScopeAuthorizationEpochEffect(deploymentId, ports),
    );
    await entered.promise;

    let interruptionSettled = false;
    const interruption = runEffect(Fiber.interrupt(fiber)).then((exit) => {
      interruptionSettled = true;
      return exit;
    });
    await delay(25);
    expect(interruptionSettled).toBe(false);
    release.resolve(TransactionAuthorizationRevocationEpochSchema.make(0n));
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
        update fx_system_scope_clock
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
