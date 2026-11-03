import { randomUUID } from "node:crypto";
import { Effect, Result } from "effect";
import { compileCoreNativeEventStorageDefinition } from "../../../persistence-postgres/src/commit/events/coreDefinition";
import type { LogicalCallReceiptValidation } from "../../src/repository/call-receipt";
import { captureInstalledWorkflowModules, type AtomicWorkflowExecution } from "../../src/workflow/host";
import { workflowModuleDefinition } from "../../src/workflow/module";
import { cartCreationModuleNames } from "../../src/workflows/cart/creation-graph";
import { prepareCreateCartWorkflow, type CartCreationHooks } from "../../src/workflows/cart/create-cart";
import { cartCreationCoreDefinitions, cartCreationRuntimes } from "./cart-creation-runtimes";
import { createCoreNativeWorkflowFixture, type CoreNativeWorkflowSource } from "./core-native-workflow-fixture";
import { orderFixtureHosts } from "./core-order-fixture";

const defaults: Readonly<Record<string, CoreNativeWorkflowSource["rows"]>> = {
  region: [{ table: "region", row: { id: "reg-create-root", name: "Native Cart Region", currency_code: "usd" } },
    { table: "region_country", row: { iso_2: "us", iso_3: "usa", num_code: "840", name: "UNITED STATES", display_name: "United States", region_id: "reg-create-root" } }],
  store: [{ table: "store", row: { id: "store-create-root", name: "Native Cart Store", default_region_id: "reg-create-root", default_sales_channel_id: "sc-create-root" } }],
  sales_channel: [{ table: "sales_channel", row: { id: "sc-create-root", name: "Native Cart Channel", is_disabled: false } }],
};

export async function prepareCoreCartCreateRoot(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  options: { readonly seeds?: Readonly<Record<string, CoreNativeWorkflowSource["rows"]>>; readonly hooks?: CartCreationHooks;
    readonly onPhase?: (phase: string) => void } = {}) {
  if ((options.seeds?.cart?.length ?? 0) > 0) throw new Error("Cart root fixture must not preseed Cart business rows");
  options.onPhase?.("constructing genuine module runtimes");
  const runtime = await cartCreationRuntimes();
  options.onPhase?.("genuine module runtimes ready");
  const target = { scopeUuid: randomUUID(), epochUuid: randomUUID() };
  const [definitions, eventDefinition] = await Effect.runPromise(Effect.all([
    cartCreationCoreDefinitions(target), compileCoreNativeEventStorageDefinition(target),
  ]));
  options.onPhase?.("all native Core schema definitions compiled");
  const sources = cartCreationModuleNames.map(name => {
    const logical = workflowModuleDefinition(runtime.workflows[name])?.logical;
    if (logical === undefined) throw new Error("Missing genuine Cart creation source " + name);
    return { name, definition: definitions[name], initialCommands: logical.commands,
      rows: [...defaults[name] ?? [], ...options.seeds?.[name] ?? []] };
  });
  const fixture = await createCoreNativeWorkflowFixture(driver, { sources, eventDefinition });
  close(fixture.close);
  options.onPhase?.("complete eighteen-source Core catalog ready");
  const { own } = orderFixtureHosts(close);
  const modules = Result.getOrThrow(captureInstalledWorkflowModules(Object.fromEntries(cartCreationModuleNames.map(name =>
    [name, { module: runtime.workflows[name], nativeStorage: fixture.source(name) }])), cartCreationModuleNames));
  const traces: Array<{ call: Parameters<LogicalCallReceiptValidation>[0]; activity: Parameters<LogicalCallReceiptValidation>[1] }> = [];
  const execution: AtomicWorkflowExecution = { ...fixture.execution,
    prepare: composition => fixture.execution.prepare({ ...composition,
      participants: composition.participants.map(registration => {
        const validate = registration.validateLogicalCall;
        return validate === undefined ? registration : { ...registration,
          validateLogicalCall: (call, activity, command) => validate(call, activity, command).pipe(
            Effect.tap(() => Effect.sync(() => { traces.push({ call, activity }); }))),
        };
      }),
    }),
  };
  const configuration = { execution, modules, salesChannelRead: runtime.salesChannelRead, link: runtime.link, logger: runtime.logger,
    revision: "1".repeat(64), subscribers: [{ id: "native-cart-create-root", revision: "2".repeat(64) }] };
  const host = own(await Effect.runPromise(prepareCreateCartWorkflow({ ...configuration,
    ...(options.hooks === undefined ? {} : { hooks: options.hooks }) })));
  return { fixture, runtime, modules, configuration, host, snapshot: fixture.snapshot, rows: fixture.readRows, traces };
}
