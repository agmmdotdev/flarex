import type { LinkPreimageOperationHandle, LinkPreimageOperationRequest } from "@medusajs/types"
import type { Link } from "@medusajs/modules-sdk/link"
import { LINKS, MedusaError } from "@medusajs/framework/utils/portable"
import { StepResponse } from "@medusajs/workflows-sdk"
import { PermanentStepFailureError } from "@medusajs/orchestration/transaction/errors"

/** The native Link owner captures rows and generations. This step retains only
 * its ordered request, including when applying it loses the response. */
export async function applyCartPromotionLinkOperation(
  link: Pick<Link, "applyPreimageOperation">,
  mutations: LinkPreimageOperationRequest["mutations"][number][],
  invocationKey: string | undefined
): Promise<StepResponse<null, LinkPreimageOperationHandle>> {
  if (invocationKey === undefined || invocationKey.length === 0) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Cart promotion updates require a native step invocation identity")
  }
  const bytes = new TextEncoder().encode(JSON.stringify(["medusa.cart-promotion-link-operation", "1", invocationKey]))
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes)
  const operationId = "lop_" + Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("")
  const request = { kind: "preimage" as const, operationId, mutations }
  const handle: LinkPreimageOperationHandle = { operationId, serviceName: LINKS.CartPromotion, request }
  try {
    const result = await link.applyPreimageOperation(handle.serviceName, request)
    if (result.state !== "applied") throw new MedusaError(MedusaError.Types.CONFLICT, "Native Cart promotion operation is already terminal")
  } catch (cause) {
    const failure = new PermanentStepFailureError("Native Cart promotion operation failed", new StepResponse(handle))
    Object.defineProperty(failure, "cause", { value: cause })
    throw failure
  }
  return new StepResponse(null, handle)
}
