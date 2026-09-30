import { Effect, Result } from "effect";
import type { prepareLogicalStorageReadiness } from "../../logicalStorageReadiness";
import type { readApplicationBindingEvidenceInTransaction } from "../../applicationBindingProjection";
import type { FlarexMetadataTransaction } from "../../metadataTransaction";
import type { TrustedScopeAuthority } from "../../scopeAuthorityResolution";
import type { ScopeClockRecord } from "../../scopeClock";
import type { CheckedApplicationActiveHead } from "../../applicationActiveHeadRead";
import type { DataBindingSetFrame } from "./model";
import { sameBindingValue } from "./canonical";
import { bindingError } from "./errors";

export type PreparedLogicalStorage = Extract<Effect.Success<ReturnType<typeof prepareLogicalStorageReadiness>>, { status: "prepared" }>;
export type SelectedLogicalStorageReadiness = Effect.Success<ReturnType<PreparedLogicalStorage["selectSources"]>>;

function verifyPreparedBinding(
  prepared: Pick<PreparedLogicalStorage, "applicationAnalysis" | "reference">, frame: DataBindingSetFrame,
  application: Effect.Success<ReturnType<typeof readApplicationBindingEvidenceInTransaction>>,
) {
  if (!sameBindingValue(frame.application, application.projection) ||
      !sameBindingValue(prepared.applicationAnalysis, application.analysis))
    return Result.fail(bindingError("staleApplication"));
  if (frame.logicalSchema === null || !sameBindingValue(frame.logicalSchema, prepared.reference))
    return Result.fail(bindingError("logicalSchemaMismatch"));
  return Result.succeed(undefined);
}

/** Shared accepting check. Call with fresh Application evidence under the
 * transaction's scope lock; this neither selects a head nor grants execution. */
export const verifyLogicalSchemaBindingInTransaction = Effect.fn("DataBinding.verifyLogicalSchema")(function* (
  prepared: PreparedLogicalStorage, frame: DataBindingSetFrame,
  application: Effect.Success<ReturnType<typeof readApplicationBindingEvidenceInTransaction>>,
  tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord,
  checkedActive?: CheckedApplicationActiveHead,
) {
  yield* Effect.fromResult(verifyPreparedBinding(prepared, frame, application));
  const readiness = yield* prepared.inspect(tx, authority, clock, checkedActive);
  if (readiness.status !== "ready") return yield* Effect.fail(bindingError("logicalSchemaNotReady", readiness));
  return readiness;
});

/** Private finite internal-read check. A selected readiness verdict is never
 * full entry, aggregate-seal or publication eligibility. */
export const verifyLogicalSchemaReadBindingInTransaction = Effect.fn("DataBinding.verifyLogicalSchemaRead")(function* (
  prepared: SelectedLogicalStorageReadiness, frame: DataBindingSetFrame,
  application: Effect.Success<ReturnType<typeof readApplicationBindingEvidenceInTransaction>>,
  tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord,
  checkedActive?: CheckedApplicationActiveHead,
) {
  yield* Effect.fromResult(verifyPreparedBinding(prepared, frame, application));
  const readiness = yield* prepared.inspectSelected(tx, authority, clock, checkedActive);
  if (readiness.status !== "ready") return yield* Effect.fail(bindingError("logicalSchemaNotReady", readiness));
  return readiness;
});
