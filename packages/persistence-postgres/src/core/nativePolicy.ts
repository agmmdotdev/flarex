import { Effect, Option, Result, Schema } from "effect";
import { bytesEqual, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { decodeApplicationWritePolicies, digestApplicationWritePolicyFrame, payloadUniqueDeclarations,
  validateApplicationWritePolicySchema, verifyApplicationWritePolicies } from "@flarex/analysis/internal/application-write-policy";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { LogicalSchemaSourceSchema, encodeLogicalSchemaSource, type LogicalSchemaSource } from "flarex-protocol/internal/logical-schema-candidate";
import { encodeCanonicalJson, type Json } from "flarex-protocol/json";
import { ScopeEpochUuidV1Schema, ScopeUuidV1Schema } from "flarex-protocol/storage-authority";
import { encodeIndexKey, encodeIndexValue } from "flarex-protocol/index-key";
import { incrementIndexKeyPrefix } from "flarex-protocol/index-range";
import { snapshotDecodedProtocolPlainData } from "flarex-protocol/internal/decoded-protocol-snapshot";
import { SchemaManifestSemanticInputSchema } from "flarex-protocol/schema-manifest";
import { CoreTransactionError, type CoreError, type CoreNativeCommandDefinition, type CoreTableDefinition } from "./api";
import { captureCoreSchema, CoreSchemaError, type CoreSchemaDefinition } from "./schemaTypes";
import { coreNamespaceKey, type CoreTableNamespace } from "./namespace";
import { PROGRAMS, SCHEMAS, TABLES, publicDocumentId, type CoreRegistry } from "./registry";
import { CoreReadSetBuilder, pointInterval, type CoreReadSet } from "./writeLog";
import { addIndexMetadataDependency } from "./dependencies";
import { CorePersistenceError } from "./contracts";
import { serializeCoreSchema } from "./schemaJson";
import type { CoreSchemaSelection } from "./schemaRegistry";
import { isCoreIndexStaged } from "./indexState";

import { CoreNativeIdentitySchema, CoreNativeUniqueConstraintSchema as Unique, type CoreNativeIdentity,
  type CoreNativeTablePolicy, coreNativeConstraintFields, coreNativeConstraintNullsDistinct } from "./nativePolicyTypes";
export { CoreNativeIdentitySchema, CoreNativeTablePolicySchema, coreNativeConstraintFields,
  coreNativeConstraintNullsDistinct } from "./nativePolicyTypes";
export type { CoreNativeIdentity, CoreNativeTablePolicy } from "./nativePolicyTypes";
export interface CoreNativeDefinition {
  readonly identity: CoreNativeIdentity;
  readonly source: LogicalSchemaSource;
  readonly schema: CoreSchemaDefinition;
  readonly applicationRead: boolean;
  readonly commands: readonly CoreNativeCommandDefinition[];
  /** Authoritative source wire and exposure, stored with the shared schema record. */
  readonly metadata: string;
  readonly tables: readonly Readonly<{ name: string; uniqueConstraints: readonly typeof Unique.Type[] }>[];
}
/** Trusted transaction data, constructed only after a DB-owned binding has been checked. */
export interface CoreNativeAuthority {
  readonly definition: CoreNativeDefinition;
  readonly namespace: CoreTableNamespace;
  readonly schemaId: string;
  readonly authorityEpoch: bigint;
  readonly tables: readonly CoreTableDefinition[];
}
const SourceContract = Schema.Struct({ sourceKey: Schema.Literal("payload"), writeProfile: Schema.Literal("payload.scalar"),
  definition: Schema.toType(LogicalSchemaSourceSchema.fields.definition), evidence: LogicalSchemaSourceSchema.fields.evidence,
  configuration: LogicalSchemaSourceSchema.fields.evidence });
const DefinitionOptions = Schema.Struct({ scopeUuid: ScopeUuidV1Schema, epochUuid: ScopeEpochUuidV1Schema,
  applicationRead: Schema.Boolean });
const decodeDefinitionOptions = Schema.decodeUnknownEffect(DefinitionOptions);
const captureSourceInput = Schema.decodeUnknownEffect(SchemaManifestSemanticInputSchema);
const decodeSourceContract = Schema.decodeUnknownEffect(SourceContract, { onExcessProperty: "error" });
const StoredNativeMetadata = Schema.Struct({ source: LogicalSchemaSourceSchema, identity: CoreNativeIdentitySchema,
  applicationRead: Schema.Boolean });
const decodeStoredNativeMetadata = Schema.decodeUnknownEffect(StoredNativeMetadata, { onExcessProperty: "error" });
const definitions = new WeakSet<CoreNativeDefinition>();
const verifiedRegistries = new WeakMap<CoreRegistry, ReadonlyMap<string, CoreNativeDefinition>>();
const canonical = (value: Json): string => encodeCanonicalJson(value, issue => { throw new Error(`Native source lost JSON: ${issue.reason}`); });
const unsupported = (message: string, cause?: unknown) => new CoreSchemaError({ reason: "unsupportedCapability", message,
  ...(cause === undefined ? {} : { cause }) });
const producerFailure = (message: string, cause: { readonly reason: string }) => cause.reason === "digestUnavailable"
  ? new CoreSchemaError({ reason: "hashFailure", message, cause }) : unsupported(message, cause);
const revoked = () => new CoreTransactionError({ reason: "authorityRevoked" });
const corrupt = (cause?: unknown) => new CorePersistenceError({ reason: "corruptData", ...(cause === undefined ? {} : { cause }) });

/** The genuine compiler/source contract supplies every native schema and policy field. */
export const makeCoreNativeDefinition = Effect.fn("CoreNativeDefinition.make")(function* (input: Readonly<{
  source: unknown; scopeUuid: string; epochUuid: string; applicationRead?: boolean;
}>) {
  const options = yield* decodeDefinitionOptions({ ...input, applicationRead: input.applicationRead ?? false })
    .pipe(Effect.mapError(cause => unsupported("Invalid native target", cause)));
  const captured = yield* captureSourceInput(input.source)
    .pipe(Effect.mapError(cause => unsupported("Invalid native source", cause)));
  const contract = yield* decodeSourceContract(captured)
    .pipe(Effect.mapError(cause => unsupported("Only the selected scalar Payload source is supported", cause)));
  if (contract.definition.kind !== "documents" || contract.definition.relations.length !== 0)
    return yield* unsupported("Native relationships and relational sources are not supported");
  const documentDefinition = contract.definition;
  const verified = yield* verifyApplicationWritePolicies(contract.evidence, documentDefinition.tables.map(table => table.logicalName))
    .pipe(Effect.mapError(cause => producerFailure("Native producer evidence is invalid", cause)));
  const configuration = verified.policies.configuration;
  if (configuration.profile !== "payload.scalar" || canonical(contract.configuration) !== canonical(configuration)
    || verified.policies.tables.some(table => table.owner !== "payload")
    || configuration.tables.length !== documentDefinition.tables.length)
    return yield* unsupported("Native configuration does not match its producer");
  const tableNumbers = new Map(documentDefinition.tables.map((table, position) => [table.logicalName, position + 1]));
  const indexDeclarations = [];
  for (const [position, index] of documentDefinition.indexes.entries()) {
    const tableId = tableNumbers.get(index.tableLogicalName);
    if (tableId === undefined) return yield* unsupported("Native index references an unknown table");
    indexDeclarations.push({ indexId: position + 1, tableId, name: index.descriptor, fields: [...index.fields] });
  }
  yield* Effect.fromResult(validateApplicationWritePolicySchema(verified.policies,
    documentDefinition.tables.map((table, position) => ({ tableId: position + 1, name: table.logicalName,
      validator: table.definition.documentType })), [], indexDeclarations))
    .pipe(Effect.mapError(cause => unsupported("Native schema differs from the authenticated configuration", cause)));
  if (documentDefinition.indexes.length !== configuration.tables.reduce((count, table) => count + (table.indexes?.length ?? 0), 0))
    return yield* unsupported("Native indexes differ from the authenticated configuration");
  const constraints = (yield* Effect.forEach(configuration.tables, payloadUniqueDeclarations)).flat();
  if (canonical(constraints) !== canonical(documentDefinition.uniqueConstraints))
    return yield* unsupported("Native constraints differ from the authenticated configuration");
  const tables: CoreNativeDefinition["tables"][number][] = [];
  for (const table of configuration.tables) {
    const uniqueConstraints: typeof Unique.Type[] = [];
    for (const constraint of constraints.filter(candidate => candidate.tableLogicalName === table.logicalTableName)) {
      const index = documentDefinition.indexes.find(candidate => candidate.tableLogicalName === table.logicalTableName
        && candidate.fields.length === constraint.fields.length
        && candidate.fields.every((field, position) => field === constraint.fields[position]));
      if (constraint.fields.length === 0 || constraint.sparse || constraint.predicate !== undefined || index === undefined
        || constraint.fields.some(field => !table.fields.some(configured => configured.name === field && configured.kind !== "relationship")))
        return yield* unsupported("Native uniqueness requires a declared scalar index with no sparse or conditional policy");
      uniqueConstraints.push(Object.freeze({ descriptor: constraint.descriptor,
        fields: Object.freeze([...constraint.fields]), nullsDistinct: constraint.nullsDistinct, indexName: index.descriptor }));
    }
    tables.push(Object.freeze({ name: table.logicalTableName, uniqueConstraints: Object.freeze(uniqueConstraints) }));
  }
  const schema = yield* Effect.fromResult(captureCoreSchema({ schemaValidation: true,
    tables: documentDefinition.tables.map(table => ({ tableName: table.logicalName, documentType: table.definition.documentType,
      indexes: documentDefinition.indexes.filter(index => index.tableLogicalName === table.logicalName)
        .map(index => ({ indexDescriptor: index.descriptor, fields: index.fields })), stagedDbIndexes: [] })) }));
  const source = snapshotDecodedProtocolPlainData(yield* captureLogicalSchemaSource({ key: contract.sourceKey, owner: "payload", evidence: contract.evidence,
    writeProfile: contract.writeProfile, definition: documentDefinition,
    bindings: documentDefinition.tables.map(table => ({ kind: "definition", localName: table.logicalName,
      table: { namespace: "app", logicalName: table.logicalName } })) })
    .pipe(Effect.mapError(cause => producerFailure("Invalid native source definition", cause))));
  const configSha256 = yield* digestApplicationWritePolicyFrame(configuration).pipe(Effect.mapError(cause => producerFailure("Native digest failed", cause)));
  const definitionHash = yield* digestApplicationWritePolicyFrame({ sourceSha256: source.sourceSha256,
    scopeUuid: options.scopeUuid, epochUuid: options.epochUuid, applicationRead: options.applicationRead })
    .pipe(Effect.mapError(cause => producerFailure("Native digest failed", cause)));
  const identity: CoreNativeIdentity = Object.freeze({ scopeUuid: options.scopeUuid, epochUuid: options.epochUuid,
    sourceKey: contract.sourceKey, sourceSha256: source.sourceSha256, configSha256,
    provenanceSha256: configuration.provenanceSha256, definitionHash });
  const commands = ([ ["payload-create", "write"], ["payload-update", "write"], ["payload-delete", "write"],
    ["payload-find", "read"], ["payload-findByID", "read"], ["payload-count", "read"] ] as const)
    .map(([name, mode]) => Object.freeze({ name, mode, identity: Object.freeze({ source: identity, name, mode }) }));
  const metadata = canonical({ source: encodeLogicalSchemaSource(source), identity, applicationRead: options.applicationRead });
  const definition: CoreNativeDefinition = Object.freeze({ identity, source, schema, applicationRead: options.applicationRead,
    commands: Object.freeze(commands), metadata, tables: Object.freeze(tables) });
  definitions.add(definition);
  return definition;
});

export function requireCoreNativeDefinition(definition: CoreNativeDefinition): Result.Result<void, CoreSchemaError> {
  return definitions.has(definition) ? Result.succeed(undefined) : Result.fail(unsupported("Native definition was not issued by the source owner"));
}
export function sameCoreNativeIdentity(left: CoreNativeIdentity, right: CoreNativeIdentity): boolean {
  return left.scopeUuid === right.scopeUuid && left.epochUuid === right.epochUuid && left.sourceKey === right.sourceKey
    && left.sourceSha256 === right.sourceSha256 && left.configSha256 === right.configSha256
    && left.provenanceSha256 === right.provenanceSha256 && left.definitionHash === right.definitionHash;
}
function nativePolicyMatches(policy: CoreNativeTablePolicy, definition: CoreNativeDefinition, tableName: string): boolean {
  const expected = definition.tables.find(table => table.name === tableName);
  return expected !== undefined && sameCoreNativeIdentity(policy.identity, definition.identity)
    && policy.applicationRead === definition.applicationRead
    && sameNativeConstraints(policy.uniqueConstraints, expected.uniqueConstraints);
}
function sameNativeConstraints(left: CoreNativeTablePolicy["uniqueConstraints"], right: CoreNativeTablePolicy["uniqueConstraints"]): boolean {
  return left.length === right.length && left.every((constraint, position) => {
      const clause = right[position];
      return clause !== undefined && constraint.descriptor === clause.descriptor
        && constraint.indexName === clause.indexName
        && coreNativeConstraintNullsDistinct(constraint) === coreNativeConstraintNullsDistinct(clause)
        && JSON.stringify(coreNativeConstraintFields(constraint)) === JSON.stringify(coreNativeConstraintFields(clause));
    });
}
/** Identity-preserving replay compares authenticated policy meaning, not object key order or the Legacy clause encoding. */
export function sameCoreNativeTablePolicy(left: CoreNativeTablePolicy, right: CoreNativeTablePolicy): boolean {
  return left.state === right.state && left.schemaId === right.schemaId
    && left.applicationRead === right.applicationRead && sameCoreNativeIdentity(left.identity, right.identity)
    && sameNativeConstraints(left.uniqueConstraints, right.uniqueConstraints);
}
export function checkCoreTableAccess(table: CoreTableDefinition, mode: "read" | "write",
  authority?: CoreNativeAuthority): Result.Result<void, CoreTransactionError> {
  const policy = table.nativePolicy;
  if (authority === undefined) return policy === undefined || (mode === "read" && policy.state === "active" && policy.applicationRead)
    ? Result.succeed(undefined) : Result.fail(revoked());
  const expected = authority.tables.find(candidate => candidate.name === table.name);
  return policy?.state === "active" && expected !== undefined && bytesEqual(expected.tabletId, table.tabletId)
    && coreNamespaceKey(table.namespace) === coreNamespaceKey(authority.namespace)
    && policy.schemaId === authority.schemaId && nativePolicyMatches(policy, authority.definition, table.name)
    ? Result.succeed(undefined) : Result.fail(revoked());
}

export function checkCoreNativeAuthority(registry: CoreRegistry, authority: CoreNativeAuthority, tableName?: string): Result.Result<void, CoreError> {
  return Result.gen(function* () {
    if (registry.authority?.epoch !== authority.authorityEpoch) return yield* Result.fail(revoked());
    const schemaTable = registry.table(SCHEMAS, authority.namespace)?.definition;
    const stateIndex = schemaTable?.indexes.find(index => index.name === "by_state");
    if (schemaTable === undefined || stateIndex === undefined) return yield* Result.fail(revoked());
    const active = yield* registry.schemas.getByState(authority.namespace, "active", stateIndex.ref, () => {});
    if (Option.isNone(active) || active.value.id !== authority.schemaId || active.value.metadata.native !== authority.definition.metadata)
      return yield* Result.fail(revoked());
    const tables = tableName === undefined ? authority.tables : authority.tables.filter(table => table.name === tableName);
    if (tables.length === 0) return yield* Result.fail(revoked());
    for (const expected of tables) {
      const table = registry.table(expected.name, authority.namespace)?.definition;
      if (table === undefined || table.state !== "active" || table.number !== expected.number) return yield* Result.fail(revoked());
      yield* checkCoreTableAccess(table, "read", authority);
      if (JSON.stringify(table.nativePolicy) !== JSON.stringify(expected.nativePolicy)) return yield* Result.fail(revoked());
      for (const index of expected.indexes) {
        const actual = table.indexes.find(candidate => candidate.name === index.name);
        if (actual === undefined || !bytesEqual(index.ref.id, actual.ref.id)
          || JSON.stringify(index.fields) !== JSON.stringify(actual.fields)) return yield* Result.fail(revoked());
      }
      yield* checkNativeTableIndexes(registry, table, authority.definition, true).pipe(Result.mapError(() => revoked()));
    }
  });
}

interface NativeSchema { readonly namespace: CoreTableNamespace; readonly selection: CoreSchemaSelection }
const nativeTableKey = (table: CoreTableDefinition) => JSON.stringify([coreNamespaceKey(table.namespace), table.name,
  table.number, encodeBytesToLowercaseHex(table.tabletId)]);
function nativeSchemas(registry: CoreRegistry): Result.Result<readonly NativeSchema[], CorePersistenceError> {
  return Result.gen(function* () {
    const selected: NativeSchema[] = [];
    for (const { definition: table } of registry.tables.values()) {
      if (table.name !== SCHEMAS || table.state !== "active") continue;
      for (const state of ["active", "pending", "validated"] as const) {
        const schema = yield* registry.schemas.nativeByState(table.namespace, state);
        if (Option.isSome(schema)) selected.push({ namespace: table.namespace, selection: schema.value });
      }
    }
    return selected;
  });
}
function checkNativeTableIndexes(registry: CoreRegistry, table: CoreTableDefinition, definition: CoreNativeDefinition,
  active: boolean): Result.Result<void, CorePersistenceError> {
  const schema = definition.schema.tables.find(candidate => candidate.tableName === table.name);
  if (schema === undefined) return Result.fail(corrupt("Native table is absent from its producer schema"));
  const expected = [{ name: "by_id", fields: [] }, { name: "by_creation_time", fields: ["_creationTime"] },
    ...schema.indexes.map(index => ({ name: index.indexDescriptor, fields: index.fields }))];
  const actual = registry.indexesForTablet(table.tabletId);
  if (actual.length !== expected.length || actual.some(index => {
    const declaration = expected.find(candidate => candidate.name === index.name);
    return declaration === undefined || JSON.stringify(index.fields) !== JSON.stringify(declaration.fields)
      || isCoreIndexStaged(index) || active && index.state.type !== "Enabled";
  })) return Result.fail(corrupt("Native index generations differ from their authenticated declarations"));
  return Result.succeed(undefined);
}
function checkNativeRegistry(registry: CoreRegistry, sources: ReadonlyMap<string, CoreNativeDefinition>):
  Result.Result<ReadonlyMap<string, CoreNativeDefinition>, CorePersistenceError> {
  return Result.gen(function* () {
    const schemas = yield* nativeSchemas(registry), selected = new Map<string, CoreNativeDefinition>();
    const ownedTables = new Set<string>();
    for (const { namespace, selection } of schemas) {
      const metadata = selection.metadata.native;
      const definition = metadata === undefined ? undefined : sources.get(metadata);
      if (definition === undefined || definition.metadata !== metadata)
        return yield* Result.fail(corrupt("Native schema has no authenticated source proof"));
      const expectedSchema = yield* serializeCoreSchema(definition.schema).pipe(Result.mapError(corrupt));
      const actualSchema = yield* serializeCoreSchema(selection.schema).pipe(Result.mapError(corrupt));
      if (expectedSchema !== actualSchema) return yield* Result.fail(corrupt("Native schema differs from its authenticated source"));
      selected.set(metadata, definition);
      const state = selection.metadata.state.state === "active" ? "active" : "reserved";
      for (const declaration of definition.tables) {
        const table = registry.table(declaration.name, namespace)?.definition;
        if (table?.nativePolicy === undefined || table.state !== "active" || table.nativePolicy.state !== state
          || table.nativePolicy.schemaId !== selection.id || !nativePolicyMatches(table.nativePolicy, definition, table.name))
          return yield* Result.fail(corrupt("Native table policy differs from its authenticated source"));
        yield* checkNativeTableIndexes(registry, table, definition, state === "active");
        const key = nativeTableKey(table);
        if (ownedTables.has(key)) return yield* Result.fail(corrupt("Native table has multiple schema owners"));
        ownedTables.add(key);
      }
    }
    for (const { definition: table } of registry.tables.values()) if (table.nativePolicy !== undefined
      && !ownedTables.has(nativeTableKey(table)))
      return yield* Result.fail(corrupt("Native table policy has no authenticated schema owner"));
    return selected;
  });
}

/** Decode stored wire through the same producer owner used for a fresh installation. */
const readStoredNativeDefinition = Effect.fn("CoreNativeDefinition.readStored")(function* (metadata: string) {
  const json = yield* Effect.try({ try: (): unknown => JSON.parse(metadata), catch: corrupt });
  const stored = yield* decodeStoredNativeMetadata(json).pipe(Effect.mapError(corrupt));
  if (stored.source.definition.kind !== "documents") return yield* corrupt("Unsupported native source definition");
  const policies = yield* Effect.fromResult(decodeApplicationWritePolicies(stored.source.evidence,
    stored.source.definition.tables.map(table => table.logicalName))).pipe(Effect.mapError(corrupt));
  const definition = yield* makeCoreNativeDefinition({ source: { sourceKey: stored.source.key,
    writeProfile: stored.source.writeProfile, definition: stored.source.definition, evidence: stored.source.evidence,
    configuration: policies.configuration }, scopeUuid: stored.identity.scopeUuid, epochUuid: stored.identity.epochUuid,
    applicationRead: stored.applicationRead }).pipe(Effect.mapError(error => error.reason === "hashFailure" ? error : corrupt(error)));
  if (definition.metadata !== metadata) return yield* corrupt("Stored native source identity does not match its authoritative frame");
  return definition;
});

/** Cold bootstrap and complete metadata candidates authenticate before serving or settlement. */
export const authenticateCoreNativeRegistry = Effect.fn("CoreNativeRegistry.authenticate")(function* (
  registry: CoreRegistry, predecessor?: CoreRegistry,
) {
  const inherited = predecessor === undefined ? undefined : verifiedRegistries.get(predecessor);
  const sources = new Map<string, CoreNativeDefinition>();
  for (const { selection } of yield* Effect.fromResult(nativeSchemas(registry))) {
    const metadata = selection.metadata.native;
    if (metadata === undefined) return yield* corrupt();
    const definition = inherited?.get(metadata) ?? sources.get(metadata) ?? (yield* readStoredNativeDefinition(metadata));
    sources.set(metadata, definition);
  }
  const checked = yield* Effect.fromResult(checkNativeRegistry(registry, sources));
  verifiedRegistries.set(registry, checked);
});

/** The ordering owner folds only already authenticated source proofs; no crypto or I/O runs here. */
export function checkCoreNativeRegistryTransition(registry: CoreRegistry, current: CoreRegistry,
  candidate: CoreRegistry): Result.Result<void, CorePersistenceError> {
  const sources = new Map([...(verifiedRegistries.get(current) ?? []), ...(verifiedRegistries.get(candidate) ?? [])]);
  return Result.map(checkNativeRegistry(registry, sources), checked => { verifiedRegistries.set(registry, checked); });
}

export function coreNativeMetadataReads(registry: CoreRegistry, authority: CoreNativeAuthority, tableName?: string): Result.Result<CoreReadSet, CoreError> {
  return Result.gen(function* () {
    yield* checkCoreNativeAuthority(registry, authority, tableName);
    const reads = new CoreReadSetBuilder();
    const programs = registry.table(PROGRAMS)?.definition, authorityRecord = registry.authority;
    const programsById = programs?.indexes.find(index => index.name === "by_id");
    if (programs === undefined || programsById === undefined || authorityRecord === undefined) return yield* Result.fail(revoked());
    const authorityId = yield* publicDocumentId(programs, authorityRecord.id);
    const authorityKey = yield* Result.mapError(encodeIndexKey([], authorityId), cause => new CoreTransactionError({ reason: "invalidValue", cause }));
    reads.add(programsById.ref.id, pointInterval(authorityKey));
    const tables = registry.table(TABLES)?.definition, schemas = registry.table(SCHEMAS, authority.namespace)?.definition;
    const tableById = tables?.indexes.find(index => index.name === "by_id"), schemaById = schemas?.indexes.find(index => index.name === "by_id");
    const state = schemas?.indexes.find(index => index.name === "by_state");
    if (tables === undefined || schemas === undefined || tableById === undefined || schemaById === undefined || state === undefined)
      return yield* Result.fail(revoked());
    const stateKey = yield* Result.mapError(encodeIndexValue({ state: "active" }), cause => new CoreTransactionError({ reason: "invalidValue", cause }));
    reads.add(state.ref.id, { start: stateKey, end: incrementIndexKeyPrefix(stateKey) });
    const schemaKey = yield* Result.mapError(encodeIndexKey([], authority.schemaId), cause => new CoreTransactionError({ reason: "invalidValue", cause }));
    reads.add(schemaById.ref.id, pointInterval(schemaKey));
    for (const table of authority.tables.filter(candidate => tableName === undefined || candidate.name === tableName)) {
      const id = yield* publicDocumentId(tables, table.tabletId);
      const key = yield* Result.mapError(encodeIndexKey([], id), cause => new CoreTransactionError({ reason: "invalidValue", cause }));
      reads.add(tableById.ref.id, pointInterval(key));
      for (const index of table.indexes) yield* addIndexMetadataDependency(reads, registry, index);
    }
    return reads.snapshot();
  });
}
