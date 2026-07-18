import type {
  PointMutationSessionAttemptFacetObservationV1,
} from "@flarex/persistence-postgres/transaction-session-activation";
import type { TransactionRequestKeyV1 } from
  "flarex-protocol/transaction-session";

import type {
  LoadedPointMutationSessionAttemptInspectionV1,
} from "./pointMutationSessionActivation";

export interface LoadedPointMutationSessionAttemptOccRerunInspectionV1
  extends LoadedPointMutationSessionAttemptInspectionV1 {
  readonly requestKey: TransactionRequestKeyV1;
  /** Temporal evidence only; this is never durable execution authority. */
  readonly attemptFacet: PointMutationSessionAttemptFacetObservationV1;
}

interface LoadedPointMutationSessionAttemptStateV1 {
  readonly publicInspection: LoadedPointMutationSessionAttemptInspectionV1;
  readonly occRerunInspection:
    LoadedPointMutationSessionAttemptOccRerunInspectionV1;
}

const loadedAttemptStateByHandle = new WeakMap<
  object,
  LoadedPointMutationSessionAttemptStateV1
>();

export function registerLoadedPointMutationSessionAttemptStateV1(
  handle: object,
  publicInspection: LoadedPointMutationSessionAttemptInspectionV1,
  requestKey: TransactionRequestKeyV1,
  attemptFacet: PointMutationSessionAttemptFacetObservationV1,
): void {
  loadedAttemptStateByHandle.set(handle, Object.freeze({
    publicInspection,
    occRerunInspection: Object.freeze({
      ...publicInspection,
      requestKey,
      attemptFacet: Object.freeze({ kind: attemptFacet.kind }),
    }),
  }));
}

export function getLoadedPointMutationSessionAttemptInspectionV1(
  value: object,
): LoadedPointMutationSessionAttemptInspectionV1 | undefined {
  return loadedAttemptStateByHandle.get(value)?.publicInspection;
}

export function getLoadedPointMutationSessionAttemptOccRerunInspectionV1(
  value: object,
): LoadedPointMutationSessionAttemptOccRerunInspectionV1 | undefined {
  return loadedAttemptStateByHandle.get(value)?.occRerunInspection;
}
