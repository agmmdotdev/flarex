import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";

import { createFlarexExecutor } from "../src";
import { getExecutorHealthEffect } from "../src/health";
import { runEffect } from "./effectTestRuntime";
import { healthyPersistence } from "./helpers/persistence";

describe("createFlarexExecutor", () => {
  it("returns stable health state directly", async () => {
    const executor = createFlarexExecutor({
      clock: { now: () => new Date("2026-06-19T00:00:00.000Z") },
      persistence: healthyPersistence(),
    });

    await expect(executor.health()).resolves.toEqual({
      service: "executor",
      status: "ok",
      persistence: { status: "ok" },
      time: "2026-06-19T00:00:00.000Z",
    });
  });

  it("reports degraded health when persistence fails", async () => {
    const executor = createFlarexExecutor({
      clock: { now: () => new Date("2026-06-19T00:00:00.000Z") },
      persistence: {
        ...healthyPersistence(),
        async check() {
          throw new Error("database unavailable");
        },
      },
    });

    await expect(executor.health()).resolves.toEqual({
      service: "executor",
      status: "degraded",
      persistence: {
        status: "error",
        message: "database unavailable",
      },
      time: "2026-06-19T00:00:00.000Z",
    });
  });

  it("completes the persistence check before reading the configured clock once", async () => {
    const events: string[] = [];
    let finishCheck: (() => void) | undefined;
    const checkPending = new Promise<void>((resolve) => {
      finishCheck = resolve;
    });
    const executor = createFlarexExecutor({
      clock: {
        now: () => {
          events.push("clock");
          return new Date("2026-06-19T00:00:00.000Z");
        },
      },
      persistence: {
        ...healthyPersistence(),
        async check() {
          events.push("check:start");
          await checkPending;
          events.push("check:end");
          return { status: "ok" as const };
        },
      },
    });

    const healthPending = executor.health();
    expect(events).toEqual(["check:start"]);
    finishCheck?.();
    await healthPending;

    expect(events).toEqual(["check:start", "check:end", "clock"]);
  });

  it("preserves a throwing configured clock as the public rejection cause", async () => {
    const clockFailure = new Error("clock unavailable");
    const executor = createFlarexExecutor({
      clock: {
        now: () => {
          throw clockFailure;
        },
      },
      persistence: healthyPersistence(),
    });

    await expect(executor.health()).rejects.toBe(clockFailure);
  });

  it("preserves the invalid Date RangeError rejection", async () => {
    const executor = createFlarexExecutor({
      clock: { now: () => new Date(Number.NaN) },
      persistence: healthyPersistence(),
    });

    await expect(executor.health()).rejects.toThrow(RangeError);
  });

  it("preserves configured Date method dispatch at the compatibility boundary", async () => {
    class ConfiguredDate extends Date {
      override getTime(): number {
        return 0;
      }

      override toISOString(): string {
        return "configured-clock-iso";
      }
    }
    const executor = createFlarexExecutor({
      clock: {
        now: () => new ConfiguredDate("2026-06-19T00:00:00.000Z"),
      },
      persistence: healthyPersistence(),
    });

    await expect(executor.health()).resolves.toMatchObject({
      time: "configured-clock-iso",
    });
  });

  it("preserves a configured Date formatting failure by identity", async () => {
    const formattingFailure = new Error("clock formatting unavailable");
    class FailingConfiguredDate extends Date {
      override toISOString(): string {
        throw formattingFailure;
      }
    }
    const executor = createFlarexExecutor({
      clock: {
        now: () => new FailingConfiguredDate("2026-06-19T00:00:00.000Z"),
      },
      persistence: healthyPersistence(),
    });

    await expect(executor.health()).rejects.toBe(formattingFailure);
  });

  it("uses Effect TestClock in the internal health operation", async () => {
    const persistence = healthyPersistence();
    const result = await runEffect(Effect.gen(function* () {
      yield* TestClock.setTime(
        new Date("2026-06-20T12:34:56.789Z").getTime(),
      );
      return yield* getExecutorHealthEffect(persistence);
    }).pipe(Effect.provide(TestClock.layer())));

    expect(result).toEqual({
      service: "executor",
      status: "ok",
      persistence: { status: "ok" },
      time: "2026-06-20T12:34:56.789Z",
    });
  });
});
