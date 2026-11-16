import { promiseFailureObserver } from "./support/promise-failure-observer";
import { describe, expect, it } from "vitest";
import { Cause, Effect, Exit, Result } from "effect";
import { createStep, createWorkflow, StepResponse, transform, WorkflowResponse, type PreparedWorkflow, type WorkflowData } from "@medusajs/workflows-sdk";
import { executeWorkflow, type WorkflowExecutionPort } from "@medusajs/workflows-sdk/native";
import type { AtomicCommerceContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, defaultCommerceResources, inspectCapturedPrivateJsonData, useCapturedPrivateJsonData } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureWorkflowValue, presentWorkflowValue } from "../src/workflow/value";

// The shared value owner measures every capture exactly as the native root's
// context does. This port records what it was asked to charge; it holds no
// lifetime, persistence or settlement behavior.
function capturePort() {
  const charges: { readonly bytes: number; readonly normalized: boolean }[] = [];
  const context: AtomicCommerceContext = { eventGroupId: "issued-capture", checkpoint: Effect.void, recordFailure: promiseFailureObserver(),
    clearPendingEvents: () => Effect.fail(commerceError("unadmittedEvent")),
    capture: (value, normalize) => Effect.suspend(() => Effect.fromResult(Result.gen(function* () {
      const captured = yield* useCapturedPrivateJsonData(normalize === undefined ? value : yield* normalize(value),
        defaultCommerceResources.commandBytes, commerceError, { canonicalNumbers: true, wellFormedUnicode: true });
      charges.push({ bytes: captured.bytes, normalized: normalize !== undefined });
      return captured.value;
    }))),
    call: () => Effect.fail(commerceError("unsupportedProfile")), emit: () => Effect.fail(commerceError("unadmittedEvent")),
    refuse: error => Effect.fail(error),
  };
  // The adapter's value owner behind the SDK port, without resources or children.
  const workflowPort: WorkflowExecutionPort<unknown> = { checkpoint: Effect.void,
    capture: value => captureWorkflowValue(context, value), present: presentWorkflowValue,
    invoke: work => Effect.tryPromise({ try: () => Promise.resolve(work()), catch: cause => cause }),
    context: { eventGroupId: context.eventGroupId, container: { resolve() { throw new Error("Unexpected native container resolution"); } } } };
  return { charges, capture: (value: unknown) => Effect.runPromise(captureWorkflowValue(context, value)),
    refusal: async (value: unknown) => {
      const exit = await Effect.runPromiseExit(captureWorkflowValue(context, value));
      if (Exit.isSuccess(exit)) throw new Error("Expected the capture to be refused");
      return Result.getOrThrow(Cause.findError(exit.cause));
    },
    exit: (workflow: { prepare(): Result.Result<PreparedWorkflow, unknown> }, input: unknown) =>
      Effect.runPromiseExit(executeWorkflow(Result.getOrThrow(workflow.prepare()), input, workflowPort)) };
}
const member = (value: unknown, key: string | number): unknown =>
  typeof value === "object" && value !== null ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
const source = () => ({ id: "prod_1", absent: undefined, tags: ["a", "b"],
  nested: { title: "Shirt", missing: undefined, slots: [undefined, { sku: "s-1" }] }, plain: { options: [{ value: "L" }] } });
function expectDeeplyFrozen(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const key of Reflect.ownKeys(value)) expectDeeplyFrozen(Object.getOwnPropertyDescriptor(value, key)?.value);
}

describe("issued workflow captures", () => {
  it("returns an issued root by identity and charges its retained envelope without another normalization", async () => {
    const port = capturePort();
    const issued = await port.capture(source());
    expect(issued).toEqual(source());
    expectDeeplyFrozen(issued);
    expect(Object.hasOwn(Object(issued), "absent")).toBe(true);
    expect(Object.hasOwn(Object(member(issued, "nested")), "missing")).toBe(true);
    expect(Object.keys(Object(issued))).toEqual(["id", "tags", "nested", "plain", "absent"]);
    expect(port.charges).toHaveLength(1);
    expect(await port.capture(issued)).toBe(issued);
    expect(port.charges).toEqual([{ bytes: port.charges[0]!.bytes, normalized: true }, { bytes: port.charges[0]!.bytes, normalized: false }]);
    // A root with no undefined slot is the capture owner's own issued node.
    const plain = await port.capture({ options: [{ value: "L" }] });
    expect(inspectCapturedPrivateJsonData(plain)).toBeDefined();
    expect(await port.capture(plain)).toBe(plain);
  });

  it("keeps issued subtrees by identity inside a newly assembled value and recaptures only what is new", async () => {
    const port = capturePort();
    const issued = await port.capture(source());
    const plain = member(issued, "plain"), nested = member(issued, "nested");
    const assembled = await port.capture({ plain, again: plain, nested, extra: { fresh: [1, undefined] } });
    expect(assembled).toEqual({ plain: source().plain, again: source().plain, nested: source().nested, extra: { fresh: [1, undefined] } });
    expectDeeplyFrozen(assembled);
    expect(member(assembled, "plain")).toBe(plain);
    expect(member(assembled, "again")).toBe(plain);
    // Containers leading to an undefined slot are rebuilt; their members that
    // hold none are still the issued nodes.
    expect(member(assembled, "nested")).not.toBe(nested);
    expect(member(member(member(assembled, "nested"), "slots"), 1)).toBe(member(member(nested, "slots"), 1));
    // The same measured bytes are charged as for an equal foreign value.
    const foreign = capturePort();
    await foreign.capture({ plain: source().plain, again: source().plain, nested: source().nested, extra: { fresh: [1, undefined] } });
    expect(port.charges.at(-1)).toEqual(foreign.charges[0]);
  });

  it("presents a fresh mutable copy and gives a subtree held twice two copies", async () => {
    const port = capturePort();
    const issued = await port.capture(source());
    const twice = await port.capture({ left: member(issued, "plain"), right: member(issued, "plain") });
    const first = presentWorkflowValue(twice), second = presentWorkflowValue(twice);
    expect(first).toEqual({ left: source().plain, right: source().plain });
    expect(first).not.toBe(second);
    expect(Object.isFrozen(first)).toBe(false);
    expect(member(first, "left")).not.toBe(member(first, "right"));
    expect(member(first, "left")).not.toBe(member(issued, "plain"));
    expect(Object.isFrozen(member(member(first, "left"), "options"))).toBe(false);
    const presented = presentWorkflowValue(issued);
    expect(presented).toEqual(source());
    expect(Object.hasOwn(Object(presented), "absent")).toBe(true);
    expect(Object.hasOwn(Object(member(member(presented, "nested"), "slots")), 0)).toBe(true);
  });

  it("captures a presented copy completely, valid or not", async () => {
    const port = capturePort();
    const issued = await port.capture(source());
    const untouched = presentWorkflowValue(issued);
    const recaptured = await port.capture(untouched);
    expect(recaptured).toEqual(issued);
    expect(recaptured).not.toBe(issued);
    expect(recaptured).not.toBe(untouched);
    expect(member(recaptured, "plain")).not.toBe(member(issued, "plain"));
    expect(port.charges.at(-1)).toEqual({ bytes: port.charges[0]!.bytes, normalized: true });
    const mutated = Object(presentWorkflowValue(issued));
    Object.defineProperty(member(mutated, "plain"), "options", { value: [{ value: "XL" }, 2n], enumerable: true });
    expect(await port.refusal(mutated)).toMatchObject({ reason: "invalidInput" });
  });

  it("captures a frozen look-alike completely", async () => {
    const port = capturePort();
    const deepFreeze = (value: unknown): unknown => {
      if (typeof value === "object" && value !== null) for (const key of Reflect.ownKeys(value)) deepFreeze(Object.getOwnPropertyDescriptor(value, key)?.value);
      return Object.freeze(value);
    };
    const lookAlike = deepFreeze(source());
    const captured = await port.capture(lookAlike);
    expect(captured).toEqual(lookAlike);
    expect(captured).not.toBe(lookAlike);
    expect(member(captured, "plain")).not.toBe(member(lookAlike, "plain"));
    expect(port.charges).toEqual([{ bytes: port.charges[0]!.bytes, normalized: true }]);
    let read = 0;
    const accessor = Object.freeze({ plain: Object.freeze(Object.defineProperty({}, "options", { enumerable: true, get: () => { read++; return []; } })) });
    expect(await port.refusal(accessor)).toMatchObject({ reason: "invalidInput" });
    expect(read).toBe(0);
    expect(await port.refusal(Object.freeze({ plain: Object.freeze(new Map()) }))).toMatchObject({ reason: "invalidInput" });
  });

  it("isolates a step that mutates its input from later steps, transforms and the result", async () => {
    const port = capturePort();
    const flowSource = () => ({ id: "prod_1", absent: undefined, tags: ["a", "b"], nested: { title: "Shirt", missing: undefined, slots: [{ sku: "s-1" }] } });
    const seen: unknown[] = [];
    const produce = createStep<unknown, ReturnType<typeof flowSource>, unknown>("issued-produce", _input => new StepResponse(flowSource(), { compensation: flowSource() }));
    const mutate = createStep("issued-mutate", (input: ReturnType<typeof flowSource>) => {
      seen.push(structuredClone(input));
      expect(Object.isFrozen(input)).toBe(false);
      expect(Object.isFrozen(input.nested.slots)).toBe(false);
      input.id = "changed"; input.tags.push("c"); input.nested.slots.length = 0;
      return new StepResponse(input);
    });
    const observe = createStep("issued-observe", (input: { readonly original: ReturnType<typeof flowSource>; readonly mutated: unknown }) => {
      seen.push(structuredClone(input));
      input.original.nested.title = "observed";
      return new StepResponse(input.original.id);
    });
    const workflow = createWorkflow("issued-capture-isolation", (input: WorkflowData<unknown>) => {
      const original = produce(input);
      const mutated = mutate(original);
      const shaped = transform({ original }, data => {
        seen.push(structuredClone(data));
        data.original.tags.length = 0;
        return data.original.tags;
      });
      const observed = observe({ original, mutated });
      return new WorkflowResponse({ mutated, shaped, observed, original });
    });
    const exit = await port.exit(workflow, null);
    if (Exit.isFailure(exit)) throw new Error("Expected the workflow to complete", { cause: exit.cause });
    const result = exit.value;
    const stored = { id: "prod_1", tags: ["a", "b"], nested: { title: "Shirt", slots: [{ sku: "s-1" }] } };
    const changed = { id: "changed", tags: ["a", "b", "c"], nested: { title: "Shirt", slots: [] } };
    expect(seen).toHaveLength(3);
    expect(seen[0]).toEqual(flowSource());
    expect(seen).toContainEqual({ original: flowSource() });
    expect(seen).toContainEqual({ original: flowSource(), mutated: { ...changed, absent: undefined, nested: { ...changed.nested, missing: undefined } } });
    for (const value of seen) expect(Object.hasOwn(Object(member(value, "original") ?? value), "absent")).toBe(true);
    expect(result).toEqual({ mutated: { ...changed, absent: undefined }, shaped: [], observed: "prod_1", original: { ...stored, absent: undefined } });
    expect(member(member(result, "original"), "nested")).toEqual({ title: "Shirt", missing: undefined, slots: [{ sku: "s-1" }] });
    expectDeeplyFrozen(member(result, "original"));
  });

  it("refuses an invalid value a step returns inside its presented input", async () => {
    const port = capturePort();
    const produce = createStep<unknown, ReturnType<typeof source>>("issued-invalid-produce", _input => new StepResponse(source()));
    const corrupt = createStep("issued-invalid-return", (input: ReturnType<typeof source>) => {
      Object.defineProperty(input.plain, "options", { value: new Map(), enumerable: true });
      return new StepResponse(input);
    });
    const workflow = createWorkflow("issued-capture-invalid-return", (input: WorkflowData<unknown>) => new WorkflowResponse(corrupt(produce(input))));
    const exit = await port.exit(workflow, null);
    if (Exit.isSuccess(exit)) throw new Error("Expected the returned value to be refused");
    expect(Result.getOrThrow(Cause.findError(exit.cause))).toMatchObject({ reason: "invalidInput" });
  });
});
