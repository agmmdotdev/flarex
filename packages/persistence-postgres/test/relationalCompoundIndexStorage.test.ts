import { Effect } from "effect";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { commerceHostFixture, type CommerceHostTestFixture } from "./commerceHostFixture";
import { createRelationalPGliteFixture } from "./relationalPGliteWorkerTestSupport";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";
import { createFileScopedPostgresFixture } from "./postgresHelpers";
import { makePostgresRelationalSession } from "../src/relationalTransaction/session";
import { captureRelationalSchemaArtifact } from "../src/relationalSchema/artifact";
import { captureRelationalPhysicalLayout } from "../src/relationalSchema/physical/canonical";
import { registerLocalCommerceProfile } from "../src/commerceTransaction/profile";
import { defineCommerceCommand } from "../src/commerceTransaction/commands";
import { commerceError } from "../src/commerceTransaction/model";
import { compoundIndexSchema, compoundIndexValue } from "./compoundIndexFixture";

const prepare = Effect.fn(function* (deploymentId: string, target: Parameters<Parameters<typeof commerceHostFixture>[2]>[1]) {
  const captured = yield* captureRelationalSchemaArtifact({ deploymentId,
    provenance: { kind: "sourceSnapshot", repository: "https://example.com/compound", revision: "d".repeat(40), paths: ["model.ts"] },
    schema: compoundIndexSchema(),
  });
  const layout = yield* captureRelationalPhysicalLayout({ artifact: captured.artifact, ...target });
  const profile = yield* registerLocalCommerceProfile(captured.artifact, layout, "test.compound", [{ tableId: "listing", keyId: "listing.primary" }]);
  return { profile, initialization: { rows: undefined } };
});
const write = defineCommerceCommand("compoundWrite", "write", Effect.fn(function* (ctx) {
  const table = yield* ctx.table("listing");
  return [...yield* table.write(ctx.manager, "insert", [
    { id: "active", state: compoundIndexValue }, { id: "draft", state: "draft" },
    { id: "retired", state: compoundIndexValue, retired: "2026-09-14T00:00:00.000Z" },
  ])];
}));
const read = defineCommerceCommand("compoundRead", "read", Effect.fn(function* (ctx) {
  const table = yield* ctx.table("listing");
  return [...yield* table.find(ctx.manager, { fields: ["id", "state", "retired"], take: 10, order: { column: "id", direction: "asc" } })];
}));
const cleanup: Array<() => Promise<void>> = [];
let fixture: CommerceHostTestFixture;
beforeAll(async () => {
  const registerCleanup = (close: () => Promise<void>) => cleanup.push(close);
  const postgres = process.env.FLAREX_TEST_DRIVER === "postgres";
  const resource = postgres ? await (async () => {
    const value = await createFileScopedPostgresFixture(); registerCleanup(value.dispose);
    return { persistence: value.persistence, session: makePostgresRelationalSession(value.persistence) };
  })() : await createRelationalPGliteFixture({ registerCleanup });
  const control = postgres ? resource.persistence : await createMigratedPGlitePersistence(registerCleanup);
  fixture = await commerceHostFixture(resource.persistence, resource.session, prepare, [write, read], control, () => ({
    capture: () => Effect.fail(commerceError("unadmittedEvent")),
    validate: events => events.length ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void,
    deliver: events => events.length ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void,
  }));
}, 120000);
afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120000);

describe("installed compound index", () => {
  it("installs, verifies and cold-reopens the escaped predicate without broadening row membership", async () => {
    const key = fixture.host.newRequestKey();
    const output = await Effect.runPromise(fixture.host.run(key, write, null));
    expect(await Effect.runPromise(fixture.host.run(key, write, null))).toEqual(output);
    expect(await Effect.runPromise(fixture.host.read(read, null))).toMatchObject([
      { id: "active", state: compoundIndexValue, retired: null }, { id: "draft", state: "draft" }, { id: "retired", state: compoundIndexValue },
    ]);
    const index = fixture.descriptor.layout.frame.tables[0]?.indexes[0];
    if (!index || index.predicate?.kind !== "isNullAndTextEquals") throw new Error("Missing installed compound index");
    const catalog = await fixture.persistence.query<{ predicate: string }>(
      "select pg_get_expr(i.indpred, i.indrelid) as predicate from pg_index i join pg_class c on c.oid=i.indexrelid where c.relname=$1", [index.name]);
    expect(catalog.rows).toEqual([{ predicate: `((${index.predicate.nullColumn} IS NULL) AND (${index.predicate.textColumn} = 'active'') AND (true) -- \\ $fx$'::text))` }]);
  });
});
