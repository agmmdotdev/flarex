import { Effect } from "effect";
import { it } from "vitest";
import { makeUniquePayloadFixture, payloadUniqueScenario } from "./payloadUniqueScenario";
import { runEffect } from "../../support/effectTestRuntime";

it("executes native Payload required and compound uniqueness over five-table indexes", () =>
  runEffect(Effect.scoped(makeUniquePayloadFixture({ kind: "fresh", driver: "pglite" })
    .pipe(Effect.flatMap(payloadUniqueScenario)))), 180_000);
