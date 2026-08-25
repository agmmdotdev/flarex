import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";

import type {
  StoredPointMutationOccRerunAuthorizationV1,
} from "../src/storedAttemptAuthentication";
import type {
  AuthorizedPointMutationOccRerunStateV1,
} from "../src/storedAttemptAuthentication/capabilityState";
import {
  makeStoredPointMutationOccRerunExecutionOperationsV1,
  type StoredPointMutationOccRerunExecutionDependenciesV1,
} from
  "../src/storedAttemptAuthentication/occRerunExecutionOperations";
import { runEffect } from "./effectTestRuntime";

describe("stored point-mutation OCC rerun execution operations", () => {
  it("reuses the combined claim and admission operation after a conflict", async () => {
    const calls: string[] = [];
    const initialRerun = Object.freeze({});
    const nextRerun = Object.freeze({});
    const initialState = authorizedStateForTest(1n);
    const nextState = authorizedStateForTest(2n);
    const initialScope = Object.freeze({ scope: "initial" });
    const nextScope = Object.freeze({ scope: "next" });
    const conflict = Object.freeze({ conflict: true });
    const loadedEvidence = storedOccExecutionEvidenceForTest();
    const committedOutcome = Object.freeze({
      kind: "available",
      token: Object.freeze({ token: "committed" }),
      successfulResult: Object.freeze({ valueJson: null }),
    });
    const publicationResult = Object.freeze({
      kind: "replayed",
      token: committedOutcome.token,
      successfulResult: committedOutcome.successfulResult,
    });
    let outcomeCalls = 0;
    let evidenceCalls = 0;
    let kernelCalls = 0;

    const base = unsafeAuthorizationFacadeForTest({
      authorizePointMutationOccRerun: (observed: unknown) =>
        Effect.sync(() => {
          calls.push("authorize");
          expect(observed).toBe(conflict);
          return Object.freeze({
            kind: "authorized" as const,
            rerun: nextRerun,
            backoffUpperBoundMilliseconds: 200,
            backoffMilliseconds: 0,
          });
        }),
    });
    const execution =
      makeStoredPointMutationOccRerunExecutionOperationsV1(
        unsafeExecutionDependenciesForTest({
          base,
          claimAuthorizedPointMutationOccRerun: (input: unknown) => {
            calls.push(input === initialRerun ? "claim:initial" : "claim:next");
            return Result.succeed(
              input === initialRerun ? initialState : nextState,
            );
          },
          executionClaimAdmission: {
            admit: (claim: unknown) => {
              const initial = claim === initialState.executionClaim;
              calls.push(initial ? "admit:initial" : "admit:next");
              return Result.succeed(initial ? initialScope : nextScope);
            },
            inspect: (scope: unknown) => {
              calls.push(
                scope === initialScope ? "inspect:initial" : "inspect:next",
              );
              return Result.succeed(Object.freeze({
                observation: Object.freeze({
                  claimOwner: "owner",
                  claimFence: 1n,
                }),
              }));
            },
          },
          executionLiveness: {
            run: (
              scope: unknown,
              _mode: unknown,
              use: (control: unknown) => Effect.Effect<unknown, unknown>,
            ) => {
              calls.push(
                scope === initialScope ? "liveness:initial" : "liveness:next",
              );
              return use(Object.freeze({
                enterFinishing: (effect: unknown) => effect,
              }));
            },
          },
          executionEvidence: {
            loadEffect: () => Effect.sync(() => {
              evidenceCalls += 1;
              calls.push(`evidence:${evidenceCalls}`);
              return evidenceCalls === 1
                ? Object.freeze({
                    kind: "loaded" as const,
                    evidence: loadedEvidence,
                  })
                : Object.freeze({ kind: "alreadyCommitted" as const });
            }),
          },
          resolvePointMutationOccOutcome: () => Effect.sync(() => {
            outcomeCalls += 1;
            calls.push(`outcome:${outcomeCalls}`);
            return outcomeCalls < 3
              ? Object.freeze({ kind: "missing" as const })
              : committedOutcome;
          }),
          verifyCommitAuthorityEvidence: () => {
            calls.push("verify");
            return Effect.succeed(Object.freeze({ verified: true }));
          },
          executeExactPointMutationAttempt: () => Effect.sync(() => {
            kernelCalls += 1;
            calls.push("kernel");
            return Object.freeze({
              kind: "conflict" as const,
              error: conflict,
            });
          }),
          publicationResultFromCommittedOutcome: (outcome: unknown) => {
            calls.push("projectOutcome");
            expect(outcome).toBe(committedOutcome);
            return publicationResult;
          },
        }),
      );

    const result = await runEffect(
      execution.executeAuthorizedPointMutationOccRerun(initialRerun),
    );

    expect(result).toBe(publicationResult);
    expect(kernelCalls).toBe(1);
    expect(calls).toEqual([
      "claim:initial",
      "admit:initial",
      "outcome:1",
      "liveness:initial",
      "inspect:initial",
      "evidence:1",
      "verify",
      "kernel",
      "authorize",
      "claim:next",
      "admit:next",
      "outcome:2",
      "liveness:next",
      "inspect:next",
      "evidence:2",
      "outcome:3",
      "projectOutcome",
    ]);
  });
});

function authorizedStateForTest(
  attemptFence: bigint,
): AuthorizedPointMutationOccRerunStateV1 {
  const bytes = new Uint8Array([1]);
  const snapshotToken = Object.freeze({
    scopeId: "scope",
    epoch: "epoch",
    commitSeq: 1n,
  });
  return {
    loadedAttempt: Object.freeze({}),
    executionClaim: Object.freeze({ attemptFence }),
    lineage: {
      authorityPins: {
        deploymentId: "deployment",
        scopeId: "scope",
        sessionId: "session",
        attemptFence,
        storageGeneration: 1n,
        storageGenerationFence: 1n,
        snapshotToken,
        schemaVersionId: "schema",
      },
      scopeUuid: "scope-uuid",
      previousSession: {
        identityAccessPolicySha256: bytes,
        validatedArgsSha256: bytes,
        authorizationGrantSha256: bytes,
        requestSha256: bytes,
      },
    },
    conflict: Object.freeze({
      documentId: "document",
      snapshotCommitSeq: 1n,
      currentCommitSeq: 2n,
    }),
    inspection: Object.freeze({
      deploymentId: "deployment",
      scopeId: "scope",
      sessionId: "session",
      requestKey: "request",
      previousAttemptFence: attemptFence - 1n,
      attemptFence,
      previousSnapshotToken: snapshotToken,
      snapshotToken,
      conflictDocumentId: "document",
      conflictingCommitSeq: 2n,
    }),
  } as unknown as AuthorizedPointMutationOccRerunStateV1;
}

function storedOccExecutionEvidenceForTest(): unknown {
  const bytes = new Uint8Array([1]);
  return Object.freeze({
    session: Object.freeze({
      identityAccessPolicySha256: bytes,
      validatedArgsSha256: bytes,
      authorizationGrantSha256: bytes,
      requestSha256: bytes,
    }),
  });
}

function unsafeAuthorizationFacadeForTest(
  value: unknown,
): StoredPointMutationOccRerunAuthorizationV1 {
  return value as StoredPointMutationOccRerunAuthorizationV1;
}

function unsafeExecutionDependenciesForTest(
  value: unknown,
): StoredPointMutationOccRerunExecutionDependenciesV1 {
  return value as StoredPointMutationOccRerunExecutionDependenciesV1;
}
