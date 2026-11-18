import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { count, eq, sql } from "drizzle-orm";
import { Cause, Effect, Exit, Schema } from "effect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApplicationMutationRoot, type ApplicationMutationRoot } from "../src/application-root.ts";
import { createApplicationStorage } from "../src/application-storage.ts";
import { createGroupRoot } from "../src/group-root.ts";
import { compileDefinition, type Definition } from "../src/definition.ts";
import type { Command, Snapshot } from "../src/persistence.ts";
import { createBudget } from "../src/budget.ts";
import { fixture, type Fixture } from "./fixture.ts";
import { startPostgres } from "./postgres.ts";
import * as tables from "../src/schema.ts";

const generation = vi.hoisted(() => {
  const state: { next: ReturnType<typeof randomUUID> | undefined } = { next: undefined }; return state;
});
vi.mock("node:crypto", async importOriginal => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, randomUUID: (...args: Parameters<typeof actual.randomUUID>) => {
    const next = generation.next; generation.next = undefined;
    return next ?? actual.randomUUID(...args);
  } };
});

const reason = <A, E>(exit: Exit.Exit<A, E>) => Exit.isFailure(exit) ? Cause.findErrorOption(exit.cause) : null;
type Opened = { command: Command; snapshot: Snapshot; root: ApplicationMutationRoot };
type Storage = ReturnType<typeof createApplicationStorage>;
const barrier = () => {
  let ready = () => {}; let release = () => {};
  const started = new Promise<void>(resolve => { ready = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  return { ready, release, started, gate };
};
const waitingForLock = async (database: Fixture) => {
  const locks = Schema.decodeUnknownSync(Schema.Struct({ rows: Schema.Array(Schema.Struct({ n: Schema.Number })) }));
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (locks(await database.admin(db => db.execute(sql`select count(*)::integer as n from pg_stat_activity
      where application_name = ${database.role} and wait_event_type = 'Lock'`))).rows[0]?.n === 1) return;
    await delay(5);
  }
  throw new Error("Expected the serving role to wait for the held definition lock");
};
const insert = (opened: Opened, name = "new") => Effect.runPromise(opened.root.insert({ name, priority: 1 }));
const accept = async (storage: Storage, opened: Opened) => {
  const candidate = await Effect.runPromise(opened.root.freeze());
  return Effect.runPromise(storage.accept(opened.command, candidate.changes, candidate.dependencies, null));
};

describe.each(["pglite", "postgres"] as const)("batched generated identities (%s)", driver => {
  let postgres: Awaited<ReturnType<typeof startPostgres>> | undefined;
  beforeAll(async () => { if (driver === "postgres") postgres = await startPostgres(); });
  afterAll(async () => { if (postgres !== undefined) await postgres.close(); });
  const withDatabase = async (work: (database: Fixture, storage: Storage, definition: Definition, open: () => Promise<Opened>) => Promise<void>) => {
    const database = await fixture(postgres?.connectionString); const opened: Opened[] = [];
    try {
      const definition = await Effect.runPromise(Effect.fromResult(compileDefinition({ table: "tasks", tableId: 7,
        fields: [{ name: "name", kind: "text", unique: true }, { name: "priority", kind: "number", unique: false }],
        indexes: [{ name: "by_priority", field: "priority" }] })));
      await database.admin(db => db.insert(tables.definitions).values({ table: definition.table, version: definition.version,
        fields: definition.fields, indexes: definition.indexes, equalities: definition.equalities }));
      const storage = createApplicationStorage(database.persistence);
      const open = async () => {
        const command = await Effect.runPromise(storage.openMutation("shop-a", randomUUID(), randomUUID(), definition, randomUUID()));
        const snapshot = await Effect.runPromise(storage.commandSnapshot(command));
        const root = await Effect.runPromise(createApplicationMutationRoot(definition, storage, snapshot));
        const value = { command, snapshot, root }; opened.push(value); return value;
      };
      await work(database, storage, definition, open);
    } finally {
      generation.next = undefined;
      try { for (const value of opened) {
        await Effect.runPromise(value.root.close); await Effect.runPromise(database.persistence.closeSnapshot(value.snapshot));
        await Effect.runPromise(database.persistence.abort(value.command));
      } } finally { await database.close(); }
    }
  };

  it.each([false, true])("refuses an older generated-ID collision, tombstone=%s", async tombstone => withDatabase(async (database, storage, _definition, open) => {
    const first = await open(); const uuid = randomUUID(); generation.next = uuid;
    const id = await insert(first, "original"); expect(id).toBe(`7:${uuid}`); await accept(storage, first);
    if (tombstone) {
      const removal = await open(); await Effect.runPromise(removal.root.delete(id)); await accept(storage, removal);
    }
    const collision = await open(); generation.next = uuid;
    expect(await insert(collision, "collision")).toBe(id);
    expect(reason(await Effect.runPromiseExit(collision.root.freeze()))).toMatchObject({ value: { reason: "conflict" } });
    const rows = await database.admin(db => db.select().from(tables.documents).where(eq(tables.documents.id, id)));
    expect(rows).toEqual(tombstone ? [] : [expect.objectContaining({ body: expect.objectContaining({ name: "original" }) })]);
    expect(await database.admin(db => db.select().from(tables.history).where(eq(tables.history.id, id)))).toHaveLength(tombstone ? 2 : 1);
  }));

  it("refuses duplicate local generation and retains the sticky failure", async () => withDatabase(async (_database, _storage, _definition, open) => {
    const opened = await open(); const uuid = randomUUID(); generation.next = uuid; await insert(opened, "first");
    generation.next = uuid;
    expect(reason(await Effect.runPromiseExit(opened.root.insert({ name: "second", priority: 2 })))).toMatchObject({ value: { reason: "conflict" } });
    expect(reason(await Effect.runPromiseExit(opened.root.freeze()))).toMatchObject({ value: { reason: "conflict" } });
  }));

  it("uses one freeze transaction for 64 intents and publishes exact absent dependencies", async () => withDatabase(async (database, storage, _definition, open) => {
    const opened = await open(); const operations = database.persistence.metrics.operations; const ids: string[] = [];
    for (let index = 0; index < 64; index++) ids.push(await insert(opened, `batch-${index}`));
    expect(database.persistence.metrics.operations).toBe(operations);
    const candidate = await Effect.runPromise(opened.root.freeze());
    expect(database.persistence.metrics.operations).toBe(operations + 1);
    expect(candidate.dependencies).toEqual(ids.map(id => ({ kind: "point", id, revision: null, tombstone: false })));
    expect(opened.root.diagnostics().read).toEqual({ rows: 64, bytes: 0, dependencies: 64 });
    expect(reason(await Effect.runPromiseExit(opened.root.insert({ name: "late", priority: 1 })))).toMatchObject({ value: { reason: "closed" } });
    await Effect.runPromise(storage.accept(opened.command, candidate.changes, candidate.dependencies, null));
    expect(await database.admin(db => db.select({ n: count() }).from(tables.documents))).toEqual([{ n: 64 }]);
    expect(await database.admin(db => db.select({ n: count() }).from(tables.history))).toEqual([{ n: 64 }]);
  }));

  it("checks the last identity of a full batch", async () => withDatabase(async (_database, storage, _definition, open) => {
    const original = await open(); const uuid = randomUUID(); generation.next = uuid; await insert(original, "original"); await accept(storage, original);
    const batch = await open();
    for (let index = 0; index < 63; index++) await insert(batch, `batch-${index}`);
    generation.next = uuid; await insert(batch, "collision-last");
    expect(reason(await Effect.runPromiseExit(batch.root.freeze()))).toMatchObject({ value: { reason: "conflict" } });
  }));

  it("isolates identity history by both scope and table", async () => withDatabase(async (database, storage, _definition, open) => {
    const opened = await open(); const id = await insert(opened);
    await database.admin(db => db.insert(tables.history).values([
      { scope: "another-shop", table: "tasks", id, commitSeq: 0, body: null },
      { scope: "shop-a", table: "news-items", id, commitSeq: 0, body: null },
    ]));
    await accept(storage, opened);
    expect(await database.admin(db => db.select().from(tables.documents))).toEqual([expect.objectContaining({ id, table: "tasks", scope: "shop-a" })]);
  }));

  it("keeps pending edits, local deletion and original absence coherent", async () => withDatabase(async (database, storage, _definition, open) => {
    const opened = await open(); const id = await insert(opened); const removed = await insert(opened, "removed");
    await Effect.runPromise(opened.root.patch(id, { priority: 5 }));
    await Effect.runPromise(opened.root.replace(id, { name: "replaced", priority: 7 }));
    expect(await Effect.runPromise(opened.root.get(id))).toMatchObject({ id, name: "replaced", priority: 7 });
    await Effect.runPromise(opened.root.delete(removed)); expect(await Effect.runPromise(opened.root.get(removed))).toBeNull();
    const candidate = await Effect.runPromise(opened.root.freeze());
    expect(candidate.dependencies).toEqual([id, removed].map(value => ({ kind: "point", id: value, revision: null, tombstone: false })));
    expect(candidate.changes).toEqual([expect.objectContaining({ id, before: null, body: expect.objectContaining({ name: "replaced" }) })]);
    await Effect.runPromise(storage.accept(opened.command, candidate.changes, candidate.dependencies, null));
    expect(await database.admin(db => db.select().from(tables.history).where(eq(tables.history.id, removed)))).toEqual([]);
  }));

  it("validates an inserted-then-deleted identity even with no final write", async () => withDatabase(async (_database, storage, _definition, open) => {
    const first = await open(); const uuid = randomUUID(); generation.next = uuid; const id = await insert(first); await accept(storage, first);
    const collision = await open(); generation.next = uuid; await insert(collision, "collision"); await Effect.runPromise(collision.root.delete(id));
    expect(reason(await Effect.runPromiseExit(collision.root.freeze()))).toMatchObject({ value: { reason: "conflict" } });
  }));

  it.each([false, true])("rejects a post-freeze collision, local deletion=%s", async removed => withDatabase(async (database, storage, _definition, open) => {
    const first = await open(); const uuid = randomUUID(); generation.next = uuid; const id = await insert(first, "loser");
    if (removed) await Effect.runPromise(first.root.delete(id));
    const candidate = await Effect.runPromise(first.root.freeze());
    const winner = await open(); generation.next = uuid; await insert(winner, "winner"); await accept(storage, winner);
    expect(reason(await Effect.runPromiseExit(storage.accept(first.command, candidate.changes, candidate.dependencies, null))))
      .toMatchObject({ value: { reason: "conflict" } });
    expect(await database.admin(db => db.select().from(tables.history).where(eq(tables.history.id, id))))
      .toEqual([expect.objectContaining({ body: expect.objectContaining({ name: "winner" }) })]);
    expect((await database.admin(db => db.select().from(tables.commands).where(eq(tables.commands.id, first.command.id))))[0]?.status).toBe("active");
  }));

  it.each(["revoke", "fence", "definition", "retention", "closed"] as const)("refuses %s before exporting generated-ID evidence", async change => withDatabase(async (database, _storage, _definition, open) => {
    const opened = await open(); await insert(opened);
    if (change === "revoke") await database.admin(db => db.delete(tables.grants).where(eq(tables.grants.scope, "shop-a")));
    if (change === "fence") await database.admin(db => db.update(tables.authorities).set({ fence: 2 }).where(eq(tables.authorities.scope, "shop-a")));
    if (change === "definition") await database.admin(db => db.update(tables.definitions).set({ version: "retired" }).where(eq(tables.definitions.table, "tasks")));
    if (change === "retention") await database.admin(db => db.update(tables.authorities).set({ retainedFrom: opened.snapshot.sequence + 1 }).where(eq(tables.authorities.scope, "shop-a")));
    if (change === "closed") await Effect.runPromise(database.persistence.closeSnapshot(opened.snapshot));
    const expected = change === "retention" ? "expired" : change === "closed" ? "closed" : "denied";
    expect(reason(await Effect.runPromiseExit(opened.root.freeze()))).toMatchObject({ value: { reason: expected } });
    expect(await database.admin(db => db.select().from(tables.documents))).toEqual([]);
  }));

  it("checks actual reads freshly after tentative inserts and preserves caught refusal", async () => withDatabase(async (database, _storage, _definition, open) => {
    const opened = await open(); const id = await insert(opened);
    await database.admin(db => db.delete(tables.grants).where(eq(tables.grants.scope, "shop-a")));
    expect(reason(await Effect.runPromiseExit(opened.root.get(id)))).toMatchObject({ value: { reason: "denied" } });
    await database.admin(db => db.insert(tables.grants).values({ scope: "shop-a", principal: database.role }));
    expect(reason(await Effect.runPromiseExit(opened.root.freeze()))).toMatchObject({ value: { reason: "denied" } });
  }));

  it("preserves logical row/dependency and shared byte budgets", async () => withDatabase(async (_database, storage, definition, open) => {
    const opened = await open();
    for (let index = 0; index < 256; index++) await insert(opened, `limit-${index}`);
    expect(reason(await Effect.runPromiseExit(opened.root.insert({ name: "overflow", priority: 1 })))).toMatchObject({ value: { reason: "limit" } });
    expect(reason(await Effect.runPromiseExit(opened.root.freeze()))).toMatchObject({ value: { reason: "limit" } });
    const bounded = await open(); const budget = createBudget();
    const root = await Effect.runPromise(createApplicationMutationRoot(definition, storage, bounded.snapshot, budget));
    try {
      expect(Effect.runSync(Effect.fromResult(budget.event(262_000)))).toBeUndefined();
      expect(reason(await Effect.runPromiseExit(root.insert({ name: "bytes", priority: 1 })))).toMatchObject({ value: { reason: "limit" } });
      expect(reason(await Effect.runPromiseExit(root.freeze()))).toMatchObject({ value: { reason: "limit" } });
    } finally { await Effect.runPromise(root.close); }
  }));

  it("retains the same validation in an Application participant of a mixed root", async () => withDatabase(async (database, storage, definition, open) => {
    const original = await open(); const uuid = randomUUID(); generation.next = uuid; await insert(original); await accept(storage, original);
    const command = await Effect.runPromise(database.commands.openMixed("shop-a", randomUUID(), "mixed", [definition], randomUUID()));
    const root = await Effect.runPromise(createGroupRoot(database.persistence, command, [definition]));
    try {
      generation.next = uuid;
      await Effect.runPromise(root.withApplication(definition, child => child.insert({ name: "mixed-collision", priority: 2 })));
      expect(reason(await Effect.runPromiseExit(root.freeze()))).toMatchObject({ value: { reason: "conflict" } });
    } finally { await Effect.runPromise(root.close); await Effect.runPromise(database.persistence.abort(command)); }
  }));

  it.skipIf(driver !== "postgres")("acquires new history in a fresh statement after a guard lock wait", async () => withDatabase(async (database, _storage, _definition, open) => {
    const blocked = await open(); const id = await insert(blocked, "blocked");
    const lock = barrier(); let freezing: Promise<Exit.Exit<unknown, unknown>> | undefined;
    const held = database.admin(async db => {
      await db.transaction(async tx => {
        await tx.select().from(tables.definitions).where(eq(tables.definitions.table, "tasks")).for("update");
        lock.ready(); await lock.gate;
      });
    });
    try {
      await lock.started;
      freezing = Effect.runPromiseExit(blocked.root.freeze()); await waitingForLock(database);
      // A controlled owner seeds old identity history while the read's initial
      // statement snapshot is already fixed. This is a statement-freshness
      // witness; genuine concurrent business publication is covered above.
      await database.admin(db => db.insert(tables.history).values({ scope: "shop-a", table: "tasks", id,
        commitSeq: blocked.snapshot.sequence, body: null }));
      lock.release(); await held;
      expect(reason(await freezing)).toMatchObject({ value: { reason: "conflict" } });
      expect(database.servingPool?.totalCount).toBe(database.servingPool?.idleCount);
      expect(await database.admin(db => db.select().from(tables.documents))).toEqual([]);
    } finally { lock.release(); await Promise.allSettled([held, ...(freezing === undefined ? [] : [freezing])]); }
  }));

  it.skipIf(driver !== "postgres")("withholds cancellation until the freeze transaction drains", async () => withDatabase(async (database, _storage, _definition, open) => {
    const opened = await open(); await insert(opened); const lock = barrier(); let settled = false;
    let freezing: Promise<Exit.Exit<unknown, unknown>> | undefined;
    const held = database.admin(db => db.transaction(async tx => {
      await tx.select().from(tables.definitions).where(eq(tables.definitions.table, "tasks")).for("update");
      lock.ready(); await lock.gate;
    }));
    const controller = new AbortController();
    try {
      await lock.started;
      freezing = Effect.runPromiseExit(opened.root.freeze(), { signal: controller.signal }).then(exit => { settled = true; return exit; });
      await waitingForLock(database); controller.abort(); await delay(10); expect(settled).toBe(false);
      lock.release(); await held;
      const exit = await freezing; expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true);
      expect(database.servingPool?.totalCount).toBe(database.servingPool?.idleCount);
      expect(await database.admin(db => db.select().from(tables.documents))).toEqual([]);
    } finally { lock.release(); await Promise.allSettled([held, ...(freezing === undefined ? [] : [freezing])]); }
  }));

  it.skipIf(driver !== "postgres")("checks snapshot expiry after the freeze gate lock wait", async () => withDatabase(async (database, _storage, _definition, open) => {
    const opened = await open(); await insert(opened);
    const [stored] = await database.admin(db => db.select({ expires: tables.commands.expires }).from(tables.commands).where(eq(tables.commands.id, opened.command.id)));
    if (stored === undefined) throw new Error("Missing issued command");
    // Keep the real 30-second issuer deadline. Start the lock wait just before
    // expiry so the witness remains inside the unchanged 3-second lock timeout.
    await delay(Math.max(0, stored.expires.getTime() - Date.now() - 800));
    const lock = barrier(); let freezing: Promise<Exit.Exit<unknown, unknown>> | undefined;
    const held = database.admin(db => db.transaction(async tx => {
      await tx.select().from(tables.definitions).where(eq(tables.definitions.table, "tasks")).for("update");
      lock.ready(); await lock.gate;
    }));
    const clock = Schema.decodeUnknownSync(Schema.Struct({ rows: Schema.Array(Schema.Struct({ expired: Schema.Boolean })) }));
    try {
      await lock.started;
      expect(clock(await database.admin(db => db.execute(sql`select clock_timestamp() >= ${stored.expires} as expired`))).rows[0]?.expired).toBe(false);
      freezing = Effect.runPromiseExit(opened.root.freeze()); await waitingForLock(database);
      expect(clock(await database.admin(db => db.execute(sql`select clock_timestamp() >=
        ${stored.expires}::timestamptz - interval '100 milliseconds' as expired`))).rows[0]?.expired).toBe(false);
      const limit = Date.now() + 2000; let expired = false;
      while (!expired && Date.now() < limit) {
        expired = clock(await database.admin(db => db.execute(sql`select clock_timestamp() >= ${stored.expires} as expired`))).rows[0]?.expired === true;
        if (!expired) await delay(10);
      }
      expect(expired).toBe(true); lock.release(); await held;
      expect(reason(await freezing)).toMatchObject({ value: { reason: "expired" } });
      expect(await database.admin(db => db.select().from(tables.documents))).toEqual([]);
    } finally { lock.release(); await Promise.allSettled([held, ...(freezing === undefined ? [] : [freezing])]); }
  }));
});
