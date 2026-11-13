import { expect, it, vi } from "vitest";
import { Cause, Effect, Exit, Fiber, Result, Schema } from "effect";
import { createWorkflow, WorkflowResponse } from "@medusajs/workflows-sdk";
import { captureWorkflowResourceDigest, captureWorkflowFramedResourceDigest, captureWorkflowPolicy } from "../src/workflow/configuration";
import { prepareWorkflowComposition, type InstalledWorkflowModule } from "../src/workflow/host";
import { prepareWorkflowResources } from "../src/workflow/resources";
import { currencyWorkflowModule } from "../src/modules/currency/service";

const proof = () => ({ resources: Array.from({ length: 20 }, (_, index) => ({ name: "participant" + index,
  source: { name: "native-source" + index, profile: "bounded.native" },
  methods: [{ name: "retrieve", command: { name: "retrieve" + index, mode: "read" } }],
  graph: { native: { format: "native-metadata", schema: "s".repeat(4096), sourceRevision: "a".repeat(64) } },
})), composedResources: [{ name: "router", identity: { format: "native.router", version: 1 }, methods: ["create", "dismiss"],
  dependencies: [{ participant: "participant0", command: { name: "retrieve0", mode: "read" } }] },
{ name: "logger", identity: { format: "native.logger", version: 1 }, methods: ["warn"], dependencies: [] }] });
const digest = (value: unknown) => Effect.runPromise(captureWorkflowFramedResourceDigest(value));

it("preserves the neutral oversized resourceDigest refusal before framing", async () => {
  expect(new TextEncoder().encode(JSON.stringify(proof())).length).toBeGreaterThan(65_536);
  expect(await Effect.runPromise(Effect.result(captureWorkflowResourceDigest(proof()))))
    .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
});

it("admits aggregate frames while every frame and final policy retain the existing ceiling", async () => {
  const value = proof(), original = await digest(value);
  expect(original).toMatch(/^[a-f0-9]{64}$/); expect(await digest(value)).toBe(original);
  expect(Result.isSuccess(captureWorkflowPolicy({ policy: { profile: "neutral" }, workflow: { identityEncoding: "framedResourceDigest", resourceDigest: original } }))).toBe(true);
  expect(await Effect.runPromise(Effect.result(captureWorkflowFramedResourceDigest({ resources: [{ native: "x".repeat(70_000) }] }))))
    .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
});

it("binds complete names, source metadata, methods, dependencies, category and ordering", async () => {
  const original = await digest(proof());
  const variants = [
    (value: ReturnType<typeof proof>) => { value.resources[0]!.name = "renamed"; },
    (value: ReturnType<typeof proof>) => { value.resources[0]!.source.profile = "changed.native"; },
    (value: ReturnType<typeof proof>) => { value.resources[0]!.graph.native.sourceRevision = "b".repeat(64); },
    (value: ReturnType<typeof proof>) => { value.resources[0]!.methods[0]!.command.mode = "write"; },
    (value: ReturnType<typeof proof>) => { value.resources.reverse(); },
    (value: ReturnType<typeof proof>) => { value.composedResources[0]!.identity.version = 2; },
    (value: ReturnType<typeof proof>) => { value.composedResources[0]!.methods.reverse(); },
    (value: ReturnType<typeof proof>) => { value.composedResources[0]!.dependencies[0]!.participant = "participant1"; },
    (value: ReturnType<typeof proof>) => { value.composedResources.reverse(); },
  ];
  for (const change of variants) { const value = proof(); change(value); expect(await digest(value)).not.toBe(original); }
  const frame = { name: "same", methods: ["read"], identity: { native: "same" } };
  expect(await digest({ resources: [frame] })).not.toBe(await digest({ resources: [], composedResources: [frame] }));
  expect(await digest({ resources: [], composedResources: undefined })).toBe(await digest({ resources: [] }));
  expect(await digest({ resources: [], composedResources: [] })).not.toBe(await digest({ resources: [] }));
});

it("captures all frames and rejects accessors, unknown wrapper fields and excess registrations before hashing", async () => {
  let reads = 0;
  const hidden = Object.defineProperty({}, "source", { enumerable: true, get() { reads++; return "native"; } });
  const hashing = vi.spyOn(globalThis.crypto.subtle, "digest");
  try {
    for (const value of [{ resources: [{ name: "first" }, hidden] }, { resources: [], omittedProof: true },
      { resources: [undefined] },
      { resources: Array.from({ length: 129 }, (_, index) => ({ name: "participant" + index })) },
      { resources: [], composedResources: [{ name: "first" }, hidden] },
      { resources: [{ name: "first" }, { native: "x".repeat(70_000) }] }])
      expect(Result.isFailure(await Effect.runPromise(Effect.result(captureWorkflowFramedResourceDigest(value))))).toBe(true);
    expect(reads).toBe(0); expect(hashing).not.toHaveBeenCalled();
  } finally { hashing.mockRestore(); }
});

it("owns the complete ordered proof before the first asynchronous hash", async () => {
  const value = proof(), original = structuredClone(value), nativeDigest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
  let began: () => void = () => undefined, release: () => void = () => undefined, blocked = false;
  const reached = new Promise<void>(resolve => { began = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const hashing = vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementation((algorithm, data) => {
    if (blocked) return nativeDigest(algorithm, data);
    blocked = true; began(); return gate.then(() => nativeDigest(algorithm, data));
  });
  let actual: string;
  try {
    const pending = digest(value); await reached;
    value.resources[1]!.source.profile = "changed-during-hashing"; value.resources.reverse();
    value.composedResources[0]!.methods.reverse(); value.composedResources.reverse();
    release(); actual = await pending;
  } finally { release(); hashing.mockRestore(); }
  expect(actual).toBe(await digest(original)); expect(actual).not.toBe(await digest(value));
});

it("keeps hash failure provenance and interruption", async () => {
  const failure = new Error("framed digest unavailable"), hashing = vi.spyOn(globalThis.crypto.subtle, "digest").mockRejectedValue(failure);
  try {
    expect(await Effect.runPromise(Effect.result(captureWorkflowFramedResourceDigest(proof()))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "resourceFailure", cause: failure } });
  } finally { hashing.mockRestore(); }
  let began: () => void = () => undefined;
  const reached = new Promise<void>(resolve => { began = resolve; });
  const blocked = vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementation(() => { began(); return new Promise<ArrayBuffer>(() => {}); });
  try {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const fiber = yield* Effect.forkScoped(captureWorkflowFramedResourceDigest(proof()));
      yield* Effect.promise(() => reached); yield* Fiber.interrupt(fiber);
      const exit = yield* Fiber.await(fiber);
      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    })));
  } finally { blocked.mockRestore(); }
});

it("selects framing explicitly and preserves raw definitions and independent final policy fields", async () => {
  const module = Result.getOrThrow(currencyWorkflowModule);
  const resources = Result.getOrThrow(prepareWorkflowResources({ currency: { module, methods: ["retrieveCurrency"], graph: false } }, false, undefined, { absent: ["hidden"] }));
  const modules: Record<string, InstalledWorkflowModule> = {};
  Object.defineProperty(modules, "currency", { enumerable: true, value: { module, logicalStorage: {} } });
  const workflow = createWorkflow("neutral-framed-resource-identity", () => new WorkflowResponse(null));
  const prepared = Result.getOrThrow(workflow.prepare()), base = { identityAndAccessPolicy: { profile: "neutral-framing" }, modules,
    revision: "1".repeat(64), workflow: { name: "neutral-framed-resource-identity", resources, prepared, input: Schema.Json, output: Schema.Json },
    executionIsolation: "scopeExclusive" as const, operationScheduling: "queued" as const, borrowedOperationScheduling: "queued" as const };
  const composition = async (identityEncoding?: "resourceDigest" | "resourceAndDefinitionDigest" | "framedResourceDigest") => {
    const result = await Effect.runPromise(prepareWorkflowComposition({ ...base, ...(identityEncoding === undefined ? {} : { identityEncoding }) }));
    return Schema.decodeUnknownSync(Schema.Struct({ policy: Schema.JsonObject, workflow: Schema.JsonObject }))(result.composition.identityAndAccessPolicy);
  };
  const raw = await composition(), resource = await composition("resourceDigest"), compact = await composition("resourceAndDefinitionDigest"), framed = await composition("framedResourceDigest");
  expect(raw.workflow).not.toHaveProperty("identityEncoding"); expect(resource.workflow.resourceDigest).toBe(compact.workflow.resourceDigest);
  expect(framed).toMatchObject({ policy: { profile: "neutral-framing" }, workflow: { identityEncoding: "framedResourceDigest", revision: base.revision,
    definition: prepared.identity, absentResources: ["hidden"], events: [], executionIsolation: "scopeExclusive", operationScheduling: "queued", borrowedOperationScheduling: "queued" } });
  expect(framed.workflow.resourceDigest).not.toBe(resource.workflow.resourceDigest);
  expect(new TextEncoder().encode(JSON.stringify(framed)).length).toBeLessThanOrEqual(65_536);
});
