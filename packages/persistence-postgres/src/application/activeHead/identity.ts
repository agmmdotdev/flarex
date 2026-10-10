import type { PreparedHostPreparationCharge } from "../../execution/preparation/preparedHostRuntime";
import type { ProtectedTargetMetadataEvidence } from "../../execution/preparation/preparedMetadataEpoch";
import type { ScopeClockRecord } from "../../scope/scopeClock";
import type { AppRowTransaction } from "../../storage/documents/appRows";
import type {
  ApplicationActiveSelectionBasis,
  ApplicationBindingObservation,
} from "../activation/contracts";
import type { readApplicationSchemaForHeadForShareInTransactionEffect } from "../applicationActiveHeadRead";
import type {
  CheckedApplicationActiveHead,
  CoherentApplicationActiveHead,
  DecodedApplicationActiveHead,
  PreparedApplicationActiveHeadStructure,
} from "./contracts";
import { ApplicationActiveHeadStateError } from "./errors";
import { copyBytes } from "@flarex/utils/bytes";
import { type Effect, Result } from "effect";

export type CheckedActiveHeadState = {
  readonly tx: AppRowTransaction;
  readonly clock: ScopeClockRecord;
  readonly head: DecodedApplicationActiveHead;
  active?: CoherentApplicationActiveHead;
  schema?: Effect.Success<ReturnType<typeof readApplicationSchemaForHeadForShareInTransactionEffect>>;
  preparation?: ApplicationActiveHeadPreparationState;
};

const checkedActiveHeads = new WeakMap<object, CheckedActiveHeadState>();

/** The SQL reader issues this exact locked head observation. */
export function issueCheckedApplicationHeadObservation(tx: AppRowTransaction, clock: ScopeClockRecord,
  head: DecodedApplicationActiveHead): CheckedApplicationActiveHead {
  // SAFETY: membership and the private phase are established only by this issuer.
  const checked = Object.freeze({}) as CheckedApplicationActiveHead;
  checkedActiveHeads.set(checked, { tx, clock: { ...clock, updatedAt: new Date(clock.updatedAt.getTime()) }, head: structuredClone(head) });
  return checked;
}

export function issueCheckedCoherentApplicationHeadObservation(tx: AppRowTransaction, clock: ScopeClockRecord,
  active: CoherentApplicationActiveHead, matchingPreparation: ApplicationActiveHeadPreparationState | undefined): CheckedApplicationActiveHead {
  // SAFETY: only this fresh locked reader issues the inert handle; the WeakMap owns its evidence.
  const checked = Object.freeze({}) as CheckedApplicationActiveHead;
  checkedActiveHeads.set(checked, {
    tx,
    clock: { ...clock, updatedAt: new Date(clock.updatedAt.getTime()) },
    head: structuredClone(active.head),
    // The issuer's copy cannot be changed through the validated basis or a coverage context.
    active: structuredClone(active),
    ...(matchingPreparation === undefined ? {} : { preparation: matchingPreparation }),
  });
  return checked;
}

export function readIssuedCheckedApplicationActiveHeadState(checked: CheckedApplicationActiveHead) {
  return checkedActiveHeads.get(checked);
}

export function isCheckedApplicationActiveHead(observation: ApplicationBindingObservation): observation is CheckedApplicationActiveHead {
  return checkedActiveHeads.has(observation);
}

export interface ApplicationActiveHeadPreparationState {
  readonly protection: ProtectedTargetMetadataEvidence;
  readonly charge: PreparedHostPreparationCharge | undefined;
  readonly expected: Pick<ApplicationActiveSelectionBasis, "authority" | "revisionId" | "activationSequence" | "activationSha256" | "headSha256">;
  active?: CoherentApplicationActiveHead;
  schema?: Effect.Success<ReturnType<typeof readApplicationSchemaForHeadForShareInTransactionEffect>>;
}

const preparedHeadStructures = new WeakMap<object, ApplicationActiveHeadPreparationState>();

export function readApplicationActiveHeadPreparationState(prepared: PreparedApplicationActiveHeadStructure) {
  return preparedHeadStructures.get(prepared);
}

/** Called by the nominal Application binding issuer during host construction.
 * Lazy readers retain only decoded immutable bodies under this captured epoch. */
export function prepareApplicationActiveHeadStructure(protection: ProtectedTargetMetadataEvidence,
  charge: ApplicationActiveHeadPreparationState["charge"],
  expected: ApplicationActiveHeadPreparationState["expected"]): PreparedApplicationActiveHeadStructure {
  // SAFETY: the private registry authenticates this inert preparation handle.
  const prepared = Object.freeze({}) as PreparedApplicationActiveHeadStructure;
  preparedHeadStructures.set(prepared, { protection, charge, expected: { ...expected,
    authority: { ...expected.authority }, activationSha256: copyBytes(expected.activationSha256), headSha256: copyBytes(expected.headSha256) } });
  return prepared;
}

/** Wrong transaction or lifecycle identity is invalid; ordinary clock progress requests a fresh read. */
export function readCheckedApplicationActiveHead(
  checked: CheckedApplicationActiveHead,
  tx: AppRowTransaction,
  clock: ScopeClockRecord,
): Result.Result<"refresh" | CoherentApplicationActiveHead, ApplicationActiveHeadStateError> {
  return Result.gen(function* () {
    const state = yield* readCheckedActiveHeadState(checked, tx, clock);
    if (state === "refresh") return "refresh" as const;
    if (state.active === undefined)
      return yield* Result.fail(new ApplicationActiveHeadStateError({ reason: "storedState", retryable: false }));
    return structuredClone(state.active);
  });
}

export function readCheckedActiveHeadState(checked: CheckedApplicationActiveHead, tx: AppRowTransaction,
  clock: ScopeClockRecord): Result.Result<"refresh" | CheckedActiveHeadState, ApplicationActiveHeadStateError> {
  const state = checkedActiveHeads.get(checked);
  if (state === undefined || state.tx !== tx || state.clock.scopeId !== clock.scopeId ||
    state.clock.storageGeneration !== clock.storageGeneration ||
    state.clock.storageGenerationFence !== clock.storageGenerationFence ||
    state.clock.epoch !== clock.epoch) {
    return Result.fail(new ApplicationActiveHeadStateError({ reason: "storedState", retryable: false }));
  }
  if (clock.lastCommitSeq < state.clock.lastCommitSeq ||
    clock.oldestAvailableCommitSeq < state.clock.oldestAvailableCommitSeq)
    return Result.fail(new ApplicationActiveHeadStateError({ reason: "storedState", retryable: false }));
  if (state.clock.lastCommitSeq !== clock.lastCommitSeq ||
    state.clock.oldestAvailableCommitSeq !== clock.oldestAvailableCommitSeq ||
    state.clock.updatedAt.getTime() !== clock.updatedAt.getTime()) return Result.succeed("refresh");
  return Result.succeed(state);
}

export function releaseCheckedApplicationActiveHead(checked: CheckedApplicationActiveHead | undefined): void {
  if (checked !== undefined) checkedActiveHeads.delete(checked);
}
