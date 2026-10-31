import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { compilePayloadCollections } from "../../payload-adapter/src/collections";
import { makePayloadRuntime } from "../../payload-adapter/src/runtime";
import { inspectPayloadRuntimeForTest, withPayloadRuntimeScopeForTest } from "../../payload-adapter/src/testing";
import { bindCmsCommand, makeCmsCommandBinding } from "../../persistence-postgres/src/frameworks/cmsTransaction/construction";
import type { CmsCommand } from "../../persistence-postgres/src/frameworks/cmsTransaction/commands";
import { postgresUrl } from "../../persistence-postgres/test/support/postgresHelpers";
import { runEffect } from "../../persistence-postgres/test/support/effectTestRuntime";
import { payloadDisjointVisibilityScenario, payloadPendingVisibilityScenario, payloadUniqueAbaVisibilityScenario,
  payloadVisibilityScenario } from
  "../../persistence-postgres/test/integration/payload/payloadVisibilityScenario";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";

describe.skipIf(postgresUrl === null || !process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL)("source-profile Payload visibility", () => {
  it.each(["pending", "overlap", "disjoint", "unique-key-aba"] as const)("characterizes the actual source CMS binding: %s", async vector => {
    const cleanup: Array<() => Promise<void>> = [];
    const body = await Promise.allSettled([Promise.resolve().then(async () => {
      const fixture = await logicalCurrencyFixture("postgres", close => cleanup.push(close), { managedRead: true });
      if (fixture.resource.kind !== "postgres") throw new Error("Expected ordinary PostgreSQL fixture");
      const role = await fixture.resource.target.query<{ superuser: boolean }>(
        "select rolsuper as superuser from pg_roles where rolname=current_user");
      expect(role.rows[0]?.superuser).toBe(false);
      await runEffect(Effect.scoped(Effect.gen(function* () {
        const compiled = yield* compilePayloadCollections([{ slug: "news", fields: [
          { name: "title", type: "text", required: true, unique: true },
        ] }]);
        const runtime = yield* makePayloadRuntime(compiled);
        const commands = inspectPayloadRuntimeForTest(runtime).commands;
        const openHost = (extra: readonly CmsCommand[]) => withPayloadRuntimeScopeForTest(runtime, Effect.gen(function* () {
          const binding = yield* makeCmsCommandBinding({
            serving: yield* fixture.application.makeServing(fixture.session), hostRuntime: fixture.hostInput.hostRuntime,
            identityAndAccessPolicy: { profile: "payload.scalar", access: "closed-headless-local-api" },
            profile: { kind: "source", schemaVersionId: fixture.schemaVersionId, source: compiled.sourceContract },
          });
          return yield* bindCmsCommand(binding, [...Object.values(commands), ...extra], compiled.contentIdentity);
        }));
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
        }
      })));
    })]);
    const failures = body.flatMap(result => result.status === "rejected" ? [result.reason] : []);
    for (const close of cleanup.reverse()) {
      const result = await Promise.allSettled([close()]);
      failures.push(...result.flatMap(exit => exit.status === "rejected" ? [exit.reason] : []));
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "Source Payload visibility and cleanup failed", { cause: failures[0] });
  }, 180_000);
});
