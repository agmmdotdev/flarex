import { Effect, Option, Result } from "effect";

import {
  FrameworkSchemaArtifactControlSessionDeadlineIssue,
  FrameworkSchemaArtifactControlSessionDecisionUncertainIssue,
  FrameworkSchemaArtifactControlSessionResourceIssue,
  type FrameworkSchemaArtifactControlSessionPhase,
} from "./controlSession";
import {
  FrameworkSchemaArtifactError,
  FrameworkSchemaArtifactInvariantDefect,
  type FrameworkSchemaArtifactPersistenceStage,
} from "./errors";
import { runLockedFrameworkSchemaArtifactAdmissionEffect } from
  "./lockedAdmission";
import type { FrameworkSchemaArtifact } from "./model";
import {
  classifyFrameworkSchemaArtifactReplay,
  type DecodedFrameworkSchemaArtifactIdentity,
} from "./policy";
import {
  getPreparedFrameworkSchemaArtifactAdmissionEvidence,
  runFrameworkSchemaArtifactRepositoryAdmissionEffect,
  type FrameworkSchemaArtifactAdmissionEvidence,
  type FrameworkSchemaArtifactRepository,
  type PreparedFrameworkSchemaArtifactAdmission,
} from "./repository";
import {
  loadStoredFrameworkSchemaArtifactEffect,
  type DetachedStoredFrameworkSchemaArtifact,
  type FrameworkSchemaArtifactStoredQueryIssue,
} from "./storedLoader";
import {
  reconstructStoredFrameworkSchemaArtifactEffect,
  type FrameworkSchemaArtifactStoredIssue,
} from "./storedCodec";

export interface FrameworkSchemaArtifactAdmissionResult {
  readonly status: "created" | "existing";
  readonly artifact: FrameworkSchemaArtifact;
}

type FrameworkSchemaArtifactAdmissionWorkFailure =
  | FrameworkSchemaArtifactError
  | FrameworkSchemaArtifactStoredIssue
  | FrameworkSchemaArtifactStoredQueryIssue;

type FrameworkSchemaArtifactAdmissionFailure =
  | FrameworkSchemaArtifactAdmissionWorkFailure
  | FrameworkSchemaArtifactControlSessionDeadlineIssue
  | FrameworkSchemaArtifactControlSessionResourceIssue
  | FrameworkSchemaArtifactControlSessionDecisionUncertainIssue;

type AdmissionLifecycleMode = "read" | "transaction";

/** Private immutable artifact admission facade. */
export const admitFrameworkSchemaArtifactEffect = Effect.fn(
  "FrameworkSchemaArtifactRepository.admitArtifact",
)((
  repository: FrameworkSchemaArtifactRepository,
  prepared: PreparedFrameworkSchemaArtifactAdmission,
): Effect.Effect<
  FrameworkSchemaArtifactAdmissionResult,
  FrameworkSchemaArtifactError,
  never
> => Effect.suspend(() => {
  let evidence: FrameworkSchemaArtifactAdmissionEvidence | undefined;
  let activeStage: FrameworkSchemaArtifactPersistenceStage = "readArtifact";
  let lifecycleMode: AdmissionLifecycleMode = "read";
  let activeAttempt: "initial" | "recovery" = "initial";
  let pendingResolutionRead = false;

  return runFrameworkSchemaArtifactRepositoryAdmissionEffect<
    FrameworkSchemaArtifactAdmissionEvidence,
    DetachedStoredFrameworkSchemaArtifact | null,
    FrameworkSchemaArtifact,
    FrameworkSchemaArtifactAdmissionWorkFailure
  >(repository, {
    prepareEffect: () => Effect.fromResult(
      getPreparedFrameworkSchemaArtifactAdmissionEvidence(prepared),
    ).pipe(Effect.tap(preparedEvidence => Effect.sync(() => {
      evidence = preparedEvidence;
    }))),
    queryAndDetachOptimisticEffect: (database, preparedEvidence) => {
      lifecycleMode = "read";
      activeStage = "readArtifact";
      return loadStoredFrameworkSchemaArtifactEffect(database, {
        decodedIdentity: decodedIdentityFromEvidence(preparedEvidence),
        observePersistenceStage: stage => {
          activeStage = stage;
        },
      });
    },
    reconstructOptimisticEffect: (detached, preparedEvidence) => {
      if (detached === null) {
        lifecycleMode = "transaction";
        activeStage = "transaction";
        return Effect.succeed(Option.none());
      }
      activeStage = "reconstructArtifact";
      return reconstructAndClassifyExistingEffect(
        detached,
        preparedEvidence,
      ).pipe(Effect.map(Option.some));
    },
    runLockedEffect: (
      transaction,
      preparedEvidence,
      attempt,
    ) => Effect.suspend(() => {
      lifecycleMode = "transaction";
      activeAttempt = attempt;
      activeStage = "transaction";
      return runLockedFrameworkSchemaArtifactAdmissionEffect(
        repository,
        transaction,
        {
          evidence: preparedEvidence,
          observePersistenceStage: stage => {
            activeStage = stage;
          },
        },
      ).pipe(Effect.tap(decision => Effect.sync(() => {
        pendingResolutionRead = decision.kind !== "created";
      })));
    }),
    resolveExistingEffect: (database, preparedEvidence) => {
      lifecycleMode = "read";
      activeStage = "readArtifact";
      pendingResolutionRead = false;
      return loadStoredFrameworkSchemaArtifactEffect(database, {
        decodedIdentity: decodedIdentityFromEvidence(preparedEvidence),
        observePersistenceStage: stage => {
          activeStage = stage;
        },
      }).pipe(Effect.flatMap((detached) => {
        if (detached === null) {
          return Effect.fail(
            FrameworkSchemaArtifactError.admissionStoredStateCorrupt(
              preparedEvidence.identity,
              "artifactRow",
            ),
          );
        }
        activeStage = "reconstructArtifact";
        return reconstructAndClassifyExistingEffect(
          detached,
          preparedEvidence,
        );
      }));
    },
  }).pipe(
    Effect.map(result => Object.freeze({
      status: result.status,
      artifact: result.value,
    })),
    Effect.mapError((failure: FrameworkSchemaArtifactAdmissionFailure) =>
      mapAdmissionFailure(
        failure,
        evidence,
        activeStage,
        lifecycleMode,
        activeAttempt,
        pendingResolutionRead,
      )
    ),
  );
}));

function decodedIdentityFromEvidence(
  evidence: FrameworkSchemaArtifactAdmissionEvidence,
): DecodedFrameworkSchemaArtifactIdentity {
  return Object.freeze({
    identity: evidence.identity,
    artifactSha256Bytes: evidence.artifactSha256Bytes,
  });
}

function reconstructAndClassifyExistingEffect(
  detached: DetachedStoredFrameworkSchemaArtifact,
  evidence: FrameworkSchemaArtifactAdmissionEvidence,
): Effect.Effect<
  FrameworkSchemaArtifact,
  FrameworkSchemaArtifactError | FrameworkSchemaArtifactStoredIssue,
  never
> {
  return reconstructStoredFrameworkSchemaArtifactEffect(
    evidence.identity,
    detached.artifactRow,
    detached.dependencyRows,
  ).pipe(Effect.flatMap((existing) => {
    const classification = classifyFrameworkSchemaArtifactReplay(
      existing,
      evidence.artifact,
    );
    return Result.match(classification, {
      onFailure: failure =>
        failure.operation === "classifyReplay" &&
          failure.reason === "digestCollision"
          ? Effect.fail(
            FrameworkSchemaArtifactError.admissionDigestCollision(
              evidence.identity,
            ),
          )
          : Effect.die(new FrameworkSchemaArtifactInvariantDefect({
            reason: "unexpectedAdmissionFailure",
          })),
      onSuccess: replayClassification => replayClassification === "exact"
        ? Effect.succeed(existing)
        : Effect.die(new FrameworkSchemaArtifactInvariantDefect({
          reason: "unexpectedAdmissionFailure",
        })),
    });
  }));
}

function mapAdmissionFailure(
  failure: FrameworkSchemaArtifactAdmissionFailure,
  evidence: FrameworkSchemaArtifactAdmissionEvidence | undefined,
  activeStage: FrameworkSchemaArtifactPersistenceStage,
  lifecycleMode: AdmissionLifecycleMode,
  activeAttempt: "initial" | "recovery",
  pendingResolutionRead: boolean,
): FrameworkSchemaArtifactError {
  if (failure instanceof FrameworkSchemaArtifactError) return failure;
  if (evidence === undefined) {
    throw new FrameworkSchemaArtifactInvariantDefect({
      reason: "unexpectedAdmissionFailure",
    });
  }
  if (
    failure instanceof
      FrameworkSchemaArtifactControlSessionDecisionUncertainIssue
  ) {
    return FrameworkSchemaArtifactError.admissionDecisionUncertain(
      evidence.identity,
      failure.stage,
      failure.initialSettlementCause,
      failure.resolutionCause,
    );
  }
  if (failure instanceof FrameworkSchemaArtifactControlSessionDeadlineIssue) {
    return FrameworkSchemaArtifactError.admissionResourceFailure(
      evidence.identity,
      lifecycleStage(
        failure.phase,
        activeStage,
        lifecycleMode,
        activeAttempt,
        pendingResolutionRead,
      ),
      failure,
    );
  }
  if (failure instanceof FrameworkSchemaArtifactControlSessionResourceIssue) {
    return FrameworkSchemaArtifactError.admissionResourceFailure(
      evidence.identity,
      lifecycleStage(
        failure.phase,
        activeStage,
        lifecycleMode,
        activeAttempt,
        pendingResolutionRead,
      ),
      failure,
    );
  }
  switch (failure._tag) {
    case "FrameworkSchemaArtifactStoredQueryIssue":
      return FrameworkSchemaArtifactError.admissionResourceFailure(
        evidence.identity,
        failure.persistenceStage,
        failure.cause,
      );
    case "FrameworkSchemaArtifactStoredCorruptionIssue":
      return FrameworkSchemaArtifactError.admissionStoredStateCorrupt(
        evidence.identity,
        failure.storedStage,
      );
    case "FrameworkSchemaArtifactStoredResourceIssue":
      return FrameworkSchemaArtifactError.admissionResourceFailure(
        evidence.identity,
        failure.persistenceStage,
        failure.cause,
      );
  }
}

function lifecycleStage(
  phase: FrameworkSchemaArtifactControlSessionPhase,
  activeStage: FrameworkSchemaArtifactPersistenceStage,
  lifecycleMode: AdmissionLifecycleMode,
  activeAttempt: "initial" | "recovery",
  pendingResolutionRead: boolean,
): FrameworkSchemaArtifactPersistenceStage {
  if (
    lifecycleMode === "transaction" &&
    (phase === "commit" ||
      phase === "rollback" ||
      phase === "release" ||
      phase === "quarantine")
  ) {
    return activeAttempt === "recovery" ? "recover" : "settle";
  }
  if (
    lifecycleMode === "transaction" &&
    pendingResolutionRead &&
    (phase === "acquire" ||
      phase === "configureReadBudget" ||
      phase === "read")
  ) {
    return "readArtifact";
  }
  return activeStage;
}
