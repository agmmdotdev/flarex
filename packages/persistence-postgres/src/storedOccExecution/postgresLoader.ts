import { copyBytes } from "@flarex/utils/bytes";
import { Effect } from "effect";

import { materializeOpenOccExecutionEffect } from "../storedCommitAuthority/materialization";
import {
  captureStoredCommitAuthorityRowsEffect,
  type StoredCommitAuthorityEvidenceLoaderOptionsV1,
  type StoredCommitAuthorityEvidenceLoaderPortsV1,
} from "../storedCommitAuthority/postgresLoader";
import {
  occExecutionAuthorityMismatch,
  occExecutionCorrupt,
  StoredOccExecutionEvidencePersistenceV1Error,
  type StoredOccExecutionEvidenceAuthorityV1,
  type StoredOccExecutionEvidenceLoaderV1,
} from "./model";

export type StoredOccExecutionEvidenceLoaderOptionsV1 =
  StoredCommitAuthorityEvidenceLoaderOptionsV1;

export function createStoredOccExecutionEvidenceLoaderV1(
  ports: StoredCommitAuthorityEvidenceLoaderPortsV1,
  options: StoredOccExecutionEvidenceLoaderOptionsV1 = {},
): StoredOccExecutionEvidenceLoaderV1 {
  const loadEffect = Effect.fn("StoredOccExecution.load")((
    input: StoredOccExecutionEvidenceAuthorityV1,
  ) =>
    Effect.gen(function* () {
      const authority = captureAuthority(input);
      const captured = yield* captureStoredCommitAuthorityRowsEffect(
        ports,
        authority,
        options,
        true,
      );
      if (captured.kind === "authorityMismatch") {
        return occExecutionAuthorityMismatch(captured.reason);
      }
      if (captured.kind === "corrupt") {
        return occExecutionCorrupt(captured.reason, captured.cause);
      }
      return yield* materializeOpenOccExecutionEffect(
        authority,
        captured.preliminaryAuthority,
        captured.rows,
        options,
      );
    }).pipe(
      Effect.mapError(
        (error) =>
          new StoredOccExecutionEvidencePersistenceV1Error({
            operation: error.operation,
            cause: error,
          }),
      ),
    ));

  return Object.freeze({ loadEffect });
}

function captureAuthority(
  input: StoredOccExecutionEvidenceAuthorityV1,
): StoredOccExecutionEvidenceAuthorityV1 {
  const common = {
    deploymentId: input.deploymentId,
    scopeId: input.scopeId,
    scopeUuid: input.scopeUuid,
    sessionId: input.sessionId,
    attemptFence: input.attemptFence,
    storageGeneration: input.storageGeneration,
    storageGenerationFence: input.storageGenerationFence,
    snapshotToken: Object.freeze({ ...input.snapshotToken }),
    schemaVersionId: input.schemaVersionId,
    executionClaim: Object.freeze({ ...input.executionClaim }),
  } as const;
  if (input.kind === "claimedAttempt") {
    return Object.freeze({ ...common, kind: "claimedAttempt" as const });
  }
  if (input.kind === "claimedRelationConflict") {
    return Object.freeze({
      ...common,
      kind: "claimedRelationConflict" as const,
    });
  }
  return Object.freeze({
        ...common,
        kind: "occRerun" as const,
        previousSession: Object.freeze({
          ...input.previousSession,
          identityAccessPolicySha256: copyBytes(
            input.previousSession.identityAccessPolicySha256,
          ),
          validatedArgsSha256: copyBytes(
            input.previousSession.validatedArgsSha256,
          ),
          authorizationGrantSha256: copyBytes(
            input.previousSession.authorizationGrantSha256,
          ),
          requestSha256: copyBytes(input.previousSession.requestSha256),
        }),
      });
}
