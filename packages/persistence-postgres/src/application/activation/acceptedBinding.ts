import type { ScopeClockRecord } from "../../scope/scopeClock";
import type { AppRowTransaction } from "../../storage/documents/appRows";
import type { CheckedApplicationActiveHead } from "../activeHead/contracts";
import { readCheckedActiveHeadState } from "../activeHead/identity";
import { ApplicationActiveHeadStateError } from "../activeHead/errors";
import type { PreparedApplicationRelationActiveRead } from "../relations/applicationRelationReadinessFold";
import type {
  AcceptedApplicationBinding,
  ApplicationBindingInput,
  ApplicationBindingObservation,
  ApplicationExecutableActiveSelection,
} from "./contracts";
import { activationError } from "./errors";
import {
  clockMatches,
  copyRelationSelectionBasis,
  copySelectionBasis,
  readApplicationBindingTargetProtection,
  readRelationApplicationBindingPreparation,
} from "./selectionIdentity";
import { Effect, Result } from "effect";
import type { ApplicationBindingEvidence } from "../applicationBindingProjection";

const acceptedBindings = new WeakMap<object, {
  selection: ApplicationBindingInput; tx: AppRowTransaction; clock: ScopeClockRecord;
  validated: ApplicationExecutableActiveSelection;
  checkedActive: CheckedApplicationActiveHead | undefined;
  readiness: PreparedApplicationRelationActiveRead | undefined;
  readonly fullOrdinaryBasis: boolean;
  lendingOpen: boolean;
  /** String-only, deeply frozen projection issued by the projection owner.
   * Raw basis digests remain private detached byte arrays. */
  evidence?: ApplicationBindingEvidence;
}>();

// An index of this issuer's live callback tokens, not another acceptance cache.
const acceptedBindingTransactions = new WeakMap<AppRowTransaction, {
  lendingOpen: boolean; readonly bindings: Set<AcceptedApplicationBinding>;
}>();

/** Internal accepting owners borrow the same callback token state. */
export function readAcceptedApplicationBindingState(binding: ApplicationBindingObservation) {
  return acceptedBindings.get(binding);
}

export function closeAcceptedApplicationBindingLending(binding: AcceptedApplicationBinding): void {
  const state = acceptedBindings.get(binding);
  if (state !== undefined) state.lendingOpen = false;
}

/** Lowering and sanctioned metadata writers close lending before their work.
 * The live token remains usable by its original source/settlement callback. */
export function invalidateAcceptedApplicationBindingInTransaction(tx: AppRowTransaction): void {
  let phase = acceptedBindingTransactions.get(tx);
  if (phase === undefined) {
    phase = { lendingOpen: false, bindings: new Set() };
    acceptedBindingTransactions.set(tx, phase);
  }
  phase.lendingOpen = false;
  for (const binding of phase.bindings) {
    const state = acceptedBindings.get(binding);
    if (state !== undefined) state.lendingOpen = false;
  }
}

export function sameBindingClock(expected: ScopeClockRecord, actual: ScopeClockRecord): boolean {
  return expected.scopeId === actual.scopeId && expected.storageGeneration === actual.storageGeneration &&
    expected.storageGenerationFence === actual.storageGenerationFence && expected.epoch === actual.epoch &&
    expected.lastCommitSeq === actual.lastCommitSeq && expected.lastMetadataSequence === actual.lastMetadataSequence &&
    expected.oldestAvailableCommitSeq === actual.oldestAvailableCommitSeq &&
    expected.updatedAt.getTime() === actual.updatedAt.getTime();
}

/** The entry/source owner supplies its genuine captured source membership.
 * This verifies only the borrowed Application observation, never source proof. */
export function requireAcceptedApplicationBindingObservation(binding: AcceptedApplicationBinding,
  selection: ApplicationBindingInput, tx: AppRowTransaction, clock: ScopeClockRecord) {
  const state = acceptedBindings.get(binding);
  if (state === undefined || state.selection !== selection || state.tx !== tx || !sameBindingClock(state.clock, clock) ||
    !clockMatches(state.validated.basis.authority, clock) || state.checkedActive === undefined)
    return Result.fail(activationError("validateSelection", "invalidComposition"));
  const checked = state.checkedActive;
  return Result.gen(function* () {
    yield* readApplicationBindingTargetProtection(selection);
    // This frontier authenticates membership/completeness only. The active-head
    // issuer retains mutable digest bytes privately; its public reader detaches
    // the full body, which this refusal-only check never needs to construct.
    const active = yield* readCheckedActiveHeadState(checked, tx, clock).pipe(
      Result.flatMap(activeState => activeState === "refresh" || activeState.active !== undefined ? Result.succeed(activeState) :
        Result.fail(new ApplicationActiveHeadStateError({ reason: "storedState", retryable: false }))),
      Result.mapError(cause => activationError("validateSelection", "invalidComposition", undefined, false, cause)));
    if (active === "refresh") return yield* Result.fail(activationError("validateSelection", "invalidComposition"));
  });
}

/** Only a live ordinary callback can lend acceptance to another source. The
 * original callback's observation remains valid after its lending phase closes. */
export function requireAcceptedApplicationBindingLending(binding: AcceptedApplicationBinding,
  selection: ApplicationBindingInput, tx: AppRowTransaction, clock: ScopeClockRecord) {
  const state = acceptedBindings.get(binding);
  if (state === undefined || !state.lendingOpen || !state.fullOrdinaryBasis)
    return Result.fail(activationError("validateSelection", "invalidComposition"));
  return requireAcceptedApplicationBindingObservation(binding, selection, tx, clock);
}

export function withApplicationBindingObservation<Value, Failure, Requirements>(selection: ApplicationBindingInput,
  tx: AppRowTransaction, clock: ScopeClockRecord, validated: ApplicationExecutableActiveSelection,
  checkedActive: CheckedApplicationActiveHead | undefined,
  work: (binding: AcceptedApplicationBinding) => Effect.Effect<Value, Failure, Requirements>,
  fullOrdinaryBasis = true): Effect.Effect<Value, Failure, Requirements> {
  return Effect.acquireUseRelease(Effect.sync(() => {
    // SAFETY: this existing issuer owns the inert callback-local observation;
    // neither its basis nor its checked handle grants executable authority.
    const binding = Object.freeze({}) as AcceptedApplicationBinding;
    const detached = validated.kind === "legacy"
      ? Object.freeze({ kind: "legacy" as const, basis: copySelectionBasis(validated.basis) })
      : Object.freeze({ kind: "relation" as const, basis: copyRelationSelectionBasis(validated.basis) });
    let phase = acceptedBindingTransactions.get(tx);
    if (phase === undefined) {
      phase = { lendingOpen: true, bindings: new Set() };
      acceptedBindingTransactions.set(tx, phase);
    }
    phase.bindings.add(binding);
    acceptedBindings.set(binding, { selection, tx, clock: { ...clock, updatedAt: new Date(clock.updatedAt.getTime()) },
      validated: detached, checkedActive, readiness: readRelationApplicationBindingPreparation(selection)?.readiness,
      fullOrdinaryBasis, lendingOpen: phase.lendingOpen });
    return binding;
  }), binding => Effect.suspend(() => work(binding)), binding => Effect.sync(() => {
    acceptedBindings.delete(binding);
    acceptedBindingTransactions.get(tx)?.bindings.delete(binding);
  }));
}
