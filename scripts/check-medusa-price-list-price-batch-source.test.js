// @ts-check
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { priceListPriceBatchSourcePair, verifyPriceListPriceBatchCallbacks, verifyPriceListPriceBatchSelection, verifyPriceListPriceBatchService } from "./check-medusa-price-list-prices-source.mjs";
import { verifyCurrencyPromotion } from "./check-medusa-currency-promotion.mjs";

const read = (/** @type {string} */ file) => readFileSync(file, "utf8");
const original = read(priceListPriceBatchSourcePair.source);
const target = read(priceListPriceBatchSourcePair.target);

describe("native PriceList Price batch parent provenance", () => {
  it("admits only portable package aliases in the complete original parent", () => {
    expect(() => verifyPriceListPriceBatchCallbacks(original, target)).not.toThrow();
  });
  it("ignores comments and whitespace without erasing typed or emitted authority", () => {
    expect(() => verifyPriceListPriceBatchCallbacks(original, "/* formatting only */\n" + target + "\n")).not.toThrow();
  });
  it.each([
    ["workflow identity", 'batchPriceListPricesWorkflowId = "batch-price-list-prices"', 'batchPriceListPricesWorkflowId = "other-batch"'],
    ["typed public input", "data: BatchPriceListPricesWorkflowDTO", "data: unknown"],
    ["typed DSL input", "WorkflowData<BatchPriceListPricesWorkflowInput>", "WorkflowData<unknown>"],
    ["typed public result", "WorkflowResponse<BatchPriceListPricesWorkflowResult>", "WorkflowResponse<unknown>"],
    ["native input type owner", 'from "@medusajs/types"', 'from "@medusajs/other-types"'],
    ["native workflow owner", 'from "@medusajs/workflows-sdk"', 'from "@medusajs/other-workflows-sdk"'],
    ["creation child owner", 'from "./create-price-list-prices"', 'from "./update-price-list-prices"'],
    ["update child owner", 'from "./update-price-list-prices"', 'from "./create-price-list-prices"'],
    ["removal child owner", 'from "./remove-price-list-prices"', 'from "./delete-price-lists"'],
    ["native creation transform", "createInput = transform({ input: input.data }", "createInput = transform({ input: {} }"],
    ["native update transform", "updateInput = transform({ input: input.data }", "updateInput = transform({ input: {} }"],
    ["creation List identity", "{ id: data.input.id, prices: data.input.create }", "{ id: 'another-list', prices: data.input.create }"],
    ["update List identity", "{ id: data.input.id, prices: data.input.update }", "{ id: 'another-list', prices: data.input.update }"],
    ["creation payload", "prices: data.input.create", "prices: data.input.update"],
    ["update payload", "prices: data.input.update", "prices: data.input.create"],
    ["unmodified empty creation", "prices: data.input.create", "prices: data.input.create ?? []"],
    ["unmodified empty update", "prices: data.input.update", "prices: data.input.update ?? []"],
    ["native parallel region", "const [created, updated, deleted] = parallelize(", "const [created, updated, deleted] = Array.of("],
    ["named child slots", "const [created, updated, deleted]", "const [updated, created, deleted]"],
    ["creation native child frame", "createPriceListPricesWorkflow.runAsStep({", "createPriceListPricesWorkflow.run({"],
    ["update native child frame", "updatePriceListPricesWorkflow.runAsStep({", "updatePriceListPricesWorkflow.run({"],
    ["removal native child frame", "removePriceListPricesWorkflow.runAsStep({", "removePriceListPricesWorkflow.run({"],
    ["creation child input", "data: createInput", "data: updateInput"],
    ["update child input", "data: updateInput", "data: createInput"],
    ["raw removal selector", "ids: input.data.delete", "ids: [input.data.id]"],
    ["unmodified removal selector", "ids: input.data.delete", "ids: input.data.delete ?? []"],
    ["result slot values", "transform({ created, updated, deleted }, (data) => data)", "transform({ created, updated, deleted }, (data) => ({ ...data, deleted: [] }))"],
    ["result slot positions", "transform({ created, updated, deleted }, (data) => data)", "transform({ created: updated, updated: created, deleted }, (data) => data)"],
  ])("rejects changed %s", (_label, before, after) => {
    const changed = target.replace(before, after);
    expect(changed).not.toBe(target);
    expect(() => verifyPriceListPriceBatchCallbacks(original, changed))
      .toThrow("Changed native PriceList Price batch callback behavior");
  });
  it("rejects extra top-level execution", () => {
    expect(() => verifyPriceListPriceBatchCallbacks(original, target + "\nthrow new Error('extra');"))
      .toThrow("Changed native PriceList Price batch callback behavior");
  });
  // The whole-promotion proof owns the immutable pair and source authentication.
  // These controls require its158 pair rule as well as the new manifest entry.
  it.each([
    { mutation: { classification: "authored" }, expectedMessage: "PriceList Price batch outside its exact pinned source pair" },
    { mutation: { source: "third_party/medusa/upstream/packages/core/core-flows/src/price-list/workflows/create-price-list-prices.ts" },
      expectedMessage: "PriceList Price creation outside its exact pinned source pair" },
    { mutation: { target: "packages/medusa-core-flows/src/price-list/workflows/unrelated-batch.ts" },
      expectedMessage: "PriceList Price batch outside its exact pinned source pair" },
  ])("binds source, target and classification against $mutation", ({ mutation, expectedMessage }) => {
    /** @type {ReturnType<typeof verifyCurrencyPromotion>} */
    const promotion = JSON.parse(read("roadmaps/flarexdb-framework-integration/preflight/medusa-currency-promotion.json"));
    const changed = structuredClone(promotion), entry = changed.files.find(file => file.target === priceListPriceBatchSourcePair.target);
    if (!entry) throw new Error("Missing batch provenance");
    const before = structuredClone(entry);
    Object.assign(entry, mutation);
    expect(entry).not.toEqual(before);
    expect(() => verifyCurrencyPromotion(process.cwd(), changed))
      .toThrow(expectedMessage);
  }, 15_000);
});

describe("private PriceList Price batch original-command composition", () => {
  const service = read("packages/medusa-adapter/src/modules/pricing/price-list-price-batch-service.ts");
  it("preserves fixed child profiles, their authentic method tokens and original validators", () => {
    expect(() => verifyPriceListPriceBatchService(service)).not.toThrow();
  });
  it.each([
    ["creation profile", 'makeLocalPricingCommands("price-list-price-creations")', 'makeLocalPricingCommands("price-list-price-updates")'],
    ["update profile", 'makeLocalPricingCommands("price-list-price-updates")', 'makeLocalPricingCommands("price-list-price-creations")'],
    ["removal profile", 'makeLocalPricingCommands("price-list-price-removals")', 'makeLocalPricingCommands("price-list-deletions")'],
    ["original profile owner", 'from "./service"', 'from "./other-service"'],
    ["authentic method owner", 'from "../../workflow/module"', 'from "../../workflow/other-module"'],
    ["creation logical policy", "workflowModuleDefinition(creation.workflow)?.logical", "workflowModuleDefinition(update.workflow)?.logical"],
    ["update logical policy", "workflowModuleDefinition(update.workflow)?.logical", "workflowModuleDefinition(creation.workflow)?.logical"],
    ["removal logical policy", "workflowModuleDefinition(removal.workflow)?.logical", "workflowModuleDefinition(update.workflow)?.logical"],
    ["missing-policy refusal", "creationPolicy === undefined || updatePolicy === undefined || removalPolicy === undefined", "false"],
    ["aggregate hook refusal", "creationPolicy.validateLogical !== undefined || updatePolicy.validateLogical !== undefined || removalPolicy.validateLogical !== undefined", "false"],
    ["creation List validator token", "{ listPriceLists, addPriceListPrices, removePrices } = creation.workflow.methods", "{ listPrices: listPriceLists, addPriceListPrices, removePrices } = creation.workflow.methods"],
    ["creation write token", "{ listPriceLists, addPriceListPrices, removePrices } = creation.workflow.methods", "{ listPriceLists, updatePriceListPrices: addPriceListPrices, removePrices } = creation.workflow.methods"],
    ["creation inverse token", "{ listPriceLists, addPriceListPrices, removePrices } = creation.workflow.methods", "{ listPriceLists, addPriceListPrices, softDeletePrices: removePrices } = creation.workflow.methods"],
    ["update snapshot token", "{ snapshotPriceListPricesForUpdate, updatePriceListPrices, restorePriceListPrices } = update.workflow.methods", "{ listPriceLists: snapshotPriceListPricesForUpdate, updatePriceListPrices, restorePriceListPrices } = update.workflow.methods"],
    ["update write token", "{ snapshotPriceListPricesForUpdate, updatePriceListPrices, restorePriceListPrices } = update.workflow.methods", "{ snapshotPriceListPricesForUpdate, addPriceListPrices: updatePriceListPrices, restorePriceListPrices } = update.workflow.methods"],
    ["update recorded inverse token", "{ snapshotPriceListPricesForUpdate, updatePriceListPrices, restorePriceListPrices } = update.workflow.methods", "{ snapshotPriceListPricesForUpdate, updatePriceListPrices, restorePrices: restorePriceListPrices } = update.workflow.methods"],
    ["removal read token", "{ listPrices, softDeletePrices, restorePrices } = removal.workflow.methods", "{ listPriceLists: listPrices, softDeletePrices, restorePrices } = removal.workflow.methods"],
    ["removal write token", "{ listPrices, softDeletePrices, restorePrices } = removal.workflow.methods", "{ listPrices, removePrices: softDeletePrices, restorePrices } = removal.workflow.methods"],
    ["removal current-graph inverse token", "{ listPrices, softDeletePrices, restorePrices } = removal.workflow.methods", "{ listPrices, softDeletePrices, restorePriceListPrices: restorePrices } = removal.workflow.methods"],
    ["original creation token owner", "{ listPriceLists, addPriceListPrices, removePrices } = creation.workflow.methods", "{ listPriceLists, addPriceListPrices, removePrices } = update.workflow.methods"],
    ["original update token owner", "{ snapshotPriceListPricesForUpdate, updatePriceListPrices, restorePriceListPrices } = update.workflow.methods", "{ snapshotPriceListPricesForUpdate, updatePriceListPrices, restorePriceListPrices } = creation.workflow.methods"],
    ["original removal token owner", "{ listPrices, softDeletePrices, restorePrices } = removal.workflow.methods", "{ listPrices, softDeletePrices, restorePrices } = update.workflow.methods"],
    ["missing creation token refusal", "listPriceLists === undefined || addPriceListPrices === undefined || removePrices === undefined", "false"],
    ["missing update token refusal", "snapshotPriceListPricesForUpdate === undefined || updatePriceListPrices === undefined || restorePriceListPrices === undefined", "false"],
    ["missing removal token refusal", "listPrices === undefined || softDeletePrices === undefined || restorePrices === undefined", "false"],
    ["original creation policy", "methods: [listPriceLists, addPriceListPrices, removePrices], policy: creationPolicy", "methods: [listPriceLists, addPriceListPrices, removePrices], policy: updatePolicy"],
    ["original update policy", "methods: [snapshotPriceListPricesForUpdate, updatePriceListPrices, restorePriceListPrices], policy: updatePolicy", "methods: [snapshotPriceListPricesForUpdate, updatePriceListPrices, restorePriceListPrices], policy: creationPolicy"],
    ["original removal policy", "methods: [listPrices, softDeletePrices, restorePrices], policy: removalPolicy", "methods: [listPrices, softDeletePrices, restorePrices], policy: creationPolicy"],
    ["typed command-object routing", "Map<CommerceCommand, LogicalCommerceCallValidation>", "Map<string, LogicalCommerceCallValidation>"],
    ["authentic method definition", "workflowMethodDefinition(method)", "method"],
    ["original policy command membership", "!group.policy.commands.includes(definition.command)", "false"],
    ["unique command ownership", "owners.has(definition.command)", "false"],
    ["original method installation", "const methods = { listPriceLists,", "const methods = { listPriceLists: addPriceListPrices,"],
    ["closed method installation", "const methods = { listPriceLists,", "const methods = { deletePriceLists: removePrices, listPriceLists,"],
    ["original command installation", "commands.push(definition.command)", "commands.push({ ...definition.command })"],
    ["original validator installation", "owners.set(definition.command, group.policy.validateLogicalCall)", "owners.set(definition.command, creationPolicy.validateLogicalCall)"],
    ["object routing key", "owners.get(command)", "owners.get(call.commandName)"],
    ["no name-based fallback", "const validate = owners.get(command)", "const validate = owners.get(command) ?? creationPolicy.validateLogicalCall"],
    ["unknown issuer refusal", "if (validate === undefined)", "if (false)"],
    ["original issuer forwarding", "yield* validate(call, activity, command)", "yield* validate(call, activity, { ...command })"],
    ["complete activity forwarding", "yield* validate(call, activity, command)", "yield* validate(call, { ...activity, mutations: [] }, command)"],
    ["trusted source identity", 'source: { name: "flarex-pricing-local", profile:', 'source: { name: "other-pricing", profile:'],
    ["combined profile identity", 'profile: "pricing-price-list-price-batch"', 'profile: "pricing-price-list-price-creations"'],
    ["no module graph", "graph: { aliases: [], reads: [] }", "graph: creation.graph"],
    ["original event capture", "capture: creationPolicy.capture", "capture: removalPolicy.capture"],
    ["original update insertion permission", "allowStorageInsertionOrder: true", "allowStorageInsertionOrder: false"],
    ["original update replay permission", "allowRecordedRowReplay: true", "allowRecordedRowReplay: false"],
    ["original update clock permission", 'allowPreservingDeletionUpsert: "preserveTimestamps"', 'allowPreservingDeletionUpsert: "replaceTimestamps"'],
    ["no active-restore expansion", "allowRecordedRowReplay: true,", "allowRecordedRowReplay: true, allowActiveRestoreUpdate: true,"],
    ["no nested host lifetime", "return { workflow, commands }", "return prepareAtomicWorkflowHost({ workflow, commands })"],
  ])("rejects changed %s", (_label, before, after) => {
    const changed = service.replace(before, after);
    expect(changed).not.toBe(service);
    expect(() => verifyPriceListPriceBatchService(changed)).toThrow("Changed PriceList Price batch service selection");
  });
  it("rejects extra service execution", () => {
    expect(() => verifyPriceListPriceBatchService(service + "\nthrow new Error('extra');"))
      .toThrow("Changed PriceList Price batch service selection");
  });
});

describe("private PriceList Price batch authority selection", () => {
  const sources = {
    facade: read("packages/medusa-adapter/src/workflows/pricing/batch-price-list-prices.ts"),
    policy: read("packages/medusa-adapter/src/workflow/policy.ts"),
  };
  it("admits only the combined Pricing facade, read-only Link Query and approved limit of 256 calls", () => {
    expect(() => verifyPriceListPriceBatchSelection(sources.facade, sources.policy)).not.toThrow();
  });
  it.each([
    ["facade", "trusted Pricing source", 'pricing?.source.name !== "flarex-pricing-local"', 'pricing?.source.name !== "other-pricing"'],
    ["facade", "combined Pricing profile", 'pricing.source.profile !== "pricing-price-list-price-batch"', 'pricing.source.profile !== "pricing-price-list-price-creations"'],
    ["facade", "genuine stored Link Query", 'link?.source.profile !== "medusa.variant-pricing.link-workflow"', 'link?.source.profile !== "other-link"'],
    ["facade", "selected participants", '["pricing", "link"]))', '["pricing", "link", "product"]))'],
    ["facade", "extra registration refusal", "Object.keys(registrations).length !== 2", "false"],
    ["facade", "unsupported options", '!["execution", "modules", "revision", "subscribers"].includes(key)', "false"],
    ["facade", "participant resource equality", "!jsonEqual(binding.logicalResources, priceListPriceBatchResources)", "false"],
    ["facade", "both resource bindings", "for (const binding of [installed.pricing, installed.link])", "for (const binding of [installed.pricing])"],
    ["facade", "Pricing publication", 'logicalPublication: "mixed"', 'logicalPublication: "readOnly"'],
    ["facade", "creation physical inverse", '"addPriceListPrices", "removePrices"', '"addPriceListPrices", "deletePriceLists"'],
    ["facade", "update recorded inverse", '"snapshotPriceListPricesForUpdate", "updatePriceListPrices", "restorePriceListPrices"', '"snapshotPriceListPricesForUpdate", "updatePriceListPrices", "restorePrices"'],
    ["facade", "removal current-graph inverse", '"listPrices", "softDeletePrices", "restorePrices"', '"listPrices", "softDeletePrices", "restorePriceListPrices"'],
    ["facade", "Pricing graph refusal", "graph: false", "graph: true"],
    ["facade", "Link mutation refusal", "methods: [], graph: true, expose: false", 'methods: ["create"], graph: true, expose: false'],
    ["facade", "Link service exposure", "methods: [], graph: true, expose: false", "methods: [], graph: true, expose: true"],
    ["facade", "Link Query", "methods: [], graph: true, expose: false", "methods: [], graph: false, expose: false"],
    ["facade", "native parent", "batchPriceListPricesWorkflow.prepare()", "createPriceListPricesWorkflow.prepare()"],
    ["facade", "queued root operations", 'operationScheduling: "queued"', 'operationScheduling: "parallel"'],
    ["facade", "queued borrowed operations", 'borrowedOperationScheduling: "queued"', 'borrowedOperationScheduling: "parallel"'],
    ["facade", "named calls", "requestCallLimit: priceListPriceBatchResources.calls", "requestCallLimit: 128"],
    ["facade", "parent input contract", "input: PriceListPriceBatchWorkflowInput", "input: PriceListPriceUpdateWorkflowInput"],
    ["facade", "complete child result contract", "output: contracts.Output", "output: Schema.Unknown"],
    ["facade", "module event capture", "events: internalModuleWorkflowEvents", "events: undefined"],
    ["facade", "typed authority", "readonly revision: string", "readonly revision: unknown"],
    ["facade", "policy owner", 'from "../../workflow/policy"', 'from "../../workflow/other-policy"'],
    ["facade", "composition service owner", 'from "../../modules/pricing/price-list-price-batch-service"', 'from "../../modules/pricing/service"'],
    ["policy", "default owner", 'from "@flarex/persistence-postgres/internal/commerce-values"', 'from "./commerce-values"'],
    ["policy", "default64calls", "priceListPriceBatchResources = Object.freeze({ ...defaultCommerceResources, calls: 256 })", "priceListPriceBatchResources = Object.freeze({ ...defaultCommerceResources })"],
    ["policy", "explicit64calls", "priceListPriceBatchResources = Object.freeze({ ...defaultCommerceResources, calls: 256 })", "priceListPriceBatchResources = Object.freeze({ ...defaultCommerceResources, calls: 64 })"],
    ["policy", "inherited128calls", "priceListPriceBatchResources = Object.freeze({ ...defaultCommerceResources, calls: 256 })", "priceListPriceBatchResources = Object.freeze({ ...defaultCommerceResources, calls: 128 })"],
    ["policy", "expanded512calls", "priceListPriceBatchResources = Object.freeze({ ...defaultCommerceResources, calls: 256 })", "priceListPriceBatchResources = Object.freeze({ ...defaultCommerceResources, calls: 512 })"],
    ["policy", "unknown events property", "priceListPriceBatchResources = Object.freeze({ ...defaultCommerceResources, calls: 256 })", "priceListPriceBatchResources = Object.freeze({ ...defaultCommerceResources, calls: 256, events: 128 })"],
    ["policy", "expanded eventMessages", "priceListPriceBatchResources = Object.freeze({ ...defaultCommerceResources, calls: 256 })", "priceListPriceBatchResources = Object.freeze({ ...defaultCommerceResources, calls: 256, eventMessages: 128 })"],
    ["policy", "creation allowance alias", "priceListPriceBatchResources = Object.freeze({ ...defaultCommerceResources, calls: 256 })", "priceListPriceBatchResources = priceListPriceCreationResources"],
    ["policy", "mutable declaration", "export const priceListPriceBatchResources", "export let priceListPriceBatchResources"],
  ])("rejects %s changed %s", (key, _label, before, after) => {
    const field = /** @type {keyof typeof sources} */ (key);
    const changed = sources[field].replace(before, after);
    expect(changed).not.toBe(sources[field]);
    const mutation = { ...sources, [field]: changed };
    expect(() => verifyPriceListPriceBatchSelection(mutation.facade, mutation.policy))
      .toThrow("Changed PriceList Price batch resource selection");
  });
  it("rejects extra host execution", () => {
    expect(() => verifyPriceListPriceBatchSelection(sources.facade + "\nthrow new Error('extra');", sources.policy))
      .toThrow("Changed PriceList Price batch resource selection");
  });
});
