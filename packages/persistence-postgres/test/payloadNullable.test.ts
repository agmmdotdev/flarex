import { Effect } from "effect";
import { it } from "vitest";
import { createRelationalPGliteFixture } from "./relationalPGliteWorkerTestSupport";
import { makeNullablePayloadFixture, payloadNullableScenario } from "./payloadNullableScenario";
import { runEffect } from "./effectTestRuntime";

it("executes native Payload nullable keys through shared indexes and claims", async () => {
  const resource = await createRelationalPGliteFixture();
  await runEffect(Effect.scoped(makeNullablePayloadFixture(resource.persistence, resource.session)
    .pipe(Effect.flatMap(payloadNullableScenario))));
}, 180_000);
