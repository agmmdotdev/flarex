import { isNonBlankString } from "@flarex/utils/strings";
import { Data, Effect, Result } from "effect";

import type { FlarexMetadataDatabase } from "./deployments";
import type { LocatedRetainedHistoryFloorTarget } from
  "./retainedHistoryFloorObservation";
import {
  createRetainedHistoryMaintenancePort,
  inspectRetainedHistoryMaintenanceContinuationEffect,
  restoreRetainedHistoryMaintenanceContinuationEffect,
  runRetainedHistoryMaintenanceEffect,
  type RetainedHistoryMaintenanceConfigurationError,
  type RetainedHistoryMaintenancePolicy,
  type RetainedHistoryMaintenanceReceipt,
  type RunRetainedHistoryMaintenanceError,
} from "./retainedHistoryMaintenance";
import type {
  RetainedHistoryMaintenanceContinuationEvidenceV1,
} from "./retainedHistoryMaintenanceContinuationEvidenceV1";
import {
  createReplacementScopeDirectoryDiscoveryFromExecuteV1,
  type ReplacementScopeDirectoryCandidateV1,
  type ReplacementScopeDirectoryContinuationV1,
} from "./replacementScopeDirectoryDiscoveryV1";
import {
  captureTrustedScopeAuthorityResolutionPorts,
  resolveLocatedTrustedScopeAuthorityEffect,
  type TrustedScopeAuthorityPortError,
  type TrustedScopeAuthorityResolutionPorts,
} from "./scopeAuthorityResolution";

export type RetainedHistorySchedulerDirectoryContinuationV1 =
  ReplacementScopeDirectoryContinuationV1;

export class RetainedHistorySchedulerDirectoryInputError
  extends Data.TaggedError("RetainedHistorySchedulerDirectoryInputError")<{
    readonly reason: "invalidInput" | "continuationOrderingInvalid";
    readonly cause?: unknown;
  }> {}

export class RetainedHistorySchedulerDirectoryCorruptionError
  extends Data.TaggedError(
    "RetainedHistorySchedulerDirectoryCorruptionError",
  )<{
    readonly reason:
      | "driverResultInvalid"
      | "metadataInvalid"
      | "candidateOverflow"
      | "candidateOrderingInvalid";
    readonly cause?: unknown;
  }> {}

export class RetainedHistorySchedulerDirectorySqlError
  extends Data.TaggedError("RetainedHistorySchedulerDirectorySqlError")<{
    readonly operation: "discover";
    readonly cause: unknown;
  }> {}

export type RetainedHistorySchedulerDirectoryError =
  | RetainedHistorySchedulerDirectoryInputError
  | RetainedHistorySchedulerDirectoryCorruptionError
  | RetainedHistorySchedulerDirectorySqlError
  | TrustedScopeAuthorityPortError;

export type RetainedHistorySchedulerCandidateFailureReason =
  | "authorityUnavailable"
  | "candidateScopeMismatch";

export interface RetainedHistorySchedulerScopeMaintenance {
  readonly runEffect: (
    continuation: RetainedHistoryMaintenanceContinuationEvidenceV1 | null,
  ) => Effect.Effect<
    Readonly<{
      readonly receipt: RetainedHistoryMaintenanceReceipt;
      readonly continuation:
        | RetainedHistoryMaintenanceContinuationEvidenceV1
        | null;
    }>,
    RunRetainedHistoryMaintenanceError
  >;
}

export type RetainedHistorySchedulerDirectoryItem =
  | Readonly<{
      readonly kind: "ready";
      readonly deploymentId: string;
      readonly scopeId: ReplacementScopeDirectoryCandidateV1["scopeId"];
      readonly maximumPagesPerRun: number;
      readonly maintenance: RetainedHistorySchedulerScopeMaintenance;
    }>
  | Readonly<{
      readonly kind: "failed";
      readonly deploymentId: string;
      readonly scopeId: ReplacementScopeDirectoryCandidateV1["scopeId"];
      readonly reason: RetainedHistorySchedulerCandidateFailureReason;
    }>;

export interface RetainedHistorySchedulerDirectoryPage {
  readonly items: ReadonlyArray<RetainedHistorySchedulerDirectoryItem>;
  readonly continuation: RetainedHistorySchedulerDirectoryContinuationV1 | null;
}

export interface RetainedHistorySchedulerDirectory {
  readonly discoverEffect: (
    input: unknown,
  ) => Effect.Effect<
    RetainedHistorySchedulerDirectoryPage,
    RetainedHistorySchedulerDirectoryError
  >;
  readonly resolveEffect: (
    candidate: Readonly<{
      readonly deploymentId: string;
      readonly scopeId: ReplacementScopeDirectoryCandidateV1["scopeId"];
    }>,
  ) => Effect.Effect<
    RetainedHistorySchedulerDirectoryItem,
    TrustedScopeAuthorityPortError
  >;
}

export interface RetainedHistorySchedulerDirectoryOptions {
  readonly authority: TrustedScopeAuthorityResolutionPorts<
    LocatedRetainedHistoryFloorTarget
  >;
  readonly maintenance: RetainedHistoryMaintenancePolicy;
}

/**
 * O11-owned view of the generic replacement-scope directory. Candidate-local
 * authority failures are inert directory evidence; successful items expose
 * only the exact O11-E operation for that candidate.
 */
export function createRetainedHistorySchedulerDirectory(
  controlDb: FlarexMetadataDatabase,
  options: RetainedHistorySchedulerDirectoryOptions,
): Result.Result<
  RetainedHistorySchedulerDirectory,
  RetainedHistoryMaintenanceConfigurationError
> {
  const authorityInput = options.authority;
  const maintenanceInput = options.maintenance;
  const maintenancePolicy = Object.freeze({
    maximumPages: maintenanceInput.maximumPages,
    maximumElapsedMilliseconds: maintenanceInput.maximumElapsedMilliseconds,
  });
  const authority = captureTrustedScopeAuthorityResolutionPorts(
    authorityInput,
  );
  const controlDbOwner = controlDb;
  const executeMethod = controlDbOwner.execute;
  const execute = (
    statement: Parameters<typeof executeMethod>[0],
  ) => executeMethod.call(controlDbOwner, statement);
  return createRetainedHistoryMaintenancePort({
    authority,
    policy: maintenancePolicy,
  }).pipe(Result.map((maintenancePort) => {
    const directory = createReplacementScopeDirectoryDiscoveryFromExecuteV1<
      string,
      RetainedHistorySchedulerDirectoryError
    >(execute, {
      operationName: "RetainedHistorySchedulerDirectory.discoverScopes",
      input: (reason, cause) =>
        new RetainedHistorySchedulerDirectoryInputError({
          reason,
          ...(cause === undefined ? {} : { cause }),
        }),
      corruption: (reason, cause) =>
        new RetainedHistorySchedulerDirectoryCorruptionError({
          reason,
          ...(cause === undefined ? {} : { cause }),
        }),
      sql: (cause) => new RetainedHistorySchedulerDirectorySqlError({
        operation: "discover",
        cause,
      }),
      decodeDeploymentId: (value) =>
        isNonBlankString(value)
          ? Result.succeed(value)
          : Result.fail(
            new RetainedHistorySchedulerDirectoryCorruptionError({
              reason: "metadataInvalid",
            }),
          ),
    });

    const resolveCandidateEffect = Effect.fn(
      "RetainedHistorySchedulerDirectory.resolveCandidate",
    )(function* (candidate: ReplacementScopeDirectoryCandidateV1) {
      return yield* resolveLocatedTrustedScopeAuthorityEffect(
        candidate.deploymentId,
        authority,
      ).pipe(
        Effect.map((located) =>
          located.authority.scopeId !== candidate.scopeId
            ? failed(candidate, "candidateScopeMismatch")
            : ready(
              candidate,
              maintenancePolicy.maximumPages,
              maintenancePort,
            )
        ),
        Effect.catchTag(
          "TrustedScopeAuthorityResolutionError",
          () => Effect.succeed(failed(candidate, "authorityUnavailable")),
        ),
      );
    });

    const discoverEffect: RetainedHistorySchedulerDirectory["discoverEffect"] =
      Effect.fn("RetainedHistorySchedulerDirectory.discover")(
        function* (input) {
          const page = yield* directory.discoverEffect(input);
          const items: RetainedHistorySchedulerDirectoryItem[] = [];
          for (const candidate of page.candidates) {
            items.push(yield* resolveCandidateEffect(candidate));
          }
          return Object.freeze({
            items: Object.freeze(items),
            continuation: page.continuation,
          });
        },
      );

    const resolveEffect: RetainedHistorySchedulerDirectory["resolveEffect"] =
      Effect.fn("RetainedHistorySchedulerDirectory.resolve")(
        function* (candidate) {
          return yield* resolveCandidateEffect(Object.freeze({
            deploymentId: candidate.deploymentId,
            scopeId: candidate.scopeId,
          }));
        },
      );

    return Object.freeze({ discoverEffect, resolveEffect });
  }));
}

function ready(
  candidate: ReplacementScopeDirectoryCandidateV1,
  maximumPagesPerRun: number,
  port: Parameters<typeof runRetainedHistoryMaintenanceEffect>[0],
): Extract<RetainedHistorySchedulerDirectoryItem, { kind: "ready" }> {
  const runEffect: RetainedHistorySchedulerScopeMaintenance["runEffect"] =
    Effect.fn("RetainedHistorySchedulerDirectory.runScope")(
      function* (evidence) {
        const continuation = evidence === null
          ? null
          : yield* restoreRetainedHistoryMaintenanceContinuationEffect(
            port,
            evidence,
          );
        const receipt = yield* runRetainedHistoryMaintenanceEffect(
          port,
          candidate.deploymentId,
          continuation,
        );
        const nextEvidence = receipt.continuation === null
          ? null
          : yield* inspectRetainedHistoryMaintenanceContinuationEffect(
            port,
            receipt.continuation,
          );
        return Object.freeze({ receipt, continuation: nextEvidence });
      },
    );
  return Object.freeze({
    kind: "ready",
    deploymentId: candidate.deploymentId,
    scopeId: candidate.scopeId,
    maximumPagesPerRun,
    maintenance: Object.freeze({ runEffect }),
  });
}

function failed(
  candidate: ReplacementScopeDirectoryCandidateV1,
  reason: RetainedHistorySchedulerCandidateFailureReason,
): Extract<RetainedHistorySchedulerDirectoryItem, { kind: "failed" }> {
  return Object.freeze({
    kind: "failed",
    deploymentId: candidate.deploymentId,
    scopeId: candidate.scopeId,
    reason,
  });
}
