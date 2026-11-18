import { createHash, randomUUID } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, transform, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { deleteShippingProfileWorkflow } from "@medusajs/core-flows/shipping-profile/delete-shipping-profile";
import { createProductsStep } from "@medusajs/core-flows/product/create-products-step";
import { createShippingProfilesStep } from "@medusajs/core-flows/fulfillment/create-shipping-profiles-step";
import { createRemoteLinkStep } from "@medusajs/core-flows/common/create-remote-links-step";
import { compileCoreNativeEventStorageDefinition } from "../../../persistence-postgres/src/commit/events/coreDefinition";
import type { CorePersistenceFixture } from "../../../persistence-postgres/test/core/fixture";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { makeShippingProfileDeletionCommands } from "../../src/modules/fulfillment/shipping-profile-delete-service";
import { makeLocalShippingProfileCommands, SimpleShippingProfileInput } from "../../src/modules/fulfillment/shipping-profile-service";
import { SimpleProductInput } from "../../src/modules/product/workflow";
import { prepareProductNativeLinkResource } from "../../src/links/product-resource";
import { prepareShippingProfileDeletionLinks } from "../../src/links/shipping-profile-deletion";
import { prepareShippingProfileDeletionWorkflow, ShippingProfileDeletionInput } from "../../src/workflows/fulfillment/delete-shipping-profile";
import { compileServiceZoneCreationCoreDefinition } from "../../src/modules/fulfillment/shipping-profile-schema";
import { compileProductLinksCoreDefinition } from "../../src/links/product-definition";
import { compileProductCoreDefinition } from "../../src/modules/product/schema";
import { makeLocalProductCommands } from "../../src/modules/product/service";
import { createCoreNativeWorkflowFixture, shareCoreNativeWorkflowPhysical } from "./core-native-workflow-fixture";
import { orderFixtureHosts } from "./core-order-fixture";
import { shippingProfileOptionParents, type shippingProfileDeletionGraph } from "./shipping-profile-seeds";

const revision = (name: string) => createHash("sha256").update(name).digest("hex");
const deletion = Result.getOrThrow(deleteShippingProfileWorkflow.prepare());
function nativeCompensator(name: string) {
  const node = deletion.nodes.find(node => node.name === name);
  if (node?.kind !== "step" || node.compensation !== "transactionCovered" || node.compensate === undefined)
    throw new Error("Missing retained ShippingProfile compensator " + name);
  return node.compensate;
}
const restoreProfiles = nativeCompensator("delete-shipping-profile"), restoreLinks = nativeCompensator("remove-remote-links");

export async function prepareCoreShippingProfileDeletion(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  graphs: readonly ReturnType<typeof shippingProfileDeletionGraph>[], shared?: CorePersistenceFixture) {
  const target = { scopeUuid: randomUUID(), epochUuid: randomUUID() };
  const [fulfillment, links, product, fulfillmentDefinition, linkDefinition, productDefinition, eventDefinition] =
    await Effect.runPromise(Effect.all([
      makeShippingProfileDeletionCommands(), prepareShippingProfileDeletionLinks(), makeLocalProductCommands(),
      compileServiceZoneCreationCoreDefinition(target), compileProductLinksCoreDefinition(target, { salesChannel: false, shippingProfile: true }),
      compileProductCoreDefinition(target), compileCoreNativeEventStorageDefinition(target),
    ]));
  const tableOrder = ["fulfillment_set", "service_zone", "shipping_option_type", "fulfillment_provider", "shipping_profile", "shipping_option"];
  const supplied = [...shippingProfileOptionParents, ...graphs.flatMap(graph => graph.rows)];
  const ordered = tableOrder.flatMap(table => supplied.filter(value => value.table === table));
  if (ordered.length !== supplied.length) throw new Error("Unknown ShippingProfile fixture table");
  const physical = shared === undefined ? undefined : await shareCoreNativeWorkflowPhysical(shared);
  const linkSlot = "product_shipping_profile_deletion_links";
  const fixture = await createCoreNativeWorkflowFixture(driver, {
    eventDefinition, ...(physical === undefined ? {} : { physical }),
    sources: [
      { name: "fulfillment", definition: fulfillmentDefinition, initialCommands: fulfillment.commands, rows: ordered },
      { name: "product", definition: productDefinition, initialCommands: Object.values(product.commands), rows: [] },
      { name: linkSlot, definition: linkDefinition, initialCommands: links.shipping.commands, rows: graphs.flatMap(graph => graph.links) },
    ],
  });
  close(fixture.close);
  const { own, closeCaseHosts } = orderFixtureHosts(close);
  const execution = fixture.execution;
  // Product endpoints use the genuine already-supported creation callback.
  const productModule = { module: product.workflow, nativeStorage: fixture.source("product") };
  const productResources = Result.getOrThrow(prepareWorkflowResources({ product: { module: productModule.module, methods: ["createProducts"], graph: false } }, true));
  const ProductSeed = Schema.Array(SimpleProductInput).check(Schema.isMaxLength(4));
  const productSeed = createWorkflow("seed-shipping-profile-delete-products", (input: WorkflowData<typeof ProductSeed.Type>) => new WorkflowResponse(createProductsStep(transform(input, rows => [...rows]))));
  const productHost = await Effect.runPromise(prepareAtomicWorkflowHost({ execution, modules: { product: productModule }, revision: revision("shipping-profile-delete-products"),
    subscribers: [{ id: "shipping-profile-delete-products", revision: "1".repeat(64) }], workflow: { name: "seedShippingProfileDeletionProducts", resources: productResources,
      prepared: Result.getOrThrow(productSeed.prepare()), input: ProductSeed, output: Schema.Array(Schema.JsonObject), events: internalModuleWorkflowEvents } }));
  const products = [...new Set([...graphs.flatMap(graph => graph.productIds), "sp-delete-competing-product"])];
  try { for (let index = 0; index < products.length; index += 4)
    await Effect.runPromise(productHost.run(productHost.newRequestKey(), products.slice(index, index + 4).map(id => ({ id, title: id })))); }
  finally { await Effect.runPromise(productHost.close); }
  const modules = { fulfillment: { module: fulfillment.workflow, nativeStorage: fixture.source("fulfillment") },
    product_shipping_profile_deletion_links: { module: links.shipping.workflow, nativeStorage: fixture.source(linkSlot) } };
  const options = { execution, modules, link: links.resource, revision: revision("native-shipping-profile-deletion"),
    subscribers: [{ id: "native-shipping-profile-deletion", revision: "2".repeat(64) }] };
  const prepare = async (selectedRevision = options.revision) => {
    const host = await Effect.runPromise(prepareShippingProfileDeletionWorkflow({ ...options, revision: selectedRevision }));
    return own(host);
  };
  const resources = Result.getOrThrow(prepareWorkflowResources({
    fulfillment: { module: fulfillment.workflow, methods: ["softDeleteShippingProfiles", "restoreShippingProfiles"], graph: false },
    product_shipping_profile_deletion_links: { module: links.shipping.workflow, methods: ["softDelete", "restore"], graph: true, expose: false },
  }, true, { link: links.resource }));
  const prepareInverse = async (roundtrip: boolean, lateFailure?: Error) => {
    const restore = createStep("invoke-retained-shipping-profile-compensators", resources.callback(async (input: typeof ShippingProfileDeletionInput.Type, context) => {
      // Native reverse compensation order: Link first, then Fulfillment. Raw
      // endpoint selection restores historical Links and previously deleted roots.
      await restoreLinks({ fulfillment: { shipping_profile_id: [...input.ids] } }, context);
      await restoreProfiles([...input.ids], context);
      if (lateFailure !== undefined) throw lateFailure;
      return new StepResponse(null);
    }));
    const workflow = createWorkflow(roundtrip ? "probe-shipping-profile-deletion-roundtrip" : "probe-shipping-profile-deletion-inverse", (input: WorkflowData<typeof ShippingProfileDeletionInput.Type>) => {
      if (roundtrip) {
        const deleted = deleteShippingProfileWorkflow.runAsStep({ input: { ids: input.ids } });
        return new WorkflowResponse(restore(transform({ input, deleted }, ({ input }) => input)));
      }
      return new WorkflowResponse(restore(input));
    });
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution, modules, operationScheduling: "queued", revision: options.revision, subscribers: options.subscribers,
      workflow: { name: roundtrip ? "probeShippingProfileDeletionRoundtrip" : "probeShippingProfileDeletionInverse", resources,
        prepared: Result.getOrThrow(workflow.prepare()), input: ShippingProfileDeletionInput, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    return own(host);
  };
  const prepareCreateLink = async () => {
    const selected = { product_shipping_profile_deletion_links: modules.product_shipping_profile_deletion_links };
    const resource = Result.getOrThrow(prepareWorkflowResources({ product_shipping_profile_deletion_links: { module: links.shipping.workflow, methods: ["create", "list"], graph: false, expose: false } }, true, { link: Result.getOrThrow(prepareProductNativeLinkResource([links.nativeServices.shipping])) }));
    const Input = Schema.Struct({ product_id: Schema.String, shipping_profile_id: Schema.String });
    const flow = createWorkflow("probe-create-shipping-profile-product-link", (input: WorkflowData<typeof Input.Type>) => new WorkflowResponse(createRemoteLinkStep([
      { product: { product_id: input.product_id }, fulfillment: { shipping_profile_id: input.shipping_profile_id } },
    ])));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution, modules: selected, revision: options.revision, subscribers: options.subscribers,
      workflow: { name: "probeCreateShippingProfileProductLink", resources: resource, prepared: Result.getOrThrow(flow.prepare()), input: Input,
        output: Schema.Array(Schema.JsonObject), events: internalModuleWorkflowEvents } }));
    return own(host);
  };
  const prepareCreateProfile = async () => {
    const creation = await Effect.runPromise(makeLocalShippingProfileCommands()), selected = { fulfillment: { module: creation.workflow, nativeStorage: modules.fulfillment.nativeStorage } };
    const resource = Result.getOrThrow(prepareWorkflowResources({ fulfillment: { module: creation.workflow, methods: ["createShippingProfiles"], graph: false } }, true));
    const Input = Schema.Array(SimpleShippingProfileInput).check(Schema.isMaxLength(4));
    const flow = createWorkflow("probe-create-shipping-profile", (input: WorkflowData<typeof Input.Type>) => new WorkflowResponse(createShippingProfilesStep(transform(input, rows => [...rows]))));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution, modules: selected, revision: options.revision, subscribers: options.subscribers,
      workflow: { name: "probeCreateShippingProfile", resources: resource, prepared: Result.getOrThrow(flow.prepare()), input: Input,
        output: Schema.Array(Schema.JsonObject), events: internalModuleWorkflowEvents } }));
    return own(host);
  };
  const read = async (ids: readonly string[]) => (await fixture.readRows()).filter(row => typeof row.id === "string" && ids.includes(row.id))
    .toSorted((left, right) => String(left.id).localeCompare(String(right.id)));
  return { fixture, fulfillment, modules, options, prepare, prepareRoundtrip: (lateFailure?: Error) => prepareInverse(true, lateFailure),
    prepareRestore: () => prepareInverse(false), prepareCreateLink, prepareCreateProfile, closeCaseHosts,
    read, snapshot: fixture.snapshot };
}
