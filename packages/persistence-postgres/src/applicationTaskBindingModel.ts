import type { PreparedApplicationTaskBindingsV1 } from
  "@flarex/standard-application-definition/internal/application-task-binding-v1";
import { Data } from "effect";

import type { ApplicationAnalysisAuthority } from
  "./applicationAnalysisRegistration";

export interface RegisterApplicationTaskBindingsInput {
  readonly authority: ApplicationAnalysisAuthority;
  readonly bindings: PreparedApplicationTaskBindingsV1;
}

export interface ApplicationTaskBindingRegistration {
  readonly scopeId: ApplicationAnalysisAuthority["scopeId"];
  readonly revisionId: string;
  readonly candidateId: string;
  readonly analysisId: string;
  readonly sourceArtifactRootSha256: string;
  readonly publicationSha256: string;
  readonly taskCatalogSha256: string;
  readonly taskCatalogBindingSha256: string;
  readonly taskCount: number;
  readonly runtimeHostIdentity: string;
  readonly compatibilityDate: string;
  readonly registeredAt: Date;
}

export class ApplicationTaskBindingPersistenceError extends Data.TaggedError(
  "ApplicationTaskBindingPersistenceError",
)<{
  readonly operation: "register";
  readonly reason:
    | "invalidInput"
    | "authorityChanged"
    | "publicationMissing"
    | "publicationMismatch"
    | "conflictingReplay"
    | "storedState"
    | "resourceFailure";
  readonly retryable: boolean;
  readonly cause?: unknown;
}> {}

export interface ApplicationTaskCatalogSnapshot {
  readonly scopeId: ApplicationAnalysisAuthority["scopeId"];
  readonly revisionId: string;
  readonly candidateId: string;
  readonly analysisId: string;
  readonly sourceArtifactRootSha256: Uint8Array;
  readonly publicationSha256: Uint8Array;
  readonly taskCatalogSha256: Uint8Array;
  readonly taskCatalogBindingSha256: Uint8Array;
  readonly taskCount: number;
  readonly runtimeHostIdentity: string;
  readonly compatibilityDate: string;
}

export class ApplicationTaskCatalogSnapshotError extends Data.TaggedError(
  "ApplicationTaskCatalogSnapshotError",
)<{
  readonly reason:
    | "invalidInput"
    | "authorityChanged"
    | "storedState"
    | "resourceFailure";
  readonly retryable: boolean;
  readonly cause?: unknown;
}> {}
