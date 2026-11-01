/** Cross-source protected references have assignment, retention and traversal
 * policy distinct from module-local SQL foreign keys. */
import { Effect, Result } from "effect";
import { bytesEqual, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import type { DocumentObject } from "flarex-protocol/document-value";
import type { LogicalSchemaEndpointLiveness } from "flarex-protocol/internal/logical-schema-candidate";
import { CoreNativeReferenceError, CoreTransactionError, type CoreError, type CoreTableDefinition } from "./api";
import { CorePersistenceError, type CorePersistenceSnapshot, type CoreWriteBatch } from "./contracts";
import { CORE_TRANSACTION_REFERENCE_LIMITS } from "./accounting";
import { addIndexMetadataDependency, addTableSemanticDependency, addTableWriteDependencies } from "./dependencies";
import { captureCoreDocument } from "./document";
import { isCoreIndexEnabled } from "./indexState";
import { coreNativeKeyInterval } from "./nativeForeignKeys";
import { captureCoreNativeKeyProbe, foldCoreNativeKeyProbe, type CoreNativeKeyProbe } from "./nativeKeyProbe";
import type { CoreNativeProtectedReference } from "./nativePolicy";
import { isCoreSystemTable } from "./nativeTableAccess";
import { coreNamespaceKey } from "./namespace";
import type { CoreRegistry } from "./registry";
import type { CoreFinalizedState } from "./transaction";
import { CoreReadSetBuilder, type CoreReadSet } from "./writeLog";
import { CoreNativeIntegrityBudget } from "./nativeIntegrityBudget";

const live = (document: DocumentObject | null, liveness: LogicalSchemaEndpointLiveness) => document !== null
  && (liveness.kind === "current" || document[liveness.field] === null);
const current = { kind: "current" } as const;
interface Selection { readonly reference: CoreNativeProtectedReference; readonly source: CoreTableDefinition; readonly target: CoreTableDefinition }
interface Demand { readonly selection: Selection; readonly sourceId: string; readonly targetId: string; readonly target: CoreNativeKeyProbe; readonly retained: boolean }
interface Release { readonly selection: Selection; readonly targetId: string; readonly target: CoreNativeKeyProbe; readonly incoming: CoreNativeKeyProbe }
export interface CorePreparedNativeProtectedReferences {
  readonly reads: CoreReadSet;
  readonly grantReads?: CoreReadSet;
  readonly demands: readonly Demand[];
  readonly releases: readonly Release[];
  readonly maxIdentities: number;
  readonly identities: readonly string[];
  readonly sourceCaptures: readonly Readonly<{ tablets: readonly string[]; maxIdentities: number; identities: readonly string[] }>[];
}
function refusal(selection: Selection, sourceId: string, targetId: string, reason: CoreNativeReferenceError["reason"]) {
  return new CoreNativeReferenceError({ reason, forwardName: selection.reference.reference.name,
    sourceTable: selection.source.name, targetTable: selection.target.name, sourceId, targetId });
}

export const prepareCoreNativeProtectedReferences = Effect.fn("CoreNativeProtectedReferences.prepare")(function* (
  snapshot: CorePersistenceSnapshot, registry: CoreRegistry, transaction: CoreFinalizedState, budget?: CoreNativeIntegrityBudget,
) {
  const reads = new CoreReadSetBuilder(), grantReads = new CoreReadSetBuilder();
  const limits = transaction.limits ?? CORE_TRANSACTION_REFERENCE_LIMITS;
  const queryBudget = budget ?? new CoreNativeIntegrityBudget(transaction);
  const accounting = queryBudget.accounting;
  const maxIdentities = transaction.nativeObservations?.limits.maxIdentities ?? limits.documentsRead;
  const identities = new Set(transaction.nativeObservations?.identities ?? []);
  const sources = transaction.nativeObservations?.sourceCaptures?.map(source => ({ tablets: source.tablets,
    maxIdentities: source.limits.maxIdentities, identities: new Set(source.identities) })) ?? [];
  const demands: Demand[] = [], releases: Release[] = [];
  const selections = new Map<string, Selection>();
  for (const { definition: owner } of registry.tables.values()) for (const reference of owner.nativePolicy?.protectedReferences ?? []) {
    const key = `${coreNamespaceKey(owner.namespace)}:${reference.reference.name}`;
    if (selections.has(key)) continue;
    const source = registry.table(reference.sourceTable, owner.namespace)?.definition;
    const target = registry.table(reference.targetTable, owner.namespace)?.definition;
    if (source?.state !== "active" || target?.state !== "active" || target.nativePolicy?.state !== "active"
      || target.nativePolicy.identity.sourceKey !== reference.targetIdentity.sourceKey
      || target.nativePolicy.identity.sourceSha256 !== reference.targetIdentity.sourceSha256
      || !target.nativePolicy.protectedReferences?.some(value => value.reference.name === reference.reference.name)
      || source.nativePolicy !== undefined && (source.nativePolicy.state !== "active"
        || source.nativePolicy.identity.sourceKey !== reference.sourceIdentity.sourceKey
        || source.nativePolicy.identity.sourceSha256 !== reference.sourceIdentity.sourceSha256))
      return yield* new CoreTransactionError({ reason: "authorityRevoked" });
    selections.set(key, { reference, source, target });
  }
  const probes = new Map<string, CoreNativeKeyProbe>();
  const probe = Effect.fn("CoreNativeProtectedReferences.probe")(function* (table: CoreTableDefinition, indexName: string, field: string, value: string) {
    const index = table.indexes.find(candidate => candidate.name === indexName);
    const generation = index === undefined ? undefined : registry.indexes.records.get(encodeBytesToLowercaseHex(index.ref.id));
    if (index === undefined || index.fields[0] !== field || generation === undefined || !isCoreIndexEnabled(generation)
      || !bytesEqual(generation.tableId, table.tabletId) || generation.ref.persistenceIndexId !== index.ref.persistenceIndexId)
      return yield* new CoreTransactionError({ reason: "indexUnavailable" });
    const interval = yield* Effect.fromResult(coreNativeKeyInterval(index, [field], [value]));
    const key = `${encodeBytesToLowercaseHex(index.ref.id)}:${JSON.stringify(value)}`;
    const prior = probes.get(key); if (prior !== undefined) return prior;
    yield* Effect.fromResult(addTableWriteDependencies(reads, registry, table, transaction.nativeObservations?.selectiveMetadata === true));
    yield* Effect.fromResult(addIndexMetadataDependency(reads, registry, index));
    const result = yield* captureCoreNativeKeyProbe({ snapshot, table, index, interval, maxIdentities,
      chargeQuery: remaining => queryBudget.query(index, remaining), chargeDocument: (id, document) => Result.gen(function* () {
        if (budget !== undefined) yield* budget.reserve(table, id);
        identities.add(id);
        const source = sources.find(candidate => candidate.tablets.includes(encodeBytesToLowercaseHex(table.tabletId)));
        source?.identities.add(id);
        if (identities.size > maxIdentities || source !== undefined && source.identities.size > source.maxIdentities)
          return yield* Result.fail(new CoreTransactionError({ reason: "capacity", cause: "Protected reference identity limit" }));
        const captured = yield* Result.mapError(captureCoreDocument(document, isCoreSystemTable(table)), cause => new CorePersistenceError({ reason: "corruptData", cause }));
        yield* accounting.read(isCoreSystemTable(table), captured.semanticSizeBytes);
        if (document[field] !== value) return yield* Result.fail(new CorePersistenceError({ reason: "corruptData" }));
      }),
    });
    reads.add(index.ref.id, interval); probes.set(key, result); return result;
  });
  for (const selection of selections.values()) {
    const reference = selection.reference, declaration = reference.reference;
    for (const change of transaction.changes) {
      if (bytesEqual(change.table.tabletId, selection.source.tabletId) && live(change.finalDocument, declaration.liveness.source)) {
        const document = change.finalDocument;
        if (document === null) continue;
        const targetId = document[reference.field];
        if (targetId === null || targetId === undefined) continue;
        if (typeof targetId !== "string" || typeof document._id !== "string")
          return yield* new CoreTransactionError({ reason: "documentValidation" });
        const assigned = change.protectedReferenceAssignments?.some(value => value.referenceName === declaration.name && value.targetId === targetId) === true;
        const unchanged = !assigned && live(change.originalDocument, declaration.liveness.source) && change.originalDocument?.[reference.field] === targetId;
        if (!unchanged && selection.target.nativePolicy?.bindingSelected === false)
          return yield* new CoreTransactionError({ reason: "authorityRevoked", cause: "Protected reference target binding is withdrawn" });
        if (!unchanged) yield* Effect.fromResult(addTableSemanticDependency(grantReads, registry, selection.target));
        demands.push({ selection, sourceId: document._id, targetId,
          retained: declaration.onTargetSoftDelete === "retain" && unchanged,
          target: yield* probe(selection.target, reference.targetIndexName, reference.targetField, targetId) });
      }
      const deletionLiveness = declaration.onTargetSoftDelete === "retain" ? current : declaration.liveness.target;
      if (bytesEqual(change.table.tabletId, selection.target.tabletId) && live(change.originalDocument, deletionLiveness)) {
        const targetId = change.originalDocument?.[reference.targetField];
        if (typeof targetId !== "string") return yield* new CorePersistenceError({ reason: "corruptData" });
        if (live(change.finalDocument, deletionLiveness) && change.finalDocument?.[reference.targetField] === targetId) continue;
        releases.push({ selection, targetId, target: yield* probe(selection.target, reference.targetIndexName, reference.targetField, targetId),
          incoming: yield* probe(selection.source, reference.indexName, reference.field, targetId) });
      }
    }
  }
  return { reads: reads.snapshot(), grantReads: grantReads.snapshot(), demands, releases, maxIdentities, identities: [...identities],
    sourceCaptures: sources.map(source => ({ ...source, identities: [...source.identities] })) } satisfies CorePreparedNativeProtectedReferences;
});

export function validateCoreNativeProtectedReferences(prepared: CorePreparedNativeProtectedReferences, accepted: Iterable<CoreWriteBatch>,
  candidate: CoreWriteBatch, budget?: CoreNativeIntegrityBudget): Result.Result<ReadonlySet<CoreWriteBatch>, CoreError> {
  return Result.gen(function* () {
    const batches = [...accepted], predecessors = new Set<CoreWriteBatch>(), identities = new Set(prepared.identities);
    const sources = prepared.sourceCaptures.map(source => ({ ...source, identities: new Set(source.identities) }));
    const reserve = (table: CoreTableDefinition, id: string) => {
      if (budget !== undefined) return budget.reserve(table, id);
      identities.add(id);
      const source = sources.find(value => value.tablets.includes(encodeBytesToLowercaseHex(table.tabletId)));
      source?.identities.add(id);
      return identities.size > prepared.maxIdentities || source !== undefined && source.identities.size > source.maxIdentities
        ? Result.fail(new CoreTransactionError({ reason: "capacity", cause: "Protected accepted reference identity limit" })) : Result.succeed(undefined);
    };
    for (const demand of prepared.demands) {
      const liveness = demand.retained ? current : demand.selection.reference.reference.liveness.target;
      const state = yield* foldCoreNativeKeyProbe(demand.target, batches, candidate, reserve, document => live(document, liveness));
      if (state.entries.size === 0) return yield* Result.fail(refusal(demand.selection, demand.sourceId, demand.targetId, "relationTargetMissing"));
      for (const batch of state.origins.values()) predecessors.add(batch);
    }
    for (const release of prepared.releases) {
      const declaration = release.selection.reference.reference;
      const deletionLiveness = declaration.onTargetSoftDelete === "retain" ? current : declaration.liveness.target;
      const target = yield* foldCoreNativeKeyProbe(release.target, batches, candidate, reserve, document => live(document, deletionLiveness));
      if (target.entries.size > 0) {
        for (const batch of target.origins.values()) predecessors.add(batch);
        continue;
      }
      const incoming = yield* foldCoreNativeKeyProbe(release.incoming, batches, candidate, reserve, document => live(document, declaration.liveness.source));
      const sourceId = incoming.entries.values().next().value;
      if (sourceId !== undefined) return yield* Result.fail(refusal(release.selection, sourceId, release.targetId, "relationDeleteRestricted"));
      for (const batch of incoming.removals) predecessors.add(batch);
    }
    return predecessors;
  });
}
