import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Cause, Effect, Exit, Fiber, Schema } from "effect";
import { expect, it } from "vitest";
import { acquireCycleAttribution } from "./cycleAttribution";

it.skipIf(process.env.FLAREX_MEASUREMENT_CYCLE_READER === undefined)("restores the actual installed runner after failure and interruption", async () => {
  const readerPath = process.env.FLAREX_MEASUREMENT_CYCLE_READER;
  if (readerPath === undefined) throw new Error("Explicit native reader required");
  const require = createRequire(import.meta.url);
  const engine: unknown = await import(/* @vite-ignore */pathToFileURL(resolve(dirname(require.resolve("effect")), "internal/effect.js")).href);
  const { FiberImpl } = Schema.decodeUnknownSync(Schema.Struct({ FiberImpl: Schema.Unknown }))(engine);
  if (typeof FiberImpl !== "function") throw new Error("Expected real installed engine");
  const prototype: unknown = FiberImpl.prototype;
  if (typeof prototype !== "object" || prototype === null) throw new Error("Expected real installed prototype");
  const originalDescriptor = Object.getOwnPropertyDescriptor(prototype, "runLoop");
  const resource = await acquireCycleAttribution({ readerPath, detail: "engine", order: "abba" });
  try {
    const original = new Error("original business refusal"), failure = resource.create(true);
    await expect(failure.capture(async () => { await Effect.runPromise(Effect.succeed(1)); throw original; })).rejects.toBe(original);
    expect(failure.evidence().complete).toBe(true);
    expect(Object.getOwnPropertyDescriptor(prototype, "runLoop")).toEqual(originalDescriptor);
    const interrupted = resource.create(true); let finalized = 0;
    await interrupted.capture(async () => {
      const fiber = Effect.runFork(Effect.never.pipe(Effect.ensuring(Effect.sync(() => { finalized++; }))));
      await Effect.runPromise(Fiber.interrupt(fiber));
      const exit = await Effect.runPromise(Fiber.await(fiber));
      expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true);
    });
    expect(finalized).toBe(1);
    expect(interrupted.evidence().complete).toBe(true);
    expect(Object.getOwnPropertyDescriptor(prototype, "runLoop")).toEqual(originalDescriptor);
    const missing = resource.create(true);
    expect(await missing.capture(async () => 17)).toBe(17);
    expect(missing.evidence().complete).toBe(false);
    expect(Object.getOwnPropertyDescriptor(prototype, "runLoop")).toEqual(originalDescriptor);
  } finally { await resource.close(); }
});
