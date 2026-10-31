import { Effect } from "effect";
import { it } from "vitest";
import { createRelationalPGliteFixture } from "../../database/relationalPGliteWorkerTestSupport";
import { runEffect } from "../../support/effectTestRuntime";
import { makeIndexedPayloadFixture } from "./payloadIndexedFixture";
import { compilePayloadCollections } from "../../../../payload-adapter/src/collections";
import { payloadPendingVisibilityScenario } from "./payloadVisibilityScenario";
import { fullProofPayloadVisibilityTarget } from "./payloadVisibilityFixture";

it("preserves direct native Payload pending reads, root rollback and outcome replay", async () => {
  const resource = await createRelationalPGliteFixture();
  await runEffect(Effect.scoped(Effect.gen(function* () {
    const compiled = yield* compilePayloadCollections([{ slug: "items", fields: [
      { name: "title", type: "text", required: true, unique: true },
    ] }]);
    const tested = yield* makeIndexedPayloadFixture(resource.persistence, resource.session, compiled);
    yield* payloadPendingVisibilityScenario(fullProofPayloadVisibilityTarget(tested));
  })));
}, 180_000);
