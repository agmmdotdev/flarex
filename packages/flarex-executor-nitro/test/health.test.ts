import { describe, expect, it } from "vitest";

import { createFlarexExecutor } from "flarex-executor";

import { createFlarexNitroHandler } from "../src/index";

describe("createFlarexNitroHandler", () => {
  it("maps health requests to the executor core", async () => {
    const handler = createFlarexNitroHandler({
      executor: createFlarexExecutor({
        clock: { now: () => new Date("2026-06-19T00:00:00.000Z") },
        persistence: healthyPersistence(),
      }),
    });

    const response = await handler({
      request: new Request("https://executor.test/health"),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      service: "flarex-executor",
      status: "ok",
      persistence: { status: "ok" },
      time: "2026-06-19T00:00:00.000Z",
    });
  });

  it("returns a JSON 404 for unknown adapter routes", async () => {
    const handler = createFlarexNitroHandler({
      executor: createFlarexExecutor({
        persistence: healthyPersistence(),
      }),
    });

    const response = await handler({
      request: new Request("https://executor.test/unknown"),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "not_found",
      message: "No Flarex executor adapter route for GET /unknown",
    });
  });

  it("serializes degraded executor health without failing the route", async () => {
    const handler = createFlarexNitroHandler({
      executor: createFlarexExecutor({
        clock: { now: () => new Date("2026-06-19T00:00:00.000Z") },
        persistence: {
          async check() {
            throw new Error("database unavailable");
          },
        },
      }),
    });

    const response = await handler({
      request: new Request("https://executor.test/health"),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
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
