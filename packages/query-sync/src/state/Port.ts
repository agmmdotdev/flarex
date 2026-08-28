import type { Effect } from "effect";

import type {
  AdmittedInvalidationBatch,
  BuildQuerySyncStateError,
  GenerationRefreshEvidence,
  NamespaceCursor,
  QueryEvaluationEvidence,
  QueryOperationTarget,
} from "../kernel/Model.js";
import type {
  ApplyInvalidationsError,
  BeginQueryGenerationError,
  CompleteQueryGenerationError,
} from "../kernel/Policy.js";
import type { QuerySyncStateIntegrationError } from "./Errors.js";
import type {
  ApplyAdmittedBatchReceipt,
  BeginQueryGenerationReceipt,
  CompleteQueryGenerationReceipt,
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

  readonly beginQueryGeneration: (
    target: QueryOperationTarget,
  ) => Effect.Effect<
    BeginQueryGenerationReceipt,
    | BeginQueryGenerationError
    | QuerySyncStateIntegrationError<"beginQueryGeneration">,
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

  readonly completeQueryGeneration: (
    evaluation: QueryEvaluationEvidence,
    refresh: GenerationRefreshEvidence,
  ) => Effect.Effect<
    CompleteQueryGenerationReceipt,
    | CompleteQueryGenerationError
    | QuerySyncStateIntegrationError<"completeQueryGeneration">,
    never
  >;
}
