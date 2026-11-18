import { Data, Result } from "effect";
import type { AppIndexDefinitionRecord } from "../storage/indexes/appIndexDefinitions";
import type { FlarexMetadataDatabase } from "../application/deployments";
import type { PublishedPhysicalRequirementSnapshotV1 } from "../storage/indexes/indexBuildReconciliation";

export class InvalidIndexBuildReconciliationInputV1Error
  extends Data.TaggedError("InvalidIndexBuildReconciliationInputV1Error")<{
    readonly reason:
      | "invalidInputShape"
      | "invalidDeploymentId"
      | "invalidScopeId"
      | "invalidSchemaVersionId";
  }> {}

/** Package-private state owned by the verified published-requirement loader.
 * Reconciliation and definition location share this one original issuer. */
export const publishedPhysicalRequirementSnapshots = new WeakMap<
  object,
  Readonly<{ database: FlarexMetadataDatabase; definitions: readonly AppIndexDefinitionRecord[] }>
>();

/** Lend the original verified records only for their issuing database. This
 * authenticates a handle; it neither mints a snapshot nor reads live readiness. */
export const readPublishedPhysicalRequirementDefinitionRecordsResult = (
  snapshot: PublishedPhysicalRequirementSnapshotV1, database: FlarexMetadataDatabase,
): Result.Result<readonly AppIndexDefinitionRecord[], InvalidIndexBuildReconciliationInputV1Error> => {
  const state = publishedPhysicalRequirementSnapshots.get(snapshot);
  return state === undefined || state.database !== database
    ? Result.fail(new InvalidIndexBuildReconciliationInputV1Error({ reason: "invalidInputShape" }))
    : Result.succeed(state.definitions);
};
