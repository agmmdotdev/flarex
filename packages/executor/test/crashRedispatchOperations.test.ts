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
        mode: "replaceRelationConflict" as const,
        expected: [
          "acquire",
          "work-admit:replaceRelationConflict",
          "work-inspect:replaceRelationConflict",
          "liveness:replaceRelationConflict",
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

  it("recovers a durable relation conflict before using the existing retry path", async () => {
    const calls: string[] = [];
    const opaqueClaim = Object.freeze({ claim: "opaque" });
    const workScope = Object.freeze({ scope: "replacement" });
    const durableExecutionClaim = Object.freeze({
      claimOwner: "95000000-0000-4000-8000-000000000020",
      claimFence: 2n,
      claimedAt: "2026-07-24T00:00:00.000Z",
      claimExpiresAt: "2026-07-24T00:01:00.000Z",
    });
    const authority = Object.freeze({
      deploymentId: SELECTOR.deploymentId,
      scopeId: SELECTOR.scopeId,
      sessionId: SELECTOR.sessionId,
      attemptFence: SELECTOR.attemptFence,
      storageGeneration: "flarexdb_v1",
      storageGenerationFence: 1n,
      snapshotToken: Object.freeze({
        scopeId: SELECTOR.scopeId,
        epoch: "epoch_95000000-0000-4000-8000-000000000021",
        commitSeq: 1n,
      }),
      schemaVersionId: "schema_crash_relation_recovery",
      executionClaim: durableExecutionClaim,
    });
    const session = storedRunningSessionForRelationRecoveryTest();
    const storedEvidence = Object.freeze({ session });
    const request = Object.freeze({
      format: "flarex.session-journal-syscall",
      codecVersion: 1,
      kind: "relationIncoming",
      syscallSequence: 1n,
      relationId: "relation_crash_recovery",
      edgeDefinitionId: "edge_crash_recovery",
      sourceTableId: 1,
      targetTableId: 2,
      targetRowId: "00000000000000000000000000000001",
      limit: 8,
    });
    const conflict = Object.freeze({
      kind: "relationConflict",
      edgeDefinitionId: request.edgeDefinitionId,
      targetRowId: request.targetRowId,
      expectedAdjacencyVersion: 1n,
      actualAdjacencyVersion: 2n,
      snapshotCommitSeq: 1n,
    });
    const recoveredEvidence = Object.freeze({ request, conflict });
    const recoveredError = Object.freeze({ error: "recovered" });
    const rerun = Object.freeze({ rerun: "authorized" });
    const publication = Object.freeze({
      kind: "committed",
      token: Object.freeze({ token: "replacement" }),
    });
    let capturedTicket: unknown;

    const operations = makeStoredPointMutationCrashRedispatchOperationsV1(
      unsafeCrashRedispatchDependenciesForTest({
        base: Object.freeze({
          authorizePointMutationOccRerun: (error: unknown) =>
            Effect.sync(() => {
              calls.push("authorize");
              expect(error).toBe(recoveredError);
              expect(capturedTicket).toBeDefined();
              return Object.freeze({ kind: "authorized", rerun });
            }),
          executeAuthorizedPointMutationOccRerun: (input: unknown) =>
            Effect.sync(() => {
              calls.push("execute-rerun");
              expect(input).toBe(rerun);
              return publication;
            }),
        }),
        acquisition: {
          acquireEffect: () => Effect.sync(() => {
            calls.push("acquire");
            return Object.freeze({
              kind: "acquired",
              mode: "replaceRelationConflict",
              executionClaim: opaqueClaim,
            });
          }),
        },
        executionClaims: {
          admission: {
            admit: (candidate: unknown, mode: string) => {
              calls.push(`work-admit:${mode}`);
              expect(candidate).toBe(opaqueClaim);
              return Result.succeed(workScope);
            },
            inspect: (scope: unknown, mode: string) => {
              calls.push(`work-inspect:${mode}`);
              expect(scope).toBe(workScope);
              return Result.succeed(Object.freeze({
                selector: SELECTOR,
                mode,
              }));
            },
          },
        },
        executionLiveness: {
          run: (
            scope: unknown,
            mode: string,
            body: (control: unknown) => Effect.Effect<unknown, unknown>,
          ) => Effect.gen(function* () {
            calls.push(`liveness-enter:${mode}`);
            expect(scope).toBe(workScope);
            const result = yield* body(Object.freeze({}));
            calls.push(`liveness-exit:${mode}`);
            return result;
          }),
        },
        attemptLoading: {
          load: () => Effect.sync(() => {
            calls.push("load-attempt");
            return Object.freeze({ loaded: true });
          }),
        },
        deriveAuthority: () => Effect.sync(() => {
          calls.push("derive-authority");
          return Object.freeze({ handle: true });
        }),
        lookupAuthority: () => {
          calls.push("lookup-authority");
          return Object.freeze({ authority });
        },
        executionEvidence: {
          loadEffect: (input: { readonly kind?: string }) =>
            Effect.sync(() => {
              calls.push(`load-evidence:${input.kind}`);
              expect(input).toMatchObject({
                kind: "claimedRelationConflict",
                executionClaim: durableExecutionClaim,
              });
              return Object.freeze({
                kind: "loaded",
                evidence: storedEvidence,
              });
            }),
        },
        verifyCommitAuthorityEvidence: () => Effect.sync(() => {
          calls.push("verify-authority");
          return Object.freeze({ verified: true });
        }),
        runningRelationConflictRecovery: {
          recoverRunningRelationConflict: (command: unknown) =>
            Effect.sync(() => {
              calls.push("recover-conflict");
              expect(command).toMatchObject({
                authorityPins: {
                  attemptFence: SELECTOR.attemptFence,
                  snapshotToken: { commitSeq: 1n },
                },
                executionClaim: durableExecutionClaim,
              });
              return recoveredEvidence;
            }),
        },
        resolvePointCommitOutcomeFromStoredSession: () =>
          Effect.sync(() => {
            calls.push("recheck-outcome");
            return Object.freeze({ kind: "missing" });
          }),
        journalRelationConflictRecovery: {
          captureRecoveredRelationConflict: (evidence: unknown) => {
            calls.push("capture-journal-error");
            expect(evidence).toBe(recoveredEvidence);
            return recoveredError;
          },
        },
        captureRunningRelationConflictTicket: (
          error: unknown,
          captured: unknown,
        ) => {
          calls.push("capture-ticket");
          expect(error).toBe(recoveredError);
          capturedTicket = captured;
        },
        publicationResultFromCommittedOutcome: () => {
          throw new Error("missing outcome was projected");
        },
      }),
    );

    await expect(runEffect(
      operations.redispatchExactPointMutationAttempt(SELECTOR_INPUT),
    )).resolves.toBe(publication);
    expect(calls).toEqual([
      "acquire",
      "work-admit:replaceRelationConflict",
      "work-inspect:replaceRelationConflict",
      "liveness-enter:replaceRelationConflict",
      "load-attempt",
      "derive-authority",
      "lookup-authority",
      "load-evidence:claimedRelationConflict",
      "verify-authority",
      "recover-conflict",
      "recheck-outcome",
      "capture-journal-error",
      "capture-ticket",
      "liveness-exit:replaceRelationConflict",
      "authorize",
      "execute-rerun",
    ]);
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

function storedRunningSessionForRelationRecoveryTest() {
  const digest = new Uint8Array(32);
  return Object.freeze({
    lifecycle: "running" as const,
    storageGeneration: "flarexdb_v1",
    storageGenerationFence: 1n,
    functionPath: "mutation:crash-recovery",
    functionKind: "mutation",
    schemaVersionId: "schema_crash_relation_recovery",
    policyVersion: "policy_crash_relation_recovery",
    identityAccessPolicySha256: digest,
    validatedArgsValueCodecVersion: 1,
    validatedArgsCanonicalByteLength: 1,
    validatedArgsSha256: digest,
    authorizationGrantId: "grant_crash_relation_recovery",
    authorizationGrantValueCodecVersion: 1,
    authorizationGrantCanonicalByteLength: 1,
    authorizationGrantSha256: digest,
    authorizationRevocationEpoch: 0n,
    authorizationGrantExpiresAtMilliseconds: 2_000,
    requestKey: "request_crash_relation_recovery",
    requestSha256: digest,
    protocolVersion: 1,
    hardExpiresAtMilliseconds: 2_000,
    createdAtMilliseconds: 1_000,
    updatedAtMilliseconds: 1_001,
    executionAuthorityGeneration: "legacy_dynamic_worker_v1" as const,
    packageId: "package_crash_relation_recovery",
    artifactRuntime: "dynamic-worker",
    artifactId: "artifact_00000000000000000000000000000001",
    sourcePackageHash:
      "0000000000000000000000000000000000000000000000000000000000000001",
    executionModule: "module_crash_relation_recovery",
    validatedArgsJson: Object.freeze({}),
    validatedArgsCanonicalBytes: new Uint8Array([0]),
    authorizationGrantJson: Object.freeze({}),
    authorizationGrantCanonicalBytes: new Uint8Array([0]),
  });
}
