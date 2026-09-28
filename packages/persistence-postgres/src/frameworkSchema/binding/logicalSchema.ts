import { Effect } from "effect";
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

/** Shared accepting check. Call with fresh Application evidence under the
 * transaction's scope lock; this neither selects a head nor grants execution. */
export const verifyLogicalSchemaBindingInTransaction = Effect.fn("DataBinding.verifyLogicalSchema")(function* (
  prepared: PreparedLogicalStorage, frame: DataBindingSetFrame,
  application: Effect.Success<ReturnType<typeof readApplicationBindingEvidenceInTransaction>>,
  tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord,
  checkedActive?: CheckedApplicationActiveHead,
) {
  if (!sameBindingValue(frame.application, application.projection) ||
      !sameBindingValue(prepared.applicationAnalysis, application.analysis))
    return yield* Effect.fail(bindingError("staleApplication"));
  if (frame.logicalSchema === null || !sameBindingValue(frame.logicalSchema, prepared.reference))
    return yield* Effect.fail(bindingError("logicalSchemaMismatch"));
  const readiness = yield* prepared.inspect(tx, authority, clock, checkedActive);
  if (readiness.status !== "ready") return yield* Effect.fail(bindingError("logicalSchemaNotReady", readiness));
  return readiness;
});
