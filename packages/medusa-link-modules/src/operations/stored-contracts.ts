import { Schema } from "effect"
import { LinkOperationRecord, decoder } from "./contracts"
import { LinkPreimageOperationRecord } from "./preimage-contracts"

/** Existing membership frames keep their exact encoding and decoder. New
 * ordered preimage requests are explicitly tagged within the existing JSON
 * protocol columns; they cannot be interpreted as the older semantics. */
export const StoredLinkOperationRecord = Schema.Union([LinkOperationRecord, LinkPreimageOperationRecord])
export const decodeStoredLinkOperationRecord = decoder(StoredLinkOperationRecord, "stored")
