import { Effect } from "effect";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { commerceHostFixture, type CommerceHostTestFixture } from "../../frameworks/commerceTransaction/commerceHostFixture";
import { commerceInventory } from "../../frameworks/commerceTransaction/commerceInventory";
import { createRelationalPGliteFixture } from "../../database/relationalPGliteWorkerTestSupport";
import { createMigratedPGlitePersistence } from "../../support/pgliteTestFixture";
import { createFileScopedPostgresFixture } from "../../support/postgresHelpers";
import { makePostgresRelationalSession } from "../../../src/database/relationalTransaction/session";
import { captureRelationalSchemaArtifact } from "../../../src/storage/relationalSchema/artifact";
import { captureRelationalPhysicalLayout } from "../../../src/storage/relationalSchema/physical/canonical";
import { registerLocalCommerceProfile } from "../../../src/frameworks/commerceTransaction/profile";
import { defineCommerceCommand } from "../../../src/frameworks/commerceTransaction/commands";
import { commerceError } from "../../../src/frameworks/commerceTransaction/model";
import { binary64SchemaInput, binary64Values } from "./doublePrecisionFixture";

const prepare = Effect.fn(function* (deploymentId: string, target: Parameters<Parameters<typeof commerceHostFixture>[2]>[1]) {
  const captured = yield* captureRelationalSchemaArtifact({ deploymentId, schema: binary64SchemaInput(),
    provenance: { kind: "sourceSnapshot", repository: "https://example.com/binary64", revision: "d".repeat(40), paths: ["model.ts"] } });
  const layout = yield* captureRelationalPhysicalLayout({ artifact: captured.artifact, ...target });
  const profile = yield* registerLocalCommerceProfile(captured.artifact, layout, "test.binary64", [{ tableId: "measure", keyId: "measure.primary" }]);
  return { profile, initialization: { rows: undefined } };
});
const write = defineCommerceCommand("binary64Write", "write", (ctx, rows) => ctx.store.write(ctx.manager, "insert", rows));
const read = defineCommerceCommand("binary64Read", "read", ctx => ctx.store.find(ctx.manager, { order: { column: "value", direction: "asc" } }));
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
}, 180_000);
afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);
const run = (rows: Parameters<typeof fixture.host.run>[2]) => Effect.runPromise(fixture.host.run(fixture.host.newRequestKey(), write, rows));

describe("installed physical binary64 scalar", () => {
  it("executes and cold-verifies typed defaults, finite writes and numeric ordering", async () => {
    // commerceHostFixture performs installation and a cold profile reopen through
    // the structural runner, including actual pg_get_expr default attestation.
    expect(await run([{ id: "default" }])).toMatchObject([{ id: "default", value: 1.25, large_default: 1e30, optional: null, count: 7 }]);
    await run(binary64Values.map((value, index) => ({ id: "number-" + index, value })));
    const values = (await Effect.runPromise(fixture.host.read(read, null)));
    expect(Array.isArray(values)).toBe(true);
    if (!Array.isArray(values)) throw new Error("Missing binary64 result rows");
    expect(values.map(row => row.value)).toEqual([...binary64Values, 1.25].sort((left, right) => left - right));
    const actual = await commerceInventory(fixture);
    expect(actual.rows.find(row => row.id === "number-4")?.value).toBe(Number.MIN_VALUE);
    expect(actual.rows.find(row => row.id === "number-8")?.value).toBe(Number.MAX_VALUE);
    expect(actual.rows.find(row => row.id === "default")).toMatchObject({ value: 1.25, large_default: 1e30, optional: null, count: 7 });
  });

  it("retains canonical zero equality, int32 validation and atomic rejection", async () => {
    const before = await commerceInventory(fixture);
    for (const rows of [[{ id: "duplicate-zero", value: -0 }], [{ id: "bad-int", value: 2.5, count: 2147483648 }], [{ id: "bad-finite", value: Infinity }]]) {
      await expect(run(rows)).rejects.toBeDefined();
      expect(await commerceInventory(fixture)).toEqual(before);
    }
  });
});
