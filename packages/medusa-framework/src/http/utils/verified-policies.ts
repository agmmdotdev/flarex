import { MedusaError } from "@medusajs/utils/common/errors"
import type { MedusaRequest, PolicyAction } from "../types"

const verified = new WeakMap<MedusaRequest, readonly PolicyAction[]>()
export type PolicyVerifier = (request: MedusaRequest, policies: readonly PolicyAction[]) => Promise<void> | void

export function hasVerifiedRequestPolicies(request: MedusaRequest): boolean {
  return request.policies === verified.get(request)
}

/** The host verifies declared policies; this owner records only that successful check. */
export async function verifyAndRecordPolicies(request: MedusaRequest, policies: PolicyAction | PolicyAction[], verifier: PolicyVerifier): Promise<void> {
  if (request.policies?.length && !hasVerifiedRequestPolicies(request)) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Unverified request policies are not supported by the private HTTP profile")
  }
  const list = (Array.isArray(policies) ? policies : [policies]).map((policy) => Object.freeze({
    resource: policy.resource,
    operation: typeof policy.operation === "string" ? policy.operation : Object.freeze([...policy.operation]),
  }))
  await verifier(request, list)
  const accepted = Object.freeze([...(request.policies ?? []), ...list])
  request.policies = accepted
  verified.set(request, accepted)
}
