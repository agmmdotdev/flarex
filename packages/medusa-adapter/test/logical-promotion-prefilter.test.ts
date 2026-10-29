import { afterAll, beforeAll, expect, it } from "vitest";
import { Cause, Effect, Exit, Result, Schema } from "effect";
import { portablePromotionRuleQueryFilter } from "@medusajs/promotion/prefilter";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { defineCommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { capturePrivateCanonicalValue, commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeCommerceHost } from "../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { capturePromotionMetadata, compilePromotionDefinition } from "../src/modules/promotion/schema";
import { preparePromotionPrefilterPort } from "../src/modules/promotion/prefilter-port";
import { withCommerceService } from "../src/module/service-bridge";
import { commerceRepositoryContext } from "../src/repository/context";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
const Seed = Schema.Struct({ values: Schema.Array(Schema.String), operator: Schema.String,
  automatic: Schema.Boolean, detached: Schema.Boolean, historical: Schema.Boolean });
const decodeSeed = Schema.decodeUnknownEffect(Seed);
const participant = defineAtomicCommerceParticipant("promotionPrefilter");

async function prepare() {
  const definition = await Effect.runPromise(compilePromotionDefinition());
  const metadata = await Effect.runPromise(capturePromotionMetadata());
  const port = Result.getOrThrow(preparePromotionPrefilterPort(metadata.frame));
  const source = await Effect.runPromise(captureLogicalSchemaSource({ key: "medusa.promotion-prefilter", owner: "medusa", writeProfile: "medusa.promotion-prefilter",
    evidence: definition.provenance, definition: { kind: "relational", schema: definition.schema }, bindings: definition.schema.tables.map(table => ({
      kind: "definition", localName: table.identity.tableId, table: { namespace: "medusa", logicalName: definition.schema.coordinate.lineageId + "/" + table.identity.tableId },
    })) }));
  const fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), { additionalSources: [source] });
  const seed = defineCommerceCommand("promotionPrefilterSeed", "write", (ctx, input) => Effect.gen(function* () {
    const data = yield* decodeSeed(input).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
    for (const name of ["promotion_rule_value", "promotion_promotion_rule", "application_method_target_rules", "application_method_buy_rules", "promotion_application_method", "promotion", "promotion_rule"]) {
      const table = yield* ctx.table(name);
      const rows = yield* table.find(ctx.manager, { order: { column: name === "promotion_promotion_rule" ? "promotion_id" :
        name.startsWith("application_method_") ? "application_method_id" : "id", direction: "asc" } });
      const entity = port.entities.find(entity => entity.table.name === name);
      if (entity === undefined) return yield* ctx.refuse(commerceError("unsupportedProfile"));
      if (rows.length) yield* table.delete(ctx.manager, rows.map(row => Object.fromEntries(entity.primary.map(column => [column, row[column]]))));
    }
    yield* (yield* ctx.table("promotion")).write(ctx.manager, "insert", [{ id: "promo_root", code: "ROOT", type: "standard", status: "active", is_automatic: data.automatic }]);
    yield* (yield* ctx.table("promotion_rule")).write(ctx.manager, "insert", [{ id: "rule", attribute: "threshold", operator: data.operator,
      ...(data.historical ? { deleted_at: "2026-01-01T00:00:00.000Z" } : {}) }]);
    if (data.values.length) yield* (yield* ctx.table("promotion_rule_value")).write(ctx.manager, "insert", data.values.map((value, index) => ({
      id: "value_" + index, promotion_rule_id: "rule", value, ...(data.historical ? { deleted_at: "2026-01-01T00:00:00.000Z" } : {}),
    })));
    if (!data.detached) yield* (yield* ctx.table("promotion_promotion_rule")).write(ctx.manager, "insert", [{ promotion_id: "promo_root", promotion_rule_id: "rule" }]);
    return null;
  }));
  const read = defineCommerceCommand("promotionPrefilterNative", "read", (ctx, input) => withCommerceService(ctx,
    owner => port.bind(commerceRepositoryContext(ctx, owner)),
    persistence => portablePromotionRuleQueryFilter({ currency_code: "usd", threshold: input }, { manager: ctx.manager, transactionManager: ctx.manager }, persistence)));
  const commands = [seed, read];
  const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] }, 1_048_576,
    { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) }));
  const logicalStorage = { ...fixture.hostInput.logicalStorage, source: { sourceKey: source.key, writeProfile: source.writeProfile, schema: definition.schema, evidence: definition.provenance },
    initialization: { stepId: "promotion-prefilter-empty", datasetSha256: dataset.sha256Hex, expectedRowCount: 0 } };
  const reader = await Effect.runPromise(makeCommerceHost({ ...fixture.hostInput, logicalStorage, commands }));
  cleanup.push(() => Effect.runPromise(reader.close)); await Effect.runPromise(reader.initialize([]));
  const seedRoot = defineAtomicCommerceCommand("promotionPrefilterSeedRoot", (ctx, input) => ctx.call(participant, seed, input));
  const readRoot = defineAtomicCommerceCommand("promotionPrefilterReadRoot", (ctx, input) => ctx.call(participant, read, input));
  const receipts: unknown[] = [];
  const host = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.hostInput, executionIsolation: "scopeExclusive", commands: [seedRoot, readRoot],
    participants: [{ participant, logicalStorage, commands, validateLogicalCall: (call, activity) => Effect.sync(() => {
      expect(call.events).toEqual([]);
      if (call.commandName === "promotionPrefilterNative") {
        expect(activity.mutations).toEqual([]);
        receipts.push(activity);
      }
    }) }] }));
  cleanup.push(() => Effect.runPromise(host.close));
  return { host, receipts, seed: (input: typeof Seed.Type) => Effect.runPromise(host.run(host.newRequestKey(), seedRoot, input)),
    read: (input: string | readonly string[]) => Effect.runPromiseExit(host.run(host.newRequestKey(), readRoot, typeof input === "string" ? input : [...input])) };
}

let connected: Awaited<ReturnType<typeof prepare>>;
beforeAll(async () => { connected = await prepare(); }, 240_000);
afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 180_000);

it("runs the native complete Rule/Value program and retains the genuine related match receipt", async () => {
  await connected.seed({ values: ["1", "4"], operator: "gt", automatic: true, detached: false, historical: false });
  expect(await connected.read("2")).toMatchObject({ _tag: "Success", value: { id: { $in: [] } } });
  expect(connected.receipts.at(-1)).toMatchObject({ relationalReads: expect.arrayContaining([{
    table: "promotion_rule", query: expect.objectContaining({ childTable: "promotion_rule_value", foreignKey: expect.any(String) }),
    total: 1, returned: 1, orderedIdentities: [{ id: "rule" }],
    related: { childTable: "promotion_rule_value", foreignKeyConstraintId: expect.any(String) },
  }]) });
});

it("preserves native lexical suppression, historical casts and no-automatic-root skip", async () => {
  await connected.seed({ values: ["bad"], operator: "gte", automatic: true, detached: false, historical: false });
  expect(await connected.read(["bad", "2"])).toMatchObject({ _tag: "Success", value: { id: { $in: ["promo_root"] } } });
  await connected.seed({ values: ["bad"], operator: "gt", automatic: true, detached: true, historical: true });
  const failed = await connected.read("2");
  expect(Exit.isFailure(failed)).toBe(true);
  if (Exit.isFailure(failed)) expect(failed.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error.reason)).toContain("resourceFailure");
  await connected.seed({ values: ["bad"], operator: "gt", automatic: false, detached: false, historical: false });
  expect(await connected.read("2")).toMatchObject({ _tag: "Success", value: { id: { $in: [] } } });
});
