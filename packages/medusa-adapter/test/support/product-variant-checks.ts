import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { ProductEvents } from "@medusajs/utils/product/events";
import { commerceError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from
  "../../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { defineCommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { makeCommerceHost } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { captureProductSchema } from "../../src/modules/product/schema";
import { productRuntimeMetadata } from "../../src/modules/product/runtime-metadata";
import { logicalCurrencyInventory } from "./logical-currency-inventory";
import { getLogicalProductRunnerFixture, productIntegrationTestRunner, runLogicalProductCommand } from
  "./logical-product-runner";

const run = Effect.runPromise;

productIntegrationTestRunner({ moduleName: "product", testSuite: () => describe("Product Variant boundary", () => {
  it("removes exact image pairs atomically and replays without deleting images", async () => {
    const { currency, product, product: { runtime }, writer } = getLogicalProductRunnerFixture();
    await run(runLogicalProductCommand(runtime.commands.create, {
      id: "product_images", title: "images", handle: "images",
      images: [{ id: "image_a", url: "a" }, { id: "image_b", url: "b" }],
      variants: [{ id: "variant_a", title: "A" }, { id: "variant_b", title: "B" }],
    }));
    await run(runLogicalProductCommand(runtime.commands.addImageToVariant, [
      { variant_id: "variant_a", image_id: "image_a" },
      { variant_id: "variant_b", image_id: "image_b" },
      { variant_id: "variant_a", image_id: "image_b" },
    ]));
    const catalog = await run(captureProductSchema("variant-boundary")
      .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
    const assignmentRead = defineCommerceCommand("productVariantBoundaryAssignments", "read", ctx =>
      Effect.gen(function* () {
        const store = yield* ctx.table(catalog.assignment.table.name);
        return yield* store.find(ctx.manager, { take: 20, order: { column: "id", direction: "asc" } });
      }));
    const reads = await run(makeCommerceHost({ ...product.hostInput, commands: [assignmentRead] }));
    const assignmentPairs = async () => {
      const selected = await run(reads.read(assignmentRead, null));
      if (!Array.isArray(selected) || !selected.every(isJsonObject))
        throw new Error("Invalid logical Variant/Image assignments");
      return selected.map(row => ({ variant_id: row.variant_id, image_id: row.image_id }));
    };
    const pairs = [{ variant_id: "variant_a", image_id: "image_a" },
      { variant_id: "variant_b", image_id: "image_b" }];
    const before = await logicalCurrencyInventory(currency);
    const revision = createHash("sha256").update("logical-variant-pair-late-refusal").digest("hex");
    const contract = defineCommerceEventContract({ name: catalog.variant.updatedEvent,
      revision, internal: true, decode: runtime.logicalPolicy.capture });
    const participant = defineAtomicCommerceParticipant("product");
    const root = defineAtomicCommerceCommand("variantPairLateRefusal", (ctx, input) =>
      ctx.call(participant, runtime.commands.removeImageFromVariant, input));
    const rejected = await run(makeAtomicCommerceHost({ ...currency.hostInput,
      identityAndAccessPolicy: { profile: "logical-variant-pair-late-refusal" },
      participants: [{ participant, logicalStorage: product.hostInput.logicalStorage,
        commands: [runtime.commands.removeImageFromVariant],
        validateLogicalCall: (...args) => runtime.logicalPolicy.validateLogicalCall(...args)
          .pipe(Effect.andThen(Effect.fail(commerceError("receiptMismatch")))),
        events: { contracts: [contract], select: () => Effect.fail(commerceError("unadmittedEvent")) } }],
      commands: [root], events: { producerRevision: revision, contracts: [contract],
        subscribers: [{ id: "logical-variant-pair-late-refusal", revision }],
        validate: events => events.length > 0 ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
    }));
    try {
      expect(await assignmentPairs()).toEqual(expect.arrayContaining([
        { variant_id: "variant_a", image_id: "image_a" },
        { variant_id: "variant_b", image_id: "image_b" },
        { variant_id: "variant_a", image_id: "image_b" },
      ]));
      expect(await run(Effect.result(rejected.run(rejected.newRequestKey(), root, pairs))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
      expect(await logicalCurrencyInventory(currency)).toEqual(before);
      const key = writer.newRequestKey();
      const result = await run(runLogicalProductCommand(runtime.commands.removeImageFromVariant, pairs, key));
      const after = await logicalCurrencyInventory(currency);
      expect(await assignmentPairs()).toEqual([{ variant_id: "variant_a", image_id: "image_b" }]);
      expect(after.rowChanges.slice(before.rowChanges.length)).toHaveLength(2);
      expect(after.revisions.filter(row => row.isTombstone)).toHaveLength(
        before.revisions.filter(row => row.isTombstone).length + 2);
      expect(after.events).toEqual(before.events);
      expect(await run(product.host.read(runtime.commands.internalProductRetrieve,
        { id: "product_images", config: { relations: ["images"] } })))
        .toMatchObject({ images: expect.arrayContaining([
          expect.objectContaining({ id: "image_a" }), expect.objectContaining({ id: "image_b" }),
        ]) });
      expect(await run(runLogicalProductCommand(runtime.commands.removeImageFromVariant, pairs, key))).toEqual(result);
      expect(await logicalCurrencyInventory(currency)).toEqual(after);
    } finally {
      // The pinned explicit assignment has noAction FKs. Clear this fixture's
      // remaining pair before the canonical runner hard-deletes its Product.
      await run(runLogicalProductCommand(runtime.commands.removeImageFromVariant, [
        { variant_id: "variant_a", image_id: "image_a" },
        { variant_id: "variant_b", image_id: "image_b" },
        { variant_id: "variant_a", image_id: "image_b" },
      ]));
      await run(rejected.close);
      await run(reads.close);
    }
  }, 180_000);

  it("soft deletes only the selected Variant with authenticated events and replay", async () => {
    const { currency, product: { runtime }, reader, writer } = getLogicalProductRunnerFixture();
    await run(runLogicalProductCommand(runtime.commands.create, {
      id: "product_shared", title: "shared", handle: "shared",
      options: [{ title: "size", values: ["small", "large"] },
        { title: "color", values: ["red"] }],
      variants: [{ id: "variant_small", title: "small", options: { size: "small", color: "red" } },
        { id: "variant_large", title: "large", options: { size: "large", color: "red" } }],
    }));
    const before = await logicalCurrencyInventory(currency);
    const key = writer.newRequestKey();
    const result = await run(runLogicalProductCommand(runtime.commands.softDeleteVariants, "variant_small", key));
    const after = await logicalCurrencyInventory(currency);
    expect(after.rows).toHaveLength(before.rows.length);
    expect(after.rows.filter((row, index) => !isDeepStrictEqual(row, before.rows[index]))).toHaveLength(1);
    expect(after.rowChanges.slice(before.rowChanges.length)).toHaveLength(1);
    expect(after.events.slice(before.events.length).map(event => event.envelope.message))
      .toMatchObject([{ name: ProductEvents.PRODUCT_VARIANT_DELETED,
        metadata: { source: "product", object: "product_variant", action: "deleted" },
        data: { id: "variant_small" } }]);
    expect(await run(reader.read(runtime.commands.countVariants, {})))
      .toMatchObject([[{ id: "variant_large" }], 1]);
    expect(await run(reader.read(runtime.commands.retrieveVariant,
      { id: "variant_small", config: { withDeleted: true, relations: ["options"] } })))
      .toMatchObject({ id: "variant_small",
        options: expect.arrayContaining([expect.objectContaining({ value: "red", deleted_at: null })]) });
    expect(await run(runLogicalProductCommand(runtime.commands.softDeleteVariants, "variant_small", key))).toEqual(result);
    expect(await logicalCurrencyInventory(currency)).toEqual(after);
  }, 180_000);

  it("refuses unsupported Variant inputs without publication", async () => {
    const { currency, product: { runtime }, reader } = getLogicalProductRunnerFixture();
    await run(runLogicalProductCommand(runtime.commands.create,
      { id: "product_refusal", title: "refusal", handle: "refusal",
        variants: [{ id: "variant_refusal", title: "valid" }] }));
    const before = await logicalCurrencyInventory(currency);
    for (const input of [
      { config: { relations: ["product.tags"] } }, { config: { relations: ["options.variants"] } },
      { config: { select: ["product.title"] } }, { filters: { scopeId: "foreign" } },
      { config: { take: 257 } },
    ]) expect(await run(Effect.result(reader.read(runtime.commands.listVariants, input))))
      .toMatchObject({ _tag: "Failure", failure: { _tag: "CommerceTransactionError" } });
    for (const input of [
      { variant_id: "variant_refusal" },
      { variant_id: "variant_refusal", image_id: "missing", scopeId: "foreign" },
    ]) expect(await run(Effect.result(runLogicalProductCommand(runtime.commands.removeImageFromVariant, input))))
      .toMatchObject({ _tag: "Failure", failure: { _tag: "CommerceTransactionError" } });
    expect(await run(Effect.result(runLogicalProductCommand(runtime.commands.softDeleteVariants,
      { selector: {} }))))
      .toMatchObject({ _tag: "Failure", failure: { _tag: "CommerceTransactionError" } });
    expect(await logicalCurrencyInventory(currency)).toEqual(before);
  });
}) });
