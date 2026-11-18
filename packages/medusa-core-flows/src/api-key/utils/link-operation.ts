import { LINKS, MedusaError } from "@medusajs/framework/utils/portable"
import type { LinkOperationHandle, LinkWorkflowInput } from "@medusajs/framework/types"
import type { Link } from "@medusajs/modules-sdk/link"
import { StepResponse } from "@medusajs/workflows-sdk"
import { PermanentStepFailureError } from "@medusajs/orchestration/transaction/errors"

/** Correlate this API Key step across retries and its retained compensation.
 * The digest is an identity, never permission to mutate a Link module. */
export async function apiKeyLinkOperationId(invocationKey: string | undefined): Promise<string> {
  if (invocationKey === undefined || invocationKey.length === 0) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "API Key associations require a native step invocation identity")
  }
  const bytes = new TextEncoder().encode(JSON.stringify(["medusa.api-key-link-operation", "1", invocationKey]))
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes)
  return "lop_" + Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("")
}

/** Retain invocation identity and exact input before mutation. The native SDK
 * can then compensate both success and a lost/failed apply response. */
export async function applyApiKeyLinkOperation(link: Pick<Link, "applyOperation">, input: LinkWorkflowInput,
  invocationKey: string | undefined): Promise<StepResponse<void, LinkOperationHandle>> {
  const primary = input.id
  const add = (input.add ?? []).map(foreign => ({ primary, foreign }))
  const remove = (input.remove ?? []).map(foreign => ({ primary, foreign }))
  const operationId = await apiKeyLinkOperationId(invocationKey)
  const request = { operationId, add, remove }
  const handle: LinkOperationHandle = { operationId, serviceName: LINKS.PublishableApiKeySalesChannel, request }
  try {
    const outcome = await link.applyOperation(handle.serviceName, request)
    if (outcome.state !== "applied") throw new MedusaError(MedusaError.Types.CONFLICT, "Native API Key association operation is already terminal")
  } catch (cause) {
    const failure = new PermanentStepFailureError("Native API Key association operation failed", new StepResponse(handle))
    Object.defineProperty(failure, "cause", { value: cause })
    throw failure
  }
  return new StepResponse(void 0, handle)
}
