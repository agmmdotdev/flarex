import { describe, expect, it } from "vitest";

import { createFlarexExecutor } from "flarex-executor";

import { createFlarexNitroHandler } from "../src/index";

describe("createFlarexNitroHandler", () => {
  it("delegates health requests to the executor core", async () => {
    const handler = createFlarexNitroHandler({
      executor: createFlarexExecutor({
        clock: { now: () => new Date("2026-06-19T00:00:00.000Z") },
      }),
    });

    const response = await handler({
      request: new Request("https://executor.test/health"),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      service: "flarex-executor",
      status: "ok",
      time: "2026-06-19T00:00:00.000Z",
    });
  });
});
