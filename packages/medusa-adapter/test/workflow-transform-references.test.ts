import { describe, expect, it, vi } from "vitest";
import { Deferred, Effect, Fiber, Result } from "effect";
import { createStep, createWorkflow, parallelize, transform, when, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { executeWorkflow, type WorkflowExecutionPort } from "@medusajs/workflows-sdk/native";

const port: WorkflowExecutionPort<Error> = {
  checkpoint: Effect.void,
  capture: value => Effect.try({ try: () => structuredClone(value), catch: cause => cause instanceof Error ? cause : new Error("Capture failed", { cause }) }),
  invoke: work => Effect.tryPromise({ try: () => Promise.resolve(work()), catch: cause => cause instanceof Error ? cause : new Error("Callback failed", { cause }) }),
  context: { container: { resolve() { throw new Error("No resources selected"); } }, eventGroupId: "transform-reference-root" },
};

describe("transform-produced native WorkflowData references", () => {
  it("resolves a closure-captured selector ID reference before passing the transform result to a step", async () => {
    const received = vi.fn((input: { selector: { id: string[]; thumbnail: string }; update: { thumbnail: null } }) => input);
    const update = createStep("update", received);
    const workflow = createWorkflow("nested-transform-reference", (input: WorkflowData<{ remove: string[] }>) => {
      const normalized = transform(input, data => ({ remove: data.remove }));
      const request = transform({ url: "image.png" }, data => ({ selector: { id: normalized.remove, thumbnail: data.url }, update: { thumbnail: null } }));
      return new WorkflowResponse(update(request));
    });
    const input = { remove: ["v02", "v01", "v02", "missing"] };
    const expected = { selector: { id: input.remove, thumbnail: "image.png" }, update: { thumbnail: null } };
    expect(await Effect.runPromise(executeWorkflow(Result.getOrThrow(workflow.prepare()), input, port))).toEqual(expected);
    expect(received).toHaveBeenCalledExactlyOnceWith(expected, port.context);
  });

  it("resolves nested records/arrays and prior step outputs while caching each transform once per frame", async () => {
    const normalize = vi.fn(async (value: number) => { await Promise.resolve(); return { id: value + 1 }; });
    const prior = createStep("prior", (value: number) => value * 2);
    const workflow = createWorkflow("nested-result-cache", (input: WorkflowData<number>) => {
      const normalized = transform(input, normalize), before = prior(input);
      const result = transform(undefined, () => ({ nested: [{ id: normalized.id, before }], repeated: normalized }));
      return new WorkflowResponse(result);
    });
    const prepared = Result.getOrThrow(workflow.prepare());
    for (const input of [3, 7]) expect(await Effect.runPromise(executeWorkflow(prepared, input, port)))
      .toEqual({ nested: [{ id: input + 1, before: input * 2 }], repeated: { id: input + 1 } });
    expect(normalize).toHaveBeenCalledTimes(2);
  });

  it("refuses foreign and not-yet-completed step references reached only through a callback closure", async () => {
    let foreign: unknown;
    createWorkflow("foreign-reference-owner", (input: WorkflowData<number>) => { foreign = input; return new WorkflowResponse(input); });
    const foreignWorkflow = createWorkflow("foreign-result", () => new WorkflowResponse(transform(undefined, () => ({ foreign }))));
    expect(await Effect.runPromise(Effect.result(executeWorkflow(Result.getOrThrow(foreignWorkflow.prepare()), 1, port))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidReference" } });
    let future: unknown;
    const consume = createStep("consume", (value: unknown) => value), later = vi.fn(() => 2), produce = createStep("future", later);
    const futureWorkflow = createWorkflow("future-result", () => {
      const result = consume(transform(undefined, () => ({ future })));
      future = produce(undefined);
      return new WorkflowResponse(result);
    });
    expect(await Effect.runPromise(Effect.result(executeWorkflow(Result.getOrThrow(futureWorkflow.prepare()), undefined, port))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidReference" } });
    expect(later).not.toHaveBeenCalled();
  });

  it("does not evaluate transform callbacks in skipped regions, including returned skipped references", async () => {
    const skipped = vi.fn(() => { throw new Error("Skipped transformer ran"); });
    const workflow = createWorkflow("skipped-transform-return", () => {
      const absent = when("false-region", false, value => value).then(() => transform(undefined, skipped));
      return new WorkflowResponse(transform(undefined, () => ({ absent })));
    });
    expect(await Effect.runPromise(executeWorkflow(Result.getOrThrow(workflow.prepare()), undefined, port))).toEqual({ absent: undefined });
    expect(skipped).not.toHaveBeenCalled();
  });

  it("rejects self and mutually recursive returned references without waiting on their own pending cells", async () => {
    for (const mutual of [false, true]) {
      let left: unknown, right: unknown;
      const workflow = createWorkflow(mutual ? "mutual-reference-cycle" : "self-reference-cycle", () => {
        left = transform(undefined, () => mutual ? right : left);
        right = transform(undefined, () => left);
        return new WorkflowResponse(left);
      });
      expect(await Effect.runPromise(Effect.result(executeWorkflow(Result.getOrThrow(workflow.prepare()), undefined, port).pipe(Effect.timeout(1_000)))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "invalidReference" } });
    }
  });

  it("detects cross-parallel pending transform cycles and drains the failed sibling group", async () => {
    const both = Deferred.makeUnsafe<void>();
    let entered = 0, left: unknown, right: unknown;
    const wait = async () => { if (++entered === 2) await Effect.runPromise(Deferred.succeed(both, undefined)); await Effect.runPromise(Deferred.await(both)); };
    const leftStep = createStep("left", (value: unknown) => value), rightStep = createStep("right", (value: unknown) => value);
    const workflow = createWorkflow("parallel-transform-cycle", () => {
      const leftRef = transform(undefined, async () => { await wait(); return right; });
      const rightRef = transform(undefined, async () => { await wait(); return left; });
      left = leftRef; right = rightRef;
      return new WorkflowResponse(parallelize(leftStep(leftRef), rightStep(rightRef)));
    });
    expect(await Effect.runPromise(Effect.result(executeWorkflow(Result.getOrThrow(workflow.prepare()), undefined, port).pipe(Effect.timeout(1_000)))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidReference" } });
    expect(entered).toBe(2);
  });

  it("single-flights returned transform dependencies shared by genuine parallel branches", async () => {
    const inner = vi.fn(async () => { await Promise.resolve(); return ["v02", "v01"]; });
    const left = createStep("left", (value: unknown) => value), right = createStep("right", (value: unknown) => value);
    const workflow = createWorkflow("parallel-returned-dependency", () => {
      const ids = transform(undefined, inner), input = transform(undefined, () => ({ selector: { id: ids } }));
      return new WorkflowResponse(parallelize(left(input), right(input)));
    });
    const prepared = Result.getOrThrow(workflow.prepare());
    expect(await Effect.runPromise(executeWorkflow(prepared, undefined, port))).toEqual([
      { selector: { id: ["v02", "v01"] } }, { selector: { id: ["v02", "v01"] } },
    ]);
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("rejects unsafe descriptors, prototypes, sparse arrays and ordinary cycles without reading getters", async () => {
    const getter = vi.fn(() => "must not read");
    const accessor = Object.defineProperty({}, "id", { enumerable: true, get: getter });
    const hidden = Object.defineProperty({}, "id", { enumerable: false, value: "hidden" });
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    const inherited = Object.create({ inherited: true });
    class CustomArray extends Array<string> {}
    const reordered = new Proxy(["first", "second"], { ownKeys: () => ["1", "0", "length"] });
    for (const output of [accessor, hidden, inherited, new Array(1), cycle, { [Symbol("hidden")]: 1 },
      new CustomArray("first", "second"), Object.setPrototypeOf(["first"], null), reordered]) {
      const workflow = createWorkflow("unsafe-transform-return", () => new WorkflowResponse(transform(undefined, () => output)));
      expect(await Effect.runPromise(Effect.result(executeWorkflow(Result.getOrThrow(workflow.prepare()), undefined, port))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "invalidReference" } });
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it("bounds expansion of shared acyclic transform results before output capture", async () => {
    const small = { left: { value: "retained" }, right: { value: "retained" } };
    small.right = small.left;
    const admitted = createWorkflow("small-shared-transform", () => new WorkflowResponse(transform(undefined, () => small)));
    expect(await Effect.runPromise(executeWorkflow(Result.getOrThrow(admitted.prepare()), undefined, port))).toEqual(small);
    let shared: object = {};
    for (let depth = 0; depth < 13; depth++) shared = { left: shared, right: shared };
    const capture = vi.fn(port.capture);
    const bounded = createWorkflow("bounded-shared-transform", () => new WorkflowResponse(transform(undefined, () => shared)));
    const outcome = await Effect.runPromise(Effect.result(executeWorkflow(Result.getOrThrow(bounded.prepare()), undefined, { ...port, capture })));
    expect(outcome._tag).toBe("Failure");
    if (outcome._tag === "Failure") expect(outcome.failure).toMatchObject({ reason: "invalidReference" });
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith(undefined);
  });

  it("keeps foreign descriptor-trap throws in the owning port's typed failure channel", async () => {
    const failure = new Error("foreign transform result inspection failed");
    const outputs = [
      new Proxy({}, { getPrototypeOf() { throw failure; } }),
      new Proxy({}, { ownKeys() { throw failure; } }),
      new Proxy({ id: 1 }, { getOwnPropertyDescriptor() { throw failure; } }),
    ];
    for (const output of outputs) {
      const workflow = createWorkflow("foreign-result-inspection", () => new WorkflowResponse(transform(undefined, () => output)));
      const exit = await Effect.runPromise(Effect.exit(executeWorkflow(Result.getOrThrow(workflow.prepare()), undefined, port)));
      expect(exit._tag === "Failure" && exit.cause.reasons.some(reason => reason._tag === "Fail" && reason.error === failure)).toBe(true);
      expect(exit._tag === "Failure" && exit.cause.reasons.some(reason => reason._tag === "Die")).toBe(false);
    }
    const revoked = Proxy.revocable({}, {}); revoked.revoke();
    const workflow = createWorkflow("revoked-result-inspection", () => new WorkflowResponse(transform(undefined, () => revoked.proxy)));
    const exit = await Effect.runPromise(Effect.exit(executeWorkflow(Result.getOrThrow(workflow.prepare()), undefined, port)));
    expect(exit._tag === "Failure" && exit.cause.reasons.some(reason => reason._tag === "Fail" && reason.error instanceof TypeError)).toBe(true);
  });

  it("refuses an invocation port that succeeds without running result inspection", async () => {
    const workflow = createWorkflow("missing-result-inspection", () => new WorkflowResponse(transform(undefined, () => 1)));
    expect(await Effect.runPromise(Effect.result(executeWorkflow(Result.getOrThrow(workflow.prepare()), undefined,
      { ...port, invoke: () => Effect.succeed(undefined) }))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidReference", detail: "Transform result inspection did not complete" } });
  });

  it("bounds dynamic returned reference chains and result data before unbounded expansion", async () => {
    const workflow = createWorkflow("bounded-returned-chain", () => {
      const refs: unknown[] = [];
      for (let index = 0; index < 66; index++) refs.push(transform(undefined, () => refs[index + 1] ?? "finished"));
      return new WorkflowResponse(refs[0]);
    });
    expect(await Effect.runPromise(Effect.result(executeWorkflow(Result.getOrThrow(workflow.prepare()), undefined, port))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidReference" } });
    const wide = createWorkflow("bounded-returned-data", () => new WorkflowResponse(transform(undefined, () => new Array(4097).fill(0))));
    expect(await Effect.runPromise(Effect.result(executeWorkflow(Result.getOrThrow(wide.prepare()), undefined, port))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidReference" } });
  });

  it("preserves a nested callback failure and interrupts a pending returned dependency with its finalizer", async () => {
    const failure = new Error("nested callback failed");
    const failed = createWorkflow("failed-returned-dependency", () => {
      const inner = transform(undefined, () => { throw failure; });
      return new WorkflowResponse(transform(undefined, () => ({ inner })));
    });
    const exit = await Effect.runPromise(Effect.exit(executeWorkflow(Result.getOrThrow(failed.prepare()), undefined, port)));
    expect(exit._tag === "Failure" && exit.cause.reasons.some(reason => reason._tag === "Fail" && reason.error === failure)).toBe(true);
    const entered = Deferred.makeUnsafe<void>(), marker = Symbol("pending");
    let finalized = false;
    const pendingPort: WorkflowExecutionPort<Error> = { ...port, invoke: work => port.invoke(work).pipe(Effect.flatMap(value => value === marker
      ? Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never), Effect.ensuring(Effect.sync(() => { finalized = true; }))) : Effect.succeed(value))) };
    const pending = createWorkflow("cancelled-returned-dependency", () => {
      const inner = transform(undefined, () => marker);
      return new WorkflowResponse(transform(undefined, () => ({ inner })));
    });
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(executeWorkflow(Result.getOrThrow(pending.prepare()), undefined, pendingPort));
      yield* Deferred.await(entered).pipe(Effect.timeout(1_000));
      yield* Fiber.interrupt(fiber);
    })));
    expect(finalized).toBe(true);
  });
});
