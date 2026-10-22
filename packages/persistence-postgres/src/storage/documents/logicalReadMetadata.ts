import { and, eq } from "drizzle-orm";
import { Data, Effect, Result, Schema } from "effect";
import { verifyApplicationWritePolicies } from "@flarex/analysis/internal/application-write-policy";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { CatalogTableIdSchema, CatalogIndexIdSchema, CatalogIndexDefinitionIdSchema, CatalogUniqueConstraintDefinitionIdSchema, type CatalogTableId } from "flarex-protocol/catalog";
import { encodeCanonicalJson, isJson, isJsonObject, type JsonObject } from "flarex-protocol/json";
import { logicalTableKey } from "flarex-protocol/internal/logical-schema-candidate";
import { snapshotDecodedProtocolPlainData } from "flarex-protocol/internal/decoded-protocol-snapshot";
import { decodeRelationalSchemaMetadata, relationalSchemaSourceFromDefinition, relationalReverseIndexes, type RelationalSchema,
  type RelationalPersistenceCapability, type RelationalTableDefinition } from "flarex-protocol/internal/relational-schema";
import { CatalogSchemaVersionIdSchema, SchemaManifestAppTableDeclarationV1Schema,
  type CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { ScopeIdSchema, type ScopeId } from "flarex-protocol/storage-authority";
import type { FlarexMetadataDatabase } from "../../application/deployments";
import type { FlarexMetadataTransaction } from "../../database/metadataTransaction";
import type { PreparedLogicalStorageRequirements } from "../catalog/logicalStorageDefinitions";
import { runDrizzleStatementEffect } from "../../database/drizzleStatementEffect";
import { fxControlLogicalReadSources, fxControlLogicalReadTables, fxControlLogicalReadAccess } from "../../database/schema";
import { capturePrivateCanonicalValue } from "../../installation/frameworkSchema/privateCanonicalValue";
import { captureHostPreparationLifetime } from "../../execution/preparation/preparedHostRuntime";
import { locateAppIndexDefinitionByIdEffect, type AppIndexDefinitionRecord } from "../indexes/appIndexDefinitions";
import { locateAppUniqueConstraintDefinitionByIdEffect, type AppUniqueConstraintDefinitionRecordV1, type LocatedAppUniqueConstraintDefinitionV1 } from "../unique/appUniqueConstraintDefinitions";
import { runEffectTransaction } from "../../database/effectTransaction";
import type { LogicalWhere } from "./logicalDocuments/query";
import { type PreparedInstallation } from "../../installation/installationLifecycle";
import { prepareProtectedMetadata, captureProtectedMetadataEpoch, guardProtectedMetadataEpoch,
  authenticateProtectedTargetMetadataSnapshot, registerProtectedMetadataFinalGuard } from "../../execution/preparation/preparedMetadataEpoch";
import type { LocatedAppIndexDefinitionV1 } from "../indexes/appIndexDefinitions";
import type { LogicalSearchDefinition } from "./logicalDocuments/searchEntries";
import type { LogicalRelationalReadAccess, LogicalRelationalReadDemand } from "./logicalDocuments/relationalQuery";
import { logicalIndexReadAccessQuery, logicalUniqueReadAccessQuery, logicalNativeReadAccessQuery, logicalPageReadAccessQuery, logicalSearchReadAccessQuery,
  logicalReadPredicateKey } from "./logicalReadAccessQueries";

const strict = { parseOptions: { onExcessProperty: "error" } } as const;
const signature = (fields: readonly string[]) => JSON.stringify([...new Set(fields)].toSorted());
const structuralWhere = (where: LogicalWhere, textFields: readonly string[]) => Object.keys(where).toSorted().map(field => {
  const value = where[field];
  return [field, value === null ? "null" : typeof value === "object" ? ["range", Object.keys(value).toSorted()] :
    textFields.includes(field) ? [typeof value, value] : typeof value];
});
const issuedReadMetadata = new WeakSet<object>();
const Sha256 = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
export const LogicalSourceReadPinSchema = Schema.Struct({ sourceKey: Schema.NonEmptyString,
  sourceSha256: Sha256, writeProfile: Schema.NonEmptyString }).annotate(strict);
/** An immutable source selector. It grants no serving or transaction authority. */
export type LogicalSourceReadPin = typeof LogicalSourceReadPinSchema.Type;
export class LogicalReadMetadataError extends Data.TaggedError("LogicalReadMetadataError")<{
  readonly reason: "invalidInput" | "sourceMismatch" | "invalidComposition" | "definitionMissing" | "storedCorruption" | "resourceFailure" | "closed";
  readonly cause?: unknown;
}> {}
const failure = (reason: LogicalReadMetadataError["reason"], cause?: unknown) => new LogicalReadMetadataError({ reason, cause });
const errors = { invalidInput: () => failure("storedCorruption"), hashFailure: (cause: unknown) => failure("resourceFailure", cause) };
const Analysis = Schema.Struct({ candidateId: Schema.NonEmptyString, analysisId: Schema.NonEmptyString,
  manifestSha256: Sha256, sourceArtifactRootSha256: Sha256 }).annotate(strict);
const Root = Schema.Struct({ format: Schema.Literal("flarex.logical-read-source"), version: Schema.Literal(1),
  deploymentId: Schema.NonEmptyString, scopeId: ScopeIdSchema, schemaVersionId: CatalogSchemaVersionIdSchema,
  manifestSha256: Sha256, sourceKey: Schema.NonEmptyString, sourceSha256: Sha256,
  owner: Schema.Literals(["application", "payload", "medusa", "system"]), kind: Schema.Literals(["documents", "relational"]),
  writeProfile: Schema.NonEmptyString, defaultTableName: Schema.NonEmptyString, applicationAnalysis: Analysis,
  hasDocumentRelations: Schema.Boolean,
  contentIdentity: Schema.NullOr(Schema.Struct({ configSha256: Sha256, provenanceSha256: Sha256 }).annotate(strict)),
}).annotate(strict);
export type LogicalReadSourceRoot = typeof Root.Type;
const ReadSchema = Schema.declare<RelationalSchema>((value): value is RelationalSchema => {
  if (!isJson(value)) return false;
  const normalized = decodeRelationalSchemaMetadata(relationalSchemaSourceFromDefinition(value));
  return Result.isSuccess(normalized) && encodeCanonicalJson(normalized.success, () => { throw new Error("Owned read schema is not JSON"); }) ===
    encodeCanonicalJson(value, () => { throw new Error("Owned read schema is not JSON"); });
});
const Table = Schema.Union([
  Schema.Struct({ format: Schema.Literal("flarex.logical-read-table"), version: Schema.Literal(1),
    sourceSha256: Sha256, localName: Schema.NonEmptyString, tableId: CatalogTableIdSchema,
    selectorTextFields: Schema.Array(Schema.NonEmptyString), selectorBooleanFields: Schema.optionalKey(Schema.Array(Schema.NonEmptyString)),
    kind: Schema.Literal("relational"), readSchema: ReadSchema }).annotate(strict),
  Schema.Struct({ format: Schema.Literal("flarex.logical-read-table"), version: Schema.Literal(1),
    sourceSha256: Sha256, localName: Schema.NonEmptyString, tableId: CatalogTableIdSchema,
    selectorTextFields: Schema.Array(Schema.NonEmptyString), selectorBooleanFields: Schema.optionalKey(Schema.Array(Schema.NonEmptyString)),
    kind: Schema.Literal("documents"), definition: SchemaManifestAppTableDeclarationV1Schema }).annotate(strict),
]);
export type LogicalReadTableMetadata = typeof Table.Type;
const decodeRoot = Schema.decodeUnknownEffect(Root);
const decodeTable = Schema.decodeUnknownEffect(Table);
const sha = (frame: JsonObject) => capturePrivateCanonicalValue(frame, 4_194_304, errors);
const acquireMetadata = <Value, Failure>(db: FlarexMetadataDatabase,
  work: (tx: FlarexMetadataTransaction) => Effect.Effect<Value, Failure>, installation: PreparedInstallation) => runEffectTransaction(
  callback => db.transaction(callback, { isolationLevel: "repeatable read" }),
  "Logical read metadata acquisition rolled back", work, cause => failure("resourceFailure", cause), { token: installation, database: db });
const Predicate = Schema.NullOr(Schema.Union([
  Schema.Struct({ kind: Schema.Literal("fieldIsNull"), field: Schema.NonEmptyString }).annotate(strict),
  Schema.Struct({ kind: Schema.Literal("fieldIsNullAndTextEquals"), nullField: Schema.NonEmptyString,
    textField: Schema.NonEmptyString, value: Schema.String }).annotate(strict),
  Schema.Struct({ kind: Schema.Literal("fieldIsNullAndBooleanEquals"), nullField: Schema.NonEmptyString,
    booleanField: Schema.NonEmptyString, value: Schema.Boolean }).annotate(strict),
]));
const IndexAccess = Schema.Struct({ format: Schema.Literal("flarex.logical-read-access"), version: Schema.Literal(1),
  fields: Schema.Array(Schema.NonEmptyString), predicate: Predicate,
  indexDefinitionId: CatalogIndexDefinitionIdSchema,
  formats: Schema.optionalKey(Schema.Array(Schema.Literals(["plain", "sha256TextV1"]))),
}).annotate(strict);
const UniqueAccess = Schema.Struct({ format: Schema.Literal("flarex.logical-read-access"), version: Schema.Literal(1),
  fields: Schema.Array(Schema.NonEmptyString), predicate: Schema.Null,
  uniqueConstraintDefinitionId: CatalogUniqueConstraintDefinitionIdSchema, nullsDistinct: Schema.Boolean,
}).annotate(strict);
const decodeIndexAccess = Schema.decodeUnknownEffect(IndexAccess);
const decodeUniqueAccess = Schema.decodeUnknownEffect(UniqueAccess);
const SearchAccess = Schema.Struct({ format: Schema.Literal("flarex.logical-read-access"), version: Schema.Literal(1),
  fields: Schema.Array(Schema.NonEmptyString), predicate: Predicate, logicalIndexId: CatalogIndexIdSchema,
  kind: Schema.Literals(["text", "jsonContainment"]), sourceSha256: Sha256, nullPredicateField: Schema.NullOr(Schema.NonEmptyString),
}).annotate(strict);
const decodeSearchAccess = Schema.decodeUnknownEffect(SearchAccess);

/** Publication alone traverses the full admitted source. Required-table misses
 * never read the source artifact or reconstruct this projection. */
export const publishLogicalReadMetadata = Effect.fn("LogicalReadMetadata.publish")(function* (
  tx: FlarexMetadataTransaction, requirements: PreparedLogicalStorageRequirements,
  definitions: readonly AppIndexDefinitionRecord[], uniques: readonly AppUniqueConstraintDefinitionRecordV1[],
  searches: readonly (LogicalSearchDefinition & Readonly<{ sourceKey: string }>)[],
) {
  const { artifact, evidence } = requirements;
  const deploymentId = artifact.deploymentId, schemaVersionId = artifact.schemaVersionId;
  const bindings = new Map(evidence.tableBindings.map(binding => [logicalTableKey(binding.table), binding.tableId]));
  for (const source of evidence.candidate.sources) {
    const bound = source.bindings.filter(binding => binding.kind === "definition");
    // Admitted views retain their candidate evidence but own no serving table
    // definitions. A projection must not turn a view into read authority.
    if (bound.length === 0 && source.bindings.some(binding => binding.kind === "view")) continue;
    const defaultTableName = bound[0]?.localName;
    if (defaultTableName === undefined) return yield* Effect.fail(failure("storedCorruption"));
    let contentIdentity: LogicalReadSourceRoot["contentIdentity"] = null;
    if (source.owner === "payload" && source.definition.kind === "documents") {
      const policy = yield* verifyApplicationWritePolicies(source.evidence,
        source.definition.tables.map(table => table.logicalName)).pipe(Effect.mapError(cause => failure("storedCorruption", cause)));
      const first = policy.policies.tables[0];
      if (first === undefined || first.owner !== "payload") return yield* Effect.fail(failure("storedCorruption"));
      contentIdentity = { configSha256: first.configSha256, provenanceSha256: first.provenanceSha256 };
    }
    const root = yield* decodeRoot({ format: "flarex.logical-read-source", version: 1,
      deploymentId, schemaVersionId, scopeId: evidence.candidate.scopeId,
      manifestSha256: encodeBytesToLowercaseHex(artifact.manifestSha256), sourceKey: source.key,
      sourceSha256: source.sourceSha256, owner: source.owner, kind: source.definition.kind,
      writeProfile: source.writeProfile, defaultTableName, applicationAnalysis: evidence.candidate.applicationAnalysis, contentIdentity,
      hasDocumentRelations: source.definition.kind === "documents" && source.definition.relations.length !== 0,
    }).pipe(Effect.mapError(cause => failure("storedCorruption", cause)));
    const rootCanonical = yield* sha(root);
    yield* runDrizzleStatementEffect(tx.insert(fxControlLogicalReadSources).values({ deploymentId, schemaVersionId,
      sourceKey: source.key, sourceSha256: source.sourceSha256, artifactVersion: artifact.version,
      manifestSha256: artifact.manifestSha256, projectionJson: root, projectionSha256: rootCanonical.sha256Hex,
    }).onConflictDoNothing(), cause => failure("resourceFailure", cause));
    const [stored] = yield* runDrizzleStatementEffect(tx.select({ digest: fxControlLogicalReadSources.projectionSha256 })
      .from(fxControlLogicalReadSources).where(and(eq(fxControlLogicalReadSources.deploymentId, deploymentId),
        eq(fxControlLogicalReadSources.schemaVersionId, schemaVersionId), eq(fxControlLogicalReadSources.sourceKey, source.key))), cause => failure("resourceFailure", cause));
    if (stored?.digest !== rootCanonical.sha256Hex) return yield* Effect.fail(failure("storedCorruption"));
    for (const binding of bound) {
      const tableId = bindings.get(logicalTableKey(binding.table));
      if (tableId === undefined) return yield* Effect.fail(failure("storedCorruption"));
      let frame: LogicalReadTableMetadata;
      const selectorTextFields = [...new Set(definitions.filter(definition => definition.access.tableId === tableId)
        .flatMap(definition => definition.physicalSpec.predicate?.kind === "fieldIsNullAndTextEquals" ? [definition.physicalSpec.predicate.textField] : []))].toSorted();
      const selectorBooleanFields = [...new Set(definitions.filter(definition => definition.access.tableId === tableId)
        .flatMap(definition => definition.physicalSpec.predicate?.kind === "fieldIsNullAndBooleanEquals" ? [definition.physicalSpec.predicate.booleanField] : []))].toSorted();
      const booleanSelectors = selectorBooleanFields.length === 0 ? {} : { selectorBooleanFields };
      if (source.definition.kind === "relational") {
        const original = source.definition.schema.tables.find(table => table.identity.tableId === binding.localName);
        if (original === undefined) return yield* Effect.fail(failure("storedCorruption"));
        // Complete persisted-row validation is required even for a projection.
        // Foreign-key/delete obligations belong to full write admission.
        const capabilities: readonly RelationalPersistenceCapability[] = source.definition.schema.capabilities.filter(capability =>
          capability.kind === "exactNumericCompanion" && capability.numericColumn.tableId === original.identity.tableId);
        const readSchema: RelationalSchema = { ...source.definition.schema,
          tables: [{ ...original, keys: original.keys.some(key => key.kind === "primary") ? original.keys.filter(key => key.kind === "primary") : original.keys,
            indexes: [], constraints: original.constraints.filter(constraint => constraint.kind !== "foreignKey"), relationships: [] }], capabilities };
        frame = { format: "flarex.logical-read-table", version: 1, sourceSha256: source.sourceSha256,
          localName: binding.localName, tableId, selectorTextFields, ...booleanSelectors, kind: "relational", readSchema };
      } else {
        const definition = source.definition.tables.find(table => table.logicalName === binding.localName);
        if (definition === undefined) return yield* Effect.fail(failure("storedCorruption"));
        frame = { format: "flarex.logical-read-table", version: 1, sourceSha256: source.sourceSha256,
          localName: binding.localName, tableId, selectorTextFields, ...booleanSelectors, kind: "documents", definition };
      }
      const canonical = yield* sha(frame);
      yield* runDrizzleStatementEffect(tx.insert(fxControlLogicalReadTables).values({ deploymentId, schemaVersionId,
        sourceKey: source.key, sourceSha256: source.sourceSha256, localName: binding.localName, tableId,
        projectionJson: frame, projectionSha256: canonical.sha256Hex }).onConflictDoNothing(), cause => failure("resourceFailure", cause));
      const [existing] = yield* runDrizzleStatementEffect(tx.select({ digest: fxControlLogicalReadTables.projectionSha256 })
        .from(fxControlLogicalReadTables).where(and(eq(fxControlLogicalReadTables.deploymentId, deploymentId),
          eq(fxControlLogicalReadTables.schemaVersionId, schemaVersionId), eq(fxControlLogicalReadTables.sourceKey, source.key),
          eq(fxControlLogicalReadTables.localName, binding.localName))), cause => failure("resourceFailure", cause));
      if (existing?.digest !== canonical.sha256Hex) return yield* Effect.fail(failure("storedCorruption"));
      yield* publishTableAccess(tx, { deploymentId, schemaVersionId, sourceKey: source.key, localName: binding.localName },
        definitions.filter(definition => definition.access.tableId === tableId), uniques.filter(definition => definition.tableId === tableId),
        source.definition.kind === "relational" ? source.definition.schema.tables.find(table => table.identity.tableId === binding.localName) : undefined,
        searches.filter(definition => definition.tableId === tableId && definition.sourceKey === source.key));
    }
  }
});

type TableKey = Readonly<{ deploymentId: string; schemaVersionId: CatalogSchemaVersionId; sourceKey: string; localName: string }>;
const publishTableAccess = Effect.fn("LogicalReadMetadata.publishAccess")(function* (
  tx: FlarexMetadataTransaction, key: TableKey, indexes: readonly AppIndexDefinitionRecord[],
  uniques: readonly AppUniqueConstraintDefinitionRecordV1[],
  nativeTable: RelationalTableDefinition | undefined, searches: readonly LogicalSearchDefinition[],
) {
  const winners = new Map<string, Readonly<{ selectorKind: string; selectorKey: string; leadingField: string;
    prefixLength: number; ordinal: number; projectionJson: JsonObject }>>();
  const add = (selectorKind: string, fields: readonly string[], predicate: JsonObject | null, ordinal: number, extra: JsonObject) => {
    const selectorKey = JSON.stringify([fields, logicalReadPredicateKey(predicate), extra.formats ?? null]);
    addKey(selectorKind, selectorKey, fields, predicate, ordinal, extra);
  };
  const addKey = (selectorKind: string, selectorKey: string, fields: readonly string[], predicate: JsonObject | null, ordinal: number, extra: JsonObject) => {
    const winnerKey = JSON.stringify([selectorKind, selectorKey]);
    if (fields[0] === undefined || winners.has(winnerKey)) return;
    winners.set(winnerKey, { selectorKind, selectorKey, leadingField: fields[0], prefixLength: fields.length, ordinal,
      projectionJson: { format: "flarex.logical-read-access", version: 1, fields: [...fields], predicate, ...extra } });
  };
  const addTrie = (kind: "index" | "unique", fields: readonly string[]) => {
    const sorted = [...new Set(fields)].toSorted();
    for (let length = 1; length <= sorted.length; length++) {
      const prefix = sorted.slice(0, length);
      addKey(`trie:${kind}`, JSON.stringify(prefix), prefix, null, 0, {});
    }
  };
  const ordered = indexes.toSorted((left, right) =>
    (left.access.kind === "developer" ? left.access.logicalIndexId : 0) -
    (right.access.kind === "developer" ? right.access.logicalIndexId : 0));
  for (const [ordinal, definition] of ordered.entries()) {
    if (definition.access.kind !== "developer") continue;
    const fields: string[] = [], formats: string[] = [];
    const predicate = definition.physicalSpec.predicate ?? null;
    for (const field of definition.physicalSpec.orderedFields) {
      if (field.kind !== "documentPath" || field.path.includes(".") || field.valueFormat === "exactDecimal") break;
      fields.push(field.path); formats.push(field.valueFormat ?? "plain");
      addTrie("index", fields);
      const setKey = signature(fields), predicateKey = logicalReadPredicateKey(predicate);
      const extra = { indexDefinitionId: definition.indexDefinitionId, formats: [...formats] };
      // Equality eligibility depends on the field set and membership, whereas
      // a range must be the last consumed plain field. Keep the first admitted
      // definition for each exact eligibility class.
      addKey("index", JSON.stringify([setKey, predicateKey, "eq"]), fields, predicate, ordinal, extra);
      if (field.valueFormat !== "sha256TextV1")
        addKey("indexRange", JSON.stringify([setKey, predicateKey, field.path]), fields, predicate, ordinal, extra);
      for (let length = 1; length <= fields.length; length++) {
        const pointKey = JSON.stringify(fields.slice(0, length));
        addKey("indexPoint", JSON.stringify([setKey, predicateKey, pointKey, "eq"]), fields, predicate, ordinal, extra);
        if (field.valueFormat !== "sha256TextV1")
          addKey("indexPoint", JSON.stringify([setKey, predicateKey, pointKey, field.path]), fields, predicate, ordinal, extra);
      }
    }
    const physicalFields = definition.physicalSpec.orderedFields;
    if (physicalFields.at(-1)?.kind === "systemCreationTime" && fields.length === physicalFields.length - 1 &&
      physicalFields.slice(0, -1).every(field => field.kind === "documentPath" && field.valueFormat === undefined))
      add("page", fields, predicate, ordinal, { indexDefinitionId: definition.indexDefinitionId });
  }
  for (const [ordinal, definition] of uniques.toSorted((left, right) => left.logicalUniqueConstraintId - right.logicalUniqueConstraintId).entries()) {
    if (definition.physicalSpec.predicate !== undefined || definition.physicalSpec.orderedFields.some(field => field.includes("."))) continue;
    const fields = definition.physicalSpec.orderedFields;
    addTrie("unique", fields);
    addKey("unique", JSON.stringify([signature(fields), definition.physicalSpec.nullsDistinct === true ? "nonNull" : "all"]), fields, null, ordinal, {
      uniqueConstraintDefinitionId: definition.uniqueConstraintDefinitionId,
      nullsDistinct: definition.physicalSpec.nullsDistinct ?? false });
  }
  for (const [ordinal, index] of (nativeTable?.indexes ?? []).entries()) {
    // The current native compiler does not select text-equality membership
    // indexes as scalar anchors. Preserve that existing refusal/order.
    if (index.predicate?.kind === "isNullAndTextEquals" || index.predicate?.kind === "isNullAndBooleanEquals") continue;
    const fields = index.columns.map(column => column.columnId);
    const predicate = index.predicate?.kind === "isNull" ? { kind: "fieldIsNull", field: index.predicate.column.columnId } : null;
    // Scalar eligibility is independent of irrelevant index suffixes. The
    // earliest equivalent native fact wins, preserving existing find order.
    add(`native:${index.kind}`, fields.slice(0, 1), predicate, ordinal, { nativeIndex: index });
    if (index.kind === "uniqueBtree" && fields.length === 1)
      add("native:uniqueSingle", fields, predicate, ordinal, { nativeIndex: index });
    if (index.kind === "uniqueBtree" && fields.length > 1 && fields.length <= 4)
      add("nativePoint", fields, predicate, ordinal, { nativeIndex: index });
  }
  for (const [ordinal, nativeKey] of (nativeTable?.keys ?? []).entries())
    add(nativeKey.columns.length === 1 ? "nativeKey:single" : "nativeKey:composite", nativeKey.columns.slice(0, 1).map(column => column.columnId), null, ordinal, { nativeKey });
  if (nativeTable !== undefined) for (const index of relationalReverseIndexes(nativeTable)) add("nativeReverse", [index.column.columnId], null, 0, {});
  for (const [ordinal, definition] of searches.entries()) add("search", definition.columns,
    definition.nullPredicateField === null ? null : { kind: "fieldIsNull", field: definition.nullPredicateField }, ordinal,
    { logicalIndexId: definition.logicalIndexId, kind: definition.kind, sourceSha256: definition.sourceSha256,
      nullPredicateField: definition.nullPredicateField });
  for (const winner of winners.values()) {
    const canonical = yield* sha(winner.projectionJson);
    yield* runDrizzleStatementEffect(tx.insert(fxControlLogicalReadAccess).values({ ...key, ...winner,
      projectionSha256: canonical.sha256Hex }).onConflictDoNothing(), cause => failure("resourceFailure", cause));
    const [existing] = yield* runDrizzleStatementEffect(tx.select({ digest: fxControlLogicalReadAccess.projectionSha256 })
      .from(fxControlLogicalReadAccess).where(and(eq(fxControlLogicalReadAccess.deploymentId, key.deploymentId),
        eq(fxControlLogicalReadAccess.schemaVersionId, key.schemaVersionId), eq(fxControlLogicalReadAccess.sourceKey, key.sourceKey),
        eq(fxControlLogicalReadAccess.localName, key.localName), eq(fxControlLogicalReadAccess.selectorKind, winner.selectorKind),
        eq(fxControlLogicalReadAccess.selectorKey, winner.selectorKey))), cause => failure("resourceFailure", cause));
    if (existing?.digest !== canonical.sha256Hex) return yield* Effect.fail(failure("storedCorruption"));
  }
});

/** Each miss loads a single immutable root/table. The captured lease charges
 * retained successful values, bounds concurrent work through the host owner,
 * and refuses every escaped access after close. */
export const prepareLogicalReadMetadata = Effect.fn("LogicalReadMetadata.prepare")(function* (
  db: FlarexMetadataDatabase, input: Readonly<{ deploymentId: string; scopeId: ScopeId; schemaVersionId: CatalogSchemaVersionId }>,
  pinInput: unknown, controlInstallation: PreparedInstallation,
) {
  const pin = yield* Schema.decodeUnknownEffect(LogicalSourceReadPinSchema)(pinInput).pipe(Effect.mapError(cause => failure("invalidInput", cause)));
  const lifetime = yield* captureHostPreparationLifetime();
  if (lifetime === undefined) return yield* Effect.fail(failure("invalidComposition"));
  const checkOpen = Effect.suspend(() => Effect.fromResult(lifetime.checkOpen()).pipe(Effect.mapError(cause =>
    failure(cause.reason === "closed" ? "closed" : "resourceFailure", cause))));
  const protectedMetadata = yield* prepareProtectedMetadata(db, controlInstallation).pipe(Effect.mapError(cause => failure("invalidComposition", cause)));
  const captured = yield* acquireMetadata(db, tx => Effect.gen(function* () {
    const rows = yield* runDrizzleStatementEffect(tx.select().from(fxControlLogicalReadSources).where(and(
    eq(fxControlLogicalReadSources.deploymentId, input.deploymentId), eq(fxControlLogicalReadSources.schemaVersionId, input.schemaVersionId),
    eq(fxControlLogicalReadSources.sourceKey, pin.sourceKey))).limit(1), cause => failure("resourceFailure", cause));
    return { rows, epoch: yield* captureProtectedMetadataEpoch(protectedMetadata, db, tx)
      .pipe(Effect.mapError(cause => failure("invalidComposition", cause))) };
  }), controlInstallation);
  const stored = captured.rows[0];
  const acquire = <A, E>(work: (tx: FlarexMetadataTransaction) => Effect.Effect<A, E>) => acquireMetadata(db, tx =>
    guardProtectedMetadataEpoch(protectedMetadata, db, captured.epoch, tx).pipe(
      Effect.mapError(cause => failure("invalidComposition", cause)), Effect.andThen(() => work(tx))), controlInstallation);
  const checkCurrent = Effect.fn("LogicalReadMetadata.checkCurrent")(function* () {
    yield* checkOpen;
    yield* acquireMetadata(db, tx => guardProtectedMetadataEpoch(protectedMetadata, db, captured.epoch, tx), controlInstallation)
      .pipe(Effect.mapError(cause => failure("invalidComposition", cause)));
  });
  const authenticateAndRegister = Effect.fn("LogicalReadMetadata.authenticateAndRegister")(function* (
    tx: FlarexMetadataTransaction,
  ) {
    yield* checkOpen;
    yield* authenticateProtectedTargetMetadataSnapshot({ database: db, token: protectedMetadata, epoch: captured.epoch }, tx)
      .pipe(Effect.mapError(cause => failure("invalidComposition", cause)));
    yield* registerProtectedMetadataFinalGuard(tx, protectedMetadata, db, captured.epoch)
      .pipe(Effect.mapError(cause => failure("invalidComposition", cause)));
  });
  if (stored === undefined) return yield* Effect.fail(failure("definitionMissing"));
  const root = yield* decodeRoot(stored.projectionJson).pipe(Effect.mapError(cause => failure("storedCorruption", cause)));
  if (root.sourceKey !== pin.sourceKey || root.sourceSha256 !== pin.sourceSha256 || root.writeProfile !== pin.writeProfile)
    return yield* Effect.fail(failure("sourceMismatch"));
  const canonical = yield* sha(root);
  if (canonical.sha256Hex !== stored.projectionSha256 || root.deploymentId !== input.deploymentId || root.scopeId !== input.scopeId ||
    root.schemaVersionId !== input.schemaVersionId || root.sourceKey !== pin.sourceKey || root.sourceSha256 !== pin.sourceSha256 ||
    root.writeProfile !== pin.writeProfile || root.sourceSha256 !== stored.sourceSha256 || root.manifestSha256 !== encodeBytesToLowercaseHex(stored.manifestSha256))
    return yield* Effect.fail(failure("storedCorruption"));
  yield* Effect.fromResult(lifetime.charge(root)).pipe(Effect.mapError(cause => failure("resourceFailure", cause)));
  const tables = new Map<string, LogicalReadTableMetadata>();
  const tablesById = new Map<CatalogTableId, LogicalReadTableMetadata>();
  const indexesById = new Map<number, LocatedAppIndexDefinitionV1>();
  const uniqueById = new Map<number, LocatedAppUniqueConstraintDefinitionV1>();
  const searchesById = new Map<number, LogicalSearchDefinition>();
  const selectedIndexes = new Map<string, LocatedAppIndexDefinitionV1 | null>();
  const selectedUnique = new Map<string, LocatedAppUniqueConstraintDefinitionV1 | null>();
  const nativeSelections = new Map<string, LogicalRelationalReadAccess>();
  const searchSelections = new Map<string, readonly LogicalSearchDefinition[]>();
  const retain = <A>(cache: Map<string, A>, key: string, value: A, payload: unknown = value) => Effect.suspend(() => {
    if (cache.has(key)) return Effect.succeed(cache.get(key)!);
    return Effect.fromResult(lifetime.charge({ key, value: payload })).pipe(Effect.mapError(cause => failure("resourceFailure", cause)),
      Effect.map(() => { cache.set(key, value); return value; }));
  });
  const table = Effect.fn("LogicalReadMetadata.table")(function* (localName: string) {
    yield* checkOpen;
    const existing = tables.get(localName);
    if (existing !== undefined) return existing;
    const [row] = yield* acquire(tx => runDrizzleStatementEffect(tx.select().from(fxControlLogicalReadTables).where(and(
      eq(fxControlLogicalReadTables.deploymentId, input.deploymentId), eq(fxControlLogicalReadTables.schemaVersionId, input.schemaVersionId),
      eq(fxControlLogicalReadTables.sourceKey, root.sourceKey), eq(fxControlLogicalReadTables.localName, localName))).limit(1), cause => failure("resourceFailure", cause)));
    if (row === undefined) return yield* Effect.fail(failure("definitionMissing"));
    const decoded = yield* decodeTable(row.projectionJson).pipe(Effect.mapError(cause => failure("storedCorruption", cause)));
    const canonicalTable = yield* sha(decoded);
    if (canonicalTable.sha256Hex !== row.projectionSha256 || decoded.sourceSha256 !== root.sourceSha256 || decoded.localName !== localName ||
      decoded.tableId !== row.tableId || decoded.kind !== root.kind)
      return yield* Effect.fail(failure("storedCorruption"));
    yield* checkCurrent();
    return yield* Effect.suspend(() => {
      const concurrent = tables.get(localName);
      if (concurrent !== undefined) return Effect.succeed(concurrent);
      return Effect.fromResult(lifetime.charge(decoded)).pipe(Effect.mapError(cause => failure("resourceFailure", cause)),
        Effect.map(() => { const owned = snapshotDecodedProtocolPlainData(decoded); tables.set(localName, owned); tablesById.set(owned.tableId, owned); return owned; }));
    });
  });
  const selectIndex = Effect.fn("LogicalReadMetadata.selectIndex")(function* (
    localName: string, where: LogicalWhere, exactPoint?: Readonly<{ columns: readonly string[]; nullColumn?: string }>,
  ) {
    yield* checkOpen;
    const metadata = yield* table(localName);
    const key = JSON.stringify([localName, structuralWhere(where, [...metadata.selectorTextFields, ...(metadata.selectorBooleanFields ?? [])]), exactPoint ?? null]);
    if (selectedIndexes.has(key)) return selectedIndexes.get(key)!;
    const available = Object.keys(where);
    if (available.length === 0) return null;
    const [row] = yield* acquire(tx => runDrizzleStatementEffect(logicalIndexReadAccessQuery(tx, { ...input, sourceKey: root.sourceKey, localName }, where, exactPoint), cause => failure("resourceFailure", cause)));
    if (row === undefined) { yield* checkCurrent(); return yield* retain(selectedIndexes, key, null); }
    const access = yield* decodeIndexAccess(row.projectionJson).pipe(Effect.mapError(cause => failure("storedCorruption", cause)));
    const canonicalAccess = yield* sha(access);
    if (canonicalAccess.sha256Hex !== row.projectionSha256) return yield* Effect.fail(failure("storedCorruption"));
    const located = indexesById.get(access.indexDefinitionId) ?? (yield* acquire(tx => locateAppIndexDefinitionByIdEffect(tx, input.scopeId, access.indexDefinitionId)));
    if (located === null || located.deploymentId !== input.deploymentId || located.access.tableId !== metadata.tableId)
      return yield* Effect.fail(failure("storedCorruption"));
    if (JSON.stringify(located.physicalSpec.predicate ?? null) !== JSON.stringify(access.predicate) ||
      access.fields.some((field, offset) => { const actual = located.physicalSpec.orderedFields[offset];
        return actual?.kind !== "documentPath" || actual.path !== field || (actual.valueFormat ?? "plain") !== access.formats?.[offset]; }))
      return yield* Effect.fail(failure("storedCorruption"));
    yield* checkCurrent();
    const kept = yield* retain(selectedIndexes, key, located, { ...located, createdAt: located.createdAt.getTime() });
    if (kept !== null) indexesById.set(kept.indexDefinitionId, kept);
    return kept;
  });
  const selectUnique = Effect.fn("LogicalReadMetadata.selectUnique")(function* (localName: string, where: LogicalWhere) {
    yield* checkOpen;
    const metadata = yield* table(localName), key = JSON.stringify([localName, structuralWhere(where, [])]);
    if (selectedUnique.has(key)) return selectedUnique.get(key)!;
    const available = Object.keys(where).filter(field => where[field] === null || typeof where[field] !== "object");
    if (available.length === 0) return null;
    const [row] = yield* acquire(tx => runDrizzleStatementEffect(logicalUniqueReadAccessQuery(tx, { ...input, sourceKey: root.sourceKey, localName }, where), cause => failure("resourceFailure", cause)));
    if (row === undefined) { yield* checkCurrent(); return yield* retain(selectedUnique, key, null); }
    const access = yield* decodeUniqueAccess(row.projectionJson).pipe(Effect.mapError(cause => failure("storedCorruption", cause)));
    if ((yield* sha(access)).sha256Hex !== row.projectionSha256) return yield* Effect.fail(failure("storedCorruption"));
    const located = uniqueById.get(access.uniqueConstraintDefinitionId) ?? (yield* acquire(tx =>
      locateAppUniqueConstraintDefinitionByIdEffect(tx, input.deploymentId, input.scopeId, input.schemaVersionId, access.uniqueConstraintDefinitionId)));
    if (located === null || located.tableId !== metadata.tableId || JSON.stringify(located.physicalSpec.orderedFields) !== JSON.stringify(access.fields) ||
      (located.physicalSpec.nullsDistinct ?? false) !== access.nullsDistinct || located.physicalSpec.predicate !== undefined)
      return yield* Effect.fail(failure("storedCorruption"));
    yield* checkCurrent();
    const kept = yield* retain(selectedUnique, key, located, { ...located, createdAt: located.createdAt.getTime() });
    if (kept !== null) uniqueById.set(kept.uniqueConstraintDefinitionId, kept);
    return kept;
  });
  const selectPage = Effect.fn("LogicalReadMetadata.selectPage")(function* (localName: string, orderColumn: string,
    equality: Readonly<{ column: string; value: string | boolean }> | undefined, requiredNulls: readonly string[]) {
    yield* checkOpen;
    const metadata = yield* table(localName);
    const fields = equality !== undefined && equality.column !== orderColumn ? [equality.column, orderColumn] : [orderColumn];
    const key = JSON.stringify(["page", localName, fields, equality === undefined ? null :
      [equality.column, metadata.selectorTextFields.includes(equality.column) || metadata.selectorBooleanFields?.includes(equality.column)
        ? equality.value : typeof equality.value], [...requiredNulls].toSorted()]);
    if (selectedIndexes.has(key)) return selectedIndexes.get(key)!;
    const [row] = yield* acquire(tx => runDrizzleStatementEffect(logicalPageReadAccessQuery(tx,
      { ...input, sourceKey: root.sourceKey, localName }, fields, equality, requiredNulls), cause => failure("resourceFailure", cause)));
    if (row === undefined) { yield* checkCurrent(); return yield* retain(selectedIndexes, key, null); }
    const access = yield* decodeIndexAccess(row.projectionJson).pipe(Effect.mapError(cause => failure("storedCorruption", cause)));
    if ((yield* sha(access)).sha256Hex !== row.projectionSha256) return yield* Effect.fail(failure("storedCorruption"));
    const located = indexesById.get(access.indexDefinitionId) ?? (yield* acquire(tx => locateAppIndexDefinitionByIdEffect(tx, input.scopeId, access.indexDefinitionId)));
    if (located === null || located.access.tableId !== metadata.tableId || located.deploymentId !== input.deploymentId)
      return yield* Effect.fail(failure("storedCorruption"));
    yield* checkCurrent();
    const kept = yield* retain(selectedIndexes, key, located, { ...located, createdAt: located.createdAt.getTime() });
    if (kept !== null) indexesById.set(kept.indexDefinitionId, kept);
    return kept;
  });
  const tableById = Effect.fn("LogicalReadMetadata.tableById")(function* (tableId: CatalogTableId) {
    yield* checkOpen;
    const existing = tablesById.get(tableId);
    if (existing !== undefined) return existing;
    const [row] = yield* acquire(tx => runDrizzleStatementEffect(tx.select({ localName: fxControlLogicalReadTables.localName }).from(fxControlLogicalReadTables)
      .where(and(eq(fxControlLogicalReadTables.deploymentId, input.deploymentId), eq(fxControlLogicalReadTables.schemaVersionId, input.schemaVersionId),
        eq(fxControlLogicalReadTables.sourceKey, root.sourceKey), eq(fxControlLogicalReadTables.tableId, tableId))).limit(1), cause => failure("resourceFailure", cause)));
    if (row === undefined) return yield* Effect.fail(failure("definitionMissing"));
    return yield* table(row.localName);
  });
  const queryAccess = Effect.fn("LogicalReadMetadata.queryAccess")(function* (localName: string, demand: LogicalRelationalReadDemand) {
    yield* checkOpen;
    const metadata = yield* table(localName);
    if (metadata.kind !== "relational") return yield* Effect.fail(failure("invalidInput"));
    const available = demand.fields, requiredNulls = demand.nulls, points = demand.points.map(columns => JSON.stringify(columns)),
      key = JSON.stringify([localName, available, requiredNulls, points]);
    if (nativeSelections.has(key)) return nativeSelections.get(key)!;
    if (available.length === 0) return { indexes: [], keys: [], scalarColumns: [] } satisfies LogicalRelationalReadAccess;
    const rows = yield* acquire(tx => runDrizzleStatementEffect(logicalNativeReadAccessQuery(tx,
      { ...input, sourceKey: root.sourceKey, localName }, demand), cause => failure("resourceFailure", cause)));
    if (rows.length > (available.length * 8 + points.length) * (requiredNulls.length + 1)) return yield* Effect.fail(failure("storedCorruption"));
    const native: RelationalTableDefinition["indexes"][number][] = [];
    const keys: RelationalTableDefinition["keys"][number][] = [], scalarColumns: string[] = [];
    for (const row of rows) {
      if (!isJson(row.projectionJson) || !isJsonObject(row.projectionJson) || (yield* sha(row.projectionJson)).sha256Hex !== row.projectionSha256)
        return yield* Effect.fail(failure("storedCorruption"));
      const base = metadata.readSchema.tables[0];
      if (base === undefined) return yield* Effect.fail(failure("storedCorruption"));
      if (row.selectorKind === "nativeReverse") { scalarColumns.push(row.leadingField); continue; }
      if (row.selectorKind.startsWith("nativeKey:")) {
        const nativeKey = row.projectionJson.nativeKey;
        if (!isJson(nativeKey) || !isJsonObject(nativeKey) || !isJson(nativeKey.identity) || !isJsonObject(nativeKey.identity)) return yield* Effect.fail(failure("storedCorruption"));
        const selectedKeyId = nativeKey.identity.keyId;
        const normalized = yield* Effect.fromResult(decodeRelationalSchemaMetadata(relationalSchemaSourceFromDefinition({ ...metadata.readSchema,
          tables: [{ ...base, keys: [...base.keys.filter(existing => existing.identity.keyId !== selectedKeyId), nativeKey] }] })))
          .pipe(Effect.mapError(cause => failure("storedCorruption", cause)));
        const selected = normalized.tables[0]?.keys.find(candidate => candidate.identity.keyId === selectedKeyId);
        if (selected === undefined) return yield* Effect.fail(failure("storedCorruption"));
        keys.push(selected); continue;
      }
      const normalized = yield* Effect.fromResult(decodeRelationalSchemaMetadata(relationalSchemaSourceFromDefinition({ ...metadata.readSchema,
        tables: [{ ...base, indexes: [row.projectionJson.nativeIndex] }] }))).pipe(Effect.mapError(cause => failure("storedCorruption", cause)));
      const index = normalized.tables[0]?.indexes[0];
      if (index === undefined) return yield* Effect.fail(failure("storedCorruption"));
      native.push(index);
    }
    yield* checkCurrent();
    return yield* retain(nativeSelections, key, Object.freeze({ indexes: Object.freeze(native), keys: Object.freeze(keys), scalarColumns: Object.freeze(scalarColumns) }));
  });
  const selectSearch = Effect.fn("LogicalReadMetadata.selectSearch")(function* (localName: string, columns: readonly string[], nulls: readonly string[], kind: "text" | "jsonContainment") {
    yield* checkOpen;
    const metadata = yield* table(localName), key = JSON.stringify([localName, [...new Set(columns)].toSorted(), [...new Set(nulls)].toSorted(), kind]);
    if (searchSelections.has(key)) return searchSelections.get(key)!;
    if (columns.length === 0) return [];
    const rows = yield* acquire(tx => runDrizzleStatementEffect(logicalSearchReadAccessQuery(tx,
      { ...input, sourceKey: root.sourceKey, localName }, columns, nulls, kind), cause => failure("resourceFailure", cause)));
    const selected: LogicalSearchDefinition[] = [];
    for (const row of rows) {
      const access = yield* decodeSearchAccess(row.projectionJson).pipe(Effect.mapError(cause => failure("storedCorruption", cause)));
      if ((yield* sha(access)).sha256Hex !== row.projectionSha256 || access.sourceSha256 !== root.sourceSha256) return yield* Effect.fail(failure("storedCorruption"));
      selected.push(Object.freeze({ tableId: metadata.tableId, logicalIndexId: access.logicalIndexId, kind: access.kind,
        sourceSha256: access.sourceSha256, columns: access.fields, nullPredicateField: access.nullPredicateField }));
    }
    yield* checkCurrent();
    const kept = yield* retain(searchSelections, key, Object.freeze(selected));
    for (const definition of kept) searchesById.set(definition.logicalIndexId, definition);
    return kept;
  });
  yield* checkCurrent();
  const prepared = Object.freeze({ root: snapshotDecodedProtocolPlainData(root), table, tableById, selectIndex, selectPage, selectUnique, queryAccess, selectSearch, checkOpen, authenticateAndRegister,
    selectedTable: (id: CatalogTableId) => tablesById.get(id), selectedIndex: (id: number) => indexesById.get(id),
    selectedUnique: (id: number) => uniqueById.get(id), selectedSearch: (id: number) => searchesById.get(id) });
  issuedReadMetadata.add(prepared);
  return prepared;
});
export type PreparedLogicalReadMetadata = Effect.Success<ReturnType<typeof prepareLogicalReadMetadata>>;

/** Only the protected catalog owner can issue a recognized read preparation. */
export const requirePreparedLogicalReadMetadata = Effect.fn("LogicalReadMetadata.requirePrepared")(function* (
  metadata: PreparedLogicalReadMetadata,
) {
  if (!issuedReadMetadata.has(metadata)) return yield* Effect.fail(failure("invalidComposition"));
  yield* metadata.checkOpen;
});
