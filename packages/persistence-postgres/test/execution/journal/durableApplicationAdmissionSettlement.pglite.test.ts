import { Effect } from "effect";
import { it } from "vitest";
import { runEffect } from "../../support/effectTestRuntime";
import { createSessionJournalStorePGliteFixture } from "./journalFixture";
import { durableApplicationAdmissionSettlementScenario } from "./durableApplicationAdmissionSettlementScenario";

it("preserves real durable admission refusal and post-rollback settlement rejection (PGlite)", () => runEffect(Effect.scoped(Effect.gen(function* () {
  const fixture = yield* Effect.acquireRelease(Effect.tryPromise(createSessionJournalStorePGliteFixture),
    owner => Effect.tryPromise(owner.close).pipe(Effect.orDie));
  yield* durableApplicationAdmissionSettlementScenario(fixture);
}))), 120_000);
