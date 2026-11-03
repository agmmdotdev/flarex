import { randomUUID } from "node:crypto";
import { Cause, Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, transform, type WorkflowData } from "@medusajs/workflows-sdk";
import { createApiKeysWorkflow } from "@medusajs/core-flows/api-key/create-api-keys";
import { updateApiKeysWorkflow } from "@medusajs/core-flows/api-key/update-api-keys";
import { revokeApiKeysWorkflow } from "@medusajs/core-flows/api-key/revoke-api-keys";
import { compileCoreNativeEventStorageDefinition } from "../../../persistence-postgres/src/commit/events/coreDefinition";
import type { CorePersistenceFixture } from "../../../persistence-postgres/test/core/fixture";
import { compileApiKeyCoreDefinition } from "../../src/modules/api-key/schema";
import { makeApiKeyCreationCommands } from "../../src/modules/api-key/service";
import { makeApiKeyLifecycleCommands } from "../../src/modules/api-key/lifecycle-service";
import { ApiKeyUpdateInput, ApiKeyRevokeInput } from "../../src/modules/api-key/lifecycle-input";
import { ApiKeyCreationInput } from "../../src/modules/api-key/contracts";
import { prepareApiKeyCreationWorkflow } from "../../src/workflows/api-key/create";
import { prepareApiKeyUpdateWorkflow } from "../../src/workflows/api-key/update";
import { prepareApiKeyRevocationWorkflow } from "../../src/workflows/api-key/revoke";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { prepareWorkflowResources, type PreparedWorkflowResources } from "../../src/workflow/resources";
import { createCoreNativeWorkflowFixture, shareCoreNativeWorkflowPhysical, type CoreNativeWorkflowSource } from "./core-native-workflow-fixture";

export function apiKeyFailureMessages(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => Cause.isFailReason(reason) ? apiKeyFailureMessages(reason.error)
    : Cause.isDieReason(reason) ? apiKeyFailureMessages(reason.defect) : ["Interrupt"]);
  return value instanceof Error ? [value.name, value.message, ...apiKeyFailureMessages(value.cause)] : [];
}

export interface CoreApiKeyTarget { readonly scopeUuid: string; readonly epochUuid: string }
export interface CoreApiKeyFixtureConfiguration {
  readonly target?: CoreApiKeyTarget;
  readonly physical?: CorePersistenceFixture;
  readonly additionalSources?: readonly CoreNativeWorkflowSource[];
}

/** The actual native API Key owners run over one Core installation. Additional
 * sources are installation/setup inputs; each workflow selects its own grants. */
export async function prepareCoreApiKeys(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  configuration: CoreApiKeyFixtureConfiguration = {}) {
  const selectedTarget = configuration.target ?? { scopeUuid: randomUUID(), epochUuid: randomUUID() };
  const target = Object.freeze({ ...selectedTarget });
  const definition = await Effect.runPromise(compileApiKeyCoreDefinition(target));
  const eventDefinition = await Effect.runPromise(compileCoreNativeEventStorageDefinition(target));
  const apiKey = await Effect.runPromise(makeApiKeyCreationCommands());
  const lifecycle = await Effect.runPromise(makeApiKeyLifecycleCommands());
  const fixture = await createCoreNativeWorkflowFixture(driver, { eventDefinition, sources: [
    { name: "api_key", definition, initialCommands: apiKey.commands, rows: [] },
    ...configuration.additionalSources ?? [],
  ], ...(configuration.physical === undefined ? {} : { physical: await shareCoreNativeWorkflowPhysical(configuration.physical) }) });
  close(fixture.close);
  const source = fixture.source("api_key"), execution = fixture.execution;
  const modules = { api_key: { module: apiKey.workflow, nativeStorage: source } };
  const options: Parameters<typeof prepareApiKeyCreationWorkflow>[0] = {
    execution, modules, revision: "b".repeat(64), subscribers: [{ id: "native-api-keys", revision: "c".repeat(64) }],
  };
  const lifecycleOptions: Parameters<typeof prepareApiKeyUpdateWorkflow>[0] = {
    ...options, modules: { api_key: { module: lifecycle.workflow, nativeStorage: source } },
  };
  const prepareUpdate = async () => {
    const host = await Effect.runPromise(prepareApiKeyUpdateWorkflow(lifecycleOptions));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareRevoke = async () => {
    const host = await Effect.runPromise(prepareApiKeyRevocationWorkflow(lifecycleOptions));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareCreate = async (revision = options.revision) => {
    const host = await Effect.runPromise(prepareApiKeyCreationWorkflow({ ...options, revision }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const resources = Result.getOrThrow(prepareWorkflowResources({ api_key: { module: apiKey.workflow,
    methods: ["createApiKeys", "revertCreatedApiKeys"], graph: false } }, true));
  const prepareLateFailure = async () => {
    const flow = createWorkflow("probe-api-key-late-failure", (data: WorkflowData<typeof ApiKeyCreationInput.Type>) => {
      const created = createApiKeysWorkflow.runAsStep({ input: data });
      return new WorkflowResponse(transform(created, () => { throw new Error("Late parent failure after native API Key creation"); }));
    });
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution, modules, revision: options.revision, subscribers: options.subscribers,
      operationScheduling: "queued", borrowedOperationScheduling: "queued", workflow: { name: "probeApiKeyLateFailure", resources,
        prepared: Result.getOrThrow(flow.prepare()), input: ApiKeyCreationInput, output: Schema.Json, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const lifecycleResources = Result.getOrThrow(prepareWorkflowResources({ api_key: { module: lifecycle.workflow,
    methods: ["listApiKeys", "updateApiKeys", "upsertApiKeys", "revoke", "deleteApiKeys"], graph: false } }, true));
  const prepareRetained = async (operation: "creation" | "update", inverse: boolean) => {
    const native = (operation === "creation" ? Result.getOrThrow(createApiKeysWorkflow.prepare()) : Result.getOrThrow(updateApiKeysWorkflow.prepare()))
      .nodes.find(node => node.name === (operation === "creation" ? "create-api-keys" : "update-api-keys"));
    if (native?.kind !== "step" || native.compensate === undefined) throw new Error("Missing genuine API Key retained inverse");
    const invoke = native.invoke, compensate = native.compensate;
    const currentResources: PreparedWorkflowResources = operation === "creation" ? resources : lifecycleResources;
    const currentOptions = operation === "creation" ? options : lifecycleOptions;
    const name = `probeApiKeyRetained${operation}${inverse ? "Inverse" : "Forward"}`;
    const step = createStep(name, currentResources.callback(async (data: unknown, context) => {
      if (inverse) { await compensate(data, context); return new StepResponse(null); }
      const decoded = operation === "creation" ? Schema.decodeUnknownSync(ApiKeyCreationInput)(data) : Schema.decodeUnknownSync(ApiKeyUpdateInput)(data);
      const response = await invoke(decoded, context);
      if (!(response instanceof StepResponse)) throw new Error("Missing native API Key response");
      return new StepResponse({ output: response.output, retained: response.compensateInput });
    }));
    const flow = createWorkflow(name, (data: WorkflowData<unknown>) => new WorkflowResponse(step(data)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...currentOptions,
      operationScheduling: "queued", borrowedOperationScheduling: "queued", workflow: { name, resources: currentResources,
        prepared: Result.getOrThrow(flow.prepare()), input: Schema.Json, output: Schema.Json, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareLateRevokeFailure = async () => {
    const flow = createWorkflow("probe-api-key-revoke-late-failure", (data: WorkflowData<typeof ApiKeyRevokeInput.Type>) => {
      const revoked = revokeApiKeysWorkflow.runAsStep({ input: data });
      return new WorkflowResponse(transform(revoked, () => { throw new Error("Late parent failure after native API Key revocation"); }));
    });
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...lifecycleOptions,
      operationScheduling: "queued", borrowedOperationScheduling: "queued", workflow: { name: "probeApiKeyRevokeLateFailure", resources: lifecycleResources,
        prepared: Result.getOrThrow(flow.prepare()), input: ApiKeyRevokeInput, output: Schema.Json, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  return { fixture, target, definition, source, apiKey, lifecycle, options, lifecycleOptions, modules, execution,
    prepareCreate, prepareUpdate, prepareRevoke, prepareLateFailure, prepareLateRevokeFailure,
    prepareRetainedCreation: (inverse = false) => prepareRetained("creation", inverse),
    prepareRetainedUpdate: (inverse = false) => prepareRetained("update", inverse),
    read: () => fixture.readRows("api_key"), readRows: () => fixture.readRows(), snapshot: fixture.snapshot };
}
