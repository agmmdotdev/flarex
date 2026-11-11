import { describe, expect, it, vi } from "vitest";
import { Cause, Effect, Exit, Fiber, Result, Schema } from "effect";
import { createHook, createStep, createWorkflow, nativeCartMutationProfile, parallelize, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { updateLineItemInCartWorkflow } from "@medusajs/core-flows/cart/update-line-item-in-cart";
import { captureWorkflowDefinitionDigest } from "../src/workflow/definition-identity";
import { captureWorkflowPolicy } from "../src/workflow/configuration";
import { prepareWorkflowComposition, type InstalledWorkflowModule } from "../src/workflow/host";
import { prepareWorkflowResources } from "../src/workflow/resources";
import { currencyWorkflowModule } from "../src/modules/currency/service";

const value = createStep("identity-value", (input: number) => new StepResponse(input));
const child = createWorkflow("identity-child", (input: WorkflowData<number>) => new WorkflowResponse(value(input)));
const flow = (reverse = false, second = 2) => createWorkflow("identity-parent", (input: WorkflowData<number>) => {
  const first = child.runAsStep({ input }).config({ name: "first" });
  const other = child.runAsStep({ input: second }).config({ name: "second" });
  return new WorkflowResponse(reverse ? [other, first] : [first, other]);
});
const prepare = (definition = flow()) => Result.getOrThrow(definition.prepare());
const digest = (definition = prepare()) => Effect.runPromise(captureWorkflowDefinitionDigest(definition));

describe("explicit workflow definition frame digests", () => {
  it("preserves ordered repeated children, references, literals and outputs", async () => {
    const original = await digest();
    expect(original).toMatch(/^[a-f0-9]{64}$/);
    expect(await digest()).toBe(original);
    expect(await digest(prepare(flow(true)))).not.toBe(original);
    expect(await digest(prepare(flow(false, 3)))).not.toBe(original);
  });

  it("binds nested hooks, native declarations and parallel topology", async () => {
    const hooked = createWorkflow("identity-hook-child", (input: WorkflowData<number>) => {
      const hook = createHook("after", { input }); return new WorkflowResponse(null, { hooks: [hook] });
    });
    const root = (bound: boolean) => createWorkflow("identity-hook-parent", (input: WorkflowData<number>) => {
      hooked.runAsStep({ input, ...(bound ? { hooks: { after: () => undefined } } : {}) }); return new WorkflowResponse(null);
    });
    expect(await digest(Result.getOrThrow(root(false).prepare()))).not.toBe(await digest(Result.getOrThrow(root(true).prepare())));
    const declaration = (native: boolean) => createWorkflow(native ? { name: "identity-declaration", idempotent: false } : "identity-declaration",
      () => new WorkflowResponse(null));
    expect(await digest(Result.getOrThrow(declaration(false).prepare()))).not.toBe(await digest(Result.getOrThrow(declaration(true).prepare())));
    const first = createStep("identity-first", (input: number) => new StepResponse(input));
    const second = createStep("identity-second", (input: number) => new StepResponse(input));
    const topology = (parallel: boolean) => createWorkflow("identity-topology", (input: WorkflowData<number>) =>
      new WorkflowResponse(parallel ? parallelize(first(input), second(input)) : [first(input), second(input)]));
    expect(await digest(Result.getOrThrow(topology(false).prepare()))).not.toBe(await digest(Result.getOrThrow(topology(true).prepare())));
  });

  it("encodes the actual 243-node native closure without increasing policy capture limits", async () => {
    const root = createWorkflow({ name: "native-item-identity-wrapper", constructionProfile: nativeCartMutationProfile },
      (input: WorkflowData<NonNullable<typeof updateLineItemInCartWorkflow[" input"]>>) => {
        updateLineItemInCartWorkflow.runAsStep({ input }); return new WorkflowResponse(null);
      });
    const prepared = Result.getOrThrow(root.prepare());
    expect(prepared.nodeCount).toBe(243);
    expect(captureWorkflowPolicy(prepared.identity)).toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
    expect(await digest(prepared)).toMatch(/^[a-f0-9]{64}$/);
    const oversized = createWorkflow("oversized-local-frame", () => new WorkflowResponse("x".repeat(70_000)));
    expect(await Effect.runPromise(Effect.result(captureWorkflowDefinitionDigest(Result.getOrThrow(oversized.prepare())))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
  });

  it("requires SDK issuance before reading root descriptors", async () => {
    const prepared = prepare(); let reads = 0;
    const accessor = Object.defineProperty({ ...prepared }, "identity", { get() { reads++; return prepared.identity; } });
    for (const forged of [{ ...prepared }, accessor, prepared.identity]) {
      expect(await Effect.runPromise(Effect.result(captureWorkflowDefinitionDigest(forged))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
    }
    expect(reads).toBe(0);
  });

  it("preserves old raw/resource-only identities and binds trusted revisions separately", async () => {
    const module = Result.getOrThrow(currencyWorkflowModule);
    const resources = Result.getOrThrow(prepareWorkflowResources({ currency: { module, methods: ["retrieveCurrency"], graph: false } }, false));
    // Pure composition authenticates definition/resource metadata. The actual
    // Core host separately authenticates storage before any execution.
    const modules: Record<string, InstalledWorkflowModule> = {};
    Object.defineProperty(modules, "currency", { enumerable: true, value: { module, logicalStorage: {} } });
    const prepared = prepare(), base = { identityAndAccessPolicy: { profile: "identity-unit" }, modules, revision: "1".repeat(64),
      workflow: { name: "identity-unit", resources, prepared, input: Schema.Finite, output: Schema.Json } };
    const composition = async (identityEncoding?: "resourceDigest" | "resourceAndDefinitionDigest", revision = base.revision) => {
      const result = await Effect.runPromise(prepareWorkflowComposition({ ...base, revision,
        ...(identityEncoding === undefined ? {} : { identityEncoding }) }));
      return Schema.decodeUnknownSync(Schema.Struct({ policy: Schema.JsonObject, workflow: Schema.JsonObject }))(result.composition.identityAndAccessPolicy);
    };
    const raw = await composition(), resource = await composition("resourceDigest"), compact = await composition("resourceAndDefinitionDigest");
    expect(raw.workflow.definition).toEqual(prepared.identity); expect(raw.workflow).not.toHaveProperty("identityEncoding");
    expect(resource.workflow.definition).toEqual(prepared.identity); expect(resource.workflow.identityEncoding).toBe("resourceDigest");
    expect(compact.workflow.definition).toEqual({ format: "flarex.medusa-workflow-definition-digest", version: 1, sha256: await digest(prepared) });
    expect(compact.workflow.resourceDigest).toBe(resource.workflow.resourceDigest);
    expect((await composition("resourceAndDefinitionDigest", "2".repeat(64))).workflow).toEqual({ ...compact.workflow, revision: "2".repeat(64) });
  });

  it("propagates hashing failures and interruption", async () => {
    const prepared = prepare(), failure = new Error("digest unavailable");
    const unavailable = vi.spyOn(globalThis.crypto.subtle, "digest").mockRejectedValue(failure);
    try {
      expect(await Effect.runPromise(Effect.result(captureWorkflowDefinitionDigest(prepared))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "resourceFailure", cause: failure } });
    } finally { unavailable.mockRestore(); }
    let began: () => void = () => undefined;
    const reached = new Promise<void>(resolve => { began = resolve; });
    const blocked = vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementation(() => { began(); return new Promise<ArrayBuffer>(() => {}); });
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const fiber = yield* Effect.forkScoped(captureWorkflowDefinitionDigest(prepared));
        yield* Effect.promise(() => reached); yield* Fiber.interrupt(fiber);
        const exit = yield* Fiber.await(fiber);
        expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
      })));
    } finally { blocked.mockRestore(); }
  });
});
