import { expect, vi } from "vitest";
import { Result, Schema } from "effect";
import { and, eq } from "drizzle-orm";
import {
  appRowIdHexV1ToBytes,
  decodeAppDocumentIdentityV1Result,
} from "flarex-protocol/app-document-id";
import type { PGliteFlarexPersistence } from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";
import { canonicalizeFlarexValueV1Effect } from "flarex-protocol/value";
import { cmsLimits } from "../src/cmsTransaction/model";
import { fxAppRowRevisions } from "../src/schema";
import { cmsExecutionMeasurementFixture } from "./cmsExecutionMeasurementFixture";
import { makeCe0CmsMutationReference } from "./ce0CmsMutationReference";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

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
        expect(
          await runEffectFailure(
            run(tested.host.newRequestKey(), {
              count: 8,
              prefix: `identity-${collision}`,
            }),
          ),
        ).toMatchObject({ reason: "uniqueConflict" });
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
}
