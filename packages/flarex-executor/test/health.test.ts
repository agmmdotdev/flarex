import { describe, expect, it } from "vitest";

import { createFlarexExecutor } from "../src/index";

describe("createFlarexExecutor", () => {
  it("returns stable health state directly", () => {
    const executor = createFlarexExecutor({
      clock: { now: () => new Date("2026-06-19T00:00:00.000Z") },
    });

    expect(executor.health()).toEqual({
      service: "flarex-executor",
      status: "ok",
      time: "2026-06-19T00:00:00.000Z",
    });
  });
});
