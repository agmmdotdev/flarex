import { Effect } from "effect";
import { it } from "vitest";
import { createRelationalPGliteFixture } from "./relationalPGliteWorkerTestSupport";
import { makeUniquePayloadFixture, payloadUniqueScenario } from "./payloadUniqueScenario";
import { runEffect } from "./effectTestRuntime";

it("executes native Payload multiple and compound uniqueness through shared claims", async () => {
  const resource = await createRelationalPGliteFixture();
  await runEffect(Effect.scoped(makeUniquePayloadFixture(resource.persistence, resource.session)
    .pipe(Effect.flatMap(payloadUniqueScenario))));
}, 180_000);
