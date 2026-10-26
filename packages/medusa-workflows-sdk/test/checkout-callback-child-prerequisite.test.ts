import { describe, expect, it } from "vitest";
import { Cause, Effect, Exit, Result } from "effect";
import { createStep, createWorkflow, parallelize, StepResponse, WorkflowResponse, type WorkflowContainer, type WorkflowData } from "../src/index";
import { executeWorkflow, type WorkflowExecutionPort } from "../src/runtime";

function owningPort() {
  let failure: Cause.Cause<unknown> | undefined;
  const pending = new Set<Promise<unknown>>();
  const port: WorkflowExecutionPort<unknown> = {
    checkpoint: Effect.suspend(() => failure === undefined ? Effect.void : Effect.failCause(failure)),
    refuseCallback: error => { failure = failure === undefined ? Cause.fail(error) : Cause.combine(failure, Cause.fail(error)); throw error; },
    capture: value => Effect.sync(() => structuredClone(value)),
    invoke: work => Effect.tryPromise({ try: () => Promise.resolve(work()), catch: cause => cause }),
    runChild: work => {
      // Deliberate foreign Promise edge. The production adapter uses its
      // existing CommercePromiseOwner rather than this neutral test runner.
      const result = Effect.runPromiseExit(work).then(exit => {
        if (Exit.isFailure(exit)) { failure = failure === undefined ? exit.cause : Cause.combine(failure, exit.cause); throw exit.cause; }
        return exit.value;
      });
      pending.add(result);
      void result.then(() => pending.delete(result), () => pending.delete(result));
      return result;
    },
    context: { container: { resolve() { throw new Error("No resource selected"); } }, eventGroupId: "callback-root" },
  };
  return { port, close: () => Promise.allSettled([...pending]) };
}

// The pinned compensate-payment-if-needed step calls its refund/session child
// as workflow(container).run({ input }) from its retained callback. A finite
// callback child needs explicit preparation/identity and the current owner port;
// it must not open another host or independently settle a workflow.
describe("native checkout callback child prerequisite", () => {
  const child = createWorkflow("checkout-callback-child", () => new WorkflowResponse(null));

  it("preserves the native callable workflow factory shape", () => {
    expect(typeof child).toBe("function");
  });

  it("admits an explicitly declared callback child closure", () => {
    const declaration = { name: "checkout-callback-owner", invokedWorkflows: [child] };
    expect(() => createStep(declaration, () => new StepResponse(null))).not.toThrow();
  });

  it("retains callback child input and output types", () => {
    const typed = createWorkflow("typed-callback-child", (input: WorkflowData<{ readonly id: string }>) => new WorkflowResponse(input));
    const check = async (container: WorkflowContainer) => {
      const { result } = await typed(container).run({ input: { id: "row" } });
      const id: string = result.id;
      // @ts-expect-error Runtime values must match the declared child input.
      typed(container).run({ input: { id: 123 } });
      // @ts-expect-error Independent runner options grant no authority.
      typed(container).run({ input: { id }, transactionId: "foreign" });
      return id;
    };
    expect(typeof check).toBe("function");
  });

  it("executes the actual declared child with captured inputs and genuine occurrence identity", async () => {
    const identify = createStep("callback-child-identify", (input: { value: string }, context) => new StepResponse({
      value: input.value, parent: context.parentStepIdempotencyKey, key: context.idempotencyKey,
    }));
    const identified = createWorkflow("identified-child", (input: WorkflowData<{ value: string }>) => new WorkflowResponse(identify(input)));
    const call = createStep({ name: "call-identified-child", invokedWorkflows: [identified] }, async (input: { value: string }, context) =>
      new StepResponse((await identified(context.container).run({ input })).result));
    const parent = createWorkflow("callback-parent", (input: WorkflowData<{ value: string }>) => {
      const [left, right] = parallelize(call(input).config({ name: "left" }), call(input).config({ name: "right" }));
      return new WorkflowResponse({ left, right });
    });
    const prepared = Result.getOrThrow(parent.prepare()), owner = owningPort();
    const first = await Effect.runPromise(executeWorkflow(prepared, { value: "exact" }, owner.port));
    expect(first).toEqual({
      left: { value: "exact", parent: '["callback-root",0]', key: '["callback-root",0,0,0]' },
      right: { value: "exact", parent: '["callback-root",1]', key: '["callback-root",1,0,0]' },
    });
    expect(await Effect.runPromise(executeWorkflow(prepared, { value: "exact" }, owner.port))).toEqual(first);
    await owner.close();
  });

  it.each(["undeclared", "repeated", "invalid-options"] as const)("keeps %s child refusal sticky when the callback catches it", async mode => {
    let calls = 0;
    const count = createStep("count-child", () => { calls++; return new StepResponse(null); });
    const counted = createWorkflow("counted-child", () => new WorkflowResponse(count(undefined)));
    const undeclared = createWorkflow("undeclared-child", () => new WorkflowResponse(count(undefined)));
    const call = createStep({ name: "caught-child", invokedWorkflows: [counted] }, async (_input: void, { container }) => {
      try {
        if (mode === "undeclared") await undeclared(container).run({ input: undefined });
        else if (mode === "invalid-options") await Reflect.apply(counted(container).run, undefined, [{ input: undefined, transactionId: "forged" }]);
        else { await counted(container).run({ input: undefined }); await counted(container).run({ input: undefined }); }
      } catch { /* Native callback deliberately catches the refusal. */ }
      return new StepResponse(null);
    });
    const flow = createWorkflow("caught-child-parent", () => new WorkflowResponse(call(undefined))), owner = owningPort();
    expect(Exit.isFailure(await Effect.runPromiseExit(executeWorkflow(Result.getOrThrow(flow.prepare()), undefined, owner.port)))).toBe(true);
    expect(calls).toBe(mode === "repeated" ? 1 : 0);
    await owner.close();
  });

  it("refuses foreign containers and revokes saved views and containers when the callback settles", async () => {
    const owner = owningPort();
    expect(() => child(owner.port.context.container)).toThrow("live parent container");
    let escaped: ReturnType<typeof child> | undefined, container: WorkflowContainer | undefined;
    const save = createStep({ name: "save-child-view", invokedWorkflows: [child] }, (_input: void, context) => {
      container = context.container; escaped = child(context.container); return new StepResponse(null);
    });
    const flow = createWorkflow("saved-child-parent", () => new WorkflowResponse(save(undefined)));
    await Effect.runPromise(executeWorkflow(Result.getOrThrow(flow.prepare()), undefined, owner.port));
    if (escaped === undefined || container === undefined) throw new Error("Native callback did not execute");
    const savedContainer = container;
    await expect(escaped.run({ input: undefined })).rejects.toMatchObject({
      reasons: [{ _tag: "Fail", error: { reason: "unsupportedProfile" } }],
    });
    expect(() => child(savedContainer)).toThrow("binding has expired");
    await owner.close();
  });

  it("covers declared children in identity, inclusive limits and pre-callback storage policy admission", async () => {
    let calls = 0;
    const count = createStep("storage-callback-probe", () => { calls++; return new StepResponse(null); });
    const stored = createWorkflow({ name: "stored-callback-child", store: true, idempotent: false, retentionTime: 259200 }, () => new WorkflowResponse(count(undefined)));
    const call = createStep({ name: "stored-callback-owner", invokedWorkflows: [stored] }, () => { calls++; return new StepResponse(null); });
    const parent = createWorkflow("stored-callback-parent", () => new WorkflowResponse(call(undefined)));
    const prepared = Result.getOrThrow(parent.prepare()), owner = owningPort();
    expect(prepared.nodeCount).toBe(2);
    expect(prepared.identity.nodes[0]).toMatchObject({ invokedWorkflows: [{ name: stored.name, store: true }] });
    expect(Exit.isFailure(await Effect.runPromiseExit(executeWorkflow(prepared, undefined, owner.port)))).toBe(true);
    expect(calls).toBe(0);
    const { runChild: _runner, ...withoutRunner } = owner.port;
    expect(Exit.isFailure(await Effect.runPromiseExit(executeWorkflow(prepared, undefined,
      { ...withoutRunner, storedWorkflowPolicy: "atomicRootOutcome" })))).toBe(true);
    expect(calls).toBe(0);
    const huge = createWorkflow("huge-callback-child", () => {
      for (let index = 0; index < 64; index++) count(undefined).config({ name: "probe-" + index });
      return new WorkflowResponse(null);
    });
    const oversized = createStep({ name: "oversized-owner", invokedWorkflows: [huge] }, () => null);
    expect(() => createWorkflow("oversized-parent", () => new WorkflowResponse(oversized(undefined)))).toThrow("Too many workflow nodes");
    await owner.close();
  });

  it("captures strict child declarations without invoking accessors or accepting fake definitions", () => {
    let reads = 0;
    expect(() => createStep({ name: "accessor-declaration", get invokedWorkflows() { reads++; return [child]; } }, () => null)).toThrow();
    expect(reads).toBe(0);
    expect(() => createStep({ name: "duplicate-declaration", invokedWorkflows: [child, child] }, () => null)).toThrow();
    expect(() => Reflect.apply(createStep, undefined, [{ name: "fake-declaration", invokedWorkflows: [{ ...child }] }, () => null])).toThrow();
    const children = [child];
    Object.defineProperty(children, "0", { get() { reads++; return child; }, enumerable: true });
    expect(() => createStep({ name: "accessor-child", invokedWorkflows: children }, () => null)).toThrow();
    expect(reads).toBe(0);
  });

  it("borrows the same port through nested callback children and covers their transitive identity", async () => {
    const leafStep = createStep("callback-leaf-step", (input: string) => new StepResponse(input + "-leaf"));
    const leaf = createWorkflow("callback-leaf", (input: WorkflowData<string>) => new WorkflowResponse(leafStep(input)));
    const middleStep = createStep({ name: "callback-middle-step", invokedWorkflows: [leaf] }, async (input: string, { container }) =>
      new StepResponse((await leaf(container).run({ input })).result));
    const middle = createWorkflow("callback-middle", (input: WorkflowData<string>) => new WorkflowResponse(middleStep(input)));
    const parentStep = createStep({ name: "callback-transitive-step", invokedWorkflows: [middle] }, async (input: string, { container }) =>
      new StepResponse((await middle(container).run({ input })).result));
    const parent = createWorkflow("callback-transitive-parent", (input: WorkflowData<string>) => new WorkflowResponse(parentStep(input)));
    const prepared = Result.getOrThrow(parent.prepare()), owner = owningPort();
    expect(prepared.nodeCount).toBe(3);
    expect(prepared.identity.nodes[0]).toMatchObject({ invokedWorkflows: [{ name: middle.name,
      nodes: [{ invokedWorkflows: [{ name: leaf.name }] }] }] });
    expect(await Effect.runPromise(executeWorkflow(prepared, "native", owner.port))).toBe("native-leaf");
    await owner.close();
  });

  it("refuses undeclared children in ordinary callbacks through the existing sticky owner", async () => {
    const call = createStep("undeclared-ordinary-step", async (_input: void, { container }) => {
      try { await child(container).run({ input: undefined }); } catch { /* Must not erase the owning failure. */ }
      return new StepResponse(null);
    });
    const parent = createWorkflow("undeclared-ordinary-parent", () => new WorkflowResponse(call(undefined))), owner = owningPort();
    expect(Exit.isFailure(await Effect.runPromiseExit(executeWorkflow(Result.getOrThrow(parent.prepare()), undefined, owner.port)))).toBe(true);
    await owner.close();
  });

  it.each(["getOwnPropertyDescriptor", "ownKeys", "getPrototypeOf"] as const)("records a caught throwing %s options trap before rejecting the child", async trap => {
    const defect = new Error("Throwing callback options " + trap);
    let calls = 0;
    const count = createStep("proxy-child-count", () => { calls++; return new StepResponse(null); });
    const counted = createWorkflow("proxy-child", () => new WorkflowResponse(count(undefined)));
    const options = new Proxy({ input: undefined }, { [trap]: () => { throw defect; } });
    const call = createStep({ name: "caught-proxy-child", invokedWorkflows: [counted] }, async (_input: void, { container }) => {
      try { await counted(container).run(options); } catch { /* Root must still fail. */ }
      return new StepResponse(null);
    });
    const parent = createWorkflow("caught-proxy-root", () => new WorkflowResponse(call(undefined))), owner = owningPort();
    const exit = await Effect.runPromiseExit(executeWorkflow(Result.getOrThrow(parent.prepare()), undefined, owner.port));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(exit.cause.reasons).toEqual(expect.arrayContaining([expect.objectContaining({ error: defect })]));
    expect(calls).toBe(0);
    await owner.close();
  });

  it("keeps expired-view refusal sticky when a later callback in the same live root catches it", async () => {
    let escaped: ReturnType<typeof child> | undefined;
    const saveActual = createStep({ name: "save-actual-view", invokedWorkflows: [child] }, (_input: void, { container }) => {
      escaped = child(container); return new StepResponse(null);
    });
    const reuse = createStep("reuse-expired-view", async (_input: void) => {
      if (escaped === undefined) throw new Error("Missing saved view");
      try { await escaped.run({ input: undefined }); } catch { /* Same root remains live. */ }
      return new StepResponse(null);
    });
    const parent = createWorkflow("expired-live-parent", () => {
      saveActual(undefined); return new WorkflowResponse(reuse(undefined));
    }), owner = owningPort();
    expect(Exit.isFailure(await Effect.runPromiseExit(executeWorkflow(Result.getOrThrow(parent.prepare()), undefined, owner.port)))).toBe(true);
    await owner.close();
  });

  it.each(["factory", "resolve"] as const)("revokes saved container %s access while its outer root remains live", async mode => {
    let container: WorkflowContainer | undefined, lookups = 0;
    const save = createStep({ name: "save-expiring-container", invokedWorkflows: [child] }, (_input: void, context) => {
      container = context.container; return new StepResponse(null);
    });
    const reuse = createStep("reuse-expiring-container", () => {
      if (container === undefined) throw new Error("Missing saved callback container");
      try { if (mode === "factory") child(container); else container.resolve("admitted-parent-resource"); }
      catch { /* Expired capability refusal must remain fatal to its own root. */ }
      return new StepResponse(null);
    });
    const parent = createWorkflow("expired-container-root", () => { save(undefined); return new WorkflowResponse(reuse(undefined)); });
    const owner = owningPort(), port = { ...owner.port, context: { ...owner.port.context,
      container: { resolve() { lookups++; throw new Error("Unexpected resource delegation"); } } } };
    expect(Exit.isFailure(await Effect.runPromiseExit(executeWorkflow(Result.getOrThrow(parent.prepare()), undefined, port)))).toBe(true);
    expect(lookups).toBe(0);
    await owner.close();
  });

  it("forwards exact resolver arguments and receiver to the existing strict parent owner", async () => {
    const observed: unknown[][] = [], receivers: unknown[] = [];
    const parentContainer: WorkflowContainer = { resolve() {
      observed.push([...arguments]); receivers.push(this); throw new Error("Parent resolver boundary");
    } };
    const inputs = [["payment"], ["payment", undefined], ["payment", { allowUnregistered: true }], ["payment", undefined, "extra"]];
    const call = createStep("resolver-argument-forwarding", (_input: void, { container }) => {
      for (const args of inputs) { try { Reflect.apply(container.resolve, container, args); } catch { /* Inspect exact delegation. */ } }
      return new StepResponse(null);
    });
    const parent = createWorkflow("resolver-forwarding-root", () => new WorkflowResponse(call(undefined))), owner = owningPort();
    await Effect.runPromise(executeWorkflow(Result.getOrThrow(parent.prepare()), undefined,
      { ...owner.port, context: { ...owner.port.context, container: parentContainer } }));
    expect(observed).toEqual(inputs); expect(receivers.every(receiver => receiver === parentContainer)).toBe(true);
    await owner.close();
  });
});
