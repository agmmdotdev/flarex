import { Deferred, Effect, Fiber, Result, Schema } from "effect";
import { expect, vi } from "vitest";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import type { JsonObject } from "flarex-protocol/json";
import { defineCommerceCommand, makeCommerceHost } from "../../../src/frameworks/commerceTransaction/host";
import { makeAtomicCommerceHost } from "../../../src/frameworks/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../src/frameworks/atomicCommerce/commands";
import { commerceError } from "../../../src/frameworks/commerceTransaction/model";
import { defaultCommerceResources } from "../../../src/frameworks/commerceTransaction/resources";
import { capturePrivateCanonicalValue } from "../../../src/installation/frameworkSchema/privateCanonicalValue";
import { prepareNeutralLogicalFixture } from "./neutralLogicalFixture";
import * as contribution from "../../../src/storage/documents/logicalDocuments/contribution";
import { lockInstallationForCurrentTransaction, closeInstallationAdmission } from "../../../src/installation/installationLifecycle";
import { lockScopeClockRowsForOrdinaryWriteInTransactionEffect, closeExactAttemptScopeClockObservation } from "../../../src/scope/scopeClock";

const tables = ["batch", "pending", "rollback", "replay", "concurrent", "exhausted", "negative", "bounded"] as const;
const decodeInput = Schema.decodeUnknownEffect(Schema.Struct({ table: Schema.Literals(tables), rows: Schema.Array(Schema.JsonObject) }), { onExcessProperty: "error" });
const decodeReadRows = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));
export function serialSchemaInput() {
  const origin = { kind: "synthetic", sourceId: "neutral.serial" }, implicit = { kind: "implicit", sourceId: "neutral.serial.stamps" };
  return { owner: "medusa", lineageId: "neutral.serial", tables: tables.map(tableId => ({ tableId, origin, columns: [
    { columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
    ...["ticket", "other"].map(columnId => ({ columnId, type: "integer", nullable: false, default: { kind: "serialNext" }, origin })),
    ...["created_at", "updated_at"].map(columnId => ({ columnId, type: "timestamptz", nullable: false, default: { kind: "currentTimestamp" }, origin: implicit })),
    { columnId: "deleted_at", type: "timestamptz", nullable: true, default: { kind: "none" }, origin: implicit },
  ], keys: [{ keyId: tableId + ".primary", kind: "primary", columns: ["id"], origin }],
  indexes: [{ indexId: tableId + ".active", kind: "btree", columns: ["deleted_at"], predicate: { kind: "isNull", columnId: "deleted_at" }, origin: implicit }],
  constraints: [], relationships: [] })), capabilities: tables.flatMap(tableId => [
    { capabilityId: tableId + ".stamps", kind: "managedTimestamps", createdAtColumn: { tableId, columnId: "created_at" }, updatedAtColumn: { tableId, columnId: "updated_at" },
      updateBehavior: "currentTimestampOnUpdate", origin: implicit },
    { capabilityId: tableId + ".deleted", kind: "softDelete", deletedAtColumn: { tableId, columnId: "deleted_at" }, activeRowsIndex: { tableId, indexId: tableId + ".active" }, origin: implicit },
  ]) };
}

/** Constants characterize the native max-plus-one contract. Every allocation,
 * dependency, conflict and rollback is performed by the accepting store. */
export async function serialScenario(driver: "pglite" | "postgres", finiteCapture = false) {
  const cleanup: Array<() => Promise<void>> = [];
  try {
    const schema = Result.getOrThrow(normalizeRelationalSchema(serialSchemaInput())), evidence = { kind: "synthetic", sourceId: "neutral.serial" };
    const source = await Effect.runPromise(captureLogicalSchemaSource({ key: "medusa.neutral-serial", owner: "medusa", writeProfile: "medusa.neutral-serial", evidence,
      definition: { kind: "relational", schema }, bindings: schema.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
        table: { namespace: "medusa", logicalName: schema.coordinate.lineageId + "/" + table.identity.tableId } })) }));
    const fixture = await prepareNeutralLogicalFixture(driver, close => cleanup.push(close), { name: "neutral-serial", sources: [source], ...(finiteCapture ? { finiteCapture: true } : {}) });
    if (driver === "postgres") expect((await fixture.persistence.query<{ ordinary: boolean }>(
      "select not (rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls) as ordinary from pg_roles where rolname=current_user")).rows).toEqual([{ ordinary: true }]);
    const insert = defineCommerceCommand("neutralSerialInsert", "write", (ctx, input) => Effect.gen(function* () {
      const value = yield* decodeInput(input).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
      return [...yield* (yield* ctx.table(value.table)).write(ctx.manager, "insert", value.rows)];
    }));
    const read = defineCommerceCommand("neutralSerialRead", "read", (ctx, input) => Effect.gen(function* () {
      const table = yield* Schema.decodeUnknownEffect(Schema.Literals(tables))(input).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
      return [...yield* (yield* ctx.table(table)).find(ctx.manager, { order: { column: "id", direction: "asc" } })];
    }));
    const pending = defineCommerceCommand("neutralSerialPending", "write", ctx => Effect.gen(function* () {
      const store = yield* ctx.table("pending");
      const first = yield* store.write(ctx.manager, "insert", [{ id: "p1", ticket: 5, other: 0 }, { id: "p2" }]);
      expect(first.map(row => [row.ticket, row.other])).toEqual([[5, 0], [6, 1]]);
      yield* store.write(ctx.manager, "update", [{ id: "p1", ticket: 100 }]);
      expect(yield* store.write(ctx.manager, "insert", [{ id: "p3" }])).toMatchObject([{ ticket: 101, other: 2 }]);
      yield* store.delete(ctx.manager, [{ id: "p3" }]);
      expect(yield* store.write(ctx.manager, "insert", [{ id: "p4" }])).toMatchObject([{ ticket: 101, other: 2 }]);
      yield* store.lifecycle(ctx.manager, "softDelete", [{ id: "p4" }]);
      return [...yield* store.write(ctx.manager, "insert", [{ id: "p5" }])];
    }));
    const abort = defineCommerceCommand("neutralSerialAbort", "write", ctx => Effect.gen(function* () {
      yield* (yield* ctx.table("rollback")).write(ctx.manager, "insert", [{ id: "rolled-back" }]);
      return yield* ctx.refuse(commerceError("invalidInput", "Deliberate late failure"));
    }));
    const removeMax = defineCommerceCommand("neutralSerialRemoveMax", "write", ctx => Effect.gen(function* () {
      yield* (yield* ctx.table("exhausted")).delete(ctx.manager, [{ id: "max" }]);
      return null;
    }));
    const rows: readonly [] = [];
    const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows }, 1_048_576,
      { invalidInput: () => new Error("Invalid neutral serial dataset"), hashFailure: cause => new Error("Neutral serial dataset hash", { cause }) }));
    const input = { ...fixture.hostInput, commands: [insert, read, pending, abort, removeMax], identityAndAccessPolicy: { profile: "neutral-serial" },
      logicalStorage: { ...fixture.hostInput.logicalStorage, source: { sourceKey: source.key, writeProfile: source.writeProfile, schema, evidence },
        initialization: { stepId: "neutral-serial-initial", datasetSha256: dataset.sha256Hex, expectedRowCount: 0 } } };
    const host = await Effect.runPromise(makeCommerceHost(input)); cleanup.push(() => Effect.runPromise(host.close)); await Effect.runPromise(host.initialize(rows));
    const run = (table: typeof tables[number], rows: readonly JsonObject[]) => host.run(host.newRequestKey(), insert, { table, rows });
    expect(await Effect.runPromise(run("batch", [{ id: "b1" }, { id: "b2", ticket: null }, { id: "b3", ticket: 17, other: -10 }, { id: "b4" }])))
      .toMatchObject([{ ticket: 1, other: 1 }, { ticket: 2, other: 2 }, { ticket: 17, other: -10 }, { ticket: 18, other: 3 }]);
    expect(await Effect.runPromise(host.run(host.newRequestKey(), pending, null))).toMatchObject([{ ticket: 102, other: 3 }]);
    expect(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), abort, null)))).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    expect(await Effect.runPromise(run("rollback", [{ id: "after-rollback" }]))).toMatchObject([{ ticket: 1, other: 1 }]);
    const replayKey = host.newRequestKey(), replayInput = { table: "replay", rows: [{ id: "once" }] };
    const original = await Effect.runPromise(host.run(replayKey, insert, replayInput));
    expect(await Effect.runPromise(host.run(replayKey, insert, replayInput))).toEqual(original);
    expect(await Effect.runPromise(run("replay", [{ id: "twice" }]))).toMatchObject([{ ticket: 2, other: 2 }]);
    expect(await Effect.runPromise(run("negative", [{ id: "negative-explicit", ticket: -10, other: -2147483648 }, { id: "negative-generated" }])))
      .toMatchObject([{ ticket: -10, other: -2147483648 }, { ticket: -9, other: -2147483647 }]);
    await Effect.runPromise(run("exhausted", [{ id: "max", ticket: 2147483647 }]));
    expect(await Effect.runPromise(Effect.result(run("exhausted", [{ id: "overflow" }])))).toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
    expect(await Effect.runPromise(host.read(read, "exhausted"))).toMatchObject([{ id: "max", ticket: 2147483647 }]);
    await Effect.runPromise(host.run(host.newRequestKey(), removeMax, null));
    expect(await Effect.runPromise(run("exhausted", [{ id: "after-delete" }]))).toMatchObject([{ ticket: 1, other: 1 }]);
    // Both genuine allocators observe the same empty identity range before
    // either settles. The retained contribution must conflict after the other
    // root commits, proving that this allocation path records the dependency.
    if (driver === "postgres") await Effect.runPromise(Effect.gen(function* () {
      const reached = yield* Deferred.make<void>(), resume = yield* Deferred.make<void>();
      const participant = defineAtomicCommerceParticipant("neutralSerialRace");
      const paused = defineCommerceCommand("neutralSerialPaused", "write", ctx => Effect.gen(function* () {
        const rows = yield* (yield* ctx.table("concurrent")).write(ctx.manager, "insert", [{ id: "concurrent-a" }]);
        expect(rows).toMatchObject([{ ticket: 1, other: 1 }]);
        yield* Deferred.succeed(reached, undefined); yield* Deferred.await(resume);
        return [...rows];
      }));
      const pausedRoot = defineAtomicCommerceCommand("neutralSerialPausedRoot", ctx => ctx.call(participant, paused, null));
      const insertRoot = defineAtomicCommerceCommand("neutralSerialInsertRoot", (ctx, value) => ctx.call(participant, insert, value));
      yield* Effect.acquireUseRelease(makeAtomicCommerceHost({ ...input, commands: [pausedRoot, insertRoot],
        participants: [{ participant, logicalStorage: input.logicalStorage, commands: [paused, insert], validateLogicalCall: () => Effect.void }] }),
      racing => Effect.gen(function* () {
        const pending = yield* Effect.forkChild(Effect.result(racing.run(racing.newRequestKey(), pausedRoot, null)));
        yield* Effect.gen(function* () {
          yield* Deferred.await(reached);
          expect(yield* racing.run(racing.newRequestKey(), insertRoot, { table: "concurrent", rows: [{ id: "concurrent-b" }] }))
            .toMatchObject([{ ticket: 1, other: 1 }]);
          yield* Deferred.succeed(resume, undefined);
          expect(yield* Fiber.join(pending)).toMatchObject({ _tag: "Failure", failure: { reason: "writeConflict" } });
          expect(yield* racing.run(racing.newRequestKey(), insertRoot, { table: "concurrent", rows: [{ id: "concurrent-a" }] }))
            .toMatchObject([{ ticket: 2, other: 2 }]);
        }).pipe(Effect.ensuring(Effect.gen(function* () {
          yield* Deferred.succeed(resume, undefined);
          yield* Fiber.interrupt(pending);
        })));
      }), racing => racing.close);
    }));
    else {
      // PGlite owns one serialized transaction lease. Capture the genuine
      // allocator's dependency vector before deliberately aborting settlement,
      // then validate it unchanged after a separate real writer commits.
      type Validation = Parameters<typeof contribution.validateLogicalDocumentChanges>[0];
      const captured: { value: Pick<Validation, "scopeId" | "tables" | "maximumIndexEntries"> & {
        closed: Parameters<typeof contribution.validateLogicalDocumentChanges>[1];
      } | null } = { value: null };
      const validate = contribution.validateLogicalDocumentChanges;
      const spy = vi.spyOn(contribution, "validateLogicalDocumentChanges").mockImplementation((validation, closed) =>
        validate(validation, closed).pipe(Effect.flatMap(() => Effect.gen(function* () {
          captured.value = { scopeId: validation.scopeId, tables: new Set(validation.tables),
            maximumIndexEntries: validation.maximumIndexEntries, closed };
          return yield* Effect.fail(validation.error("invalidInput", "Deliberate serial capture abort"));
        }))));
      try {
        expect(await Effect.runPromise(Effect.result(run("concurrent", [{ id: "concurrent-a" }]))))
          .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
      } finally { spy.mockRestore(); }
      const snapshot = captured.value;
      if (snapshot === null) throw new Error("Missing actual generated serial dependency capture");
      expect(snapshot.closed.indexReads).toHaveLength(1);
      expect(snapshot.closed.indexReads[0]?.entries).toEqual([]);
      expect(await Effect.runPromise(run("concurrent", [{ id: "concurrent-b" }])))
        .toMatchObject([{ ticket: 1, other: 1 }]);
      const stale = await fixture.persistence.drizzle.transaction(async tx => {
        await Effect.runPromise(lockInstallationForCurrentTransaction(tx));
        try {
          await Effect.runPromise(lockScopeClockRowsForOrdinaryWriteInTransactionEffect(tx, snapshot.scopeId));
          return await Effect.runPromise(Effect.result(contribution.validateLogicalDocumentReadDependencies({ tx,
            scopeId: snapshot.scopeId, tables: snapshot.tables, maximumIndexEntries: snapshot.maximumIndexEntries,
            error: (reason, cause): { reason: typeof reason; cause?: unknown; observation?: contribution.LogicalDocumentConflictObservation } => ({ reason, cause }),
            conflict: observation => ({ reason: "writeConflict" as const, observation }),
          }, snapshot.closed)));
        } finally { closeExactAttemptScopeClockObservation(tx); closeInstallationAdmission(tx); }
      });
      expect(stale).toMatchObject({ _tag: "Failure", failure: { reason: "writeConflict", observation: { readKind: "indexRange" } } });
      expect(await Effect.runPromise(run("concurrent", [{ id: "concurrent-a" }])))
        .toMatchObject([{ ticket: 2, other: 2 }]);
    }
    const allocated = decodeReadRows(await Effect.runPromise(host.read(read, "concurrent")));
    expect(allocated).toHaveLength(2);
    expect(allocated.map(row => row.ticket).sort()).toEqual([1, 2]);
    expect(allocated.map(row => row.other).sort()).toEqual([1, 2]);
    await Effect.runPromise(run("bounded", [{ id: "bounded-1", ticket: 1, other: 1 }, { id: "bounded-2", ticket: 2, other: 2 }, { id: "bounded-3", ticket: 3, other: 3 }]));
    const bounded = await Effect.runPromise(makeCommerceHost({ ...input, logicalResources: { ...defaultCommerceResources, catalogRows: 2, queryRows: 2, writeBatchRows: 2 } }));
    cleanup.push(() => Effect.runPromise(bounded.close));
    expect(await Effect.runPromise(Effect.result(bounded.run(bounded.newRequestKey(), insert, { table: "bounded", rows: [{ id: "must-refuse" }] }))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
    expect(await Effect.runPromise(host.read(read, "bounded"))).toHaveLength(3);
  } finally { for (const close of cleanup.reverse()) await close(); }
}
