import { expect, vi } from "vitest";
import { Cause, Effect, Exit, Result, Schema } from "effect";
import { and, eq } from "drizzle-orm";
import {
  appRowIdHexV1ToBytes,
  decodeAppDocumentIdentityV1Result,
} from "flarex-protocol/app-document-id";
import type { PGliteFlarexPersistence } from "../../src/database/pglite";
import type { PostgresFlarexPersistence } from "../../src/database/postgres";
import { canonicalizeFlarexValueV1Effect } from "flarex-protocol/value";
import { cmsLimits } from "../../src/frameworks/cmsTransaction/model";
import { fxAppRowRevisions } from "../../src/database/schema";
import { AppDocumentInsertionConflictError } from "../../src/commit/pointCommitErrors";
import { makeCmsHost } from "../../src/frameworks/cmsTransaction/host";
import { cmsExecutionMeasurementFixture } from "../frameworks/cmsTransaction/cmsExecutionMeasurementFixture";
import { makeCe0CmsMutationReference } from "../frameworks/cmsTransaction/ce0CmsMutationReference";
import { runEffect, runEffectFailure } from "../support/effectTestRuntime";

const decodeIds = Schema.decodeUnknownSync(
  Schema.Array(
    Schema.Struct({
      _id: Schema.String,
      _creationTime: Schema.Number,
      title: Schema.String,
    }),
  ),
);

export async function ce0FirstInsertExecutionScenario(
  persistence: PGliteFlarexPersistence | PostgresFlarexPersistence,
  tested: Awaited<ReturnType<typeof cmsExecutionMeasurementFixture>>,
) {
  const reference = await runEffect(makeCe0CmsMutationReference(tested.input));
  const core = (key: string, args: { count: number; prefix: string }) =>
    tested.host.run(key, tested.insert, args);
  const seedArgs = { count: 1, prefix: "execution-seed" };
  const before = await tested.inventory();
  const seed = await runEffect(core(tested.host.newRequestKey(), seedArgs));
  const seeded = await tested.verifyInsert(before, seed, 1, seedArgs.prefix);
  const document = decodeIds(seed)[0];
  if (document === undefined) throw new Error("Missing seed document");
  const id = document._id;
  const identity = Result.getOrThrow(decodeAppDocumentIdentityV1Result(id));
  const seedBytes = appRowIdHexV1ToBytes(identity.rowId);
  const freshBytes = new Uint8Array(16).fill(0x7a);
  expect(
    seeded.rows.some((row) =>
      new Uint8Array(row.rowId).every(
        (byte, index) => byte === freshBytes[index],
      ),
    ),
  ).toBe(false);
  for (const collision of ["committed", "pending"] as const)
    for (const run of [core, reference.run]) {
      const stable = await tested.inventory();
      let calls = 0;
      const random = vi
        .spyOn(crypto, "getRandomValues")
        .mockImplementation((array) => {
          if (!(array instanceof Uint8Array) || array.byteLength !== 16)
            throw new Error("Unexpected random request");
          calls++;
          array.set(collision === "committed" ? seedBytes : freshBytes);
          return array;
        });
      try {
        const failure = await runEffectFailure(
          run(tested.host.newRequestKey(), {
            // One committed collision reaches the deferred settlement guard;
            // repeated pending IDs retain the separate two-allocation proof.
            count: collision === "committed" ? 1 : 8,
            prefix: `identity-${collision}`,
          }),
        );
        expect(failure).toMatchObject({ reason: "uniqueConflict" });
        expect(calls).toBe(collision === "committed" ? 1 : 2);
        expect(await tested.inventory()).toEqual(stable);
      } finally {
        random.mockRestore();
      }
    }
  for (const length of [cmsLimits.documentBytes, cmsLimits.commandBytes + 1])
    for (const run of [core, reference.run]) {
      const stable = await tested.inventory();
      expect(
        await runEffectFailure(
          run(tested.host.newRequestKey(), {
            count: 1,
            prefix: "x".repeat(length),
          }),
        ),
      ).toMatchObject({ reason: "limitExceeded" });
      expect(await tested.inventory()).toEqual(stable);
    }

  const stable = await tested.inventory();
  const mismatched = await runEffect(
    canonicalizeFlarexValueV1Effect(
      { ...document, title: "execution-mismatched" },
      "appDocument",
    ),
  );
  const revision = stable.revisions.find((row) =>
    new Uint8Array(row.rowId).every((byte, index) => byte === seedBytes[index]),
  );
  if (revision === undefined) throw new Error("Missing seed revision");
  const revisionSlot = and(
    eq(fxAppRowRevisions.scopeUuid, tested.scope.scopeUuid),
    eq(fxAppRowRevisions.tableId, revision.tableId),
    eq(fxAppRowRevisions.rowId, revision.rowId),
    eq(fxAppRowRevisions.commitSeq, revision.commitSeq),
  );
  // FK and per-owner uniqueness prevent inventing or double-assigning a physical
  // owner. Corrupt its canonical content while preserving those constraints.
  const corruptions = [
    {
      apply: () =>
        persistence.drizzle
          .update(fxAppRowRevisions)
          .set({
            valueBytes: mismatched.canonicalBytes,
            valueSha256: mismatched.sha256,
          })
          .where(revisionSlot),
      restore: () =>
        persistence.drizzle
          .update(fxAppRowRevisions)
          .set({
            valueBytes: revision.valueBytes,
            valueSha256: revision.valueSha256,
          })
          .where(revisionSlot),
    },
    {
      apply: () =>
        persistence.drizzle
          .update(fxAppRowRevisions)
          .set({ isTombstone: true, valueBytes: null, valueSha256: null })
          .where(revisionSlot),
      restore: () =>
        persistence.drizzle
          .update(fxAppRowRevisions)
          .set({
            isTombstone: revision.isTombstone,
            valueBytes: revision.valueBytes,
            valueSha256: revision.valueSha256,
          })
          .where(revisionSlot),
    },
  ];
  for (const corruption of corruptions) {
    await corruption.apply();
    try {
      const damaged = await tested.inventory();
      for (const run of [core, reference.run]) {
        expect(
          await runEffectFailure(run(tested.host.newRequestKey(), seedArgs)),
        ).toMatchObject({ reason: "storedCorruption" });
        expect(await tested.inventory()).toEqual(damaged);
      }
    } finally {
      await corruption.restore();
    }
    expect(await tested.inventory()).toEqual(stable);
  }
  const beforeTombstone = await tested.inventory();
  const tombstoneSeedArgs = { count: 1, prefix: "execution-tombstone-seed" };
  const tombstoneSeed = await runEffect(core(tested.host.newRequestKey(), tombstoneSeedArgs));
  const liveTombstoneSeed = await tested.verifyInsert(beforeTombstone, tombstoneSeed, 1, tombstoneSeedArgs.prefix);
  const tombstoneDocument = decodeIds(tombstoneSeed)[0];
  if (tombstoneDocument === undefined) throw new Error("Missing tombstone seed document");
  const tombstoneIdentity = Result.getOrThrow(decodeAppDocumentIdentityV1Result(tombstoneDocument._id));
  const tombstoneBytes = appRowIdHexV1ToBytes(tombstoneIdentity.rowId);
  const deletingHost = await runEffect(makeCmsHost({ ...tested.input, commands: [tested.remove] }));
  try {
    expect(await runEffect(deletingHost.run(deletingHost.newRequestKey(), tested.remove, tombstoneDocument._id))).toBeNull();
  } finally { await runEffect(deletingHost.close); }
  expect(await runEffect(tested.host.read(tested.read, [tombstoneDocument._id]))).toEqual([null]);
  const deleted = await tested.inventory();
  expect(deleted.revisions).toHaveLength(liveTombstoneSeed.revisions.length + 1);
  const tombstoneHistory = deleted.revisions.filter(row => row.tableId === tombstoneIdentity.tableId && Buffer.from(row.rowId).equals(tombstoneBytes));
  expect(tombstoneHistory).toHaveLength(2);
  const [liveRevision, tombstoneRevision] = tombstoneHistory;
  const currentTombstone = deleted.rows.find(row => row.tableId === tombstoneIdentity.tableId && Buffer.from(row.rowId).equals(tombstoneBytes));
  if (liveRevision === undefined || tombstoneRevision === undefined || currentTombstone === undefined)
    throw new Error("Missing retained tombstone history or current pointer");
  expect(liveRevision.isTombstone).toBe(false);
  expect(tombstoneRevision.isTombstone).toBe(true);
  expect(tombstoneRevision.valueBytes).toBeNull();
  expect(tombstoneRevision.valueSha256).toBeNull();
  expect(tombstoneRevision.prevCommitSeq).toBe(liveRevision.commitSeq);
  expect(currentTombstone.commitSeq).toBe(tombstoneRevision.commitSeq);
  expect(deleted.indexes.some(row => Buffer.from(row.rowId).equals(tombstoneBytes))).toBe(false);
  expect(deleted.claims.some(row => row.tableId === tombstoneIdentity.tableId && Buffer.from(row.rowId).equals(tombstoneBytes))).toBe(false);
  let allocations = 0;
  const tombstoneRandom = vi.spyOn(crypto, "getRandomValues").mockImplementation(array => {
    if (!(array instanceof Uint8Array) || array.byteLength !== 16) throw new Error("Unexpected random request");
    allocations++;
    array.set(tombstoneBytes);
    return array;
  });
  try {
    const rejected = await runEffect(Effect.exit(core(tested.host.newRequestKey(), { count: 1, prefix: "execution-tombstone-collision" })));
    expect(Exit.isFailure(rejected)).toBe(true);
    if (!Exit.isFailure(rejected)) throw new Error("Expected generated tombstone insertion conflict");
    expect(rejected.cause.reasons).toHaveLength(1);
    const reason = rejected.cause.reasons[0];
    if (reason === undefined || !Cause.isFailReason(reason)) throw new Error("Expected a typed insertion-conflict Cause");
    const failure = reason.error;
    expect(failure).toMatchObject({ reason: "uniqueConflict", cause: { documentId: tombstoneDocument._id } });
    expect(failure.cause).toBeInstanceOf(AppDocumentInsertionConflictError);
    expect(allocations).toBe(1);
    expect(await tested.inventory()).toEqual(deleted);
  } finally { tombstoneRandom.mockRestore(); }
}
