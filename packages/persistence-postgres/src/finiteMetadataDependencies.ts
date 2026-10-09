import { and, eq, sql } from "drizzle-orm";
import { bytesEqualFullScan, copyBytes, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { Data, Effect, Result, Schema } from "effect";
import type { CatalogTableId } from "flarex-protocol/catalog";
import { LogicalMetadataKeySchema, LogicalMetadataReadDependencySchema, MetadataSequenceSchema,
  MAX_COMMIT_METADATA_READ_DEPENDENCIES, logicalMetadataDependencyIdentity,
  type LogicalMetadataKey, type LogicalMetadataReadDependency, type MetadataSequence } from "flarex-protocol/commit-protocol";
import { encodeCanonicalJson, isJson, type Json, type JsonObject } from "flarex-protocol/json";
import { logicalTableKey } from "flarex-protocol/internal/logical-schema-candidate";
import { relationalForeignKeyReverseColumns } from "flarex-protocol/internal/relational-schema";
import type { ScopeId } from "flarex-protocol/storage-authority";
import type { SchemaManifestAppSchemaV1 } from "flarex-protocol/schema-manifest";
import type { LocatedAppIndexDefinitionV1 } from "./appIndexDefinitions";
import type { LocatedAppUniqueConstraintDefinitionV1 } from "./appUniqueConstraintDefinitions";
import { capturePrivateCanonicalValue } from "./frameworkSchema/privateCanonicalValue";
import type { PreparedLogicalStorageRequirements } from "./logicalStorageDefinitions";
import type { FlarexMetadataTransaction } from "./metadataTransaction";
import { runDrizzleStatementEffect } from "./drizzleStatementEffect";
import { fxSystemMetadataContractObservations, fxSystemScopeClocks } from "./schema";

const strict = { parseOptions: { onExcessProperty: "error" } } as const;
const digest = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));
export const FiniteMetadataContractSchema = Schema.Struct({ ...LogicalMetadataKeySchema.fields,
  semanticSha256Hex: digest }).annotate(strict);
export type FiniteMetadataContract = typeof FiniteMetadataContractSchema.Type;
export const FiniteMetadataOwnerSchema = Schema.Struct({ namespace: LogicalMetadataKeySchema.fields.namespace,
  ownerKey: LogicalMetadataKeySchema.fields.ownerKey }).annotate(strict);
export type FiniteMetadataOwner = typeof FiniteMetadataOwnerSchema.Type;
const decodeContractEffect = Schema.decodeUnknownEffect(FiniteMetadataContractSchema);
const decodeOwnersEffect = Schema.decodeUnknownEffect(Schema.Array(FiniteMetadataOwnerSchema));
const decodeSequenceTypeEffect = Schema.decodeUnknownEffect(Schema.toType(MetadataSequenceSchema));
const decodeDependencyTypeResult = Schema.decodeUnknownResult(Schema.toType(LogicalMetadataReadDependencySchema));
const decodeDependencyArrayTypeResult = Schema.decodeUnknownResult(Schema.toType(Schema.Array(LogicalMetadataReadDependencySchema)));
export const APPLICATION_EXECUTION_METADATA_OWNER = Object.freeze({ namespace: "execution", ownerKey: "application" } as const satisfies FiniteMetadataOwner);

export class FiniteMetadataError extends Data.TaggedError("FiniteMetadataError")<{
  readonly reason: "invalidInput" | "invalidProjection" | "projectionMissing" | "writeConflict" | "limitExceeded" | "resourceFailure";
  readonly cause?: unknown;
  readonly dependency?: LogicalMetadataKey;
  readonly capturedMetadataWatermark?: MetadataSequence;
  readonly lastChangedMetadataSequence?: MetadataSequence;
  readonly expectedObservation?: LogicalMetadataReadDependency["observed"];
  readonly currentObservation?: Readonly<{ present: boolean; semanticSha256Hex: string | null;
    lastChangedMetadataSequence: MetadataSequence }> | null;
}> {}
const failure = (reason: FiniteMetadataError["reason"], cause?: unknown) => new FiniteMetadataError({ reason,
  ...(cause === undefined ? {} : { cause }) });
const canonical = (value: Json): string => encodeCanonicalJson(value, () => { throw new Error("Owned metadata semantics are not JSON"); });
export const finiteMetadataContractKey = (kind: string, ...identity: readonly (string | number)[]): string =>
  canonical([kind, ...identity]);

const FiniteMetadataComparisonExpectedSchema = Schema.Struct({ ...LogicalMetadataKeySchema.fields,
  present: Schema.Boolean, semanticSha256Hex: Schema.NullOr(digest),
  semanticBytesHex: Schema.optional(Schema.String.check(Schema.isPattern(/^(?:[0-9a-f]{2})+$/))),
}).annotate(strict);
export type FiniteMetadataComparisonExpected = typeof FiniteMetadataComparisonExpectedSchema.Type;
const FiniteMetadataComparisonVerdictSchema = Schema.Union([
  Schema.Struct({ reason: Schema.Literal("accepted") }).annotate(strict),
  Schema.Struct({ reason: Schema.Literals(["writeConflict", "projectionMissing"]),
    ordinal: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    currentObservation: Schema.NullOr(Schema.Struct({ present: Schema.Boolean,
      semanticSha256Hex: Schema.NullOr(digest), lastChangedMetadataSequence: MetadataSequenceSchema }).annotate(strict)),
  }).annotate(strict),
]);
const decodeComparisonVerdict = Schema.decodeUnknownResult(FiniteMetadataComparisonVerdictSchema);
const entryComparisonFailure = (cause: FiniteMetadataError): FiniteMetadataError => cause.reason === "writeConflict"
  ? new FiniteMetadataError({ ...cause, reason: "projectionMissing", cause }) : cause;

/** Driver JSON is decoded once, then correlated with the ordered authentic
 * expectations. A success carries no returned metadata graph. */
export const acceptFiniteMetadataComparisonVerdict = (input: unknown,
  expected: readonly FiniteMetadataComparisonExpected[], capturedWatermark: MetadataSequence | null,
): Result.Result<void, FiniteMetadataError> => Result.gen(function* () {
  const verdict = yield* decodeComparisonVerdict(input).pipe(Result.mapError(cause => failure("invalidProjection", cause)));
  if (verdict.reason === "accepted") return;
  const selected = expected[verdict.ordinal];
  if (selected === undefined || verdict.reason === "writeConflict" && (capturedWatermark === null ||
    verdict.currentObservation === null || verdict.currentObservation.lastChangedMetadataSequence <= capturedWatermark))
    return yield* Result.fail(failure("invalidProjection"));
  return yield* Result.fail(new FiniteMetadataError({ reason: verdict.reason,
    dependency: { namespace: selected.namespace, ownerKey: selected.ownerKey, contractKey: selected.contractKey },
    expectedObservation: selected.present && selected.semanticSha256Hex !== null
      ? { kind: "present", semanticSha256Hex: selected.semanticSha256Hex } : { kind: "missing" },
    currentObservation: verdict.currentObservation,
    ...(verdict.reason === "writeConflict" && capturedWatermark !== null && verdict.currentObservation !== null ? {
      capturedMetadataWatermark: capturedWatermark,
      lastChangedMetadataSequence: verdict.currentObservation.lastChangedMetadataSequence,
    } : {}),
  }));
});
/** Entry preserves construction refusal even when the underlying observation
 * identifies a relevant activation after its provisional watermark. */
export const acceptFiniteMetadataEntryComparisonVerdict = (input: unknown,
  expected: readonly FiniteMetadataComparisonExpected[], capturedWatermark: MetadataSequence,
) => acceptFiniteMetadataComparisonVerdict(input, expected, capturedWatermark).pipe(Result.mapError(entryComparisonFailure));

const compareFiniteMetadata = Effect.fn("FiniteMetadata.compareCurrent")(function* (
  tx: FlarexMetadataTransaction, scopeId: ScopeId, watermark: MetadataSequence | null,
  expected: readonly FiniteMetadataComparisonExpected[],
) {
  if (expected.length === 0) return;
  const [row] = yield* runDrizzleStatementEffect(tx.select({ verdict: sql<unknown>`fx_compare_finite_metadata(
    ${scopeId}::text, ${watermark?.toString() ?? null}::bigint, ${encodeFiniteMetadataComparison(expected)}::jsonb)` }).from(sql`(values (1)) as metadata_comparison`),
  cause => failure("resourceFailure", cause));
  return yield* Effect.fromResult(acceptFiniteMetadataComparisonVerdict(row?.verdict, expected, watermark));
});

/** Full-artifact entry submits its complete authentic expectations once before
 * flushing the existing epoch guards. The installed path composes this same
 * SQL owner inside its completion statement instead. */
export const submitFiniteMetadataEntryComparisonEffect = Effect.fn("FiniteMetadata.submitEntryComparison")((
  tx: FlarexMetadataTransaction, scopeId: ScopeId, watermark: MetadataSequence,
  expected: readonly FiniteMetadataComparisonExpected[],
): Effect.Effect<void, FiniteMetadataError> =>
  compareFiniteMetadata(tx, scopeId, watermark, expected).pipe(Effect.mapError(entryComparisonFailure)));

declare const projectionBrand: unique symbol;
/** An authenticated retained semantic projection, never an admission authority. */
export interface PreparedFiniteMetadataProjection { readonly [projectionBrand]: true }
interface ProjectionState {
  readonly contracts: ReadonlyMap<string, FiniteMetadataContract>;
  readonly semanticBytes: ReadonlyMap<string, Uint8Array>;
  readonly owners: readonly FiniteMetadataOwner[];
  readonly tables: ReadonlyMap<CatalogTableId, Readonly<{ namespace: FiniteMetadataOwner["namespace"]; ownerKey: string; localName: string }>>;
  readonly entryExpected: readonly FiniteMetadataComparisonExpected[];
  readonly entryByIdentity: ReadonlyMap<string, FiniteMetadataComparisonExpected>;
  readonly writeClosures: ReadonlyMap<CatalogTableId, FiniteMetadataComparisonExpected>;
  readonly ownedExpected: readonly FiniteMetadataComparisonExpected[];
}
const projections = new WeakMap<PreparedFiniteMetadataProjection, ProjectionState>();
const encodedExpectations = new WeakMap<FiniteMetadataComparisonExpected, string>();
/** Only exact immutable tuples issued here retain their encoding. Dynamic
 * negative observations are encoded anew; no structural equality grants reuse. */
export const encodeFiniteMetadataComparison = (expected: readonly FiniteMetadataComparisonExpected[]): string =>
  `[${expected.map(member => encodedExpectations.get(member) ?? JSON.stringify(member)).join(",")}]`;
type ProjectionInputState = Omit<ProjectionState, "entryExpected" | "entryByIdentity" | "writeClosures" | "ownedExpected">;
function compileProjectionComparisons(state: ProjectionInputState): ProjectionState {
  const entryExpected = Object.freeze([...state.contracts.values()].map(contract => {
    const expected = Object.freeze({ namespace: contract.namespace, ownerKey: contract.ownerKey,
      contractKey: contract.contractKey, present: true, semanticSha256Hex: contract.semanticSha256Hex });
    encodedExpectations.set(expected, JSON.stringify(expected));
    return expected;
  }));
  const writeClosures = new Map<CatalogTableId, FiniteMetadataComparisonExpected>();
  for (const [tableId, table] of state.tables) {
    const key = { namespace: table.namespace, ownerKey: table.ownerKey,
      contractKey: finiteMetadataContractKey("writeClosure", table.localName) };
    const identity = logicalMetadataDependencyIdentity(key);
    const contract = state.contracts.get(identity), bytes = state.semanticBytes.get(identity);
    if (contract === undefined || bytes === undefined) continue;
    const expected = Object.freeze({ ...key, present: true, semanticSha256Hex: contract.semanticSha256Hex,
      semanticBytesHex: encodeBytesToLowercaseHex(bytes) });
    encodedExpectations.set(expected, JSON.stringify(expected));
    writeClosures.set(tableId, expected);
  }
  return { ...state, entryExpected, writeClosures,
    entryByIdentity: new Map(entryExpected.map(expected => [logicalMetadataDependencyIdentity(expected), expected])),
    ownedExpected: Object.freeze([...entryExpected, ...writeClosures.values()]) };
}
/** Existing issuer disposal removes every retained comparison along with its
 * authenticated projection; escaped inert tuple data cannot restore authority. */
export function disposeFiniteMetadataProjection(projection: PreparedFiniteMetadataProjection): void {
  const state = projections.get(projection);
  if (state === undefined) return;
  for (const expected of state.ownedExpected) encodedExpectations.delete(expected);
  projections.delete(projection);
}
/** Immutable catalog semantics consumed by metadata projection. Physical build
 * location/readiness belongs to the existing admission owner. */
export type FiniteMetadataIndexSemantics = Pick<LocatedAppIndexDefinitionV1,
  "indexDefinitionId" | "access" | "physicalSpec" | "physicalSpecSha256Hex">;
export type FiniteMetadataUniqueSemantics = Pick<LocatedAppUniqueConstraintDefinitionV1,
  "tableId" | "uniqueConstraintDefinitionId" | "logicalUniqueConstraintId" | "physicalSpec" | "physicalSpecSha256Hex">;
export type FiniteMetadataProjectionInput = Readonly<{
  readonly sourceKey?: string;
  readonly indexes: readonly FiniteMetadataIndexSemantics[];
  readonly unique: readonly FiniteMetadataUniqueSemantics[];
  readonly sourcePolicies?: readonly Readonly<{ sourceKey: string; semantic: JsonObject }>[];
  readonly application?: Readonly<{
    readonly functions: readonly Readonly<{ path: string; semantic: JsonObject }>[];
    readonly groups: readonly Readonly<{ group: string; semantic: JsonObject }>[];
  }>;
}> & (Readonly<{ requirements: PreparedLogicalStorageRequirements; requirementsProfile: "binding" | "nativeApplication";
  applicationSchema?: never }> | Readonly<{ requirements?: never; requirementsProfile?: never;
  applicationSchema?: Readonly<{ manifest: SchemaManifestAppSchemaV1 }> }>);

/** Derive only semantic contracts. Existing manifest/source/head digests retain
 * their original meaning and are deliberately absent from table preimages. */
export const prepareFiniteMetadataProjection = Effect.fn("FiniteMetadata.prepareProjection")(function* (input: FiniteMetadataProjectionInput) {
  const contracts = new Map<string, FiniteMetadataContract>();
  const semanticBytes = new Map<string, Uint8Array>();
  const owners = new Map<string, FiniteMetadataOwner>();
  const tables = new Map<CatalogTableId, ProjectionState["tables"] extends ReadonlyMap<CatalogTableId, infer Value> ? Value : never>();
  const add = Effect.fn("FiniteMetadata.addContract")(function* (owner: FiniteMetadataOwner, contractKey: string, semantic: unknown) {
    if (!isJson(semantic)) return yield* Effect.fail(failure("invalidProjection"));
    const captured = yield* capturePrivateCanonicalValue({ format: "flarex.metadata-contract", version: 1,
      semantic }, 4_194_304, { invalidInput: () => failure("invalidProjection"), hashFailure: cause => failure("resourceFailure", cause) });
    const contract = yield* decodeContractEffect({ ...owner, contractKey,
      semanticSha256Hex: captured.sha256Hex }).pipe(Effect.mapError(cause => failure("invalidProjection", cause)));
    const identity = logicalMetadataDependencyIdentity(contract);
    const prior = contracts.get(identity);
    if (prior !== undefined && prior.semanticSha256Hex !== contract.semanticSha256Hex)
      return yield* Effect.fail(failure("invalidProjection"));
    contracts.set(identity, Object.freeze(contract));
    semanticBytes.set(identity, captured.copyCanonicalBytes());
    owners.set(canonical([owner.namespace, owner.ownerKey]), Object.freeze(owner));
  });
  if (input.requirements !== undefined && input.requirementsProfile !== "binding" && input.requirementsProfile !== "nativeApplication" ||
    input.requirements !== undefined && input.applicationSchema !== undefined ||
    input.requirements === undefined && input.applicationSchema === undefined && input.application === undefined)
    return yield* Effect.fail(failure("invalidInput"));
  const addPhysicalContracts = Effect.fn("FiniteMetadata.addPhysicalContracts")(function* (
    owner: FiniteMetadataOwner, localName: string, tableId: CatalogTableId,
  ) {
    const indexes = input.indexes.filter(index => index.access.tableId === tableId);
    const unique = input.unique.filter(constraint => constraint.tableId === tableId);
    const indexSemantics = indexes.map(index => ({ indexDefinitionId: index.indexDefinitionId,
      access: index.access, physicalSpec: index.physicalSpec, physicalSpecSha256Hex: index.physicalSpecSha256Hex }));
    const uniqueSemantics = unique.map(constraint => ({ uniqueConstraintDefinitionId: constraint.uniqueConstraintDefinitionId,
      logicalUniqueConstraintId: constraint.logicalUniqueConstraintId, physicalSpec: constraint.physicalSpec,
      physicalSpecSha256Hex: constraint.physicalSpecSha256Hex }));
    for (const index of indexSemantics) yield* add(owner, finiteMetadataContractKey("index", index.indexDefinitionId), index);
    for (const constraint of uniqueSemantics) yield* add(owner, finiteMetadataContractKey("unique", constraint.uniqueConstraintDefinitionId), constraint);
    const families = new Map<string, unknown[]>();
    const member = (family: string, field: string | undefined, value: unknown) => {
      if (field === undefined) return;
      const key = finiteMetadataContractKey("accessFamily", localName, family, field);
      const values = families.get(key) ?? [];
      values.push(value);
      families.set(key, values);
    };
    for (const [ordinal, index] of indexes.entries()) {
      const field = index.physicalSpec.orderedFields[0];
      if (index.access.kind === "developer" && field?.kind === "documentPath") member("ordered", field.path, indexSemantics[ordinal]);
    }
    for (const [ordinal, constraint] of unique.entries()) member("unique", constraint.physicalSpec.orderedFields[0], uniqueSemantics[ordinal]);
    for (const [key, values] of families) yield* add(owner, key, values);
    return { indexSemantics, uniqueSemantics };
  });
  const requirements = input.requirements;
  const bindings = new Map((requirements?.evidence.tableBindings ?? []).map(binding => [logicalTableKey(binding.table), binding.tableId]));
  for (const source of requirements?.evidence.candidate.sources ?? []) {
    if (input.requirementsProfile === "nativeApplication" && source.owner !== "application") continue;
    if (input.sourceKey !== undefined && source.key !== input.sourceKey) continue;
    const owner: FiniteMetadataOwner = { namespace: input.requirementsProfile === "nativeApplication" ? "application" : "binding", ownerKey: source.key };
    yield* add(owner, finiteMetadataContractKey("sourcePolicy"), input.sourcePolicies?.find(policy => policy.sourceKey === source.key)?.semantic ??
      { owner: source.owner, writeProfile: source.writeProfile });
    for (const binding of source.bindings) {
      if (binding.kind !== "definition") continue;
      const tableId = bindings.get(logicalTableKey(binding.table));
      if (tableId === undefined || tables.has(tableId)) return yield* Effect.fail(failure("invalidProjection"));
      tables.set(tableId, { ...owner, localName: binding.localName });
      const { indexSemantics, uniqueSemantics } = yield* addPhysicalContracts(owner, binding.localName, tableId);
      const definition = source.definition.kind === "documents"
        ? source.definition.tables.find(table => table.logicalName === binding.localName)
        : source.definition.schema.tables.find(table => table.identity.tableId === binding.localName);
      if (definition === undefined) return yield* Effect.fail(failure("invalidProjection"));
      const relationalCoordinate = source.definition.kind === "relational" ? source.definition.schema.coordinate : null;
      if (source.definition.kind === "documents") {
        yield* add(owner, finiteMetadataContractKey("table", binding.localName), { tableId, definition });
      } else {
        const original = source.definition.schema.tables.find(table => table.identity.tableId === binding.localName);
        if (original === undefined) return yield* Effect.fail(failure("invalidProjection"));
        yield* add(owner, finiteMetadataContractKey("table", binding.localName), { tableId,
          definition: { ...original, indexes: [], relationships: [],
            keys: original.keys.some(key => key.kind === "primary") ? original.keys.filter(key => key.kind === "primary") : original.keys,
            constraints: original.constraints.filter(constraint => constraint.kind !== "foreignKey") },
          capabilities: source.definition.schema.capabilities.filter(capability => capability.kind === "exactNumericCompanion" &&
            capability.numericColumn.tableId === original.identity.tableId) });
      }
      yield* add(owner, finiteMetadataContractKey("writeClosure", binding.localName), { tableId, definition,
        indexes: indexSemantics, unique: uniqueSemantics,
        capabilities: source.definition.kind === "relational" ? source.definition.schema.capabilities.filter(capability =>
          capability.kind === "searchableText" ? capability.columns.some(column => column.tableId === binding.localName) :
          capability.kind === "exactNumericCompanion" ? capability.numericColumn.tableId === binding.localName || capability.rawColumn.tableId === binding.localName :
          capability.kind === "managedTimestamps" ? capability.createdAtColumn.tableId === binding.localName || capability.updatedAtColumn.tableId === binding.localName :
          capability.deletedAtColumn.tableId === binding.localName) : [],
        sourceRelations: source.definition.kind === "documents" ? source.definition.relations.filter(relation =>
          relation.source.table === binding.localName || relation.target.table === binding.localName) : [],
        extensions: (requirements?.evidence.candidate.extensions ?? []).filter(extension =>
          logicalTableKey(extension.source.table) === logicalTableKey(binding.table) ||
          logicalTableKey(extension.target.table) === logicalTableKey(binding.table)),
        incoming: (requirements?.evidence.candidate.sources ?? []).flatMap(candidate => candidate.definition.kind === "relational" ?
          candidate.definition.schema.tables.flatMap(table => table.constraints.filter(constraint => constraint.kind === "foreignKey" &&
            relationalCoordinate !== null && constraint.targetColumns.some(column =>
              column.tableId === binding.localName && column.owner === relationalCoordinate.owner &&
              column.lineageId === relationalCoordinate.lineageId)).map(constraint => ({ sourceKey: candidate.key, constraint }))) : []),
      });
      const families = new Map<string, Readonly<{ family: string; leadingField: string; values: unknown[] }>>();
      const member = (family: string, leadingField: string | undefined, value: unknown) => {
        if (leadingField === undefined) return;
        const key = canonical([family, leadingField]);
        let existing = families.get(key);
        if (existing === undefined) { existing = { family, leadingField, values: [] }; families.set(key, existing); }
        existing.values.push(value);
      };
      if (source.definition.kind === "relational") {
        const original = source.definition.schema.tables.find(table => table.identity.tableId === binding.localName);
        if (original === undefined) return yield* Effect.fail(failure("invalidProjection"));
        for (const index of original.indexes) member("nativeIndex", index.columns[0]?.columnId, index);
        for (const key of original.keys) member("nativeKey", key.columns[0]?.columnId, key);
        for (const column of relationalForeignKeyReverseColumns(original)) member("reverse", column.columnId, column);
      }
      for (const family of families.values()) yield* add(owner,
        finiteMetadataContractKey("accessFamily", binding.localName, family.family, family.leadingField), family.values);
    }
  }
  if (input.applicationSchema !== undefined) {
    const owner: FiniteMetadataOwner = { namespace: "application", ownerKey: "application" };
    yield* add(owner, finiteMetadataContractKey("sourcePolicy"), input.sourcePolicies?.find(policy => policy.sourceKey === "application")?.semantic ??
      { owner: "application", writeProfile: "application.occ" });
    for (const table of input.applicationSchema.manifest.tableDefinitions.tables) {
      if (tables.has(table.tableId)) return yield* Effect.fail(failure("invalidProjection"));
      tables.set(table.tableId, { ...owner, localName: table.logicalName });
      const definition = { logicalName: table.logicalName, definition: table.definition };
      const { indexSemantics, uniqueSemantics } = yield* addPhysicalContracts(owner, table.logicalName, table.tableId);
      yield* add(owner, finiteMetadataContractKey("table", table.logicalName), { tableId: table.tableId, definition });
      yield* add(owner, finiteMetadataContractKey("writeClosure", table.logicalName), { tableId: table.tableId, definition,
        indexes: indexSemantics, unique: uniqueSemantics, capabilities: [], sourceRelations: [], extensions: [], incoming: [] });
    }
  }
  const applicationOwner = APPLICATION_EXECUTION_METADATA_OWNER;
  for (const fn of input.application?.functions ?? []) yield* add(applicationOwner, finiteMetadataContractKey("function", fn.path), fn.semantic);
  for (const group of input.application?.groups ?? []) yield* add(applicationOwner, finiteMetadataContractKey("executionGroup", group.group), group.semantic);
  // SAFETY: only this private issuer can lend retained authenticated semantics.
  const projection = Object.freeze({}) as PreparedFiniteMetadataProjection;
  projections.set(projection, compileProjectionComparisons({ contracts, semanticBytes, owners: Object.freeze([...owners.values()]), tables }));
  return projection;
});

export const inspectFiniteMetadataProjection = (projection: PreparedFiniteMetadataProjection) => {
  const state = projections.get(projection);
  return state === undefined ? null : Object.freeze({ contracts: Object.freeze([...state.contracts.values()]), owners: state.owners });
};
/** The authentic issuer supplies the complete entry projection once. These
 * scalar expectations are inert data until the installed owner compares them. */
export const prepareFiniteMetadataEntryComparison = (projection: PreparedFiniteMetadataProjection):
  Result.Result<readonly FiniteMetadataComparisonExpected[], FiniteMetadataError> => {
  const state = projections.get(projection);
  if (state === undefined || state.contracts.size === 0) return Result.fail(failure("invalidProjection"));
  return Result.succeed(state.entryExpected);
};
/** The preparation owner charges the actual retained canonical bytes once. */
export function readFiniteMetadataProjectionPreparationPayload(projection: PreparedFiniteMetadataProjection) {
  const state = projections.get(projection);
  if (state === undefined) return Result.fail(failure("invalidProjection"));
  return Result.succeed(Object.freeze({ contracts: structuredClone([...state.contracts.entries()]), owners: structuredClone(state.owners),
    tables: structuredClone([...state.tables.entries()]), comparisons: {
      entry: state.entryExpected, writeClosures: [...state.writeClosures.entries()],
      encoded: state.ownedExpected.map(expected =>
        encodedExpectations.get(expected) ?? JSON.stringify(expected)),
    }, semanticBytes: [...state.semanticBytes.entries()].map(([identity, bytes]) =>
      Object.freeze({ identity, bytes: copyBytes(bytes) })) }));
}
/** Compose authenticated owner projections without lending a second issuer. */
const mergeAuthenticatedMetadataProjections = (inputs: readonly PreparedFiniteMetadataProjection[], includeTableRouting: boolean):
  Result.Result<PreparedFiniteMetadataProjection, FiniteMetadataError> => {
  const contracts = new Map<string, FiniteMetadataContract>();
  const semanticBytes = new Map<string, Uint8Array>();
  const entryByIdentity = new Map<string, FiniteMetadataComparisonExpected>();
  const writeClosures = new Map<CatalogTableId, FiniteMetadataComparisonExpected>();
  const owners = new Map<string, FiniteMetadataOwner>();
  const tables = new Map<CatalogTableId, ProjectionState["tables"] extends ReadonlyMap<CatalogTableId, infer Value> ? Value : never>();
  for (const input of inputs) {
    const state = projections.get(input);
    if (state === undefined) return Result.fail(failure("invalidProjection"));
    for (const [identity, contract] of state.contracts) {
      const prior = contracts.get(identity);
      if (prior !== undefined && prior.semanticSha256Hex !== contract.semanticSha256Hex)
        return Result.fail(failure("invalidProjection"));
      contracts.set(identity, contract);
      const bytes = state.semanticBytes.get(identity);
      if (bytes === undefined) return Result.fail(failure("invalidProjection"));
      semanticBytes.set(identity, bytes);
      const expected = state.entryByIdentity.get(identity);
      if (expected === undefined) return Result.fail(failure("invalidProjection"));
      entryByIdentity.set(identity, expected);
    }
    for (const owner of state.owners) owners.set(canonical([owner.namespace, owner.ownerKey]), owner);
    if (includeTableRouting) for (const [tableId, table] of state.tables) {
      const prior = tables.get(tableId);
      if (prior !== undefined && (prior.namespace !== table.namespace || prior.ownerKey !== table.ownerKey || prior.localName !== table.localName))
        return Result.fail(failure("invalidProjection"));
      tables.set(tableId, table);
      const expected = state.writeClosures.get(tableId);
      if (expected !== undefined) writeClosures.set(tableId, expected);
    }
  }
  if (contracts.size === 0) return Result.fail(failure("invalidProjection"));
  // SAFETY: the private registry authenticates every composed projection.
  const projection = Object.freeze({}) as PreparedFiniteMetadataProjection;
  projections.set(projection, { contracts, semanticBytes, owners: Object.freeze([...owners.values()]), tables,
    entryByIdentity, entryExpected: Object.freeze([...entryByIdentity.values()]), writeClosures, ownedExpected: Object.freeze([]) });
  return Result.succeed(projection);
};
export const mergeFiniteMetadataProjections = (inputs: readonly PreparedFiniteMetadataProjection[]) =>
  mergeAuthenticatedMetadataProjections(inputs, true);
/** Aggregate facts retain their exact owners; demand routing stays with each
 * authentic native or bound source projection. */
export const mergeFiniteMetadataContractProjections = (inputs: readonly PreparedFiniteMetadataProjection[]) =>
  mergeAuthenticatedMetadataProjections(inputs, false);
export const getFiniteMetadataProjectionSource = (projection: PreparedFiniteMetadataProjection, sourceKey: string): PreparedFiniteMetadataProjection | null => {
  const state = projections.get(projection);
  if (state === undefined) return null;
  const owners = state.owners.filter(owner => owner.ownerKey === sourceKey);
  if (owners.length !== 1) return null;
  // SAFETY: a subprojection preserves its original authenticated semantic issuer.
  const selected = Object.freeze({}) as PreparedFiniteMetadataProjection;
  const entryByIdentity = new Map([...state.entryByIdentity].filter(([, expected]) => expected.ownerKey === sourceKey));
  projections.set(selected, { owners: Object.freeze(owners),
    contracts: new Map([...state.contracts].filter(([, contract]) => contract.ownerKey === sourceKey)),
    semanticBytes: new Map([...state.semanticBytes].filter(([identity]) => state.contracts.get(identity)?.ownerKey === sourceKey)),
    tables: new Map([...state.tables].filter(([, table]) => table.ownerKey === sourceKey)),
    entryByIdentity, entryExpected: Object.freeze([...entryByIdentity.values()]), ownedExpected: Object.freeze([]),
    writeClosures: new Map([...state.writeClosures].filter(([, expected]) => expected.ownerKey === sourceKey)) });
  return selected;
};
export const finiteMetadataTableKey = (projection: PreparedFiniteMetadataProjection, tableId: CatalogTableId, kind: "table" | "writeClosure") => {
  const table = projections.get(projection)?.tables.get(tableId);
  return table === undefined ? null : Object.freeze({ namespace: table.namespace, ownerKey: table.ownerKey,
    contractKey: finiteMetadataContractKey(kind, table.localName) });
};

/** Transaction-local cache comparison consults the genuine private projection,
 * without lending its mutable byte arrays or copying them for comparison. */
export const matchesFiniteTableWriteClosureProjections = (left: PreparedFiniteMetadataProjection,
  right: PreparedFiniteMetadataProjection, tableId: CatalogTableId): boolean => {
  const leftKey = finiteMetadataTableKey(left, tableId, "writeClosure");
  const rightKey = finiteMetadataTableKey(right, tableId, "writeClosure");
  const leftBytes = leftKey === null ? undefined : projections.get(left)?.semanticBytes.get(logicalMetadataDependencyIdentity(leftKey));
  const rightBytes = rightKey === null ? undefined : projections.get(right)?.semanticBytes.get(logicalMetadataDependencyIdentity(rightKey));
  return leftBytes !== undefined && rightBytes !== undefined && bytesEqualFullScan(leftBytes, rightBytes);
};
/** Distinct demanded tables share an ordered actual full-byte comparison.
 * Success lends no bytes; the source owner may then lend its original located
 * capabilities. Digest-only rows require managed backfill, never request repair. */
export interface FiniteTableWriteClosureComparison {
  readonly pages: readonly (readonly FiniteMetadataComparisonExpected[])[];
  readonly invalidProjection: boolean;
}
export function prepareFiniteTableWriteClosureComparison(projection: PreparedFiniteMetadataProjection,
  tableIds: readonly CatalogTableId[],
): Result.Result<FiniteTableWriteClosureComparison, FiniteMetadataError> {
  const state = projections.get(projection);
  if (state === undefined) return Result.fail(failure("invalidProjection"));
  const selected: FiniteMetadataComparisonExpected[] = [];
  let invalidProjection = false;
  for (const tableId of new Set(tableIds)) {
    const expected = state.writeClosures.get(tableId);
    if (expected === undefined) { invalidProjection = true; break; }
    selected.push(expected);
  }
  // An invalid later selector cannot preempt an earlier actual SQL refusal.
  // Fully authentic input still performs one comparison per bounded batch.
  const pages: (readonly FiniteMetadataComparisonExpected[])[] = [];
  for (let offset = 0; offset < selected.length; offset += MAX_COMMIT_METADATA_READ_DEPENDENCIES)
    pages.push(Object.freeze(selected.slice(offset, offset + MAX_COMMIT_METADATA_READ_DEPENDENCIES)));
  return Result.succeed(Object.freeze({ pages: Object.freeze(pages), invalidProjection }));
}
const decodeComparisonPages = Schema.decodeUnknownResult(Schema.Array(Schema.Unknown));
export function acceptFiniteTableWriteClosureComparison(plan: FiniteTableWriteClosureComparison, input: unknown) {
  return Result.gen(function* () {
    const pages = yield* decodeComparisonPages(input).pipe(Result.mapError(cause => failure("invalidProjection", cause)));
    for (const [index, expected] of plan.pages.entries())
      yield* acceptFiniteMetadataComparisonVerdict(pages[index], expected, null);
    if (pages.length !== plan.pages.length || plan.invalidProjection) return yield* Result.fail(failure("invalidProjection"));
  });
}
export const requireFiniteTableWriteClosures = Effect.fn("FiniteMetadata.requireTableWriteClosures")(function* (
  tx: FlarexMetadataTransaction, scopeId: ScopeId, projection: PreparedFiniteMetadataProjection,
  tableIds: readonly CatalogTableId[],
) {
  const plan = yield* Effect.fromResult(prepareFiniteTableWriteClosureComparison(projection, tableIds));
  for (const page of plan.pages) yield* compareFiniteMetadata(tx, scopeId, null, page);
  if (plan.invalidProjection) return yield* Effect.fail(failure("invalidProjection"));
});
export const finiteMetadataAccessKey = (projection: PreparedFiniteMetadataProjection, tableId: CatalogTableId,
  family: string, leadingField: string): LogicalMetadataKey | null => {
  const table = projections.get(projection)?.tables.get(tableId);
  return table === undefined ? null : Object.freeze({ namespace: table.namespace, ownerKey: table.ownerKey,
    contractKey: finiteMetadataContractKey("accessFamily", table.localName, family, leadingField) });
};

/** Every consumption uses the entry watermark, including a first use after an
 * activation. Missing keys are genuine negative observations of that version. */
export const captureFiniteMetadataDependency = (projection: PreparedFiniteMetadataProjection,
  key: LogicalMetadataKey, capturedWatermark: MetadataSequence): Result.Result<LogicalMetadataReadDependency, FiniteMetadataError> => {
  const state = projections.get(projection);
  if (state === undefined) return Result.fail(failure("invalidProjection"));
  const selected = state.contracts.get(logicalMetadataDependencyIdentity(key));
  return decodeDependencyTypeResult({ kind: "metadata", ...key,
    capturedWatermark, observed: selected === undefined ? { kind: "missing" } :
      { kind: "present", semanticSha256Hex: selected.semanticSha256Hex } }).pipe(Result.mapError(cause => failure("invalidInput", cause)));
};

/** Compare a previously decoded consumption against its original immutable
 * issuer. This is an observation comparison, never an admission capability or
 * a substitute for the first-use decoder. */
export const matchesFiniteMetadataDependencyObservation = (projection: PreparedFiniteMetadataProjection,
  key: LogicalMetadataKey, capturedWatermark: MetadataSequence, dependency: LogicalMetadataReadDependency): boolean => {
  const state = projections.get(projection);
  if (state === undefined || dependency.capturedWatermark !== capturedWatermark ||
    dependency.namespace !== key.namespace || dependency.ownerKey !== key.ownerKey || dependency.contractKey !== key.contractKey)
    return false;
  const selected = state.contracts.get(logicalMetadataDependencyIdentity(key));
  return selected === undefined ? dependency.observed.kind === "missing" :
    dependency.observed.kind === "present" && dependency.observed.semanticSha256Hex === selected.semanticSha256Hex;
};

/** Called only by an effective activation writer after its authority-first
 * sequencer acquisition. All selected owners and tombstones commit together. */
export const applyFiniteMetadataActivationProjection = Effect.fn("FiniteMetadata.applyActivation")(function* (
  tx: FlarexMetadataTransaction, scopeId: ScopeId, projection: PreparedFiniteMetadataProjection,
  selectedOwners: readonly FiniteMetadataOwner[],
) {
  const state = projections.get(projection);
  if (state === undefined) return yield* Effect.fail(failure("invalidProjection"));
  const owners = yield* decodeOwnersEffect(selectedOwners)
    .pipe(Effect.mapError(cause => failure("invalidInput", cause)));
  if (new Set(owners.map(owner => canonical([owner.namespace, owner.ownerKey]))).size !== owners.length)
    return yield* Effect.fail(failure("invalidInput"));
  if (state.owners.some(owner => !owners.some(selected => selected.namespace === owner.namespace && selected.ownerKey === owner.ownerKey)))
    return yield* Effect.fail(failure("invalidInput"));
  const [clock] = yield* runDrizzleStatementEffect(tx.update(fxSystemScopeClocks).set({
    lastMetadataSequence: sql`${fxSystemScopeClocks.lastMetadataSequence} + 1`,
  }).where(eq(fxSystemScopeClocks.scopeId, scopeId)).returning({ sequence: fxSystemScopeClocks.lastMetadataSequence }),
  cause => failure("resourceFailure", cause));
  if (clock === undefined) return yield* Effect.fail(failure("projectionMissing"));
  const sequence = yield* decodeSequenceTypeEffect(clock.sequence)
    .pipe(Effect.mapError(cause => failure("invalidProjection", cause)));
  for (const owner of owners) {
    const existing = yield* runDrizzleStatementEffect(tx.select().from(fxSystemMetadataContractObservations).where(and(
      eq(fxSystemMetadataContractObservations.scopeId, scopeId), eq(fxSystemMetadataContractObservations.namespace, owner.namespace),
      eq(fxSystemMetadataContractObservations.ownerKey, owner.ownerKey))), cause => failure("resourceFailure", cause));
    const selected = [...state.contracts.values()].filter(contract => contract.namespace === owner.namespace && contract.ownerKey === owner.ownerKey);
    const next = new Map(selected.map(contract => [contract.contractKey, contract]));
    for (const row of existing) {
      const contract = next.get(row.contractKey);
      const semanticBytes = contract === undefined ? null : state.semanticBytes.get(logicalMetadataDependencyIdentity(contract));
      if (contract !== undefined && semanticBytes === undefined) return yield* Effect.fail(failure("invalidProjection"));
      if (contract !== undefined && row.present && row.semanticSha256Hex === contract.semanticSha256Hex &&
        row.semanticBytes !== null && semanticBytes !== null && semanticBytes !== undefined &&
        bytesEqualFullScan(row.semanticBytes, semanticBytes)) { next.delete(row.contractKey); continue; }
      if (contract === undefined && !row.present) continue;
      yield* runDrizzleStatementEffect(tx.update(fxSystemMetadataContractObservations).set({ present: contract !== undefined,
        semanticSha256Hex: contract?.semanticSha256Hex ?? null, semanticBytes: semanticBytes ?? null,
        lastChangedMetadataSequence: sequence }).where(and(
        eq(fxSystemMetadataContractObservations.scopeId, scopeId), eq(fxSystemMetadataContractObservations.namespace, owner.namespace),
        eq(fxSystemMetadataContractObservations.ownerKey, owner.ownerKey), eq(fxSystemMetadataContractObservations.contractKey, row.contractKey))),
      cause => failure("resourceFailure", cause));
      next.delete(row.contractKey);
    }
    for (const contract of next.values()) yield* runDrizzleStatementEffect(tx.insert(fxSystemMetadataContractObservations).values({
      scopeId, ...contract, semanticBytes: state.semanticBytes.get(logicalMetadataDependencyIdentity(contract)),
      present: true, lastChangedMetadataSequence: sequence }), cause => failure("resourceFailure", cause));
  }
  return sequence;
});

/** Explicit managed backfill after authority-first acquisition. Replaying a
 * complete current projection preserves its sequence; this never repairs a
 * request entry or assigns evidence to historical attempts. */
export const initializeCurrentFiniteMetadataProjection = Effect.fn("FiniteMetadata.initializeCurrentProjection")(function* (
  tx: FlarexMetadataTransaction, scopeId: ScopeId, projection: PreparedFiniteMetadataProjection,
  selectedOwners: readonly FiniteMetadataOwner[],
) {
  const state = projections.get(projection);
  if (state === undefined) return yield* Effect.fail(failure("invalidProjection"));
  const owners = yield* decodeOwnersEffect(selectedOwners)
    .pipe(Effect.mapError(cause => failure("invalidInput", cause)));
  const identities = new Set(owners.map(owner => canonical([owner.namespace, owner.ownerKey])));
  if (identities.size !== owners.length || state.owners.some(owner => !identities.has(canonical([owner.namespace, owner.ownerKey]))))
    return yield* Effect.fail(failure("invalidInput"));
  const [clock] = yield* runDrizzleStatementEffect(tx.select({ sequence: fxSystemScopeClocks.lastMetadataSequence })
    .from(fxSystemScopeClocks).where(eq(fxSystemScopeClocks.scopeId, scopeId)).for("update"),
  cause => failure("resourceFailure", cause));
  if (clock === undefined) return yield* Effect.fail(failure("projectionMissing"));
  const sequence = yield* decodeSequenceTypeEffect(clock.sequence)
    .pipe(Effect.mapError(cause => failure("invalidProjection", cause)));
  let complete = true;
  for (const owner of owners) {
    const rows = yield* runDrizzleStatementEffect(tx.select().from(fxSystemMetadataContractObservations).where(and(
      eq(fxSystemMetadataContractObservations.scopeId, scopeId), eq(fxSystemMetadataContractObservations.namespace, owner.namespace),
      eq(fxSystemMetadataContractObservations.ownerKey, owner.ownerKey))), cause => failure("resourceFailure", cause));
    const expected = new Map([...state.contracts.values()].filter(contract =>
      contract.namespace === owner.namespace && contract.ownerKey === owner.ownerKey).map(contract => [contract.contractKey, contract]));
    for (const row of rows) {
      if (row.lastChangedMetadataSequence > sequence) return yield* Effect.fail(failure("projectionMissing"));
      const contract = expected.get(row.contractKey);
      const bytes = contract === undefined ? undefined : state.semanticBytes.get(logicalMetadataDependencyIdentity(contract));
      if (contract === undefined ? row.present : !row.present || row.semanticSha256Hex !== contract.semanticSha256Hex ||
        row.semanticBytes === null || bytes === undefined || !bytesEqualFullScan(row.semanticBytes, bytes)) complete = false;
      expected.delete(row.contractKey);
    }
    if (expected.size > 0) complete = false;
  }
  if (complete) return sequence;
  return yield* applyFiniteMetadataActivationProjection(tx, scopeId, projection, owners);
});

/** The persisted reservation watermark is supplied by the journal authority;
 * dependency-carried numbers cannot establish an attempt's entry observation. */
export function prepareConsumedFiniteMetadataComparison(capturedWatermark: MetadataSequence,
  input: readonly LogicalMetadataReadDependency[],
) { return Result.gen(function* () {
  const dependencies = yield* decodeDependencyArrayTypeResult(input)
    .pipe(Result.mapError(cause => failure("invalidInput", cause)));
  if (dependencies.length > MAX_COMMIT_METADATA_READ_DEPENDENCIES) return yield* Result.fail(failure("limitExceeded"));
  const seen = new Map<string, LogicalMetadataReadDependency>();
  for (const dependency of dependencies) {
    if (dependency.capturedWatermark !== capturedWatermark) return yield* Result.fail(failure("invalidInput"));
    const identity = logicalMetadataDependencyIdentity(dependency);
    const prior = seen.get(identity);
    if (prior !== undefined) {
      if (prior.observed.kind !== dependency.observed.kind || prior.observed.kind === "present" && dependency.observed.kind === "present" &&
        prior.observed.semanticSha256Hex !== dependency.observed.semanticSha256Hex) return yield* Result.fail(failure("invalidInput"));
      continue;
    }
    seen.set(identity, dependency);
  }
  return [...seen.values()].map(dependency => ({
    namespace: dependency.namespace, ownerKey: dependency.ownerKey, contractKey: dependency.contractKey,
    present: dependency.observed.kind === "present",
    semanticSha256Hex: dependency.observed.kind === "present" ? dependency.observed.semanticSha256Hex : null,
  }));
}); }
export const validateConsumedMetadataDependencies = Effect.fn("FiniteMetadata.validateConsumed")(function* (
  tx: FlarexMetadataTransaction, scopeId: ScopeId, capturedWatermark: MetadataSequence,
  input: readonly LogicalMetadataReadDependency[],
) {
  const expected = yield* Effect.fromResult(prepareConsumedFiniteMetadataComparison(capturedWatermark, input));
  if (expected.length > 0) yield* compareFiniteMetadata(tx, scopeId, capturedWatermark, expected);
});

/** Entry authenticates that every retained selector matches current projection
 * facts under its sequencer lock; missing backfill is a construction refusal. */
export const requireCurrentFiniteMetadataProjection = Effect.fn("FiniteMetadata.requireCurrentProjection")(function* (
  tx: FlarexMetadataTransaction, scopeId: ScopeId, capturedWatermark: MetadataSequence,
  projection: PreparedFiniteMetadataProjection,
) {
  const expected = yield* Effect.fromResult(prepareFiniteMetadataEntryComparison(projection));
  for (let offset = 0; offset < expected.length; offset += MAX_COMMIT_METADATA_READ_DEPENDENCIES)
    yield* compareFiniteMetadata(tx, scopeId, capturedWatermark,
      expected.slice(offset, offset + MAX_COMMIT_METADATA_READ_DEPENDENCIES))
      .pipe(Effect.mapError(entryComparisonFailure));
});
