import { Effect, Result } from "effect";
import { ReplacementScopeIdV1Schema } from
  "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from
  "flarex-protocol/transaction-grant";
import {
  TransactionAttemptFenceSchema,
  TransactionSessionIdV1Schema,
} from "flarex-protocol/transaction-session";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  PointMutationExecutionClaimAcquisitionPersistenceV1Error,
  type PointMutationExecutionClaimAcquisitionV1,
} from "@flarex/persistence-postgres/transaction-session-activation";
import {
  TransactionExecutionClaimFenceV1Schema,
  TransactionExecutionClaimOwnerV1Schema,
} from "@flarex/persistence-postgres/transaction-execution-claim";

import * as executorRoot from "../src";
import {
  createPointMutationExecutionClaimVaultV1,
  InvalidPointMutationExecutionClaimV1Error,
} from "../src/pointMutationExecutionClaim";
import { createPointMutationExecutionClaimDispatchAcquisitionV1 } from
  "../src/pointMutationExecutionClaimAcquisition";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

const DEPLOYMENT_ID = TransactionGrantDeploymentIdV1Schema.make(
  "deployment_execution_claim_unit",
);
const SCOPE_ID = ReplacementScopeIdV1Schema.make(
  "scope_73100000-0000-4000-8000-000000000001",
);
const SESSION_ID = TransactionSessionIdV1Schema.make(
  "73100000-0000-4000-8000-000000000002",
);
const ATTEMPT_FENCE = TransactionAttemptFenceSchema.make(3n);
const SELECTOR = Object.freeze({
  deploymentId: DEPLOYMENT_ID,
  scopeId: SCOPE_ID,
  sessionId: SESSION_ID,
  attemptFence: ATTEMPT_FENCE.toString(),
});
const OBSERVATION = Object.freeze({
  claimOwner: TransactionExecutionClaimOwnerV1Schema.make(
    "73100000-0000-4000-8000-000000000003",
  ),
  claimFence: TransactionExecutionClaimFenceV1Schema.make(4n),
  claimedAt: "2026-07-19T00:00:00.000Z",
  claimExpiresAt: "2026-07-19T00:01:00.000Z",
});

describe("B2b1/C06-A execution-claim capability projection", () => {
  it("stays off the root surface and rejects malformed selectors before I/O", async () => {
    type RootLeak = Extract<
      keyof typeof executorRoot,
      | "createPointMutationExecutionClaimVaultV1"
      | "createPointMutationExecutionClaimDispatchAcquisitionV1"
    >;
    expectTypeOf<RootLeak>().toEqualTypeOf<never>();
    let calls = 0;
    const acquisition = createPointMutationExecutionClaimDispatchAcquisitionV1(
      persistenceAcquisition(() => {
        calls += 1;
        return Effect.succeed({ kind: "busy", observation: OBSERVATION });
      }),
      createPointMutationExecutionClaimVaultV1().issuer,
    );

    await expect(runEffectFailure(acquisition.acquireEffect({
      ...SELECTOR,
      attemptFence: "0",
    }))).resolves.toMatchObject({
      _tag: "PointMutationExecutionClaimAcquisitionInputV1Error",
      reason: "invalidSelector",
    });
    expect(calls).toBe(0);
  });

  it("mints one frozen same-factory claim only from a settled acquisition", async () => {
    const claims = createPointMutationExecutionClaimVaultV1();
    const crossFactory = createPointMutationExecutionClaimVaultV1();
    expect(Object.keys(claims).sort()).toEqual(["admission", "issuer"]);
    expect(Object.isFrozen(claims)).toBe(true);
    expect(Object.isFrozen(claims.issuer)).toBe(true);
    expect(Object.isFrozen(claims.admission)).toBe(true);
    expect("mint" in claims.admission).toBe(false);
    expect("inspect" in claims.issuer).toBe(false);
    const sourceObservation = { ...OBSERVATION };
    const acquisition = createPointMutationExecutionClaimDispatchAcquisitionV1(
      persistenceAcquisition(() => Effect.succeed({
        kind: "acquired",
        mode: "execute",
        observation: sourceObservation,
      })),
      claims.issuer,
    );

    const result = await runEffect(acquisition.acquireEffect(SELECTOR));
    if (result.kind !== "acquired") {
      throw new Error("Expected a process-local acquired claim.");
    }
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.executionClaim)).toBe(true);
    sourceObservation.claimFence =
      TransactionExecutionClaimFenceV1Schema.make(99n);

    const cross = crossFactory.admission.admit(
      result.executionClaim,
      "execute",
    );
    expect(Result.isFailure(cross)).toBe(true);
    if (Result.isFailure(cross)) {
      expect(cross.failure).toBeInstanceOf(
        InvalidPointMutationExecutionClaimV1Error,
      );
      expect(cross.failure.reason).toBe("notSameFactory");
    }
    const admitted = claims.admission.admit(result.executionClaim, "execute");
    expect(Result.isSuccess(admitted)).toBe(true);
    if (Result.isFailure(admitted)) throw admitted.failure;
    expect(claims.admission.inspect(admitted.success, "execute"))
      .toMatchObject({
      _tag: "Success",
      success: {
        selector: {
          deploymentId: DEPLOYMENT_ID,
          scopeId: SCOPE_ID,
          sessionId: SESSION_ID,
          attemptFence: ATTEMPT_FENCE,
        },
        observation: OBSERVATION,
        mode: "execute",
      },
    });
    expect(claims.admission.admit(result.executionClaim, "execute"))
      .toMatchObject({
      _tag: "Failure",
      failure: { reason: "consumed" },
    });
  });

  it("passes inert closed outcomes through and mints nothing after failure", async () => {
    const claims = createPointMutationExecutionClaimVaultV1();
    for (const inert of [
      { kind: "busy" as const, observation: OBSERVATION },
      { kind: "nonDispatchable" as const, reason: "dirtyOpen" as const },
    ]) {
      const acquisition = createPointMutationExecutionClaimDispatchAcquisitionV1(
        persistenceAcquisition(() => Effect.succeed(inert)),
        claims.issuer,
      );
      const result = await runEffect(acquisition.acquireEffect(SELECTOR));
      expect(result).toEqual(inert);
      expect("executionClaim" in result).toBe(false);
    }

    const cause = new Error("claim acquisition unavailable");
    const acquisition = createPointMutationExecutionClaimDispatchAcquisitionV1(
      persistenceAcquisition(() => Effect.fail(
        new PointMutationExecutionClaimAcquisitionPersistenceV1Error({
          operation: "transaction",
          cause,
        }),
      )),
      claims.issuer,
    );
    await expect(runEffectFailure(acquisition.acquireEffect(SELECTOR)))
      .resolves.toMatchObject({
        _tag: "PointMutationExecutionClaimAcquisitionPersistenceV1Error",
        cause,
      });
  });
});

function persistenceAcquisition(
  acquireEffect: PointMutationExecutionClaimAcquisitionV1["acquireEffect"],
): PointMutationExecutionClaimAcquisitionV1 {
  return Object.freeze({ acquireEffect });
}
