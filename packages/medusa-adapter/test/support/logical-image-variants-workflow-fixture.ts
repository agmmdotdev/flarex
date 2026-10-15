import { createHash } from "node:crypto";
import { Effect } from "effect";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { makeCommerceHost } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { defineCommerceCommand, type CommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, defaultCommerceResources, isJsonObject, type CommerceTransactionError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareImageVariantsWorkflow } from "../../src/workflows/product/variant-images";
import type { ProductWorkflowModule } from "../../src/modules/product/workflow";
import type { AtomicWorkflowExecution } from "../../src/workflow/host";
import { logicalCurrencyFixture, type LogicalCurrencyFixture } from "./logical-currency-fixture";
import { prepareLogicalProductHost } from "./logical-product-fixture";

type ImageWorkflowOptions = Parameters<typeof prepareImageVariantsWorkflow>[0];
interface SeedInput { readonly parents?: number; readonly siblings?: number; readonly options?: number; readonly values?: number; readonly imageUrl?: string | null }
interface SeedGraph { readonly productIds: string[]; readonly imageId: string; readonly variantIds: string[]; readonly optionIds: string[] }
type ReadRows = Effect.Effect<Json, CommerceTransactionError>;
export interface LogicalImageVariantsFixture {
  readonly fixture: LogicalCurrencyFixture;
  readonly product: Awaited<ReturnType<typeof prepareLogicalProductHost>>;
  readonly execution: AtomicWorkflowExecution;
  readonly options: ImageWorkflowOptions;
  readonly prepare: (execution?: AtomicWorkflowExecution, revision?: string, module?: ProductWorkflowModule) =>
    Promise<Effect.Success<ReturnType<typeof prepareImageVariantsWorkflow>>>;
  readonly seed: (prefix: string, input?: SeedInput) => Promise<SeedGraph>;
  readonly seedOptions: (input: Json) => Promise<Json>;
  readonly seedAdditionEndpoints: (prefix: string) => Promise<{ readonly productIds: string[]; readonly variantIds: string[] }>;
  readonly assign: (imageId: string, variantIds: readonly string[]) => Promise<Json>;
  readonly arrangeDeleted: (entity: "image" | "variant", id: string) => Promise<void>;
  readonly arrangeExtraValuePivot: (variantId: string, valueId: string) => Promise<void>;
  readonly listAssignments: () => ReadRows;
  readonly listVariants: (ids: readonly string[]) => ReadRows;
  readonly listOptions: (ids: readonly string[]) => ReadRows;
  readonly listProducts: (ids: readonly string[]) => ReadRows;
  readonly cleanupProducts: () => Promise<void>;
}

/** Native commands prepare and clean the graph; explicit persisted-state
 * arrangements use core lifecycle and scoped pivot writes. */
export async function prepareLogicalImageVariants(driver: "pglite" | "postgres", registerCleanup: (close: () => Promise<void>) => void,
  selectedFixture?: LogicalCurrencyFixture): Promise<LogicalImageVariantsFixture> {
  const fixture = selectedFixture ?? await logicalCurrencyFixture(driver, registerCleanup, { includeProduct: true });
  const product = await prepareLogicalProductHost(fixture);
  registerCleanup(() => Effect.runPromise(product.host.close));
  await Effect.runPromise(product.host.initialize([]));
  const { metadata, logicalPolicy } = product.runtime;
  const assignments = defineCommerceCommand("imageVariantsAssignmentObservation", "read", Effect.fn(function* (ctx) {
    return yield* (yield* ctx.table(metadata.assignment.table.name)).find(ctx.manager,
      { take: 256, order: { column: "id", direction: "asc" } });
  }));
  const reads = await Effect.runPromise(makeCommerceHost({ ...product.hostInput,
    commands: [assignments, product.runtime.commands.listVariants, product.runtime.commands.listOptions, product.runtime.commands.internalProductList] }));
  registerCleanup(() => Effect.runPromise(reads.close));
  const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
    prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition }) };
  const options: ImageWorkflowOptions = { execution,
    modules: { product: { module: product.runtime.productImageVariantWorkflow, logicalStorage: product.hostInput.logicalStorage } },
    revision: createHash("sha256").update("native-image-variant-workflow-108").digest("hex"),
    subscribers: [{ id: "native-image-variants", revision: "b".repeat(64) }] };
  const prepare = async (selectedExecution = execution, revision = options.revision,
    module = product.runtime.productImageVariantWorkflow) => {
    const host = await Effect.runPromise(prepareImageVariantsWorkflow({ ...options, execution: selectedExecution, revision,
      modules: { product: { ...options.modules.product, module } } }));
    registerCleanup(() => Effect.runPromise(host.close)); return host;
  };
  const seededProducts = new Set<string>(), seededVariants = new Set<string>(), seededImages = new Set<string>();
  const runNative = async (command: CommerceCommand, input: Json) => {
    if (![product.runtime.commands.create, product.runtime.commands.createOptions, product.runtime.commands.createVariants,
      product.runtime.commands.addImageToVariant, product.runtime.commands.removeImageFromVariant,
      product.runtime.commands.delete].includes(command)) throw new Error("Unselected image fixture command");
    const participant = defineAtomicCommerceParticipant("product");
    const selected = metadata.entities.flatMap(entity => [entity.createdEvent, entity.updatedEvent, entity.deletedEvent])
      .filter((name, index, all) => all.indexOf(name) === index).map(name => ({ name,
        contract: defineCommerceEventContract({ name, revision: options.revision, internal: true, decode: logicalPolicy.capture }) }));
    const contracts = selected.map(value => value.contract);
    // Fixture-only admission permits complete legitimate preparation and cleanup
    // without changing any production workflow profile or its limits.
    const resources = { ...defaultCommerceResources, calls: 1024, eventMessages: 256 };
    const root = defineAtomicCommerceCommand("nativeImageVariantFixtureCommand", (ctx, value) => ctx.call(participant, command, value));
    const host = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.hostInput,
      requestCallLimit: resources.calls, requestEventLimit: resources.eventMessages,
      identityAndAccessPolicy: { profile: "native-image-variant-fixture" },
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
  const seed = async (prefix: string, input: SeedInput = {}) => {
    const parentCount = input.parents ?? 1, siblingCount = input.siblings ?? 4;
    const optionCount = input.options ?? 1, valueCount = input.values ?? 4;
    const productIds = Array.from({ length: parentCount }, (_, n) => prefix + "-product-" + n), imageId = prefix + "-image";
    const variantIds: string[] = [], optionIds: string[] = [];
    for (const [parent, productId] of productIds.entries()) {
      await runNative(product.runtime.commands.create, [{ id: productId, title: prefix + parent, handle: prefix + "-handle-" + parent,
        ...(parent === 0 ? { images: [{ id: imageId, url: input.imageUrl === undefined ? "image-url" : input.imageUrl }] } : {}) }]);
      seededProducts.add(productId);
      if (parent === 0) seededImages.add(imageId);
      const localOptions = parent === 0 ? Array.from({ length: optionCount }, (_, n) => ({ id: prefix + "-option-" + n,
        title: "Option " + n, product_id: productId, values: Array.from({ length: valueCount }, (_, value) => "value-" + value) })) : [];
      if (localOptions.length > 0) await runNative(product.runtime.commands.createOptions, localOptions);
      optionIds.push(...localOptions.map(value => value.id));
      const count = parent === 0 ? siblingCount - parentCount + 1 : 1;
      const variants = Array.from({ length: count }, (_, n) => ({ id: prefix + "-variant-" + parent + "-" + n,
        product_id: productId, title: prefix + parent + n, manage_inventory: false, thumbnail: n % 2 === 0 ? "image-url" : "other-url",
        ...(localOptions.length === 0 ? {} : { options: Object.fromEntries(localOptions.map((option, index) => [option.title,
          "value-" + (Math.floor(n / valueCount ** index) % valueCount)])) }) }));
      for (let offset = 0; offset < variants.length; offset += 4) await runNative(product.runtime.commands.createVariants, variants.slice(offset, offset + 4));
      variantIds.push(...variants.map(value => value.id));
      for (const row of variants) seededVariants.add(row.id);
    }
    return { productIds, imageId, variantIds, optionIds };
  };
  const assign = (imageId: string, variantIds: readonly string[]) => runNative(product.runtime.commands.addImageToVariant,
    variantIds.map(variant_id => ({ image_id: imageId, variant_id })));
  const seedOptions = (input: Json) => runNative(product.runtime.commands.createOptions, input);
  const seedAdditionEndpoints = async (prefix: string) => {
    const productIds = Array.from({ length: 4 }, (_, n) => prefix + "-addition-product-" + n);
    const variantIds = productIds.map((_id, n) => prefix + "-addition-variant-" + n);
    await runNative(product.runtime.commands.create, productIds.map((id, n) => ({ id, title: prefix + " addition " + n, handle: id })));
    for (const id of productIds) seededProducts.add(id);
    await runNative(product.runtime.commands.createVariants, productIds.map((product_id, n) => ({
      id: prefix + "-addition-variant-" + n, product_id, title: "Independent addition " + n, manage_inventory: false, thumbnail: "independent-url" })));
    for (const id of variantIds) seededVariants.add(id);
    return { productIds, variantIds };
  };
  const arrangeExtraValuePivot = async (variantId: string, valueId: string) => {
    // This legitimate relational state has two Values from one Option. Public
    // native Variant input selects one Value per title and cannot express it.
    // The core owns all FK, identity and write enforcement for the arrangement.
    const arrange = defineCommerceCommand("imageVariantExtraValuePivotArrangement", "write", Effect.fn(function* (ctx) {
      yield* (yield* ctx.table(metadata.pivot.table.name)).write(ctx.manager, "insert", [{
        [metadata.pivot.variantColumn]: variantId, [metadata.pivot.valueColumn]: valueId,
      }]); return null;
    }));
    const participant = defineAtomicCommerceParticipant("image_pivot_arrangement");
    const root = defineAtomicCommerceCommand("imageVariantExtraValuePivotArrangementRoot", ctx => ctx.call(participant, arrange, null));
    const host = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.hostInput,
      participants: [{ participant, logicalStorage: product.hostInput.logicalStorage, commands: [arrange] }], commands: [root] }));
    try { await Effect.runPromise(host.run(host.newRequestKey(), root, null)); } finally { await Effect.runPromise(host.close); }
  };
  const arrangeDeleted = async (entity: "image" | "variant", id: string) => {
    const arrange = defineCommerceCommand("imageVariantDeletedArrangement", "write", Effect.fn(function* (ctx) {
      yield* (yield* ctx.table(metadata[entity].table.name)).lifecycle(ctx.manager, "softDelete", [{ id }]); return null;
    }));
    const participant = defineAtomicCommerceParticipant("image_arrangement");
    const root = defineAtomicCommerceCommand("imageVariantDeletedArrangementRoot", ctx => ctx.call(participant, arrange, null));
    const host = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.hostInput,
      participants: [{ participant, logicalStorage: product.hostInput.logicalStorage, commands: [arrange] }], commands: [root] }));
    try { await Effect.runPromise(host.run(host.newRequestKey(), root, null)); } finally { await Effect.runPromise(host.close); }
  };
  const listAssignments = () => reads.read(assignments, null);
  const listVariants = (ids: readonly string[]) => reads.read(product.runtime.commands.listVariants,
    { filters: { id: [...ids] }, config: { take: 256, relations: ["options"] } });
  const listOptions = (ids: readonly string[]) => reads.read(product.runtime.commands.listOptions,
    { filters: { id: [...ids] }, config: { take: 256, relations: ["values"] } });
  const listProducts = (ids: readonly string[]) => reads.read(product.runtime.commands.internalProductList, { filters: { id: [...ids] } });
  const cleanupProducts = async () => {
    const observed = await Effect.runPromise(listAssignments());
    if (!Array.isArray(observed) || !observed.every(isJsonObject)) throw new Error("Invalid native assignment cleanup observation");
    const pairs = observed.flatMap(row => {
      if (typeof row.image_id !== "string" || typeof row.variant_id !== "string") throw new Error("Missing native assignment cleanup endpoints");
      return seededImages.has(row.image_id) || seededVariants.has(row.variant_id)
        ? [{ image_id: row.image_id, variant_id: row.variant_id }] : [];
    });
    // Assignment endpoint FKs intentionally retain NO ACTION. Use the genuine
    // existing ordinary unlink before deleting either owned endpoint graph.
    // Its retained selection also handles soft-deleted endpoint rows.
    if (pairs.length > 0) await runNative(product.runtime.commands.removeImageFromVariant, pairs);
    for (const id of seededProducts) { await runNative(product.runtime.commands.delete, id); seededProducts.delete(id); }
    seededVariants.clear(); seededImages.clear();
  };
  registerCleanup(cleanupProducts);
  return { fixture, product, execution, options, prepare, seed, seedOptions, seedAdditionEndpoints, assign, arrangeDeleted, arrangeExtraValuePivot,
    listAssignments, listVariants, listOptions, listProducts, cleanupProducts };
}
