import { Result } from "effect";
import { coreNativeRelationalRows, requireCoreNativeDefinition, type CoreNativeDefinition } from "../../core/nativePolicy";
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
const sources = new WeakMap<object, Readonly<{
  identity: AtomicCommerceNativeSourceIdentity;
  relationalTables: readonly string[];
}>>();

export function defineAtomicCommerceNativeSource(name: string, definition: CoreNativeDefinition): Result.Result<AtomicCommerceNativeSource, CommerceTransactionError> {
  return requireCoreNativeDefinition(definition).pipe(Result.mapError(cause => commerceError("invalidAuthority", cause)),
    Result.map(() => {
      // SAFETY: this registry authenticates a semantic definition, never a runtime grant.
      const token = Object.freeze({}) as AtomicCommerceNativeSource;
      const { sourceKey, sourceSha256, configSha256, provenanceSha256 } = definition.identity;
      const relationalTables = definition.tables.filter(table => coreNativeRelationalRows(definition, table.name) !== undefined)
        .map(table => table.localName ?? table.name);
      sources.set(token, Object.freeze({
        identity: Object.freeze({ name, sourceKey, sourceSha256, configSha256, provenanceSha256, applicationRead: definition.applicationRead }),
        relationalTables: Object.freeze(relationalTables),
      }));
      return token;
    }));
}

export const atomicCommerceNativeSourceIdentity = (source: AtomicCommerceNativeSource) => sources.get(source)?.identity;

/** Authenticates the selection and table requirements for a framework-owned slot. */
export function matchesAtomicCommerceNativeSource(source: AtomicCommerceNativeSource, name: string, sourceKey: string,
  requiredTables?: readonly string[] | Readonly<{ exactly: readonly string[] }>,
): boolean {
  const selection = sources.get(source);
  if (selection === undefined || selection.identity.name !== name || selection.identity.sourceKey !== sourceKey) return false;
  if (requiredTables === undefined) return true;
  if ("exactly" in requiredTables) return requiredTables.exactly.length === selection.relationalTables.length
    && selection.relationalTables.every(table => requiredTables.exactly.includes(table));
  return requiredTables.every(table => selection.relationalTables.includes(table));
}
