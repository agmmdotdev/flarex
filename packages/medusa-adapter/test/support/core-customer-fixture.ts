import { createHash, randomUUID } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, transform, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { findOrCreateCustomerStep } from "@medusajs/core-flows/cart/find-or-create-customer";
import { compileCoreNativeEventStorageDefinition } from "../../../persistence-postgres/src/commit/events/coreDefinition";
import type { CorePersistenceFixture } from "../../../persistence-postgres/test/core/fixture";
import { compileCustomerCoreDefinition } from "../../src/modules/customer/schema";
import { makeCustomerSelectionCommands } from "../../src/modules/customer/service";
import { prepareCustomerSelectionWorkflow, CustomerSelectionInput } from "../../src/workflows/cart/customer-selection";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { createCoreNativeWorkflowFixture, shareCoreNativeWorkflowPhysical, type CoreNativeWorkflowSource } from "./core-native-workflow-fixture";
import { customerSelectionInitial, type CustomerInitialRow } from "./customer-rows";

export async function prepareCoreCustomerFixture(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  rows: readonly CustomerInitialRow[], initialCommands: CoreNativeWorkflowSource["initialCommands"], physical?: CorePersistenceFixture) {
  const target = Object.freeze({ scopeUuid: randomUUID(), epochUuid: randomUUID() });
  const [definition, eventDefinition] = await Effect.runPromise(Effect.all([
    compileCustomerCoreDefinition(target),
    compileCoreNativeEventStorageDefinition(target),
  ]));
  const order = ["customer", "customer_group", "customer_address", "customer_group_customer"];
  const initial = order.flatMap(table => rows.filter(value => value.table === table));
  if (initial.length !== rows.length) throw new Error("Unknown Customer seed table");
  const fixture = await createCoreNativeWorkflowFixture(driver, {
    eventDefinition, sources: [{ name: "customer", definition, initialCommands, rows: initial }],
    ...(physical === undefined ? {} : { physical: await shareCoreNativeWorkflowPhysical(physical) }),
  });
  close(fixture.close);
  return fixture;
}

const native = createWorkflow("probe-customer-native-selection", (input: WorkflowData<typeof CustomerSelectionInput.Type>) =>
  new WorkflowResponse(findOrCreateCustomerStep(input)));
const retained = Result.getOrThrow(native.prepare()).nodes.find(node => node.name === "find-or-create-customer");
if (retained?.kind !== "step" || retained.compensation !== "transactionCovered" || retained.compensate === undefined)
  throw new Error("Missing genuine Customer selection retained inverse");
const compensate = retained.compensate;

export async function prepareCoreCustomerSelection(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  rows: readonly CustomerInitialRow[] = customerSelectionInitial, physical?: CorePersistenceFixture) {
  const customer = await Effect.runPromise(makeCustomerSelectionCommands());
  const fixture = await prepareCoreCustomerFixture(driver, close, rows, customer.commands, physical);
  const source = fixture.sources[0]?.definition.tables.find(table => table.localName === "customer");
  if (source === undefined) throw new Error("Missing admitted Customer table");
  const modules = { customer: { module: customer.workflow, nativeStorage: fixture.source("customer") } };
  const options = { execution: fixture.execution, modules, revision: createHash("sha256").update("native-customer-selection-162").digest("hex"),
    subscribers: [{ id: "native-customer-selection", revision: "d".repeat(64) }] };
  const prepare = async () => {
    const host = await Effect.runPromise(prepareCustomerSelectionWorkflow(options));
    close(() => Effect.runPromise(host.close));
    return host;
  };
  const resources = Result.getOrThrow(prepareWorkflowResources({ customer: { module: customer.workflow,
    methods: ["retrieveCustomer", "listCustomers", "createCustomers", "deleteCustomers"], graph: false } }, true, undefined, { absent: ["caching"] }));
  const prepareRoundtrip = async (actualRetained: () => unknown, lateFailure = false) => {
    const undo = createStep("probe-native-customer-retained-inverse", resources.callback(async (_input: null, context) => {
      await compensate(actualRetained(), context);
      if (lateFailure) throw new Error("Late genuine Customer retained inverse failure"); return new StepResponse(null);
    }));
    const flow = createWorkflow("probe-native-customer-selection-roundtrip", (value: WorkflowData<typeof CustomerSelectionInput.Type>) => {
      const output = findOrCreateCustomerStep(value), inverse = undo(transform(output, () => null));
      return new WorkflowResponse(transform({ output, inverse }, ({ output }) => output));
    });
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options,
      operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeNativeCustomerSelectionRoundtrip", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: CustomerSelectionInput, output: Schema.Json, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close));
    return host;
  };
  const prepareInverse = async (lateFailure = false) => {
    const undo = createStep("probe-native-customer-physical-inverse", resources.callback(async (id: string, context) => {
      // A separately labelled physical closure probe, not evidence that this
      // seeded generation was created by an earlier workflow invocation.
      await compensate({ customer: { id }, customerWasCreated: true }, context);
      if (lateFailure) throw new Error("Late genuine Customer physical inverse failure"); return new StepResponse(null);
    }));
    const flow = createWorkflow("probe-native-customer-physical-inverse", (id: WorkflowData<string>) => new WorkflowResponse(undo(id)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options,
      operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeNativeCustomerPhysicalInverse", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: Schema.String, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close));
    return host;
  };
  return { fixture, customerTable: source.name, prepare, prepareRoundtrip, prepareInverse,
    read: (ids: readonly string[]) => fixture.readRows("customer", ids), snapshot: fixture.snapshot };
}
