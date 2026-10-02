import { FlarexValueSha256V1Schema } from "flarex-protocol/value";
import { expect } from "vitest";
import { Cause, Effect, Exit, Result, Schema } from "effect";
import { and, eq } from "drizzle-orm";
import { CatalogTableIdSchema } from "flarex-protocol/catalog";
import {
  appDocumentIdV1FromRowIdentity,
  appRowIdHexV1FromBytesResult,
  appRowIdHexV1ToBytes,
  decodeAppDocumentIdentityV1Result,
} from "flarex-protocol/app-document-id";
import { StorageGenerationFenceSchema } from "flarex-protocol/storage-authority";
import type { PGliteFlarexPersistence } from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";
import type { RelationalSession } from "../src/relationalTransaction/session";
import { makeCmsHost } from "../src/cmsTransaction/host";
import { defineCmsCommand } from "../src/cmsTransaction/commands";
import { cmsError } from "../src/cmsTransaction/model";
import { fxAppRowRevisions, fxSystemScopeClocks } from "../src/schema";
import { cmsExecutionMeasurementFixture } from "./cmsExecutionMeasurementFixture";
import { makeCe0CmsReadReference } from "./ce0CmsReadReference";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

export const decodeReadDocuments = Schema.decodeUnknownSync(
  Schema.Array(
    Schema.Struct({
      _id: Schema.String,
      _creationTime: Schema.Number,
      title: Schema.String,
    }),
  ),
);
const decodeId = Schema.decodeUnknownEffect(Schema.String);

export async function ce0CmsReadReferenceScenario(
  persistence: PGliteFlarexPersistence | PostgresFlarexPersistence,
  session: RelationalSession,
) {
  const tested = await cmsExecutionMeasurementFixture(persistence, session);
  const other = await cmsExecutionMeasurementFixture(persistence, session);
  const before = await tested.inventory();
  const value = await runEffect(
    tested.host.run(tested.host.newRequestKey(), tested.insert, {
      count: 32,
      prefix: "read-seed",
    }),
  );
  const stable = await tested.verifyInsert(before, value, 32, "read-seed");
  const documents = decodeReadDocuments(value);
  const ids = documents.map((document) => document._id);
  const first = ids[0];
  if (first === undefined) throw new Error("Missing read seed");
  const identity = Result.getOrThrow(decodeAppDocumentIdentityV1Result(first));
  const missing = appDocumentIdV1FromRowIdentity({
    tableId: identity.tableId,
    rowId: Result.getOrThrow(
      appRowIdHexV1FromBytesResult(new Uint8Array(16).fill(0x69)),
    ),
  });
  const foreignTable = appDocumentIdV1FromRowIdentity({
    tableId: CatalogTableIdSchema.make(2147483647),
    rowId: identity.rowId,
  });
  const otherBefore = await other.inventory();
  const otherValue = await runEffect(
    other.host.run(other.host.newRequestKey(), other.insert, {
      count: 1,
      prefix: "other-scope",
    }),
  );
  const otherStable = await other.verifyInsert(
    otherBefore,
    otherValue,
    1,
    "other-scope",
  );
  const foreignIds = decodeReadDocuments(otherValue).map(
    (document) => document._id,
  );

  let reads = 0;
  const hooks = {
    documentReads: {
      beforeRead: () =>
        Effect.sync(() => {
          reads++;
        }),
    },
  };
  const core = await runEffect(makeCmsHost(tested.input, hooks));
  const reference = await runEffect(
    makeCe0CmsReadReference(tested.input, hooks),
  );
  const coreRead = (ids: string[]) => core.read(tested.read, ids);
  const profiles = [
    { ids: [], expected: [], captures: 0 },
    { ids: [first], expected: [documents[0]], captures: 1 },
    { ids: ids.slice(0, 8), expected: documents.slice(0, 8), captures: 8 },
    { ids, expected: value, captures: 32 },
    {
      ids: [first, first],
      expected: [documents[0], documents[0]],
      captures: 1,
    },
    { ids: [missing, missing], expected: [null, null], captures: 1 },
    { ids: foreignIds, expected: [null], captures: 1 },
  ];
  for (const profile of profiles)
    for (const read of [coreRead, reference.read])
      for (let repeat = 0; repeat < 2; repeat++) {
        const callbacks =
          tested.readExecutionCount() + reference.executionCount();
        const captures = reads;
        expect(await runEffect(read(profile.ids))).toEqual(profile.expected);
        expect(tested.readExecutionCount() + reference.executionCount()).toBe(
          callbacks + 1,
        );
        expect(reads - captures).toBe(profile.captures);
        expect(await tested.inventory()).toEqual(stable);
        expect(await other.inventory()).toEqual(otherStable);
      }
  for (const read of [coreRead, reference.read]) {
    expect(await runEffectFailure(read(["bad-id"]))).toMatchObject({
      reason: "invalidInput",
    });
    expect(await runEffectFailure(read([foreignTable]))).toMatchObject({
      reason: "invalidAuthority",
    });
    expect(await tested.inventory()).toEqual(stable);
  }
  const revision = stable.revisions.find((row) =>
    new Uint8Array(row.rowId).every(
      (byte, index) => byte === appRowIdHexV1ToBytes(identity.rowId)[index],
    ),
  );
  if (revision?.valueSha256 == null) throw new Error("Missing revision hash");
  const slot = and(
    eq(fxAppRowRevisions.scopeUuid, tested.scope.scopeUuid),
    eq(fxAppRowRevisions.tableId, identity.tableId),
    eq(fxAppRowRevisions.rowId, revision.rowId),
    eq(fxAppRowRevisions.commitSeq, revision.commitSeq),
  );
  const damagedHash = new Uint8Array(revision.valueSha256);
  damagedHash[0] = (damagedHash[0] ?? 0) ^ 1;
  await persistence.drizzle
    .update(fxAppRowRevisions)
    .set({ valueSha256: FlarexValueSha256V1Schema.make(damagedHash) })
    .where(slot);
  try {
    const damaged = await tested.inventory();
    for (const read of [coreRead, reference.read]) {
      expect(await runEffectFailure(read([first]))).toMatchObject({
        reason: "storedCorruption",
      });
      expect(await tested.inventory()).toEqual(damaged);
    }
  } finally {
    await persistence.drizzle
      .update(fxAppRowRevisions)
      .set({ valueSha256: revision.valueSha256 })
      .where(slot);
  }
  const clock = stable.clock[0];
  if (clock === undefined) throw new Error("Missing scope clock");
  await persistence.drizzle
    .update(fxSystemScopeClocks)
    .set({
      storageGenerationFence: StorageGenerationFenceSchema.make(
        clock.storageGenerationFence + 1n,
      ),
    })
    .where(eq(fxSystemScopeClocks.scopeId, clock.scopeId));
  try {
    const changed = await tested.inventory();
    for (const read of [coreRead, reference.read]) {
      const callbacks =
        tested.readExecutionCount() + reference.executionCount();
      expect(await runEffectFailure(read([]))).toMatchObject({
        reason: "invalidAuthority",
      });
      expect(tested.readExecutionCount() + reference.executionCount()).toBe(
        callbacks,
      );
      expect(await tested.inventory()).toEqual(changed);
    }
  } finally {
    await persistence.drizzle
      .update(fxSystemScopeClocks)
      .set({ storageGenerationFence: clock.storageGenerationFence })
      .where(eq(fxSystemScopeClocks.scopeId, clock.scopeId));
  }
  for (const implementation of ["core", "reference"] as const) {
    const controller = new AbortController();
    let entered = 0;
    const hooks = {
      documentReads: {
        beforeRead: () =>
          Effect.sync(() => {
            entered++;
            controller.abort();
          }),
      },
    };
    const host = await runEffect(makeCmsHost(tested.input, hooks));
    const ref = await runEffect(makeCe0CmsReadReference(tested.input, hooks));
    const exit = await Effect.runPromiseExit(
      implementation === "core" ? host.read(tested.read, ids) : ref.read(ids),
      { signal: controller.signal },
    );
    expect(entered).toBe(1);
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.reasons.length).toBeGreaterThan(0);
      expect(exit.cause.reasons.every(Cause.isInterruptReason)).toBe(true);
    }
    expect(await tested.inventory()).toEqual(stable);
  }
  const remove = defineCmsCommand({
    name: "deleteReadSeed",
    mode: "write",
    run: (ctx, args) =>
      Effect.gen(function* () {
        const id = yield* decodeId(args).pipe(
          Effect.mapError((cause) => cmsError("invalidInput", cause)),
        );
        yield* ctx.documents.delete(ctx.context, ctx.transactionId, id);
        return null;
      }),
  });
  const deleting = await runEffect(
    makeCmsHost({
      ...tested.input,
      commands: [...tested.input.commands, remove],
    }),
  );
  await runEffect(deleting.run(deleting.newRequestKey(), remove, first));
  const deleted = await tested.inventory();
  for (const read of [coreRead, reference.read]) {
    const captures = reads;
    expect(await runEffect(read([first, first]))).toEqual([null, null]);
    expect(reads - captures).toBe(1);
    expect(await tested.inventory()).toEqual(deleted);
  }
  expect(await other.inventory()).toEqual(otherStable);
  return tested;
}
