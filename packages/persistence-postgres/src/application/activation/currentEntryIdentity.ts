import type { FiniteEntryObservation } from "../../execution/finiteEntryObservation";
import type { ScopeClockRecord } from "../../scope/scopeClock";
import type { AppRowTransaction } from "../../storage/documents/appRows";
import type { CheckedApplicationActiveHead } from "../activeHead/contracts";
import type {
  ApplicationBindingInput,
  CurrentApplicationFiniteEntry,
  currentFiniteEntryBrand,
} from "./contracts";
import { activationError, activationFailure, type CurrentApplicationEntryFailure } from "./errors";
import { Effect, Result } from "effect";

const currentFiniteEntryIssuance = Symbol("CurrentApplicationFiniteEntryIssuance");

export type CurrentFiniteEntryCheck = (tx: AppRowTransaction, clock: ScopeClockRecord, checked: CheckedApplicationActiveHead,
  observation: FiniteEntryObservation, changedEpoch: boolean) => Effect.Effect<void, CurrentApplicationEntryFailure>;

class BorrowedCurrentApplicationFiniteEntry implements CurrentApplicationFiniteEntry {
  declare readonly [currentFiniteEntryBrand]: true;
  readonly #binding: ApplicationBindingInput;
  readonly #check: CurrentFiniteEntryCheck;
  #open: boolean;
  constructor(issuance: typeof currentFiniteEntryIssuance, binding: ApplicationBindingInput,
    check: CurrentFiniteEntryCheck) {
    this.#binding = binding;
    this.#check = check;
    this.#open = issuance === currentFiniteEntryIssuance;
    Object.freeze(this);
  }
  static authenticate(entry: CurrentApplicationFiniteEntry, binding: ApplicationBindingInput) {
    return entry instanceof BorrowedCurrentApplicationFiniteEntry && #binding in entry &&
      entry.#open && entry.#binding === binding ? Result.succeed(entry) :
      Result.fail(activationError("validateSelection", "invalidComposition"));
  }
  check(tx: AppRowTransaction, clock: ScopeClockRecord, checked: CheckedApplicationActiveHead,
    observation: FiniteEntryObservation, changedEpoch: boolean) {
    return Effect.suspend(() => this.#open ? this.#check(tx, clock, checked, observation, changedEpoch) :
      activationFailure("validateSelection", "invalidComposition"));
  }
  close() { this.#open = false; }
}

/** Only the current-generation owner supplies this lexical entry check. */
export function borrowCurrentApplicationFiniteEntry(binding: ApplicationBindingInput, check: CurrentFiniteEntryCheck) {
  return new BorrowedCurrentApplicationFiniteEntry(currentFiniteEntryIssuance, binding, check);
}

export function authenticateCurrentApplicationFiniteEntry(entry: CurrentApplicationFiniteEntry, binding: ApplicationBindingInput) {
  return BorrowedCurrentApplicationFiniteEntry.authenticate(entry, binding);
}
