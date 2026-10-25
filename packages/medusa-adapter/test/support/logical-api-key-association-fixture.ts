import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, transform, type WorkflowData } from "@medusajs/workflows-sdk";
import { linkSalesChannelsToApiKeyWorkflow } from "@medusajs/core-flows/api-key/link-sales-channels-to-publishable-key";
import { prepareApiKeyAssociationLinks } from "../../src/links/api-key-associations";
import { prepareSalesChannelApiKeyRead } from "../../src/modules/sales-channel/api-key-read";
import { ApiKeyAssociationInput, prepareApiKeyAssociationWorkflow } from "../../src/workflows/api-key/associate-sales-channels";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { apiKeyAssociationResources } from "../../src/workflow/policy";
import { prepareLogicalApiKeyDeletion } from "./logical-api-key-deletion-fixture";

/** Reuse the connected native source fixture. Only genuine native workflow
 * callbacks and modules implement association or its retained inverse. */
export async function prepareLogicalApiKeyAssociations(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  shared?: Parameters<typeof prepareLogicalApiKeyDeletion>[2]) {
  const connected = await prepareLogicalApiKeyDeletion(driver, close, shared);
  const salesRead = await Effect.runPromise(prepareSalesChannelApiKeyRead());
  const links = await Effect.runPromise(prepareApiKeyAssociationLinks());
  const modules = {
    sales_channel: { module: salesRead.workflow, logicalStorage: connected.sales.hostInput.logicalStorage },
    api_key_sales_channel_links: { module: links.workflow, logicalStorage: connected.linkInput.logicalStorage },
  };
  const options = { execution: connected.execution, modules, revision: connected.options.revision,
    subscribers: connected.options.subscribers, link: links.resource };
  const prepareAssociate = async () => {
    const host = await Effect.runPromise(prepareApiKeyAssociationWorkflow(options));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const resources = Result.getOrThrow(prepareWorkflowResources({
    sales_channel: { module: modules.sales_channel.module, methods: ["listSalesChannels"], graph: false },
    api_key_sales_channel_links: { module: modules.api_key_sales_channel_links.module,
      methods: ["applyOperation", "compensateOperation"], graph: false, expose: false },
  }, true, { link: links.resource }));
  // This genuine native root preserves the default-budget refusal separately
  // from the fixed named allowance; callers cannot override the public facade.
  const prepareDefaultAssociation = async () => {
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution: connected.execution, modules,
      revision: options.revision, subscribers: options.subscribers, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeApiKeyAssociationDefaultBudget", resources,
        prepared: Result.getOrThrow(linkSalesChannelsToApiKeyWorkflow.prepare()),
        input: ApiKeyAssociationInput, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareLateAssociationFailure = async () => {
    const flow = createWorkflow("probe-api-key-association-late-failure", (data: WorkflowData<typeof ApiKeyAssociationInput.Type>) => {
      const nativeInput = transform(data, input => ({
        id: input.id,
        ...(input.add === undefined ? {} : { add: [...input.add] }),
        ...(input.remove === undefined ? {} : { remove: [...input.remove] }),
      }));
      const result = linkSalesChannelsToApiKeyWorkflow.runAsStep({ input: nativeInput });
      return new WorkflowResponse(transform(result, () => { throw new Error("Late parent failure after API Key association"); }));
    });
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution: connected.execution, modules,
      revision: options.revision, subscribers: options.subscribers, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      requestCallLimit: apiKeyAssociationResources.calls,
      workflow: { name: "probeApiKeyAssociationLateFailure", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: ApiKeyAssociationInput, output: Schema.Json, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareRetainedAssociation = async (inverse = false) => {
    const node = Result.getOrThrow(linkSalesChannelsToApiKeyWorkflow.prepare()).nodes.find(node => node.name === "link-sales-channels-to-api-key");
    if (node?.kind !== "step" || node.compensate === undefined) throw new Error("Missing genuine native Link callbacks");
    const invoke = node.invoke, compensate = node.compensate;
    const name = inverse ? "probeApiKeyAssociationInverse" : "probeApiKeyAssociationForward";
    const step = createStep(name, resources.callback(async (data: unknown, context) => {
      if (inverse) { await compensate(data, context); return new StepResponse(null); }
      const response = await invoke(Schema.decodeUnknownSync(ApiKeyAssociationInput)(data), context);
      if (!(response instanceof StepResponse)) throw new Error("Missing genuine native Link retained response");
      return new StepResponse(response.compensateInput);
    }));
    const flow = createWorkflow(name, (data: WorkflowData<unknown>) => new WorkflowResponse(step(data)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution: connected.execution, modules,
      revision: options.revision, subscribers: options.subscribers, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      requestCallLimit: apiKeyAssociationResources.calls,
      workflow: { name, resources, prepared: Result.getOrThrow(flow.prepare()), input: Schema.Json, output: Schema.Json,
        events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  return { ...connected, associationLinks: links, associationOptions: options, prepareAssociate,
    prepareLateAssociationFailure, prepareRetainedAssociation, prepareDefaultAssociation };
}
