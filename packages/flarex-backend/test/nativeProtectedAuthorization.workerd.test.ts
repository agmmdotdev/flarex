import { describe, it } from "vitest";
import { nativeProtectedAuthorizationWorkerScenario } from "./support/nativeProtectedAuthorizationWorkerScenarios";

const drivers = process.env.FLAREX_POSTGRES_DATABASE_URL === undefined ? ["pglite" as const] : ["pglite" as const, "postgres" as const];
describe.each(drivers)("translated protected native authorization on %s", driver => {
  it("uses genuine hook normalization, native access and separate assignment/retention grants", () =>
    nativeProtectedAuthorizationWorkerScenario(driver), 240_000);
});
