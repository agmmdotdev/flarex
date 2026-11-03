import { Option, Result } from "effect";
import { bytesEqual } from "@flarex/utils/bytes";
import { encodeDocumentValue } from "flarex-protocol/document-value";
import { encodeIndexKey } from "flarex-protocol/index-key";
import { CoreTransactionError, type CoreError, type CoreTableDefinition } from "./api";
import { addTableSemanticDependency } from "./dependencies";
import { coreNamespaceKey } from "./namespace";
import { authenticatedCoreNativeSchemaProof, coreNativeSchemaIncludes,
  type CoreNativeAuthority, type CoreApplicationReadAuthority, type CoreApplicationInsertAuthority } from "./nativePolicy";
import { SCHEMAS, PROGRAMS, publicDocumentId, isStoredCoreNativeTablePolicy, type CoreRegistry } from "./registry";
import { serializeCoreSchema } from "./schemaJson";
import { CoreReadSetBuilder, pointInterval, type CoreReadSet } from "./writeLog";
import { coreProtectedNativePolicyMeaning } from "./protectedNativeMetadata";
import type { CoreNativeTablePolicy } from "./nativePolicyTypes";

const revoked = () => new CoreTransactionError({ reason: "authorityRevoked" });
const verifiedProtectedPolicies = new WeakSet<CoreNativeTablePolicy>();

function addAuthorityDependency(reads: CoreReadSetBuilder, registry: CoreRegistry, epoch: bigint): Result.Result<void, CoreError> {
  return Result.gen(function* () {
    const programs = registry.table(PROGRAMS)?.definition, authority = registry.authority;
    const byId = programs?.indexes.find(index => index.name === "by_id");
    if (programs === undefined || byId === undefined || authority?.epoch !== epoch) return yield* Result.fail(revoked());
    const id = yield* publicDocumentId(programs, authority.id);
    const key = yield* Result.mapError(encodeIndexKey([], id), revoked);
    reads.add(byId.ref.id, pointInterval(key));
  });
}

export function coreProtectedAuthorityMetadataReads(registry: CoreRegistry, epoch: bigint): Result.Result<CoreReadSet, CoreError> {
  return Result.gen(function* () {
    const reads = new CoreReadSetBuilder();
    yield* addAuthorityDependency(reads, registry, epoch);
    return reads.snapshot();
  });
}

function sameTable(expected: CoreTableDefinition, actual: CoreTableDefinition): boolean {
  return expected.name === actual.name && expected.number === actual.number && bytesEqual(expected.tabletId, actual.tabletId)
    && coreNamespaceKey(expected.namespace) === coreNamespaceKey(actual.namespace) && actual.state === "active";
}

/** Protected attempts consume the selected native source's meaning. An
 * unrelated compatible source handoff may replace only its schema document ID. */
export function checkCoreProtectedNativeAuthority(registry: CoreRegistry, authority: CoreNativeAuthority,
  tableName?: string): Result.Result<void, CoreError> {
  return Result.gen(function* () {
    if (registry.authority?.epoch !== authority.authorityEpoch) return yield* Result.fail(revoked());
    const active = yield* registry.schemas.nativeByState(authority.namespace, "active");
    if (Option.isNone(active) || !coreNativeSchemaIncludes(registry, active.value.metadata.native, authority.definition))
      return yield* Result.fail(revoked());
    const proof = authenticatedCoreNativeSchemaProof(registry, active.value.metadata.native);
    if (proof !== undefined && "nativeDefinitions" in proof
      && proof.nativeBindings?.some(binding => binding.sourceKey === authority.definition.identity.sourceKey && !binding.selected))
      return yield* Result.fail(revoked());
    const expected = tableName === undefined ? [] : authority.tables.filter(table => table.name === tableName);
    if (tableName !== undefined && expected.length === 0) return yield* Result.fail(revoked());
    for (const table of expected) {
      const current = registry.table(table.name, authority.namespace)?.definition;
      if (current === undefined || !sameTable(table, current) || current.nativePolicy === undefined || table.nativePolicy === undefined)
        return yield* Result.fail(revoked());
      const sameStoredPolicy = current.nativePolicy === table.nativePolicy && isStoredCoreNativeTablePolicy(table.nativePolicy);
      if (sameStoredPolicy && verifiedProtectedPolicies.has(table.nativePolicy)) continue;
      const before = yield* Result.mapError(encodeDocumentValue(coreProtectedNativePolicyMeaning(table.nativePolicy)), revoked);
      if (sameStoredPolicy) {
        verifiedProtectedPolicies.add(table.nativePolicy);
        continue;
      }
      const after = yield* Result.mapError(encodeDocumentValue(coreProtectedNativePolicyMeaning(current.nativePolicy)), revoked);
      if (!bytesEqual(before, after)) return yield* Result.fail(revoked());
    }
  });
}

export function coreProtectedNativeMetadataReads(registry: CoreRegistry, authority: CoreNativeAuthority,
  tableName?: string): Result.Result<CoreReadSet, CoreError> {
  return Result.gen(function* () {
    yield* checkCoreProtectedNativeAuthority(registry, authority, tableName);
    const reads = new CoreReadSetBuilder();
    yield* addAuthorityDependency(reads, registry, authority.authorityEpoch);
    const names = tableName === undefined ? [] : authority.tables.filter(table => table.name === tableName).map(table => table.name);
    for (const name of names) {
      const current = registry.table(name, authority.namespace)?.definition;
      if (current === undefined) return yield* Result.fail(revoked());
      yield* addTableSemanticDependency(reads, registry, current);
    }
    return reads.snapshot();
  });
}

export function checkCoreProtectedApplicationAuthority(registry: CoreRegistry,
  authority: CoreApplicationReadAuthority | CoreApplicationInsertAuthority): Result.Result<void, CoreError> {
  return Result.gen(function* () {
    if (registry.authority?.epoch !== authority.authorityEpoch) return yield* Result.fail(revoked());
    const active = yield* registry.schemas.nativeByState(authority.namespace, "active");
    const proof = Option.isNone(active) ? undefined : authenticatedCoreNativeSchemaProof(registry, active.value.metadata.native);
    if (proof === undefined || !("nativeDefinitions" in proof) || coreNamespaceKey(proof.namespace) !== coreNamespaceKey(authority.namespace))
      return yield* Result.fail(revoked());
    const previous = authority.bundle.schema.tables.find(table => table.tableName === authority.table.name);
    const current = proof.schema.tables.find(table => table.tableName === authority.table.name);
    const table = registry.table(authority.table.name, authority.namespace)?.definition;
    if (previous === undefined || current === undefined || table === undefined || table.nativePolicy !== undefined
      || !sameTable(authority.table, table) || !proof.bindings.some(binding => binding.sourceKey === "application"
        && binding.coreTableName === table.name)) return yield* Result.fail(revoked());
    const before = yield* serializeCoreSchema({ schemaValidation: authority.bundle.schema.schemaValidation, tables: [previous] });
    const after = yield* serializeCoreSchema({ schemaValidation: proof.schema.schemaValidation, tables: [current] });
    if (before !== after) return yield* Result.fail(revoked());
  });
}

/** Program revision/head dependencies remain exact at their existing owner. */
export function coreProtectedApplicationMetadataReads(registry: CoreRegistry,
  authority: CoreApplicationReadAuthority | CoreApplicationInsertAuthority): Result.Result<CoreReadSet, CoreError> {
  return Result.gen(function* () {
    yield* checkCoreProtectedApplicationAuthority(registry, authority);
    if (registry.table(SCHEMAS, authority.namespace) === undefined) return yield* Result.fail(revoked());
    const reads = new CoreReadSetBuilder();
    yield* addAuthorityDependency(reads, registry, authority.authorityEpoch);
    yield* addTableSemanticDependency(reads, registry, authority.table);
    return reads.snapshot();
  });
}
