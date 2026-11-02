import { randomUUID } from "node:crypto";
import { Cause, Context, Deferred, Effect, Equal, Exit, Fiber, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { isJsonObject, jsonEqual, type Json } from "flarex-protocol/json";
import { defineCommerceCommand } from "../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { commerceError, type CommerceTransactionError } from "../../persistence-postgres/src/frameworks/commerceTransaction/model";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant, type AtomicCommerceContext, type AtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { compileCoreNativeEventStorageDefinition } from "../../persistence-postgres/src/commit/events/coreDefinition";
import { defineAtomicCommerceNativeSource, type AtomicCommerceNativeSource } from "../../persistence-postgres/src/frameworks/atomicCommerce/nativeSelection";
import { CoreNativeRootRequestEvidenceSchema } from "../../persistence-postgres/src/core/nativeRootRequest";
import { compileCurrencyCoreDefinition } from "../src/modules/currency/schema";
import { createCoreNativeWorkflowFixture, type CoreNativeWorkflowFixture } from "./support/core-native-workflow-fixture";

const driver = process.env.FLAREX_TEST_DRIVER === "postgres" ? "postgres" : "pglite";
const Input = Schema.Struct({ code: Schema.String, name: Schema.String, mode: Schema.Literals(["insert", "update"]), emit: Schema.Boolean });
const decodeInput = Schema.decodeUnknownEffect(Input);
const decodeEvent = Schema.decodeUnknownEffect(Schema.Struct({ name: Schema.Literal("neutral.changed"), code: Schema.String,
  phase: Schema.optionalKey(Schema.Literals(["before", "after"])) }));
const failures = <A, E>(value: Exit.Exit<A, E>) => Exit.isFailure(value) ? value.cause.reasons.flatMap(reason =>
  Cause.isFailReason(reason) ? [reason.error] : []) : [];
const participant = defineAtomicCommerceParticipant("neutral-currency");
const revision = "a".repeat(64);
const contract = defineCommerceEventContract({ name: "neutral.changed", revision, internal: true,
  decode: value => decodeEvent(value).pipe(Effect.mapError(cause => commerceError("unadmittedEvent", cause))) });
const write = defineCommerceCommand("neutral-write", "write", (context, input) => Effect.gen(function* () {
  const args = yield* decodeInput(input).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
  const rows = yield* context.store.write(context.manager, args.mode, [{ code: args.code, name: args.name, symbol: "N", symbol_native: "N" }]);
  if (args.emit) yield* context.captureLocalEvent({ name: "neutral.changed", code: args.code });
  return rows;
}));
const nestedWrite = defineCommerceCommand("neutral-nested-write", "write", (context, input) => Effect.gen(function* () {
  const args = yield* decodeInput(input).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
  if (args.emit) yield* context.captureLocalEvent({ name: "neutral.changed", code: args.code, phase: "before" });
  const rows = yield* context.nested(write, input);
  if (args.emit) yield* context.captureLocalEvent({ name: "neutral.changed", code: args.code, phase: "after" });
  return rows;
}));
const emittedFor = (code: string) => [{ name: "neutral.changed", code, phase: "before" },
  { name: "neutral.changed", code }, { name: "neutral.changed", code, phase: "after" }];
const argumentsFor = (code: string, mode: "insert" | "update" = "insert", name = code, emit = true) => ({ code, name, mode, emit });

async function fixture(maximumRequests = 32) {
  const target = { scopeUuid: randomUUID(), epochUuid: randomUUID() };
  const definition = await Effect.runPromise(compileCurrencyCoreDefinition(target));
  const eventDefinition = await Effect.runPromise(compileCoreNativeEventStorageDefinition(target));
  return await createCoreNativeWorkflowFixture(driver, { sources: [{ name: "currency", definition, initialCommands: [write], rows: [] }], eventDefinition, maximumRequests });
}
function profile(tested: CoreNativeWorkflowFixture, body: Parameters<typeof defineAtomicCommerceCommand>[1],
  options: Readonly<{ events?: false; padding?: string; source?: AtomicCommerceNativeSource }> = {}) {
  const command = defineAtomicCommerceCommand("neutral-root", body);
  const prepared = tested.execution.prepare({ identityAndAccessPolicy: { profile: "native-atomic-neutral",
    ...(options.padding === undefined ? {} : { padding: options.padding }) }, participants: [{ participant,
    nativeStorage: options.source ?? tested.source("currency"), commands: [write, nestedWrite],
    validateLogicalCall: (call, activity) => call.mode !== "write" || activity.mutations.length !== 1
      || activity.mutations[0]?.table !== "currency" || activity.referenceReplacements.length !== 0 || activity.setNull.length !== 0
      || !jsonEqual(call.events, !isJsonObject(call.input) || call.input.emit !== true ? [] : call.commandName === "neutral-nested-write"
        && typeof call.input.code === "string" ? emittedFor(call.input.code) : [{ name: "neutral.changed", code: call.input.code ?? null }])
      ? Effect.fail(commerceError("receiptMismatch")) : Effect.void,
    ...(options.events === false ? {} : { events: { contracts: [contract], select: () => Effect.succeed(contract) } }),
  }], commands: [command], ...(options.events === false ? {} : { events: { producerRevision: revision, contracts: [contract],
    subscribers: [{ id: "neutral-indexer", revision }], validate: () => Effect.void } }) });
  return { prepared, command };
}
async function host(tested: CoreNativeWorkflowFixture, body: Parameters<typeof defineAtomicCommerceCommand>[1],
  options: Readonly<{ events?: false; padding?: string; source?: AtomicCommerceNativeSource }> = {}) {
  const { prepared, command } = profile(tested, body, options);
  const selected = await tested.run(prepared);
  return { selected, command, run: (key: string, args: Json) => selected.run(key, command, args) };
}

describe(`${driver} ordinary atomic workflow owner`, () => {
  it("retains three independent owned failures through native body and seal while rolling back the complete root", async () => {
    const tested = await fixture();
    const reused = commerceError("invalidInput"), sameCode = commerceError("invalidInput");
    const Annotation = Context.Service<string>("NativeAtomicTest/OwnedOccurrences");
    let runs = 0, bodyCause: Cause.Cause<CommerceTransactionError> | undefined;
    try {
      const selected = await host(tested, (context, args) => Effect.gen(function* () {
        runs++;
        yield* context.call(participant, nestedWrite, args);
        // Issue every origin independently, then exercise the real Cause join.
        const first = Result.getOrThrow(context.recordFailure(Cause.annotate(Cause.fail(reused), Context.make(Annotation, "native-body"))));
        const second = Result.getOrThrow(context.recordFailure(Cause.annotate(Cause.fail(reused), Context.make(Annotation, "native-body"))));
        const third = Result.getOrThrow(context.recordFailure(Cause.annotate(Cause.fail(sameCode), Context.make(Annotation, "native-body"))));
        bodyCause = Result.getOrThrow(context.recordFailure(Cause.combine(Cause.combine(first, second), third)));
        expect(bodyCause.reasons).toHaveLength(3);
        return yield* Effect.failCause(bodyCause);
      }));
      const before = await tested.snapshot(), key = selected.selected.newRequestKey();
      const outcome = await Effect.runPromise(Effect.exit(selected.run(key, argumentsFor("xoi"))));
      if (Exit.isSuccess(outcome) || bodyCause === undefined) throw new Error("Expected authentic native body and seal failure");
      expect(outcome.cause.reasons).toHaveLength(4);
      expect(outcome.cause.reasons.every(Cause.isFailReason)).toBe(true);
      expect(failures(outcome)).toEqual([reused, reused, sameCode, expect.objectContaining({ reason: "rollbackOnly" })]);
      const owned = outcome.cause.reasons.filter(reason => Cause.isFailReason(reason) && reason.error.reason === "invalidInput");
      const tokens = owned.map(reason => reason.annotations.get("Flarex/BoundedRequestFailureOrigin"));
      expect(tokens).toEqual(bodyCause.reasons.map(reason => reason.annotations.get("Flarex/BoundedRequestFailureOrigin")));
      expect(new Set(tokens).size).toBe(3);
      expect(Equal.equals(tokens[0], tokens[1])).toBe(false);
      expect(owned.every(reason => reason.annotations.get(Annotation.key) === "native-body")).toBe(true);
      expect(runs).toBe(1);
      expect(await tested.snapshot()).toEqual(before);
      expect(await tested.readRows("currency", ["xoi"])).toEqual([]);
      const inventory = await tested.inventory();
      expect(inventory.outcomes.filter(outcome => outcome.value.key === key)).toHaveLength(1);
      expect(inventory.outcomes.find(outcome => outcome.value.key === key)?.value).toMatchObject({ state: "failed" });
      await Effect.runPromise(selected.selected.close);
    } finally { await tested.close(); }
  }, 120_000);

  it("uses one shared root and keeps a caught foreign capability refusal rollback-only", async () => {
    const tested = await fixture();
    try {
      const foreignDefinition = await Effect.runPromise(compileCurrencyCoreDefinition({ scopeUuid: randomUUID(), epochUuid: randomUUID() }));
      const portable = Result.getOrThrow(defineAtomicCommerceNativeSource("currency", foreignDefinition));
      const local = await host(tested, (context, args) => Effect.gen(function* () {
        const rows = yield* context.call(participant, nestedWrite, args);
        yield* context.call(participant, nestedWrite, argumentsFor("xln"));
        return rows;
      }), { source: portable });
      await Effect.runPromise(local.run(local.selected.newRequestKey(), argumentsFor("xlo")));
      const localDefinition = tested.sources[0]?.definition;
      if (localDefinition === undefined) throw new Error("Missing locally installed Currency source");
      const actual = await tested.inventory(), currencyTable = localDefinition.tables[0]?.name;
      expect(actual.rows.filter(row => row.table === currencyTable && row.value.code === "xlo")).toHaveLength(1);
      const published = await tested.snapshot(), packed = published.families[0]?.value.root_request;
      const evidence = await Effect.runPromise(Schema.decodeUnknownEffect(Schema.fromJsonString(CoreNativeRootRequestEvidenceSchema))(packed));
      expect(published.events.map(event => event.envelope.message)).toEqual([...emittedFor("xlo"), ...emittedFor("xln")]);
      expect(evidence.frame.participants.find(member => member.source.sourceKey === "medusa.currency")?.source)
        .toEqual(localDefinition.identity);
      expect(localDefinition.identity.scopeUuid).not.toBe(foreignDefinition.identity.scopeUuid);
      expect(await tested.readRows("currency", ["xlo"])).toEqual([expect.objectContaining({ code: "xlo" })]);
      const mismatchedDefinition = await Effect.runPromise(compileCurrencyCoreDefinition({ scopeUuid: randomUUID(), epochUuid: randomUUID(), applicationRead: true }));
      const mismatched = Result.getOrThrow(defineAtomicCommerceNativeSource("currency", mismatchedDefinition));
      let deniedBodyCalls = 0;
      for (const attempt of [{ source: new Proxy(portable, {}), reason: "unsupportedProfile", code: "xpx" },
        { source: mismatched, reason: "invalidAuthority", code: "xmm" }]) {
        const beforeDenial = await tested.snapshot();
        const denied = await host(tested, (context, args) => Effect.gen(function* () {
          deniedBodyCalls++;
          return yield* context.call(participant, write, args);
        }), { source: attempt.source });
        try {
          const result = await tested.run(Effect.exit(denied.run(denied.selected.newRequestKey(), argumentsFor(attempt.code))));
          if (Exit.isSuccess(result)) throw new Error("Expected native source refusal before its body");
          expect(result.cause.reasons).toHaveLength(1);
          expect(result.cause.reasons.every(Cause.isFailReason)).toBe(true);
          expect(failures(result)).toEqual([expect.objectContaining({ reason: attempt.reason })]);
          expect(deniedBodyCalls).toBe(0);
          expect(await tested.snapshot()).toEqual(beforeDenial);
        } finally { await Effect.runPromise(denied.selected.close); }
      }
      await Effect.runPromise(local.selected.close);
      const foreign = defineAtomicCommerceParticipant("foreign");
      const selected = await host(tested, (context, args) => Effect.gen(function* () {
        yield* context.call(participant, write, args);
        const caught = yield* Effect.result(context.call(foreign, write, argumentsFor("xno")));
        expect(Result.isFailure(caught)).toBe(true);
        return { caught: true };
      }));
      const before = await tested.snapshot();
      const result = await Effect.runPromise(Effect.exit(selected.run(selected.selected.newRequestKey(), argumentsFor("xok"))));
      expect(result).toMatchObject({ _tag: "Failure" });
      expect(failures(result)).toEqual(expect.arrayContaining([expect.objectContaining({ reason: "invalidAuthority" })]));
      const after = await tested.snapshot();
      expect(after.rows).toEqual(before.rows); expect(after.events).toEqual(before.events); expect(after.outcomes).toEqual(before.outcomes);
      await Effect.runPromise(selected.selected.close);
      const captures = [
        (context: AtomicCommerceContext) => context.capture({ value: "native" }, () => Result.fail(commerceError("invalidInput"))),
        (context: AtomicCommerceContext) => context.capture({ invalid: undefined }),
      ];
      for (const [index, capture] of captures.entries()) {
        const refused = await host(tested, (context, input) => Effect.gen(function* () {
          yield* context.call(participant, write, input);
          expect(Result.isFailure(yield* Effect.result(capture(context)))).toBe(true);
          return { caught: true };
        }), { padding: `capture-${index}` });
        const outcome = await Effect.runPromise(Effect.exit(refused.run(refused.selected.newRequestKey(), argumentsFor(`xc${index}`))));
        expect(outcome).toMatchObject({ _tag: "Failure" });
        expect(failures(outcome)).toEqual(expect.arrayContaining([expect.objectContaining({ reason: "invalidInput" })]));
        const unchanged = await tested.snapshot();
        expect(unchanged.rows).toEqual(before.rows); expect(unchanged.events).toEqual(before.events); expect(unchanged.outcomes).toEqual(before.outcomes);
        await Effect.runPromise(refused.selected.close);
      }
    } finally { await tested.close(); }
  }, 120_000);

  it("allows both default-OCC hooks to enter and commits only one conflicting update without callback replay", async () => {
    const tested = await fixture();
    try {
      const seed = await host(tested, (context, args) => context.call(participant, write, args));
      await Effect.runPromise(seed.run(seed.selected.newRequestKey(), argumentsFor("xor")));
      let entered = 0, release: (() => void) | undefined, both: (() => void) | undefined;
      const waiting = new Promise<void>(resolve => { release = resolve; });
      const ready = new Promise<void>(resolve => { both = resolve; });
      const selected = await host(tested, (context, args) => Effect.gen(function* () {
        const result = yield* context.call(participant, write, args);
        entered++; if (entered === 2) both?.();
        yield* Effect.promise(() => waiting);
        return result;
      }));
      const first = Effect.runPromise(Effect.exit(selected.run(selected.selected.newRequestKey(), argumentsFor("xor", "update", "first"))));
      const second = Effect.runPromise(Effect.exit(selected.run(selected.selected.newRequestKey(), argumentsFor("xor", "update", "second"))));
      try { await Effect.runPromise(Effect.tryPromise({ try: () => Promise.race([ready, Promise.all([first, second]).then(() => {
        throw new Error("Both roots settled before both native hooks entered");
      })]), catch: cause => cause }).pipe(Effect.timeout("20 seconds"))); }
      finally { release?.(); }
      const outcomes = await Promise.all([first, second]);
      expect(entered).toBe(2); expect(outcomes.filter(Exit.isSuccess)).toHaveLength(1);
      expect(outcomes.flatMap(failures)).toEqual(expect.arrayContaining([expect.objectContaining({ reason: "writeConflict" })]));
      expect((await tested.snapshot()).events).toHaveLength(2);
      await Effect.runPromise(selected.selected.close); await Effect.runPromise(seed.selected.close);
    } finally { await tested.close(); }
  }, 120_000);

  it("joins exact current requests and recovers the original DTO after argument mutation and lost acknowledgement", async () => {
    const tested = await fixture();
    try {
      let calls = 0, signal: (() => void) | undefined, release: (() => void) | undefined;
      const ready = new Promise<void>(resolve => { signal = resolve; });
      const waiting = new Promise<void>(resolve => { release = resolve; });
      const selected = await host(tested, (context, args) => Effect.gen(function* () {
        calls++;
        signal?.(); yield* Effect.promise(() => waiting);
        return { rows: yield* context.call(participant, write, args), complete: { nested: ["native", "DTO"] } };
      }));
      const fault = tested.loseNextNativeRootAcknowledgement();
      const key = selected.selected.newRequestKey(), args = argumentsFor("xak");
      const first = Effect.runPromise(Effect.exit(selected.run(key, args)));
      await Effect.runPromise(Effect.raceFirst(Effect.promise(() => ready), Effect.promise(() => first).pipe(
        Effect.flatMap(outcome => outcome), Effect.andThen(Effect.die(new Error("Root settled before its native hook entered")))))
        .pipe(Effect.timeout("20 seconds")));
      args.code = "mutated"; args.name = "mutated";
      const follower = Effect.runPromise(Effect.exit(selected.run(key, argumentsFor("xak"))));
      try {
        const changed = await Effect.runPromise(Effect.exit(selected.run(key, argumentsFor("changed"))));
        expect(failures(changed)).toEqual([expect.objectContaining({ reason: "requestConflict" })]);
        const anotherProfile = await host(tested, (context, input) => context.call(participant, write, input), { padding: "another-profile" });
        const refused = await Effect.runPromise(Effect.exit(anotherProfile.run(key, argumentsFor("xak"))));
        expect(failures(refused)).toEqual([expect.objectContaining({ reason: "requestConflict" })]);
        await Effect.runPromise(anotherProfile.selected.close);
      } finally { release?.(); }
      const [firstOutcome, followerOutcome] = await Promise.all([first, follower]);
      const result = await Effect.runPromise(firstOutcome), joined = await Effect.runPromise(followerOutcome);
      expect(joined).toEqual(result);
      expect(result).toMatchObject({ rows: [{ code: "xak" }], complete: { nested: ["native", "DTO"] } });
      expect(fault.failures).toBe(1); expect(calls).toBe(1);
      expect(Object.isFrozen(result)).toBe(true);
      expect(await Effect.runPromise(selected.run(key, argumentsFor("xak")))).toEqual(result); expect(calls).toBe(1);
      expect((await tested.snapshot()).events).toHaveLength(1);
      await Effect.runPromise(selected.selected.close);
    } finally { await tested.close(); }
  }, 120_000);

  it("bounds leaders and followers through existing app admission and detaches canceled or timed-out waiters", async () => {
    const tested = await fixture(2);
    const entered = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>();
    try {
      let calls = 0;
      const selected = await host(tested, (context, args) => Effect.gen(function* () {
        calls++; const rows = yield* context.call(participant, write, args);
        yield* Deferred.succeed(entered, undefined); yield* Deferred.await(release); return rows;
      }));
      const key = selected.selected.newRequestKey();
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const leader = yield* Effect.forkChild(selected.run(key, argumentsFor("xcp")));
        yield* Effect.raceFirst(Deferred.await(entered), Fiber.join(leader).pipe(Effect.andThen(
          Effect.die(new Error("Root settled before its native hook entered")))));
        const follower = yield* Effect.forkChild(selected.run(key, argumentsFor("xcp")));
        yield* Effect.yieldNow;
        const overflow = yield* Effect.exit(selected.run(selected.selected.newRequestKey(), argumentsFor("xno"))
          .pipe(Effect.timeout("2 seconds")));
        expect(failures(overflow)).toEqual([expect.objectContaining({ reason: "limitExceeded" })]);
        yield* Fiber.interrupt(follower);
        const canceled = yield* Fiber.await(follower);
        expect(Exit.isFailure(canceled) && Cause.hasInterrupts(canceled.cause)).toBe(true);
        const timed = yield* Effect.exit(selected.run(key, argumentsFor("xcp")).pipe(Effect.timeoutOrElse({ duration: 20,
          orElse: () => Effect.fail(commerceError("deadlineExceeded")) })));
        expect(failures(timed)).toEqual([expect.objectContaining({ reason: "deadlineExceeded" })]);
        expect(calls).toBe(1);
        const remaining = yield* Effect.forkChild(selected.run(key, argumentsFor("xcp")));
        yield* Effect.yieldNow; yield* Deferred.succeed(release, undefined);
        expect(yield* Fiber.join(remaining)).toEqual(yield* Fiber.join(leader));
      }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)))));
      expect(calls).toBe(1); expect((await tested.snapshot()).events).toHaveLength(1);
      await Effect.runPromise(selected.selected.close);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); await tested.close(); }
  }, 120_000);

  it("refuses an impossible private metadata anchor before any native callback and creates no partial publication", async () => {
    const tested = await fixture();
    try {
      let calls = 0;
      const selected = await host(tested, (context, args) => Effect.gen(function* () {
        calls++; return yield* context.call(participant, write, args);
      }), { padding: "metadata".repeat(25_000) });
      const before = await tested.snapshot();
      const result = await Effect.runPromise(Effect.exit(selected.run(selected.selected.newRequestKey(), argumentsFor("xlg"))));
      expect(failures(result)).toEqual(expect.arrayContaining([expect.objectContaining({ reason: "limitExceeded" })]));
      expect(calls).toBe(0);
      const after = await tested.snapshot();
      expect(after.rows).toEqual(before.rows); expect(after.events).toEqual(before.events); expect(after.outcomes).toEqual(before.outcomes);
      await Effect.runPromise(selected.selected.close);
    } finally { await tested.close(); }
  }, 120_000);

  it("commits an admitted no-event workflow without an event header or outcome wrapper", async () => {
    const tested = await fixture();
    try {
      const selected = await host(tested, (context, args) => context.call(participant, write, args), { events: false });
      const key = selected.selected.newRequestKey(), args = argumentsFor("xne", "insert", "no event", false);
      const result = await Effect.runPromise(selected.run(key, args));
      expect(result).toMatchObject([{ code: "xne", name: "no event" }]);
      expect(await Effect.runPromise(selected.run(key, args))).toEqual(result);
      expect((await tested.snapshot()).events).toHaveLength(0);
      await Effect.runPromise(selected.selected.close);
    } finally { await tested.close(); }
  }, 120_000);

  it("keeps the default call budget and admits an identity-bound larger logical root budget", async () => {
    const tested = await fixture();
    const decode = Schema.decodeUnknownEffect(Schema.Struct({ row: Input, captures: Schema.Int }));
    let callbacks = 0;
    const command = defineAtomicCommerceCommand("neutral-budget-root", (context, input) => Effect.gen(function* () {
      const args = yield* decode(input).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
      callbacks++;
      const rows = yield* context.call(participant, write, args.row);
      for (let index = 0; index < args.captures; index++) yield* context.capture(index);
      return rows;
    }));
    const composition = { identityAndAccessPolicy: { profile: "native-atomic-budget" }, commands: [command],
      participants: [{ participant, nativeStorage: tested.source("currency"), commands: [write] }] };
    const hosts: AtomicCommerceHost[] = [];
    try {
      const ordinary = await tested.run(tested.execution.prepare(composition)); hosts.push(ordinary);
      const input = { row: argumentsFor("xcb", "insert", "bounded", false), captures: 70 };
      const before = await tested.snapshot();
      const refused = await Effect.runPromise(Effect.exit(ordinary.run(ordinary.newRequestKey(), command, input)));
      const refusal = failures(refused);
      expect(refusal).toEqual(expect.arrayContaining([expect.objectContaining({ reason: "rollbackOnly" })]));
      expect(refusal).toEqual(expect.arrayContaining([expect.objectContaining({ reason: "limitExceeded" })]));
      console.info("Neutral default call-budget full Exit", refused);
      expect(await tested.snapshot()).toEqual(before);
      expect(callbacks).toBe(1);

      const selected = await tested.run(tested.execution.prepare({ ...composition, requestCallLimit: 128 })); hosts.push(selected);
      const key = selected.newRequestKey(), result = await Effect.runPromise(selected.run(key, command, input));
      expect(result).toMatchObject([{ code: "xcb" }]); expect(callbacks).toBe(2);
      const committed = await tested.snapshot();
      expect(committed.rows).toHaveLength(before.rows.length + 1);
      expect(committed.outcomes).toHaveLength(before.outcomes.length + 1);
      expect(await Effect.runPromise(selected.run(key, command, input))).toEqual(result);
      expect(callbacks).toBe(2);
      const changed = await Effect.runPromise(Effect.exit(ordinary.run(key, command, input)));
      expect(failures(changed)).toEqual([expect.objectContaining({ reason: "requestConflict" })]);

      const overflow = await Effect.runPromise(Effect.exit(selected.run(selected.newRequestKey(), command,
        { row: argumentsFor("xov", "insert", "overflow", false), captures: 140 })));
      expect(failures(overflow)).toEqual(expect.arrayContaining([expect.objectContaining({ reason: "rollbackOnly" })]));
      expect(failures(overflow)).toEqual(expect.arrayContaining([expect.objectContaining({ reason: "limitExceeded" })]));
      console.info("Neutral selected call-budget overflow full Exit", overflow);
      expect(callbacks).toBe(3);
      expect(await tested.snapshot()).toEqual(committed);
    } finally {
      for (const selected of hosts.reverse()) await Effect.runPromise(selected.close);
      await tested.close();
    }
  }, 120_000);
});
