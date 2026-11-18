import { promiseFailureObserver } from "./support/promise-failure-observer";
import { Cause, Deferred, Effect, Exit, Result, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import { createStep, createWorkflow, parallelize, WorkflowResponse, type PreparedWorkflow } from "@medusajs/workflows-sdk";
import { batchProductsWorkflow } from "@medusajs/core-flows/product/batch-products";
import type { AtomicCommerceContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineGraphReadCommand } from "../src/local-graph/commands";
import { commerceDecoder } from "../src/value/decoder";
import { defineWorkflowMethod, defineWorkflowModule } from "../src/workflow/module";
import { prepareWorkflowResources, workflowResourceSelections } from "../src/workflow/resources";
import { bindWorkflowResources } from "../src/workflow/binding";
import { runNativeMedusaWorkflow } from "../src/workflow/runtime";

// A native callback/runner boundary proof. This port does not simulate storage,
// commit, rollback or the shared core's operation scheduler.
function fixture(call: (value: unknown) => Effect.Effect<string, CommerceTransactionError>) {
  const command = defineGraphReadCommand("parallelSampleRead", () => Effect.succeed([[], 0]));
  const method = Result.getOrThrow(defineWorkflowMethod({ command,
    arguments: commerceDecoder(Schema.Tuple([Schema.String]), "invalidInput"),
    encode: ([value]: readonly [string]) => value, output: commerceDecoder(Schema.String, "storedCorruption"),
  }));
  const module = Result.getOrThrow(defineWorkflowModule({ name: "parallel_sample", methods: { read: method },
    source: { name: "parallel-sample", profile: "sample" },
    graph: { aliases: [{ name: "parallel_sample", model: "Sample" }], reads: [{ command, model: "Sample",
      table: { name: "sample", columns: ["id"], primaryKeys: ["id"], foreignKeys: [], companions: {} },
      paths: [], orderable: ["id"], uniqueOrder: ["id"], multipleOrder: false,
      decode: commerceDecoder(Schema.Tuple([Schema.Array(Schema.JsonObject), Schema.Number]), "storedCorruption"),
    }] },
  }));
  const resources = Result.getOrThrow(prepareWorkflowResources({ sample: { module, methods: ["read"], graph: false } }, false));
  const members = workflowResourceSelections(resources);
  if (members === undefined) throw new Error("Missing authentic selection");
  const decode = commerceDecoder(Schema.Json, "invalidInput");
  const refuse = vi.fn((error: CommerceTransactionError) => Effect.fail(error));
  const recordFailure = promiseFailureObserver();
  const context: AtomicCommerceContext = { eventGroupId: "parallel-lifetime", checkpoint: Effect.void, recordFailure,
    capture: (value, normalize) => Effect.suspend(() => Effect.fromResult((normalize ?? decode)(value))),
    call: (_participant, _command, value) => call(value), emit: () => Effect.fail(commerceError("unadmittedEvent")),
    clearPendingEvents: () => Effect.fail(commerceError("unadmittedEvent")), refuse,
  };
  return { resources, refuse, recordFailure, run: (flow: PreparedWorkflow, input: unknown = null) =>
    runNativeMedusaWorkflow(flow, context, input,
      owner => bindWorkflowResources(resources, members, undefined, [], context, owner)),
  };
}

describe("parallel native callback lifetime", () => {
  it("captures the actual empty native Product batch's skipped positional results", async () => {
    const native = fixture(() => Effect.die("The empty Product batch must skip every child"));
    expect(await Effect.runPromise(native.run(Result.getOrThrow(batchProductsWorkflow.prepare()), {})))
      .toEqual({ created: [], updated: [], deleted: [] });
  });

  it("enters two authentic method runners together and closes both borrowed handles", async () => {
    const entered = await Effect.runPromise(Deferred.make<void>());
    let calls = 0;
    const native = fixture(value => Effect.gen(function* () {
      if (++calls === 2) yield* Deferred.succeed(entered, undefined);
      yield* Deferred.await(entered);
      return String(value);
    }));
    let escaped: ((value: string) => Promise<string>) | undefined;
    const step = createStep("parallel-read", native.resources.callback(async (value: string, { resources }) => {
      escaped = resources.sample.read;
      return await resources.sample.read(value);
    }));
    const flow = createWorkflow("parallel-native-read", () => new WorkflowResponse(parallelize(
      step("left").config({ name: "left" }), step("right").config({ name: "right" }),
    )));
    expect(await Effect.runPromise(native.run(Result.getOrThrow(flow.prepare())).pipe(Effect.timeout(2_000)))).toEqual(["left", "right"]);
    expect(calls).toBe(2);
    expect(native.refuse).not.toHaveBeenCalled();
    expect(escaped).toBeDefined();
    await expect(escaped?.("late")).rejects.toMatchObject({ reason: "closed" });
    expect(calls).toBe(2);
  });

  it("preserves the initiating refusal and joins a cancelled sibling's runner finalizer", async () => {
    const entered = await Effect.runPromise(Deferred.make<void>());
    const cleaning = await Effect.runPromise(Deferred.make<void>());
    const release = await Effect.runPromise(Deferred.make<void>());
    const failure = commerceError("invalidInput");
    let cleaned = false, completed = false;
    const native = fixture(value => value === "failure"
      ? Deferred.await(entered).pipe(Effect.andThen(Effect.fail(failure)))
      : Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never), Effect.ensuring(
        Deferred.succeed(cleaning, undefined).pipe(Effect.andThen(Deferred.await(release)),
          Effect.andThen(Effect.sync(() => { cleaned = true; }))))));
    let escaped: ((value: string) => Promise<string>) | undefined;
    const step = createStep("parallel-failure", native.resources.callback(async (value: string, { resources }) => {
      escaped = resources.sample.read;
      return await resources.sample.read(value);
    }));
    const flow = createWorkflow("parallel-native-failure", () => new WorkflowResponse(parallelize(
      step("slow").config({ name: "slow" }), step("failure").config({ name: "failure" }),
    )));
    const outcome = Effect.runPromise(Effect.exit(native.run(Result.getOrThrow(flow.prepare())))).then(value => { completed = true; return value; });
    try {
      await Effect.runPromise(Deferred.await(cleaning).pipe(Effect.timeout(2_000)));
      expect(completed).toBe(false);
      expect(cleaned).toBe(false);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); }
    const exit = await outcome;
    expect(cleaned).toBe(true);
    if (Exit.isSuccess(exit)) throw new Error("Expected the initiating refusal");
    expect(Result.getOrThrow(Cause.findError(exit.cause))).toBe(failure);
    expect(native.recordFailure).toHaveBeenCalledWith(expect.objectContaining({ reasons: expect.arrayContaining([expect.objectContaining({ _tag: "Fail", error: failure })]) }));
    await expect(escaped?.("late")).rejects.toMatchObject({ reason: "closed" });
  });

  it("revokes an interrupted foreign callback before its late continuation can dispatch", async () => {
    const entered = await Effect.runPromise(Deferred.make<void>());
    const controller = new AbortController();
    let release: (() => void) | undefined;
    let escaped: ((value: string) => Promise<string>) | undefined;
    let calls = 0;
    const native = fixture(value => Effect.sync(() => { calls++; return String(value); }));
    const waiting = createStep("parallel-wait", native.resources.callback(async (_: undefined, { resources }) => {
      escaped = resources.sample.read;
      await Effect.runPromise(Deferred.succeed(entered, undefined));
      await new Promise<void>(resolve => { release = resolve; });
      return await resources.sample.read("late");
    }));
    const sibling = createStep("parallel-complete", () => "completed sibling");
    const flow = createWorkflow("parallel-native-interruption", () => new WorkflowResponse(parallelize(waiting(undefined), sibling(undefined))));
    const outcome = Effect.runPromiseExit(native.run(Result.getOrThrow(flow.prepare())), { signal: controller.signal });
    await Effect.runPromise(Deferred.await(entered).pipe(Effect.timeout(2_000)));
    controller.abort();
    // The callback is foreign work: let the owned cancellation revoke it before
    // releasing its continuation, then verify the borrowed runner cannot start.
    await expect(escaped?.("after-abort")).rejects.toMatchObject({ reason: "closed" });
    release?.();
    const exit = await outcome;
    expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true);
    expect(calls).toBe(0);
  });
});
