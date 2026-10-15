import { createHash } from "node:crypto";
import { Effect, Result } from "effect";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { makeCommerceHost } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { commerceError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareProductTypeDeletionLinkResource } from "../../src/links/product-type-resource";
import { prepareProductTypeCreationWorkflow, prepareProductTypeUpdateWorkflow, prepareProductTypeDeletionWorkflow,
  type ProductTypeCreationHooks, type ProductTypeUpdateHooks, type ProductTypeDeletionHooks } from "../../src/workflows/product/type";
import type { AtomicWorkflowExecution } from "../../src/workflow/host";
import { logicalCurrencyFixture, type LogicalCurrencyFixture } from "./logical-currency-fixture";
import { prepareLogicalProductHost } from "./logical-product-fixture";

/** Reuse the admitted shared Product source; this helper owns no bootstrap,
 * transaction, lifecycle or settlement implementation. */
export async function prepareLogicalProductType(driver: "pglite" | "postgres", registerCleanup: (close: () => Promise<void>) => void,
  selectedFixture?: LogicalCurrencyFixture) {
  const fixture = selectedFixture ?? await logicalCurrencyFixture(driver, registerCleanup, { includeProduct: true });
  const product = await prepareLogicalProductHost(fixture);
  registerCleanup(() => Effect.runPromise(product.host.close));
  await Effect.runPromise(product.host.initialize([]));
  const reads = await Effect.runPromise(makeCommerceHost({ ...product.hostInput,
    commands: [...product.hostInput.commands, product.runtime.commands.listTypes] }));
  registerCleanup(() => Effect.runPromise(reads.close));
  const execution: AtomicWorkflowExecution = {
    identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
    prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition }),
  };
  const link = Result.getOrThrow(prepareProductTypeDeletionLinkResource());
  const options: Omit<Parameters<typeof prepareProductTypeCreationWorkflow>[0], "hooks"> = { execution, modules: { product: { module: product.runtime.productTypeWorkflow,
    logicalStorage: product.hostInput.logicalStorage } },
    revision: createHash("sha256").update("native-product-type-workflows-104").digest("hex"),
    subscribers: [{ id: "native-product-types", revision: "b".repeat(64) }] };
  const prepareCreate = async (hooks: ProductTypeCreationHooks = {}, selectedExecution = execution, revision = options.revision) => {
    const host = await Effect.runPromise(prepareProductTypeCreationWorkflow({ ...options, execution: selectedExecution, revision, hooks }));
    registerCleanup(() => Effect.runPromise(host.close)); return host;
  };
  const prepareUpdate = async (hooks: ProductTypeUpdateHooks = {}, selectedExecution = execution, revision = options.revision) => {
    const host = await Effect.runPromise(prepareProductTypeUpdateWorkflow({ ...options, execution: selectedExecution, revision, hooks }));
    registerCleanup(() => Effect.runPromise(host.close)); return host;
  };
  const prepareDelete = async (hooks: ProductTypeDeletionHooks = {}, selectedExecution = execution, revision = options.revision) => {
    const host = await Effect.runPromise(prepareProductTypeDeletionWorkflow({ ...options, execution: selectedExecution, revision, link, hooks }));
    registerCleanup(() => Effect.runPromise(host.close)); return host;
  };
  const listTypes = (ids?: readonly string[], withDeleted = false) => reads.read(product.runtime.commands.listTypes,
    { filters: ids === undefined ? {} : { id: [...ids] }, config: { withDeleted, take: 16 } });
  const seedProducts = async (prefix: string, typeId: string) => {
    const products = Array.from({ length: 4 }, (_, index) => ({ id: prefix + "-product-" + index,
      title: prefix + index, handle: prefix + "-handle-" + index, type_id: typeId }));
    // Product references belong to the public module command, rather than the
    // deliberately scalar-only internal Product service test profile.
    const { metadata, logicalPolicy, commands } = product.runtime;
    const participant = defineAtomicCommerceParticipant("product");
    const selected = [metadata.product, metadata.option, metadata.value, metadata.variant, metadata.image].map(entity => ({
      name: entity.createdEvent, contract: defineCommerceEventContract({ name: entity.createdEvent,
        revision: options.revision, internal: true, decode: logicalPolicy.capture }),
    }));
    const contracts = selected.map(value => value.contract);
    const root = defineAtomicCommerceCommand("seedTypeReferencedProducts", (ctx, input) => ctx.call(participant, commands.create, input));
    const host = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.hostInput,
      identityAndAccessPolicy: { profile: "type-workflow-product-reference-seed" },
      participants: [{ participant, logicalStorage: product.hostInput.logicalStorage, commands: [commands.create],
        validateLogicalCall: logicalPolicy.validateLogicalCall, events: { contracts, select: event => {
          const selectedEvent = isJsonObject(event) && typeof event.name === "string"
            ? selected.find(value => value.name === event.name) : undefined;
          return selectedEvent === undefined ? Effect.fail(commerceError("unadmittedEvent")) : Effect.succeed(selectedEvent.contract);
        } } }], commands: [root], events: { producerRevision: options.revision, contracts, subscribers: options.subscribers,
        validate: values => values.some(value => !value.internal) ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
    }));
    try { await Effect.runPromise(host.run(host.newRequestKey(), root, products)); }
    finally { await Effect.runPromise(host.close); }
    return products.map(row => row.id);
  };
  const listProducts = (ids: readonly string[]) => product.host.read(product.runtime.commands.internalProductList,
    { filters: { id: [...ids] } });
  return { fixture, product, reads, execution, link, options, prepareCreate, prepareUpdate, prepareDelete, listTypes, seedProducts, listProducts };
}
