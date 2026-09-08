import { afterAll, beforeAll, expect, it } from "vitest";
import { Effect } from "effect";
import { defineCommerceCommand } from "../src/commerceTransaction/commands";
import { registerLocalCommerceProfile } from "../src/commerceTransaction/profile";
import { commerceError } from "../src/commerceTransaction/model";
import { captureRelationalSchemaArtifact } from "../src/relationalSchema/artifact";
import { captureRelationalPhysicalLayout } from "../src/relationalSchema/physical/canonical";
import { makePostgresRelationalSession } from "../src/relationalTransaction/session";
import { commerceHostFixture, type CommerceHostTestFixture } from "./commerceHostFixture";
import { commerceInventory } from "./commerceInventory";
import { createRelationalPGliteFixture } from "./relationalPGliteWorkerTestSupport";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";
import { createFileScopedPostgresFixture } from "./postgresHelpers";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

const cleanup: Array<() => Promise<void>> = [];
let fixture: CommerceHostTestFixture;
const insert = defineCommerceCommand("plainInsert", "write", (context, rows) => context.store.write(context.manager, "insert", rows));
const update = defineCommerceCommand("plainUpdate", "write", (context, rows) => context.store.write(context.manager, "update", rows));
beforeAll(async () => {
  const native = process.env.FLAREX_TEST_DRIVER === "postgres";
  const registerCleanup = (close: () => Promise<void>) => cleanup.push(close);
  const resource = native ? await (async () => {
    const resource = await createFileScopedPostgresFixture(); registerCleanup(resource.dispose);
    return { persistence: resource.persistence, session: makePostgresRelationalSession(resource.persistence) };
  })() : await createRelationalPGliteFixture({ registerCleanup });
  const control = native ? resource.persistence : await createMigratedPGlitePersistence(registerCleanup);
  fixture = await commerceHostFixture(resource.persistence, resource.session, Effect.fn("PlainCommerceTest.prepare")(function* (deploymentId, target) {
    const origin = { kind: "authored", sourceId: "plain-row" };
    const artifact = yield* captureRelationalSchemaArtifact({ deploymentId,
      provenance: { kind: "sourceSnapshot", repository: "https://example.com/plain-row", revision: "a".repeat(40), paths: ["model.ts"] },
      schema: { owner: "medusa", lineageId: "plain-row", tables: [{ tableId: "plain", origin,
        columns: [
          { columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
          { columnId: "value", type: "text", nullable: true, default: { kind: "none" }, origin },
          { columnId: "amount", type: "numeric", nullable: true, default: { kind: "none" }, origin },
        ], keys: [{ keyId: "plain.primary", kind: "primary", columns: ["id"], origin }], indexes: [], constraints: [], relationships: [] }], capabilities: [] },
    });
    const layout = yield* captureRelationalPhysicalLayout({ artifact: artifact.artifact, ...target });
    const profile = yield* registerLocalCommerceProfile(artifact.artifact, layout, "test.plain", [{ tableId: "plain", keyId: "plain.primary", update: "existingPrimaryKey" }]);
    return { profile, initialization: { rows: undefined } };
  }), [insert, update], control, () => ({
    capture: () => Effect.fail(commerceError("unsupportedProfile")),
    validate: events => events.length === 0 ? Effect.void : Effect.fail(commerceError("adapterFailure")),
    deliver: () => Effect.void,
  }));
}, 120000);
afterAll(async () => { for (const close of cleanup.reverse()) await close(); });

it("preserves ordered exact rows across column groups and distinguishes key-only updates from mutations", async () => {
  const inserted = await runEffect(fixture.host.run(fixture.host.newRequestKey(), insert,
    [{ id: "b", value: "second", amount: "9007199254740993.01" }, { id: "a", value: "first" }]));
  expect(inserted).toEqual([{ id: "b", value: "second", amount: "9007199254740993.01" }, { id: "a", value: "first", amount: null }]);
  const before = await commerceInventory(fixture);
  const updated = await runEffect(fixture.host.run(fixture.host.newRequestKey(), update, [{ id: "b" }, { id: "a", value: "changed" }]));
  expect(updated).toEqual([{ id: "b", value: "second", amount: "9007199254740993.01" }, { id: "a", value: "changed", amount: null }]);
  const after = await commerceInventory(fixture);
  expect(after.facts.slice(before.facts.length)).toMatchObject([{ operation: "update" }]);
  const noOp = await runEffect(fixture.host.run(fixture.host.newRequestKey(), update, [{ id: "b" }]));
  expect(noOp).toEqual([{ id: "b", value: "second", amount: "9007199254740993.01" }]);
  expect((await commerceInventory(fixture)).facts).toEqual(after.facts);
});

it("rejects missing or duplicate keys and rolls back successful earlier column groups", async () => {
  const before = await commerceInventory(fixture);
  for (const rows of [[{ id: "missing" }], [{ id: "a" }, { id: "a", value: "duplicate" }],
    [{ id: "a", value: "must roll back" }, { id: "missing", amount: "1" }]]) {
    expect(await runEffectFailure(fixture.host.run(fixture.host.newRequestKey(), update, rows))).toMatchObject({ reason: "invalidInput" });
    expect(await commerceInventory(fixture)).toEqual(before);
  }
  await runEffectFailure(fixture.host.run(fixture.host.newRequestKey(), insert, [{ id: "new", value: "must roll back" }, { id: "a", amount: "1" }]));
  expect(await commerceInventory(fixture)).toEqual(before);
});
