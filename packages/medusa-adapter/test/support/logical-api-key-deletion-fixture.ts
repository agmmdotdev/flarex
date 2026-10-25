import { Effect, Result, Schema } from "effect";
import type { ILinkModule } from "@medusajs/types";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, transform, type WorkflowData } from "@medusajs/workflows-sdk";
import { deleteApiKeysWorkflow } from "@medusajs/core-flows/api-key/delete-api-keys";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { capturePrivateCanonicalValue } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeCommerceHost, type LogicalCommerceHostInput } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { compileApiKeySalesChannelLinkDefinition } from "../../src/links/api-key-sales-channel-schema";
import { prepareApiKeyDeletionLinks } from "../../src/links/api-key-deletion";
import { ApiKeyDeletionInput, prepareApiKeyDeletionWorkflow } from "../../src/workflows/api-key/delete";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { prepareLogicalApiKeys } from "./logical-api-key-fixture";
import { prepareLogicalSalesChannelHost } from "./logical-sales-channel-fixture";
import { prepareSalesChannelCreationWorkflow } from "../../src/workflows/sales-channel/create";
import type { LogicalCurrencyFixture } from "./logical-currency-fixture";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const Seed = Schema.Struct({ key: Id, channel: Id });
const decodeRows = Schema.decodeUnknownEffect(Schema.Array(Schema.JsonObject));

/** Compose existing native API Key, Sales Channel and rich Link owners. The
 * seed callback calls the genuine Link module; deletion uses its native router. */
export async function prepareLogicalApiKeyDeletion(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  shared?: Readonly<{ resource: LogicalCurrencyFixture["resource"];
    fixtureIdentity: Readonly<{ deploymentId: string; projectId: string; uuidOffset: number }> }>) {
  const definition = await Effect.runPromise(compileApiKeySalesChannelLinkDefinition());
  const source = await Effect.runPromise(captureLogicalSchemaSource({ key: "medusa.apiKeySalesChannel", owner: "medusa", writeProfile: "medusa.apiKeySalesChannel",
    evidence: definition.provenance, definition: { kind: "relational", schema: definition.schema },
    bindings: definition.schema.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
      table: { namespace: "medusa", logicalName: `${definition.schema.coordinate.lineageId}/${table.identity.tableId}` } })),
  }));
  const configuration = { includeSalesChannel: true, additionalSources: [source] } as const;
  const connected = await prepareLogicalApiKeys(driver, close, shared === undefined ? configuration : { ...configuration, ...shared });
  const sales = await prepareLogicalSalesChannelHost(connected.fixture);
  close(() => Effect.runPromise(sales.host.close));
  await Effect.runPromise(sales.host.initialize([]));
  const salesCreation = await Effect.runPromise(prepareSalesChannelCreationWorkflow({
    execution: connected.execution,
    modules: { sales_channel: { module: sales.runtime.workflow, logicalStorage: sales.hostInput.logicalStorage } },
    revision: connected.options.revision, subscribers: connected.options.subscribers,
  }));
  close(() => Effect.runPromise(salesCreation.close));
  const createChannel = (id: string) => Effect.runPromise(salesCreation.run(salesCreation.newRequestKey(),
    { salesChannelsData: [{ id, name: id }] }));
  const links = await Effect.runPromise(prepareApiKeyDeletionLinks());
  const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] }, 1_048_576,
    { invalidInput: () => new Error("Invalid empty API Key Link dataset"), hashFailure: cause => new Error("API Key Link dataset hash", { cause }) }));
  const linkInput = { ...connected.fixture.hostInput, commands: links.commands,
    logicalStorage: { ...connected.fixture.hostInput.logicalStorage,
      source: { sourceKey: source.key, writeProfile: source.writeProfile, schema: definition.schema, evidence: definition.provenance },
      initialization: { stepId: "api-key-sales-channel-empty", datasetSha256: dataset.sha256Hex, expectedRowCount: 0 } },
  } satisfies LogicalCommerceHostInput<unknown>;
  const reader = await Effect.runPromise(makeCommerceHost(linkInput));
  close(() => Effect.runPromise(reader.close));
  await Effect.runPromise(reader.initialize([]));
  const modules = { ...connected.lifecycleOptions.modules,
    api_key_sales_channel_links: { module: links.workflow, logicalStorage: linkInput.logicalStorage } };
  const options = { ...connected.lifecycleOptions, modules, link: links.resource };
  const prepareDelete = async () => {
    const host = await Effect.runPromise(prepareApiKeyDeletionWorkflow(options));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const resources = Result.getOrThrow(prepareWorkflowResources({
    api_key: { module: modules.api_key.module, methods: ["deleteApiKeys"], graph: false },
    api_key_sales_channel_links: { module: links.workflow, methods: ["softDelete"], graph: false, expose: false },
  }, true, { link: links.resource }));
  const prepareLateFailure = async () => {
    const flow = createWorkflow("probe-api-key-delete-late-failure", (data: WorkflowData<typeof ApiKeyDeletionInput.Type>) => {
      const deleted = deleteApiKeysWorkflow.runAsStep({ input: data });
      return new WorkflowResponse(transform(deleted, () => { throw new Error("Late parent failure after API Key and Link deletion"); }));
    });
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
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
  const seedHost = await Effect.runPromise(prepareAtomicWorkflowHost({ execution: connected.execution, modules: { api_key_sales_channel_links: modules.api_key_sales_channel_links },
    revision: options.revision, subscribers: options.subscribers, operationScheduling: "queued", borrowedOperationScheduling: "queued",
    executionIsolation: "scopeExclusive",
    workflow: { name: "seedApiKeySalesChannelLink", resources: seedResources, prepared: Result.getOrThrow(seedFlow.prepare()),
      input: Seed, output: Schema.Null, events: internalModuleWorkflowEvents } }));
  close(() => Effect.runPromise(seedHost.close));
  const attach = (key: string, channel: string) => Effect.runPromise(seedHost.run(seedHost.newRequestKey(), { key, channel }));
  const attachNewChannel = async (key: string, channel: string) => {
    await createChannel(channel);
    await attach(key, channel);
  };
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
  return { ...connected, links, options, sales, linkInput, prepareDelete, prepareLateDeleteFailure: prepareLateFailure, seed, attach, attachNewChannel, createChannel, readLinks };
}
