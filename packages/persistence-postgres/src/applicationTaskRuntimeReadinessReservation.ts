import { Data, Effect } from "effect";

import type { AppRowTransaction } from "./appRows";
import type { ApplicationAnalysisAuthority } from
  "./applicationAnalysisRegistration";
import {
  isApplicationTaskRuntimeReadinessSnapshotPort,
  type ApplicationTaskRuntimeReadinessSnapshot,
  type ApplicationTaskRuntimeReadinessSnapshotPort,
  type LoadApplicationTaskRuntimeReadinessSnapshotError,
} from "./applicationTaskRuntimeReadinessSnapshot";
import type { FlarexMetadataDatabase } from "./deployments";
import { runEffectTransaction } from "./effectTransaction";

export interface ReserveApplicationTaskRuntimeReadinessInput {
  readonly authority: ApplicationAnalysisAuthority;
  readonly revisionId: string;
}

export class ApplicationTaskRuntimeReadinessReservationError
  extends Data.TaggedError(
    "ApplicationTaskRuntimeReadinessReservationError",
  )<{
    readonly operation: "reserve";
    readonly reason:
      | "invalidComposition"
      | "resourceFailure"
      | "settlementUncertain";
    readonly retryable: boolean;
    readonly cause?: unknown;
  }> {}

export type ReserveApplicationTaskRuntimeReadinessError =
  | ApplicationTaskRuntimeReadinessReservationError
  | LoadApplicationTaskRuntimeReadinessSnapshotError;

export interface ApplicationTaskRuntimeReadinessReservationPort {
  readonly reserve: (
    input: ReserveApplicationTaskRuntimeReadinessInput,
  ) => Effect.Effect<
    ApplicationTaskRuntimeReadinessSnapshot | null,
    ReserveApplicationTaskRuntimeReadinessError
  >;
}

const reservationPorts = new WeakSet<object>();

/**
 * Builds the read-only transaction owner used before cold object verification.
 * The returned Effect cannot succeed until the Drizzle transaction settles.
 */
export function createApplicationTaskRuntimeReadinessReservationPort(
  db: FlarexMetadataDatabase,
  snapshot: ApplicationTaskRuntimeReadinessSnapshotPort,
): ApplicationTaskRuntimeReadinessReservationPort {
  const snapshotOwner = snapshot;
  const loadInTransaction = snapshot.loadInTransaction;
  const validSnapshot = isApplicationTaskRuntimeReadinessSnapshotPort(snapshot);
  const reserve = Effect.fn(
    "ApplicationTaskRuntimeReadinessReservation.reserve",
  )(function* (
    input: ReserveApplicationTaskRuntimeReadinessInput,
  ): Effect.fn.Return<
    ApplicationTaskRuntimeReadinessSnapshot | null,
    ReserveApplicationTaskRuntimeReadinessError
  > {
    if (!validSnapshot) {
      return yield* Effect.fail(reservationFailure(
        "invalidComposition",
        false,
      ));
    }
    let bodySucceeded = false;
    return yield* runEffectTransaction(
      callback => db.transaction(callback),
      "Application task-runtime readiness reservation rolled back.",
      (tx: AppRowTransaction) => loadInTransaction.call(
        snapshotOwner,
        tx,
        input.authority,
        input.revisionId,
      ).pipe(Effect.tap(() => Effect.sync(() => {
        bodySucceeded = true;
      }))),
      cause => reservationFailure(
        bodySucceeded ? "settlementUncertain" : "resourceFailure",
        bodySucceeded || retryableCause(cause),
        cause,
      ),
    );
  });
  const port = Object.freeze({ reserve });
  reservationPorts.add(port);
  return port;
}

export function isApplicationTaskRuntimeReadinessReservationPort(
  value: unknown,
): value is ApplicationTaskRuntimeReadinessReservationPort {
  return typeof value === "object" && value !== null &&
    reservationPorts.has(value);
}

function reservationFailure(
  reason: ApplicationTaskRuntimeReadinessReservationError["reason"],
  retryable: boolean,
  cause?: unknown,
): ApplicationTaskRuntimeReadinessReservationError {
  return new ApplicationTaskRuntimeReadinessReservationError({
    operation: "reserve",
    reason,
    retryable,
    ...(cause === undefined ? {} : { cause }),
  });
}

function retryableCause(cause: unknown): boolean {
  if (typeof cause !== "object" || cause === null) return false;
  let code: unknown;
  try {
    code = Reflect.get(cause, "code");
  } catch {
    return false;
  }
  return code === "40001" || code === "40P01" || code === "55P03" ||
    code === "57014" || code === "57P01" || code === "57P02" ||
    code === "57P03" || code === "08000" || code === "08001" ||
    code === "08003" || code === "08004" || code === "08006" ||
    code === "08007" || code === "08P01";
}
