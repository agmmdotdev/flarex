import { Effect } from "effect";
import { it } from "vitest";
import { makeIndexedPayloadFixture } from "./payloadIndexedFixture";
import { payloadIndexedScenario } from "./payloadIndexedScenario";
import { payloadIndexedVisibilityCases, payloadIndexedVisibilityScenario } from "./payloadIndexedVisibilityScenario";
import { runEffect } from "../../support/effectTestRuntime";

it("executes native indexed Payload queries and pending membership over five-table storage", () =>
  runEffect(Effect.scoped(makeIndexedPayloadFixture({ kind: "fresh", driver: "pglite" })
    .pipe(Effect.flatMap(tested => Effect.tryPromise({ try: () => payloadIndexedScenario(tested), catch: cause => cause }))))), 180_000);

it.each(payloadIndexedVisibilityCases)("preserves native ordinary-range observations on PGlite: %s", mode =>
  runEffect(Effect.scoped(makeIndexedPayloadFixture({ kind: "fresh", driver: "pglite" }).pipe(
    Effect.flatMap(tested => payloadIndexedVisibilityScenario(tested, mode))))), 120_000);
