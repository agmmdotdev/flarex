import { describe, it } from "vitest";
import { nativeProtectedWorkerScenario } from "./support/nativeProtectedWorkerScenario";
const drivers = process.env.FLAREX_POSTGRES_DATABASE_URL === undefined ? ["pglite" as const] : ["pglite" as const, "postgres" as const];
describe.each(drivers)("translated protected mixed Worker on %s", driver => {
  it("executes genuine Product and Payload with one Core root and cold committed replay", () => nativeProtectedWorkerScenario(driver), 240_000);
});
