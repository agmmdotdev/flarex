import { Effect } from "effect";
import { describe, it } from "vitest";
import { payloadNativeBudgetCases, payloadNativeBudgetScenario } from "./payloadNativeBudgetScenario";
import { postgresUrl } from "../../support/postgresHelpers";
import { runEffect } from "../../support/effectTestRuntime";

describe.skipIf(postgresUrl === null || !process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL)("native Payload byte budget (ordinary PostgreSQL)", () => {
  it.each(payloadNativeBudgetCases)("preserves one request counter across hidden members and input: %s", mode =>
    runEffect(Effect.scoped(payloadNativeBudgetScenario({ kind: "fresh", driver: "postgres" }, mode))), 180_000);
});
