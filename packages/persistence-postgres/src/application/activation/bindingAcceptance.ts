import { observeExecution } from "../../execution/diagnostics/operation";
import type { FiniteEntryObservation } from "../../execution/finiteEntryObservation";
import {
  isLocatedReadCommittedAttemptTargetV1,
} from "../../database/locatedTransactionIdentity";
import {
  type ExactTrustedScopeAuthorityResolutionPorts,
  resolveLocatedTrustedScopeAuthorityByIdEffect,
  type TrustedScopeAuthority,
} from "../../scope/scopeAuthorityResolution";
import { lockScopeClockForUpdateInTransactionEffect, type ScopeClockRecord } from "../../scope/scopeClock";
import type { AppRowTransaction } from "../../storage/documents/appRows";
import type { CheckedApplicationActiveHead } from "../activeHead/contracts";
import {
  isCheckedApplicationActiveHead,
  readCheckedApplicationActiveHead,
  releaseCheckedApplicationActiveHead,
} from "../activeHead/identity";
import { fxSystemApplicationActiveHeads } from "../applicationActivationSchema";
import {
  completeCheckedApplicationActiveHeadInTransactionEffect,
  readCheckedCoherentApplicationActiveHeadForShareInTransactionEffect,
  readCoherentApplicationActiveHeadForShareInTransactionEffect,
} from "../applicationActiveHeadRead";
import type { FlarexMetadataDatabase } from "../deployments";
import { ApplicationWriteOwnershipError } from "../ownership/Model";
import type { ApplicationWriteOwnershipHistoryBudget } from "../ownership/Policy";
import {
  validateFiniteApplicationReadinessInTransaction,
  validateStoredApplicationReadinessForActivationInTransaction,
  withStoredApplicationReadinessForBindingInTransaction,
} from "../readiness/acceptance";
import {
  acceptPreparedApplicationRelationActiveRead,
  type ApplicationRelationReadinessActivationBasis,
  type ApplicationRelationReadinessFoldRepository,
  hasPreparedApplicationRelationReadRepository,
  readApplicationRelationOwnershipInTransaction,
  validateActiveApplicationRelationReadinessInTransaction,
} from "../relations/applicationRelationReadinessFold";
import {
  closeAcceptedApplicationBindingLending,
  readAcceptedApplicationBindingState,
  requireAcceptedApplicationBindingObservation,
  sameBindingClock,
  withApplicationBindingObservation,
} from "./acceptedBinding";
import { headMatchesValidatedReadiness } from "./capture";
import type {
  AcceptedApplicationBinding,
  ApplicationActiveSelection,
  ApplicationActiveSelectionBasis,
  ApplicationBindingInput,
  ApplicationBindingObservation,
  ApplicationExecutableActiveSelection,
  ApplicationRelationActiveSelectionBasis,
  PreparedApplicationBinding,
} from "./contracts";
import { query, runLocatedTransaction } from "./databaseBoundary";
import {
  activationError,
  activationFailure,
  ApplicationActivationError,
  type ValidateApplicationRelationActiveSelectionError,
  type ValidateApplicationRelationActiveSelectionInTransactionError,
} from "./errors";
import { activeHeadFailure, type DecodedHead, decodeHead } from "./headCapture";
import {
  claimApplicationActiveSelection,
  claimApplicationExecutableActiveSelection,
  claimApplicationRelationActiveSelectionForReadiness,
  clockMatches,
  copyRelationSelectionBasis,
  copySelectionBasis,
  readApplicationBindingHeadPreparation,
  readApplicationBindingTargetProtection,
  readApplicationSelectionState,
  readLegacyApplicationBindingPreparation,
  readRelationApplicationBindingPreparation,
  type RelationSelectionState,
  sameTrustedAuthority,
} from "./selectionIdentity";
import { bytesEqualFullScan, copyBytes } from "@flarex/utils/bytes";
import { eq } from "drizzle-orm";
import { Effect, Result } from "effect";

export const withAcceptedApplicationBinding = Effect.fnUntraced(
  function* <A, E, R>(input: ApplicationBindingInput, tx: AppRowTransaction, clock: ScopeClockRecord,
    work: (binding: AcceptedApplicationBinding) => Effect.Effect<A, E, R>, observation?: ApplicationBindingObservation) {
    const prepared = readRelationApplicationBindingPreparation(input);
    if (prepared === undefined) return yield* activationFailure("validateSelection", "invalidComposition");
    return yield* withValidatedApplicationBindingBasisInTransaction(input, tx, clock,
      (validated, _checked, binding) => Effect.gen(function* () {
        if (validated.kind !== "relation") return yield* activationFailure("validateSelection", "invalidComposition");
        return yield* work(binding);
      }), observation);
  }, work => observeExecution("ApplicationActivation.withAcceptedBinding", work),
);

export function readAcceptedApplicationBinding(binding: AcceptedApplicationBinding, tx: AppRowTransaction,
  clock: ScopeClockRecord, repository?: ApplicationRelationReadinessFoldRepository): Result.Result<
    ApplicationRelationActiveSelectionBasis, ApplicationActivationError> {
  const state = readAcceptedApplicationBindingState(binding);
  if (state === undefined || state.validated.kind !== "relation" || state.tx !== tx ||
    !clockMatches(state.validated.basis.authority, clock) ||
    !sameBindingClock(state.clock, clock) ||
    (repository !== undefined && (state.readiness === undefined ||
      !hasPreparedApplicationRelationReadRepository(state.readiness, repository)))) {
    return Result.fail(new ApplicationActivationError({ operation: "validateSelection", reason: "invalidComposition", retryable: false }));
  }
  const basis = state.validated.basis;
  return requireAcceptedApplicationBindingObservation(binding, state.selection, tx, clock).pipe(
    Result.map(() => copyRelationSelectionBasis(basis)));
}

export const validateApplicationRelationActiveSelectionForReadiness = Effect.fn(
  "ApplicationActivation.validateRelationSelectionForReadiness",
)(function* (
  readiness: ApplicationRelationReadinessFoldRepository,
  selection: unknown,
  deploymentId: string,
  authority: ExactTrustedScopeAuthorityResolutionPorts,
): Effect.fn.Return<
  ApplicationRelationActiveSelectionBasis,
  ValidateApplicationRelationActiveSelectionError
> {
  const basis = yield* Effect.fromResult(
    claimApplicationRelationActiveSelectionForReadiness(readiness, selection),
  );
  if (basis.deploymentId !== deploymentId) {
    return yield* activationFailure(
      "validateSelection",
      "invalidComposition",
      basis.revisionId,
    );
  }
  const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect(
    { deploymentId, scopeId: basis.authority.scopeId },
    authority,
  );
  if (!sameTrustedAuthority(basis.authority, located.authority)) {
    return yield* activationFailure(
      "validateSelection",
      "scopeAuthority",
      basis.revisionId,
    );
  }
  if (!isLocatedReadCommittedAttemptTargetV1(located.target)) {
    return yield* activationFailure(
      "validateSelection",
      "invalidComposition",
      basis.revisionId,
    );
  }
  return yield* runLocatedTransaction(
    located.target,
    "validateSelection",
    basis.revisionId,
    tx => Effect.gen(function* () {
      const clock = yield* lockScopeClockForUpdateInTransactionEffect(
        tx,
        basis.authority.scopeId,
      );
      return yield* validateApplicationRelationActiveSelectionInTransaction(
        selection,
        tx,
        clock,
      );
    }),
  );
});

export const withValidatedApplicationBindingBasisInTransaction = Effect.fnUntraced(function* <Value, Failure, Requirements>(selection: ApplicationBindingInput, tx: AppRowTransaction,
  currentClock: ScopeClockRecord,
  work: (validated: Effect.Success<ReturnType<typeof validateApplicationBindingBasisOwned>>,
    checked: CheckedApplicationActiveHead | undefined, binding: AcceptedApplicationBinding) => Effect.Effect<Value, Failure, Requirements>,
  observation?: ApplicationBindingObservation, finiteEntry?: FiniteEntryObservation) {
  let checked: CheckedApplicationActiveHead | undefined;
  let borrowedHead: CheckedApplicationActiveHead | undefined;
  return yield* Effect.gen(function* () {
    if (observation !== undefined && isCheckedApplicationActiveHead(observation)) {
      if (finiteEntry !== undefined) return yield* activationFailure("validateSelection", "invalidComposition");
      borrowedHead = observation;
    } else if (observation !== undefined) {
      // An invalid/closed accepted token never falls through into head acceptance.
      const state = readAcceptedApplicationBindingState(observation);
      if (state === undefined || state.selection !== selection || state.tx !== tx || !state.lendingOpen ||
        !clockMatches(state.validated.basis.authority, currentClock) || state.checkedActive === undefined ||
        currentClock.lastMetadataSequence < state.clock.lastMetadataSequence)
        return yield* activationFailure("validateSelection", "invalidComposition");
      yield* Effect.fromResult(readApplicationBindingTargetProtection(selection));
      const active = yield* Effect.fromResult(readCheckedApplicationActiveHead(state.checkedActive, tx, currentClock));
      if (state.fullOrdinaryBasis && sameBindingClock(state.clock, currentClock) && active !== "refresh")
        return yield* Effect.suspend(() => work(state.validated.kind === "legacy"
          ? Object.freeze({ kind: "legacy" as const, basis: copySelectionBasis(state.validated.basis) })
          : Object.freeze({ kind: "relation" as const, basis: copyRelationSelectionBasis(state.validated.basis) }), state.checkedActive, observation));
      if (!sameBindingClock(state.clock, currentClock) || active === "refresh") closeAcceptedApplicationBindingLending(observation);
      else borrowedHead = state.checkedActive;
      // Clock progress and weaker finite entry always re-enter the genuine
      // Application owner. A refresh marker is never positive acceptance.
    }
    const validated = yield* validateApplicationBindingBasisOwned(selection, tx, currentClock,
      issued => { checked = issued; }, finiteEntry, borrowedHead);
    const observed = checked ?? borrowedHead;
    // SAFETY: successful owned validation authenticated this exact selection in
    // an existing issuer registry. The assertion permits only an identity lookup
    // in the active-selection registry; it creates no new membership or authority.
    const selected = readLegacyApplicationBindingPreparation(selection) ?? readApplicationSelectionState(selection as ApplicationActiveSelection);
    return yield* withApplicationBindingObservation(selection, tx, currentClock, validated, observed,
      binding => work(validated, observed, binding), finiteEntry === undefined &&
        (selected?.kind !== "legacy" || selected.finitePreparation === undefined));
  }).pipe(Effect.ensuring(Effect.sync(() => releaseCheckedApplicationActiveHead(checked))));
}, work => observeExecution("ApplicationActivation.withValidatedBindingBasis", work));

export const withPreparedApplicationBindingBasisInTransaction = Effect.fnUntraced(function* <Value, Failure, Requirements>(selection: PreparedApplicationBinding, tx: AppRowTransaction,
  currentClock: ScopeClockRecord,
  work: (validated: Extract<ApplicationExecutableActiveSelection, { readonly kind: "legacy" }>,
    checked: CheckedApplicationActiveHead | undefined, binding: AcceptedApplicationBinding) => Effect.Effect<Value, Failure, Requirements>,
  entryHead?: CheckedApplicationActiveHead) {
  const state = readLegacyApplicationBindingPreparation(selection);
  if (state === undefined) return yield* activationFailure("validateSelection", "invalidComposition");
  yield* Effect.fromResult(readApplicationBindingTargetProtection(selection));
  if (!clockMatches(state.basis.authority, currentClock))
    return yield* activationFailure("validateSelection", "scopeAuthority", state.basis.revisionId);
  let checked: CheckedApplicationActiveHead | undefined;
  return yield* Effect.gen(function* () {
    // The request capture authenticated readiness, not the activation/schema
    // rows. Keep the actual live row proofs, without a retained head template.
    const observed = entryHead === undefined
      ? yield* readCheckedCoherentApplicationActiveHeadForShareInTransactionEffect(tx, currentClock, issued => { checked = issued; })
      : yield* completeCheckedApplicationActiveHeadInTransactionEffect(entryHead, tx, currentClock).pipe(Effect.flatMap(active =>
          active === "refresh" ? activationFailure("validateSelection", "invalidComposition") : Effect.succeed({ active, checked: entryHead })));
    const observation = checked ?? entryHead;
    return yield* withStoredApplicationReadinessForBindingInTransaction(state.readinessRepository,
      state.readiness, tx, currentClock, observation, ready => Effect.gen(function* () {
        if (observed === null || !headMatchesBasis(observed.active.head, state.basis) ||
          !headMatchesValidatedReadiness(observed.active.head, { kind: "legacy", basis: ready.basis }))
          return yield* activationFailure("validateSelection", "concurrentHead", state.basis.revisionId);
        const validated = Object.freeze({ kind: "legacy" as const, basis: copySelectionBasis(state.basis) });
        return yield* withApplicationBindingObservation(selection, tx, currentClock, validated, observation,
          binding => work(validated, observation, binding));
      }), state.currentPreparation);
  }).pipe(Effect.ensuring(Effect.sync(() => releaseCheckedApplicationActiveHead(checked))));
}, work => observeExecution("ApplicationActivation.withPreparedBindingBasis", work));

export const validateApplicationBindingBasisInTransaction = Effect.fn(
  "ApplicationActivation.validateBindingBasisInTransaction",
)((selection: ApplicationBindingInput, tx: AppRowTransaction, currentClock: ScopeClockRecord) =>
  withValidatedApplicationBindingBasisInTransaction(selection, tx, currentClock, validated => Effect.succeed(validated)));

export const validateApplicationBindingBasisOwned = Effect.fnUntraced(function* (selection: ApplicationBindingInput, tx: AppRowTransaction, currentClock: ScopeClockRecord,
  issued: (checked: CheckedApplicationActiveHead | undefined) => void,
  finiteEntry?: FiniteEntryObservation, borrowedHead?: CheckedApplicationActiveHead) {
  const checkedHead = borrowedHead;
  const readActive = () => checkedHead === undefined
    ? readCheckedCoherentApplicationActiveHeadForShareInTransactionEffect(tx, currentClock,
        issued, readApplicationBindingHeadPreparation(selection), finiteEntry)
    : completeCheckedApplicationActiveHeadInTransactionEffect(checkedHead, tx, currentClock, readApplicationBindingHeadPreparation(selection)).pipe(Effect.flatMap(active =>
        active === "refresh" ? activationFailure("validateSelection", "invalidComposition") : Effect.succeed({ active, checked: checkedHead })));
  const preparation = readRelationApplicationBindingPreparation(selection);
  if (preparation !== undefined) {
    yield* Effect.fromResult(readApplicationBindingTargetProtection(selection));
    if (!clockMatches(preparation.authority, currentClock)) return yield* activationFailure("validateSelection", "scopeAuthority", preparation.revisionId);
    const observed = yield* readActive();
    const active = observed?.active ?? null;
    if (active === null || active.head.revisionId !== preparation.revisionId || active.head.readinessKind === "legacy") {
      return yield* activationFailure("validateSelection", "concurrentHead", preparation.revisionId);
    }
    const validated = yield* acceptPreparedApplicationRelationActiveRead(preparation.readiness, tx, currentClock,
      preparation.currentPreparation);
    if (!headMatchesValidatedReadiness(active.head, { kind: "relation", basis: validated })) {
      return yield* activationFailure("validateSelection", "concurrentHead", preparation.revisionId);
    }
    return Object.freeze({ kind: "relation" as const, basis: copyRelationSelectionBasis({ ...validated,
      activationSequence: active.head.activationSequence, activationSha256: copyBytes(active.head.activationSha256),
      headSha256: copyBytes(active.head.headSha256),
    }) });
  }
  // SAFETY: this assertion only permits lookup by object identity. The selection registry authenticates the remaining member; a forged
  // preparation is not promoted to an active selection by this lookup.
  const state = readLegacyApplicationBindingPreparation(selection) ?? readApplicationSelectionState(selection as ApplicationActiveSelection);
  if (state === undefined) return yield* activationFailure("validateSelection", "invalidComposition");
  if (state.kind === "relation") {
    // Binding admission locks the Application head before restoring its readiness dependencies.
    const observed = yield* readActive();
    const active = observed?.active ?? null;
    if (active === null || !relationHeadMatchesBasis(active.head, state.basis)) {
      return yield* activationFailure("validateSelection", "concurrentHead", state.basis.revisionId);
    }
    const basis = yield* validateCheckedRelationSelection(state, tx, currentClock);
    return Object.freeze({ kind: "relation" as const, basis });
  }
  yield* Effect.fromResult((state.lifetime?.checkOpen() ?? Result.succeed(undefined)).pipe(
    Result.mapError(cause => activationError("validateSelection", "invalidComposition", state.basis.revisionId, false, cause))));
  if (!clockMatches(state.basis.authority, currentClock)) {
    return yield* activationFailure("validateSelection", "scopeAuthority", state.basis.revisionId);
  }
  const observed = yield* readActive();
  const active = observed?.active ?? null;
  const validated = state.finitePreparation === undefined
    ? yield* validateStoredApplicationReadinessForActivationInTransaction(
        state.readinessRepository, state.readiness, tx, currentClock, observed?.checked, state.currentPreparation)
    : yield* validateFiniteApplicationReadinessInTransaction(
        state.readinessRepository, state.readiness, tx, currentClock, observed?.checked);
  if (active === null || !headMatchesBasis(active.head, state.basis)
    || !headMatchesValidatedReadiness(active.head, { kind: "legacy", basis: validated.basis })) {
    return yield* activationFailure("validateSelection", "concurrentHead", state.basis.revisionId);
  }
  return Object.freeze({ kind: "legacy" as const, basis: copySelectionBasis(state.basis) });
}, work => observeExecution("ApplicationActivation.validateBindingBasisOwned", work));

export const validateApplicationActiveSelectionInTransaction = Effect.fn(
  "ApplicationActivation.validateSelectionInTransaction",
)(function* (
  selection: unknown,
  tx: AppRowTransaction,
  currentClock: ScopeClockRecord,
) {
  const basis = yield* Effect.fromResult(claimApplicationActiveSelection(selection));
  if (!clockMatches(basis.authority, currentClock)) {
    return yield* activationFailure(
      "validateSelection",
      "scopeAuthority",
      basis.revisionId,
    );
  }
  const rows = yield* query(
    tx.select().from(fxSystemApplicationActiveHeads).where(eq(
      fxSystemApplicationActiveHeads.scopeId,
      basis.authority.scopeId,
    )).limit(1).for("share"),
    "validateSelection",
    basis.revisionId,
  );
  const row = rows[0];
  if (row === undefined) {
    return yield* activationFailure(
      "validateSelection",
      "concurrentHead",
      basis.revisionId,
    );
  }
  const head = yield* decodeHead(row, "validateSelection", basis.revisionId);
  if (!headMatchesBasis(head, basis)) {
    return yield* activationFailure(
      "validateSelection",
      "concurrentHead",
      basis.revisionId,
    );
  }
  return copySelectionBasis(basis);
});

export const validateCheckedRelationSelection = Effect.fn(
  "ApplicationActivation.validateCheckedRelationSelection",
)(function* (
  state: RelationSelectionState,
  tx: AppRowTransaction,
  currentClock: ScopeClockRecord,
): Effect.fn.Return<
  ApplicationRelationActiveSelectionBasis,
  ValidateApplicationRelationActiveSelectionInTransactionError
> {
  const basis = state.basis;
  if (!clockMatches(basis.authority, currentClock)) {
    return yield* activationFailure(
      "validateSelection",
      "scopeAuthority",
      basis.revisionId,
    );
  }
  const validated = yield*
    validateActiveApplicationRelationReadinessInTransaction(
      state.readinessRepository,
      state.readiness,
      tx,
      currentClock,
    );
  if (!relationReadinessMatchesSelection(validated.basis, basis)) {
    return yield* activationFailure(
      "validateSelection",
      "scopeAuthority",
      basis.revisionId,
    );
  }
  return copyRelationSelectionBasis(basis);
});

export const validateApplicationRelationActiveSelectionInTransaction = Effect.fn(
  "ApplicationActivation.validateRelationSelectionInTransaction",
)(function* (
  selection: unknown,
  tx: AppRowTransaction,
  currentClock: ScopeClockRecord,
): Effect.fn.Return<
  ApplicationRelationActiveSelectionBasis,
  ValidateApplicationRelationActiveSelectionInTransactionError
> {
  if (typeof selection !== "object" || selection === null) {
    return yield* activationFailure(
      "validateSelection",
      "invalidComposition",
    );
  }
  // SAFETY: the object guard permits the WeakMap lookup; the relation
  // discriminant and stored nominal handles carry the actual authority.
  const state = readApplicationSelectionState(selection as ApplicationActiveSelection);
  if (state?.kind !== "relation") {
    return yield* activationFailure(
      "validateSelection",
      "invalidComposition",
    );
  }
  const basis = state.basis;
  if (!clockMatches(basis.authority, currentClock)) {
    return yield* activationFailure(
      "validateSelection",
      "scopeAuthority",
      basis.revisionId,
    );
  }
  const active = yield*
    readCoherentApplicationActiveHeadForShareInTransactionEffect(
      tx,
      basis.authority.scopeId,
    ).pipe(Effect.mapError(error => activeHeadFailure(
      "validateSelection",
      error,
      basis.revisionId,
    )));
  if (active === null || !relationHeadMatchesBasis(active.head, basis)) {
    return yield* activationFailure(
      "validateSelection",
      "concurrentHead",
      basis.revisionId,
    );
  }
  return yield* validateCheckedRelationSelection(state, tx, currentClock);
});

export const validateApplicationExecutableActiveSelectionInTransaction =
  Effect.fn("ApplicationActivation.validateExecutableSelectionInTransaction")(
    function* (
      selection: unknown,
      tx: AppRowTransaction,
      currentClock: ScopeClockRecord,
    ) {
      const claimed = yield* Effect.fromResult(
        claimApplicationExecutableActiveSelection(selection),
      );
      if (claimed.kind === "legacy") {
        const basis = yield* validateApplicationActiveSelectionInTransaction(
          selection,
          tx,
          currentClock,
        );
        return Object.freeze({ kind: "legacy" as const, basis });
      }
      const basis = yield*
        validateApplicationRelationActiveSelectionInTransaction(
          selection,
          tx,
          currentClock,
        );
      return Object.freeze({ kind: "relation" as const, basis });
    },
  );

export function headMatchesBasis(
  head: DecodedHead,
  basis: ApplicationActiveSelectionBasis,
): boolean {
  return head.readinessKind === "legacy" &&
    head.scopeId === basis.authority.scopeId &&
    head.activationSequence === basis.activationSequence &&
    head.revisionId === basis.revisionId &&
    bytesEqualFullScan(head.readinessSha256, basis.readinessSha256) &&
    bytesEqualFullScan(head.activationSha256, basis.activationSha256) &&
    bytesEqualFullScan(head.headSha256, basis.headSha256);
}

export function relationHeadMatchesBasis(
  head: DecodedHead,
  basis: ApplicationRelationActiveSelectionBasis,
): boolean {
  return head.readinessKind === "relation" &&
    head.scopeId === basis.authority.scopeId &&
    head.activationSequence === basis.activationSequence &&
    head.revisionId === basis.revisionId &&
    head.relationCount === basis.relationCount &&
    bytesEqualFullScan(head.readinessSha256, basis.readinessSha256) &&
    bytesEqualFullScan(
      head.relationSetReadinessSha256,
      basis.relationSetReadinessSha256,
    ) &&
    bytesEqualFullScan(head.activationSha256, basis.activationSha256) &&
    bytesEqualFullScan(head.headSha256, basis.headSha256);
}

export function relationReadinessMatchesSelection(
  readiness: ApplicationRelationReadinessActivationBasis,
  selection: ApplicationRelationActiveSelectionBasis,
): boolean {
  return readiness.authority.scopeId === selection.authority.scopeId &&
    readiness.authority.storageGeneration ===
      selection.authority.storageGeneration &&
    readiness.authority.storageGenerationFence ===
      selection.authority.storageGenerationFence &&
    readiness.authority.epoch === selection.authority.epoch &&
    readiness.deploymentId === selection.deploymentId &&
    readiness.revisionId === selection.revisionId &&
    readiness.schemaVersionId === selection.schemaVersionId &&
    readiness.relationFrontierCommitSeq ===
      selection.relationFrontierCommitSeq &&
    readiness.relationCount === selection.relationCount &&
    bytesEqualFullScan(readiness.readinessSha256,
      selection.readinessSha256) &&
    bytesEqualFullScan(
      readiness.relationSetReadinessSha256,
      selection.relationSetReadinessSha256,
    );
}

export const readApplicationSelectionOwnershipInTransaction = Effect.fn("ApplicationActivation.readOwnership")(function* (
  selection: ApplicationActiveSelection, tx: AppRowTransaction, scopeId: TrustedScopeAuthority["scopeId"], budget: ApplicationWriteOwnershipHistoryBudget,
  targetDatabase: FlarexMetadataDatabase,
) {
  const state = readApplicationSelectionState(selection);
  if (state?.kind !== "relation" || state.basis.authority.scopeId !== scopeId) return yield* Effect.fail(new ApplicationWriteOwnershipError({ reason: "invalidEvidence" }));
  return yield* readApplicationRelationOwnershipInTransaction(state.readinessRepository, tx, scopeId, budget, undefined, undefined, targetDatabase);
});