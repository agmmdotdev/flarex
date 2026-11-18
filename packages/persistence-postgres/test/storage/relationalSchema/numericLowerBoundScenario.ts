import { Effect, Result, Schema } from "effect";
import { expect } from "vitest";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { defineCommerceCommand, makeCommerceHost } from "../../../src/frameworks/commerceTransaction/host";
import { commerceError } from "../../../src/frameworks/commerceTransaction/model";
import { capturePrivateCanonicalValue } from "../../../src/installation/frameworkSchema/privateCanonicalValue";
import { fxAppRowCurrent, fxAppRowRevisions, fxAppIndexEntryCurrent, fxAppIndexEntryRevisions,
  fxSystemCommits, fxSystemIdempotency, fxSystemCommitAppRowChanges, fxSystemScopeClocks } from "../../../src/database/schema";
import { prepareNeutralLogicalFixture } from "./neutralLogicalFixture";
import { numericLowerBoundSchemaInput } from "./numericLowerBoundFixture";
import type { Json, JsonObject } from "flarex-protocol/json";

const evidence = { kind: "synthetic", sourceId: "neutral-numeric-bound" };
const decodeRows = Schema.decodeUnknownEffect(Schema.Array(Schema.JsonObject));
export async function numericLowerBoundScenario(driver: "pglite" | "postgres") {
  const cleanup: Array<() => Promise<void>> = [];
  try {
    const definitions = ["main", "initial", "invalid-initial"].map(kind => ({ kind,
      schema: Result.getOrThrow(normalizeRelationalSchema(numericLowerBoundSchemaInput("neutral-numeric-bound-" + kind))) }));
    const sources: Array<Effect.Success<ReturnType<typeof captureLogicalSchemaSource>>> = [];
    for (const { kind, schema } of definitions) sources.push(await Effect.runPromise(captureLogicalSchemaSource({
      key: "medusa.numeric-bound." + kind, owner: "medusa", writeProfile: "numeric-bound." + kind, evidence,
      definition: { kind: "relational", schema }, bindings: [{ kind: "definition", localName: "entry",
        table: { namespace: "medusa", logicalName: schema.coordinate.lineageId + "/entry" } }],
    })));
    const fixture = await prepareNeutralLogicalFixture(driver, close => cleanup.push(close), { name: "neutral-numeric-bound", sources });
    if (driver === "postgres") expect((await fixture.persistence.query<{ ordinary: boolean }>(
      "select not (rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls) as ordinary from pg_roles where rolname=current_user")).rows).toEqual([{ ordinary: true }]);
    const insert = defineCommerceCommand("numericBoundInsert", "write", (ctx, input) => Effect.gen(function* () {
      const rows = yield* decodeRows(input).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
      return [...yield* (yield* ctx.table("entry")).write(ctx.manager, "insert", rows)];
    }));
    const update = defineCommerceCommand("numericBoundUpdate", "write", (ctx, input) => Effect.gen(function* () {
      const rows = yield* decodeRows(input).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
      return [...yield* (yield* ctx.table("entry")).write(ctx.manager, "update", rows)];
    }));
    const read = defineCommerceCommand("numericBoundRead", "read", ctx => Effect.gen(function* () {
      return [...yield* (yield* ctx.table("entry")).find(ctx.manager, { order: { column: "id", direction: "asc" } })];
    }));
    const pending = defineCommerceCommand("numericBoundPending", "write", ctx => Effect.gen(function* () {
      const table = yield* ctx.table("entry");
      yield* table.write(ctx.manager, "insert", [{ id: "pending", amount: "1e-10000" }]);
      expect(yield* table.find(ctx.manager, { predicate: { kind: "in", column: "id", values: ["pending"] } })).toMatchObject([{ id: "pending", amount: "1e-10000" }]);
      return [...yield* table.write(ctx.manager, "update", [{ id: "pending", amount: "-1e-10000" }])];
    }));
    const commands = [insert, update, read, pending];
    const prepare = async (index: number, rows: readonly JsonObject[] = []) => {
      const definition = definitions[index]!, source = sources[index]!;
      const seed = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows }, 1_048_576,
        { invalidInput: () => new Error("Invalid neutral numeric seed"), hashFailure: cause => new Error("Neutral numeric hash", { cause }) }));
      const host = await Effect.runPromise(makeCommerceHost({ ...fixture.hostInput, commands, identityAndAccessPolicy: { profile: "neutral-numeric-bound" },
        logicalStorage: { ...fixture.hostInput.logicalStorage,
          source: { sourceKey: source.key, writeProfile: source.writeProfile, schema: definition.schema, evidence },
          initialization: { stepId: "numeric-bound-seed", datasetSha256: seed.sha256Hex, expectedRowCount: rows.length } } }));
      cleanup.push(() => Effect.runPromise(host.close)); return host;
    };
    const main = await prepare(0); await Effect.runPromise(main.initialize([]));
    const inventory = async () => ({
      rows: await fixture.persistence.drizzle.select().from(fxAppRowCurrent), revisions: await fixture.persistence.drizzle.select().from(fxAppRowRevisions),
      indexes: await fixture.persistence.drizzle.select().from(fxAppIndexEntryCurrent), indexHistory: await fixture.persistence.drizzle.select().from(fxAppIndexEntryRevisions),
      commits: await fixture.persistence.drizzle.select().from(fxSystemCommits), facts: await fixture.persistence.drizzle.select().from(fxSystemCommitAppRowChanges),
      outcomes: await fixture.persistence.drizzle.select().from(fxSystemIdempotency), clocks: await fixture.persistence.drizzle.select().from(fxSystemScopeClocks),
    });
    const run = (command: typeof insert, input: Json) => Effect.runPromise(main.run(main.newRequestKey(), command, input));
    const refuses = async (action: () => Promise<unknown>) => {
      const before = await inventory(); await expect(action()).rejects.toBeDefined(); expect(await inventory()).toEqual(before);
    };
    await run(insert, [{ id: "zero", amount: "-0" }, { id: "null", amount: null }, { id: "tiny", amount: "1e-10000" },
      { id: "large", amount: "9007199254740993.000000000000000001" }]);
    const rows = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject))(await Effect.runPromise(main.read(read, null)));
    expect(rows.find(row => row.id === "large")?.amount).toBe("9007199254740993.000000000000000001");
    for (const amount of ["-1e-10000", "-0.01"]) await refuses(() => run(insert, [{ id: "prefix", amount: "1" }, { id: "invalid", amount }]));
    await refuses(() => run(update, [{ id: "zero", floor: "1.0000000000000000009" }]));
    await refuses(() => run(pending, null));
    const request = main.newRequestKey(), changed = await Effect.runPromise(main.run(request, update, [{ id: "zero", amount: "2.125" }]));
    const after = await inventory(); expect(await Effect.runPromise(main.run(request, update, [{ id: "zero", amount: "2.125" }]))).toEqual(changed); expect(await inventory()).toEqual(after);
    const cold = await prepare(0); expect(await Effect.runPromise(cold.read(read, null))).toEqual(await Effect.runPromise(main.read(read, null)));
    const seedRows = [{ id: "initial", amount: "0" }], seeded = await prepare(1, seedRows);
    expect(await Effect.runPromise(seeded.initialize(seedRows))).toEqual({ rowCount: 1 });
    const badRows = [{ id: "prefix", amount: "1" }, { id: "bad", amount: "-1e-10000" }], invalid = await prepare(2, badRows);
    await refuses(() => Effect.runPromise(invalid.initialize(badRows)));
  } finally { for (const close of cleanup.reverse()) await close(); }
}
