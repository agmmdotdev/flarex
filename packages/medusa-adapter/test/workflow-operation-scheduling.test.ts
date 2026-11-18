import { expect, it, vi } from "vitest";
import { Effect, Result, Schema } from "effect";
import { createWorkflow, WorkflowResponse } from "@medusajs/workflows-sdk";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineGraphReadCommand } from "../src/local-graph/commands";
import { commerceDecoder } from "../src/value/decoder";
import { defineWorkflowMethod, defineWorkflowModule } from "../src/workflow/module";
import { prepareWorkflowResources } from "../src/workflow/resources";
import { prepareAtomicWorkflowHost, prepareWorkflowComposition, type AtomicWorkflowHostComposition, type InstalledWorkflowModule } from "../src/workflow/host";

function fixture() {
  const command = defineGraphReadCommand("scheduling-read", () => Effect.succeed([[], 0]));
  const method = Result.getOrThrow(defineWorkflowMethod({ command, arguments: commerceDecoder(Schema.Tuple([]), "invalidInput"),
    encode: () => null, output: commerceDecoder(Schema.Json, "storedCorruption") }));
  const module = Result.getOrThrow(defineWorkflowModule({ name: "sample", source: {
    name: "sample-scheduling", profile: "sample",
  }, methods: { read: method }, graph: { aliases: [{ name: "sample", model: "Sample" }], reads: [{
    command, model: "Sample", table: { name: "sample", columns: ["id"], primaryKeys: ["id"], foreignKeys: [], companions: {} },
    paths: [], orderable: ["id"], uniqueOrder: ["id"], multipleOrder: false,
    decode: commerceDecoder(Schema.Tuple([Schema.Array(Schema.JsonObject), Schema.Number]), "storedCorruption"),
  }] } }));
  const resources = Result.getOrThrow(prepareWorkflowResources({ sample: { module, methods: ["read"], graph: false } }, false));
  const flow = createWorkflow("scheduling-policy", () => new WorkflowResponse(null));
  const modules: Record<string, InstalledWorkflowModule> = {};
  // This pure composition unit never authenticates storage or runs a command.
  // The real core host separately owns storage authority and its I/O boundary.
  Object.defineProperty(modules, "sample", { enumerable: true, value: { module, logicalStorage: {} } });
  return { identityAndAccessPolicy: {}, modules, revision: "a".repeat(64), workflow: {
    name: "scheduling", resources, prepared: Result.getOrThrow(flow.prepare()), input: Schema.Json, output: Schema.Json,
  } };
}

it("forwards queued scheduling while omitted and own undefined retain identical workflow identities", async () => {
  const base = fixture();
  const plain = await Effect.runPromise(prepareWorkflowComposition(base));
  const ownUndefined = await Effect.runPromise(prepareWorkflowComposition(Object.defineProperty({ ...base }, "operationScheduling",
    { value: undefined, enumerable: true })));
  const queued = await Effect.runPromise(prepareWorkflowComposition({ ...base, operationScheduling: "queued" }));
  expect(plain.composition).not.toHaveProperty("operationScheduling");
  expect(ownUndefined.composition.identityAndAccessPolicy).toEqual(plain.composition.identityAndAccessPolicy);
  expect(queued.composition.operationScheduling).toBe("queued");
  expect(queued.composition).not.toHaveProperty("executionIsolation");
  expect(queued.composition.identityAndAccessPolicy).not.toEqual(plain.composition.identityAndAccessPolicy);
  const prepare = vi.fn((_composition: AtomicWorkflowHostComposition) => Effect.fail(commerceError("invalidAuthority")));
  expect(await Effect.runPromise(Effect.result(prepareAtomicWorkflowHost({ execution: { identityAndAccessPolicy: {}, prepare },
    modules: base.modules, revision: base.revision, workflow: base.workflow, operationScheduling: "queued" }))))
    .toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(prepare.mock.calls[0]?.[0].operationScheduling).toBe("queued");
});

it("rejects unknown operation scheduling before execution preparation", async () => {
  const base = fixture();
  const prepare = vi.fn(() => Effect.fail(commerceError("invalidAuthority")));
  // @ts-expect-error Runtime negative witness deliberately selects an unknown trusted scheduling profile.
  const result = await Effect.runPromise(Effect.result(prepareAtomicWorkflowHost({ ...base, execution: { identityAndAccessPolicy: {}, prepare }, operationScheduling: "parallel" })));
  expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  expect(prepare).not.toHaveBeenCalled();
});

it("forwards mixed logical publication only for an explicit validated participant selection", async () => {
  const base = fixture(), binding = base.modules.sample;
  if (binding === undefined) throw new Error("Missing configured unit participant");
  const plain = await Effect.runPromise(prepareWorkflowComposition(base));
  const omitted = await Effect.runPromise(prepareWorkflowComposition({ ...base, modules: { sample: Object.defineProperty({ ...binding },
    "logicalPublication", { value: undefined, enumerable: true }) } }));
  const mixed = await Effect.runPromise(prepareWorkflowComposition({ ...base,
    modules: { sample: { ...binding, logicalPublication: "mixed" } } }));
  expect(plain.composition.participants[0]).not.toHaveProperty("logicalPublication");
  expect(omitted.composition.participants[0]).not.toHaveProperty("logicalPublication");
  expect(omitted.composition.identityAndAccessPolicy).toEqual(plain.composition.identityAndAccessPolicy);
  expect(mixed.composition.participants[0]).toHaveProperty("logicalPublication", "mixed");
  const prepare = vi.fn(() => Effect.fail(commerceError("invalidAuthority")));
  expect(await Effect.runPromise(Effect.result(prepareAtomicWorkflowHost({ ...base,
    execution: { identityAndAccessPolicy: {}, prepare }, modules: { sample: Object.defineProperty({ ...binding },
      "logicalPublication", { value: "parallel", enumerable: true }) } }))))
    .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  expect(prepare).not.toHaveBeenCalled();
});

it("forwards an explicit byte allowance and binds only explicit selection into the workflow identity", async () => {
  const base = fixture();
  const plain = await Effect.runPromise(prepareWorkflowComposition(base));
  const ownUndefined = await Effect.runPromise(prepareWorkflowComposition(Object.defineProperty({ ...base }, "requestByteLimit",
    { value: undefined, enumerable: true })));
  const extended = await Effect.runPromise(prepareWorkflowComposition({ ...base, requestByteLimit: 2_097_152 }));
  expect(plain.composition).not.toHaveProperty("requestByteLimit");
  expect(ownUndefined.composition.identityAndAccessPolicy).toEqual(plain.composition.identityAndAccessPolicy);
  expect(extended.composition.requestByteLimit).toBe(2_097_152);
  expect(extended.composition.identityAndAccessPolicy).not.toEqual(plain.composition.identityAndAccessPolicy);
  const prepare = vi.fn((_composition: AtomicWorkflowHostComposition) => Effect.fail(commerceError("invalidAuthority")));
  expect(await Effect.runPromise(Effect.result(prepareAtomicWorkflowHost({ execution: { identityAndAccessPolicy: {}, prepare },
    modules: base.modules, revision: base.revision, workflow: base.workflow, requestByteLimit: 2_097_152 }))))
    .toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
  expect(prepare.mock.calls[0]?.[0].requestByteLimit).toBe(2_097_152);
});

it("rejects a scheduling accessor without invoking it or execution preparation", async () => {
  const base = fixture();
  const prepare = vi.fn(() => Effect.fail(commerceError("invalidAuthority")));
  const getter = vi.fn(() => "queued");
  const input = Object.defineProperty({ ...base, execution: { identityAndAccessPolicy: {}, prepare } }, "operationScheduling",
    { get: getter, enumerable: true });
  expect(await Effect.runPromise(Effect.result(prepareAtomicWorkflowHost(input))))
    .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  expect(getter).not.toHaveBeenCalled();
  expect(prepare).not.toHaveBeenCalled();
});
