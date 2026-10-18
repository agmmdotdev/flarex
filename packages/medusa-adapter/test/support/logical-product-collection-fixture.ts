import { createHash } from "node:crypto";
import { Effect, Result } from "effect";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { makeCommerceHost } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { commerceError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareProductCollectionDeletionLinkResource } from "../../src/links/product-collection-resource";
import { prepareProductCollectionCreationWorkflow, prepareProductCollectionUpdateWorkflow, prepareProductCollectionDeletionWorkflow,
  type ProductCollectionCreationHooks, type ProductCollectionUpdateHooks, type ProductCollectionDeletionHooks } from "../../src/workflows/product/collection-workflows";
import type { AtomicWorkflowExecution } from "../../src/workflow/host";
import { logicalCurrencyFixture, type LogicalCurrencyFixture } from "./logical-currency-fixture";
import { prepareLogicalProductHost } from "./logical-product-fixture";

/** Collection tests select the existing admitted Product source and native
 * commands. Bootstrap, membership planning and settlement retain their owners. */
export async function prepareLogicalProductCollection(driver: "pglite" | "postgres", registerCleanup: (close: () => Promise<void>) => void,
  selectedFixture?: LogicalCurrencyFixture) {
  const fixture = selectedFixture ?? await logicalCurrencyFixture(driver, registerCleanup, { includeProduct: true });
  const product = await prepareLogicalProductHost(fixture);
  registerCleanup(() => Effect.runPromise(product.host.close));
  await Effect.runPromise(product.host.initialize([]));
  const reads = await Effect.runPromise(makeCommerceHost({ ...product.hostInput,
    commands: [...product.hostInput.commands, product.runtime.commands.listCollections, product.runtime.commands.retrieveCollection] }));
  registerCleanup(() => Effect.runPromise(reads.close));
  const execution: AtomicWorkflowExecution = {
    identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
    prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition }),
  };
  const link = Result.getOrThrow(prepareProductCollectionDeletionLinkResource());
  const options: Omit<Parameters<typeof prepareProductCollectionCreationWorkflow>[0], "hooks"> = { execution,
    modules: { product: { module: product.runtime.productCollectionWorkflow, logicalStorage: product.hostInput.logicalStorage } },
    revision: createHash("sha256").update("native-product-collection-workflows-105").digest("hex"),
    subscribers: [{ id: "native-product-collections", revision: "b".repeat(64) }] };
  const prepareCreate = async (hooks: ProductCollectionCreationHooks = {}, selectedExecution = execution, revision = options.revision) => {
    const host = await Effect.runPromise(prepareProductCollectionCreationWorkflow({ ...options, execution: selectedExecution, revision, hooks }));
    registerCleanup(() => Effect.runPromise(host.close)); return host;
  };
  const prepareUpdate = async (hooks: ProductCollectionUpdateHooks = {}, selectedExecution = execution, revision = options.revision) => {
    const host = await Effect.runPromise(prepareProductCollectionUpdateWorkflow({ ...options, execution: selectedExecution, revision, hooks }));
    registerCleanup(() => Effect.runPromise(host.close)); return host;
  };
  const prepareDelete = async (hooks: ProductCollectionDeletionHooks = {}, selectedExecution = execution, revision = options.revision) => {
    const host = await Effect.runPromise(prepareProductCollectionDeletionWorkflow({ ...options, execution: selectedExecution, revision, link, hooks }));
    registerCleanup(() => Effect.runPromise(host.close)); return host;
  };
  const listCollections = (ids?: readonly string[], withDeleted = false) => reads.read(product.runtime.commands.listCollections,
    { filters: ids === undefined ? {} : { id: [...ids] }, config: { withDeleted, take: 16 } });
  const collectionMembers = (id: string) => reads.read(product.runtime.commands.retrieveCollection,
    { id, config: { select: ["id", "products.id"], relations: ["products"] } });
  const listProducts = (ids: readonly string[]) => product.host.read(product.runtime.commands.internalProductList,
    { filters: { id: [...ids] } });
  const seedProducts = async (prefix: string, collectionId?: string, count = 4) => {
    if (!Number.isInteger(count) || count < 1 || count > 4) throw new Error("Collection test seeds use one to four genuine Products per call");
    const products = Array.from({ length: count }, (_, index) => ({ id: prefix + "-product-" + index,
      title: prefix + index, handle: prefix + "-handle-" + index, ...(collectionId === undefined ? {} : { collection_id: collectionId }) }));
    const { metadata, logicalPolicy, commands } = product.runtime;
    const participant = defineAtomicCommerceParticipant("product");
    const selected = [metadata.product, metadata.option, metadata.value, metadata.variant, metadata.image].map(entity => ({
      name: entity.createdEvent, contract: defineCommerceEventContract({ name: entity.createdEvent,
        revision: options.revision, internal: true, decode: logicalPolicy.capture }),
    }));
    const contracts = selected.map(value => value.contract);
    const root = defineAtomicCommerceCommand("seedCollectionWorkflowProducts", (ctx, input) => ctx.call(participant, commands.create, input));
    const host = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.hostInput,
      identityAndAccessPolicy: { profile: "collection-workflow-product-seed" },
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
  const physicallyDelete = async (ids: readonly string[]) => {
    const { metadata, logicalPolicy, commands } = product.runtime;
    const participant = defineAtomicCommerceParticipant("product");
    const contract = defineCommerceEventContract({ name: metadata.collection.deletedEvent, revision: options.revision,
      internal: true, decode: logicalPolicy.capture });
    const root = defineAtomicCommerceCommand("physicalCollectionDeleteContrast", (ctx, input) => ctx.call(participant, commands.deleteCollections, input));
    const host = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.hostInput,
      identityAndAccessPolicy: { profile: "collection-workflow-physical-delete-contrast" },
      participants: [{ participant, logicalStorage: product.hostInput.logicalStorage, commands: [commands.deleteCollections], setNullPolicy: { managedUpdate: "advance" },
        validateLogicalCall: logicalPolicy.validateLogicalCall, events: { contracts: [contract], select: () => Effect.succeed(contract) } }],
      commands: [root], events: { producerRevision: options.revision, contracts: [contract], subscribers: options.subscribers,
        validate: values => values.some(value => !value.internal) ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
    }));
    try { return await Effect.runPromise(host.run(host.newRequestKey(), root, [...ids])); }
    finally { await Effect.runPromise(host.close); }
  };
  return { fixture, product, reads, execution, link, options, prepareCreate, prepareUpdate, prepareDelete,
    listCollections, collectionMembers, listProducts, seedProducts, physicallyDelete };
}
