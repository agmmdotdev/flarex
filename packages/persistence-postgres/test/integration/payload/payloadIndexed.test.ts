import { Effect } from "effect";
import { it } from "vitest";
import { createRelationalPGliteFixture } from "../../database/relationalPGliteWorkerTestSupport";
import { makeIndexedPayloadFixture } from "./payloadIndexedFixture";
import { payloadIndexedScenario } from "./payloadIndexedScenario";
import { runEffect } from "../../support/effectTestRuntime";

it("executes indexed Payload ranges, compound prefixes and pending membership", async () => {
  const resource = await createRelationalPGliteFixture();
  await runEffect(Effect.scoped(makeIndexedPayloadFixture(resource.persistence, resource.session)
    .pipe(Effect.flatMap(tested => Effect.promise(() => payloadIndexedScenario(tested))))));
}, 180_000);
