import { createHash, randomUUID } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import type { Logger } from "@medusajs/framework/types";
import { createStep, createWorkflow, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { getItemTaxLinesStep } from "@medusajs/core-flows/tax/get-item-tax-lines";
import { compileCoreNativeEventStorageDefinition } from "../../../persistence-postgres/src/commit/events/coreDefinition";
import type { CorePersistenceFixture } from "../../../persistence-postgres/test/core/fixture";
import { compileTaxCoreDefinition } from "../../src/modules/tax/schema";
import { makeTaxLinesCommands } from "../../src/modules/tax/service";
import { ItemTaxLinesInput, ItemTaxLinesOutput, prepareItemTaxLinesWorkflow } from "../../src/workflows/tax/item-tax-lines";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { createCoreNativeWorkflowFixture, shareCoreNativeWorkflowPhysical } from "./core-native-workflow-fixture";
import { taxSeed, type TaxInitialRow } from "./tax-fixture-data";

export * from "./tax-fixture-data";

/** One genuine four-model source over shared Core persistence. Supplied Tax
 * calculation inputs grant no Cart, Order or Product table capability. */
export async function prepareCoreItemTaxLines(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  rows: readonly TaxInitialRow[] = taxSeed(), shared?: Readonly<{ physical: CorePersistenceFixture }>) {
  const target = Object.freeze({ scopeUuid: randomUUID(), epochUuid: randomUUID() });
  const definition = await Effect.runPromise(compileTaxCoreDefinition(target));
  const eventDefinition = await Effect.runPromise(compileCoreNativeEventStorageDefinition(target));
  const errors: Array<readonly [string | Error, Error | undefined]> = [];
  const logger: Logger = { panic() {}, shouldLog: () => false, setLogLevel() {}, unsetLogLevel() {}, activity: message => message,
    progress() {}, error: (message, error) => { errors.push([message, error]); }, failure() {}, success: () => ({}), silly() {}, debug() {},
    verbose() {}, http() {}, info() {}, warn() {}, log() {} };
  const tax = await Effect.runPromise(makeTaxLinesCommands(logger));
  const order = ["tax_provider", "tax_region", "tax_rate", "tax_rate_rule"], initial = order.flatMap(table => rows.filter(value => value.table === table));
  if (initial.length !== rows.length) throw new Error("Unknown Tax seed table");
  const physical = shared === undefined ? undefined : await shareCoreNativeWorkflowPhysical(shared.physical);
  const fixture = await createCoreNativeWorkflowFixture(driver, { sources: [{ name: "tax", definition,
    initialCommands: tax.commands, rows: initial }], eventDefinition, ...(physical === undefined ? {} : { physical }) });
  close(fixture.close);
  const execution = fixture.execution;
  const modules = { tax: { module: tax.workflow, nativeStorage: fixture.source("tax") } };
  const options = { execution, modules, revision: createHash("sha256").update("native-item-tax-lines-163").digest("hex") };
  const prepare = async () => {
    const host = await fixture.run(prepareItemTaxLinesWorkflow(options)); close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareLateFailure = async () => {
    const resources = Result.getOrThrow(prepareWorkflowResources({ tax: { module: tax.workflow, methods: ["getTaxLines"], graph: false } }, false));
    const fail = createStep("probe-tax-late-parent-failure", resources.callback(async (input: unknown) => {
      Schema.decodeUnknownSync(ItemTaxLinesOutput)(input);
      throw new Error("Late genuine Tax parent failure");
    }));
    const flow = createWorkflow("probe-native-item-tax-lines-late-parent", (value: WorkflowData<typeof ItemTaxLinesInput.Type>) => {
      const output = getItemTaxLinesStep(value as unknown as Parameters<typeof getItemTaxLinesStep>[0]);
      return new WorkflowResponse(fail(output));
    });
    const host = await fixture.run(prepareAtomicWorkflowHost({ ...options,
      operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeNativeItemTaxLinesLateParent", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: ItemTaxLinesInput, output: ItemTaxLinesOutput } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  return { fixture, definition, tax, errors, modules, options, execution, prepare, prepareLateFailure,
    snapshot: fixture.snapshot, read: (ids?: readonly string[]) => fixture.readRows("tax", ids) };
}
