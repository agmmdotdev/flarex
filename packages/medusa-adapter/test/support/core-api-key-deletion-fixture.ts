import { randomUUID } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import type { ILinkModule } from "@medusajs/types";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, transform, type WorkflowData } from "@medusajs/workflows-sdk";
import { deleteApiKeysWorkflow } from "@medusajs/core-flows/api-key/delete-api-keys";
import { compileApiKeySalesChannelLinkCoreDefinition } from "../../src/links/api-key-sales-channel-schema";
import { prepareApiKeyDeletionLinks } from "../../src/links/api-key-deletion";
import { compileSalesChannelCoreDefinition } from "../../src/modules/sales-channel/schema";
import { makeLocalSalesChannelCommands } from "../../src/modules/sales-channel/service";
import { ApiKeyDeletionInput, prepareApiKeyDeletionWorkflow } from "../../src/workflows/api-key/delete";
import { prepareSalesChannelCreationWorkflow } from "../../src/workflows/sales-channel/create";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { apiKeyDeletionResources } from "../../src/workflow/policy";
import { prepareCoreApiKeys } from "./core-api-key-fixture";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const Seed = Schema.Struct({ key: Id, channel: Id });
const decodeRows = Schema.decodeUnknownEffect(Schema.Array(Schema.JsonObject));

/** One real Core installation contains the setup union. Each business workflow
 * selects its own exact participants; deletion grants no Sales API. */
export async function prepareCoreApiKeyDeletion(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  shared: Pick<NonNullable<Parameters<typeof prepareCoreApiKeys>[2]>, "physical"> = {}) {
  const target = Object.freeze({ scopeUuid: randomUUID(), epochUuid: randomUUID() });
  const links = await Effect.runPromise(prepareApiKeyDeletionLinks());
  const definition = await Effect.runPromise(compileApiKeySalesChannelLinkCoreDefinition(target));
  const salesRuntime = await Effect.runPromise(makeLocalSalesChannelCommands());
  const salesDefinition = await Effect.runPromise(compileSalesChannelCoreDefinition(target));
  const connected = await prepareCoreApiKeys(driver, close, { ...shared, target, additionalSources: [
    { name: "sales_channel", definition: salesDefinition, initialCommands: salesRuntime.commands, rows: [] },
    { name: "api_key_sales_channel_links", definition, initialCommands: links.commands, rows: [] },
  ] });
  const salesSource = connected.fixture.source("sales_channel"), linkSource = connected.fixture.source("api_key_sales_channel_links");
  const salesCreation = await Effect.runPromise(prepareSalesChannelCreationWorkflow({
    execution: connected.execution, modules: { sales_channel: { module: salesRuntime.workflow, nativeStorage: salesSource } },
    revision: connected.options.revision, subscribers: connected.options.subscribers,
  }));
  close(() => Effect.runPromise(salesCreation.close));
  const createChannel = (id: string) => Effect.runPromise(salesCreation.run(salesCreation.newRequestKey(),
    { salesChannelsData: [{ id, name: id }] }));
  const reader = await connected.fixture.run(connected.fixture.openReadHost("api_key_sales_channel_links", [links.nativeService.list]));
  close(() => Effect.runPromise(reader.close));
  const modules = { ...connected.lifecycleOptions.modules,
    api_key_sales_channel_links: { module: links.workflow, nativeStorage: linkSource } };
  const options = { ...connected.lifecycleOptions, modules, link: links.resource };
  const prepareDelete = async () => {
    const host = await Effect.runPromise(prepareApiKeyDeletionWorkflow(options));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const resources = Result.getOrThrow(prepareWorkflowResources({
    api_key: { module: modules.api_key.module, methods: ["deleteApiKeys"], graph: false },
    api_key_sales_channel_links: { module: links.workflow, methods: ["softDelete"], graph: false, expose: false },
  }, true, { link: links.resource }));
  const prepareDefaultDeletion = async () => {
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options,
      operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "deleteApiKeysWorkflow", resources, prepared: Result.getOrThrow(deleteApiKeysWorkflow.prepare()),
        input: ApiKeyDeletionInput, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareLateDeleteFailure = async () => {
    const flow = createWorkflow("probe-api-key-delete-late-failure", (data: WorkflowData<typeof ApiKeyDeletionInput.Type>) => {
      const deleted = deleteApiKeysWorkflow.runAsStep({ input: data });
      return new WorkflowResponse(transform(deleted, () => { throw new Error("Late parent failure after API Key and Link deletion"); }));
    });
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      requestCallLimit: apiKeyDeletionResources.calls,
      workflow: { name: "probeApiKeyDeleteLateFailure", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: ApiKeyDeletionInput, output: Schema.Json, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const seedResources = Result.getOrThrow(prepareWorkflowResources({
    api_key_sales_channel_links: { module: links.workflow, methods: ["create"], graph: false },
  }, true));
  const seedStep = createStep("seed-api-key-sales-channel-link", async (data: typeof Seed.Type, { container }) => {
    await container.resolve<Pick<ILinkModule, "create">>("api_key_sales_channel_links").create([[data.key, data.channel]]);
    return new StepResponse(null);
  });
  const seedFlow = createWorkflow("seed-api-key-sales-channel-link", (data: WorkflowData<typeof Seed.Type>) => new WorkflowResponse(seedStep(data)));
  const seedHost = await Effect.runPromise(prepareAtomicWorkflowHost({ execution: connected.execution,
    modules: { api_key_sales_channel_links: modules.api_key_sales_channel_links }, revision: options.revision,
    subscribers: options.subscribers, operationScheduling: "queued", borrowedOperationScheduling: "queued", executionIsolation: "scopeExclusive",
    workflow: { name: "seedApiKeySalesChannelLink", resources: seedResources, prepared: Result.getOrThrow(seedFlow.prepare()),
      input: Seed, output: Schema.Null, events: internalModuleWorkflowEvents } }));
  close(() => Effect.runPromise(seedHost.close));
  const attach = (key: string, channel: string) => Effect.runPromise(seedHost.run(seedHost.newRequestKey(), { key, channel }));
  const attachNewChannel = async (key: string, channel: string) => { await createChannel(channel); await attach(key, channel); };
  const seed = async (title: string, revoked = true) => {
    const create = await connected.prepareCreate();
    const rows = await Effect.runPromise(create.run(create.newRequestKey(), { api_keys: [{ type: "publishable", title, created_by: "owner" }] }).pipe(Effect.flatMap(decodeRows)));
    const id = Schema.decodeUnknownSync(Id)(rows[0]?.id), channel = "api-key-channel-" + id;
    await attachNewChannel(id, channel);
    if (revoked) {
      const revoke = await connected.prepareRevoke();
      await Effect.runPromise(revoke.run(revoke.newRequestKey(), { selector: { id }, revoke: { revoked_by: "owner" } }));
    }
    return { id, channel };
  };
  const readLinks = (ids: readonly string[]) => Effect.runPromise(reader.read(links.nativeService.list,
    { filters: { publishable_key_id: [...ids] }, config: { withDeleted: true, take: 8 } }).pipe(Effect.flatMap(decodeRows)));
  return { ...connected, links, options, sales: { runtime: salesRuntime, definition: salesDefinition, source: salesSource },
    linkSource, prepareDelete, prepareDefaultDeletion, prepareLateDeleteFailure, seed, attach, attachNewChannel, createChannel, readLinks };
}
