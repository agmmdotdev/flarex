import { expect, vi } from "vitest";
import { Cause, Effect, Exit, Option, Result } from "effect";
import { canonicalizeAppDocumentV1, decodeAppCreationTimeV1 } from "flarex-protocol/app-document";
import { appRowIdHexV1ToBytes, decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import { orderedIndexValueFromFlarexValueV1 } from "flarex-protocol/ordered-index";
import { decodeCatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { CommitSeqSchema, ScopeEpochSchema, ScopeIdSchema, projectScopeEpochUuidV1,
  projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { decodeAppUniqueConstraintIdV1Result } from "../../../src/storage/unique/appUniqueKeyContract";
import { AppUniqueKeyStorageCorruptionError, applyAppUniqueKeyMutationsInTransactionEffect,
  withAppUniqueKeySlotsInTransactionEffect, readAppUniqueKeySlotInTransactionEffect } from "../../../src/storage/unique/appUniqueKeys";
import {
  AppRowStorageCorruptionError,
} from "../../../src/storage/documents/appRowErrors";
import {
  appendPreparedAppRowRevisionsInTransactionEffect,
  readBoundedCurrentAppRowsInTransactionEffect,
  readBoundedPublicationAppRowsInTransactionEffect,
} from "../../../src/storage/documents/appRows";
import type { FlarexMetadataTransaction } from "../../../src/database/metadataTransaction";
import { fxSystemCommits, fxSystemCommitAppRowChanges } from "../../../src/database/schema";
import { runEffect, runEffectFailure } from "../../support/effectTestRuntime";
import { insertCurrentScopeClockFixtureInTransaction } from "../../scope/scopeClockFixture";
import { lockScopeClockForOrdinaryWriteInTransactionEffect } from "../../../src/scope/scopeClock";

const scopeId = ScopeIdSchema.make("scope_5c000000-0000-0000-0000-000000000001");
const epoch = ScopeEpochSchema.make("epoch_5c000000-0000-0000-0000-000000000002");
const tableId = decodeCatalogTableId(1);
const rowId = decodeAppRowIdHexV1("5c00000000000000000000000000000a");
const schemaVersionId = decodeCatalogSchemaVersionId("schema_publication_slot");
const constraintId = Result.getOrThrow(decodeAppUniqueConstraintIdV1Result(1));
const committed = CommitSeqSchema.make(100n);
const pending = CommitSeqSchema.make(101n);
const key = { sparse: false, localeKey: null,
  values: [orderedIndexValueFromFlarexValueV1("product-1")] } as const;

/** Tests only the shared slot owner's transaction-local final-state rule.
 * Host admission, scope locking and complete publication are separate proofs. */
export async function verifyPublicationSlotFinalState(tx: FlarexMetadataTransaction): Promise<void> {
  const scopeUuid = projectScopeIdUuidV1(scopeId).scopeUuid;
  const epochUuid = projectScopeEpochUuidV1(epoch).epochUuid;
  await insertCurrentScopeClockFixtureInTransaction(tx, { scopeId, lastCommitSeq: committed, epoch });
  await runEffect(lockScopeClockForOrdinaryWriteInTransactionEffect(tx, scopeId));
  const creationTime = decodeAppCreationTimeV1(1_725_000_000_300.75);
  const document = await canonicalizeAppDocumentV1({ tableId, rowId, creationTime,
    fields: { id: "product-1" } });
  await runEffect(appendPreparedAppRowRevisionsInTransactionEffect(tx, [{ kind: "live", scopeId,
    tableId, rowId, writeEpoch: epoch, commitSeq: pending, prevCommitSeq: null,
    schemaVersionId, creationTime, document }]));
  await runEffect(applyAppUniqueKeyMutationsInTransactionEffect(tx, [{ scopeId, constraintId,
    tableId, rowId, writeEpoch: epoch, previous: null, next: key }]));

  const selection = { scopeId, constraintId, key };
  const bounded = { scopeId, tableId, minimumCommitSeq: committed, maximumIdentities: 1,
    maximumDocumentBytes: 65_536, maximumTotalValueBytes: 65_536, rowIds: [rowId] };
  expect(await runEffectFailure(readBoundedCurrentAppRowsInTransactionEffect(tx, bounded)))
    .toBeInstanceOf(AppRowStorageCorruptionError);
  expect(await runEffectFailure(readBoundedPublicationAppRowsInTransactionEffect(tx,
    { ...bounded, pendingCommitSeq: pending }))).toBeInstanceOf(AppRowStorageCorruptionError);
  expect(await runEffectFailure(readAppUniqueKeySlotInTransactionEffect(tx, selection)))
    .toBeInstanceOf(AppUniqueKeyStorageCorruptionError);
  expect(await runEffectFailure(withAppUniqueKeySlotsInTransactionEffect(tx,
    [{ ...selection, pendingCommitSeq: pending }], cause => cause, capture => capture.read(0)).pipe(Effect.map(owners => owners[0]!)))).toBeInstanceOf(AppUniqueKeyStorageCorruptionError);

  await tx.insert(fxSystemCommits).values({ scopeUuid, epochUuid, commitSeq: pending, changeCount: 1 });
  await tx.insert(fxSystemCommitAppRowChanges).values({ scopeUuid, epochUuid, commitSeq: pending,
    changeOrdinal: 0, tableId, rowId: appRowIdHexV1ToBytes(rowId) });
  const current = await runEffect(readBoundedPublicationAppRowsInTransactionEffect(tx,
    { ...bounded, pendingCommitSeq: pending }));
  expect(current.commitSeq).toBe(committed);
  expect(current.rows).toMatchObject([{ kind: "live", rowId, commitSeq: pending }]);
  expect(await runEffectFailure(readBoundedCurrentAppRowsInTransactionEffect(tx, bounded)))
    .toBeInstanceOf(AppRowStorageCorruptionError);
  expect(await runEffectFailure(readBoundedPublicationAppRowsInTransactionEffect(tx,
    { ...bounded, pendingCommitSeq: CommitSeqSchema.make(102n) }))).toBeInstanceOf(AppRowStorageCorruptionError);
  const slot = await runEffect(withAppUniqueKeySlotsInTransactionEffect(tx,
    [{ ...selection, pendingCommitSeq: pending }], cause => cause, capture => capture.read(0)).pipe(Effect.map(owners => owners[0]!)));
  expect(Option.isSome(slot)).toBe(true);
  if (Option.isSome(slot)) expect(slot.value).toMatchObject({ tableId, rowId, ownerCommitSeq: pending });
  const acceptedRead = await runEffect(withAppUniqueKeySlotsInTransactionEffect(tx,
    [{ ...selection, pendingCommitSeq: pending }], cause => cause, capture => Effect.succeed(capture.read)));
  expect(await runEffectFailure(acceptedRead[0]!(0))).toMatchObject({
    reason: "unique slot capture is closed or ordinal is invalid" });
  for (const interrupted of [false, true]) {
    const escaped: { read?: typeof acceptedRead[0] } = {};
    const stopped = await runEffect(Effect.exit(withAppUniqueKeySlotsInTransactionEffect(tx,
      [{ ...selection, pendingCommitSeq: pending }], cause => cause, capture => {
        escaped.read = capture.read;
        return interrupted ? Effect.interrupt : Effect.fail(new AppUniqueKeyStorageCorruptionError("consumer refused"));
      })));
    expect(stopped._tag).toBe("Failure");
    if (escaped.read === undefined) throw new Error("Slot capture was not lent");
    expect(await runEffectFailure(escaped.read(0))).toMatchObject({
      reason: "unique slot capture is closed or ordinal is invalid" });
  }
  const marker = new Error("Slot callback constructor defect");
  const escapedFromConstructor: { read?: typeof acceptedRead[0] } = {};
  const constructorExit = await runEffect(Effect.exit(withAppUniqueKeySlotsInTransactionEffect(tx,
    [{ ...selection, pendingCommitSeq: pending }], cause => cause, capture => {
      escapedFromConstructor.read = capture.read;
      throw marker;
    })));
  expect(Exit.isFailure(constructorExit)).toBe(true);
  if (Exit.isFailure(constructorExit)) {
    expect(Cause.hasFails(constructorExit.cause)).toBe(false);
    expect(constructorExit.cause.reasons.some(reason => Cause.isDieReason(reason) && reason.defect === marker)).toBe(true);
  }
  if (escapedFromConstructor.read === undefined) throw new Error("Slot capture was not lent to constructor");
  expect(await runEffectFailure(escapedFromConstructor.read(0))).toMatchObject({
    _tag: "AppUniqueKeyStorageCorruptionError",
    reason: "unique slot capture is closed or ordinal is invalid",
  });
  expect(await runEffect(withAppUniqueKeySlotsInTransactionEffect(tx,
    [{ ...selection, pendingCommitSeq: pending }], cause => cause, capture => capture.read(0))))
    .toEqual([slot]);
  for (const mode of ["envelope", "claim"] as const) {
    const decodeMarker = new Error(`Native slot ${mode} getter defect`);
    let useVisited = false;
    let laterOrdinalVisited = false;
    let getterVisits = 0;
    const escapedFromDecode: { read?: typeof acceptedRead[0] } = {};
    const prepare = tx._.session.prepareQuery.bind(tx._.session);
    const spy = vi.spyOn(tx._.session, "prepareQuery").mockImplementation((...args) => {
      const prepared = prepare(...args);
      if (!args[0].sql.includes("fx_app_unique_key") || !args[0].sql.includes("left join")) return prepared;
      return new Proxy(prepared, {
        get(target, property) {
          const member = Reflect.get(target, property, target);
          if (property !== "execute" || typeof member !== "function")
            return typeof member === "function" ? member.bind(target) : member;
          return async (...bindings: ReadonlyArray<unknown>) => {
            const rows: unknown = await Reflect.apply(member, target, bindings);
            if (!Array.isArray(rows) || rows.length !== 1) throw new Error("Expected genuine native slot envelope");
            return rows.map((row: unknown) => {
              if (typeof row !== "object" || row === null || !("claim" in row) ||
                typeof row.claim !== "object" || row.claim === null) throw new Error("Missing genuine native slot claim");
              if (mode === "envelope") return Object.defineProperty({ ...row }, "claim", {
                enumerable: true, get(): never { getterVisits += 1; throw decodeMarker; },
              });
              return { ...row, claim: Object.defineProperty({ ...row.claim }, "encodedKey", {
                enumerable: true, get(): never { getterVisits += 1; throw decodeMarker; },
              }) };
            });
          };
        },
      });
    });
    try {
      const decodeExit = await runEffect(Effect.exit(withAppUniqueKeySlotsInTransactionEffect(tx,
        [{ ...selection, pendingCommitSeq: pending }, { ...selection, pendingCommitSeq: pending }], cause => cause,
        capture => {
          useVisited = true;
          escapedFromDecode.read = capture.read;
          return Effect.gen(function* () {
            yield* capture.read(0);
            laterOrdinalVisited = true;
            yield* capture.read(1);
          });
        })));
      expect(Exit.isFailure(decodeExit)).toBe(true);
      if (Exit.isFailure(decodeExit)) {
        expect(Cause.hasFails(decodeExit.cause)).toBe(false);
        expect(decodeExit.cause.reasons.some(reason => Cause.isDieReason(reason) && reason.defect === decodeMarker)).toBe(true);
      }
      expect(useVisited).toBe(mode === "claim");
      expect(laterOrdinalVisited).toBe(false);
      expect(getterVisits).toBe(1);
      if (mode === "claim") {
        if (escapedFromDecode.read === undefined) throw new Error("Slot capture was not lent before claim decoding");
        expect(await runEffectFailure(escapedFromDecode.read(0))).toMatchObject({
          _tag: "AppUniqueKeyStorageCorruptionError", reason: "unique slot capture is closed or ordinal is invalid",
        });
        expect(await runEffectFailure(withAppUniqueKeySlotsInTransactionEffect(tx,
          [{ ...selection, pendingCommitSeq: CommitSeqSchema.make(102n) }], cause => cause, capture => capture.read(0))))
          .toMatchObject({ _tag: "AppUniqueKeyStorageCorruptionError", reason: "slot owner is not the pending publication revision" });
        expect(getterVisits).toBe(1);
      }
    } finally { spy.mockRestore(); }
    expect(await runEffect(withAppUniqueKeySlotsInTransactionEffect(tx,
      [{ ...selection, pendingCommitSeq: pending }], cause => cause, capture => capture.read(0))))
      .toEqual([slot]);
  }
  expect(await runEffectFailure(readAppUniqueKeySlotInTransactionEffect(tx, selection)))
    .toBeInstanceOf(AppUniqueKeyStorageCorruptionError);
  expect(await runEffectFailure(withAppUniqueKeySlotsInTransactionEffect(tx,
    [{ ...selection, pendingCommitSeq: CommitSeqSchema.make(102n) }], cause => cause, capture => capture.read(0)).pipe(Effect.map(owners => owners[0]!))))
    .toBeInstanceOf(AppUniqueKeyStorageCorruptionError);
}
