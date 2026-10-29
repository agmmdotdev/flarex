import type { Context } from "@medusajs/framework/types"
import type { LinkOperationPair } from "./contracts"
import type { LinkPreimageRow } from "./preimage-contracts"

/** Native persistence adaptation under the existing Link serialization owner.
 * A physical implementation reads exact timestamp text while locking actual
 * rows; the logical implementation authenticates existing scope exclusion and
 * uses the trusted recorded-row replay capability. Neither settles a call. */
export interface LinkPreimageStorage {
  require(context: Context): Promise<void>
  capture(pairs: readonly (typeof LinkOperationPair.Type)[], context: Context): Promise<unknown>
  restore(rows: readonly (typeof LinkPreimageRow.Type)[], context: Context): Promise<unknown>
}
