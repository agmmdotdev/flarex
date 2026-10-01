import type {
  PointMutationSessionActivationResultV1,
  PreparedApplicationMutationSessionActivationV1,
  PreparedPointMutationSessionActivationV1,
} from "@flarex/persistence-postgres/transaction-session-activation";
import type {
  CanonicalApplicationMutationExecutionAuthorityV1,
} from "flarex-protocol/internal/application-mutation-authority-v1";
import type {
  InertApplicationMutationGrantEvidenceV1,
} from "flarex-protocol/internal/application-mutation-grant-v1";

import type {
  ActivatedPointMutationSessionV1,
} from "./pointMutationSessionActivation";
import type {
  PointMutationExecutionClaimV1,
} from "./pointMutationExecutionClaim";
import type { ConfirmedFiniteRootEntryCapture, PreparedFiniteSessionJournalEntry } from "@flarex/persistence-postgres/session-journal-store";
import type { PointMutationJournalV1 } from "./pointMutationJournal";

export interface ActivatedApplicationMutationSessionPreparationV1 {
  readonly executionAuthorityGeneration: "application_v1";
  readonly deploymentId: PreparedApplicationMutationSessionActivationV1["deploymentId"];
  readonly scopeId: PreparedApplicationMutationSessionActivationV1["scopeId"];
  readonly evidence: Omit<
    PreparedApplicationMutationSessionActivationV1["evidence"],
    "executionAuthority" | "verifiedGrant"
  > & {
    readonly executionAuthority:
      CanonicalApplicationMutationExecutionAuthorityV1;
    readonly grant: InertApplicationMutationGrantEvidenceV1;
  };
}

export type ActivatedPointMutationSessionPreparationV1 =
  | (PreparedPointMutationSessionActivationV1 & {
      readonly executionAuthorityGeneration: "legacy_dynamic_worker_v1";
    })
  | ActivatedApplicationMutationSessionPreparationV1;

export interface ActivatedPointMutationSessionStateV1 {
  readonly inspection: PointMutationSessionActivationResultV1;
  readonly prepared: ActivatedPointMutationSessionPreparationV1;
  readonly executionClaim?: PointMutationExecutionClaimV1;
  readonly finiteEntry?: Readonly<{
    capture: ConfirmedFiniteRootEntryCapture;
    preparation: PreparedFiniteSessionJournalEntry;
    journal: PointMutationJournalV1;
    executionClaim: PointMutationExecutionClaimV1;
  }>;
}

const activatedSessionStateByHandle = new WeakMap<
  object,
  ActivatedPointMutationSessionStateV1
>();

export function registerActivatedPointMutationSessionStateV1(
  handle: ActivatedPointMutationSessionV1,
  state: ActivatedPointMutationSessionStateV1,
): void {
  activatedSessionStateByHandle.set(handle, state);
}

export function getActivatedPointMutationSessionStateV1(
  value: unknown,
): ActivatedPointMutationSessionStateV1 | undefined {
  return typeof value === "object" && value !== null ? activatedSessionStateByHandle.get(value) : undefined;
}
