import type { Effect } from "effect";

import type {
  AdmittedInvalidationBatch,
  BeginQueryEvaluationRequest,
  BuildQuerySyncStateError,
  GenerationRefreshEvidence,
  NamespaceCursor,
  QueryEvaluationAttempt,
  QueryEvaluationEvidence,
} from "../kernel/Model.js";
import type {
  ApplyInvalidationsError,
  BeginQueryEvaluationError,
  CompleteQueryEvaluationError,
} from "../kernel/Policy.js";
import type { QueryPublicationArtifact } from "../kernel/Publication.js";
import type { QuerySyncStateIntegrationError } from "./Errors.js";
import type {
  ApplyAdmittedBatchReceipt,
  BeginQueryEvaluationReceipt,
  CompleteQueryEvaluationReceipt,
  InitializeNamespaceReceipt,
} from "./Receipts.js";

export interface QuerySyncTransitionState {
  readonly initializeOrInspectNamespace: (
    bootstrapCursor: NamespaceCursor,
  ) => Effect.Effect<
    InitializeNamespaceReceipt,
    | BuildQuerySyncStateError
    | QuerySyncStateIntegrationError<"initializeOrInspectNamespace">,
    never
  >;

  readonly beginQueryEvaluation: (
    request: BeginQueryEvaluationRequest,
  ) => Effect.Effect<
    BeginQueryEvaluationReceipt,
    | BeginQueryEvaluationError
    | QuerySyncStateIntegrationError<"beginQueryEvaluation">,
    never
  >;

  readonly applyAdmittedBatchAndAdvance: (
    batch: AdmittedInvalidationBatch,
  ) => Effect.Effect<
    ApplyAdmittedBatchReceipt,
    | ApplyInvalidationsError
    | QuerySyncStateIntegrationError<"applyAdmittedBatchAndAdvance">,
    never
  >;

  readonly completeQueryEvaluation: (
    attempt: QueryEvaluationAttempt,
    evaluation: QueryEvaluationEvidence,
    refresh: GenerationRefreshEvidence,
    publication: QueryPublicationArtifact,
  ) => Effect.Effect<
    CompleteQueryEvaluationReceipt,
    | CompleteQueryEvaluationError
    | QuerySyncStateIntegrationError<"completeQueryEvaluation">,
    never
  >;
}
