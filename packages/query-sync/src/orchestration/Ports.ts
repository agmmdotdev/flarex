import type { Effect } from "effect";

import type {
  QueryEvaluationAttempt,
  QueryEvaluationEvidence,
} from "../kernel/Model.js";
import type { QueryPublicationArtifact } from "../kernel/Publication.js";
import type { QuerySyncTransitionState } from "../state/Port.js";
import type { QueryEvaluatorError } from "./Errors.js";

export interface QueryEvaluationArtifact {
  readonly evaluation: QueryEvaluationEvidence;
  readonly publication: QueryPublicationArtifact;
}

export interface EvaluationCallBudget {
  readonly remainingEvaluatorCallsIncludingThisCall: number;
  readonly maximumSettlementMilliseconds: number;
}

export interface QueryEvaluator {
  readonly evaluate: (
    attempt: QueryEvaluationAttempt,
    budget: EvaluationCallBudget,
  ) => Effect.Effect<QueryEvaluationArtifact, QueryEvaluatorError, never>;
}

export type QuerySyncOrchestrationState = Pick<
  QuerySyncTransitionState,
  | "initializeOrInspectNamespace"
  | "beginQueryEvaluation"
  | "applyAdmittedBatchAndAdvance"
  | "completeQueryEvaluation"
  | "claimEvaluationWork"
  | "recordEvaluationAttemptOutcome"
>;
