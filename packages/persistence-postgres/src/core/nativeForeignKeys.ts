/** Native relational keys use ordinary Source index state. Native keys are
 * business values; they never replace the document envelope's identity. */
import { Effect, Result, Schema } from "effect";
import { bytesEqual, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import type { DocumentObject } from "flarex-protocol/document-value";
import type { JsonObject } from "flarex-protocol/json";
import { compileIndexRange } from "flarex-protocol/index-range";
import { CoreNativeForeignKeyError, CoreTransactionError, type CoreError, type CoreIndexDefinition,
  type CoreTableDefinition } from "./api";
import { CorePersistenceError, type CoreInterval, type CorePersistenceSnapshot, type CoreWriteBatch } from "./contracts";
import { addIndexMetadataDependency, addTableWriteDependencies } from "./dependencies";
import { captureCoreDocument } from "./document";
import { isCoreIndexEnabled } from "./indexState";
import { sameCoreNativeIdentity, type CoreNativeForeignKey } from "./nativePolicy";
import type { CoreRegistry } from "./registry";
import type { CoreFinalizedState } from "./transaction";
import { CoreReadSetBuilder, type CoreReadSet } from "./writeLog";
import { captureCoreNativeKeyProbe, foldCoreNativeKeyProbe, type CoreNativeKeyProbe, type CoreNativeKeyState } from "./nativeKeyProbe";
import { CoreNativeIntegrityBudget } from "./nativeIntegrityBudget";
import { retainReferenceFailure, type ReferenceFailureEvidence } from "../values/referenceFailure";

const Scalar = Schema.Union([Schema.String, Schema.Finite, Schema.Boolean, Schema.Null]);
const isScalar = Schema.is(Scalar);
export type CoreNativeKeyValue = typeof Scalar.Type;

/** SQL MATCH SIMPLE: a null component makes the entire FK non-demanding. */
export function coreNativeKeyTuple(document: DocumentObject, fields: readonly string[], nullable = false):
  Result.Result<readonly CoreNativeKeyValue[] | null, CoreError> {
  const tuple: CoreNativeKeyValue[] = [];
  for (const field of fields) {
    const value = document[field];
    if (!isScalar(value)) return Result.fail(new CoreTransactionError({ reason: "documentValidation" }));
    tuple.push(value);
  }
  return Result.succeed(nullable && tuple.some(value => value === null) ? null : tuple);
}

export function sameCoreNativeKeyTuple(left: readonly CoreNativeKeyValue[], right: readonly CoreNativeKeyValue[]): boolean {
  return left.length === right.length && left.every((value, position) => Object.is(value, right[position]));
}

export function coreNativeKeyWhere(fields: readonly string[], tuple: readonly CoreNativeKeyValue[]): Result.Result<JsonObject, CoreError> {
  if (fields.length !== tuple.length) return Result.fail(new CoreTransactionError({ reason: "invalidValue" }));
  const where: Record<string, CoreNativeKeyValue> = {};
  for (const [position, field] of fields.entries()) {
    const value = tuple[position];
    if (value === undefined) return Result.fail(new CoreTransactionError({ reason: "invalidValue" }));
    where[field] = value;
  }
  return Result.succeed(where);
}

export interface CoreNativeForeignKeySelection {
  readonly foreignKey: CoreNativeForeignKey;
  readonly source: CoreTableDefinition;
  readonly target: CoreTableDefinition;
  readonly sourceIndex: CoreIndexDefinition;
  readonly targetIndex: CoreIndexDefinition;
}

export function coreNativeForeignKeyError(foreignKey: CoreNativeForeignKey, reason: CoreNativeForeignKeyError["reason"],
  evidence?: Extract<ReferenceFailureEvidence, { readonly storage: "core" }>) {
  const failure = new CoreNativeForeignKeyError({ reason, descriptor: foreignKey.descriptor, sourceTable: foreignKey.sourceTable,
    targetTable: foreignKey.targetTable, sourceFields: foreignKey.sourceFields, targetFields: foreignKey.targetFields });
  if (evidence !== undefined) retainReferenceFailure(failure, evidence);
  return failure;
}

export function selectCoreNativeForeignKey(registry: CoreRegistry, owner: CoreTableDefinition, foreignKey: CoreNativeForeignKey):
  Result.Result<CoreNativeForeignKeySelection, CoreError> {
  return Result.gen(function* () {
    const source = registry.table(foreignKey.sourceTable, owner.namespace)?.definition;
    const target = registry.table(foreignKey.targetTable, owner.namespace)?.definition;
    const policy = owner.nativePolicy;
    if (policy?.state !== "active" || source?.state !== "active" || target?.state !== "active"
      || source.nativePolicy?.state !== "active" || target.nativePolicy?.state !== "active"
      || !sameCoreNativeIdentity(policy.identity, source.nativePolicy.identity)
      || !sameCoreNativeIdentity(policy.identity, target.nativePolicy.identity)
      || source.nativePolicy.schemaId !== policy.schemaId || target.nativePolicy.schemaId !== policy.schemaId
      || !source.nativePolicy.foreignKeys?.some(value => value.descriptor === foreignKey.descriptor)
      || !target.nativePolicy.foreignKeys?.some(value => value.descriptor === foreignKey.descriptor))
      return yield* Result.fail(new CoreTransactionError({ reason: "authorityRevoked" }));
    const select = (table: CoreTableDefinition, name: string, fields: readonly string[]) => {
      const index = table.indexes.find(value => value.name === name);
      const generation = index === undefined ? undefined : registry.indexes.records.get(encodeBytesToLowercaseHex(index.ref.id));
      return index !== undefined && generation !== undefined && isCoreIndexEnabled(generation)
        && bytesEqual(generation.tableId, table.tabletId) && generation.ref.persistenceIndexId === index.ref.persistenceIndexId
        && fields.every((field, position) => index.fields[position] === field) ? index : undefined;
    };
    const sourceIndex = select(source, foreignKey.sourceIndexName, foreignKey.sourceFields);
    const targetIndex = select(target, foreignKey.targetIndexName, foreignKey.targetFields);
    if (sourceIndex === undefined || targetIndex === undefined)
      return yield* Result.fail(new CoreTransactionError({ reason: "indexUnavailable" }));
    return { foreignKey, source, target, sourceIndex, targetIndex };
  });
}

export function coreNativeKeyInterval(index: CoreIndexDefinition, fields: readonly string[], tuple: readonly CoreNativeKeyValue[]):
  Result.Result<CoreInterval, CoreError> {
  return Result.mapError(compileIndexRange(fields.map((field, position) => ({ op: "eq" as const, field, value: tuple[position] })), index.fields),
    cause => new CoreTransactionError({ reason: "invalidValue", cause }));
}

type Probe = CoreNativeKeyProbe;
interface Demand { readonly selection: CoreNativeForeignKeySelection; readonly target: Probe }
interface Release { readonly selection: CoreNativeForeignKeySelection; readonly target: Probe; readonly incoming: Probe; readonly deleting: boolean }
export interface CorePreparedNativeForeignKeys {
  readonly reads: CoreReadSet;
  readonly demands: readonly Demand[];
  readonly releases: readonly Release[];
  readonly maxIdentities: number;
  readonly identities: readonly string[];
  readonly sourceCaptures: readonly Readonly<{ tablets: readonly string[]; maxIdentities: number; identities: readonly string[] }>[];
}

/** Re-prepare only pure integrity facts against the current published suffix.
 * A final acceptance never widens a previously sealed deletion graph. */
export const prepareCoreNativeForeignKeys = Effect.fn("CoreNativeForeignKeys.prepare")(function* (
  snapshot: CorePersistenceSnapshot, registry: CoreRegistry, transaction: CoreFinalizedState, budget?: CoreNativeIntegrityBudget,
) {
  const reads = new CoreReadSetBuilder();
  const queryBudget = budget ?? new CoreNativeIntegrityBudget(transaction);
  const accounting = queryBudget.accounting;
  const maxIdentities = transaction.nativeObservations?.limits.maxIdentities ?? 0;
  const identities = new Set(transaction.nativeObservations?.identities ?? []);
  const sources = transaction.nativeObservations?.sourceCaptures?.map(source => ({ tablets: source.tablets,
    maxIdentities: source.limits.maxIdentities, identities: new Set(source.identities) })) ?? [];
  const demands: Demand[] = [], releases: Release[] = [];
  const probes = new Map<string, Probe>();
  const reserve = (table: CoreTableDefinition, id: string) => {
    if (budget !== undefined) return budget.reserve(table, id);
    identities.add(id);
    const source = sources.find(value => value.tablets.includes(encodeBytesToLowercaseHex(table.tabletId)));
    if (sources.length > 0 && source === undefined) return Result.fail(new CoreTransactionError({ reason: "authorityRevoked" }));
    source?.identities.add(id);
    return identities.size > maxIdentities || source !== undefined && source.identities.size > source.maxIdentities
      ? Result.fail(new CoreTransactionError({ reason: "capacity", cause: "Native foreign key identity limit" })) : Result.succeed(undefined);
  };
  const probe = Effect.fn("CoreNativeForeignKeys.probe")(function* (
    table: CoreTableDefinition, index: CoreIndexDefinition, fields: readonly string[], tuple: readonly CoreNativeKeyValue[],
  ) {
    const interval = yield* Effect.fromResult(coreNativeKeyInterval(index, fields, tuple));
    const key = `${encodeBytesToLowercaseHex(index.ref.id)}:${JSON.stringify(tuple)}`;
    const prior = probes.get(key);
    if (prior !== undefined) return prior;
    yield* Effect.fromResult(addTableWriteDependencies(reads, registry, table, transaction.nativeObservations?.selectiveMetadata === true));
    yield* Effect.fromResult(addIndexMetadataDependency(reads, registry, index));
    const value = yield* captureCoreNativeKeyProbe({ snapshot, table, index, interval, maxIdentities,
      chargeQuery: remaining => queryBudget.query(index, remaining),
      chargeDocument: (id, document) => Result.gen(function* () {
        yield* reserve(table, id);
        const captured = yield* Result.mapError(captureCoreDocument(document, false), cause => new CorePersistenceError({ reason: "corruptData", cause }));
        yield* accounting.read(false, captured.semanticSizeBytes);
        const actual = yield* coreNativeKeyTuple(document, fields);
        if (actual === null || !sameCoreNativeKeyTuple(actual, tuple)) return yield* Result.fail(new CorePersistenceError({ reason: "corruptData" }));
      }),
    });
    reads.add(index.ref.id, interval);
    probes.set(key, value); return value;
  });
  if (transaction.nativeObservations !== undefined) for (const change of transaction.changes) {
    for (const foreignKey of change.table.nativePolicy?.foreignKeys ?? []) {
      const owner = registry.tableByTablet(change.table.tabletId)?.definition;
      if (owner === undefined) return yield* new CoreTransactionError({ reason: "authorityRevoked" });
      const selection = yield* Effect.fromResult(selectCoreNativeForeignKey(registry, owner, foreignKey));
      if (bytesEqual(change.table.tabletId, selection.source.tabletId) && change.finalDocument !== null) {
        const tuple = yield* Effect.fromResult(coreNativeKeyTuple(change.finalDocument, foreignKey.sourceFields, true));
        if (tuple !== null) demands.push({ selection,
          target: yield* probe(selection.target, selection.targetIndex, foreignKey.targetFields, tuple) });
      }
      if (bytesEqual(change.table.tabletId, selection.target.tabletId) && change.originalDocument !== null) {
        const original = yield* Effect.fromResult(coreNativeKeyTuple(change.originalDocument, foreignKey.targetFields));
        if (original === null) return yield* new CorePersistenceError({ reason: "corruptData" });
        const final = change.finalDocument === null ? null : yield* Effect.fromResult(coreNativeKeyTuple(change.finalDocument, foreignKey.targetFields));
        if (final !== null && sameCoreNativeKeyTuple(original, final)) continue;
        releases.push({ selection, deleting: change.finalDocument === null,
          target: yield* probe(selection.target, selection.targetIndex, foreignKey.targetFields, original),
          incoming: yield* probe(selection.source, selection.sourceIndex, foreignKey.sourceFields, original) });
      }
    }
  }
  return { reads: reads.snapshot(), demands, releases, maxIdentities, identities: [...identities],
    sourceCaptures: sources.map(source => ({ ...source, identities: [...source.identities] })) } satisfies CorePreparedNativeForeignKeys;
});

/** Fold the complete ordered accepted prefix and candidate. Provenance tracks
 * surviving keys and removals on which this candidate's integrity depends. */
export function validateCoreNativeForeignKeys(prepared: CorePreparedNativeForeignKeys, accepted: Iterable<CoreWriteBatch>,
  candidate: CoreWriteBatch, budget?: CoreNativeIntegrityBudget): Result.Result<ReadonlySet<CoreWriteBatch>, CoreError> {
  return Result.gen(function* () {
    const batches = [...accepted], predecessors = new Set<CoreWriteBatch>();
    const identities = new Set(prepared.identities);
    const sources = prepared.sourceCaptures.map(source => ({ ...source, identities: new Set(source.identities) }));
    const states = new Map<Probe, CoreNativeKeyState>();
    const reserve = (table: CoreTableDefinition, id: string) => {
      if (budget !== undefined) return budget.reserve(table, id);
      identities.add(id);
      const source = sources.find(value => value.tablets.includes(encodeBytesToLowercaseHex(table.tabletId)));
      source?.identities.add(id);
      return identities.size > prepared.maxIdentities || source !== undefined && source.identities.size > source.maxIdentities
        ? Result.fail(new CoreTransactionError({ reason: "capacity", cause: "Native accepted foreign key identity limit" })) : Result.succeed(undefined);
    };
    const fold = (probe: Probe) => Result.gen(function* () {
      const prior = states.get(probe); if (prior !== undefined) return prior;
      const state = yield* foldCoreNativeKeyProbe(probe, batches, candidate, reserve);
      states.set(probe, state); return state;
    });
    for (const demand of prepared.demands) {
      const state = yield* fold(demand.target);
      if (state.entries.size === 0) return yield* Result.fail(coreNativeForeignKeyError(demand.selection.foreignKey, "targetMissing"));
      for (const predecessor of state.origins.values()) predecessors.add(predecessor);
    }
    for (const release of prepared.releases) {
      const target = yield* fold(release.target);
      if (target.entries.size > 0) {
        for (const predecessor of target.origins.values()) predecessors.add(predecessor);
        continue;
      }
      const incoming = yield* fold(release.incoming);
      if (incoming.entries.size > 0) return yield* Result.fail(coreNativeForeignKeyError(release.selection.foreignKey,
        release.deleting ? "deleteRestricted" : "updateRestricted"));
      for (const predecessor of incoming.removals) predecessors.add(predecessor);
    }
    return predecessors;
  });
}
