import { createHash } from "node:crypto";
import { Effect, Result } from "effect";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { makeCommerceHost } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { commerceError, defaultCommerceResources, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareProductCategoryDeletionLinkResource } from "../../src/links/product-category-resource";
import { prepareProductCategoryCreationWorkflow, prepareProductCategoryUpdateWorkflow, prepareProductCategoryDeletionWorkflow,
  type ProductCategoryCreationHooks, type ProductCategoryUpdateHooks, type ProductCategoryDeletionHooks } from "../../src/workflows/product/category-workflows";
import { decodeCategoryProjection } from "../../src/modules/product/category-projection";
import type { AtomicWorkflowExecution } from "../../src/workflow/host";
import { logicalCurrencyFixture, type LogicalCurrencyFixture } from "./logical-currency-fixture";
import { prepareLogicalProductHost } from "./logical-product-fixture";

/** Category tests select the existing admitted Product source and native
 * commands. Bootstrap, membership planning and settlement retain their owners. */
export async function prepareLogicalProductCategory(driver: "pglite" | "postgres", registerCleanup: (close: () => Promise<void>) => void,
  selectedFixture?: LogicalCurrencyFixture) {
  const fixture = selectedFixture ?? await logicalCurrencyFixture(driver, registerCleanup, { includeProduct: true });
  const product = await prepareLogicalProductHost(fixture);
  registerCleanup(() => Effect.runPromise(product.host.close));
  await Effect.runPromise(product.host.initialize([]));
  const reads = await Effect.runPromise(makeCommerceHost({ ...product.hostInput,
    commands: [...product.hostInput.commands, product.runtime.commands.listCategories, product.runtime.commands.retrieveCategory] }));
  registerCleanup(() => Effect.runPromise(reads.close));
  const execution: AtomicWorkflowExecution = {
    identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
    prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition }),
  };
  const link = Result.getOrThrow(prepareProductCategoryDeletionLinkResource());
  const options: Omit<Parameters<typeof prepareProductCategoryCreationWorkflow>[0], "hooks"> = { execution,
    modules: { product: { module: product.runtime.productCategoryWorkflow, logicalStorage: product.hostInput.logicalStorage } },
    revision: createHash("sha256").update("native-product-category-workflows-107").digest("hex"),
    subscribers: [{ id: "native-product-categories", revision: "b".repeat(64) }] };
  const prepareCreate = async (hooks: ProductCategoryCreationHooks = {}, selectedExecution = execution, revision = options.revision) => {
    const host = await Effect.runPromise(prepareProductCategoryCreationWorkflow({ ...options, execution: selectedExecution, revision, hooks }));
    registerCleanup(() => Effect.runPromise(host.close)); return host;
  };
  const prepareUpdate = async (hooks: ProductCategoryUpdateHooks = {}, selectedExecution = execution, revision = options.revision) => {
    const host = await Effect.runPromise(prepareProductCategoryUpdateWorkflow({ ...options, execution: selectedExecution, revision, hooks }));
    registerCleanup(() => Effect.runPromise(host.close)); return host;
  };
  const prepareDelete = async (hooks: ProductCategoryDeletionHooks = {}, selectedExecution = execution, revision = options.revision) => {
    const host = await Effect.runPromise(prepareProductCategoryDeletionWorkflow({ ...options, execution: selectedExecution, revision, link, hooks }));
    registerCleanup(() => Effect.runPromise(host.close)); return host;
  };
  const listCategories = (ids?: readonly string[]) => reads.read(product.runtime.commands.listCategories,
    { filters: ids === undefined ? {} : { id: [...ids] }, config: { take: 256 } }).pipe(Effect.flatMap(value => Effect.fromResult(decodeCategoryProjection(value))));
  const categoryMembers = (id: string) => reads.read(product.runtime.commands.retrieveCategory,
    { id, config: { select: ["id", "products.id"], relations: ["products"] } }).pipe(Effect.flatMap(value => Effect.fromResult(decodeCategoryProjection(value))));
  const listProducts = (ids: readonly string[]) => product.host.read(product.runtime.commands.internalProductList,
    { filters: { id: [...ids] } });
  const seedProducts = async (prefix: string, count = 4, categoryId?: string) => {
    if (!Number.isInteger(count) || count < 1 || count > 4) throw new Error("Category test seeds use one to four genuine Products per call");
    const products = Array.from({ length: count }, (_, index) => ({ id: prefix + "-product-" + index,
      title: prefix + index, handle: prefix + "-handle-" + index,
      ...(categoryId === undefined ? {} : { category_ids: [categoryId] }) }));
    const { metadata, logicalPolicy, commands } = product.runtime;
    const participant = defineAtomicCommerceParticipant("product");
    const selected = [metadata.product, metadata.option, metadata.value, metadata.variant, metadata.image].map(entity => ({
      name: entity.createdEvent, contract: defineCommerceEventContract({ name: entity.createdEvent,
        revision: options.revision, internal: true, decode: logicalPolicy.capture }),
    }));
    const contracts = selected.map(value => value.contract);
    const root = defineAtomicCommerceCommand("seedCategoryWorkflowProducts", (ctx, input) => ctx.call(participant, commands.create, input));
    const host = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.hostInput,
      identityAndAccessPolicy: { profile: "category-workflow-product-seed" },
      participants: [{ participant, logicalStorage: product.hostInput.logicalStorage, commands: [commands.create],
        validateLogicalCall: logicalPolicy.validateLogicalCall, events: { contracts, select: event => {
          const selectedEvent = isJsonObject(event) && typeof event.name === "string" ? selected.find(value => value.name === event.name) : undefined;
          return selectedEvent === undefined ? Effect.fail(commerceError("unadmittedEvent")) : Effect.succeed(selectedEvent.contract);
        } } }], commands: [root], events: { producerRevision: options.revision, contracts, subscribers: options.subscribers,
        validate: values => values.some(value => !value.internal) ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
    }));
    try { await Effect.runPromise(host.run(host.newRequestKey(), root, products)); }
    finally { await Effect.runPromise(host.close); }
    return products.map(row => row.id);
  };
  /** Ordinary physical Category deletion is an existing separate contract.
   * It can clean a successful twenty-row creation graph without pretending the
   * next named workflow admits a twenty-row initial tree closure. */
  const physicallyDeleteCategories = async (ids: readonly string[]) => {
    if (ids.length === 0) return;
    const { metadata, logicalPolicy, commands } = product.runtime;
    const participant = defineAtomicCommerceParticipant("product");
    const selected = [metadata.category.updatedEvent, metadata.category.deletedEvent].map(name => ({
      name, contract: defineCommerceEventContract({ name, revision: options.revision,
        internal: true, decode: logicalPolicy.capture }),
    }));
    const contracts = selected.map(value => value.contract);
    const cleanupResources = { ...defaultCommerceResources, calls: 256 };
    const root = defineAtomicCommerceCommand("physicalCategoryWorkflowCleanup", (ctx, input) => ctx.call(participant, commands.deleteCategories, input));
    const host = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.hostInput, requestCallLimit: cleanupResources.calls,
      identityAndAccessPolicy: { profile: "category-workflow-physical-cleanup" },
      participants: [{ participant, logicalStorage: product.hostInput.logicalStorage, logicalResources: cleanupResources, commands: [commands.deleteCategories],
        validateLogicalCall: logicalPolicy.validateLogicalCall, events: { contracts, select: event => {
          const contract = isJsonObject(event) && typeof event.name === "string" ? selected.find(value => value.name === event.name)?.contract : undefined;
          return contract === undefined ? Effect.fail(commerceError("unadmittedEvent")) : Effect.succeed(contract);
        } } }], commands: [root], events: { producerRevision: options.revision, contracts, subscribers: options.subscribers,
        validate: values => values.some(value => !value.internal) ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
    }));
    try { for (const id of ids) await Effect.runPromise(host.run(host.newRequestKey(), root, id)); }
    finally { await Effect.runPromise(host.close); }
  };
  return { fixture, product, reads, execution, link, options, prepareCreate, prepareUpdate, prepareDelete,
    listCategories, categoryMembers, listProducts, seedProducts, physicallyDeleteCategories };
}
