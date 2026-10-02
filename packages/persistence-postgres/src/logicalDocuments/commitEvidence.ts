import { consumeCurrentAppIndexPagesInTransactionEffect, MAX_APP_INDEX_RANGE_PAGE_SIZE_V1, type ScanCurrentAppIndexV1Input, type AppIndexRangeEntryV1 } from "../appIndexEntries";
import { Effect, Option, Result, Schema } from "effect";
import { CatalogIndexDefinitionIdSchema, CatalogUniqueConstraintDefinitionIdSchema, type CatalogTableId } from "flarex-protocol/catalog";
import type { ScopeId } from "flarex-protocol/storage-authority";
import { OrderedIndexBoundHexV1Schema, OrderedIndexKeyBytesHexV1Schema,
  OrderedIndexRowIdHexV1Schema, decodeOrderedIndexComponentsV1 } from "flarex-protocol/ordered-index";
import type { AdmittedParticipantOperation, SourceContribution } from "flarex-protocol/commit-protocol";
import { consumeAppUniqueKeySlotsInTransactionEffect } from "../appUniqueKeys";
import { canonicalizeAppUniqueKeyV1Result } from "../appUniqueKeyContract";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import type { LocatedAppIndexDefinitionV1 } from "../appIndexDefinitions";
import type { LocatedAppUniqueConstraintDefinitionV1 } from "../appUniqueConstraintDefinitions";
import { logicalIndexReadFailureReason, readLogicalIndexPage } from "./indexReads";
import { decodeLogicalParticipantDependencyEvidence, logicalParticipantEvidenceError } from "./journalEvidence";
import type { LogicalDocumentFailureReason } from "./model";
import type { PointCommitPublicationObservation } from "../pointCommitPublicationObservation";

const decodeIndexId = Schema.decodeUnknownResult(Schema.toType(CatalogIndexDefinitionIdSchema));
const decodeUniqueId = Schema.decodeUnknownResult(Schema.toType(CatalogUniqueConstraintDefinitionIdSchema));
const decodeBound = Schema.decodeUnknownResult(Schema.toType(OrderedIndexBoundHexV1Schema));
const decodeKey = Schema.decodeUnknownResult(Schema.toType(OrderedIndexKeyBytesHexV1Schema));
const decodeRow = Schema.decodeUnknownResult(Schema.toType(OrderedIndexRowIdHexV1Schema));
const failure = (reason: LogicalDocumentFailureReason | "invalidEvidence", cause?: unknown) =>
  logicalParticipantEvidenceError(reason === "writeConflict" ? "writeConflict" :
    reason === "resourceFailure" || reason === "statementFailure" ? "resourceFailure" :
    reason === "limitExceeded" ? "limitExceeded" : "invalidEvidence", cause);

/** Recheck every selected historical index/unique decision against current
 * state under the root publisher's scope lock. The definitions come only from
 * a re-resolved source admission, including finish-only recovery. */
export const validateLogicalParticipantDependencyEvidence = Effect.fn("LogicalDocuments.validateParticipantEvidence")(
  function* (tx: FlarexMetadataTransaction, scopeId: ScopeId, operation: AdmittedParticipantOperation,
    contribution: SourceContribution,
    admitted: Readonly<{ tableIds: ReadonlySet<CatalogTableId>;
      indexes: readonly LocatedAppIndexDefinitionV1[];
      unique: readonly LocatedAppUniqueConstraintDefinitionV1[] }>,
    publicationObservation?: PointCommitPublicationObservation) {
    const evidence = yield* Effect.fromResult(decodeLogicalParticipantDependencyEvidence(contribution.dependencyEvidence));
    if (publicationObservation?.detail) publicationObservation.record({ kind: "counts", owner: "participant",
      counts: { indexes: admitted.indexes.length, constraints: admitted.unique.length,
        ranges: evidence.indexRanges.length, pages: evidence.indexPages.length, uniqueReads: evidence.uniqueReads.length } });
    for (const kind of ["range", "page"] as const) {
      const selected = kind === "range" ? evidence.indexRanges : evidence.indexPages;
      const prepared: { input: ScanCurrentAppIndexV1Input; read: (typeof selected)[number] }[] = [];
      let preparationFailure: ReturnType<typeof failure> | undefined;
      for (const read of selected) {
        const result = yield* Effect.result(Effect.gen(function* () {
          const id = yield* Effect.fromResult(decodeIndexId(read.indexDefinitionId).pipe(Result.mapError(cause => failure("invalidEvidence", cause))));
          const definition = admitted.indexes.find(member => member.indexDefinitionId === id);
          if (definition === undefined || definition.access.kind !== "developer" || !admitted.tableIds.has(definition.access.tableId))
            return yield* Effect.fail(failure("invalidEvidence"));
          const bounds = yield* decodeBounds(read.bounds);
          const recordedAfter = kind === "page" ? evidence.indexPages[prepared.length]?.after : undefined;
          const after = recordedAfter !== undefined ? {
            encodedKey: yield* Effect.fromResult(decodeKey(recordedAfter.encodedKey).pipe(Result.mapError(cause => failure("invalidEvidence", cause)))),
            rowId: yield* Effect.fromResult(decodeRow(recordedAfter.rowId).pipe(Result.mapError(cause => failure("invalidEvidence", cause)))),
          } : undefined;
          const limit = Math.min(MAX_APP_INDEX_RANGE_PAGE_SIZE_V1,
            Math.max(1, read.entries.length + (kind === "range" ? 1 : 0)));
          return { input: { scopeId, definition, bounds, limit, ...(after === undefined ? {} : { after }) }, read };
        }));
        if (Result.isFailure(result)) { preparationFailure = result.failure; break; }
        prepared.push(result.success);
      }
      yield* consumeCurrentAppIndexPagesInTransactionEffect(tx, prepared.map(member => member.input), cause =>
        failure(logicalIndexReadFailureReason(cause), cause), (ordinal, page) => Effect.gen(function* () {
        const member = prepared[ordinal];
        if (member === undefined) return yield* Effect.die(new Error("Participant evidence lost an ordinal"));
        const { read, input } = member;
        const entries: AppIndexRangeEntryV1[] = [...page.entries];
        if (kind === "range") {
          let current = page;
          const maximum = Math.max(1, read.entries.length + 1);
          while (!current.isDone) {
            if (entries.length >= maximum) return yield* Effect.fail(failure("writeConflict"));
            if (current.continueCursor === null) return yield* Effect.fail(failure("invalidEvidence"));
            current = yield* readLogicalIndexPage(tx, scopeId, { definition: input.definition, bounds: input.bounds,
              after: current.continueCursor }, Math.min(MAX_APP_INDEX_RANGE_PAGE_SIZE_V1, maximum - entries.length), failure);
            entries.push(...current.entries);
          }
        }
        if (entries.length !== read.entries.length || (kind === "page" && evidence.indexPages[ordinal]?.isDone !== page.isDone) ||
          entries.some((entry, position) => {
            const expected = read.entries[position];
            return expected === undefined || entry.rowId !== expected.rowId || entry.encodedKey !== expected.encodedKey ||
              entry.commitSeq.toString() !== expected.commitSeq;
          })) return yield* Effect.fail(failure("writeConflict"));
      }));
      if (preparationFailure !== undefined) return yield* Effect.fail(preparationFailure);
    }
    const unique: { input: Parameters<typeof consumeAppUniqueKeySlotsInTransactionEffect>[1][number];
      read: (typeof evidence.uniqueReads)[number] }[] = [];
    let uniquePreparationFailure: ReturnType<typeof failure> | undefined;
    for (const read of evidence.uniqueReads) {
      const prepared = yield* Effect.result(Effect.gen(function* () {
      const id = yield* Effect.fromResult(decodeUniqueId(read.constraintId).pipe(Result.mapError(cause => failure("invalidEvidence", cause))));
      const definition = admitted.unique.find(member => member.uniqueConstraintDefinitionId === id);
      if (definition === undefined || !admitted.tableIds.has(definition.tableId))
        return yield* Effect.fail(failure("invalidEvidence"));
      const observedKey = read.key;
      if (observedKey.kind === "omitted") {
        if (read.owner !== null) return yield* Effect.fail(failure("invalidEvidence"));
        return { scopeId, constraintId: id, key: { sparse: true, localeKey: null, values: [{ kind: "missing" as const }] } };
      }
      const encodedKey = observedKey.encodedKey;
      const componentCount = observedKey.componentCount;
      const components = yield* Effect.try({ try: () => decodeOrderedIndexComponentsV1(
        encodedKey, componentCount + 1),
        catch: cause => failure("invalidEvidence", cause) });
      const locale = components[0];
      if (locale === undefined || (observedKey.localeKey === "" ? locale.kind !== "missing" :
        locale.kind !== "string" || locale.value !== observedKey.localeKey))
        return yield* Effect.fail(failure("invalidEvidence"));
      const key = { sparse: false, localeKey: observedKey.localeKey === "" ? null : observedKey.localeKey,
        values: components.slice(1) };
      const canonical = yield* Effect.fromResult(canonicalizeAppUniqueKeyV1Result(key)
        .pipe(Result.mapError(cause => failure("invalidEvidence", cause))));
      if (canonical.kind !== "claim" || canonical.encodedKey !== observedKey.encodedKey)
        return yield* Effect.fail(failure("invalidEvidence"));
          return { scopeId, constraintId: id, key };
      }));
      if (Result.isFailure(prepared)) { uniquePreparationFailure = prepared.failure; break; }
      unique.push({ input: prepared.success, read });
    }
    yield* consumeAppUniqueKeySlotsInTransactionEffect(tx, unique.map(member => member.input), cause => failure("resourceFailure", cause),
      (ordinal, slot) => {
        const read = unique[ordinal]?.read;
        if (read === undefined) return Effect.die(new Error("Participant unique evidence lost an ordinal"));
        const owner = Option.isSome(slot) ? slot.value : null;
        return (owner === null ? read.owner !== null : read.owner === null ||
          owner.tableId !== read.owner.tableId || owner.rowId !== read.owner.rowId)
          ? Effect.fail(failure("writeConflict")) : Effect.void;
      });
    if (uniquePreparationFailure !== undefined) return yield* Effect.fail(uniquePreparationFailure);
  });

const decodeBounds = Effect.fn("LogicalDocuments.decodeEvidenceBounds")(function* (
  value: Readonly<{ startInclusive?: string; endExclusive?: string }>,
) {
  const startInclusive = value.startInclusive === undefined ? undefined :
    yield* Effect.fromResult(decodeBound(value.startInclusive).pipe(Result.mapError(cause => failure("invalidEvidence", cause))));
  const endExclusive = value.endExclusive === undefined ? undefined :
    yield* Effect.fromResult(decodeBound(value.endExclusive).pipe(Result.mapError(cause => failure("invalidEvidence", cause))));
  return Object.freeze({ ...(startInclusive === undefined ? {} : { startInclusive }),
    ...(endExclusive === undefined ? {} : { endExclusive }) });
});
