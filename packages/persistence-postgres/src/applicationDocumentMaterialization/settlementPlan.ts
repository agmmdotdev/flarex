import { Effect, Exit, Result } from "effect";
import { ExactDecimalError } from "flarex-protocol/internal/exact-decimal";
import { appDocumentIdV1FromRowIdentity, appRowIdHexV1ToBytes, type AppDocumentIdV1 } from "flarex-protocol/app-document-id";
import { orderedIndexRowIdHexV1FromBytesResult, encodeAppOrderedIndexKeyV1, orderedIndexCreationTimeV1,
  type OrderedIndexKeyHexV1, type OrderedIndexRowIdHexV1 } from "flarex-protocol/ordered-index";
import type { AppCreationTimeV1 } from "flarex-protocol/app-document";
import { lowerAppDeveloperIndexKeyV1 } from "../appDeveloperIndexCommitV1";
import { lowerCanonicalAppUniqueConstraintV1Result } from "../appUniqueConstraintCommitV1";
import { hasPreparedApplicationRelationCommitAuthority, prepareApplicationRelationCommitResult,
  ApplicationRelationCommitCorruptionError, type ApplicationRelationRowTransition } from "../applicationRelationCommit";
import { corruption, PointCommitDeveloperIndexMaintenanceUnavailableV1Error,
  PointCommitUniqueConstraintMaintenanceUnavailableV1Error, type PointCommitCorruptionV1Error } from "../pointCommitErrors";
import type { LiveAppRowRevisionV1 } from "../appRows";
import type { LocatedAppIndexDefinitionV1 } from "../appIndexDefinitions";
import type { LocatedAppUniqueConstraintDefinitionV1 } from "../appUniqueConstraintDefinitions";
import type { CanonicalFlarexValueV1 } from "flarex-protocol/value";
import type { ApplicationDocumentMaterializationCommand, LoadedPointCommitHeadV1,
  LocatedPreparedPointCommitApplicationRelations, PointCommitDeveloperIndexRowPlanV1,
  PointCommitUniqueKeyPlanV1 } from "./model";

/** Canonical obligations have no transaction, build verdict or allocated sequence. */
export type PreparedDeveloperIndexKeyPair = Omit<PointCommitDeveloperIndexRowPlanV1, "build">;
export interface ApplicationDocumentOriginals {
  readonly headsByDocumentId: ReadonlyMap<AppDocumentIdV1, LoadedPointCommitHeadV1>;
  readonly documents: ReadonlyMap<AppDocumentIdV1, CanonicalFlarexValueV1>;
}
export interface PreparedIntrinsicIndexKey {
  readonly definition: LocatedAppIndexDefinitionV1; readonly rowId: OrderedIndexRowIdHexV1;
  readonly creationTime: AppCreationTimeV1; readonly encodedKey: OrderedIndexKeyHexV1;
}

export function prepareOriginalDocumentsResult(command: ApplicationDocumentMaterializationCommand,
  rows: readonly LiveAppRowRevisionV1[]) {
  return Result.gen(function* () {
    const originals = new Map<AppDocumentIdV1, LiveAppRowRevisionV1>();
    const intents = new Map(command.rowIntents.map(intent => [intent.documentId, intent]));
    for (const row of rows) {
      const id = appDocumentIdV1FromRowIdentity(row);
      const intent = intents.get(id);
      if (row.scopeId !== command.authorityPins.scopeId || row.commitSeq > command.authorityPins.snapshotToken.commitSeq ||
        (intent !== undefined && (intent.dependency.observed.kind !== "present" || intent.dependency.observed.revisionCommitSeq !== row.commitSeq)) || originals.has(id))
        return yield* Result.fail(corruption("priorDocumentInvalid"));
      originals.set(id, row);
    }
    const headsByDocumentId = new Map<AppDocumentIdV1, LoadedPointCommitHeadV1>();
    const documents = new Map<AppDocumentIdV1, CanonicalFlarexValueV1>();
    for (const intent of command.rowIntents) {
      const observed = intent.dependency.observed;
      const identity = { scopeId: command.authorityPins.scopeId, tableId: intent.tableId, rowId: intent.rowId };
      if (observed.kind === "present") {
        const original = originals.get(intent.documentId);
        if (original === undefined) return yield* Result.fail(corruption("priorDocumentInvalid"));
        headsByDocumentId.set(intent.documentId, { head: { kind: "live", identity, revisionCommitSeq: original.commitSeq }, creationTime: original.creationTime });
        documents.set(intent.documentId, original.document);
      } else {
        headsByDocumentId.set(intent.documentId, { head: observed.basis.kind === "tombstone"
          ? { kind: "tombstone", identity, revisionCommitSeq: observed.basis.revisionCommitSeq } : { kind: "missing", identity }, creationTime: null });
      }
    }
    return Object.freeze({ headsByDocumentId, documents });
  });
}

export function prepareDeveloperIndexKeyPairsResult(command: ApplicationDocumentMaterializationCommand,
  originals: ApplicationDocumentOriginals, definitions: readonly LocatedAppIndexDefinitionV1[]) {
  return Result.gen(function* () {
    const plans: PreparedDeveloperIndexKeyPair[] = [];
    for (const definition of definitions) for (const intent of command.rowIntents) {
      if (intent.tableId !== definition.access.tableId) continue;
      const loaded = originals.headsByDocumentId.get(intent.documentId);
      if (loaded === undefined) return yield* Result.fail(corruption("developerIndexTransitionInvalid"));
      const rowId = yield* orderedIndexRowIdHexV1FromBytesResult(appRowIdHexV1ToBytes(intent.rowId))
        .pipe(Result.mapError(() => corruption("developerIndexTransitionInvalid")));
      const original = originals.documents.get(intent.documentId) ?? null;
      if (loaded.head.kind === "live" && (original === null || loaded.creationTime === null))
        return yield* Result.fail(corruption("developerIndexTransitionInvalid"));
      const lower = (document: CanonicalFlarexValueV1, creationTime: NonNullable<typeof loaded.creationTime>) =>
        lowerAppDeveloperIndexKeyV1(definition, document, creationTime).pipe(Result.mapError(cause =>
          new PointCommitDeveloperIndexMaintenanceUnavailableV1Error(cause instanceof ExactDecimalError
            ? { reason: "entryValueInvalid" } : { reason: "entryKeyLimitExceeded", observed: cause.observedBytes, maximum: cause.maximumBytes })));
      const priorKey = loaded.head.kind === "live" && original !== null && loaded.creationTime !== null
        ? yield* lower(original, loaded.creationTime) : null;
      const finalKey = intent.kind === "live" ? yield* lower(intent.document, intent.creationTime) : null;
      plans.push(Object.freeze({ definition, rowId, priorCommitSeq: loaded.head.kind === "live" ? loaded.head.revisionCommitSeq : null, priorKey, finalKey }));
    }
    return Object.freeze(plans);
  });
}

export function prepareUniqueKeyPairsResult(command: ApplicationDocumentMaterializationCommand,
  originals: ApplicationDocumentOriginals, definitions: readonly LocatedAppUniqueConstraintDefinitionV1[]) {
  return Result.gen(function* () {
    const plans: PointCommitUniqueKeyPlanV1[] = [];
    for (const definition of definitions) for (const intent of command.rowIntents) {
      if (intent.tableId !== definition.tableId) continue;
      const loaded = originals.headsByDocumentId.get(intent.documentId);
      if (loaded === undefined) return yield* Result.fail(corruption("uniqueKeyTransitionInvalid"));
      const original = originals.documents.get(intent.documentId) ?? null;
      if (loaded.head.kind === "live" && original === null) return yield* Result.fail(corruption("uniqueKeyTransitionInvalid"));
      const lower = (document: CanonicalFlarexValueV1) => lowerCanonicalAppUniqueConstraintV1Result(definition, document)
        .pipe(Result.mapError(cause => new PointCommitUniqueConstraintMaintenanceUnavailableV1Error({ reason: "keyInvalid", cause })));
      const previous = loaded.head.kind === "live" && original !== null ? yield* lower(original) : null;
      const next = intent.kind === "live" ? yield* lower(intent.document) : null;
      plans.push(Object.freeze({ definition, rowId: intent.rowId,
        rowPrevCommitSeq: loaded.head.kind === "live" ? loaded.head.revisionCommitSeq : null,
        previousCanonical: previous, nextCanonical: next }));
    }
    return Object.freeze(plans);
  });
}

export function prepareRelationTransitionsResult(command: ApplicationDocumentMaterializationCommand,
  originals: ApplicationDocumentOriginals, relations: LocatedPreparedPointCommitApplicationRelations | null) {
  return Result.gen(function* () {
    if (relations === null) return null;
    const sourceTables = new Set(relations.definitions.definitions.map(definition => definition.binding.sourceTableId));
    const tables = new Set(relations.definitions.definitions.flatMap(definition => [definition.binding.sourceTableId, definition.binding.targetTableId]));
    const transitions: ApplicationRelationRowTransition[] = [];
    for (const intent of command.rowIntents) {
      if (!tables.has(intent.tableId)) continue;
      const loaded = originals.headsByDocumentId.get(intent.documentId);
      if (loaded === undefined) return yield* Result.fail(corruption("relationTransitionInvalid"));
      const prior = sourceTables.has(intent.tableId) ? originals.documents.get(intent.documentId) ?? null : null;
      if (sourceTables.has(intent.tableId) && loaded.head.kind === "live" && prior === null)
        return yield* Result.fail(corruption("relationTransitionInvalid"));
      transitions.push(Object.freeze({ documentId: intent.documentId, tableId: intent.tableId, rowId: intent.rowId, prior, final: intent.kind === "live" ? intent.document : null }));
    }
    if (transitions.length === 0) return null;
    const prepared = yield* prepareApplicationRelationCommitResult(relations.definitions, Object.freeze(transitions)).pipe(Result.mapError(cause =>
      cause instanceof ApplicationRelationCommitCorruptionError ? corruption(cause.reason === "invalidDefinitionSet" ? "relationBindingInvalid" : "relationTransitionInvalid") : cause));
    if (!hasPreparedApplicationRelationCommitAuthority(relations.port, prepared, command.authorityPins.schemaVersionId))
      return yield* Result.fail(corruption("relationTransitionInvalid"));
    return Object.freeze({ port: relations.port, prepared });
  });
}

export function prepareIntrinsicIndexKeysResult(command: ApplicationDocumentMaterializationCommand, originals: ApplicationDocumentOriginals,
  definitions: readonly LocatedAppIndexDefinitionV1[]) {
  return Result.gen(function* () {
    const keys: PreparedIntrinsicIndexKey[] = [];
    const byTable = new Map(definitions.map(definition => [definition.access.tableId, definition]));
    for (const intent of command.rowIntents) {
      const definition = byTable.get(intent.tableId);
      if (definition === undefined) continue;
      if (definition.access.kind !== "by_creation_time") return yield* Result.fail(corruption("intrinsicIndexBuildInvalid"));
      const rowId = yield* orderedIndexRowIdHexV1FromBytesResult(appRowIdHexV1ToBytes(intent.rowId))
        .pipe(Result.mapError(() => corruption("intrinsicIndexTransitionInvalid")));
      const creationTime = intent.kind === "live" ? intent.creationTime : originals.headsByDocumentId.get(intent.documentId)?.creationTime ?? null;
      if (creationTime === null) return yield* Result.fail(corruption("rowTransitionInvalid"));
      const encodedKey = encodeAppOrderedIndexKeyV1({ spec: definition.physicalSpec,
        values: [orderedIndexCreationTimeV1(creationTime)] });
      keys.push(Object.freeze({ definition, rowId, creationTime, encodedKey }));
    }
    return Object.freeze(keys);
  });
}

export const prepareApplicationDocumentSettlementEffect = Effect.fn("ApplicationDocument.prepareSettlement")(function* (
  command: ApplicationDocumentMaterializationCommand, originalRows: readonly LiveAppRowRevisionV1[],
  developerDefinitions: readonly LocatedAppIndexDefinitionV1[], uniqueDefinitions: readonly LocatedAppUniqueConstraintDefinitionV1[],
  relations: LocatedPreparedPointCommitApplicationRelations | null,
  intrinsicDefinitions: readonly LocatedAppIndexDefinitionV1[],
) {
  const originals = yield* Effect.exit(Effect.suspend(() => Effect.fromResult(prepareOriginalDocumentsResult(command, originalRows))));
  const prior: Effect.Effect<ApplicationDocumentOriginals, PointCommitCorruptionV1Error> = Exit.isSuccess(originals)
    ? Effect.succeed(originals.value) : Effect.failCause(originals.cause);
  const developer = yield* Effect.exit(prior.pipe(Effect.flatMap(value => Effect.fromResult(prepareDeveloperIndexKeyPairsResult(command, value, developerDefinitions)))));
  const unique = Exit.isFailure(developer) ? undefined
    : yield* Effect.exit(prior.pipe(Effect.flatMap(value => Effect.fromResult(prepareUniqueKeyPairsResult(command, value, uniqueDefinitions)))));
  const relation = unique === undefined || Exit.isFailure(unique) ? undefined
    : yield* Effect.exit(prior.pipe(Effect.flatMap(value => Effect.fromResult(prepareRelationTransitionsResult(command, value, relations)))));
  const intrinsic = relation === undefined || Exit.isFailure(relation) ? undefined
    : yield* Effect.exit(prior.pipe(Effect.flatMap(value => Effect.fromResult(prepareIntrinsicIndexKeysResult(command, value, intrinsicDefinitions)))));
  return Object.freeze({ command, originalRows, originals, developer, unique, relation, intrinsic });
});

export type PreparedApplicationDocumentSettlement = Effect.Success<ReturnType<typeof prepareApplicationDocumentSettlementEffect>>;
export function preparedApplicationDocumentSettlementHasFailure(prepared: PreparedApplicationDocumentSettlement): boolean {
  return Exit.isFailure(prepared.originals) || Exit.isFailure(prepared.developer) || prepared.unique === undefined || Exit.isFailure(prepared.unique) ||
    prepared.relation === undefined || Exit.isFailure(prepared.relation) || prepared.intrinsic === undefined || Exit.isFailure(prepared.intrinsic);
}
