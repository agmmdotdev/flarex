import { expect } from "vitest";
import { Result } from "effect";
import {
  canonicalizeAppDocumentV1,
  decodeAppCreationTimeV1,
} from "flarex-protocol/app-document";
import { decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import { decodeCatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  ScopeEpochSchema,
  type ScopeId,
  type ScopeEpoch,
} from "flarex-protocol/storage-authority";
import { orderedIndexValueFromFlarexValueV1 } from "flarex-protocol/ordered-index";
import type { FlarexPersistence } from "../src";
import type { FlarexMetadataDatabase } from "../src/deployments";
import {
  appendPreparedAppRowRevisionsInTransactionEffect,
  type AppendPreparedLiveAppRowRevisionV1Input,
} from "../src/appRows";
import { decodeAppUniqueConstraintIdV1Result } from "../src/appUniqueKeyContract";
import {
  applyAppUniqueKeyMutationsInTransactionEffect,
  type ApplyAppUniqueKeyMutationV1Input,
  AppUniqueKeyConflictError,
  AppUniqueKeyStorageCorruptionError,
  AppUniqueKeyScopeAuthorityUnavailableError,
  AppUniqueKeyPreviousClaimMismatchError,
  InvalidAppUniqueKeyMutationV1Error,
  CanonicalAppUniqueKeyHashCollisionError,
} from "../src/appUniqueKeys";
import { runEffect } from "./effectTestRuntime";

export async function verifyUniqueBatches(
  persistence: Pick<FlarexPersistence, "query">,
  db: FlarexMetadataDatabase,
  scopeId: ScopeId,
  writeEpoch: ScopeEpoch,
) {
  const apply = (inputs: readonly ApplyAppUniqueKeyMutationV1Input[]) =>
    db.transaction((tx) =>
      runEffect(applyAppUniqueKeyMutationsInTransactionEffect(tx, inputs)),
    );
  expect(await apply([])).toEqual([]);
  for (const count of [1, 32, 33, 128]) {
    const tableId = decodeCatalogTableId(1);
    const constraintId = Result.getOrThrow(
      decodeAppUniqueConstraintIdV1Result(count + 10),
    );
    const creationTime = decodeAppCreationTimeV1(42);
    const rows: AppendPreparedLiveAppRowRevisionV1Input[] = [];
    const actions: ApplyAppUniqueKeyMutationV1Input[] = [];
    for (let i = 0; i < count; i += 1) {
      const rowId = decodeAppRowIdHexV1(
        (count * 1000 + i).toString(16).padStart(32, "0"),
      );
      rows.push({
        kind: "live",
        scopeId,
        writeEpoch,
        tableId,
        rowId,
        creationTime,
        schemaVersionId: decodeCatalogSchemaVersionId("ce1_unique_batch"),
        commitSeq: CommitSeqSchema.make(1n),
        prevCommitSeq: null,
        document: await canonicalizeAppDocumentV1({
          tableId,
          rowId,
          creationTime,
          fields: { ordinal: i },
        }),
      });
      actions.push({
        scopeId,
        writeEpoch,
        constraintId,
        tableId,
        rowId,
        previous: null,
        next: {
          sparse: false,
          localeKey: null,
          values: [orderedIndexValueFromFlarexValueV1(`key_${i}`)],
        },
      });
    }
    await db.transaction((tx) =>
      runEffect(appendPreparedAppRowRevisionsInTransactionEffect(tx, rows)),
    );
    const first = actions[0];
    const last = actions.at(-1);
    if (first === undefined || last === undefined)
      throw new Error("Missing unique actions");
    const state = async () =>
      (
        await persistence.query(
          "select * from fx_app_unique_key where constraint_id = $1 order by row_id",
          [constraintId],
        )
      ).rows;
    await expect(apply([first, first])).rejects.toBeInstanceOf(
      InvalidAppUniqueKeyMutationV1Error,
    );
    await expect(
      apply([
        {
          ...first,
          writeEpoch: ScopeEpochSchema.make(
            "epoch_00000000-0000-0000-0000-000000000001",
          ),
        },
      ]),
    ).rejects.toBeInstanceOf(AppUniqueKeyScopeAuthorityUnavailableError);
    if (count > 1) {
      await expect(
        apply(actions.map((action) => ({ ...action, next: first.next }))),
      ).rejects.toBeInstanceOf(AppUniqueKeyConflictError);
      await expect(
        db.transaction((tx) =>
          runEffect(
            applyAppUniqueKeyMutationsInTransactionEffect(
              tx,
              actions,
              async () => new Uint8Array(32).fill(7),
            ),
          ),
        ),
      ).rejects.toBeInstanceOf(CanonicalAppUniqueKeyHashCollisionError);
      expect(await state()).toHaveLength(0);
    }
    if (count === 33) {
      await persistence.query(`create function corrupt_unique_batch() returns trigger language plpgsql as $$
        begin if new.row_id = decode('${last.rowId}', 'hex') then
          new.encoded_key := new.encoded_key || decode('00','hex'); end if; return new; end $$`);
      await persistence.query(
        "create trigger corrupt_unique_batch before insert on fx_app_unique_key for each row execute function corrupt_unique_batch()",
      );
      await expect(apply(actions)).rejects.toBeInstanceOf(
        AppUniqueKeyStorageCorruptionError,
      );
      expect(await state()).toHaveLength(0);
      await persistence.query(
        "drop trigger corrupt_unique_batch on fx_app_unique_key",
      );
      await persistence.query("drop function corrupt_unique_batch()");
    }
    expect((await apply(actions)).map((result) => result.status)).toEqual(
      actions.map(() => "claimed"),
    );
    const initial = await state();
    const omittedLocales = ["en", "fr"].map(localeKey => ({ ...first,
      next: { sparse: true, localeKey, values: [{ kind: "missing" as const }] },
    }));
    expect((await apply(omittedLocales)).map(result => result.status)).toEqual(["omitted", "omitted"]);
    await expect(apply([{ ...first, next: { sparse: true, localeKey: null, values: [{ kind: "missing" }] } }]))
      .rejects.toBeInstanceOf(AppUniqueKeyPreviousClaimMismatchError);
    expect(await state()).toEqual(initial);
    const unchanged = actions.map((action) => ({
      ...action,
      previous: action.next,
    }));
    expect((await apply(unchanged)).map((result) => result.status)).toEqual(
      actions.map(() => "unchanged"),
    );
    expect(await state()).toEqual(initial);
    const releases = actions.map((action) => ({
      ...action,
      previous: action.next,
      next: null,
    }));
    if (count === 33) {
      await persistence.query(`create function omit_unique_delete() returns trigger language plpgsql as $$
        begin if old.row_id = decode('${last.rowId}', 'hex') then return null; end if; return old; end $$`);
      await persistence.query(
        "create trigger omit_unique_delete before delete on fx_app_unique_key for each row execute function omit_unique_delete()",
      );
      await expect(apply(releases)).rejects.toBeInstanceOf(
        AppUniqueKeyStorageCorruptionError,
      );
      expect(await state()).toEqual(initial);
      await persistence.query(
        "drop trigger omit_unique_delete on fx_app_unique_key",
      );
      await persistence.query("drop function omit_unique_delete()");
    }
    // Swaps use the same release-before-claim contract as shared materialization.
    const swapped = actions.map((action, index) => ({
      ...action,
      next: actions[(index + 1) % count]?.next ?? null,
    }));
    if (count > 1)
      await expect(
        apply(
          swapped.map((action, index) => ({
            ...action,
            previous: actions[index]?.next ?? null,
          })),
        ),
      ).rejects.toBeInstanceOf(AppUniqueKeyConflictError);
    await db.transaction(async (tx) => {
      await runEffect(
        applyAppUniqueKeyMutationsInTransactionEffect(tx, releases),
      );
      await runEffect(
        applyAppUniqueKeyMutationsInTransactionEffect(tx, swapped),
      );
    });
    expect(await state()).toHaveLength(count);
    expect(
      (
        await apply(
          swapped.map((action) => ({
            ...action,
            previous: action.next,
            next: null,
          })),
        )
      ).map((result) => result.status),
    ).toEqual(actions.map(() => "released"));
    expect(await state()).toHaveLength(0);
  }
}
