import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Cause, Deferred, Effect, Exit, Fiber, Result, Schema } from "effect";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { isJsonObject, type Json } from "flarex-protocol/json";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { capturePrivateCanonicalValue } from "../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { defineCommerceCommand, type CommerceCommand, type CommerceCommandContext } from "../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { makeCommerceHost } from "../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { commerceError } from "../../persistence-postgres/src/frameworks/commerceTransaction/model";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant, type AtomicCommerceContext } from "../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import type { LogicalCommerceCallValidation } from "../../persistence-postgres/src/frameworks/atomicCommerce/participants";
import { fxAppRowCurrent, fxSystemCommits } from "../../persistence-postgres/src/database/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commit/events/schema";
import { createStep, createWorkflow, parallelize, WorkflowResponse } from "@medusajs/workflows-sdk";
import { runNativeMedusaWorkflow } from "../src/workflow/runtime";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
const origin = { kind: "synthetic", sourceId: "atomic-queued-operations" };
const schema = Result.getOrThrow(normalizeRelationalSchema({ owner: "medusa", lineageId: "atomic-queued-operations",
  tables: [{ tableId: "queue_probe", origin, columns: [
    { columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
    { columnId: "value", type: "integer", nullable: false, default: { kind: "none" }, origin },
  ], keys: [{ keyId: "queue_probe.primary", kind: "primary", columns: ["id"], origin }], indexes: [], constraints: [], relationships: [] }],
  capabilities: [],
}));
const evidence = { kind: "synthetic", sourceId: "atomic-queued-operations" };
const decodeInput = Schema.decodeUnknownResult(Schema.Struct({ id: Schema.String, value: Schema.Int }), { onExcessProperty: "error" });
type Input = Result.Result.Success<ReturnType<typeof decodeInput>>;
const participant = defineAtomicCommerceParticipant("queue_probe");
let fixture: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
let storage: Awaited<ReturnType<typeof makeStorage>>;
let reader: Effect.Success<ReturnType<typeof makeCommerceHost>>;
const rows = () => fixture.persistence.drizzle.select().from(fxAppRowCurrent);
const commits = () => fixture.persistence.drizzle.select().from(fxSystemCommits);
const events = () => fixture.persistence.drizzle.select().from(fxSystemCommitEvents);
const read = defineCommerceCommand("queueProbeRead", "read", Effect.fn(function* (ctx) {
  const table = yield* ctx.table("queue_probe");
  return [...yield* table.find(ctx.manager, { fields: ["id", "value"], take: 100, order: { column: "id", direction: "asc" } })];
}));

async function makeStorage() {
  const empty = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] }, 1_048_576,
    { invalidInput: () => new Error("Invalid queued-operation dataset"), hashFailure: cause => new Error("Queued-operation dataset hash", { cause }) }));
  return { ...fixture.hostInput.logicalStorage,
    source: { sourceKey: "medusa.queue-probe", writeProfile: "medusa.queue-probe", schema, evidence },
    initialization: { stepId: "queue-probe-empty", datasetSha256: empty.sha256Hex, expectedRowCount: 0 },
  };
}

function write(name: string, enter: (input: Input) => Effect.Effect<void> = () => Effect.void, refuse = false) {
  return defineCommerceCommand(name, "write", Effect.fn(function* (ctx, input) {
    const data = yield* Effect.fromResult(decodeInput(input)).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)),
      Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    const table = yield* ctx.table("queue_probe");
    yield* table.write(ctx.manager, "insert", [{ id: data.id, value: data.value }]);
    yield* enter(data);
    if (refuse) return yield* ctx.refuse(commerceError("invalidInput"));
    return data.id;
  }));
}

async function open(root: Parameters<typeof defineAtomicCommerceCommand>[1], commands: readonly CommerceCommand[],
  validateLogicalCall?: LogicalCommerceCallValidation, scheduling: "queued" | "strict" = "queued", borrowedScheduling = false) {
  const command = defineAtomicCommerceCommand("queuedNeutralRoot", root);
  const host = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.hostInput,
    identityAndAccessPolicy: { profile: "neutral-queued-operation-proof" },
    ...(scheduling === "queued" ? { operationScheduling: scheduling } : {}),
    ...(borrowedScheduling ? { borrowedOperationScheduling: "queued" } : {}),
    participants: [{ participant, logicalStorage: storage, commands,
      ...(validateLogicalCall === undefined ? {} : { validateLogicalCall }) }], commands: [command],
  }));
  cleanup.push(() => Effect.runPromise(host.close));
  return { host, command };
}


/** The command is neutral. A selected FIFO owns capture/accounting and each real
 * store operation; omitted scheduling keeps the pre-existing immediate path. */
function writeBorrowed(ctx: CommerceCommandContext, input: Json,
  before: (data: Input) => Effect.Effect<void, ReturnType<typeof commerceError>> = () => Effect.void) {
  const work = (captured: Json) => writeBorrowedWithoutQueue(ctx, captured, before);
  return ctx.enqueue === undefined ? work(input) : ctx.enqueue(() => Result.succeed(input), work);
}


function writeBorrowedWithoutQueue(ctx: CommerceCommandContext, input: Json, before: (data: Input) => Effect.Effect<void, ReturnType<typeof commerceError>>) {
  return Effect.gen(function* () {
    const data = yield* Effect.fromResult(decodeInput(input)).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
    yield* before(data);
    const table = yield* ctx.table("queue_probe");
    yield* table.write(ctx.manager, "insert", [{ id: data.id, value: data.value }]);
    return data.id;
  });
}

function reasons(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => {
    switch (reason._tag) {
      case "Fail": return reasons(reason.error);
      case "Die": return reasons(reason.defect);
      case "Interrupt": return ["Interrupt"];
    }
  });
  if (typeof value !== "object" || value === null) return [];
  const reason = Object.getOwnPropertyDescriptor(value, "reason")?.value;
  const cause = Object.getOwnPropertyDescriptor(value, "cause")?.value;
  return [...(typeof reason === "string" ? [reason] : []), ...(cause === undefined ? [] : reasons(cause))];
}

describe("explicit queued atomic operations on a neutral logical source", () => {
  beforeAll(async () => {
    const source = await Effect.runPromise(captureLogicalSchemaSource({ key: "medusa.queue-probe", owner: "medusa", writeProfile: "medusa.queue-probe",
      evidence, definition: { kind: "relational", schema },
      bindings: [{ kind: "definition", localName: "queue_probe", table: { namespace: "medusa", logicalName: "atomic-queued-operations/queue_probe" } }],
    }));
    // Reuse authenticated catalog/database construction only. The source and
    // commands below are authored neutral records, with no module services.
    fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), { additionalSources: [source] });
    storage = await makeStorage();
    reader = await Effect.runPromise(makeCommerceHost({ ...fixture.hostInput, logicalStorage: storage, commands: [read] }));
    cleanup.push(() => Effect.runPromise(reader.close));
    await Effect.runPromise(reader.initialize([]));
  }, 180_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("captures queued arguments before waiting and keeps FIFO writes and receipt boundaries separate", async () => {
    const reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>();
    const started: string[] = [], receipts: Array<{ input: Json; ids: readonly unknown[] }> = [];
    const command = write("queueProbeWrite", input => Effect.gen(function* () {
      started.push(input.id);
      if (input.id === "fifo-first") { yield* Deferred.succeed(reached, undefined); yield* Deferred.await(release); }
    }));
    const validate: LogicalCommerceCallValidation = Effect.fn(function* (call, activity) {
      expect(isJsonObject(call.input)).toBe(true);
      expect(activity.mutations).toHaveLength(1);
      expect(activity.mutations[0]).toMatchObject({ ordinal: 0, operation: "insert", table: "queue_probe", after: call.input });
      expect(activity.lifecycle).toEqual([]); expect(activity.setNull).toEqual([]); expect(activity.referenceReplacements).toEqual([]);
      expect(call.events).toEqual([]);
      receipts.push({ input: call.input, ids: activity.mutations.map(mutation => mutation.after?.id) });
    });
    const tested = await open(Effect.fn(function* (ctx) {
      const first = yield* Effect.forkChild(ctx.call(participant, command, { id: "fifo-first", value: 1 }));
      yield* Deferred.await(reached).pipe(Effect.timeoutOrElse({ duration: 5000, orElse: () => Effect.fail(commerceError("deadlineExceeded")) }));
      const mutable = { id: "fifo-second", value: 2 };
      const captured = Deferred.makeUnsafe<void>();
      let captures = 0;
      const observed = new Proxy(mutable, { ownKeys(target) {
        captures++;
        // Observe completion of this synchronous foreign-value snapshot. An
        // immediate Deferred signal can resume the mutator inside ownKeys,
        // before capture has read the object's data descriptors.
        queueMicrotask(() => { Deferred.doneUnsafe(captured, Effect.void); });
        return Reflect.ownKeys(target);
      } });
      const second = yield* Effect.forkChild(ctx.call(participant, command, observed));
      return yield* Effect.gen(function* () {
        yield* Deferred.await(captured).pipe(Effect.timeoutOrElse({ duration: 5000, orElse: () => Effect.fail(commerceError("deadlineExceeded")) }));
        expect(captures).toBeGreaterThan(0); expect(started).toEqual(["fifo-first"]);
        mutable.id = "mutated-after-queue"; mutable.value = 999;
        yield* Deferred.succeed(release, undefined);
        return [yield* Fiber.join(first), yield* Fiber.join(second)];
      }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
    }), [command], validate);
    const beforeCommits = await commits(), key = tested.host.newRequestKey();
    expect(await Effect.runPromise(tested.host.run(key, tested.command, null))).toEqual(["fifo-first", "fifo-second"]);
    expect(started).toEqual(["fifo-first", "fifo-second"]);
    expect(receipts).toEqual([{ input: { id: "fifo-first", value: 1 }, ids: ["fifo-first"] },
      { input: { id: "fifo-second", value: 2 }, ids: ["fifo-second"] }]);
    expect(await Effect.runPromise(reader.read(read, null))).toMatchObject([{ id: "fifo-first", value: 1 }, { id: "fifo-second", value: 2 }]);
    expect((await commits()).length - beforeCommits.length).toBe(1);
    expect(await Effect.runPromise(tested.host.run(key, tested.command, null))).toEqual(["fifo-first", "fifo-second"]);
    expect(started).toHaveLength(2); expect(receipts).toHaveLength(2);
  });

  it("rolls back all writes when a queued operation fails even when every caller catches the failure", async () => {
    const started: string[] = [];
    const record = (input: Input) => Effect.sync(() => { started.push(input.id); });
    const successful = write("queueProbeBeforeRefusal", record), failing = write("queueProbeRefused", record, true);
    const later = write("queueProbeAfterRefusal", record);
    const tested = await open(Effect.fn(function* (ctx) {
      const outcomes = yield* Effect.all([
        ctx.call(participant, successful, { id: "caught-first", value: 1 }),
        ctx.call(participant, failing, { id: "caught-failure", value: 2 }),
        ctx.call(participant, later, { id: "caught-never", value: 3 }),
      ].map(operation => Effect.exit(operation)), { concurrency: "unbounded" });
      expect(outcomes[0]?._tag).toBe("Success"); expect(outcomes[1]?._tag).toBe("Failure"); expect(outcomes[2]?._tag).toBe("Failure");
      return null;
    }), [successful, failing, later]);
    const beforeRows = await rows(), beforeCommits = await commits(), beforeEvents = await events();
    const exit = await Effect.runPromise(Effect.exit(tested.host.run(tested.host.newRequestKey(), tested.command, null)));
    expect(exit._tag).toBe("Failure");
    expect(exit._tag === "Failure" ? reasons(exit.cause) : []).toContain("invalidInput");
    expect(started).toEqual(["caught-first", "caught-failure"]);
    expect(await rows()).toEqual(beforeRows); expect(await commits()).toEqual(beforeCommits); expect(await events()).toEqual(beforeEvents);
  });

  it("records a native callback failure once under the default strict profile", async () => {
    const failure = commerceError("invalidInput");
    const refused = createStep("queue-probe-strict-native-refused", async () => { throw failure; });
    const workflow = createWorkflow("queue-probe-strict-native-failure", () => new WorkflowResponse(refused(undefined)));
    const prepared = Result.getOrThrow(workflow.prepare());
    const unused = write("queueProbeStrictNativeRefusal");
    const tested = await open(Effect.fn(function* (ctx) {
      return yield* runNativeMedusaWorkflow(prepared, ctx, null, () => ({
        resolve: () => { throw new Error("Unexpected native container resolution"); },
      }));
    }), [unused], undefined, "strict");
    const before = { rows: await rows(), commits: await commits(), events: await events() };
    const exit = await Effect.runPromise(Effect.exit(tested.host.run(tested.host.newRequestKey(), tested.command, null)));
    if (Exit.isSuccess(exit)) throw new Error("Expected the native callback refusal");
    expect(Result.getOrThrow(Cause.findError(exit.cause))).toBe(failure);
    expect({ rows: await rows(), commits: await commits(), events: await events() }).toEqual(before);
  });

  it("records a native callback failure before fail-fast cancellation interrupts a queued sibling", async () => {
    const reached = Deferred.makeUnsafe<void>();
    const failure = commerceError("invalidInput");
    let cleaned = false;
    let escaped: (() => Promise<Json>) | undefined;
    const active = write("queueProbeNativeCallbackFailure", () => Deferred.succeed(reached, undefined).pipe(
      Effect.andThen(Effect.never), Effect.ensuring(Effect.sync(() => { cleaned = true; })),
    ));
    const pending = createStep("queue-probe-native-pending", async () => {
      if (escaped === undefined) throw new Error("Missing native participant method");
      return await escaped();
    });
    const refused = createStep("queue-probe-native-refused", async () => {
      await Effect.runPromise(Deferred.await(reached));
      throw failure;
    });
    const workflow = createWorkflow("queue-probe-native-callback-failure", () =>
      new WorkflowResponse(parallelize(pending(undefined), refused(undefined))));
    const prepared = Result.getOrThrow(workflow.prepare());
    const tested = await open(Effect.fn(function* (ctx) {
      return yield* runNativeMedusaWorkflow(prepared, ctx, null, owner => {
        escaped = () => owner.run(ctx.call(participant, active, { id: "native-refused-write", value: 1 }));
        return { resolve: () => { throw new Error("Unexpected native container resolution"); } };
      });
    }), [active]);
    const before = { rows: await rows(), commits: await commits(), events: await events() };
    const exit = await Effect.runPromise(Effect.exit(tested.host.run(tested.host.newRequestKey(), tested.command, null)));
    if (Exit.isSuccess(exit)) throw new Error("Expected the native callback refusal");
    expect(Result.getOrThrow(Cause.findError(exit.cause))).toBe(failure);
    // The original failure remains first; interrupted participant work also
    // retains the transaction owner's rollback-only cleanup evidence.
    expect(reasons(exit.cause)).toEqual(["invalidInput", "rollbackOnly"]);
    expect(cleaned).toBe(true);
    expect({ rows: await rows(), commits: await commits(), events: await events() }).toEqual(before);
    if (escaped === undefined) throw new Error("Missing escaped native participant method");
    await expect(escaped()).rejects.toMatchObject({ reason: "closed" });
    expect(await rows()).toEqual(before.rows);
  });

  it("refuses settlement with escaped active and pending jobs, drains the worker and closes escaped authority", async () => {
    const reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>();
    const pendingCaptured = Deferred.makeUnsafe<void>();
    let activeEnded = false, pendingEntered = false, rootReachedReturn = false;
    let escaped: AtomicCommerceContext | undefined;
    const pending: Array<Promise<Exit.Exit<Json, ReturnType<typeof commerceError>>>> = [];
    const active = write("queueProbeEscapedActive", () => Deferred.succeed(reached, undefined).pipe(Effect.andThen(Deferred.await(release)),
      Effect.ensuring(Effect.sync(() => { activeEnded = true; }))));
    const later = write("queueProbeEscapedPending", () => Effect.sync(() => { pendingEntered = true; }));
    const tested = await open(Effect.fn(function* (ctx) {
      escaped = ctx;
      pending.push(Effect.runPromise(Effect.exit(ctx.call(participant, active, { id: "escaped-active", value: 1 }))));
      yield* Deferred.await(reached).pipe(Effect.timeoutOrElse({ duration: 5000, orElse: () => Effect.fail(commerceError("deadlineExceeded")) }));
      const pendingInput = new Proxy({ id: "escaped-pending", value: 2 }, { ownKeys(target) {
        // Resume the root after synchronous capture and queue admission finish.
        queueMicrotask(() => { Deferred.doneUnsafe(pendingCaptured, Effect.void); });
        return Reflect.ownKeys(target);
      } });
      pending.push(Effect.runPromise(Effect.exit(ctx.call(participant, later, pendingInput))));
      yield* Deferred.await(pendingCaptured).pipe(Effect.timeoutOrElse({ duration: 5000, orElse: () => Effect.fail(commerceError("deadlineExceeded")) }));
      rootReachedReturn = true;
      return null;
    }), [active, later]);
    const beforeRows = await rows(), beforeCommits = await commits();
    try {
      const exit = await Effect.runPromise(Effect.exit(tested.host.run(tested.host.newRequestKey(), tested.command, null)));
      expect(rootReachedReturn).toBe(true);
      expect(exit._tag).toBe("Failure");
      expect(exit._tag === "Failure" ? reasons(exit.cause) : []).toContain("overlappingOperation");
      expect((await Promise.all(pending)).map(result => result._tag)).toEqual(["Failure", "Failure"]);
      expect(activeEnded).toBe(true); expect(pendingEntered).toBe(false);
      expect(await rows()).toEqual(beforeRows); expect(await commits()).toEqual(beforeCommits);
      if (escaped === undefined) throw new Error("Missing escaped root authority");
      expect(await Effect.runPromise(Effect.result(escaped.call(participant, later, { id: "escaped-late", value: 3 }))))
        .toMatchObject({ _tag: "Failure" });
      expect(pendingEntered).toBe(false); expect(await rows()).toEqual(beforeRows);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); }
  });

  it("keeps the default profile's overlap refusal instead of silently queuing sibling calls", async () => {
    const reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>();
    const started: string[] = [];
    const command = write("queueProbeDefault", input => Effect.gen(function* () {
      started.push(input.id);
      if (input.id === "default-active") { yield* Deferred.succeed(reached, undefined); yield* Deferred.await(release); }
    }));
    const tested = await open(Effect.fn(function* (ctx) {
      const first = yield* Effect.forkChild(Effect.exit(ctx.call(participant, command, { id: "default-active", value: 1 })));
      yield* Deferred.await(reached).pipe(Effect.timeoutOrElse({ duration: 5000, orElse: () => Effect.fail(commerceError("deadlineExceeded")) }));
      const refused = yield* Effect.exit(ctx.call(participant, command, { id: "default-overlap", value: 2 }));
      expect(refused._tag).toBe("Failure");
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(first);
      return null;
    }), [command], undefined, "strict");
    const beforeRows = await rows(), beforeCommits = await commits();
    try {
      const exit = await Effect.runPromise(Effect.exit(tested.host.run(tested.host.newRequestKey(), tested.command, null)));
      expect(exit._tag).toBe("Failure");
      expect(exit._tag === "Failure" ? reasons(exit.cause) : []).toContain("overlappingOperation");
      expect(started).toEqual(["default-active"]);
      expect(await rows()).toEqual(beforeRows); expect(await commits()).toEqual(beforeCommits);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); }
  });

  it("queues descendant DAL work in one borrowed command, captures before waiting and commits one replayable receipt", async () => {
    const reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>(), prepared = Deferred.makeUnsafe<void>();
    const started: string[] = [];
    let receipts = 0;
    const command = defineCommerceCommand("queueProbeBorrowedFifo", "write", Effect.fn(function* (ctx) {
      expect(ctx.enqueue).toBeTypeOf("function");
      const root = yield* writeBorrowed(ctx, { id: "borrowed-command", value: 0 });
      const children = yield* ctx.borrow(child => Effect.gen(function* () {
        expect(child.enqueue).toBeTypeOf("function");
        const first = yield* Effect.forkChild(writeBorrowed(child, { id: "borrowed-first", value: 1 }, data => Effect.gen(function* () {
          started.push(data.id); yield* Deferred.succeed(reached, undefined); yield* Deferred.await(release);
        })));
        yield* Deferred.await(reached);
        const mutable = { id: "borrowed-second", value: 2 };
        const enqueue = child.enqueue;
        if (enqueue === undefined) throw new Error("Missing borrowed FIFO");
        const second = yield* Effect.forkChild(enqueue(() => {
          queueMicrotask(() => { Deferred.doneUnsafe(prepared, Effect.void); });
          return Result.succeed(mutable);
        }, captured => writeBorrowedWithoutQueue(child, captured, data => Effect.sync(() => { started.push(data.id); }))));
        yield* Deferred.await(prepared);
        mutable.id = "borrowed-mutated"; mutable.value = 999;
        expect(started).toEqual(["borrowed-first"]);
        yield* Deferred.succeed(release, undefined);
        return [yield* Fiber.join(first), yield* Fiber.join(second)];
      }));
      return [root, ...children];
    }));
    const tested = await open(Effect.fn(function* (ctx) { return yield* ctx.call(participant, command, null); }), [command],
      Effect.fn(function* (call, activity) {
        receipts++;
        expect(call.result).toEqual(["borrowed-command", "borrowed-first", "borrowed-second"]);
        expect(activity.mutations.map(mutation => mutation.after?.id)).toEqual(["borrowed-command", "borrowed-first", "borrowed-second"]);
      }), "queued", true);
    const before = (await commits()).length, key = tested.host.newRequestKey();
    expect(await Effect.runPromise(tested.host.run(key, tested.command, null))).toEqual(["borrowed-command", "borrowed-first", "borrowed-second"]);
    expect(started).toEqual(["borrowed-first", "borrowed-second"]); expect(receipts).toBe(1);
    expect((await commits()).length - before).toBe(1);
    expect(await Effect.runPromise(tested.host.run(key, tested.command, null))).toEqual(["borrowed-command", "borrowed-first", "borrowed-second"]);
    expect(receipts).toBe(1); expect((await commits()).length - before).toBe(1);
    const listed = await Effect.runPromise(reader.read(read, null));
    expect(listed).toEqual(expect.arrayContaining([{ id: "borrowed-command", value: 0 }, { id: "borrowed-first", value: 1 }, { id: "borrowed-second", value: 2 }]));
  });

  it("keeps root-only scheduling identity-distinct and rejects borrowed scheduling without its root policy", async () => {
    const command = defineCommerceCommand("queueProbeBorrowedIdentity", "write", ctx => Effect.succeed(ctx.enqueue === undefined ? "root-only" : "borrowed-queued"));
    const root = Effect.fn(function* (ctx: AtomicCommerceContext) { return yield* ctx.call(participant, command, null); });
    const omitted = await open(root, [command]), selected = await open(root, [command], undefined, "queued", true);
    const key = omitted.host.newRequestKey();
    expect(await Effect.runPromise(omitted.host.run(key, omitted.command, null))).toBe("root-only");
    const before = { rows: await rows(), commits: await commits() };
    const conflict = await Effect.runPromise(Effect.exit(selected.host.run(key, selected.command, null)));
    expect(Exit.isFailure(conflict) ? reasons(conflict.cause) : []).toContain("requestConflict");
    await expect(open(root, [command], undefined, "strict", true)).rejects.toMatchObject({ reason: "unsupportedProfile" });
    expect({ rows: await rows(), commits: await commits() }).toEqual(before);
  });

  it("keeps omitted borrowed scheduling strict for concurrent descendant writes", async () => {
    const command = defineCommerceCommand("queueProbeBorrowedOmitted", "write", ctx => ctx.borrow(child => {
      expect(child.enqueue).toBeUndefined();
      return Effect.all([writeBorrowed(child, { id: "borrowed-default-a", value: 1 }), writeBorrowed(child, { id: "borrowed-default-b", value: 2 })],
        { concurrency: "unbounded" });
    }));
    const tested = await open(Effect.fn(function* (ctx) { return yield* ctx.call(participant, command, null); }), [command]);
    const before = { rows: await rows(), commits: await commits(), events: await events() };
    const exit = await Effect.runPromise(Effect.exit(tested.host.run(tested.host.newRequestKey(), tested.command, null)));
    expect(Exit.isFailure(exit) ? reasons(exit.cause) : []).toContain("overlappingOperation");
    expect({ rows: await rows(), commits: await commits(), events: await events() }).toEqual(before);
  });

  it("latches a swallowed descendant failure and stops later jobs before any commit", async () => {
    const started: string[] = [];
    const command = defineCommerceCommand("queueProbeBorrowedCaught", "write", ctx => ctx.borrow(child => Effect.gen(function* () {
      const outcomes = yield* Effect.all([
        writeBorrowed(child, { id: "borrowed-caught-first", value: 1 }, data => Effect.sync(() => { started.push(data.id); })),
        writeBorrowed(child, { id: "borrowed-caught-failure", value: 2 }, data => Effect.sync(() => { started.push(data.id); }).pipe(Effect.andThen(Effect.fail(commerceError("invalidInput"))))),
        writeBorrowed(child, { id: "borrowed-caught-never", value: 3 }, data => Effect.sync(() => { started.push(data.id); })),
      ].map(operation => Effect.exit(operation)), { concurrency: "unbounded" });
      expect(outcomes.map(outcome => outcome._tag)).toEqual(["Success", "Failure", "Failure"]);
      return null;
    })));
    const tested = await open(Effect.fn(function* (ctx) { return yield* ctx.call(participant, command, null); }), [command], undefined, "queued", true);
    const before = { rows: await rows(), commits: await commits(), events: await events() };
    const exit = await Effect.runPromise(Effect.exit(tested.host.run(tested.host.newRequestKey(), tested.command, null)));
    expect(Exit.isFailure(exit) ? reasons(exit.cause) : []).toContain("invalidInput");
    expect(started).toEqual(["borrowed-caught-first", "borrowed-caught-failure"]);
    expect({ rows: await rows(), commits: await commits(), events: await events() }).toEqual(before);
  });

  it("interrupts and joins descendant jobs before returning a canceled borrowed manager", async () => {
    const reached = Deferred.makeUnsafe<void>(), prepared = Deferred.makeUnsafe<void>();
    let cleaned = false, waitingRan = false;
    const command = defineCommerceCommand("queueProbeBorrowedCanceled", "write", ctx => ctx.borrow(child => Effect.gen(function* () {
      const first = yield* Effect.forkChild(Effect.exit(writeBorrowed(child, { id: "borrowed-cancel-active", value: 1 }, () =>
        Deferred.succeed(reached, undefined).pipe(Effect.andThen(Effect.never), Effect.ensuring(Effect.sync(() => { cleaned = true; }))))));
      yield* Deferred.await(reached);
      const enqueue = child.enqueue;
      if (enqueue === undefined) throw new Error("Missing borrowed FIFO");
      const waiting = yield* Effect.forkChild(enqueue(() => {
        Deferred.doneUnsafe(prepared, Effect.void); return Result.succeed(null);
      }, () => Effect.sync(() => { waitingRan = true; return null; })));
      yield* Deferred.await(prepared); yield* Fiber.interrupt(waiting); yield* Fiber.join(first);
      expect(cleaned).toBe(true); expect(waitingRan).toBe(false);
      return null;
    })));
    const tested = await open(Effect.fn(function* (ctx) { return yield* ctx.call(participant, command, null); }), [command], undefined, "queued", true);
    const before = { rows: await rows(), commits: await commits() };
    const exit = await Effect.runPromise(Effect.exit(tested.host.run(tested.host.newRequestKey(), tested.command, null)));
    expect(Exit.isFailure(exit) ? reasons(exit.cause) : []).toContain("Interrupt");
    expect(cleaned).toBe(true); expect(waitingRan).toBe(false);
    expect({ rows: await rows(), commits: await commits() }).toEqual(before);
  });

  it("rejects escaped descendant jobs, drains cleanup and closes the borrowed enqueue capability", async () => {
    const reached = Deferred.makeUnsafe<void>(), prepared = Deferred.makeUnsafe<void>();
    const pending: Array<Promise<Exit.Exit<Json, ReturnType<typeof commerceError>>>> = [];
    let escaped: CommerceCommandContext | undefined, cleaned = false, waitingRan = false;
    const command = defineCommerceCommand("queueProbeBorrowedEscaped", "write", ctx => ctx.borrow(child => Effect.gen(function* () {
      escaped = child;
      pending.push(Effect.runPromise(Effect.exit(writeBorrowed(child, { id: "borrowed-escaped-active", value: 1 }, () =>
        Deferred.succeed(reached, undefined).pipe(Effect.andThen(Effect.never), Effect.ensuring(Effect.sync(() => { cleaned = true; })))))));
      yield* Deferred.await(reached);
      const enqueue = child.enqueue;
      if (enqueue === undefined) throw new Error("Missing borrowed FIFO");
      pending.push(Effect.runPromise(Effect.exit(enqueue(() => {
        queueMicrotask(() => { Deferred.doneUnsafe(prepared, Effect.void); }); return Result.succeed(null);
      }, () => Effect.sync(() => { waitingRan = true; return null; })))));
      yield* Deferred.await(prepared);
      return null;
    })));
    const tested = await open(Effect.fn(function* (ctx) { return yield* ctx.call(participant, command, null); }), [command], undefined, "queued", true);
    const before = { rows: await rows(), commits: await commits() };
    const exit = await Effect.runPromise(Effect.exit(tested.host.run(tested.host.newRequestKey(), tested.command, null)));
    expect(Exit.isFailure(exit) ? reasons(exit.cause) : []).toContain("overlappingOperation");
    expect((await Promise.all(pending)).map(outcome => outcome._tag)).toEqual(["Failure", "Failure"]);
    expect(cleaned).toBe(true); expect(waitingRan).toBe(false);
    if (escaped === undefined) throw new Error("Missing escaped borrowed manager");
    const late = await Effect.runPromise(Effect.exit(writeBorrowed(escaped, { id: "borrowed-escaped-late", value: 2 })));
    expect(Exit.isFailure(late)).toBe(true); expect(waitingRan).toBe(false);
    expect({ rows: await rows(), commits: await commits() }).toEqual(before);
  });

});
