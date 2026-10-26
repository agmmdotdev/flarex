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
import { numericLowerBoundSchemaInput } from "./numericLowerBoundFixture";

const prepare = Effect.fn(function* (deploymentId: string, target: Parameters<Parameters<typeof commerceHostFixture>[2]>[1]) {
  const captured = yield* captureRelationalSchemaArtifact({ deploymentId, schema: numericLowerBoundSchemaInput(),
    provenance: { kind: "sourceSnapshot", repository: "https://example.com/numeric-bound", revision: "e".repeat(40), paths: ["model.ts"] } });
  const layout = yield* captureRelationalPhysicalLayout({ artifact: captured.artifact, ...target });
  const profile = yield* registerLocalCommerceProfile(captured.artifact, layout, "test.numeric-bound", [{ tableId: "entry", keyId: "entry.primary" }]);
  return { profile, initialization: { rows: undefined } };
});
const write = defineCommerceCommand("numericBoundPhysicalWrite", "write", (ctx, rows) => ctx.store.write(ctx.manager, "insert", rows));
const read = defineCommerceCommand("numericBoundPhysicalRead", "read", ctx => ctx.store.find(ctx.manager, { order: { column: "id", direction: "asc" } }));
const cleanup: Array<() => Promise<void>> = [];
let fixture: CommerceHostTestFixture;
beforeAll(async () => {
  const registerCleanup = (close: () => Promise<void>) => cleanup.push(close), postgres = process.env.FLAREX_TEST_DRIVER === "postgres";
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
describe("installed physical exact numeric lower bounds", () => {
  it("installs and cold-verifies SQL checks, precise defaults and SQL NULL", async () => {
    expect(await run([{ id: "zero", amount: "-0", negative: "-1.25" }, { id: "null" }, { id: "tiny", amount: "1e-1000" },
      { id: "large", amount: "9007199254740993.000000000000000001" }])).toMatchObject([
      { id: "zero", amount: "0", floor: "1.000000000000000001", negative: "-1.25" }, { id: "null", amount: null }, { id: "tiny" },
      { id: "large", amount: "9007199254740993.000000000000000001" },
    ]);
  });
  it("refuses negative and below-bound values atomically", async () => {
    const before = await commerceInventory(fixture);
    for (const invalid of [{ amount: "-1e-1000" }, { floor: "1.0000000000000000009" }, { negative: "-1.250000000000000001" }]) {
      await expect(run([{ id: "prefix", amount: "1" }, { id: "bad", ...invalid }])).rejects.toBeDefined();
      expect(await commerceInventory(fixture)).toEqual(before);
    }
  });
});
