import type { Context } from "../shared-context"
import type { CartDTO } from "./common"
import type { CreateCartDTO } from "./mutations"

/** Retained private workflow data; the storefront Cart result omits it. */
export interface CartCreationHandle { readonly operation_id: string }
export interface CartCreationResult {
  readonly carts: CartDTO[]
  readonly receipt?: CartCreationHandle
}
export interface CartCreationCompensation {
  readonly status: "compensated" | "alreadyCompensated"
  readonly deletedCartIds: readonly string[]
  readonly deletedAddressIds: readonly string[]
  readonly retainedAddressIds: readonly string[]
}

/** Explicit native capability for the creation profile. Default Cart module
 * contracts do not acquire ownership storage or this workflow admission. */
export interface ICartCreationOwnershipService {
  createCartsWithOwnership(data: CreateCartDTO[], sharedContext?: Context): Promise<CartCreationResult>
  compensateCartsCreation(receipt: CartCreationHandle, sharedContext?: Context): Promise<CartCreationCompensation>
}
