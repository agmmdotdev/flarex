import { createHash } from "node:crypto";
import { Effect, Result } from "effect";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { makeCommerceHost } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { defineCommerceCommand, type CommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, defaultCommerceResources, isJsonObject, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareProductOptionDeletionLinkResource } from "../../src/links/product-option-resource";
import { prepareProductOptionCreationWorkflow, prepareProductOptionUpdateWorkflow, prepareProductOptionDeletionWorkflow,
  type ProductOptionCreationHooks, type ProductOptionUpdateHooks, type ProductOptionDeletionHooks } from "../../src/workflows/product/option-workflows";
import type { AtomicWorkflowExecution } from "../../src/workflow/host";
import { logicalCurrencyFixture, type LogicalCurrencyFixture } from "./logical-currency-fixture";
import { prepareLogicalProductHost } from "./logical-product-fixture";

/** Seeds and cleanup call genuine existing native commands. This fixture adds
 * no graph replacement, cascade, mutation or settlement implementation. */
export async function prepareLogicalProductOption(driver: "pglite" | "postgres", registerCleanup: (close: () => Promise<void>) => void,
  selectedFixture?: LogicalCurrencyFixture) {
  const fixture = selectedFixture ?? await logicalCurrencyFixture(driver, registerCleanup, { includeProduct: true });
  const product = await prepareLogicalProductHost(fixture);
  registerCleanup(() => Effect.runPromise(product.host.close));
  await Effect.runPromise(product.host.initialize([]));
  const reads = await Effect.runPromise(makeCommerceHost({ ...product.hostInput,
    commands: [...product.hostInput.commands, product.runtime.commands.listOptions, product.runtime.commands.retrieveOption,
      product.runtime.commands.listVariants] }));
  registerCleanup(() => Effect.runPromise(reads.close));
  const execution: AtomicWorkflowExecution = {
    identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
    prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition }),
  };
  const link = Result.getOrThrow(prepareProductOptionDeletionLinkResource());
  const options: Omit<Parameters<typeof prepareProductOptionCreationWorkflow>[0], "hooks"> = { execution,
    modules: { product: { module: product.runtime.productOptionWorkflow, logicalStorage: product.hostInput.logicalStorage } },
    revision: createHash("sha256").update("native-product-option-workflows-107").digest("hex"),
    subscribers: [{ id: "native-product-options", revision: "b".repeat(64) }] };
  const prepareCreate = async (hooks: ProductOptionCreationHooks = {}, selectedExecution = execution, revision = options.revision) => {
    const host = await Effect.runPromise(prepareProductOptionCreationWorkflow({ ...options, execution: selectedExecution, revision, hooks }));
    registerCleanup(() => Effect.runPromise(host.close)); return host;
  };
  const prepareUpdate = async (hooks: ProductOptionUpdateHooks = {}, selectedExecution = execution, revision = options.revision) => {
    const host = await Effect.runPromise(prepareProductOptionUpdateWorkflow({ ...options, execution: selectedExecution, revision, hooks }));
    registerCleanup(() => Effect.runPromise(host.close)); return host;
  };
  const prepareDelete = async (hooks: ProductOptionDeletionHooks = {}, selectedExecution = execution, revision = options.revision) => {
    const host = await Effect.runPromise(prepareProductOptionDeletionWorkflow({ ...options, execution: selectedExecution, revision, link, hooks }));
    registerCleanup(() => Effect.runPromise(host.close)); return host;
  };
  const listOptions = (ids?: readonly string[], withDeleted = false) => reads.read(product.runtime.commands.listOptions,
    { filters: ids === undefined ? {} : { id: [...ids] }, config: { take: 256, relations: ["values"], ...(withDeleted ? { withDeleted: true } : {}) } });
  const listProducts = (ids: readonly string[]) => product.host.read(product.runtime.commands.internalProductList, { filters: { id: [...ids] } });
  const listVariants = (productId: string) => reads.read(product.runtime.commands.listVariants,
    { filters: { product_id: productId }, config: { take: 256, relations: ["options"] } });

  const seededProducts = new Set<string>();
  /** Explicit fixture-only call allowance admits complete legitimate setup and
   * physical cleanup graphs without changing a production Option profile. */
  const runNative = async (command: CommerceCommand, input: Json) => {
    const { metadata, logicalPolicy } = product.runtime;
    const admitted = [product.runtime.commands.create, product.runtime.commands.createOptions,
      product.runtime.commands.createVariants, product.runtime.commands.delete];
    if (!admitted.includes(command)) throw new Error("Unselected Option fixture command");
    const participant = defineAtomicCommerceParticipant("product");
    const selected = metadata.entities.flatMap(entity => [entity.createdEvent, entity.updatedEvent, entity.deletedEvent])
      .filter((name, index, all) => all.indexOf(name) === index).map(name => ({ name,
        contract: defineCommerceEventContract({ name, revision: options.revision, internal: true, decode: logicalPolicy.capture }) }));
    const contracts = selected.map(value => value.contract);
    const resources = { ...defaultCommerceResources, calls: 512, eventMessages: 128 };
    const root = defineAtomicCommerceCommand("nativeOptionFixtureCommand", (ctx, value) => ctx.call(participant, command, value));
    const host = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.hostInput,
      requestCallLimit: resources.calls, requestEventLimit: resources.eventMessages,
      identityAndAccessPolicy: { profile: "native-option-fixture" },
      participants: [{ participant, logicalStorage: product.hostInput.logicalStorage, logicalResources: resources, commands: [command],
        validateLogicalCall: logicalPolicy.validateLogicalCall, events: { contracts, select: event => {
          const token = isJsonObject(event) && typeof event.name === "string" ? selected.find(value => value.name === event.name)?.contract : undefined;
          return token === undefined ? Effect.fail(commerceError("unadmittedEvent")) : Effect.succeed(token);
        } } }], commands: [root], events: { producerRevision: options.revision, contracts, subscribers: options.subscribers,
        validate: values => values.some(value => !value.internal) ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
    }));
    try { return await Effect.runPromise(host.run(host.newRequestKey(), root, input)); }
    finally { await Effect.runPromise(host.close); }
  };
  const seedProducts = async (prefix: string, count = 1) => {
    if (!Number.isInteger(count) || count < 1 || count > 4) throw new Error("Option fixture seeds one to four native Products per call");
    const supplied = Array.from({ length: count }, (_, n) => ({ id: prefix + "-product-" + n, title: prefix + n, handle: prefix + "-handle-" + n }));
    await runNative(product.runtime.commands.create, supplied);
    for (const row of supplied) seededProducts.add(row.id);
    return supplied.map(row => row.id);
  };
  const seedOptions = (input: Json) => runNative(product.runtime.commands.createOptions, input);
  const seedVariants = (input: Json) => runNative(product.runtime.commands.createVariants, input);
  const seedMaximumReplacementGraph = async (prefix: string) => {
    const productIds = await seedProducts(prefix, 4);
    const targetIds: string[] = [], discriminatorIds: string[] = [], variantIds: string[] = [];
    for (const [index, product_id] of productIds.entries()) {
      const targetId = prefix + "-target-" + index, discriminatorId = prefix + "-discriminator-" + index;
      targetIds.push(targetId); discriminatorIds.push(discriminatorId);
      await seedOptions([{ id: targetId, title: "Target", product_id, values: ["old-0", "old-1", "old-2", "old-3"] },
        { id: discriminatorId, title: "Discriminator", product_id, values: ["left", "right"] }]);
      // Two discriminator Values make each pair of Variants sharing one target
      // Value a legal distinct native combination. Discriminator links survive.
      const variants = Array.from({ length: 8 }, (_, n) => ({ id: prefix + "-variant-" + index + "-" + n,
        title: "Variant " + n, product_id, manage_inventory: false,
        options: { Target: "old-" + Math.floor(n / 2), Discriminator: n % 2 === 0 ? "left" : "right" } }));
      for (let offset = 0; offset < variants.length; offset += 4) await seedVariants(variants.slice(offset, offset + 4));
      variantIds.push(...variants.map(row => row.id));
    }
    return { productIds, targetIds, discriminatorIds, variantIds };
  };
  const arrangeDeletedValue = async (id: string) => {
    // Like the retained Inventory deletion fixture, invoke the real core
    // lifecycle owner to establish history without reproducing its rules.
    const arrange = defineCommerceCommand("optionDeletedValueArrangement", "write", Effect.fn(function* (ctx) {
      yield* (yield* ctx.table(product.runtime.metadata.value.table.name)).lifecycle(ctx.manager, "softDelete", [{ id }]); return null;
    }));
    const participant = defineAtomicCommerceParticipant("option_arrangement");
    const root = defineAtomicCommerceCommand("optionDeletedValueArrangementRoot", ctx => ctx.call(participant, arrange, null));
    const host = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.hostInput, participants: [{ participant,
      logicalStorage: product.hostInput.logicalStorage, commands: [arrange] }], commands: [root] }));
    try { await Effect.runPromise(host.run(host.newRequestKey(), root, null)); } finally { await Effect.runPromise(host.close); }
  };
  const cleanupProducts = async () => {
    for (const id of seededProducts) {
      await runNative(product.runtime.commands.delete, id); seededProducts.delete(id);
    }
  };
  registerCleanup(cleanupProducts);
  return { fixture, product, reads, execution, link, options, prepareCreate, prepareUpdate, prepareDelete,
    listOptions, listProducts, listVariants, seedProducts, seedOptions, seedVariants, seedMaximumReplacementGraph,
    arrangeDeletedValue, cleanupProducts };
}
