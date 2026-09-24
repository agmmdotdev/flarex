import type { Effect } from "effect";
import type { applyPayloadPreferenceCleanup } from "../payloadPreferences/cleanup";
import type { CmsTransactionError } from "./model";
import type { CmsClosedDocuments } from "./documents";
/** Fault injection only; no admission, preparation or receipt issuer is exposed. */
export interface CmsMaterializationTestHooks {
  readonly afterDocumentClosure?: (evidence: Pick<CmsClosedDocuments,
    "dependencies" | "scans" | "uniqueReads" | "changes" | "noFinalRows" | "observedRows">) => Effect.Effect<void, CmsTransactionError>;
  readonly transformReceipts?: (
    receipts: readonly object[],
  ) => readonly object[];
  readonly afterPreferenceCleanup?: (
    evidence: Effect.Success<
      ReturnType<typeof applyPayloadPreferenceCleanup>
    >,
  ) => Effect.Effect<void, CmsTransactionError>;
  readonly afterPreferenceFacts?: () => Effect.Effect<
    void,
    CmsTransactionError
  >;
}
