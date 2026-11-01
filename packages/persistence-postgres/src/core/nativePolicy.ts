import { Effect, Option, Result, Schema } from "effect";
import { bytesEqual, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { decodeApplicationWritePolicies, digestApplicationWritePolicyFrame, payloadUniqueDeclarations,
  validateApplicationWritePolicySchema, verifyApplicationWritePolicies } from "@flarex/analysis/internal/application-write-policy";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { LogicalSchemaSourceSchema, encodeLogicalSchemaSource, type LogicalSchemaSource, type QualifiedLogicalTable } from "flarex-protocol/internal/logical-schema-candidate";
import { compileLogicalDocumentReference } from "flarex-protocol/internal/logical-storage-requirements";
import { encodeCanonicalJson, type Json } from "flarex-protocol/json";
import { ScopeEpochUuidV1Schema, ScopeUuidV1Schema } from "flarex-protocol/storage-authority";
import { encodeIndexKey, encodeIndexValue } from "flarex-protocol/index-key";
import { incrementIndexKeyPrefix } from "flarex-protocol/index-range";
import { snapshotDecodedProtocolPlainData } from "flarex-protocol/internal/decoded-protocol-snapshot";
import { SchemaManifestSemanticInputSchema } from "flarex-protocol/schema-manifest";
import { CoreTransactionError, type CoreError, type CoreNativeCommandDefinition, type CoreTableDefinition } from "./api";
import { captureCoreSchema, CoreSchemaError, type CoreSchemaDefinition, type CoreSchemaInputSchema } from "./schemaTypes";
import { coreNamespaceKey, type CoreTableNamespace } from "./namespace";
import { PROGRAMS, SCHEMAS, TABLES, publicDocumentId, type CoreRegistry } from "./registry";
import { CoreReadSetBuilder, pointInterval, type CoreReadSet } from "./writeLog";
import { addIndexMetadataDependency } from "./dependencies";
import { CorePersistenceError } from "./contracts";
import { serializeCoreSchema } from "./schemaJson";
import type { CoreSchemaSelection } from "./schemaRegistry";
import { isCoreIndexStaged } from "./indexState";
import type { RelationalPersistenceCapability, RelationalTableDefinition } from "flarex-protocol/internal/relational-schema";
import { encodeValidatorJsonV1, type ValidatorJsonV1 } from "flarex-protocol/validator-json";
import { prepareRelationalRows, type RelationalRowFailureDiagnostic } from "../values/relationalRows";
import { coreNativeIndexName, coreNativeReferenceTableName, coreNativeTableName } from "./schemaTableName";
import { coreSchemaBundleNative, isCoreSchemaBundleSuccessor, requireCoreSchemaBundle, type CoreSchemaBundle } from "./schemaBundle";
import { isCorePrivateTable } from "./nativeTableAccess";

import { CoreNativeIdentitySchema, CoreNativeUniqueConstraintSchema as Unique, type CoreNativeIdentity,
  type CoreNativeTablePolicy, type CoreNativeReference, coreNativeConstraintFields, coreNativeConstraintNullsDistinct } from "./nativePolicyTypes";
import type { CoreNativePrivateReferenceRole } from "./nativePolicyTypes";
export { CoreNativeIdentitySchema, CoreNativeTablePolicySchema, coreNativeConstraintFields,
  coreNativeConstraintNullsDistinct } from "./nativePolicyTypes";
export type { CoreNativeIdentity, CoreNativeTablePolicy, CoreNativeReference, CoreNativeReferenceProjection,
  CoreNativePrivateReferenceRole } from "./nativePolicyTypes";
export interface CoreNativeTableDeclaration {
  readonly name: string;
  readonly localName?: string;
  readonly table?: QualifiedLogicalTable;
  readonly uniqueConstraints: readonly typeof Unique.Type[];
  readonly indexes?: readonly CoreNativeRelationalIndex[];
  readonly privateReference?: CoreNativePrivateReferenceRole;
}
export interface CoreNativePrivateTableDeclaration extends CoreNativeTableDeclaration {
  readonly privateReference: CoreNativePrivateReferenceRole;
}
export interface CoreNativeDefinition {
  readonly identity: CoreNativeIdentity;
  readonly source: LogicalSchemaSource;
  readonly schema: CoreSchemaDefinition;
  readonly applicationRead: boolean;
  readonly commands: readonly CoreNativeCommandDefinition[];
  /** Authoritative source wire and exposure, stored with the shared schema record. */
  readonly metadata: string;
  readonly references: readonly CoreNativeReference[];
  /** Business capabilities never include derived private projection tables. */
  readonly tables: readonly CoreNativeTableDeclaration[];
  readonly privateTables?: readonly CoreNativePrivateTableDeclaration[];
}

export function coreNativeStoredTables(definition: Pick<CoreNativeDefinition, "tables" | "privateTables">):
  readonly (CoreNativeTableDeclaration | CoreNativePrivateTableDeclaration)[] {
  return definition.privateTables === undefined ? definition.tables : [...definition.tables, ...definition.privateTables];
}
export interface CoreNativeRelationalIndex {
  readonly nativeId: string;
  readonly kind: "key" | "index";
  readonly indexName: string;
  readonly fields: readonly string[];
  readonly requiredPrefix?: Readonly<{ field: string; value: null }>;
}
export interface CoreNativeRelationalRowPolicy {
  readonly table: RelationalTableDefinition;
  readonly capabilities: readonly RelationalPersistenceCapability[];
  readonly rows: ReturnType<typeof prepareRelationalRows<CoreError>> extends Result.Result<infer Rows, CoreError> ? Rows : never;
}
const relationalPolicies = new WeakMap<CoreNativeDefinition, ReadonlyMap<string, CoreNativeRelationalRowPolicy>>();
const relationalFailures = new WeakMap<object, Readonly<{ table: RelationalTableDefinition; diagnostic: RelationalRowFailureDiagnostic }>>();
export const coreNativeRelationalRows = (definition: CoreNativeDefinition, tableName: string) => relationalPolicies.get(definition)?.get(tableName);
export const coreNativeRelationalFailure = (failure: unknown) =>
  (typeof failure === "object" && failure !== null) || typeof failure === "function" ? relationalFailures.get(failure) : undefined;
/** Trusted transaction data, constructed only after a DB-owned binding has been checked. */
export interface CoreNativeAuthority {
  readonly definition: CoreNativeDefinition;
  readonly namespace: CoreTableNamespace;
  readonly schemaId: string;
  readonly authorityEpoch: bigint;
  readonly tables: readonly CoreTableDefinition[];
}
export interface CoreApplicationInsertAuthority {
  readonly kind: "applicationInsert";
  readonly sourceKey: "application";
  readonly namespace: CoreTableNamespace;
  readonly schemaId: string;
  readonly authorityEpoch: bigint;
  readonly table: CoreTableDefinition;
  readonly bundle: CoreSchemaBundle;
}
const SourceContract = Schema.Struct({ sourceKey: Schema.Literal("payload"), writeProfile: Schema.Literals([
  "payload.scalar", "payload.content-relations", "payload.content-many", "payload.content-joins"]),
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
const definitions = new WeakSet<object>();
type NativeSchemaProof = CoreNativeDefinition | CoreSchemaBundle;
const verifiedRegistries = new WeakMap<CoreRegistry, ReadonlyMap<string, NativeSchemaProof>>();
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
    .pipe(Effect.mapError(cause => unsupported("Only the selected Payload document source is supported", cause)));
  const manyProfile = contract.writeProfile === "payload.content-many" || contract.writeProfile === "payload.content-joins";
  if (contract.definition.kind !== "documents" || contract.definition.relations.length !== (contract.writeProfile === "payload.scalar" ? 0 : manyProfile ? 2 : 1))
    return yield* unsupported("Native document declarations differ from the selected profile");
  const documentDefinition = contract.definition;
  const verified = yield* verifyApplicationWritePolicies(contract.evidence, documentDefinition.tables.map(table => table.logicalName))
    .pipe(Effect.mapError(cause => producerFailure("Native producer evidence is invalid", cause)));
  const configuration = verified.policies.configuration;
  if (configuration.profile !== contract.writeProfile || canonical(contract.configuration) !== canonical(configuration)
    || verified.policies.tables.some(table => table.owner !== "payload")
    || configuration.tables.length !== documentDefinition.tables.length)
    return yield* unsupported("Native configuration does not match its producer");
  const tableNumbers = new Map<string, number>(documentDefinition.tables.map((table, position) => [table.logicalName, position + 1]));
  const indexDeclarations = [];
  for (const [position, index] of documentDefinition.indexes.entries()) {
    const tableId = tableNumbers.get(index.tableLogicalName);
    if (tableId === undefined) return yield* unsupported("Native index references an unknown table");
    indexDeclarations.push({ indexId: position + 1, tableId, name: index.descriptor, fields: [...index.fields] });
  }
  yield* Effect.fromResult(validateApplicationWritePolicySchema(verified.policies,
    documentDefinition.tables.map((table, position) => ({ tableId: position + 1, name: table.logicalName,
      validator: table.definition.documentType })), documentDefinition.relations.map((declaration, index) => ({ declaration,
        relationOrdinal: index + 1, sourceTableOrdinal: tableNumbers.get(declaration.source.table) ?? 0,
        targetTableOrdinal: tableNumbers.get(declaration.target.table) ?? 0 })), indexDeclarations))
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
  const source = snapshotDecodedProtocolPlainData(yield* captureLogicalSchemaSource({ key: contract.sourceKey, owner: "payload", evidence: contract.evidence,
    writeProfile: contract.writeProfile, definition: documentDefinition,
    bindings: documentDefinition.tables.map(table => ({ kind: "definition", localName: table.logicalName,
      table: { namespace: "app", logicalName: table.logicalName } })) })
    .pipe(Effect.mapError(cause => producerFailure("Invalid native source definition", cause))));
  if (source.definition.kind !== "documents") return yield* unsupported("Native document source lost its definition");
  const references: CoreNativeReference[] = [];
  const privateTables: CoreNativePrivateTableDeclaration[] = [];
  const privateSchemas: (typeof CoreSchemaInputSchema.Type)["tables"][number][] = [];
  for (const declaration of source.definition.relations) {
    if (!tableNumbers.has(declaration.source.table) || !tableNumbers.has(declaration.target.table))
      return yield* unsupported("Native reference endpoints are outside their authenticated source");
    const field = declaration.source.path[0].name;
    if (declaration.value.cardinality === "many") {
      if (!manyProfile || declaration.source.path.length !== 1 || declaration.value.minItems !== 0
        || declaration.value.maxItems !== 32 || !declaration.value.ordered || declaration.value.duplicates !== "forbid"
        || declaration.localized || declaration.inverse.name !== null || declaration.onTargetDelete !== "restrict")
        return yield* unsupported("Native many declaration differs from its admitted profile");
      const name = `document-relation/${source.key}/${declaration.source.table}/${declaration.source.forwardName}`;
      const tableName = yield* coreNativeReferenceTableName(source.key, name);
      if (tableNumbers.has(tableName) || privateTables.some(table => table.name === tableName))
        return yield* unsupported("Native private reference tables collide with their source");
      const projection = Object.freeze({ tableName, bySourceIndex: "by_source_target" as const, byTargetIndex: "by_target_source" as const });
      references.push(snapshotDecodedProtocolPlainData({ declaration, reference: { kind: "manyMembership" as const, name, sourceKey: source.key },
        sourceTable: declaration.source.table, targetTable: declaration.target.table, field,
        indexName: projection.byTargetIndex, projection }));
      privateTables.push(Object.freeze({ name: tableName, uniqueConstraints: Object.freeze([]),
        privateReference: Object.freeze({ kind: "referenceMembership", referenceName: name }) }));
      privateSchemas.push({ tableName, documentType: { type: "object", value: {
        sourceId: { optional: false, fieldType: { type: "id", tableName: declaration.source.table } },
        targetId: { optional: false, fieldType: { type: "id", tableName: declaration.target.table } },
      } }, indexes: [{ indexDescriptor: projection.bySourceIndex, fields: ["sourceId", "targetId"] },
        { indexDescriptor: projection.byTargetIndex, fields: ["targetId", "sourceId"] }], stagedDbIndexes: [] });
      continue;
    }
    const reference = yield* Effect.fromResult(compileLogicalDocumentReference(source, declaration))
      .pipe(Effect.mapError(cause => unsupported("Native scalar reference declaration is unsupported", cause)));
    const indexName = `by_reference_${declaration.source.forwardName}`;
    const sourceTable: string = declaration.source.table;
    if (documentDefinition.indexes.some(index => index.tableLogicalName === sourceTable
      && (index.descriptor === indexName || index.fields.length === 1 && index.fields[0] === reference.source.field)))
      return yield* unsupported("Native derived reference index collides with a producer declaration");
    references.push(snapshotDecodedProtocolPlainData({ declaration, reference, sourceTable: declaration.source.table,
      targetTable: declaration.target.table, field: reference.source.field, indexName }));
  }
  if (references.length !== documentDefinition.relations.length)
    return yield* unsupported("Native reference lowering is incomplete");
  const schema = yield* Effect.fromResult(captureCoreSchema({ schemaValidation: true,
    tables: [...documentDefinition.tables.map(table => ({ tableName: table.logicalName, documentType: table.definition.documentType,
      indexes: [...documentDefinition.indexes.filter(index => index.tableLogicalName === table.logicalName)
        .map(index => ({ indexDescriptor: index.descriptor, fields: index.fields })),
        ...references.filter(reference => reference.sourceTable === table.logicalName && !("projection" in reference))
          .map(reference => ({ indexDescriptor: reference.indexName, fields: [reference.field] }))], stagedDbIndexes: [] })), ...privateSchemas] }));
  const configSha256 = yield* digestApplicationWritePolicyFrame(configuration).pipe(Effect.mapError(cause => producerFailure("Native digest failed", cause)));
  const definitionFrame = { sourceSha256: source.sourceSha256,
    scopeUuid: options.scopeUuid, epochUuid: options.epochUuid, applicationRead: options.applicationRead };
  const loweredSchema = manyProfile ? yield* Effect.fromResult(serializeCoreSchema(schema)) : undefined;
  const definitionHash = yield* digestApplicationWritePolicyFrame(loweredSchema === undefined ? definitionFrame : {
    format: "flarex.core-native-memberships", version: 1, loweringVersion: 1, ...definitionFrame, schema: loweredSchema })
    .pipe(Effect.mapError(cause => producerFailure("Native digest failed", cause)));
  const identity: CoreNativeIdentity = Object.freeze({ scopeUuid: options.scopeUuid, epochUuid: options.epochUuid,
    sourceKey: contract.sourceKey, sourceSha256: source.sourceSha256, configSha256,
    provenanceSha256: configuration.provenanceSha256, definitionHash });
  const commands = ([ ["payload-create", "write"], ["payload-update", "write"], ["payload-delete", "write"],
    ["payload-find", "read"], ["payload-findByID", "read"], ["payload-count", "read"] ] as const)
    .map(([name, mode]) => Object.freeze({ name, mode, identity: Object.freeze({ source: identity, name, mode }) }));
  const metadataFrame = { source: encodeLogicalSchemaSource(source), identity, applicationRead: options.applicationRead };
  const metadata = canonical(loweredSchema === undefined ? metadataFrame : {
    format: "flarex.core-native-memberships", version: 1, loweringVersion: 1, ...metadataFrame,
    privateTables: privateTables.map(table => ({ name: table.name, privateReference: { ...table.privateReference } })), schema: loweredSchema });
  const definition: CoreNativeDefinition = Object.freeze({ identity, source, schema, applicationRead: options.applicationRead,
    commands: Object.freeze(commands), metadata, tables: Object.freeze(tables), references: Object.freeze(references),
    ...(privateTables.length === 0 ? {} : { privateTables: Object.freeze(privateTables) }) });
  definitions.add(definition);
  return definition;
});

const NativeCommands = Schema.Array(Schema.Struct({ name: Schema.NonEmptyString,
  mode: Schema.Literals(["read", "write"]) }).annotate({ parseOptions: { onExcessProperty: "error" } }))
  .check(Schema.isMaxLength(128), Schema.makeFilter(commands =>
    new Set(commands.map(command => command.name)).size === commands.length ? undefined : "Native command names must be distinct"));
const decodeRelationalInput = Schema.decodeUnknownEffect(Schema.Struct({ source: Schema.toType(LogicalSchemaSourceSchema),
  scopeUuid: ScopeUuidV1Schema, epochUuid: ScopeEpochUuidV1Schema, provenance: LogicalSchemaSourceSchema.fields.evidence,
  commands: NativeCommands, applicationRead: Schema.optionalKey(Schema.Boolean),
}).annotate({ parseOptions: { onExcessProperty: "error" } }));
const decodeRelationalEvidence = Schema.decodeUnknownEffect(Schema.Struct({ provenance: LogicalSchemaSourceSchema.fields.evidence }));

/** Trusted native producer seam. The expected bundle is rebuilt through that
 * producer on reopen; persisted relational metadata alone cannot issue proof. */
export const makeCoreRelationalNativeDefinition = Effect.fn("CoreNativeDefinition.relational")(function* (input: Readonly<{
  source: LogicalSchemaSource; scopeUuid: string; epochUuid: string; provenance: Json;
  commands: readonly Readonly<{ name: string; mode: "read" | "write" }>[]; applicationRead?: boolean;
}>) {
  const captured = yield* captureSourceInput(input).pipe(Effect.mapError(cause => unsupported("Invalid relational definition input", cause)));
  const frame = yield* decodeRelationalInput(captured).pipe(Effect.mapError(cause => unsupported("Invalid relational definition input", cause)));
  const options = { scopeUuid: frame.scopeUuid, epochUuid: frame.epochUuid, applicationRead: frame.applicationRead ?? false };
  const decoded = frame.source;
  if (decoded.definition.kind !== "relational" || decoded.owner === "application"
    || decoded.definition.schema.coordinate.owner !== decoded.owner || decoded.bindings.some(binding => binding.kind !== "definition"))
    return yield* unsupported("Native relational source ownership is not supported");
  const { sourceSha256, ...sourceFrame } = decoded;
  const recaptured = yield* captureLogicalSchemaSource(sourceFrame)
    .pipe(Effect.mapError(cause => producerFailure("Invalid relational source digest", cause)));
  if (recaptured.sourceSha256 !== sourceSha256) return yield* unsupported("Relational source digest differs from its definition");
  const source = snapshotDecodedProtocolPlainData(recaptured);
  if (source.definition.kind !== "relational") return yield* unsupported("Relational source lost its definition");
  const evidence = yield* decodeRelationalEvidence(source.evidence)
    .pipe(Effect.mapError(cause => unsupported("Relational source has no native provenance", cause)));
  if (canonical(frame.provenance) !== canonical(evidence.provenance)) return yield* unsupported("Native provenance differs from its source");
  const relational = source.definition.schema;
  const registrations = frame.commands;
  const declarations: CoreNativeDefinition["tables"][number][] = [];
  const schemaTables: (typeof CoreSchemaInputSchema.Type)["tables"][number][] = [];
  const policies = new Map<string, CoreNativeRelationalRowPolicy>();
  const sourceNames = new Set<string>();
  if (relational.tables.length === 0 || relational.tables.length > 256 || source.bindings.length !== relational.tables.length)
    return yield* unsupported("Relational source table closure is invalid");
  for (const table of relational.tables) {
    const binding = source.bindings.find(candidate => candidate.localName === table.identity.tableId);
    if (binding === undefined || sourceNames.has(binding.localName) || binding.table.namespace !== source.owner)
      return yield* unsupported("Relational table bindings differ from their producer");
    sourceNames.add(binding.localName);
    if (table.relationships.length !== 0 || table.constraints.some(constraint => constraint.kind === "foreignKey")
      || table.columns.some(column => column.type === "real" || column.default.kind === "serialNext"))
      return yield* unsupported("Relational relationships, REAL conversion and serial allocation are not admitted");
    const name = yield* coreNativeTableName(binding.table);
    const error = (reason: "invalidInput" | "documentInvalid" | "storedCorruption" | "limitExceeded", cause?: unknown,
      diagnostic?: RelationalRowFailureDiagnostic): CoreError => {
      const failure = reason === "storedCorruption" ? corrupt(cause) : new CoreTransactionError({
        reason: reason === "limitExceeded" ? "capacity" : reason === "invalidInput" ? "invalidValue" : "documentValidation",
        ...(cause === undefined ? {} : { cause }),
      });
      if (diagnostic !== undefined) relationalFailures.set(failure, Object.freeze({ table, diagnostic }));
      return failure;
    };
    const rows = yield* Effect.fromResult(prepareRelationalRows(table, relational.capabilities, error))
      .pipe(Effect.mapError(cause => unsupported("Relational scalar row policy is not supported", cause)));
    policies.set(name, Object.freeze({ table, capabilities: relational.capabilities, rows }));
    const indexes: CoreNativeRelationalIndex[] = [], uniqueConstraints: typeof Unique.Type[] = [];
    for (const key of table.keys) {
      const fields = key.columns.map(column => column.columnId);
      if (fields.length === 0 || fields.some(field => {
        const column = table.columns.find(candidate => candidate.identity.columnId === field);
        return column === undefined || column.type === "numeric" || column.type === "jsonb";
      })) return yield* unsupported("Relational key requires admitted ordered scalar columns");
      const indexName = yield* coreNativeIndexName(binding.table, "key", key.identity.keyId);
      indexes.push(Object.freeze({ nativeId: key.identity.keyId, kind: "key", indexName, fields: Object.freeze(fields) }));
      uniqueConstraints.push(Object.freeze({ descriptor: key.identity.keyId, fields: Object.freeze(fields),
        indexName, nullsDistinct: key.kind !== "primary" }));
    }
    for (const index of table.indexes) {
      if (index.kind !== "btree" || index.predicate !== null && index.predicate.kind !== "isNull")
        return yield* unsupported("Relational index requires an ordinary or isNull B-tree lowering");
      const prefix = index.predicate === null ? undefined : index.predicate.column.columnId;
      const fields = [...(prefix === undefined ? [] : [prefix]), ...index.columns.map(column => column.columnId)
        .filter(field => field !== prefix)];
      if (fields.length === 0 || fields.some(field => {
        const column = table.columns.find(candidate => candidate.identity.columnId === field);
        return column === undefined || column.type === "numeric" || column.type === "jsonb";
      })) return yield* unsupported("Relational index requires admitted ordered scalar columns");
      const indexName = yield* coreNativeIndexName(binding.table, "index", index.identity.indexId);
      indexes.push(Object.freeze({ nativeId: index.identity.indexId, kind: "index", indexName, fields: Object.freeze(fields),
        ...(prefix === undefined ? {} : { requiredPrefix: Object.freeze({ field: prefix, value: null }) }) }));
    }
    const value: Record<string, { fieldType: ValidatorJsonV1; optional: false }> = {};
    for (const column of table.columns) {
      const fieldType: ValidatorJsonV1 = column.type === "text" || column.type === "timestamptz" ? { type: "string" }
        : column.type === "boolean" ? { type: "boolean" }
        : column.type === "integer" || column.type === "doublePrecision" ? { type: "number" }
        : column.type === "numeric" ? { type: "union", value: [{ type: "number" }, { type: "string" }] } : { type: "any" };
      value[column.identity.columnId] = { fieldType: column.nullable ? { type: "union", value: [fieldType, { type: "null" }] } : fieldType,
        optional: false };
    }
    schemaTables.push({ tableName: name, documentType: { type: "object", value },
      indexes: indexes.map(index => ({ indexDescriptor: index.indexName, fields: index.fields })), stagedDbIndexes: [] });
    declarations.push(Object.freeze({ name, localName: binding.localName, table: binding.table,
      uniqueConstraints: Object.freeze(uniqueConstraints), indexes: Object.freeze(indexes) }));
  }
  const schema = yield* Effect.fromResult(captureCoreSchema({ schemaValidation: true, tables: schemaTables }));
  const provenanceSha256 = yield* digestApplicationWritePolicyFrame(evidence.provenance)
    .pipe(Effect.mapError(cause => producerFailure("Native provenance digest failed", cause)));
  const configSha256 = yield* digestApplicationWritePolicyFrame({ definition: source.definition, writeProfile: source.writeProfile })
    .pipe(Effect.mapError(cause => producerFailure("Native configuration digest failed", cause)));
  const definitionHash = yield* digestApplicationWritePolicyFrame({ format: "flarex.core-relational-native", version: 1,
    loweringVersion: 1, sourceSha256: source.sourceSha256, scopeUuid: options.scopeUuid, epochUuid: options.epochUuid,
    provenanceSha256, applicationRead: options.applicationRead })
    .pipe(Effect.mapError(cause => producerFailure("Native definition digest failed", cause)));
  const identity: CoreNativeIdentity = Object.freeze({ scopeUuid: options.scopeUuid, epochUuid: options.epochUuid,
    sourceKey: source.key, sourceSha256: source.sourceSha256, configSha256, provenanceSha256, definitionHash });
  const commands = registrations.map(({ name, mode }) => Object.freeze({ name, mode,
    identity: Object.freeze({ source: identity, name, mode }) }));
  const metadata = canonical({ format: "flarex.core-relational-native", version: 1, loweringVersion: 1,
    source: encodeLogicalSchemaSource(source), identity, applicationRead: options.applicationRead,
    commands: registrations, tables: declarations.map(table => ({ name: table.name, localName: table.localName ?? table.name,
      table: table.table === undefined ? null : { ...table.table }, uniqueConstraints: table.uniqueConstraints.map(constraint => ({ ...constraint })),
      indexes: table.indexes?.map(index => ({ ...index })) ?? [] })) });
  const definition: CoreNativeDefinition = Object.freeze({ identity, source, schema, applicationRead: options.applicationRead,
    commands: Object.freeze(commands), metadata, tables: Object.freeze(declarations), references: Object.freeze([]) });
  definitions.add(definition);
  relationalPolicies.set(definition, policies);
  return definition;
});

export function requireCoreNativeDefinition(definition: unknown): Result.Result<void, CoreSchemaError> {
  return definition !== null && (typeof definition === "object" || typeof definition === "function") && definitions.has(definition)
    ? Result.succeed(undefined) : Result.fail(unsupported("Native definition was not issued by the source owner"));
}
export function sameCoreNativeIdentity(left: CoreNativeIdentity, right: CoreNativeIdentity): boolean {
  return left.scopeUuid === right.scopeUuid && left.epochUuid === right.epochUuid && left.sourceKey === right.sourceKey
    && left.sourceSha256 === right.sourceSha256 && left.configSha256 === right.configSha256
    && left.provenanceSha256 === right.provenanceSha256 && left.definitionHash === right.definitionHash;
}
export function coreNativePolicyForTable(definition: CoreNativeDefinition,
  declaration: CoreNativeTableDeclaration | CoreNativePrivateTableDeclaration,
  state: CoreNativeTablePolicy["state"], schemaId: string): CoreNativeTablePolicy {
  const privateReference = declaration.privateReference;
  const references = privateReference === undefined ? definition.references : [];
  return Object.freeze({ state, schemaId, identity: definition.identity,
    applicationRead: privateReference === undefined && definition.applicationRead,
    uniqueConstraints: declaration.uniqueConstraints,
    ...(references.length === 0 ? {} : { references }),
    ...(privateReference === undefined ? {} : { privateReference }) });
}
function nativePolicyMatches(policy: CoreNativeTablePolicy, definition: CoreNativeDefinition, tableName: string): boolean {
  const expected = coreNativeStoredTables(definition).find(table => table.name === tableName);
  const privateReference = expected?.privateReference;
  return expected !== undefined && sameCoreNativeIdentity(policy.identity, definition.identity)
    && policy.applicationRead === (privateReference === undefined && definition.applicationRead)
    && canonical(policy.privateReference ?? null) === canonical(privateReference ?? null)
    && sameNativeConstraints(policy.uniqueConstraints, expected.uniqueConstraints)
    && canonical(policy.references ?? []) === canonical(privateReference === undefined ? definition.references : []);
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
    && canonical(left.privateReference ?? null) === canonical(right.privateReference ?? null)
    && sameNativeConstraints(left.uniqueConstraints, right.uniqueConstraints)
    && canonical(left.references ?? []) === canonical(right.references ?? []);
}

/** A same-owner upgrade adds only its authenticated canonical optional reference.
 * Both definitions have already been rebuilt through the authenticated producer. */
export function isCoreNativeDefinitionSuccessor(prior: CoreNativeDefinition, next: CoreNativeDefinition): boolean {
  if (Result.isFailure(requireCoreNativeDefinition(prior)) || Result.isFailure(requireCoreNativeDefinition(next))) return false;
  if (prior.metadata === next.metadata) return true;
  if (prior.source.key !== next.source.key || prior.source.owner !== "payload" || next.source.owner !== "payload"
    || prior.source.writeProfile !== "payload.scalar" || next.source.writeProfile !== "payload.content-relations"
    || prior.identity.scopeUuid !== next.identity.scopeUuid || prior.identity.epochUuid !== next.identity.epochUuid
    || prior.identity.provenanceSha256 !== next.identity.provenanceSha256 || prior.applicationRead !== next.applicationRead
    || prior.source.definition.kind !== "documents" || next.source.definition.kind !== "documents"
    || prior.source.definition.tables.length !== next.source.definition.tables.length || next.references.length !== 1 || prior.references.length !== 0
    || canonical(prior.source.bindings) !== canonical(next.source.bindings)
    || canonical(prior.source.definition.indexes) !== canonical(next.source.definition.indexes)
    || canonical(prior.source.definition.uniqueConstraints) !== canonical(next.source.definition.uniqueConstraints)) return false;
  const reference = next.references[0];
  if (reference === undefined) return false;
  const names = prior.source.definition.tables.map(table => table.logicalName);
  if (!names.some(name => name === reference.sourceTable) || !names.some(name => name === reference.targetTable)) return false;
  const before = decodeApplicationWritePolicies(prior.source.evidence, names);
  const after = decodeApplicationWritePolicies(next.source.evidence, names);
  if (Result.isFailure(before) || Result.isFailure(after)) return false;
  if (canonical(before.success.provenance) !== canonical(after.success.provenance)
    || canonical(before.success.configuration.tables) !== canonical(after.success.configuration.tables.map(table => ({ ...table,
      fields: table.fields.filter(field => field.kind !== "relationship") })))
    || canonical(before.success.tables.map(table => ({ logicalTableName: table.logicalTableName, owner: table.owner,
      ...("policyId" in table ? { policyId: table.policyId } : {}) }))) !== canonical(after.success.tables.map(table => ({
      logicalTableName: table.logicalTableName, owner: table.owner, ...("policyId" in table ? { policyId: table.policyId } : {}) })))) return false;
  return prior.source.definition.tables.every((previous, position) => {
    const candidate = next.source.definition.kind === "documents" ? next.source.definition.tables[position] : undefined;
    if (candidate?.logicalName !== previous.logicalName) return false;
    if (previous.logicalName !== reference.sourceTable)
      return canonical(encodeValidatorJsonV1(previous.definition.documentType)) === canonical(encodeValidatorJsonV1(candidate.definition.documentType));
    if (candidate.definition.documentType.type !== "object") return false;
    const fields = Object.fromEntries(Object.entries(candidate.definition.documentType.value).filter(([name]) => name !== reference.field));
    return canonical(encodeValidatorJsonV1(previous.definition.documentType)) === canonical(encodeValidatorJsonV1({ type: "object", value: fields }));
  });
}
export function checkCoreTableAccess(table: CoreTableDefinition, mode: "read" | "write",
  authority?: CoreNativeAuthority): Result.Result<void, CoreTransactionError> {
  const policy = table.nativePolicy;
  if (isCorePrivateTable(table)) return Result.fail(revoked());
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
    if (Option.isNone(active) || active.value.id !== authority.schemaId
      || !coreNativeSchemaIncludes(registry, active.value.metadata.native, authority.definition))
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
    for (const declaration of authority.definition.privateTables ?? []) {
      const table = registry.table(declaration.name, authority.namespace)?.definition;
      if (table?.state !== "active" || table.nativePolicy?.state !== "active" || table.nativePolicy.schemaId !== authority.schemaId
        || !nativePolicyMatches(table.nativePolicy, authority.definition, declaration.name)) return yield* Result.fail(revoked());
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
function checkNativeTableIndexes(registry: CoreRegistry, table: CoreTableDefinition, definition: Pick<CoreNativeDefinition, "schema">,
  active: boolean): Result.Result<void, CorePersistenceError> {
  const schema = definition.schema.tables.find(candidate => candidate.tableName === table.name);
  if (schema === undefined) return Result.fail(corrupt("Native table is absent from its producer schema"));
  const expected = [{ name: "by_id", fields: [] }, { name: "by_creation_time", fields: ["_creationTime"] },
    ...schema.indexes.map(index => ({ name: index.indexDescriptor, fields: index.fields }))];
  return Result.gen(function* () {
    const admitted = [...expected];
    const enabled: { name: string; fields: readonly string[] }[] = [{ name: "by_id", fields: [] }, { name: "by_creation_time", fields: ["_creationTime"] }];
    // The shared registry has already authenticated the active/candidate pair.
    // Both generations receive writes; only the enabled generation serves reads.
    for (const state of ["active", "pending", "validated"] as const) {
      const selection = yield* registry.schemas.nativeByState(table.namespace, state);
      if (Option.isNone(selection)) continue;
      const declaration = selection.value.schema.tables.find(candidate => candidate.tableName === table.name);
      if (state === "active") enabled.push(...(declaration?.indexes ?? []).map(index => ({ name: index.indexDescriptor, fields: index.fields })));
      for (const index of declaration?.indexes ?? []) if (!admitted.some(candidate => candidate.name === index.indexDescriptor
        && JSON.stringify(candidate.fields) === JSON.stringify(index.fields))) admitted.push({ name: index.indexDescriptor, fields: index.fields });
    }
    const actual = registry.indexesForTablet(table.tabletId);
    if (actual.length !== admitted.length || actual.some(index => !admitted.some(declaration => declaration.name === index.name
      && JSON.stringify(index.fields) === JSON.stringify(declaration.fields)) || isCoreIndexStaged(index)
      || index.state.type === "Enabled" && !enabled.some(declaration => declaration.name === index.name
        && JSON.stringify(index.fields) === JSON.stringify(declaration.fields)))
      || expected.some(declaration => !actual.some(index => index.name === declaration.name
        && JSON.stringify(index.fields) === JSON.stringify(declaration.fields) && (!active || index.state.type === "Enabled"))))
      return yield* Result.fail(corrupt("Native index generations differ from their authenticated declarations"));
  });
}
const isBundle = (proof: NativeSchemaProof): proof is CoreSchemaBundle => "nativeDefinitions" in proof;
export function coreNativeSchemaSuccessor(registry: CoreRegistry, metadata: string | undefined,
  next: CoreNativeDefinition | CoreSchemaBundle): boolean {
  if (metadata === next.metadata) return true;
  const prior = metadata === undefined ? undefined : verifiedRegistries.get(registry)?.get(metadata);
  return prior !== undefined && (isBundle(prior) && isBundle(next) ? isCoreSchemaBundleSuccessor(prior, next)
    : !isBundle(prior) && !isBundle(next) && isCoreNativeDefinitionSuccessor(prior, next));
}
export function coreNativeSchemaIncludes(registry: CoreRegistry, metadata: string | undefined, definition: CoreNativeDefinition): boolean {
  if (metadata === undefined || Result.isFailure(requireCoreNativeDefinition(definition))) return false;
  // Preserve the exact standalone Payload profile and its synthetic owner tests.
  if (metadata === definition.metadata && definition.source.owner === "payload" && definition.source.definition.kind === "documents") return true;
  const proof = verifiedRegistries.get(registry)?.get(metadata);
  return proof !== undefined && isBundle(proof) && coreSchemaBundleNative(proof, definition);
}
function checkNativeRegistry(registry: CoreRegistry, sources: ReadonlyMap<string, NativeSchemaProof>):
  Result.Result<ReadonlyMap<string, NativeSchemaProof>, CorePersistenceError> {
  return Result.gen(function* () {
    const schemas = yield* nativeSchemas(registry), selected = new Map<string, NativeSchemaProof>();
    const ownedTables = new Set<string>();
    for (const { namespace, selection } of schemas) {
      if (selection.metadata.state.state === "active") continue;
      const active = schemas.find(candidate => coreNamespaceKey(candidate.namespace) === coreNamespaceKey(namespace)
        && candidate.selection.metadata.state.state === "active");
      if (active === undefined) continue;
      const before = sources.get(active.selection.metadata.native ?? ""), after = sources.get(selection.metadata.native ?? "");
      if (before === undefined || after === undefined || !(before.metadata === after.metadata
        || (isBundle(before) && isBundle(after) ? isCoreSchemaBundleSuccessor(before, after)
          : !isBundle(before) && !isBundle(after) && isCoreNativeDefinitionSuccessor(before, after))))
        return yield* Result.fail(corrupt("Native pending schema is not an authenticated compatible successor"));
    }
    for (const { namespace, selection } of schemas) {
      const metadata = selection.metadata.native;
      const proof = metadata === undefined ? undefined : sources.get(metadata);
      if (proof === undefined || proof.metadata !== metadata)
        return yield* Result.fail(corrupt("Native schema has no authenticated source proof"));
      if (isBundle(proof) && coreNamespaceKey(proof.namespace) !== coreNamespaceKey(namespace))
        return yield* Result.fail(corrupt("Schema bundle namespace differs from its source proof"));
      const expectedSchema = yield* serializeCoreSchema(proof.schema).pipe(Result.mapError(corrupt));
      const actualSchema = yield* serializeCoreSchema(selection.schema).pipe(Result.mapError(corrupt));
      if (expectedSchema !== actualSchema) return yield* Result.fail(corrupt("Native schema differs from its authenticated source"));
      selected.set(metadata, proof);
      const state = selection.metadata.state.state === "active" ? "active" : "reserved";
      const active = schemas.find(candidate => coreNamespaceKey(candidate.namespace) === coreNamespaceKey(namespace)
        && candidate.selection.metadata.state.state === "active");
      const activeProof = active === undefined ? undefined : sources.get(active.selection.metadata.native ?? "");
      for (const definition of isBundle(proof) ? proof.nativeDefinitions : [proof]) {
        for (const declaration of coreNativeStoredTables(definition)) {
          const table = registry.table(declaration.name, namespace)?.definition;
          const previous = activeProof === undefined ? undefined : (isBundle(activeProof) ? activeProof.nativeDefinitions : [activeProof])
            .find(candidate => coreNativeStoredTables(candidate).some(item => item.name === declaration.name));
          if (state === "reserved" && previous !== undefined) {
            if (table?.nativePolicy === undefined || table.nativePolicy.state !== "active" || table.nativePolicy.schemaId !== active?.selection.id
              || !nativePolicyMatches(table.nativePolicy, previous, declaration.name))
              return yield* Result.fail(corrupt("Pending native successor replaced its active writer policy"));
            yield* checkNativeTableIndexes(registry, table, definition, false);
            continue;
          }
          if (table?.nativePolicy === undefined || table.state !== "active" || table.nativePolicy.state !== state
            || table.nativePolicy.schemaId !== selection.id || !nativePolicyMatches(table.nativePolicy, definition, table.name))
            return yield* Result.fail(corrupt("Native table policy differs from its authenticated source"));
          yield* checkNativeTableIndexes(registry, table, definition, state === "active");
          const key = nativeTableKey(table);
          if (ownedTables.has(key)) return yield* Result.fail(corrupt("Native table has multiple schema owners"));
          ownedTables.add(key);
        }
      }
      if (isBundle(proof)) for (const source of proof.sources.filter(candidate => candidate.kind === "application")) {
        for (const binding of proof.bindings.filter(candidate => candidate.sourceKey === source.definition.source.key)) {
          const table = registry.table(binding.coreTableName, namespace)?.definition;
          if (table === undefined || table.state !== "active" || table.nativePolicy !== undefined)
            return yield* Result.fail(corrupt("Application table ownership differs from its authenticated source"));
          yield* checkNativeTableIndexes(registry, table, proof, state === "active");
        }
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
  registry: CoreRegistry, predecessor?: CoreRegistry, expectedBundles: readonly CoreSchemaBundle[] = [],
) {
  const inherited = predecessor === undefined ? undefined : verifiedRegistries.get(predecessor);
  const supplied = new Map<string, CoreSchemaBundle>();
  for (const bundle of expectedBundles) {
    yield* Effect.fromResult(requireCoreSchemaBundle(bundle));
    supplied.set(bundle.metadata, bundle);
  }
  const sources = new Map<string, NativeSchemaProof>();
  for (const { selection } of yield* Effect.fromResult(nativeSchemas(registry))) {
    const metadata = selection.metadata.native;
    if (metadata === undefined) return yield* corrupt();
    const proof = inherited?.get(metadata) ?? supplied.get(metadata) ?? sources.get(metadata);
    if (proof !== undefined) sources.set(metadata, proof);
    else {
      // The retained untagged reader is deliberately not a fallback for a new
      // tagged format, relational source or an unknown version.
      const decoded = yield* Effect.try({ try: (): unknown => JSON.parse(metadata), catch: corrupt });
      if (decoded !== null && typeof decoded === "object" && Object.hasOwn(decoded, "format"))
        return yield* corrupt("Tagged schema metadata has no expected producer proof");
      sources.set(metadata, yield* readStoredNativeDefinition(metadata));
    }
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

export function checkCoreApplicationInsertAuthority(registry: CoreRegistry,
  authority: CoreApplicationInsertAuthority): Result.Result<void, CoreError> {
  return Result.gen(function* () {
    if (Result.isFailure(requireCoreSchemaBundle(authority.bundle)) || registry.authority?.epoch !== authority.authorityEpoch
      || coreNamespaceKey(authority.bundle.namespace) !== coreNamespaceKey(authority.namespace)) return yield* Result.fail(revoked());
    const schemas = registry.table(SCHEMAS, authority.namespace)?.definition;
    const stateIndex = schemas?.indexes.find(index => index.name === "by_state");
    if (schemas === undefined || stateIndex === undefined) return yield* Result.fail(revoked());
    const active = yield* registry.schemas.getByState(authority.namespace, "active", stateIndex.ref, () => {});
    if (Option.isNone(active) || active.value.id !== authority.schemaId || active.value.metadata.native !== authority.bundle.metadata)
      return yield* Result.fail(revoked());
    const proof = verifiedRegistries.get(registry)?.get(authority.bundle.metadata);
    if (proof === undefined || !isBundle(proof) || proof.metadata !== authority.bundle.metadata)
      return yield* Result.fail(revoked());
    const source = authority.bundle.sources.find(candidate => candidate.kind === "application"
      && candidate.definition.source.key === authority.sourceKey);
    if (source === undefined || !authority.bundle.bindings.some(binding => binding.sourceKey === authority.sourceKey
      && binding.coreTableName === authority.table.name)) return yield* Result.fail(revoked());
    const table = registry.table(authority.table.name, authority.namespace)?.definition;
    if (table === undefined || table.nativePolicy !== undefined || authority.table.nativePolicy !== undefined
      || table.state !== "active" || table.number !== authority.table.number
      || !bytesEqual(table.tabletId, authority.table.tabletId)
      || coreNamespaceKey(table.namespace) !== coreNamespaceKey(authority.namespace)) return yield* Result.fail(revoked());
    yield* checkNativeTableIndexes(registry, table, authority.bundle, true).pipe(Result.mapError(() => revoked()));
    if (table.indexes.length !== authority.table.indexes.length || authority.table.indexes.some(expected => {
      const actual = table.indexes.find(index => index.name === expected.name);
      return actual === undefined || !bytesEqual(actual.ref.id, expected.ref.id)
        || JSON.stringify(actual.fields) !== JSON.stringify(expected.fields);
    })) return yield* Result.fail(revoked());
  });
}

function schemaAuthorityMetadataReads(registry: CoreRegistry, authority: Readonly<{ namespace: CoreTableNamespace;
  schemaId: string; tables: readonly CoreTableDefinition[] }>): Result.Result<CoreReadSet, CoreError> {
  return Result.gen(function* () {
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
    for (const table of authority.tables) {
      const id = yield* publicDocumentId(tables, table.tabletId);
      const key = yield* Result.mapError(encodeIndexKey([], id), cause => new CoreTransactionError({ reason: "invalidValue", cause }));
      reads.add(tableById.ref.id, pointInterval(key));
      for (const index of table.indexes) yield* addIndexMetadataDependency(reads, registry, index);
    }
    return reads.snapshot();
  });
}

export function coreNativeMetadataReads(registry: CoreRegistry, authority: CoreNativeAuthority, tableName?: string): Result.Result<CoreReadSet, CoreError> {
  return Result.gen(function* () {
    yield* checkCoreNativeAuthority(registry, authority, tableName);
    const privateTables: CoreTableDefinition[] = [];
    for (const declaration of authority.definition.privateTables ?? []) {
      const table = registry.table(declaration.name, authority.namespace)?.definition;
      if (table === undefined) return yield* Result.fail(revoked());
      privateTables.push(table);
    }
    return yield* schemaAuthorityMetadataReads(registry, { ...authority,
      tables: [...authority.tables.filter(candidate => tableName === undefined || candidate.name === tableName), ...privateTables] });
  });
}
export function coreApplicationInsertMetadataReads(registry: CoreRegistry,
  authority: CoreApplicationInsertAuthority): Result.Result<CoreReadSet, CoreError> {
  return Result.gen(function* () {
    yield* checkCoreApplicationInsertAuthority(registry, authority);
    return yield* schemaAuthorityMetadataReads(registry, { ...authority, tables: [authority.table] });
  });
}
