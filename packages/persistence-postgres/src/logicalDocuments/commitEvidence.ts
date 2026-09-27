import { Effect, Option, Result, Schema } from "effect";
import { CatalogIndexDefinitionIdSchema, CatalogUniqueConstraintDefinitionIdSchema, type CatalogTableId } from "flarex-protocol/catalog";
import type { ScopeId } from "flarex-protocol/storage-authority";
import { OrderedIndexBoundHexV1Schema, OrderedIndexKeyBytesHexV1Schema,
  OrderedIndexRowIdHexV1Schema, decodeOrderedIndexComponentsV1 } from "flarex-protocol/ordered-index";
import type { AdmittedParticipantOperation, SourceContribution } from "flarex-protocol/commit-protocol";
import { readAppUniqueKeySlotInTransactionEffect } from "../appUniqueKeys";
import { canonicalizeAppUniqueKeyV1Result } from "../appUniqueKeyContract";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import type { LocatedAppIndexDefinitionV1 } from "../appIndexDefinitions";
import type { LocatedAppUniqueConstraintDefinitionV1 } from "../appUniqueConstraintDefinitions";
import { readLogicalIndexPage, readLogicalIndexRange } from "./indexReads";
import { decodeLogicalParticipantDependencyEvidence, logicalParticipantEvidenceError } from "./journalEvidence";
import type { LogicalDocumentFailureReason } from "./model";

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
      unique: readonly LocatedAppUniqueConstraintDefinitionV1[] }>) {
    const evidence = yield* Effect.fromResult(decodeLogicalParticipantDependencyEvidence(contribution.dependencyEvidence));
    for (const read of evidence.indexRanges) {
      const id = yield* Effect.fromResult(decodeIndexId(read.indexDefinitionId).pipe(Result.mapError(cause => failure("invalidEvidence", cause))));
      const definition = admitted.indexes.find(member => member.indexDefinitionId === id);
      if (definition === undefined || definition.access.kind !== "developer" || !admitted.tableIds.has(definition.access.tableId))
        return yield* Effect.fail(failure("invalidEvidence"));
      const bounds = yield* decodeBounds(read.bounds);
      const current = yield* readLogicalIndexRange(tx, scopeId, { definition, bounds },
        Math.max(1, read.entries.length + 1), failure).pipe(Effect.mapError(cause =>
          cause.reason === "limitExceeded" ? failure("writeConflict") : cause));
      if (current.length !== read.entries.length || current.some((member, position) => {
        const expected = read.entries[position];
        return expected === undefined || member.rowId !== expected.rowId || member.encodedKey !== expected.encodedKey ||
          member.commitSeq.toString() !== expected.commitSeq;
      })) return yield* Effect.fail(failure("writeConflict"));
    }
    for (const read of evidence.indexPages) {
      const id = yield* Effect.fromResult(decodeIndexId(read.indexDefinitionId).pipe(Result.mapError(cause => failure("invalidEvidence", cause))));
      const definition = admitted.indexes.find(member => member.indexDefinitionId === id);
      if (definition === undefined || definition.access.kind !== "developer" || !admitted.tableIds.has(definition.access.tableId))
        return yield* Effect.fail(failure("invalidEvidence"));
      const bounds = yield* decodeBounds(read.bounds);
      const after = read.after === undefined ? undefined : {
        encodedKey: yield* Effect.fromResult(decodeKey(read.after.encodedKey).pipe(Result.mapError(cause => failure("invalidEvidence", cause)))),
        rowId: yield* Effect.fromResult(decodeRow(read.after.rowId).pipe(Result.mapError(cause => failure("invalidEvidence", cause)))),
      };
      const current = yield* readLogicalIndexPage(tx, scopeId,
        { definition, bounds, ...(after === undefined ? {} : { after }) },
        Math.max(1, read.entries.length), failure);
      if (current.entries.length !== read.entries.length || read.isDone !== current.isDone ||
        current.entries.some((member, position) => {
          const expected = read.entries[position];
          return expected === undefined || member.rowId !== expected.rowId || member.encodedKey !== expected.encodedKey ||
            member.commitSeq.toString() !== expected.commitSeq;
        })) return yield* Effect.fail(failure("writeConflict"));
    }
    for (const read of evidence.uniqueReads) {
      const id = yield* Effect.fromResult(decodeUniqueId(read.constraintId).pipe(Result.mapError(cause => failure("invalidEvidence", cause))));
      const definition = admitted.unique.find(member => member.uniqueConstraintDefinitionId === id);
      if (definition === undefined || !admitted.tableIds.has(definition.tableId))
        return yield* Effect.fail(failure("invalidEvidence"));
      const observedKey = read.key;
      if (observedKey.kind === "omitted") {
        if (read.owner !== null) return yield* Effect.fail(failure("invalidEvidence"));
        continue;
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
      const slot = yield* readAppUniqueKeySlotInTransactionEffect(tx, { scopeId, constraintId: id, key })
        .pipe(Effect.mapError(cause => failure("resourceFailure", cause)));
      const owner = Option.isSome(slot) ? slot.value : null;
      if (owner === null ? read.owner !== null : read.owner === null ||
        owner.tableId !== read.owner.tableId || owner.rowId !== read.owner.rowId)
        return yield* Effect.fail(failure("writeConflict"));
    }
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
