import { describe, expect, it } from "vitest";

import { createFlarexExecutor } from "../src/index";

describe("createFlarexExecutor", () => {
  it("serves a stable health response", async () => {
    const executor = createFlarexExecutor({
      clock: { now: () => new Date("2026-06-19T00:00:00.000Z") },
    });

    const response = await executor.fetch(
      new Request("https://executor.test/health"),
    );

    await expect(response.json()).resolves.toEqual({
      service: "flarex-executor",
      status: "ok",
      time: "2026-06-19T00:00:00.000Z",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
  });

  it("returns a JSON 404 for unknown routes", async () => {
    const executor = createFlarexExecutor();

    const response = await executor.fetch(
      new Request("https://executor.test/unknown"),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "not_found",
      message: "No Flarex executor route for GET /unknown",
    });
  });
});
