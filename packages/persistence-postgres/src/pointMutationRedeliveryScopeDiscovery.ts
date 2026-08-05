import { Data, Result, Schema } from "effect";
import {
  TransactionGrantDeploymentIdV1Schema,
  type TransactionGrantDeploymentIdV1,
} from "flarex-protocol/transaction-grant";

import type { FlarexMetadataDatabase } from "./deployments";
import {
  MAX_REPLACEMENT_SCOPE_DIRECTORY_DISCOVERY_LIMIT_V1,
  buildReplacementScopeDirectoryDiscoveryStatementV1,
  createReplacementScopeDirectoryDiscoveryV1,
  type ReplacementScopeDirectoryCandidateV1,
  type ReplacementScopeDirectoryContinuationV1,
  type ReplacementScopeDirectoryCorruptionReasonV1,
  type ReplacementScopeDirectoryDiscoveryV1,
  type ReplacementScopeDirectoryInputReasonV1,
  type ReplacementScopeDirectoryPageV1,
} from "./replacementScopeDirectoryDiscoveryV1";

export const MAX_POINT_MUTATION_REDELIVERY_SCOPE_DISCOVERY_LIMIT_V1 =
  MAX_REPLACEMENT_SCOPE_DIRECTORY_DISCOVERY_LIMIT_V1;

/**
 * Pagination data only. Altering it can at most skip or repeat inert scope
 * hints. It grants no placement, claim, journal, lifecycle, or execution
 * authority.
 */
export type PointMutationRedeliveryScopeDiscoveryContinuationV1 =
  ReplacementScopeDirectoryContinuationV1;

/**
 * An inert control-plane locator. Exact per-scope authority is resolved again
 * by point-attempt discovery and only locked C06-A acquisition may mint an
 * execution capability.
 */
export type PointMutationRedeliveryScopeCandidateV1 =
  ReplacementScopeDirectoryCandidateV1<TransactionGrantDeploymentIdV1>;

export type PointMutationRedeliveryScopeDiscoveryPageV1 =
  ReplacementScopeDirectoryPageV1<TransactionGrantDeploymentIdV1>;

export interface PointMutationRedeliveryScopeDiscoveryV1
  extends ReplacementScopeDirectoryDiscoveryV1<
    TransactionGrantDeploymentIdV1,
    PointMutationRedeliveryScopeDiscoveryV1Error
  > {}

export class PointMutationRedeliveryScopeDiscoveryInputV1Error
  extends Data.TaggedError(
    "PointMutationRedeliveryScopeDiscoveryInputV1Error",
  )<{
    readonly reason: ReplacementScopeDirectoryInputReasonV1;
    readonly cause?: unknown;
  }> {}

export class PointMutationRedeliveryScopeDiscoveryCorruptionV1Error
  extends Data.TaggedError(
    "PointMutationRedeliveryScopeDiscoveryCorruptionV1Error",
  )<{
    readonly reason: ReplacementScopeDirectoryCorruptionReasonV1;
    readonly cause?: unknown;
  }> {}

export class PointMutationRedeliveryScopeDiscoverySqlV1Error
  extends Data.TaggedError(
    "PointMutationRedeliveryScopeDiscoverySqlV1Error",
  )<{
    readonly operation: "discover";
    readonly cause: unknown;
  }> {}

export type PointMutationRedeliveryScopeDiscoveryV1Error =
  | PointMutationRedeliveryScopeDiscoveryInputV1Error
  | PointMutationRedeliveryScopeDiscoveryCorruptionV1Error
  | PointMutationRedeliveryScopeDiscoverySqlV1Error;

const decodeDeploymentIdResult = Schema.decodeUnknownResult(
  TransactionGrantDeploymentIdV1Schema,
);

export function createPointMutationRedeliveryScopeDiscoveryV1(
  db: FlarexMetadataDatabase,
): PointMutationRedeliveryScopeDiscoveryV1 {
  return createReplacementScopeDirectoryDiscoveryV1<
    TransactionGrantDeploymentIdV1,
    PointMutationRedeliveryScopeDiscoveryV1Error
  >(db, {
    operationName: "PointMutationRedeliveryScopeDiscovery.discover",
    input: (reason, cause) =>
      new PointMutationRedeliveryScopeDiscoveryInputV1Error({
        reason,
        ...(cause === undefined ? {} : { cause }),
      }),
    corruption: (reason, cause) =>
      new PointMutationRedeliveryScopeDiscoveryCorruptionV1Error({
        reason,
        ...(cause === undefined ? {} : { cause }),
      }),
    sql: (cause) => new PointMutationRedeliveryScopeDiscoverySqlV1Error({
      operation: "discover",
      cause,
    }),
    decodeDeploymentId: (value) => decodeDeploymentIdResult(value).pipe(
      Result.mapError((cause) =>
        new PointMutationRedeliveryScopeDiscoveryCorruptionV1Error({
          reason: "metadataInvalid",
          cause,
        })
      ),
    ),
  });
}

export const buildPointMutationRedeliveryScopeDiscoveryStatementV1 =
  buildReplacementScopeDirectoryDiscoveryStatementV1;
