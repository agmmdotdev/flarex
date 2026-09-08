import type { Effect } from "effect";
import type { consumePayloadPreferenceCleanup } from "../payloadPreferences/cleanup";
import type { CmsTransactionError } from "./model";
/** Fault injection only; no admission, preparation or receipt issuer is exposed. */
export interface CmsMaterializationTestHooks {
  readonly transformReceipts?: (
    receipts: readonly object[],
  ) => readonly object[];
  readonly afterPreferenceClosure?: (
    evidence: Effect.Success<
      ReturnType<typeof consumePayloadPreferenceCleanup>
    >,
  ) => Effect.Effect<void, CmsTransactionError>;
  readonly afterPreferenceFacts?: () => Effect.Effect<
    void,
    CmsTransactionError
  >;
}
