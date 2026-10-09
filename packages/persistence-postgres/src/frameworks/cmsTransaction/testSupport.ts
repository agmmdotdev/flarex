import type { Effect } from "effect";
import type { applyPayloadPreferenceCleanup } from "../payloadPreferences/cleanup";
import type { CmsTransactionError } from "./model";
import type { CmsClosedDocuments, CmsDocumentReadTestHooks } from "./documents";
import type { AppRelationEdgeQueryObservation } from "../../storage/relations";
import type { FlarexMetadataTransaction } from "../../database/metadataTransaction";
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

/** Read conformance only; no write/materialization hooks or settlement issuer. */
export interface CmsReadHostTestHooks {
  readonly documentReads?: CmsDocumentReadTestHooks;
  /** Physical-driver conformance only; never passed to a registered operation. */
  readonly afterAdmission?: (tx: FlarexMetadataTransaction) => Effect.Effect<void, CmsTransactionError>;
}
export interface CmsHostTestHooks extends CmsMaterializationTestHooks, CmsReadHostTestHooks {
  readonly observeIncomingQuery?: (query: AppRelationEdgeQueryObservation) => void;
}
