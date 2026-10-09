import { expect } from "vitest";
import { inspect } from "node:util";
import { Effect, Schema } from "effect";
import { and, eq } from "drizzle-orm";
import {
  appDocumentIdV1FromRowIdentity,
  AppRowIdHexV1Schema,
  decodeAppDocumentIdentityV1Result,
} from "flarex-protocol/app-document-id";
import { CommitSeqSchema } from "flarex-protocol/storage-authority";
import type { PGliteFlarexPersistence } from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";
import type { RelationalSession } from "../src/relationalTransaction/session";
import type { FlarexMetadataTransaction } from "../src/metadataTransaction";
import type { CmsMaterializationTestHooks } from "../src/cmsTransaction/testSupport";
import { makeCmsHost } from "../src/cmsTransaction/host";
import { defineCmsCommand } from "../src/cmsTransaction/commands";
import { cmsError } from "../src/cmsTransaction/model";
import {
  fxAppRowCurrent,
  fxAppRowRevisions,
  fxAppUniqueKeys,
  fxSystemScopeClocks,
} from "../src/schema";
import { bytesEqualFullScan } from "@flarex/utils/bytes";
import { runDrizzleStatementEffect } from "../src/drizzleStatementEffect";
import { cmsExecutionMeasurementFixture } from "./cmsExecutionMeasurementFixture";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

const decodeRows = Schema.decodeUnknownSync(
  Schema.Array(Schema.Struct({ _id: Schema.String, title: Schema.String })),
);
type Evidence = Parameters<
  NonNullable<CmsMaterializationTestHooks["afterDocumentClosure"]>
>[0];

export async function cmsCommandSettlementScenario(
  persistence: PGliteFlarexPersistence | PostgresFlarexPersistence,
  session: RelationalSession,
) {
  const fixture = await cmsExecutionMeasurementFixture(persistence, session);
  let emptyEvidence: Evidence | undefined;
  const emptyScan = defineCmsCommand({
    name: "settlementEmptyScan",
    mode: "write",
    run: (ctx) =>
      ctx.documents
        .find(ctx.context, ctx.transactionId, "posts", {
          where: {},
          offset: 0,
          limit: 1,
        })
        .pipe(
          Effect.map((page) => {
            expect(page).toEqual({ docs: [], total: 0 });
            return null;
          }),
        ),
  });
  const emptyHost = await runEffect(
    makeCmsHost(
      { ...fixture.input, commands: [emptyScan] },
      {
        afterDocumentClosure: (evidence) =>
          Effect.sync(() => {
            emptyEvidence = evidence;
          }),
      },
    ),
  );
  await runEffect(emptyHost.run(emptyHost.newRequestKey(), emptyScan, null));
  expect(emptyEvidence?.dependencies).toEqual([]);
  expect(emptyEvidence?.scans).toEqual([
    expect.objectContaining({ frontier: null }),
  ]);
  const seeded = decodeRows(
    await runEffect(
      fixture.host.run(fixture.host.newRequestKey(), fixture.insert, {
        titles: ["settlement-0", "settlement-1", "settlement-2"],
      }),
    ),
  );
  const [readRow, editedRow, removedRow] = seeded;
  if (
    readRow === undefined ||
    editedRow === undefined ||
    removedRow === undefined
  )
    throw new Error("Missing seeded documents");
  const identity = await runEffect(
    Effect.fromResult(decodeAppDocumentIdentityV1Result(readRow._id)),
  );
  const absent = appDocumentIdV1FromRowIdentity({
    tableId: identity.tableId,
    rowId: AppRowIdHexV1Schema.make("f".repeat(32)),
  });
  const absentBatch = appDocumentIdV1FromRowIdentity({
    tableId: identity.tableId,
    rowId: AppRowIdHexV1Schema.make("e".repeat(32)),
  });
  let calls = 0;
  let transientId: string | undefined;
  const remove = defineCmsCommand({
    name: "settlementRemove",
    mode: "write",
    run: (ctx) =>
      ctx.documents
        .delete(ctx.context, ctx.transactionId, removedRow._id)
        .pipe(Effect.as(null)),
  });
  const decide = defineCmsCommand({
    name: "settlementDecide",
    mode: "write",
    run: Effect.fn("SettlementTest.decide")(function* (ctx) {
      calls++;
      expect(
        yield* ctx.documents.get(ctx.context, ctx.transactionId, readRow._id),
      ).toMatchObject({ title: readRow.title });
      expect(
        yield* ctx.documents.get(ctx.context, ctx.transactionId, absent),
      ).toBeNull();
      expect(
        yield* ctx.documents.get(ctx.context, ctx.transactionId, absent),
      ).toBeNull();
      expect(
        yield* ctx.documents.getMany(ctx.context, ctx.transactionId, "posts", [
          readRow._id,
          absentBatch,
          removedRow._id,
        ]),
      ).toEqual([
        expect.objectContaining({ title: readRow.title }),
        null,
        null,
      ]);
      expect(
        (yield* ctx.documents.find(ctx.context, ctx.transactionId, "posts", {
          where: { title: "not-present" },
          offset: 0,
          limit: 1,
        })).total,
      ).toBe(0);
      const transient = yield* ctx.documents.insert(
        ctx.context,
        ctx.transactionId,
        "posts",
        { title: "transient-claim" },
      );
      if (typeof transient._id !== "string")
        return yield* Effect.fail(cmsError("storedCorruption"));
      transientId = transient._id;
      yield* ctx.documents.delete(
        ctx.context,
        ctx.transactionId,
        transient._id,
      );
      yield* ctx.documents.patch(
        ctx.context,
        ctx.transactionId,
        editedRow._id,
        { title: "settled-title" },
      );
      return { decision: readRow.title };
    }),
  });
  const point = defineCmsCommand({
    name: "settlementPoint",
    mode: "write",
    run: (ctx) =>
      ctx.documents.get(ctx.context, ctx.transactionId, readRow._id),
  });
  const scan = defineCmsCommand({
    name: "settlementScan",
    mode: "write",
    run: (ctx) =>
      ctx.documents
        .find(ctx.context, ctx.transactionId, "posts", {
          where: {},
          offset: 0,
          limit: 1,
        })
        .pipe(Effect.as(null)),
  });
  const unique = defineCmsCommand({
    name: "settlementUnique",
    mode: "write",
    run: (ctx) =>
      ctx.documents.patch(ctx.context, ctx.transactionId, readRow._id, {
        title: readRow.title,
      }),
  });
  const evidence: Evidence[] = [];
  let activeTx: FlarexMetadataTransaction | undefined;
  let fault: "point" | "point-conflict" | "scan" | "unique" | null = null;
  const host = await runEffect(
    makeCmsHost(
      { ...fixture.input, commands: [remove, decide, point, scan, unique] },
      {
        afterAdmission: (tx) =>
          Effect.sync(() => {
            activeTx = tx;
          }),
        afterDocumentClosure: (closed) =>
          Effect.gen(function* () {
            evidence.push(closed);
            if (activeTx === undefined)
              return yield* Effect.fail(cmsError("invalidAuthority"));
            // Fault injection under the real host transaction tests enforcement, not
            // concurrency. The whole injected state must roll back with refusal.
            const where = and(
              eq(fxAppRowCurrent.scopeUuid, fixture.scope.scopeUuid),
              eq(fxAppRowCurrent.tableId, identity.tableId),
              eq(fxAppRowCurrent.rowId, Buffer.from(identity.rowId, "hex")),
            );
            if (fault === "point" || fault === "point-conflict" || fault === "scan") {
              const clock = fixtureState.clock[0];
              const revision = fixtureState.revisions.find((row) =>
                bytesEqualFullScan(
                  row.rowId,
                  Buffer.from(identity.rowId, "hex"),
                ),
              );
              if (clock === undefined || revision === undefined)
                return yield* Effect.fail(cmsError("storedCorruption"));
              const commitSeq = CommitSeqSchema.make(clock.lastCommitSeq + 1n);
              yield* runDrizzleStatementEffect(
                activeTx.insert(fxAppRowRevisions).values({
                  ...revision,
                  prevCommitSeq: revision.commitSeq,
                  commitSeq,
                }),
                (cause) => cmsError("statementFailure", cause),
              );
              yield* runDrizzleStatementEffect(
                activeTx
                  .update(fxAppRowCurrent)
                  .set({ commitSeq })
                  .where(where),
                (cause) => cmsError("statementFailure", cause),
              );
              if (fault === "point-conflict") yield* runDrizzleStatementEffect(
                activeTx.update(fxSystemScopeClocks).set({ lastCommitSeq: commitSeq }).where(
                  eq(fxSystemScopeClocks.scopeUuid, fixture.scope.scopeUuid)),
                cause => cmsError("statementFailure", cause),
              );
            }
            if (fault === "unique")
              yield* runDrizzleStatementEffect(
                activeTx
                  .delete(fxAppUniqueKeys)
                  .where(
                    and(
                      eq(fxAppUniqueKeys.scopeUuid, fixture.scope.scopeUuid),
                      eq(
                        fxAppUniqueKeys.rowId,
                        Buffer.from(identity.rowId, "hex"),
                      ),
                    ),
                  ),
                (cause) => cmsError("statementFailure", cause),
              );
          }),
      },
    ),
  );
  await runEffect(host.run(host.newRequestKey(), remove, null));
  const before = await fixture.inventory();
  let fixtureState = before;
  evidence.length = 0;
  const key = host.newRequestKey();
  expect(await runEffect(host.run(key, decide, null))).toEqual({
    decision: readRow.title,
  });
  const closed = evidence[0];
  if (closed === undefined || transientId === undefined)
    throw new Error("Missing complete contribution");
  expect(closed.dependencies.map((row) => row.documentId).sort()).toEqual(
    [
      readRow._id,
      editedRow._id,
      removedRow._id,
      absent,
      absentBatch,
      transientId,
    ].sort(),
  );
  expect(
    closed.dependencies.find((row) => row.documentId === readRow._id)
      ?.dependency,
  ).toMatchObject({ kind: "appRowPoint", observed: { kind: "present" } });
  expect(
    closed.dependencies.find((row) => row.documentId === removedRow._id)
      ?.dependency,
  ).toMatchObject({ kind: "appRowPoint", observed: { kind: "missing", basis: { kind: "tombstone" } } });
  expect(
    closed.dependencies.find((row) => row.documentId === absent)?.dependency,
  ).toEqual({ kind: "appRowPoint", documentId: absent,
    observed: { kind: "missing", basis: { kind: "noVisibleRevision" } } });
  expect(closed.changes.map((row) => row.documentId)).toEqual([editedRow._id]);
  expect(closed.observedRows.find(row => row.documentId === readRow._id)?.value.title).toBe(readRow.title);
  expect(closed.observedRows.find(row => row.documentId === editedRow._id)?.value.title).toBe("settled-title");
  expect(closed.observedRows.some(row => row.documentId === removedRow._id || row.documentId === transientId)).toBe(false);
  expect(closed.noFinalRows).toEqual([transientId]);
  expect(closed.scans).toEqual([]);
  expect(closed.uniqueReads).toHaveLength(3);
  expect(closed.uniqueReads.every((read) => read.owner === null)).toBe(true);
  const after = await fixture.inventory();
  expect(after.rows).toHaveLength(before.rows.length);
  expect(after.commits).toHaveLength(before.commits.length + 1);
  expect(after.facts).toHaveLength(before.facts.length + 1);
  expect(await runEffect(host.run(key, decide, null))).toEqual({
    decision: readRow.title,
  });
  expect(calls).toBe(1);
  expect(evidence).toHaveLength(1);
  expect(await fixture.inventory()).toEqual(after);
  fixtureState = after;
  for (const [kind, command, reason] of [
    ["point", point, "storedCorruption"],
    ["point-conflict", point, "writeConflict"],
    ["scan", scan, "writeConflict"],
    ["unique", unique, "writeConflict"],
  ] as const) {
    fault = kind;
    const failure = await runEffectFailure(
      host.run(host.newRequestKey(), command, null),
    );
    expect(failure, inspect(failure, { depth: 7 })).toMatchObject({ reason });
    expect(await fixture.inventory()).toEqual(after);
  }
  fault = null;
  const missing = defineCmsCommand({
    name: "settlementMissingLimit",
    mode: "write",
    run: Effect.fn("SettlementTest.missingLimit")(function* (ctx) {
      for (let batch = 0; batch < 9; batch++) {
        const ids = Array.from({ length: 32 }, (_, index) =>
          appDocumentIdV1FromRowIdentity({
            tableId: identity.tableId,
            rowId: AppRowIdHexV1Schema.make(
              (batch * 32 + index).toString(16).padStart(32, "0"),
            ),
          }),
        );
        yield* ctx.documents.getMany(
          ctx.context,
          ctx.transactionId,
          "posts",
          ids,
        );
      }
      return null;
    }),
  });
  const bounded = await runEffect(
    makeCmsHost({ ...fixture.input, commands: [missing] }),
  );
  expect(
    await runEffectFailure(bounded.run(bounded.newRequestKey(), missing, null)),
  ).toMatchObject({ reason: "limitExceeded" });
  expect(await fixture.inventory()).toEqual(after);
}
