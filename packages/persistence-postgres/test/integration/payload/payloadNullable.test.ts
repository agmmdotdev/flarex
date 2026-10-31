import { Effect } from "effect";
import { it } from "vitest";
import { makeNullablePayloadFixture, payloadNullableScenario } from "./payloadNullableScenario";
import { runEffect } from "../../support/effectTestRuntime";

it("executes native Payload nullable keys over five-table indexes", () =>
  runEffect(Effect.scoped(makeNullablePayloadFixture({ kind: "fresh", driver: "pglite" })
    .pipe(Effect.flatMap(payloadNullableScenario)))), 180_000);
