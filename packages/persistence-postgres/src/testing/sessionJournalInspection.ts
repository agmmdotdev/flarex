/** Test-only detached proof and lifecycle inspection; no issuer or registry mutation. */
export { readFrozenFiniteAttempt, type FrozenFiniteAttemptData } from "../execution/journal/frozenAttempt";
export {
  readConfirmedFiniteRootEntryCapture,
  inspectPreparedFiniteSessionJournalEntry,
} from "../execution/journal/finiteEntry";
