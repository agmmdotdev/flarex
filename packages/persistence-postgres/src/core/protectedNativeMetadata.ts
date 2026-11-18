import type { CoreNativeProtectedReference, CoreNativeTablePolicy } from "./nativePolicyTypes";

/** Endpoint source digests authenticate their producer at bundle admission.
 * Consumed dependency meaning is the endpoint contract, not unrelated source
 * declarations that happen to share that authenticated source envelope. */
export function coreProtectedNativeReferenceMeaning(reference: CoreNativeProtectedReference) {
  const { sourceSha256: _sourceDigest, ...sourceIdentity } = reference.sourceIdentity;
  const { sourceSha256: _targetDigest, ...targetIdentity } = reference.targetIdentity;
  return { ...reference, sourceIdentity, targetIdentity };
}

export function coreProtectedNativePolicyMeaning(policy: CoreNativeTablePolicy) {
  const { schemaId: _schemaId, protectedReferences, bindingSelected, ...meaning } = policy;
  return { ...meaning, bindingSelected: bindingSelected ?? true, ...(protectedReferences === undefined ? {} : {
    protectedReferences: protectedReferences.map(coreProtectedNativeReferenceMeaning),
  }) };
}
