import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { Effect, Result } from "effect";
import { currencyWorkflowModule } from "../src/currency-service";
import { prepareProductTagWorkflow } from "../src/product-tag-workflow";
import { makeLocalProductCommands } from "../src/product-service";
import { captureProductSchema } from "../src/product-schema";
import { productRuntimeMetadata } from "../src/product-runtime-metadata";
import { productModuleEventPolicy } from "../src/product-local-events";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/atomicCommerce/host";
import { commercePhysicalRows } from "../../persistence-postgres/test/commerceInventory";
import { runEffect, runEffectFailure } from "../../persistence-postgres/test/effectTestRuntime";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commitEvents/schema";
import { logicalCategoryCurrencyFixture } from "./support/logical-category-currency-fixture";
import { logicalCurrencyInventory } from "./support/logical-currency-inventory";
import type { InstalledWorkflowModule } from "../src/workflow/host";
import type { CurrencyWorkflowModule } from "../src/currency-service";

const driver = process.env.FLAREX_TEST_DRIVER ?? process.env.MEDUSA_COMPARISON_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Medusa comparison driver");
const cleanup: Array<() => Promise<void>> = [];
let fixture: Awaited<ReturnType<typeof logicalCategoryCurrencyFixture>>;

describe("native Product-tag workflow with logical Currency", () => {
  beforeAll(async () => { fixture = await logicalCategoryCurrencyFixture(driver, close => cleanup.push(close)); }, 150_000);
  afterAll(async () => {
    const failures: unknown[] = [];
    for (const close of cleanup.reverse()) await close().catch(cause => { failures.push(cause); });
    if (failures.length > 0) throw new AggregateError(failures, "Logical workflow fixture cleanup failed");
  }, 120_000);

  it("reads logical Currency during a pending native Product write and publishes one outcome", async () => {
    const { currency, product, input, installation } = fixture;
    const commands = await runEffect(makeLocalProductCommands());
    const metadata = await runEffect(captureProductSchema("atomic-commerce")
      .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
    let hookCalls = 0;
    const options = {
      execution: { identityAndAccessPolicy: input.identityAndAccessPolicy,
        prepare: composition => makeAtomicCommerceHost({ ...input, ...composition }) },
      modules: {
        product: { module: commands.workflow, profile: product.profile, installation,
          moduleEvents: productModuleEventPolicy(product.descriptor, metadata) },
        currency: { module: Result.getOrThrow(currencyWorkflowModule), logicalStorage: currency.hostInput.logicalStorage },
      },
      revision: createHash("sha256").update("logical-product-tag-workflow").digest("hex"),
      subscribers: [{ id: "logical-product-tags", revision: "a".repeat(64) }],
      hooks: { productTagsCreated: async (value, { resources }) => {
        hookCalls++;
        expect(value.product_tags).toMatchObject([{ value: "logical-tag" }]);
        expect(await resources.query.graph({ entity: "currency", fields: ["code"],
          filters: { code: "usd" }, pagination: { take: 1 } }))
          .toMatchObject({ data: [{ code: "usd" }] });
        expect(await resources.query.graph({ entity: "product_tag", fields: ["value"],
          filters: { id: value.product_tags.map(tag => tag.id) }, pagination: { take: 1 } }))
          .toMatchObject({ data: [{ value: "logical-tag" }] });
      } },
    } satisfies Parameters<typeof prepareProductTagWorkflow>[0];
    // @ts-expect-error A module cannot name both logical and physical storage.
    const hybrid: InstalledWorkflowModule<CurrencyWorkflowModule, "physical" | "logical"> = {
      ...options.modules.currency, profile: product.profile, installation,
    };
    expect(await runEffectFailure(prepareProductTagWorkflow({ ...options,
      modules: { ...options.modules, currency: hybrid } }))).toMatchObject({ reason: "unsupportedProfile" });
    const host = await runEffect(prepareProductTagWorkflow(options));
    try {
      const beforeLogical = await logicalCurrencyInventory(currency);
      const beforeProduct = await commercePhysicalRows(currency.persistence, product.descriptor.layout.frame);
      const beforeEvents = await currency.persistence.drizzle.select().from(fxSystemCommitEvents)
        .orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal);
      const key = host.newRequestKey();
      const value = await runEffect(host.run(key, { product_tags: [{ value: "logical-tag" }] }));
      expect(value).toMatchObject([{ value: "logical-tag" }]);
      const afterLogical = await logicalCurrencyInventory(currency);
      const afterProduct = await commercePhysicalRows(currency.persistence, product.descriptor.layout.frame);
      const afterEvents = await currency.persistence.drizzle.select().from(fxSystemCommitEvents)
        .orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal);
      expect(afterProduct.product_tag).toHaveLength((beforeProduct.product_tag?.length ?? 0) + 1);
      expect(afterLogical.rows).toEqual(beforeLogical.rows);
      expect(afterLogical.commits).toHaveLength(beforeLogical.commits.length + 1);
      expect(afterLogical.outcomes).toHaveLength(beforeLogical.outcomes.length + 1);
      expect(afterEvents.slice(beforeEvents.length).map(event => event.envelope.contract))
        .toEqual(["product.product-tag.created", "product-tag.created"]);
      expect(afterEvents.slice(beforeEvents.length).map(event => event.eventOrdinal)).toEqual([0, 1]);
      expect(hookCalls).toBe(1);
      expect(await runEffect(host.run(key, { product_tags: [{ value: "logical-tag" }] }))).toEqual(value);
      expect(hookCalls).toBe(1);
      expect(await logicalCurrencyInventory(currency)).toEqual(afterLogical);
      expect(await commercePhysicalRows(currency.persistence, product.descriptor.layout.frame)).toEqual(afterProduct);
    } finally { await runEffect(host.close); }
  }, 120_000);
});
