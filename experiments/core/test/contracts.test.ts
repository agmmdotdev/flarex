import { randomUUID } from "node:crypto";
import { Cause, Effect, Exit, Result } from "effect";
import { describe, expect, it } from "vitest";
import { compilePayloadDefinition } from "../src/payload-definition.ts";
import { uniqueKeys } from "../src/definition.ts";
import { CoreError, NativeOperationFailure } from "../src/errors.ts";
import { createPayloadHost } from "../src/payload.ts";
import { createRoot } from "../src/root.ts";
import type { Command, Storage } from "../src/storage.ts";
import { newsCollection } from "./fixture.ts";

const command: Command = { id: "command", token: "private-token", request: "request", snapshot: 0, status: "active", result: null };
const backend = (changes: Partial<Storage> = {}): Storage => ({
  metrics: { operations: 0 }, open: () => Effect.succeed(command),
  observeUnique: (_command, keys) => Effect.succeed(keys.map(key => ({ ...key, owner: null }))),
  settle: () => Effect.fail(new CoreError({ reason: "unsupported" })),
  resolve: () => Effect.fail(new CoreError({ reason: "unsupported" })), abort: () => Effect.void,
  read: () => Effect.succeed(null), ...changes,
});

describe("framework-neutral root and native boundary contracts", () => {
  it("detaches and freezes each compiled unique definition", async () => {
    const collection = newsCollection();
    const definition = await Effect.runPromise(Effect.fromResult(compilePayloadDefinition(collection)));
    const first = definition.fields[0];
    expect(first).toBeDefined();
    if (first === undefined) throw new Error("Missing compiled field");
    expect(Reflect.set(first, "unique", false)).toBe(false);
    expect(uniqueKeys(definition, { id: "i", createdAt: "t", updatedAt: "t", headline: "one", score: 0 })).toHaveLength(1);
  });

  it("classifies unsupported native definitions as typed failures", async () => {
    const result = await Effect.runPromise(Effect.result(Effect.scoped(createPayloadHost({ ...newsCollection(), auth: true }, backend(), "shop-a"))));
    expect(Result.isFailure(result) && result.failure).toMatchObject({ _tag: "CoreError", reason: "unsupported" });
    const multiple = newsCollection();
    multiple.fields.push({ name: "slug", type: "text", required: true, unique: true });
    expect(compilePayloadDefinition(multiple)).toMatchObject({ _tag: "Failure", failure: { reason: "unsupported" } });
  });

  it("retains native drain failure and abort cleanup defect when the caller cancels", async () => {
    let release = () => {}; let ready = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { ready = resolve; });
    const collection = newsCollection();
    collection.hooks = { afterChange: [async () => {
      ready(); await gate; throw new Error("native-drain-witness");
    }] };
    const controller = new AbortController();
    const pending = Effect.runPromiseExit(Effect.scoped(Effect.gen(function* () {
      const host = yield* createPayloadHost(collection, backend({ abort: () => Effect.die(new Error("abort-cleanup-witness")) }), "shop-a");
      return yield* host.create(randomUUID(), { headline: "cancel" });
    })), { signal: controller.signal });
    await started; controller.abort(); release();
    const result = await pending;
    expect(Exit.isFailure(result)).toBe(true);
    if (Exit.isFailure(result)) {
      expect(Cause.hasInterrupts(result.cause)).toBe(true);
      expect(result.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error)).toContainEqual(
        expect.objectContaining({ _tag: "NativeFailure", cause: expect.objectContaining({ message: "native-drain-witness" }) }),
      );
      expect(result.cause.reasons.filter(Cause.isDieReason).map(reason => reason.defect)).toContainEqual(
        expect.objectContaining({ message: "abort-cleanup-witness" }),
      );
    }
  });

  it("preserves a combined storage failure and cleanup defect across Payload", async () => {
    const storage = backend({ observeUnique: () => Effect.failCause(Cause.combine(
      Cause.fail(new CoreError({ reason: "storage" })), Cause.die(new Error("cleanup-witness")),
    )) });
    const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const host = yield* createPayloadHost(newsCollection(), storage, "shop-a");
      return yield* Effect.result(host.create(randomUUID(), { headline: "cause" }));
    })));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe("NativeFailure");
      expect(result.failure.cause).toBeInstanceOf(NativeOperationFailure);
      if (!(result.failure.cause instanceof NativeOperationFailure)) throw new Error("Missing full native cause");
      expect(Cause.pretty(result.failure.cause.cause)).toContain("cleanup-witness");
      expect(Cause.findErrorOption(result.failure.cause.cause)).toMatchObject({ value: { reason: "storage" } });
    }
  });

  it("refuses concurrent duplicate identities without losing a successful row", async () => {
    const definition = await Effect.runPromise(Effect.fromResult(compilePayloadDefinition(newsCollection())));
    let release = () => {};
    let ready = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { ready = resolve; });
    let calls = 0;
    const storage = backend({ observeUnique: (_command, keys) => Effect.promise(async () => {
      if (++calls === 2) ready();
      await gate;
      return keys.map(key => ({ ...key, owner: null }));
    }) });
    const root = await Effect.runPromise(createRoot(definition, storage, command));
    const pending = ["one", "two"].map(headline => Effect.runPromiseExit(root.insert({
      id: "same", headline, score: 0, createdAt: "t", updatedAt: "t",
    })));
    await started; release();
    const results = await Promise.all(pending);
    expect(results.filter(Exit.isSuccess)).toHaveLength(1);
    expect(results.filter(Exit.isFailure)).toHaveLength(1);
    expect(root.diagnostics().rows).toBe(1);
    expect(Exit.isFailure(await Effect.runPromiseExit(root.freeze()))).toBe(true);
  });
});
