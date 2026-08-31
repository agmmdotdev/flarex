import {
  QuerySyncStoredStateCorruptError,
  type QuerySyncTransitionState,
} from "@flarex/query-sync/internal/state";
import {
  authenticateCompletePublicationEvidence,
  authenticateRecordPublicationAttemptOutcomeAttempt,
  planCompletePublication,
  planRecordPublicationAttemptOutcome,
  resumeClaimPublicationInFlightOwner,
  resumeClaimPublicationPending,
  startClaimPublication,
  type AcceptedQueryPublicationEvidence,
  type ClaimPublicationPlan,
  type CompletePublicationPlan,
  type PlanCompletePublicationError,
  type PlanRecordPublicationAttemptOutcomeError,
  type PublicationAttempt,
  type PublicationAttemptOutcome,
  type RecordPublicationAttemptOutcomePlan,
  type ResumeClaimPublicationInFlightOwnerError,
  type ResumeClaimPublicationPendingError,
  type StartClaimPublicationError,
} from "@flarex/query-sync/internal/transition-plan";
import { Effect, Result } from "effect";

import type { DeploymentQuerySyncBinding } from "./Binding";
import {
  readDeploymentQuerySyncPublicationInstant,
  type DeploymentQuerySyncPublicationInstantReader,
} from "./PublicationClock";
import {
  readDeploymentQuerySyncLowestPendingPublication,
  readDeploymentQuerySyncPublicationLifecycle,
  readDeploymentQuerySyncPublicationOwner,
  writeDeploymentQuerySyncClaimPublicationPlan,
  writeDeploymentQuerySyncCompletePublicationPlan,
  writeDeploymentQuerySyncPublicationOutcomePlan,
} from "./PublicationStorage";
import {
  mapDeploymentQuerySyncTransitionFactError,
  requireDeploymentQuerySyncScope,
  runDeploymentQuerySyncTransaction,
  type BoundDeploymentQuerySyncStorage,
} from "./StateStorage";
import {
  readDeploymentQuerySyncContractState,
  type DeploymentQuerySyncSqlStorage,
} from "./StorageContract";

type PublicationOperations = Pick<
  QuerySyncTransitionState,
  | "claimPublication"
  | "recordPublicationAttemptOutcome"
  | "completePublication"
>;

type ClaimStateError = Effect.Error<ReturnType<
  QuerySyncTransitionState["claimPublication"]
>>;
type OutcomeStateError = Effect.Error<ReturnType<
  QuerySyncTransitionState["recordPublicationAttemptOutcome"]
>>;
type CompleteStateError = Effect.Error<ReturnType<
  QuerySyncTransitionState["completePublication"]
>>;

type ClaimPlannerError =
  | StartClaimPublicationError
  | ResumeClaimPublicationInFlightOwnerError
  | ResumeClaimPublicationPendingError;

export function makeDeploymentQuerySyncPublicationOperations(
  storage: BoundDeploymentQuerySyncStorage,
  binding: DeploymentQuerySyncBinding,
  readInstant: DeploymentQuerySyncPublicationInstantReader =
    readDeploymentQuerySyncPublicationInstant,
): PublicationOperations {
  const claimPublication = Effect.fn(
    "DeploymentQuerySyncState.claimPublication",
  )(() => runDeploymentQuerySyncTransaction(
    storage,
    sql => claimPublicationResult(sql, binding, readInstant),
  ));

  const recordPublicationAttemptOutcome = Effect.fn(
    "DeploymentQuerySyncState.recordPublicationAttemptOutcome",
  )((attempt: PublicationAttempt, outcome: PublicationAttemptOutcome) =>
    Effect.fromResult(
      authenticateRecordPublicationAttemptOutcomeAttempt(attempt),
    ).pipe(Effect.flatMap(authenticated => runDeploymentQuerySyncTransaction(
      storage,
      sql => recordPublicationAttemptOutcomeResult(
        sql,
        binding,
        authenticated.attempt,
        authenticated.queryKey,
        outcome,
        readInstant,
      ),
    )))
  );

  const completePublication = Effect.fn(
    "DeploymentQuerySyncState.completePublication",
  )((evidence: AcceptedQueryPublicationEvidence) => Effect.fromResult(
    authenticateCompletePublicationEvidence(evidence),
  ).pipe(Effect.flatMap(authenticated => runDeploymentQuerySyncTransaction(
    storage,
    sql => completePublicationResult(
      sql,
      binding,
      authenticated.evidence,
      authenticated.queryKey,
    ),
  ))));

  return Object.freeze({
    claimPublication,
    recordPublicationAttemptOutcome,
    completePublication,
  });
}

function claimPublicationResult(
  sql: DeploymentQuerySyncSqlStorage,
  binding: DeploymentQuerySyncBinding,
  readInstant: DeploymentQuerySyncPublicationInstantReader,
): Result.Result<
  Effect.Success<ReturnType<QuerySyncTransitionState["claimPublication"]>>,
  ClaimStateError
> {
  return Result.gen(function* () {
    const contract = yield* readDeploymentQuerySyncContractState(
      sql,
      "claimPublication",
    );
    const scope = yield* requireDeploymentQuerySyncScope(
      sql,
      binding,
      contract,
      "claimPublication",
      true,
    );
    const capturedNow = readInstant(sql, "claimPublication");
    const lifecycle = yield* readDeploymentQuerySyncPublicationLifecycle(
      sql,
      scope,
      "claimPublication",
    );
    const start = yield* startClaimPublication({
      scope: scope.facts,
      lifecycle,
      capturedNow,
    }).pipe(Result.mapError(mapClaimPlannerError));
    let plan: ClaimPublicationPlan;
    if (start.stage === "inFlightOwner") {
      const owner = yield* readDeploymentQuerySyncPublicationOwner(
        sql,
        scope,
        start.intent.identity.queryKey,
        "claimPublication",
      );
      plan = yield* resumeClaimPublicationInFlightOwner(
        start.resume,
        owner,
      ).pipe(Result.mapError(mapClaimPlannerError));
    } else {
      const selection = yield* readDeploymentQuerySyncLowestPendingPublication(
        sql,
        scope,
      );
      plan = yield* resumeClaimPublicationPending(
        start.resume,
        selection,
      ).pipe(Result.mapError(mapClaimPlannerError));
    }
    writeDeploymentQuerySyncClaimPublicationPlan(
      sql,
      binding,
      scope,
      plan,
    );
    return plan.receipt;
  });
}

function recordPublicationAttemptOutcomeResult(
  sql: DeploymentQuerySyncSqlStorage,
  binding: DeploymentQuerySyncBinding,
  attempt: PublicationAttempt,
  queryKey: PublicationAttempt["publication"]["identity"]["queryKey"],
  outcome: PublicationAttemptOutcome,
  readInstant: DeploymentQuerySyncPublicationInstantReader,
): Result.Result<
  Effect.Success<ReturnType<
    QuerySyncTransitionState["recordPublicationAttemptOutcome"]
  >>,
  OutcomeStateError
> {
  return Result.gen(function* () {
    const contract = yield* readDeploymentQuerySyncContractState(
      sql,
      "recordPublicationAttemptOutcome",
    );
    const scope = yield* requireDeploymentQuerySyncScope(
      sql,
      binding,
      contract,
      "recordPublicationAttemptOutcome",
      true,
    );
    const capturedNow = readInstant(sql, "recordPublicationAttemptOutcome");
    const lifecycle = yield* readDeploymentQuerySyncPublicationLifecycle(
      sql,
      scope,
      "recordPublicationAttemptOutcome",
    );
    const owner = yield* readDeploymentQuerySyncPublicationOwner(
      sql,
      scope,
      queryKey,
      "recordPublicationAttemptOutcome",
    );
    const plan: RecordPublicationAttemptOutcomePlan = yield*
      planRecordPublicationAttemptOutcome({
        scope: scope.facts,
        lifecycle,
        owner,
        attempt,
        outcome,
        capturedNow,
      }).pipe(Result.mapError(mapOutcomePlannerError));
    writeDeploymentQuerySyncPublicationOutcomePlan(
      sql,
      binding,
      scope,
      plan,
    );
    return plan.receipt;
  });
}

function completePublicationResult(
  sql: DeploymentQuerySyncSqlStorage,
  binding: DeploymentQuerySyncBinding,
  evidence: AcceptedQueryPublicationEvidence,
  queryKey: AcceptedQueryPublicationEvidence["identity"]["queryKey"],
): Result.Result<
  Effect.Success<ReturnType<QuerySyncTransitionState["completePublication"]>>,
  CompleteStateError
> {
  return Result.gen(function* () {
    const contract = yield* readDeploymentQuerySyncContractState(
      sql,
      "completePublication",
    );
    const scope = yield* requireDeploymentQuerySyncScope(
      sql,
      binding,
      contract,
      "completePublication",
      true,
    );
    const lifecycle = yield* readDeploymentQuerySyncPublicationLifecycle(
      sql,
      scope,
      "completePublication",
    );
    const owner = yield* readDeploymentQuerySyncPublicationOwner(
      sql,
      scope,
      queryKey,
      "completePublication",
    );
    const plan: CompletePublicationPlan = yield* planCompletePublication({
      scope: scope.facts,
      lifecycle,
      owner,
      evidence,
    }).pipe(Result.mapError(mapCompletePlannerError));
    writeDeploymentQuerySyncCompletePublicationPlan(
      sql,
      binding,
      scope,
      plan,
    );
    return plan.receipt;
  });
}

function mapClaimPlannerError(error: ClaimPlannerError): ClaimStateError {
  return error._tag === "QuerySyncTransitionFactError"
    ? mapDeploymentQuerySyncTransitionFactError("claimPublication", error)
    : error;
}

function mapOutcomePlannerError(
  error: PlanRecordPublicationAttemptOutcomeError,
): OutcomeStateError {
  return error._tag === "QuerySyncTransitionFactError"
    ? mapDeploymentQuerySyncTransitionFactError(
      "recordPublicationAttemptOutcome",
      error,
    )
    : error;
}

function mapCompletePlannerError(
  error: PlanCompletePublicationError,
): CompleteStateError {
  return error._tag === "QuerySyncTransitionFactError"
    ? mapDeploymentQuerySyncTransitionFactError("completePublication", error)
    : error;
}
