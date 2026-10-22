import { createHash } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import type { Logger } from "@medusajs/framework/types";
import { createStep, createWorkflow, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { getItemTaxLinesStep } from "@medusajs/core-flows/tax/get-item-tax-lines";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { makeCommerceHost, type LogicalCommerceHostInput } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { capturePrivateCanonicalValue } from "../../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { compileTaxDefinition } from "../../src/modules/tax/schema";
import { makeTaxLinesCommands } from "../../src/modules/tax/service";
import { ItemTaxLinesInput, ItemTaxLinesOutput, prepareItemTaxLinesWorkflow } from "../../src/workflows/tax/item-tax-lines";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { logicalCurrencyFixture, type LogicalCurrencyFixture } from "./logical-currency-fixture";
import { logicalCurrencyInventory } from "./logical-currency-inventory";

export type TaxInitialRow = Readonly<{ table: string; row: JsonObject }>;
const stamp = "2026-10-22T00:00:00.000Z", managed = { created_at: stamp, updated_at: stamp, deleted_at: null };
export const taxCountry = "txreg163-us", taxProvince = "txreg163-ca";
export const taxItem = { id: "li163-one", product_id: "prod163-one", product_type_id: "ptyp163-one", quantity: 2, unit_price: 13.25 };
export const taxShipping = { id: "sm163-one", shipping_option_id: "so163-one", amount: 7.5, name: "Native163 shipping" };
export const taxCart = { id: "cart163-input", currency_code: "usd", locale: "en-US", region: { automatic_taxes: true },
  shipping_address: { country_code: "us", province: "ca", address_1: "Native163", postal_code: "90001", metadata: { source: "cart" } },
  customer: { id: "cus163-supplied", email: "native163@example.invalid", groups: [{ id: "cg163-one" }], metadata: { supplied: true } },
  shipping_methods: [taxShipping] };
export function taxInput(overrides: Partial<typeof ItemTaxLinesInput.Type> = {}): typeof ItemTaxLinesInput.Type {
  return { orderOrCart: structuredClone(taxCart), items: [structuredClone(taxItem)], shipping_methods: [structuredClone(taxShipping)], ...overrides };
}
export function taxRegion(id = taxCountry, extra: JsonObject = {}): TaxInitialRow {
  return { table: "tax_region", row: { id, country_code: "us", province_code: null, parent_id: null, provider_id: "tp_system",
    metadata: null, created_by: null, ...managed, ...extra } };
}
export function taxRate(id = "txr163-country", extra: JsonObject = {}): TaxInitialRow {
  return { table: "tax_rate", row: { id, tax_region_id: taxCountry, rate: 10, code: "N163_COUNTRY", name: "Native163 country",
    is_default: true, is_combinable: false, metadata: null, created_by: null, ...managed, ...extra } };
}
export function taxRule(id: string, rate: string, reference: string, reference_id: string, extra: JsonObject = {}): TaxInitialRow {
  return { table: "tax_rate_rule", row: { id, tax_rate_id: rate, reference, reference_id, metadata: null, created_by: null, ...managed, ...extra } };
}
export function taxSeed(rates: readonly TaxInitialRow[] = [taxRate()], regions: readonly TaxInitialRow[] = [taxRegion()],
  rules: readonly TaxInitialRow[] = []): readonly TaxInitialRow[] {
  return [{ table: "tax_provider", row: { id: "tp_system", is_enabled: true, ...managed } }, ...regions, ...rates, ...rules];
}

/** The native supplement's complete graph. These are fixture rows, not a
 * reimplementation of native matching, priority or provider calculation. */
export function fullTaxGraph(layout: "mixed" | "items" | "shipping" = "mixed") {
  const kinds = ["default", "product", "type", "shipping"], rows: TaxInitialRow[] = [], rules: TaxInitialRow[] = [];
  for (const region of [0, 1]) {
    for (const [kind, name] of kinds.entries()) {
      const id = `txr163s-${region}-${kind}-${name}`;
      rows.push(taxRate(id, { tax_region_id: region === 0 ? taxCountry : taxProvince, rate: 1 + region * 10 + kind,
        code: `N163S_${region}_${name}`, name: `Native163s ${region} ${name}`, is_default: kind === 0, is_combinable: region === 1 }));
      for (const index of [0, 1]) {
        const reference = kind === 0 ? index === 0 ? "product" : "shipping_option"
          : layout === "items" ? "product" : layout === "shipping" ? "shipping_option"
          : kind === 1 ? "product" : kind === 2 ? "product_type" : "shipping_option";
        const referenceId = kind === 0 ? index === 0 ? "prod163s-unmatched" : "so163s-unmatched"
          : reference === "product" ? `prod163s-${index}` : reference === "product_type" ? `ptyp163s-${index}` : `so163s-${index}`;
        rules.push(taxRule(`txrule163s-${region}-${kind}-${index}`, id, reference, referenceId));
      }
    }
  }
  const shipping = Array.from({ length: 4 }, (_, index) => ({ id: `sm163s-${index}`,
    shipping_option_id: `so163s-${layout === "shipping" ? index % 2 : index}`, name: `Native163s shipping ${index}`, amount: index + 5.5 }));
  const input = taxInput({ orderOrCart: { ...structuredClone(taxCart), shipping_address: { ...taxCart.shipping_address, country_code: "US", province: "CA" },
    shipping_methods: shipping }, items: Array.from({ length: 4 }, (_, index) => ({ id: `li163s-${index}`,
      product_id: `prod163s-${layout === "items" ? index % 2 : index}`, product_type_id: `ptyp163s-${index % 2}`,
      quantity: index + 1, unit_price: index + 10.25 })), shipping_methods: shipping });
  return { input, rows: taxSeed(rows, [taxRegion(), taxRegion(taxProvince, { province_code: "ca", parent_id: taxCountry, provider_id: null })], rules) };
}

/** Initialize all four genuine Tax DML tables through the existing logical
 * owner. This test-only setup admits no Tax configuration workflow or CRUD. */
export async function prepareLogicalItemTaxLines(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  rows: readonly TaxInitialRow[] = taxSeed(),
  shared?: Readonly<{ resource: LogicalCurrencyFixture["resource"];
    fixtureIdentity: Readonly<{ deploymentId: string; projectId: string; uuidOffset: number }> }>) {
  const definition = await Effect.runPromise(compileTaxDefinition());
  const source = await Effect.runPromise(captureLogicalSchemaSource({ key: "medusa.tax", owner: "medusa", writeProfile: "medusa.tax",
    evidence: definition.provenance, definition: { kind: "relational", schema: definition.schema },
    bindings: definition.schema.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
      table: { namespace: "medusa", logicalName: `${definition.schema.coordinate.lineageId}/${table.identity.tableId}` } })) }));
  const configuration = { additionalSources: [source] };
  const fixture = await logicalCurrencyFixture(driver, close, shared === undefined ? configuration : { ...configuration, ...shared });
  const errors: Array<readonly [string | Error, Error | undefined]> = [];
  const logger: Logger = { panic() {}, shouldLog: () => false, setLogLevel() {}, unsetLogLevel() {}, activity: message => message,
    progress() {}, error: (message, error) => { errors.push([message, error]); }, failure() {}, success: () => ({}), silly() {}, debug() {},
    verbose() {}, http() {}, info() {}, warn() {}, log() {} };
  const tax = await Effect.runPromise(makeTaxLinesCommands(logger));
  const order = ["tax_provider", "tax_region", "tax_rate", "tax_rate_rule"], initial = order.flatMap(table => rows.filter(value => value.table === table));
  if (initial.length !== rows.length) throw new Error("Unknown Tax seed table");
  const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: initial },
    1_048_576, { invalidInput: () => new Error("Invalid Tax seed"), hashFailure: cause => new Error("Tax seed hash", { cause }) }));
  const input = { ...fixture.hostInput, commands: tax.commands, identityAndAccessPolicy: { profile: "logical-item-tax-lines-initialization" },
    logicalStorage: { ...fixture.hostInput.logicalStorage,
      source: { sourceKey: source.key, writeProfile: source.writeProfile, schema: definition.schema, evidence: definition.provenance },
      initialization: { stepId: "item-tax-lines-initial", datasetSha256: dataset.sha256Hex, expectedRowCount: initial.length } },
  } satisfies LogicalCommerceHostInput<unknown>;
  const initializer = await Effect.runPromise(makeCommerceHost(input));
  try { await Effect.runPromise(initializer.initialize(initial)); } finally { await Effect.runPromise(initializer.close); }
  const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
    prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition }) };
  const modules = { tax: { module: tax.workflow, logicalStorage: input.logicalStorage } };
  const options = { execution, modules, revision: createHash("sha256").update("native-item-tax-lines-163").digest("hex") };
  const prepare = async () => {
    const host = await Effect.runPromise(prepareItemTaxLinesWorkflow(options)); close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareLateFailure = async () => {
    const resources = Result.getOrThrow(prepareWorkflowResources({ tax: { module: tax.workflow, methods: ["getTaxLines"], graph: false } }, false));
    const fail = createStep("probe-tax-late-parent-failure", resources.callback(async (input: unknown) => {
      Schema.decodeUnknownSync(ItemTaxLinesOutput)(input);
      throw new Error("Late genuine Tax parent failure");
    }));
    const flow = createWorkflow("probe-native-item-tax-lines-late-parent", (value: WorkflowData<typeof ItemTaxLinesInput.Type>) => {
      // Runtime input is the same checked supplied-data subset as the admitted
      // root; native authoring DTOs additionally require unused persisted fields.
      const output = getItemTaxLinesStep(value as unknown as Parameters<typeof getItemTaxLinesStep>[0]);
      return new WorkflowResponse(fail(output));
    });
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options,
      operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeNativeItemTaxLinesLateParent", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: ItemTaxLinesInput, output: ItemTaxLinesOutput } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  return { fixture, definition, tax, errors, modules, options, execution, prepare, prepareLateFailure,
    snapshot: () => logicalCurrencyInventory(fixture) };
}
