import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Cause, Effect, Result } from "effect";
import { isJsonObject } from "flarex-protocol/json";
import { currencyWorkflowModule } from "../src/currency-service";
import { productLogicalTagEventPolicy } from "../src/product-local-events";
import { prepareProductTagWorkflow } from "../src/product-tag-workflow";
import { captureProductSchema } from "../src/product-schema";
import { productRuntimeMetadata } from "../src/product-runtime-metadata";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/atomicCommerce/host";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commitEvents/schema";
import { fxAppRowCurrent } from "../../persistence-postgres/src/schema";
import { runEffectFailure } from "../../persistence-postgres/test/effectTestRuntime";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { prepareLogicalProductHost } from "./support/logical-product-fixture";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Product test driver");
const cleanup: Array<() => Promise<void>> = [];
let currency: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
let product: Awaited<ReturnType<typeof prepareLogicalProductHost>>;

describe("native Product-tag workflow with logical Product and Currency", () => {
  beforeAll(async () => {
    currency = await logicalCurrencyFixture(driver, close => cleanup.push(close), { includeProduct: true });
    product = await prepareLogicalProductHost(currency);
    await Effect.runPromise(product.host.initialize([]));
    await Effect.runPromise(product.host.close);
  }, 180_000);
  afterAll(async () => {
    const failures: unknown[] = [];
    for (const close of cleanup.reverse()) await close().catch(cause => { failures.push(cause); });
    if (failures.length > 0) throw new AggregateError(failures, "Logical Product workflow fixture cleanup failed");
  }, 120_000);

  it("commits native tags, module and workflow events, then replays one outcome", async () => {
    const metadata = await Effect.runPromise(captureProductSchema("atomic-commerce")
      .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
    let hookCalls = 0;
    const host = await Effect.runPromise(prepareProductTagWorkflow({
      execution: { identityAndAccessPolicy: currency.hostInput.identityAndAccessPolicy,
        prepare: composition => makeAtomicCommerceHost({ ...currency.hostInput, ...composition }) },
      modules: {
        product: { module: product.runtime.workflow, logicalStorage: product.hostInput.logicalStorage,
          moduleEvents: productLogicalTagEventPolicy(metadata) },
        currency: { module: Result.getOrThrow(currencyWorkflowModule), logicalStorage: currency.hostInput.logicalStorage },
      },
      revision: createHash("sha256").update("logical-product-tag-workflow").digest("hex"),
      subscribers: [{ id: "logical-product-tags", revision: "a".repeat(64) }],
      hooks: { productTagsCreated: async (value, { resources }) => {
        hookCalls++;
        const tag = value.product_tags[0];
        expect(tag).toMatchObject({ value: "logical-tag" });
        expect(await resources.query.graph({ entity: "product_tag", fields: ["id", "value"],
          filters: { id: tag?.id }, pagination: { take: 1 } }))
          .toMatchObject({ data: [{ id: tag?.id, value: "logical-tag" }] });
        expect(await resources.query.graph({ entity: "currency", fields: ["code"],
          filters: { code: "usd" }, pagination: { take: 1 } }))
          .toMatchObject({ data: [{ code: "usd" }] });
      } },
    }));
    try {
      const beforeRows = await currency.persistence.drizzle.select().from(fxAppRowCurrent);
      const beforeEvents = await currency.persistence.drizzle.select().from(fxSystemCommitEvents);
      const key = host.newRequestKey();
      const input = { product_tags: [{ value: "logical-tag" }] };
      const created = await Effect.runPromise(host.run(key, input));
      expect(created).toMatchObject([{ value: "logical-tag" }]);
      expect(hookCalls).toBe(1);
      const afterRows = await currency.persistence.drizzle.select().from(fxAppRowCurrent);
      const afterEvents = await currency.persistence.drizzle.select().from(fxSystemCommitEvents);
      expect(afterRows).toHaveLength(beforeRows.length + 1);
      expect(afterEvents.slice(beforeEvents.length).map(event => event.envelope.contract))
        .toEqual(["product.product-tag.created", "product-tag.created"]);
      expect(await Effect.runPromise(host.run(key, input))).toEqual(created);
      expect(hookCalls).toBe(1);
      expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(afterRows);
      expect(await currency.persistence.drizzle.select().from(fxSystemCommitEvents)).toEqual(afterEvents);
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);

  it("accepts native tag creation without an optional query hook", async () => {
    const metadata = await Effect.runPromise(captureProductSchema("atomic-commerce")
      .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
    const host = await Effect.runPromise(prepareProductTagWorkflow({
      execution: { identityAndAccessPolicy: currency.hostInput.identityAndAccessPolicy,
        prepare: composition => makeAtomicCommerceHost({ ...currency.hostInput, ...composition }) },
      modules: {
        product: { module: product.runtime.workflow, logicalStorage: product.hostInput.logicalStorage,
          moduleEvents: productLogicalTagEventPolicy(metadata) },
        currency: { module: Result.getOrThrow(currencyWorkflowModule), logicalStorage: currency.hostInput.logicalStorage },
      },
      revision: createHash("sha256").update("logical-product-tag-no-hook").digest("hex"),
      subscribers: [{ id: "logical-product-tags", revision: "a".repeat(64) }],
    }));
    try {
      const beforeRows = await currency.persistence.drizzle.select().from(fxAppRowCurrent);
      const beforeEvents = await currency.persistence.drizzle.select().from(fxSystemCommitEvents);
      expect(await Effect.runPromise(host.run(host.newRequestKey(),
        { product_tags: [{ value: "without-hook" }] }))).toMatchObject([{ value: "without-hook" }]);
      expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toHaveLength(beforeRows.length + 1);
      expect((await currency.persistence.drizzle.select().from(fxSystemCommitEvents)).slice(beforeEvents.length)
        .map(event => event.envelope.contract)).toEqual(["product.product-tag.created", "product-tag.created"]);
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);

  it("refuses a module event ID without a matching logical Product insert", async () => {
    let hooks = 0;
    const metadata = await Effect.runPromise(captureProductSchema("atomic-commerce")
      .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
    const policy = productLogicalTagEventPolicy(metadata);
    const host = await Effect.runPromise(prepareProductTagWorkflow({
      execution: { identityAndAccessPolicy: currency.hostInput.identityAndAccessPolicy,
        prepare: composition => makeAtomicCommerceHost({ ...currency.hostInput, ...composition }) },
      modules: {
        product: { module: product.runtime.workflow, logicalStorage: product.hostInput.logicalStorage,
          moduleEvents: { ...policy, capture: event => policy.capture(event).pipe(Effect.map(message =>
            isJsonObject(message) && isJsonObject(message.data)
              ? { ...message, data: { ...message.data, id: "ptag_forged" } } : message)) } },
        currency: { module: Result.getOrThrow(currencyWorkflowModule), logicalStorage: currency.hostInput.logicalStorage },
      },
      revision: createHash("sha256").update("logical-product-tag-workflow-refusal").digest("hex"),
      subscribers: [{ id: "logical-product-tags", revision: "a".repeat(64) }],
      hooks: { productTagsCreated: async () => { hooks++; } },
    }));
    try {
      const beforeRows = await currency.persistence.drizzle.select().from(fxAppRowCurrent);
      const beforeEvents = await currency.persistence.drizzle.select().from(fxSystemCommitEvents);
      const failure = await runEffectFailure(host.run(host.newRequestKey(),
        { product_tags: [{ value: "forged-event-tag" }] }));
      expect(failure).toMatchObject({ reason: "rollbackOnly" });
      if (!Cause.isCause(failure.cause)) throw new Error("Missing native call refusal cause");
      expect(Result.getOrThrow(Cause.findError(failure.cause))).toMatchObject({ reason: "receiptMismatch" });
      expect(hooks).toBe(0);
      expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(beforeRows);
      expect(await currency.persistence.drizzle.select().from(fxSystemCommitEvents)).toEqual(beforeEvents);
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);
});
