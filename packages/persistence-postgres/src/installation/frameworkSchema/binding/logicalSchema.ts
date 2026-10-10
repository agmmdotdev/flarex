import { Effect, Result } from "effect";
import type { prepareLogicalStorageReadiness } from "../../../storage/catalog/logicalStorageReadiness";
import {
  immutableApplicationBindingReference,
  type ApplicationBindingReference,
  type readApplicationBindingEvidenceInTransaction,
} from "../../../application/applicationBindingProjection";
import type { FlarexMetadataTransaction } from "../../../database/metadataTransaction";
import type { TrustedScopeAuthority } from "../../../scope/scopeAuthorityResolution";
import type { ScopeClockRecord } from "../../../scope/scopeClock";
import type {
  CheckedApplicationActiveHead,
} from "../../../application/activeHead/contracts";
import type {
  ApplicationRelationReadinessProtection,
} from "../../../application/relations/applicationRelationReadinessFold";
import type { DataBindingActivationFrame, DataBindingSetFrame } from "./model";
import type { StoredBindingValue } from "./repository";
import { sameBindingValue } from "./canonical";
import { bindingError } from "./errors";

export type PreparedLogicalStorage = Extract<Effect.Success<ReturnType<typeof prepareLogicalStorageReadiness>>, { status: "prepared" }>;
export type SelectedLogicalStorageReadiness = Effect.Success<ReturnType<PreparedLogicalStorage["selectSources"]>>;

export type BindingApplicationAcceptance = Readonly<{ kind: "proposal" }> |
  Readonly<{ kind: "activated"; activation: StoredBindingValue<DataBindingActivationFrame> }>;

/** Activation proposals retain their observed live epoch. Current admission
 * instead authenticates the selected receipt's actual accepted epoch, including
 * a writer-owned withdrawal. Retained v2 history keeps its original semantics. */
export function verifyBindingApplicationReference(reference: ApplicationBindingReference,
  current: ApplicationBindingReference, acceptance: BindingApplicationAcceptance) {
  if (acceptance.kind === "proposal") return sameBindingValue(reference, current)
    ? Result.succeed(undefined) : Result.fail(bindingError("staleApplication"));
  const activation = acceptance.activation.frame;
  const acceptedEpoch = activation.version === 3 ? activation.authorizationRevocationEpoch
    : reference.authorizationRevocationEpoch;
  if (acceptedEpoch !== current.authorizationRevocationEpoch ||
    !sameBindingValue(immutableApplicationBindingReference(reference), immutableApplicationBindingReference(current)))
    return Result.fail(bindingError("staleApplication"));
  return Result.succeed(undefined);
}

export function verifyPreparedLogicalSchemaBinding(
  prepared: Pick<PreparedLogicalStorage, "applicationAnalysis" | "reference">,
  frame: Pick<DataBindingSetFrame, "application" | "logicalSchema">,
  application: Effect.Success<ReturnType<typeof readApplicationBindingEvidenceInTransaction>>,
  acceptance: BindingApplicationAcceptance,
) {
  return Result.gen(function* () {
    yield* verifyBindingApplicationReference(frame.application, application.projection, acceptance);
    if (!sameBindingValue(prepared.applicationAnalysis, application.analysis))
      return yield* Result.fail(bindingError("staleApplication"));
    if (frame.logicalSchema === null || !sameBindingValue(frame.logicalSchema, prepared.reference))
      return yield* Result.fail(bindingError("logicalSchemaMismatch"));
  });
}

/** Shared accepting check. Call with fresh Application evidence under the
 * transaction's scope lock; this neither selects a head nor grants execution. */
export const verifyLogicalSchemaBindingInTransaction = Effect.fn("DataBinding.verifyLogicalSchema")(function* (
  prepared: PreparedLogicalStorage, frame: DataBindingSetFrame,
  application: Effect.Success<ReturnType<typeof readApplicationBindingEvidenceInTransaction>>,
  tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord,
  acceptance: BindingApplicationAcceptance,
  checkedActive?: CheckedApplicationActiveHead,
  protection?: ApplicationRelationReadinessProtection,
) {
  yield* Effect.fromResult(verifyPreparedLogicalSchemaBinding(prepared, frame, application, acceptance));
  const readiness = yield* prepared.inspect(tx, authority, clock, checkedActive, protection);
  if (readiness.status !== "ready") return yield* Effect.fail(bindingError("logicalSchemaNotReady", readiness));
  return readiness;
});

/** Private finite internal-read check. A selected readiness verdict is never
 * full entry, aggregate-seal or publication eligibility. */
export const verifyLogicalSchemaReadBindingInTransaction = Effect.fn("DataBinding.verifyLogicalSchemaRead")(function* (
  prepared: SelectedLogicalStorageReadiness, frame: DataBindingSetFrame,
  application: Effect.Success<ReturnType<typeof readApplicationBindingEvidenceInTransaction>>,
  tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord,
  acceptance: BindingApplicationAcceptance,
  checkedActive?: CheckedApplicationActiveHead,
  protection?: ApplicationRelationReadinessProtection,
) {
  yield* Effect.fromResult(verifyPreparedLogicalSchemaBinding(prepared, frame, application, acceptance));
  const readiness = yield* prepared.inspectSelected(tx, authority, clock, checkedActive, protection);
  if (readiness.status !== "ready") return yield* Effect.fail(bindingError("logicalSchemaNotReady", readiness));
  return readiness;
});
