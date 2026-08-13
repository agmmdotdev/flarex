import type {
  PointMutationSessionActivationResultV1,
  PreparedPointMutationSessionActivationV1,
} from "@flarex/persistence-postgres/transaction-session-activation";
import type {
  StoredApplicationSessionScalarsV1,
  TransactionRequestKeyV1,
} from "flarex-protocol/transaction-session";
import type {
  CatalogSchemaVersionId,
} from "flarex-protocol/schema-manifest";

import type {
  PointMutationExecutionClaimV1,
} from "./pointMutationExecutionClaim";

interface ActivatedPointMutationSessionStateBaseV1 {
  readonly inspection: PointMutationSessionActivationResultV1;
  readonly executionClaim?: PointMutationExecutionClaimV1;
}

interface ActivatedLegacyPointMutationSessionStateV1
  extends ActivatedPointMutationSessionStateBaseV1 {
  readonly executionAuthorityGeneration: "legacy_dynamic_worker_v1";
  readonly prepared: PreparedPointMutationSessionActivationV1;
}

interface ActivatedApplicationPointMutationSessionStateV1
  extends ActivatedPointMutationSessionStateBaseV1 {
  readonly executionAuthorityGeneration: "application_v1";
  /** Owned exact Application authority used by the first stored-attempt load. */
  readonly initialSession: StoredApplicationSessionScalarsV1;
  /** Branded pins retained from the same captured Application evidence. */
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly requestKey: TransactionRequestKeyV1;
}

export type ActivatedPointMutationSessionStateV1 =
  | ActivatedLegacyPointMutationSessionStateV1
  | ActivatedApplicationPointMutationSessionStateV1;

const activatedSessionStateByHandle = new WeakMap<
  object,
  ActivatedPointMutationSessionStateV1
>();

export function registerActivatedPointMutationSessionStateV1(
  handle: object,
  state: ActivatedPointMutationSessionStateV1,
): void {
  activatedSessionStateByHandle.set(handle, state);
}

export function getActivatedPointMutationSessionStateV1(
  value: object,
): ActivatedPointMutationSessionStateV1 | undefined {
  return activatedSessionStateByHandle.get(value);
}
