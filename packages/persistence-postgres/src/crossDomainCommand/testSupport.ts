import type { Effect } from "effect";
import type { CompositeBinding } from "./binding";
import type { CompositeFailure } from "./model";

/** Source-private fault injection; never part of the returned command facade. */
export interface CurrencyAnnouncementTestHooks {
  readonly afterSteps?: () => Effect.Effect<void, CompositeFailure>;
  readonly beforeApplication?: () => Effect.Effect<void, CompositeFailure>;
  readonly receipts?: (receipts: readonly object[]) => readonly object[];
  readonly bindingProof?: (binding: CompositeBinding) => CompositeBinding;
}
