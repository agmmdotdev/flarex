import { Result } from "effect";
import { requireCoreNativeDefinition, type CoreNativeDefinition } from "../../core/nativePolicy";
import { commerceError, type CommerceTransactionError } from "../commerceTransaction/model";

declare const sourceBrand: unique symbol;

/** Definition selection only. The trusted host must supply the matching Core
 * source; this token grants no database, operation or settlement capability. */
export interface AtomicCommerceNativeSource { readonly [sourceBrand]: true }

export interface AtomicCommerceNativeSourceIdentity {
  readonly name: string;
  readonly sourceKey: string;
  readonly sourceSha256: string;
  readonly configSha256: string;
  readonly provenanceSha256: string;
  readonly applicationRead: boolean;
}
const sources = new WeakMap<object, AtomicCommerceNativeSourceIdentity>();

export function defineAtomicCommerceNativeSource(name: string, definition: CoreNativeDefinition): Result.Result<AtomicCommerceNativeSource, CommerceTransactionError> {
  return requireCoreNativeDefinition(definition).pipe(Result.mapError(cause => commerceError("invalidAuthority", cause)),
    Result.map(() => {
      // SAFETY: this registry authenticates a semantic definition, never a runtime grant.
      const token = Object.freeze({}) as AtomicCommerceNativeSource;
      const { sourceKey, sourceSha256, configSha256, provenanceSha256 } = definition.identity;
      sources.set(token, Object.freeze({ name, sourceKey, sourceSha256, configSha256, provenanceSha256,
        applicationRead: definition.applicationRead }));
      return token;
    }));
}

export const atomicCommerceNativeSourceIdentity = (source: AtomicCommerceNativeSource) => sources.get(source);

/** Authenticates the selection for a framework-owned composition slot. */
export function matchesAtomicCommerceNativeSource(source: AtomicCommerceNativeSource, name: string, sourceKey: string): boolean {
  const identity = atomicCommerceNativeSourceIdentity(source);
  return identity !== undefined && identity.name === name && identity.sourceKey === sourceKey;
}
