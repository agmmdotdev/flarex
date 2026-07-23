import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";
import { isNonEmptyString } from "@flarex/utils/strings";
import { Data, Effect } from "effect";
import type { DeploymentSqlStorage } from "../deployment/Store";

export interface SemanticArtifactV1SourceCorrelation {
  readonly uploadId: string;
  readonly generation: number;
  readonly mutationFence: number;
  readonly state: "finalized";
  readonly completedRootDigest: string;
  readonly completedSelectorDigest: string;
}

export class SemanticArtifactV1SourceCorrelationResourceError extends Data.TaggedError(
  "SemanticArtifactV1SourceCorrelationResourceError",
)<{ readonly uploadId: string }> {}

export class SemanticArtifactV1SourceCorrelationCorruptionError extends Data.TaggedError(
  "SemanticArtifactV1SourceCorrelationCorruptionError",
)<{ readonly uploadId: string }> {}

export class SemanticArtifactV1SourceCorrelationBudgetError extends Data.TaggedError(
  "SemanticArtifactV1SourceCorrelationBudgetError",
)<{ readonly uploadId: string; readonly observed: number; readonly maximum: number }> {}

export interface SemanticArtifactV1SourceCorrelationReader {
  readonly read: (
    uploadId: string,
    budget: SemanticArtifactV1SourceCorrelationReadBudget,
  ) => Effect.Effect<
    SemanticArtifactV1SourceCorrelation | null,
    SemanticArtifactV1SourceCorrelationBudgetError |
      SemanticArtifactV1SourceCorrelationCorruptionError |
      SemanticArtifactV1SourceCorrelationResourceError
  >;
}

export interface SemanticArtifactV1SourceCorrelationReadBudget {
  readonly maximumCalls: number;
  readonly maximumStoredBytes: number;
}

type SourceCorrelationMetadataRow = {
  stored_byte_length: number;
};

type SourceCorrelationRow = {
  upload_id: string;
  generation: number;
  mutation_fence: number;
  state: string;
  completed_root_digest: string | null;
  completed_selector_digest: string | null;
};

const resourceCause = new WeakMap<
  SemanticArtifactV1SourceCorrelationResourceError,
  unknown
>();

export function semanticArtifactV1SourceCorrelationResourceCause(
  error: SemanticArtifactV1SourceCorrelationResourceError,
): unknown {
  return resourceCause.get(error);
}

export function makeSemanticArtifactV1SourceCorrelationReader(
  sql: DeploymentSqlStorage,
): SemanticArtifactV1SourceCorrelationReader {
  const read = Effect.fn("SemanticArtifactV1SourceCorrelationReader.read")(
    function* (uploadId: string, budget: SemanticArtifactV1SourceCorrelationReadBudget) {
      if (
        typeof budget !== "object" ||
        budget === null ||
        !isNonNegativeSafeInteger(budget.maximumCalls) ||
        !isNonNegativeSafeInteger(budget.maximumStoredBytes) ||
        budget.maximumCalls < 1
      ) {
        return yield* Effect.fail(new SemanticArtifactV1SourceCorrelationBudgetError({
          uploadId,
          observed: 1,
          maximum: typeof budget === "object" &&
              budget !== null &&
              "maximumCalls" in budget &&
              isNonNegativeSafeInteger(budget.maximumCalls)
            ? budget.maximumCalls
            : 0,
        }));
      }
      const metadata = yield* Effect.try({
        try: () => sql.exec<SourceCorrelationMetadataRow>(`
          SELECT
            length(CAST(upload_id AS BLOB)) +
            length(CAST(state AS BLOB)) +
            COALESCE(length(CAST(completed_root_digest AS BLOB)), 0) +
            COALESCE(length(CAST(completed_selector_digest AS BLOB)), 0)
              AS stored_byte_length
          FROM source_artifact_upload_attempts_v2
          WHERE upload_id = ?
        `, uploadId).toArray()[0],
        catch: cause => resourceFailure(uploadId, cause),
      });
      if (metadata === undefined) return null;
      if (
        !isNonNegativeSafeInteger(metadata.stored_byte_length) ||
        metadata.stored_byte_length > budget.maximumStoredBytes
      ) {
        return yield* Effect.fail(new SemanticArtifactV1SourceCorrelationBudgetError({
          uploadId,
          observed: isNonNegativeSafeInteger(metadata.stored_byte_length)
            ? metadata.stored_byte_length
            : 0,
          maximum: budget.maximumStoredBytes,
        }));
      }
      if (budget.maximumCalls < 2) {
        return yield* Effect.fail(new SemanticArtifactV1SourceCorrelationBudgetError({
          uploadId,
          observed: 2,
          maximum: budget.maximumCalls,
        }));
      }
      const row = yield* Effect.try({
        try: () => sql.exec<SourceCorrelationRow>(`
          SELECT upload_id, generation, mutation_fence, state,
            completed_root_digest, completed_selector_digest
          FROM source_artifact_upload_attempts_v2
          WHERE upload_id = ?
        `, uploadId).toArray()[0],
        catch: cause => resourceFailure(uploadId, cause),
      });
      if (row === undefined) {
        return yield* Effect.fail(
          new SemanticArtifactV1SourceCorrelationCorruptionError({ uploadId }),
        );
      }
      if (
        !isNonEmptyString(row.upload_id) ||
        !isNonNegativeSafeInteger(row.generation) ||
        row.generation < 1 ||
        !isNonNegativeSafeInteger(row.mutation_fence) ||
        row.state !== "finalized" ||
        !digest(row.completed_root_digest) ||
        !digest(row.completed_selector_digest)
      ) {
        return yield* Effect.fail(
          new SemanticArtifactV1SourceCorrelationCorruptionError({ uploadId }),
        );
      }
      return Object.freeze({
        uploadId: row.upload_id,
        generation: row.generation,
        mutationFence: row.mutation_fence,
        state: "finalized" as const,
        completedRootDigest: row.completed_root_digest,
        completedSelectorDigest: row.completed_selector_digest,
      });
    },
  );
  return Object.freeze({ read });
}

function digest(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function resourceFailure(
  uploadId: string,
  cause: unknown,
): SemanticArtifactV1SourceCorrelationResourceError {
  const error = new SemanticArtifactV1SourceCorrelationResourceError({ uploadId });
  resourceCause.set(error, cause);
  return error;
}
