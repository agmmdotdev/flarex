import { Effect, Result } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileDmlSchema } from "@medusajs/drizzle/schema";
import { model } from "@medusajs/utils/dml/model";
import { captureRelationalSchemaArtifact } from "@flarex/persistence-postgres/internal/relational-schema-values";
import { decodeCompiledDml } from "../src/schema/compiled";
import { lowerDmlSchema } from "../src/schema/lower";
import { encodeExactNumeric, decodeExactNumeric } from "../src/exact-numeric";
import { commerceHostFixture, type CommerceHostTestFixture } from "../../persistence-postgres/test/commerceHostFixture";
import { createRelationalPGliteFixture } from "../../persistence-postgres/test/relationalPGliteWorkerTestSupport";
import { createMigratedPGlitePersistence } from "../../persistence-postgres/test/pgliteTestFixture";
import { createFileScopedPostgresFixture } from "../../persistence-postgres/test/postgresHelpers";
import { makePostgresRelationalSession } from "../../persistence-postgres/src/relationalTransaction/session";
import { captureRelationalPhysicalLayout, verifyStoredRelationalPhysicalValue } from "../../persistence-postgres/src/relationalSchema/physical/canonical";
import { registerLocalCommerceProfile } from "../../persistence-postgres/src/commerceTransaction/profile";
import { defineCommerceCommand } from "../../persistence-postgres/src/commerceTransaction/commands";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";

const Ledger = model.define("NumericLedger", {
  id: model.id().primaryKey(), amount: model.bigNumber(), quantity: model.bigNumber().nullable(),
});
const prepare = Effect.fn(function* (deploymentId: string, target: Parameters<Parameters<typeof commerceHostFixture>[2]>[1]) {
  const native = Ledger.parse();
  // Exercise the actual compiler fallback when a foreign parser omits raw_amount.
  const fallback = { name: Ledger.name, schema: Ledger.schema, parse: () => ({ ...native,
    schema: Object.fromEntries(Object.entries(native.schema).filter(([name]) => name !== "raw_amount")),
  }) };
  const checked = yield* decodeCompiledDml(JSON.parse(JSON.stringify(compileDmlSchema([fallback]))));
  expect(checked.tables[0]?.columns.find(column => column.name === "raw_amount"))
    .toMatchObject({ generated: true, nullable: true, type: "json" });
  const captured = yield* captureRelationalSchemaArtifact({ deploymentId,
    provenance: { kind: "sourceSnapshot", repository: "https://example.com/numeric-ledger", revision: "d".repeat(40), paths: ["model.ts"] },
    schema: lowerDmlSchema(checked.tables, "numeric-ledger"),
  });
  const layout = yield* captureRelationalPhysicalLayout({ artifact: captured.artifact, ...target });
  expect(yield* verifyStoredRelationalPhysicalValue({ kind: "physicalLayout", canonicalBytes: new TextEncoder().encode(layout.canonicalJson), sha256Hex: layout.layoutSha256 })).toEqual(layout.frame);
  const profile = yield* registerLocalCommerceProfile(captured.artifact, layout, "test.numeric", [{ tableId: "numeric_ledger", keyId: "numeric_ledger.primary" }]);
  return { profile, initialization: { rows: undefined } };
});
const write = defineCommerceCommand("numericWrite", "write", Effect.fn(function* (ctx, input) {
  if (typeof input !== "string") return yield* ctx.refuse(commerceError("invalidInput"));
  const numeric = yield* encodeExactNumeric(input);
  const table = yield* ctx.table("numeric_ledger");
  return [...yield* table.write(ctx.manager, "insert", [{ id: "exact", amount: numeric.value, raw_amount: { ...numeric.raw } }])];
}));
const malformed = defineCommerceCommand("numericMalformed", "write", Effect.fn(function* (ctx, input) {
  const table = yield* ctx.table("numeric_ledger");
  return [...yield* table.write(ctx.manager, "insert", [{ id: "invalid", ...(input === "null" ? { amount: null } : {}) }])];
}));
const read = defineCommerceCommand("numericRead", "read", Effect.fn(function* (ctx) {
  const table = yield* ctx.table("numeric_ledger");
  return [...yield* table.find(ctx.manager, { fields: ["id", "amount", "raw_amount", "quantity", "raw_quantity"], take: 10, order: { column: "id", direction: "asc" } })];
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
  fixture = await commerceHostFixture(resource.persistence, resource.session, prepare, [write, malformed, read], control, () => ({
    capture: () => Effect.fail(commerceError("unadmittedEvent")),
    validate: events => events.length ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void,
    deliver: events => events.length ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void,
  }));
}, 120000);
afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120000);

describe("installed exact numeric contracts", () => {
  it("installs and restores default-free pairs, transports exact values and replays without a second write", async () => {
    const key = fixture.host.newRequestKey();
    const value = "9007199254740993.125";
    const output = await Effect.runPromise(fixture.host.run(key, write, value));
    expect(await Effect.runPromise(fixture.host.run(key, write, value))).toEqual(output);
    expect(await Effect.runPromise(fixture.host.read(read, null))).toMatchObject([
      { id: "exact", amount: "9007199254740993.1250", raw_amount: { value: "9007199254740993.1250", precision: 20 }, quantity: null, raw_quantity: null },
    ]);
    expect(await Effect.runPromise(decodeExactNumeric(value, { value, precision: 20 }))).toBe(Number(value));
    expect(await Effect.runPromise(decodeExactNumeric(null, null, true))).toBeNull();
  });
  it.each(["missing", "null"])("refuses %s required values without committing a row", async mode => {
    expect(Result.isFailure(await Effect.runPromise(Effect.result(fixture.host.run(fixture.host.newRequestKey(), malformed, mode))))).toBe(true);
    const rows = await Effect.runPromise(fixture.host.read(read, null));
    expect(rows).toHaveLength(1);
  });
});
