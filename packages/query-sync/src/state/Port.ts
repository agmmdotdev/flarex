import type { Effect } from "effect";

import type {
  ClaimEvaluationWorkError,
  EvaluationAttemptOutcome,
  EvaluationWorkScanRequest,
  RecordEvaluationAttemptOutcomeError,
} from "../kernel/EvaluationWork.js";
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
import type {
  AcceptedQueryPublicationEvidence,
  ClaimPublicationError,
  CompletePublicationError,
  PublicationAttempt,
  PublicationAttemptOutcome,
  RecordPublicationAttemptOutcomeError,
} from "../kernel/PublicationWork.js";
import type { QuerySyncStateIntegrationError } from "./Errors.js";
import type {
  ApplyAdmittedBatchReceipt,
  BeginQueryEvaluationReceipt,
  ClaimEvaluationWorkReceipt,
  ClaimPublicationReceipt,
  CompleteQueryEvaluationReceipt,
  CompletePublicationReceipt,
  InitializeNamespaceReceipt,
  RecordEvaluationAttemptOutcomeReceipt,
  RecordPublicationAttemptOutcomeReceipt,
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

  readonly claimEvaluationWork: (
    request: EvaluationWorkScanRequest,
  ) => Effect.Effect<
    ClaimEvaluationWorkReceipt,
    | ClaimEvaluationWorkError
    | QuerySyncStateIntegrationError<"claimEvaluationWork">,
    never
  >;

  readonly recordEvaluationAttemptOutcome: (
    attempt: QueryEvaluationAttempt,
    outcome: EvaluationAttemptOutcome,
  ) => Effect.Effect<
    RecordEvaluationAttemptOutcomeReceipt,
    | RecordEvaluationAttemptOutcomeError
    | QuerySyncStateIntegrationError<"recordEvaluationAttemptOutcome">,
    never
  >;

  readonly claimPublication: () => Effect.Effect<
    ClaimPublicationReceipt,
    | ClaimPublicationError
    | QuerySyncStateIntegrationError<"claimPublication">,
    never
  >;

  readonly recordPublicationAttemptOutcome: (
    attempt: PublicationAttempt,
    outcome: PublicationAttemptOutcome,
  ) => Effect.Effect<
    RecordPublicationAttemptOutcomeReceipt,
    | RecordPublicationAttemptOutcomeError
    | QuerySyncStateIntegrationError<"recordPublicationAttemptOutcome">,
    never
  >;

  readonly completePublication: (
    evidence: AcceptedQueryPublicationEvidence,
  ) => Effect.Effect<
    CompletePublicationReceipt,
    | CompletePublicationError
    | QuerySyncStateIntegrationError<"completePublication">,
    never
  >;
}
