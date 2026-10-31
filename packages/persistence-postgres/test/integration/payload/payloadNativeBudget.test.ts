import { Effect } from "effect";
import { it } from "vitest";
import { payloadNativeBudgetCases, payloadNativeBudgetScenario } from "./payloadNativeBudgetScenario";
import { runEffect } from "../../support/effectTestRuntime";

it.each(payloadNativeBudgetCases)("preserves the shared native request byte bound: %s", mode =>
  runEffect(Effect.scoped(payloadNativeBudgetScenario({ kind: "fresh", driver: "pglite" }, mode))), 180_000);
