import { afterAll, beforeAll, expect, it } from "vitest";
import { Cause, Effect, Exit, Result, Schema } from "effect";
import { portablePromotionRuleQueryFilter } from "@medusajs/promotion/prefilter";
import { defineCommerceCommand, type LogicalCommerceCallValidation } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { capturePromotionMetadata } from "../src/modules/promotion/schema";
import { preparePromotionPrefilterPort } from "../src/modules/promotion/prefilter-port";
import { withCommerceService } from "../src/module/service-bridge";
import { commerceRepositoryContext } from "../src/repository/context";
import { finishOrderFixture } from "./support/core-order-fixture";
import { prepareCorePromotionFixture } from "./support/core-promotion-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
const Seed = Schema.Struct({ values: Schema.Array(Schema.String), operator: Schema.String,
  automatic: Schema.Boolean, detached: Schema.Boolean, historical: Schema.Boolean,
  otherRootIds: Schema.optionalKey(Schema.Array(Schema.String)) });
const decodeSeed = Schema.decodeUnknownEffect(Seed);
const decodeSelector = Schema.decodeUnknownEffect(Schema.Struct({ id: Schema.Struct({ $in: Schema.Array(Schema.String) }) }),
  { onExcessProperty: "error" });
const participant = defineAtomicCommerceParticipant("promotionPrefilter");

async function prepare() {
  const metadata = await Effect.runPromise(capturePromotionMetadata());
  const port = Result.getOrThrow(preparePromotionPrefilterPort(metadata.frame));
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
    if (data.otherRootIds?.length) yield* (yield* ctx.table("promotion")).write(ctx.manager, "insert", data.otherRootIds.map(id => ({
      id, code: id, type: "standard", status: "active", is_automatic: true,
    })));
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
    persistence => portablePromotionRuleQueryFilter({ currency_code: "usd", threshold: input }, { manager: ctx.manager, transactionManager: ctx.manager }, persistence))
    // Consume Medusa's internal selector inside the proof command, as the native compute service does.
    .pipe(Effect.flatMap(selector => decodeSelector(selector).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)))),
      Effect.map(selector => selector.id.$in)));
  const commands = [seed, read];
  const fixture = await prepareCorePromotionFixture(driver, close => cleanup.push(close), commands);
  const seedRoot = defineAtomicCommerceCommand("promotionPrefilterSeedRoot", (ctx, input) => ctx.call(participant, seed, input));
  const readRoot = defineAtomicCommerceCommand("promotionPrefilterReadRoot", (ctx, input) => ctx.call(participant, read, input));
  const caughtCasts: CommerceTransactionError[] = [];
  const castRollbackRoot = defineAtomicCommerceCommand("promotionPrefilterCastRollbackRoot", (ctx, input) =>
    ctx.call(participant, seed, input).pipe(Effect.andThen(ctx.call(participant, read, "2").pipe(Effect.catch(error => {
      if (error.reason !== "resourceFailure") return Effect.fail(error);
      return Effect.sync(() => { caughtCasts.push(error); return null; });
    })))));
  const receipts: Array<Parameters<LogicalCommerceCallValidation>[1]> = [];
  const host = await Effect.runPromise(fixture.execution.prepare({ identityAndAccessPolicy: fixture.execution.identityAndAccessPolicy,
    executionIsolation: "scopeExclusive", operationScheduling: "queued", borrowedOperationScheduling: "queued",
    commands: [seedRoot, readRoot, castRollbackRoot], participants: [{ participant, nativeStorage: fixture.source("promotion"), commands,
      validateLogicalCall: (call, activity, command) => Effect.sync(() => {
        expect(call.events).toEqual([]);
        if (command === read) {
          expect(activity.mutations).toEqual([]);
          receipts.push(activity);
        }
      }) }] }));
  cleanup.push(() => Effect.runPromise(host.close));
  return { fixture, foreignKey: port.foreignKey, receipts, caughtCasts,
    seed: (input: typeof Seed.Type) => Effect.runPromise(host.run(host.newRequestKey(), seedRoot, input)),
    read: (input: string | readonly string[]) => Effect.runPromiseExit(host.run(host.newRequestKey(), readRoot, typeof input === "string" ? input : [...input])),
    seedAndFail: (input: typeof Seed.Type) => Effect.runPromiseExit(host.run(host.newRequestKey(), castRollbackRoot, input)) };
}

let connected: Awaited<ReturnType<typeof prepare>>;
beforeAll(async () => { connected = await prepare(); }, 240_000);
afterAll(() => finishOrderFixture(cleanup.reverse()), 180_000);

it("runs the native complete Rule/Value program and retains the genuine related match receipt", async () => {
  await connected.seed({ values: ["1", "4"], operator: "gt", automatic: true, detached: false, historical: false });
  expect(await connected.read("2")).toMatchObject({ _tag: "Success", value: [] });
  const receipt = connected.receipts.at(-1);
  if (receipt === undefined) throw new Error("Missing genuine Promotion prefilter receipt");
  expect(receipt.relationalReads.slice(1, 4)).toMatchObject([{
    table: "promotion_rule", query: { order: { column: "id", direction: "asc" }, includeIdentities: true },
    total: 1, returned: 1, orderedIdentities: [{ id: "rule" }],
  }, {
    table: "promotion_rule_value", query: { order: { column: "id", direction: "asc" }, includeIdentities: true },
    total: 2, returned: 2, orderedIdentities: [{ id: "value_0" }, { id: "value_1" }],
  }, {
    table: "promotion_rule", query: { childTable: "promotion_rule_value", foreignKey: connected.foreignKey },
    total: 1, returned: 1, orderedIdentities: [{ id: "rule" }],
    related: { childTable: "promotion_rule_value", foreignKeyConstraintId: connected.foreignKey },
  }]);
  expect(receipt.observedRows).toEqual(expect.arrayContaining([
    { table: "promotion_rule", row: expect.objectContaining({ id: "rule", attribute: "threshold", operator: "gt" }) },
    { table: "promotion_rule_value", row: expect.objectContaining({ id: "value_0", promotion_rule_id: "rule", value: "1" }) },
    { table: "promotion_rule_value", row: expect.objectContaining({ id: "value_1", promotion_rule_id: "rule", value: "4" }) },
  ]));

  await connected.seed({ values: ["1", "4"], operator: "gt", automatic: true, detached: false, historical: false,
    otherRootIds: ["promo_z", "promo_a"] });
  expect(await connected.read("2")).toMatchObject({ _tag: "Success", value: ["promo_a", "promo_z"] });
});

it("preserves native lexical suppression, historical casts and no-automatic-root skip", async () => {
  await connected.seed({ values: ["bad"], operator: "gte", automatic: true, detached: false, historical: false });
  expect(await connected.read(["bad", "2"])).toMatchObject({ _tag: "Success", value: ["promo_root"] });
  const historical = { values: ["bad"], operator: "gt", automatic: true, detached: true, historical: true };
  const before = await connected.fixture.snapshot(), receipts = connected.receipts.length;
  const rolledBack = await connected.seedAndFail(historical);
  expect(connected.caughtCasts).toMatchObject([{ reason: "resourceFailure", cause: { reason: "unavailable" } }]);
  expect(Exit.isFailure(rolledBack)).toBe(true);
  if (Exit.isFailure(rolledBack)) expect(rolledBack.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error.reason)).toContain("rollbackOnly");
  expect(await connected.fixture.snapshot()).toEqual(before);
  expect(connected.receipts).toHaveLength(receipts);
  await connected.seed(historical);
  const failed = await connected.read("2");
  expect(Exit.isFailure(failed)).toBe(true);
  if (Exit.isFailure(failed)) expect(failed.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error.reason)).toContain("resourceFailure");
  await connected.seed({ values: ["bad"], operator: "gt", automatic: false, detached: false, historical: false });
  expect(await connected.read("2")).toMatchObject({ _tag: "Success", value: [] });
  expect(connected.receipts.at(-1)?.relationalReads).toMatchObject([{ table: "promotion", total: 0, returned: 0, orderedIdentities: [] }]);
});
