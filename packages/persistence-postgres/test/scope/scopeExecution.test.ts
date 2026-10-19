import {
  useFileScopedPGliteScopeAuthorityPersistence,
} from "../support/pgliteTestFixture";
import { fxSystemScopeExecutionAuthorities } from "../../src/database/schema";
import { Cause, Effect, Exit, Result } from "effect";
import {
  FlarexDbV1StorageGenerationSchema,
  StorageGenerationFenceSchema,
  type ScopeId,
} from "flarex-protocol/storage-authority";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  createPGliteLocatedPointMutationSessionActivationTargetV1,

  createPGliteSharedScopeAuthorityProvisioner,
  type PGliteFlarexPersistence,
} from "../../src/database/pglite";
import { fxSystemScopeClocks } from "../../src/database/schema";
import {
  resolveLocatedTrustedScopeAuthorityEffect,
  type LocatedTrustedScopeAuthority,
  type TrustedScopeAuthorityResolutionPorts,
} from "../../src/scope/scopeAuthorityResolution";
import type { SharedDatabaseScopePhysicalLocator } from
  "../../src/scope/scopeMetadataTypes";
import {
  ScopeExecutionAuthorityError,
  ScopedTransactionCapabilityError,
} from "../../src/scope/execution/Errors";
import { liveScopeExecution } from "../../src/scope/execution/ScopeExecution";
import {
  defineScopedReadOperation,
  defineScopedWriteOperation,
  inspectScopedTransactionContextEffect,
  runScopedTransactionOperationEffect,
  type ScopedTransaction,
} from "../../src/scope/execution/ScopedTransaction";
import {
  isLocatedReadCommittedAttemptTargetV1,
  RUN_LOCATED_READ_COMMITTED_V1,
  type LocatedReadCommittedAttemptTargetV1,
} from "../../src/database/locatedTransactionIdentity";
import { runEffect } from "../support/effectTestRuntime";

const locator = Object.freeze({
  kind: "shared_database",
  databaseKey: "scope-execution-primary",
  schemaName: "public",
}) satisfies SharedDatabaseScopePhysicalLocator;

const settlement = Object.freeze({
  rollbackMessage: "Scoped-execution test transaction rolled back.",
  cleanupDefect: (failure: unknown) => failure,
});

describe("scope execution", { timeout: 120_000 }, () => {
  it("rejects a forged capability as a defect before invoking package work", async () => {
    let invoked = 0;
    const forged = Object.freeze({}) as unknown as ScopedTransaction;
    const operation = defineScopedReadOperation(
      (_tx, _context, _input: void) => Effect.sync(() => invoked += 1),
    );
    const exit = await runEffect(Effect.exit(
      runScopedTransactionOperationEffect(forged, operation, undefined),
    ));

    expectCapabilityDefect(exit, "invalid");
    expect(invoked).toBe(0);
  });

  describe("scope fixture", { concurrent: false }, () => {
    const withPersistence = useFileScopedPGliteScopeAuthorityPersistence();

    it("mints one authentic capability after the clock guard and closes it on return", () => withPersistence(async persistence => {
      const located = await scopeFixture(persistence, "deployment_scope_execution_lifetime");
      let retained: ScopedTransaction | undefined;

      const operation = defineScopedReadOperation(
        (_tx, context, _input: void, scoped) => Effect.sync(() => {
          retained = scoped;
          return Object.freeze({
            mode: context.mode,
            scopeId: context.authority.scopeId,
            clockScopeId: context.clock.scopeId,
            exposedKeys: Reflect.ownKeys(scoped),
          });
        }),
      );
      const observed = await runEffect(liveScopeExecution.runRead(
        located,
        settlement,
        operation,
        undefined,
      ));

      expect(observed).toEqual({
        mode: "read",
        scopeId: located.authority.scopeId,
        clockScopeId: located.authority.scopeId,
        exposedKeys: [],
      });
      expect(retained).toBeDefined();

      const expired = await runEffect(Effect.exit(
        inspectScopedTransactionContextEffect(retained!),
      ));
      expectCapabilityDefect(expired, "closed");
    }));

    it.each(["ordinaryWrite", "scopeTransition"] as const)("closes write capabilities after success and rollback with %s protection", (clockProtection) => withPersistence(async persistence => {
      const located = await scopeFixture(persistence, `deployment_scope_execution_${clockProtection}`);
      let retained: ScopedTransaction | undefined;
      const operation = defineScopedWriteOperation((_tx, context, rollback: boolean, scoped) => Effect.gen(function* () {
        retained = scoped;
        expect(context.mode).toBe("write");
        expect(context.clock.scopeId).toBe(located.authority.scopeId);
        expect(Reflect.ownKeys(scoped)).toEqual([]);
        if (rollback) return yield* Effect.fail("test rollback");
        return "completed";
      }));
      for (const rollback of [false, true]) {
        const result = await runEffect(Effect.result(liveScopeExecution.runWrite(located,
          { ...settlement, clockProtection }, operation, rollback)));
        expect(result).toEqual(rollback ? Result.fail("test rollback") : Result.succeed("completed"));
        expect(retained).toBeDefined();
        expectCapabilityDefect(await runEffect(Effect.exit(inspectScopedTransactionContextEffect(retained!))), "closed");
      }
    }));

    it("rejects stale authority inside the transaction before domain work", () => withPersistence(async persistence => {
      const located = await scopeFixture(persistence, "deployment_scope_execution_stale");
      const stale = Object.freeze({
        authority: Object.freeze({
          ...located.authority,
          storageGenerationFence: StorageGenerationFenceSchema.make(
            located.authority.storageGenerationFence + 1n,
          ),
        }),
        target: located.target,
      }) satisfies LocatedTrustedScopeAuthority<LocatedReadCommittedAttemptTargetV1>;
      let invoked = 0;

      const operation = defineScopedWriteOperation(
        (_tx, _context, _input: void) => Effect.sync(() => invoked += 1),
      );
      const result = await runEffect(Effect.result(liveScopeExecution.runWrite(
        stale,
        { ...settlement, clockProtection: "scopeTransition" },
        operation,
        undefined,
      )));

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toBeInstanceOf(ScopeExecutionAuthorityError);
        expect(result.failure).toMatchObject({
          scopeId: located.authority.scopeId,
          reason: "storageGenerationFenceChanged",
        });
      }
      expect(invoked).toBe(0);
    }));

    it("rejects a foreign target placement before acquiring a transaction", () => withPersistence(async persistence => {
      const located = await scopeFixture(persistence, "deployment_scope_execution_locator");
      let transactions = 0;
      let invoked = 0;
      const target = Object.freeze({
        physicalLocator: Object.freeze({
          ...locator,
          databaseKey: "foreign-scope-execution-primary",
        }),
        getCurrentClock: located.target.getCurrentClock,
        [RUN_LOCATED_READ_COMMITTED_V1]: async <Value>(
          _work: (tx: never) => Promise<Value>,
        ): Promise<Value> => {
          transactions += 1;
          throw new Error("Foreign target transaction must not start.");
        },
      }) satisfies LocatedReadCommittedAttemptTargetV1;
      const foreign = Object.freeze({
        authority: located.authority,
        target,
      });

      const operation = defineScopedReadOperation(
        (_tx, _context, _input: void) => Effect.sync(() => invoked += 1),
      );
      const result = await runEffect(Effect.result(liveScopeExecution.runRead(
        foreign,
        settlement,
        operation,
        undefined,
      )));

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toMatchObject({
          reason: "targetPlacementMismatch",
        });
      }
      expect(transactions).toBe(0);
      expect(invoked).toBe(0);
    }));

    it("rejects a package operation that attempts to return the raw transaction", () => withPersistence(async persistence => {
      const located = await scopeFixture(persistence, "deployment_scope_execution_raw_escape");
      const operation = defineScopedReadOperation(
        (tx, _context, _input: void) => Effect.succeed(tx),
      );

      const exit = await runEffect(Effect.exit(liveScopeExecution.runRead(
        located,
        settlement,
        operation,
        undefined,
      )));

      expectCapabilityDefect(exit, "invalid");
    }));
  });
});

async function scopeFixture(
  persistence: PGliteFlarexPersistence,
  deploymentId: string,
): Promise<LocatedTrustedScopeAuthority<LocatedReadCommittedAttemptTargetV1>> {
  const provisioned = await createPGliteSharedScopeAuthorityProvisioner(
    persistence,
    {
      physicalLocator: locator,
      randomUuid: uuidSequence(
        "90000000-0000-4000-8000-000000000011",
        "90000000-0000-4000-8000-000000000012",
      ),
    },
  ).ensure({ deploymentId, projectId: `${deploymentId}_project` });
  await persistence.drizzle.update(fxSystemScopeExecutionAuthorities).set({storageGeneration:
        FlarexDbV1StorageGenerationSchema.make("flarexdb_v1")}).where(eq(fxSystemScopeExecutionAuthorities.scopeId, provisioned.scope.scopeId));
  const unresolved = createPGliteLocatedPointMutationSessionActivationTargetV1(
    persistence,
    locator,
  );
  if (!isLocatedReadCommittedAttemptTargetV1(unresolved)) {
    throw new Error("PGlite located target lacks read-committed execution.");
  }
  const ports = {
    scopeMetadata: persistence,
    provisioningReceipts: {
      getScopeAuthorityProvisioningReceipt: async (_scopeId: ScopeId) => {
        throw new Error("Shared scope resolution must not read split receipts.");
      },
    },
    scopeClockTargets: {
      resolve: async () => unresolved,
    },
  } satisfies TrustedScopeAuthorityResolutionPorts<
    LocatedReadCommittedAttemptTargetV1
  >;
  const located = await runEffect(resolveLocatedTrustedScopeAuthorityEffect(
    provisioned.scope.deploymentId,
    ports,
  ));
  return located;
}

function expectCapabilityDefect(
  exit: Exit.Exit<unknown, unknown>,
  reason: ScopedTransactionCapabilityError["reason"],
): void {
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) {
    const defect = Cause.findDefect(exit.cause);
    expect(Result.isSuccess(defect)).toBe(true);
    if (Result.isSuccess(defect)) {
      expect(defect.success).toBeInstanceOf(ScopedTransactionCapabilityError);
      expect(defect.success).toMatchObject({ reason });
    }
  }
}

function uuidSequence(...values: readonly string[]): () => string {
  let index = 0;
  return () => {
    const value = values[index];
    index += 1;
    if (value === undefined) throw new Error("UUID sequence exhausted.");
    return value;
  };
}
