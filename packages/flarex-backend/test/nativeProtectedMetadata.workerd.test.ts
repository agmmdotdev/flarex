import { describe, it } from "vitest";
import { nativeProtectedMetadataWorkerScenarios } from "./support/nativeProtectedMetadataWorkerScenarios";

const drivers = process.env.FLAREX_POSTGRES_DATABASE_URL === undefined ? ["pglite" as const] : ["pglite" as const, "postgres" as const];
describe.each(drivers)("translated protected Worker metadata on %s", driver => {
  it("permits compatible schema handoff and refuses actor ABA and explicit revocation", () =>
    nativeProtectedMetadataWorkerScenarios(driver), 240_000);
});
