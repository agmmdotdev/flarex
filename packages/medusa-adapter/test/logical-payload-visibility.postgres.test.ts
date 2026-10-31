import { describe, it } from "vitest";
import { Effect } from "effect";
import { inspectPayloadRuntimeForTest } from "../../payload-adapter/src/testing";
import { postgresUrl } from "../../persistence-postgres/test/support/postgresHelpers";
import { payloadCachedKeyCoherenceScenario, payloadCapturedOwnerConflictScenario,
  payloadDisjointVisibilityScenario, payloadPendingVisibilityScenario, payloadUniqueAbaVisibilityScenario,
  payloadVisibilityScenario } from
  "../../persistence-postgres/test/integration/payload/payloadVisibilityScenario";
import { createCorePayloadFixture } from "./support/core-payload-fixture";

for (const driver of ["pglite", "postgres"] as const) describe.skipIf(driver === "postgres" &&
  (postgresUrl === null || !process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL))(`core-native Payload visibility (${driver})`, () => {
  it.each(driver === "pglite" ? ["pending"] as const : ["pending", "overlap", "disjoint", "unique-key-aba",
    "cached-key-point", "cached-key-table", "captured-owner-conflict"] as const)("preserves the actual source CMS binding: %s", async vector => {
    const fixture = await createCorePayloadFixture(driver);
    const body = await Promise.allSettled([Promise.resolve().then(async () => {
      // createCorePostgresFixture verifies its runtime pool is an ordinary role.
      await fixture.run(Effect.gen(function* () {
        const commands = inspectPayloadRuntimeForTest(fixture.runtime).commands;
        const openHost = fixture.openHost;
        const host = yield* openHost([]);
        const target = { collection: "news" as const, commands, host, openHost,
          // This profile observes its own native records; it does not borrow the
          // full-proof fixture's physical inventory or emulate publication.
          inventory: host.read(commands.find, { collection: "news", where: {}, limit: 32, pagination: false }) };
        switch (vector) {
          case "pending": yield* payloadPendingVisibilityScenario(target); break;
          case "overlap": yield* payloadVisibilityScenario(target); break;
          case "disjoint": yield* payloadDisjointVisibilityScenario(target); break;
          case "unique-key-aba": yield* payloadUniqueAbaVisibilityScenario(target); break;
          case "cached-key-point": yield* payloadCachedKeyCoherenceScenario(target, "point"); break;
          case "cached-key-table": yield* payloadCachedKeyCoherenceScenario(target, "table"); break;
          case "captured-owner-conflict": yield* payloadCapturedOwnerConflictScenario(target); break;
        }
      }));
    })]);
    const failures = body.flatMap(result => result.status === "rejected" ? [result.reason] : []);
    for (const close of [fixture.close]) {
      const result = await Promise.allSettled([close()]);
      failures.push(...result.flatMap(exit => exit.status === "rejected" ? [exit.reason] : []));
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "Source Payload visibility and cleanup failed", { cause: failures[0] });
  }, 180_000);
});
