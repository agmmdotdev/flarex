import { createHash } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, transform, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { deleteShippingProfileWorkflow } from "@medusajs/core-flows/shipping-profile/delete-shipping-profile";
import { createProductsStep } from "@medusajs/core-flows/product/create-products-step";
import { createShippingProfilesStep } from "@medusajs/core-flows/fulfillment/create-shipping-profiles-step";
import { createRemoteLinkStep } from "@medusajs/core-flows/common/create-remote-links-step";
import { decodeCanonicalFlarexValueEvidenceV1 } from "flarex-protocol/value";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { makeCommerceHost, type LogicalCommerceHostInput } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { capturePrivateCanonicalValue } from "../../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { ShippingProfileDeletionIds } from "../../src/modules/fulfillment/shipping-profile-delete-input";
import { makeShippingProfileDeletionCommands } from "../../src/modules/fulfillment/shipping-profile-delete-service";
import { makeLocalShippingProfileCommands, SimpleShippingProfileInput } from "../../src/modules/fulfillment/shipping-profile-service";
import { SimpleProductInput } from "../../src/modules/product/workflow";
import { prepareProductNativeLinkResource } from "../../src/links/product-resource";
import { prepareShippingProfileDeletionLinks } from "../../src/links/shipping-profile-deletion";
import { prepareShippingProfileDeletionWorkflow, ShippingProfileDeletionInput } from "../../src/workflows/fulfillment/delete-shipping-profile";
import { logicalCurrencyFixture, type LogicalCurrencyFixture } from "./logical-currency-fixture";
import { logicalCurrencyInventory } from "./logical-currency-inventory";
import { prepareLogicalProductHost } from "./logical-product-fixture";

const revision = (name: string) => createHash("sha256").update(name).digest("hex");
export const shippingProfileDeletionSeedTime = "2026-10-17T00:00:00.000Z";
export type ShippingProfileDeletionInitialRow = Readonly<{ table: string; row: JsonObject }>;
const managed = (deleted = false) => ({ created_at: shippingProfileDeletionSeedTime, updated_at: shippingProfileDeletionSeedTime,
  deleted_at: deleted ? shippingProfileDeletionSeedTime : null });

/** Full native DML seed with every real FK target. This is canonical initial
 * state, not ShippingOption creation/provider capability. */
export const shippingProfileOptionParents: readonly ShippingProfileDeletionInitialRow[] = [
  { table: "fulfillment_set", row: { id: "sp-delete-set", name: "Shipping deletion set", type: "shipping", metadata: null, ...managed() } },
  { table: "service_zone", row: { id: "sp-delete-zone", name: "Shipping deletion zone", fulfillment_set_id: "sp-delete-set", metadata: null, ...managed() } },
  { table: "shipping_option_type", row: { id: "sp-delete-option-type", label: "Shipping deletion type", description: null, code: "shipping", ...managed() } },
  { table: "fulfillment_provider", row: { id: "sp-delete-provider", is_enabled: true, ...managed() } },
];
export function shippingProfileDeletionGraph(prefix: string, count = 1, options: Readonly<{
  optionsPerProfile?: number; deletedOptions?: boolean; deletedProfiles?: boolean; linksPerProfile?: number; deletedLinks?: boolean;
}> = {}) {
  const profiles = Array.from({ length: count }, (_, index) => `${prefix}-profile-${index}`);
  const optionIds = profiles.flatMap(id => Array.from({ length: options.optionsPerProfile ?? 0 }, (_, index) => `${id}-option-${index}`));
  const linkIds = profiles.flatMap(id => Array.from({ length: options.linksPerProfile ?? 0 }, (_, index) => `${id}-link-${index}`));
  const productIds = profiles.flatMap(id => Array.from({ length: options.linksPerProfile ?? 0 }, (_, index) => `${id}-product-${index}`));
  const rows: ShippingProfileDeletionInitialRow[] = profiles.flatMap(id => [
    { table: "shipping_profile", row: { id, name: id, type: "default", metadata: { fixture: prefix }, ...managed(options.deletedProfiles) } },
    ...Array.from({ length: options.optionsPerProfile ?? 0 }, (_, index) => ({ table: "shipping_option", row: {
      id: `${id}-option-${index}`, name: `${id} option ${index}`, price_type: "flat", data: null, metadata: { fixture: prefix },
      service_zone_id: "sp-delete-zone", shipping_profile_id: id, provider_id: "sp-delete-provider",
      shipping_option_type_id: "sp-delete-option-type", ...managed(options.deletedOptions),
    } })),
  ]);
  const links: ShippingProfileDeletionInitialRow[] = profiles.flatMap(id => Array.from({ length: options.linksPerProfile ?? 0 }, (_, index) => ({
    table: "product_shipping_profile", row: { id: `${id}-link-${index}`, product_id: `${id}-product-${index}`,
      shipping_profile_id: id, ...managed(options.deletedLinks) },
  })));
  return { profiles, optionIds, linkIds, productIds, rows, links };
}
const deletion = Result.getOrThrow(deleteShippingProfileWorkflow.prepare());
function nativeCompensator(name: string) {
  const node = deletion.nodes.find(node => node.name === name);
  if (node?.kind !== "step" || node.compensation !== "transactionCovered" || node.compensate === undefined)
    throw new Error("Missing retained ShippingProfile compensator " + name);
  return node.compensate;
}
const restoreProfiles = nativeCompensator("delete-shipping-profile"), restoreLinks = nativeCompensator("remove-remote-links");

export async function prepareLogicalShippingProfileDeletion(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  graphs: readonly ReturnType<typeof shippingProfileDeletionGraph>[], shared?: Readonly<{ resource: LogicalCurrencyFixture["resource"];
    fixtureIdentity: Readonly<{ deploymentId: string; projectId: string; uuidOffset: number }> }>) {
  const configuration = { includeProduct: true, includeShippingProfile: true, includeShippingProfileDeletion: true, includeProductShippingProfileLink: true };
  const fixture = await logicalCurrencyFixture(driver, close, shared === undefined ? configuration : { ...configuration, ...shared });
  const fulfillment = await Effect.runPromise(makeShippingProfileDeletionCommands()), links = await Effect.runPromise(prepareShippingProfileDeletionLinks());
  const definition = fixture.shippingProfileDefinition, linkDefinition = fixture.productLinksDefinition;
  if (definition === undefined || definition.schema.tables.length !== 6 || linkDefinition === undefined || linkDefinition.schema.tables.length !== 1)
    throw new Error("Missing six-table ShippingProfile and shipping-only Link sources");
  const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
    prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition }) };
  const sourceInput = async (key: string, schema: typeof definition | typeof linkDefinition, inputRows: readonly ShippingProfileDeletionInitialRow[], commands: LogicalCommerceHostInput<unknown>["commands"]) => {
    const rows = schema.schema.tables.length === 1 ? inputRows.map(value => ({ ...value.row })) : inputRows.map(value => ({ table: value.table, row: value.row }));
    const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows }, 1_048_576,
      { invalidInput: () => new Error("Invalid ShippingProfile deletion seed"), hashFailure: cause => new Error("ShippingProfile seed hash", { cause }) }));
    const input = { ...fixture.hostInput, commands, identityAndAccessPolicy: { profile: key + ".shipping-profile-deletion-initialization" },
      logicalStorage: { ...fixture.hostInput.logicalStorage,
        source: { sourceKey: key, writeProfile: key, schema: schema.schema, evidence: schema.provenance },
        initialization: { stepId: key.toLowerCase() + ".shipping-profile-deletion-initial", datasetSha256: dataset.sha256Hex, expectedRowCount: rows.length } },
    } satisfies LogicalCommerceHostInput<unknown>;
    const host = await Effect.runPromise(makeCommerceHost(input));
    try { await Effect.runPromise(host.initialize(rows)); } finally { await Effect.runPromise(host.close); }
    return input;
  };
  const tableOrder = ["fulfillment_set", "service_zone", "shipping_option_type", "fulfillment_provider", "shipping_profile", "shipping_option"];
  const supplied = [...shippingProfileOptionParents, ...graphs.flatMap(graph => graph.rows)];
  const ordered = tableOrder.flatMap(table => supplied.filter(value => value.table === table));
  if (ordered.length !== supplied.length) throw new Error("Unknown ShippingProfile fixture table");
  const fulfillmentInput = await sourceInput("medusa.shippingProfile", definition, ordered, fulfillment.commands);
  const product = await prepareLogicalProductHost(fixture);
  try { await Effect.runPromise(product.host.initialize([])); } finally { await Effect.runPromise(product.host.close); }
  // Product endpoints use the genuine already-supported creation callback.
  const productModule = { module: product.runtime.workflow, logicalStorage: product.hostInput.logicalStorage };
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
  const linkInput = await sourceInput("medusa.productLinks", linkDefinition, graphs.flatMap(graph => graph.links), links.shipping.commands);
  const modules = { fulfillment: { module: fulfillment.workflow, logicalStorage: fulfillmentInput.logicalStorage },
    product_shipping_profile_deletion_links: { module: links.shipping.workflow, logicalStorage: linkInput.logicalStorage } };
  const options = { execution, modules, link: links.resource, revision: revision("native-shipping-profile-deletion"),
    subscribers: [{ id: "native-shipping-profile-deletion", revision: "2".repeat(64) }] };
  const prepare = async (selectedRevision = options.revision) => {
    const host = await Effect.runPromise(prepareShippingProfileDeletionWorkflow({ ...options, revision: selectedRevision }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const resources = Result.getOrThrow(prepareWorkflowResources({
    fulfillment: { module: fulfillment.workflow, methods: ["softDeleteShippingProfiles", "restoreShippingProfiles"], graph: false },
    product_shipping_profile_deletion_links: { module: links.shipping.workflow, methods: ["softDelete", "restore"], graph: true, expose: false },
  }, true, { link: links.resource }));
  const Restore = Schema.Struct({ ids: ShippingProfileDeletionIds, fail: Schema.optionalKey(Schema.Boolean) });
  const prepareInverse = async (roundtrip: boolean) => {
    const restore = createStep("invoke-retained-shipping-profile-compensators", resources.callback(async (input: typeof Restore.Type, context) => {
      // Native reverse compensation order: Link first, then Fulfillment. Raw
      // endpoint selection restores historical Links and previously deleted roots.
      await restoreLinks({ fulfillment: { shipping_profile_id: [...input.ids] } }, context);
      await restoreProfiles([...input.ids], context);
      if (input.fail === true) throw new Error("Late native ShippingProfile inverse failure");
      return null;
    }));
    const workflow = createWorkflow(roundtrip ? "probe-shipping-profile-deletion-roundtrip" : "probe-shipping-profile-deletion-inverse", (input: WorkflowData<typeof Restore.Type>) => {
      if (roundtrip) {
        const deleted = deleteShippingProfileWorkflow.runAsStep({ input: { ids: input.ids } });
        return new WorkflowResponse(restore(transform({ input, deleted }, ({ input }) => input)));
      }
      return new WorkflowResponse(restore(input));
    });
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution, modules, operationScheduling: "queued", revision: options.revision, subscribers: options.subscribers,
      workflow: { name: roundtrip ? "probeShippingProfileDeletionRoundtrip" : "probeShippingProfileDeletionInverse", resources,
        prepared: Result.getOrThrow(workflow.prepare()), input: Restore, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
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
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareCreateProfile = async () => {
    const creation = await Effect.runPromise(makeLocalShippingProfileCommands()), selected = { fulfillment: { module: creation.workflow, logicalStorage: fulfillmentInput.logicalStorage } };
    const resource = Result.getOrThrow(prepareWorkflowResources({ fulfillment: { module: creation.workflow, methods: ["createShippingProfiles"], graph: false } }, true));
    const Input = Schema.Array(SimpleShippingProfileInput).check(Schema.isMaxLength(4));
    const flow = createWorkflow("probe-create-shipping-profile", (input: WorkflowData<typeof Input.Type>) => new WorkflowResponse(createShippingProfilesStep(transform(input, rows => [...rows]))));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution, modules: selected, revision: options.revision, subscribers: options.subscribers,
      workflow: { name: "probeCreateShippingProfile", resources: resource, prepared: Result.getOrThrow(flow.prepare()), input: Input,
        output: Schema.Array(Schema.JsonObject), events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const read = async (ids: readonly string[]) => {
    const inventory = await logicalCurrencyInventory(fixture), selected = new Set(ids), found: JsonObject[] = [];
    for (const current of inventory.rows) {
      if (current.scopeUuid !== projectScopeIdUuidV1(fixture.application.authority.scopeId).scopeUuid) continue;
      const revision = inventory.revisions.find(row => row.scopeUuid === current.scopeUuid && row.tableId === current.tableId
        && row.commitSeq === current.commitSeq && Buffer.from(row.rowId).equals(Buffer.from(current.rowId)));
      if (revision === undefined || revision.isTombstone) continue;
      const decoded = await decodeCanonicalFlarexValueEvidenceV1({ canonicalBytes: revision.valueBytes, sha256: revision.valueSha256, profile: "appDocument" });
      const row = Schema.decodeUnknownSync(Schema.JsonObject)(decoded.valueJson);
      if (typeof row.id === "string" && selected.has(row.id)) found.push(row);
    }
    return found.sort((left, right) => String(left.id).localeCompare(String(right.id)));
  };
  return { fixture, fulfillment, links, product, execution, modules, options, prepare, prepareRoundtrip: () => prepareInverse(true),
    prepareRestore: () => prepareInverse(false), prepareCreateLink, prepareCreateProfile, read, snapshot: () => logicalCurrencyInventory(fixture) };
}
