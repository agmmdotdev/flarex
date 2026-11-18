import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, transform, type WorkflowData } from "@medusajs/workflows-sdk";
import { linkSalesChannelsToApiKeyWorkflow } from "@medusajs/core-flows/api-key/link-sales-channels-to-publishable-key";
import type { Link } from "@medusajs/modules-sdk/link";
import { LinkOperationRequestSchema, LinkOperationHandleSchema } from "@medusajs/link-modules";
import { LINKS } from "@medusajs/framework/utils/portable";
import { prepareApiKeyAssociationLinks } from "../../src/links/api-key-associations";
import { prepareSalesChannelApiKeyRead } from "../../src/modules/sales-channel/api-key-read";
import { ApiKeyAssociationInput, prepareApiKeyAssociationWorkflow } from "../../src/workflows/api-key/associate-sales-channels";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { apiKeyAssociationResources } from "../../src/workflow/policy";
import { prepareCoreApiKeyDeletion } from "./core-api-key-deletion-fixture";

/** Reuse actual native callbacks and durable Link operation owners. The
 * association business root grants Sales + rich Link, with no Key read. */
export async function prepareCoreApiKeyAssociations(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  shared?: Parameters<typeof prepareCoreApiKeyDeletion>[2]) {
  const connected = await prepareCoreApiKeyDeletion(driver, close, shared);
  const salesRead = await Effect.runPromise(prepareSalesChannelApiKeyRead());
  const links = await Effect.runPromise(prepareApiKeyAssociationLinks());
  const modules = {
    sales_channel: { module: salesRead.workflow, nativeStorage: connected.sales.source },
    api_key_sales_channel_links: { module: links.workflow, nativeStorage: connected.linkSource },
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
  const prepareDefaultAssociation = async () => {
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution: connected.execution, modules,
      revision: options.revision, subscribers: options.subscribers, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeApiKeyAssociationDefaultBudget", resources, prepared: Result.getOrThrow(linkSalesChannelsToApiKeyWorkflow.prepare()),
        input: ApiKeyAssociationInput, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareLateAssociationFailure = async () => {
    const flow = createWorkflow("probe-api-key-association-late-failure", (data: WorkflowData<typeof ApiKeyAssociationInput.Type>) => {
      const nativeInput = transform(data, input => ({ id: input.id,
        ...(input.add === undefined ? {} : { add: [...input.add] }), ...(input.remove === undefined ? {} : { remove: [...input.remove] }) }));
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
  // Private trusted protocol probe. Production API Key workflow still derives
  // its operation ID from the real prepared SDK invocation identity.
  const prepareProtocol = async (inverse = false) => {
    const protocolResources = Result.getOrThrow(prepareWorkflowResources({
      api_key_sales_channel_links: { module: links.workflow,
        methods: ["applyOperation", "compensateOperation"], graph: false, expose: false },
    }, true, { link: links.resource }));
    const name = inverse ? "probeApiKeyProtocolCompensate" : "probeApiKeyProtocolApply";
    const step = createStep(name, protocolResources.callback(async (data: unknown, { container }) => {
      const link = container.resolve<Pick<Link, "applyOperation" | "compensateOperation">>("link");
      return new StepResponse(inverse
        ? await link.compensateOperation(Schema.decodeUnknownSync(LinkOperationHandleSchema)(data))
        : await link.applyOperation(LINKS.PublishableApiKeySalesChannel, Schema.decodeUnknownSync(LinkOperationRequestSchema)(data)));
    }));
    const flow = createWorkflow(name, (data: WorkflowData<unknown>) => new WorkflowResponse(step(data)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution: connected.execution,
      modules: { api_key_sales_channel_links: modules.api_key_sales_channel_links }, revision: options.revision,
      subscribers: options.subscribers, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      requestCallLimit: apiKeyAssociationResources.calls,
      workflow: { name, resources: protocolResources, prepared: Result.getOrThrow(flow.prepare()),
        input: Schema.Json, output: Schema.Json, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  return { ...connected, associationLinks: links, associationOptions: options, prepareAssociate,
    prepareLateAssociationFailure, prepareRetainedAssociation, prepareDefaultAssociation, prepareProtocol };
}
