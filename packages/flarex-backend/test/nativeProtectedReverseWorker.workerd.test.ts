import { describe, it } from "vitest";
import { nativeProtectedReverseWorkerScenarios } from "./support/nativeProtectedReverseWorkerScenarios";

const drivers = process.env.FLAREX_POSTGRES_DATABASE_URL === undefined
  ? ["pglite" as const] : ["pglite" as const, "postgres" as const];

describe.each(drivers)("translated protected reverse Worker on %s", driver => {
  it("preserves visible hydration, cumulative scan limits, pending generation and selection ABA", () =>
    nativeProtectedReverseWorkerScenarios(driver), 240_000);
});
