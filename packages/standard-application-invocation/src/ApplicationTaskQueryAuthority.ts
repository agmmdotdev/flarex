import type {
  ApplicationActiveSelection,
  ApplicationActiveSelectionBasis,
  ApplicationActivationRepository,
} from "@flarex/persistence-postgres/internal/application-activation";
import { claimApplicationActiveSelection } from
  "@flarex/persistence-postgres/internal/application-activation";
import {
  decodeApplicationTaskRunCreationAuthorityV1,
  decodeApplicationTaskRuntimeTargetV1,
  type ApplicationTaskRunCreationAuthorityV1,
  type ApplicationTaskRuntimeTargetV1,
} from "@flarex/standard-application-definition/internal/application-task-binding-v1";
import { bytesEqualFullScan, encodeBytesToLowercaseHex } from
  "@flarex/utils/bytes";
import { Data, Effect, Result } from "effect";
import {
  normalizeFlarexValueV1,
  type CanonicalFlarexRuntimeValueV1,
} from "flarex-protocol/value";

export interface ApplicationTaskQueryLaunchEvidence {
  readonly creationAuthority: ApplicationTaskRunCreationAuthorityV1;
  readonly runtimeTarget: ApplicationTaskRuntimeTargetV1;
}

export type ApplicationTaskQuerySelectionBasis = Omit<Pick<
  ApplicationActiveSelectionBasis,
  | "authority"
  | "activationSequence"
  | "headSha256"
  | "readinessSha256"
  | "revisionId"
  | "candidateId"
  | "analysisId"
  | "sourceArtifactRootSha256"
  | "publicationSha256"
  | "taskCatalogSha256"
  | "taskCatalogBindingSha256"
  | "runtimeHostIdentity"
  | "compatibilityDate"
>, "authority"> & Readonly<{
  readonly authority: Pick<ApplicationActiveSelectionBasis["authority"], "scopeId">;
}>;

export class ApplicationTaskQueryAuthorityError extends Data.TaggedError(
  "ApplicationTaskQueryAuthorityError",
)<{
  readonly reason:
    | "invalidInput"
    | "activationUnavailable"
    | "invalidComposition"
    | "staleLaunch"
    | "queryFailed"
    | "invalidResult";
  readonly cause?: unknown;
}> {}

/**
 * Selection-bound query execution seam. Its future live adapter reuses the
 * Application query execution core; it is deliberately not the foreground
 * Action callback bundle and exposes no mutation or action operation.
 */
export interface ApplicationSelectionQueryPort<QueryFailure> {
  readonly runQuery: (
    selection: ApplicationActiveSelection,
    functionPath: string,
    argumentsValue: CanonicalFlarexRuntimeValueV1,
  ) => Effect.Effect<unknown, QueryFailure>;
}

export interface ApplicationTaskQueryAuthorityLive<QueryFailure> {
  readonly activation: Pick<
    ApplicationActivationRepository<unknown, unknown>,
    "readActive"
  >;
  readonly query: ApplicationSelectionQueryPort<QueryFailure>;
}

export interface ApplicationTaskQuerySession {
  readonly runQuery: (
    functionPath: string,
    argumentsValue: CanonicalFlarexRuntimeValueV1,
  ) => Effect.Effect<
    CanonicalFlarexRuntimeValueV1,
    ApplicationTaskQueryAuthorityError
  >;
}

export interface ApplicationTaskQueryAuthority {
  /**
   * Called exactly once by the post-launch composition. The returned session
   * no longer accepts launch identity and cannot be retargeted per callback.
   */
  readonly bindLaunch: (
    subject: ApplicationTaskQueryLaunchEvidence,
  ) => Result.Result<
    ApplicationTaskQuerySession,
    ApplicationTaskQueryAuthorityError
  >;
}

/**
 * Read-only Task callback authority. It reacquires and correlates the active
 * Application selection for every call; the launch subject never becomes an
 * ambient or fabricated selection capability.
 */
export function makeApplicationTaskQueryAuthority<QueryFailure>(
  live: ApplicationTaskQueryAuthorityLive<QueryFailure>,
): ApplicationTaskQueryAuthority {
  const activation = live.activation;
  const query = live.query;
  const bindLaunch: ApplicationTaskQueryAuthority["bindLaunch"] = subject =>
    captureLaunchEvidence(subject).pipe(Result.map(captured => {
      const runQuery: ApplicationTaskQuerySession["runQuery"] = Effect.fn(
        "ApplicationTaskQuerySession.runQuery",
      )(function* (functionPath, argumentsValue) {
        if (functionPath.trim().length === 0) {
          return yield* queryError("invalidInput");
        }
        const active = yield* activation.readActive().pipe(
          Effect.mapError(cause =>
            queryErrorValue("activationUnavailable", cause)
          ),
        );
        const basis = yield* Effect.fromResult(
          claimApplicationActiveSelection(active.selection).pipe(
            Result.mapError(cause =>
              queryErrorValue("invalidComposition", cause)
            ),
          ),
        );
        yield* Effect.fromResult(correlateApplicationTaskQuerySelection(
          captured,
          basis,
        ));
        const raw = yield* query.runQuery(
          active.selection,
          functionPath,
          argumentsValue,
        ).pipe(Effect.mapError(cause => queryErrorValue("queryFailed", cause)));
        return yield* Effect.try({
          try: () => normalizeFlarexValueV1(raw).value,
          catch: cause => queryErrorValue("invalidResult", cause),
        });
      });
      return Object.freeze({ runQuery });
    }));
  return Object.freeze({ bindLaunch });
}

function captureLaunchEvidence(
  subject: ApplicationTaskQueryLaunchEvidence,
): Result.Result<
  ApplicationTaskQueryLaunchEvidence,
  ApplicationTaskQueryAuthorityError
> {
  return Result.gen(function* () {
    const direct = yield* Result.try({
      try: () => Object.freeze({
        creationAuthority: subject.creationAuthority,
        runtimeTarget: subject.runtimeTarget,
      }),
      catch: cause => queryErrorValue("invalidInput", cause),
    });
    const creationAuthority = yield* decodeApplicationTaskRunCreationAuthorityV1(
      direct.creationAuthority,
    ).pipe(Result.mapError(cause => queryErrorValue("invalidInput", cause)));
    const runtimeTarget = yield* decodeApplicationTaskRuntimeTargetV1(
      direct.runtimeTarget,
    ).pipe(Result.mapError(cause => queryErrorValue("invalidInput", cause)));
    if (!runtimeTargetsEqual(creationAuthority.runtimeTarget, runtimeTarget)) {
      return yield* Result.fail(queryErrorValue("invalidComposition"));
    }
    return Object.freeze({ creationAuthority, runtimeTarget });
  });
}

export function correlateApplicationTaskQuerySelection(
  subject: ApplicationTaskQueryLaunchEvidence,
  basis: ApplicationTaskQuerySelectionBasis,
): Result.Result<void, ApplicationTaskQueryAuthorityError> {
  const authority = subject.creationAuthority;
  const target = subject.runtimeTarget;
  const matches = authority.scopeId === target.scopeId &&
    basis.authority.scopeId === authority.scopeId &&
    basis.activationSequence === authority.activationSequence &&
    bytesEqualFullScan(basis.headSha256, authority.activeHeadSha256) &&
    bytesEqualFullScan(basis.readinessSha256, authority.readinessSha256) &&
    runtimeTargetsEqual(authority.runtimeTarget, target) &&
    basis.revisionId === target.revisionId &&
    basis.candidateId === target.candidateId &&
    basis.analysisId === target.analysisId &&
    encodeBytesToLowercaseHex(basis.sourceArtifactRootSha256) ===
      target.sourceArtifactRootSha256 &&
    encodeBytesToLowercaseHex(basis.publicationSha256) ===
      target.publicationSha256 &&
    bytesEqualFullScan(basis.taskCatalogSha256, target.taskCatalogSha256) &&
    bytesEqualFullScan(
      basis.taskCatalogBindingSha256,
      target.applicationTaskCatalogBindingSha256,
    ) &&
    basis.runtimeHostIdentity === target.runtimeHostIdentity &&
    basis.compatibilityDate === target.compatibilityDate;
  return matches
    ? Result.succeed(undefined)
    : Result.fail(queryErrorValue("staleLaunch"));
}

function runtimeTargetsEqual(
  left: ApplicationTaskRuntimeTargetV1,
  right: ApplicationTaskRuntimeTargetV1,
): boolean {
  return left.version === right.version &&
    left.scopeId === right.scopeId &&
    left.revisionId === right.revisionId &&
    left.candidateId === right.candidateId &&
    left.analysisId === right.analysisId &&
    left.sourceArtifactRootSha256 === right.sourceArtifactRootSha256 &&
    left.publicationSha256 === right.publicationSha256 &&
    bytesEqualFullScan(
      left.applicationTaskCatalogBindingSha256,
      right.applicationTaskCatalogBindingSha256,
    ) &&
    bytesEqualFullScan(
      left.applicationTaskDefinitionBindingSha256,
      right.applicationTaskDefinitionBindingSha256,
    ) &&
    bytesEqualFullScan(left.taskCatalogSha256, right.taskCatalogSha256) &&
    left.taskId === right.taskId &&
    bytesEqualFullScan(
      left.canonicalTaskManifestSha256,
      right.canonicalTaskManifestSha256,
    ) &&
    left.handler.logicalModulePath === right.handler.logicalModulePath &&
    left.handler.sourceModulePath === right.handler.sourceModulePath &&
    left.handler.exportName === right.handler.exportName &&
    left.runtimeHostIdentity === right.runtimeHostIdentity &&
    left.compatibilityDate === right.compatibilityDate;
}

function queryError(
  reason: ApplicationTaskQueryAuthorityError["reason"],
  cause?: unknown,
): Effect.Effect<never, ApplicationTaskQueryAuthorityError> {
  return Effect.fail(queryErrorValue(reason, cause));
}

function queryErrorValue(
  reason: ApplicationTaskQueryAuthorityError["reason"],
  cause?: unknown,
): ApplicationTaskQueryAuthorityError {
  return new ApplicationTaskQueryAuthorityError({
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}
