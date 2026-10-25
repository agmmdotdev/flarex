import { Cause, Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, transform, type WorkflowData } from "@medusajs/workflows-sdk";
import { createApiKeysWorkflow } from "@medusajs/core-flows/api-key/create-api-keys";
import { updateApiKeysWorkflow } from "@medusajs/core-flows/api-key/update-api-keys";
import { revokeApiKeysWorkflow } from "@medusajs/core-flows/api-key/revoke-api-keys";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { capturePrivateCanonicalValue, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeCommerceHost, type LogicalCommerceHostInput } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { decodeCanonicalFlarexValueEvidenceV1 } from "flarex-protocol/value";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { compileApiKeyDefinition } from "../../src/modules/api-key/schema";
import { makeApiKeyCreationCommands } from "../../src/modules/api-key/service";
import { makeApiKeyLifecycleCommands } from "../../src/modules/api-key/lifecycle-service";
import { ApiKeyUpdateInput, ApiKeyRevokeInput } from "../../src/modules/api-key/lifecycle-input";
import { ApiKeyCreationInput } from "../../src/modules/api-key/contracts";
import { prepareApiKeyCreationWorkflow } from "../../src/workflows/api-key/create";
import { prepareApiKeyUpdateWorkflow } from "../../src/workflows/api-key/update";
import { prepareApiKeyRevocationWorkflow } from "../../src/workflows/api-key/revoke";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution } from "../../src/workflow/host";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { prepareWorkflowResources, type PreparedWorkflowResources } from "../../src/workflow/resources";
import { projectNativeRow } from "../../src/repository/result";
import { logicalCurrencyFixture, type LogicalCurrencyFixture } from "./logical-currency-fixture";
import { logicalCurrencyInventory } from "./logical-currency-inventory";

export function apiKeyFailureMessages(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => Cause.isFailReason(reason) ? apiKeyFailureMessages(reason.error)
    : Cause.isDieReason(reason) ? apiKeyFailureMessages(reason.defect) : ["Interrupt"]);
  return value instanceof Error ? [value.name, value.message, ...apiKeyFailureMessages(value.cause)] : [];
}

type FixtureIdentity = NonNullable<NonNullable<Parameters<typeof logicalCurrencyFixture>[2]>["fixtureIdentity"]>;
export async function prepareLogicalApiKeys(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  configuration?: Readonly<{ additionalSources?: readonly Effect.Success<ReturnType<typeof captureLogicalSchemaSource>>[];
    includeSalesChannel?: true }> & (Readonly<{ resource?: never; fixtureIdentity?: FixtureIdentity }>
      | Readonly<{ resource: LogicalCurrencyFixture["resource"]; fixtureIdentity: FixtureIdentity }>)) {
  const definition = await Effect.runPromise(compileApiKeyDefinition());
  const source = await Effect.runPromise(captureLogicalSchemaSource({ key: "medusa.api-key", owner: "medusa", writeProfile: "medusa.api-key",
    evidence: definition.provenance, definition: { kind: "relational", schema: definition.schema },
    bindings: definition.schema.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
      table: { namespace: "medusa", logicalName: `${definition.schema.coordinate.lineageId}/${table.identity.tableId}` } })),
  }));
  const fixture = await logicalCurrencyFixture(driver, close, { ...configuration,
    additionalSources: [source, ...configuration?.additionalSources ?? []] });
  const apiKey = await Effect.runPromise(makeApiKeyCreationCommands());
  const lifecycle = await Effect.runPromise(makeApiKeyLifecycleCommands());
  const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] }, 1_048_576,
    { invalidInput: () => new Error("Invalid empty API Key dataset"), hashFailure: cause => new Error("API Key dataset hash", { cause }) }));
  const input = { ...fixture.hostInput, commands: apiKey.commands,
    logicalStorage: { ...fixture.hostInput.logicalStorage,
      source: { sourceKey: source.key, writeProfile: source.writeProfile, schema: definition.schema, evidence: definition.provenance },
      initialization: { stepId: "api-key-empty", datasetSha256: dataset.sha256Hex, expectedRowCount: 0 } },
  } satisfies LogicalCommerceHostInput<unknown>;
  const initializer = await Effect.runPromise(makeCommerceHost(input));
  try { await Effect.runPromise(initializer.initialize([])); } finally { await Effect.runPromise(initializer.close); }
  const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
    prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition }) };
  const modules = { api_key: { module: apiKey.workflow, logicalStorage: input.logicalStorage } };
  const options = { execution, modules, revision: "b".repeat(64), subscribers: [{ id: "native-api-keys", revision: "c".repeat(64) }] };
  const lifecycleOptions = { ...options, modules: { api_key: { module: lifecycle.workflow, logicalStorage: input.logicalStorage } } };
  const prepareUpdate = async () => {
    const host = await Effect.runPromise(prepareApiKeyUpdateWorkflow(lifecycleOptions));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareRevoke = async () => {
    const host = await Effect.runPromise(prepareApiKeyRevocationWorkflow(lifecycleOptions));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareCreate = async () => {
    const host = await Effect.runPromise(prepareApiKeyCreationWorkflow(options));
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
  const readRows = async () => {
    const inventory = await logicalCurrencyInventory(fixture), rows: JsonObject[] = [], scope = projectScopeIdUuidV1(fixture.application.authority.scopeId).scopeUuid;
    for (const current of inventory.rows) {
      if (current.scopeUuid !== scope) continue;
      const revision = inventory.revisions.find(row => row.scopeUuid === scope && row.tableId === current.tableId && row.commitSeq === current.commitSeq &&
        Buffer.from(row.rowId).equals(Buffer.from(current.rowId)));
      if (revision === undefined || revision.isTombstone) continue;
      const decoded = await decodeCanonicalFlarexValueEvidenceV1({ canonicalBytes: revision.valueBytes, sha256: revision.valueSha256, profile: "appDocument" });
      const row = Schema.decodeUnknownSync(Schema.JsonObject)(decoded.valueJson);
      rows.push(projectNativeRow(row));
    }
    return rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  };
  const read = async () => (await readRows()).filter(row => typeof row.id === "string" && row.id.startsWith("apk_"));
  return { fixture, apiKey, lifecycle, options, lifecycleOptions, modules, execution, prepareCreate, prepareUpdate, prepareRevoke,
    prepareLateFailure, prepareLateRevokeFailure,
    prepareRetainedCreation: (inverse = false) => prepareRetained("creation", inverse),
    prepareRetainedUpdate: (inverse = false) => prepareRetained("update", inverse),
    read, readRows, snapshot: () => logicalCurrencyInventory(fixture) };
}
