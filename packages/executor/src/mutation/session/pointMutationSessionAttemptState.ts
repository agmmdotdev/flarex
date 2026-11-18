import type {
  PointMutationSessionAttemptFacetObservationV1,
} from "@flarex/persistence-postgres/internal/session";
import type { TransactionRequestKeyV1 } from
  "flarex-protocol/transaction-session";
import type { MetadataSequence } from "flarex-protocol/commit-protocol";

import type {
  LoadedPointMutationSessionAttemptInspectionV1,
  LoadedPointMutationSessionAttemptV1,
} from "./pointMutationSessionActivation";

export interface LoadedPointMutationSessionAttemptOccRerunInspectionV1
  extends LoadedPointMutationSessionAttemptInspectionV1 {
  readonly requestKey: TransactionRequestKeyV1;
  /** Temporal evidence only; this is never durable execution authority. */
  readonly attemptFacet: PointMutationSessionAttemptFacetObservationV1;
  /** Actual sequencer observation from the loader or its confirmed entry transaction. */
  readonly lastMetadataSequence?: MetadataSequence;
}

interface LoadedPointMutationSessionAttemptStateV1 {
  readonly publicInspection: LoadedPointMutationSessionAttemptInspectionV1;
  readonly occRerunInspection:
    LoadedPointMutationSessionAttemptOccRerunInspectionV1;
}

const loadedAttemptStateByHandle = new WeakMap<
  LoadedPointMutationSessionAttemptV1,
  LoadedPointMutationSessionAttemptStateV1
>();

export function registerLoadedPointMutationSessionAttemptStateV1(
  handle: LoadedPointMutationSessionAttemptV1,
  publicInspection: LoadedPointMutationSessionAttemptInspectionV1,
  requestKey: TransactionRequestKeyV1,
  attemptFacet: PointMutationSessionAttemptFacetObservationV1,
  lastMetadataSequence?: MetadataSequence,
): void {
  loadedAttemptStateByHandle.set(handle, Object.freeze({
    publicInspection,
    occRerunInspection: Object.freeze({
      ...publicInspection,
      requestKey,
      attemptFacet: Object.freeze({ kind: attemptFacet.kind }),
      ...(lastMetadataSequence === undefined ? {} : { lastMetadataSequence }),
    }),
  }));
}

export function getLoadedPointMutationSessionAttemptInspectionV1(
  value: LoadedPointMutationSessionAttemptV1,
): LoadedPointMutationSessionAttemptInspectionV1 | undefined {
  return loadedAttemptStateByHandle.get(value)?.publicInspection;
}

export function getLoadedPointMutationSessionAttemptOccRerunInspectionV1(
  value: LoadedPointMutationSessionAttemptV1,
): LoadedPointMutationSessionAttemptOccRerunInspectionV1 | undefined {
  return loadedAttemptStateByHandle.get(value)?.occRerunInspection;
}
