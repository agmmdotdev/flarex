import { describe, expect, it } from "vitest";

import { createFlarexExecutor } from "../src/index";

describe("createFlarexExecutor", () => {
  it("returns stable health state directly", async () => {
    const executor = createFlarexExecutor({
      clock: { now: () => new Date("2026-06-19T00:00:00.000Z") },
      persistence: healthyPersistence(),
    });

    await expect(executor.health()).resolves.toEqual({
      service: "flarex-executor",
      status: "ok",
      persistence: { status: "ok" },
      time: "2026-06-19T00:00:00.000Z",
    });
  });

  it("reports degraded health when persistence fails", async () => {
    const executor = createFlarexExecutor({
      clock: { now: () => new Date("2026-06-19T00:00:00.000Z") },
      persistence: {
        async check() {
          throw new Error("database unavailable");
        },
      },
    });

    await expect(executor.health()).resolves.toEqual({
      service: "flarex-executor",
      status: "degraded",
      persistence: {
        status: "error",
        message: "database unavailable",
      },
      time: "2026-06-19T00:00:00.000Z",
    });
  });
});

function healthyPersistence() {
  return {
    async check() {
      return { status: "ok" as const };
    },
  };
}
