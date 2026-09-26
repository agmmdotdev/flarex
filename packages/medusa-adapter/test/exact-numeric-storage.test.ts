import { Effect, Result } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileDmlSchema } from "@medusajs/drizzle/schema";
import { model } from "@medusajs/utils/dml/model";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { makeCommerceHost } from "../../persistence-postgres/src/commerceTransaction/host";
import { defineCommerceCommand } from "../../persistence-postgres/src/commerceTransaction/commands";
import { capturePrivateCanonicalValue } from "../../persistence-postgres/src/frameworkSchema/privateCanonicalValue";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { decodeCompiledDml } from "../src/schema/compiled";
import { lowerDmlSchema } from "../src/schema/lower";
import { encodeExactNumeric, decodeExactNumeric } from "../src/exact-numeric";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";

const Ledger = model.define("NumericLedger", {
  id: model.id().primaryKey(), amount: model.bigNumber(), quantity: model.bigNumber().nullable(),
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
  return [...yield* table.find(ctx.manager, { fields: ["id", "amount", "raw_amount", "quantity", "raw_quantity"],
    take: 10, order: { column: "id", direction: "asc" } })];
}));
const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid numeric test driver");
const cleanup: Array<() => Promise<void>> = [];
let fixture: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
let host: Effect.Success<ReturnType<typeof makeCommerceHost>>;

beforeAll(async () => {
  const native = Ledger.parse();
  // Exercise the native compiler fallback when a foreign parser omits raw_amount.
  const fallback = { name: Ledger.name, schema: Ledger.schema, parse: () => ({ ...native,
    schema: Object.fromEntries(Object.entries(native.schema).filter(([name]) => name !== "raw_amount")),
  }) };
  const checked = await Effect.runPromise(decodeCompiledDml(JSON.parse(JSON.stringify(compileDmlSchema([fallback])))));
  expect(checked.tables[0]?.columns.find(column => column.name === "raw_amount"))
    .toMatchObject({ generated: true, nullable: true, type: "json" });
  const schema = Result.getOrThrow(normalizeRelationalSchema(lowerDmlSchema(checked.tables, "numeric-ledger")));
  const evidence = { kind: "synthetic", sourceId: "numeric-ledger" };
  const source = await Effect.runPromise(captureLogicalSchemaSource({
    key: "medusa.numeric-ledger", owner: "medusa", writeProfile: "medusa.numeric-ledger", evidence,
    definition: { kind: "relational", schema },
    bindings: [{ kind: "definition", localName: "numeric_ledger",
      table: { namespace: "medusa", logicalName: "numeric-ledger/numeric_ledger" } }],
  }));
  fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), { additionalSources: [source] });
  const seed = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset",
    version: 1, rows: [] }, 1_048_576, { invalidInput: () => new Error("Invalid numeric seed"),
      hashFailure: cause => new Error("Numeric seed hash", { cause }) }));
  host = await Effect.runPromise(makeCommerceHost({ ...fixture.hostInput,
    identityAndAccessPolicy: { profile: "logical-numeric-test" },
    logicalStorage: { ...fixture.hostInput.logicalStorage,
      source: { sourceKey: "medusa.numeric-ledger", writeProfile: "medusa.numeric-ledger", schema, evidence },
      initialization: { stepId: "numeric-empty", datasetSha256: seed.sha256Hex, expectedRowCount: 0 } },
    commands: [write, malformed, read],
  }));
  await Effect.runPromise(host.initialize([]));
}, 180_000);
afterAll(async () => {
  if (host !== undefined) await Effect.runPromise(host.close);
  for (const close of cleanup.reverse()) await close();
}, 120_000);

describe("shared logical exact numeric contracts", () => {
  it("uses no generated module tables and transports exact values with one replayed write", async () => {
    expect((await fixture.persistence.query<{ name: string }>(
      "select tablename as name from pg_tables where schemaname = current_schema() order by tablename")).rows)
      .toEqual(fixture.physicalTablesBeforeCandidate);
    const key = host.newRequestKey();
    const value = "9007199254740993.125";
    const output = await Effect.runPromise(host.run(key, write, value));
    expect(await Effect.runPromise(host.run(key, write, value))).toEqual(output);
    expect(await Effect.runPromise(host.read(read, null))).toMatchObject([
      { id: "exact", amount: "9007199254740993.1250", raw_amount: { value: "9007199254740993.1250", precision: 20 },
        quantity: null, raw_quantity: null },
    ]);
    expect(await Effect.runPromise(decodeExactNumeric(value, { value, precision: 20 }))).toBe(Number(value));
    expect(await Effect.runPromise(decodeExactNumeric(null, null, true))).toBeNull();
  });
  it.each(["missing", "null"])("refuses %s required values without committing a row", async mode => {
    expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), malformed, mode))))).toBe(true);
    expect(await Effect.runPromise(host.read(read, null))).toHaveLength(1);
  });
});
