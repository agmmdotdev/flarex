import { Effect, Result, Schema } from "effect";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { capturePrivateCanonicalValue, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeCommerceHost } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { decodeCanonicalFlarexValueEvidenceV1 } from "flarex-protocol/value";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { workflowModuleDefinition, type WorkflowModule } from "../../src/workflow/module";
import { captureInstalledWorkflowModules, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "../../src/workflow/host";
import { prepareCreateCartWorkflow, type CartCreationHooks } from "../../src/workflows/cart/create-cart";
import { cartCreationModuleNames } from "../../src/workflows/cart/creation-graph";
import { projectNativeRow } from "../../src/repository/result";
import type { LogicalCallReceiptValidation } from "../../src/repository/call-receipt";
import { cartCreationDefinitions, cartCreationRuntimes } from "./cart-creation-runtimes";
import { logicalCurrencyFixture } from "./logical-currency-fixture";
import { logicalCurrencyInventory } from "./logical-currency-inventory";

export async function prepareLogicalCartCreateRoot(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  options: { readonly seeds?: Readonly<Record<string, readonly JsonObject[]>>; readonly hooks?: CartCreationHooks;
    readonly onPhase?: (phase: string) => void } = {}) {
  options.onPhase?.("constructing genuine module runtimes");
  const runtime = await cartCreationRuntimes();
  options.onPhase?.("genuine module runtimes ready");
  const definitions = await cartCreationDefinitions();
  options.onPhase?.("all native schema definitions compiled");
  const sources: Array<Effect.Success<ReturnType<typeof captureLogicalSchemaSource>>> = [];
  for (const { name, definition } of definitions) {
    options.onPhase?.("capturing source " + name);
    sources.push(await Effect.runPromise(captureLogicalSchemaSource({
    key: "medusa.cart-create-root." + name, owner: "medusa", writeProfile: "medusa.cart-create-root." + name, evidence: definition.provenance,
    definition: { kind: "relational", schema: definition.schema }, bindings: definition.schema.tables.map(table => ({ kind: "definition",
      localName: table.identity.tableId, table: { namespace: "medusa", logicalName: definition.schema.coordinate.lineageId + "/" + table.identity.tableId } })),
  })));
  }
  options.onPhase?.("all genuine sources captured");
  const fixture = await logicalCurrencyFixture(driver, close, { additionalSources: sources });
  options.onPhase?.("complete eighteen-source catalog ready");
  options.onPhase?.("catalog preparation timings: " + JSON.stringify(fixture.preparationTiming));
  if (driver === "postgres") {
    const role = await fixture.persistence.query("select rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls from pg_roles where rolname=current_user");
    const active = role.rows[0];
    if (role.rows.length !== 1 || active === undefined || Object.values(active).some(value => value !== false)) throw new Error("Cart creation requires an ordinary PostgreSQL role");
  }
  const seeds: Readonly<Record<string, readonly JsonObject[]>> = {
    region: [{ table: "region", row: { id: "reg-create-root", name: "Native Cart Region", currency_code: "usd" } },
      { table: "region_country", row: { iso_2: "us", iso_3: "usa", num_code: "840", name: "UNITED STATES", display_name: "United States", region_id: "reg-create-root" } }],
    store: [{ table: "store", row: { id: "store-create-root", name: "Native Cart Store", default_region_id: "reg-create-root", default_sales_channel_id: "sc-create-root" } }],
    sales_channel: [{ id: "sc-create-root", name: "Native Cart Channel", is_disabled: false }],
  };
  if ((options.seeds?.cart?.length ?? 0) > 0) throw new Error("Cart root fixture must not preseed Cart business rows");
  const workflows: Readonly<Record<string, WorkflowModule>> = runtime.workflows, entries: Array<[string, InstalledWorkflowModule]> = [];
  for (const [index, selected] of definitions.entries()) {
    const source = sources[index], module = workflows[selected.name], logical = module === undefined ? undefined : workflowModuleDefinition(module)?.logical;
    if (source === undefined || logical === undefined || module === undefined) throw new Error("Missing genuine Cart creation source");
    const rows = [...seeds[selected.name] ?? [], ...options.seeds?.[selected.name] ?? []];
    const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows }, 1_048_576,
      { invalidInput: () => new Error("Invalid Cart root setup dataset"), hashFailure: cause => new Error("Cart root setup hash", { cause }) }));
    const logicalStorage = { ...fixture.hostInput.logicalStorage, source: { sourceKey: source.key, writeProfile: source.writeProfile,
      schema: selected.definition.schema, evidence: selected.definition.provenance },
      initialization: { stepId: "cart-root-setup-" + index, datasetSha256: dataset.sha256Hex, expectedRowCount: rows.length } };
    const initializer = await Effect.runPromise(makeCommerceHost({ ...fixture.hostInput, logicalStorage, commands: logical.commands,
      identityAndAccessPolicy: { profile: "cart-root-setup" } }));
    try { await Effect.runPromise(initializer.initialize(rows)); } finally { await Effect.runPromise(initializer.close); }
    options.onPhase?.("initialized " + selected.name);
    entries.push([selected.name, { module, logicalStorage }]);
  }
  const modules = Result.getOrThrow(captureInstalledWorkflowModules(Object.fromEntries(entries), cartCreationModuleNames));
  const traces: Array<{ call: Parameters<LogicalCallReceiptValidation>[0]; activity: Parameters<LogicalCallReceiptValidation>[1] }> = [];
  const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
    prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition,
      participants: composition.participants.map(registration => ({ ...registration, validateLogicalCall: (call, activity, command) => Effect.gen(function* () {
        traces.push({ call, activity });
        if (registration.validateLogicalCall !== undefined) yield* registration.validateLogicalCall(call, activity, command);
      }) })) }) };
  const configuration = { execution, modules, salesChannelRead: runtime.salesChannelRead, link: runtime.link, logger: runtime.logger,
    revision: "1".repeat(64), subscribers: [{ id: "native-cart-create-root", revision: "2".repeat(64) }] };
  const host = await Effect.runPromise(prepareCreateCartWorkflow({ ...configuration, ...(options.hooks === undefined ? {} : { hooks: options.hooks }) }));
  close(() => Effect.runPromise(host.close));
  const snapshot = () => logicalCurrencyInventory(fixture);
  const rows = async () => {
    const inventory = await snapshot(), output: JsonObject[] = [], scope = projectScopeIdUuidV1(fixture.application.authority.scopeId).scopeUuid;
    for (const row of inventory.rows) if (row.scopeUuid === scope) {
      const version = inventory.revisions.find(value => value.scopeUuid === row.scopeUuid && value.tableId === row.tableId &&
        value.commitSeq === row.commitSeq && Buffer.from(value.rowId).equals(Buffer.from(row.rowId)));
      if (version === undefined || version.isTombstone) continue;
      const decoded = await decodeCanonicalFlarexValueEvidenceV1({ canonicalBytes: version.valueBytes, sha256: version.valueSha256, profile: "appDocument" });
      output.push(projectNativeRow(Schema.decodeUnknownSync(Schema.JsonObject)(decoded.valueJson)));
    }
    return output;
  };
  return { fixture, runtime, modules, configuration, host, snapshot, rows, traces };
}
