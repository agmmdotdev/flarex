import {
  PointMutationExecutionClaimAcquisitionStaleV1Error,
} from "@flarex/persistence-postgres/transaction-session-activation";
import { Effect, Result } from "effect";
import { ReplacementScopeIdV1Schema } from
  "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from
  "flarex-protocol/transaction-grant";
import {
  TransactionAttemptFenceSchema,
  TransactionSessionIdV1Schema,
} from "flarex-protocol/transaction-session";
import { describe, expect, it } from "vitest";

import {
  makeStoredPointMutationCrashRedispatchOperationsV1,
} from "../src/storedAttemptAuthentication/crashRedispatchOperations";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

const SELECTOR = Object.freeze({
  deploymentId: TransactionGrantDeploymentIdV1Schema.make(
    "deployment_crash_redispatch_unit",
  ),
  scopeId: ReplacementScopeIdV1Schema.make(
    "scope_95000000-0000-4000-8000-000000000010",
  ),
  sessionId: TransactionSessionIdV1Schema.make(
    "95000000-0000-4000-8000-000000000001",
  ),
  attemptFence: TransactionAttemptFenceSchema.make(1n),
});
const SELECTOR_INPUT = Object.freeze({
  ...SELECTOR,
  attemptFence: SELECTOR.attemptFence.toString(),
});

describe("stored point-mutation crash redispatch operations", () => {
  it("keeps replayed, busy, and finishing classifications inert", async () => {
    const replayedOutcome = Object.freeze({
      kind: "expired" as const,
      token: Object.freeze({ token: "replayed" }),
    });
    const replayedResult = Object.freeze({
      kind: "expired" as const,
      token: replayedOutcome.token,
    });
    const finishingResult = Object.freeze({
      kind: "replayed" as const,
      token: Object.freeze({ token: "finishing" }),
      successfulResult: Object.freeze({ valueJson: null }),
    });
    const cases = [
      {
        name: "replayed",
        acquisition: Object.freeze({
          kind: "replayed" as const,
          outcome: replayedOutcome,
        }),
        expected: replayedResult,
      },
      {
        name: "busy",
        acquisition: Object.freeze({
          kind: "busy" as const,
          observation: Object.freeze({
            claimOwner: "owner",
            claimFence: 1n,
          }),
        }),
        expected: Object.freeze({ kind: "busy" as const }),
      },
      {
        name: "finishing",
        acquisition: Object.freeze({ kind: "finishing" as const }),
        expected: finishingResult,
      },
    ] as const;

    for (const testCase of cases) {
      const calls: string[] = [];
      const operations = makeStoredPointMutationCrashRedispatchOperationsV1(
        unsafeCrashRedispatchDependenciesForTest({
          base: Object.freeze({}),
          acquisition: {
            acquireEffect: () => Effect.sync(() => {
              calls.push("acquire");
              return testCase.acquisition;
            }),
          },
          executionClaims: {
            admission: {
              admit: () => {
                calls.push("work-admit");
                throw new Error("inert branch admitted work");
              },
            },
            abortOnlyAdmission: {
              admit: () => {
                calls.push("abort-admit");
                throw new Error("inert branch admitted abort");
              },
            },
          },
          resumePointCommit: () => Effect.sync(() => {
            calls.push("resume");
            return finishingResult;
          }),
          publicationResultFromCommittedOutcome: () => {
            calls.push("project");
            return replayedResult;
          },
        }),
      );

      const result = await runEffect(
        operations.redispatchExactPointMutationAttempt(SELECTOR_INPUT),
      );

      if (testCase.name === "busy") {
        expect(result).toEqual(testCase.expected);
        expect(Object.isFrozen(result)).toBe(true);
      } else {
        expect(result).toBe(testCase.expected);
      }
      expect(calls).toEqual(testCase.name === "replayed"
        ? ["acquire", "project"]
        : testCase.name === "finishing"
        ? ["acquire", "resume"]
        : ["acquire"]);
    }
  });

  it("admits only the matching claim after an acquired classification", async () => {
    const stop = new Error("stop after admission");
    const claim = Object.freeze({ claim: true });
    const workScope = Object.freeze({ scope: "work" });
    const abortScope = Object.freeze({ scope: "abort" });
    const cases = [
      {
        mode: "execute" as const,
        expected: [
          "acquire",
          "work-admit:execute",
          "work-inspect:execute",
          "liveness:execute",
        ],
      },
      {
        mode: "finishOnly" as const,
        expected: [
          "acquire",
          "work-admit:finishOnly",
          "work-inspect:finishOnly",
          "liveness:finishOnly",
        ],
      },
      {
        mode: "abortOnly" as const,
        expected: [
          "acquire",
          "abort-admit",
          "abort-inspect",
          "load",
        ],
      },
    ] as const;

    for (const testCase of cases) {
      const calls: string[] = [];
      const operations = makeStoredPointMutationCrashRedispatchOperationsV1(
        unsafeCrashRedispatchDependenciesForTest({
          base: Object.freeze({}),
          acquisition: {
            acquireEffect: () => Effect.sync(() => {
              calls.push("acquire");
              return testCase.mode === "abortOnly"
                ? Object.freeze({
                    kind: "acquired" as const,
                    mode: testCase.mode,
                    reason: "dirtyOpen" as const,
                    executionClaim: claim,
                  })
                : Object.freeze({
                    kind: "acquired" as const,
                    mode: testCase.mode,
                    executionClaim: claim,
                  });
            }),
          },
          executionClaims: {
            admission: {
              admit: (candidate: unknown, mode: string) => {
                expect(candidate).toBe(claim);
                calls.push(`work-admit:${mode}`);
                return Result.succeed(workScope);
              },
              inspect: (scope: unknown, mode: string) => {
                expect(scope).toBe(workScope);
                calls.push(`work-inspect:${mode}`);
                return Result.succeed(Object.freeze({
                  selector: SELECTOR,
                }));
              },
            },
            abortOnlyAdmission: {
              admit: (candidate: unknown) => {
                expect(candidate).toBe(claim);
                calls.push("abort-admit");
                return Result.succeed(abortScope);
              },
              inspect: (scope: unknown) => {
                expect(scope).toBe(abortScope);
                calls.push("abort-inspect");
                return Result.succeed(Object.freeze({
                  selector: SELECTOR,
                  reason: "dirtyOpen" as const,
                }));
              },
            },
          },
          executionLiveness: {
            run: (_scope: unknown, mode: string) => {
              calls.push(`liveness:${mode}`);
              return Effect.fail(stop);
            },
          },
          attemptLoading: {
            load: () => {
              calls.push("load");
              return Effect.fail(stop);
            },
          },
        }),
      );

      await expect(runEffectFailure(
        operations.redispatchExactPointMutationAttempt(SELECTOR_INPUT),
      )).resolves.toBe(stop);
      expect(calls).toEqual(testCase.expected);
    }
  });

  it("closes an expired authority without admitting a claim", async () => {
    const calls: string[] = [];
    const operations = makeStoredPointMutationCrashRedispatchOperationsV1(
      unsafeCrashRedispatchDependenciesForTest({
        base: Object.freeze({}),
        acquisition: {
          acquireEffect: () => Effect.fail(
            new PointMutationExecutionClaimAcquisitionStaleV1Error({
              reason: "leaseExpired",
            }),
          ),
        },
        executionClaims: {
          admission: {
            admit: () => {
              calls.push("work-admit");
              throw new Error("expired branch admitted work");
            },
          },
          abortOnlyAdmission: {
            admit: () => {
              calls.push("abort-admit");
              throw new Error("expired branch admitted abort");
            },
          },
        },
        terminalization: {
          expire: (selector: unknown) => Effect.sync(() => {
            calls.push("expire");
            expect(selector).toEqual(SELECTOR_INPUT);
            return Object.freeze({
              terminal: Object.freeze({
                lifecycle: "expired" as const,
                terminalizedAt: "2026-07-24T00:00:00.000Z",
              }),
            });
          }),
        },
      }),
    );

    await expect(runEffect(
      operations.redispatchExactPointMutationAttempt(SELECTOR_INPUT),
    )).resolves.toEqual({
      kind: "closed",
      reason: "authorityExpired",
      lifecycle: "expired",
      terminalizedAt: "2026-07-24T00:00:00.000Z",
    });
    expect(calls).toEqual(["expire"]);
  });
});

function unsafeCrashRedispatchDependenciesForTest(
  value: unknown,
): Parameters<typeof makeStoredPointMutationCrashRedispatchOperationsV1>[0] {
  return value as
    Parameters<typeof makeStoredPointMutationCrashRedispatchOperationsV1>[0];
}
