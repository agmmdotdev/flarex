import { afterAll, beforeAll, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { eq, sql } from "drizzle-orm";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { fxSystemScopeClocks } from "../src/schema";
import { fxSystemCommitEvents } from "../src/commitEvents/schema";
import { captureRelationalSchemaArtifact } from "../src/relationalSchema/artifact";
import { captureRelationalPhysicalLayout } from "../src/relationalSchema/physical/canonical";
import { registerLocalCommerceProfile, requireCommerceProfile } from "../src/commerceTransaction/profile";
import { defaultCommerceResources } from "../src/commerceTransaction/resources";
import { defineCommerceCommand, type CommerceCommandContext } from "../src/commerceTransaction/commands";
import { commerceError } from "../src/commerceTransaction/model";
import type { LocalCommerceEventPolicy } from "../src/commerceTransaction/host";
import { makeAtomicCommerceHost } from "../src/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../src/atomicCommerce/commands";
import { defineCommerceEventContract } from "../src/atomicCommerce/events";
import { issueRelationalSession, makePostgresRelationalSession, runRelationalSession } from "../src/relationalTransaction/session";
import { RelationalSessionError } from "../src/relationalTransaction/model";
import { makeLocalCommerceHost } from "../src/commerceTransaction/host";
import { commerceHostFixture, type CommerceHostTestFixture } from "./commerceHostFixture";
import { commerceInventory } from "./commerceInventory";
import { createRelationalPGliteFixture } from "./relationalPGliteWorkerTestSupport";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";
import { createFileScopedPostgresFixture } from "./postgresHelpers";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

const cleanup: Array<() => Promise<void>> = [];
let fixture: CommerceHostTestFixture;
const upsert = defineCommerceCommand("upsertRows", "write", (ctx, rows) => ctx.store.write(ctx.manager, "upsert", rows));
const update = defineCommerceCommand("updateRows", "write", (ctx, rows) => ctx.store.write(ctx.manager, "update", rows));
const remove = defineCommerceCommand("removeRows", "write", (ctx, rows) => ctx.store.delete(ctx.manager, rows));
const find = defineCommerceCommand("findRows", "read", ctx => ctx.store.find(ctx.manager, { order: { column: "left_id", direction: "asc" } }));
const softDelete = defineCommerceCommand("softDeleteRows", "write", (ctx, rows) => ctx.store.lifecycle(ctx.manager, "softDelete", rows));
const restore = defineCommerceCommand("restoreRows", "write", (ctx, rows) => ctx.store.lifecycle(ctx.manager, "restore", rows));
const eventSchema = Schema.Struct({ id: Schema.String });
const decodeEvent = Schema.decodeUnknownEffect(eventSchema, { onExcessProperty: "error" });
const observations: Array<Parameters<LocalCommerceEventPolicy["validate"]>[4]> = [];
const policy: LocalCommerceEventPolicy = {
  capture: value => decodeEvent(value).pipe(Effect.mapError(cause => commerceError("unadmittedEvent", cause))),
  validate: Effect.fn(function* (events, facts, _command, _lifecycle, evidence = []) {
    observations.push(evidence);
    expect(evidence.every(row => Object.isFrozen(row.row))).toBe(true);
    expect(evidence.filter(row => row.changed)).toHaveLength(facts.length);
    if (events.length) {
      const expected = evidence.map(row => row.row.id);
      for (const event of events) {
        const value = yield* decodeEvent(event).pipe(Effect.mapError(cause => commerceError("unadmittedEvent", cause)));
        const index = expected.indexOf(value.id);
        if (index < 0) return yield* Effect.fail(commerceError("receiptMismatch"));
        expected.splice(index, 1);
      }
      if (expected.length) return yield* Effect.fail(commerceError("receiptMismatch"));
    }
  }),
  deliver: () => Effect.void,
};
const emitStored = defineCommerceCommand("emitStored", "write", Effect.fn(function* (ctx, rows) {
  const result = yield* ctx.store.write(ctx.manager, "upsert", rows);
  for (const row of result) yield* ctx.captureLocalEvent({ id: row.id });
  return result;
}));
const emitWrong = defineCommerceCommand("emitWrong", "write", Effect.fn(function* (ctx, rows) {
  yield* ctx.store.write(ctx.manager, "upsert", rows);
  yield* ctx.captureLocalEvent({ id: "not-stored" });
  return null;
}));
const restoreEvent = defineCommerceCommand("restoreEvent", "write", Effect.fn(function* (ctx, rows) {
  const result = yield* ctx.store.lifecycle(ctx.manager, "restore", rows);
  for (const row of result) yield* ctx.captureLocalEvent({ id: row.id });
  return result;
}));
const caughtFailure = defineCommerceCommand("caughtFailure", "write", Effect.fn(function* (ctx, rows) {
  yield* ctx.store.write(ctx.manager, "upsert", rows);
  yield* ctx.store.write(ctx.manager, "upsert", [{ left_id: "bad", right_id: "bad", id: "bad", updated_at: "2000-01-01T00:00:00.000Z" }]).pipe(Effect.catch(() => Effect.succeed([])));
  return null;
}));
let escaped: CommerceCommandContext | undefined;
const escape = defineCommerceCommand("escapeContext", "write", ctx => { escaped = ctx; return Effect.succeed(null); });
const commands = [upsert, update, remove, find, softDelete, restore, emitStored, emitWrong, restoreEvent, caughtFailure, escape];
const key = (right: string) => ({ left_id: "shared", right_id: right });
const row = (right: string, id: string) => ({ ...key(right), id, value: { nested: [id] } });

beforeAll(async () => {
  const native = process.env.FLAREX_TEST_DRIVER === "postgres";
  const registerCleanup = (close: () => Promise<void>) => cleanup.push(close);
  const resource = native ? await (async () => {
    const resource = await createFileScopedPostgresFixture(); registerCleanup(resource.dispose);
    return { persistence: resource.persistence, session: makePostgresRelationalSession(resource.persistence) };
  })() : await createRelationalPGliteFixture({ registerCleanup });
  const control = native ? resource.persistence : await createMigratedPGlitePersistence(registerCleanup);
  fixture = await commerceHostFixture(resource.persistence, resource.session, Effect.fn(function* (deploymentId, target) {
    const origin = { kind: "authored", sourceId: "test.declared-key" };
    const implicit = { kind: "implicit", sourceId: "test.declared-key.lifecycle" };
    const artifact = yield* captureRelationalSchemaArtifact({ deploymentId,
      provenance: { kind: "sourceSnapshot", repository: "https://example.com/declared-key", revision: "a".repeat(40), paths: ["model.ts"] },
      schema: { owner: "medusa", lineageId: "declared-key", tables: [{ tableId: "pair", origin,
        columns: [
          ...["left_id", "right_id", "id"].map(columnId => ({ columnId, type: "text", nullable: false, default: { kind: "none" }, origin })),
          { columnId: "value", type: "jsonb", nullable: true, default: { kind: "none" }, origin },
          ...["created_at", "updated_at", "deleted_at"].map(columnId => ({ columnId, type: "timestamptz", nullable: columnId === "deleted_at", default: { kind: columnId === "deleted_at" ? "none" : "currentTimestamp" }, origin: implicit })),
        ], keys: [{ keyId: "pair.primary", kind: "primary", columns: ["left_id", "right_id"], origin }],
        indexes: [{ indexId: "pair.active", kind: "btree", columns: ["deleted_at"], predicate: { kind: "isNull", columnId: "deleted_at" }, origin: implicit }], constraints: [], relationships: [] }],
      capabilities: [
        { capabilityId: "pair.timestamps", kind: "managedTimestamps", createdAtColumn: { tableId: "pair", columnId: "created_at" }, updatedAtColumn: { tableId: "pair", columnId: "updated_at" }, updateBehavior: "currentTimestampOnUpdate", origin: implicit },
        { capabilityId: "pair.lifecycle", kind: "softDelete", deletedAtColumn: { tableId: "pair", columnId: "deleted_at" }, activeRowsIndex: { tableId: "pair", indexId: "pair.active" }, origin: implicit },
      ] },
    });
    const layout = yield* captureRelationalPhysicalLayout({ artifact: artifact.artifact, ...target });
    const profile = yield* registerLocalCommerceProfile(artifact.artifact, layout, "test.pair", [{ tableId: "pair", keyId: "pair.primary", update: "existingPrimaryKey", remove: "declaredKey", lifecycle: "managedSoftDelete", upsert: "activeRow", observeRows: true }], { ...defaultCommerceResources, writeBatchRows: 2 });
    return { profile, initialization: { rows: undefined } };
  }), commands, control, () => policy);
}, 120000);
afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120000);
const write = (command: typeof upsert, input: Parameters<typeof fixture.host.run>[2]) => runEffect(fixture.host.run(fixture.host.newRequestKey(), command, input));

it("uses complete keys for upsert and update; preserves conflict timestamps and owned nested evidence", async () => {
  const input = [row("a", "first-a"), row("b", "first-b")];
  const first = await write(upsert, input);
  const evidence = observations.at(-1);
  input[0]!.value.nested[0] = "caller-mutated";
  expect(evidence?.[0]?.row.value).toEqual({ nested: ["first-a"] });
  const second = await write(upsert, [row("b", "second-b"), row("a", "second-a")]);
  expect(second).toMatchObject([{ id: "second-b" }, { id: "second-a" }]);
  expect(Array.isArray(first) && Array.isArray(second)).toBe(true);
  expect(observations.at(-1)?.every(item => item.operation === "update" && item.changed)).toBe(true);
  expect(observations.at(-1)?.map(item => item.row.created_at)).toEqual([evidence?.[1]?.row.created_at, evidence?.[0]?.row.created_at]);
  expect(observations.at(-1)?.map(item => item.row.updated_at)).toEqual([evidence?.[1]?.row.updated_at, evidence?.[0]?.row.updated_at]);
  await write(update, [{ ...key("a"), id: "updated-a" }]);
  expect(await runEffect(fixture.host.read(find, null))).toMatchObject([{ id: "updated-a" }, { id: "second-b" }]);
});

it("distinguishes mixed and unchanged restores without timestamp or fact fabrication", async () => {
  await write(softDelete, [key("a")]);
  const deleted = observations.at(-1)?.[0]?.row;
  expect(deleted?.deleted_at).toEqual(expect.any(String));
  const before = await commerceInventory(fixture);
  await write(restore, [key("b"), key("a")]);
  const after = await commerceInventory(fixture);
  expect(after.facts.slice(before.facts.length)).toHaveLength(1);
  expect(observations.at(-1)?.filter(value => value.changed)).toHaveLength(1);
  await write(restoreEvent, [key("a"), key("b")]);
  const repeated = await commerceInventory(fixture);
  expect(repeated.facts).toEqual(after.facts);
  expect(repeated.tables).toEqual(after.tables);
  expect(observations.at(-1)?.every(value => value.operation === "restore" && !value.changed)).toBe(true);
});

it("reattaches with a replacement non-key ID and removes only the exact pair", async () => {
  await write(softDelete, [key("a")]);
  const deleted = observations.at(-1)?.[0]?.row;
  await write(upsert, [row("a", "reattached")]);
  expect(observations.at(-1)?.[0]?.row).toMatchObject({ id: "reattached", deleted_at: null, created_at: deleted?.created_at, updated_at: deleted?.updated_at });
  await write(remove, [key("a")]);
  expect(await runEffect(fixture.host.read(find, null))).toMatchObject([{ id: "second-b" }]);
  expect(observations.at(-1)).toEqual([]); // read commands cannot fabricate write evidence
});

it("rejects duplicate keys across chunks, managed input, missing keys and late caught failure atomically", async () => {
  const before = await commerceInventory(fixture);
  for (const input of [[row("x", "x"), row("y", "y"), row("x", "duplicate")],
    [{ ...row("x", "x"), updated_at: "2000-01-01T00:00:00.000Z" }], [{ ...row("x", "x"), deleted_at: null }]]) {
    await runEffectFailure(fixture.host.run(fixture.host.newRequestKey(), upsert, input));
    expect(await commerceInventory(fixture)).toEqual(before);
  }
  for (const command of [update, restore, softDelete, remove]) {
    await runEffectFailure(fixture.host.run(fixture.host.newRequestKey(), command, [key("b"), key("missing")]));
    expect(await commerceInventory(fixture)).toEqual(before);
  }
  expect(await runEffectFailure(fixture.host.run(fixture.host.newRequestKey(), upsert, [row("x", "must-rollback"), { ...key("y"), value: null }]))).toMatchObject({ reason: "statementFailure" });
  expect(await commerceInventory(fixture)).toEqual(before);
  // The first refusal closes the borrowed context; catching it cannot reopen
  // the context for the host's final result capture or settle the earlier row.
  expect(await runEffectFailure(fixture.host.run(fixture.host.newRequestKey(), caughtFailure, [row("x", "caught")]))).toMatchObject({ reason: "closed" });
  expect(await commerceInventory(fixture)).toEqual(before);
});

it("uses storage evidence for non-key event IDs and seals escaped contexts", async () => {
  const before = await commerceInventory(fixture);
  expect(await runEffectFailure(fixture.host.run(fixture.host.newRequestKey(), emitWrong, [row("wrong", "real-id")]))).toMatchObject({ reason: "receiptMismatch" });
  expect(await commerceInventory(fixture)).toEqual(before);
  await write(escape, null);
  if (escaped === undefined) throw new Error("Missing escaped context witness");
  await runEffectFailure(escaped.store.write(escaped.manager, "upsert", [row("escaped", "forbidden")]));
  expect((await commerceInventory(fixture)).tables).toEqual(before.tables);
});

it("captures profile capabilities and refuses malformed or ungranted contracts", async () => {
  const { artifact, layout } = fixture.descriptor;
  const entries = [{ tableId: "pair", keyId: "pair.primary", observeRows: true as const }];
  const selected = await runEffect(registerLocalCommerceProfile(artifact, layout, "test.observe", entries));
  entries[0]!.tableId = "caller-mutated";
  expect((await runEffect(requireCommerceProfile(selected))).tables[0]?.tableId).toBe("pair");
  for (const entry of [
    { tableId: "pair", keyId: "pair.primary", upsert: "arbitrary" },
    { tableId: "pair", keyId: "pair.primary", observeRows: false },
    { tableId: "pair", keyId: "pair.primary", extra: true },
  ]) {
    // Deliberate unknown-input profile boundary, not a command capability cast.
    expect(await runEffectFailure(registerLocalCommerceProfile(artifact, layout, "test.invalid", [entry as Parameters<typeof registerLocalCommerceProfile>[3][number]]))).toMatchObject({ reason: "unsupportedProfile" });
  }
});

it("serializes concurrent replacement and recovers a lost acknowledgement without another upsert", async () => {
  const before = await commerceInventory(fixture);
  const values = await Promise.all([write(upsert, [row("parallel", "parallel-a")]), write(upsert, [row("parallel", "parallel-b")])]);
  expect(values).toHaveLength(2);
  const after = await commerceInventory(fixture);
  expect(after.facts.slice(before.facts.length).map(fact => fact.operation)).toEqual(["insert", "update"]);
  let lose = true;
  let executions = 0;
  const session = issueRelationalSession(fixture.persistence.drizzle, work => runRelationalSession(fixture.session, work).pipe(
    Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))),
    Effect.flatMap(value => {
      if (!lose) return Effect.succeed(value);
      lose = false;
      return Effect.fail(new RelationalSessionError({ reason: "decisionUncertain", cause: new Error("Lost upsert COMMIT acknowledgement") }));
    }),
  ));
  const counted = defineCommerceCommand("countedUpsert", "write", Effect.fn(function* (ctx) { executions++; return yield* ctx.store.write(ctx.manager, "upsert", [row("recovery", "retained")]); }));
  const opened = await runEffect(makeLocalCommerceHost({ ...fixture.hostInput, session, commands: [counted] }, policy));
  const request = opened.host.newRequestKey();
  const result = await runEffect(opened.host.run(request, counted, null));
  const retained = await commerceInventory(fixture);
  expect(await runEffect(opened.host.run(request, counted, null))).toEqual(result);
  expect(executions).toBe(1);
  expect(retained.facts.length).toBe(after.facts.length + 1);
  expect(await commerceInventory(fixture)).toEqual(retained);
});

it("publishes operation-local IDs atomically, supports event-only restore and replays once", async () => {
  const participant = defineAtomicCommerceParticipant("neutralPair");
  const event = defineCommerceEventContract({ name: "neutral.pair", revision: "a".repeat(64), internal: true, decode: policy.capture });
  const command = defineAtomicCommerceCommand("pairAtomic", Effect.fn(function* (ctx) {
    const first = yield* ctx.call(participant, emitStored, [row("atomic", "first-id")]);
    const second = yield* ctx.call(participant, emitStored, [row("atomic", "second-id")]);
    yield* ctx.call(participant, restoreEvent, [key("atomic")]);
    return { first, second };
  }));
  const noChange = defineAtomicCommerceCommand("pairNoChange", ctx => ctx.call(participant, restoreEvent, [key("atomic")]));
  const wrong = defineAtomicCommerceCommand("pairWrong", ctx => ctx.call(participant, emitWrong, [row("atomic", "forbidden")]));
  const host = await runEffect(makeAtomicCommerceHost({ ...fixture.hostInput, commands: [command, noChange, wrong], participants: [{ participant, profile: fixture.prepared.profile, installation: fixture.installation, commands, validate: policy.validate, events: { contracts: [event], select: () => Effect.succeed(event) } }],
    events: { producerRevision: "a".repeat(64), contracts: [event], subscribers: [{ id: "neutral", revision: "a".repeat(64) }], validate: () => Effect.void } }));
  const before = await commerceInventory(fixture);
  const request = host.newRequestKey();
  const result = await runEffect(host.run(request, command, null));
  const after = await commerceInventory(fixture);
  expect(after.facts.slice(before.facts.length)).toHaveLength(2);
  const messages = () => fixture.persistence.drizzle.select().from(fxSystemCommitEvents).orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal);
  const retained = await messages();
  expect(retained.map(item => item.envelope.message)).toEqual([{ id: "first-id" }, { id: "second-id" }, { id: "second-id" }]);
  expect(new Set(retained.map(item => item.commitSeq)).size).toBe(1);
  expect(await runEffect(host.run(request, command, null))).toEqual(result);
  expect(await commerceInventory(fixture)).toEqual(after);
  expect(await messages()).toEqual(retained);
  expect(await runEffectFailure(host.run(host.newRequestKey(), wrong, null))).toMatchObject({ reason: "receiptMismatch" });
  expect(await commerceInventory(fixture)).toEqual(after);
  expect(await messages()).toEqual(retained);
  await runEffect(host.run(host.newRequestKey(), noChange, null));
  const onlyEvent = await commerceInventory(fixture);
  expect(onlyEvent.facts).toEqual(after.facts);
  expect(onlyEvent.tables).toEqual(after.tables);
  expect(onlyEvent.commits.length).toBe(after.commits.length + 1);
  expect(await messages()).toHaveLength(retained.length + 1);
});

it("confines colliding composite keys to the admitted scope", async () => {
  const foreign = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const clock = (await fixture.persistence.drizzle.select().from(fxSystemScopeClocks))[0];
  if (clock === undefined) throw new Error("Missing clock");
  await fixture.persistence.drizzle.insert(fxSystemScopeClocks).values({ scopeId: ScopeIdSchema.make("scope_" + foreign), epoch: clock.epoch, storageGeneration: clock.storageGeneration });
  const table = fixture.descriptor.layout.frame.tables[0];
  if (table === undefined) throw new Error("Missing table");
  const column = (id: string) => {
    const field = table.columns.find(value => value.identity.columnId === id);
    if (field === undefined) throw new Error("Missing physical column " + id);
    return sql.identifier(field.name);
  };
  const target = sql`${sql.identifier(fixture.descriptor.layout.frame.targetNamespace.schemaName)}.${sql.identifier(table.name)}`;
  await fixture.persistence.drizzle.execute(sql`insert into ${target} (scope_uuid, ${column("left_id")}, ${column("right_id")}, ${column("id")}) values (${foreign}::uuid, 'shared', 'b', 'foreign')`);
  await write(upsert, [row("b", "owned")]);
  await write(softDelete, [key("b")]);
  const actual = await fixture.persistence.drizzle.execute(sql`select ${column("id")} as id, ${column("deleted_at")} as deleted_at from ${target} where scope_uuid = ${foreign}::uuid`);
  expect("rows" in actual ? actual.rows : actual).toMatchObject([{ id: "foreign", deleted_at: null }]);
  await fixture.persistence.drizzle.execute(sql`delete from ${target} where scope_uuid = ${foreign}::uuid`);
  await fixture.persistence.drizzle.delete(fxSystemScopeClocks).where(eq(fxSystemScopeClocks.scopeId, ScopeIdSchema.make("scope_" + foreign)));
});
