import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect, Result, Schema } from "effect";
import { eq } from "drizzle-orm";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { decodeOrderedIndexComponentsV1, orderedIndexFloat64ToNumberV1, orderedIndexKeyBytesHexV1FromBytes } from "flarex-protocol/ordered-index";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { capturePrivateCanonicalValue } from "../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { defineCommerceCommand } from "../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { makeCommerceHost } from "../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { fxAppRowCurrent, fxSystemCommits, fxAppIndexEntryCurrent } from "../../persistence-postgres/src/database/schema";
import { prepareLogicalReadIndexReadinessWitness } from "../../persistence-postgres/test/storage/documents/logicalReadIndexReadinessTestSupport";
import { binary64SchemaInput, binary64Values } from "../../persistence-postgres/test/storage/relationalSchema/doublePrecisionFixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
const schema = Result.getOrThrow(normalizeRelationalSchema(binary64SchemaInput()));
const sourceKey = "medusa.neutral-binary64", evidence = { kind: "synthetic", sourceId: "neutral.binary64-storage" };
const write = defineCommerceCommand("neutralBinary64Write", "write", Effect.fn(function* (ctx, input) {
  const table = yield* ctx.table("measure"); return [...yield* table.write(ctx.manager, "insert", input)];
}));
const read = defineCommerceCommand("neutralBinary64Read", "read", Effect.fn(function* (ctx) {
  const table = yield* ctx.table("measure"); return [...yield* table.find(ctx.manager, { order: { column: "value", direction: "asc" } })];
}));
const commands = [write, read];
let fixture: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
let host: Effect.Success<ReturnType<typeof makeCommerceHost>>;
let storage: Awaited<ReturnType<typeof makeStorage>>;
async function makeStorage() {
  const empty = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] }, 1_048_576,
    { invalidInput: () => new Error("Invalid neutral binary64 dataset"), hashFailure: cause => new Error("Neutral binary64 dataset hash", { cause }) }));
  return { ...fixture.hostInput.logicalStorage, source: { sourceKey, writeProfile: sourceKey, schema, evidence },
    initialization: { stepId: "neutral-binary64-empty", datasetSha256: empty.sha256Hex, expectedRowCount: 0 } };
}
async function prepareSource() {
  return Effect.runPromise(captureLogicalSchemaSource({ key: sourceKey, owner: "medusa", writeProfile: sourceKey, evidence,
    definition: { kind: "relational", schema }, bindings: [{ kind: "definition", localName: "measure",
      table: { namespace: "medusa", logicalName: "neutral-binary64/measure" } }] }));
}
const run = (input: Parameters<typeof host.run>[2]) => Effect.runPromise(host.run(host.newRequestKey(), write, input));
const rows = () => Effect.runPromise(host.read(read, null));
const snapshot = async () => ({ rows: await fixture.persistence.drizzle.select().from(fxAppRowCurrent),
  commits: await fixture.persistence.drizzle.select().from(fxSystemCommits) });

describe("neutral shared logical binary64 scalar", () => {
  beforeAll(async () => {
    fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), { additionalSources: [await prepareSource()] });
    storage = await makeStorage();
    host = await Effect.runPromise(makeCommerceHost({ ...fixture.hostInput, logicalStorage: storage, commands }));
    cleanup.push(() => Effect.runPromise(host.close)); await Effect.runPromise(host.initialize([]));
  }, 180_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("persists complete finite values and defaults with numeric ordering and replay", async () => {
    expect(await run([{ id: "default" }])).toMatchObject([{ value: 1.25, large_default: 1e30, optional: null, count: 7 }]);
    const key = host.newRequestKey(), input = binary64Values.map((value, index) => ({ id: "number-" + index, value }));
    const result = await Effect.runPromise(host.run(key, write, input)), before = await snapshot();
    expect(await Effect.runPromise(host.run(key, write, input))).toEqual(result);
    expect(await snapshot()).toEqual(before);
    const selected = await rows();
    if (!Array.isArray(selected)) throw new Error("Missing neutral binary64 rows");
    expect(selected.map(row => row.value)).toEqual([...binary64Values, 1.25].sort((left, right) => left - right));
  });

  it("materializes actual binary64 ordered keys and canonical zero uniqueness", async () => {
    const witness = await prepareLogicalReadIndexReadinessWitness({ controlDb: fixture.control.drizzle, targetDb: fixture.testOwner.drizzle,
      deploymentId: fixture.deploymentId, schemaVersionId: fixture.schemaVersionId, scopeId: fixture.application.authority.scopeId,
      sourceKey, localName: "measure", field: "value", visibility: "all" });
    const entries = await fixture.persistence.drizzle.select().from(fxAppIndexEntryCurrent)
      .where(eq(fxAppIndexEntryCurrent.indexDefinitionId, witness.indexDefinitionId)).orderBy(fxAppIndexEntryCurrent.encodedKey);
    const actual = entries.map(entry => {
      const value = decodeOrderedIndexComponentsV1(orderedIndexKeyBytesHexV1FromBytes(entry.encodedKey), 2)[0];
      if (value?.kind !== "float64") throw new Error("Missing binary64 materialized index component");
      return orderedIndexFloat64ToNumberV1(value);
    });
    expect(actual).toEqual([...binary64Values, 1.25].sort((left, right) => left - right));
    const before = await snapshot();
    await expect(run([{ id: "duplicate-zero", value: -0 }])).rejects.toBeDefined();
    expect(await snapshot()).toEqual(before);
  });

  it("refuses nonfinite values, int32 overflow and source reinterpretation without changing committed data", async () => {
    const before = await snapshot();
    for (const input of [[{ id: "bad-double", value: Infinity }], [{ id: "bad-int", value: 3.5, count: 2147483648 }]]) {
      await expect(run(input)).rejects.toBeDefined(); expect(await snapshot()).toEqual(before);
    }
    const changed = binary64SchemaInput();
    const replacement = Result.getOrThrow(normalizeRelationalSchema({ ...changed, tables: changed.tables.map(table => ({ ...table,
      columns: table.columns.map(column => column.columnId === "value" ? { ...column, type: "integer", default: { kind: "integerLiteral", value: 1 } } : column) })) }));
    await expect(Effect.runPromise(makeCommerceHost({ ...fixture.hostInput, commands,
      logicalStorage: { ...storage, source: { ...storage.source, schema: replacement } } }))).rejects.toMatchObject({ reason: "invalidAuthority", cause: { reason: "sourceMismatch" } });
    expect(await snapshot()).toEqual(before);
  });
});
