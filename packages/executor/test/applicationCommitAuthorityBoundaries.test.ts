import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  StoredCommitAuthorityCorruptionV1Error,
} from "../src/storedAttemptAuthentication";
import {
  applicationGrantPinsResult,
  type CommitAuthorityVerificationStateV1,
} from "../src/storedAttemptAuthentication/commitAuthorityVerification";
import {
  makeExactPointMutationExecutionOperationsV1,
  type ExactPointMutationExecutionOperationDependenciesV1,
} from "../src/storedAttemptAuthentication/exactPointMutationExecutionOperations";
import type {
  ExecuteExactPointMutationAttemptInputV1,
} from "../src/storedAttemptAuthentication/occRerunExecutionOperations";
import {
  PointMutationOccExecutionAuthorityCorruptionV1Error,
} from "../src/storedAttemptAuthentication/occRerunExecutionOperations";
import { runEffectFailure } from "./effectTestRuntime";

describe("Application commit-authority boundaries", () => {
  it("maps malformed Application grant pin scalars to typed corruption", () => {
    for (const sessionPatch of [
      { policyVersion: "" },
      { requestKey: "" },
    ]) {
      const state = {
        authority: {
          deploymentId: "deployment-test",
          scopeId: "scope_00000000-0000-0000-0000-000000000001",
          schemaVersionId: "schema-test",
        },
        session: {
          executionAuthorityGeneration: "application_v1",
          applicationExecutionAuthoritySha256: new Uint8Array(32),
          functionPath: "users:update",
          policyVersion: "policy_point_mutation_v1",
          identityAccessPolicySha256: new Uint8Array(32),
          validatedArgsValueCodecVersion: 1,
          validatedArgsSha256: new Uint8Array(32),
          requestKey: "request:test",
          requestSha256: new Uint8Array(32),
          authorizationRevocationEpoch: 0n,
          ...sessionPatch,
        },
      } as unknown as CommitAuthorityVerificationStateV1;
      const result = applicationGrantPinsResult(state, {
        executionAuthority: {
          activationSequence: "1",
          activeHeadSha256: "0".repeat(64),
        },
      } as never);

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toBeInstanceOf(
          StoredCommitAuthorityCorruptionV1Error,
        );
        expect(result.failure).toMatchObject({ reason: "sessionEvidenceInvalid" });
      }
    }
  });

  it("rejects mixed verified-evidence generation through the typed channel", async () => {
    const operations = makeExactPointMutationExecutionOperationsV1(
      Object.freeze({}) as ExactPointMutationExecutionOperationDependenciesV1,
    );
    const input = {
      executionEvidence: {
        session: {
          executionAuthorityGeneration: "legacy_dynamic_worker_v1",
          artifactRuntime: "dynamic-worker",
        },
      },
      verificationState: {
        session: { executionAuthorityGeneration: "legacy_dynamic_worker_v1" },
      },
      verifiedEvidence: { executionAuthorityGeneration: "application_v1" },
    } as unknown as ExecuteExactPointMutationAttemptInputV1<never, never>;

    const failure = await runEffectFailure(
      operations.executeExactPointMutationAttempt(input),
    );
    expect(failure).toBeInstanceOf(
      PointMutationOccExecutionAuthorityCorruptionV1Error,
    );
    expect(failure).toMatchObject({ reason: "runtimePinInvalid" });
  });
});
