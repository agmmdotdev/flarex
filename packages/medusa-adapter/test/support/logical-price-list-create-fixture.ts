import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, transform, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { createPriceListsWorkflow, type CreatePriceListsWorkflowInput } from "@medusajs/core-flows/price-list/create-price-lists";
import { decodeCanonicalFlarexValueEvidenceV1 } from "flarex-protocol/value";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { makeCommerceHost, type LogicalCommerceHostInput } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { capturePrivateCanonicalValue } from "../../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { capturePricingMetadata } from "../../src/modules/pricing/schema";
import { makeLocalPricingCommands } from "../../src/modules/pricing/service";
import { compilePriceListCreationContracts, PriceListDeletionIds, PriceListWorkflowInput } from "../../src/modules/pricing/list-input";
import { prepareCreatePriceListsWorkflow } from "../../src/workflows/pricing/create-price-lists";
import { prepareVariantPricingLink } from "../../src/links/variant-pricing-service";
import { captureVariantPricingLinkMetadata } from "../../src/composition/product-variant-pricing-schema";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { projectNativeRow } from "../../src/repository/result";
import { logicalCurrencyFixture } from "./logical-currency-fixture";
import { logicalCurrencyInventory } from "./logical-currency-inventory";

const revision = "b".repeat(64), stamp = "2026-01-01T00:00:00.000Z";
const preparedNative = Result.getOrThrow(createPriceListsWorkflow.prepare());
const validation = preparedNative.nodes.find(node => node.name === "validate-variant-price-links");
const creation = preparedNative.nodes.find(node => node.name === "create-price-lists");
if (validation?.kind !== "step" || creation?.kind !== "step" || creation.compensation !== "transactionCovered" || !creation.compensate)
  throw new Error("Missing genuine native Price List creation callbacks");
const retained = { validate: validation.invoke, invoke: creation.invoke, compensate: creation.compensate };

type Options = Parameters<typeof prepareCreatePriceListsWorkflow>[0];
type Host = Effect.Success<ReturnType<typeof prepareCreatePriceListsWorkflow>>;
interface ParentOptions {
  readonly lateFailure?: boolean; readonly caughtRefusal?: boolean;
  readonly inspect?: (resources: unknown) => void;
  readonly escape?: (work: () => Promise<unknown>) => void;
}
const selectResources = (modules: Options["modules"]) => prepareWorkflowResources({
  pricing: { module: modules.pricing.module, methods: ["createPriceLists", "deletePriceLists"], graph: false },
  link: { module: modules.link.module, methods: [], graph: true, expose: false },
}, true);

/** Explicit comparison data for native creation and physical inverse proofs. */
export function priceListCreationComparisonRows(linkTable: string) {
  const managed = { created_at: stamp, updated_at: stamp, deleted_at: null };
  const setIds = Array.from({ length: 4 }, (_, index) => "plist152-set-" + index);
  const variantIds = Array.from({ length: 4 }, (_, index) => "plist152-variant-" + index);
  const protectedIds = [...setIds, "plist152-protected-preference", "plist152-protected-base"];
  const seedRows: Array<{ table: string; row: JsonObject }> = [
    ...setIds.map((id, index) => ({ table: "price_set", row: { id, ...managed, deleted_at: index === 3 ? stamp : null } })),
    { table: "price_preference", row: { id: "plist152-protected-preference", attribute: "currency_code", value: "protected152", is_tax_inclusive: true, ...managed } },
    { table: "price", row: { id: "plist152-protected-base", title: null, currency_code: "USD", amount: "123.00000000000000000",
      raw_amount: { value: "123.00000000000000000", precision: 20 }, min_quantity: null, raw_min_quantity: null,
      max_quantity: null, raw_max_quantity: null, rules_count: 0, price_set_id: setIds[0]!, price_list_id: null, ...managed } },
  ];
  const historicalRootId = "plist152-comparison-history", historicalIds = [historicalRootId];
  seedRows.push({ table: "price_list", row: { id: historicalRootId, title: "historical comparison152", description: "stored history",
    status: "draft", type: "sale", starts_at: null, ends_at: null, rules_count: 3, ...managed, deleted_at: stamp } });
  for (const index of [0, 1, 2]) {
    const listRuleId = "plrule152-comparison-history-" + index;
    historicalIds.push(listRuleId);
    seedRows.push({ table: "price_list_rule", row: { id: listRuleId, price_list_id: historicalRootId,
      attribute: "comparison-" + index, value: ["history", String(index)], ...managed, deleted_at: index === 1 ? null : stamp } });
    const priceId = "price152-comparison-" + index;
    historicalIds.push(priceId);
    seedRows.push({ table: "price", row: { id: priceId, title: null, currency_code: "USD", amount: "1.0000000000000000000",
      raw_amount: { value: "1.0000000000000000000", precision: 20 }, min_quantity: null, raw_min_quantity: null,
      max_quantity: null, raw_max_quantity: null, rules_count: 3, price_set_id: setIds[0]!, price_list_id: historicalRootId,
      ...managed, deleted_at: index === 1 ? stamp : null } });
    for (const priority of [0, 1, 2]) {
      const ruleId = "prule152-comparison-" + index + "-" + priority;
      historicalIds.push(ruleId);
      seedRows.push({ table: "price_rule", row: { id: ruleId, price_id: priceId, attribute: "comparison-" + priority,
        value: String(index), operator: "eq", priority, ...managed, deleted_at: priority === 1 ? stamp : null } });
    }
  }
  const insertionRootIds = ["plist152-z-storage-order", "plist152-a-storage-order"];
  for (const id of insertionRootIds) seedRows.push({ table: "price_list", row: { id, title: id, description: "stored order comparison",
    status: "draft", type: "sale", starts_at: null, ends_at: null, rules_count: 0, ...managed, deleted_at: stamp } });
  const linkRows: Array<{ table: string; row: JsonObject }> = variantIds.map((variant_id, index) => ({ table: linkTable, row: {
    id: "plist152-link-" + index, variant_id, price_set_id: setIds[index]!, ...managed,
  } }));
  linkRows.push({ table: linkTable, row: { id: "plist152-link-history", variant_id: "plist152-variant-history", price_set_id: setIds[0]!, ...managed, deleted_at: stamp } });
  return { setIds, variantIds, protectedIds, seedRows, linkRows, historicalRootId, historicalIds, insertionRootIds };
}

/** Existing canonical initialization owns comparison seeds. All exercised
 * mutations run native Pricing callbacks through the shared participant. */
export async function prepareLogicalPriceListCreation(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void) {
  // The installed stored-Link catalog depends on Product and Pricing metadata.
  // The native Link has no endpoint FK and its flat root query borrows neither
  // a Product service nor a Product participant or endpoint read.
  const fixture = await logicalCurrencyFixture(driver, close, { includeProduct: true, includePricing: true, includeVariantPricingLink: true });
  const pricing = await Effect.runPromise(makeLocalPricingCommands("price-list-creations"));
  const link = await Effect.runPromise(prepareVariantPricingLink());
  const pricingDefinition = fixture.pricingDefinition, linkDefinition = fixture.variantPricingLinkDefinition;
  if (!pricingDefinition || !linkDefinition) throw new Error("Missing installed Pricing/Link source");
  const { setIds, variantIds, protectedIds, seedRows, linkRows, historicalRootId, historicalIds, insertionRootIds } =
    priceListCreationComparisonRows((await Effect.runPromise(captureVariantPricingLinkMetadata())).frame.name);
  const initialize = async (sourceKey: string, definition: typeof pricingDefinition | typeof linkDefinition,
    commands: LogicalCommerceHostInput<unknown>["commands"], rows: readonly { table: string; row: JsonObject }[]) => {
    const inputRows = definition.schema.tables.length === 1 ? rows.map(entry => entry.row) : rows;
    const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: inputRows }, 1_048_576,
      { invalidInput: () => new Error("Invalid Price List comparison seed"), hashFailure: cause => new Error("Price List seed hash", { cause }) }));
    const input = { ...fixture.hostInput, commands, logicalStorage: { ...fixture.hostInput.logicalStorage,
      source: { sourceKey, writeProfile: sourceKey, schema: definition.schema, evidence: definition.provenance },
      initialization: { stepId: sourceKey.toLowerCase() + ".152-comparison", datasetSha256: dataset.sha256Hex, expectedRowCount: rows.length },
    } } satisfies LogicalCommerceHostInput<unknown>;
    const initializer = await Effect.runPromise(makeCommerceHost(input));
    try { await Effect.runPromise(initializer.initialize(inputRows).pipe(Effect.mapError(cause => new Error(
      "Price List comparison initialization: " + sourceKey + " [" + rows.map(entry => entry.table + ":" + entry.row.id).join(", ") + "]", { cause })))); }
    finally { await Effect.runPromise(initializer.close); }
    return input.logicalStorage;
  };
  const pricingStorage = await initialize("medusa.pricing", pricingDefinition, pricing.commands, seedRows);
  const linkStorage = await initialize("medusa.link.productVariantPriceSet", linkDefinition, link.commands, linkRows);
  const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
    prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition }) };
  const options: Options = { execution, modules: {
    pricing: { module: pricing.workflow, logicalStorage: pricingStorage }, link: { module: link.workflow, logicalStorage: linkStorage },
  }, revision, subscribers: [{ id: "native-price-list-create", revision }] };
  const resources = Result.getOrThrow(selectResources(options.modules));
  const contracts = Result.getOrThrow(compilePriceListCreationContracts((await Effect.runPromise(capturePricingMetadata())).frame));
  const caseHosts: Array<() => Promise<void>> = [];
  const own = <H extends { readonly close: Effect.Effect<void> }>(host: H) => { caseHosts.push(() => Effect.runPromise(host.close)); return host; };
  const closeCaseHosts = async () => { for (const dispose of caseHosts.splice(0).reverse()) await dispose(); };
  close(closeCaseHosts);
  const prepareInverse = async () => {
    const step = createStep("probe152-genuine-inverse", resources.callback(async (ids: typeof PriceListDeletionIds.Type, context) => {
      await retained.compensate(ids, context); return new StepResponse(null);
    }));
    const flow = createWorkflow("probe152-genuine-inverse-root", (ids: WorkflowData<typeof PriceListDeletionIds.Type>) => new WorkflowResponse(step(ids)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, workflow: { name: "probePriceListCreateInverse",
      resources, prepared: Result.getOrThrow(flow.prepare()), input: PriceListDeletionIds, output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  const prepareForward = async () => {
    const step = createStep("probe152-genuine-forward", resources.callback(async (input: typeof PriceListWorkflowInput.Type, context) => {
      const map = await retained.validate(input.price_lists_data, context);
      if (!(map instanceof StepResponse)) throw new Error("Missing genuine validation StepResponse");
      const result = await retained.invoke({ data: input.price_lists_data, variant_price_map: map.output }, context);
      if (!(result instanceof StepResponse)) throw new Error("Missing genuine creation StepResponse");
      return { output: result.output, compensation: result.compensateInput ?? [] };
    }));
    const flow = createWorkflow("probe152-genuine-forward-root", (input: WorkflowData<CreatePriceListsWorkflowInput>) => new WorkflowResponse(step(input)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, workflow: { name: "probePriceListCreateForward",
      resources, prepared: Result.getOrThrow(flow.prepare()), input: PriceListWorkflowInput,
      output: Schema.Struct({ output: contracts.Output, compensation: PriceListDeletionIds }), events: internalModuleWorkflowEvents } })));
  };
  const prepareWrapped = async (configuration: ParentOptions = {}): Promise<Host> => {
    const step = createStep("probe152-parent", resources.callback(async (created: unknown, context) => {
      configuration.inspect?.(context.resources);
      configuration.escape?.(() => context.resources.pricing.createPriceLists([]));
      if (configuration.caughtRefusal) { try { context.container.resolve("region"); } catch { /* Caller catches an authentic refusal. */ } }
      if (configuration.lateFailure) throw new Error("Late parent failure after genuine Price List creation");
      return created;
    }));
    const flow = createWorkflow("probe152-parent-root", (input: WorkflowData<CreatePriceListsWorkflowInput>) => {
      const created = createPriceListsWorkflow.runAsStep({ input });
      return new WorkflowResponse(step(transform({ created }, value => value.created)));
    });
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, workflow: { name: "probePriceListCreateParent",
      resources, prepared: Result.getOrThrow(flow.prepare()), input: PriceListWorkflowInput,
      output: contracts.Output, events: internalModuleWorkflowEvents } })));
  };
  const read = async (selected?: readonly string[]) => {
    const inventory = await logicalCurrencyInventory(fixture), output: JsonObject[] = [];
    const ids = selected === undefined ? undefined : new Set(selected);
    for (const row of inventory.rows) {
      if (row.scopeUuid !== projectScopeIdUuidV1(fixture.application.authority.scopeId).scopeUuid) continue;
      const version = inventory.revisions.find(item => item.scopeUuid === row.scopeUuid && item.tableId === row.tableId &&
        item.commitSeq === row.commitSeq && Buffer.from(item.rowId).equals(Buffer.from(row.rowId)));
      if (!version || version.isTombstone) continue;
      const decoded = await decodeCanonicalFlarexValueEvidenceV1({ canonicalBytes: version.valueBytes, sha256: version.valueSha256, profile: "appDocument" });
      const value = Schema.decodeUnknownSync(Schema.JsonObject)(decoded.valueJson);
      if (typeof value.id === "string" && (ids === undefined || ids.has(value.id))) output.push(projectNativeRow(value));
    }
    return output.sort((left, right) => String(left.id).localeCompare(String(right.id)));
  };
  const readStorageOrder = async (selected: readonly string[]) => {
    const inventory = await logicalCurrencyInventory(fixture), ids = new Set(selected);
    const order: Array<{ id: string; commit: bigint; ordinal: number }> = [];
    for (const row of inventory.rows) {
      if (row.scopeUuid !== projectScopeIdUuidV1(fixture.application.authority.scopeId).scopeUuid) continue;
      const version = inventory.revisions.find(item => item.scopeUuid === row.scopeUuid && item.tableId === row.tableId &&
        item.commitSeq === row.commitSeq && Buffer.from(item.rowId).equals(Buffer.from(row.rowId)));
      if (!version || version.isTombstone) continue;
      const decoded = await decodeCanonicalFlarexValueEvidenceV1({ canonicalBytes: version.valueBytes, sha256: version.valueSha256, profile: "appDocument" });
      const value = Schema.decodeUnknownSync(Schema.JsonObject)(decoded.valueJson);
      if (typeof value.id !== "string" || !ids.has(value.id)) continue;
      if (version.insertionCommitSeq === null || version.insertionAttemptOrdinal === null) throw new Error("Missing actual storage insertion provenance");
      order.push({ id: value.id, commit: version.insertionCommitSeq, ordinal: version.insertionAttemptOrdinal });
    }
    return order.sort((left, right) => left.commit < right.commit ? -1 : left.commit > right.commit ? 1 : left.ordinal - right.ordinal).map(item => item.id);
  };
  return { fixture, options, pricing, link, variantIds, setIds, historicalRootId, historicalIds, insertionRootIds, readStorageOrder,
    protectedIds: [...protectedIds, ...linkRows.map(item => Schema.decodeUnknownSync(Schema.String)(item.row.id))],
    prepare: async () => own(await Effect.runPromise(prepareCreatePriceListsWorkflow(options))), prepareForward, prepareInverse,
    prepareWrapped, read, snapshot: () => logicalCurrencyInventory(fixture), closeCaseHosts };
}
